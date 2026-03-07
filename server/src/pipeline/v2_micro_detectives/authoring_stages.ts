import {
  ActOutlineSchema,
  DeckAssemblyReportSchema,
  DeckSpecSchema,
  NarrativeStateSchema,
  SlideBlockSchema,
  StoryBlueprintSchema,
  type ActOutline,
  type ClueGraph,
  type DeckAssemblyReport,
  type DeckSlideSpec,
  type DeckSpec,
  type DifferentialCast,
  type DramaPlan,
  type NarrativeState,
  type SetpiecePlan,
  type SlideBlock,
  type SlideBlockOperation,
  type StoryBlueprint
} from "./schemas.js";

type StoryBlueprintInput = {
  topic: string;
  clueObligations: string[];
};

type ActOutlineInput = {
  deck: DeckSpec;
  storyBlueprint: StoryBlueprint;
};

export type SlideBlockPlan = {
  blockId: string;
  actId: "ACT1" | "ACT2" | "ACT3" | "ACT4";
  start: number;
  end: number;
  unresolvedThreadsIn: string[];
};

type BuildBlockFallbackInput = {
  deck: DeckSpec;
  plan: SlideBlockPlan;
  priorSummary?: string;
};

type ApplyBlocksInput = {
  scaffoldDeck: DeckSpec;
  blocks: SlideBlock[];
};

type ApplyOperationState = {
  slides: DeckSlideSpec[];
  warnings: string[];
  blockId: string;
};

function clampPromptText(value: string, maxChars: number): string {
  const trimmed = String(value ?? "").trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function compactPromptJson<T>(value: T, maxChars = 2_000): string {
  return clampPromptText(JSON.stringify(value, null, 2), maxChars);
}

function uniqueStrings(values: Array<string | undefined | null>, maxItems?: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (normalized.length === 0 || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (typeof maxItems === "number" && out.length >= maxItems) break;
  }
  return out;
}

function chunkSlides(start: number, end: number, preferred = 16): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  let cursor = start;
  while (cursor <= end) {
    const nextEnd = Math.min(end, cursor + preferred - 1);
    ranges.push({ start: cursor, end: nextEnd });
    cursor = nextEnd + 1;
  }
  return ranges;
}

