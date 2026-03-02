import { z } from "zod";
import { nowIso } from "./utils.js";
import type { CanonicalProfile } from "./canon.js";

export const WORKSHOP_CHAPTER_CATEGORIES = [
  "Common Initial Complaints",
  "Normal Physiology",
  "Pathophysiology",
  "Clinical Features",
  "Diagnosis workup",
  "Differentials",
  "Acute treatment",
  "Long term treatment",
  "Prognosis and complications",
  "Patient counseling/prevention"
] as const;

const ChapterOutlineSubtopicSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  content_md: z.string().optional().default("")
});

const ChapterOutlineTopicAreaSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  subtopics: z.array(ChapterOutlineSubtopicSchema).min(1)
});

const ChapterOutlineCategorySchema = z.object({
  order: z.number().int().min(1),
  title: z.string().min(1),
  topic_areas: z.array(ChapterOutlineTopicAreaSchema).min(1)
});

const ChapterOutlineBodySchema = z.object({
  categories: z.array(ChapterOutlineCategorySchema).min(1)
});

export const ChapterOutlineArtifactSchema = z.object({
  chapter_outline: ChapterOutlineBodySchema
});

const StoryBeatFreeSchema = z.object({
  user_notes: z.string().default(""),
  beat_md: z.string().default(""),
  generation_count: z.number().int().min(0).default(0),
  updated_at: z.string().optional()
});

export const StoryBeatNodeSchema = z.object({
  topic_area_id: z.string().min(1),
  category_title: z.string().min(1),
  topic_area_title: z.string().min(1),
  outline_md: z.string().min(1),
  user_notes: z.string().default(""),
  beat_md: z.string().default(""),
  generation_count: z.number().int().min(0).default(0),
  updated_at: z.string().optional(),
  continuity_hook: z.string().optional()
});

export const StoryBeatsSchema = z.object({
  schema_version: z.literal("1.0.0"),
  topic: z.string().min(1),
  intro: StoryBeatFreeSchema,
  outro: StoryBeatFreeSchema,
  topic_area_beats: z.record(z.string(), StoryBeatNodeSchema),
  updated_at: z.string().optional()
});

export const StoryBeatsPatchSchema = z
  .object({
    topicAreaId: z.string().min(1),
    categoryTitle: z.string().optional(),
    topicAreaTitle: z.string().optional(),
    userNotes: z.string().max(20000).optional(),
    beatMd: z.string().max(50000).optional()
  })
  .strict();

export const StoryBeatGenerateBodySchema = z
  .object({
    categoryTitle: z.string().max(200).optional(),
    topicAreaId: z.string().min(1),
    userNotes: z.string().max(20000).optional()
  })
  .strict();

export type ChapterOutlineArtifact = z.infer<typeof ChapterOutlineArtifactSchema>;
export type StoryBeats = z.infer<typeof StoryBeatsSchema>;
export type StoryBeatNode = z.infer<typeof StoryBeatNodeSchema>;
export type StoryBeatsPatch = z.infer<typeof StoryBeatsPatchSchema>;
export type StoryBeatGenerateBody = z.infer<typeof StoryBeatGenerateBodySchema>;

function compact(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`;
}

function dedupePreserveOrder(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const v = raw.trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

export function parseChapterOutlineArtifact(data: unknown): ChapterOutlineArtifact {
  if (typeof data !== "object" || data === null) {
    throw new Error("chapter outline payload is not an object");
  }
  const candidate = data as Record<string, unknown>;
  if ("chapter_outline" in candidate) {
    return ChapterOutlineArtifactSchema.parse(candidate);
  }
  return ChapterOutlineArtifactSchema.parse({ chapter_outline: candidate });
}

function outlineMarkdown(node: { id: string; title: string; subtopics: Array<{ id: string; title: string; content_md?: string }> }): string {
  const lines: string[] = [];
  lines.push(`## ${node.id} ${node.title}`);
  for (const subtopic of node.subtopics) {
    lines.push(`- **${subtopic.id} ${subtopic.title}**`);
    if (subtopic.content_md && subtopic.content_md.trim().length > 0) {
      lines.push(`  - ${compact(subtopic.content_md.replace(/\s+/g, " ").trim(), 320)}`);
    }
  }
  return lines.join("\n");
}

