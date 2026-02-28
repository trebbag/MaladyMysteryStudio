import { z } from "zod";

export const V2_WORKFLOW = "v2_micro_detectives" as const;
export const V2_DECK_LENGTHS = [30, 45, 60] as const;
export const V2_AUDIENCE_LEVELS = ["MED_SCHOOL_ADVANCED", "RESIDENT", "FELLOWSHIP"] as const;
export const V2_PHASE1_STEP_ORDER = ["KB0", "A", "B", "C"] as const;
export const V2_GATE_IDS = ["GATE_1_PITCH", "GATE_2_TRUTH_LOCK", "GATE_3_STORYBOARD", "GATE_4_FINAL"] as const;

export const V2DeckLengthMainSchema = z.union([z.literal(30), z.literal(45), z.literal(60)]);
export const V2AudienceLevelSchema = z.enum(V2_AUDIENCE_LEVELS);

export const CitationRefSchema = z.object({
  citation_id: z.string().min(1),
  chunk_id: z.string().min(1).optional(),
  locator: z.string().min(1).optional(),
  claim: z.string().min(1)
});

const OnSlideTextSchema = z
  .object({
    headline: z.string().min(1),
    subtitle: z.string().min(1).optional(),
    callouts: z.array(z.string().min(1)).optional(),
    labels: z.array(z.string().min(1)).optional()
  })
  .strict();

const StoryPanelSchema = z
  .object({
    goal: z.string().min(1),
    opposition: z.string().min(1),
    turn: z.string().min(1),
    decision: z.string().min(1),
    consequence: z.string().min(1).optional()
  })
  .strict();

export const DeliveryModeSchema = z.enum(["clue", "exhibit", "dialogue", "action", "note_only", "none"]);

const MedicalPayloadSchema = z
  .object({
    major_concept_id: z.string().min(1),
    supporting_details: z.array(z.string().min(1)).optional(),
    delivery_mode: DeliveryModeSchema,
    linked_learning_objectives: z.array(z.string().min(1)).optional(),
    dossier_citations: z.array(CitationRefSchema)
  })
  .strict();

const DifferentialUpdateSchema = z
  .object({
    top_dx_ids: z.array(z.string().min(1)),
    eliminated_dx_ids: z.array(z.string().min(1)),
    why: z.string().min(1)
  })
  .strict();

const SpeakerNotesSchema = z
  .object({
    narrative_notes: z.string().min(1).optional(),
    medical_reasoning: z.string().min(1),
    what_this_slide_teaches: z.array(z.string().min(1)).optional(),
    differential_update: DifferentialUpdateSchema,
    citations: z.array(CitationRefSchema)
  })
  .strict();

const SlideSpecSchema = z
  .object({
    slide_id: z.string().min(1),
    act_id: z.enum(["ACT1", "ACT2", "ACT3", "ACT4", "APPENDIX"]),
    beat_type: z.enum([
      "cold_open",
      "case_intake",
      "first_dive",
      "clue_discovery",
      "suspect_intro",
      "red_herring",
      "setback",
      "reversal",
      "action_setpiece",
      "theory_update",
      "false_theory_lock_in",
      "false_theory_collapse",
      "twist",
      "proof",
      "showdown",
      "aftermath",
      "appendix"
    ]),
    template_id: z.enum([
      "T01_COLD_OPEN_MICRO_CRIME_SCENE",
      "T02_CASE_INTAKE_MACRO",
      "T03_SHRINK_DIVE_SEQUENCE",
      "T04_CLUE_DISCOVERY",
      "T05_INTERROGATION_CELL_ACTOR",
      "T06_DIFFERENTIAL_BOARD_UPDATE",
      "T07_RED_HERRING_REVERSAL",
      "T08_ACTION_SET_PIECE_MICRO_HAZARD",
      "T09_TWIST_RECONTEXTUALIZATION",
      "T10_PROOF_TRAP",
      "T11_AFTERCARE_AFTERMATH",
      "T90_APPENDIX_DEEP_DIVE"
    ]),
    title: z.string().min(1).optional(),
    on_slide_text: OnSlideTextSchema,
    visual_description: z.string().min(1),
    exhibit_ids: z.array(z.string().min(1)).optional(),
    story_panel: StoryPanelSchema,
    medical_payload: MedicalPayloadSchema,
    pressure_channels_advanced: z.array(z.enum(["physical", "institutional", "relational", "moral"])).optional(),
    hook: z.string().min(1),
    appendix_links: z.array(z.string().min(1)).optional(),
    speaker_notes: SpeakerNotesSchema
  })
  .strict();

