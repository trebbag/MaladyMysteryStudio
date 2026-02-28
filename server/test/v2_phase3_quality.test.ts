import { describe, expect, it } from "vitest";
import { generateV2DeckSpec } from "../src/pipeline/v2_micro_detectives/generator.js";
import { generateDiseaseDossier, generateEpisodePitch, generateMedFactcheckReport, generateTruthModel } from "../src/pipeline/v2_micro_detectives/phase2_generator.js";
import { generateClueGraph, generateDifferentialCast, generateReaderSimReport } from "../src/pipeline/v2_micro_detectives/phase3_generator.js";
import { lintDeckSpecPhase1 } from "../src/pipeline/v2_micro_detectives/lints.js";
import { applyQaPatchesToDeckSpec, applyTargetedQaPatches, buildCombinedQaReport } from "../src/pipeline/v2_micro_detectives/phase3_quality.js";

describe("v2 phase-3 quality helpers", () => {
  it("builds a combined QA report with grader scores and fix list", () => {
    const base = {
      topic: "Pneumonia",
      audienceLevel: "RESIDENT" as const,
      deckLengthMain: 45 as const,
      kbContext: "## Medical / Clinical KB\n- source notes"
    };
    const dossier = generateDiseaseDossier(base);
    const pitch = generateEpisodePitch(base, dossier);
    const truth = generateTruthModel(base, dossier, pitch);
    const deck = generateV2DeckSpec({ topic: base.topic, deckLengthMain: 45, audienceLevel: "RESIDENT" });
    const differential = generateDifferentialCast(deck, dossier, truth);
    const clueGraph = generateClueGraph(deck, dossier, differential);
    const reader = generateReaderSimReport(deck, truth, clueGraph);
    const med = generateMedFactcheckReport(deck, dossier);
    const lint = lintDeckSpecPhase1(deck, 45);

    const qa = buildCombinedQaReport({
      lintReport: lint,
      readerSimReport: reader,
      medFactcheckReport: med,
      deckSpec: deck
    });

    expect(qa.schema_version).toBe("1.0.0");
    expect(qa.grader_scores.length).toBe(6);
    expect(qa.citations_used.length).toBeGreaterThan(0);
  });

  it("applies deterministic patch transforms when QA requires fixes", () => {
    const deck = generateV2DeckSpec({ topic: "AKI", deckLengthMain: 30, audienceLevel: "MED_SCHOOL_ADVANCED" });
    const qa = {
      schema_version: "1.0.0",
      lint_pass: false,
      lint_errors: [],
      grader_scores: [],
      accept: false,
      required_fixes: [
        {
          fix_id: "FIX-1",
          type: "reduce_text_density" as const,
          priority: "must" as const,
          description: "too many words",
          targets: [deck.slides[0]!.slide_id]
        },
        {
          fix_id: "FIX-2",
          type: "increase_story_turn" as const,
          priority: "must" as const,
          description: "story turn weak",
          targets: [deck.slides[1]!.slide_id]
        }
      ],
      summary: "needs patching",
      citations_used: [{ citation_id: "CIT-001", claim: "x" }]
    };

    const patched = applyQaPatchesToDeckSpec(deck, qa, 1);
    expect(patched.patchNotes.length).toBeGreaterThan(0);
    expect(["clue", "dialogue", "action"]).toContain(patched.deck.slides[1]!.medical_payload.delivery_mode);
  });

  it("applies targeted QA patches across deck, clue graph, and differential cast", () => {
    const base = {
      topic: "Asthma",
      audienceLevel: "RESIDENT" as const,
      deckLengthMain: 30 as const,
      kbContext: "## Medical / Clinical KB\n- source notes"
    };
    const dossier = generateDiseaseDossier(base);
    const pitch = generateEpisodePitch(base, dossier);
    const truth = generateTruthModel(base, dossier, pitch);
    const deck = generateV2DeckSpec({ topic: base.topic, deckLengthMain: 30, audienceLevel: "RESIDENT" });
    const differential = generateDifferentialCast(deck, dossier, truth);
    const clueGraph = generateClueGraph(deck, dossier, differential);
    const targetSlideId = deck.slides[0]!.slide_id;
    const targetClueId = clueGraph.clues[0]!.clue_id;
    const targetDxId = differential.primary_suspects[0]!.dx_id;
    const qa = {
      schema_version: "1.0.0",
      lint_pass: false,
      lint_errors: [],
      grader_scores: [],
      accept: false,
      required_fixes: [
        { fix_id: "FX-CLUE", type: "edit_clue" as const, priority: "must" as const, description: "tighten clue", targets: [targetClueId] },
        { fix_id: "FX-DX", type: "edit_differential" as const, priority: "must" as const, description: "tighten differential", targets: [targetDxId] },
        { fix_id: "FX-SLIDE", type: "reduce_text_density" as const, priority: "must" as const, description: "reduce text", targets: [targetSlideId] }
      ],
      summary: "needs patching",
      citations_used: [{ citation_id: "CIT-001", claim: "x" }]
    };

    const patched = applyTargetedQaPatches({
      deckSpec: deck,
      clueGraph,
      differentialCast: differential,
      qaReport: qa,
      loopIndex: 1
    });

    expect(patched.deckChanges).toBeGreaterThan(0);
    expect(patched.clueChanges).toBeGreaterThan(0);
    expect(patched.differentialChanges).toBeGreaterThan(0);
    expect(patched.clueGraph.clues[0]!.correct_inference).toContain("Patch 1");
    expect(patched.differentialCast.primary_suspects[0]!.why_tempting).toContain("Patch 1");
  });

  it("builds lint-driven required fixes across error-code branches and dedupes duplicates", () => {
    const base = {
      topic: "Pulmonary embolism",
      audienceLevel: "RESIDENT" as const,
      deckLengthMain: 30 as const,
      kbContext: "## Medical / Clinical KB\n- source notes"
    };
    const dossier = generateDiseaseDossier(base);
    const pitch = generateEpisodePitch(base, dossier);
    const truth = generateTruthModel(base, dossier, pitch);
    const deck = generateV2DeckSpec({ topic: base.topic, deckLengthMain: 30, audienceLevel: "RESIDENT" });
    const differential = generateDifferentialCast(deck, dossier, truth);
    const clueGraph = generateClueGraph(deck, dossier, differential);
    const reader = generateReaderSimReport(deck, truth, clueGraph);
    const med = generateMedFactcheckReport(deck, dossier);

    const duplicatedFix = {
      fix_id: "FIX-DUP",
      type: "medical_correction" as const,
      priority: "must" as const,
      description: "Patch same contradiction",
      targets: [deck.slides[0]!.slide_id]
    };
    med.pass = false;
    med.required_fixes = [duplicatedFix, duplicatedFix];

    reader.required_fixes = [
      duplicatedFix,
      {
        fix_id: "FIX-READ",
        type: "increase_story_turn" as const,
        priority: "must" as const,
        description: "Reader got lost in transitions",
        targets: [deck.slides[1]!.slide_id]
      }
    ];

    const lint = {
      workflow: "v2_micro_detectives" as const,
      expectedDeckLengthMain: 30 as const,
      measuredDeckLengthMain: 30,
      storyForwardRatio: 0.45,
      storyForwardTargetRatio: 0.7,
      pass: false,
      errorCount: 6,
      warningCount: 0,
      errors: [
        {
          code: "ON_SLIDE_WORD_LIMIT_EXCEEDED",
          message: "Too many words",
          severity: "error" as const,
          slide_id: deck.slides[0]!.slide_id
        },
        {
          code: "MISSING_STORY_TURN",
          message: "Story turn missing",
          severity: "error" as const,
          slide_id: deck.slides[1]!.slide_id
        },
        {
          code: "STORY_DOMINANCE_BELOW_TARGET",
          message: "Story ratio too low",
          severity: "error" as const
        },
        {
          code: "MAJOR_CONCEPT_EMPTY",
          message: "Major concept empty",
          severity: "error" as const,
          slide_id: deck.slides[2]!.slide_id
        },
        {
          code: "MAJOR_CONCEPT_COMPOUND",
          message: "Compound concept",
          severity: "error" as const,
          slide_id: deck.slides[3]!.slide_id
        },
        {
          code: "UNKNOWN_ERROR_CODE",
          message: "Fallback branch should create edit_slide fix",
          severity: "error" as const,
          slide_id: deck.slides[4]!.slide_id
        }
      ]
    };

    const qa = buildCombinedQaReport({
      lintReport: lint,
      readerSimReport: reader,
      medFactcheckReport: med,
      deckSpec: deck
    });

    expect(qa.accept).toBe(false);
    expect(qa.required_fixes.some((fix) => fix.type === "reduce_text_density")).toBe(true);
    expect(qa.required_fixes.some((fix) => fix.type === "increase_story_turn")).toBe(true);
    expect(qa.required_fixes.some((fix) => fix.type === "medical_correction")).toBe(true);
    expect(qa.required_fixes.some((fix) => fix.type === "edit_slide")).toBe(true);
    expect(qa.required_fixes.filter((fix) => fix.description === "Patch same contradiction")).toHaveLength(1);
  });

  it("applies twist receipt and fallback targeting patches when fixes have sparse targets", () => {
    const base = {
      topic: "Acute kidney injury",
      audienceLevel: "MED_SCHOOL_ADVANCED" as const,
      deckLengthMain: 30 as const,
      kbContext: "## Medical / Clinical KB\n- source notes"
    };
    const dossier = generateDiseaseDossier(base);
    const pitch = generateEpisodePitch(base, dossier);
    const truth = generateTruthModel(base, dossier, pitch);
    const deck = generateV2DeckSpec({ topic: base.topic, deckLengthMain: 30, audienceLevel: "MED_SCHOOL_ADVANCED" });
    const differential = generateDifferentialCast(deck, dossier, truth);
    const clueGraph = generateClueGraph(deck, dossier, differential);

    deck.slides[0]!.medical_payload.major_concept_id = "";
    if (clueGraph.twist_support_matrix[0]) {
      clueGraph.twist_support_matrix[0]!.supporting_clue_ids = [clueGraph.clues[0]!.clue_id];
    }

    const qa = {
      schema_version: "1.0.0",
      lint_pass: false,
      lint_errors: [],
      grader_scores: [],
      accept: false,
      required_fixes: [
        {
          fix_id: "FIX-TWIST",
          type: "add_twist_receipts" as const,
          priority: "must" as const,
          description: "Need explicit twist receipts",
          targets: []
        },
        {
          fix_id: "FIX-OTHER",
          type: "other" as const,
          priority: "should" as const,
          description: "Refine clue framing",
          targets: []
        },
        {
          fix_id: "FIX-MED",
          type: "medical_correction" as const,
          priority: "must" as const,
          description: "Repair missing major concept",
          targets: [deck.slides[0]!.slide_id]
        }
      ],
      summary: "needs patching",
      citations_used: [{ citation_id: "CIT-001", claim: "x" }]
    };

    const patched = applyTargetedQaPatches({
      deckSpec: deck,
      clueGraph,
      differentialCast: differential,
      qaReport: qa,
      loopIndex: 2
    });

    expect(patched.patchNotes.some((note) => note.includes("added twist receipt note"))).toBe(true);
    expect(patched.patchNotes.some((note) => note.includes("adjusted clue framing"))).toBe(true);
    expect(patched.deck.slides[0]!.speaker_notes.medical_reasoning).toContain("Twist receipt");
    expect(patched.deck.slides[0]!.medical_payload.major_concept_id).toBe("MC-PATCH-S01");
    if (patched.clueGraph.twist_support_matrix[0]) {
      expect(patched.clueGraph.twist_support_matrix[0]!.supporting_clue_ids.length).toBeGreaterThanOrEqual(3);
    }
  });
});
