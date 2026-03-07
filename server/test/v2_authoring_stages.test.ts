import { describe, expect, it } from "vitest";
import { generateV2DeckSpec } from "../src/pipeline/v2_micro_detectives/generator.js";
import {
  assembleDeckFromSlideBlocks,
  buildBlockPromptContext,
  buildNarrativeStateForBlock,
  normalizeSlideBlockOperations,
  planSlideBlocksFromOutline
} from "../src/pipeline/v2_micro_detectives/authoring_stages.js";
import type { ActOutline, StoryBlueprint } from "../src/pipeline/v2_micro_detectives/schemas.js";
import { SlideBlockSchema } from "../src/pipeline/v2_micro_detectives/schemas.js";

function makeStoryBlueprint(overrides?: Partial<StoryBlueprint>): StoryBlueprint {
  return {
    schema_version: "1.0.0",
    episode_logline: "A medical case becomes a micro-mystery.",
    core_mystery_arc: {
      inciting_case: "case",
      false_theory_lock_in: "false theory",
      midpoint_fracture: "fracture",
      twist_reveal: "twist",
      final_proof: "proof"
    },
    detective_deputy_arc: {
      baseline_dynamic: "baseline tension",
      rupture_beat: "rupture",
      repair_beat: "repair",
      named_recurring_tensions: ["speed versus rigor", "intuition versus proof"],
      relationship_change_by_act: [
        { act_id: "ACT1", change_due_to_case: "They start aligned but strain under the first clue." },
        { act_id: "ACT2", change_due_to_case: "The deputy distrusts the detective's shortcut." },
        { act_id: "ACT3", change_due_to_case: "They rupture over the false theory collapse." },
        { act_id: "ACT4", change_due_to_case: "They repair through the final proof." }
      ]
    },
    opener_motif: "motif",
    opener_motif_vocabulary: ["motif", "coffee rings", "evidence pinboard"],
    ending_callback: "callback",
    ending_callback_vocabulary: ["callback", "coffee rings", "closed case"],
    clue_obligations: ["c1", "c2", "c3", "c4"],
    false_theory_scene_obligations: ["lock the wrong theory", "collapse the wrong theory publicly"],
    emotionally_costly_clue: {
      act_id: "ACT2",
      event: "The best clue implicates an ally.",
      cost: "The deputy loses faith in the detective."
    },
    act_debts: [
      { act_id: "ACT1", must_pay_by_end_of_act: ["introduce the false theory"] },
      { act_id: "ACT2", must_pay_by_end_of_act: ["raise the emotional stakes"] },
      { act_id: "ACT3", must_pay_by_end_of_act: ["fracture the partnership"] },
      { act_id: "ACT4", must_pay_by_end_of_act: ["pay off the opener motif"] }
    ],
    unresolved_threads: ["thread-1", "thread-2"],
    ...overrides
  };
}

function makeActOutline(spans?: Array<{ act_id: "ACT1" | "ACT2" | "ACT3" | "ACT4"; start: number; end: number }>): ActOutline {
  const defaults = spans ?? [
    { act_id: "ACT1", start: 1, end: 8 },
    { act_id: "ACT2", start: 9, end: 16 },
    { act_id: "ACT3", start: 17, end: 24 },
    { act_id: "ACT4", start: 25, end: 30 }
  ];
  return {
    schema_version: "1.0.0",
    acts: defaults.map((span, index) => ({
      act_id: span.act_id,
      act_goal: `goal-${index + 1}`,
      story_pressure: [`pressure-${index + 1}-a`, `pressure-${index + 1}-b`],
      pressure_channels: ["physical", "relational"],
      emotional_turn: `emotion-${index + 1}`,
      clue_obligations: [`clue-${index + 1}`],
      false_theory_scene_obligations: [`false-theory-${index + 1}`],
      setpiece_requirement: `setpiece-${index + 1}`,
      relationship_change_due_to_case: `relationship-change-${index + 1}`,
      emotionally_costly_clue: `costly-clue-${index + 1}`,
      must_pay_by_end_of_act: [`debt-${index + 1}`],
      target_slide_span: { start: span.start, end: span.end }
    }))
  };
}

