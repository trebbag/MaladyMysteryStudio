import type { PatchOutput, ShowrunnerOutput, VisualDirectorOutput } from "./schemas.js";

type ReusableVisualPrimer = PatchOutput["final_slide_spec_patched"]["reusable_visual_primer"];
type SlideSpec = PatchOutput["final_slide_spec_patched"]["slides"][number];

export const MASTER_DOC_SECTION_HEADINGS = [
  "GENSPARK GENERATION PROMPT",
  "ORIGINAL USER PROMPT",
  "GLOBAL CONSISTENCY PACK",
  "RECURRING CHARACTERS",
  "RECURRING SCENES",
  "RECURRING OBJECTS/ASSETS",
  "SLIDE-BY-SLIDE RENDER PLAN"
] as const;

export const MASTER_DOC_SLIDE_FIELD_ORDER = [
  "Slide ID",
  "Slide Title",
  "Panel 1 Text Content",
  "Panel 2 Medical Visual Content",
  "Dialogue For Speaker Notes",
  "Speaker Notes",
  "Story Description",
  "Location",
  "Scene Description",
  "Used Assets",
  "Used Characters",
  "Medical Visual Mode",
  "Render Instructions"
] as const;

export type BuildMasterDocInput = {
  topic: string;
  finalPatched: PatchOutput["final_slide_spec_patched"];
  reusableVisualPrimer: ReusableVisualPrimer;
  storyBible: ShowrunnerOutput["story_bible"];
  beatSheet: ShowrunnerOutput["beat_sheet"];
  shotList: VisualDirectorOutput["shot_list"];
  gensparkAssetBibleMd: string;
  gensparkSlideGuideMd: string;
  gensparkBuildScriptTxt: string;
};

export type MasterDocValidation = {
  ok: boolean;
  errors: string[];
};

function uniq(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter((v) => v.length > 0))];
}

function toBullets(items: string[]): string {
  if (items.length === 0) return "- None";
  return items.map((item) => `- ${item}`).join("\n");
}

function firstQuotedDialogue(input: string): string {
  const quoted = input.match(/"([^"]+)"/g) ?? [];
  if (quoted.length === 0) return input.trim();
  return quoted.join(" ");
}

function renderInstructions(slide: SlideSpec): string {
  const lines: string[] = [];
  if (slide.slide_mode === "story_transition") {
    lines.push(
      "Render as a cinematic transition/action beat. Keep medical payload off HUD bullets; preserve story continuity and location change cues."
    );
  } else if (slide.medical_visual_mode === "in_scene_annotated_visual") {
    lines.push(
      "Render the medical teaching visual inside the scene using labels/annotations. Keep panel 1 bullets legible and aligned to the same teaching target."
    );
  } else {
    lines.push("Render dual HUD panels: panel 1 for standalone medical bullets and panel 2 for the explicit medical visual payload.");
  }

  lines.push("");
  lines.push(`Character staging: ${slide.character_staging.trim()}`);
  lines.push(`Medical evidence/visual teaching payload: ${slide.evidence_visual_description.trim()}`);
  return lines.join("\n");
}

function panel2Content(slide: SlideSpec): string {
  if (slide.medical_visual_mode === "in_scene_annotated_visual") return "None";
  return slide.evidence_visual_description.trim();
}

function slideBlock(slide: SlideSpec): string {
  const panel1 = slide.hud_panel_bullets.length > 0 ? toBullets(slide.hud_panel_bullets) : "None";
  const panel2 = panel2Content(slide);

  return [
    `<!-- BEGIN_SLIDE:${slide.slide_id} -->`,
    `Slide ID: ${slide.slide_id}`,
    `Slide Title: ${slide.title}`,
    "Panel 1 Text Content:",
    panel1,
    "Panel 2 Medical Visual Content:",
    panel2,
    "Dialogue For Speaker Notes:",
    firstQuotedDialogue(slide.story_and_dialogue),
    "Speaker Notes:",
    slide.speaker_notes,
    "Story Description:",
    slide.story_and_dialogue,
    "Location:",
    slide.location_description,
    "Scene Description:",
    slide.scene_description,
    "Used Assets:",
    toBullets(slide.used_assets),
    "Used Characters:",
    toBullets(slide.used_characters),
    "Medical Visual Mode:",
    slide.medical_visual_mode,
    "Render Instructions:",
    renderInstructions(slide),
    `<!-- END_SLIDE:${slide.slide_id} -->`
  ].join("\n");
}

