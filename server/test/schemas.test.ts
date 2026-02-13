import { describe, expect, it } from "vitest";
import { MEDICAL_NARRATIVE_SECTIONS, MedicalNarrativeFlowOutputSchema } from "../src/pipeline/schemas.js";

function makeSectionCoverage() {
  return MEDICAL_NARRATIVE_SECTIONS.map((section) => ({
    section,
    medical_takeaways: [`takeaway for ${section}`],
    narrative_translation: `translation for ${section}`,
    story_function: `story function for ${section}`,
    stage_name_suggestion: `${section} checkpoint`
  }));
}

describe("pipeline/schemas", () => {
  it("accepts medical narrative flow when all required section coverage entries are present", () => {
    const parsed = MedicalNarrativeFlowOutputSchema.safeParse({
      medical_narrative_flow: {
        chapter_summary: "summary",
        progression: [
          {
            stage: "baseline",
            medical_logic: "logic",
            key_teaching_points: ["point"],
            story_implication: "implication"
          }
        ],
        section_coverage: makeSectionCoverage(),
        metaphor_map: [
          {
            medical_element: "element",
            mystery_expression: "expression",
            pedagogy_reason: "reason"
          }
        ],
        required_plot_events: ["event"]
      }
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects medical narrative flow when a required section coverage entry is missing", () => {
    const missing = "differential";
    const parsed = MedicalNarrativeFlowOutputSchema.safeParse({
      medical_narrative_flow: {
        chapter_summary: "summary",
        progression: [
          {
            stage: "baseline",
            medical_logic: "logic",
            key_teaching_points: ["point"],
            story_implication: "implication"
          }
        ],
        section_coverage: makeSectionCoverage().filter((row) => row.section !== missing),
        metaphor_map: [
          {
            medical_element: "element",
            mystery_expression: "expression",
            pedagogy_reason: "reason"
          }
        ],
        required_plot_events: ["event"]
      }
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.some((issue) => issue.message.includes(`Missing section coverage entry for "${missing}"`))).toBe(true);
  });
});