const DeckMetaSchema = z
  .object({
    schema_version: z.string().min(1),
    episode_slug: z.string().min(1),
    episode_title: z.string().min(1),
    deck_length_main: z.enum(["30", "45", "60"]),
    tone: z.enum(["noir", "brisk", "comedic_dry", "thriller", "awe"]),
    audience_level: V2AudienceLevelSchema,
    story_dominance_target_ratio: z.number().min(0).max(1),
    max_words_on_slide: z.number().int().min(1),
    one_major_med_concept_per_slide: z.boolean(),
    appendix_unlimited: z.boolean()
  })
  .strict();

const CharacterProfileSchema = z
  .object({
    name: z.string().min(1),
    species_or_origin: z.string().min(1),
    voice_style: z.string().min(1),
    competency: z.string().min(1),
    blind_spot: z.string().min(1)
  })
  .strict();

const CharacterSpecSchema = z
  .object({
    detective: CharacterProfileSchema,
    deputy: CharacterProfileSchema,
    patient: z
      .object({
        label: z.string().min(1),
        macro_context: z.string().min(1)
      })
      .strict(),
    macro_supporting_cast: z.array(
      z
        .object({
          role: z.string().min(1),
          name_or_label: z.string().min(1),
          function: z.string().min(1)
        })
        .strict()
    )
  })
  .strict();

const ActSpecSchema = z
  .object({
    act_id: z.enum(["ACT1", "ACT2", "ACT3", "ACT4"]),
    name: z.string().min(1),
    slide_start: z.number().int().min(1),
    slide_end: z.number().int().min(1),
    act_goal: z.string().min(1),
    required_pressure_channels: z.array(z.enum(["physical", "institutional", "relational", "moral"]))
  })
  .strict();

export const DeckSpecSchema = z
  .object({
    deck_meta: DeckMetaSchema,
    characters: CharacterSpecSchema,
    acts: z.array(ActSpecSchema).min(1),
    slides: z.array(SlideSpecSchema),
    appendix_slides: z.array(SlideSpecSchema)
  })
  .strict();

export const V2LintErrorSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
    severity: z.enum(["error", "warning"]),
    slide_id: z.string().min(1).optional()
  })
  .strict();

export const V2DeckSpecLintReportSchema = z
  .object({
    workflow: z.literal(V2_WORKFLOW),
    expectedDeckLengthMain: V2DeckLengthMainSchema,
    measuredDeckLengthMain: z.number().int().min(0),
    storyForwardRatio: z.number().min(0).max(1),
    storyForwardTargetRatio: z.number().min(0).max(1),
    pass: z.boolean(),
    errorCount: z.number().int().min(0),
    warningCount: z.number().int().min(0),
    errors: z.array(V2LintErrorSchema)
  })
  .strict();

export const V2StoryboardGateSchema = z
  .object({
    gate_id: z.literal("GATE_3_STORYBOARD"),
    workflow: z.literal(V2_WORKFLOW),
    status: z.literal("review_required"),
    message: z.string().min(1),
    next_action: z.string().min(1)
  })
  .strict();

export const V2GateIdSchema = z.enum(V2_GATE_IDS);

export const V2GateRequirementSchema = z
  .object({
    gate_id: V2GateIdSchema,
    workflow: z.literal(V2_WORKFLOW),
    status: z.literal("review_required"),
    message: z.string().min(1),
    next_action: z.string().min(1)
  })
  .strict();

export const HumanReviewDecisionSchema = z.enum(["approve", "request_changes", "regenerate"]);

export const HumanReviewRequestedChangeSchema = z
  .object({
    path: z.string().min(1),
    instruction: z.string().min(1),
    severity: z.enum(["must", "should", "nice"])
  })
  .strict();

