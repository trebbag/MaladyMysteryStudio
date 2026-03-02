#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

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


function repoRoot() {
  return process.cwd();
}

function runtimeRoot() {
  return path.join(repoRoot(), "server", "src", "pipeline", "v2_micro_detectives", "assets");
}

function sourceRoot() {
  return path.join(repoRoot(), "micro-detectives-schemas-prompts");
}

async function readTextOrThrow(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return raw.replace(/\r\n/g, "\n");
}

async function assertExistsDirectory(dirPath, label) {
  try {
    const st = await fs.stat(dirPath);
    if (!st.isDirectory()) throw new Error(`${label} is not a directory: ${dirPath}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Missing ${label}: ${dirPath} (${msg})`);
  }
}

async function main() {
  const srcRoot = sourceRoot();
  const runRoot = runtimeRoot();
  await assertExistsDirectory(srcRoot, "source asset root");
  await assertExistsDirectory(runRoot, "runtime asset root");

  const mismatches = [];

  for (const name of REQUIRED_SCHEMA_FILES) {
    const srcPath = path.join(srcRoot, "schemas", name);
    const runPath = path.join(runRoot, "schemas", name);
    const src = await readTextOrThrow(srcPath);
    const run = await readTextOrThrow(runPath);
    if (src !== run) mismatches.push(`schema mismatch: ${name}`);
  }

  for (const name of REQUIRED_PROMPT_FILES) {
    const srcPath = path.join(srcRoot, "prompts", name);
    const runPath = path.join(runRoot, "prompts", name);
    const src = await readTextOrThrow(srcPath);
    const run = await readTextOrThrow(runPath);
    if (src !== run) mismatches.push(`prompt mismatch: ${name}`);
  }

  if (mismatches.length > 0) {
    throw new Error(
      `v2 asset sync mismatch detected (${mismatches.length}): ${mismatches.join(
        "; "
      )}. Sync source assets into runtime assets and rerun lock generation.`
    );
  }

  // eslint-disable-next-line no-console
  console.log("v2 asset sync check passed (source folder matches runtime assets).");
}

main().catch((error) => {
  const msg = error instanceof Error ? error.message : String(error);
  // eslint-disable-next-line no-console
  console.error(`check_v2_asset_sync failed: ${msg}`);
  process.exitCode = 1;
});
