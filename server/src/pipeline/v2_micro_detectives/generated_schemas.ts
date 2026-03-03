/* AUTO-GENERATED FILE. DO NOT EDIT.
 * Source: micro-detectives-schemas-prompts/schemas
 * Generator: scripts/generate_v2_schemas.mjs
 */

export const V2CanonicalSchemaFiles = [
  "clue_graph.schema.json",
  "deck_cohesion_pass.schema.json",
  "deck_spec.schema.json",
  "differential_cast.schema.json",
  "disease_dossier.schema.json",
  "drama_plan.schema.json",
  "episode_pitch.schema.json",
  "human_review.schema.json",
  "med_factcheck_report.schema.json",
  "micro_world_map.schema.json",
  "narrative_state.schema.json",
  "qa_report.schema.json",
  "reader_sim_report.schema.json",
  "setpiece_plan.schema.json",
  "slide_block.schema.json",
  "truth_model.schema.json"
] as const;

export const V2CanonicalSchemaHashes = {
  "clue_graph.schema.json": "9bfef9b2ce5eb527815b1a0b120a7e7e33caf6ce020b3665931667c203188627",
  "deck_cohesion_pass.schema.json": "07afdb214172dffc94d8c9c549c576f2a72bfe2c5fc75df30e6b9aeff164167d",
  "deck_spec.schema.json": "6ec27011b5ff01a3a8c3f9380699144b6cfcc364ddeb2475db35aa0e2c241f65",
  "differential_cast.schema.json": "bfe2185c9cb8cbbafbce69edea1dc8efdb151616f95f2030710c04784d3a47bd",
  "disease_dossier.schema.json": "de476862b0241e0892dcd080ae50b6d554a8faad141ed26cd0b2b46bca8dff36",
  "drama_plan.schema.json": "127ed37fce3f542c914d2c537bc52d27882699d47fb03f5c401f1f373abf92a9",
  "episode_pitch.schema.json": "e2387f3239d6d8cda3f1c560afb24d410fa606ffdf89c85a57fa7477b236e940",
  "human_review.schema.json": "70fc101a3ca770743a0f355f05c304e18e2c6e8376ee3dd91160f33f22ae20ba",
  "med_factcheck_report.schema.json": "b0cc7c9391d385f2d9f0f5f40f94b145685f0a3ab51d431afcf94a08125b9ab9",
  "micro_world_map.schema.json": "8dd84b2a010de524cf261803c0193445fa06a0bded472669ce98fe991da48c6f",
  "narrative_state.schema.json": "86229431d42b6a74a2cefe1cec1a9c7894f65bdcf3445dadee3b486faa0e5abb",
  "qa_report.schema.json": "d0e372d88543777c7386d939f9f99ac03a16f110fe12c4c3feb2588713dfd6b0",
  "reader_sim_report.schema.json": "88d0c4c29ed0bc920f162346b4dcbceb02f53e44536a5a20ec1ef2a99170315c",
  "setpiece_plan.schema.json": "d47f24d4af9ef745df7c79fc937b340d7caf436724a5ead50627ddb9043d8c80",
  "slide_block.schema.json": "3645c6d9e0b2024656536361bf1ec4747150887c0edf38c9485e1b03a7ce1e46",
  "truth_model.schema.json": "193a89566bed9b9fb2b08a89816d1970e054008ea0f5b32e593f7fc10cfa10e2"
} as const;

