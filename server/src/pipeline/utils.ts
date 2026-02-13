import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const RUN_INTERMEDIATE_DIRNAME = "intermediate";
export const RUN_FINAL_DIRNAME = "final";

// Artifacts intended as final outputs for pilot consumption.
const FINAL_ARTIFACT_NAMES = new Set([
  "trace.json",
  "final_slide_spec_patched.json",
  "reusable_visual_primer.json",
  "medical_story_traceability_report.json",
  "qa_report.json",
  "constraint_adherence_report.json",
  "GENSPARK_ASSET_BIBLE.md",
  "GENSPARK_SLIDE_GUIDE.md",
  "GENSPARK_BUILD_SCRIPT.txt"
]);

export function nowIso(): string {
  return new Date().toISOString();
}

export function repoRoot(): string {
  // This file lives at server/src/pipeline/utils.ts
  // repo root is three levels up: pipeline -> src -> server -> repo
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../..");
}

export function outputRootAbs(): string {
  const env = process.env.MMS_OUTPUT_DIR;
  if (env && env.trim().length > 0) return path.resolve(env.trim());
  return path.join(repoRoot(), "output");
}

export function runOutputDirAbs(runId: string): string {
  return path.join(outputRootAbs(), runId);
}

export function runIntermediateDirAbs(runId: string): string {
  return path.join(runOutputDirAbs(runId), RUN_INTERMEDIATE_DIRNAME);
}

export function runFinalDirAbs(runId: string): string {
  return path.join(runOutputDirAbs(runId), RUN_FINAL_DIRNAME);
}

export function isFinalArtifactName(name: string): boolean {
  return FINAL_ARTIFACT_NAMES.has(name);
}

export function artifactAbsPath(runId: string, name: string): string {
  if (isFinalArtifactName(name)) {
    return path.join(runFinalDirAbs(runId), name);
  }
  return path.join(runIntermediateDirAbs(runId), name);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

export async function resolveArtifactPathAbs(runId: string, name: string): Promise<string | null> {
  // Keep legacy compatibility: older runs stored artifacts at the run root.
  const rootCandidate = path.join(runOutputDirAbs(runId), name);
  if (await fileExists(rootCandidate)) return rootCandidate;

  const preferredCandidate = artifactAbsPath(runId, name);
  if (await fileExists(preferredCandidate)) return preferredCandidate;

  const intermediateCandidate = path.join(runIntermediateDirAbs(runId), name);
  if (intermediateCandidate !== preferredCandidate && (await fileExists(intermediateCandidate))) return intermediateCandidate;

  const finalCandidate = path.join(runFinalDirAbs(runId), name);
  if (finalCandidate !== preferredCandidate && (await fileExists(finalCandidate))) return finalCandidate;

  return null;
}

export function dataRootAbs(): string {
  const env = process.env.MMS_DATA_DIR;
  if (env && env.trim().length > 0) return path.resolve(env.trim());
  return path.join(repoRoot(), "data");
}

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

async function atomicWrite(filePath: string, data: string | Buffer): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  await fs.writeFile(tmpPath, data);
  await fs.rename(tmpPath, filePath);
}

export async function writeTextFile(filePath: string, text: string): Promise<void> {
  const out = text.endsWith("\n") ? text : `${text}\n`;
  await atomicWrite(filePath, out);
}

export async function writeJsonFile(filePath: string, obj: unknown): Promise<void> {
  await atomicWrite(filePath, `${JSON.stringify(obj, null, 2)}\n`);
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

export async function tryReadJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return await readJsonFile<T>(filePath);
  } catch {
    return null;
  }
}

export function isSafeArtifactName(name: string): boolean {
  // Prevent path traversal and keep filenames predictable.
  if (name.includes("/") || name.includes("\\") || name.includes("..")) return false;
  return /^[A-Za-z0-9._-]+$/.test(name);
}

export function slug(input: string): string {
  const s = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s.slice(0, 60) || "untitled";
}
