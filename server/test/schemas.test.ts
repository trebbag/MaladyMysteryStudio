import { describe, expect, it } from "vitest";
import { MEDICAL_NARRATIVE_SECTIONS, MedicalNarrativeFlowOutputSchema } from "../src/pipeline/schemas.js";
import {
  CitationRefSchema,
  DeckSpecSchema,
  MedFactcheckAgentOutputSchema,
  MicroWorldMapAgentOutputSchema,
  MicroWorldMapSchema,
  SlideBlockSchema
} from "../src/pipeline/v2_micro_detectives/schemas.js";

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

  it("accepts optional citation fields as blank strings to match canonical v2 JSON schema", () => {
    const parsed = CitationRefSchema.safeParse({
      citation_id: "CIT-01",
      chunk_id: "",
      locator: "",
      claim: "Supported claim."
    });

    expect(parsed.success).toBe(true);
  });

  it("accepts non-empty slide pressure channel labels in v2 deck specs", () => {
    const parsed = DeckSpecSchema.safeParse({
      deck_meta: {
        schema_version: "1.0.0",
        episode_slug: "test-case",
        episode_title: "Test Case",
        deck_length_main: "unconstrained",
        tone: "thriller",
        audience_level: "PHYSICIAN_LEVEL",
        story_dominance_target_ratio: 0.75,
        max_words_on_slide: 24,
        one_major_med_concept_per_slide: true,
        appendix_unlimited: true
      },
      characters: {
        detective: {
          name: "Pip",
          species_or_origin: "Cell detective",
          voice_style: "dry",
          competency: "pattern recognition",
          blind_spot: "overconfidence"
        },
        deputy: {
          name: "Cyto",
          species_or_origin: "Deputy",
          voice_style: "analytic",
          competency: "evidence tracing",
          blind_spot: "hesitation"
        },
        patient: {
          label: "Patient",
          macro_context: "ED"
        },
        macro_supporting_cast: []
      },
      acts: [
        {
          act_id: "ACT1",
          name: "Act I",
          slide_start: 1,
          slide_end: 1,
          act_goal: "Open the case",
          required_pressure_channels: ["physical", "institutional"]
        }
      ],
      slides: [
        {
          slide_id: "S01",
          act_id: "ACT1",
          beat_type: "cold_open",
          template_id: "T01_COLD_OPEN_MICRO_CRIME_SCENE",
          title: "Cold Open",
          on_slide_text: {
            headline: "Headline",
            callouts: ["Callout"]
          },
          visual_description: "Visual",
          story_panel: {
            goal: "Goal",
            opposition: "Opposition",
            turn: "Turn",
            decision: "Decision"
          },
          medical_payload: {
            major_concept_id: "MC-1",
            delivery_mode: "clue",
            dossier_citations: [
              {
                citation_id: "CIT-1",
                claim: "Claim"
              }
            ]
          },
          pressure_channels_advanced: ["time pressure", "evidence instability"],
          hook: "Hook",
          speaker_notes: {
            medical_reasoning: "Reasoning",
            differential_update: {
              top_dx_ids: ["DX-1"],
              eliminated_dx_ids: [],
              why: "Why"
            },
            citations: [
              {
                citation_id: "CIT-1",
                claim: "Claim"
              }
            ]
          }
        }
      ],
      appendix_slides: []
    });

    expect(parsed.success).toBe(true);
  });

  it("accepts slide blocks without block_summary_out so runtime can backfill deterministic summaries", () => {
    const parsed = SlideBlockSchema.safeParse({
      schema_version: "1.0.0",
      block_id: "ACT1_B01",
      act_id: "ACT1",
      slide_range: { start: 1, end: 8 },
      operations: [
        {
          op: "drop_slide",
          slide_id: "S01"
        }
      ]
    });

    expect(parsed.success).toBe(true);
  });

  it("accepts slide blocks with an empty prior_block_summary so runtime can backfill continuity text", () => {
    const parsed = SlideBlockSchema.safeParse({
      schema_version: "1.0.0",
      block_id: "ACT1_B01",
      act_id: "ACT1",
      slide_range: { start: 1, end: 8 },
      prior_block_summary: "",
      operations: [
        {
          op: "drop_slide",
          slide_id: "S01"
        }
      ]
    });

    expect(parsed.success).toBe(true);
  });

  it("accepts micro-world agent output with empty citation buckets so runtime can backfill them", () => {
    const parsed = MicroWorldMapAgentOutputSchema.safeParse({
      schema_version: "1.0.0",
      episode_slug: "cap-adults",
      primary_organs: ["lung"],
      zones: [
        {
          zone_id: "Z-LUNG-ENTRY",
          name: "Entry",
          anatomic_location: "upper airway",
          citations: []
        }
      ],
      hazards: [
        {
          hazard_id: "HZ-01",
          type: "immune_attack",
          description: "Hazard",
          links_to_pathophysiology: "Inflammation",
          citations: []
        }
      ],
      routes: [
        {
          route_id: "RT-01",
          from_zone_id: "Z-LUNG-ENTRY",
          to_zone_id: "Z-LUNG-ENTRY",
          mode: "airflow",
          citations: []
        }
      ],
      visual_style_guide: {
        citations: []
      }
    });

    expect(parsed.success).toBe(true);
  });

  it("still rejects persisted micro-world artifacts with empty citation buckets", () => {
    const parsed = MicroWorldMapSchema.safeParse({
      schema_version: "1.0.0",
      episode_slug: "cap-adults",
      primary_organs: ["lung"],
      zones: [
        {
          zone_id: "Z-LUNG-ENTRY",
          name: "Entry",
          anatomic_location: "upper airway",
          citations: []
        }
      ],
      hazards: [
        {
          hazard_id: "HZ-01",
          type: "immune_attack",
          description: "Hazard",
          links_to_pathophysiology: "Inflammation",
          citations: []
        }
      ],
      routes: [
        {
          route_id: "RT-01",
          from_zone_id: "Z-LUNG-ENTRY",
          to_zone_id: "Z-LUNG-ENTRY",
          mode: "airflow",
          citations: []
        }
      ],
      visual_style_guide: {
        citations: []
      }
    });

    expect(parsed.success).toBe(false);
  });

  it("accepts med factcheck issues with empty supporting citations so runtime can backfill them", () => {
    const parsed = MedFactcheckAgentOutputSchema.safeParse({
      schema_version: "1.0.0",
      pass: false,
      issues: [
        {
          issue_id: "MED-001",
          severity: "major",
          type: "unsupported_inference",
          claim: "Slide S01 overstates certainty.",
          why_wrong: "The cited evidence is missing.",
          suggested_fix: "Ground S01 in dossier evidence.",
          supporting_citations: []
        }
      ],
      summary: "One issue found.",
      required_fixes: [
        {
          fix_id: "FIX-001",
          type: "edit_slide",
          priority: "must",
          description: "Ground S01 in dossier evidence.",
          targets: ["S01"]
        }
      ]
    });

    expect(parsed.success).toBe(true);
  });
});