export const HumanReviewEntrySchema = z
  .object({
    schema_version: z.string().min(1),
    gate_id: V2GateIdSchema,
    status: HumanReviewDecisionSchema,
    notes: z.string().default(""),
    requested_changes: z.array(HumanReviewRequestedChangeSchema),
    submitted_at: z.string().min(1)
  })
  .strict();

export const HumanReviewStoreSchema = z
  .object({
    schema_version: z.string().min(1),
    latest_by_gate: z.record(V2GateIdSchema, HumanReviewEntrySchema.nullable()),
    history: z.array(HumanReviewEntrySchema)
  })
  .strict();

const DossierSectionSchema = z
  .object({
    section: z.string().min(1),
    key_points: z.array(z.string().min(1)).min(1),
    citations: z.array(CitationRefSchema).min(1)
  })
  .strict();

export const DiseaseDossierSchema = z
  .object({
    schema_version: z.string().min(1),
    created_at: z.string().min(1),
    disease_request: z
      .object({
        disease_topic: z.string().min(1),
        target_level: V2AudienceLevelSchema,
        setting_focus: z.string().min(1),
        constraints: z.array(z.string()).default([])
      })
      .strict(),
    canonical_name: z.string().min(1),
    aliases: z.array(z.string().min(1)).default([]),
    learning_objectives: z.array(z.string().min(1)).min(3),
    sections: z.array(DossierSectionSchema).min(5),
    citations: z.array(CitationRefSchema).min(1)
  })
  .strict();

export const EpisodePitchSchema = z
  .object({
    schema_version: z.string().min(1),
    pitch_id: z.string().min(1),
    episode_title: z.string().min(1),
    logline: z.string().min(1),
    target_deck_length: z.enum(["30", "45", "60"]),
    tone: z.enum(["noir", "brisk", "comedic_dry", "thriller", "awe"]),
    patient_stub: z
      .object({
        age: z.number().int().min(0).max(120).optional(),
        sex: z.enum(["female", "male", "intersex", "unknown"]).default("unknown"),
        one_sentence_context: z.string().min(1),
        presenting_problem: z.string().min(1),
        stakes_if_missed: z.string().min(1)
      })
      .strict(),
    macro_hook: z.string().min(1),
    micro_hook: z.string().min(1),
    proposed_twist_type: z.enum([
      "mimic",
      "iatrogenic_overlay",
      "dual_process",
      "localization_switch",
      "immune_twist",
      "toxin_exposure",
      "genetic_variant",
      "other"
    ]),
    teaser_storyboard: z
      .array(
        z
          .object({
            slide_id: z.string().min(1),
            template_id: z.string().min(1),
            title: z.string().min(1),
            one_line_story: z.string().min(1),
            visual: z.string().min(1),
            hook: z.string().min(1),
            medical_payload_brief: z.string().optional()
          })
          .strict()
      )
      .min(3),
    citations_used: z.array(CitationRefSchema).min(1)
  })
  .strict();

const TimelineEventSchema = z
  .object({
    t: z.string().min(1),
    event_id: z.string().min(1),
    what_happens: z.string().min(1),
    citations: z.array(CitationRefSchema).min(1)
  })
  .strict();

export const TruthModelSchema = z
  .object({
    schema_version: z.string().min(1),
    episode_title: z.string().min(1),
    final_diagnosis: z
      .object({
        dx_id: z.string().min(1),
        name: z.string().min(1),
        one_sentence_mechanism: z.string().min(1)
      })
      .strict(),
    case_logline: z.string().min(1),
    patient_profile: z
      .object({
        sex: z.enum(["female", "male", "intersex", "unknown"]),
        key_history: z.array(z.string().min(1)).min(1)
      })
      .strict(),
    cover_story: z
      .object({
        initial_working_dx_ids: z.array(z.string().min(1)).min(1),
        why_it_seems_right: z.string().min(1),
        what_it_gets_wrong: z.string().min(1)
      })
      .strict(),
    macro_timeline: z.array(TimelineEventSchema).min(2),
    micro_timeline: z.array(TimelineEventSchema.extend({ zone_id: z.string().min(1) }).strict()).min(2),
    twist_blueprint: z
      .object({
        setup: z.string().min(1),
        reveal: z.string().min(1),
        receipts: z.array(z.string().min(1)).min(1)
      })
      .strict()
  })
  .strict();

