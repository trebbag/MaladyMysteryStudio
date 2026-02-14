import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import type { RunManager, RunSettings, StepName } from "../run_manager.js";
import { STEP_ORDER } from "../run_manager.js";
import { resolveCanonicalProfilePaths } from "./canon.js";
import { summarizeConstraintAdherence, type ConstraintAdherenceReport } from "./constraint_checks.js";
import { buildGensparkMasterDoc, validateGensparkMasterDoc } from "./genspark_master_doc.js";
import { buildMedicalStoryTraceabilityReport, evaluateMedicalDepth } from "./qa_depth_traceability.js";
import { MEDICAL_NARRATIVE_SECTIONS } from "./schemas.js";
import { artifactAbsPath, ensureDir, nowIso, runOutputDirAbs, writeJsonFile, writeTextFile } from "./utils.js";

export type RunInput = {
  runId: string;
  topic: string;
  settings?: RunSettings;
};

export type PipelineOptions = {
  signal: AbortSignal;
  startFrom?: StepName;
};

function parseDelayMs(): number {
  const raw = Number(process.env.MMS_FAKE_STEP_DELAY_MS ?? 80);
  if (!Number.isFinite(raw) || raw < 0) return 80;
  return Math.min(2000, raw);
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Cancelled"));
      return;
    }
    if (ms <= 0) {
      resolve();
      return;
    }

    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(new Error("Cancelled"));
    };

    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function idx(step: StepName): number {
  return STEP_ORDER.indexOf(step);
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function mkKnowledgeEntry(topic: string, concept: string, detail: string) {
  return {
    concept,
    clinically_relevant_detail: `${detail} (${topic}).`,
    why_it_matters_for_pcp: `Primary care decisions depend on this point for safe triage and longitudinal planning in ${topic}.`,
    citations: ["https://example.org/clinical-reference"],
    confidence: 0.9
  };
}

function mkMedicalChapter(topic: string) {
  return {
    normal_physiology: [mkKnowledgeEntry(topic, "Normal baseline", "Expected physiology under stable conditions")],
    pathophysiology: [mkKnowledgeEntry(topic, "Core mechanism", "Underlying disease mechanism and progression")],
    epidemiology_risk: [mkKnowledgeEntry(topic, "Risk profile", "Population burden and major risk modifiers")],
    clinical_presentation: [mkKnowledgeEntry(topic, "Presentation pattern", "High-yield signs, symptoms, and timeline clues")],
    diagnosis_workup: [mkKnowledgeEntry(topic, "Diagnostic sequence", "Workup sequence with test interpretation caveats")],
    differential: [mkKnowledgeEntry(topic, "Competing diagnoses", "How to separate look-alike conditions")],
    treatment_acute: [mkKnowledgeEntry(topic, "Acute treatment", "First-line stabilization and escalation thresholds")],
    treatment_long_term: [mkKnowledgeEntry(topic, "Long-term treatment", "Maintenance strategy and follow-up cadence")],
    prognosis_complications: [mkKnowledgeEntry(topic, "Prognosis", "Expected trajectory and major complications")],
    patient_counseling_prevention: [mkKnowledgeEntry(topic, "Counseling", "Prevention, adherence, and safety-net guidance")]
  };
}

function mkNarrativeFlow(topic: string) {
  const sectionCoverage = MEDICAL_NARRATIVE_SECTIONS.map((section) => ({
    section,
    medical_takeaways: [`High-yield ${section} takeaway for ${topic}`],
    narrative_translation: `Translate ${section} into a mystery clue sequence anchored to ${topic}.`,
    story_function: `Covers ${section} to preserve clinical reasoning continuity.`,
    stage_name_suggestion: `${section.replaceAll("_", " ")} checkpoint`
  }));

  return {
    medical_narrative_flow: {
      chapter_summary: `Clinical chapter flow for ${topic}: baseline state, disease perturbation, diagnostic narrowing, treatment, and prevention.`,
      progression: [
        {
          stage: "Baseline physiology",
          medical_logic: "Describe normal state before pathology appears.",
          key_teaching_points: ["Recognize normal baselines", "Identify early deviation signals"],
          story_implication: "Establish the city at peace before the first clue appears."
        },
        {
          stage: "Pathology escalation",
          medical_logic: "Map mechanism to signs and symptom evolution.",
          key_teaching_points: ["Mechanism explains presentation", "Risk factors shape pre-test probability"],
          story_implication: "Escalating criminal pattern mirrors worsening disease."
        },
        {
          stage: "Diagnosis and management",
          medical_logic: "Use evidence checkpoints to confirm and treat.",
          key_teaching_points: ["Prioritize differential by evidence", "Match treatment to disease phase"],
          story_implication: "Detectives decode the case and neutralize the threat."
        }
      ],
      section_coverage: sectionCoverage,
      metaphor_map: [
        {
          medical_element: "inflammatory cascade",
          mystery_expression: "crime-network signal cascade",
          pedagogy_reason: "Cause-and-effect chain remains visible."
        },
        {
          medical_element: "diagnostic testing",
          mystery_expression: "forensic checkpoint board",
          pedagogy_reason: "Evidence progression mirrors workup flow."
        }
      ],
      required_plot_events: [
        "Initial anomaly discovery",
        "False lead corrected by evidence",
        "Decisive intervention tied to treatment logic"
      ]
    }
  };
}

function mkReusableVisualPrimer(topic: string) {
  return {
    character_descriptions: [
      "Dr. Ada Vega: lead clinician-detective, focused expression, efficient posture, navy clinical jacket with holo-badge.",
      "Nurse Lee: tactical triage specialist, observant stance, portable scanner wrist rig."
    ],
    recurring_scene_descriptions: [
      `Immune district command hub with diagnostic wall displays for ${topic}.`,
      "Organ-scale investigation corridor with glowing pathology overlays."
    ],
    reusable_visual_elements: [
      "Transparent HUD differential board",
      "Evidence tokens with lab-value callouts",
      "Timeline strip showing symptom progression"
    ],
    continuity_rules: [
      "Keep character wardrobe and proportions consistent across slides.",
      "Maintain the same dashboard visual language and color coding for evidence."
    ]
  };
}

function mkSlide(
  slideId: string,
  title: string,
  topic: string,
  beat: string,
  narrativePhase: "intro" | "body" | "outro",
  slideMode: "hybrid" | "story_transition" = "hybrid",
  medicalVisualMode: "dual_hud_panels" | "in_scene_annotated_visual" = "dual_hud_panels"
) {
  const isTransition = slideMode === "story_transition";
  return {
    slide_id: slideId,
    title,
    slide_mode: slideMode,
    medical_visual_mode: medicalVisualMode,
    narrative_phase: narrativePhase,
    content_md: `${title}: clinical investigation anchored to ${topic}.`,
    speaker_notes: `Teach the decision logic for ${beat}.`,
    hud_panel_bullets: isTransition
      ? []
      : [`${topic}: key teaching point for ${beat}`, "Diagnostic and management cue linked to evidence"],
    location_description: `Scene set in the ${topic} investigation zone with organ-context overlays and command consoles.`,
    evidence_visual_description: `Display clinically accurate ${topic} evidence visuals with labeled findings and trend arrows.`,
    character_staging: "Dr. Ada leans over the evidence console while Nurse Lee cross-checks scanner readouts; both show focused urgency.",
    scene_description: `Cinematic felt-style medical detective scene for ${topic} around beat "${beat}" with educational overlays and continuity-safe lighting.`,
    used_assets: ["Mission HUD overlay", "Evidence board", "Anatomy reference panel"],
    used_characters: ["Dr. Ada Vega", "Nurse Lee"],
    story_and_dialogue: `Story beat: ${beat}. Dialogue: "Ada: The pattern changed at this checkpoint." "Lee: Then the differential narrows now."`
  };
}

function mkFinalSlideSpec(topic: string, targetSlides?: number) {
  const totalSlides = Math.max(100, typeof targetSlides === "number" ? Math.round(targetSlides) : 100);
  const introCount = Math.max(3, Math.round(totalSlides * 0.08));
  const outroCount = Math.max(2, Math.round(totalSlides * 0.05));

  const introSlideIds = Array.from({ length: introCount }, (_, idx) => `S${idx + 1}`);
  const outroSlideIds = Array.from({ length: outroCount }, (_, idx) => `S${totalSlides - outroCount + idx + 1}`);
  const entryToBody = introSlideIds[introSlideIds.length - 1] ?? "S3";
  const returnToOffice = outroSlideIds[0] ?? `S${totalSlides - 1}`;
  const callback = outroSlideIds[outroSlideIds.length - 1] ?? `S${totalSlides}`;

  const sectionBeats: Array<{ label: string; beat: string }> = [
    { label: "Normal physiology", beat: "baseline clues in normal physiology" },
    { label: "Pathophysiology", beat: "pathophysiology reveals the hidden mechanism" },
    { label: "Epidemiology/risk", beat: "risk factors narrow the suspect list" },
    { label: "Clinical presentation", beat: "symptoms become the first witness statements" },
    { label: "Diagnosis/workup", beat: "workup orders expose the culprit pattern" },
    { label: "Differential", beat: "differential suspects are eliminated by evidence" },
    { label: "Treatment (acute)", beat: "acute intervention defuses the crisis" },
    { label: "Treatment (long-term)", beat: "long-term plan prevents repeat offenses" },
    { label: "Prognosis/complications", beat: "complications are the looming secondary threat" },
    { label: "Counseling/prevention", beat: "prevention closes the case permanently" }
  ];

  const slides = Array.from({ length: totalSlides }, (_, idx) => {
    const n = idx + 1;
    const slideId = `S${n}`;
    const narrativePhase: "intro" | "body" | "outro" =
      n <= introCount ? "intro" : n > totalSlides - outroCount ? "outro" : "body";
    const isTransition = slideId === "S2" || (n % 25 === 0 && narrativePhase === "body");
    const slideMode: "hybrid" | "story_transition" = isTransition ? "story_transition" : "hybrid";
    const medicalVisualMode: "dual_hud_panels" | "in_scene_annotated_visual" =
      slideMode === "story_transition" ? "in_scene_annotated_visual" : n % 3 === 0 ? "in_scene_annotated_visual" : "dual_hud_panels";

    let title = `Slide ${slideId}`;
    let beat = "investigation beat";
    if (n === 1) {
      title = "Quirky cold open";
      beat = "intro detective routine";
    } else if (n === 2) {
      title = "Case call and scramble";
      beat = "drop everything and rush to HQ";
    } else if (slideId === entryToBody) {
      title = "Shrink entry launch";
      beat = "office-to-body entry";
    } else if (slideId === returnToOffice) {
      title = "Return to office";
      beat = "case wrapped and normal size restored";
    } else if (slideId === callback) {
      title = "Outro callback";
      beat = "fun payoff tied to intro";
    } else if (n > introCount && n <= totalSlides - outroCount) {
      const section = sectionBeats[(n - introCount - 1) % sectionBeats.length];
      title = `${section.label} checkpoint`;
      beat = section.beat;
    }

    return mkSlide(slideId, title, topic, beat, narrativePhase, slideMode, medicalVisualMode);
  });

  return {
    title: `The ${topic} Caper`,
    reusable_visual_primer: mkReusableVisualPrimer(topic),
    story_arc_contract: {
      intro_slide_ids: introSlideIds,
      outro_slide_ids: outroSlideIds,
      entry_to_body_slide_id: entryToBody,
      return_to_office_slide_id: returnToOffice,
      callback_slide_id: callback
    },
    slides,
    sources: ["https://example.org/clinical-reference"]
  };
}

export async function runFakeStudioPipeline(input: RunInput, runs: RunManager, options: PipelineOptions): Promise<void> {
  const { runId, topic, settings } = input;
  const { signal } = options;
  const outDir = runOutputDirAbs(runId);
  const delayMs = parseDelayMs();

  await ensureDir(outDir);

  const startFrom = options.startFrom ?? "KB0";
  const startIdx = idx(startFrom);
  if (startIdx === -1) throw new Error(`Invalid startFrom: ${startFrom}`);

  const shouldRun = (step: StepName) => idx(step) >= startIdx;

  async function writeJsonArtifact(step: StepName, name: string, obj: unknown): Promise<void> {
    await writeJsonFile(artifactAbsPath(runId, name), obj);
    await runs.addArtifact(runId, step, name);
  }

  async function writeTextArtifact(step: StepName, name: string, text: string): Promise<void> {
    await writeTextFile(artifactAbsPath(runId, name), text);
    await runs.addArtifact(runId, step, name);
  }

  async function runStep(step: StepName, fn: () => Promise<void>): Promise<void> {
    if (!shouldRun(step)) {
      runs.log(runId, `Reusing ${step} artifacts`, step);
      return;
    }

    if (signal.aborted) throw new Error("Cancelled");

    await runs.startStep(runId, step);
    try {
      await wait(delayMs, signal);
      await fn();
      await runs.finishStep(runId, step, true);
    } catch (err) {
      const msg = toErrorMessage(err);
      await runs.finishStep(runId, step, false, msg);
      throw err;
    }
  }

  async function ensureFinalArtifacts(): Promise<void> {
    const finalPatchedPath = artifactAbsPath(runId, "final_slide_spec_patched.json");
    const finalSlideSpecPatched = mkFinalSlideSpec(topic, settings?.targetSlides);
    if (!existsSync(finalPatchedPath)) {
      await writeJsonArtifact("N", "final_slide_spec_patched.json", {
        final_slide_spec_patched: finalSlideSpecPatched
      });
    }
    const primerPath = artifactAbsPath(runId, "reusable_visual_primer.json");
    if (!existsSync(primerPath)) {
      await writeJsonArtifact("N", "reusable_visual_primer.json", {
        reusable_visual_primer: finalSlideSpecPatched.reusable_visual_primer
      });
    }
    const qaPath = artifactAbsPath(runId, "qa_report.json");
    if (!existsSync(qaPath)) {
      await writeJsonArtifact("M", "qa_report.json", {
        qa_report: {
          pass: true,
          patch_list: []
        }
      });
    }
  }

  runs.log(runId, `Pipeline start (fake mode, startFrom=${startFrom})`);
  runs.log(runId, "Fake pipeline enabled: no external model calls.");

  const traceId = `trace_fake_${runId}`;
  await runs.setTraceId(runId, traceId);
  await writeJsonFile(artifactAbsPath(runId, "trace.json"), { traceId, mode: "fake", started_at: nowIso() });
  await runs.addArtifact(runId, "KB0", "trace.json");

  const canonicalPaths = resolveCanonicalProfilePaths();
  const foundAny =
    (canonicalPaths.characterBiblePath ? existsSync(canonicalPaths.characterBiblePath) : false) ||
    (canonicalPaths.seriesStyleBiblePath ? existsSync(canonicalPaths.seriesStyleBiblePath) : false) ||
    (canonicalPaths.deckSpecPath ? existsSync(canonicalPaths.deckSpecPath) : false);

  await runs.setCanonicalSources(runId, { ...canonicalPaths, foundAny });
  await writeJsonArtifact("KB0", "canonical_profile_sources.json", canonicalPaths);

  await runStep("KB0", async () => {
    const kb = [
      "## Medical / Clinical KB",
      "Rapid assessment cues and differential framing for the selected topic.",
      "",
      "## Characters & Story Constraints",
      "Use stable recurring character identities and role continuity.",
      "",
      "## Visual Style / Shot Constraints",
      "Favor clean educational diagrams and low-noise compositions."
    ].join("\n");

    await writeTextArtifact("KB0", "kb_context.md", kb);
  });

  await runStep("A", async () => {
    await writeJsonArtifact("A", "producer_brief.json", {
      producer_brief: {
        title: `Malady Mystery: ${topic}`,
        learning_goal: `Teach a PCP-ready chapter for ${topic} through a narrative case format.`,
        target_audience: settings?.level ?? "student",
        key_constraints: [
          "Preserve canonical character/style constraints when available",
          "Maintain medically accurate teaching points on every slide"
        ],
        outline: ["Clinical baseline", "Pathology and risk", "Diagnosis and differential", "Acute and longitudinal management"],
        tone: "cinematic, rigorous, educational"
      }
    });
  });

  await runStep("B", async () => {
    await writeJsonArtifact("B", "facts_library_raw.json", {
      facts_library: mkMedicalChapter(topic)
    });
  });

  await runStep("C", async () => {
    await writeJsonArtifact("C", "facts_library_clean.json", {
      facts_library_clean: mkMedicalChapter(topic)
    });

    await writeJsonArtifact("C", "editor_notes.json", {
      editor_notes: {
        changes_made: ["Normalized terminology for PCP-level clarity", "Removed duplicate phrasing across chapter sections"],
        red_flags: ["No conflicting guideline statements detected in fake mode"],
        completeness_checks: [
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
        ]
      }
    });
  });

  await runStep("D", async () => {
    await writeJsonArtifact("D", "medical_atoms.json", {
      medical_atoms: [
        { atom_id: "A1", statement: `Identify high-risk presentation signals in ${topic}.`, common_pitfalls: ["Anchoring on first clue"] },
        { atom_id: "A2", statement: `Sequence workup and treatment decisions for ${topic}.`, common_pitfalls: ["Delaying escalation triggers"] }
      ]
    });

    await writeJsonArtifact("D", "teaching_blueprint.json", {
      teaching_blueprint: {
        sequence: ["A1", "A2"],
        misconceptions_to_address: ["Single-finding diagnosis certainty", "One-size-fits-all management"],
        end_state: `Learner can diagnose and manage ${topic} in primary care context.`
      }
    });
  });

  await runStep("E", async () => {
    const assessment_bank = Array.from({ length: 30 }, (_, idx) => {
      const n = idx + 1;
      return {
        question_id: `Q${n}`,
        stem: `Q${n}: Which action is most appropriate given the current ${topic} clues?`,
        choices: ["A", "B", "C", "D"],
        answer_index: 0,
        explanation: "This choice best matches the clinical evidence and safety priorities."
      };
    });
    await writeJsonArtifact("E", "assessment_bank.json", {
      assessment_bank
    });
  });

  await runStep("F", async () => {
    const spec = mkFinalSlideSpec(topic, settings?.targetSlides);
    const slide_skeleton = spec.slides.map((slide) => {
      const bullets =
        Array.isArray(slide.hud_panel_bullets) && slide.hud_panel_bullets.length > 0 ? slide.hud_panel_bullets.slice(0, 3) : ["transition beat"];
      const story_goal =
        slide.narrative_phase === "intro"
          ? "Establish tone, receive case, and enter the body"
          : slide.narrative_phase === "outro"
            ? "Return to office and close the loop"
            : slide.slide_mode === "story_transition"
              ? "Move location or escalate action without adding medical bullets"
              : "Advance investigation and teach the next medical checkpoint";

      return {
        slide_id: slide.slide_id,
        title: slide.title,
        objective: `Teach ${topic} via a cinematic medical mystery beat.`,
        bullets,
        slide_mode: slide.slide_mode,
        narrative_phase: slide.narrative_phase,
        story_goal
      };
    });

    await writeJsonArtifact("F", "slide_skeleton.json", {
      slide_skeleton
    });

    await writeJsonArtifact("F", "coverage.json", {
      coverage: {
        atoms_covered: ["A1", "A2"],
        gaps: []
      }
    });
  });

  await runStep("G", async () => {
    const narrativeFlow = mkNarrativeFlow(topic);
    await writeJsonArtifact("G", "medical_narrative_flow.json", narrativeFlow);

    await writeJsonArtifact("G", "story_seed.json", {
      story_seed: {
        logline: `Detectives inside the body-city decode a ${topic} conspiracy before system collapse.`,
        setting: "Immune district command center and affected organ corridors",
        cast: ["Dr. Ada Vega", "Nurse Lee"],
        stakes: `If the team misses key ${topic} signals, the city destabilizes.`,
        medical_backbone_summary: narrativeFlow.medical_narrative_flow.chapter_summary,
        metaphor_map: narrativeFlow.medical_narrative_flow.metaphor_map.map((m) => ({
          medical_element: m.medical_element,
          mystery_expression: m.mystery_expression,
          teaching_value: m.pedagogy_reason
        })),
        action_moments: [
          "Emergency evidence-board pivot during escalating vitals",
          "Rapid intervention against a cascading physiologic threat"
        ],
        intrigue_twists: ["Primary suspect mechanism is a decoy", "Second pathology overlaps with the first pattern"],
        variety_pack: {
          genre_wrapper: "medical noir",
          body_setting: "overnight ED shift",
          antagonist_archetype: "anchoring bias",
          twist_type: "two conditions are happening at once",
          signature_gadget: "a whiteboard of shifting differentials",
          motifs: ["signal vs noise", "team handoffs", "protocol vs intuition"]
        }
      }
    });
  });

  await runStep("H", async () => {
    await writeJsonArtifact("H", "story_bible.json", {
      story_bible: {
        premise: `A clinical mystery around ${topic} where medical clues become forensic evidence.`,
        rules: ["Clinical logic must drive each plot turn", "Canonical character constraints remain stable"],
        recurring_motifs: ["signal vs noise", "evidence checkpoint board"],
        cast: [
          {
            name: "Dr. Ada Vega",
            role: "Lead clinician detective",
            bio: "Rapid differential strategist with calm command presence.",
            traits: ["decisive", "empathetic", "methodical"],
            constraints: ["maintain educational clarity", "avoid sensationalism over evidence"]
          },
          {
            name: "Nurse Lee",
            role: "Triage intelligence specialist",
            bio: "Spots subtle vitals patterns and continuity breaks.",
            traits: ["observant", "steady", "direct"],
            constraints: ["surface hidden clues", "keep patient-centered framing"]
          }
        ],
        story_constraints_used: ["Clinical evidence checkpoints", "Canonical cast continuity"],
        visual_constraints_used: ["Legible HUD overlays", "Low-noise educational composition"]
      }
    });

    await writeJsonArtifact("H", "episode_arc.json", {
      episode_arc: {
        intro_beats: ["Quirky detective opening", "Case acquisition", "Office return and shrink launch"],
        body_beats: ["Evidence-driven differential", "Intervention and stabilization", "Prevention closeout"],
        outro_beats: ["Return to normal size in office", "Fun callback ending"],
        entry_to_body_beat: "Office return and shrink launch",
        return_to_office_beat: "Return to normal size in office",
        callback_beat: "Fun callback ending"
      }
    });

    await writeJsonArtifact("H", "beat_sheet.json", {
      beat_sheet: [
        {
          beat: "Red flag arrival",
          purpose: "Reveal first pathophysiology clue and urgency",
          characters: ["Dr. Ada Vega", "Nurse Lee"],
          setting: "Immune district triage atrium"
        },
        {
          beat: "Differential pivot",
          purpose: "Use evidence to demote false lead and choose treatment branch",
          characters: ["Dr. Ada Vega"],
          setting: "Diagnostic command wall"
        },
        {
          beat: "Return and callback",
          purpose: "Return to office and deliver full-circle ending",
          characters: ["Dr. Ada Vega", "Nurse Lee"],
          setting: "Office HQ"
        }
      ]
    });
  });

  await runStep("I", async () => {
    await writeJsonArtifact("I", "shot_list.json", {
      shot_list: [
        {
          shot_id: "SH1",
          moment: "Case escalation checkpoint",
          framing: "Medium wide",
          visual_notes: "Clean holographic overlays, annotated organ map, high-contrast evidence tags."
        }
      ]
    });
  });

  await runStep("J", async () => {
    const spec = mkFinalSlideSpec(topic, settings?.targetSlides);
    const totalMinutes = settings?.durationMinutes ?? 20;
    const totalSeconds = Math.max(1, Math.round(totalMinutes * 60));
    const secondsPerSlide = Math.max(20, Math.round(totalSeconds / spec.slides.length));
    await writeJsonArtifact("J", "pacing_map.json", {
      pacing_map: {
        total_minutes: totalMinutes,
        per_slide_seconds: spec.slides.map((slide) => ({ slide_id: slide.slide_id, seconds: secondsPerSlide })),
        transitions: ["match-cut to evidence board", "tight zoom to intervention panel"]
      }
    });
  });

  await runStep("K", async () => {
    const spec = mkFinalSlideSpec(topic, settings?.targetSlides);
    const totalSlides = spec.slides.length;
    const pickSlideId = (fraction: number) => `S${Math.min(totalSlides, Math.max(1, Math.round(totalSlides * fraction)))}`;
    const selectedQuestions = ["Q1", "Q2", "Q3", "Q4", "Q5"];
    await writeJsonArtifact("K", "alignment_plan.json", {
      alignment_plan: {
        slide_to_atoms: [
          { slide_id: "S1", atom_ids: ["A1"] },
          { slide_id: "S2", atom_ids: [] },
          { slide_id: "S3", atom_ids: ["A1"] },
          { slide_id: pickSlideId(0.4), atom_ids: ["A1", "A2"] },
          { slide_id: pickSlideId(0.7), atom_ids: ["A2"] }
        ],
        slide_to_assessment: [
          { slide_id: pickSlideId(0.25), question_ids: [selectedQuestions[0]] },
          { slide_id: pickSlideId(0.35), question_ids: [selectedQuestions[1]] },
          { slide_id: pickSlideId(0.5), question_ids: [selectedQuestions[2]] },
          { slide_id: pickSlideId(0.65), question_ids: [selectedQuestions[3]] },
          { slide_id: pickSlideId(0.8), question_ids: [selectedQuestions[4]] }
        ],
        coverage_notes: ["Each slide ties back to at least one medical atom."]
      }
    });
  });

  await runStep("L", async () => {
    await writeJsonArtifact("L", "final_slide_spec.json", {
      final_slide_spec: mkFinalSlideSpec(topic, settings?.targetSlides)
    });
  });

  await runStep("M", async () => {
    const depthReport = evaluateMedicalDepth(mkMedicalChapter(topic), {
      level: settings?.level ?? "student",
      mode: settings?.adherenceMode ?? "strict",
      checkedAt: nowIso()
    });
    await writeJsonArtifact("M", "medical_depth_report.json", depthReport);

    await writeJsonArtifact("M", "qa_report_iter1.json", {
      qa_report: {
        pass: false,
        patch_list: [
          {
            target: "S2",
            instruction: "Clarify evidence checkpoint language in story_and_dialogue and HUD bullets.",
            severity: "must"
          }
        ],
        notes: ["Transition from differential to intervention can be more explicit."]
      }
    });
  });

  await runStep("N", async () => {
    const patchedIter1 = mkFinalSlideSpec(topic, settings?.targetSlides);
    patchedIter1.slides[1] = {
      ...patchedIter1.slides[1],
      story_and_dialogue:
        'Story beat: evidence pivot under pressure. Dialogue: "Ada: This marker excludes the false lead." "Lee: Then we move to targeted intervention now."'
    };

    await writeJsonArtifact("N", "final_slide_spec_patched_iter1.json", {
      final_slide_spec_patched: patchedIter1
    });

    const finalPatched = mkFinalSlideSpec(topic, settings?.targetSlides);
    await writeJsonArtifact("N", "final_slide_spec_patched.json", {
      final_slide_spec_patched: finalPatched
    });

    await writeJsonArtifact("N", "reusable_visual_primer.json", {
      reusable_visual_primer: finalPatched.reusable_visual_primer
    });
  });

  await runStep("M", async () => {
    await writeJsonArtifact("M", "qa_report_iter2.json", {
      qa_report: {
        pass: true,
        patch_list: [],
        notes: ["Patch resolved clarity issue."]
      }
    });

    await writeJsonArtifact("M", "qa_report.json", {
      qa_report: {
        pass: true,
        patch_list: [],
        notes: ["Final QA pass."]
      }
    });
  });

  await runStep("O", async () => {
    await ensureFinalArtifacts();
    const finalPatched = mkFinalSlideSpec(topic, settings?.targetSlides);

    await writeTextArtifact(
      "O",
      "GENSPARK_ASSET_BIBLE.md",
      [
        "# Genspark Asset Bible",
        `- Topic: ${topic}`,
        "- Visual tone: clean, cinematic educational frames",
        "- Character consistency: Dr. Ada Vega, Nurse Lee"
      ].join("\n")
    );

    await writeTextArtifact(
      "O",
      "GENSPARK_SLIDE_GUIDE.md",
      [
        "# Genspark Slide Guide",
        "1. Start with symptom framing",
        "2. Show differential pruning",
        "3. End with intervention checklist"
      ].join("\n")
    );

    await writeTextArtifact(
      "O",
      "GENSPARK_BUILD_SCRIPT.txt",
      ["LOAD final_slide_spec_patched.json", "APPLY style guide", "EXPORT deck package"].join("\n")
    );

    const traceability = buildMedicalStoryTraceabilityReport({
      createdAt: nowIso(),
      narrativeFlow: mkNarrativeFlow(topic).medical_narrative_flow,
      finalPatched
    });
    await writeJsonArtifact("O", "medical_story_traceability_report.json", traceability);

    const slideModeCounts = {
      hybrid: finalPatched.slides.filter((s) => s.slide_mode === "hybrid").length,
      story_transition: finalPatched.slides.filter((s) => s.slide_mode === "story_transition").length
    };

    const adherenceReport: ConstraintAdherenceReport = {
      status: "pass",
      checked_at: nowIso(),
      canonical_sources: { ...canonicalPaths, foundAny },
      failures: [],
      warnings: [],
      details: {
        canonical_characters: foundAny ? ["Dr. Ada Vega", "Nurse Lee"] : [],
        matched_story_characters: foundAny ? ["Dr. Ada Vega", "Nurse Lee"] : [],
        missing_story_characters: [],
        required_style_rules_checked: foundAny ? 3 : 0,
        required_style_rule_hits: foundAny ? 3 : 0,
        forbidden_style_hits: [],
        slide_mode_counts: slideModeCounts,
        intro_outro_contract_status: { status: "pass", issues: [] },
        medical_only_violations: [],
        master_doc_validation_status: "not_checked"
      }
    };

    await writeJsonArtifact("O", "constraint_adherence_report.json", adherenceReport);
    await runs.setConstraintAdherence(runId, summarizeConstraintAdherence(adherenceReport));
  });

  await runStep("P", async () => {
    const finalPatchedRaw = await fs.readFile(artifactAbsPath(runId, "final_slide_spec_patched.json"), "utf8");
    const finalPatched = JSON.parse(finalPatchedRaw) as { final_slide_spec_patched: ReturnType<typeof mkFinalSlideSpec> };
    const gensparkAssetBibleMd = await fs.readFile(artifactAbsPath(runId, "GENSPARK_ASSET_BIBLE.md"), "utf8");
    const gensparkSlideGuideMd = await fs.readFile(artifactAbsPath(runId, "GENSPARK_SLIDE_GUIDE.md"), "utf8");
    const gensparkBuildScriptTxt = await fs.readFile(artifactAbsPath(runId, "GENSPARK_BUILD_SCRIPT.txt"), "utf8");
    const storyBible = (await fs
      .readFile(artifactAbsPath(runId, "story_bible.json"), "utf8")
      .then((raw) => JSON.parse(raw) as {
        story_bible: {
          premise: string;
          rules: string[];
          recurring_motifs: string[];
          cast: Array<{ name: string; role: string; bio: string; traits: string[]; constraints: string[] }>;
          story_constraints_used: string[];
          visual_constraints_used: string[];
        };
      })
      .catch(() => ({
        story_bible: {
          premise: `Fallback story bible for ${topic}`,
          rules: ["keep continuity"],
          recurring_motifs: ["signal vs noise"],
          cast: [{ name: "Dr. Ada Vega", role: "lead", bio: "Fallback lead", traits: ["calm"], constraints: ["no cruelty"] }],
          story_constraints_used: ["fallback"],
          visual_constraints_used: ["fallback"]
        }
      }))) as {
      story_bible: {
        premise: string;
        rules: string[];
        recurring_motifs: string[];
        cast: Array<{ name: string; role: string; bio: string; traits: string[]; constraints: string[] }>;
        story_constraints_used: string[];
        visual_constraints_used: string[];
      };
    };
    const beatSheet = (await fs
      .readFile(artifactAbsPath(runId, "beat_sheet.json"), "utf8")
      .then((raw) => JSON.parse(raw) as { beat_sheet: Array<{ beat: string; purpose: string; characters: string[]; setting: string }> })
      .catch(() => ({
        beat_sheet: [{ beat: "fallback beat", purpose: "fallback purpose", characters: ["Dr. Ada Vega"], setting: "HQ" }]
      }))) as { beat_sheet: Array<{ beat: string; purpose: string; characters: string[]; setting: string }> };
    const shotList = (await fs
      .readFile(artifactAbsPath(runId, "shot_list.json"), "utf8")
      .then((raw) => JSON.parse(raw) as { shot_list: Array<{ shot_id: string; moment: string; framing: string; visual_notes: string }> })
      .catch(() => ({
        shot_list: [{ shot_id: "SH1", moment: "fallback shot", framing: "medium", visual_notes: "fallback visual notes" }]
      }))) as { shot_list: Array<{ shot_id: string; moment: string; framing: string; visual_notes: string }> };

    const baseDoc = buildGensparkMasterDoc({
      topic,
      finalPatched: finalPatched.final_slide_spec_patched,
      reusableVisualPrimer: finalPatched.final_slide_spec_patched.reusable_visual_primer,
      storyBible: storyBible.story_bible,
      beatSheet: beatSheet.beat_sheet,
      shotList: shotList.shot_list,
      gensparkAssetBibleMd,
      gensparkSlideGuideMd,
      gensparkBuildScriptTxt
    });

    await writeTextArtifact("P", "GENSPARK_MASTER_RENDER_PLAN_BASE.md", baseDoc);
    const validation = validateGensparkMasterDoc(baseDoc, finalPatched.final_slide_spec_patched.slides);
    const finalDoc = validation.ok ? baseDoc : `${baseDoc}\n`;
    await writeTextArtifact("P", "GENSPARK_MASTER_RENDER_PLAN.md", finalDoc);

    const adherenceRaw = await fs.readFile(artifactAbsPath(runId, "constraint_adherence_report.json"), "utf8").catch(() => null);
    if (adherenceRaw) {
      const adherence = JSON.parse(adherenceRaw) as ConstraintAdherenceReport;
      const next: ConstraintAdherenceReport = {
        ...adherence,
        details: {
          ...adherence.details,
          master_doc_validation_status: validation.ok ? "pass" : "fail"
        },
        warnings: validation.ok ? adherence.warnings : [...adherence.warnings, ...validation.errors]
      };
      await writeJsonArtifact("P", "constraint_adherence_report.json", next);
      await runs.setConstraintAdherence(runId, summarizeConstraintAdherence(next));
    }
  });
}
