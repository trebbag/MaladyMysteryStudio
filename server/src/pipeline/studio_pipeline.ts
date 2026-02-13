import fs from "node:fs/promises";
import { Runner, setDefaultOpenAIKey, withTrace, MaxTurnsExceededError, ModelBehaviorError } from "@openai/agents";
import type { RunManager, RunSettings, StepName } from "../run_manager.js";
import { STEP_ORDER } from "../run_manager.js";
import { loadEpisodeMemory, remember, rememberStoryFingerprint, saveEpisodeMemory, type VarietyPack } from "./memory.js";
import { loadCanonicalProfile } from "./canon.js";
import { buildStoryFingerprint, closestFingerprint, type SimilarityMatch } from "./repetition_guard.js";
import { evaluateConstraintAdherence, summarizeConstraintAdherence } from "./constraint_checks.js";
import {
  applyMedicalDepthGuardToQa,
  buildMedicalStoryTraceabilityReport,
  evaluateMedicalDepth,
  type MedicalDepthReport
} from "./qa_depth_traceability.js";
import {
  assessmentDesignerAgent,
  CONFIGURED_MODEL,
  curriculumArchitectAgent,
  gensparkMasterPolisherAgent,
  gensparkPackagerAgent,
  makeKbCompilerAgent,
  mapperAgent,
  medicalEditorAgent,
  medicalNarrativeFlowAgent,
  medicalResearcherAgent,
  pacingEditorAgent,
  patchApplierAgent,
  producerAgent,
  qaSuiteAgent,
  showrunnerAgent,
  slideArchitectAgent,
  slideWriterAgent,
  storySeedAgent,
  visualDirectorAgent
} from "./agents.js";
import { buildGensparkMasterDoc, validateGensparkMasterDoc } from "./genspark_master_doc.js";
import { artifactAbsPath, nowIso, readJsonFile, resolveArtifactPathAbs, writeJsonFile, writeTextFile } from "./utils.js";
import type {
  AssessmentOutput,
  CurriculumOutput,
  EditorOutput,
  GensparkMasterDocOutput,
  GensparkOutput,
  KbCompilerOutput,
  MedicalNarrativeFlowOutput,
  MapperOutput,
  PacingEditorOutput,
  PatchOutput,
  ProducerOutput,
  QaOutput,
  ResearcherOutput,
  ShowrunnerOutput,
  SlideArchitectOutput,
  SlideWriterOutput,
  StorySeedOutput,
  VisualDirectorOutput
} from "./schemas.js";

export type RunInput = {
  runId: string;
  topic: string;
  settings?: RunSettings;
};

export type PipelineOptions = {
  signal: AbortSignal;
  startFrom?: StepName;
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim().length === 0) throw new Error(`Missing required env var: ${name}`);
  return v.trim();
}