export const V2CanonicalSchemas = {
  "clue_graph.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "ClueGraph",
    "description": "All clues, red herrings, exhibits, and twist-support mapping used to build a fair-play, story-dominant deck.",
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "schema_version": {
        "type": "string",
        "description": "Schema version."
      },
      "exhibits": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "exhibit_id": {
              "type": "string",
              "description": "EX-01."
            },
            "type": {
              "type": "string",
              "enum": [
                "labs_trend",
                "imaging_panel",
                "histo_zoom",
                "pathway_map",
                "differential_board",
                "timeline_rail",
                "vitals_strip",
                "medication_timeline",
                "micro_terrain_map",
                "other"
              ]
            },
            "title": {
              "type": "string",
              "description": "Short title."
            },
            "purpose": {
              "type": "string",
              "description": "What question this exhibit answers."
            },
            "data_fields": {
              "type": "array",
              "items": {
                "type": "string",
                "description": "Key data fields displayed (e.g., WBC, LDH)."
              }
            },
            "how_it_is_visualized": {
              "type": "string",
              "description": "Visual description (sparklines, zoom boxes, etc.)."
            },
            "produced_on_slide_id": {
              "type": "string",
              "description": "Slide where exhibit first appears."
            },
            "citations": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "citation_id": {
                    "type": "string",
                    "description": "ID of a source in citations[] (e.g., CIT-01)."
                  },
                  "chunk_id": {
                    "type": "string",
                    "description": "Optional chunk locator within the source (e.g., CH-014)."
                  },
                  "locator": {
                    "type": "string",
                    "description": "Optional human-readable locator (chapter/section/page)."
                  },
                  "claim": {
                    "type": "string",
                    "description": "What this citation supports (brief)."
                  }
                },
                "additionalProperties": false,
                "required": [
                  "citation_id",
                  "claim"
                ],
                "title": "CitationRef"
              }
            }
          },
          "additionalProperties": false,
          "required": [
            "exhibit_id",
            "type",
            "title",
            "purpose",
            "produced_on_slide_id",
            "citations"
          ],
          "title": "Exhibit"
        }
      },
      "clues": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "clue_id": {
              "type": "string",
              "description": "C1, C2, ..."
            },
            "macro_or_micro": {
              "type": "string",
              "enum": [
                "macro",
                "micro"
              ]
            },
            "observed": {
              "type": "string",
              "description": "What the audience sees/hears (on slide/exhibit)."
            },
            "where_found": {
              "type": "string",
              "description": "Where/when found (macro location or micro zone)."
            },
            "acquisition_method": {
              "type": "string",
              "enum": [
                "history",
                "physical_exam",
                "lab",
                "imaging",
                "biopsy_path",
                "bedside_test",
                "micro_observation",
                "intervention_response",
                "other"
              ]
            },
            "wrong_inference": {
              "type": "string",
              "description": "Tempting but wrong conclusion."
            },
            "correct_inference": {
              "type": "string",
              "description": "Correct conclusion."
            },
            "implicates_dx_ids": {
              "type": "array",
              "items": {
                "type": "string",
                "description": "DX ids implicated."
              }
            },
            "eliminates_dx_ids": {
              "type": "array",
              "items": {
                "type": "string",
                "description": "DX ids eliminated."
              }
            },
            "first_seen_slide_id": {
              "type": "string",
              "description": "Slide where clue appears."
            },
            "payoff_slide_id": {
              "type": "string",
              "description": "Slide where clue's meaning pays off."
            },
            "associated_exhibit_ids": {
              "type": "array",
              "items": {
                "type": "string",
                "description": "Exhibit IDs supporting it."
              }
            },
            "dossier_citations": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "citation_id": {
                    "type": "string",
                    "description": "ID of a source in citations[] (e.g., CIT-01)."
                  },
                  "chunk_id": {
                    "type": "string",
                    "description": "Optional chunk locator within the source (e.g., CH-014)."
                  },
                  "locator": {
                    "type": "string",
                    "description": "Optional human-readable locator (chapter/section/page)."
                  },
                  "claim": {
                    "type": "string",
                    "description": "What this citation supports (brief)."
                  }
                },
                "additionalProperties": false,
                "required": [
                  "citation_id",
                  "claim"
                ],
                "title": "CitationRef"
              }
            }
          },
          "additionalProperties": false,
          "required": [
            "clue_id",
            "macro_or_micro",
            "observed",
            "wrong_inference",
            "correct_inference",
            "first_seen_slide_id",
            "payoff_slide_id",
            "dossier_citations"
          ],
          "title": "Clue"
        }
      },
      "red_herrings": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "rh_id": {
              "type": "string",
              "description": "RH1, RH2, ..."
            },
            "suggests_dx_id": {
              "type": "string",
              "description": "DX id suggested by the red herring."
            },
            "why_believable": {
              "type": "string",
              "description": "Why a smart investigator might believe it."
            },
            "rooted_truth": {
              "type": "string",
              "description": "What is actually true (non-final explanation) that makes it believable."
            },
            "associated_clue_ids": {
              "type": "array",
              "items": {
                "type": "string",
                "description": "Clues that feed the herring."
              }
            },
            "payoff_slide_id": {
              "type": "string",
              "description": "Slide where it's explained/cleared."
            },
            "how_it_advances_story": {
              "type": "string",
              "description": "Character conflict, stakes, set-piece, etc."
            },
            "dossier_citations": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "citation_id": {
                    "type": "string",
                    "description": "ID of a source in citations[] (e.g., CIT-01)."
                  },
                  "chunk_id": {
                    "type": "string",
                    "description": "Optional chunk locator within the source (e.g., CH-014)."
                  },
                  "locator": {
                    "type": "string",
                    "description": "Optional human-readable locator (chapter/section/page)."
                  },
                  "claim": {
                    "type": "string",
                    "description": "What this citation supports (brief)."
                  }
                },
                "additionalProperties": false,
                "required": [
                  "citation_id",
                  "claim"
                ],
                "title": "CitationRef"
              }
            }
          },
          "additionalProperties": false,
          "required": [
            "rh_id",
            "suggests_dx_id",
            "why_believable",
            "rooted_truth",
            "payoff_slide_id",
            "dossier_citations"
          ],
          "title": "RedHerring"
        }
      },
      "twist_support_matrix": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "twist_id": {
              "type": "string",
              "description": "Twist id from TruthModel."
            },
            "supporting_clue_ids": {
              "type": "array",
              "items": {
                "type": "string",
                "description": "Clues supporting this twist."
              }
            },
            "recontextualized_slide_ids": {
              "type": "array",
              "items": {
                "type": "string",
                "description": "Earlier slides whose meaning changes."
              }
            },
            "act1_setup_clue_ids": {
              "type": "array",
              "items": {
                "type": "string",
                "description": "Must include at least one clue from Act I."
              }
            }
          },
          "additionalProperties": false,
          "required": [
            "twist_id",
            "supporting_clue_ids",
            "recontextualized_slide_ids",
            "act1_setup_clue_ids"
          ],
          "title": "TwistSupport"
        }
      },
      "constraints": {
        "type": "object",
        "properties": {
          "one_major_med_concept_per_story_slide": {
            "type": "boolean"
          },
          "min_clues_per_twist": {
            "type": "integer"
          },
          "require_act1_setup": {
            "type": "boolean"
          }
        },
        "additionalProperties": false,
        "required": [
          "one_major_med_concept_per_story_slide",
          "min_clues_per_twist",
          "require_act1_setup"
        ]
      },
      "citations_used": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "citation_id": {
              "type": "string",
              "description": "ID of a source in citations[] (e.g., CIT-01)."
            },
            "chunk_id": {
              "type": "string",
              "description": "Optional chunk locator within the source (e.g., CH-014)."
            },
            "locator": {
              "type": "string",
              "description": "Optional human-readable locator (chapter/section/page)."
            },
            "claim": {
              "type": "string",
              "description": "What this citation supports (brief)."
            }
          },
          "additionalProperties": false,
          "required": [
            "citation_id",
            "claim"
          ],
          "title": "CitationRef"
        }
      }
    },
    "required": [
      "schema_version",
      "exhibits",
      "clues",
      "red_herrings",
      "twist_support_matrix",
      "constraints",
      "citations_used"
    ]
  },
  "deck_cohesion_pass.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "DeckCohesionPass",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "schema_version",
      "global_continuity_findings",
      "act_obligation_gaps",
      "must_fix_operations",
      "narrative_risk_flags"
    ],
    "properties": {
      "schema_version": {
        "type": "string",
        "minLength": 1
      },
      "global_continuity_findings": {
        "type": "array",
        "minItems": 1,
        "items": {
          "type": "string",
          "minLength": 1
        }
      },
      "act_obligation_gaps": {
        "type": "array",
        "items": {
          "type": "string",
          "minLength": 1
        }
      },
      "must_fix_operations": {
        "type": "array",
        "items": {
          "type": "object"
        }
      },
      "narrative_risk_flags": {
        "type": "array",
        "items": {
          "type": "string",
          "minLength": 1
        }
      }
    }
  },
  "deck_spec.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "DeckSpec",
    "description": "Slide-by-slide specification for the main narrative deck + optional appendix. Story beats define slide count; medical depth is layered via exhibits/notes/appendix.",
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "deck_meta": {
        "type": "object",
        "properties": {
          "schema_version": {
            "type": "string",
            "description": "Schema version."
          },
          "episode_slug": {
            "type": "string",
            "description": "Short slug for filenames."
          },
          "episode_title": {
            "type": "string",
            "description": "Deck title."
          },
          "deck_length_main": {
            "type": "string",
            "enum": [
              "30",
              "45",
              "60"
            ]
          },
          "tone": {
            "type": "string",
            "enum": [
              "noir",
              "brisk",
              "comedic_dry",
              "thriller",
              "awe"
            ]
          },
          "audience_level": {
            "type": "string",
            "enum": [
              "PHYSICIAN_LEVEL",
              "COLLEGE_LEVEL",
              "PHYSICIAN_LEVEL"
            ]
          },
          "story_dominance_target_ratio": {
            "type": "number",
            "description": "Target ratio of story slides in main deck (e.g., 0.7)."
          },
          "max_words_on_slide": {
            "type": "integer",
            "description": "Maximum on-slide words (enforced by linter)."
          },
          "one_major_med_concept_per_slide": {
            "type": "boolean"
          },
          "appendix_unlimited": {
            "type": "boolean"
          }
        },
        "additionalProperties": false,
        "required": [
          "schema_version",
          "episode_slug",
          "episode_title",
          "deck_length_main",
          "tone",
          "audience_level",
          "story_dominance_target_ratio",
          "max_words_on_slide",
          "one_major_med_concept_per_slide",
          "appendix_unlimited"
        ],
        "title": "DeckMeta"
      },
      "characters": {
        "type": "object",
        "properties": {
          "detective": {
            "type": "object",
            "properties": {
              "name": {
                "type": "string"
              },
              "species_or_origin": {
                "type": "string",
                "description": "Alien origin/affiliation."
              },
              "voice_style": {
                "type": "string",
                "description": "How they speak."
              },
              "competency": {
                "type": "string",
                "description": "Core skill."
              },
              "blind_spot": {
                "type": "string",
                "description": "Core weakness."
              }
            },
            "additionalProperties": false,
            "required": [
              "name",
              "species_or_origin",
              "voice_style",
              "competency",
              "blind_spot"
            ]
          },
          "deputy": {
            "type": "object",
            "properties": {
              "name": {
                "type": "string"
              },
              "species_or_origin": {
                "type": "string"
              },
              "voice_style": {
                "type": "string"
              },
              "competency": {
                "type": "string"
              },
              "blind_spot": {
                "type": "string"
              }
            },
            "additionalProperties": false,
            "required": [
              "name",
              "species_or_origin",
              "voice_style",
              "competency",
              "blind_spot"
            ]
          },
          "patient": {
            "type": "object",
            "properties": {
              "label": {
                "type": "string",
                "description": "How patient is referenced on slides."
              },
              "macro_context": {
                "type": "string",
                "description": "Setting context (ER, ICU, clinic)."
              }
            },
            "additionalProperties": false,
            "required": [
              "label",
              "macro_context"
            ]
          },
          "macro_supporting_cast": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "role": {
                  "type": "string",
                  "description": "Clinician role."
                },
                "name_or_label": {
                  "type": "string",
                  "description": "Name or label."
                },
                "function": {
                  "type": "string",
                  "description": "Story function."
                }
              },
              "additionalProperties": false,
              "required": [
                "role",
                "name_or_label",
                "function"
              ]
            }
          }
        },
        "additionalProperties": false,
        "required": [
          "detective",
          "deputy",
          "patient",
          "macro_supporting_cast"
        ],
        "title": "CharacterSpec"
      },
      "acts": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "act_id": {
              "type": "string",
              "enum": [
                "ACT1",
                "ACT2",
                "ACT3",
                "ACT4"
              ]
            },
            "name": {
              "type": "string",
              "description": "Act name."
            },
            "slide_start": {
              "type": "integer",
              "description": "1-indexed start slide number in main deck."
            },
            "slide_end": {
              "type": "integer",
              "description": "1-indexed end slide number in main deck."
            },
            "act_goal": {
              "type": "string",
              "description": "What this act must accomplish narratively."
            },
            "required_pressure_channels": {
              "type": "array",
              "items": {
                "type": "string",
                "enum": [
                  "physical",
                  "institutional",
                  "relational",
                  "moral"
                ]
              }
            }
          },
          "additionalProperties": false,
          "required": [
            "act_id",
            "name",
            "slide_start",
            "slide_end",
            "act_goal",
            "required_pressure_channels"
          ],
          "title": "ActSpec"
        }
      },
      "slides": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "slide_id": {
              "type": "string",
              "description": "S01.."
            },
            "act_id": {
              "type": "string",
              "enum": [
                "ACT1",
                "ACT2",
                "ACT3",
                "ACT4",
                "APPENDIX"
              ]
            },
            "beat_type": {
              "type": "string",
              "enum": [
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
              ]
            },
            "template_id": {
              "type": "string",
              "enum": [
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
              ]
            },
            "title": {
              "type": "string",
              "description": "Internal title."
            },
            "on_slide_text": {
              "type": "object",
              "properties": {
                "headline": {
                  "type": "string",
                  "description": "Short headline."
                },
                "subtitle": {
                  "type": "string",
                  "description": "Short subtitle."
                },
                "callouts": {
                  "type": "array",
                  "items": {
                    "type": "string",
                    "description": "Very short callouts anchored to visuals."
                  }
                },
                "labels": {
                  "type": "array",
                  "items": {
                    "type": "string",
                    "description": "Optional micro labels: molecules/cells; keep minimal."
                  }
                }
              },
              "additionalProperties": false,
              "required": [
                "headline"
              ],
              "title": "OnSlideText"
            },
            "visual_description": {
              "type": "string",
              "description": "Describe what appears on the slide visually."
            },
            "exhibit_ids": {
              "type": "array",
              "items": {
                "type": "string",
                "description": "Exhibit IDs shown on slide."
              }
            },
            "story_panel": {
              "type": "object",
              "properties": {
                "goal": {
                  "type": "string",
                  "description": "What the protagonist(s) want in this slide."
                },
                "opposition": {
                  "type": "string",
                  "description": "What blocks them."
                },
                "turn": {
                  "type": "string",
                  "description": "What changes (reversal, new info, setback)."
                },
                "decision": {
                  "type": "string",
                  "description": "What they decide/do next because of the turn."
                },
                "consequence": {
                  "type": "string",
                  "description": "Immediate consequence that raises stakes or opens the next question."
                }
              },
              "additionalProperties": false,
              "required": [
                "goal",
                "opposition",
                "turn",
                "decision"
              ],
              "title": "StoryPanel"
            },
            "medical_payload": {
              "type": "object",
              "properties": {
                "major_concept_id": {
                  "type": "string",
                  "description": "Concept ID introduced (or 'NONE' if no new concept on this slide)."
                },
                "supporting_details": {
                  "type": "array",
                  "items": {
                    "type": "string",
                    "description": "Up to 2 short details."
                  }
                },
                "delivery_mode": {
                  "type": "string",
                  "enum": [
                    "clue",
                    "exhibit",
                    "dialogue",
                    "action",
                    "note_only",
                    "none"
                  ]
                },
                "linked_learning_objectives": {
                  "type": "array",
                  "items": {
                    "type": "string",
                    "description": "LO ids satisfied (may be empty)."
                  }
                },
                "dossier_citations": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "citation_id": {
                        "type": "string",
                        "description": "ID of a source in citations[] (e.g., CIT-01)."
                      },
                      "chunk_id": {
                        "type": "string",
                        "description": "Optional chunk locator within the source (e.g., CH-014)."
                      },
                      "locator": {
                        "type": "string",
                        "description": "Optional human-readable locator (chapter/section/page)."
                      },
                      "claim": {
                        "type": "string",
                        "description": "What this citation supports (brief)."
                      }
                    },
                    "additionalProperties": false,
                    "required": [
                      "citation_id",
                      "claim"
                    ],
                    "title": "CitationRef"
                  }
                }
              },
              "additionalProperties": false,
              "required": [
                "major_concept_id",
                "delivery_mode",
                "dossier_citations"
              ],
              "title": "MedicalPayload"
            },
            "pressure_channels_advanced": {
              "type": "array",
              "items": {
                "type": "string",
                "enum": [
                  "physical",
                  "institutional",
                  "relational",
                  "moral"
                ]
              }
            },
            "hook": {
              "type": "string",
              "description": "What question/impulse pulls to next slide."
            },
            "appendix_links": {
              "type": "array",
              "items": {
                "type": "string",
                "description": "Appendix slide ids for deeper details."
              }
            },
            "speaker_notes": {
              "type": "object",
              "properties": {
                "narrative_notes": {
                  "type": "string",
                  "description": "Optional: what to say narratively."
                },
                "medical_reasoning": {
                  "type": "string",
                  "description": "Med-school level reasoning: mechanism, ddx, why tests matter."
                },
                "what_this_slide_teaches": {
                  "type": "array",
                  "items": {
                    "type": "string",
                    "description": "Key takeaways (optional)."
                  }
                },
                "differential_update": {
                  "type": "object",
                  "properties": {
                    "top_dx_ids": {
                      "type": "array",
                      "items": {
                        "type": "string",
                        "description": "Current top differentials."
                      }
                    },
                    "eliminated_dx_ids": {
                      "type": "array",
                      "items": {
                        "type": "string",
                        "description": "Eliminated this slide."
                      }
                    },
                    "why": {
                      "type": "string",
                      "description": "1–3 sentence reasoning for the update."
                    }
                  },
                  "additionalProperties": false,
                  "required": [
                    "top_dx_ids",
                    "eliminated_dx_ids",
                    "why"
                  ],
                  "title": "DifferentialUpdate"
                },
                "citations": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "citation_id": {
                        "type": "string",
                        "description": "ID of a source in citations[] (e.g., CIT-01)."
                      },
                      "chunk_id": {
                        "type": "string",
                        "description": "Optional chunk locator within the source (e.g., CH-014)."
                      },
                      "locator": {
                        "type": "string",
                        "description": "Optional human-readable locator (chapter/section/page)."
                      },
                      "claim": {
                        "type": "string",
                        "description": "What this citation supports (brief)."
                      }
                    },
                    "additionalProperties": false,
                    "required": [
                      "citation_id",
                      "claim"
                    ],
                    "title": "CitationRef"
                  }
                }
              },
              "additionalProperties": false,
              "required": [
                "medical_reasoning",
                "differential_update",
                "citations"
              ],
              "title": "SpeakerNotes"
            }
          },
          "additionalProperties": false,
          "required": [
            "slide_id",
            "act_id",
            "beat_type",
            "template_id",
            "on_slide_text",
            "visual_description",
            "story_panel",
            "medical_payload",
            "hook",
            "speaker_notes"
          ],
          "title": "SlideSpec"
        }
      },
      "appendix_slides": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "slide_id": {
              "type": "string",
              "description": "S01.."
            },
            "act_id": {
              "type": "string",
              "enum": [
                "ACT1",
                "ACT2",
                "ACT3",
                "ACT4",
                "APPENDIX"
              ]
            },
            "beat_type": {
              "type": "string",
              "enum": [
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
              ]
            },
            "template_id": {
              "type": "string",
              "enum": [
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
              ]
            },
            "title": {
              "type": "string",
              "description": "Internal title."
            },
            "on_slide_text": {
              "type": "object",
              "properties": {
                "headline": {
                  "type": "string",
                  "description": "Short headline."
                },
                "subtitle": {
                  "type": "string",
                  "description": "Short subtitle."
                },
                "callouts": {
                  "type": "array",
                  "items": {
                    "type": "string",
                    "description": "Very short callouts anchored to visuals."
                  }
                },
                "labels": {
                  "type": "array",
                  "items": {
                    "type": "string",
                    "description": "Optional micro labels: molecules/cells; keep minimal."
                  }
                }
              },
              "additionalProperties": false,
              "required": [
                "headline"
              ],
              "title": "OnSlideText"
            },
            "visual_description": {
              "type": "string",
              "description": "Describe what appears on the slide visually."
            },
            "exhibit_ids": {
              "type": "array",
              "items": {
                "type": "string",
                "description": "Exhibit IDs shown on slide."
              }
            },
            "story_panel": {
              "type": "object",
              "properties": {
                "goal": {
                  "type": "string",
                  "description": "What the protagonist(s) want in this slide."
                },
                "opposition": {
                  "type": "string",
                  "description": "What blocks them."
                },
                "turn": {
                  "type": "string",
                  "description": "What changes (reversal, new info, setback)."
                },
                "decision": {
                  "type": "string",
                  "description": "What they decide/do next because of the turn."
                },
                "consequence": {
                  "type": "string",
                  "description": "Immediate consequence that raises stakes or opens the next question."
                }
              },
              "additionalProperties": false,
              "required": [
                "goal",
                "opposition",
                "turn",
                "decision"
              ],
              "title": "StoryPanel"
            },
            "medical_payload": {
              "type": "object",
              "properties": {
                "major_concept_id": {
                  "type": "string",
                  "description": "Concept ID introduced (or 'NONE' if no new concept on this slide)."
                },
                "supporting_details": {
                  "type": "array",
                  "items": {
                    "type": "string",
                    "description": "Up to 2 short details."
                  }
                },
                "delivery_mode": {
                  "type": "string",
                  "enum": [
                    "clue",
                    "exhibit",
                    "dialogue",
                    "action",
                    "note_only",
                    "none"
                  ]
                },
                "linked_learning_objectives": {
                  "type": "array",
                  "items": {
                    "type": "string",
                    "description": "LO ids satisfied (may be empty)."
                  }
                },
                "dossier_citations": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "citation_id": {
                        "type": "string",
                        "description": "ID of a source in citations[] (e.g., CIT-01)."
                      },
                      "chunk_id": {
                        "type": "string",
                        "description": "Optional chunk locator within the source (e.g., CH-014)."
                      },
                      "locator": {
                        "type": "string",
                        "description": "Optional human-readable locator (chapter/section/page)."
                      },
                      "claim": {
                        "type": "string",
                        "description": "What this citation supports (brief)."
                      }
                    },
                    "additionalProperties": false,
                    "required": [
                      "citation_id",
                      "claim"
                    ],
                    "title": "CitationRef"
                  }
                }
              },
              "additionalProperties": false,
              "required": [
                "major_concept_id",
                "delivery_mode",
                "dossier_citations"
              ],
              "title": "MedicalPayload"
            },
            "pressure_channels_advanced": {
              "type": "array",
              "items": {
                "type": "string",
                "enum": [
                  "physical",
                  "institutional",
                  "relational",
                  "moral"
                ]
              }
            },
            "hook": {
              "type": "string",
              "description": "What question/impulse pulls to next slide."
            },
            "appendix_links": {
              "type": "array",
              "items": {
                "type": "string",
                "description": "Appendix slide ids for deeper details."
              }
            },
            "speaker_notes": {
              "type": "object",
              "properties": {
                "narrative_notes": {
                  "type": "string",
                  "description": "Optional: what to say narratively."
                },
                "medical_reasoning": {
                  "type": "string",
                  "description": "Med-school level reasoning: mechanism, ddx, why tests matter."
                },
                "what_this_slide_teaches": {
                  "type": "array",
                  "items": {
                    "type": "string",
                    "description": "Key takeaways (optional)."
                  }
                },
                "differential_update": {
                  "type": "object",
                  "properties": {
                    "top_dx_ids": {
                      "type": "array",
                      "items": {
                        "type": "string",
                        "description": "Current top differentials."
                      }
                    },
                    "eliminated_dx_ids": {
                      "type": "array",
                      "items": {
                        "type": "string",
                        "description": "Eliminated this slide."
                      }
                    },
                    "why": {
                      "type": "string",
                      "description": "1–3 sentence reasoning for the update."
                    }
                  },
                  "additionalProperties": false,
                  "required": [
                    "top_dx_ids",
                    "eliminated_dx_ids",
                    "why"
                  ],
                  "title": "DifferentialUpdate"
                },
                "citations": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "citation_id": {
                        "type": "string",
                        "description": "ID of a source in citations[] (e.g., CIT-01)."
                      },
                      "chunk_id": {
                        "type": "string",
                        "description": "Optional chunk locator within the source (e.g., CH-014)."
                      },
                      "locator": {
                        "type": "string",
                        "description": "Optional human-readable locator (chapter/section/page)."
                      },
                      "claim": {
                        "type": "string",
                        "description": "What this citation supports (brief)."
                      }
                    },
                    "additionalProperties": false,
                    "required": [
                      "citation_id",
                      "claim"
                    ],
                    "title": "CitationRef"
                  }
                }
              },
              "additionalProperties": false,
              "required": [
                "medical_reasoning",
                "differential_update",
                "citations"
              ],
              "title": "SpeakerNotes"
            }
          },
          "additionalProperties": false,
          "required": [
            "slide_id",
            "act_id",
            "beat_type",
            "template_id",
            "on_slide_text",
            "visual_description",
            "story_panel",
            "medical_payload",
            "hook",
            "speaker_notes"
          ],
          "title": "SlideSpec"
        }
      }
    },
    "required": [
      "deck_meta",
      "characters",
      "acts",
      "slides",
      "appendix_slides"
    ]
  },
  "differential_cast.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "DifferentialCast",
    "description": "Differential diagnosis suspects cast + planned rotation and elimination milestones for the story.",
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "schema_version": {
        "type": "string",
        "description": "Schema version."
      },
      "primary_suspects": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "dx_id": {
              "type": "string",
              "description": "DX id."
            },
            "name": {
              "type": "string",
              "description": "Diagnosis name."
            },
            "why_tempting": {
              "type": "string",
              "description": "Why plausible to a smart clinician."
            },
            "signature_fingerprint": {
              "type": "string",
              "description": "Mechanism/tissue signature."
            },
            "timeline_signature": {
              "type": "string",
              "description": "Typical timing (acute/subacute/chronic)."
            },
            "localization_logic": {
              "type": "string",
              "description": "Why it affects particular tissue/organ."
            },
            "key_discriminators": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "type": {
                    "type": "string",
                    "enum": [
                      "positive",
                      "negative",
                      "temporal",
                      "response_to_treatment",
                      "imaging",
                      "micro"
                    ]
                  },
                  "statement": {
                    "type": "string",
                    "description": "Discriminator."
                  },
                  "why_it_matters": {
                    "type": "string",
                    "description": "How it rules in/out."
                  },
                  "citations": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "properties": {
                        "citation_id": {
                          "type": "string",
                          "description": "ID of a source in citations[] (e.g., CIT-01)."
                        },
                        "chunk_id": {
                          "type": "string",
                          "description": "Optional chunk locator within the source (e.g., CH-014)."
                        },
                        "locator": {
                          "type": "string",
                          "description": "Optional human-readable locator (chapter/section/page)."
                        },
                        "claim": {
                          "type": "string",
                          "description": "What this citation supports (brief)."
                        }
                      },
                      "additionalProperties": false,
                      "required": [
                        "citation_id",
                        "claim"
                      ],
                      "title": "CitationRef"
                    }
                  }
                },
                "additionalProperties": false,
                "required": [
                  "type",
                  "statement",
                  "citations"
                ]
              }
            },
            "danger_if_wrong": {
              "type": "string",
              "description": "Risk of anchoring on this dx incorrectly."
            },
            "what_it_mimics": {
              "type": "array",
              "items": {
                "type": "string",
                "description": "Other DX ids it mimics/frames."
              }
            },
            "citations": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "citation_id": {
                    "type": "string",
                    "description": "ID of a source in citations[] (e.g., CIT-01)."
                  },
                  "chunk_id": {
                    "type": "string",
                    "description": "Optional chunk locator within the source (e.g., CH-014)."
                  },
                  "locator": {
                    "type": "string",
                    "description": "Optional human-readable locator (chapter/section/page)."
                  },
                  "claim": {
                    "type": "string",
                    "description": "What this citation supports (brief)."
                  }
                },
                "additionalProperties": false,
                "required": [
                  "citation_id",
                  "claim"
                ],
                "title": "CitationRef"
              }
            }
          },
          "additionalProperties": false,
          "required": [
            "dx_id",
            "name",
            "why_tempting",
            "signature_fingerprint",
            "citations"
          ],
          "title": "DxSuspect"
        }
      },
      "rotation_plan": {
        "type": "object",
        "properties": {
          "act1_focus_dx_ids": {
            "type": "array",
            "items": {
              "type": "string",
              "description": "DX ids emphasized in Act I."
            }
          },
          "act2_expansion_dx_ids": {
            "type": "array",
            "items": {
              "type": "string",
              "description": "New suspects introduced Act II."
            }
          },
          "act3_collapse_dx_ids": {
            "type": "array",
            "items": {
              "type": "string",
              "description": "Suspects eliminated/false theory collapses Act III."
            }
          },
          "act4_final_dx_id": {
            "type": "string",
            "description": "Final diagnosis dx id."
          }
        },
        "additionalProperties": false,
        "required": [
          "act4_final_dx_id"
        ]
      },
      "elimination_milestones": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "milestone_id": {
              "type": "string",
              "description": "MS-01."
            },
            "slide_id": {
              "type": "string",
              "description": "Slide where elimination is shown."
            },
            "eliminated_dx_ids": {
              "type": "array",
              "items": {
                "type": "string",
                "description": "Eliminated suspects."
              }
            },
            "evidence_clue_ids": {
              "type": "array",
              "items": {
                "type": "string",
                "description": "Clue IDs justifying elimination."
              }
            },
            "reasoning_summary": {
              "type": "string",
              "description": "One-paragraph reasoning."
            },
            "citations": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "citation_id": {
                    "type": "string",
                    "description": "ID of a source in citations[] (e.g., CIT-01)."
                  },
                  "chunk_id": {
                    "type": "string",
                    "description": "Optional chunk locator within the source (e.g., CH-014)."
                  },
                  "locator": {
                    "type": "string",
                    "description": "Optional human-readable locator (chapter/section/page)."
                  },
                  "claim": {
                    "type": "string",
                    "description": "What this citation supports (brief)."
                  }
                },
                "additionalProperties": false,
                "required": [
                  "citation_id",
                  "claim"
                ],
                "title": "CitationRef"
              }
            }
          },
          "additionalProperties": false,
          "required": [
            "milestone_id",
            "slide_id",
            "eliminated_dx_ids",
            "evidence_clue_ids",
            "citations"
          ]
        }
      },
      "citations_used": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "citation_id": {
              "type": "string",
              "description": "ID of a source in citations[] (e.g., CIT-01)."
            },
            "chunk_id": {
              "type": "string",
              "description": "Optional chunk locator within the source (e.g., CH-014)."
            },
            "locator": {
              "type": "string",
              "description": "Optional human-readable locator (chapter/section/page)."
            },
            "claim": {
              "type": "string",
              "description": "What this citation supports (brief)."
            }
          },
          "additionalProperties": false,
          "required": [
            "citation_id",
            "claim"
          ],
          "title": "CitationRef"
        }
      }
    },
    "required": [
      "schema_version",
      "primary_suspects",
      "rotation_plan",
      "citations_used"
    ]
  },
  "disease_dossier.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "DiseaseDossier",
    "description": "Grounded, citation-backed medical dossier for one disease-case episode. Use as the only source of truth for medical facts.",
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "schema_version": {
        "type": "string",
        "description": "Schema version, e.g., 1.0.0."
      },
      "created_at": {
        "type": "string",
        "description": "ISO-8601 timestamp."
      },
      "disease_request": {
        "type": "object",
        "properties": {
          "disease_topic": {
            "type": "string",
            "description": "User-provided topic prompt."
          },
          "target_level": {
            "type": "string",
            "enum": [
              "PHYSICIAN_LEVEL",
              "COLLEGE_LEVEL",
              "PHYSICIAN_LEVEL"
            ]
          },
          "setting_focus": {
            "type": "string",
            "enum": [
              "lung",
              "kidney",
              "neuro",
              "heme",
              "gi",
              "cardio",
              "derm",
              "rheum",
              "multi_system",
              "other"
            ]
          },
          "constraints": {
            "type": "array",
            "items": {
              "type": "string",
              "description": "Additional constraints, e.g., 'no gore', 'more action set-pieces'."
            }
          }
        },
        "additionalProperties": false,
        "required": [
          "disease_topic",
          "target_level",
          "setting_focus",
          "constraints"
        ]
      },
      "canonical_name": {
        "type": "string",
        "description": "Canonical disease name."
      },
      "aliases": {
        "type": "array",
        "items": {
          "type": "string",
          "description": "Alternative names/abbreviations."
        }
      },
      "variants": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "name": {
              "type": "string",
              "description": "Variant name."
            },
            "notes": {
              "type": "string",
              "description": "Clinically important differences."
            },
            "citations": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "citation_id": {
                    "type": "string",
                    "description": "ID of a source in citations[] (e.g., CIT-01)."
                  },
                  "chunk_id": {
                    "type": "string",
                    "description": "Optional chunk locator within the source (e.g., CH-014)."
                  },
                  "locator": {
                    "type": "string",
                    "description": "Optional human-readable locator (chapter/section/page)."
                  },
                  "claim": {
                    "type": "string",
                    "description": "What this citation supports (brief)."
                  }
                },
                "additionalProperties": false,
                "required": [
                  "citation_id",
                  "claim"
                ],
                "title": "CitationRef"
              }
            }
          },
          "additionalProperties": false,
          "required": [
            "name",
            "citations"
          ]
        }
      },
      "epidemiology": {
        "type": "object",
        "properties": {
          "prevalence_context": {
            "type": "string",
            "description": "High-level prevalence/incidence notes."
          },
          "risk_factors": {
            "type": "array",
            "items": {
              "type": "string",
              "description": "Key risk factors relevant to plot/differential."
            }
          },
          "typical_age_range": {
            "type": "string",
            "description": "Typical age range."
          },
          "sex_skew": {
            "type": "string",
            "description": "Sex distribution notes."
          },
          "geography_notes": {
            "type": "string",
            "description": "Geographic/seasonal notes if relevant."
          },
          "citations": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "citation_id": {
                  "type": "string",
                  "description": "ID of a source in citations[] (e.g., CIT-01)."
                },
                "chunk_id": {
                  "type": "string",
                  "description": "Optional chunk locator within the source (e.g., CH-014)."
                },
                "locator": {
                  "type": "string",
                  "description": "Optional human-readable locator (chapter/section/page)."
                },
                "claim": {
                  "type": "string",
                  "description": "What this citation supports (brief)."
                }
              },
              "additionalProperties": false,
              "required": [
                "citation_id",
                "claim"
              ],
              "title": "CitationRef"
            }
          }
        },
        "additionalProperties": false,
        "required": [
          "citations"
        ]
      },
      "learning_objectives": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "objective_id": {
              "type": "string",
              "description": "Stable id, e.g., LO-01."
            },
            "statement": {
              "type": "string",
              "description": "What the learner should understand."
            },
            "priority": {
              "type": "string",
              "enum": [
                "must_have",
                "nice_to_have"
              ]
            },
            "mapped_concepts": {
              "type": "array",
              "items": {
                "type": "string",
                "description": "Concept IDs that fulfill this objective."
              }
            },
            "citations": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "citation_id": {
                    "type": "string",
                    "description": "ID of a source in citations[] (e.g., CIT-01)."
                  },
                  "chunk_id": {
                    "type": "string",
                    "description": "Optional chunk locator within the source (e.g., CH-014)."
                  },
                  "locator": {
                    "type": "string",
                    "description": "Optional human-readable locator (chapter/section/page)."
                  },
                  "claim": {
                    "type": "string",
                    "description": "What this citation supports (brief)."
                  }
                },
                "additionalProperties": false,
                "required": [
                  "citation_id",
                  "claim"
                ],
                "title": "CitationRef"
              }
            }
          },
          "additionalProperties": false,
          "required": [
            "objective_id",
            "statement",
            "priority",
            "mapped_concepts",
            "citations"
          ]
        }
      },
      "concept_index": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "concept_id": {
              "type": "string",
              "description": "Stable concept id, e.g., CON-IMM-001."
            },
            "name": {
              "type": "string",
              "description": "Concept name."
            },
            "summary": {
              "type": "string",
              "description": "1–3 sentence summary."
            },
            "level": {
              "type": "string",
              "enum": [
                "PHYSICIAN_LEVEL",
                "COLLEGE_LEVEL",
                "PHYSICIAN_LEVEL"
              ]
            },
            "common_mistake": {
              "type": "string",
              "description": "A common mistake or confusion point (optional)."
            },
            "citations": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "citation_id": {
                    "type": "string",
                    "description": "ID of a source in citations[] (e.g., CIT-01)."
                  },
                  "chunk_id": {
                    "type": "string",
                    "description": "Optional chunk locator within the source (e.g., CH-014)."
                  },
                  "locator": {
                    "type": "string",
                    "description": "Optional human-readable locator (chapter/section/page)."
                  },
                  "claim": {
                    "type": "string",
                    "description": "What this citation supports (brief)."
                  }
                },
                "additionalProperties": false,
                "required": [
                  "citation_id",
                  "claim"
                ],
                "title": "CitationRef"
              }
            }
          },
          "additionalProperties": false,
          "required": [
            "concept_id",
            "name",
            "summary",
            "level",
            "citations"
          ],
          "title": "Concept"
        }
      },
      "pathogenesis_steps": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "step_id": {
              "type": "string",
              "description": "Stable id, e.g., PATH-01."
            },
            "stage_name": {
              "type": "string",
              "description": "Stage name."
            },
            "time_from_trigger": {
              "type": "string",
              "description": "Time from trigger (e.g., minutes-hours, day 3–5)."
            },
            "primary_locations": {
              "type": "array",
              "items": {
                "type": "string",
                "description": "Organ/tissue/microenvironment location(s)."
              }
            },
            "key_events": {
              "type": "array",
              "items": {
                "type": "string",
                "description": "Key event."
              }
            },
            "key_players": {
              "type": "array",
              "items": {
                "type": "string",
                "description": "Cells/mediators."
              }
            },
            "expected_micro_findings": {
              "type": "array",
              "items": {
                "type": "string",
                "description": "Expected microscopic findings."
              }
            },
            "expected_macro_manifestations": {
              "type": "array",
              "items": {
                "type": "string",
                "description": "Expected clinical manifestations."
              }
            },
            "citations": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "citation_id": {
                    "type": "string",
                    "description": "ID of a source in citations[] (e.g., CIT-01)."
                  },
                  "chunk_id": {
                    "type": "string",
                    "description": "Optional chunk locator within the source (e.g., CH-014)."
                  },
                  "locator": {
                    "type": "string",
                    "description": "Optional human-readable locator (chapter/section/page)."
                  },
                  "claim": {
                    "type": "string",
                    "description": "What this citation supports (brief)."
                  }
                },
                "additionalProperties": false,
                "required": [
                  "citation_id",
                  "claim"
                ],
                "title": "CitationRef"
              }
            }
          },
          "additionalProperties": false,
          "required": [
            "step_id",
            "stage_name",
            "time_from_trigger",
            "key_events",
            "citations"
          ],
          "title": "PathogenesisStep"
        }
      },
      "key_cells_mediators": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "name": {
              "type": "string",
              "description": "Name of cell/mediator/antibody/etc."
            },
            "category": {
              "type": "string",
              "enum": [
                "cell",
                "cytokine",
                "chemokine",
                "antibody",
                "receptor",
                "enzyme",
                "toxin",
                "pathogen_factor",
                "metabolite",
                "other"
              ]
            },
            "role_in_disease": {
              "type": "string",
              "description": "Role in pathogenesis."
            },
            "notes": {
              "type": "string",
              "description": "Optional clarifying notes."
            },
            "citations": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "citation_id": {
                    "type": "string",
                    "description": "ID of a source in citations[] (e.g., CIT-01)."
                  },
                  "chunk_id": {
                    "type": "string",
                    "description": "Optional chunk locator within the source (e.g., CH-014)."
                  },
                  "locator": {
                    "type": "string",
                    "description": "Optional human-readable locator (chapter/section/page)."
                  },
                  "claim": {
                    "type": "string",
                    "description": "What this citation supports (brief)."
                  }
                },
                "additionalProperties": false,
                "required": [
                  "citation_id",
                  "claim"
                ],
                "title": "CitationRef"
              }
            }
          },
          "additionalProperties": false,
          "required": [
            "name",
            "category",
            "role_in_disease",
            "citations"
          ]
        }
      },
      "micro_findings": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "finding_id": {
              "type": "string",
              "description": "Stable id, e.g., MF-01."
            },
            "tissue": {
              "type": "string",
              "description": "Tissue/organ."
            },
            "description": {
              "type": "string",
              "description": "What is seen at micro scale (histology/ultrastructure/cell behavior)."
            },
            "modality": {
              "type": "string",
              "enum": [
                "histology",
                "immunofluorescence",
                "electron_microscopy",
                "flow_cytometry",
                "microbiology",
                "imaging_micro",
                "functional_micro",
                "other"
              ]
            },
            "supports_dx_ids": {
              "type": "array",
              "items": {
                "type": "string",
                "description": "DX ids supported."
              }
            },
            "rules_out_dx_ids": {
              "type": "array",
              "items": {
                "type": "string",
                "description": "DX ids argued against."
              }
            },
            "citations": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "citation_id": {
                    "type": "string",
                    "description": "ID of a source in citations[] (e.g., CIT-01)."
                  },
                  "chunk_id": {
                    "type": "string",
                    "description": "Optional chunk locator within the source (e.g., CH-014)."
                  },
                  "locator": {
                    "type": "string",
                    "description": "Optional human-readable locator (chapter/section/page)."
                  },
                  "claim": {
                    "type": "string",
                    "description": "What this citation supports (brief)."
                  }
                },
                "additionalProperties": false,
                "required": [
                  "citation_id",
                  "claim"
                ],
                "title": "CitationRef"
              }
            }
          },
          "additionalProperties": false,
          "required": [
            "finding_id",
            "tissue",
            "description",
            "modality",
            "citations"
          ],
          "title": "MicroFinding"
        }
      },
      "macro_presentation": {
        "type": "object",
        "properties": {
          "symptoms": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "name": {
                  "type": "string",
                  "description": "Symptom/sign."
                },
                "timing": {
                  "type": "string",
                  "description": "Onset/duration."
                },
                "severity_course": {
                  "type": "string",
                  "description": "How it evolves."
                },
                "citations": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "citation_id": {
                        "type": "string",
                        "description": "ID of a source in citations[] (e.g., CIT-01)."
                      },
                      "chunk_id": {
                        "type": "string",
                        "description": "Optional chunk locator within the source (e.g., CH-014)."
                      },
                      "locator": {
                        "type": "string",
                        "description": "Optional human-readable locator (chapter/section/page)."
                      },
                      "claim": {
                        "type": "string",
                        "description": "What this citation supports (brief)."
                      }
                    },
                    "additionalProperties": false,
                    "required": [
                      "citation_id",
                      "claim"
                    ],
                    "title": "CitationRef"
                  }
                }
              },
              "additionalProperties": false,
              "required": [
                "name",
                "citations"
              ],
              "title": "Symptom"
            }
          },
          "signs": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "name": {
                  "type": "string",
                  "description": "Symptom/sign."
                },
                "timing": {
                  "type": "string",
                  "description": "Onset/duration."
                },
                "severity_course": {
                  "type": "string",
                  "description": "How it evolves."
                },
                "citations": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "citation_id": {
                        "type": "string",
                        "description": "ID of a source in citations[] (e.g., CIT-01)."
                      },
                      "chunk_id": {
                        "type": "string",
                        "description": "Optional chunk locator within the source (e.g., CH-014)."
                      },
                      "locator": {
                        "type": "string",
                        "description": "Optional human-readable locator (chapter/section/page)."
                      },
                      "claim": {
                        "type": "string",
                        "description": "What this citation supports (brief)."
                      }
                    },
                    "additionalProperties": false,
                    "required": [
                      "citation_id",
                      "claim"
                    ],
                    "title": "CitationRef"
                  }
                }
              },
              "additionalProperties": false,
              "required": [
                "name",
                "citations"
              ],
              "title": "Symptom"
            }
          },
          "vitals_patterns": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "pattern": {
                  "type": "string",
                  "description": "Vitals pattern (e.g., fever curve, shock physiology)."
                },
                "why_it_matters": {
                  "type": "string",
                  "description": "Diagnostic/severity relevance."
                },
                "citations": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "citation_id": {
                        "type": "string",
                        "description": "ID of a source in citations[] (e.g., CIT-01)."
                      },
                      "chunk_id": {
                        "type": "string",
                        "description": "Optional chunk locator within the source (e.g., CH-014)."
                      },
                      "locator": {
                        "type": "string",
                        "description": "Optional human-readable locator (chapter/section/page)."
                      },
                      "claim": {
                        "type": "string",
                        "description": "What this citation supports (brief)."
                      }
                    },
                    "additionalProperties": false,
                    "required": [
                      "citation_id",
                      "claim"
                    ],
                    "title": "CitationRef"
                  }
                }
              },
              "additionalProperties": false,
              "required": [
                "pattern",
                "citations"
              ]
            }
          },
          "labs_core": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "name": {
                  "type": "string",
                  "description": "Lab name/panel."
                },
                "pattern": {
                  "type": "string",
                  "description": "Direction/pattern over time."
                },
                "why_it_matters": {
                  "type": "string",
                  "description": "How it updates differential or severity."
                },
                "citations": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "citation_id": {
                        "type": "string",
                        "description": "ID of a source in citations[] (e.g., CIT-01)."
                      },
                      "chunk_id": {
                        "type": "string",
                        "description": "Optional chunk locator within the source (e.g., CH-014)."
                      },
                      "locator": {
                        "type": "string",
                        "description": "Optional human-readable locator (chapter/section/page)."
                      },
                      "claim": {
                        "type": "string",
                        "description": "What this citation supports (brief)."
                      }
                    },
                    "additionalProperties": false,
                    "required": [
                      "citation_id",
                      "claim"
                    ],
                    "title": "CitationRef"
                  }
                }
              },
              "additionalProperties": false,
              "required": [
                "name",
                "pattern",
                "why_it_matters",
                "citations"
              ],
              "title": "LabPattern"
            }
          },
          "imaging_core": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "modality": {
                  "type": "string",
                  "enum": [
                    "xray",
                    "ct",
                    "mri",
                    "ultrasound",
                    "echo",
                    "angiography",
                    "nuclear",
                    "other"
                  ]
                },
                "pattern": {
                  "type": "string",
                  "description": "Key imaging pattern."
                },
                "discriminates": {
                  "type": "string",
                  "description": "How it helps differential."
                },
                "citations": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "citation_id": {
                        "type": "string",
                        "description": "ID of a source in citations[] (e.g., CIT-01)."
                      },
                      "chunk_id": {
                        "type": "string",
                        "description": "Optional chunk locator within the source (e.g., CH-014)."
                      },
                      "locator": {
                        "type": "string",
                        "description": "Optional human-readable locator (chapter/section/page)."
                      },
                      "claim": {
                        "type": "string",
                        "description": "What this citation supports (brief)."
                      }
                    },
                    "additionalProperties": false,
                    "required": [
                      "citation_id",
                      "claim"
                    ],
                    "title": "CitationRef"
                  }
                }
              },
              "additionalProperties": false,
              "required": [
                "modality",
                "pattern",
                "citations"
              ]
            }
          },
          "exam_clues": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "clue": {
                  "type": "string",
                  "description": "Physical exam clue."
                },
                "why_it_matters": {
                  "type": "string",
                  "description": "Differential relevance."
                },
                "citations": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "citation_id": {
                        "type": "string",
                        "description": "ID of a source in citations[] (e.g., CIT-01)."
                      },
                      "chunk_id": {
                        "type": "string",
                        "description": "Optional chunk locator within the source (e.g., CH-014)."
                      },
                      "locator": {
                        "type": "string",
                        "description": "Optional human-readable locator (chapter/section/page)."
                      },
                      "claim": {
                        "type": "string",
                        "description": "What this citation supports (brief)."
                      }
                    },
                    "additionalProperties": false,
                    "required": [
                      "citation_id",
                      "claim"
                    ],
                    "title": "CitationRef"
                  }
                }
              },
              "additionalProperties": false,
              "required": [
                "clue",
                "citations"
              ]
            }
          }
        },
        "additionalProperties": false
      },
      "differential": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "dx_id": {
              "type": "string",
              "description": "Stable differential id, e.g., DX-01."
            },
            "name": {
              "type": "string",
              "description": "Diagnosis name."
            },
            "why_tempting": {
              "type": "string",
              "description": "Why this diagnosis is plausible early."
            },
            "signature_fingerprint": {
              "type": "string",
              "description": "Short fingerprint of typical mechanism/pattern."
            },
            "discriminators_positive": {
              "type": "array",
              "items": {
                "type": "string",
                "description": "A positive finding that supports this dx."
              }
            },
            "discriminators_negative": {
              "type": "array",
              "items": {
                "type": "string",
                "description": "A negative finding that argues against this dx."
              }
            },
            "danger_if_wrong": {
              "type": "string",
              "description": "What goes wrong if you treat as this dx when it's not."
            },
            "citations": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "citation_id": {
                    "type": "string",
                    "description": "ID of a source in citations[] (e.g., CIT-01)."
                  },
                  "chunk_id": {
                    "type": "string",
                    "description": "Optional chunk locator within the source (e.g., CH-014)."
                  },
                  "locator": {
                    "type": "string",
                    "description": "Optional human-readable locator (chapter/section/page)."
                  },
                  "claim": {
                    "type": "string",
                    "description": "What this citation supports (brief)."
                  }
                },
                "additionalProperties": false,
                "required": [
                  "citation_id",
                  "claim"
                ],
                "title": "CitationRef"
              }
            }
          },
          "additionalProperties": false,
          "required": [
            "dx_id",
            "name",
            "why_tempting",
            "signature_fingerprint",
            "citations"
          ],
          "title": "DxCandidate"
        }
      },
      "tests_and_confounds": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "test_id": {
              "type": "string",
              "description": "Stable id, e.g., TEST-01."
            },
            "name": {
              "type": "string",
              "description": "Test name."
            },
            "what_it_measures": {
              "type": "string",
              "description": "What physiologic/pathologic variable it measures."
            },
            "expected_in_true_dx": {
              "type": "string",
              "description": "Expected result/pattern in the true diagnosis."
            },
            "common_confouders": {
              "type": "array",
              "items": {
                "type": "string",
                "description": "Confounder."
              }
            },
            "false_positive_modes": {
              "type": "array",
              "items": {
                "type": "string",
                "description": "How false positives happen."
              }
            },
            "false_negative_modes": {
              "type": "array",
              "items": {
                "type": "string",
                "description": "How false negatives happen."
              }
            },
            "interpretation_notes": {
              "type": "string",
              "description": "How to interpret in context, incl. timing."
            },
            "citations": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "citation_id": {
                    "type": "string",
                    "description": "ID of a source in citations[] (e.g., CIT-01)."
                  },
                  "chunk_id": {
                    "type": "string",
                    "description": "Optional chunk locator within the source (e.g., CH-014)."
                  },
                  "locator": {
                    "type": "string",
                    "description": "Optional human-readable locator (chapter/section/page)."
                  },
                  "claim": {
                    "type": "string",
                    "description": "What this citation supports (brief)."
                  }
                },
                "additionalProperties": false,
                "required": [
                  "citation_id",
                  "claim"
                ],
                "title": "CitationRef"
              }
            }
          },
          "additionalProperties": false,
          "required": [
            "test_id",
            "name",
            "what_it_measures",
            "expected_in_true_dx",
            "citations"
          ],
          "title": "TestAndConfound"
        }
      },
      "treatments": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "intervention_id": {
              "type": "string",
              "description": "Stable id, e.g., TX-01."
            },
            "name": {
              "type": "string",
              "description": "Intervention name."
            },
            "mechanism": {
              "type": "string",
              "description": "Mechanism of action at a clinically useful level."
            },
            "indications": {
              "type": "array",
              "items": {
                "type": "string",
                "description": "Indication."
              }
            },
            "expected_response": {
              "type": "string",
              "description": "Expected clinical response if correct diagnosis."
            },
            "time_to_response": {
              "type": "string",
              "description": "Typical time course to improvement/worsening."
            },
            "adverse_effects": {
              "type": "array",
              "items": {
                "type": "string",
                "description": "Notable adverse effects relevant to plot/differential."
              }
            },
            "how_response_informs_ddx": {
              "type": "string",
              "description": "How response or non-response updates the differential."
            },
            "citations": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "citation_id": {
                    "type": "string",
                    "description": "ID of a source in citations[] (e.g., CIT-01)."
                  },
                  "chunk_id": {
                    "type": "string",
                    "description": "Optional chunk locator within the source (e.g., CH-014)."
                  },
                  "locator": {
                    "type": "string",
                    "description": "Optional human-readable locator (chapter/section/page)."
                  },
                  "claim": {
                    "type": "string",
                    "description": "What this citation supports (brief)."
                  }
                },
                "additionalProperties": false,
                "required": [
                  "citation_id",
                  "claim"
                ],
                "title": "CitationRef"
              }
            }
          },
          "additionalProperties": false,
          "required": [
            "intervention_id",
            "name",
            "mechanism",
            "expected_response",
            "citations"
          ],
          "title": "Intervention"
        }
      },
      "misconceptions": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "misconception_id": {
              "type": "string",
              "description": "Stable id, e.g., MIS-01."
            },
            "wrong_statement": {
              "type": "string",
              "description": "Tempting but incorrect statement."
            },
            "why_tempting": {
              "type": "string",
              "description": "Why a smart person might believe it."
            },
            "correction": {
              "type": "string",
              "description": "Correct statement."
            },
            "how_it_misleads_ddx": {
              "type": "string",
              "description": "How this misconception would push the differential in the wrong direction."
            },
            "citations": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "citation_id": {
                    "type": "string",
                    "description": "ID of a source in citations[] (e.g., CIT-01)."
                  },
                  "chunk_id": {
                    "type": "string",
                    "description": "Optional chunk locator within the source (e.g., CH-014)."
                  },
                  "locator": {
                    "type": "string",
                    "description": "Optional human-readable locator (chapter/section/page)."
                  },
                  "claim": {
                    "type": "string",
                    "description": "What this citation supports (brief)."
                  }
                },
                "additionalProperties": false,
                "required": [
                  "citation_id",
                  "claim"
                ],
                "title": "CitationRef"
              }
            }
          },
          "additionalProperties": false,
          "required": [
            "misconception_id",
            "wrong_statement",
            "correction",
            "citations"
          ],
          "title": "Misconception"
        }
      },
      "do_not_misstate": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "rule_id": {
              "type": "string",
              "description": "Stable id, e.g., DNMS-01."
            },
            "statement": {
              "type": "string",
              "description": "Statement that must not appear in story/notes because it would be incorrect."
            },
            "reason": {
              "type": "string",
              "description": "Why it would be incorrect or misleading."
            },
            "citations": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "citation_id": {
                    "type": "string",
                    "description": "ID of a source in citations[] (e.g., CIT-01)."
                  },
                  "chunk_id": {
                    "type": "string",
                    "description": "Optional chunk locator within the source (e.g., CH-014)."
                  },
                  "locator": {
                    "type": "string",
                    "description": "Optional human-readable locator (chapter/section/page)."
                  },
                  "claim": {
                    "type": "string",
                    "description": "What this citation supports (brief)."
                  }
                },
                "additionalProperties": false,
                "required": [
                  "citation_id",
                  "claim"
                ],
                "title": "CitationRef"
              }
            }
          },
          "additionalProperties": false,
          "required": [
            "rule_id",
            "statement",
            "reason",
            "citations"
          ],
          "title": "DoNotMisstate"
        }
      },
      "citations": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "citation_id": {
              "type": "string",
              "description": "Stable id, e.g., CIT-01."
            },
            "source_type": {
              "type": "string",
              "enum": [
                "textbook",
                "review",
                "guideline",
                "primary_research",
                "lecture_notes",
                "other"
              ]
            },
            "title": {
              "type": "string",
              "description": "Title of the source."
            },
            "authors_or_org": {
              "type": "string",
              "description": "Authors or issuing organization."
            },
            "year": {
              "type": "integer",
              "description": "Publication year if known."
            },
            "publisher_or_journal": {
              "type": "string",
              "description": "Publisher/journal if known."
            },
            "url": {
              "type": "string",
              "description": "Optional URL (store in app; avoid showing on slides)."
            },
            "notes": {
              "type": "string",
              "description": "Optional notes on why this source is trustworthy/relevant."
            },
            "chunks": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "chunk_id": {
                    "type": "string",
                    "description": "Chunk identifier used by retrieval/indexing."
                  },
                  "locator": {
                    "type": "string",
                    "description": "Page/section/figure reference if available."
                  },
                  "excerpt": {
                    "type": "string",
                    "description": "Short excerpt/paraphrase of the chunk for audit (keep concise)."
                  }
                },
                "additionalProperties": false,
                "required": [
                  "chunk_id"
                ],
                "title": "SourceChunkRef"
              },
              "description": "Indexed chunks used from this source."
            }
          },
          "additionalProperties": false,
          "required": [
            "citation_id",
            "source_type",
            "title",
            "authors_or_org",
            "chunks"
          ],
          "title": "CitationSource"
        }
      }
    },
    "required": [
      "schema_version",
      "created_at",
      "disease_request",
      "canonical_name",
      "concept_index",
      "pathogenesis_steps",
      "differential",
      "tests_and_confounds",
      "treatments",
      "misconceptions",
      "do_not_misstate",
      "citations"
    ]
  },
  "drama_plan.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "DramaPlan",
    "description": "Story-first character and relationship arc plan ensuring the deck remains narrative-dominant.",
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "schema_version": {
        "type": "string",
        "description": "Schema version."
      },
      "series_bible_constraints": {
        "type": "array",
        "items": {
          "type": "string",
          "description": "World rules/limits that create stakes (e.g., time-limited shrinking)."
        }
      },
      "character_arcs": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "character_id": {
              "type": "string",
              "enum": [
                "detective",
                "deputy",
                "patient",
                "clinician_lead",
                "antagonist_institution",
                "other"
              ]
            },
            "name": {
              "type": "string",
              "description": "Name (or label)."
            },
            "core_need": {
              "type": "string",
              "description": "Internal need."
            },
            "core_fear": {
              "type": "string",
              "description": "Internal fear."
            },
            "wound_or_backstory": {
              "type": "string",
              "description": "Backstory that explains behavior."
            },
            "moral_line": {
              "type": "string",
              "description": "Line they won't cross (or think they won't)."
            },
            "act_turns": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "act_id": {
                    "type": "string",
                    "enum": [
                      "ACT1",
                      "ACT2",
                      "ACT3",
                      "ACT4"
                    ]
                  },
                  "pressure": {
                    "type": "string",
                    "description": "What presses on them."
                  },
                  "choice": {
                    "type": "string",
                    "description": "Choice they must make."
                  },
                  "change": {
                    "type": "string",
                    "description": "How they evolve."
                  }
                },
                "additionalProperties": false,
                "required": [
                  "act_id",
                  "pressure",
                  "choice",
                  "change"
                ]
              }
            }
          },
          "additionalProperties": false,
          "required": [
            "character_id",
            "name",
            "core_need",
            "core_fear",
            "moral_line",
            "act_turns"
          ],
          "title": "CharacterArc"
        }
      },
      "relationship_arcs": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "pair": {
              "type": "string",
              "enum": [
                "detective_deputy",
                "aliens_patient",
                "aliens_clinicians",
                "detective_authority",
                "deputy_authority"
              ]
            },
            "starting_dynamic": {
              "type": "string",
              "description": "How it begins."
            },
            "friction_points": {
              "type": "array",
              "items": {
                "type": "string",
                "description": "Conflicts that will occur."
              }
            },
            "repair_moments": {
              "type": "array",
              "items": {
                "type": "string",
                "description": "Moments of trust-building."
              }
            },
            "climax_resolution": {
              "type": "string",
              "description": "How it resolves by end."
            }
          },
          "additionalProperties": false,
          "required": [
            "pair",
            "starting_dynamic",
            "climax_resolution"
          ],
          "title": "RelationshipArc"
        }
      },
      "pressure_ladder": {
        "type": "object",
        "properties": {
          "physical": {
            "type": "array",
            "items": {
              "type": "string",
              "description": "How physical danger escalates by act."
            }
          },
          "institutional": {
            "type": "array",
            "items": {
              "type": "string",
              "description": "How institutional pressure escalates by act."
            }
          },
          "relational": {
            "type": "array",
            "items": {
              "type": "string",
              "description": "How relationships strain by act."
            }
          },
          "moral": {
            "type": "array",
            "items": {
              "type": "string",
              "description": "How moral dilemmas intensify by act."
            }
          }
        },
        "additionalProperties": false,
        "required": [
          "physical",
          "institutional",
          "relational",
          "moral"
        ]
      },
      "chapter_or_act_setups": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "act_id": {
              "type": "string",
              "enum": [
                "ACT1",
                "ACT2",
                "ACT3",
                "ACT4"
              ]
            },
            "required_emotional_beats": {
              "type": "array",
              "items": {
                "type": "string",
                "description": "Beats that must happen."
              }
            },
            "required_choices": {
              "type": "array",
              "items": {
                "type": "string",
                "description": "Key decisions."
              }
            },
            "notes": {
              "type": "string"
            }
          },
          "additionalProperties": false,
          "required": [
            "act_id",
            "required_emotional_beats",
            "required_choices"
          ]
        }
      }
    },
    "required": [
      "schema_version",
      "character_arcs",
      "relationship_arcs",
      "pressure_ladder"
    ]
  },
  "episode_pitch.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "EpisodePitch",
    "description": "Short pitch + teaser storyboard used for Gate 1 human approval.",
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "schema_version": {
        "type": "string",
        "description": "Schema version."
      },
      "pitch_id": {
        "type": "string",
        "description": "Stable id, e.g., PITCH-2026-0001."
      },
      "episode_title": {
        "type": "string",
        "description": "Working title."
      },
      "logline": {
        "type": "string",
        "description": "One-sentence hook."
      },
      "target_deck_length": {
        "type": "string",
        "enum": [
          "30",
          "45",
          "60"
        ],
        "description": "Main narrative deck slide count."
      },
      "tone": {
        "type": "string",
        "enum": [
          "noir",
          "brisk",
          "comedic_dry",
          "thriller",
          "awe"
        ]
      },
      "patient_stub": {
        "type": "object",
        "properties": {
          "age": {
            "type": "integer",
            "description": "Age in years."
          },
          "sex": {
            "type": "string",
            "enum": [
              "female",
              "male",
              "intersex",
              "unknown"
            ]
          },
          "one_sentence_context": {
            "type": "string",
            "description": "High-level context (occupation/exposure/etc.)."
          },
          "presenting_problem": {
            "type": "string",
            "description": "Chief complaint / presenting syndrome."
          },
          "stakes_if_missed": {
            "type": "string",
            "description": "Why time matters."
          }
        },
        "additionalProperties": false,
        "required": [
          "one_sentence_context",
          "presenting_problem",
          "stakes_if_missed"
        ]
      },
      "macro_hook": {
        "type": "string",
        "description": "What clinicians observe first."
      },
      "micro_hook": {
        "type": "string",
        "description": "What the aliens observe first at cell scale."
      },
      "proposed_twist_type": {
        "type": "string",
        "enum": [
          "mimic",
          "iatrogenic_overlay",
          "dual_process",
          "localization_switch",
          "immune_twist",
          "toxin_exposure",
          "genetic_variant",
          "other"
        ]
      },
      "why_this_case_is_cinematically_micro_scale": {
        "type": "array",
        "items": {
          "type": "string",
          "description": "Specific micro-scale visuals/sets that will wow."
        }
      },
      "core_stakes": {
        "type": "array",
        "items": {
          "type": "string",
          "description": "Story stakes (physical/institutional/relational/moral)."
        }
      },
      "detective_arc": {
        "type": "string",
        "description": "Detective internal arc in one paragraph."
      },
      "deputy_arc": {
        "type": "string",
        "description": "Deputy internal arc in one paragraph."
      },
      "teaser_storyboard": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "slide_id": {
              "type": "string",
              "description": "S01.."
            },
            "template_id": {
              "type": "string",
              "description": "Template identifier, e.g., T01_COLD_OPEN_MICRO_CRIME_SCENE."
            },
            "title": {
              "type": "string",
              "description": "Slide title."
            },
            "one_line_story": {
              "type": "string",
              "description": "One sentence of what happens."
            },
            "visual": {
              "type": "string",
              "description": "What is shown visually."
            },
            "hook": {
              "type": "string",
              "description": "The question this slide leaves hanging."
            },
            "medical_payload_brief": {
              "type": "string",
              "description": "Optional: the single major concept this slide would implicitly carry."
            }
          },
          "additionalProperties": false,
          "required": [
            "slide_id",
            "template_id",
            "title",
            "one_line_story",
            "visual",
            "hook"
          ],
          "title": "TeaserSlide"
        }
      },
      "must_have_learning_objectives": {
        "type": "array",
        "items": {
          "type": "string",
          "description": "LO ids from dossier (if available)."
        }
      },
      "citations_used": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "citation_id": {
              "type": "string",
              "description": "ID of a source in citations[] (e.g., CIT-01)."
            },
            "chunk_id": {
              "type": "string",
              "description": "Optional chunk locator within the source (e.g., CH-014)."
            },
            "locator": {
              "type": "string",
              "description": "Optional human-readable locator (chapter/section/page)."
            },
            "claim": {
              "type": "string",
              "description": "What this citation supports (brief)."
            }
          },
          "additionalProperties": false,
          "required": [
            "citation_id",
            "claim"
          ],
          "title": "CitationRef"
        }
      }
    },
    "required": [
      "schema_version",
      "pitch_id",
      "episode_title",
      "logline",
      "target_deck_length",
      "tone",
      "patient_stub",
      "macro_hook",
      "micro_hook",
      "proposed_twist_type",
      "teaser_storyboard",
      "citations_used"
    ]
  },
  "human_review.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "HumanReview",
    "description": "Human-in-the-loop decision at a gate (approve, request changes, or regenerate).",
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "schema_version": {
        "type": "string",
        "description": "Schema version."
      },
      "gate_id": {
        "type": "string",
        "enum": [
          "GATE_1_PITCH",
          "GATE_2_TRUTH_LOCK",
          "GATE_3_STORYBOARD",
          "GATE_4_FINAL"
        ]
      },
      "status": {
        "type": "string",
        "enum": [
          "approve",
          "request_changes",
          "regenerate"
        ]
      },
      "notes": {
        "type": "string",
        "description": "Freeform feedback."
      },
      "requested_changes": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "path": {
              "type": "string",
              "description": "JSON path to the field being commented on (e.g., $.slides[12].on_slide_text.headline)."
            },
            "instruction": {
              "type": "string",
              "description": "What to change."
            },
            "severity": {
              "type": "string",
              "enum": [
                "must",
                "should",
                "nice"
              ]
            }
          },
          "additionalProperties": false,
          "required": [
            "path",
            "instruction",
            "severity"
          ],
          "title": "RequestedChange"
        }
      }
    },
    "required": [
      "schema_version",
      "gate_id",
      "status",
      "requested_changes"
    ]
  },
  "med_factcheck_report.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "MedFactCheckReport",
    "description": "Medical correctness audit of DeckSpec against DiseaseDossier. Flags critical errors and unsupported inferences.",
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "schema_version": {
        "type": "string",
        "description": "Schema version."
      },
      "pass": {
        "type": "boolean",
        "description": "True if no critical issues."
      },
      "issues": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "issue_id": {
              "type": "string",
              "description": "MED-ERR-01."
            },
            "severity": {
              "type": "string",
              "enum": [
                "critical",
                "major",
                "minor"
              ]
            },
            "type": {
              "type": "string",
              "enum": [
                "incorrect_fact",
                "unsupported_inference",
                "misused_term",
                "wrong_timecourse",
                "wrong_test_interpretation",
                "wrong_treatment_response",
                "contradiction_with_dossier",
                "other"
              ]
            },
            "claim": {
              "type": "string",
              "description": "The problematic claim/inference."
            },
            "where": {
              "type": "object",
              "properties": {
                "slide_id": {
                  "type": "string",
                  "description": "Slide id if applicable."
                },
                "notes_field": {
                  "type": "string",
                  "description": "Which field (e.g., speaker_notes.medical_reasoning)."
                },
                "exhibit_id": {
                  "type": "string",
                  "description": "Exhibit id if applicable."
                }
              },
              "additionalProperties": false
            },
            "why_wrong": {
              "type": "string",
              "description": "Explanation grounded in dossier."
            },
            "suggested_fix": {
              "type": "string",
              "description": "How to correct."
            },
            "supporting_citations": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "citation_id": {
                    "type": "string",
                    "description": "ID of a source in citations[] (e.g., CIT-01)."
                  },
                  "chunk_id": {
                    "type": "string",
                    "description": "Optional chunk locator within the source (e.g., CH-014)."
                  },
                  "locator": {
                    "type": "string",
                    "description": "Optional human-readable locator (chapter/section/page)."
                  },
                  "claim": {
                    "type": "string",
                    "description": "What this citation supports (brief)."
                  }
                },
                "additionalProperties": false,
                "required": [
                  "citation_id",
                  "claim"
                ],
                "title": "CitationRef"
              }
            }
          },
          "additionalProperties": false,
          "required": [
            "issue_id",
            "severity",
            "type",
            "claim",
            "why_wrong",
            "suggested_fix",
            "supporting_citations"
          ],
          "title": "MedIssue"
        }
      },
      "summary": {
        "type": "string",
        "description": "One-paragraph summary."
      },
      "required_fixes": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "fix_id": {
              "type": "string",
              "description": "FIX-01."
            },
            "type": {
              "type": "string",
              "enum": [
                "regenerate_section",
                "edit_slide",
                "edit_clue",
                "edit_differential",
                "medical_correction",
                "reduce_text_density",
                "increase_story_turn",
                "add_twist_receipts",
                "other"
              ]
            },
            "priority": {
              "type": "string",
              "enum": [
                "must",
                "should",
                "could"
              ]
            },
            "description": {
              "type": "string",
              "description": "What must change."
            },
            "targets": {
              "type": "array",
              "items": {
                "type": "string",
                "description": "Paths or IDs affected (slide ids, clue ids)."
              }
            }
          },
          "additionalProperties": false,
          "required": [
            "fix_id",
            "type",
            "priority",
            "description"
          ],
          "title": "RequiredFix"
        }
      }
    },
    "required": [
      "schema_version",
      "pass",
      "issues",
      "summary",
      "required_fixes"
    ]
  },
  "micro_world_map.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "MicroWorldMap",
    "description": "Slide-visualization-focused map of the body/tissue at cell scale for this episode: zones, hazards, routes, motifs.",
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "schema_version": {
        "type": "string",
        "description": "Schema version."
      },
      "episode_slug": {
        "type": "string",
        "description": "Short slug for filenames."
      },
      "primary_organs": {
        "type": "array",
        "items": {
          "type": "string",
          "description": "Primary organs/tissues involved."
        }
      },
      "zones": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "zone_id": {
              "type": "string",
              "description": "Stable id, e.g., Z-LUNG-ALV-01."
            },
            "name": {
              "type": "string",
              "description": "Name for narrative use."
            },
            "anatomic_location": {
              "type": "string",
              "description": "Precise anatomic location."
            },
            "scale_notes": {
              "type": "string",
              "description": "What sizes/distances mean here (cell scale framing)."
            },
            "physical_properties": {
              "type": "array",
              "items": {
                "type": "string",
                "description": "Viscosity, flow, compliance, ECM density, etc."
              }
            },
            "resident_actors": {
              "type": "array",
              "items": {
                "type": "string",
                "description": "Common cells/structures encountered."
              }
            },
            "environmental_gradients": {
              "type": "array",
              "items": {
                "type": "string",
                "description": "O2, pH, cytokines, osmolarity, etc."
              }
            },
            "narrative_motifs": {
              "type": "array",
              "items": {
                "type": "string",
                "description": "Recurring sensory/visual metaphors, kept consistent."
              }
            },
            "citations": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "citation_id": {
                    "type": "string",
                    "description": "ID of a source in citations[] (e.g., CIT-01)."
                  },
                  "chunk_id": {
                    "type": "string",
                    "description": "Optional chunk locator within the source (e.g., CH-014)."
                  },
                  "locator": {
                    "type": "string",
                    "description": "Optional human-readable locator (chapter/section/page)."
                  },
                  "claim": {
                    "type": "string",
                    "description": "What this citation supports (brief)."
                  }
                },
                "additionalProperties": false,
                "required": [
                  "citation_id",
                  "claim"
                ],
                "title": "CitationRef"
              }
            }
          },
          "additionalProperties": false,
          "required": [
            "zone_id",
            "name",
            "anatomic_location",
            "citations"
          ],
          "title": "TissueZone"
        }
      },
      "hazards": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "hazard_id": {
              "type": "string",
              "description": "Stable id, e.g., HZ-01."
            },
            "type": {
              "type": "string",
              "enum": [
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
              ]
            },
            "description": {
              "type": "string",
              "description": "What makes it dangerous at cell scale."
            },
            "how_it_appears_visually": {
              "type": "string",
              "description": "How it will be visualized on slides."
            },
            "how_characters_survive": {
              "type": "string",
              "description": "Non-actionable survival logic (avoid procedural harm info)."
            },
            "links_to_pathophysiology": {
              "type": "string",
              "description": "Which disease mechanisms create this hazard."
            },
            "citations": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "citation_id": {
                    "type": "string",
                    "description": "ID of a source in citations[] (e.g., CIT-01)."
                  },
                  "chunk_id": {
                    "type": "string",
                    "description": "Optional chunk locator within the source (e.g., CH-014)."
                  },
                  "locator": {
                    "type": "string",
                    "description": "Optional human-readable locator (chapter/section/page)."
                  },
                  "claim": {
                    "type": "string",
                    "description": "What this citation supports (brief)."
                  }
                },
                "additionalProperties": false,
                "required": [
                  "citation_id",
                  "claim"
                ],
                "title": "CitationRef"
              }
            }
          },
          "additionalProperties": false,
          "required": [
            "hazard_id",
            "type",
            "description",
            "links_to_pathophysiology",
            "citations"
          ],
          "title": "MicroHazard"
        }
      },
      "routes": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "route_id": {
              "type": "string",
              "description": "Stable id."
            },
            "from_zone_id": {
              "type": "string",
              "description": "Zone id."
            },
            "to_zone_id": {
              "type": "string",
              "description": "Zone id."
            },
            "mode": {
              "type": "string",
              "enum": [
                "bloodstream",
                "lymph",
                "mucus_surface",
                "interstitial",
                "neuronal_track",
                "duct_system",
                "airflow",
                "other"
              ]
            },
            "constraints": {
              "type": "array",
              "items": {
                "type": "string",
                "description": "Barriers, checkpoints, time limits."
              }
            },
            "story_use": {
              "type": "string",
              "description": "What dramatic purpose this route serves (chase, stealth, etc.)."
            },
            "citations": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "citation_id": {
                    "type": "string",
                    "description": "ID of a source in citations[] (e.g., CIT-01)."
                  },
                  "chunk_id": {
                    "type": "string",
                    "description": "Optional chunk locator within the source (e.g., CH-014)."
                  },
                  "locator": {
                    "type": "string",
                    "description": "Optional human-readable locator (chapter/section/page)."
                  },
                  "claim": {
                    "type": "string",
                    "description": "What this citation supports (brief)."
                  }
                },
                "additionalProperties": false,
                "required": [
                  "citation_id",
                  "claim"
                ],
                "title": "CitationRef"
              }
            }
          },
          "additionalProperties": false,
          "required": [
            "route_id",
            "from_zone_id",
            "to_zone_id",
            "mode",
            "citations"
          ],
          "title": "TransitRoute"
        }
      },
      "immune_law_enforcement_metaphors": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "actor": {
              "type": "string",
              "description": "Immune component (e.g., neutrophils, complement)."
            },
            "metaphor": {
              "type": "string",
              "description": "How it behaves in-story (riot squad, drones, etc.)."
            },
            "accuracy_notes": {
              "type": "string",
              "description": "How to keep the metaphor medically correct."
            },
            "citations": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "citation_id": {
                    "type": "string",
                    "description": "ID of a source in citations[] (e.g., CIT-01)."
                  },
                  "chunk_id": {
                    "type": "string",
                    "description": "Optional chunk locator within the source (e.g., CH-014)."
                  },
                  "locator": {
                    "type": "string",
                    "description": "Optional human-readable locator (chapter/section/page)."
                  },
                  "claim": {
                    "type": "string",
                    "description": "What this citation supports (brief)."
                  }
                },
                "additionalProperties": false,
                "required": [
                  "citation_id",
                  "claim"
                ],
                "title": "CitationRef"
              }
            }
          },
          "additionalProperties": false,
          "required": [
            "actor",
            "metaphor",
            "citations"
          ]
        }
      },
      "visual_style_guide": {
        "type": "object",
        "properties": {
          "palette_notes": {
            "type": "string",
            "description": "High-level aesthetic notes (no specific colors required)."
          },
          "recurring_ui_elements": {
            "type": "array",
            "items": {
              "type": "string",
              "description": "Badges, evidence stamps, timers, etc."
            }
          },
          "labeling_rules": {
            "type": "array",
            "items": {
              "type": "string",
              "description": "How to label molecules/cells without clutter."
            }
          },
          "citations": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "citation_id": {
                  "type": "string",
                  "description": "ID of a source in citations[] (e.g., CIT-01)."
                },
                "chunk_id": {
                  "type": "string",
                  "description": "Optional chunk locator within the source (e.g., CH-014)."
                },
                "locator": {
                  "type": "string",
                  "description": "Optional human-readable locator (chapter/section/page)."
                },
                "claim": {
                  "type": "string",
                  "description": "What this citation supports (brief)."
                }
              },
              "additionalProperties": false,
              "required": [
                "citation_id",
                "claim"
              ],
              "title": "CitationRef"
            }
          }
        },
        "additionalProperties": false,
        "required": [
          "citations"
        ]
      }
    },
    "required": [
      "schema_version",
      "episode_slug",
      "zones",
      "hazards",
      "routes",
      "visual_style_guide"
    ]
  },
  "narrative_state.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "NarrativeState",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "schema_version",
      "block_id",
      "current_false_theory",
      "relationship_state_detective_deputy",
      "unresolved_emotional_thread",
      "active_clue_obligations",
      "active_motif_callback_lexicon",
      "pressure_channels",
      "recent_slide_excerpts",
      "active_differential_ordering",
      "delta_from_previous_block",
      "canonical_profile_excerpt",
      "episode_memory_excerpt"
    ],
    "properties": {
      "schema_version": {
        "type": "string",
        "minLength": 1
      },
      "block_id": {
        "type": "string",
        "minLength": 1
      },
      "current_false_theory": {
        "type": "string",
        "minLength": 1
      },
      "relationship_state_detective_deputy": {
        "type": "string",
        "minLength": 1
      },
      "unresolved_emotional_thread": {
        "type": "string",
        "minLength": 1
      },
      "active_clue_obligations": {
        "type": "array",
        "minItems": 1,
        "items": {
          "type": "string",
          "minLength": 1
        }
      },
      "active_motif_callback_lexicon": {
        "type": "array",
        "minItems": 1,
        "items": {
          "type": "string",
          "minLength": 1
        }
      },
      "pressure_channels": {
        "type": "array",
        "minItems": 1,
        "items": {
          "type": "string",
          "minLength": 1
        }
      },
      "recent_slide_excerpts": {
        "type": "array",
        "minItems": 2,
        "maxItems": 4,
        "items": {
          "type": "string",
          "minLength": 1
        }
      },
      "active_differential_ordering": {
        "type": "array",
        "minItems": 1,
        "items": {
          "type": "string",
          "minLength": 1
        }
      },
      "delta_from_previous_block": {
        "type": "string",
        "minLength": 1
      },
      "canonical_profile_excerpt": {
        "type": "string",
        "minLength": 1
      },
      "episode_memory_excerpt": {
        "type": "string",
        "minLength": 1
      }
    }
  },
  "qa_report.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "QAReport",
    "description": "Combined deterministic lint + LLM grader results; used for Gate 4 approval and fix-loop control.",
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "schema_version": {
        "type": "string",
        "description": "Schema version."
      },
      "lint_pass": {
        "type": "boolean"
      },
      "lint_errors": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "code": {
              "type": "string",
              "description": "Machine-readable code."
            },
            "message": {
              "type": "string",
              "description": "Human-readable description."
            },
            "severity": {
              "type": "string",
              "enum": [
                "error",
                "warning"
              ]
            },
            "slide_id": {
              "type": "string",
              "description": "Optional slide id affected."
            }
          },
          "additionalProperties": false,
          "required": [
            "code",
            "message",
            "severity"
          ],
          "title": "LintError"
        }
      },
      "grader_scores": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "category": {
              "type": "string",
              "enum": [
                "MedicalAccuracy",
                "StoryDominance",
                "TwistQuality",
                "SlideClarity",
                "PacingTurnRate",
                "MicroMacroCoherence",
                "ActEscalation",
                "FalseTheoryArc",
                "CallbackClosure",
                "DetectiveDeputyArc",
                "SceneVariety",
                "GenericLanguageRate"
              ]
            },
            "score_0_to_5": {
              "type": "number",
              "description": "Score 0-5."
            },
            "rationale": {
              "type": "string",
              "description": "Brief rationale."
            },
            "critical": {
              "type": "boolean",
              "description": "If true, failing this category rejects output."
            }
          },
          "additionalProperties": false,
          "required": [
            "category",
            "score_0_to_5",
            "rationale",
            "critical"
          ],
          "title": "GraderScore"
        }
      },
      "accept": {
        "type": "boolean",
        "description": "True when ready to render final PPTX."
      },
      "required_fixes": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "fix_id": {
              "type": "string",
              "description": "FIX-01."
            },
            "type": {
              "type": "string",
              "enum": [
                "regenerate_section",
                "edit_slide",
                "edit_clue",
                "edit_differential",
                "medical_correction",
                "reduce_text_density",
                "increase_story_turn",
                "add_twist_receipts",
                "other"
              ]
            },
            "priority": {
              "type": "string",
              "enum": [
                "must",
                "should",
                "could"
              ]
            },
            "description": {
              "type": "string",
              "description": "What must change."
            },
            "targets": {
              "type": "array",
              "items": {
                "type": "string",
                "description": "Paths or IDs affected (slide ids, clue ids)."
              }
            }
          },
          "additionalProperties": false,
          "required": [
            "fix_id",
            "type",
            "priority",
            "description"
          ],
          "title": "RequiredFix"
        }
      },
      "summary": {
        "type": "string",
        "description": "One-paragraph summary of quality and remaining risks."
      },
      "citations_used": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "citation_id": {
              "type": "string",
              "description": "ID of a source in citations[] (e.g., CIT-01)."
            },
            "chunk_id": {
              "type": "string",
              "description": "Optional chunk locator within the source (e.g., CH-014)."
            },
            "locator": {
              "type": "string",
              "description": "Optional human-readable locator (chapter/section/page)."
            },
            "claim": {
              "type": "string",
              "description": "What this citation supports (brief)."
            }
          },
          "additionalProperties": false,
          "required": [
            "citation_id",
            "claim"
          ],
          "title": "CitationRef"
        }
      }
    },
    "required": [
      "schema_version",
      "lint_pass",
      "lint_errors",
      "grader_scores",
      "accept",
      "required_fixes",
      "summary",
      "citations_used"
    ]
  },
  "reader_sim_report.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "ReaderSimReport",
    "description": "Adversarial reader simulation output: solve attempts at checkpoints + story/pacing issues + required fixes suggestions.",
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "schema_version": {
        "type": "string",
        "description": "Schema version."
      },
      "solve_attempts": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "checkpoint": {
              "type": "string",
              "enum": [
                "ACT1_END",
                "MIDPOINT",
                "ACT3_START",
                "ACT3_END"
              ]
            },
            "top_dx_guesses": {
              "type": "array",
              "items": {
                "type": "string",
                "description": "DX ids guessed."
              }
            },
            "confidence_0_to_1": {
              "type": "number",
              "description": "Confidence."
            },
            "key_clues_used": {
              "type": "array",
              "items": {
                "type": "string",
                "description": "Clue IDs used."
              }
            },
            "what_was_confusing": {
              "type": "array",
              "items": {
                "type": "string",
                "description": "Confusions."
              }
            },
            "was_twist_predictable": {
              "type": "string",
              "enum": [
                "too_easy",
                "fairly_guessable",
                "surprising_but_fair",
                "felt_like_cheating"
              ]
            }
          },
          "additionalProperties": false,
          "required": [
            "checkpoint",
            "top_dx_guesses",
            "confidence_0_to_1",
            "key_clues_used",
            "was_twist_predictable"
          ],
          "title": "SolveAttempt"
        }
      },
      "overall_story_dominance_score_0_to_5": {
        "type": "number"
      },
      "overall_twist_quality_score_0_to_5": {
        "type": "number"
      },
      "overall_clarity_score_0_to_5": {
        "type": "number"
      },
      "biggest_strengths": {
        "type": "array",
        "items": {
          "type": "string"
        }
      },
      "biggest_risks": {
        "type": "array",
        "items": {
          "type": "string"
        }
      },
      "slide_notes": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "slide_id": {
              "type": "string",
              "description": "Slide id."
            },
            "issue_type": {
              "type": "string",
              "enum": [
                "too_texty",
                "no_story_turn",
                "medical_confusion",
                "twist_setup_missing",
                "pacing_slow",
                "pacing_rushed",
                "unclear_visual",
                "tone_break",
                "other"
              ]
            },
            "note": {
              "type": "string",
              "description": "What to fix."
            },
            "severity": {
              "type": "string",
              "enum": [
                "must",
                "should",
                "nice"
              ]
            }
          },
          "additionalProperties": false,
          "required": [
            "slide_id",
            "issue_type",
            "note",
            "severity"
          ],
          "title": "SlideNote"
        }
      },
      "required_fixes": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "fix_id": {
              "type": "string",
              "description": "FIX-01."
            },
            "type": {
              "type": "string",
              "enum": [
                "regenerate_section",
                "edit_slide",
                "edit_clue",
                "edit_differential",
                "medical_correction",
                "reduce_text_density",
                "increase_story_turn",
                "add_twist_receipts",
                "other"
              ]
            },
            "priority": {
              "type": "string",
              "enum": [
                "must",
                "should",
                "could"
              ]
            },
            "description": {
              "type": "string",
              "description": "What must change."
            },
            "targets": {
              "type": "array",
              "items": {
                "type": "string",
                "description": "Paths or IDs affected (slide ids, clue ids)."
              }
            }
          },
          "additionalProperties": false,
          "required": [
            "fix_id",
            "type",
            "priority",
            "description"
          ],
          "title": "RequiredFix"
        }
      }
    },
    "required": [
      "schema_version",
      "solve_attempts",
      "overall_story_dominance_score_0_to_5",
      "overall_twist_quality_score_0_to_5",
      "overall_clarity_score_0_to_5",
      "slide_notes",
      "required_fixes"
    ]
  },
  "setpiece_plan.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "SetPiecePlan",
    "description": "Act-by-act action and set-piece plan to keep the story thrilling at cell scale while staying medically correct.",
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "schema_version": {
        "type": "string",
        "description": "Schema version."
      },
      "setpieces": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "setpiece_id": {
              "type": "string",
              "description": "SP-01."
            },
            "act_id": {
              "type": "string",
              "enum": [
                "ACT1",
                "ACT2",
                "ACT3",
                "ACT4"
              ]
            },
            "type": {
              "type": "string",
              "enum": [
                "transit_peril",
                "immune_chase",
                "barrier_infiltration",
                "environmental_hazard",
                "intervention_shockwave",
                "moral_confrontation",
                "proof_trap",
                "other"
              ]
            },
            "location_zone_id": {
              "type": "string",
              "description": "MicroWorld zone id where it occurs."
            },
            "story_purpose": {
              "type": "string",
              "description": "What it does for plot/characters."
            },
            "medical_mechanism_anchor": {
              "type": "string",
              "description": "Which pathophysiology makes it happen."
            },
            "visual_signature": {
              "type": "string",
              "description": "How it will look on slides."
            },
            "constraints": {
              "type": "array",
              "items": {
                "type": "string",
                "description": "What makes it hard (time, energy, hostile immune system)."
              }
            },
            "outcome_turn": {
              "type": "string",
              "description": "The reversal/outcome."
            },
            "citations": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "citation_id": {
                    "type": "string",
                    "description": "ID of a source in citations[] (e.g., CIT-01)."
                  },
                  "chunk_id": {
                    "type": "string",
                    "description": "Optional chunk locator within the source (e.g., CH-014)."
                  },
                  "locator": {
                    "type": "string",
                    "description": "Optional human-readable locator (chapter/section/page)."
                  },
                  "claim": {
                    "type": "string",
                    "description": "What this citation supports (brief)."
                  }
                },
                "additionalProperties": false,
                "required": [
                  "citation_id",
                  "claim"
                ],
                "title": "CitationRef"
              }
            }
          },
          "additionalProperties": false,
          "required": [
            "setpiece_id",
            "act_id",
            "type",
            "story_purpose",
            "medical_mechanism_anchor",
            "visual_signature",
            "outcome_turn",
            "citations"
          ],
          "title": "SetPiece"
        }
      },
      "quotas": {
        "type": "object",
        "properties": {
          "act1_social_or_ethics_confrontation": {
            "type": "boolean"
          },
          "act2_micro_action_setpiece": {
            "type": "boolean"
          },
          "act3_truth_bomb": {
            "type": "boolean"
          },
          "act4_proof_or_showdown": {
            "type": "boolean"
          }
        },
        "additionalProperties": false,
        "required": [
          "act1_social_or_ethics_confrontation",
          "act2_micro_action_setpiece",
          "act3_truth_bomb",
          "act4_proof_or_showdown"
        ]
      },
      "notes": {
        "type": "array",
        "items": {
          "type": "string",
          "description": "Optional notes."
        }
      }
    },
    "required": [
      "schema_version",
      "setpieces",
      "quotas"
    ]
  },
  "slide_block.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "SlideBlock",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "schema_version",
      "block_id",
      "act_id",
      "slide_range",
      "block_summary_out"
    ],
    "properties": {
      "schema_version": {
        "type": "string",
        "minLength": 1
      },
      "block_id": {
        "type": "string",
        "minLength": 1
      },
      "act_id": {
        "type": "string",
        "enum": [
          "ACT1",
          "ACT2",
          "ACT3",
          "ACT4"
        ]
      },
      "slide_range": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "start",
          "end"
        ],
        "properties": {
          "start": {
            "type": "integer",
            "minimum": 1
          },
          "end": {
            "type": "integer",
            "minimum": 1
          }
        }
      },
      "prior_block_summary": {
        "type": "string",
        "minLength": 1
      },
      "unresolved_threads_in": {
        "type": "array",
        "items": {
          "type": "string",
          "minLength": 1
        }
      },
      "slide_overrides": {
        "type": "array",
        "minItems": 1,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "slide_id"
          ],
          "properties": {
            "slide_id": {
              "type": "string",
              "minLength": 1
            },
            "title": {
              "type": "string",
              "minLength": 1
            },
            "hook": {
              "type": "string",
              "minLength": 1
            },
            "visual_description": {
              "type": "string",
              "minLength": 1
            },
            "delivery_mode": {
              "type": "string",
              "enum": [
                "clue",
                "dialogue",
                "action",
                "exhibit",
                "note_only",
                "none"
              ]
            },
            "major_concept_id": {
              "type": "string",
              "minLength": 1
            },
            "speaker_notes_patch": {
              "type": "string",
              "minLength": 1
            }
          }
        }
      },
      "operations": {
        "type": "array",
        "minItems": 1,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "op"
          ],
          "properties": {
            "op": {
              "type": "string",
              "enum": [
                "replace_slide",
                "insert_after",
                "split_slide",
                "drop_slide",
                "replace_window"
              ]
            },
            "slide_id": {
              "type": "string",
              "minLength": 1
            },
            "after_slide_id": {
              "type": "string",
              "minLength": 1
            },
            "start_slide_id": {
              "type": "string",
              "minLength": 1
            },
            "end_slide_id": {
              "type": "string",
              "minLength": 1
            },
            "replacement_slide": {
              "type": "object"
            },
            "replacement_slides": {
              "type": "array",
              "items": {
                "type": "object"
              }
            },
            "reason": {
              "type": "string",
              "minLength": 1
            }
          }
        }
      },
      "unresolved_threads_out": {
        "type": "array",
        "items": {
          "type": "string",
          "minLength": 1
        }
      },
      "block_summary_out": {
        "type": "string",
        "minLength": 1
      }
    },
    "anyOf": [
      {
        "required": [
          "slide_overrides"
        ]
      },
      {
        "required": [
          "operations"
        ]
      }
    ]
  },
  "truth_model.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "TruthModel",
    "description": "Locked 'what really happens' model: final diagnosis, aligned macro/micro timelines, interventions, twist blueprints, fairness contract.",
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "schema_version": {
        "type": "string",
        "description": "Schema version."
      },
      "episode_title": {
        "type": "string",
        "description": "Working title."
      },
      "final_diagnosis": {
        "type": "object",
        "properties": {
          "dx_id": {
            "type": "string",
            "description": "DX id from dossier differential or final."
          },
          "name": {
            "type": "string",
            "description": "Diagnosis name."
          },
          "one_sentence_mechanism": {
            "type": "string",
            "description": "High-level mechanism summary."
          }
        },
        "additionalProperties": false,
        "required": [
          "dx_id",
          "name",
          "one_sentence_mechanism"
        ]
      },
      "case_logline": {
        "type": "string",
        "description": "One-sentence case hook."
      },
      "patient_profile": {
        "type": "object",
        "properties": {
          "age": {
            "type": "integer"
          },
          "sex": {
            "type": "string",
            "enum": [
              "female",
              "male",
              "intersex",
              "unknown"
            ]
          },
          "key_history": {
            "type": "array",
            "items": {
              "type": "string",
              "description": "Comorbidities, meds, exposures, social history relevant to case."
            }
          },
          "baseline_state": {
            "type": "string",
            "description": "Baseline functional status."
          },
          "constraints": {
            "type": "array",
            "items": {
              "type": "string",
              "description": "Constraints like pregnancy, renal failure, immunosuppression."
            }
          }
        },
        "additionalProperties": false,
        "required": [
          "sex",
          "key_history"
        ]
      },
      "cover_story": {
        "type": "object",
        "properties": {
          "initial_working_dx_ids": {
            "type": "array",
            "items": {
              "type": "string",
              "description": "DDx suspects initially favored."
            }
          },
          "why_it_seems_right": {
            "type": "string",
            "description": "Why clinicians (and/or aliens) initially believe this."
          },
          "what_it_gets_wrong": {
            "type": "string",
            "description": "What it fails to explain (seed for twist)."
          }
        },
        "additionalProperties": false,
        "required": [
          "initial_working_dx_ids",
          "why_it_seems_right",
          "what_it_gets_wrong"
        ]
      },
      "macro_timeline": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "t": {
              "type": "string",
              "description": "Relative time marker (e.g., T0, T+6h, Day 2)."
            },
            "event_id": {
              "type": "string",
              "description": "Stable id, e.g., ME-01."
            },
            "what_happens": {
              "type": "string",
              "description": "Narrative of clinical event."
            },
            "observations": {
              "type": "array",
              "items": {
                "type": "string",
                "description": "Symptoms/signs/labs/imaging observations available at this moment."
              }
            },
            "differential_shift": {
              "type": "string",
              "description": "How this should update the differential."
            },
            "citations": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "citation_id": {
                    "type": "string",
                    "description": "ID of a source in citations[] (e.g., CIT-01)."
                  },
                  "chunk_id": {
                    "type": "string",
                    "description": "Optional chunk locator within the source (e.g., CH-014)."
                  },
                  "locator": {
                    "type": "string",
                    "description": "Optional human-readable locator (chapter/section/page)."
                  },
                  "claim": {
                    "type": "string",
                    "description": "What this citation supports (brief)."
                  }
                },
                "additionalProperties": false,
                "required": [
                  "citation_id",
                  "claim"
                ],
                "title": "CitationRef"
              }
            }
          },
          "additionalProperties": false,
          "required": [
            "t",
            "event_id",
            "what_happens",
            "citations"
          ],
          "title": "MacroEvent"
        }
      },
      "micro_timeline": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "t": {
              "type": "string",
              "description": "Relative time marker aligned to macro timeline."
            },
            "event_id": {
              "type": "string",
              "description": "Stable id, e.g., mE-01."
            },
            "zone_id": {
              "type": "string",
              "description": "Zone id from MicroWorldMap."
            },
            "what_happens": {
              "type": "string",
              "description": "What happens at cell scale."
            },
            "key_players": {
              "type": "array",
              "items": {
                "type": "string",
                "description": "Cells/mediators/structures involved."
              }
            },
            "clue_potential": {
              "type": "array",
              "items": {
                "type": "string",
                "description": "What this could become as a clue (without explaining yet)."
              }
            },
            "citations": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "citation_id": {
                    "type": "string",
                    "description": "ID of a source in citations[] (e.g., CIT-01)."
                  },
                  "chunk_id": {
                    "type": "string",
                    "description": "Optional chunk locator within the source (e.g., CH-014)."
                  },
                  "locator": {
                    "type": "string",
                    "description": "Optional human-readable locator (chapter/section/page)."
                  },
                  "claim": {
                    "type": "string",
                    "description": "What this citation supports (brief)."
                  }
                },
                "additionalProperties": false,
                "required": [
                  "citation_id",
                  "claim"
                ],
                "title": "CitationRef"
              }
            }
          },
          "additionalProperties": false,
          "required": [
            "t",
            "event_id",
            "zone_id",
            "what_happens",
            "citations"
          ],
          "title": "MicroEvent"
        }
      },
      "interventions": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "t": {
              "type": "string",
              "description": "When administered."
            },
            "intervention_id": {
              "type": "string",
              "description": "Reference to TX id in dossier (or local)."
            },
            "name": {
              "type": "string",
              "description": "Name."
            },
            "why_given": {
              "type": "string",
              "description": "Clinical rationale."
            },
            "expected_macro_effects": {
              "type": "array",
              "items": {
                "type": "string",
                "description": "Expected clinical changes."
              }
            },
            "expected_micro_effects": {
              "type": "array",
              "items": {
                "type": "string",
                "description": "Expected micro-scale changes."
              }
            },
            "diagnostic_value": {
              "type": "string",
              "description": "How response/non-response updates differential."
            },
            "risks_and_complications": {
              "type": "array",
              "items": {
                "type": "string",
                "description": "Key risks that could generate new plot complications."
              }
            },
            "citations": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "citation_id": {
                    "type": "string",
                    "description": "ID of a source in citations[] (e.g., CIT-01)."
                  },
                  "chunk_id": {
                    "type": "string",
                    "description": "Optional chunk locator within the source (e.g., CH-014)."
                  },
                  "locator": {
                    "type": "string",
                    "description": "Optional human-readable locator (chapter/section/page)."
                  },
                  "claim": {
                    "type": "string",
                    "description": "What this citation supports (brief)."
                  }
                },
                "additionalProperties": false,
                "required": [
                  "citation_id",
                  "claim"
                ],
                "title": "CitationRef"
              }
            }
          },
          "additionalProperties": false,
          "required": [
            "t",
            "intervention_id",
            "name",
            "why_given",
            "citations"
          ],
          "title": "InterventionEvent"
        }
      },
      "twist_blueprints": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "twist_id": {
              "type": "string",
              "description": "Stable id, e.g., TW-01."
            },
            "type": {
              "type": "string",
              "enum": [
                "mimic",
                "iatrogenic_overlay",
                "dual_process",
                "localization_switch",
                "immune_twist",
                "toxin_exposure",
                "variant_presentation",
                "other"
              ]
            },
            "description": {
              "type": "string",
              "description": "What the twist is."
            },
            "why_surprising": {
              "type": "string",
              "description": "Why a smart reader might not anticipate it."
            },
            "why_inevitable": {
              "type": "string",
              "description": "Why it is inevitable in hindsight."
            },
            "required_clue_ids": {
              "type": "array",
              "items": {
                "type": "string",
                "description": "Clue IDs that support this twist."
              }
            },
            "act1_setup_clue_ids": {
              "type": "array",
              "items": {
                "type": "string",
                "description": "At least one must be in Act I."
              }
            },
            "recontextualizes_slide_ids": {
              "type": "array",
              "items": {
                "type": "string",
                "description": "Slide IDs whose meaning changes in hindsight."
              }
            },
            "payoff_slide_id": {
              "type": "string",
              "description": "Where twist lands in main deck."
            },
            "citations": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "citation_id": {
                    "type": "string",
                    "description": "ID of a source in citations[] (e.g., CIT-01)."
                  },
                  "chunk_id": {
                    "type": "string",
                    "description": "Optional chunk locator within the source (e.g., CH-014)."
                  },
                  "locator": {
                    "type": "string",
                    "description": "Optional human-readable locator (chapter/section/page)."
                  },
                  "claim": {
                    "type": "string",
                    "description": "What this citation supports (brief)."
                  }
                },
                "additionalProperties": false,
                "required": [
                  "citation_id",
                  "claim"
                ],
                "title": "CitationRef"
              }
            }
          },
          "additionalProperties": false,
          "required": [
            "twist_id",
            "type",
            "description",
            "required_clue_ids",
            "payoff_slide_id",
            "citations"
          ],
          "title": "TwistBlueprint"
        }
      },
      "fairness_contract": {
        "type": "object",
        "properties": {
          "no_new_crucial_facts_in_reveal": {
            "type": "boolean",
            "description": "True if reveal only connects existing dots."
          },
          "all_major_clues_on_slide_or_exhibit": {
            "type": "boolean",
            "description": "True if major clues appear visually somewhere (not only in notes)."
          },
          "one_major_med_concept_per_story_slide": {
            "type": "boolean",
            "description": "Enforce story dominance."
          },
          "twist_receipts_min_clues": {
            "type": "integer",
            "description": "Minimum supporting clues per twist (recommend 3)."
          },
          "twist_requires_act1_setup": {
            "type": "boolean",
            "description": "At least one setup clue in Act I."
          },
          "notes": {
            "type": "array",
            "items": {
              "type": "string",
              "description": "Additional constraints."
            }
          }
        },
        "additionalProperties": false,
        "required": [
          "no_new_crucial_facts_in_reveal",
          "all_major_clues_on_slide_or_exhibit",
          "one_major_med_concept_per_story_slide",
          "twist_receipts_min_clues",
          "twist_requires_act1_setup"
        ],
        "title": "FairnessContract"
      },
      "citations_used": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "citation_id": {
              "type": "string",
              "description": "ID of a source in citations[] (e.g., CIT-01)."
            },
            "chunk_id": {
              "type": "string",
              "description": "Optional chunk locator within the source (e.g., CH-014)."
            },
            "locator": {
              "type": "string",
              "description": "Optional human-readable locator (chapter/section/page)."
            },
            "claim": {
              "type": "string",
              "description": "What this citation supports (brief)."
            }
          },
          "additionalProperties": false,
          "required": [
            "citation_id",
            "claim"
          ],
          "title": "CitationRef"
        }
      }
    },
    "required": [
      "schema_version",
      "episode_title",
      "final_diagnosis",
      "case_logline",
      "cover_story",
      "macro_timeline",
      "micro_timeline",
      "twist_blueprints",
      "fairness_contract",
      "citations_used"
    ]
  }
} as const;

export type V2CanonicalSchemaFile = (typeof V2CanonicalSchemaFiles)[number];

export function getV2CanonicalSchema(name: V2CanonicalSchemaFile): (typeof V2CanonicalSchemas)[V2CanonicalSchemaFile] {
  return V2CanonicalSchemas[name];
}