export const RequiredFixSchema = z
  .object({
    fix_id: z.string().min(1),
    type: z.enum([
      "regenerate_section",
      "edit_slide",
      "edit_clue",
      "edit_differential",
      "medical_correction",
      "reduce_text_density",
      "increase_story_turn",
      "add_twist_receipts",
      "other"
    ]),
    priority: z.enum(["must", "should", "could"]),
    description: z.string().min(1),
    targets: z.array(z.string().min(1)).optional()
  })
  .strict();

const MedIssueSchema = z
  .object({
    issue_id: z.string().min(1),
    severity: z.enum(["critical", "major", "minor"]),
    type: z.enum([
      "incorrect_fact",
      "unsupported_inference",
      "misused_term",
      "wrong_timecourse",
      "wrong_test_interpretation",
      "wrong_treatment_response",
      "contradiction_with_dossier",
      "other"
    ]),
    claim: z.string().min(1),
    why_wrong: z.string().min(1),
    suggested_fix: z.string().min(1),
    supporting_citations: z.array(CitationRefSchema).min(1)
  })
  .strict();

export const MedFactcheckReportSchema = z
  .object({
    schema_version: z.string().min(1),
    pass: z.boolean(),
    issues: z.array(MedIssueSchema),
    summary: z.string().min(1),
    required_fixes: z.array(RequiredFixSchema)
  })
  .strict();

const DifferentialSuspectSchema = z
  .object({
    dx_id: z.string().min(1),
    name: z.string().min(1),
    why_tempting: z.string().min(1),
    signature_fingerprint: z
      .array(
        z
          .object({
            type: z.string().min(1),
            statement: z.string().min(1),
            citations: z.array(CitationRefSchema).min(1)
          })
          .strict()
      )
      .min(1),
    danger_if_wrong: z.string().optional(),
    what_it_mimics: z.array(z.string().min(1)).optional(),
    citations: z.array(CitationRefSchema).min(1)
  })
  .strict();

export const DifferentialCastSchema = z
  .object({
    schema_version: z.string().min(1),
    primary_suspects: z.array(DifferentialSuspectSchema).min(3),
    rotation_plan: z
      .object({
        act1_focus_dx_ids: z.array(z.string().min(1)).optional(),
        act2_expansion_dx_ids: z.array(z.string().min(1)).optional(),
        act3_collapse_dx_ids: z.array(z.string().min(1)).optional(),
        act4_final_dx_id: z.string().min(1)
      })
      .strict(),
    elimination_milestones: z
      .array(
        z
          .object({
            milestone_id: z.string().min(1),
            slide_id: z.string().min(1),
            eliminated_dx_ids: z.array(z.string().min(1)).default([]),
            evidence_clue_ids: z.array(z.string().min(1)).min(1),
            reasoning_summary: z.string().optional(),
            citations: z.array(CitationRefSchema).min(1)
          })
          .strict()
      )
      .default([]),
    citations_used: z.array(CitationRefSchema).min(1)
  })
  .strict();

const ClueGraphExhibitSchema = z
  .object({
    exhibit_id: z.string().min(1),
    type: z.string().min(1),
    title: z.string().min(1),
    purpose: z.string().min(1),
    produced_on_slide_id: z.string().min(1),
    data_fields: z.array(z.string().min(1)).optional(),
    how_it_is_visualized: z.string().optional(),
    citations: z.array(CitationRefSchema).min(1)
  })
  .strict();

const ClueGraphClueSchema = z
  .object({
    clue_id: z.string().min(1),
    macro_or_micro: z.enum(["macro", "micro"]),
    observed: z.string().min(1),
    where_found: z.string().optional(),
    acquisition_method: z.string().optional(),
    wrong_inference: z.string().min(1),
    correct_inference: z.string().min(1),
    implicates_dx_ids: z.array(z.string().min(1)).optional(),
    eliminates_dx_ids: z.array(z.string().min(1)).optional(),
    first_seen_slide_id: z.string().min(1),
    payoff_slide_id: z.string().min(1),
    associated_exhibit_ids: z.array(z.string().min(1)).optional(),
    dossier_citations: z.array(CitationRefSchema).min(1)
  })
  .strict();

