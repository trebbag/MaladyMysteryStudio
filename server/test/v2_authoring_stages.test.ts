import { describe, expect, it } from "vitest";
import { generateV2DeckSpec } from "../src/pipeline/v2_micro_detectives/generator.js";
import {
  assembleDeckFromSlideBlocks,
  buildNarrativeStateForBlock,
  normalizeSlideBlockOperations
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
    expect(out.deck.slides[0]!.slide_id).toBe("S01");
    expect(out.deck.slides.some((slide) => slide.title === "Author Replaced Slide")).toBe(true);
    expect(out.deck.slides.some((slide) => slide.title === "Inserted Beat")).toBe(true);
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
});
