import { describe, expect, it } from "vitest";
import { generateV2DeckSpec } from "../src/pipeline/v2_micro_detectives/generator.js";
import {
  generateDiseaseDossier,
  generateEpisodePitch,
  generateMedFactcheckReport,
  generateTruthModel
} from "../src/pipeline/v2_micro_detectives/phase2_generator.js";

describe("v2 phase-2 deterministic generators", () => {
  it("builds dossier, pitch, and truth model with required gate-ready structure", () => {
    const base = {
      topic: "DKA",
      audienceLevel: "MED_SCHOOL_ADVANCED" as const,
      deckLengthMain: 45 as const,
      kbContext: "## Medical / Clinical KB\n- source notes"
    };
    const dossier = generateDiseaseDossier(base);
    expect(dossier.citations.length).toBeGreaterThan(0);
    expect(dossier.sections.length).toBeGreaterThanOrEqual(5);

    const pitch = generateEpisodePitch(base, dossier);
    expect(pitch.target_deck_length).toBe("45");
    expect(pitch.citations_used.length).toBeGreaterThan(0);
    expect(pitch.teaser_storyboard.length).toBeGreaterThanOrEqual(3);

    const truth = generateTruthModel(base, dossier, pitch);
    expect(truth.final_diagnosis.name).toBe("DKA");
    expect(truth.macro_timeline.length).toBeGreaterThanOrEqual(2);
    expect(truth.micro_timeline.length).toBeGreaterThanOrEqual(2);
  });

  it("flags deck-length mismatch in med factcheck report", () => {
    const base = {
      topic: "COPD",
      audienceLevel: "RESIDENT" as const,
      deckLengthMain: 30 as const,
      kbContext: "## Medical / Clinical KB\n- source notes"
    };
    const dossier = generateDiseaseDossier(base);
    const deck = generateV2DeckSpec({
      topic: "COPD",
      deckLengthMain: 30,
      audienceLevel: "RESIDENT"
    });
    deck.slides = deck.slides.slice(0, 28);

    const report = generateMedFactcheckReport(deck, dossier);
    expect(report.pass).toBe(false);
    expect(report.issues.some((i) => i.issue_id === "MED-ERR-001")).toBe(true);
    expect(report.required_fixes.length).toBeGreaterThan(0);
  });
});
