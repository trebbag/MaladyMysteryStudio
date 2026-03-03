import { describe, expect, it } from "vitest";
import { generateV2DeckSpec } from "../src/pipeline/v2_micro_detectives/generator.js";
import { generateDiseaseDossier, generateEpisodePitch, generateTruthModel } from "../src/pipeline/v2_micro_detectives/phase2_generator.js";
import { generateClueGraph, generateDifferentialCast } from "../src/pipeline/v2_micro_detectives/phase3_generator.js";
import { polishDeckSpecForFallback } from "../src/pipeline/v2_micro_detectives/quality_polish.js";

function onSlideWordCount(slide: {
  on_slide_text: { headline: string; subtitle?: string; callouts?: string[]; labels?: string[] };
}): number {
  const items = [slide.on_slide_text.headline];
  if (slide.on_slide_text.subtitle) items.push(slide.on_slide_text.subtitle);
  if (Array.isArray(slide.on_slide_text.callouts)) items.push(...slide.on_slide_text.callouts);
  if (Array.isArray(slide.on_slide_text.labels)) items.push(...slide.on_slide_text.labels);
  return items
    .join(" ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

describe("v2 quality polish", () => {
  it("grounds fallback deck content to dossier citations and raises story-forward ratio", () => {
    const base = {
      topic: "Acute kidney injury",
      audienceLevel: "COLLEGE_LEVEL" as const,
      deckLengthMain: 30 as const,
      deckLengthConstraintEnabled: true,
      kbContext: "## Medical / Clinical KB\n- deterministic context"
    };
    const deck = generateV2DeckSpec({
      topic: base.topic,
      audienceLevel: base.audienceLevel,
      deckLengthMain: base.deckLengthMain,
      deckLengthConstraintEnabled: base.deckLengthConstraintEnabled
    });
    const dossier = generateDiseaseDossier(base);
    const pitch = generateEpisodePitch(base, dossier);
    const truth = generateTruthModel(base, dossier, pitch);
    const differential = generateDifferentialCast(deck, dossier, truth);
    const clueGraph = generateClueGraph(deck, dossier, differential);

    const polished = polishDeckSpecForFallback({
      deckSpec: deck,
      dossier,
      differentialCast: differential,
      clueGraph,
      truthModel: truth,
      topic: base.topic
    });

    const citationIds = new Set(dossier.citations.map((citation) => citation.citation_id));
    const storySlides = polished.slides.filter((slide) => ["clue", "dialogue", "action"].includes(slide.medical_payload.delivery_mode));

    expect(polished.slides).toHaveLength(30);
    expect(storySlides.length).toBeGreaterThanOrEqual(Math.ceil(polished.slides.length * 0.75));
    expect(polished.slides.every((slide) => slide.medical_payload.major_concept_id !== "NONE")).toBe(true);
    expect(polished.slides.every((slide) => citationIds.has(slide.medical_payload.dossier_citations[0]!.citation_id))).toBe(true);
    expect(polished.slides.every((slide) => citationIds.has(slide.speaker_notes.citations[0]!.citation_id))).toBe(true);
    expect(polished.slides.every((slide) => onSlideWordCount(slide) <= polished.deck_meta.max_words_on_slide)).toBe(true);
  });

  it("keeps deck topology stable while improving per-slide narrative specificity", () => {
    const base = {
      topic: "Heart failure exacerbation",
      audienceLevel: "PHYSICIAN_LEVEL" as const,
      deckLengthMain: 45 as const,
      deckLengthConstraintEnabled: true,
      kbContext: "## Medical / Clinical KB\n- deterministic context"
    };
    const deck = generateV2DeckSpec({
      topic: base.topic,
      audienceLevel: base.audienceLevel,
      deckLengthMain: base.deckLengthMain,
      deckLengthConstraintEnabled: base.deckLengthConstraintEnabled
    });
    const dossier = generateDiseaseDossier(base);
    const pitch = generateEpisodePitch(base, dossier);
    const truth = generateTruthModel(base, dossier, pitch);
    const differential = generateDifferentialCast(deck, dossier, truth);
    const clueGraph = generateClueGraph(deck, dossier, differential);

    const polished = polishDeckSpecForFallback({
      deckSpec: deck,
      dossier,
      differentialCast: differential,
      clueGraph,
      truthModel: truth,
      topic: base.topic
    });

    expect(polished.acts).toHaveLength(deck.acts.length);
    expect(polished.appendix_slides).toHaveLength(deck.appendix_slides.length);
    expect(new Set(polished.slides.map((slide) => slide.story_panel.goal)).size).toBeGreaterThan(10);
    expect(new Set(polished.slides.map((slide) => slide.title)).size).toBeGreaterThan(10);
  });

  it("repair_only mode preserves authored narrative fields while repairing empty required fields", () => {
    const base = {
      topic: "Chronic kidney disease",
      audienceLevel: "PHYSICIAN_LEVEL" as const,
      deckLengthMain: 30 as const,
      deckLengthConstraintEnabled: true,
      kbContext: "## Medical / Clinical KB\n- deterministic context"
    };
    const deck = generateV2DeckSpec({
      topic: base.topic,
      audienceLevel: base.audienceLevel,
      deckLengthMain: base.deckLengthMain,
      deckLengthConstraintEnabled: base.deckLengthConstraintEnabled
    });
    const dossier = generateDiseaseDossier(base);
    const pitch = generateEpisodePitch(base, dossier);
    const truth = generateTruthModel(base, dossier, pitch);
    const differential = generateDifferentialCast(deck, dossier, truth);
    const clueGraph = generateClueGraph(deck, dossier, differential);

    const authoredTitle = "S01: Basement membrane stakeout";
    const authoredHook = "Can this clue fracture the mimic theory?";
    const authoredGoal = "Force a reveal by testing the membrane clue.";
    const authoredTopDx = ["DX-CUSTOM-A", "DX-CUSTOM-B"];

    deck.slides[0] = {
      ...deck.slides[0],
      title: authoredTitle,
      hook: authoredHook,
      story_panel: {
        ...deck.slides[0].story_panel,
        goal: authoredGoal
      },
      speaker_notes: {
        ...deck.slides[0].speaker_notes,
        differential_update: {
          ...deck.slides[0].speaker_notes.differential_update,
          top_dx_ids: authoredTopDx
        }
      }
    };

    deck.slides[1] = {
      ...deck.slides[1],
      title: " ",
      hook: " ",
      story_panel: {
        ...deck.slides[1].story_panel,
        goal: "",
        opposition: "",
        turn: "",
        decision: ""
      },
      medical_payload: {
        ...deck.slides[1].medical_payload,
        major_concept_id: "",
        dossier_citations: []
      },
      speaker_notes: {
        ...deck.slides[1].speaker_notes,
        citations: [],
        differential_update: {
          ...deck.slides[1].speaker_notes.differential_update,
          top_dx_ids: []
        }
      }
    };

    const repaired = polishDeckSpecForFallback({
      deckSpec: deck,
      dossier,
      differentialCast: differential,
      clueGraph,
      truthModel: truth,
      topic: base.topic,
      mode: "repair_only"
    });

    expect(repaired.slides[0].title).toBe(authoredTitle);
    expect(repaired.slides[0].hook).toBe(authoredHook);
    expect(repaired.slides[0].story_panel.goal).toBe(authoredGoal);
    expect(repaired.slides[0].speaker_notes.differential_update.top_dx_ids).toEqual(authoredTopDx);

    expect(String(repaired.slides[1].title ?? "").trim().length).toBeGreaterThan(0);
    expect(String(repaired.slides[1].hook ?? "").trim().length).toBeGreaterThan(0);
    expect(repaired.slides[1].story_panel.goal.trim().length).toBeGreaterThan(0);
    expect(repaired.slides[1].medical_payload.major_concept_id.trim().length).toBeGreaterThan(0);
    expect(repaired.slides[1].medical_payload.dossier_citations.length).toBeGreaterThan(0);
    expect(repaired.slides[1].speaker_notes.citations.length).toBeGreaterThan(0);
    expect(repaired.slides[1].speaker_notes.differential_update.top_dx_ids.length).toBeGreaterThan(0);
  });
});
