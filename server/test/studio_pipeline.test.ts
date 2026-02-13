import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

vi.mock("@openai/agents", () => {
  type RunResult = { finalOutput?: unknown };
  type SafeParse = (value: unknown) => { success: true; data: unknown } | { success: false; error: { message: string } };
  type MockAgent = { name: string; outputType?: unknown };
  type Handler = (agent: MockAgent, prompt: string, options: unknown) => Promise<RunResult> | RunResult;

  let handler: Handler | null = null;

  class AgentsError extends Error {
    state: unknown;
    constructor(message: string, state: unknown) {
      super(message);
      this.name = new.target.name;
      this.state = state;
    }
  }

  class ModelBehaviorError extends AgentsError {}
  class MaxTurnsExceededError extends AgentsError {}

  function isSafeParseSchema(x: unknown): x is { safeParse: SafeParse } {
    if (!x || typeof x !== "object") return false;
    const rec = x as Record<string, unknown>;
    return typeof rec.safeParse === "function";
  }

  class Agent {
    name: string;
    outputType?: unknown;
    constructor(config: Record<string, unknown> & { name: string; outputType?: unknown }) {
      this.name = config.name;
      this.outputType = config.outputType;
      Object.assign(this, config);
    }
  }

  function fileSearchTool(...args: unknown[]) {
    return { type: "file_search", args };
  }

  function webSearchTool(...args: unknown[]) {
    return { type: "web_search", args };
  }

  class Runner {
    async run(agent: MockAgent, prompt: string, options: unknown): Promise<RunResult> {
      if (!handler) throw new Error("No mock Runner handler set");
      const res = await handler(agent, prompt, options);
      if (res.finalOutput && isSafeParseSchema(agent.outputType)) {
        const parsed = agent.outputType.safeParse(res.finalOutput);
        if (!parsed.success) {
          const state = {
            _modelResponses: [
              {
                output: [
                  {
                    role: "assistant",
                    status: "completed",
                    content: [{ type: "output_text", text: JSON.stringify(res.finalOutput) }]
                  }
                ]
              }
            ]
          };
          throw new ModelBehaviorError(`Invalid agent output for ${agent?.name ?? "unknown"}: ${parsed.error.message}`, state);
        }
        return { finalOutput: parsed.data };
      }
      return res;
    }
  }

  function setDefaultOpenAIKey() {
    // no-op in tests
  }

  async function withTrace<T>(_name: string, fn: (trace: { traceId: string }) => Promise<T>): Promise<T> {
    return await fn({ traceId: "trace_test" });
  }

  function __setMockRunnerHandler(next: Handler | null) {
    handler = next;
  }

  return {
    Agent,
    Runner,
    fileSearchTool,
    webSearchTool,
    setDefaultOpenAIKey,
    withTrace,
    __setMockRunnerHandler,
    AgentsError,
    ModelBehaviorError,
    MaxTurnsExceededError
  };
});

type MockAgent = { name: string; outputType?: unknown };
type RunnerModule = {
  __setMockRunnerHandler?: ((fn: ((agent: MockAgent, prompt: string, options: unknown) => unknown) | null) => void) | undefined;
};

function jsonBlock(prompt: string, start: string, end: string): unknown {
  const sIdx = prompt.indexOf(start);
  if (sIdx === -1) throw new Error(`missing marker: ${start}`);
  const after = prompt.slice(sIdx + start.length);
  const eIdx = after.indexOf(end);
  if (eIdx === -1) throw new Error(`missing end marker: ${end}`);
  const raw = after.slice(0, eIdx).trim();
  return JSON.parse(raw) as unknown;
}

function minimalProducerBrief() {
  return {
    producer_brief: {
      title: "Test Episode",
      learning_goal: "Learn X",
      target_audience: "student",
      key_constraints: ["local"],
      outline: ["intro", "content", "wrap"],
      tone: "clear"
    }
  };
}

function minimalFactsRaw() {
  const entry = {
    concept: "Concept 1",
    clinically_relevant_detail: "Clinical detail",
    why_it_matters_for_pcp: "Directly affects PCP management decisions.",
    citations: ["https://example.com"],
    confidence: 0.9
  };
  return {
    facts_library: {
      normal_physiology: [entry],
      pathophysiology: [entry],
      epidemiology_risk: [entry],
      clinical_presentation: [entry],
      diagnosis_workup: [entry],
      differential: [entry],
      treatment_acute: [entry],
      treatment_long_term: [entry],
      prognosis_complications: [entry],
      patient_counseling_prevention: [entry]
    }
  };
}

function minimalEditorOut() {
  return {
    facts_library_clean: minimalFactsRaw().facts_library,
    editor_notes: {
      changes_made: ["deduped"],
      red_flags: ["none"],
      completeness_checks: ["all required sections present"]
    }
  };
}

function minimalMedicalNarrativeFlowOut() {
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
    medical_takeaways: [`Key ${section} takeaway`],
    narrative_translation: `Translate ${section} to an evidence-driven mystery beat.`,
    story_function: `Preserve ${section} logic in the story spine.`,
    stage_name_suggestion: `${section} checkpoint`
  }));

  return {
    medical_narrative_flow: {
      chapter_summary: "Baseline to pathology to diagnosis and treatment progression.",
      progression: [
        {
          stage: "Baseline",
          medical_logic: "Normal physiology baseline",
          key_teaching_points: ["Understand normal state"],
          story_implication: "Peace before disruption"
        }
      ],
      section_coverage: sectionCoverage,
      metaphor_map: [
        {
          medical_element: "pathophysiology",
          mystery_expression: "criminal network pattern",
          pedagogy_reason: "Maintains causal teaching flow"
        }
      ],
      required_plot_events: ["anomaly discovered", "evidence checkpoint", "targeted intervention"]
    }
  };
}

function minimalCurriculumOut() {
  return {
    medical_atoms: [{ atom_id: "A1", statement: "Atom 1", common_pitfalls: ["pitfall"] }],
    teaching_blueprint: { sequence: ["A1"], misconceptions_to_address: ["none"], end_state: "understands" }
  };
}

function minimalAssessmentOut() {
  return {
    assessment_bank: [
      { question_id: "Q1", stem: "Stem", choices: ["a", "b"], answer_index: 0, explanation: "Because" }
    ]
  };
}

function minimalSlideArchitectOut() {
  return {
    slide_skeleton: [
      {
        slide_id: "S1",
        title: "Intro 1",
        objective: "Obj",
        bullets: ["b1"],
        slide_mode: "hybrid",
        narrative_phase: "intro",
        story_goal: "Quirky opening"
      },
      {
        slide_id: "S2",
        title: "Intro 2",
        objective: "Obj",
        bullets: ["b2"],
        slide_mode: "story_transition",
        narrative_phase: "intro",
        story_goal: "Case received"
      },
      {
        slide_id: "S3",
        title: "Intro 3",
        objective: "Obj",
        bullets: ["b3"],
        slide_mode: "hybrid",
        narrative_phase: "intro",
        story_goal: "Shrink entry"
      },
      {
        slide_id: "S4",
        title: "Outro 1",
        objective: "Obj",
        bullets: ["b4"],
        slide_mode: "hybrid",
        narrative_phase: "outro",
        story_goal: "Return office"
      },
      {
        slide_id: "S5",
        title: "Outro 2",
        objective: "Obj",
        bullets: ["b5"],
        slide_mode: "hybrid",
        narrative_phase: "outro",
        story_goal: "Callback"
      }
    ],
    coverage: { atoms_covered: ["A1"], gaps: [] }
  };
}

function minimalShowrunnerOut() {
  return {
    story_bible: {
      premise: "premise",
      rules: ["rule"],
      recurring_motifs: ["motif"],
      cast: [
        {
          name: "Dr. Ada",
          role: "attending",
          bio: "A pragmatic clinician.",
          traits: ["calm", "direct"],
          constraints: ["no cruelty"]
        }
      ],
      story_constraints_used: ["use canonical characters"],
      visual_constraints_used: ["avoid gore"]
    },
    episode_arc: {
      intro_beats: ["quirky opening", "case acquisition", "shrink entry"],
      body_beats: ["investigation"],
      outro_beats: ["return to office", "callback ending"],
      entry_to_body_beat: "shrink entry",
      return_to_office_beat: "return to office",
      callback_beat: "callback ending"
    },
    beat_sheet: [{ beat: "beat1", purpose: "purpose1", characters: ["Dr. Ada"], setting: "ED" }]
  };
}

function minimalVisualOut() {
  return { shot_list: [{ shot_id: "SH1", moment: "m", framing: "f", visual_notes: "v" }] };
}

function minimalPacingOut() {
  return {
    pacing_map: {
      total_minutes: 10,
      per_slide_seconds: [{ slide_id: "S1", seconds: 60 }],
      transitions: ["t"]
    }
  };
}

function minimalMapperOut() {
  return {
    alignment_plan: {
      slide_to_atoms: [{ slide_id: "S1", atom_ids: ["A1"] }],
      slide_to_assessment: [{ slide_id: "S1", question_ids: ["Q1"] }],
      coverage_notes: ["ok"]
    }
  };
}

function minimalStorySeed(
  variety: Record<string, unknown>,
  overrides?: Partial<{
    logline: string;
    setting: string;
    cast: string[];
    stakes: string;
  }>
) {
  return {
    logline: overrides?.logline ?? "logline",
    setting: overrides?.setting ?? "setting",
    cast: overrides?.cast ?? ["a"],
    stakes: overrides?.stakes ?? "stakes",
    medical_backbone_summary: "chapter summary",
    metaphor_map: [
      {
        medical_element: "pathophysiology",
        mystery_expression: "hidden criminal mechanism",
        teaching_value: "maps causal chain to plot"
      }
    ],
    action_moments: ["action beat"],
    intrigue_twists: ["twist beat"],
    variety_pack: variety
  };
}

function minimalSlideScene(
  slideId: string,
  content: string,
  narrativePhase: "intro" | "body" | "outro",
  slideMode: "hybrid" | "story_transition" = "hybrid",
  medicalVisualMode: "dual_hud_panels" | "in_scene_annotated_visual" = "dual_hud_panels"
) {
  return {
    slide_id: slideId,
    title: `Slide ${slideId}`,
    slide_mode: slideMode,
    medical_visual_mode: medicalVisualMode,
    narrative_phase: narrativePhase,
    content_md: content,
    speaker_notes: "notes",
    hud_panel_bullets: slideMode === "story_transition" ? [] : ["teaching bullet"],
    location_description: "Scene in organ command center.",
    evidence_visual_description: "Annotated medically accurate evidence panel.",
    character_staging: "Characters lean into dashboard with focused expression.",
    scene_description: "Detailed cinematic scene with educational overlays.",
    used_assets: ["Evidence board"],
    used_characters: ["Dr. Ada"],
    story_and_dialogue: 'Story beat with dialogue: "Ada: evidence points here."'
  };
}

function minimalSlideSpecOut() {
  return {
    final_slide_spec: {
      title: "Final Spec",
      reusable_visual_primer: {
        character_descriptions: ["Dr. Ada profile"],
        recurring_scene_descriptions: ["Immune district HQ"],
        reusable_visual_elements: ["Evidence board"],
        continuity_rules: ["Keep character styling consistent"]
      },
      story_arc_contract: {
        intro_slide_ids: ["S1", "S2", "S3"],
        outro_slide_ids: ["S4", "S5"],
        entry_to_body_slide_id: "S3",
        return_to_office_slide_id: "S4",
        callback_slide_id: "S5"
      },
      slides: [
        minimalSlideScene("S1", "content 1", "intro"),
        minimalSlideScene("S2", "content 2", "intro", "story_transition", "in_scene_annotated_visual"),
        minimalSlideScene("S3", "content 3", "intro"),
        minimalSlideScene("S4", "content 4", "outro"),
        minimalSlideScene("S5", "content 5", "outro")
      ],
      sources: ["https://example.com"]
    }
  };
}

