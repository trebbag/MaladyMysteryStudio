import { describe, expect, it } from "vitest";
import {
  evaluateConstraintAdherence,
  summarizeConstraintAdherence,
  type ConstraintCheckInput
} from "../src/pipeline/constraint_checks.js";

type SlidePhase = "intro" | "body" | "outro";

type SlideSpec = ConstraintCheckInput["finalPatched"]["slides"][number];

function mkSlide(slide_id: string, phase: SlidePhase, overrides?: Partial<SlideSpec>): SlideSpec {
  const base: SlideSpec = {
    slide_id,
    title: slide_id.toLowerCase(),
    slide_mode: "hybrid",
    medical_visual_mode: "dual_hud_panels",
    narrative_phase: phase,
    content_md: "teal scene",
    speaker_notes: `notes ${slide_id}`,
    hud_panel_bullets: ["bullet"],
    location_description: "HQ",
    evidence_visual_description: "scanner overlay",
    character_staging: "Dr. Nova at console",
    scene_description: "Detailed scene description",
    used_assets: ["anomaly scanner motif"],
    used_characters: ["Dr. Nova"],
    story_and_dialogue: "Dialogue beat"
  };
  return { ...base, ...(overrides ?? {}) };
}

function baseInput(): ConstraintCheckInput {
  const slides: SlideSpec[] = [
    mkSlide("S1", "intro"),
    mkSlide("S2", "intro", {
      medical_visual_mode: "in_scene_annotated_visual",
      content_md: "teal scene 2",
      speaker_notes: "notes 2",
      hud_panel_bullets: ["bullet 2"],
      location_description: "HQ2",
      evidence_visual_description: "in-scene labels",
      character_staging: "Dr. Nova and Nurse Kepler",
      scene_description: "Detailed scene description 2",
      used_characters: ["Nurse Kepler"],
      story_and_dialogue: "Dialogue beat 2"
    }),
    mkSlide("S3", "intro", {
      content_md: "teal scene 3",
      speaker_notes: "notes 3",
      hud_panel_bullets: ["bullet 3"],
      location_description: "HQ3",
      evidence_visual_description: "hud panel visual",
      character_staging: "Dr. Nova guiding transition",
      scene_description: "Detailed scene description 3",
      story_and_dialogue: "Dialogue beat 3"
    })
  ];

  for (let n = 4; n <= 38; n++) {
    slides.push(
      mkSlide(`S${n}`, "body", {
        content_md: `teal body scene ${n}`,
        speaker_notes: `notes ${n}`,
        hud_panel_bullets: [`bullet ${n}`],
        location_description: `Body zone ${n}`,
        evidence_visual_description: `evidence ${n}`,
        character_staging: `Dr. Nova investigates ${n}`,
        scene_description: `Detailed body scene description ${n}`
      })
    );
  }

  slides.push(
    mkSlide("S39", "outro", {
      content_md: "teal scene 39",
      speaker_notes: "notes 39",
      hud_panel_bullets: ["bullet 39"],
      location_description: "Office",
      evidence_visual_description: "closing visual",
      character_staging: "Team returns",
      scene_description: "Detailed scene description 39",
      used_characters: ["Dr. Nova", "Nurse Kepler"],
      story_and_dialogue: "Dialogue beat 39"
    })
  );

  slides.push(
    mkSlide("S40", "outro", {
      slide_mode: "story_transition",
      medical_visual_mode: "in_scene_annotated_visual",
      content_md: "teal scene 40",
      speaker_notes: "notes 40",
      hud_panel_bullets: [],
      location_description: "Office",
      evidence_visual_description: "callback visual",
      character_staging: "Team celebrates",
      scene_description: "Detailed scene description 40",
      used_characters: ["Dr. Nova", "Nurse Kepler"],
      story_and_dialogue: "Dialogue beat 40"
    })
  );

  return {
    canonical: {
      foundAny: true,
      paths: {
        templateRoot: "/repo/data/canon",
        characterBiblePath: "/repo/data/canon/character_bible.md",
        seriesStyleBiblePath: "/repo/data/canon/series_style_bible.md",
        deckSpecPath: "/repo/data/canon/episode/deck_spec.md"
      },
      character_bible_md: "## Dr. Nova\nName: Nurse Kepler\n",
      series_style_bible_md: "- must keep teal lighting and wide framing\n- do not use gore closeups\n",
      deck_spec_md: "- required: use anomaly scanner motif\n",
      combined_markdown: "",
      story_context_markdown: "",
      visual_context_markdown: ""
    },
    storyBible: {
      premise: "p",
      rules: ["r"],
      recurring_motifs: ["m"],
      cast: [
        { name: "Dr. Nova", role: "lead", bio: "b", traits: ["x"], constraints: ["c"] },
        { name: "Nurse Kepler", role: "support", bio: "b", traits: ["x"], constraints: ["c"] }
      ],
      story_constraints_used: ["s"],
      visual_constraints_used: ["v"]
    },
    beatSheet: [{ beat: "b", purpose: "p", characters: ["Dr. Nova"], setting: "ED" }],
    shotList: [{ shot_id: "S1", moment: "m", framing: "wide", visual_notes: "teal lighting with anomaly scanner" }],
    finalPatched: {
      title: "t",
      reusable_visual_primer: {
        character_descriptions: ["Dr. Nova profile"],
        recurring_scene_descriptions: ["Immune district HQ"],
        reusable_visual_elements: ["anomaly scanner motif"],
        continuity_rules: ["keep styling stable"]
      },
      story_arc_contract: {
        intro_slide_ids: ["S1", "S2", "S3"],
        outro_slide_ids: ["S39", "S40"],
        entry_to_body_slide_id: "S3",
        return_to_office_slide_id: "S39",
        callback_slide_id: "S40"
      },
      slides,
      sources: ["src"]
    },
    semanticSimilarity: null,
    checkedAt: "2026-02-11T00:00:00.000Z"
  };
}