export function buildGensparkMasterDoc(input: BuildMasterDocInput): string {
  const recurringCharacters = uniq([
    ...input.reusableVisualPrimer.character_descriptions,
    ...input.storyBible.cast.map((c) => `${c.name}: ${c.role} — ${c.bio}`)
  ]);
  const recurringScenes = uniq([
    ...input.reusableVisualPrimer.recurring_scene_descriptions,
    ...input.beatSheet.map((b) => b.setting)
  ]);
  const recurringObjects = uniq([
    ...input.reusableVisualPrimer.reusable_visual_elements,
    ...input.shotList.map((s) => s.visual_notes)
  ]);

  const slideBlocks = input.finalPatched.slides.map((slide) => slideBlock(slide)).join("\n\n");

  const arc = input.finalPatched.story_arc_contract;
  const pastePrompt = [
    `You are generating a 16:9 educational slide deck using Genspark AI Slides.`,
    `You will be given an attached document titled "GENSPARK MASTER RENDER PLAN".`,
    ``,
    `Rules:`,
    `- Follow the document exactly. Do not invent additional recurring characters/scenes/assets beyond what it lists.`,
    `- Start by reading: GLOBAL CONSISTENCY PACK and all RECURRING sections.`,
    `- Create/lock recurring characters, scenes, and reusable objects first for continuity.`,
    `- Then generate slides in order using the strict slide blocks between BEGIN_SLIDE/END_SLIDE markers.`,
    `- Hybrid slides must include story action in-scene plus medical teaching via Panel 1 bullets, plus a medically accurate visual payload (Panel 2 or in-scene annotated).`,
    `- story_transition slides must not include Panel 1 medical bullets.`,
    `- Put "Dialogue For Speaker Notes" + "Speaker Notes" into the slide speaker notes.`,
    ``,
    `USER PROMPT:`,
    input.topic
  ].join("\n");

  return [
    "# GENSPARK MASTER RENDER PLAN",
    "",
    "## GENSPARK GENERATION PROMPT",
    "```",
    pastePrompt.trim(),
    "```",
    "",
    "## ORIGINAL USER PROMPT",
    input.topic,
    "",
    "## GLOBAL CONSISTENCY PACK",
    `- Topic: ${input.topic}`,
    `- Title: ${input.finalPatched.title}`,
    `- Intro slide IDs: ${arc.intro_slide_ids.join(", ")}`,
    `- Outro slide IDs: ${arc.outro_slide_ids.join(", ")}`,
    `- Entry to body slide ID: ${arc.entry_to_body_slide_id}`,
    `- Return to office slide ID: ${arc.return_to_office_slide_id}`,
    `- Callback slide ID: ${arc.callback_slide_id}`,
    "",
    "### Canonical continuity rules",
    toBullets(input.reusableVisualPrimer.continuity_rules),
    "",
    "## RECURRING CHARACTERS",
    toBullets(recurringCharacters),
    "",
    "## RECURRING SCENES",
    toBullets(recurringScenes),
    "",
    "## RECURRING OBJECTS/ASSETS",
    toBullets(recurringObjects),
    "",
    "## SLIDE-BY-SLIDE RENDER PLAN",
    slideBlocks
  ].join("\n");
}

type SlideBlockMatch = {
  slideId: string;
  body: string;
};

function parseSlideBlocks(markdown: string): SlideBlockMatch[] {
  const out: SlideBlockMatch[] = [];
  const rx = /<!-- BEGIN_SLIDE:([^>]+) -->([\s\S]*?)<!-- END_SLIDE:\1 -->/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(markdown)) !== null) {
    out.push({ slideId: m[1].trim(), body: m[2].trim() });
  }
  return out;
}

function fieldIndexes(blockBody: string): Record<string, number> {
  const idx: Record<string, number> = {};
  for (const field of MASTER_DOC_SLIDE_FIELD_ORDER) {
    idx[field] = blockBody.indexOf(`${field}:`);
  }
  return idx;
}

function fieldValueBetween(blockBody: string, field: string, nextField: string | null): string {
  const start = blockBody.indexOf(`${field}:`);
  if (start < 0) return "";
  const contentStart = start + `${field}:`.length;
  const end = nextField ? blockBody.indexOf(`${nextField}:`, contentStart) : blockBody.length;
  if (end < 0) return blockBody.slice(contentStart).trim();
  return blockBody.slice(contentStart, end).trim();
}

export function validateGensparkMasterDoc(
  markdown: string,
  expectedSlides: PatchOutput["final_slide_spec_patched"]["slides"]
): MasterDocValidation {
  const errors: string[] = [];
  const doc = markdown.replace(/\r\n/g, "\n");

  let lastHeadingPos = -1;
  for (const heading of MASTER_DOC_SECTION_HEADINGS) {
    const marker = `## ${heading}`;
    const pos = doc.indexOf(marker);
    if (pos === -1) {
      errors.push(`Missing required section heading: ${heading}`);
      continue;
    }
    if (pos < lastHeadingPos) {
      errors.push(`Section heading out of order: ${heading}`);
    }
    lastHeadingPos = pos;
  }

  const blocks = parseSlideBlocks(doc);
  if (blocks.length !== expectedSlides.length) {
    errors.push(`Slide block count mismatch: expected ${expectedSlides.length}, found ${blocks.length}`);
  }

  const expectedIds = expectedSlides.map((s) => s.slide_id);
  const actualIds = blocks.map((b) => b.slideId);
  if (expectedIds.join("|") !== actualIds.join("|")) {
    errors.push(`Slide block order mismatch. expected=[${expectedIds.join(", ")}] actual=[${actualIds.join(", ")}]`);
  }

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const expected = expectedSlides[i];
    if (!expected) break;

    const idx = fieldIndexes(block.body);
    let last = -1;
    for (const field of MASTER_DOC_SLIDE_FIELD_ORDER) {
      const p = idx[field];
      if (p === -1) {
        errors.push(`Slide ${block.slideId}: missing field "${field}"`);
        continue;
      }
      if (p < last) {
        errors.push(`Slide ${block.slideId}: field order violation at "${field}"`);
      }
      last = p;
    }

    const mode = fieldValueBetween(block.body, "Medical Visual Mode", "Render Instructions");
    if (mode !== expected.medical_visual_mode) {
      errors.push(`Slide ${block.slideId}: Medical Visual Mode mismatch (expected ${expected.medical_visual_mode}, found ${mode || "empty"})`);
    }

    const panel2 = fieldValueBetween(block.body, "Panel 2 Medical Visual Content", "Dialogue For Speaker Notes");
    const panel2IsNone = panel2.toLowerCase().startsWith("none");
    if (panel2IsNone && expected.medical_visual_mode !== "in_scene_annotated_visual") {
      errors.push(`Slide ${block.slideId}: Panel 2 cannot be None when medical_visual_mode is ${expected.medical_visual_mode}`);
    }
  }

  return { ok: errors.length === 0, errors };
}