function hash32(input: string): number {
  // FNV-1a
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

function joinContexts(...parts: Array<string | null | undefined>): string {
  const normalized = parts.map((part) => (part ?? "").trim()).filter((part) => part.length > 0);
  return normalized.join("\n\n");
}

const SEMANTIC_REPEAT_THRESHOLD = 0.82;

type SemanticGuardInfo = {
  closest: SimilarityMatch;
  threshold: number;
  retried: boolean;
} | null;

async function selectVarietyPack(runId: string): Promise<VarietyPack> {
  const mem = await loadEpisodeMemory();

  const existing = mem.recent.find((r) => r.runId === runId);
  if (existing) return existing.variety;

  const recentKeys = new Set(mem.recent.map((r) => r.key));

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

  const baseSeed = hash32(runId);

  for (let attempt = 0; attempt < 25; attempt++) {
    const rng = mulberry32(baseSeed + attempt);

    const motifs = Array.from({ length: 3 }, () => pick(rng, motifPool));
    const variety: VarietyPack = {
      genre_wrapper: pick(rng, genres),
      body_setting: pick(rng, settings),
      antagonist_archetype: pick(rng, antagonists),
      twist_type: pick(rng, twists),
      signature_gadget: pick(rng, gadgets),
      motifs
    };

    const key = `${variety.genre_wrapper}|${variety.body_setting}|${variety.antagonist_archetype}|${variety.twist_type}|${variety.signature_gadget}|${variety.motifs.join(",")}`;
    if (recentKeys.has(key)) continue;

    const entry = { at: nowIso(), runId, key, variety };
    const nextMem = remember(mem, entry, 30);
    await saveEpisodeMemory(nextMem);
    return variety;
  }

  // Fallback: accept repetition if we can't find a unique combo.
  const rng = mulberry32(baseSeed);
  const variety: VarietyPack = {
    genre_wrapper: pick(rng, genres),
    body_setting: pick(rng, settings),
    antagonist_archetype: pick(rng, antagonists),
    twist_type: pick(rng, twists),
    signature_gadget: pick(rng, gadgets),
    motifs: Array.from({ length: 3 }, () => pick(rng, motifPool))
  };

  const key = `${variety.genre_wrapper}|${variety.body_setting}|${variety.antagonist_archetype}|${variety.twist_type}|${variety.signature_gadget}|${variety.motifs.join(",")}`;
  const entry = { at: nowIso(), runId, key, variety };
  const nextMem = remember(mem, entry, 30);
  await saveEpisodeMemory(nextMem);
  return variety;
}

export async function runStudioPipeline(input: RunInput, runs: RunManager, options: PipelineOptions): Promise<void> {
  const { runId, topic, settings } = input;
  const { signal } = options;
  const adherenceMode = settings?.adherenceMode ?? "strict";
  const level = settings?.level ?? "student";

  const openaiKey = requireEnv("OPENAI_API_KEY");
  const vectorStoreId = requireEnv("KB_VECTOR_STORE_ID");
  setDefaultOpenAIKey(openaiKey);

  const runner = new Runner();
  const deterministicRunner = new Runner({ modelSettings: { temperature: 0 } });
  const repairRunner = new Runner({ modelSettings: { temperature: 0, toolChoice: "none" } });
  const startFrom = options.startFrom ?? "KB0";
  const startIdx = STEP_ORDER.indexOf(startFrom);
  if (startIdx === -1) throw new Error(`Invalid startFrom: ${startFrom}`);
  const pOnlyRerun = startFrom === "P";

  const idx = (step: StepName) => STEP_ORDER.indexOf(step);
  const shouldRun = (step: StepName) => idx(step) >= startIdx;
  const allowSparseLegacyReuse = startIdx >= idx("O");

  async function loadJson<T>(name: string): Promise<T> {
    const resolved = await resolveArtifactPathAbs(runId, name);
    if (!resolved) throw new Error(`Missing required artifact: ${name}`);
    return await readJsonFile<T>(resolved);
  }

  async function loadText(name: string): Promise<string> {
    const resolved = await resolveArtifactPathAbs(runId, name);
    if (!resolved) throw new Error(`Missing required artifact: ${name}`);
    return await fs.readFile(resolved, "utf8");
  }

  async function writeJsonArtifact(step: StepName, name: string, obj: unknown) {
    await writeJsonFile(artifactAbsPath(runId, name), obj);
    await runs.addArtifact(runId, step, name);
  }

  async function writeTextArtifact(step: StepName, name: string, text: string) {
    await writeTextFile(artifactAbsPath(runId, name), text);
    await runs.addArtifact(runId, step, name);
  }

  function extractH2Section(markdown: string, headingText: string): string | null {
    const norm = markdown.replace(/\r\n/g, "\n");
    const lines = norm.split("\n");
    const target = `## ${headingText}`.trim().toLowerCase();
    const startIdx = lines.findIndex((l) => l.trim().toLowerCase() === target);
    if (startIdx === -1) return null;

    let endIdx = lines.length;
    for (let i = startIdx + 1; i < lines.length; i++) {
      if (lines[i]?.startsWith("## ")) {
        endIdx = i;
        break;
      }
    }

    const section = lines.slice(startIdx, endIdx).join("\n").trim();
    return section.length > 0 ? section : null;
  }

  function fallbackStoryBible(): ShowrunnerOutput["story_bible"] {
    return {
      premise: `Compatibility fallback story bible for ${topic}.`,
      rules: ["Preserve medical-story alignment", "Keep continuity of recurring cast and scene style"],
      recurring_motifs: ["evidence checkpoints", "signal vs noise"],
      cast: [
        {
          name: "Cyto",
          role: "lead detective",
          bio: "Fallback cast entry generated from sparse legacy artifacts.",
          traits: ["curious", "methodical"],
          constraints: ["avoid contradiction with medical facts"]
        },
        {
          name: "Pip",
          role: "investigation partner",
          bio: "Fallback cast entry generated from sparse legacy artifacts.",
          traits: ["energetic", "supportive"],
          constraints: ["keep scenes clinically grounded"]
        }
      ],
      story_constraints_used: ["legacy compatibility fallback"],
      visual_constraints_used: ["legacy compatibility fallback"]
    };
  }

  function fallbackBeatSheet(): ShowrunnerOutput["beat_sheet"] {
    return [
      {
        beat: "Fallback intro beat",
        purpose: "Bridge sparse legacy artifacts into a valid renderable sequence.",
        characters: ["Cyto", "Pip"],
        setting: "Office HQ"
      },
      {
        beat: "Fallback investigation beat",
        purpose: "Maintain medical narrative continuity in compatibility mode.",
        characters: ["Cyto", "Pip"],
        setting: "Body investigation zone"
      },
      {
        beat: "Fallback outro beat",
        purpose: "Close loop for compatibility mode output.",
        characters: ["Cyto", "Pip"],
        setting: "Office HQ"
      }
    ];
  }

  function fallbackShotList(): VisualDirectorOutput["shot_list"] {
    return [
      {
        shot_id: "SH_FALLBACK_1",
        moment: "Compatibility fallback framing",
        framing: "medium",
        visual_notes: "Fallback shot list generated because sparse legacy artifacts omitted shot_list.json."
      }
    ];
  }

  async function runStep<T>(step: StepName, fn: () => Promise<T>): Promise<T> {
    if (signal.aborted) throw new Error("Cancelled");
    await runs.startStep(runId, step);
    try {
      const out = await fn();
      await runs.finishStep(runId, step, true);
      return out;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await runs.finishStep(runId, step, false, msg);
      throw err;
    }
  }

  type ModelResponseLike = { output?: unknown[] } | null | undefined;
  type ErrorStateLike = { _modelResponses?: ModelResponseLike[] } | null | undefined;

  function assistantTextFromItem(item: unknown): string | null {
    if (!item || typeof item !== "object") return null;
    const rec = item as Record<string, unknown>;
    if (rec.role !== "assistant") return null;
    const content = rec.content;
    if (!Array.isArray(content)) return null;

    const parts: string[] = [];
    for (const c of content) {
      if (!c || typeof c !== "object") continue;
      const cre = c as Record<string, unknown>;
      if (cre.type === "output_text" && typeof cre.text === "string") parts.push(cre.text);
      if (cre.type === "refusal" && typeof cre.refusal === "string") parts.push(cre.refusal);
    }

    const t = parts.join("").trim();
    return t.length > 0 ? t : null;
  }

  function lastAssistantTextFromModelResponses(modelResponses: ModelResponseLike[]): string | null {
    for (let i = modelResponses.length - 1; i >= 0; i--) {
      const out = modelResponses[i]?.output;
      if (!Array.isArray(out)) continue;
      for (let j = out.length - 1; j >= 0; j--) {
        const t = assistantTextFromItem(out[j]);
        if (t) return t;
      }
    }
    return null;
  }

  function lastAssistantTextFromAgentsError(err: unknown): string | null {
    const state = (err as { state?: unknown } | null | undefined)?.state as ErrorStateLike;
    const responses = state?._modelResponses;
    if (!responses || !Array.isArray(responses)) return null;
    return lastAssistantTextFromModelResponses(responses);
  }

  async function runAgentOutput<T>(
    step: StepName,
    agent: { name?: string },
    prompt: string,
    opts: { maxTurns: number; noFinalOutputMessage?: string }
  ): Promise<T> {
    try {
      const result = await runner.run(agent as never, prompt, { maxTurns: opts.maxTurns, signal });
      if (!result.finalOutput) throw new Error(opts.noFinalOutputMessage ?? `${step} produced no final output`);
      return result.finalOutput as T;
    } catch (err) {
      // Agents SDK throws ModelBehaviorError when structured output (JSON/Zod) doesn't validate.
      // It can also throw MaxTurnsExceededError if it fails to converge on a valid output within maxTurns.
      const isSchemaFailure = err instanceof ModelBehaviorError || err instanceof MaxTurnsExceededError;
      if (!isSchemaFailure) {
        const msg = err instanceof Error ? err.message : String(err);
        // Common API error when the configured model isn't available for the API key.
        if (msg.includes("does not exist") && msg.includes("do not have access")) {
          throw new Error(`${msg}\nHint: set MMS_MODEL in .env (currently "${CONFIGURED_MODEL}") and restart the server.`, { cause: err as Error });
        }
        throw err;
      }

      const agentName = agent?.name ?? step;
      runs.log(runId, `Schema validation failed for "${agentName}". Attempting repair...`, step);

      const badOutput = lastAssistantTextFromAgentsError(err);

      if (badOutput) {
        const repairPrompt =
          `Your previous response failed JSON/schema validation for the required output schema.\n` +
          `Repair it so it conforms exactly.\n\n` +
          `Rules:\n` +
          `- Return ONLY JSON (no markdown fences)\n` +
          `- Do not add extra top-level keys\n` +
          `- Prefer minimal edits to preserve meaning\n\n` +
          `PREVIOUS OUTPUT:\n` +
          badOutput;

        try {
          const repaired = await repairRunner.run(agent as never, repairPrompt, { maxTurns: 4, signal });
          if (!repaired.finalOutput) throw new Error(`${step} produced no final output (repair)`);
          runs.log(runId, `Schema repair succeeded for "${agentName}".`, step);
          return repaired.finalOutput as T;
        } catch (repairErr) {
          const msg = repairErr instanceof Error ? repairErr.message : String(repairErr);
          runs.log(runId, `Schema repair failed (${msg}). Retrying once from scratch...`, step);
        }
      } else {
        runs.log(runId, `Schema validation failed, but raw output could not be extracted. Retrying once from scratch...`, step);
      }

      // Final fallback: one full retry with deterministic settings.
      const retried = await deterministicRunner.run(agent as never, prompt, { maxTurns: opts.maxTurns, signal });
      if (!retried.finalOutput) throw new Error(`${step} produced no final output (retry)`);
      runs.log(runId, `Schema retry succeeded for "${agentName}".`, step);
      return retried.finalOutput as T;
    }
  }

  runs.log(runId, `Pipeline start (startFrom=${startFrom})`);
  runs.log(runId, `Using model: ${CONFIGURED_MODEL}`);
  runs.log(runId, `Constraint adherence mode: ${adherenceMode}`);

  const canonicalProfile = await loadCanonicalProfile();
  await runs.setCanonicalSources(runId, { ...canonicalProfile.paths, foundAny: canonicalProfile.foundAny });
  if (canonicalProfile.foundAny) {
    runs.log(
      runId,
      `Canonical profile loaded: character=${canonicalProfile.paths.characterBiblePath ?? "n/a"}, series=${canonicalProfile.paths.seriesStyleBiblePath ?? "n/a"}, deck=${canonicalProfile.paths.deckSpecPath ?? "n/a"}`
    );
  } else {
    runs.log(runId, "Canonical profile files not found; proceeding with KB-only context.");
  }

  await withTrace(`MaladyMysteryStudio:${runId}`, async (trace) => {
    await runs.setTraceId(runId, trace.traceId);
    await writeJsonFile(artifactAbsPath(runId, "trace.json"), { traceId: trace.traceId });
    await runs.addArtifact(runId, "KB0", "trace.json");
    if (canonicalProfile.foundAny) {
      await writeTextArtifact("KB0", "canonical_profile.md", canonicalProfile.combined_markdown);
      await writeJsonArtifact("KB0", "canonical_profile_sources.json", canonicalProfile.paths);
    }

    const kbAgent = makeKbCompilerAgent(vectorStoreId);

    let kb0: KbCompilerOutput;
    if (shouldRun("KB0")) {
      kb0 = await runStep<KbCompilerOutput>("KB0", async () => {
        const prompt =
          `TOPIC:\n${topic}\n\n` +
          `CANONICAL PROFILE (markdown; must be treated as binding constraints when present):\n${canonicalProfile.combined_markdown}\n\n` +
          `Compile KB context as markdown with these exact H2 headings:\n` +
          `- ## Medical / Clinical KB\n` +
          `- ## Characters & Story Constraints\n` +
          `- ## Visual Style / Shot Constraints\n\n` +
          `Use file_search to retrieve relevant KB for all three categories.`;
        return await runAgentOutput<KbCompilerOutput>("KB0", kbAgent, prompt, { maxTurns: 8 });
      });
      await writeTextArtifact("KB0", "kb_context.md", kb0.kb_context);
    } else {
      if (pOnlyRerun) {
        runs.log(runId, "Skipping KB0 artifact load for P-only rerun path.", "KB0");
        kb0 = {
          kb_context: [
            "## Medical / Clinical KB",
            "- Compatibility fallback (P-only rerun)",
            "",
            "## Characters & Story Constraints",
            "- Compatibility fallback (P-only rerun)",
            "",
            "## Visual Style / Shot Constraints",
            "- Compatibility fallback (P-only rerun)"
          ].join("\n")
        };
      } else {
        runs.log(runId, "Reusing KB0 artifacts", "KB0");
        kb0 = { kb_context: await loadText("kb_context.md") };
      }
    }

    const kbStorySection =
      extractH2Section(kb0.kb_context, "Characters & Story Constraints") ??
      extractH2Section(kb0.kb_context, "Characters and Story Constraints");
    const kbVisualSection =
      extractH2Section(kb0.kb_context, "Visual Style / Shot Constraints") ??
      extractH2Section(kb0.kb_context, "Visual Style / Shot Constraint");
    const storyConstraintContext = joinContexts(canonicalProfile.story_context_markdown, kbStorySection, kb0.kb_context);
    const visualConstraintContext = joinContexts(canonicalProfile.visual_context_markdown, kbVisualSection, kb0.kb_context);
    let semanticGuard: SemanticGuardInfo = null;

    let a: ProducerOutput;
    if (shouldRun("A")) {
      a = await runStep<ProducerOutput>("A", async () => {
        const prompt =
          `TOPIC:\n${topic}\n\n` +
          `RUN SETTINGS (json):\n${JSON.stringify(settings ?? {}, null, 2)}\n\n` +
          `CANONICAL STORY + STYLE PROFILE (markdown):\n${canonicalProfile.combined_markdown}\n\n` +
          `KB CONTEXT (markdown):\n${kb0.kb_context}`;
        return await runAgentOutput<ProducerOutput>("A", producerAgent, prompt, { maxTurns: 6 });
      });
      await writeJsonArtifact("A", "producer_brief.json", a);
    } else {
      if (pOnlyRerun) {
        runs.log(runId, "Skipping A artifact load for P-only rerun path.", "A");
        a = {
          producer_brief: {
            title: `Compatibility fallback producer brief: ${topic}`,
            learning_goal: `Legacy P-only rerun fallback for ${topic}.`,
            target_audience: settings?.level ?? "student",
            key_constraints: ["Compatibility fallback"],
            outline: ["Legacy rerun fallback"],
            tone: "neutral"
          }
        };
      } else {
        runs.log(runId, "Reusing A artifacts", "A");
        a = await loadJson<ProducerOutput>("producer_brief.json");
      }
    }

    let b: ResearcherOutput;
    if (shouldRun("B")) {
      b = await runStep<ResearcherOutput>("B", async () => {
        const prompt = `TOPIC:\n${topic}\n\nPRODUCER BRIEF (json):\n${JSON.stringify(a, null, 2)}\n\nKB CONTEXT (markdown):\n${kb0.kb_context}`;
        return await runAgentOutput<ResearcherOutput>("B", medicalResearcherAgent, prompt, { maxTurns: 10 });
      });
      await writeJsonArtifact("B", "facts_library_raw.json", b);
    } else {
      if (pOnlyRerun) {
        runs.log(runId, "Skipping B artifact load for P-only rerun path.", "B");
        b = {
          facts_library: {
            normal_physiology: [],
            pathophysiology: [],
            epidemiology_risk: [],
            clinical_presentation: [],
            diagnosis_workup: [],
            differential: [],
            treatment_acute: [],
            treatment_long_term: [],
            prognosis_complications: [],
            patient_counseling_prevention: []
          }
        };
      } else {
        runs.log(runId, "Reusing B artifacts", "B");
        b = await loadJson<ResearcherOutput>("facts_library_raw.json");
      }
    }

    let c: EditorOutput;
    if (shouldRun("C")) {
      c = await runStep<EditorOutput>("C", async () => {
        const prompt = `TOPIC:\n${topic}\n\nRAW FACTS LIBRARY (json):\n${JSON.stringify(b, null, 2)}`;
        return await runAgentOutput<EditorOutput>("C", medicalEditorAgent, prompt, { maxTurns: 8 });
      });
      await writeJsonArtifact("C", "facts_library_clean.json", { facts_library_clean: c.facts_library_clean });
      await writeJsonArtifact("C", "editor_notes.json", { editor_notes: c.editor_notes });
    } else {
      if (pOnlyRerun) {
        runs.log(runId, "Skipping C artifact load for P-only rerun path.", "C");
        c = {
          facts_library_clean: b.facts_library,
          editor_notes: {
            changes_made: ["Compatibility fallback"],
            red_flags: ["Legacy P-only rerun fallback"],
            completeness_checks: []
          }
        };
      } else {
        runs.log(runId, "Reusing C artifacts", "C");
        const facts = await loadJson<{ facts_library_clean: EditorOutput["facts_library_clean"] }>("facts_library_clean.json");
        const notes = await loadJson<{ editor_notes: EditorOutput["editor_notes"] }>("editor_notes.json");
        c = { facts_library_clean: facts.facts_library_clean, editor_notes: notes.editor_notes };
      }
    }

    let d: CurriculumOutput;
    if (shouldRun("D")) {
      d = await runStep<CurriculumOutput>("D", async () => {
        const prompt = `TOPIC:\n${topic}\n\nCLEAN FACTS LIBRARY (json):\n${JSON.stringify({ facts_library_clean: c.facts_library_clean }, null, 2)}`;
        return await runAgentOutput<CurriculumOutput>("D", curriculumArchitectAgent, prompt, { maxTurns: 8 });
      });
      await writeJsonArtifact("D", "medical_atoms.json", { medical_atoms: d.medical_atoms });
      await writeJsonArtifact("D", "teaching_blueprint.json", { teaching_blueprint: d.teaching_blueprint });
    } else {
      if (pOnlyRerun) {
        runs.log(runId, "Skipping D artifact load for P-only rerun path.", "D");
        d = {
          medical_atoms: [],
          teaching_blueprint: {
            sequence: [],
            misconceptions_to_address: [],
            end_state: "Compatibility fallback"
          }
        };
      } else {
        runs.log(runId, "Reusing D artifacts", "D");
        const atoms = await loadJson<{ medical_atoms: CurriculumOutput["medical_atoms"] }>("medical_atoms.json");
        const blueprint = await loadJson<{ teaching_blueprint: CurriculumOutput["teaching_blueprint"] }>("teaching_blueprint.json");
        d = { medical_atoms: atoms.medical_atoms, teaching_blueprint: blueprint.teaching_blueprint };
      }
    }

    let e: AssessmentOutput;
    if (shouldRun("E")) {
      e = await runStep<AssessmentOutput>("E", async () => {
        const prompt = `TOPIC:\n${topic}\n\nMEDICAL ATOMS (json):\n${JSON.stringify({ medical_atoms: d.medical_atoms }, null, 2)}\n\nTEACHING BLUEPRINT (json):\n${JSON.stringify({ teaching_blueprint: d.teaching_blueprint }, null, 2)}`;
        return await runAgentOutput<AssessmentOutput>("E", assessmentDesignerAgent, prompt, { maxTurns: 8 });
      });
      await writeJsonArtifact("E", "assessment_bank.json", e);
    } else {
      if (pOnlyRerun) {
        runs.log(runId, "Skipping E artifact load for P-only rerun path.", "E");
        e = { assessment_bank: [] };
      } else {
        runs.log(runId, "Reusing E artifacts", "E");
        e = await loadJson<AssessmentOutput>("assessment_bank.json");
      }
    }

    let f: SlideArchitectOutput;
    if (shouldRun("F")) {
      f = await runStep<SlideArchitectOutput>("F", async () => {
        const prompt = `TOPIC:\n${topic}\n\nPRODUCER BRIEF (json):\n${JSON.stringify(a, null, 2)}\n\nATOMS (json):\n${JSON.stringify({ medical_atoms: d.medical_atoms }, null, 2)}\n\nTEACHING BLUEPRINT (json):\n${JSON.stringify({ teaching_blueprint: d.teaching_blueprint }, null, 2)}`;
        return await runAgentOutput<SlideArchitectOutput>("F", slideArchitectAgent, prompt, { maxTurns: 10 });
      });
      await writeJsonArtifact("F", "slide_skeleton.json", { slide_skeleton: f.slide_skeleton });
      await writeJsonArtifact("F", "coverage.json", { coverage: f.coverage });
    } else {
      if (pOnlyRerun) {
        runs.log(runId, "Skipping F artifact load for P-only rerun path.", "F");
        f = { slide_skeleton: [], coverage: { atoms_covered: [], gaps: [] } };
      } else {
        runs.log(runId, "Reusing F artifacts", "F");
        const skeleton = await loadJson<{ slide_skeleton: SlideArchitectOutput["slide_skeleton"] }>("slide_skeleton.json");
        const coverage = await loadJson<{ coverage: SlideArchitectOutput["coverage"] }>("coverage.json");
        f = { slide_skeleton: skeleton.slide_skeleton, coverage: coverage.coverage };
      }
    }

    let medicalNarrativeFlow: MedicalNarrativeFlowOutput["medical_narrative_flow"];
    let g: StorySeedOutput;
    if (shouldRun("G")) {
      const variety = await selectVarietyPack(runId);
      g = await runStep<StorySeedOutput>("G", async () => {
        const narrativePrompt =
          `TOPIC:\n${topic}\n\n` +
          `CLEAN FACTS LIBRARY (json):\n${JSON.stringify({ facts_library_clean: c.facts_library_clean }, null, 2)}\n\n` +
          `TEACHING BLUEPRINT (json):\n${JSON.stringify({ teaching_blueprint: d.teaching_blueprint }, null, 2)}\n\n` +
          `CANONICAL STORY + STYLE PROFILE (markdown):\n${canonicalProfile.combined_markdown}`;
        const narrative = await runAgentOutput<MedicalNarrativeFlowOutput>("G", medicalNarrativeFlowAgent, narrativePrompt, {
          maxTurns: 8
        });
        medicalNarrativeFlow = narrative.medical_narrative_flow;
        await writeJsonArtifact("G", "medical_narrative_flow.json", narrative);

        const mem = await loadEpisodeMemory();
        const recentVariety = mem.recent
          .filter((r) => r.runId !== runId)
          .slice(0, 10)
          .map((r) => r.variety);
        const recentStoryFingerprints = mem.recent
          .filter((r) => r.runId !== runId)
          .map((r) => r.story_fingerprint)
          .filter((v): v is string => Boolean(v && v.trim().length > 0))
          .slice(0, 10);
        const priorFingerprintEntries = mem.recent
          .filter((r) => r.runId !== runId && typeof r.story_fingerprint === "string" && r.story_fingerprint.trim().length > 0)
          .slice(0, 10)
          .map((r) => ({ runId: r.runId, fingerprint: String(r.story_fingerprint).trim() }));

        const buildPrompt = (extraRules?: string): string =>
          `TOPIC:\n${topic}\n\n` +
          `KB STORY/CHARACTER CONTEXT (markdown):\n${storyConstraintContext}\n\n` +
          `KB VISUAL STYLE/CONSTRAINTS (markdown):\n${visualConstraintContext}\n\n` +
          `MEDICAL NARRATIVE FLOW (json):\n${JSON.stringify({ medical_narrative_flow: medicalNarrativeFlow }, null, 2)}\n\n` +
          `VARIETY PACK (json):\n${JSON.stringify(variety, null, 2)}\n\n` +
          `RECENT VARIETY (avoid repetition):\n${JSON.stringify(recentVariety, null, 2)}\n\n` +
          `RECENT STORY FINGERPRINTS (avoid repeating these patterns):\n${JSON.stringify(recentStoryFingerprints, null, 2)}\n\n` +
          `${extraRules ? `${extraRules}\n\n` : ""}` +
          `SLIDE SKELETON (json):\n${JSON.stringify({ slide_skeleton: f.slide_skeleton }, null, 2)}`;

        let retriedForSimilarity = false;
        let candidate = await runAgentOutput<StorySeedOutput>("G", storySeedAgent, buildPrompt(), { maxTurns: 8 });
        let candidateFingerprint = buildStoryFingerprint(
          candidate.story_seed.logline,
          candidate.story_seed.setting,
          candidate.story_seed.cast,
          candidate.story_seed.stakes
        );
        let closest = closestFingerprint(candidateFingerprint, priorFingerprintEntries);

        if (closest && closest.score >= SEMANTIC_REPEAT_THRESHOLD) {
          retriedForSimilarity = true;
          runs.log(
            runId,
            `Semantic repetition guard triggered in G (closest=${closest.runId}, score=${closest.score.toFixed(3)}). Retrying with stronger novelty constraints...`,
            "G"
          );

          const retryPrompt = buildPrompt(
            `SEMANTIC REPETITION GUARD:\n` +
              `- Your prior seed appears too similar to a recent episode.\n` +
              `- Closest prior run: ${closest.runId}\n` +
              `- Closest prior fingerprint: ${closest.fingerprint}\n` +
              `- Produce a materially different logline, setting, stakes, and cast dynamics while still honoring canonical constraints.`
          );
          candidate = await runAgentOutput<StorySeedOutput>("G", storySeedAgent, retryPrompt, { maxTurns: 8 });
          candidateFingerprint = buildStoryFingerprint(
            candidate.story_seed.logline,
            candidate.story_seed.setting,
            candidate.story_seed.cast,
            candidate.story_seed.stakes
          );
          closest = closestFingerprint(candidateFingerprint, priorFingerprintEntries);
        }

        if (closest) {
          semanticGuard = {
            closest,
            threshold: SEMANTIC_REPEAT_THRESHOLD,
            retried: retriedForSimilarity
          };
          if (closest.score >= SEMANTIC_REPEAT_THRESHOLD) {
            runs.log(
              runId,
              `Semantic repetition remains elevated after guard (closest=${closest.runId}, score=${closest.score.toFixed(3)}).`,
              "G"
            );
          }
        }

        return candidate;
      });
      await writeJsonArtifact("G", "story_seed.json", g);
      const mem = await loadEpisodeMemory();
      const fingerprint = buildStoryFingerprint(g.story_seed.logline, g.story_seed.setting, g.story_seed.cast, g.story_seed.stakes).trim();
      const enriched = rememberStoryFingerprint(mem, runId, fingerprint, g.story_seed.cast, 30);
      await saveEpisodeMemory(enriched);
      await writeJsonArtifact("G", "episode_memory_snapshot.json", enriched);
    } else {
      if (pOnlyRerun) {
        runs.log(runId, "Skipping G artifact load for P-only rerun path.", "G");
        g = {
          story_seed: {
            logline: `Compatibility fallback seed for ${topic}`,
            setting: "Fallback setting",
            cast: ["Cyto", "Pip"],
            stakes: "Fallback compatibility stakes",
            medical_backbone_summary: "Fallback narrative summary",
            metaphor_map: [],
            action_moments: [],
            intrigue_twists: [],
            variety_pack: await selectVarietyPack(runId)
          }
        };
        medicalNarrativeFlow = {
          chapter_summary: "Fallback medical narrative flow for legacy P-only rerun.",
          progression: [
            {
              stage: "Fallback stage",
              medical_logic: "Compatibility fallback",
              key_teaching_points: ["Compatibility fallback"],
              story_implication: "Compatibility fallback"
            }
          ],
          section_coverage: [],
          metaphor_map: [],
          required_plot_events: []
        };
      } else {
        runs.log(runId, "Reusing G artifacts", "G");
        g = await loadJson<StorySeedOutput>("story_seed.json");
        const narrative = await loadJson<MedicalNarrativeFlowOutput>("medical_narrative_flow.json");
        medicalNarrativeFlow = narrative.medical_narrative_flow;
      }
    }

    let h: ShowrunnerOutput;
    if (shouldRun("H")) {
      h = await runStep<ShowrunnerOutput>("H", async () => {
        const prompt =
          `TOPIC:\n${topic}\n\n` +
          `KB STORY/CHARACTER CONTEXT (markdown):\n${storyConstraintContext}\n\n` +
          `KB VISUAL STYLE/CONSTRAINTS (markdown):\n${visualConstraintContext}\n\n` +
          `MEDICAL NARRATIVE FLOW (json):\n${JSON.stringify({ medical_narrative_flow: medicalNarrativeFlow }, null, 2)}\n\n` +
          `STORY SEED (json):\n${JSON.stringify(g, null, 2)}\n\n` +
          `SLIDE SKELETON (json):\n${JSON.stringify({ slide_skeleton: f.slide_skeleton }, null, 2)}`;
        return await runAgentOutput<ShowrunnerOutput>("H", showrunnerAgent, prompt, { maxTurns: 10 });
      });
      await writeJsonArtifact("H", "story_bible.json", { story_bible: h.story_bible });
      await writeJsonArtifact("H", "episode_arc.json", { episode_arc: h.episode_arc });
      await writeJsonArtifact("H", "beat_sheet.json", { beat_sheet: h.beat_sheet });
    } else {
      runs.log(runId, "Reusing H artifacts", "H");
      let bible: { story_bible: ShowrunnerOutput["story_bible"] };
      try {
        bible = await loadJson<{ story_bible: ShowrunnerOutput["story_bible"] }>("story_bible.json");
      } catch {
        if (!allowSparseLegacyReuse) throw new Error("Missing required artifact: story_bible.json");
        runs.log(runId, "story_bible.json missing; using compatibility fallback story_bible.", "H");
        bible = { story_bible: fallbackStoryBible() };
      }

      let beats: { beat_sheet: ShowrunnerOutput["beat_sheet"] };
      try {
        beats = await loadJson<{ beat_sheet: ShowrunnerOutput["beat_sheet"] }>("beat_sheet.json");
      } catch {
        if (!allowSparseLegacyReuse) throw new Error("Missing required artifact: beat_sheet.json");
        runs.log(runId, "beat_sheet.json missing; using compatibility fallback beat_sheet.", "H");
        beats = { beat_sheet: fallbackBeatSheet() };
      }

      let episodeArc: ShowrunnerOutput["episode_arc"] | null = null;
      try {
        const arc = await loadJson<{ episode_arc: ShowrunnerOutput["episode_arc"] }>("episode_arc.json");
        episodeArc = arc.episode_arc;
      } catch {
        const intro = beats.beat_sheet.slice(0, 3).map((b) => b.beat);
        const outro = beats.beat_sheet.slice(-2).map((b) => b.beat);
        const body = beats.beat_sheet.slice(3, -2).map((b) => b.beat).filter((v) => v.length > 0);
        episodeArc = {
          intro_beats: [intro[0] ?? "Intro setup", intro[1] ?? "Case received", intro[2] ?? "Shrink entry"],
          body_beats: body.length > 0 ? body : ["Body investigation"],
          outro_beats: [outro[0] ?? "Return to office", outro[1] ?? "Callback ending"],
          entry_to_body_beat: intro[2] ?? "Shrink entry",
          return_to_office_beat: outro[0] ?? "Return to office",
          callback_beat: outro[1] ?? "Callback ending"
        };
        runs.log(runId, "episode_arc.json missing; synthesized episode_arc from beat_sheet for compatibility.", "H");
      }
      h = { story_bible: bible.story_bible, episode_arc: episodeArc, beat_sheet: beats.beat_sheet };
    }

    let i: VisualDirectorOutput;
    if (shouldRun("I")) {
      i = await runStep<VisualDirectorOutput>("I", async () => {
        const prompt =
          `TOPIC:\n${topic}\n\n` +
          `KB VISUAL STYLE/CONSTRAINTS (markdown):\n${visualConstraintContext}\n\n` +
          `STORY BIBLE (json):\n${JSON.stringify({ story_bible: h.story_bible }, null, 2)}\n\n` +
          `SLIDE SKELETON (json):\n${JSON.stringify({ slide_skeleton: f.slide_skeleton }, null, 2)}`;
        return await runAgentOutput<VisualDirectorOutput>("I", visualDirectorAgent, prompt, { maxTurns: 8 });
      });
      await writeJsonArtifact("I", "shot_list.json", i);
    } else {
      runs.log(runId, "Reusing I artifacts", "I");
      try {
        i = await loadJson<VisualDirectorOutput>("shot_list.json");
      } catch {
        if (!allowSparseLegacyReuse) throw new Error("Missing required artifact: shot_list.json");
        runs.log(runId, "shot_list.json missing; using compatibility fallback shot_list.", "I");
        i = { shot_list: fallbackShotList() };
      }
    }

    const needsPacingForSlideWriter = startIdx <= idx("L");
    const needsMapperForSlideWriter = startIdx <= idx("L");
    const needsSlideSpecForPatchStage = startIdx <= idx("N");

    let j: PacingEditorOutput | null = null;
    if (shouldRun("J")) {
      j = await runStep<PacingEditorOutput>("J", async () => {
        const prompt = `TOPIC:\n${topic}\n\nBEAT SHEET (json):\n${JSON.stringify({ beat_sheet: h.beat_sheet }, null, 2)}\n\nSLIDE SKELETON (json):\n${JSON.stringify({ slide_skeleton: f.slide_skeleton }, null, 2)}`;
        return await runAgentOutput<PacingEditorOutput>("J", pacingEditorAgent, prompt, { maxTurns: 8 });
      });
      await writeJsonArtifact("J", "pacing_map.json", j);
    } else if (needsPacingForSlideWriter) {
      runs.log(runId, "Reusing J artifacts", "J");
      j = await loadJson<PacingEditorOutput>("pacing_map.json");
    } else {
      runs.log(runId, "Skipping J artifact load (not needed for this rerun path).", "J");
    }

    let k: MapperOutput | null = null;
    if (shouldRun("K")) {
      k = await runStep<MapperOutput>("K", async () => {
        const prompt = `TOPIC:\n${topic}\n\nSLIDE SKELETON (json):\n${JSON.stringify({ slide_skeleton: f.slide_skeleton }, null, 2)}\n\nMEDICAL ATOMS (json):\n${JSON.stringify({ medical_atoms: d.medical_atoms }, null, 2)}\n\nASSESSMENT BANK (json):\n${JSON.stringify(e, null, 2)}`;
        return await runAgentOutput<MapperOutput>("K", mapperAgent, prompt, { maxTurns: 8 });
      });
      await writeJsonArtifact("K", "alignment_plan.json", k);
    } else if (needsMapperForSlideWriter) {
      runs.log(runId, "Reusing K artifacts", "K");
      k = await loadJson<MapperOutput>("alignment_plan.json");
    } else {
      runs.log(runId, "Skipping K artifact load (not needed for this rerun path).", "K");
    }

    let l: SlideWriterOutput | null = null;
    if (shouldRun("L")) {
      if (!j) throw new Error("Missing pacing map context needed for Slide Writer (J)");
      if (!k) throw new Error("Missing alignment plan context needed for Slide Writer (K)");
      l = await runStep<SlideWriterOutput>("L", async () => {
        const prompt =
          `TOPIC:\n${topic}\n\n` +
          `KB STORY/CHARACTER CONTEXT (markdown):\n${storyConstraintContext}\n\n` +
          `KB VISUAL STYLE/CONSTRAINTS (markdown):\n${visualConstraintContext}\n\n` +
          `PRODUCER BRIEF (json):\n${JSON.stringify(a, null, 2)}\n\n` +
          `CLEAN FACTS (json):\n${JSON.stringify({ facts_library_clean: c.facts_library_clean }, null, 2)}\n\n` +
          `MEDICAL NARRATIVE FLOW (json):\n${JSON.stringify({ medical_narrative_flow: medicalNarrativeFlow }, null, 2)}\n\n` +
          `SLIDE SKELETON (json):\n${JSON.stringify({ slide_skeleton: f.slide_skeleton }, null, 2)}\n\n` +
          `ALIGNMENT PLAN (json):\n${JSON.stringify(k, null, 2)}\n\n` +
          `STORY BIBLE (json):\n${JSON.stringify({ story_bible: h.story_bible }, null, 2)}\n\n` +
          `SHOT LIST (json):\n${JSON.stringify(i, null, 2)}\n\n` +
          `PACING MAP (json):\n${JSON.stringify(j, null, 2)}`;
        return await runAgentOutput<SlideWriterOutput>("L", slideWriterAgent, prompt, { maxTurns: 14 });
      });
      await writeJsonArtifact("L", "final_slide_spec.json", l);
    } else if (needsSlideSpecForPatchStage) {
      runs.log(runId, "Reusing L artifacts", "L");
      l = await loadJson<SlideWriterOutput>("final_slide_spec.json");
    } else {
      runs.log(runId, "Skipping L artifact load (not needed for this rerun path).", "L");
    }

    const idxM = STEP_ORDER.indexOf("M");
    const idxN = STEP_ORDER.indexOf("N");
    const idxO = STEP_ORDER.indexOf("O");
    const startFromIdx = startIdx;
    const runQaIter1 = startFromIdx <= idxM;
    const runPatchStage = startFromIdx <= idxN; // startFrom <= N; if startFrom > N, reuse patch artifacts.
    const runPackagingO = startFromIdx <= idxO; // startFrom <= O; if startFrom === P, reuse O artifacts.
    let medicalDepth: MedicalDepthReport | null = null;

    if (runPatchStage) {
      medicalDepth = evaluateMedicalDepth(c.facts_library_clean, {
        level,
        mode: adherenceMode,
        checkedAt: nowIso()
      });
      await writeJsonArtifact("M", "medical_depth_report.json", medicalDepth);
      if (medicalDepth.status !== "pass") {
        runs.log(
          runId,
          `Medical depth guard ${medicalDepth.status}: failures=${medicalDepth.failures.length}, warnings=${medicalDepth.warnings.length}.`,
          "M"
        );
      }
    }

    let qa1: QaOutput | null = null;
    if (runQaIter1) {
      qa1 = await runStep<QaOutput>("M", async () => {
        const prompt =
          `TOPIC:\n${topic}\n\n` +
          `PRODUCER BRIEF (json):\n${JSON.stringify(a, null, 2)}\n\n` +
          `CLEAN FACTS (json):\n${JSON.stringify({ facts_library_clean: c.facts_library_clean }, null, 2)}\n\n` +
          `MEDICAL DEPTH REPORT (json):\n${JSON.stringify(medicalDepth, null, 2)}\n\n` +
          `SLIDE SPEC (json):\n${JSON.stringify(l, null, 2)}`;
        return await runAgentOutput<QaOutput>("M", qaSuiteAgent, prompt, { maxTurns: 10 });
      });
      if (medicalDepth) qa1 = { qa_report: applyMedicalDepthGuardToQa(qa1.qa_report, medicalDepth) };
      await writeJsonArtifact("M", "qa_report_iter1.json", qa1);
    } else if (runPatchStage) {
      runs.log(runId, "Reusing QA iter1 artifacts", "M");
      qa1 = await loadJson<QaOutput>("qa_report_iter1.json");
    }

    let finalPatched: PatchOutput["final_slide_spec_patched"];
    let finalQa: QaOutput["qa_report"];

    if (runPatchStage) {
      if (!qa1) throw new Error("Missing QA iter1 report (qa_report_iter1.json) needed for patch stage");
      if (!l) throw new Error("Missing slide spec context (final_slide_spec.json) needed for patch stage");

      finalPatched = l.final_slide_spec;
      finalQa = qa1.qa_report;

      if (!qa1.qa_report.pass) {
        const patch1 = await runStep<PatchOutput>("N", async () => {
          const prompt = `TOPIC:\n${topic}\n\nSLIDE SPEC (json):\n${JSON.stringify(l, null, 2)}\n\nPATCH LIST (json):\n${JSON.stringify(qa1.qa_report.patch_list, null, 2)}`;
          return await runAgentOutput<PatchOutput>("N", patchApplierAgent, prompt, { maxTurns: 10 });
        });
        await writeJsonArtifact("N", "final_slide_spec_patched_iter1.json", patch1);

        // Always run a second QA pass after applying patches.
        const qa2 = await runStep<QaOutput>("M", async () => {
          const prompt =
            `TOPIC:\n${topic}\n\n` +
            `PRODUCER BRIEF (json):\n${JSON.stringify(a, null, 2)}\n\n` +
            `CLEAN FACTS (json):\n${JSON.stringify({ facts_library_clean: c.facts_library_clean }, null, 2)}\n\n` +
            `MEDICAL DEPTH REPORT (json):\n${JSON.stringify(medicalDepth, null, 2)}\n\n` +
            `PATCHED SLIDE SPEC (json):\n${JSON.stringify(patch1, null, 2)}`;
          return await runAgentOutput<QaOutput>("M", qaSuiteAgent, prompt, {
            maxTurns: 10,
            noFinalOutputMessage: "M produced no final output (iter2)"
          });
        });
        const qa2Guarded = medicalDepth ? { qa_report: applyMedicalDepthGuardToQa(qa2.qa_report, medicalDepth) } : qa2;
        await writeJsonArtifact("M", "qa_report_iter2.json", qa2Guarded);

        finalPatched = patch1.final_slide_spec_patched;
        finalQa = qa2Guarded.qa_report;
      } else {
        // Mark N as skipped.
        await runs.startStep(runId, "N");
        runs.log(runId, "Patch step skipped (QA pass)", "N");
        await runs.finishStep(runId, "N", true);
      }

      // Final always produces these.
      await writeJsonArtifact("N", "final_slide_spec_patched.json", { final_slide_spec_patched: finalPatched });
      await writeJsonArtifact("N", "reusable_visual_primer.json", {
        reusable_visual_primer: finalPatched.reusable_visual_primer
      });
      await writeJsonArtifact("M", "qa_report.json", { qa_report: finalQa });
    } else {
      // startFrom >= O: reuse final patched outputs
      runs.log(runId, "Reusing final patched slide spec + QA report", "N");
      const patchedWrap = await loadJson<{ final_slide_spec_patched: PatchOutput["final_slide_spec_patched"] }>(
        "final_slide_spec_patched.json"
      );
      finalPatched = patchedWrap.final_slide_spec_patched;
      await writeJsonArtifact("N", "reusable_visual_primer.json", {
        reusable_visual_primer: finalPatched.reusable_visual_primer
      });
      let qaWrap: { qa_report: QaOutput["qa_report"] };
      try {
        qaWrap = await loadJson<{ qa_report: QaOutput["qa_report"] }>("qa_report.json");
      } catch {
        if (!allowSparseLegacyReuse) throw new Error("Missing required artifact: qa_report.json");
        runs.log(runId, "qa_report.json missing; using compatibility fallback QA report.", "M");
        qaWrap = { qa_report: { pass: true, patch_list: [], notes: ["compatibility fallback qa_report.json"] } };
      }
      finalQa = qaWrap.qa_report;
    }

    let gensparkAssetBibleMd = "";
    let gensparkSlideGuideMd = "";
    let gensparkBuildScriptTxt = "";

    if (runPackagingO) {
      await runStep<GensparkOutput>("O", async () => {
        const prompt = `TOPIC:\n${topic}\n\nFINAL PATCHED SLIDE SPEC (json):\n${JSON.stringify({ final_slide_spec_patched: finalPatched }, null, 2)}`;
        const o = await runAgentOutput<GensparkOutput>("O", gensparkPackagerAgent, prompt, { maxTurns: 10 });

        gensparkAssetBibleMd = o.genspark_asset_bible_md;
        gensparkSlideGuideMd = o.genspark_slide_guide_md;
        gensparkBuildScriptTxt = o.genspark_build_script_txt;

        await writeTextArtifact("O", "GENSPARK_ASSET_BIBLE.md", o.genspark_asset_bible_md);
        await writeTextArtifact("O", "GENSPARK_SLIDE_GUIDE.md", o.genspark_slide_guide_md);
        await writeTextArtifact("O", "GENSPARK_BUILD_SCRIPT.txt", o.genspark_build_script_txt);
        const traceability = buildMedicalStoryTraceabilityReport({
          createdAt: nowIso(),
          narrativeFlow: medicalNarrativeFlow,
          finalPatched
        });
        await writeJsonArtifact("O", "medical_story_traceability_report.json", traceability);

        const adherenceReport = evaluateConstraintAdherence({
          canonical: canonicalProfile,
          storyBible: h.story_bible,
          beatSheet: h.beat_sheet,
          shotList: i.shot_list,
          finalPatched,
          semanticSimilarity: semanticGuard,
          checkedAt: nowIso()
        });
        await writeJsonArtifact("O", "constraint_adherence_report.json", adherenceReport);
        await runs.setConstraintAdherence(runId, summarizeConstraintAdherence(adherenceReport));

        if (adherenceReport.status === "warn") {
          runs.log(runId, `Constraint adherence warning: ${adherenceReport.warnings.join(" | ")}`, "O");
        }
        if (adherenceReport.status === "fail") {
          if (adherenceMode === "strict") {
            throw new Error(`Constraint adherence failed: ${adherenceReport.failures.join(" | ")}`);
          }
          runs.log(runId, `Constraint adherence fail treated as non-blocking (warn mode): ${adherenceReport.failures.join(" | ")}`, "O");
        }

        return o;
      });
    } else {
      runs.log(runId, "Reusing O artifacts for master-doc assembly", "O");
      const loadPackagingText = async (name: string, fallback: string): Promise<string> => {
        try {
          return await loadText(name);
        } catch {
          if (!allowSparseLegacyReuse) throw new Error(`Missing required artifact: ${name}`);
          runs.log(runId, `${name} missing; using compatibility fallback packaging text.`, "O");
          return fallback;
        }
      };

      gensparkAssetBibleMd = await loadPackagingText(
        "GENSPARK_ASSET_BIBLE.md",
        "# Genspark Asset Bible\n- Unavailable in legacy run; compatibility fallback generated."
      );
      gensparkSlideGuideMd = await loadPackagingText(
        "GENSPARK_SLIDE_GUIDE.md",
        "# Genspark Slide Guide\n- Unavailable in legacy run; compatibility fallback generated."
      );
      gensparkBuildScriptTxt = await loadPackagingText(
        "GENSPARK_BUILD_SCRIPT.txt",
        "1) Compatibility fallback: upstream build script not present in legacy run."
      );
    }

    await runStep<GensparkMasterDocOutput>("P", async () => {
      const baseDoc = buildGensparkMasterDoc({
        topic,
        finalPatched,
        reusableVisualPrimer: finalPatched.reusable_visual_primer,
        storyBible: h.story_bible,
        beatSheet: h.beat_sheet,
        shotList: i.shot_list,
        gensparkAssetBibleMd,
        gensparkSlideGuideMd,
        gensparkBuildScriptTxt
      });
      await writeTextArtifact("P", "GENSPARK_MASTER_RENDER_PLAN_BASE.md", baseDoc);

      const baseValidation = validateGensparkMasterDoc(baseDoc, finalPatched.slides);
      if (!baseValidation.ok) {
        throw new Error(`Deterministic master doc validation failed: ${baseValidation.errors.join(" | ")}`);
      }

      let finalMasterDoc = baseDoc;
      let masterDocValidation: { status: "pass" | "warn" | "fail"; errors: string[] } = { status: "pass", errors: [] };

      try {
        const polishPrompt =
          `You must polish this markdown while preserving strict structure.\n` +
          `Do not reorder/remove headings or slide blocks.\n\n` +
          `MARKDOWN:\n${baseDoc}`;
        const polished = await runAgentOutput<GensparkMasterDocOutput>("P", gensparkMasterPolisherAgent, polishPrompt, {
          maxTurns: 6,
          noFinalOutputMessage: "P produced no final output"
        });
        const polishedValidation = validateGensparkMasterDoc(polished.genspark_master_render_plan_md, finalPatched.slides);
        if (polishedValidation.ok) {
          finalMasterDoc = polished.genspark_master_render_plan_md;
        } else {
          masterDocValidation = { status: "warn", errors: polishedValidation.errors };
          runs.log(runId, `Master doc polish rejected; using deterministic base. ${polishedValidation.errors.join(" | ")}`, "P");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        masterDocValidation = { status: "warn", errors: [msg] };
        runs.log(runId, `Master doc polish failed; using deterministic base. ${msg}`, "P");
      }

      await writeTextArtifact("P", "GENSPARK_MASTER_RENDER_PLAN.md", finalMasterDoc);

      const adherenceReport = evaluateConstraintAdherence({
        canonical: canonicalProfile,
        storyBible: h.story_bible,
        beatSheet: h.beat_sheet,
        shotList: i.shot_list,
        finalPatched,
        semanticSimilarity: semanticGuard,
        masterDocValidation,
        checkedAt: nowIso()
      });
      await writeJsonArtifact("P", "constraint_adherence_report.json", adherenceReport);
      await runs.setConstraintAdherence(runId, summarizeConstraintAdherence(adherenceReport));

      if (adherenceReport.status === "warn") {
        runs.log(runId, `Constraint adherence warning: ${adherenceReport.warnings.join(" | ")}`, "P");
      }
      if (adherenceReport.status === "fail") {
        if (adherenceMode === "strict") {
          throw new Error(`Constraint adherence failed: ${adherenceReport.failures.join(" | ")}`);
        }
        runs.log(runId, `Constraint adherence fail treated as non-blocking (warn mode): ${adherenceReport.failures.join(" | ")}`, "P");
      }

      return { genspark_master_render_plan_md: finalMasterDoc };
    });
  });
}
