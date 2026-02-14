import { z } from "zod";

export const KbCompilerOutputSchema = z.object({
  kb_context: z.string().min(1)
});

export const MEDICAL_NARRATIVE_SECTIONS = [
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
] as const;

export const SlideModeSchema = z.enum(["hybrid", "story_transition"]);
export const NarrativePhaseSchema = z.enum(["intro", "body", "outro"]);
export const MedicalVisualModeSchema = z.enum(["dual_hud_panels", "in_scene_annotated_visual"]);

const MedicalSectionCoverageSchema = z.object({
  section: z.string().min(1),
  medical_takeaways: z.array(z.string().min(1)).min(1),
  narrative_translation: z.string().min(1),
  story_function: z.string().min(1),
  stage_name_suggestion: z.string().min(1)
});

const MedicalKnowledgeEntrySchema = z.object({
  concept: z.string().min(1),
  clinically_relevant_detail: z.string().min(1),
  why_it_matters_for_pcp: z.string().min(1),
  citations: z.array(z.string().min(1)).min(1),
  confidence: z.number().min(0).max(1)
});

const MedicalChapterSchema = z.object({
  normal_physiology: z.array(MedicalKnowledgeEntrySchema).min(1),
  pathophysiology: z.array(MedicalKnowledgeEntrySchema).min(1),
  epidemiology_risk: z.array(MedicalKnowledgeEntrySchema).min(1),
  clinical_presentation: z.array(MedicalKnowledgeEntrySchema).min(1),
  diagnosis_workup: z.array(MedicalKnowledgeEntrySchema).min(1),
  differential: z.array(MedicalKnowledgeEntrySchema).min(1),
  treatment_acute: z.array(MedicalKnowledgeEntrySchema).min(1),
  treatment_long_term: z.array(MedicalKnowledgeEntrySchema).min(1),
  prognosis_complications: z.array(MedicalKnowledgeEntrySchema).min(1),
  patient_counseling_prevention: z.array(MedicalKnowledgeEntrySchema).min(1)
});

export const ProducerOutputSchema = z.object({
  producer_brief: z.object({
    title: z.string().min(1),
    learning_goal: z.string().min(1),
    target_audience: z.string().min(1),
    key_constraints: z.array(z.string().min(1)),
    outline: z.array(z.string().min(1)),
    tone: z.string().min(1)
  })
});

export const ResearcherOutputSchema = z.object({
  facts_library: MedicalChapterSchema
});

export const EditorOutputSchema = z.object({
  facts_library_clean: MedicalChapterSchema,
  editor_notes: z.object({
    changes_made: z.array(z.string().min(1)),
    red_flags: z.array(z.string().min(1)),
    completeness_checks: z.array(z.string().min(1))
  })
});

