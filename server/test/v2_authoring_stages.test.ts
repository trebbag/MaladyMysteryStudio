import { describe, expect, it } from "vitest";
import { generateV2DeckSpec } from "../src/pipeline/v2_micro_detectives/generator.js";
import {
  assembleDeckFromSlideBlocks,
  buildBlockPromptContext,
  buildNarrativeStateForBlock,
  normalizeSlideBlockOperations,
  planSlideBlocksFromOutline
} from "../src/pipeline/v2_micro_detectives/authoring_stages.js";
import { SlideBlockSchema } from "../src/pipeline/v2_micro_detectives/schemas.js";

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
      storyBlueprint: {
        schema_version: "1.0.0",
        episode_logline: "x",
        core_mystery_arc: {
          inciting_case: "case",
          false_theory_lock_in: "false theory",
          midpoint_fracture: "fracture",
          twist_reveal: "twist",
          final_proof: "proof"
        },
        detective_deputy_arc: {
          baseline_dynamic: "baseline",
          rupture_beat: "rupture",
          repair_beat: "repair"
        },
        opener_motif: "opener",
        ending_callback: "callback",
        clue_obligations: ["clue-1", "clue-2", "clue-3", "clue-4"],
        unresolved_threads: ["thread-1", "thread-2"]
      },
      actOutline: {
        schema_version: "1.0.0",
        acts: [
          { act_id: "ACT1", act_goal: "g1", story_pressure: ["p1", "p2"], emotional_turn: "e1", clue_obligations: ["c1"], setpiece_requirement: "s1", target_slide_span: { start: 1, end: 8 } },
          { act_id: "ACT2", act_goal: "g2", story_pressure: ["p3", "p4"], emotional_turn: "e2", clue_obligations: ["c2"], setpiece_requirement: "s2", target_slide_span: { start: 9, end: 16 } },
          { act_id: "ACT3", act_goal: "g3", story_pressure: ["p5", "p6"], emotional_turn: "e3", clue_obligations: ["c3"], setpiece_requirement: "s3", target_slide_span: { start: 17, end: 24 } },
          { act_id: "ACT4", act_goal: "g4", story_pressure: ["p7", "p8"], emotional_turn: "e4", clue_obligations: ["c4"], setpiece_requirement: "s4", target_slide_span: { start: 25, end: 30 } }
        ]
      },
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
    const outline = {
      schema_version: "1.0.0",
      acts: [
        { act_id: "ACT1", act_goal: "g1", story_pressure: ["p1"], emotional_turn: "e1", clue_obligations: ["c1"], setpiece_requirement: "s1", target_slide_span: { start: 1, end: 21 } },
        { act_id: "ACT2", act_goal: "g2", story_pressure: ["p2"], emotional_turn: "e2", clue_obligations: ["c2"], setpiece_requirement: "s2", target_slide_span: { start: 22, end: 41 } },
        { act_id: "ACT3", act_goal: "g3", story_pressure: ["p3"], emotional_turn: "e3", clue_obligations: ["c3"], setpiece_requirement: "s3", target_slide_span: { start: 42, end: 62 } },
        { act_id: "ACT4", act_goal: "g4", story_pressure: ["p4"], emotional_turn: "e4", clue_obligations: ["c4"], setpiece_requirement: "s4", target_slide_span: { start: 63, end: 82 } }
      ]
    } as const;

    const plans = planSlideBlocksFromOutline(outline as never, 12);
    expect(Math.max(...plans.map((plan) => plan.end - plan.start + 1))).toBeLessThanOrEqual(12);

    const context = buildBlockPromptContext({
      topic: "CAP",
      plan: plans[0]!,
      storyBlueprint: {
        schema_version: "1.0.0",
        episode_logline: "logline",
        core_mystery_arc: {
          inciting_case: "case",
          false_theory_lock_in: "false",
          midpoint_fracture: "fracture",
          twist_reveal: "twist",
          final_proof: "proof"
        },
        detective_deputy_arc: {
          baseline_dynamic: "baseline",
          rupture_beat: "rupture",
          repair_beat: "repair"
        },
        opener_motif: "motif",
        ending_callback: "callback",
        clue_obligations: ["c1"],
        unresolved_threads: ["u1"]
      },
      actOutline: outline as never,
      narrativeState: buildNarrativeStateForBlock({
        blockId: plans[0]!.blockId,
        storyBlueprint: {
          schema_version: "1.0.0",
          episode_logline: "logline",
          core_mystery_arc: {
            inciting_case: "case",
            false_theory_lock_in: "false",
            midpoint_fracture: "fracture",
            twist_reveal: "twist",
            final_proof: "proof"
          },
          detective_deputy_arc: {
            baseline_dynamic: "baseline",
            rupture_beat: "rupture",
            repair_beat: "repair"
          },
          opener_motif: "motif",
          ending_callback: "callback",
          clue_obligations: ["c1"],
          unresolved_threads: ["u1"]
        },
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

  it("builds a compact retry block prompt that keeps narrative state but trims payload volume", () => {
    const outline = {
      schema_version: "1.0.0",
      acts: [
        { act_id: "ACT1", act_goal: "g1", story_pressure: ["p1"], emotional_turn: "e1", clue_obligations: ["c1"], setpiece_requirement: "s1", target_slide_span: { start: 1, end: 12 } },
        { act_id: "ACT2", act_goal: "g2", story_pressure: ["p2"], emotional_turn: "e2", clue_obligations: ["c2"], setpiece_requirement: "s2", target_slide_span: { start: 13, end: 24 } },
        { act_id: "ACT3", act_goal: "g3", story_pressure: ["p3"], emotional_turn: "e3", clue_obligations: ["c3"], setpiece_requirement: "s3", target_slide_span: { start: 25, end: 36 } },
        { act_id: "ACT4", act_goal: "g4", story_pressure: ["p4"], emotional_turn: "e4", clue_obligations: ["c4"], setpiece_requirement: "s4", target_slide_span: { start: 37, end: 48 } }
      ]
    } as const;

    const plan = planSlideBlocksFromOutline(outline as never, 12)[0]!;
    const narrativeState = buildNarrativeStateForBlock({
      blockId: plan.blockId,
      storyBlueprint: {
        schema_version: "1.0.0",
        episode_logline: "logline",
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
          repair_beat: "repair"
        },
        opener_motif: "motif",
        ending_callback: "callback",
        clue_obligations: ["c1", "c2", "c3"],
        unresolved_threads: ["u1", "u2"]
      },
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
      storyBlueprint: {
        schema_version: "1.0.0",
        episode_logline: "logline",
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
          repair_beat: "repair"
        },
        opener_motif: "motif",
        ending_callback: "callback",
        clue_obligations: ["c1", "c2", "c3"],
        unresolved_threads: ["u1", "u2"]
      },
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
      storyBlueprint: {
        schema_version: "1.0.0",
        episode_logline: "logline",
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
          repair_beat: "repair"
        },
        opener_motif: "motif",
        ending_callback: "callback",
        clue_obligations: ["c1", "c2", "c3"],
        unresolved_threads: ["u1", "u2"]
      },
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
