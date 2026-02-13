import path from "node:path";
import { dataRootAbs, ensureDir, tryReadJsonFile, writeJsonFile } from "./utils.js";
import { resolveCanonicalProfilePaths } from "./canon.js";

export type VarietyPack = {
  genre_wrapper: string;
  body_setting: string;
  antagonist_archetype: string;
  twist_type: string;
  signature_gadget: string;
  motifs: string[];
};

export type EpisodeMemoryEntry = {
  at: string;
  runId: string;
  key: string;
  variety: VarietyPack;
  story_fingerprint?: string;
  cast?: string[];
};

export type EpisodeMemory = {
  recent: EpisodeMemoryEntry[];
};

const FILE_NAME = "episode_memory.json";

function resolveEpisodeMemoryPath(): string {
  const explicit = process.env.MMS_EPISODE_MEMORY_PATH?.trim();
  if (explicit) return path.resolve(explicit);

  const canonical = resolveCanonicalProfilePaths().templateRoot;
  if (canonical) return path.join(canonical, "episode", FILE_NAME);

  return path.join(dataRootAbs(), FILE_NAME);
}

export function episodeMemoryPath(): string {
  return resolveEpisodeMemoryPath();
}

export async function loadEpisodeMemory(): Promise<EpisodeMemory> {
  const p = episodeMemoryPath();
  await ensureDir(path.dirname(p));
  const existing = await tryReadJsonFile<EpisodeMemory>(p);
  if (existing && Array.isArray(existing.recent)) return existing;
  const empty: EpisodeMemory = { recent: [] };
  await writeJsonFile(p, empty);
  return empty;
}

export async function saveEpisodeMemory(mem: EpisodeMemory): Promise<void> {
  await writeJsonFile(episodeMemoryPath(), mem);
}

export function remember(mem: EpisodeMemory, entry: EpisodeMemoryEntry, max = 30): EpisodeMemory {
  const next = [entry, ...mem.recent.filter((e) => e.runId !== entry.runId)];
  return { recent: next.slice(0, max) };
}

export function rememberStoryFingerprint(
  mem: EpisodeMemory,
  runId: string,
  storyFingerprint: string,
  cast: string[],
  max = 30
): EpisodeMemory {
  const normalized = storyFingerprint.trim();
  if (!normalized) return mem;

  const next = mem.recent.map((entry) => {
    if (entry.runId !== runId) return entry;
    return {
      ...entry,
      story_fingerprint: normalized,
      cast: cast.slice(0, 8)
    };
  });

  return { recent: next.slice(0, max) };
}