export const MedicalNarrativeFlowOutputSchema = z.object({
  medical_narrative_flow: z.object({
    chapter_summary: z.string().min(1),
    progression: z.array(
      z.object({
        stage: z.string().min(1),
        medical_logic: z.string().min(1),
        key_teaching_points: z.array(z.string().min(1)).min(1),
        story_implication: z.string().min(1)
      })
    ),
    section_coverage: z.array(MedicalSectionCoverageSchema).min(MEDICAL_NARRATIVE_SECTIONS.length),
    metaphor_map: z.array(
      z.object({
        medical_element: z.string().min(1),
        mystery_expression: z.string().min(1),
        pedagogy_reason: z.string().min(1)
      })
    ),
    required_plot_events: z.array(z.string().min(1)).min(1)
  }).superRefine((value, ctx) => {
    const expected = new Set(MEDICAL_NARRATIVE_SECTIONS);
    const observed = new Set(
      value.section_coverage.map((row) => row.section.trim().toLowerCase())
    );

    for (const section of expected) {
      const lower = section.toLowerCase();
      if (!observed.has(lower)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Missing section coverage entry for "${section}".`
        });
      }
    }
  })
});

export const CurriculumOutputSchema = z.object({
  medical_atoms: z.array(
    z.object({
      atom_id: z.string().min(1),
      statement: z.string().min(1),
      common_pitfalls: z.array(z.string().min(1))
    })
  ),
  teaching_blueprint: z.object({
    sequence: z.array(z.string().min(1)),
    misconceptions_to_address: z.array(z.string().min(1)),
    end_state: z.string().min(1)
  })
});

export const AssessmentOutputSchema = z.object({
  // Keep producing a full bank, but downstream only uses a small subset in the deck.
  assessment_bank: z.array(
    z.object({
      question_id: z.string().min(1),
      stem: z.string().min(1),
      choices: z.array(z.string().min(1)),
      answer_index: z.number().int().min(0),
      explanation: z.string().min(1)
    })
  ).length(30)
});

export const SlideArchitectOutputSchema = z.object({
  slide_skeleton: z.array(
    z.object({
      slide_id: z.string().min(1),
      title: z.string().min(1),
      objective: z.string().min(1),
      bullets: z.array(z.string().min(1)),
      slide_mode: SlideModeSchema,
      narrative_phase: NarrativePhaseSchema,
      story_goal: z.string().min(1)
    })
  ).min(100),
  coverage: z.object({
    atoms_covered: z.array(z.string().min(1)),
    gaps: z.array(z.string().min(1))
  })
});

export const VarietyPackSchema = z.object({
  genre_wrapper: z.string().min(1),
  body_setting: z.string().min(1),
  antagonist_archetype: z.string().min(1),
  twist_type: z.string().min(1),
  signature_gadget: z.string().min(1),
  motifs: z.array(z.string().min(1))
});

export const StorySeedOutputSchema = z.object({
  story_seed: z.object({
    logline: z.string().min(1),
    setting: z.string().min(1),
    cast: z.array(z.string().min(1)),
    stakes: z.string().min(1),
    medical_backbone_summary: z.string().min(1),
    metaphor_map: z.array(
      z.object({
        medical_element: z.string().min(1),
        mystery_expression: z.string().min(1),
        teaching_value: z.string().min(1)
      })
    ),
    action_moments: z.array(z.string().min(1)).min(1),
    intrigue_twists: z.array(z.string().min(1)).min(1),
    variety_pack: VarietyPackSchema
  })
});

export const ShowrunnerOutputSchema = z.object({
  story_bible: z.object({
    premise: z.string().min(1),
    rules: z.array(z.string().min(1)),
    recurring_motifs: z.array(z.string().min(1)),
    // Include characters + constraints so downstream steps (visuals/slides) can stay consistent.
    cast: z.array(
      z.object({
        name: z.string().min(1),
        role: z.string().min(1),
        bio: z.string().min(1),
        traits: z.array(z.string().min(1)),
        constraints: z.array(z.string().min(1))
      })
    ),
    story_constraints_used: z.array(z.string().min(1)),
    visual_constraints_used: z.array(z.string().min(1))
  }),
  episode_arc: z.object({
    intro_beats: z.array(z.string().min(1)).min(3),
    body_beats: z.array(z.string().min(1)).min(1),
    outro_beats: z.array(z.string().min(1)).min(2),
    entry_to_body_beat: z.string().min(1),
    return_to_office_beat: z.string().min(1),
    callback_beat: z.string().min(1)
  }),
  beat_sheet: z.array(
    z.object({
      beat: z.string().min(1),
      purpose: z.string().min(1),
      characters: z.array(z.string().min(1)),
      setting: z.string().min(1)
    })
  )
});

export const VisualDirectorOutputSchema = z.object({
  shot_list: z.array(
    z.object({
      shot_id: z.string().min(1),
      moment: z.string().min(1),
      framing: z.string().min(1),
      visual_notes: z.string().min(1)
    })
  )
});

export const PacingEditorOutputSchema = z.object({
  pacing_map: z.object({
    total_minutes: z.number().min(1),
    // Use an array instead of a record to avoid JSON Schema `propertyNames` (not accepted by OpenAI response_format).
    per_slide_seconds: z.array(
      z.object({
        slide_id: z.string().min(1),
        seconds: z.number().min(1)
      })
    ),
    transitions: z.array(z.string().min(1))
  })
});

export const MapperOutputSchema = z.object({
  alignment_plan: z.object({
    // Use arrays instead of records to avoid JSON Schema `propertyNames` (not accepted by OpenAI response_format).
    slide_to_atoms: z.array(
      z.object({
        slide_id: z.string().min(1),
        atom_ids: z.array(z.string().min(1))
      })
    ),
    slide_to_assessment: z.array(
      z.object({
        slide_id: z.string().min(1),
        question_ids: z.array(z.string().min(1))
      })
    ),
    coverage_notes: z.array(z.string().min(1))
  })
});

const ReusableVisualPrimerSchema = z.object({
  character_descriptions: z.array(z.string().min(1)).min(1),
  recurring_scene_descriptions: z.array(z.string().min(1)).min(1),
  reusable_visual_elements: z.array(z.string().min(1)).min(1),
  continuity_rules: z.array(z.string().min(1)).min(1)
});

// NOTE: Avoid discriminated unions here.
// OpenAI's response_format JSON schema currently rejects `oneOf`, which Zod unions generate.
// We enforce mode-specific constraints via runtime refinement instead.
const SlideSceneSpecSchema = z
  .object({
    slide_id: z.string().min(1),
    title: z.string().min(1),
    slide_mode: SlideModeSchema,
    medical_visual_mode: MedicalVisualModeSchema,
    content_md: z.string().min(1),
    speaker_notes: z.string().min(1),
    narrative_phase: NarrativePhaseSchema,
    hud_panel_bullets: z.array(z.string().min(1)),
    location_description: z.string().min(1),
    evidence_visual_description: z.string().min(1),
    character_staging: z.string().min(1),
    scene_description: z.string().min(1),
    used_assets: z.array(z.string().min(1)).min(1),
    used_characters: z.array(z.string().min(1)).min(1),
    story_and_dialogue: z.string().min(1)
  })
  .superRefine((slide, ctx) => {
    const hudCount = slide.hud_panel_bullets.length;
    if (slide.slide_mode === "hybrid" && hudCount === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `hybrid slides must have non-empty hud_panel_bullets (slide_id=${slide.slide_id}).`
      });
    }
    if (slide.slide_mode === "story_transition" && hudCount > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `story_transition slides must not include hud_panel_bullets (slide_id=${slide.slide_id}).`
      });
    }
  });

const StoryArcContractSchema = z.object({
  intro_slide_ids: z.array(z.string().min(1)).min(3),
  outro_slide_ids: z.array(z.string().min(1)).min(2),
  entry_to_body_slide_id: z.string().min(1),
  return_to_office_slide_id: z.string().min(1),
  callback_slide_id: z.string().min(1)
}).superRefine((value, ctx) => {
  const introSet = new Set(value.intro_slide_ids);
  const outroSet = new Set(value.outro_slide_ids);

  if (!introSet.has(value.entry_to_body_slide_id)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `entry_to_body_slide_id must be in intro_slide_ids (found ${value.entry_to_body_slide_id}).`
    });
  }
  if (!outroSet.has(value.return_to_office_slide_id)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `return_to_office_slide_id must be in outro_slide_ids (found ${value.return_to_office_slide_id}).`
    });
  }
  if (!outroSet.has(value.callback_slide_id)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `callback_slide_id must be in outro_slide_ids (found ${value.callback_slide_id}).`
    });
  }
  for (const id of value.intro_slide_ids) {
    if (outroSet.has(id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `intro_slide_ids and outro_slide_ids must not overlap (overlap=${id}).`
      });
      break;
    }
  }
});

export const SlideWriterOutputSchema = z.object({
  final_slide_spec: z.object({
    title: z.string().min(1),
    reusable_visual_primer: ReusableVisualPrimerSchema,
    story_arc_contract: StoryArcContractSchema,
    slides: z.array(SlideSceneSpecSchema).min(100),
    sources: z.array(z.string().min(1))
  })
});

export const QaOutputSchema = z.object({
  qa_report: z.object({
    pass: z.boolean(),
    patch_list: z.array(
      z.object({
        target: z.string().min(1),
        instruction: z.string().min(1),
        severity: z.enum(["must", "should"])
      })
    ),
    notes: z.array(z.string().min(1))
  })
});

export const PatchOutputSchema = z.object({
  final_slide_spec_patched: z.object({
    title: z.string().min(1),
    reusable_visual_primer: ReusableVisualPrimerSchema,
    story_arc_contract: StoryArcContractSchema,
    slides: z.array(SlideSceneSpecSchema).min(100),
    sources: z.array(z.string().min(1))
  })
});

export const GensparkOutputSchema = z.object({
  genspark_asset_bible_md: z.string().min(1),
  genspark_slide_guide_md: z.string().min(1),
  genspark_build_script_txt: z.string().min(1)
});

export const GensparkMasterDocOutputSchema = z.object({
  genspark_master_render_plan_md: z.string().min(1)
});

export type KbCompilerOutput = z.infer<typeof KbCompilerOutputSchema>;
export type ProducerOutput = z.infer<typeof ProducerOutputSchema>;
export type ResearcherOutput = z.infer<typeof ResearcherOutputSchema>;
export type EditorOutput = z.infer<typeof EditorOutputSchema>;
export type MedicalNarrativeFlowOutput = z.infer<typeof MedicalNarrativeFlowOutputSchema>;
export type CurriculumOutput = z.infer<typeof CurriculumOutputSchema>;
export type AssessmentOutput = z.infer<typeof AssessmentOutputSchema>;
export type SlideArchitectOutput = z.infer<typeof SlideArchitectOutputSchema>;
export type StorySeedOutput = z.infer<typeof StorySeedOutputSchema>;
export type ShowrunnerOutput = z.infer<typeof ShowrunnerOutputSchema>;
export type VisualDirectorOutput = z.infer<typeof VisualDirectorOutputSchema>;
export type PacingEditorOutput = z.infer<typeof PacingEditorOutputSchema>;
export type MapperOutput = z.infer<typeof MapperOutputSchema>;
export type SlideWriterOutput = z.infer<typeof SlideWriterOutputSchema>;
export type QaOutput = z.infer<typeof QaOutputSchema>;
export type PatchOutput = z.infer<typeof PatchOutputSchema>;
export type GensparkOutput = z.infer<typeof GensparkOutputSchema>;
export type GensparkMasterDocOutput = z.infer<typeof GensparkMasterDocOutputSchema>;
