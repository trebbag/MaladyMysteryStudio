import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { EpisodeMemoryEntry } from "../src/pipeline/memory.js";
import { episodeMemoryPath, loadEpisodeMemory, remember, rememberStoryFingerprint, saveEpisodeMemory } from "../src/pipeline/memory.js";

let tmpData: string | null = null;

beforeEach(async () => {
  tmpData = await fs.mkdtemp(path.join(os.tmpdir(), "mms-data-"));
  process.env.MMS_DATA_DIR = tmpData;
  process.env.MMS_DISABLE_CANON_AUTO_DISCOVERY = "1";
});

afterEach(async () => {
  delete process.env.MMS_DATA_DIR;
  delete process.env.MMS_DISABLE_CANON_AUTO_DISCOVERY;
  if (tmpData) await fs.rm(tmpData, { recursive: true, force: true }).catch(() => undefined);
  tmpData = null;
});

describe("pipeline/memory", () => {
  it("loadEpisodeMemory creates an empty file when missing", async () => {
    const mem = await loadEpisodeMemory();
    expect(mem).toEqual({ recent: [] });
    await expect(fs.stat(episodeMemoryPath())).resolves.toBeTruthy();
  });

  it("uses MMS_EPISODE_MEMORY_PATH when provided", async () => {
    const explicit = path.join(tmpData as string, "custom", "episode_memory.json");
    process.env.MMS_EPISODE_MEMORY_PATH = explicit;
    try {
      const mem = await loadEpisodeMemory();
      expect(mem).toEqual({ recent: [] });
      expect(episodeMemoryPath()).toBe(explicit);
      await expect(fs.stat(explicit)).resolves.toBeTruthy();
    } finally {
      delete process.env.MMS_EPISODE_MEMORY_PATH;
    }
  });

  it("uses MMS_CANON_ROOT/episode/episode_memory.json when provided", async () => {
    const root = path.join(tmpData as string, "canon-root");
    process.env.MMS_CANON_ROOT = root;
    try {
      const mem = await loadEpisodeMemory();
      expect(mem).toEqual({ recent: [] });
      const expected = path.join(root, "episode", "episode_memory.json");
      expect(episodeMemoryPath()).toBe(expected);
      await expect(fs.stat(expected)).resolves.toBeTruthy();
    } finally {
      delete process.env.MMS_CANON_ROOT;
    }
  });

  it("remember de-dupes by runId and enforces max", async () => {
    const base = await loadEpisodeMemory();

    const older: EpisodeMemoryEntry = {
      at: new Date("2020-01-01T00:00:00.000Z").toISOString(),
      runId: "run1",
      key: "k1",
      variety: {
        genre_wrapper: "g",
        body_setting: "s",
        antagonist_archetype: "a",
        twist_type: "t",
        signature_gadget: "sg",
        motifs: ["m1"]
      }
    };
    const other: EpisodeMemoryEntry = { ...older, runId: "run2", key: "k2" };
    const entry: EpisodeMemoryEntry = { ...older, at: new Date().toISOString(), runId: "run1", key: "k3" };

    const next = remember({ ...base, recent: [older, other] }, entry, 2);
    expect(next.recent[0]?.key).toBe("k3");
    // run1 should not appear twice.
    expect(next.recent.filter((e) => e.runId === "run1")).toHaveLength(1);
    expect(next.recent).toHaveLength(2);
  });

  it("rememberStoryFingerprint enriches an existing run entry", async () => {
    const base: EpisodeMemoryEntry = {
      at: "t",
      runId: "run_1",
      key: "k1",
      variety: {
        genre_wrapper: "g",
        body_setting: "s",
        antagonist_archetype: "a",
        twist_type: "t",
        signature_gadget: "sg",
        motifs: ["m1"]
      }
    };

    const next = rememberStoryFingerprint({ recent: [base] }, "run_1", "fingerprint", ["Ada", "Kai"]);
    expect(next.recent[0]?.story_fingerprint).toBe("fingerprint");
    expect(next.recent[0]?.cast).toEqual(["Ada", "Kai"]);
  });

  it("saveEpisodeMemory writes to disk", async () => {
    await loadEpisodeMemory();
    const next = {
      recent: [
        {
          at: "t",
          runId: "r",
          key: "k",
          variety: {
            genre_wrapper: "g",
            body_setting: "s",
            antagonist_archetype: "a",
            twist_type: "t",
            signature_gadget: "sg",
            motifs: ["m"]
          }
        }
      ]
    };
    await saveEpisodeMemory(next);
    const raw = await fs.readFile(episodeMemoryPath(), "utf8");
    expect(raw).toContain("\"recent\"");
  });
});
