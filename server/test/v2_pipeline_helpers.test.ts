import { describe, expect, it } from "vitest";
import { buildActOutlineFallback, buildStoryBlueprintFallback } from "../src/pipeline/v2_micro_detectives/authoring_stages.js";
import { generateV2DeckSpec } from "../src/pipeline/v2_micro_detectives/generator.js";
import { generateDiseaseDossier, generateEpisodePitch, generateMedFactcheckReport, generateTruthModel } from "../src/pipeline/v2_micro_detectives/phase2_generator.js";
import { generateClueGraph, generateDifferentialCast, generateReaderSimReport } from "../src/pipeline/v2_micro_detectives/phase3_generator.js";
import { generateDramaPlan, generateMicroWorldMap, generateSetpiecePlan } from "../src/pipeline/v2_micro_detectives/phase4_generator.js";
import {
  __testOnlyApplyDiseaseResearchGroundingChecks,
  __testOnlyBuildDiseaseResearchSourceReport,
  __testOnlyCompactMedicalSliceForBlock,
  __testOnlyInferOutlineActForPlan,
  __testOnlyResolveQaLoopBudget,
  __testOnlyResolveStructuralBlockIndexes
} from "../src/pipeline/v2_micro_detectives/pipeline.js";
import { buildQaBlockHeatmap } from "../src/pipeline/v2_micro_detectives/phase3_quality.js";

function buildFixture(topic = "Community acquired pneumonia") {
  const deck = generateV2DeckSpec({
    topic,
    deckLengthMain: 60,
    deckLengthConstraintEnabled: true,
    audienceLevel: "PHYSICIAN_LEVEL"
  });
  const base = {
    topic,
    audienceLevel: "PHYSICIAN_LEVEL" as const,
    deckLengthMain: 60 as const,
    deckLengthConstraintEnabled: true,
    kbContext: "## Medical / Clinical KB\n- curated evidence"
  };
  const dossier = generateDiseaseDossier(base);
  const pitch = generateEpisodePitch(base, dossier);
  const truth = generateTruthModel(base, dossier, pitch);
  const differential = generateDifferentialCast(deck, dossier, truth);
  const clueGraph = generateClueGraph(deck, dossier, differential);
  const storyBlueprint = buildStoryBlueprintFallback({
    topic,
    clueObligations: clueGraph.clues.slice(0, 6).map((clue) => clue.clue_id)
  });
  const actOutline = buildActOutlineFallback({ deck, storyBlueprint });
  const microWorld = generateMicroWorldMap(deck, dossier, truth);
  const dramaPlan = generateDramaPlan(deck, truth);
  const setpiecePlan = generateSetpiecePlan(deck, microWorld, dossier);
  return {
    deck,
    dossier,
    truth,
    differential,
    clueGraph,
    storyBlueprint,
    actOutline,
    microWorld,
    dramaPlan,
    setpiecePlan
  };
}