const ClueGraphRedHerringSchema = z
  .object({
    rh_id: z.string().min(1),
    suggests_dx_id: z.string().min(1),
    why_believable: z.string().min(1),
    rooted_truth: z.string().min(1),
    payoff_slide_id: z.string().min(1),
    dossier_citations: z.array(CitationRefSchema).min(1)
  })
  .strict();

const ClueGraphTwistSupportSchema = z
  .object({
    twist_id: z.string().min(1),
    supporting_clue_ids: z.array(z.string().min(1)).min(1),
    recontextualized_slide_ids: z.array(z.string().min(1)).min(1),
    act1_setup_clue_ids: z.array(z.string().min(1)).min(1)
  })
  .strict();

export const ClueGraphSchema = z
  .object({
    schema_version: z.string().min(1),
    exhibits: z.array(ClueGraphExhibitSchema).min(1),
    clues: z.array(ClueGraphClueSchema).min(3),
    red_herrings: z.array(ClueGraphRedHerringSchema).min(1),
    twist_support_matrix: z.array(ClueGraphTwistSupportSchema).min(1),
    constraints: z
      .object({
        one_major_med_concept_per_story_slide: z.boolean(),
        min_clues_per_twist: z.number().int().min(1),
        require_act1_setup: z.boolean()
      })
      .strict(),
    citations_used: z.array(CitationRefSchema).min(1)
  })
  .strict();

const MicroWorldZoneSchema = z
  .object({
    zone_id: z.string().min(1),
    name: z.string().min(1),
    anatomic_location: z.string().min(1),
    scale_notes: z.string().optional(),
    physical_properties: z.array(z.string().min(1)).optional(),
    resident_actors: z.array(z.string().min(1)).optional(),
    environmental_gradients: z.array(z.string().min(1)).optional(),
    narrative_motifs: z.array(z.string().min(1)).optional(),
    citations: z.array(CitationRefSchema).min(1)
  })
  .strict();

const MicroWorldHazardSchema = z
  .object({
    hazard_id: z.string().min(1),
    type: z.enum([
      "shear_flow",
      "hypoxia",
      "acidity",
      "enzymatic_damage",
      "immune_attack",
      "thrombus_maze",
      "edema_pressure",
      "toxin_cloud",
      "barrier_checkpoint",
      "biofilm_trap",
      "other"
    ]),
    description: z.string().min(1),
    how_it_appears_visually: z.string().optional(),
    how_characters_survive: z.string().optional(),
    links_to_pathophysiology: z.string().min(1),
    citations: z.array(CitationRefSchema).min(1)
  })
  .strict();

const MicroWorldRouteSchema = z
  .object({
    route_id: z.string().min(1),
    from_zone_id: z.string().min(1),
    to_zone_id: z.string().min(1),
    mode: z.enum(["bloodstream", "lymph", "mucus_surface", "interstitial", "neuronal_track", "duct_system", "airflow", "other"]),
    constraints: z.array(z.string().min(1)).optional(),
    story_use: z.string().optional(),
    citations: z.array(CitationRefSchema).min(1)
  })
  .strict();

export const MicroWorldMapSchema = z
  .object({
    schema_version: z.string().min(1),
    episode_slug: z.string().min(1),
    primary_organs: z.array(z.string().min(1)).default([]),
    zones: z.array(MicroWorldZoneSchema).min(1),
    hazards: z.array(MicroWorldHazardSchema).min(1),
    routes: z.array(MicroWorldRouteSchema).min(1),
    immune_law_enforcement_metaphors: z
      .array(
        z
          .object({
            actor: z.string().min(1),
            metaphor: z.string().min(1),
            accuracy_notes: z.string().optional(),
            citations: z.array(CitationRefSchema).min(1)
          })
          .strict()
      )
      .optional(),
    visual_style_guide: z
      .object({
        palette_notes: z.string().optional(),
        recurring_ui_elements: z.array(z.string().min(1)).optional(),
        labeling_rules: z.array(z.string().min(1)).optional(),
        citations: z.array(CitationRefSchema).min(1)
      })
      .strict()
  })
  .strict();