export function createStoryBeatsSkeleton(topic: string, outline: ChapterOutlineArtifact): StoryBeats {
  const topic_area_beats: Record<string, StoryBeatNode> = {};
  const categories = outline.chapter_outline.categories.slice().sort((a, b) => a.order - b.order);
  for (const category of categories) {
    for (const topicArea of category.topic_areas) {
      topic_area_beats[topicArea.id] = {
        topic_area_id: topicArea.id,
        category_title: category.title,
        topic_area_title: topicArea.title,
        outline_md: outlineMarkdown(topicArea),
        user_notes: "",
        beat_md: "",
        generation_count: 0,
        updated_at: nowIso()
      };
    }
  }

  return {
    schema_version: "1.0.0",
    topic,
    intro: { user_notes: "", beat_md: "", generation_count: 0, updated_at: nowIso() },
    outro: { user_notes: "", beat_md: "", generation_count: 0, updated_at: nowIso() },
    topic_area_beats,
    updated_at: nowIso()
  };
}

export function mergeStoryBeatsWithSkeleton(current: StoryBeats, skeleton: StoryBeats): StoryBeats {
  const mergedTopicAreaBeats: Record<string, StoryBeatNode> = {};
  for (const [topicAreaId, base] of Object.entries(skeleton.topic_area_beats)) {
    const existing = current.topic_area_beats[topicAreaId];
    mergedTopicAreaBeats[topicAreaId] = existing
      ? {
          ...base,
          ...existing,
          topic_area_id: base.topic_area_id,
          category_title: base.category_title,
          topic_area_title: base.topic_area_title,
          outline_md: base.outline_md
        }
      : base;
  }

  return StoryBeatsSchema.parse({
    schema_version: "1.0.0",
    topic: current.topic || skeleton.topic,
    intro: { ...skeleton.intro, ...current.intro },
    outro: { ...skeleton.outro, ...current.outro },
    topic_area_beats: mergedTopicAreaBeats,
    updated_at: nowIso()
  });
}

export function applyStoryBeatsPatch(current: StoryBeats, patch: StoryBeatsPatch): StoryBeats {
  const at = nowIso();
  if (patch.topicAreaId === "INTRO") {
    const next = {
      ...current,
      intro: {
        ...current.intro,
        user_notes: patch.userNotes ?? current.intro.user_notes,
        beat_md: patch.beatMd ?? current.intro.beat_md,
        updated_at: at
      },
      updated_at: at
    };
    return StoryBeatsSchema.parse(next);
  }

  if (patch.topicAreaId === "OUTRO") {
    const next = {
      ...current,
      outro: {
        ...current.outro,
        user_notes: patch.userNotes ?? current.outro.user_notes,
        beat_md: patch.beatMd ?? current.outro.beat_md,
        updated_at: at
      },
      updated_at: at
    };
    return StoryBeatsSchema.parse(next);
  }

  const existing = current.topic_area_beats[patch.topicAreaId];
  if (!existing) {
    throw new Error(`Unknown topicAreaId: ${patch.topicAreaId}`);
  }

  const nextNode: StoryBeatNode = {
    ...existing,
    category_title: patch.categoryTitle ?? existing.category_title,
    topic_area_title: patch.topicAreaTitle ?? existing.topic_area_title,
    user_notes: patch.userNotes ?? existing.user_notes,
    beat_md: patch.beatMd ?? existing.beat_md,
    updated_at: at
  };

  return StoryBeatsSchema.parse({
    ...current,
    topic_area_beats: {
      ...current.topic_area_beats,
      [patch.topicAreaId]: nextNode
    },
    updated_at: at
  });
}

function summaryOfPriorBeats(storyBeats: StoryBeats, limit = 3): string[] {
  const lines: string[] = [];
  const topical = Object.values(storyBeats.topic_area_beats).filter((node) => node.beat_md.trim().length > 0);
  topical.sort((a, b) => (a.updated_at ?? "").localeCompare(b.updated_at ?? ""));
  for (const node of topical.slice(-limit)) {
    lines.push(`${node.topic_area_id} ${node.topic_area_title}: ${compact(node.beat_md.replace(/\s+/g, " "), 180)}`);
  }
  if (storyBeats.intro.beat_md.trim()) lines.push(`INTRO: ${compact(storyBeats.intro.beat_md.replace(/\s+/g, " "), 180)}`);
  if (storyBeats.outro.beat_md.trim()) lines.push(`OUTRO: ${compact(storyBeats.outro.beat_md.replace(/\s+/g, " "), 180)}`);
  return lines.slice(-limit);
}

