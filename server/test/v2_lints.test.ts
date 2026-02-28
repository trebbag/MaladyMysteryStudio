import { describe, expect, it } from "vitest";
import { generateV2DeckSpec } from "../src/pipeline/v2_micro_detectives/generator.js";
import { lintDeckSpecPhase1 } from "../src/pipeline/v2_micro_detectives/lints.js";

describe("v2 micro-detectives deterministic lints", () => {
  it("passes for generated 45-slide deck", () => {
    const deck = generateV2DeckSpec({
      topic: "DKA",
      deckLengthMain: 45,
      audienceLevel: "MED_SCHOOL_ADVANCED"
    });
    const report = lintDeckSpecPhase1(deck, 45);
    expect(report.pass).toBe(true);
    expect(report.errorCount).toBe(0);
  });

  it("fails when a main slide is missing story turn fields", () => {
    const deck = generateV2DeckSpec({
      topic: "DKA",
      deckLengthMain: 30,
      audienceLevel: "MED_SCHOOL_ADVANCED"
    });
    deck.slides[0] = {
      ...deck.slides[0],
      story_panel: {
        ...deck.slides[0].story_panel,
        turn: ""
      }
    };

    const report = lintDeckSpecPhase1(deck, 30);
    expect(report.pass).toBe(false);
    expect(report.errors.some((e) => e.code === "MISSING_STORY_TURN")).toBe(true);
  });

  it("fails when story-forward ratio falls below target", () => {
    const deck = generateV2DeckSpec({
      topic: "DKA",
      deckLengthMain: 30,
      audienceLevel: "MED_SCHOOL_ADVANCED"
    });
    deck.slides = deck.slides.map((slide) => ({
      ...slide,
      medical_payload: {
        ...slide.medical_payload,
        delivery_mode: "note_only"
      }
    }));

    const report = lintDeckSpecPhase1(deck, 30);
    expect(report.pass).toBe(false);
    expect(report.errors.some((e) => e.code === "STORY_DOMINANCE_BELOW_TARGET")).toBe(true);
  });

  it("fails when deck length declarations and main slide count mismatch", () => {
    const deck = generateV2DeckSpec({
      topic: "Asthma",
      deckLengthMain: 30,
      audienceLevel: "MED_SCHOOL_ADVANCED"
    });
    deck.deck_meta.deck_length_main = "45";
    deck.slides = deck.slides.slice(0, 29);

    const report = lintDeckSpecPhase1(deck, 30);
    expect(report.pass).toBe(false);
    expect(report.errors.some((e) => e.code === "DECK_META_LENGTH_MISMATCH")).toBe(true);
    expect(report.errors.some((e) => e.code === "MAIN_SLIDE_COUNT_MISMATCH")).toBe(true);
  });

  it("fails on word limit, empty concept id, and compound concept id", () => {
    const deck = generateV2DeckSpec({
      topic: "COPD",
      deckLengthMain: 30,
      audienceLevel: "MED_SCHOOL_ADVANCED"
    });
    deck.deck_meta.max_words_on_slide = 2;
    deck.slides[0] = {
      ...deck.slides[0],
      medical_payload: {
        ...deck.slides[0].medical_payload,
        major_concept_id: " "
      }
    };
    deck.slides[1] = {
      ...deck.slides[1],
      medical_payload: {
        ...deck.slides[1].medical_payload,
        major_concept_id: "MC-001 and MC-002"
      }
    };

    const report = lintDeckSpecPhase1(deck, 30);
    expect(report.pass).toBe(false);
    expect(report.errors.some((e) => e.code === "ON_SLIDE_WORD_LIMIT_EXCEEDED")).toBe(true);
    expect(report.errors.some((e) => e.code === "MAJOR_CONCEPT_EMPTY")).toBe(true);
    expect(report.errors.some((e) => e.code === "MAJOR_CONCEPT_COMPOUND")).toBe(true);
  });

  it("enforces elevated story-forward target ratio when configured above 0.7", () => {
    const deck = generateV2DeckSpec({
      topic: "Heart failure",
      deckLengthMain: 30,
      audienceLevel: "MED_SCHOOL_ADVANCED"
    });
    deck.deck_meta.story_dominance_target_ratio = 0.9;
    for (let i = 24; i < deck.slides.length; i++) {
      deck.slides[i] = {
        ...deck.slides[i],
        medical_payload: {
          ...deck.slides[i].medical_payload,
          delivery_mode: "note_only"
        }
      };
    }

    const report = lintDeckSpecPhase1(deck, 30);
    expect(report.pass).toBe(false);
    expect(report.storyForwardRatio).toBeLessThan(0.9);
    expect(report.errors.some((e) => e.code === "STORY_DOMINANCE_BELOW_TARGET")).toBe(true);
  });
});
