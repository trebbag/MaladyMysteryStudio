import { describe, expect, it } from "vitest";
import {
  applyMedicalDepthGuardToQa,
  buildMedicalStoryTraceabilityReport,
  evaluateMedicalDepth
} from "../src/pipeline/qa_depth_traceability.js";

function chapterWithCount(count: number) {
  const entry = {
    concept: "concept",
    clinically_relevant_detail: "detail",
    why_it_matters_for_pcp: "matters",
    citations: ["https://example.com"],
    confidence: 0.9
  };
  const arr = Array.from({ length: count }, () => entry);
  return {
    normal_physiology: arr,
    pathophysiology: arr,
    epidemiology_risk: arr,
    clinical_presentation: arr,
    diagnosis_workup: arr,
    differential: arr,
    treatment_acute: arr,
    treatment_long_term: arr,
    prognosis_complications: arr,
    patient_counseling_prevention: arr
  };
}

describe("pipeline/qa_depth_traceability", () => {
  it("fails depth report in strict PCP mode when section counts are below fail threshold", () => {
    const report = evaluateMedicalDepth(chapterWithCount(2), {
      level: "pcp",
      mode: "strict",
      checkedAt: "2026-02-12T00:00:00.000Z"
    });
    expect(report.status).toBe("fail");
    expect(report.failures.length).toBeGreaterThan(0);
  });

  it("downgrades depth report to warn in warn mode even when fail thresholds are missed", () => {
    const report = evaluateMedicalDepth(chapterWithCount(2), {
      level: "pcp",
      mode: "warn",
      checkedAt: "2026-02-12T00:00:00.000Z"
    });
    expect(report.status).toBe("warn");
    expect(report.failures.length).toBeGreaterThan(0);
  });

  it("forces QA fail and adds section patches when depth report is fail", () => {
    const depth = evaluateMedicalDepth(chapterWithCount(2), {
      level: "pcp",
      mode: "strict",
      checkedAt: "2026-02-12T00:00:00.000Z"
    });
    const qa = applyMedicalDepthGuardToQa(
      { pass: true, patch_list: [], notes: ["baseline"] },
      depth
    );
    expect(qa.pass).toBe(false);
    expect(qa.patch_list.length).toBeGreaterThan(0);
    expect(qa.notes.join(" ")).toContain("Medical depth failures");
  });

  it("builds traceability report with covered stages and plot events when slides include anchors", () => {
    const sectionCoverage = [
      "normal_physiology",
      "pathophysiology",
      "epidemiology_risk",
      "clinical_presentation",
      "diagnosis_workup",
      "differential",
      "treatment_acute",
      "treatment_long_term",
      "prognosis_complications",
      "patient_counseling_prevention"
    ].map((section) => ({
      section,
      medical_takeaways: ["teaching anchor"],
      narrative_translation: "mystery translation",
      story_function: "story spine continuity",
      stage_name_suggestion: `${section} checkpoint`
    }));

    const report = buildMedicalStoryTraceabilityReport({
      createdAt: "2026-02-12T00:00:00.000Z",
      narrativeFlow: {
        chapter_summary: "baseline to intervention",
        progression: [
          {
            stage: "Baseline physiology",
            medical_logic: "normal state before pathology",
            key_teaching_points: ["normal state", "early deviation signals"],
            story_implication: "peace before disruption"
          }
        ],
        section_coverage: sectionCoverage,
        metaphor_map: [
          {
            medical_element: "pathology",
            mystery_expression: "criminal sabotage",
            pedagogy_reason: "causal mapping"
          }
        ],
        required_plot_events: ["evidence checkpoint"]
      },
      finalPatched: {
        title: "deck",
        reusable_visual_primer: {
          character_descriptions: ["Dr. Ada"],
          recurring_scene_descriptions: ["HQ"],
          reusable_visual_elements: ["evidence board"],
          continuity_rules: ["keep style"]
        },
        story_arc_contract: {
          intro_slide_ids: ["S1", "S2", "S3"],
          outro_slide_ids: ["S4", "S5"],
          entry_to_body_slide_id: "S3",
          return_to_office_slide_id: "S4",
          callback_slide_id: "S5"
        },
        slides: [
          {
            slide_id: "S1",
            title: "Baseline physiology",
            slide_mode: "hybrid",
            medical_visual_mode: "dual_hud_panels",
            narrative_phase: "intro",
            content_md: "normal state and early deviation signals",
            speaker_notes: "normal state",
            hud_panel_bullets: ["early deviation signals"],
            location_description: "HQ",
            evidence_visual_description: "evidence checkpoint board",
            character_staging: "Dr. Ada points at board",
            scene_description: "Detailed medical scene",
            used_assets: ["evidence board"],
            used_characters: ["Dr. Ada"],
            story_and_dialogue: "The team reaches an evidence checkpoint."
          }
        ],
        sources: ["https://example.com"]
      }
    });

    expect(report.stage_traces[0]?.status).not.toBe("missing");
    expect(report.plot_event_traces[0]?.matched).toBe(true);
    expect(["pass", "warn"]).toContain(report.summary.status);
  });
});