function slideOrderValue(slideId: string): number {
  const value = Number(String(slideId).replace(/^S/i, ""));
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

function canonicalSlideIdKey(slideId: string | undefined | null): string {
  const raw = String(slideId ?? "").trim();
  if (raw.length === 0) return "";
  const numeric = raw.match(/\d+/)?.[0];
  if (numeric) {
    const normalized = String(Number(numeric));
    return normalized === "NaN" ? raw.toUpperCase() : normalized;
  }
  return raw.toUpperCase();
}

function sortSlides(slides: DeckSlideSpec[]): DeckSlideSpec[] {
  return [...slides].sort((a, b) => {
    const aVal = slideOrderValue(a.slide_id);
    const bVal = slideOrderValue(b.slide_id);
    if (Number.isFinite(aVal) && Number.isFinite(bVal)) return aVal - bVal;
    if (Number.isFinite(aVal)) return -1;
    if (Number.isFinite(bVal)) return 1;
    return a.slide_id.localeCompare(b.slide_id);
  });
}

function cloneSlide(slide: DeckSlideSpec): DeckSlideSpec {
  return JSON.parse(JSON.stringify(slide)) as DeckSlideSpec;
}

function findSlideIndex(slides: DeckSlideSpec[], slideId: string): number {
  const targetKey = canonicalSlideIdKey(slideId);
  return slides.findIndex((slide) => canonicalSlideIdKey(slide.slide_id) === targetKey);
}

function applyBlockOverride(slide: DeckSlideSpec, override: NonNullable<SlideBlock["slide_overrides"]>[number]): DeckSlideSpec {
  const updated: DeckSlideSpec = cloneSlide(slide);
  if (override.title) updated.title = override.title;
  if (override.hook) updated.hook = override.hook;
  if (override.visual_description) updated.visual_description = override.visual_description;
  if (override.story_panel) updated.story_panel = override.story_panel;
  if (override.delivery_mode) {
    updated.medical_payload = {
      ...updated.medical_payload,
      delivery_mode: override.delivery_mode
    };
  }
  if (override.major_concept_id) {
    updated.medical_payload = {
      ...updated.medical_payload,
      major_concept_id: override.major_concept_id
    };
  }
  if (override.speaker_notes_patch) {
    updated.speaker_notes = {
      ...updated.speaker_notes,
      narrative_notes: `${updated.speaker_notes.narrative_notes ?? ""} ${override.speaker_notes_patch}`.trim()
    };
  }
  return updated;
}

function normalizeOperationsFromOverrides(block: SlideBlock, currentSlides: DeckSlideSpec[], warnings: string[]): SlideBlockOperation[] {
  const overrides = block.slide_overrides ?? [];
  const operations: SlideBlockOperation[] = [];
  for (const override of overrides) {
    const base = currentSlides.find((slide) => slide.slide_id === override.slide_id);
    if (!base) {
      warnings.push(`Block ${block.block_id} override references missing slide_id ${override.slide_id}.`);
      continue;
    }
    const replacement = applyBlockOverride(base, override);
    replacement.slide_id = override.slide_id;
    operations.push({
      op: "replace_slide",
      slide_id: override.slide_id,
      replacement_slide: replacement,
      reason: override.speaker_notes_patch ?? "Converted from slide_overrides fallback."
    });
  }
  return operations;
}

export function normalizeSlideBlockOperations(input: { block: SlideBlock; currentSlides: DeckSlideSpec[] }): {
  operations: SlideBlockOperation[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const ops = input.block.operations && input.block.operations.length > 0
    ? input.block.operations
    : normalizeOperationsFromOverrides(input.block, input.currentSlides, warnings);
  return {
    operations: ops.map((op) => JSON.parse(JSON.stringify(op)) as SlideBlockOperation),
    warnings
  };
}

function pushWarning(state: ApplyOperationState, message: string): void {
  state.warnings.push(`Block ${state.blockId}: ${message}`);
}

function applyOperation(state: ApplyOperationState, operation: SlideBlockOperation): void {
  if (operation.op === "replace_slide") {
    if (!operation.slide_id || !operation.replacement_slide) {
      pushWarning(state, "replace_slide missing required slide_id/replacement_slide.");
      return;
    }
    const idx = findSlideIndex(state.slides, operation.slide_id);
    if (idx < 0) {
      pushWarning(state, `replace_slide target missing (${operation.slide_id}).`);
      return;
    }
    const replacement = cloneSlide(operation.replacement_slide);
    replacement.slide_id = state.slides[idx]!.slide_id;
    state.slides.splice(idx, 1, replacement);
    return;
  }

  if (operation.op === "insert_after") {
    if (!operation.after_slide_id || !operation.replacement_slides || operation.replacement_slides.length === 0) {
      pushWarning(state, "insert_after missing required after_slide_id/replacement_slides.");
      return;
    }
    const idx = findSlideIndex(state.slides, operation.after_slide_id);
    const insertAt = idx >= 0 ? idx + 1 : state.slides.length;
    if (idx < 0) pushWarning(state, `insert_after anchor missing (${operation.after_slide_id}); appended to end.`);
    const inserts = operation.replacement_slides.map((slide) => cloneSlide(slide));
    state.slides.splice(insertAt, 0, ...inserts);
    return;
  }

  if (operation.op === "split_slide") {
    if (!operation.slide_id || !operation.replacement_slides || operation.replacement_slides.length < 2) {
      pushWarning(state, "split_slide requires slide_id and at least 2 replacement_slides.");
      return;
    }
    const idx = findSlideIndex(state.slides, operation.slide_id);
    if (idx < 0) {
      pushWarning(state, `split_slide target missing (${operation.slide_id}).`);
      return;
    }
    const inserts = operation.replacement_slides.map((slide) => cloneSlide(slide));
    state.slides.splice(idx, 1, ...inserts);
    return;
  }

  if (operation.op === "drop_slide") {
    if (!operation.slide_id) {
      pushWarning(state, "drop_slide missing slide_id.");
      return;
    }
    const idx = findSlideIndex(state.slides, operation.slide_id);
    if (idx < 0) {
      pushWarning(state, `drop_slide target missing (${operation.slide_id}).`);
      return;
    }
    state.slides.splice(idx, 1);
    return;
  }

  if (operation.op === "replace_window") {
    if (
      !operation.start_slide_id ||
      !operation.end_slide_id ||
      !operation.replacement_slides ||
      operation.replacement_slides.length === 0
    ) {
      pushWarning(state, "replace_window missing start/end/replacement_slides.");
      return;
    }
    const startIdx = findSlideIndex(state.slides, operation.start_slide_id);
    const endIdx = findSlideIndex(state.slides, operation.end_slide_id);
    if (startIdx < 0 || endIdx < 0) {
      pushWarning(state, `replace_window anchor missing (start=${operation.start_slide_id}, end=${operation.end_slide_id}).`);
      return;
    }
    const from = Math.min(startIdx, endIdx);
    const to = Math.max(startIdx, endIdx);
    const inserts = operation.replacement_slides.map((slide) => cloneSlide(slide));
    state.slides.splice(from, to - from + 1, ...inserts);
    return;
  }
}

function normalizeSlideIds(slides: DeckSlideSpec[]): DeckSlideSpec[] {
  const width = Math.max(2, String(Math.max(1, slides.length)).length);
  const idMap = new Map<string, string>();
  for (let index = 0; index < slides.length; index += 1) {
    const slide = slides[index]!;
    const newId = `S${String(index + 1).padStart(width, "0")}`;
    idMap.set(slide.slide_id, newId);
    slide.slide_id = newId;
  }
  for (const slide of slides) {
    slide.appendix_links = (slide.appendix_links ?? []).map((link) => idMap.get(link) ?? link);
    if (slide.on_slide_text.labels) {
      slide.on_slide_text.labels = slide.on_slide_text.labels.map((label) => idMap.get(label) ?? label);
    }
  }
  return slides;
}

export function buildStoryBlueprintFallback(input: StoryBlueprintInput): StoryBlueprint {
  const fallbackObligations = ["Act I setup clue", "Midpoint fracture clue", "Twist receipt", "Final proof clue"];
  const clueObligations =
    input.clueObligations.length > 0 ? input.clueObligations.slice(0, 8) : fallbackObligations.slice();
  while (clueObligations.length < 4) {
    clueObligations.push(fallbackObligations[clueObligations.length % fallbackObligations.length]!);
  }
  return StoryBlueprintSchema.parse({
    schema_version: "1.0.0",
    episode_logline: `${input.topic}: Pip and Cyto chase a plausible diagnosis, break it at midpoint, and prove the true cause with fair-play clues.`,
    core_mystery_arc: {
      inciting_case: "Quirky opening interrupted by a high-stakes medical anomaly.",
      false_theory_lock_in: "Early clue stack locks the team onto a tempting but wrong diagnosis.",
      midpoint_fracture: "A costly clue recontextualizes prior evidence and fractures confidence.",
      twist_reveal: "Previously seeded receipts converge and expose the true mechanism.",
      final_proof: "The team commits to proof, confirms diagnosis, and stabilizes outcome."
    },
    detective_deputy_arc: {
      baseline_dynamic: "Detective leads with pattern certainty while Deputy pressure-tests assumptions.",
      rupture_beat: "A rushed call creates conflict after an avoidable setback.",
      repair_beat: "They repair trust by co-owning the proof path and final decision.",
      named_recurring_tensions: ["certainty vs skepticism", "speed vs verification"],
      relationship_change_by_act: [
        { act_id: "ACT1", change_due_to_case: "Deputy starts pushing back on Detective's early certainty." },
        { act_id: "ACT2", change_due_to_case: "Conflicting clue pressure makes the partnership openly strained." },
        { act_id: "ACT3", change_due_to_case: "Midpoint collapse forces them to admit what each was missing." },
        { act_id: "ACT4", change_due_to_case: "They repair trust by proving the case together under pressure." }
      ]
    },
    opener_motif: "Detective office banter interrupted by urgent case intake.",
    opener_motif_vocabulary: ["caseboard", "office banter", "urgent intake"],
    ending_callback: "Return to office with a callback that closes the opener motif.",
    ending_callback_vocabulary: ["back at the office", "caseboard callback", "earned banter"],
    clue_obligations: clueObligations,
    false_theory_scene_obligations: [
      "Lock the team into a tempting wrong diagnosis using fair evidence.",
      "Fracture that theory with an emotionally costly contradiction at midpoint."
    ],
    emotionally_costly_clue: {
      act_id: "ACT3",
      event: "A contradiction reveals that the team misread a clue that put the patient at greater risk.",
      cost: "Detective and Deputy lose confidence in each other until proof is rebuilt."
    },
    act_debts: [
      { act_id: "ACT1", must_pay_by_end_of_act: ["Case acquisition", "Initial false-theory lock-in"] },
      { act_id: "ACT2", must_pay_by_end_of_act: ["Escalating clue pressure", "Relationship rupture"] },
      { act_id: "ACT3", must_pay_by_end_of_act: ["False-theory collapse", "Emotionally costly clue"] },
      { act_id: "ACT4", must_pay_by_end_of_act: ["Final proof", "Ending callback"] }
    ],
    unresolved_threads: ["Why initial pattern was misleading", "What single proof seals diagnosis"]
  });
}

export function buildActOutlineFallback(input: ActOutlineInput): ActOutline {
  const fallbackActClues = ["Act setup clue", "Complication clue", "Collapse clue", "Resolution clue"];
  const acts = input.deck.acts
    .map((act, idx) => ({
      act_id: act.act_id,
      act_goal: act.act_goal,
      story_pressure: idx === 0
        ? ["Institutional pressure to decide quickly", "Relational tension over confidence"]
        : idx === 1
          ? ["Physical hazard escalation", "Differential uncertainty pressure"]
          : idx === 2
            ? ["Midpoint collapse consequences", "Moral cost of prior assumptions"]
            : ["Proof window closing", "Consequences of wrong final call"],
      emotional_turn: idx === 0
        ? "Curiosity to urgency"
        : idx === 1
          ? "Confidence to doubt"
          : idx === 2
            ? "Doubt to conviction"
            : "Conviction to closure",
      pressure_channels: idx === 0
        ? ["institutional", "relational"]
        : idx === 1
          ? ["physical", "uncertainty"]
          : idx === 2
            ? ["moral", "relational"]
            : ["physical", "institutional"],
      clue_obligations: (() => {
        const window = input.storyBlueprint.clue_obligations.slice(Math.max(0, idx * 2), Math.max(0, idx * 2) + 3);
        if (window.length > 0) return window;
        return [fallbackActClues[idx % fallbackActClues.length]!];
      })(),
      false_theory_scene_obligations: idx === 2
        ? ["Show the false theory collapsing under a contradiction."]
        : [input.storyBlueprint.false_theory_scene_obligations[idx % input.storyBlueprint.false_theory_scene_obligations.length] ?? "Carry false-theory debt visibly."],
      setpiece_requirement: idx === 1 ? "Micro-action hazard setpiece required" : idx === 3 ? "Proof/showdown setpiece required" : "At least one consequential movement beat",
      relationship_change_due_to_case:
        input.storyBlueprint.detective_deputy_arc.relationship_change_by_act[idx]?.change_due_to_case ??
        "Case pressure alters detective/deputy trust.",
      emotionally_costly_clue:
        idx === 2
          ? input.storyBlueprint.emotionally_costly_clue.event
          : `Act ${idx + 1} clue should cost certainty or trust.`,
      must_pay_by_end_of_act:
        input.storyBlueprint.act_debts[idx]?.must_pay_by_end_of_act ?? ["Fallback act debt"],
      unresolved_threads_in: idx === 0 ? input.storyBlueprint.unresolved_threads : undefined,
      unresolved_threads_out: idx === 3 ? [] : input.storyBlueprint.unresolved_threads.slice(0, 2),
      target_slide_span: {
        start: act.slide_start,
        end: act.slide_end
      }
    }));

  while (acts.length < 4) {
    acts.push({
      act_id: `ACT${acts.length + 1}` as "ACT1" | "ACT2" | "ACT3" | "ACT4",
      act_goal: "Fallback act goal",
      story_pressure: ["Fallback pressure", "Fallback opposition"],
      pressure_channels: ["uncertainty", "relational"],
      emotional_turn: "Fallback emotional turn",
      clue_obligations: ["Fallback clue obligation"],
      false_theory_scene_obligations: ["Fallback false-theory scene obligation"],
      setpiece_requirement: "Fallback setpiece requirement",
      relationship_change_due_to_case: "Fallback relationship shift",
      emotionally_costly_clue: "Fallback costly clue",
      must_pay_by_end_of_act: ["Fallback debt"],
      unresolved_threads_in: undefined,
      unresolved_threads_out: [],
      target_slide_span: {
        start: Math.max(1, acts.length * 5 + 1),
        end: Math.max(1, acts.length * 5 + 5)
      }
    });
  }

  return ActOutlineSchema.parse({
    schema_version: "1.0.0",
    acts
  });
}

export function planSlideBlocksFromOutline(outline: ActOutline, preferredBlockSize = 16): SlideBlockPlan[] {
  const plans: SlideBlockPlan[] = [];
  const blockSize = Math.max(8, Math.min(20, Math.round(preferredBlockSize)));
  for (const act of outline.acts) {
    const ranges = chunkSlides(act.target_slide_span.start, act.target_slide_span.end, blockSize);
    for (let i = 0; i < ranges.length; i += 1) {
      const range = ranges[i]!;
      plans.push({
        blockId: `${act.act_id}_B${String(i + 1).padStart(2, "0")}`,
        actId: act.act_id,
        start: range.start,
        end: range.end,
        unresolvedThreadsIn: act.unresolved_threads_in ?? []
      });
    }
  }
  return plans;
}

export function buildSlideBlockFallback(input: BuildBlockFallbackInput): SlideBlock {
  const overrides = input.deck.slides
    .filter((slide) => {
      const slideNum = Number(slide.slide_id.replace(/^S/i, ""));
      return Number.isFinite(slideNum) && slideNum >= input.plan.start && slideNum <= input.plan.end;
    })
    .map((slide) => ({
      slide_id: slide.slide_id,
      title: slide.title,
      hook: slide.hook,
      visual_description: slide.visual_description,
      story_panel: slide.story_panel,
      delivery_mode: slide.medical_payload.delivery_mode,
      major_concept_id: slide.medical_payload.major_concept_id,
      speaker_notes_patch: "Preserve story-first teaching cadence and clue continuity in this beat."
    }));

  const fallbackOverrides =
    overrides.length > 0
      ? overrides
      : [
          {
            slide_id: `S${String(input.plan.start).padStart(2, "0")}`,
            title: `Block ${input.plan.blockId} fallback title`,
            hook: "What clue changes the next decision?",
            speaker_notes_patch: "Fallback block patch."
          }
        ];

  return SlideBlockSchema.parse({
    schema_version: "1.0.0",
    block_id: input.plan.blockId,
    act_id: input.plan.actId,
    slide_range: {
      start: input.plan.start,
      end: input.plan.end
    },
    prior_block_summary: input.priorSummary ?? "No prior block summary; establish continuity at block start.",
    unresolved_threads_in: input.plan.unresolvedThreadsIn,
    slide_overrides: fallbackOverrides,
    unresolved_threads_out: input.plan.unresolvedThreadsIn.slice(0, 2),
    block_summary_out: `Block ${input.plan.blockId} advances act ${input.plan.actId} from slide ${input.plan.start} to ${input.plan.end}.`
  });
}

function rebuildActsFromSlides(scaffoldDeck: DeckSpec, slides: DeckSlideSpec[]): DeckSpec["acts"] {
  return scaffoldDeck.acts.map((act) => {
    const inAct = slides.filter((slide) => slide.act_id === act.act_id);
    if (inAct.length === 0) return act;
    const nums = inAct
      .map((slide) => Number(slide.slide_id.replace(/^S/i, "")))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    if (nums.length === 0) return act;
    return {
      ...act,
      slide_start: nums[0]!,
      slide_end: nums[nums.length - 1]!
    };
  });
}

export function collectBlockAuthoredSlideIds(block: SlideBlock): string[] {
  const ids = new Set<string>();
  for (const override of block.slide_overrides ?? []) ids.add(canonicalSlideIdKey(override.slide_id));
  for (const op of block.operations ?? []) {
    if (op.slide_id) ids.add(canonicalSlideIdKey(op.slide_id));
    if (op.start_slide_id) ids.add(canonicalSlideIdKey(op.start_slide_id));
    if (op.end_slide_id) ids.add(canonicalSlideIdKey(op.end_slide_id));
    if (op.after_slide_id) ids.add(canonicalSlideIdKey(op.after_slide_id));
    if (op.replacement_slide?.slide_id) ids.add(canonicalSlideIdKey(op.replacement_slide.slide_id));
    for (const slide of op.replacement_slides ?? []) ids.add(canonicalSlideIdKey(slide.slide_id));
  }
  return [...ids].filter((id) => id.length > 0);
}

export function assembleDeckFromSlideBlocks(input: ApplyBlocksInput): { deck: DeckSpec; report: DeckAssemblyReport } {
  const initialSlides = sortSlides(input.scaffoldDeck.slides).map((slide) => cloneSlide(slide));
  const state: ApplyOperationState = {
    slides: initialSlides,
    warnings: [],
    blockId: "unknown"
  };
  const unresolvedThreads = new Set<string>();

  for (const block of input.blocks) {
    state.blockId = block.block_id;
    for (const item of block.unresolved_threads_out ?? []) unresolvedThreads.add(item);
    const normalized = normalizeSlideBlockOperations({
      block,
      currentSlides: state.slides
    });
    for (const warning of normalized.warnings) state.warnings.push(warning);
    for (const operation of normalized.operations) applyOperation(state, operation);
  }

  if (state.slides.length === 0) {
    state.warnings.push("All slides were removed by block operations; restored first scaffold slide.");
    if (input.scaffoldDeck.slides[0]) state.slides.push(cloneSlide(input.scaffoldDeck.slides[0]));
  }

  const normalizedSlides = normalizeSlideIds(state.slides);
  const rebuiltActs = rebuildActsFromSlides(input.scaffoldDeck, normalizedSlides);
  const deck = DeckSpecSchema.parse({
    ...input.scaffoldDeck,
    deck_meta: {
      ...input.scaffoldDeck.deck_meta,
      deck_length_main: String(normalizedSlides.length)
    },
    acts: rebuiltActs,
    slides: normalizedSlides
  });

  const report = DeckAssemblyReportSchema.parse({
    schema_version: "1.0.0",
    block_count: input.blocks.length,
    main_slide_count: deck.slides.length,
    unresolved_threads_remaining: [...unresolvedThreads],
    warnings: state.warnings
  });

  return { deck, report };
}

export function buildNarrativeStateForBlock(input: {
  blockId: string;
  actId?: "ACT1" | "ACT2" | "ACT3" | "ACT4";
  storyBlueprint: StoryBlueprint;
  actOutline: ActOutline;
  unresolvedThreads: string[];
  priorBlockSummary?: string;
  recentSlideExcerpts: string[];
  activeDifferentialOrdering: string[];
  canonicalProfileExcerpt: string;
  episodeMemoryExcerpt: string;
  differentialCast?: DifferentialCast;
  clueGraph?: ClueGraph;
  dramaPlan?: DramaPlan;
  setpiecePlan?: SetpiecePlan;
  storyBeatHints?: string[];
  previousState?: NarrativeState;
}): NarrativeState {
  const actId = input.actId ?? (input.blockId.split("_")[0] as "ACT1" | "ACT2" | "ACT3" | "ACT4");
  const act = input.actOutline.acts.find((item) => item.act_id === actId);
  const blueprintActDebt = input.storyBlueprint.act_debts.find((item) => item.act_id === actId);
  const relationshipActChange = input.storyBlueprint.detective_deputy_arc.relationship_change_by_act.find(
    (item) => item.act_id === actId
  );
  const dramaRelationship = input.dramaPlan?.relationship_arcs.find((arc) => arc.pair === "detective_deputy");
  const dramaActSetup = input.dramaPlan?.chapter_or_act_setups?.find((setup) => setup.act_id === actId);
  const setpieceActDebt = input.setpiecePlan?.act_debts.find((item) => item.act_id === actId);
  const setpiecesForAct = (input.setpiecePlan?.setpieces ?? []).filter((item) => item.act_id === actId);
  const actRotation =
    actId === "ACT1"
      ? input.differentialCast?.rotation_plan.act1_focus_dx_ids
      : actId === "ACT2"
        ? input.differentialCast?.rotation_plan.act2_expansion_dx_ids
        : actId === "ACT3"
          ? input.differentialCast?.rotation_plan.act3_collapse_dx_ids
          : input.differentialCast?.rotation_plan.act4_final_dx_id
            ? [input.differentialCast.rotation_plan.act4_final_dx_id]
            : [];
  const bestTheory = uniqueStrings(
    [
      input.previousState?.current_best_theory,
      ...(actRotation ?? []),
      ...input.activeDifferentialOrdering
    ],
    2
  );
  const motifLexicon = uniqueStrings(
    [
      input.storyBlueprint.opener_motif,
      ...input.storyBlueprint.opener_motif_vocabulary,
      input.storyBlueprint.ending_callback,
      ...input.storyBlueprint.ending_callback_vocabulary,
      ...(input.storyBeatHints ?? []),
      ...input.storyBlueprint.clue_obligations
    ],
    8
  );
  const pressureStatusByChannel = uniqueStrings(
    [
      ...(act?.pressure_channels ?? []),
      ...(input.previousState?.pressure_status_by_channel ?? []).map((item) => `${item.channel}: ${item.status}`)
    ],
    6
  ).map((value) => {
    const [channel, ...rest] = value.split(":");
    const status = rest.join(":").trim();
    return {
      channel: channel.trim(),
      status: status.length > 0 ? status : `Escalates in ${actId}`
    };
  });
  const pressure = uniqueStrings(
    [
      ...(act?.pressure_channels ?? []),
      ...(act?.story_pressure ?? []),
      ...(input.previousState?.pressure_channels ?? [])
    ],
    6
  );
  const excerpts = input.recentSlideExcerpts
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 4);
  while (excerpts.length < 2) excerpts.push(input.priorBlockSummary?.trim() || "Continuity carryover from previous authored block.");
  const clueDebt = uniqueStrings(
    [
      ...(act?.clue_obligations ?? []),
      ...(act?.false_theory_scene_obligations ?? []),
      ...(input.storyBlueprint.false_theory_scene_obligations ?? []),
      ...(input.unresolvedThreads ?? []),
      ...(input.previousState?.unpaid_clue_payoff_debt ?? [])
    ],
    8
  );
  const relationshipDebt = uniqueStrings(
    [
      relationshipActChange?.change_due_to_case,
      dramaActSetup?.relationship_change_due_to_case,
      ...(dramaRelationship?.named_recurring_tensions ?? []),
      ...(input.previousState?.relationship_debt ?? [])
    ],
    6
  );
  const motifDebt = uniqueStrings(
    [
      ...(blueprintActDebt?.must_pay_by_end_of_act ?? []),
      ...(setpieceActDebt?.must_pay_by_end_of_act ?? []),
      ...input.storyBlueprint.ending_callback_vocabulary,
      ...(input.previousState?.motif_callback_debt ?? [])
    ],
    6
  );
  const setpieceDebt = uniqueStrings(
    [
      act?.setpiece_requirement,
      ...setpiecesForAct.map((item) => item.story_purpose),
      ...setpiecesForAct.map((item) => item.clue_obligation_paid),
      ...(input.previousState?.outstanding_setpiece_debt ?? [])
    ],
    6
  );
  const mustChangeThisBlock = uniqueStrings(
    [
      ...(act?.must_pay_by_end_of_act ?? []),
      act?.emotionally_costly_clue,
      relationshipActChange?.change_due_to_case,
      ...setpiecesForAct.map((item) => item.relationship_shift),
      ...setpiecesForAct.map((item) => item.emotional_cost)
    ],
    8
  );
  const mayContinueThisBlock = uniqueStrings(
    [
      ...(act?.unresolved_threads_out ?? []),
      ...input.unresolvedThreads,
      ...(input.previousState?.may_continue_this_block ?? [])
    ],
    8
  );
  const lastRuptureOrRepairStatus =
    input.previousState?.last_rupture_or_repair_status ??
    (actId === "ACT1"
      ? "Baseline tension established; rupture not yet paid."
      : actId === "ACT2"
        ? "Rupture pressure rising; trust debt is active."
        : actId === "ACT3"
          ? "Relationship is unstable and awaiting repair through proof."
          : "Repair must land alongside proof closure.");

  return NarrativeStateSchema.parse({
    schema_version: "1.0.0",
    block_id: input.blockId,
    current_false_theory: input.storyBlueprint.core_mystery_arc.false_theory_lock_in,
    current_best_theory: bestTheory[0] ?? input.storyBlueprint.core_mystery_arc.final_proof,
    runner_up_theory: bestTheory[1] ?? input.storyBlueprint.core_mystery_arc.false_theory_lock_in,
    relationship_state_detective_deputy:
      input.previousState?.relationship_state_detective_deputy ??
      input.storyBlueprint.detective_deputy_arc.baseline_dynamic,
    unresolved_emotional_thread:
      input.unresolvedThreads[0] ??
      input.previousState?.unresolved_emotional_thread ??
      "Team trust remains under pressure until proof trap resolves.",
    active_clue_obligations: (
      input.unresolvedThreads.length > 0 ? input.unresolvedThreads : input.storyBlueprint.clue_obligations
    )
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .slice(0, 6),
    unpaid_clue_payoff_debt: clueDebt.length > 0 ? clueDebt : ["A seeded clue still needs an emotionally meaningful payoff."],
    active_motif_callback_lexicon: motifLexicon.length > 0 ? motifLexicon : ["caseboard", "forensic motif"],
    motif_callback_debt: motifDebt.length > 0 ? motifDebt : ["Return to the opener vocabulary in the ending callback."],
    pressure_channels: pressure.length > 0 ? pressure : ["physical risk", "institutional urgency"],
    pressure_status_by_channel:
      pressureStatusByChannel.length > 0
        ? pressureStatusByChannel
        : [
            { channel: "physical", status: "Escalating hazard pressure" },
            { channel: "relational", status: "Trust strain remains unresolved" }
          ],
    recent_slide_excerpts: excerpts,
    active_differential_ordering:
      input.activeDifferentialOrdering.length > 0 ? input.activeDifferentialOrdering.slice(0, 5) : ["DX-UNKNOWN"],
    relationship_debt: relationshipDebt.length > 0 ? relationshipDebt : ["Detective and Deputy must earn alignment under pressure."],
    last_rupture_or_repair_status: lastRuptureOrRepairStatus,
    outstanding_setpiece_debt: setpieceDebt.length > 0 ? setpieceDebt : ["A consequential set-piece must change the investigation state."],
    must_change_this_block: mustChangeThisBlock.length > 0 ? mustChangeThisBlock : ["This block must visibly change theory, trust, or clue debt."],
    may_continue_this_block: mayContinueThisBlock.length > 0 ? mayContinueThisBlock : ["Some clue debt may continue if it actively escalates."],
    delta_from_previous_block:
      input.priorBlockSummary?.trim().length
        ? input.priorBlockSummary.trim()
        : input.previousState?.delta_from_previous_block ?? "First block in sequence.",
    canonical_profile_excerpt: input.canonicalProfileExcerpt.trim().length > 0
      ? input.canonicalProfileExcerpt.trim()
      : "(No canonical profile excerpt found.)",
    episode_memory_excerpt: input.episodeMemoryExcerpt.trim().length > 0
      ? input.episodeMemoryExcerpt.trim()
      : "(No episode memory excerpt found.)"
  });
}

export function buildBlockPromptContext(input: {
  topic: string;
  plan: SlideBlockPlan;
  storyBlueprint: StoryBlueprint;
  actOutline: ActOutline;
  narrativeState: NarrativeState;
  medicalSlice: {
    dossier_focus: unknown;
    truth_focus: unknown;
    differential_focus: unknown;
    clue_focus: unknown;
    micro_world_focus: unknown;
    drama_focus: unknown;
    setpiece_focus: unknown;
  };
  mode?: "primary" | "retry_compact";
}): string {
  const act = input.actOutline.acts.find((candidate) => candidate.act_id === input.plan.actId);
  const mode = input.mode ?? "primary";
  const narrativeState =
    mode === "retry_compact"
      ? {
          current_false_theory: input.narrativeState.current_false_theory,
          current_best_theory: input.narrativeState.current_best_theory,
          runner_up_theory: input.narrativeState.runner_up_theory,
          relationship_state_detective_deputy: input.narrativeState.relationship_state_detective_deputy,
          unresolved_emotional_thread: input.narrativeState.unresolved_emotional_thread,
          active_clue_obligations: input.narrativeState.active_clue_obligations.slice(0, 4),
          unpaid_clue_payoff_debt: input.narrativeState.unpaid_clue_payoff_debt.slice(0, 4),
          active_motif_callback_lexicon: input.narrativeState.active_motif_callback_lexicon.slice(0, 4),
          motif_callback_debt: input.narrativeState.motif_callback_debt.slice(0, 4),
          pressure_channels: input.narrativeState.pressure_channels.slice(0, 4),
          pressure_status_by_channel: input.narrativeState.pressure_status_by_channel.slice(0, 4),
          recent_slide_excerpts: input.narrativeState.recent_slide_excerpts.slice(0, 2),
          active_differential_ordering: input.narrativeState.active_differential_ordering.slice(0, 4),
          relationship_debt: input.narrativeState.relationship_debt.slice(0, 4),
          last_rupture_or_repair_status: input.narrativeState.last_rupture_or_repair_status,
          outstanding_setpiece_debt: input.narrativeState.outstanding_setpiece_debt.slice(0, 4),
          must_change_this_block: input.narrativeState.must_change_this_block.slice(0, 4),
          may_continue_this_block: input.narrativeState.may_continue_this_block.slice(0, 4),
          delta_from_previous_block: input.narrativeState.delta_from_previous_block,
          canonical_profile_excerpt: clampPromptText(input.narrativeState.canonical_profile_excerpt, 360),
          episode_memory_excerpt: clampPromptText(input.narrativeState.episode_memory_excerpt, 240)
        }
      : input.narrativeState;
  const medicalSlice =
    mode === "retry_compact"
      ? {
          dossier_focus: input.medicalSlice.dossier_focus,
          truth_focus: input.medicalSlice.truth_focus,
          differential_focus: input.medicalSlice.differential_focus,
          clue_focus: input.medicalSlice.clue_focus,
          micro_world_focus: input.medicalSlice.micro_world_focus,
          drama_focus: input.medicalSlice.drama_focus,
          setpiece_focus: input.medicalSlice.setpiece_focus
        }
      : input.medicalSlice;
  return [
    `TOPIC:\n${input.topic}`,
    `BLOCK AUTHORING RULES:\n- Replacement slides must be fully authored, not scaffold echoes.\n- Never return scaffold placeholders such as [SCAFFOLD], TBD, TODO, DX_PRIMARY, DX_ALTERNATE, MC-PATCH-*, or CIT-KB-001.\n- If optional citation fields are unavailable, omit them instead of emitting empty strings.\n- Prefer fewer, stronger operations over preserving weak scaffold language.\n- Main-deck slides should default to delivery_mode clue, dialogue, or action.\n- Use exhibit only when the exhibit itself forces a decision or consequence on the same slide.\n- Avoid note_only in the main deck; reserve it for appendix or truly minimal bridge beats, and even then preserve a concrete decision/consequence.\n- When a block is repairing weak story turns, convert passive summary slides into active clue, dialogue, or action beats instead of summarizing the same material again.\n- If the current pacing is weak, prefer replace_window or split_slide over preserving a flat slide just because it already exists.`,
    `BLOCK PLAN (json):\n${JSON.stringify(input.plan, null, 2)}`,
    `ACT OBLIGATIONS (json):\n${JSON.stringify(act ?? null, null, 2)}`,
    `STORY BLUEPRINT DIGEST (json):\n${JSON.stringify(
      {
        opener_motif: input.storyBlueprint.opener_motif,
        opener_motif_vocabulary: input.storyBlueprint.opener_motif_vocabulary.slice(0, 6),
        ending_callback: input.storyBlueprint.ending_callback,
        ending_callback_vocabulary: input.storyBlueprint.ending_callback_vocabulary.slice(0, 6),
        false_theory_scene_obligations: input.storyBlueprint.false_theory_scene_obligations.slice(0, 6),
        emotionally_costly_clue: input.storyBlueprint.emotionally_costly_clue,
        act_debts: input.storyBlueprint.act_debts.slice(0, 4),
        unresolved_threads: input.storyBlueprint.unresolved_threads.slice(0, 8),
        clue_obligations: input.storyBlueprint.clue_obligations.slice(0, 8)
      },
      null,
      2
    )}`,
    `NARRATIVE STATE (json):\n${mode === "retry_compact" ? compactPromptJson(narrativeState, 1_500) : compactPromptJson(narrativeState, 2_300)}`,
    `COMPACT MEDICAL CONTEXT (json):\n${mode === "retry_compact" ? compactPromptJson(medicalSlice, 1_800) : compactPromptJson(medicalSlice, 2_600)}`
  ].join("\n\n");
}