function minimalQa(pass: boolean) {
  return pass
    ? { qa_report: { pass: true, patch_list: [], notes: ["ok"] } }
    : {
        qa_report: {
          pass: false,
          patch_list: [{ target: "S1", instruction: "Fix wording", severity: "must" }],
          notes: ["needs fix"]
        }
      };
}

function minimalPatchedSpecOut() {
  return {
    final_slide_spec_patched: {
      title: "Final Spec (Patched)",
      reusable_visual_primer: {
        character_descriptions: ["Dr. Ada profile"],
        recurring_scene_descriptions: ["Immune district HQ"],
        reusable_visual_elements: ["Evidence board"],
        continuity_rules: ["Keep character styling consistent"]
      },
      story_arc_contract: {
        intro_slide_ids: ["S1", "S2", "S3"],
        outro_slide_ids: ["S4", "S5"],
        entry_to_body_slide_id: "S3",
        return_to_office_slide_id: "S4",
        callback_slide_id: "S5"
      },
      slides: [
        minimalSlideScene("S1", "content patched 1", "intro"),
        minimalSlideScene("S2", "content patched 2", "intro", "story_transition", "in_scene_annotated_visual"),
        minimalSlideScene("S3", "content patched 3", "intro"),
        minimalSlideScene("S4", "content patched 4", "outro"),
        minimalSlideScene("S5", "content patched 5", "outro")
      ],
      sources: ["https://example.com"]
    }
  };
}

function minimalGensparkOut() {
  return {
    genspark_asset_bible_md: "# Assets\n- A",
    genspark_slide_guide_md: "# Guide\n- G",
    genspark_build_script_txt: "1) build"
  };
}

let tmpOut: string | null = null;
let tmpData: string | null = null;