describe("pipeline/constraint_checks", () => {
  it("passes when canonical characters and style markers are present", () => {
    const report = evaluateConstraintAdherence(baseInput());
    expect(report.status).toBe("pass");
    expect(report.failures).toHaveLength(0);
    expect(report.details.matched_story_characters.length).toBeGreaterThan(0);
  });

  it("warns when story_arc_contract beat anchors point at non-intro/outro slide phases", () => {
    const input = baseInput();
    const updated = structuredClone(input.finalPatched);
    updated.story_arc_contract = {
      ...updated.story_arc_contract,
      intro_slide_ids: ["S1", "S2", "S3", "S10"],
      outro_slide_ids: ["S39", "S40", "S20", "S21"],
      entry_to_body_slide_id: "S10",
      return_to_office_slide_id: "S20",
      callback_slide_id: "S21"
    };

    const report = evaluateConstraintAdherence({ ...input, finalPatched: updated });
    expect(report.status).toBe("warn");
    expect(report.warnings.join(" ")).toContain("entry_to_body_slide_id should be an intro slide");
    expect(report.warnings.join(" ")).toContain("return_to_office_slide_id should be an outro slide");
    expect(report.warnings.join(" ")).toContain("callback_slide_id should be an outro slide");
  });

  it("fails when canonical characters are not reused", () => {
    const input = baseInput();
    const report = evaluateConstraintAdherence({
      ...input,
      storyBible: {
        ...input.storyBible,
        cast: [{ name: "Completely New Character", role: "lead", bio: "b", traits: ["x"], constraints: ["c"] }]
      },
      beatSheet: [{ beat: "b", purpose: "p", characters: ["New Person"], setting: "ED" }]
    });
    expect(report.status).toBe("fail");
    expect(report.failures.join(" ")).toContain("No canonical character");
  });

  it("warns when forbidden style markers appear", () => {
    const input = baseInput();
    const report = evaluateConstraintAdherence({
      ...input,
      shotList: [{ shot_id: "S1", moment: "m", framing: "closeup", visual_notes: "gore closeups with blood" }]
    });
    expect(report.status).toBe("warn");
    expect(report.warnings.join(" ")).toContain("forbidden-style");
  });

  it("does not fail when forbidden-rule language is restated as policy guidance", () => {
    const input = baseInput();
    const report = evaluateConstraintAdherence({
      ...input,
      canonical: {
        ...input.canonical,
        series_style_bible_md: "- avoid gore; keep educational and approachable"
      },
      shotList: [{ shot_id: "S1", moment: "m", framing: "wide", visual_notes: "Avoid gore and keep educational tone." }]
    });
    expect(report.failures.join(" ")).not.toContain("forbidden-style");
  });

  it("warns or fails based on semantic similarity level", () => {
    const warn = evaluateConstraintAdherence({
      ...baseInput(),
      semanticSimilarity: {
        closest: { runId: "prev", fingerprint: "x", score: 0.85 },
        threshold: 0.82,
        retried: true
      }
    });
    expect(warn.status).toBe("warn");

    const fail = evaluateConstraintAdherence({
      ...baseInput(),
      semanticSimilarity: {
        closest: { runId: "prev", fingerprint: "x", score: 0.95 },
        threshold: 0.82,
        retried: true
      }
    });
    expect(fail.status).toBe("fail");
  });

  it("warns when only a small fraction of canonical characters are reused", () => {
    const input = baseInput();
    const report = evaluateConstraintAdherence({
      ...input,
      canonical: {
        ...input.canonical,
        character_bible_md: "## Dr. Nova\n## Nurse Kepler\n## Dr. Orion\n## Tech Sol\n## Medic Vale\n"
      },
      storyBible: {
        ...input.storyBible,
        cast: [{ name: "Dr. Nova", role: "lead", bio: "b", traits: ["x"], constraints: ["c"] }]
      },
      beatSheet: [{ beat: "b", purpose: "p", characters: ["Dr. Nova"], setting: "ED" }]
    });
    expect(report.status).toBe("warn");
    expect(report.warnings.join(" ")).toContain("small fraction");
  });

  it("warns when required style rules are present but no style markers are detected", () => {
    const input = baseInput();
    const report = evaluateConstraintAdherence({
      ...input,
      canonical: {
        ...input.canonical,
        series_style_bible_md: "- required ultramarinechroma latticeflux pentalight",
        deck_spec_md: "- baseline"
      },
      shotList: [{ shot_id: "S1", moment: "m", framing: "close", visual_notes: "plain clinical room" }]
    });
    expect(report.status).toBe("warn");
    expect(report.warnings.join(" ")).toContain("style-rule markers");
  });

  it("warns when semantic guard threshold is hit without retry", () => {
    const report = evaluateConstraintAdherence({
      ...baseInput(),
      semanticSimilarity: {
        closest: { runId: "prev", fingerprint: "x", score: 0.86 },
        threshold: 0.82,
        retried: false
      }
    });
    expect(report.status).toBe("warn");
    expect(report.warnings.join(" ")).toContain("did not retry");
  });

  it("fails with detailed violations for hybrid/transition/contract and master-doc failures", () => {
    const input = baseInput();
    const broken = structuredClone(input.finalPatched);

    // Medical-only violation on a hybrid slide (empty HUD bullets).
    broken.slides[0] = {
      ...broken.slides[0],
      slide_mode: "hybrid",
      hud_panel_bullets: [],
      used_assets: ["Unknown Asset"],
      used_characters: ["Unknown Character"]
    };

    // Transition slide with disallowed HUD bullets + missing required fields.
    broken.slides[1] = {
      ...broken.slides[1],
      slide_mode: "story_transition",
      hud_panel_bullets: ["should be empty"],
      location_description: "",
      character_staging: "",
      story_and_dialogue: "",
      used_assets: [],
      used_characters: []
    };

    // Force transition-count failure (> 50% of deck).
    for (let i = 2; i < 23; i++) {
      broken.slides[i] = { ...broken.slides[i], slide_mode: "story_transition", hud_panel_bullets: [] };
    }

    // Force intro/outro sizing violation (>15%).
    broken.slides[10] = { ...broken.slides[10], narrative_phase: "intro" };
    broken.slides[11] = { ...broken.slides[11], narrative_phase: "outro" };

    broken.story_arc_contract = {
      intro_slide_ids: ["S1", "S2"],
      outro_slide_ids: ["S2", "S5"],
      entry_to_body_slide_id: "S99",
      return_to_office_slide_id: "",
      callback_slide_id: ""
    };

    const report = evaluateConstraintAdherence({
      ...input,
      finalPatched: broken,
      masterDocValidation: { status: "fail", errors: ["missing slide block"] },
      semanticSimilarity: {
        closest: { runId: "prior-1", fingerprint: "fp", score: 0.95 },
        threshold: 0.82,
        retried: false
      }
    });

    expect(report.status).toBe("fail");
    expect(report.failures.join(" ")).toContain("Medical-only slide violation");
    expect(report.failures.join(" ")).toContain("Missing required slide field");
    expect(report.failures.join(" ")).toContain("Transition-slide field violation");
    expect(report.failures.join(" ")).toContain("Too many story_transition");
    expect(report.failures.join(" ")).toContain("Intro/outro contract violation");
    expect(report.failures.join(" ")).toContain("intro+outro slides must be <= 15%");
    expect(report.failures.join(" ")).toContain("Master doc validation failed");
    expect(report.failures.join(" ")).toContain("too similar to prior run");
    expect(report.warnings.join(" ")).toContain("assets not in reusable primer");
    expect(report.warnings.join(" ")).toContain("did not retry");
    expect(report.details.slide_mode_counts.story_transition).toBe(23);
    expect(report.details.intro_outro_contract_status.status).toBe("fail");
    expect(report.details.master_doc_validation_status).toBe("fail");
  });

  it("warns when story_transition slides are high but below the failure threshold", () => {
    const input = baseInput();
    const updated = structuredClone(input.finalPatched);
    for (let i = 4; i < 15; i++) {
      updated.slides[i] = { ...updated.slides[i], slide_mode: "story_transition", hud_panel_bullets: [] };
    }

    const report = evaluateConstraintAdherence({ ...input, finalPatched: updated });
    expect(report.status).toBe("warn");
    expect(report.warnings.join(" ")).toContain("High story_transition slide count");
    expect(report.failures).toHaveLength(0);
  });

  it("reports master-doc warn status without hard-failing", () => {
    const report = evaluateConstraintAdherence({
      ...baseInput(),
      masterDocValidation: { status: "warn", errors: ["field order mismatch"] }
    });

    expect(report.status).toBe("warn");
    expect(report.warnings.join(" ")).toContain("Master doc validation warning");
    expect(report.details.master_doc_validation_status).toBe("warn");
  });

  it("summarizes report counts", () => {
    const report = evaluateConstraintAdherence(baseInput());
    const summary = summarizeConstraintAdherence(report);
    expect(summary.status).toBe("pass");
    expect(summary.failureCount).toBe(0);
  });
});