function canonicalCue(profile: CanonicalProfile): string {
  const cues = dedupePreserveOrder([
    profile.character_bible_md ? "Preserve canonical characters and their behavior constraints." : "",
    profile.series_style_bible_md ? "Preserve canonical tone, visual language, and mystery pacing style." : "",
    profile.deck_spec_md ? "Preserve deck-spec pacing and educational framing constraints." : ""
  ]);
  return cues.length > 0 ? cues.join(" ") : "Use existing Cyto/Pip detective tone while keeping medical truth primary.";
}

export function generateDeterministicStoryBeat(args: {
  topic: string;
  topicAreaId: string;
  categoryTitle?: string;
  userNotes?: string;
  storyBeats: StoryBeats;
  canonicalProfile: CanonicalProfile;
}): string {
  const noteText = (args.userNotes ?? "").trim();
  const prior = summaryOfPriorBeats(args.storyBeats);
  const continuity = prior.length > 0 ? prior.map((line) => `- ${line}`).join("\n") : "- (No prior beats yet)";
  const canon = canonicalCue(args.canonicalProfile);

  if (args.topicAreaId === "INTRO") {
    return [
      `### Intro Beat — ${args.topic}`,
      "",
      `Cyto and Pip open with a quirky detective routine that establishes stakes and tone. A new case interrupts the routine and forces an immediate pivot.`,
      "",
      `- **Case ignition:** Introduce the presenting complaint mystery and why delay is dangerous.`,
      `- **Office return + shrink entry:** End this beat with the pair returning to headquarters, activating the shrinking device, and entering the body.`,
      `- **Canon constraints:** ${canon}`,
      noteText ? `- **User notes integrated:** ${noteText}` : "",
      "",
      `**Continuity hooks**`,
      continuity
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (args.topicAreaId === "OUTRO") {
    return [
      `### Outro Beat — ${args.topic}`,
      "",
      `Cyto and Pip close the case with a clear medical resolution and return to normal size at the office.`,
      "",
      `- **Resolution:** Explicitly connect solved clues to clinical decisions and patient outcomes.`,
      `- **Callback ending:** End with a fun callback to the intro routine so the episode lands as a full-circle mystery.`,
      `- **Canon constraints:** ${canon}`,
      noteText ? `- **User notes integrated:** ${noteText}` : "",
      "",
      `**Continuity hooks**`,
      continuity
    ]
      .filter(Boolean)
      .join("\n");
  }

  const node = args.storyBeats.topic_area_beats[args.topicAreaId];
  if (!node) {
    throw new Error(`Unknown topicAreaId: ${args.topicAreaId}`);
  }

  const teachingPayload = node.outline_md
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- **"))
    .slice(0, 6)
    .map((line) => `- ${line.replace(/^- \*\*/, "").replace(/\*\*$/, "")}`)
    .join("\n");

  return [
    `### Beat ${node.topic_area_id} — ${node.topic_area_title}`,
    "",
    `Category: ${args.categoryTitle ?? node.category_title}`,
    "",
    `Cyto and Pip investigate this scene as an active mystery moment while teaching the medical content through clues, actions, and evidence interpretation.`,
    "",
    `**Medical content to embed in-scene**`,
    teachingPayload || "- Use the topic-area subtopics as the scene evidence payload.",
    "",
    `**Story action**`,
    `- Start with a concrete goal tied to ${node.topic_area_title}.`,
    `- Add an obstacle or false lead that tests reasoning.`,
    `- Resolve with a clue that advances the larger case and sets up the next beat.`,
    "",
    `**Continuity hooks**`,
    continuity,
    "",
    `**Canon constraints**`,
    `- ${canon}`,
    noteText ? `- User notes integrated: ${noteText}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}
