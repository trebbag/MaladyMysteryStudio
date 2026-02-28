import { describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "../src/pipeline/utils.js";

describe("v2 assets loader", () => {
  it("loads required schema/prompt files and caches the bundle", async () => {
    vi.resetModules();
    const mod = await import("../src/pipeline/v2_micro_detectives/assets.js");

    const first = await mod.loadV2Assets();
    const second = await mod.loadV2Assets();

    expect(first).toBe(second);
    expect(first.root).toContain("server/src/pipeline/v2_micro_detectives/assets");
    expect(first.sourceRoot).toContain("micro-detectives-schemas-prompts");
    expect(Object.keys(first.schemaFiles).length).toBeGreaterThan(0);
    expect(Object.keys(first.promptFiles).length).toBeGreaterThan(0);
    expect(first.deckSchema).toBeTypeOf("object");
    expect(first.manifest.requiredPromptFiles.length).toBeGreaterThan(0);
    expect(first.manifest.requiredSchemaFiles.length).toBeGreaterThan(0);
    expect(first.promptFiles["agent_plot_director_deckspec.md"]).toContain("[MMS_DOD_GUARDRAIL]");
  });

  it("fails loudly when a required asset file is missing", async () => {
    vi.resetModules();
    const readFile = fs.readFile.bind(fs);
    const spy = vi.spyOn(fs, "readFile").mockImplementation(async (filePath, options) => {
      const abs = String(filePath);
      if (abs.endsWith("/schemas/disease_dossier.schema.json")) {
        throw "ENOENT";
      }
      return await readFile(filePath, options as never);
    });

    const mod = await import("../src/pipeline/v2_micro_detectives/assets.js");
    await expect(mod.loadV2Assets()).rejects.toThrow(/Missing required v2 asset file/);
    spy.mockRestore();
  });

  it("fails loudly when deck schema JSON is invalid", async () => {
    vi.resetModules();
    const readFile = fs.readFile.bind(fs);
    const spy = vi.spyOn(fs, "readFile").mockImplementation(async (filePath, options) => {
      const abs = String(filePath);
      if (abs.endsWith("/schemas/deck_spec.schema.json")) {
        return "{ invalid-json";
      }
      return await readFile(filePath, options as never);
    });

    const mod = await import("../src/pipeline/v2_micro_detectives/assets.js");
    await expect(mod.loadV2Assets()).rejects.toThrow(/Invalid JSON in deck_spec\.schema\.json/);
    spy.mockRestore();
  });

  it("handles non-Error JSON.parse failures with explicit message coercion", async () => {
    vi.resetModules();
    const parseSpy = vi.spyOn(JSON, "parse").mockImplementationOnce(() => {
      throw "bad-json";
    });

    const mod = await import("../src/pipeline/v2_micro_detectives/assets.js");
    await expect(mod.loadV2Assets()).rejects.toThrow(/Invalid JSON in deck_spec\.schema\.json/);
    parseSpy.mockRestore();
  });

  it("keeps runtime asset tree in parity with micro-detectives source tree", async () => {
    const sourceRoot = path.join(repoRoot(), "micro-detectives-schemas-prompts");
    const runtimeRoot = path.join(repoRoot(), "server/src/pipeline/v2_micro_detectives/assets");
    const sourcePromptNames = (await fs.readdir(path.join(sourceRoot, "prompts"))).filter((name) => name.endsWith(".md"));
    const sourceSchemaNames = (await fs.readdir(path.join(sourceRoot, "schemas"))).filter((name) => name.endsWith(".json"));

    for (const name of sourcePromptNames) {
      await expect(fs.stat(path.join(runtimeRoot, "prompts", name))).resolves.toBeTruthy();
    }
    for (const name of sourceSchemaNames) {
      await expect(fs.stat(path.join(runtimeRoot, "schemas", name))).resolves.toBeTruthy();
    }
  });

  it("fails in strict mode when prompt lock hashes do not match", async () => {
    vi.resetModules();
    const prevMode = process.env.MMS_V2_ASSET_LOCK_MODE;
    process.env.MMS_V2_ASSET_LOCK_MODE = "strict";
    const readFile = fs.readFile.bind(fs);
    const spy = vi.spyOn(fs, "readFile").mockImplementation(async (filePath, options) => {
      const abs = String(filePath);
      if (abs.endsWith("/PROMPT_LOCK.json")) {
        return JSON.stringify({
          using_source_overlay: true,
          assets: {
            prompts: { "00_global_system_prompt.md": "deadbeef" },
            schemas: { "deck_spec.schema.json": "deadbeef" }
          }
        });
      }
      return await readFile(filePath, options as never);
    });

    const mod = await import("../src/pipeline/v2_micro_detectives/assets.js");
    await expect(mod.loadV2Assets()).rejects.toThrow(/asset lock mismatch/i);
    spy.mockRestore();
    if (prevMode === undefined) delete process.env.MMS_V2_ASSET_LOCK_MODE;
    else process.env.MMS_V2_ASSET_LOCK_MODE = prevMode;
  });

  it("warn mode allows lock mismatch while still loading assets", async () => {
    vi.resetModules();
    const prevMode = process.env.MMS_V2_ASSET_LOCK_MODE;
    process.env.MMS_V2_ASSET_LOCK_MODE = "warn";
    const readFile = fs.readFile.bind(fs);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const spy = vi.spyOn(fs, "readFile").mockImplementation(async (filePath, options) => {
      const abs = String(filePath);
      if (abs.endsWith("/PROMPT_LOCK.json")) {
        return JSON.stringify({
          using_source_overlay: false,
          assets: {
            prompts: { "00_global_system_prompt.md": "deadbeef" },
            schemas: { "deck_spec.schema.json": "deadbeef" }
          }
        });
      }
      return await readFile(filePath, options as never);
    });

    const mod = await import("../src/pipeline/v2_micro_detectives/assets.js");
    const assets = await mod.loadV2Assets();
    expect(assets.deckSchema).toBeTypeOf("object");
    expect(warnSpy).toHaveBeenCalled();
    spy.mockRestore();
    warnSpy.mockRestore();
    if (prevMode === undefined) delete process.env.MMS_V2_ASSET_LOCK_MODE;
    else process.env.MMS_V2_ASSET_LOCK_MODE = prevMode;
  });

  it("off mode skips prompt lock validation entirely", async () => {
    vi.resetModules();
    const prevMode = process.env.MMS_V2_ASSET_LOCK_MODE;
    process.env.MMS_V2_ASSET_LOCK_MODE = "off";
    const readFile = fs.readFile.bind(fs);
    const spy = vi.spyOn(fs, "readFile").mockImplementation(async (filePath, options) => {
      const abs = String(filePath);
      if (abs.endsWith("/PROMPT_LOCK.json")) {
        throw new Error("lock file should not be read in off mode");
      }
      return await readFile(filePath, options as never);
    });

    const mod = await import("../src/pipeline/v2_micro_detectives/assets.js");
    const assets = await mod.loadV2Assets();
    expect(assets.deckSchema).toBeTypeOf("object");
    spy.mockRestore();
    if (prevMode === undefined) delete process.env.MMS_V2_ASSET_LOCK_MODE;
    else process.env.MMS_V2_ASSET_LOCK_MODE = prevMode;
  });
});
