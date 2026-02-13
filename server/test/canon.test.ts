import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadCanonicalProfile, resolveCanonicalProfilePaths } from "../src/pipeline/canon.js";

let tmpDir: string | null = null;
let prevEnv: Record<string, string | undefined>;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mms-canon-test-"));
  await fs.mkdir(path.join(tmpDir, "episode"), { recursive: true });
  prevEnv = {
    MMS_CANON_ROOT: process.env.MMS_CANON_ROOT,
    MMS_CHARACTER_BIBLE_PATH: process.env.MMS_CHARACTER_BIBLE_PATH,
    MMS_SERIES_STYLE_BIBLE_PATH: process.env.MMS_SERIES_STYLE_BIBLE_PATH,
    MMS_DECK_SPEC_PATH: process.env.MMS_DECK_SPEC_PATH,
    MMS_DISABLE_CANON_AUTO_DISCOVERY: process.env.MMS_DISABLE_CANON_AUTO_DISCOVERY
  };
  process.env.MMS_DISABLE_CANON_AUTO_DISCOVERY = "1";
  delete process.env.MMS_CANON_ROOT;
  delete process.env.MMS_CHARACTER_BIBLE_PATH;
  delete process.env.MMS_SERIES_STYLE_BIBLE_PATH;
  delete process.env.MMS_DECK_SPEC_PATH;
});

afterEach(async () => {
  for (const [k, v] of Object.entries(prevEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  tmpDir = null;
});

describe("pipeline/canon", () => {
  it("defaults to in-repo data/canon when discovery is enabled", () => {
    process.env.MMS_DISABLE_CANON_AUTO_DISCOVERY = "0";
    const paths = resolveCanonicalProfilePaths();
    expect(paths.templateRoot).toContain(path.join("data", "canon"));
  });

  it("resolves canonical paths from MMS_CANON_ROOT", () => {
    process.env.MMS_CANON_ROOT = tmpDir as string;
    const paths = resolveCanonicalProfilePaths();
    expect(paths.templateRoot).toBe(tmpDir);
    expect(paths.characterBiblePath).toBe(path.join(tmpDir as string, "character_bible.md"));
    expect(paths.seriesStyleBiblePath).toBe(path.join(tmpDir as string, "series_style_bible.md"));
    expect(paths.deckSpecPath).toBe(path.join(tmpDir as string, "episode", "deck_spec.md"));
  });

  it("respects explicit per-file overrides", () => {
    const c = path.join(tmpDir as string, "c.md");
    const s = path.join(tmpDir as string, "s.md");
    const d = path.join(tmpDir as string, "d.md");
    process.env.MMS_CHARACTER_BIBLE_PATH = c;
    process.env.MMS_SERIES_STYLE_BIBLE_PATH = s;
    process.env.MMS_DECK_SPEC_PATH = d;
    const paths = resolveCanonicalProfilePaths();
    expect(paths.characterBiblePath).toBe(c);
    expect(paths.seriesStyleBiblePath).toBe(s);
    expect(paths.deckSpecPath).toBe(d);
  });

  it("loads files, catches missing paths, and truncates long canonical text", async () => {
    const characterPath = path.join(tmpDir as string, "character_bible.md");
    const stylePath = path.join(tmpDir as string, "series_style_bible.md");
    const deckPath = path.join(tmpDir as string, "episode", "deck_spec.md");

    await fs.writeFile(characterPath, "CHAR_A\n", "utf8");
    await fs.writeFile(stylePath, `${"X".repeat(25050)}\n`, "utf8");
    // deck path intentionally missing to exercise read catch branch

    process.env.MMS_CHARACTER_BIBLE_PATH = characterPath;
    process.env.MMS_SERIES_STYLE_BIBLE_PATH = stylePath;
    process.env.MMS_DECK_SPEC_PATH = deckPath;

    const canon = await loadCanonicalProfile();
    expect(canon.foundAny).toBe(true);
    expect(canon.character_bible_md).toContain("CHAR_A");
    expect(canon.series_style_bible_md).toContain("[TRUNCATED:");
    expect(canon.deck_spec_md).toBeUndefined();
    expect(canon.combined_markdown).toContain("## Character Bible");
    expect(canon.combined_markdown).toContain("## Deck Spec");
    expect(canon.story_context_markdown).toContain("Canonical Story Constraints");
    expect(canon.visual_context_markdown).toContain("Canonical Visual Constraints");
  });
});
