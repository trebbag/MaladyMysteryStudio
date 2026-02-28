#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import process from "node:process";

function repoRoot() {
  return process.cwd();
}

const REQUIRED_SCHEMA_FILES = [
  "clue_graph.schema.json",
  "deck_spec.schema.json",
  "differential_cast.schema.json",
  "disease_dossier.schema.json",
  "drama_plan.schema.json",
  "episode_pitch.schema.json",
  "human_review.schema.json",
  "med_factcheck_report.schema.json",
  "micro_world_map.schema.json",
  "qa_report.schema.json",
  "reader_sim_report.schema.json",
  "setpiece_plan.schema.json",
  "truth_model.schema.json"
];

const REQUIRED_PROMPT_FILES = [
  "00_global_system_prompt.md",
  "agent_case_engineer_truth_model.md",
  "agent_clue_architect.md",
  "agent_differential_cast_director.md",
  "agent_disease_research_desk.md",
  "agent_drama_architect.md",
  "agent_episode_pitch.md",
  "agent_micro_world_mapper.md",
  "agent_plot_director_deckspec.md",
  "agent_qa_med_factcheck.md",
  "agent_qa_reader_sim.md",
  "agent_setpiece_choreographer.md"
];

const PROMPT_MARKERS = Object.fromEntries(REQUIRED_PROMPT_FILES.map((name) => [name, ["[MMS_DOD_GUARDRAIL]"]]));

const DOD_GUARDRAIL_APPENDIX = [
  "",
  "## [MMS_DOD_GUARDRAIL]",
  "- Return schema-valid JSON only. No markdown wrappers.",
  "- Do not omit required fields; use conservative defaults when uncertain.",
  "- Keep outputs consistent with the fixed-length deck and story-dominance constraints.",
  "- Preserve citation traceability for all load-bearing claims."
].join("\n");

function sha256(content) {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

function withDoDPromptPatch(name, content) {
  const base = content.endsWith("\n") ? content : `${content}\n`;
  const requiredMarkers = PROMPT_MARKERS[name] ?? [];
  if (requiredMarkers.every((marker) => base.includes(marker))) return base;
  return `${base}${DOD_GUARDRAIL_APPENDIX}\n`;
}

async function readText(filePath) {
  return await fs.readFile(filePath, "utf8");
}

async function readTextIfPresent(filePath) {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return null;
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function collectEffectiveAssets() {
  const runtimeRoot = path.join(repoRoot(), "server", "src", "pipeline", "v2_micro_detectives", "assets");
  const sourceRoot = path.join(repoRoot(), "micro-detectives-schemas-prompts");
  const sourceExists = await fs
    .stat(sourceRoot)
    .then((st) => st.isDirectory())
    .catch(() => false);

  const prompts = {};
  for (const name of REQUIRED_PROMPT_FILES) {
    const runtimePath = path.join(runtimeRoot, "prompts", name);
    let content = await readText(runtimePath);
    if (sourceExists) {
      const sourceContent = await readTextIfPresent(path.join(sourceRoot, "prompts", name));
      if (sourceContent !== null) content = sourceContent;
    }
    content = withDoDPromptPatch(name, content);
    prompts[name] = sha256(content);
  }

  const schemas = {};
  for (const name of REQUIRED_SCHEMA_FILES) {
    const runtimePath = path.join(runtimeRoot, "schemas", name);
    let content = await readText(runtimePath);
    if (sourceExists) {
      const sourceContent = await readTextIfPresent(path.join(sourceRoot, "schemas", name));
      if (sourceContent !== null) content = sourceContent;
    }
    schemas[name] = sha256(content);
  }

  return {
    runtimeRoot,
    sourceRoot,
    usingSourceOverlay: sourceExists,
    prompts,
    schemas
  };
}

function parseArgs(argv) {
  const args = { check: false };
  for (const token of argv) {
    if (token === "--check") args.check = true;
  }
  return args;
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function lockPath() {
  return path.join(repoRoot(), "server", "src", "pipeline", "v2_micro_detectives", "assets", "PROMPT_LOCK.json");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const effective = await collectEffectiveAssets();
  const next = {
    schema_version: "1.0.0",
    generated_at: new Date().toISOString(),
    generated_by: "scripts/build_v2_asset_lock.mjs",
    using_source_overlay: effective.usingSourceOverlay,
    assets: {
      prompts: effective.prompts,
      schemas: effective.schemas
    }
  };

  const targetPath = lockPath();
  if (args.check) {
    const raw = await fs.readFile(targetPath, "utf8");
    const existing = JSON.parse(raw);
    const comparableExisting = {
      assets: existing?.assets ?? {},
      using_source_overlay: Boolean(existing?.using_source_overlay)
    };
    const comparableNext = {
      assets: next.assets,
      using_source_overlay: next.using_source_overlay
    };
    if (!deepEqual(comparableExisting, comparableNext)) {
      throw new Error("PROMPT_LOCK.json is out of date. Run: npm run v2:assets:lock");
    }
    // eslint-disable-next-line no-console
    console.log("PROMPT_LOCK.json is up to date.");
    return;
  }

  await fs.writeFile(targetPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  // eslint-disable-next-line no-console
  console.log(`Wrote ${targetPath}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  // eslint-disable-next-line no-console
  console.error(`build_v2_asset_lock failed: ${message}`);
  process.exitCode = 1;
});