export const DramaPlanSchema = z
  .object({
    schema_version: z.string().min(1),
    series_bible_constraints: z.array(z.string().min(1)).optional(),
    character_arcs: z
      .array(
        z
          .object({
            character_id: z.enum(["detective", "deputy", "patient", "clinician_lead", "antagonist_institution", "other"]),
            name: z.string().min(1),
            core_need: z.string().min(1),
            core_fear: z.string().min(1),
            wound_or_backstory: z.string().optional(),
            moral_line: z.string().min(1),
            act_turns: z
              .array(
                z
                  .object({
                    act_id: z.enum(["ACT1", "ACT2", "ACT3", "ACT4"]),
                    pressure: z.string().min(1),
                    choice: z.string().min(1),
                    change: z.string().min(1)
                  })
                  .strict()
              )
              .min(1)
          })
          .strict()
      )
      .min(1),
    relationship_arcs: z
      .array(
        z
          .object({
            pair: z.enum(["detective_deputy", "aliens_patient", "aliens_clinicians", "detective_authority", "deputy_authority"]),
            starting_dynamic: z.string().min(1),
            friction_points: z.array(z.string().min(1)).optional(),
            repair_moments: z.array(z.string().min(1)).optional(),
            climax_resolution: z.string().min(1)
          })
          .strict()
      )
      .min(1),
    pressure_ladder: z
      .object({
        physical: z.array(z.string().min(1)),
        institutional: z.array(z.string().min(1)),
        relational: z.array(z.string().min(1)),
        moral: z.array(z.string().min(1))
      })
      .strict(),
    chapter_or_act_setups: z
      .array(
        z
          .object({
            act_id: z.enum(["ACT1", "ACT2", "ACT3", "ACT4"]),
            required_emotional_beats: z.array(z.string().min(1)),
            required_choices: z.array(z.string().min(1)),
            notes: z.string().optional()
          })
          .strict()
      )
      .optional()
  })
  .strict();

export const SetpiecePlanSchema = z
  .object({
    schema_version: z.string().min(1),
    setpieces: z
      .array(
        z
          .object({
            setpiece_id: z.string().min(1),
            act_id: z.enum(["ACT1", "ACT2", "ACT3", "ACT4"]),
            type: z.enum([
              "transit_peril",
              "immune_chase",
              "barrier_infiltration",
              "environmental_hazard",
              "intervention_shockwave",
              "moral_confrontation",
              "proof_trap",
              "other"
            ]),
            location_zone_id: z.string().optional(),
            story_purpose: z.string().min(1),
            medical_mechanism_anchor: z.string().min(1),
            visual_signature: z.string().min(1),
            constraints: z.array(z.string().min(1)).optional(),
            outcome_turn: z.string().min(1),
            citations: z.array(CitationRefSchema).min(1)
          })
          .strict()
      )
      .min(1),
    quotas: z
      .object({
        act1_social_or_ethics_confrontation: z.boolean(),
        act2_micro_action_setpiece: z.boolean(),
        act3_truth_bomb: z.boolean(),
        act4_proof_or_showdown: z.boolean()
      })
      .strict(),
    notes: z.array(z.string().min(1)).optional()
  })
  .strict();

export const V2TemplateRegistrySchema = z
  .object({
    schema_version: z.string().min(1),
    templates: z
      .array(
        z
          .object({
            template_id: z.string().min(1),
            name: z.string().min(1),
            purpose: z.string().min(1),
            renderer_instructions: z.array(z.string().min(1)).min(1),
            allowed_beat_types: z.array(z.string().min(1)).min(1)
          })
          .strict()
      )
      .min(1),
    defaults: z
      .object({
        cinematic_style: z.string().min(1),
        typography: z.string().min(1),
        evidence_overlay: z.string().min(1)
      })
      .strict()
  })
  .strict();

