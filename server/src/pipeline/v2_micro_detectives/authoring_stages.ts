import type { DeckSlideSpec } from "./schemas.js";
import {
  ActOutlineSchema,
  DeckAssemblyReportSchema,
  DeckSpecSchema,
  SlideBlockSchema,
  StoryBlueprintSchema,
  type ActOutline,
  type DeckAssemblyReport,
  type DeckSpec,
  type SlideBlock,
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

type SlideBlockPlan = {
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

export function planSlideBlocksFromOutline(outline: ActOutline): SlideBlockPlan[] {
  const plans: SlideBlockPlan[] = [];
  for (const act of outline.acts) {
    const ranges = chunkSlides(act.target_slide_span.start, act.target_slide_span.end, 16);
    for (let i = 0; i < ranges.length; i++) {
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
      const slideNum = Number(slide.slide_id.replace(/^S/, ""));
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
    slide_overrides: overrides.length > 0 ? overrides : [
      {
        slide_id: `S${String(input.plan.start).padStart(2, "0")}`,
        title: `Block ${input.plan.blockId} fallback title`,
        hook: "What clue changes the next decision?",
        speaker_notes_patch: "Fallback block patch."
      }
    ],
    unresolved_threads_out: input.plan.unresolvedThreadsIn.slice(0, 2),
    block_summary_out: `Block ${input.plan.blockId} advances act ${input.plan.actId} from slide ${input.plan.start} to ${input.plan.end}.`
  });
}

function applyBlockOverride(slide: DeckSlideSpec, override: SlideBlock["slide_overrides"][number]): DeckSlideSpec {
  const updated: DeckSlideSpec = { ...slide };
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

export function assembleDeckFromSlideBlocks(input: ApplyBlocksInput): { deck: DeckSpec; report: DeckAssemblyReport } {
  const slideMap = new Map(input.scaffoldDeck.slides.map((slide) => [slide.slide_id, { ...slide }] as const));
  const unresolvedThreads = new Set<string>();
  const warnings: string[] = [];

  for (const block of input.blocks) {
    for (const item of block.unresolved_threads_out ?? []) unresolvedThreads.add(item);
    for (const override of block.slide_overrides) {
      const base = slideMap.get(override.slide_id);
      if (!base) {
        warnings.push(`Override references missing slide_id ${override.slide_id} in block ${block.block_id}`);
        continue;
      }
      slideMap.set(override.slide_id, applyBlockOverride(base, override));
    }
  }

  const slides = [...slideMap.values()].sort((a, b) => {
    const aNum = Number(a.slide_id.replace(/^S/, ""));
    const bNum = Number(b.slide_id.replace(/^S/, ""));
    if (!Number.isFinite(aNum) || !Number.isFinite(bNum)) return a.slide_id.localeCompare(b.slide_id);
    return aNum - bNum;
  });

  const rebuiltActs = input.scaffoldDeck.acts.map((act) => {
    const inAct = slides.filter((slide) => slide.act_id === act.act_id);
    if (inAct.length === 0) return act;
    const nums = inAct
      .map((slide) => Number(slide.slide_id.replace(/^S/, "")))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    if (nums.length === 0) return act;
    return {
      ...act,
      slide_start: nums[0]!,
      slide_end: nums[nums.length - 1]!
    };
  });

  const deck = DeckSpecSchema.parse({
    ...input.scaffoldDeck,
    acts: rebuiltActs,
    slides
  });

  const report = DeckAssemblyReportSchema.parse({
    schema_version: "1.0.0",
    block_count: input.blocks.length,
    main_slide_count: deck.slides.length,
    unresolved_threads_remaining: [...unresolvedThreads],
    warnings
  });

  return { deck, report };
}

export function buildBlockPromptContext(input: {
  topic: string;
  plan: SlideBlockPlan;
  storyBlueprint: StoryBlueprint;
  actOutline: ActOutline;
  priorBlockSummary?: string;
  unresolvedThreads: string[];
  diseaseDossier: unknown;
  truthModel: unknown;
  differentialCast: unknown;
  clueGraph: unknown;
  microWorldMap: unknown;
  dramaPlan: unknown;
  setpiecePlan: unknown;
}): string {
  const act = input.actOutline.acts.find((candidate) => candidate.act_id === input.plan.actId);
  return [
    `TOPIC:\n${input.topic}`,
    `BLOCK PLAN (json):\n${JSON.stringify(input.plan, null, 2)}`,
    `STORY BLUEPRINT (json):\n${JSON.stringify(input.storyBlueprint, null, 2)}`,
    `ACT OUTLINE (json):\n${JSON.stringify(act ?? null, null, 2)}`,
    `PRIOR BLOCK SUMMARY:\n${input.priorBlockSummary ?? "none"}`,
    `UNRESOLVED THREADS IN:\n${JSON.stringify(input.unresolvedThreads, null, 2)}`,
    `DISEASE DOSSIER (json):\n${JSON.stringify(input.diseaseDossier, null, 2)}`,
    `TRUTH MODEL (json):\n${JSON.stringify(input.truthModel, null, 2)}`,
    `DIFFERENTIAL CAST (json):\n${JSON.stringify(input.differentialCast, null, 2)}`,
    `CLUE GRAPH (json):\n${JSON.stringify(input.clueGraph, null, 2)}`,
    `MICRO WORLD MAP (json):\n${JSON.stringify(input.microWorldMap, null, 2)}`,
    `DRAMA PLAN (json):\n${JSON.stringify(input.dramaPlan, null, 2)}`,
    `SETPIECE PLAN (json):\n${JSON.stringify(input.setpiecePlan, null, 2)}`
  ].join("\n\n");
}
