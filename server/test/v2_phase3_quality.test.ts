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
      audienceLevel: "COLLEGE_LEVEL" as const,
      deckLengthMain: 45 as const,
      kbContext: "## Medical / Clinical KB\n- source notes"
    };
    const dossier = generateDiseaseDossier(base);
    const pitch = generateEpisodePitch(base, dossier);
    const truth = generateTruthModel(base, dossier, pitch);
    const deck = generateV2DeckSpec({ topic: base.topic, deckLengthMain: 45, audienceLevel: "COLLEGE_LEVEL" });
    const differential = generateDifferentialCast(deck, dossier, truth);
    const clueGraph = generateClueGraph(deck, dossier, differential);
    const reader = generateReaderSimReport(deck, truth, clueGraph);
    const med = generateMedFactcheckReport(deck, dossier);
    const lint = lintDeckSpecPhase1(deck, 45);

    const qa = buildCombinedQaReport({
      lintReport: lint,
      readerSimReport: reader,
      medFactcheckReport: med,
      clueGraph,
      deckSpec: deck
    });

    expect(qa.schema_version).toBe("1.0.0");
    expect(qa.grader_scores.length).toBeGreaterThanOrEqual(10);
    expect(qa.citations_used.length).toBeGreaterThan(0);
  });

  it("applies deterministic patch transforms when QA requires fixes", () => {
    const deck = generateV2DeckSpec({ topic: "AKI", deckLengthMain: 30, audienceLevel: "PHYSICIAN_LEVEL" });
    deck.slides[0]!.authoring_provenance = "agent_authored";
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
    expect(patched.deck.slides[0]!.authoring_provenance).toBe("agent_authored");
  });

  it("applies targeted QA patches across deck, clue graph, and differential cast", () => {
    const base = {
      topic: "Asthma",
      audienceLevel: "COLLEGE_LEVEL" as const,
      deckLengthMain: 30 as const,
      kbContext: "## Medical / Clinical KB\n- source notes"
    };
    const dossier = generateDiseaseDossier(base);
    const pitch = generateEpisodePitch(base, dossier);
    const truth = generateTruthModel(base, dossier, pitch);
    const deck = generateV2DeckSpec({ topic: base.topic, deckLengthMain: 30, audienceLevel: "COLLEGE_LEVEL" });
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
    expect(patched.clueChanges).toBe(0);
    expect(patched.differentialChanges).toBe(0);
    expect(patched.patchNotes.some((note) => note.includes("deferred for structural regeneration (edit_clue)"))).toBe(true);
    expect(patched.patchNotes.some((note) => note.includes("deferred for structural regeneration (edit_differential)"))).toBe(false);
  });

  it("retargets slide citations from dossier-backed QA fixes and preserves authored provenance", () => {
    const base = {
      topic: "Community-acquired pneumonia",
      audienceLevel: "PHYSICIAN_LEVEL" as const,
      deckLengthMain: 30 as const,
      kbContext: "## Medical / Clinical KB\n- source notes"
    };
    const dossier = generateDiseaseDossier(base);
    dossier.citations.push({
      citation_id: "CIT-KB-PATHOGENS-SP-01",
      claim: "Rust-colored sputum can be compatible with pneumococcal pneumonia.",
      locator: "Pathogens / pneumococcus"
    });
    dossier.citations.push({
      citation_id: "CIT-KB-MICRO-01",
      claim: "Severe CAP workup can include Legionella urine antigen testing.",
      locator: "Microbiology workup"
    });
    const pitch = generateEpisodePitch(base, dossier);
    const truth = generateTruthModel(base, dossier, pitch);
    const deck = generateV2DeckSpec({ topic: base.topic, deckLengthMain: 30, audienceLevel: "PHYSICIAN_LEVEL" });
    deck.slides[0]!.authoring_provenance = "agent_authored";
    deck.slides[0]!.medical_payload.dossier_citations = [{ citation_id: "CIT-KB-IMG-01", claim: "Wrong citation" }];
    deck.slides[0]!.speaker_notes.citations = [{ citation_id: "CIT-KB-IMG-01", claim: "Wrong citation" }];
    const differential = generateDifferentialCast(deck, dossier, truth);
    const clueGraph = generateClueGraph(deck, dossier, differential);

    const qa = {
      schema_version: "1.0.0",
      lint_pass: false,
      lint_errors: [],
      grader_scores: [],
      accept: false,
      required_fixes: [
        {
          fix_id: "FIX-CITE",
          type: "medical_correction" as const,
          priority: "must" as const,
          description:
            "Replace the citation with one that supports rusty sputum as a pneumococcal clue. Use CIT-KB-PATHOGENS-SP-01 and/or CIT-KB-MICRO-01.",
          targets: [deck.slides[0]!.slide_id]
        }
      ],
      summary: "needs citation retarget",
      citations_used: [{ citation_id: "CIT-KB-PATHOGENS-SP-01", claim: "Rust-colored sputum clue." }]
    };

    const patched = applyTargetedQaPatches({
      deckSpec: deck,
      clueGraph,
      differentialCast: differential,
      qaReport: qa,
      loopIndex: 1,
      dossier
    });

    expect(patched.deck.slides[0]!.medical_payload.dossier_citations.map((citation) => citation.citation_id)).toContain("CIT-KB-PATHOGENS-SP-01");
    expect(patched.deck.slides[0]!.speaker_notes.citations.map((citation) => citation.citation_id)).toContain("CIT-KB-PATHOGENS-SP-01");
    expect(patched.deck.slides[0]!.authoring_provenance).toBe("agent_authored");
  });

  it("builds lint-driven required fixes across error-code branches and dedupes duplicates", () => {
    const base = {
      topic: "Pulmonary embolism",
      audienceLevel: "COLLEGE_LEVEL" as const,
      deckLengthMain: 30 as const,
      kbContext: "## Medical / Clinical KB\n- source notes"
    };
    const dossier = generateDiseaseDossier(base);
    const pitch = generateEpisodePitch(base, dossier);
    const truth = generateTruthModel(base, dossier, pitch);
    const deck = generateV2DeckSpec({ topic: base.topic, deckLengthMain: 30, audienceLevel: "COLLEGE_LEVEL" });
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
      deckLengthConstraintEnabled: true,
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
      clueGraph,
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
      audienceLevel: "PHYSICIAN_LEVEL" as const,
      deckLengthMain: 30 as const,
      kbContext: "## Medical / Clinical KB\n- source notes"
    };
    const dossier = generateDiseaseDossier(base);
    const pitch = generateEpisodePitch(base, dossier);
    const truth = generateTruthModel(base, dossier, pitch);
    const deck = generateV2DeckSpec({ topic: base.topic, deckLengthMain: 30, audienceLevel: "PHYSICIAN_LEVEL" });
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

    expect(patched.patchNotes.some((note) => note.includes("deferred for structural regeneration (add_twist_receipts)"))).toBe(true);
    expect(patched.patchNotes.some((note) => note.includes("deferred for structural regeneration (other)"))).toBe(false);
    expect(patched.deck.slides[0]!.speaker_notes.medical_reasoning).not.toContain("Correction note");
    expect(patched.deck.slides[0]!.medical_payload.major_concept_id).toBe("MC-PATCH-S01");
    if (patched.clueGraph.twist_support_matrix[0]) {
      expect(patched.clueGraph.twist_support_matrix[0]!.supporting_clue_ids.length).toBe(1);
    }
  });

  it("retargets dossier citations and softens unsupported medical claims from med-factcheck issues", () => {
    const base = {
      topic: "Pneumococcal pneumonia",
      audienceLevel: "COLLEGE_LEVEL" as const,
      deckLengthMain: 30 as const,
      kbContext: "## Medical / Clinical KB\n- source notes"
    };
    const dossier = generateDiseaseDossier(base);
    dossier.citations.push({
      citation_id: "CIT-DX-04",
      claim: "Pneumococcal antigen detection can supplement CAP microbiology workup when appropriate.",
      locator: "Microbiology workup"
    });
    dossier.citations.push({
      citation_id: "CIT-TX-01",
      claim: "Use oxygen targets with COPD caveats and monitoring.",
      locator: "Oxygen support"
    });
    const pitch = generateEpisodePitch(base, dossier);
    const truth = generateTruthModel(base, dossier, pitch);
    const deck = generateV2DeckSpec({ topic: base.topic, deckLengthMain: 30, audienceLevel: "COLLEGE_LEVEL" });
    const differential = generateDifferentialCast(deck, dossier, truth);
    const clueGraph = generateClueGraph(deck, dossier, differential);
    const slide = deck.slides[0]!;
    slide.on_slide_text.subtitle = "Cultures/antigen now. No exceptions.";
    slide.speaker_notes.medical_reasoning =
      "SaO2 <93% or severe features should trigger ABG and closer evaluation; disposition still depends on overall severity and trajectory.";
    slide.medical_payload.dossier_citations = [{ citation_id: "CIT-WRONG-01", claim: "Wrong citation" }];
    slide.speaker_notes.citations = [{ citation_id: "CIT-WRONG-01", claim: "Wrong citation" }];

    const qa = {
      schema_version: "1.0.0",
      lint_pass: false,
      lint_errors: [],
      grader_scores: [],
      accept: false,
      required_fixes: [
        {
          fix_id: "FIX-MED-TRACE",
          type: "medical_correction" as const,
          priority: "must" as const,
          description: "Replace unsupported oxygen/antigen claims with dossier-grounded wording.",
          targets: [slide.slide_id]
        }
      ],
      summary: "needs medical traceability cleanup",
      citations_used: [{ citation_id: "CIT-DX-04", claim: "Antigen corroboration." }]
    };

    const medFactcheckReport = {
      schema_version: "1.0",
      pass: false,
      issues: [
        {
          issue_id: "ISS-ANTIGEN",
          severity: "critical" as const,
          type: "unsupported_inference" as const,
          claim: `Slide ${slide.slide_id}: ordering pneumococcal antigen testing without the correct dossier citation.`,
          why_wrong: "Antigen ordering requires the correct dossier citation.",
          suggested_fix: "Use antigen only when appropriate and cite CIT-DX-04.",
          supporting_citations: [{ citation_id: "CIT-DX-04", claim: "Antigen corroboration.", locator: "Microbiology workup" }]
        },
        {
          issue_id: "ISS-O2",
          severity: "critical" as const,
          type: "incorrect_fact" as const,
          claim: `Slide ${slide.slide_id}: SaO2 <93% or severe features should trigger ABG and closer evaluation.`,
          why_wrong: "That ABG threshold is not dossier-supported.",
          suggested_fix: "Use oxygen targets with COPD caveats and monitoring.",
          supporting_citations: [{ citation_id: "CIT-TX-01", claim: "Use oxygen targets with COPD caveats and monitoring.", locator: "Oxygen support" }]
        }
      ],
      summary: "traceability issues",
      required_fixes: qa.required_fixes
    };

    const patched = applyTargetedQaPatches({
      deckSpec: deck,
      clueGraph,
      differentialCast: differential,
      qaReport: qa,
      loopIndex: 1,
      dossier,
      medFactcheckReport
    });

    expect(patched.deck.slides[0]!.speaker_notes.medical_reasoning).not.toMatch(/ABG|<93%/i);
    expect(patched.deck.slides[0]!.on_slide_text.subtitle).toMatch(/Antigen only when appropriate/i);
    expect(patched.deck.slides[0]!.medical_payload.dossier_citations.map((citation) => citation.citation_id)).toEqual(
      expect.arrayContaining(["CIT-DX-04", "CIT-TX-01"])
    );
  });

  it("routes false-theory, midpoint, and escalation lint failures into structural regeneration fixes", () => {
    const base = {
      topic: "Pneumonia",
      audienceLevel: "COLLEGE_LEVEL" as const,
      deckLengthMain: 30 as const,
      kbContext: "## Medical / Clinical KB\n- source notes"
    };
    const dossier = generateDiseaseDossier(base);
    const pitch = generateEpisodePitch(base, dossier);
    const truth = generateTruthModel(base, dossier, pitch);
    const deck = generateV2DeckSpec({ topic: base.topic, deckLengthMain: 30, audienceLevel: "COLLEGE_LEVEL" });
    const differential = generateDifferentialCast(deck, dossier, truth);
    const clueGraph = generateClueGraph(deck, dossier, differential);
    const reader = generateReaderSimReport(deck, truth, clueGraph);
    const med = generateMedFactcheckReport(deck, dossier);

    const lint = {
      workflow: "v2_micro_detectives" as const,
      deckLengthConstraintEnabled: true,
      expectedDeckLengthMain: 30 as const,
      measuredDeckLengthMain: 30,
      storyForwardRatio: 1,
      storyForwardTargetRatio: 0.7,
      pass: false,
      errorCount: 3,
      warningCount: 0,
      errors: [
        { code: "FALSE_THEORY_COLLAPSE_SIGNAL_WEAK", message: "False theory collapse is weak.", severity: "error" as const },
        { code: "MIDPOINT_COLLAPSE_SIGNAL_WEAK", message: "Midpoint collapse is weak.", severity: "error" as const },
        { code: "ACT_ESCALATION_CHANNELS_WEAK", message: "Pressure channels do not escalate enough.", severity: "error" as const }
      ]
    };

    const qa = buildCombinedQaReport({
      lintReport: lint,
      readerSimReport: reader,
      medFactcheckReport: med,
      clueGraph,
      deckSpec: deck
    });

    const structuralFixes = qa.required_fixes.filter((fix) => fix.type === "regenerate_section");
    expect(structuralFixes.length).toBeGreaterThanOrEqual(3);
    expect(
      structuralFixes.some((fix) => /false theory collapse/i.test(fix.description))
    ).toBe(true);
    expect(
      structuralFixes.some((fix) => /midpoint collapse/i.test(fix.description))
    ).toBe(true);
    expect(
      structuralFixes.some((fix) => /pressure channels/i.test(fix.description))
    ).toBe(true);
    expect(structuralFixes.every((fix) => (fix.targets ?? []).some((target) => /^S\d{2,3}$/.test(target)))).toBe(true);
  });

  it("rejects QA acceptance when red herrings lack payoff or twists miss receipts", () => {
    const base = {
      topic: "Myocarditis",
      audienceLevel: "COLLEGE_LEVEL" as const,
      deckLengthMain: 30 as const,
      kbContext: "## Medical / Clinical KB\n- source notes"
    };
    const dossier = generateDiseaseDossier(base);
    const pitch = generateEpisodePitch(base, dossier);
    const truth = generateTruthModel(base, dossier, pitch);
    const deck = generateV2DeckSpec({ topic: base.topic, deckLengthMain: 30, audienceLevel: "COLLEGE_LEVEL" });
    const differential = generateDifferentialCast(deck, dossier, truth);
    const clueGraph = generateClueGraph(deck, dossier, differential);
    const reader = generateReaderSimReport(deck, truth, clueGraph);
    const med = generateMedFactcheckReport(deck, dossier);
    const lint = lintDeckSpecPhase1(deck, 30);

    clueGraph.red_herrings[0]!.payoff_slide_id = "S99";
    clueGraph.twist_support_matrix[0]!.supporting_clue_ids = [clueGraph.clues[0]!.clue_id];
    clueGraph.twist_support_matrix[0]!.recontextualized_slide_ids = [deck.slides[0]!.slide_id];

    const qa = buildCombinedQaReport({
      lintReport: lint,
      readerSimReport: reader,
      medFactcheckReport: med,
      clueGraph,
      deckSpec: deck
    });

    expect(qa.accept).toBe(false);
    expect(qa.lint_errors.some((err) => err.code === "RED_HERRING_PAYOFF_MISSING")).toBe(true);
    expect(qa.lint_errors.some((err) => err.code === "TWIST_RECEIPTS_INSUFFICIENT")).toBe(true);
    expect(qa.required_fixes.some((fix) => fix.type === "add_twist_receipts")).toBe(true);
  });

  it("flags twists that lack Act I setup clues when require_act1_setup is enabled", () => {
    const base = {
      topic: "Aortic stenosis",
      audienceLevel: "COLLEGE_LEVEL" as const,
      deckLengthMain: 30 as const,
      kbContext: "## Medical / Clinical KB\n- source notes"
    };
    const dossier = generateDiseaseDossier(base);
    const pitch = generateEpisodePitch(base, dossier);
    const truth = generateTruthModel(base, dossier, pitch);
    const deck = generateV2DeckSpec({ topic: base.topic, deckLengthMain: 30, audienceLevel: "COLLEGE_LEVEL" });
    const differential = generateDifferentialCast(deck, dossier, truth);
    const clueGraph = generateClueGraph(deck, dossier, differential);
    const reader = generateReaderSimReport(deck, truth, clueGraph);
    const med = generateMedFactcheckReport(deck, dossier);
    const lint = lintDeckSpecPhase1(deck, 30);

    const act2SlideId = deck.slides.find((slide) => slide.act_id === "ACT2")?.slide_id ?? deck.slides[0]!.slide_id;
    clueGraph.constraints.require_act1_setup = true;
    for (const clue of clueGraph.clues.slice(0, 3)) {
      clue.first_seen_slide_id = act2SlideId;
    }

    clueGraph.twist_support_matrix[0]!.supporting_clue_ids = clueGraph.clues.slice(0, 3).map((clue) => clue.clue_id);
    clueGraph.twist_support_matrix[0]!.recontextualized_slide_ids = deck.slides.slice(0, 2).map((slide) => slide.slide_id);

    const qa = buildCombinedQaReport({
      lintReport: lint,
      readerSimReport: reader,
      medFactcheckReport: med,
      clueGraph,
      deckSpec: deck
    });

    expect(qa.accept).toBe(false);
    expect(qa.lint_errors.some((err) => err.code === "TWIST_ACT1_SETUP_MISSING")).toBe(true);
    expect(qa.required_fixes.some((fix) => fix.fix_id.startsWith("TW-ACT1-"))).toBe(true);
  });

  it("flags red herrings when payoff slide id is blank", () => {
    const base = {
      topic: "Diabetic ketoacidosis",
      audienceLevel: "COLLEGE_LEVEL" as const,
      deckLengthMain: 30 as const,
      kbContext: "## Medical / Clinical KB\n- source notes"
    };
    const dossier = generateDiseaseDossier(base);
    const pitch = generateEpisodePitch(base, dossier);
    const truth = generateTruthModel(base, dossier, pitch);
    const deck = generateV2DeckSpec({ topic: base.topic, deckLengthMain: 30, audienceLevel: "COLLEGE_LEVEL" });
    const differential = generateDifferentialCast(deck, dossier, truth);
    const clueGraph = generateClueGraph(deck, dossier, differential);
    const reader = generateReaderSimReport(deck, truth, clueGraph);
    const med = generateMedFactcheckReport(deck, dossier);
    const lint = lintDeckSpecPhase1(deck, 30);

    clueGraph.red_herrings[0]!.payoff_slide_id = "";

    const qa = buildCombinedQaReport({
      lintReport: lint,
      readerSimReport: reader,
      medFactcheckReport: med,
      clueGraph,
      deckSpec: deck
    });

    expect(qa.accept).toBe(false);
    expect(qa.lint_errors.some((err) => err.code === "RED_HERRING_PAYOFF_MISSING")).toBe(true);
    expect(qa.required_fixes.some((fix) => fix.fix_id.startsWith("RH-PAYOFF-"))).toBe(true);
  });

  it("uses clue first-seen slide as twist focus fallback when payoff is invalid", () => {
    const base = {
      topic: "Interstitial lung disease",
      audienceLevel: "COLLEGE_LEVEL" as const,
      deckLengthMain: 30 as const,
      kbContext: "## Medical / Clinical KB\n- source notes"
    };
    const dossier = generateDiseaseDossier(base);
    const pitch = generateEpisodePitch(base, dossier);
    const truth = generateTruthModel(base, dossier, pitch);
    const deck = generateV2DeckSpec({ topic: base.topic, deckLengthMain: 30, audienceLevel: "COLLEGE_LEVEL" });
    const differential = generateDifferentialCast(deck, dossier, truth);
    const clueGraph = generateClueGraph(deck, dossier, differential);
    const reader = generateReaderSimReport(deck, truth, clueGraph);
    const med = generateMedFactcheckReport(deck, dossier);
    const lint = lintDeckSpecPhase1(deck, 30);

    const focusClue = clueGraph.clues[0]!;
    focusClue.payoff_slide_id = "S-INVALID";
    clueGraph.twist_support_matrix[0]!.supporting_clue_ids = [focusClue.clue_id];
    clueGraph.twist_support_matrix[0]!.recontextualized_slide_ids = [];

    const qa = buildCombinedQaReport({
      lintReport: lint,
      readerSimReport: reader,
      medFactcheckReport: med,
      clueGraph,
      deckSpec: deck
    });

    const twistReceiptError = qa.lint_errors.find((err) => err.code === "TWIST_RECEIPTS_INSUFFICIENT");
    expect(twistReceiptError?.slide_id).toBe(focusClue.first_seen_slide_id);
  });

  it("adds narrative required fixes when false-theory collapse and callback signals are stripped", () => {
    const base = {
      topic: "Anemia",
      audienceLevel: "COLLEGE_LEVEL" as const,
      deckLengthMain: 30 as const,
      kbContext: "## Medical / Clinical KB\n- source notes"
    };
    const dossier = generateDiseaseDossier(base);
    const pitch = generateEpisodePitch(base, dossier);
    const truth = generateTruthModel(base, dossier, pitch);
    const deck = generateV2DeckSpec({ topic: base.topic, deckLengthMain: 30, audienceLevel: "COLLEGE_LEVEL" });
    const differential = generateDifferentialCast(deck, dossier, truth);
    const clueGraph = generateClueGraph(deck, dossier, differential);
    const reader = generateReaderSimReport(deck, truth, clueGraph);
    const med = generateMedFactcheckReport(deck, dossier);
    const lint = lintDeckSpecPhase1(deck, 30);

    deck.slides = deck.slides.map((slide, idx) => {
      if (
        slide.beat_type === "false_theory_collapse" ||
        slide.beat_type === "false_theory_lock_in" ||
        slide.beat_type === "showdown" ||
        slide.beat_type === "proof" ||
        slide.beat_type === "aftermath"
      ) {
        return { ...slide, beat_type: "clue_discovery", title: `Clue Slide ${idx + 1}`, hook: "Incremental update." };
      }
      return slide;
    });

    const qa = buildCombinedQaReport({
      lintReport: lint,
      readerSimReport: reader,
      medFactcheckReport: med,
      clueGraph,
      deckSpec: deck
    });

    expect(qa.required_fixes.some((fix) => fix.fix_id === "NAR-FALSE-THEORY-COLLAPSE")).toBe(true);
    expect(qa.required_fixes.some((fix) => fix.fix_id === "NAR-ENDING-CALLBACK")).toBe(true);
  });

  it("uses higher story-dominance intervention threshold in quality profile", () => {
    const base = {
      topic: "Heart block",
      audienceLevel: "COLLEGE_LEVEL" as const,
      deckLengthMain: 30 as const,
      kbContext: "## Medical / Clinical KB\n- source notes"
    };
    const dossier = generateDiseaseDossier(base);
    const pitch = generateEpisodePitch(base, dossier);
    const truth = generateTruthModel(base, dossier, pitch);
    const deck = generateV2DeckSpec({ topic: base.topic, deckLengthMain: 30, audienceLevel: "COLLEGE_LEVEL" });
    const differential = generateDifferentialCast(deck, dossier, truth);
    const clueGraph = generateClueGraph(deck, dossier, differential);
    const reader = generateReaderSimReport(deck, truth, clueGraph);
    const med = generateMedFactcheckReport(deck, dossier);
    const lint = lintDeckSpecPhase1(deck, 30);
    reader.overall_story_dominance_score_0_to_5 = 3.5;
    reader.required_fixes = [];

    const qualityQa = buildCombinedQaReport({
      lintReport: lint,
      readerSimReport: reader,
      medFactcheckReport: med,
      clueGraph,
      deckSpec: deck,
      generationProfile: "quality"
    });
    const pilotQa = buildCombinedQaReport({
      lintReport: lint,
      readerSimReport: reader,
      medFactcheckReport: med,
      clueGraph,
      deckSpec: deck,
      generationProfile: "pilot"
    });

    expect(qualityQa.required_fixes.some((fix) => fix.fix_id === "NAR-READER-STORY-DOMINANCE")).toBe(true);
    expect(pilotQa.required_fixes.some((fix) => fix.fix_id === "NAR-READER-STORY-DOMINANCE")).toBe(false);
  });
});
