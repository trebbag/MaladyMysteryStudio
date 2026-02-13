import { describe, expect, it } from "vitest";
import { evaluateConstraintAdherence, summarizeConstraintAdherence } from "../src/pipeline/constraint_checks.js";

function baseInput() {
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
      slides: [
        {
          slide_id: "S1",
          title: "s1",
          content_md: "teal scene",
          speaker_notes: "notes",
          hud_panel_bullets: ["bullet"],
          location_description: "HQ",
          evidence_visual_description: "scanner overlay",
          character_staging: "Dr. Nova at console",
          story_and_dialogue: "Dialogue beat"
        }
      ],
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

  it("summarizes report counts", () => {
    const report = evaluateConstraintAdherence(baseInput());
    const summary = summarizeConstraintAdherence(report);
    expect(summary.status).toBe("pass");
    expect(summary.failureCount).toBe(0);
  });
});