export const ReaderSimReportSchema = z
  .object({
    schema_version: z.string().min(1),
    solve_attempts: z
      .array(
        z
          .object({
            checkpoint: z.enum(["ACT1_END", "MIDPOINT", "ACT3_START", "ACT3_END"]),
            top_dx_guesses: z.array(z.string().min(1)).min(1),
            confidence_0_to_1: z.number().min(0).max(1),
            key_clues_used: z.array(z.string().min(1)).min(1),
            what_was_confusing: z.array(z.string().min(1)).optional(),
            was_twist_predictable: z.enum(["too_easy", "fairly_guessable", "surprising_but_fair", "felt_like_cheating"])
          })
          .strict()
      )
      .min(1),
    overall_story_dominance_score_0_to_5: z.number().min(0).max(5),
    overall_twist_quality_score_0_to_5: z.number().min(0).max(5),
    overall_clarity_score_0_to_5: z.number().min(0).max(5),
    biggest_strengths: z.array(z.string().min(1)).optional(),
    biggest_risks: z.array(z.string().min(1)).optional(),
    slide_notes: z.array(
      z
        .object({
          slide_id: z.string().min(1),
          issue_type: z.string().min(1),
          note: z.string().min(1),
          severity: z.enum(["must", "should", "nice"])
        })
        .strict()
    ),
    required_fixes: z.array(RequiredFixSchema)
  })
  .strict();

export const V2QaReportSchema = z
  .object({
    schema_version: z.string().min(1),
    lint_pass: z.boolean(),
    lint_errors: z.array(V2LintErrorSchema),
    grader_scores: z.array(
      z
        .object({
          category: z.enum(["MedicalAccuracy", "StoryDominance", "TwistQuality", "SlideClarity", "PacingTurnRate", "MicroMacroCoherence"]),
          score_0_to_5: z.number().min(0).max(5),
          rationale: z.string().min(1),
          critical: z.boolean()
        })
        .strict()
    ),
    accept: z.boolean(),
    required_fixes: z.array(RequiredFixSchema),
    summary: z.string().min(1),
    citations_used: z.array(CitationRefSchema).min(1)
  })
  .strict();

export type DeckSpec = z.infer<typeof DeckSpecSchema>;
export type DeckSlideSpec = z.infer<typeof SlideSpecSchema>;
export type V2DeckSpecLintError = z.infer<typeof V2LintErrorSchema>;
export type V2DeckSpecLintReport = z.infer<typeof V2DeckSpecLintReportSchema>;
export type V2StoryboardGate = z.infer<typeof V2StoryboardGateSchema>;
export type V2GateId = z.infer<typeof V2GateIdSchema>;
export type V2GateRequirement = z.infer<typeof V2GateRequirementSchema>;
export type HumanReviewDecision = z.infer<typeof HumanReviewDecisionSchema>;
export type HumanReviewEntry = z.infer<typeof HumanReviewEntrySchema>;
export type HumanReviewStore = z.infer<typeof HumanReviewStoreSchema>;
export type V2AudienceLevel = z.infer<typeof V2AudienceLevelSchema>;
export type DiseaseDossier = z.infer<typeof DiseaseDossierSchema>;
export type EpisodePitch = z.infer<typeof EpisodePitchSchema>;
export type TruthModel = z.infer<typeof TruthModelSchema>;
export type RequiredFix = z.infer<typeof RequiredFixSchema>;
export type MedFactcheckReport = z.infer<typeof MedFactcheckReportSchema>;
export type DifferentialCast = z.infer<typeof DifferentialCastSchema>;
export type ClueGraph = z.infer<typeof ClueGraphSchema>;
export type MicroWorldMap = z.infer<typeof MicroWorldMapSchema>;
export type DramaPlan = z.infer<typeof DramaPlanSchema>;
export type SetpiecePlan = z.infer<typeof SetpiecePlanSchema>;
export type V2TemplateRegistry = z.infer<typeof V2TemplateRegistrySchema>;
export type ReaderSimReport = z.infer<typeof ReaderSimReportSchema>;
export type V2QaReport = z.infer<typeof V2QaReportSchema>;