beforeEach(async () => {
  tmpOut = await fs.mkdtemp(path.join(os.tmpdir(), "mms-out-"));
  tmpData = await fs.mkdtemp(path.join(os.tmpdir(), "mms-data-"));
  process.env.MMS_OUTPUT_DIR = tmpOut;
  process.env.MMS_DATA_DIR = tmpData;
  process.env.MMS_DISABLE_CANON_AUTO_DISCOVERY = "1";
  process.env.OPENAI_API_KEY = "sk-test";
  process.env.KB_VECTOR_STORE_ID = "vs_test";

  // Seed memory with a prior run so step G has non-empty "recent variety" context.
  await fs.writeFile(
    path.join(tmpData, "episode_memory.json"),
    JSON.stringify(
      {
        recent: [
          {
            at: new Date("2020-01-01T00:00:00.000Z").toISOString(),
            runId: "prev_run",
            key: "prev_key",
            variety: {
              genre_wrapper: "medical noir",
              body_setting: "overnight ED shift",
              antagonist_archetype: "anchoring bias",
              twist_type: "the obvious diagnosis is wrong",
              signature_gadget: "a battered pocket ultrasound",
              motifs: ["misdirection", "countdown clocks", "pattern recognition"]
            }
          }
        ]
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
});

afterEach(async () => {
  const agents = (await import("@openai/agents")) as RunnerModule;
  agents.__setMockRunnerHandler?.(null);

  delete process.env.MMS_OUTPUT_DIR;
  delete process.env.MMS_DATA_DIR;
  delete process.env.MMS_DISABLE_CANON_AUTO_DISCOVERY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.KB_VECTOR_STORE_ID;

  if (tmpOut) await fs.rm(tmpOut, { recursive: true, force: true }).catch(() => undefined);
  if (tmpData) await fs.rm(tmpData, { recursive: true, force: true }).catch(() => undefined);
  tmpOut = null;
  tmpData = null;
});

describe("runStudioPipeline", () => {
  it("runs end-to-end with QA pass (skips patch agent) and writes final artifacts", async () => {
    const { RunManager } = await import("../src/run_manager.js");
    const { runStudioPipeline } = await import("../src/pipeline/studio_pipeline.js");
    const { artifactAbsPath, readJsonFile } = await import("../src/pipeline/utils.js");

    const calls: string[] = [];

    const agents = (await import("@openai/agents")) as RunnerModule;
    agents.__setMockRunnerHandler?.((agent: MockAgent, prompt: string) => {
      calls.push(agent.name);

      if (agent.name === "KB Compiler") return { finalOutput: { kb_context: "# KB\n- item" } };
      if (agent.name === "Producer") {
        // Settings should be present in prompt.
        expect(prompt).toContain("RUN SETTINGS (json):");
        expect(prompt).toContain("\"durationMinutes\": 20");
        return { finalOutput: minimalProducerBrief() };
      }
      if (agent.name === "Medical Researcher") return { finalOutput: minimalFactsRaw() };
      if (agent.name === "Medical Editor") return { finalOutput: minimalEditorOut() };
      if (agent.name === "Medical Narrative Flow") return { finalOutput: minimalMedicalNarrativeFlowOut() };
      if (agent.name === "Curriculum Architect") return { finalOutput: minimalCurriculumOut() };
      if (agent.name === "Assessment Designer") return { finalOutput: minimalAssessmentOut() };
      if (agent.name === "Slide Architect") return { finalOutput: minimalSlideArchitectOut() };
      if (agent.name === "Story Seed") {
        const variety = jsonBlock(prompt, "VARIETY PACK (json):\n", "\n\nRECENT VARIETY") as Record<string, unknown>;
        return {
          finalOutput: {
            story_seed: minimalStorySeed(variety, { logline: "logline", setting: "setting", cast: ["a"], stakes: "stakes" })
          }
        };
      }
      if (agent.name === "Showrunner") return { finalOutput: minimalShowrunnerOut() };
      if (agent.name === "Visual Director") return { finalOutput: minimalVisualOut() };
      if (agent.name === "Pacing Editor") return { finalOutput: minimalPacingOut() };
      if (agent.name === "Mapper") return { finalOutput: minimalMapperOut() };
      if (agent.name === "Slide Writer") return { finalOutput: minimalSlideSpecOut() };
      if (agent.name === "QA Suite") return { finalOutput: minimalQa(true) };
      if (agent.name === "Patch Applier") throw new Error("Patch agent should not run when QA passes");
      if (agent.name === "Genspark Packager") return { finalOutput: minimalGensparkOut() };

      throw new Error(`Unexpected agent: ${agent.name}`);
    });

    const runs = new RunManager();
    const run = await runs.createRun("topic", { durationMinutes: 20 });

    await runStudioPipeline({ runId: run.runId, topic: run.topic, settings: run.settings }, runs, {
      signal: new AbortController().signal
    });
    await expect(fs.stat(artifactAbsPath(run.runId, "trace.json"))).resolves.toBeTruthy();
    await expect(fs.stat(artifactAbsPath(run.runId, "kb_context.md"))).resolves.toBeTruthy();
    await expect(fs.stat(artifactAbsPath(run.runId, "medical_narrative_flow.json"))).resolves.toBeTruthy();
    await expect(fs.stat(artifactAbsPath(run.runId, "medical_depth_report.json"))).resolves.toBeTruthy();
    await expect(fs.stat(artifactAbsPath(run.runId, "final_slide_spec.json"))).resolves.toBeTruthy();
    await expect(fs.stat(artifactAbsPath(run.runId, "final_slide_spec_patched.json"))).resolves.toBeTruthy();
    await expect(fs.stat(artifactAbsPath(run.runId, "reusable_visual_primer.json"))).resolves.toBeTruthy();
    await expect(fs.stat(artifactAbsPath(run.runId, "medical_story_traceability_report.json"))).resolves.toBeTruthy();
    await expect(fs.stat(artifactAbsPath(run.runId, "qa_report.json"))).resolves.toBeTruthy();
    await expect(fs.stat(artifactAbsPath(run.runId, "GENSPARK_ASSET_BIBLE.md"))).resolves.toBeTruthy();
    await expect(fs.stat(artifactAbsPath(run.runId, "GENSPARK_MASTER_RENDER_PLAN.md"))).resolves.toBeTruthy();

    const patched = await readJsonFile<{ final_slide_spec_patched: { title: string } }>(artifactAbsPath(run.runId, "final_slide_spec_patched.json"));
    expect(patched.final_slide_spec_patched.title).toBe("Final Spec");

    expect(runs.getRun(run.runId)?.traceId).toBe("trace_test");
    expect(calls).toContain("Genspark Packager");
  });

  it("repairs invalid structured output (schema failure) and continues the pipeline", async () => {
    const { RunManager } = await import("../src/run_manager.js");
    const { runStudioPipeline } = await import("../src/pipeline/studio_pipeline.js");

    const agents = (await import("@openai/agents")) as RunnerModule;

    let producerCalls = 0;

    agents.__setMockRunnerHandler?.((agent: MockAgent, prompt: string) => {
      if (agent.name === "KB Compiler") return { finalOutput: { kb_context: "kb" } };
      if (agent.name === "Producer") {
        producerCalls += 1;
        if (producerCalls === 1) return { finalOutput: { producer_brief: { title: "" } } }; // invalid; triggers schema repair
        expect(prompt).toContain("PREVIOUS OUTPUT:");
        return { finalOutput: minimalProducerBrief() };
      }
      if (agent.name === "Medical Researcher") return { finalOutput: minimalFactsRaw() };
      if (agent.name === "Medical Editor") return { finalOutput: minimalEditorOut() };
      if (agent.name === "Medical Narrative Flow") return { finalOutput: minimalMedicalNarrativeFlowOut() };
      if (agent.name === "Curriculum Architect") return { finalOutput: minimalCurriculumOut() };
      if (agent.name === "Assessment Designer") return { finalOutput: minimalAssessmentOut() };
      if (agent.name === "Slide Architect") return { finalOutput: minimalSlideArchitectOut() };
      if (agent.name === "Story Seed") {
        const variety = jsonBlock(prompt, "VARIETY PACK (json):\n", "\n\nRECENT VARIETY") as Record<string, unknown>;
        return {
          finalOutput: {
            story_seed: minimalStorySeed(variety, { logline: "l", setting: "s", cast: ["c"], stakes: "st" })
          }
        };
      }
      if (agent.name === "Showrunner") return { finalOutput: minimalShowrunnerOut() };
      if (agent.name === "Visual Director") return { finalOutput: minimalVisualOut() };
      if (agent.name === "Pacing Editor") return { finalOutput: minimalPacingOut() };
      if (agent.name === "Mapper") return { finalOutput: minimalMapperOut() };
      if (agent.name === "Slide Writer") return { finalOutput: minimalSlideSpecOut() };
      if (agent.name === "QA Suite") return { finalOutput: minimalQa(true) };
      if (agent.name === "Genspark Packager") return { finalOutput: minimalGensparkOut() };
      throw new Error(`Unexpected agent: ${agent.name}`);
    });

    const runs = new RunManager();
    const run = await runs.createRun("topic");

    await runStudioPipeline({ runId: run.runId, topic: run.topic }, runs, { signal: new AbortController().signal });

    expect(producerCalls).toBe(2);
    expect(runs.getRun(run.runId)?.steps.A.status).toBe("done");
    expect(runs.getRun(run.runId)?.steps.O.status).toBe("done");
    expect(runs.getRun(run.runId)?.steps.P.status).toBe("done");
  });

  it("retries from scratch when schema failure output cannot be extracted and continues the pipeline", async () => {
    const { RunManager } = await import("../src/run_manager.js");
    const { runStudioPipeline } = await import("../src/pipeline/studio_pipeline.js");
    const { ModelBehaviorError } = await import("@openai/agents");

    const agents = (await import("@openai/agents")) as RunnerModule;

    let producerCalls = 0;

    agents.__setMockRunnerHandler?.((agent: MockAgent, prompt: string) => {
      if (agent.name === "KB Compiler") return { finalOutput: { kb_context: "kb" } };
      if (agent.name === "Producer") {
        producerCalls += 1;
        if (producerCalls === 1) {
          // Provide _modelResponses without any assistant output so repair can't extract raw JSON.
          const state = { _modelResponses: [{ output: [{ role: "user", content: [{ type: "output_text", text: "bad" }] }] }] };
          throw new ModelBehaviorError("Invalid agent output (unextractable)", state as never);
        }
        return { finalOutput: minimalProducerBrief() };
      }
      if (agent.name === "Medical Researcher") return { finalOutput: minimalFactsRaw() };
      if (agent.name === "Medical Editor") return { finalOutput: minimalEditorOut() };
      if (agent.name === "Medical Narrative Flow") return { finalOutput: minimalMedicalNarrativeFlowOut() };
      if (agent.name === "Curriculum Architect") return { finalOutput: minimalCurriculumOut() };
      if (agent.name === "Assessment Designer") return { finalOutput: minimalAssessmentOut() };
      if (agent.name === "Slide Architect") return { finalOutput: minimalSlideArchitectOut() };
      if (agent.name === "Story Seed") {
        const variety = jsonBlock(prompt, "VARIETY PACK (json):\n", "\n\nRECENT VARIETY") as Record<string, unknown>;
        return {
          finalOutput: {
            story_seed: minimalStorySeed(variety, { logline: "l", setting: "s", cast: ["c"], stakes: "st" })
          }
        };
      }
      if (agent.name === "Showrunner") return { finalOutput: minimalShowrunnerOut() };
      if (agent.name === "Visual Director") return { finalOutput: minimalVisualOut() };
      if (agent.name === "Pacing Editor") return { finalOutput: minimalPacingOut() };
      if (agent.name === "Mapper") return { finalOutput: minimalMapperOut() };
      if (agent.name === "Slide Writer") return { finalOutput: minimalSlideSpecOut() };
      if (agent.name === "QA Suite") return { finalOutput: minimalQa(true) };
      if (agent.name === "Genspark Packager") return { finalOutput: minimalGensparkOut() };
      throw new Error(`Unexpected agent: ${agent.name}`);
    });

    const runs = new RunManager();
    const run = await runs.createRun("topic");

    await runStudioPipeline({ runId: run.runId, topic: run.topic }, runs, { signal: new AbortController().signal });

    expect(producerCalls).toBe(2);
    expect(runs.getRun(run.runId)?.steps.A.status).toBe("done");
    expect(runs.getRun(run.runId)?.steps.O.status).toBe("done");
    expect(runs.getRun(run.runId)?.steps.P.status).toBe("done");
  });

  it("applies a patch when QA fails (iter1) and runs QA iter2", async () => {
    const { RunManager } = await import("../src/run_manager.js");
    const { runStudioPipeline } = await import("../src/pipeline/studio_pipeline.js");
    const { artifactAbsPath, readJsonFile } = await import("../src/pipeline/utils.js");

    let qaCalls = 0;

    const agents = (await import("@openai/agents")) as RunnerModule;
    agents.__setMockRunnerHandler?.((agent: MockAgent, prompt: string) => {
      if (agent.name === "KB Compiler") return { finalOutput: { kb_context: "kb" } };
      if (agent.name === "Producer") return { finalOutput: minimalProducerBrief() };
      if (agent.name === "Medical Researcher") return { finalOutput: minimalFactsRaw() };
      if (agent.name === "Medical Editor") return { finalOutput: minimalEditorOut() };
      if (agent.name === "Medical Narrative Flow") return { finalOutput: minimalMedicalNarrativeFlowOut() };
      if (agent.name === "Curriculum Architect") return { finalOutput: minimalCurriculumOut() };
      if (agent.name === "Assessment Designer") return { finalOutput: minimalAssessmentOut() };
      if (agent.name === "Slide Architect") return { finalOutput: minimalSlideArchitectOut() };
      if (agent.name === "Story Seed") {
        const variety = jsonBlock(prompt, "VARIETY PACK (json):\n", "\n\nRECENT VARIETY") as Record<string, unknown>;
        return {
          finalOutput: {
            story_seed: minimalStorySeed(variety, { logline: "logline", setting: "setting", cast: ["a"], stakes: "stakes" })
          }
        };
      }
      if (agent.name === "Showrunner") return { finalOutput: minimalShowrunnerOut() };
      if (agent.name === "Visual Director") return { finalOutput: minimalVisualOut() };
      if (agent.name === "Pacing Editor") return { finalOutput: minimalPacingOut() };
      if (agent.name === "Mapper") return { finalOutput: minimalMapperOut() };
      if (agent.name === "Slide Writer") return { finalOutput: minimalSlideSpecOut() };
      if (agent.name === "QA Suite") {
        qaCalls += 1;
        return { finalOutput: minimalQa(qaCalls >= 2) };
      }
      if (agent.name === "Patch Applier") return { finalOutput: minimalPatchedSpecOut() };
      if (agent.name === "Genspark Packager") return { finalOutput: minimalGensparkOut() };
      throw new Error(`Unexpected agent: ${agent.name}`);
    });

    const runs = new RunManager();
    const run = await runs.createRun("topic");

    await runStudioPipeline({ runId: run.runId, topic: run.topic }, runs, { signal: new AbortController().signal });
    await expect(fs.stat(artifactAbsPath(run.runId, "final_slide_spec_patched_iter1.json"))).resolves.toBeTruthy();
    await expect(fs.stat(artifactAbsPath(run.runId, "qa_report_iter2.json"))).resolves.toBeTruthy();

    const patched = await readJsonFile<{ final_slide_spec_patched: { title: string } }>(artifactAbsPath(run.runId, "final_slide_spec_patched.json"));
    expect(patched.final_slide_spec_patched.title).toContain("Patched");
    expect(qaCalls).toBe(2);
  });

  it("depth guard can force patching for PCP runs even when model QA initially passes", async () => {
    const { RunManager } = await import("../src/run_manager.js");
    const { runStudioPipeline } = await import("../src/pipeline/studio_pipeline.js");
    const { artifactAbsPath } = await import("../src/pipeline/utils.js");

    let qaCalls = 0;
    let patchCalled = false;

    const agents = (await import("@openai/agents")) as RunnerModule;
    agents.__setMockRunnerHandler?.((agent: MockAgent, prompt: string) => {
      if (agent.name === "KB Compiler") return { finalOutput: { kb_context: "kb" } };
      if (agent.name === "Producer") return { finalOutput: minimalProducerBrief() };
      if (agent.name === "Medical Researcher") return { finalOutput: minimalFactsRaw() };
      if (agent.name === "Medical Editor") return { finalOutput: minimalEditorOut() };
      if (agent.name === "Medical Narrative Flow") return { finalOutput: minimalMedicalNarrativeFlowOut() };
      if (agent.name === "Curriculum Architect") return { finalOutput: minimalCurriculumOut() };
      if (agent.name === "Assessment Designer") return { finalOutput: minimalAssessmentOut() };
      if (agent.name === "Slide Architect") return { finalOutput: minimalSlideArchitectOut() };
      if (agent.name === "Story Seed") {
        const variety = jsonBlock(prompt, "VARIETY PACK (json):\n", "\n\nRECENT VARIETY") as Record<string, unknown>;
        return {
          finalOutput: {
            story_seed: minimalStorySeed(variety, { logline: "logline", setting: "setting", cast: ["a"], stakes: "stakes" })
          }
        };
      }
      if (agent.name === "Showrunner") return { finalOutput: minimalShowrunnerOut() };
      if (agent.name === "Visual Director") return { finalOutput: minimalVisualOut() };
      if (agent.name === "Pacing Editor") return { finalOutput: minimalPacingOut() };
      if (agent.name === "Mapper") return { finalOutput: minimalMapperOut() };
      if (agent.name === "Slide Writer") return { finalOutput: minimalSlideSpecOut() };
      if (agent.name === "QA Suite") {
        qaCalls += 1;
        return { finalOutput: minimalQa(true) };
      }
      if (agent.name === "Patch Applier") {
        patchCalled = true;
        return { finalOutput: minimalPatchedSpecOut() };
      }
      if (agent.name === "Genspark Packager") return { finalOutput: minimalGensparkOut() };
      throw new Error(`Unexpected agent: ${agent.name}`);
    });

    const runs = new RunManager();
    const run = await runs.createRun("topic", { level: "pcp", adherenceMode: "strict" });

    await runStudioPipeline(
      { runId: run.runId, topic: run.topic, settings: { level: "pcp", adherenceMode: "strict" } },
      runs,
      { signal: new AbortController().signal }
    );

    expect(patchCalled).toBe(true);
    expect(qaCalls).toBe(2);
    await expect(fs.stat(artifactAbsPath(run.runId, "medical_depth_report.json"))).resolves.toBeTruthy();
    await expect(fs.stat(artifactAbsPath(run.runId, "final_slide_spec_patched_iter1.json"))).resolves.toBeTruthy();
  });

  it("can reuse prior artifacts when startFrom is later (no upstream agent calls)", async () => {
    const { RunManager } = await import("../src/run_manager.js");
    const { runStudioPipeline } = await import("../src/pipeline/studio_pipeline.js");
    const { artifactAbsPath } = await import("../src/pipeline/utils.js");

    const agents = (await import("@openai/agents")) as RunnerModule;

    const runs = new RunManager();
    const run = await runs.createRun("topic");

    // First run generates all artifacts.
    agents.__setMockRunnerHandler?.((agent: MockAgent, prompt: string) => {
      if (agent.name === "KB Compiler") return { finalOutput: { kb_context: "kb" } };
      if (agent.name === "Producer") return { finalOutput: minimalProducerBrief() };
      if (agent.name === "Medical Researcher") return { finalOutput: minimalFactsRaw() };
      if (agent.name === "Medical Editor") return { finalOutput: minimalEditorOut() };
      if (agent.name === "Medical Narrative Flow") return { finalOutput: minimalMedicalNarrativeFlowOut() };
      if (agent.name === "Curriculum Architect") return { finalOutput: minimalCurriculumOut() };
      if (agent.name === "Assessment Designer") return { finalOutput: minimalAssessmentOut() };
      if (agent.name === "Slide Architect") return { finalOutput: minimalSlideArchitectOut() };
      if (agent.name === "Story Seed") {
        const variety = jsonBlock(prompt, "VARIETY PACK (json):\n", "\n\nRECENT VARIETY") as Record<string, unknown>;
        return {
          finalOutput: {
            story_seed: minimalStorySeed(variety, { logline: "l", setting: "s", cast: ["c"], stakes: "st" })
          }
        };
      }
      if (agent.name === "Showrunner") return { finalOutput: minimalShowrunnerOut() };
      if (agent.name === "Visual Director") return { finalOutput: minimalVisualOut() };
      if (agent.name === "Pacing Editor") return { finalOutput: minimalPacingOut() };
      if (agent.name === "Mapper") return { finalOutput: minimalMapperOut() };
      if (agent.name === "Slide Writer") return { finalOutput: minimalSlideSpecOut() };
      if (agent.name === "QA Suite") return { finalOutput: minimalQa(true) };
      if (agent.name === "Genspark Packager") return { finalOutput: minimalGensparkOut() };
      throw new Error(`Unexpected agent: ${agent.name}`);
    });

    await runStudioPipeline({ runId: run.runId, topic: run.topic }, runs, { signal: new AbortController().signal });

    // Second run starts from G and must not call earlier agents.
    const forbidden = new Set([
      "KB Compiler",
      "Producer",
      "Medical Researcher",
      "Medical Editor",
      "Curriculum Architect",
      "Assessment Designer",
      "Slide Architect"
    ]);

    agents.__setMockRunnerHandler?.((agent: MockAgent, prompt: string) => {
      if (forbidden.has(agent.name)) throw new Error(`Should not call upstream agent: ${agent.name}`);
      if (agent.name === "Medical Narrative Flow") return { finalOutput: minimalMedicalNarrativeFlowOut() };
      if (agent.name === "Story Seed") {
        const variety = jsonBlock(prompt, "VARIETY PACK (json):\n", "\n\nRECENT VARIETY") as Record<string, unknown>;
        return {
          finalOutput: {
            story_seed: minimalStorySeed(variety, { logline: "l2", setting: "s2", cast: ["c2"], stakes: "st2" })
          }
        };
      }
      if (agent.name === "Showrunner") return { finalOutput: minimalShowrunnerOut() };
      if (agent.name === "Visual Director") return { finalOutput: minimalVisualOut() };
      if (agent.name === "Pacing Editor") return { finalOutput: minimalPacingOut() };
      if (agent.name === "Mapper") return { finalOutput: minimalMapperOut() };
      if (agent.name === "Slide Writer") return { finalOutput: minimalSlideSpecOut() };
      if (agent.name === "QA Suite") return { finalOutput: minimalQa(true) };
      if (agent.name === "Genspark Packager") return { finalOutput: minimalGensparkOut() };
      throw new Error(`Unexpected agent: ${agent.name}`);
    });

    await runStudioPipeline(
      { runId: run.runId, topic: run.topic },
      runs,
      { signal: new AbortController().signal, startFrom: "G" }
    );
    await expect(fs.stat(artifactAbsPath(run.runId, "story_seed.json"))).resolves.toBeTruthy();
  });

  it("startFrom=N reuses QA iter1 and runs patch + QA iter2", async () => {
    const { RunManager } = await import("../src/run_manager.js");
    const { runStudioPipeline } = await import("../src/pipeline/studio_pipeline.js");
    const { artifactAbsPath } = await import("../src/pipeline/utils.js");

    const agents = (await import("@openai/agents")) as RunnerModule;

    const runs = new RunManager();
    const run = await runs.createRun("topic");

    // First run creates the prerequisite artifacts, including qa_report_iter1.json with pass=false.
    let qaCalls = 0;
    agents.__setMockRunnerHandler?.((agent: MockAgent, prompt: string) => {
      if (agent.name === "KB Compiler") return { finalOutput: { kb_context: "kb" } };
      if (agent.name === "Producer") return { finalOutput: minimalProducerBrief() };
      if (agent.name === "Medical Researcher") return { finalOutput: minimalFactsRaw() };
      if (agent.name === "Medical Editor") return { finalOutput: minimalEditorOut() };
      if (agent.name === "Medical Narrative Flow") return { finalOutput: minimalMedicalNarrativeFlowOut() };
      if (agent.name === "Curriculum Architect") return { finalOutput: minimalCurriculumOut() };
      if (agent.name === "Assessment Designer") return { finalOutput: minimalAssessmentOut() };
      if (agent.name === "Slide Architect") return { finalOutput: minimalSlideArchitectOut() };
      if (agent.name === "Story Seed") {
        const variety = jsonBlock(prompt, "VARIETY PACK (json):\n", "\n\nRECENT VARIETY") as Record<string, unknown>;
        return {
          finalOutput: {
            story_seed: minimalStorySeed(variety, { logline: "l", setting: "s", cast: ["c"], stakes: "st" })
          }
        };
      }
      if (agent.name === "Showrunner") return { finalOutput: minimalShowrunnerOut() };
      if (agent.name === "Visual Director") return { finalOutput: minimalVisualOut() };
      if (agent.name === "Pacing Editor") return { finalOutput: minimalPacingOut() };
      if (agent.name === "Mapper") return { finalOutput: minimalMapperOut() };
      if (agent.name === "Slide Writer") return { finalOutput: minimalSlideSpecOut() };
      if (agent.name === "QA Suite") {
        qaCalls += 1;
        return { finalOutput: minimalQa(qaCalls >= 2) };
      }
      if (agent.name === "Patch Applier") return { finalOutput: minimalPatchedSpecOut() };
      if (agent.name === "Genspark Packager") return { finalOutput: minimalGensparkOut() };
      throw new Error(`Unexpected agent: ${agent.name}`);
    });

    await runStudioPipeline({ runId: run.runId, topic: run.topic }, runs, { signal: new AbortController().signal });

    // Second run: start from N. It should not call upstream agents.
    const forbidden = new Set([
      "KB Compiler",
      "Producer",
      "Medical Researcher",
      "Medical Editor",
      "Curriculum Architect",
      "Assessment Designer",
      "Slide Architect",
      "Story Seed",
      "Showrunner",
      "Visual Director",
      "Pacing Editor",
      "Mapper",
      "Slide Writer"
    ]);

    let sawPatch = false;
    let sawQa = false;

    agents.__setMockRunnerHandler?.((agent: MockAgent) => {
      if (forbidden.has(agent.name)) throw new Error(`Should not call upstream agent: ${agent.name}`);
      if (agent.name === "Patch Applier") {
        sawPatch = true;
        return { finalOutput: minimalPatchedSpecOut() };
      }
      if (agent.name === "QA Suite") {
        sawQa = true;
        return { finalOutput: minimalQa(true) };
      }
      if (agent.name === "Genspark Packager") return { finalOutput: minimalGensparkOut() };
      throw new Error(`Unexpected agent: ${agent.name}`);
    });

    await runStudioPipeline(
      { runId: run.runId, topic: run.topic },
      runs,
      { signal: new AbortController().signal, startFrom: "N" }
    );
    await expect(fs.stat(artifactAbsPath(run.runId, "final_slide_spec_patched_iter1.json"))).resolves.toBeTruthy();
    await expect(fs.stat(artifactAbsPath(run.runId, "qa_report_iter2.json"))).resolves.toBeTruthy();
    expect(sawPatch).toBe(true);
    expect(sawQa).toBe(true);
  });

  it("startFrom=O reuses final patched artifacts and runs packaging + master doc", async () => {
    const { RunManager } = await import("../src/run_manager.js");
    const { runStudioPipeline } = await import("../src/pipeline/studio_pipeline.js");
    const { artifactAbsPath } = await import("../src/pipeline/utils.js");

    const agents = (await import("@openai/agents")) as RunnerModule;

    const runs = new RunManager();
    const run = await runs.createRun("topic");

    // First run creates final patched + qa report.
    agents.__setMockRunnerHandler?.((agent: MockAgent, prompt: string) => {
      if (agent.name === "KB Compiler") return { finalOutput: { kb_context: "kb" } };
      if (agent.name === "Producer") return { finalOutput: minimalProducerBrief() };
      if (agent.name === "Medical Researcher") return { finalOutput: minimalFactsRaw() };
      if (agent.name === "Medical Editor") return { finalOutput: minimalEditorOut() };
      if (agent.name === "Medical Narrative Flow") return { finalOutput: minimalMedicalNarrativeFlowOut() };
      if (agent.name === "Curriculum Architect") return { finalOutput: minimalCurriculumOut() };
      if (agent.name === "Assessment Designer") return { finalOutput: minimalAssessmentOut() };
      if (agent.name === "Slide Architect") return { finalOutput: minimalSlideArchitectOut() };
      if (agent.name === "Story Seed") {
        const variety = jsonBlock(prompt, "VARIETY PACK (json):\n", "\n\nRECENT VARIETY") as Record<string, unknown>;
        return {
          finalOutput: {
            story_seed: minimalStorySeed(variety, { logline: "l", setting: "s", cast: ["c"], stakes: "st" })
          }
        };
      }
      if (agent.name === "Showrunner") return { finalOutput: minimalShowrunnerOut() };
      if (agent.name === "Visual Director") return { finalOutput: minimalVisualOut() };
      if (agent.name === "Pacing Editor") return { finalOutput: minimalPacingOut() };
      if (agent.name === "Mapper") return { finalOutput: minimalMapperOut() };
      if (agent.name === "Slide Writer") return { finalOutput: minimalSlideSpecOut() };
      if (agent.name === "QA Suite") return { finalOutput: minimalQa(true) };
      if (agent.name === "Genspark Packager") return { finalOutput: minimalGensparkOut() };
      throw new Error(`Unexpected agent: ${agent.name}`);
    });

    await runStudioPipeline({ runId: run.runId, topic: run.topic }, runs, { signal: new AbortController().signal });

    // Second run: only packaging.
    const forbidden = new Set([
      "KB Compiler",
      "Producer",
      "Medical Researcher",
      "Medical Editor",
      "Curriculum Architect",
      "Assessment Designer",
      "Slide Architect",
      "Story Seed",
      "Showrunner",
      "Visual Director",
      "Pacing Editor",
      "Mapper",
      "Slide Writer",
      "QA Suite",
      "Patch Applier"
    ]);

    let sawPackager = false;
    agents.__setMockRunnerHandler?.((agent: MockAgent) => {
      if (forbidden.has(agent.name)) throw new Error(`Should not call agent: ${agent.name}`);
      if (agent.name === "Genspark Packager") {
        sawPackager = true;
        return { finalOutput: minimalGensparkOut() };
      }
      throw new Error(`Unexpected agent: ${agent.name}`);
    });

    await runStudioPipeline(
      { runId: run.runId, topic: run.topic },
      runs,
      { signal: new AbortController().signal, startFrom: "O" }
    );
    await expect(fs.stat(artifactAbsPath(run.runId, "GENSPARK_BUILD_SCRIPT.txt"))).resolves.toBeTruthy();
    await expect(fs.stat(artifactAbsPath(run.runId, "GENSPARK_MASTER_RENDER_PLAN.md"))).resolves.toBeTruthy();
    expect(sawPackager).toBe(true);
  });

  it("startFrom=P reuses packaging artifacts and only rebuilds master doc", async () => {
    const { RunManager } = await import("../src/run_manager.js");
    const { runStudioPipeline } = await import("../src/pipeline/studio_pipeline.js");
    const { artifactAbsPath } = await import("../src/pipeline/utils.js");

    const agents = (await import("@openai/agents")) as RunnerModule;
    const runs = new RunManager();
    const run = await runs.createRun("topic");

    // Initial full run.
    agents.__setMockRunnerHandler?.((agent: MockAgent, prompt: string) => {
      if (agent.name === "KB Compiler") return { finalOutput: { kb_context: "kb" } };
      if (agent.name === "Producer") return { finalOutput: minimalProducerBrief() };
      if (agent.name === "Medical Researcher") return { finalOutput: minimalFactsRaw() };
      if (agent.name === "Medical Editor") return { finalOutput: minimalEditorOut() };
      if (agent.name === "Medical Narrative Flow") return { finalOutput: minimalMedicalNarrativeFlowOut() };
      if (agent.name === "Curriculum Architect") return { finalOutput: minimalCurriculumOut() };
      if (agent.name === "Assessment Designer") return { finalOutput: minimalAssessmentOut() };
      if (agent.name === "Slide Architect") return { finalOutput: minimalSlideArchitectOut() };
      if (agent.name === "Story Seed") {
        const variety = jsonBlock(prompt, "VARIETY PACK (json):\n", "\n\nRECENT VARIETY") as Record<string, unknown>;
        return { finalOutput: { story_seed: minimalStorySeed(variety) } };
      }
      if (agent.name === "Showrunner") return { finalOutput: minimalShowrunnerOut() };
      if (agent.name === "Visual Director") return { finalOutput: minimalVisualOut() };
      if (agent.name === "Pacing Editor") return { finalOutput: minimalPacingOut() };
      if (agent.name === "Mapper") return { finalOutput: minimalMapperOut() };
      if (agent.name === "Slide Writer") return { finalOutput: minimalSlideSpecOut() };
      if (agent.name === "QA Suite") return { finalOutput: minimalQa(true) };
      if (agent.name === "Genspark Packager") return { finalOutput: minimalGensparkOut() };
      throw new Error(`Unexpected agent: ${agent.name}`);
    });

    await runStudioPipeline({ runId: run.runId, topic: run.topic }, runs, { signal: new AbortController().signal });

    // startFrom=P should skip O and optionally invoke only the polisher.
    const forbidden = new Set([
      "KB Compiler",
      "Producer",
      "Medical Researcher",
      "Medical Editor",
      "Medical Narrative Flow",
      "Curriculum Architect",
      "Assessment Designer",
      "Slide Architect",
      "Story Seed",
      "Showrunner",
      "Visual Director",
      "Pacing Editor",
      "Mapper",
      "Slide Writer",
      "QA Suite",
      "Patch Applier",
      "Genspark Packager"
    ]);

    let sawPolisher = false;
    agents.__setMockRunnerHandler?.((agent: MockAgent) => {
      if (forbidden.has(agent.name)) throw new Error(`Should not call agent: ${agent.name}`);
      if (agent.name === "Genspark Master Polisher") {
        sawPolisher = true;
        return { finalOutput: { genspark_master_render_plan_md: "## invalid polished doc" } };
      }
      throw new Error(`Unexpected agent: ${agent.name}`);
    });

    await runStudioPipeline(
      { runId: run.runId, topic: run.topic },
      runs,
      { signal: new AbortController().signal, startFrom: "P" }
    );

    const status = runs.getRun(run.runId);
    expect(status?.steps.O.status).toBe("done");
    expect(status?.steps.P.status).toBe("done");
    await expect(fs.stat(artifactAbsPath(run.runId, "GENSPARK_MASTER_RENDER_PLAN.md"))).resolves.toBeTruthy();
    expect(sawPolisher).toBe(true);
  });

  it("startFrom=P supports sparse legacy artifacts with compatibility fallbacks", async () => {
    const { RunManager } = await import("../src/run_manager.js");
    const { runStudioPipeline } = await import("../src/pipeline/studio_pipeline.js");
    const { artifactAbsPath } = await import("../src/pipeline/utils.js");

    const agents = (await import("@openai/agents")) as RunnerModule;
    const runs = new RunManager();
    const run = await runs.createRun("legacy sparse rerun");

    // Sparse legacy state: only the patched slide spec is present.
    await fs.writeFile(
      artifactAbsPath(run.runId, "final_slide_spec_patched.json"),
      JSON.stringify(minimalPatchedSpecOut(), null, 2) + "\n",
      "utf8"
    );

    const forbidden = new Set([
      "KB Compiler",
      "Producer",
      "Medical Researcher",
      "Medical Editor",
      "Medical Narrative Flow",
      "Curriculum Architect",
      "Assessment Designer",
      "Slide Architect",
      "Story Seed",
      "Showrunner",
      "Visual Director",
      "Pacing Editor",
      "Mapper",
      "Slide Writer",
      "QA Suite",
      "Patch Applier",
      "Genspark Packager"
    ]);

    let sawPolisher = false;
    agents.__setMockRunnerHandler?.((agent: MockAgent) => {
      if (forbidden.has(agent.name)) throw new Error(`Should not call agent: ${agent.name}`);
      if (agent.name === "Genspark Master Polisher") {
        sawPolisher = true;
        return { finalOutput: { genspark_master_render_plan_md: "## invalid polished doc" } };
      }
      throw new Error(`Unexpected agent: ${agent.name}`);
    });

    await runStudioPipeline(
      { runId: run.runId, topic: run.topic },
      runs,
      { signal: new AbortController().signal, startFrom: "P" }
    );

    const master = await fs.readFile(artifactAbsPath(run.runId, "GENSPARK_MASTER_RENDER_PLAN.md"), "utf8");
    expect(master).toContain("GENSPARK MASTER RENDER PLAN");
    expect(master).toContain("compatibility fallback");
    await expect(fs.stat(artifactAbsPath(run.runId, "constraint_adherence_report.json"))).resolves.toBeTruthy();
    expect(sawPolisher).toBe(true);
  });

  it("startFrom=P fails loudly when final_slide_spec_patched.json is missing", async () => {
    const { RunManager } = await import("../src/run_manager.js");
    const { runStudioPipeline } = await import("../src/pipeline/studio_pipeline.js");

    const agents = (await import("@openai/agents")) as RunnerModule;
    agents.__setMockRunnerHandler?.((agent: MockAgent) => {
      if (agent.name === "Genspark Master Polisher") return { finalOutput: { genspark_master_render_plan_md: "ok" } };
      throw new Error(`Unexpected agent: ${agent.name}`);
    });

    const runs = new RunManager();
    const run = await runs.createRun("missing patched spec");

    await expect(
      runStudioPipeline(
        { runId: run.runId, topic: run.topic },
        runs,
        { signal: new AbortController().signal, startFrom: "P" }
      )
    ).rejects.toThrow(/final_slide_spec_patched\.json/);
  });

  it("fails early when required env vars are missing", async () => {
    const { RunManager } = await import("../src/run_manager.js");
    const { runStudioPipeline } = await import("../src/pipeline/studio_pipeline.js");

    const agents = (await import("@openai/agents")) as RunnerModule;
    agents.__setMockRunnerHandler?.(() => {
      throw new Error("should not reach runner when env is missing");
    });

    delete process.env.OPENAI_API_KEY;

    const runs = new RunManager();
    const run = await runs.createRun("topic");
    await expect(runStudioPipeline({ runId: run.runId, topic: run.topic }, runs, { signal: new AbortController().signal })).rejects.toThrow(
      /Missing required env var: OPENAI_API_KEY/
    );
  });

  it("fails early when KB_VECTOR_STORE_ID is missing", async () => {
    const { RunManager } = await import("../src/run_manager.js");
    const { runStudioPipeline } = await import("../src/pipeline/studio_pipeline.js");

    const agents = (await import("@openai/agents")) as RunnerModule;
    agents.__setMockRunnerHandler?.(() => {
      throw new Error("should not reach runner when env is missing");
    });

    delete process.env.KB_VECTOR_STORE_ID;

    const runs = new RunManager();
    const run = await runs.createRun("topic");
    await expect(runStudioPipeline({ runId: run.runId, topic: run.topic }, runs, { signal: new AbortController().signal })).rejects.toThrow(
      /Missing required env var: KB_VECTOR_STORE_ID/
    );
  });

  it("throws on invalid startFrom values", async () => {
    const { RunManager } = await import("../src/run_manager.js");
    const { runStudioPipeline } = await import("../src/pipeline/studio_pipeline.js");

    const agents = (await import("@openai/agents")) as RunnerModule;
    agents.__setMockRunnerHandler?.(() => {
      throw new Error("should not reach runner when startFrom is invalid");
    });

    const runs = new RunManager();
    const run = await runs.createRun("topic");
    await expect(
      runStudioPipeline({ runId: run.runId, topic: run.topic }, runs, { signal: new AbortController().signal, startFrom: "ZZZ" as never })
    ).rejects.toThrow(/Invalid startFrom/);
  });

  it("fails with Cancelled when the signal is already aborted", async () => {
    const { RunManager } = await import("../src/run_manager.js");
    const { runStudioPipeline } = await import("../src/pipeline/studio_pipeline.js");

    const agents = (await import("@openai/agents")) as RunnerModule;
    agents.__setMockRunnerHandler?.(() => {
      throw new Error("should not reach runner when already aborted");
    });

    const runs = new RunManager();
    const run = await runs.createRun("topic");
    const ctrl = new AbortController();
    ctrl.abort();

    await expect(runStudioPipeline({ runId: run.runId, topic: run.topic }, runs, { signal: ctrl.signal })).rejects.toThrow(/Cancelled/);
  });

  it("reuses an existing variety pack for the same runId from memory", async () => {
    const { RunManager } = await import("../src/run_manager.js");
    const { runStudioPipeline } = await import("../src/pipeline/studio_pipeline.js");

    const runs = new RunManager();
    const run = await runs.createRun("topic");

    const memPath = path.join(String(tmpData), "episode_memory.json");
    const memRaw = JSON.parse(await fs.readFile(memPath, "utf8")) as { recent: Array<Record<string, unknown>> };
    const expectedVariety = {
      genre_wrapper: "classic whodunit",
      body_setting: "busy urgent care in flu season",
      antagonist_archetype: "a misleading device reading",
      twist_type: "two conditions are happening at once",
      signature_gadget: "a pager that never stops",
      motifs: ["protocol vs intuition", "hidden constraints", "team handoffs"]
    };
    memRaw.recent.unshift({
      at: new Date("2020-02-02T00:00:00.000Z").toISOString(),
      runId: run.runId,
      key: "expected_key",
      variety: expectedVariety
    });
    await fs.writeFile(memPath, JSON.stringify(memRaw, null, 2) + "\n", "utf8");

    const agents = (await import("@openai/agents")) as RunnerModule;
    agents.__setMockRunnerHandler?.((agent: MockAgent, prompt: string) => {
      if (agent.name === "KB Compiler") return { finalOutput: { kb_context: "kb" } };
      if (agent.name === "Producer") return { finalOutput: minimalProducerBrief() };
      if (agent.name === "Medical Researcher") return { finalOutput: minimalFactsRaw() };
      if (agent.name === "Medical Editor") return { finalOutput: minimalEditorOut() };
      if (agent.name === "Medical Narrative Flow") return { finalOutput: minimalMedicalNarrativeFlowOut() };
      if (agent.name === "Curriculum Architect") return { finalOutput: minimalCurriculumOut() };
      if (agent.name === "Assessment Designer") return { finalOutput: minimalAssessmentOut() };
      if (agent.name === "Slide Architect") return { finalOutput: minimalSlideArchitectOut() };
      if (agent.name === "Story Seed") {
        const variety = jsonBlock(prompt, "VARIETY PACK (json):\n", "\n\nRECENT VARIETY") as Record<string, unknown>;
        expect(variety).toMatchObject(expectedVariety);
        return {
          finalOutput: {
            story_seed: minimalStorySeed(variety, { logline: "l", setting: "s", cast: ["c"], stakes: "st" })
          }
        };
      }
      if (agent.name === "Showrunner") return { finalOutput: minimalShowrunnerOut() };
      if (agent.name === "Visual Director") return { finalOutput: minimalVisualOut() };
      if (agent.name === "Pacing Editor") return { finalOutput: minimalPacingOut() };
      if (agent.name === "Mapper") return { finalOutput: minimalMapperOut() };
      if (agent.name === "Slide Writer") return { finalOutput: minimalSlideSpecOut() };
      if (agent.name === "QA Suite") return { finalOutput: minimalQa(true) };
      if (agent.name === "Genspark Packager") return { finalOutput: minimalGensparkOut() };
      throw new Error(`Unexpected agent: ${agent.name}`);
    });

    await runStudioPipeline({ runId: run.runId, topic: run.topic }, runs, { signal: new AbortController().signal });
  });

  it("falls back to repetition if no unique variety can be found after attempts", async () => {
    const { RunManager } = await import("../src/run_manager.js");
    const { runStudioPipeline } = await import("../src/pipeline/studio_pipeline.js");

    const runs = new RunManager();
    const run = await runs.createRun("topic");

    // Replicate the deterministic key generation for attempts 0..24 and pre-fill memory with those keys.
    function hash32(input: string): number {
      let h = 0x811c9dc5;
      for (let i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
      }
      return h >>> 0;
    }
    function mulberry32(seed: number): () => number {
      return () => {
        let t = (seed += 0x6d2b79f5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    function pick<T>(rng: () => number, arr: T[]): T {
      return arr[Math.floor(rng() * arr.length)]!;
    }

    const genres = [
      "medical noir",
      "courtroom thriller",
      "hospital procedural",
      "small-town mystery",
      "techno-thriller",
      "classic whodunit",
      "survival drama"
    ];
    const settings = [
      "overnight ED shift",
      "rural clinic with limited resources",
      "ICU during a storm-induced power flicker",
      "ambulance ride with a deteriorating patient",
      "pre-op holding area with conflicting histories",
      "busy urgent care in flu season"
    ];
    const antagonists = [
      "anchoring bias",
      "a misleading device reading",
      "a time-critical lab delay",
      "an overconfident consultant",
      "a confusing medication list",
      "a hidden comorbidity"
    ];
    const twists = [
      "the obvious diagnosis is wrong",
      "two conditions are happening at once",
      "the history is incomplete",
      "the test result is a red herring",
      "the patient decompensates during a key decision",
      "a vital clue was overlooked in plain sight"
    ];
    const gadgets = [
      "a battered pocket ultrasound",
      "a malfunctioning glucometer",
      "a pager that never stops",
      "an annotated pocket guideline card",
      "a suspiciously pristine chart printout",
      "a whiteboard of shifting differentials"
    ];
    const motifPool = [
      "countdown clocks",
      "misdirection",
      "protocol vs intuition",
      "hidden constraints",
      "pattern recognition",
      "team handoffs",
      "false reassurance",
      "signal vs noise"
    ];

    const baseSeed = hash32(run.runId);
    const attempts = Array.from({ length: 25 }, (_, i) => i);

    const keys = attempts.map((attempt) => {
      const rng = mulberry32(baseSeed + attempt);
      const motifs = Array.from({ length: 3 }, () => pick(rng, motifPool));
      const variety = {
        genre_wrapper: pick(rng, genres),
        body_setting: pick(rng, settings),
        antagonist_archetype: pick(rng, antagonists),
        twist_type: pick(rng, twists),
        signature_gadget: pick(rng, gadgets),
        motifs
      };
      const key = `${variety.genre_wrapper}|${variety.body_setting}|${variety.antagonist_archetype}|${variety.twist_type}|${variety.signature_gadget}|${variety.motifs.join(",")}`;
      return { key, variety };
    });

    const memPath = path.join(String(tmpData), "episode_memory.json");
    await fs.writeFile(
      memPath,
      JSON.stringify(
        {
          recent: keys.map((k, idx) => ({
            at: new Date("2020-01-01T00:00:00.000Z").toISOString(),
            runId: `other_${idx}`,
            key: k.key,
            variety: k.variety
          }))
        },
        null,
        2
      ) + "\n",
      "utf8"
    );

    const agents = (await import("@openai/agents")) as RunnerModule;
    agents.__setMockRunnerHandler?.((agent: MockAgent, prompt: string) => {
      if (agent.name === "KB Compiler") return { finalOutput: { kb_context: "kb" } };
      if (agent.name === "Producer") return { finalOutput: minimalProducerBrief() };
      if (agent.name === "Medical Researcher") return { finalOutput: minimalFactsRaw() };
      if (agent.name === "Medical Editor") return { finalOutput: minimalEditorOut() };
      if (agent.name === "Medical Narrative Flow") return { finalOutput: minimalMedicalNarrativeFlowOut() };
      if (agent.name === "Curriculum Architect") return { finalOutput: minimalCurriculumOut() };
      if (agent.name === "Assessment Designer") return { finalOutput: minimalAssessmentOut() };
      if (agent.name === "Slide Architect") return { finalOutput: minimalSlideArchitectOut() };
      if (agent.name === "Story Seed") {
        const variety = jsonBlock(prompt, "VARIETY PACK (json):\n", "\n\nRECENT VARIETY") as Record<string, unknown>;
        return {
          finalOutput: { story_seed: minimalStorySeed(variety, { logline: "l", setting: "s", cast: ["c"], stakes: "st" }) }
        };
      }
      if (agent.name === "Showrunner") return { finalOutput: minimalShowrunnerOut() };
      if (agent.name === "Visual Director") return { finalOutput: minimalVisualOut() };
      if (agent.name === "Pacing Editor") return { finalOutput: minimalPacingOut() };
      if (agent.name === "Mapper") return { finalOutput: minimalMapperOut() };
      if (agent.name === "Slide Writer") return { finalOutput: minimalSlideSpecOut() };
      if (agent.name === "QA Suite") return { finalOutput: minimalQa(true) };
      if (agent.name === "Genspark Packager") return { finalOutput: minimalGensparkOut() };
      throw new Error(`Unexpected agent: ${agent.name}`);
    });

    await runStudioPipeline({ runId: run.runId, topic: run.topic }, runs, { signal: new AbortController().signal });

    const after = JSON.parse(await fs.readFile(memPath, "utf8")) as { recent: Array<{ runId: string; key: string }> };
    expect(after.recent[0]?.runId).toBe(run.runId);
    // Fallback uses the baseSeed, but with a different draw order than the attempt loop.
    const rng = mulberry32(baseSeed);
    const fallbackVariety = {
      genre_wrapper: pick(rng, genres),
      body_setting: pick(rng, settings),
      antagonist_archetype: pick(rng, antagonists),
      twist_type: pick(rng, twists),
      signature_gadget: pick(rng, gadgets),
      motifs: Array.from({ length: 3 }, () => pick(rng, motifPool))
    };
    const fallbackKey = `${fallbackVariety.genre_wrapper}|${fallbackVariety.body_setting}|${fallbackVariety.antagonist_archetype}|${fallbackVariety.twist_type}|${fallbackVariety.signature_gadget}|${fallbackVariety.motifs.join(",")}`;
    expect(after.recent[0]?.key).toBe(fallbackKey);
  });

  it.each([
    ["KB Compiler", /KB0 produced no final output/],
    ["Producer", /A produced no final output/],
    ["Medical Researcher", /B produced no final output/],
    ["Medical Editor", /C produced no final output/],
    ["Slide Architect", /F produced no final output/],
    ["Mapper", /K produced no final output/],
    ["Slide Writer", /L produced no final output/],
    ["QA Suite", /M produced no final output/],
    ["Genspark Packager", /O produced no final output/]
  ])("throws when %s returns no final output", async (agentName, errRe) => {
    const { RunManager } = await import("../src/run_manager.js");
    const { runStudioPipeline } = await import("../src/pipeline/studio_pipeline.js");

    const agents = (await import("@openai/agents")) as RunnerModule;
    agents.__setMockRunnerHandler?.((agent: MockAgent, prompt: string) => {
      if (agent.name === agentName) return { finalOutput: undefined };

      if (agent.name === "KB Compiler") return { finalOutput: { kb_context: "kb" } };
      if (agent.name === "Producer") return { finalOutput: minimalProducerBrief() };
      if (agent.name === "Medical Researcher") return { finalOutput: minimalFactsRaw() };
      if (agent.name === "Medical Editor") return { finalOutput: minimalEditorOut() };
      if (agent.name === "Medical Narrative Flow") return { finalOutput: minimalMedicalNarrativeFlowOut() };
      if (agent.name === "Curriculum Architect") return { finalOutput: minimalCurriculumOut() };
      if (agent.name === "Assessment Designer") return { finalOutput: minimalAssessmentOut() };
      if (agent.name === "Slide Architect") return { finalOutput: minimalSlideArchitectOut() };
      if (agent.name === "Story Seed") {
        const variety = jsonBlock(prompt, "VARIETY PACK (json):\n", "\n\nRECENT VARIETY") as Record<string, unknown>;
        return {
          finalOutput: {
            story_seed: minimalStorySeed(variety, { logline: "l", setting: "s", cast: ["c"], stakes: "st" })
          }
        };
      }
      if (agent.name === "Showrunner") return { finalOutput: minimalShowrunnerOut() };
      if (agent.name === "Visual Director") return { finalOutput: minimalVisualOut() };
      if (agent.name === "Pacing Editor") return { finalOutput: minimalPacingOut() };
      if (agent.name === "Mapper") return { finalOutput: minimalMapperOut() };
      if (agent.name === "Slide Writer") return { finalOutput: minimalSlideSpecOut() };
      if (agent.name === "QA Suite") return { finalOutput: minimalQa(true) };
      if (agent.name === "Genspark Packager") return { finalOutput: minimalGensparkOut() };
      throw new Error(`Unexpected agent: ${agent.name}`);
    });

    const runs = new RunManager();
    const run = await runs.createRun("topic");
    await expect(runStudioPipeline({ runId: run.runId, topic: run.topic }, runs, { signal: new AbortController().signal })).rejects.toThrow(
      errRe
    );
  });

  it("throws when Patch Applier returns no final output", async () => {
    const { RunManager } = await import("../src/run_manager.js");
    const { runStudioPipeline } = await import("../src/pipeline/studio_pipeline.js");

    const agents = (await import("@openai/agents")) as RunnerModule;
    agents.__setMockRunnerHandler?.((agent: MockAgent, prompt: string) => {
      if (agent.name === "KB Compiler") return { finalOutput: { kb_context: "kb" } };
      if (agent.name === "Producer") return { finalOutput: minimalProducerBrief() };
      if (agent.name === "Medical Researcher") return { finalOutput: minimalFactsRaw() };
      if (agent.name === "Medical Editor") return { finalOutput: minimalEditorOut() };
      if (agent.name === "Medical Narrative Flow") return { finalOutput: minimalMedicalNarrativeFlowOut() };
      if (agent.name === "Curriculum Architect") return { finalOutput: minimalCurriculumOut() };
      if (agent.name === "Assessment Designer") return { finalOutput: minimalAssessmentOut() };
      if (agent.name === "Slide Architect") return { finalOutput: minimalSlideArchitectOut() };
      if (agent.name === "Story Seed") {
        const variety = jsonBlock(prompt, "VARIETY PACK (json):\n", "\n\nRECENT VARIETY") as Record<string, unknown>;
        return {
          finalOutput: {
            story_seed: minimalStorySeed(variety, { logline: "l", setting: "s", cast: ["c"], stakes: "st" })
          }
        };
      }
      if (agent.name === "Showrunner") return { finalOutput: minimalShowrunnerOut() };
      if (agent.name === "Visual Director") return { finalOutput: minimalVisualOut() };
      if (agent.name === "Pacing Editor") return { finalOutput: minimalPacingOut() };
      if (agent.name === "Mapper") return { finalOutput: minimalMapperOut() };
      if (agent.name === "Slide Writer") return { finalOutput: minimalSlideSpecOut() };
      if (agent.name === "QA Suite") return { finalOutput: minimalQa(false) };
      if (agent.name === "Patch Applier") return { finalOutput: undefined };
      throw new Error(`Unexpected agent: ${agent.name}`);
    });

    const runs = new RunManager();
    const run = await runs.createRun("topic");
    await expect(runStudioPipeline({ runId: run.runId, topic: run.topic }, runs, { signal: new AbortController().signal })).rejects.toThrow(
      /N produced no final output/
    );
  });

  it("throws when QA Suite iter2 returns no final output", async () => {
    const { RunManager } = await import("../src/run_manager.js");
    const { runStudioPipeline } = await import("../src/pipeline/studio_pipeline.js");

    let qaCalls = 0;
    const agents = (await import("@openai/agents")) as RunnerModule;
    agents.__setMockRunnerHandler?.((agent: MockAgent, prompt: string) => {
      if (agent.name === "KB Compiler") return { finalOutput: { kb_context: "kb" } };
      if (agent.name === "Producer") return { finalOutput: minimalProducerBrief() };
      if (agent.name === "Medical Researcher") return { finalOutput: minimalFactsRaw() };
      if (agent.name === "Medical Editor") return { finalOutput: minimalEditorOut() };
      if (agent.name === "Medical Narrative Flow") return { finalOutput: minimalMedicalNarrativeFlowOut() };
      if (agent.name === "Curriculum Architect") return { finalOutput: minimalCurriculumOut() };
      if (agent.name === "Assessment Designer") return { finalOutput: minimalAssessmentOut() };
      if (agent.name === "Slide Architect") return { finalOutput: minimalSlideArchitectOut() };
      if (agent.name === "Story Seed") {
        const variety = jsonBlock(prompt, "VARIETY PACK (json):\n", "\n\nRECENT VARIETY") as Record<string, unknown>;
        return {
          finalOutput: {
            story_seed: minimalStorySeed(variety, { logline: "l", setting: "s", cast: ["c"], stakes: "st" })
          }
        };
      }
      if (agent.name === "Showrunner") return { finalOutput: minimalShowrunnerOut() };
      if (agent.name === "Visual Director") return { finalOutput: minimalVisualOut() };
      if (agent.name === "Pacing Editor") return { finalOutput: minimalPacingOut() };
      if (agent.name === "Mapper") return { finalOutput: minimalMapperOut() };
      if (agent.name === "Slide Writer") return { finalOutput: minimalSlideSpecOut() };
      if (agent.name === "Patch Applier") return { finalOutput: minimalPatchedSpecOut() };
      if (agent.name === "QA Suite") {
        qaCalls += 1;
        if (qaCalls === 1) return { finalOutput: minimalQa(false) };
        return { finalOutput: undefined };
      }
      throw new Error(`Unexpected agent: ${agent.name}`);
    });

    const runs = new RunManager();
    const run = await runs.createRun("topic");
    await expect(runStudioPipeline({ runId: run.runId, topic: run.topic }, runs, { signal: new AbortController().signal })).rejects.toThrow(
      /M produced no final output \(iter2\)/
    );
  });

  it("semantic repetition guard retries Story Seed when similarity is too high", async () => {
    const { RunManager } = await import("../src/run_manager.js");
    const { runStudioPipeline } = await import("../src/pipeline/studio_pipeline.js");
    const { artifactAbsPath, readJsonFile } = await import("../src/pipeline/utils.js");

    // Overwrite memory with a highly similar prior fingerprint so guard triggers.
    await fs.writeFile(
      path.join(tmpData as string, "episode_memory.json"),
      JSON.stringify(
        {
          recent: [
            {
              at: new Date("2020-01-01T00:00:00.000Z").toISOString(),
              runId: "prev_story",
              key: "k",
              variety: {
                genre_wrapper: "medical noir",
                body_setting: "overnight ED shift",
                antagonist_archetype: "anchoring bias",
                twist_type: "the obvious diagnosis is wrong",
                signature_gadget: "a battered pocket ultrasound",
                motifs: ["misdirection", "countdown clocks", "pattern recognition"]
              },
              story_fingerprint: "canon story | ship med bay | Dr. Nova | high stakes"
            }
          ]
        },
        null,
        2
      ) + "\n",
      "utf8"
    );

    const agents = (await import("@openai/agents")) as RunnerModule;
    let storySeedCalls = 0;

    agents.__setMockRunnerHandler?.((agent: MockAgent, prompt: string) => {
      if (agent.name === "KB Compiler") return { finalOutput: { kb_context: "kb" } };
      if (agent.name === "Producer") return { finalOutput: minimalProducerBrief() };
      if (agent.name === "Medical Researcher") return { finalOutput: minimalFactsRaw() };
      if (agent.name === "Medical Editor") return { finalOutput: minimalEditorOut() };
      if (agent.name === "Medical Narrative Flow") return { finalOutput: minimalMedicalNarrativeFlowOut() };
      if (agent.name === "Curriculum Architect") return { finalOutput: minimalCurriculumOut() };
      if (agent.name === "Assessment Designer") return { finalOutput: minimalAssessmentOut() };
      if (agent.name === "Slide Architect") return { finalOutput: minimalSlideArchitectOut() };
      if (agent.name === "Story Seed") {
        storySeedCalls += 1;
        const variety = jsonBlock(prompt, "VARIETY PACK (json):\n", "\n\nRECENT VARIETY") as Record<string, unknown>;
        if (storySeedCalls === 1) {
          return {
            finalOutput: {
              story_seed: minimalStorySeed(variety, { logline: "canon story", setting: "ship med bay", cast: ["Dr. Nova"], stakes: "high stakes" })
            }
          };
        }
        expect(prompt).toContain("SEMANTIC REPETITION GUARD");
        return {
          finalOutput: {
            story_seed: minimalStorySeed(variety, { logline: "new branch of mystery", setting: "rural clinic corridor", cast: ["Dr. Nova"], stakes: "urgent escalation" })
          }
        };
      }
      if (agent.name === "Showrunner") return { finalOutput: minimalShowrunnerOut() };
      if (agent.name === "Visual Director") return { finalOutput: minimalVisualOut() };
      if (agent.name === "Pacing Editor") return { finalOutput: minimalPacingOut() };
      if (agent.name === "Mapper") return { finalOutput: minimalMapperOut() };
      if (agent.name === "Slide Writer") return { finalOutput: minimalSlideSpecOut() };
      if (agent.name === "QA Suite") return { finalOutput: minimalQa(true) };
      if (agent.name === "Genspark Packager") return { finalOutput: minimalGensparkOut() };
      throw new Error(`Unexpected agent: ${agent.name}`);
    });

    const runs = new RunManager();
    const run = await runs.createRun("topic");

    await runStudioPipeline({ runId: run.runId, topic: run.topic }, runs, { signal: new AbortController().signal });

    expect(storySeedCalls).toBe(2);
    const memSnapshot = await readJsonFile<{ recent: Array<{ runId: string; story_fingerprint?: string }> }>(
      artifactAbsPath(run.runId, "episode_memory_snapshot.json")
    );
    const me = memSnapshot.recent.find((r) => r.runId === run.runId);
    expect(me?.story_fingerprint).toContain("new branch of mystery");
  });

  it("constraint adherence warning is persisted to run metadata", async () => {
    const { RunManager } = await import("../src/run_manager.js");
    const { runStudioPipeline } = await import("../src/pipeline/studio_pipeline.js");
    const { artifactAbsPath, readJsonFile } = await import("../src/pipeline/utils.js");

    const canonRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mms-canon-warn-"));
    await fs.mkdir(path.join(canonRoot, "episode"), { recursive: true });
    await fs.writeFile(path.join(canonRoot, "character_bible.md"), "Name: Dr. Ada\n", "utf8");
    await fs.writeFile(path.join(canonRoot, "series_style_bible.md"), "- must include impossible_marker_sequence\n", "utf8");
    await fs.writeFile(path.join(canonRoot, "episode", "deck_spec.md"), "- baseline deck\n", "utf8");
    await fs.writeFile(path.join(canonRoot, "episode", "episode_memory.json"), JSON.stringify({ recent: [] }, null, 2) + "\n", "utf8");

    process.env.MMS_CANON_ROOT = canonRoot;
    delete process.env.MMS_DISABLE_CANON_AUTO_DISCOVERY;

    const agents = (await import("@openai/agents")) as RunnerModule;
    agents.__setMockRunnerHandler?.((agent: MockAgent, prompt: string) => {
      if (agent.name === "KB Compiler") return { finalOutput: { kb_context: "kb" } };
      if (agent.name === "Producer") return { finalOutput: minimalProducerBrief() };
      if (agent.name === "Medical Researcher") return { finalOutput: minimalFactsRaw() };
      if (agent.name === "Medical Editor") return { finalOutput: minimalEditorOut() };
      if (agent.name === "Medical Narrative Flow") return { finalOutput: minimalMedicalNarrativeFlowOut() };
      if (agent.name === "Curriculum Architect") return { finalOutput: minimalCurriculumOut() };
      if (agent.name === "Assessment Designer") return { finalOutput: minimalAssessmentOut() };
      if (agent.name === "Slide Architect") return { finalOutput: minimalSlideArchitectOut() };
      if (agent.name === "Story Seed") {
        const variety = jsonBlock(prompt, "VARIETY PACK (json):\n", "\n\nRECENT VARIETY") as Record<string, unknown>;
        return {
          finalOutput: {
            story_seed: minimalStorySeed(variety, { logline: "warn case", setting: "ED", cast: ["Dr. Ada"], stakes: "high" })
          }
        };
      }
      if (agent.name === "Showrunner") return { finalOutput: minimalShowrunnerOut() };
      if (agent.name === "Visual Director") return { finalOutput: minimalVisualOut() };
      if (agent.name === "Pacing Editor") return { finalOutput: minimalPacingOut() };
      if (agent.name === "Mapper") return { finalOutput: minimalMapperOut() };
      if (agent.name === "Slide Writer") return { finalOutput: minimalSlideSpecOut() };
      if (agent.name === "QA Suite") return { finalOutput: minimalQa(true) };
      if (agent.name === "Genspark Packager") return { finalOutput: minimalGensparkOut() };
      throw new Error(`Unexpected agent: ${agent.name}`);
    });

    try {
      const runs = new RunManager();
      const run = await runs.createRun("topic");

      await runStudioPipeline({ runId: run.runId, topic: run.topic }, runs, { signal: new AbortController().signal });
      const adherence = await readJsonFile<{ status: string }>(artifactAbsPath(run.runId, "constraint_adherence_report.json"));
      expect(adherence.status).toBe("warn");
      expect(runs.getRun(run.runId)?.constraintAdherence?.status).toBe("warn");
    } finally {
      delete process.env.MMS_CANON_ROOT;
      process.env.MMS_DISABLE_CANON_AUTO_DISCOVERY = "1";
      await fs.rm(canonRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("fails run when constraint adherence check fails", async () => {
    const { RunManager } = await import("../src/run_manager.js");
    const { runStudioPipeline } = await import("../src/pipeline/studio_pipeline.js");

    const canonRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mms-canon-fail-"));
    await fs.mkdir(path.join(canonRoot, "episode"), { recursive: true });
    await fs.writeFile(path.join(canonRoot, "character_bible.md"), "Name: Dr. Impossible\n", "utf8");
    await fs.writeFile(path.join(canonRoot, "series_style_bible.md"), "- baseline\n", "utf8");
    await fs.writeFile(path.join(canonRoot, "episode", "deck_spec.md"), "- baseline deck\n", "utf8");
    await fs.writeFile(path.join(canonRoot, "episode", "episode_memory.json"), JSON.stringify({ recent: [] }, null, 2) + "\n", "utf8");

    process.env.MMS_CANON_ROOT = canonRoot;
    delete process.env.MMS_DISABLE_CANON_AUTO_DISCOVERY;

    const agents = (await import("@openai/agents")) as RunnerModule;
    agents.__setMockRunnerHandler?.((agent: MockAgent, prompt: string) => {
      if (agent.name === "KB Compiler") return { finalOutput: { kb_context: "kb" } };
      if (agent.name === "Producer") return { finalOutput: minimalProducerBrief() };
      if (agent.name === "Medical Researcher") return { finalOutput: minimalFactsRaw() };
      if (agent.name === "Medical Editor") return { finalOutput: minimalEditorOut() };
      if (agent.name === "Medical Narrative Flow") return { finalOutput: minimalMedicalNarrativeFlowOut() };
      if (agent.name === "Curriculum Architect") return { finalOutput: minimalCurriculumOut() };
      if (agent.name === "Assessment Designer") return { finalOutput: minimalAssessmentOut() };
      if (agent.name === "Slide Architect") return { finalOutput: minimalSlideArchitectOut() };
      if (agent.name === "Story Seed") {
        const variety = jsonBlock(prompt, "VARIETY PACK (json):\n", "\n\nRECENT VARIETY") as Record<string, unknown>;
        return {
          finalOutput: {
            story_seed: minimalStorySeed(variety, { logline: "fail case", setting: "ED", cast: ["Dr. Ada"], stakes: "high" })
          }
        };
      }
      if (agent.name === "Showrunner") return { finalOutput: minimalShowrunnerOut() };
      if (agent.name === "Visual Director") return { finalOutput: minimalVisualOut() };
      if (agent.name === "Pacing Editor") return { finalOutput: minimalPacingOut() };
      if (agent.name === "Mapper") return { finalOutput: minimalMapperOut() };
      if (agent.name === "Slide Writer") return { finalOutput: minimalSlideSpecOut() };
      if (agent.name === "QA Suite") return { finalOutput: minimalQa(true) };
      if (agent.name === "Genspark Packager") return { finalOutput: minimalGensparkOut() };
      throw new Error(`Unexpected agent: ${agent.name}`);
    });

    try {
      const runs = new RunManager();
      const run = await runs.createRun("topic");

      await expect(
        runStudioPipeline({ runId: run.runId, topic: run.topic }, runs, { signal: new AbortController().signal })
      ).rejects.toThrow(/Constraint adherence failed/);

      expect(runs.getRun(run.runId)?.steps.O.status).toBe("error");
    } finally {
      delete process.env.MMS_CANON_ROOT;
      process.env.MMS_DISABLE_CANON_AUTO_DISCOVERY = "1";
      await fs.rm(canonRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("does not fail run on adherence fail when settings.adherenceMode=warn", async () => {
    const { RunManager } = await import("../src/run_manager.js");
    const { runStudioPipeline } = await import("../src/pipeline/studio_pipeline.js");
    const { artifactAbsPath, readJsonFile } = await import("../src/pipeline/utils.js");

    const canonRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mms-canon-warn-mode-"));
    await fs.mkdir(path.join(canonRoot, "episode"), { recursive: true });
    await fs.writeFile(path.join(canonRoot, "character_bible.md"), "Name: Dr. Impossible\n", "utf8");
    await fs.writeFile(path.join(canonRoot, "series_style_bible.md"), "- baseline\n", "utf8");
    await fs.writeFile(path.join(canonRoot, "episode", "deck_spec.md"), "- baseline deck\n", "utf8");
    await fs.writeFile(path.join(canonRoot, "episode", "episode_memory.json"), JSON.stringify({ recent: [] }, null, 2) + "\n", "utf8");

    process.env.MMS_CANON_ROOT = canonRoot;
    delete process.env.MMS_DISABLE_CANON_AUTO_DISCOVERY;

    const agents = (await import("@openai/agents")) as RunnerModule;
    agents.__setMockRunnerHandler?.((agent: MockAgent, prompt: string) => {
      if (agent.name === "KB Compiler") return { finalOutput: { kb_context: "kb" } };
      if (agent.name === "Producer") return { finalOutput: minimalProducerBrief() };
      if (agent.name === "Medical Researcher") return { finalOutput: minimalFactsRaw() };
      if (agent.name === "Medical Editor") return { finalOutput: minimalEditorOut() };
      if (agent.name === "Medical Narrative Flow") return { finalOutput: minimalMedicalNarrativeFlowOut() };
      if (agent.name === "Curriculum Architect") return { finalOutput: minimalCurriculumOut() };
      if (agent.name === "Assessment Designer") return { finalOutput: minimalAssessmentOut() };
      if (agent.name === "Slide Architect") return { finalOutput: minimalSlideArchitectOut() };
      if (agent.name === "Story Seed") {
        const variety = jsonBlock(prompt, "VARIETY PACK (json):\n", "\n\nRECENT VARIETY") as Record<string, unknown>;
        return {
          finalOutput: {
            story_seed: minimalStorySeed(variety, { logline: "warn mode fail case", setting: "ED", cast: ["Dr. Ada"], stakes: "high" })
          }
        };
      }
      if (agent.name === "Showrunner") return { finalOutput: minimalShowrunnerOut() };
      if (agent.name === "Visual Director") return { finalOutput: minimalVisualOut() };
      if (agent.name === "Pacing Editor") return { finalOutput: minimalPacingOut() };
      if (agent.name === "Mapper") return { finalOutput: minimalMapperOut() };
      if (agent.name === "Slide Writer") return { finalOutput: minimalSlideSpecOut() };
      if (agent.name === "QA Suite") return { finalOutput: minimalQa(true) };
      if (agent.name === "Genspark Packager") return { finalOutput: minimalGensparkOut() };
      throw new Error(`Unexpected agent: ${agent.name}`);
    });

    try {
      const runs = new RunManager();
      const run = await runs.createRun("topic", { adherenceMode: "warn" });

      await runStudioPipeline(
        { runId: run.runId, topic: run.topic, settings: { adherenceMode: "warn" } },
        runs,
        { signal: new AbortController().signal }
      );

      const status = runs.getRun(run.runId);
      expect(status?.steps.O.status).toBe("done");
      expect(status?.steps.P.status).toBe("done");
      const adherence = await readJsonFile<{ status: string }>(artifactAbsPath(run.runId, "constraint_adherence_report.json"));
      expect(adherence.status).toBe("fail");
      expect(status?.constraintAdherence?.status).toBe("fail");
    } finally {
      delete process.env.MMS_CANON_ROOT;
      process.env.MMS_DISABLE_CANON_AUTO_DISCOVERY = "1";
      await fs.rm(canonRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("fails loudly when an agent returns invalid output", async () => {
    const { RunManager } = await import("../src/run_manager.js");
    const { runStudioPipeline } = await import("../src/pipeline/studio_pipeline.js");

    const agents = (await import("@openai/agents")) as RunnerModule;
    agents.__setMockRunnerHandler?.((agent: MockAgent) => {
      if (agent.name === "KB Compiler") return { finalOutput: { kb_context: "kb" } };
      if (agent.name === "Producer") {
        // Invalid: missing required producer_brief keys
        return { finalOutput: { producer_brief: { title: "" } } };
      }
      throw new Error(`Unexpected agent: ${agent.name}`);
    });

    const runs = new RunManager();
    const run = await runs.createRun("topic");

    await expect(
      runStudioPipeline({ runId: run.runId, topic: run.topic }, runs, { signal: new AbortController().signal })
    ).rejects.toThrow(/Invalid agent output/);

    expect(runs.getRun(run.runId)?.steps.A.status).toBe("error");
  });

  it("injects canonical files into story/visual prompts and updates template episode memory", async () => {
    const { RunManager } = await import("../src/run_manager.js");
    const { runStudioPipeline } = await import("../src/pipeline/studio_pipeline.js");
    const { artifactAbsPath, readJsonFile } = await import("../src/pipeline/utils.js");

    const canonRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mms-canon-"));
    const canonEpisodeDir = path.join(canonRoot, "episode");
    await fs.mkdir(canonEpisodeDir, { recursive: true });
    await fs.writeFile(path.join(canonRoot, "character_bible.md"), "CHAR_CANON: Dr. Nova, medic detective\n", "utf8");
    await fs.writeFile(path.join(canonRoot, "series_style_bible.md"), "STYLE_CANON: analog sci-fi, teal/orange grade\n", "utf8");
    await fs.writeFile(path.join(canonEpisodeDir, "deck_spec.md"), "DECK_CANON: 12 slides, cold open then reveal\n", "utf8");
    await fs.writeFile(path.join(canonEpisodeDir, "episode_memory.json"), JSON.stringify({ recent: [] }, null, 2) + "\n", "utf8");

    process.env.MMS_CANON_ROOT = canonRoot;
    delete process.env.MMS_DISABLE_CANON_AUTO_DISCOVERY;

    const agents = (await import("@openai/agents")) as RunnerModule;
    agents.__setMockRunnerHandler?.((agent: MockAgent, prompt: string) => {
      if (agent.name === "KB Compiler") {
        expect(prompt).toContain("CHAR_CANON");
        expect(prompt).toContain("STYLE_CANON");
        return {
          finalOutput: {
            kb_context:
              "## Medical / Clinical KB\n- med\n\n## Characters & Story Constraints\n- kb story\n\n## Visual Style / Shot Constraints\n- kb visual\n"
          }
        };
      }
      if (agent.name === "Producer") return { finalOutput: minimalProducerBrief() };
      if (agent.name === "Medical Researcher") return { finalOutput: minimalFactsRaw() };
      if (agent.name === "Medical Editor") return { finalOutput: minimalEditorOut() };
      if (agent.name === "Medical Narrative Flow") return { finalOutput: minimalMedicalNarrativeFlowOut() };
      if (agent.name === "Curriculum Architect") return { finalOutput: minimalCurriculumOut() };
      if (agent.name === "Assessment Designer") return { finalOutput: minimalAssessmentOut() };
      if (agent.name === "Slide Architect") return { finalOutput: minimalSlideArchitectOut() };
      if (agent.name === "Story Seed") {
        expect(prompt).toContain("CHAR_CANON");
        expect(prompt).toContain("STYLE_CANON");
        const variety = jsonBlock(prompt, "VARIETY PACK (json):\n", "\n\nRECENT VARIETY") as Record<string, unknown>;
        return {
          finalOutput: {
            story_seed: minimalStorySeed(variety, { logline: "canon story", setting: "ship med bay", cast: ["Dr. Nova"], stakes: "high" })
          }
        };
      }
      if (agent.name === "Showrunner") {
        expect(prompt).toContain("CHAR_CANON");
        expect(prompt).toContain("STYLE_CANON");
        return {
          finalOutput: {
            ...minimalShowrunnerOut(),
            story_bible: {
              ...minimalShowrunnerOut().story_bible,
              cast: [
                {
                  name: "Dr. Nova",
                  role: "lead",
                  bio: "Canon lead",
                  traits: ["calm"],
                  constraints: ["no cruelty"]
                }
              ]
            },
            beat_sheet: [{ beat: "beat1", purpose: "purpose1", characters: ["Dr. Nova"], setting: "ED" }]
          }
        };
      }
      if (agent.name === "Visual Director") {
        expect(prompt).toContain("STYLE_CANON");
        return { finalOutput: minimalVisualOut() };
      }
      if (agent.name === "Pacing Editor") return { finalOutput: minimalPacingOut() };
      if (agent.name === "Mapper") return { finalOutput: minimalMapperOut() };
      if (agent.name === "Slide Writer") {
        expect(prompt).toContain("CHAR_CANON");
        expect(prompt).toContain("STYLE_CANON");
        return { finalOutput: minimalSlideSpecOut() };
      }
      if (agent.name === "QA Suite") return { finalOutput: minimalQa(true) };
      if (agent.name === "Genspark Packager") return { finalOutput: minimalGensparkOut() };
      throw new Error(`Unexpected agent: ${agent.name}`);
    });

    try {
      const runs = new RunManager();
      const run = await runs.createRun("topic");

      await runStudioPipeline({ runId: run.runId, topic: run.topic }, runs, { signal: new AbortController().signal });
      await expect(fs.stat(artifactAbsPath(run.runId, "canonical_profile.md"))).resolves.toBeTruthy();
      await expect(fs.stat(artifactAbsPath(run.runId, "canonical_profile_sources.json"))).resolves.toBeTruthy();
      await expect(fs.stat(artifactAbsPath(run.runId, "constraint_adherence_report.json"))).resolves.toBeTruthy();

      const mem = await readJsonFile<{ recent: Array<{ runId: string; story_fingerprint?: string; cast?: string[] }> }>(
        path.join(canonEpisodeDir, "episode_memory.json")
      );
      const entry = mem.recent.find((r) => r.runId === run.runId);
      expect(entry?.story_fingerprint).toContain("canon story");
      expect(entry?.cast).toEqual(["Dr. Nova"]);

      const runStatus = runs.getRun(run.runId);
      expect(runStatus?.canonicalSources?.foundAny).toBe(true);
      expect(runStatus?.constraintAdherence?.status).toBeDefined();
    } finally {
      delete process.env.MMS_CANON_ROOT;
      process.env.MMS_DISABLE_CANON_AUTO_DISCOVERY = "1";
      await fs.rm(canonRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
