import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "./utils.js";

const DEFAULT_CANON_ROOT = path.join(repoRoot(), "data", "canon");

const MAX_FILE_CHARS = 24000;

export type CanonicalProfilePaths = {
  templateRoot?: string;
  characterBiblePath?: string;
  seriesStyleBiblePath?: string;
  deckSpecPath?: string;
};

export type CanonicalProfile = {
  foundAny: boolean;
  paths: CanonicalProfilePaths;
  character_bible_md?: string;
  series_style_bible_md?: string;
  deck_spec_md?: string;
  combined_markdown: string;
  story_context_markdown: string;
  visual_context_markdown: string;
};

function sanitizePath(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return path.resolve(trimmed);
}

function autoDiscoveryDisabled(): boolean {
  const raw = process.env.MMS_DISABLE_CANON_AUTO_DISCOVERY?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function resolveTemplateRoot(): string | undefined {
  const configured = sanitizePath(process.env.MMS_CANON_ROOT);
  if (configured) return configured;
  if (autoDiscoveryDisabled()) return undefined;
  return existsSync(DEFAULT_CANON_ROOT) ? DEFAULT_CANON_ROOT : undefined;
}

function clipForPrompt(text: string): string {
  if (text.length <= MAX_FILE_CHARS) return text;
  return `${text.slice(0, MAX_FILE_CHARS)}\n\n[TRUNCATED: canonical source exceeded ${MAX_FILE_CHARS} chars]`;
}

async function readOptionalFile(filePath: string | undefined): Promise<string | undefined> {
  if (!filePath) return undefined;
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const normalized = raw.replace(/\r\n/g, "\n").trim();
    return normalized.length > 0 ? clipForPrompt(normalized) : undefined;
  } catch {
    return undefined;
  }
}

function section(title: string, body: string | undefined): string {
  if (!body) return `## ${title}\n- (Not found)\n`;
  return `## ${title}\n${body}\n`;
}

function joinSections(parts: string[]): string {
  return `${parts.map((p) => p.trimEnd()).join("\n\n")}\n`;
}

export function resolveCanonicalProfilePaths(): CanonicalProfilePaths {
  const templateRoot = resolveTemplateRoot();

  const characterBiblePath =
    sanitizePath(process.env.MMS_CHARACTER_BIBLE_PATH) ??
    (templateRoot ? path.join(templateRoot, "character_bible.md") : undefined);
  const seriesStyleBiblePath =
    sanitizePath(process.env.MMS_SERIES_STYLE_BIBLE_PATH) ??
    (templateRoot ? path.join(templateRoot, "series_style_bible.md") : undefined);
  const deckSpecPath =
    sanitizePath(process.env.MMS_DECK_SPEC_PATH) ??
    (templateRoot ? path.join(templateRoot, "episode", "deck_spec.md") : undefined);

  return { templateRoot, characterBiblePath, seriesStyleBiblePath, deckSpecPath };
}

export async function loadCanonicalProfile(): Promise<CanonicalProfile> {
  const paths = resolveCanonicalProfilePaths();

  const character = await readOptionalFile(paths.characterBiblePath);
  const series = await readOptionalFile(paths.seriesStyleBiblePath);
  const deck = await readOptionalFile(paths.deckSpecPath);

  const foundAny = Boolean(character || series || deck);

  const combined = joinSections([
    section("Character Bible", character),
    section("Series Style Bible", series),
    section("Deck Spec", deck)
  ]);

  const storyContext = joinSections([
    section("Canonical Story Constraints (Character Bible)", character),
    section("Canonical Story Constraints (Deck Spec)", deck),
    section("Canonical Tone & Series Rules (Style Bible)", series)
  ]);

  const visualContext = joinSections([
    section("Canonical Visual Constraints (Series Style Bible)", series),
    section("Canonical Visual Constraints (Deck Spec)", deck),
    section("Canonical Character Visual Notes (Character Bible)", character)
  ]);

  return {
    foundAny,
    paths,
    character_bible_md: character,
    series_style_bible_md: series,
    deck_spec_md: deck,
    combined_markdown: combined,
    story_context_markdown: storyContext,
    visual_context_markdown: visualContext
  };
}
