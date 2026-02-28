import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { repoRoot } from "../utils.js";

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
] as const;

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
] as const;

const PROMPT_MARKERS: Record<string, string[]> = Object.fromEntries(REQUIRED_PROMPT_FILES.map((name) => [name, ["[MMS_DOD_GUARDRAIL]"]]));

const DOD_GUARDRAIL_APPENDIX = [
  "",
  "## [MMS_DOD_GUARDRAIL]",
  "- Return schema-valid JSON only. No markdown wrappers.",
  "- Do not omit required fields; use conservative defaults when uncertain.",
  "- Keep outputs consistent with the fixed-length deck and story-dominance constraints.",
  "- Preserve citation traceability for all load-bearing claims."
].join("\n");

export type V2AssetManifest = {
  requiredSchemaFiles: string[];
  requiredPromptFiles: string[];
  promptMarkers: Record<string, string[]>;
};

export type V2AssetBundle = {
  root: string;
  sourceRoot: string;
  usingSourceOverlay: boolean;
  schemaFiles: Record<string, string>;
  promptFiles: Record<string, string>;
  deckSchema: Record<string, unknown>;
  manifest: V2AssetManifest;
};

export function v2AssetsRootAbs(): string {
  return path.join(repoRoot(), "server", "src", "pipeline", "v2_micro_detectives", "assets");
}

export function v2SourceAssetsRootAbs(): string {
  return path.join(repoRoot(), "micro-detectives-schemas-prompts");
}

async function readTextOrThrow(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Missing required v2 asset file: ${filePath} (${msg})`);
  }
}

async function readTextIfPresent(filePath: string): Promise<string | null> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return null;
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

function withDoDPromptPatch(name: string, content: string): string {
  const base = content.endsWith("\n") ? content : `${content}\n`;
  if (PROMPT_MARKERS[name]?.every((marker) => base.includes(marker))) return base;
  return `${base}${DOD_GUARDRAIL_APPENDIX}\n`;
}

function validatePromptMarkers(name: string, content: string): void {
  const markers = PROMPT_MARKERS[name] ?? [];
  for (const marker of markers) {
    if (!content.includes(marker)) {
      throw new Error(`Prompt asset missing required marker '${marker}': ${name}`);
    }
  }
}

function assetDigest(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

function assetLockMode(): "strict" | "warn" | "off" {
  const raw = process.env.MMS_V2_ASSET_LOCK_MODE?.trim().toLowerCase();
  if (raw === "off" || raw === "false") return "off";
  if (raw === "warn") return "warn";
  return "strict";
}

async function validateAssetLock(args: {
  root: string;
  usingSourceOverlay: boolean;
  schemaFiles: Record<string, string>;
  promptFiles: Record<string, string>;
}): Promise<void> {
  const mode = assetLockMode();
  if (mode === "off") return;

  const lockPath = path.join(args.root, "PROMPT_LOCK.json");
  const lockRaw = await readTextIfPresent(lockPath);
  if (!lockRaw) {
    if (mode === "warn") {
      console.warn(`[v2 assets] PROMPT_LOCK.json not found at ${lockPath}`);
      return;
    }
    throw new Error(`Missing required v2 asset lock file: ${lockPath}. Run npm run v2:assets:lock`);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(lockRaw) as Record<string, unknown>;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid JSON in PROMPT_LOCK.json (${msg})`);
  }

  const assets = (parsed.assets as Record<string, unknown> | undefined) ?? {};
  const expectedPrompts = (assets.prompts as Record<string, unknown> | undefined) ?? {};
  const expectedSchemas = (assets.schemas as Record<string, unknown> | undefined) ?? {};
  const expectedOverlay = Boolean(parsed.using_source_overlay);
  const mismatch: string[] = [];

  if (expectedOverlay !== args.usingSourceOverlay) {
    mismatch.push(`using_source_overlay mismatch (lock=${String(expectedOverlay)}, runtime=${String(args.usingSourceOverlay)})`);
  }

  for (const [name, content] of Object.entries(args.promptFiles)) {
    const actual = assetDigest(content);
    const expected = typeof expectedPrompts[name] === "string" ? expectedPrompts[name] : "";
    if (!expected) mismatch.push(`missing prompt hash in lock: ${name}`);
    else if (expected !== actual) mismatch.push(`prompt hash mismatch: ${name}`);
  }
  for (const [name, content] of Object.entries(args.schemaFiles)) {
    const actual = assetDigest(content);
    const expected = typeof expectedSchemas[name] === "string" ? expectedSchemas[name] : "";
    if (!expected) mismatch.push(`missing schema hash in lock: ${name}`);
    else if (expected !== actual) mismatch.push(`schema hash mismatch: ${name}`);
  }

  if (mismatch.length === 0) return;

  const msg = `v2 asset lock mismatch detected (${mismatch.join("; ")}). Run npm run v2:assets:lock`;
  if (mode === "warn") {
    console.warn(`[v2 assets] ${msg}`);
    return;
  }
  throw new Error(msg);
}

export async function loadV2AssetsManifest(): Promise<V2AssetManifest> {
  return {
    requiredSchemaFiles: [...REQUIRED_SCHEMA_FILES],
    requiredPromptFiles: [...REQUIRED_PROMPT_FILES],
    promptMarkers: PROMPT_MARKERS
  };
}

let cachedAssets: Promise<V2AssetBundle> | null = null;

export function loadV2Assets(): Promise<V2AssetBundle> {
  if (cachedAssets) return cachedAssets;

  cachedAssets = (async () => {
    const root = v2AssetsRootAbs();
    const sourceRoot = v2SourceAssetsRootAbs();
    const sourceStats = await fs
      .stat(sourceRoot)
      .then((st) => ({ exists: st.isDirectory() }))
      .catch(() => ({ exists: false }));

    const schemaFiles: Record<string, string> = {};
    for (const name of REQUIRED_SCHEMA_FILES) {
      const baselinePath = path.join(root, "schemas", name);
      let finalText = await readTextOrThrow(baselinePath);
      if (sourceStats.exists) {
        const overlayPath = path.join(sourceRoot, "schemas", name);
        const overlayText = await readTextIfPresent(overlayPath);
        if (overlayText !== null) finalText = overlayText;
      }
      schemaFiles[name] = finalText;
    }

    const promptFiles: Record<string, string> = {};
    for (const name of REQUIRED_PROMPT_FILES) {
      const baselinePath = path.join(root, "prompts", name);
      let finalText = await readTextOrThrow(baselinePath);
      if (sourceStats.exists) {
        const overlayPath = path.join(sourceRoot, "prompts", name);
        const overlayText = await readTextIfPresent(overlayPath);
        if (overlayText !== null) finalText = overlayText;
      }
      finalText = withDoDPromptPatch(name, finalText);
      validatePromptMarkers(name, finalText);
      promptFiles[name] = finalText;
    }

    let deckSchema: Record<string, unknown>;
    try {
      deckSchema = JSON.parse(schemaFiles["deck_spec.schema.json"] ?? "{}") as Record<string, unknown>;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Invalid JSON in deck_spec.schema.json (${msg})`);
    }

    await validateAssetLock({
      root,
      usingSourceOverlay: sourceStats.exists,
      schemaFiles,
      promptFiles
    });

    return {
      root,
      sourceRoot,
      usingSourceOverlay: sourceStats.exists,
      schemaFiles,
      promptFiles,
      deckSchema,
      manifest: await loadV2AssetsManifest()
    };
  })();

  return cachedAssets;
}