describe("v2 authoring stages", () => {
  it("applies operation-based block authoring with insert/split/drop and reindexes slide ids", () => {
    const deck = generateV2DeckSpec({
      topic: "Test case",
      deckLengthMain: 30,
      deckLengthConstraintEnabled: true,
      audienceLevel: "PHYSICIAN_LEVEL"
    });

    const insertTemplate = { ...deck.slides[1]! };
    const splitTemplateA = { ...deck.slides[2]! };
    const splitTemplateB = { ...deck.slides[2]! };

    const block = SlideBlockSchema.parse({
      schema_version: "1.0.0",
      block_id: "ACT1_B01",
      act_id: "ACT1",
      slide_range: { start: 1, end: 8 },
      operations: [
        {
          op: "replace_slide",
          slide_id: deck.slides[0]!.slide_id,
          replacement_slide: { ...deck.slides[0]!, title: "Author Replaced Slide" }
        },
        {
          op: "insert_after",
          after_slide_id: deck.slides[0]!.slide_id,
          replacement_slides: [{ ...insertTemplate, slide_id: "S900", title: "Inserted Beat" }]
        },
        {
          op: "split_slide",
          slide_id: deck.slides[2]!.slide_id,
          replacement_slides: [
            { ...splitTemplateA, slide_id: "S901", title: "Split A" },
            { ...splitTemplateB, slide_id: "S902", title: "Split B" }
          ]
        },
        {
          op: "drop_slide",
          slide_id: deck.slides[3]!.slide_id
        }
      ],
      block_summary_out: "Operations applied"
    });

    const out = assembleDeckFromSlideBlocks({ scaffoldDeck: deck, blocks: [block] });
    expect(out.deck.slides.length).toBe(deck.slides.length + 1);
    expect(out.deck.deck_meta.deck_length_main).toBe(String(deck.slides.length + 1));
    expect(out.deck.slides[0]!.slide_id).toBe("S01");
    expect(out.deck.slides.some((slide) => slide.title === "Author Replaced Slide")).toBe(true);
    expect(out.deck.slides.some((slide) => slide.title === "Inserted Beat")).toBe(true);
  });

  it("matches mixed slide-id formats when applying authored block windows", () => {
    const deck = generateV2DeckSpec({
      topic: "Mixed ids",
      deckLengthMain: 30,
      deckLengthConstraintEnabled: true,
      audienceLevel: "PHYSICIAN_LEVEL"
    });

    const block = SlideBlockSchema.parse({
      schema_version: "1.0.0",
      block_id: "ACT1_B01",
      act_id: "ACT1",
      slide_range: { start: 1, end: 4 },
      operations: [
        {
          op: "replace_window",
          start_slide_id: "1",
          end_slide_id: "4",
          replacement_slides: deck.slides.slice(0, 4).map((slide, idx) => ({
            ...slide,
            slide_id: `S${idx + 1}`,
            title: `Authored Window ${idx + 1}`
          }))
        }
      ],
      block_summary_out: "Replaced with mixed id formats"
    });

    const out = assembleDeckFromSlideBlocks({ scaffoldDeck: deck, blocks: [block] });
    expect(out.report.warnings).toHaveLength(0);
    expect(out.deck.slides.slice(0, 4).map((slide) => slide.title)).toEqual([
      "Authored Window 1",
      "Authored Window 2",
      "Authored Window 3",
      "Authored Window 4"
    ]);
  });

  it("preserves already-authored slides outside a narrowed replacement window when the base deck is authored", () => {
    const scaffold = generateV2DeckSpec({
      topic: "Structural regeneration long-form cardiopulmonary investigation",
      deckLengthMain: 60,
      deckLengthConstraintEnabled: false,
      audienceLevel: "PHYSICIAN_LEVEL"
    });
    expect(scaffold.slides.length).toBeGreaterThan(57);
    const authored = {
      ...scaffold,
      slides: scaffold.slides.map((slide) => ({
        ...slide,
        title: `AUTHORED ${slide.slide_id}`,
        hook: `Authored hook ${slide.slide_id}`,
        authoring_provenance: "agent_authored" as const
      }))
    };

    const block = SlideBlockSchema.parse({
      schema_version: "1.0.0",
      block_id: "ACT3_B02",
      act_id: "ACT3",
      slide_range: { start: 50, end: 57 },
      operations: [
        {
          op: "replace_window",
          start_slide_id: "S50",
          end_slide_id: "S55",
          replacement_slides: authored.slides.slice(49, 55).map((slide, idx) => ({
            ...slide,
            slide_id: `TMP-${idx + 1}`,
            title: `REGEN ${slide.slide_id}`
          }))
        }
      ],
      block_summary_out: "Partial regeneration over authored base deck."
    });

    const out = assembleDeckFromSlideBlocks({ scaffoldDeck: authored, blocks: [block] });
    expect(out.deck.slides[49]?.title).toBe("REGEN S50");
    expect(out.deck.slides[55]?.title).toBe("AUTHORED S56");
    expect(out.deck.slides[56]?.title).toBe("AUTHORED S57");
  });

  it("normalizes legacy slide_overrides into replace_slide operations", () => {
    const deck = generateV2DeckSpec({
      topic: "Legacy override",
      deckLengthMain: 30,
      deckLengthConstraintEnabled: true,
      audienceLevel: "COLLEGE_LEVEL"
    });
    const block = SlideBlockSchema.parse({
      schema_version: "1.0.0",
      block_id: "ACT1_B01",
      act_id: "ACT1",
      slide_range: { start: 1, end: 4 },
      slide_overrides: [
        {
          slide_id: deck.slides[0]!.slide_id,
          title: "Legacy Override Title"
        }
      ],
      block_summary_out: "Legacy override block"
    });

    const normalized = normalizeSlideBlockOperations({ block, currentSlides: deck.slides });
    expect(normalized.operations.length).toBe(1);
    expect(normalized.operations[0]!.op).toBe("replace_slide");
    expect(normalized.operations[0]!.slide_id).toBe(deck.slides[0]!.slide_id);
  });

  it("accepts operations-first blocks even when slide_overrides is present but empty", () => {
    const deck = generateV2DeckSpec({
      topic: "Operations first",
      deckLengthMain: 30,
      deckLengthConstraintEnabled: true,
      audienceLevel: "PHYSICIAN_LEVEL"
    });
    const block = SlideBlockSchema.parse({
      schema_version: "1.0.0",
      block_id: "ACT1_B02",
      act_id: "ACT1",
      slide_range: { start: 2, end: 2 },
      slide_overrides: [],
      operations: [
        {
          op: "replace_slide",
          slide_id: deck.slides[1]!.slide_id,
          replacement_slide: {
            ...deck.slides[1]!,
            title: "Authored replacement title",
            hook: "A sharper authored hook."
          }
        }
      ],
      block_summary_out: "Act I escalates."
    });

    const normalized = normalizeSlideBlockOperations({ block, currentSlides: deck.slides });
    expect(normalized.operations).toHaveLength(1);
    expect(normalized.operations[0]!.op).toBe("replace_slide");
    expect(normalized.warnings).toHaveLength(0);
  });

  it("builds narrative state with continuity and excerpts", () => {
    const deck = generateV2DeckSpec({
      topic: "Narrative state",
      deckLengthMain: 30,
      deckLengthConstraintEnabled: true,
      audienceLevel: "COLLEGE_LEVEL"
    });
    const state = buildNarrativeStateForBlock({
      blockId: "ACT2_B01",
      storyBlueprint: makeStoryBlueprint({ episode_logline: "x" }),
      actOutline: makeActOutline(),
      unresolvedThreads: ["thread-1"],
      priorBlockSummary: "last block changed the suspect ordering",
      recentSlideExcerpts: deck.slides.slice(0, 3).map((slide) => `${slide.slide_id} ${slide.title}`),
      activeDifferentialOrdering: ["DX-A", "DX-B"],
      canonicalProfileExcerpt: "canon excerpt",
      episodeMemoryExcerpt: "episode memory excerpt"
    });

    expect(state.block_id).toBe("ACT2_B01");
    expect(state.canonical_profile_excerpt).toContain("canon excerpt");
    expect(state.episode_memory_excerpt).toContain("episode memory");
    expect(state.recent_slide_excerpts.length).toBeGreaterThanOrEqual(2);
  });

  it("plans smaller quality blocks and injects anti-scaffold rules into block prompt context", () => {
    const outline = makeActOutline([
      { act_id: "ACT1", start: 1, end: 21 },
      { act_id: "ACT2", start: 22, end: 41 },
      { act_id: "ACT3", start: 42, end: 62 },
      { act_id: "ACT4", start: 63, end: 82 }
    ]);

    const plans = planSlideBlocksFromOutline(outline as never, 12);
    expect(Math.max(...plans.map((plan) => plan.end - plan.start + 1))).toBeLessThanOrEqual(12);

    const context = buildBlockPromptContext({
      topic: "CAP",
      plan: plans[0]!,
      storyBlueprint: makeStoryBlueprint({ clue_obligations: ["c1", "c2", "c3", "c4"], unresolved_threads: ["u1", "u2"] }),
      actOutline: outline as never,
      narrativeState: buildNarrativeStateForBlock({
        blockId: plans[0]!.blockId,
        storyBlueprint: makeStoryBlueprint({ clue_obligations: ["c1", "c2", "c3", "c4"], unresolved_threads: ["u1", "u2"] }),
        actOutline: outline as never,
        unresolvedThreads: ["u1"],
        priorBlockSummary: "summary",
        recentSlideExcerpts: ["S01 clue"],
        activeDifferentialOrdering: ["DX-1"],
        canonicalProfileExcerpt: "canon",
        episodeMemoryExcerpt: "memory"
      }),
      medicalSlice: {
        dossier_focus: { dx: "cap" },
        truth_focus: { lock: "cap" },
        differential_focus: { ids: ["DX-1"] },
        clue_focus: { clues: ["C1"] },
        micro_world_focus: { zones: ["Z1"] },
        drama_focus: { arc: "tension" },
        setpiece_focus: { beat: "entry" }
      }
    });

    expect(context).toContain("Never return scaffold placeholders");
    expect(context).toContain("omit them instead of emitting empty strings");
    expect(context).toContain("Main-deck slides should default to delivery_mode clue, dialogue, or action");
    expect(context).toContain("Avoid note_only in the main deck");
  });

  it("preserves smaller quality blocks while trimming narrative state carryover for block prompts", () => {
    const outline = makeActOutline([
      { act_id: "ACT1", start: 1, end: 28 },
      { act_id: "ACT2", start: 29, end: 56 },
      { act_id: "ACT3", start: 57, end: 84 },
      { act_id: "ACT4", start: 85, end: 112 }
    ]);
    outline.acts[0]!.story_pressure = ["p1", "p2", "p3"];
    outline.acts[0]!.clue_obligations = ["c1", "c2", "c3", "c4", "c5", "c6", "c7"];
    outline.acts[1]!.story_pressure = ["p4", "p5"];

    const plans = planSlideBlocksFromOutline(outline as never, 6);
    expect(Math.max(...plans.map((plan) => plan.end - plan.start + 1))).toBeLessThanOrEqual(8);

    const narrativeState = buildNarrativeStateForBlock({
      blockId: plans[0]!.blockId,
      storyBlueprint: makeStoryBlueprint({
        clue_obligations: ["c1", "c2", "c3", "c4", "c5", "c6", "c7"],
        unresolved_threads: ["u1", "u2", "u3", "u4", "u5", "u6", "u7"]
      }),
      actOutline: outline as never,
      unresolvedThreads: ["u1", "u2", "u3", "u4", "u5", "u6", "u7"],
      priorBlockSummary: "Prior block changed the active suspect list and forced a new proof route.",
      recentSlideExcerpts: ["S01 clue", "S02 reversal", "S03 pursuit", "S04 fallout", "S05 proof"],
      activeDifferentialOrdering: ["DX-1", "DX-2", "DX-3", "DX-4", "DX-5", "DX-6"],
      canonicalProfileExcerpt: "canon ".repeat(400),
      episodeMemoryExcerpt: "memory ".repeat(250)
    });

    expect(narrativeState.recent_slide_excerpts).toHaveLength(4);
    expect(narrativeState.active_clue_obligations).toHaveLength(6);
    expect(narrativeState.active_differential_ordering).toHaveLength(5);
  });

  it("builds a compact retry block prompt that keeps narrative state but trims payload volume", () => {
    const outline = makeActOutline([
      { act_id: "ACT1", start: 1, end: 12 },
      { act_id: "ACT2", start: 13, end: 24 },
      { act_id: "ACT3", start: 25, end: 36 },
      { act_id: "ACT4", start: 37, end: 48 }
    ]);

    const plan = planSlideBlocksFromOutline(outline as never, 12)[0]!;
    const narrativeState = buildNarrativeStateForBlock({
      blockId: plan.blockId,
      storyBlueprint: makeStoryBlueprint({ clue_obligations: ["c1", "c2", "c3", "c4"], unresolved_threads: ["u1", "u2"] }),
      actOutline: outline as never,
      unresolvedThreads: ["u1", "u2"],
      priorBlockSummary: "prior summary with continuity change",
      recentSlideExcerpts: ["S01 clue", "S02 reversal", "S03 proof seed"],
      activeDifferentialOrdering: ["DX-1", "DX-2", "DX-3"],
      canonicalProfileExcerpt: "canon ".repeat(200),
      episodeMemoryExcerpt: "memory ".repeat(120)
    });
    const primary = buildBlockPromptContext({
      topic: "CAP",
      plan,
      storyBlueprint: makeStoryBlueprint({ clue_obligations: ["c1", "c2", "c3", "c4"], unresolved_threads: ["u1", "u2"] }),
      actOutline: outline as never,
      narrativeState,
      medicalSlice: {
        dossier_focus: { dx: "cap", long_blob: "x".repeat(2500) },
        truth_focus: { lock: "cap" },
        differential_focus: { ids: ["DX-1", "DX-2"] },
        clue_focus: { clues: ["C1", "C2", "C3"] },
        micro_world_focus: { zones: ["Z1", "Z2"] },
        drama_focus: { arc: "tension" },
        setpiece_focus: { beat: "entry" }
      }
    });
    const compact = buildBlockPromptContext({
      topic: "CAP",
      plan,
      storyBlueprint: makeStoryBlueprint({ clue_obligations: ["c1", "c2", "c3", "c4"], unresolved_threads: ["u1", "u2"] }),
      actOutline: outline as never,
      narrativeState,
      medicalSlice: {
        dossier_focus: { dx: "cap", long_blob: "x".repeat(2500) },
        truth_focus: { lock: "cap" },
        differential_focus: { ids: ["DX-1", "DX-2"] },
        clue_focus: { clues: ["C1", "C2", "C3"] },
        micro_world_focus: { zones: ["Z1", "Z2"] },
        drama_focus: { arc: "tension" },
        setpiece_focus: { beat: "entry" }
      },
      mode: "retry_compact"
    });

    expect(compact).toContain("NARRATIVE STATE");
    expect(compact).toContain("baseline tension");
    expect(compact.length).toBeLessThan(primary.length);
  });
});
