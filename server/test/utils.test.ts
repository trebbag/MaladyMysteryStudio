import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  artifactAbsPath,
  dataRootAbs,
  ensureDir,
  isFinalArtifactName,
  isSafeArtifactName,
  nowIso,
  outputRootAbs,
  readJsonFile,
  repoRoot,
  resolveArtifactPathAbs,
  runFinalDirAbs,
  runIntermediateDirAbs,
  slug,
  tryReadJsonFile,
  writeJsonFile,
  writeTextFile
} from "../src/pipeline/utils.js";

let savedOutputDir: string | undefined;
let savedDataDir: string | undefined;

beforeEach(() => {
  savedOutputDir = process.env.MMS_OUTPUT_DIR;
  savedDataDir = process.env.MMS_DATA_DIR;
});

afterEach(() => {
  if (savedOutputDir === undefined) delete process.env.MMS_OUTPUT_DIR;
  else process.env.MMS_OUTPUT_DIR = savedOutputDir;

  if (savedDataDir === undefined) delete process.env.MMS_DATA_DIR;
  else process.env.MMS_DATA_DIR = savedDataDir;
});

describe("pipeline/utils", () => {
  it("repoRoot resolves to the parent of server cwd", () => {
    expect(repoRoot()).toBe(path.resolve(process.cwd(), ".."));
  });

  it("outputRootAbs uses MMS_OUTPUT_DIR when set", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mms-out-"));
    process.env.MMS_OUTPUT_DIR = tmp;
    expect(outputRootAbs()).toBe(tmp);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("outputRootAbs defaults under repo root when MMS_OUTPUT_DIR is unset", () => {
    delete process.env.MMS_OUTPUT_DIR;
    expect(outputRootAbs()).toBe(path.join(repoRoot(), "output"));
  });

  it("dataRootAbs uses MMS_DATA_DIR when set", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mms-data-"));
    process.env.MMS_DATA_DIR = tmp;
    expect(dataRootAbs()).toBe(tmp);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("dataRootAbs defaults under repo root when MMS_DATA_DIR is unset", () => {
    delete process.env.MMS_DATA_DIR;
    expect(dataRootAbs()).toBe(path.join(repoRoot(), "data"));
  });

  it("ensureDir creates a directory recursively", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mms-dir-"));
    const nested = path.join(tmp, "a/b/c");
    await ensureDir(nested);
    await expect(fs.stat(nested)).resolves.toBeTruthy();
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("writeTextFile ensures a trailing newline", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mms-file-"));
    const p = path.join(tmp, "a.txt");
    await writeTextFile(p, "hello");
    const raw = await fs.readFile(p, "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("writeTextFile preserves input when it already ends with a newline", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mms-file-"));
    const p = path.join(tmp, "a.txt");
    await writeTextFile(p, "hello\n");
    const raw = await fs.readFile(p, "utf8");
    expect(raw).toBe("hello\n");
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("writeJsonFile + readJsonFile roundtrip", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mms-json-"));
    const p = path.join(tmp, "a.json");
    await writeJsonFile(p, { at: nowIso(), ok: true });
    const obj = await readJsonFile<{ ok: boolean }>(p);
    expect(obj.ok).toBe(true);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("tryReadJsonFile returns null for missing/invalid json", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mms-json-"));
    const missing = await tryReadJsonFile(path.join(tmp, "nope.json"));
    expect(missing).toBeNull();
    await fs.writeFile(path.join(tmp, "bad.json"), "{not valid json", "utf8");
    const bad = await tryReadJsonFile(path.join(tmp, "bad.json"));
    expect(bad).toBeNull();
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("isSafeArtifactName rejects traversal and weird chars", () => {
    expect(isSafeArtifactName("../x.txt")).toBe(false);
    expect(isSafeArtifactName("a/b.txt")).toBe(false);
    expect(isSafeArtifactName("a\\b.txt")).toBe(false);
    expect(isSafeArtifactName("bad name.txt")).toBe(false);
    expect(isSafeArtifactName("good_name-1.json")).toBe(true);
  });

  it("slug normalizes and truncates input", () => {
    expect(slug("Hello, World!")).toBe("hello-world");
    expect(slug("   ")).toBe("untitled");
  });

  it("routes final and intermediate artifacts into separate subfolders", () => {
    const runId = "abc";
    expect(isFinalArtifactName("GENSPARK_ASSET_BIBLE.md")).toBe(true);
    expect(isFinalArtifactName("qa_report.json")).toBe(true);
    expect(isFinalArtifactName("kb_context.md")).toBe(false);

    expect(artifactAbsPath(runId, "GENSPARK_ASSET_BIBLE.md")).toBe(path.join(runFinalDirAbs(runId), "GENSPARK_ASSET_BIBLE.md"));
    expect(artifactAbsPath(runId, "kb_context.md")).toBe(path.join(runIntermediateDirAbs(runId), "kb_context.md"));
  });

  it("resolveArtifactPathAbs supports root legacy files and new subfolders", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mms-artifacts-"));
    process.env.MMS_OUTPUT_DIR = tmp;

    const runId = "run1";
    const root = path.join(tmp, runId);
    const intermediate = runIntermediateDirAbs(runId);
    const final = runFinalDirAbs(runId);
    await fs.mkdir(root, { recursive: true });
    await fs.mkdir(intermediate, { recursive: true });
    await fs.mkdir(final, { recursive: true });

    const legacy = path.join(root, "legacy.txt");
    const inter = path.join(intermediate, "kb_context.md");
    const fin = path.join(final, "qa_report.json");
    await fs.writeFile(legacy, "legacy\n", "utf8");
    await fs.writeFile(inter, "intermediate\n", "utf8");
    await fs.writeFile(fin, "{\"qa_report\":{}}\n", "utf8");

    await expect(resolveArtifactPathAbs(runId, "legacy.txt")).resolves.toBe(legacy);
    await expect(resolveArtifactPathAbs(runId, "kb_context.md")).resolves.toBe(inter);
    await expect(resolveArtifactPathAbs(runId, "qa_report.json")).resolves.toBe(fin);
    await expect(resolveArtifactPathAbs(runId, "missing.txt")).resolves.toBeNull();

    await fs.rm(tmp, { recursive: true, force: true });
  });
});
