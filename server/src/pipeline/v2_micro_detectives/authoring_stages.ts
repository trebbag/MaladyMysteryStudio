import {
  ActOutlineSchema,
  DeckAssemblyReportSchema,
  DeckSpecSchema,
  NarrativeStateSchema,
  SlideBlockSchema,
  StoryBlueprintSchema,
  type ActOutline,
  type DeckAssemblyReport,
  type DeckSlideSpec,
  type DeckSpec,
  type NarrativeState,
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
      repair_beat: "They repair trust by co-owning the proof path and final decision."
    },
    opener_motif: "Detective office banter interrupted by urgent case intake.",
    ending_callback: "Return to office with a callback that closes the opener motif.",
    clue_obligations: clueObligations,
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
      clue_obligations: (() => {
        const window = input.storyBlueprint.clue_obligations.slice(Math.max(0, idx * 2), Math.max(0, idx * 2) + 3);
        if (window.length > 0) return window;
        return [fallbackActClues[idx % fallbackActClues.length]!];
      })(),
      setpiece_requirement: idx === 1 ? "Micro-action hazard setpiece required" : idx === 3 ? "Proof/showdown setpiece required" : "At least one consequential movement beat",
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
      emotional_turn: "Fallback emotional turn",
      clue_obligations: ["Fallback clue obligation"],
      setpiece_requirement: "Fallback setpiece requirement",
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
  storyBlueprint: StoryBlueprint;
  actOutline: ActOutline;
  unresolvedThreads: string[];
  priorBlockSummary?: string;
  recentSlideExcerpts: string[];
  activeDifferentialOrdering: string[];
  canonicalProfileExcerpt: string;
  episodeMemoryExcerpt: string;
  previousState?: NarrativeState;
}): NarrativeState {
  const act = input.actOutline.acts.find((item) => item.act_id === input.blockId.split("_")[0]);
  const motifLexicon = [
    input.storyBlueprint.opener_motif,
    input.storyBlueprint.ending_callback,
    ...(input.storyBlueprint.clue_obligations ?? [])
  ]
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 8);
  const pressure = [...(act?.story_pressure ?? []), ...(input.previousState?.pressure_channels ?? [])]
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 8);
  const excerpts = input.recentSlideExcerpts
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 4);
  while (excerpts.length < 2) excerpts.push(input.priorBlockSummary?.trim() || "Continuity carryover from previous authored block.");

  return NarrativeStateSchema.parse({
    schema_version: "1.0.0",
    block_id: input.blockId,
    current_false_theory: input.storyBlueprint.core_mystery_arc.false_theory_lock_in,
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
      .slice(0, 8),
    active_motif_callback_lexicon: motifLexicon.length > 0 ? motifLexicon : ["caseboard", "forensic motif"],
    pressure_channels: pressure.length > 0 ? pressure : ["physical risk", "institutional urgency"],
    recent_slide_excerpts: excerpts,
    active_differential_ordering:
      input.activeDifferentialOrdering.length > 0 ? input.activeDifferentialOrdering.slice(0, 6) : ["DX-UNKNOWN"],
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
          relationship_state_detective_deputy: input.narrativeState.relationship_state_detective_deputy,
          unresolved_emotional_thread: input.narrativeState.unresolved_emotional_thread,
          active_clue_obligations: input.narrativeState.active_clue_obligations.slice(0, 5),
          active_motif_callback_lexicon: input.narrativeState.active_motif_callback_lexicon.slice(0, 5),
          pressure_channels: input.narrativeState.pressure_channels.slice(0, 5),
          recent_slide_excerpts: input.narrativeState.recent_slide_excerpts.slice(0, 2),
          active_differential_ordering: input.narrativeState.active_differential_ordering.slice(0, 4),
          delta_from_previous_block: input.narrativeState.delta_from_previous_block,
          canonical_profile_excerpt: clampPromptText(input.narrativeState.canonical_profile_excerpt, 600),
          episode_memory_excerpt: clampPromptText(input.narrativeState.episode_memory_excerpt, 420)
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
        ending_callback: input.storyBlueprint.ending_callback,
        unresolved_threads: input.storyBlueprint.unresolved_threads.slice(0, 8),
        clue_obligations: input.storyBlueprint.clue_obligations.slice(0, 10)
      },
      null,
      2
    )}`,
    `NARRATIVE STATE (json):\n${mode === "retry_compact" ? compactPromptJson(narrativeState, 2_200) : compactPromptJson(narrativeState, 3_600)}`,
    `COMPACT MEDICAL CONTEXT (json):\n${mode === "retry_compact" ? compactPromptJson(medicalSlice, 2_800) : compactPromptJson(medicalSlice, 3_800)}`
  ].join("\n\n");
}