describe("v2 pipeline helpers", () => {
  it("derives adaptive QA loop budget from slide count or block count fallback", () => {
    expect(__testOnlyResolveQaLoopBudget({ estimatedMainSlides: 30, blockCount: 4 })).toBe(2);
    expect(__testOnlyResolveQaLoopBudget({ estimatedMainSlides: 60, blockCount: 4 })).toBe(3);
    expect(__testOnlyResolveQaLoopBudget({ estimatedMainSlides: 120, blockCount: 4 })).toBe(4);
    expect(__testOnlyResolveQaLoopBudget({ estimatedMainSlides: 180, blockCount: 4 })).toBe(5);

    expect(__testOnlyResolveQaLoopBudget({ blockCount: 5 })).toBe(2);
    expect(__testOnlyResolveQaLoopBudget({ blockCount: 7 })).toBe(3);
    expect(__testOnlyResolveQaLoopBudget({ blockCount: 12 })).toBe(4);
    expect(__testOnlyResolveQaLoopBudget({ blockCount: 18 })).toBe(5);
  });

  it("uses the block plan act id for compact medical/drama/setpiece context instead of slide-number heuristics", () => {
    const fixture = buildFixture("Act scoped context");
    const outlineAct = __testOnlyInferOutlineActForPlan(
      { actId: "ACT4", start: 1, end: 6 },
      fixture.actOutline
    );

    expect(outlineAct).toBe("ACT1");

    const slice = __testOnlyCompactMedicalSliceForBlock({
      plan: { start: 1, end: 6, actId: "ACT4" },
      diseaseDossier: fixture.dossier,
      truthModel: fixture.truth,
      differentialCast: fixture.differential,
      clueGraph: fixture.clueGraph,
      microWorldMap: fixture.microWorld,
      dramaPlan: fixture.dramaPlan,
      setpiecePlan: fixture.setpiecePlan
    });

    expect(slice.drama_focus.chapter_or_act_setups[0]?.act_id).toBe("ACT4");
    expect(slice.setpiece_focus.setpieces.every((setpiece) => setpiece.act_id === "ACT4")).toBe(true);
    expect(slice.setpiece_focus.act_debts[0]?.act_id).toBe("ACT4");
  });

  it("builds full-deck QA heatmaps and targets the worst block per act plus repeated-template offenders", () => {
    const fixture = buildFixture("QA heatmap");
    const reader = generateReaderSimReport(fixture.deck, fixture.truth, fixture.clueGraph);
    const blockPlans = [
      { blockId: "ACT1_B01", actId: "ACT1" as const, start: 1, end: 15 },
      { blockId: "ACT2_B01", actId: "ACT2" as const, start: 16, end: 30 },
      { blockId: "ACT3_B01", actId: "ACT3" as const, start: 31, end: 45 },
      { blockId: "ACT4_B01", actId: "ACT4" as const, start: 46, end: 60 }
    ];
    const degradedDeck = {
      ...fixture.deck,
      slides: fixture.deck.slides.map((slide, index) =>
        index < 15 || index >= 45
          ? {
              ...slide,
              title: "Repeated Title",
              hook: "Repeated hook",
              story_panel: {
                goal: "Repeat",
                opposition: "Repeat",
                turn: "Repeat",
                decision: "Repeat"
              },
              medical_payload: {
                ...slide.medical_payload,
                delivery_mode: "note_only" as const
              }
            }
          : slide
      )
    };
    const heatmap = buildQaBlockHeatmap({
      deckSpec: degradedDeck,
      blockPlans,
      readerSimReport: reader,
      semanticMetrics: {
        mainSlideCount: degradedDeck.slides.length,
        storyForwardRatio: 0.4,
        hybridSlideQuality: 0.45,
        citationGroundingCoverage: 0.7,
        pass: false,
        failures: ["story_forward_ratio below threshold"],
        storyForwardDeficitSlideIds: degradedDeck.slides.slice(0, 5).map((slide) => slide.slide_id),
        hybridDeficitSlideIds: degradedDeck.slides.slice(45, 50).map((slide) => slide.slide_id),
        citationDeficitSlideIds: []
      },
      loop: 1
    });

    const targetedIndexes = __testOnlyResolveStructuralBlockIndexes(
      [
        {
          fix_id: "SEM-001",
          type: "increase_story_turn",
          priority: "must",
          description: "Strengthen the weak blocks.",
          targets: ["ACT2_B01", "S49"]
        }
      ],
      blockPlans,
      {
        blocks: heatmap.blocks.map((block) => ({
          block_id: block.block_id,
          act_id: block.act_id,
          severity_score: block.severity_score,
          repeated_template_density: block.repeated_template_density
        }))
      }
    );

    expect(heatmap.blocks).toHaveLength(4);
    expect(heatmap.blocks.some((block) => block.repeated_template_density >= 0.18)).toBe(true);
    expect(targetedIndexes).toEqual(expect.arrayContaining([1, 2, 3]));
  });

  it("reports curated-first disease research sourcing with explicit fallback reasons when web dominates", () => {
    const fixture = buildFixture("Curated research");
    fixture.dossier.sections[0]!.citations = [
      { citation_id: "CIT-KB-001", claim: "Curated evidence", locator: "kb_context>pathophysiology" },
      { citation_id: "WEB-001", claim: "Supplemental evidence", locator: "web:guideline" }
    ];
    fixture.dossier.sections[1]!.citations = [{ citation_id: "WEB-ONLY-001", claim: "Web heavy", locator: "web:review" }];

    const report = __testOnlyBuildDiseaseResearchSourceReport({
      topic: "Curated research",
      dossier: fixture.dossier,
      curatedEvidenceAvailable: true
    });

    expect(report.sections[0]?.dominant_source).toBe("mixed");
    expect(report.sections[1]?.dominant_source).toBe("web");
    expect(report.sections[1]?.fallback_reason).toMatch(/curated evidence was available/i);
  });

  it("promotes web-dominant research sections into med-factcheck issues for QA", () => {
    const fixture = buildFixture("Grounding QA");
    fixture.dossier.sections[0]!.citations = [{ citation_id: "WEB-ONLY-001", claim: "Web heavy", locator: "web:review" }];
    const sourceReport = __testOnlyBuildDiseaseResearchSourceReport({
      topic: "Grounding QA",
      dossier: fixture.dossier,
      curatedEvidenceAvailable: true
    });
    const baselineFactcheck = generateMedFactcheckReport(fixture.deck, fixture.dossier);

    const groundedFactcheck = __testOnlyApplyDiseaseResearchGroundingChecks({
      report: baselineFactcheck,
      sourceReport,
      dossier: fixture.dossier,
      generationProfile: "quality"
    });

    expect(groundedFactcheck.pass).toBe(false);
    expect(
      groundedFactcheck.issues.some((issue) => issue.claim.includes("relies on web-only grounding despite curated evidence availability"))
    ).toBe(true);
    expect(groundedFactcheck.required_fixes.some((fix) => fix.fix_id.startsWith("GROUNDING-FIX-"))).toBe(true);
  });
});
