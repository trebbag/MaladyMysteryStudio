import fs from "node:fs/promises";
import path from "node:path";
import { setDefaultOpenAIKey, withTrace } from "@openai/agents";
import { PipelinePause } from "../../executor.js";
import type { RunManager, RunSettings, StepName } from "../../run_manager.js";
import { loadCanonicalProfile } from "../canon.js";
import { makeKbCompilerAgent } from "../agents.js";
import { nowIso, resolveArtifactPathAbs, runFinalDirAbs, runIntermediateDirAbs, writeJsonFile, writeTextFile } from "../utils.js";
import { loadV2Assets } from "./assets.js";
import { createStructuredRunners, runStructuredAgentOutput } from "./agent_runner.js";
import { runV2AgentInChild, type V2AgentKey } from "./agent_child_runner.js";
import {
  makeV2ClueArchitectAgent,
  makeV2DifferentialCastAgent,
  makeV2DiseaseResearchAgent,
  makeV2EpisodePitchAgent,
  makeV2MedFactcheckAgent,
  makeV2PlotDirectorDeckSpecAgent,
  makeV2ReaderSimAgent,
  makeV2TruthModelAgent
} from "./agents.js";
import { buildCitationTraceabilityReport } from "./citation_traceability.js";
import { generateV2DeckSpec } from "./generator.js";
import { lintDeckSpecPhase1 } from "./lints.js";
import { applyTargetedQaPatches, buildCombinedQaReport } from "./phase3_quality.js";
import {
  generateDiseaseDossier as generateDiseaseDossierFallback,
  generateEpisodePitch as generateEpisodePitchFallback,
  generateMedFactcheckReport,
  generateTruthModel as generateTruthModelFallback
} from "./phase2_generator.js";
import { generateClueGraph, generateDifferentialCast, generateReaderSimReport } from "./phase3_generator.js";
import {
  buildAppendixRenderPlanMd,
  buildMainDeckRenderPlanMd,
  buildSpeakerNotesWithCitationsMd,
  buildTemplateRegistry,
  generateDramaPlan,
  generateMicroWorldMap,
  generateSetpiecePlan
} from "./phase4_generator.js";
import { normalizeDossierCitationIds, polishDeckSpecForFallback } from "./quality_polish.js";
import { gateRequirementArtifactName, latestGateDecision, readHumanReviewStore } from "./reviews.js";
import {
  ClueGraphSchema,
  DeckSpecSchema,
  DifferentialCastSchema,
  DramaPlanSchema,
  DiseaseDossierSchema,
  EpisodePitchSchema,
  MedFactcheckReportSchema,
  MicroWorldMapSchema,
  ReaderSimReportSchema,
  SetpiecePlanSchema,
  TruthModelSchema,
  V2DeckSpecLintReportSchema,
  V2GateRequirementSchema,
  V2QaReportSchema,
  V2TemplateRegistrySchema,
  V2StoryboardGateSchema,
  type HumanReviewEntry,
  type MedFactcheckReport,
  type ReaderSimReport,
  type V2GateId
} from "./schemas.js";

type RunInput = {
  runId: string;
  topic: string;
  settings?: RunSettings;
};

type PipelineOptions = {
  signal: AbortSignal;
  startFrom?: StepName;
};

const V2_STEPS: StepName[] = ["KB0", "A", "B", "C"];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) throw new Error(`Missing required env var: ${name}`);
  return value.trim();
}

function isV2Step(value: StepName): boolean {
  return V2_STEPS.includes(value);
}

function gateResumeStep(gateId: V2GateId): StepName {
  if (gateId === "GATE_1_PITCH") return "B";
  if (gateId === "GATE_2_TRUTH_LOCK") return "C";
  return "C";
}

function maxQaPatchLoops(): number {
  const raw = Number(process.env.MMS_V2_QA_MAX_LOOPS ?? 2);
  if (!Number.isFinite(raw)) return 2;
  return Math.max(0, Math.min(5, Math.round(raw)));
}

function stepCAgentTimeoutMs(): number {
  const raw = Number(process.env.MMS_V2_STEP_C_AGENT_TIMEOUT_MS ?? 180_000);
  if (!Number.isFinite(raw)) return 180_000;
  // Step C includes the heaviest generation work (DeckSpec + QA agents). Enforce a sane floor
  // even if local env overrides were set aggressively for earlier debugging sessions.
  return Math.max(150_000, Math.min(900_000, Math.round(raw)));
}

function stepCDeckSpecTimeoutMs(): number {
  const raw = Number(process.env.MMS_V2_STEP_C_DECKSPEC_TIMEOUT_MS ?? 300_000);
  if (!Number.isFinite(raw)) return 300_000;
  // DeckSpec generation is the largest single structured output in v2.
  return Math.max(180_000, Math.min(1_200_000, Math.round(raw)));
}

function stepCHardWatchdogMs(): number {
  const raw = Number(process.env.MMS_V2_STEP_C_WATCHDOG_MS ?? 900_000);
  if (!Number.isFinite(raw)) return 900_000;
  return Math.max(1_000, Math.min(3_600_000, Math.round(raw)));
}

function stepCDeckRefineTimeoutMs(): number {
  const raw = Number(process.env.MMS_V2_STEP_C_DECKREFINE_TIMEOUT_MS ?? 180_000);
  if (!Number.isFinite(raw)) return 180_000;
  return Math.max(90_000, Math.min(600_000, Math.round(raw)));
}

function kb0TimeoutMs(): number {
  const raw = Number(process.env.MMS_V2_KB0_TIMEOUT_MS ?? 120_000);
  if (!Number.isFinite(raw)) return 120_000;
  return Math.max(60_000, Math.min(600_000, Math.round(raw)));
}

function stepABAgentTimeoutMs(): number {
  const raw = Number(process.env.MMS_V2_STEP_AB_AGENT_TIMEOUT_MS ?? 120_000);
  if (!Number.isFinite(raw)) return 120_000;
  return Math.max(90_000, Math.min(600_000, Math.round(raw)));
}

function deckSpecGenerationMode(adherenceMode: "strict" | "warn"): "agent_full" | "deterministic_refine" {
  const raw = process.env.MMS_V2_DECKSPEC_MODE?.trim().toLowerCase();
  if (raw === "agent_full") return "agent_full";
  if (raw === "deterministic_refine") return "deterministic_refine";
  // Default strategy: in warn mode, start from deterministic deck and apply lightweight refinement
  // to avoid long full-deck generations that frequently abort in pilot.
  return adherenceMode === "warn" ? "deterministic_refine" : "agent_full";
}

function useChildAgentIsolation(): boolean {
  const raw = process.env.MMS_V2_AGENT_ISOLATION_MODE?.trim().toLowerCase();
  if (raw === "off" || raw === "false" || raw === "inprocess") return false;
  return true;
}

function withAgentTimeout(signal: AbortSignal, timeoutMs: number): AbortSignal {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return signal;
  if (typeof AbortSignal.any === "function" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
  }
  return signal;
}

function mergeAbortSignals(signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === "function") return AbortSignal.any(signals);
  const ctrl = new AbortController();
  for (const sig of signals) {
    if (sig.aborted) {
      ctrl.abort(sig.reason);
      return ctrl.signal;
    }
  }
  const onAbort = (ev: Event) => {
    const source = ev.target as AbortSignal | null;
    ctrl.abort(source?.reason);
    for (const sig of signals) sig.removeEventListener("abort", onAbort);
  };
  for (const sig of signals) sig.addEventListener("abort", onAbort, { once: true });
  return ctrl.signal;
}

async function withHardTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return await promise;
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isLikelyTimeoutError(message: string): boolean {
  return /(timed out|timeout|Request was aborted|Child timeout)/i.test(message);
}

function isAbortLikeMessage(message: string): boolean {
  // Treat only explicit local cancellation/watchdog signals as hard aborts.
  // Upstream "Request was aborted" transport failures are handled by warn-mode fallbacks.
  return /(cancelled|watchdog)/i.test(message);
}

function abortErrorFromSignal(signal: AbortSignal, fallback = "Cancelled"): Error {
  const reason = signal.reason;
  if (reason instanceof Error) return reason;
  if (typeof reason === "string" && reason.trim().length > 0) return new Error(reason);
  return new Error(fallback);
}

function deckNeedsSemanticPolish(input: ReturnType<typeof DeckSpecSchema.parse>): boolean {
  const text = JSON.stringify(input);
  if (/"major_concept_id":"NONE"/.test(text)) return true;
  if (/"citation_id":"CIT-00\d"/.test(text)) return true;
  if (/"dx_id":"DX-\d/.test(text)) return true;
  if (/— S\d{2,3}"/.test(text)) return true;
  return false;
}

function readerScoreMean(report: ReaderSimReport): number {
  return (
    Number(report.overall_story_dominance_score_0_to_5 || 0) +
    Number(report.overall_twist_quality_score_0_to_5 || 0) +
    Number(report.overall_clarity_score_0_to_5 || 0)
  ) / 3;
}

function shouldPreferDeterministicReader(agent: ReaderSimReport, deterministic: ReaderSimReport): boolean {
  const agentMean = readerScoreMean(agent);
  const deterministicMean = readerScoreMean(deterministic);
  const mustFixes = agent.required_fixes.filter((fix) => fix.priority === "must").length;
  return deterministicMean >= agentMean + 0.7 || (agentMean < 2.6 && mustFixes >= 2);
}

function shouldPreferDeterministicFactcheck(agent: MedFactcheckReport, deterministic: MedFactcheckReport): boolean {
  return !agent.pass && deterministic.pass;
}

function clampText(value: string, maxChars: number): string {
  const trimmed = String(value || "").trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function compactGateFeedback(value: string): string {
  const normalized = String(value || "").trim();
  if (normalized.length <= 900) return normalized;
  return clampText(normalized, 900);
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  return {};
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function fallbackKbContext(topic: string, canonicalMarkdown: string): string {
  return [
    "## Medical / Clinical KB",
    `Fallback KB context for topic: ${topic}`,
    "Use disease dossier + truth model as primary ground truth when file-search results are unavailable.",
    "",
    "## Characters & Story Constraints",
    "Preserve recurring character canon and tone continuity across acts.",
    "",
    "## Visual Style / Shot Constraints",
    "Prioritize cinematic readability, consistent character rendering, and clear evidence visuals.",
    "",
    "## Canonical Profile (fallback excerpt)",
    canonicalMarkdown.slice(0, 6000)
  ].join("\n");
}

function gateFeedbackForPrompt(entry: HumanReviewEntry | null): string {
  if (!entry) return "No prior human gate feedback.";
  const requested = entry.requested_changes
    .map((change, idx) => `${idx + 1}. path=${change.path}; severity=${change.severity}; instruction=${change.instruction}`)
    .join("\n");
  return [
    `Latest gate decision: ${entry.status}`,
    `Submitted at: ${entry.submitted_at}`,
    `Notes: ${entry.notes || "(none)"}`,
    `Requested changes:`,
    requested || "- (none)"
  ].join("\n");
}

const V2_PHASE4_FINAL_ARTIFACTS = {
  mainDeckRenderPlan: "V2_MAIN_DECK_RENDER_PLAN.md",
  appendixRenderPlan: "V2_APPENDIX_RENDER_PLAN.md",
  speakerNotesBundle: "V2_SPEAKER_NOTES_WITH_CITATIONS.md",
  templateRegistry: "v2_template_registry.json"
} as const;

async function readJsonArtifact<T>(runId: string, name: string): Promise<T> {
  const resolved = await resolveArtifactPathAbs(runId, name);
  if (!resolved) throw new Error(`Missing required artifact: ${name}`);
  const raw = await fs.readFile(resolved, "utf8");
  return JSON.parse(raw) as T;
}

async function ensureArtifactExists(runId: string, name: string): Promise<void> {
  const resolved = await resolveArtifactPathAbs(runId, name);
  if (!resolved) throw new Error(`Missing required artifact: ${name}`);
}

export async function runMicroDetectivesPipeline(input: RunInput, runs: RunManager, options: PipelineOptions): Promise<void> {
  const { runId, topic, settings } = input;
  const { signal } = options;
  const adherenceMode = settings?.adherenceMode ?? "strict";
  const startFrom = options.startFrom ?? "KB0";

  if (!isV2Step(startFrom)) {
    throw new Error(`Invalid startFrom for v2: ${startFrom}. Supported: ${V2_STEPS.join(", ")}`);
  }

  const shouldRun = (step: StepName): boolean => V2_STEPS.indexOf(step) >= V2_STEPS.indexOf(startFrom);
  const expectedDeckLength = settings?.deckLengthMain ?? 45;
  const audienceLevel = settings?.audienceLevel ?? "MED_SCHOOL_ADVANCED";

  const openaiKey = requireEnv("OPENAI_API_KEY");
  const vectorStoreId = requireEnv("KB_VECTOR_STORE_ID");
  setDefaultOpenAIKey(openaiKey);

  const canonicalProfile = await loadCanonicalProfile();
  await runs.setCanonicalSources(runId, { ...canonicalProfile.paths, foundAny: canonicalProfile.foundAny });

  const runnerBundle = createStructuredRunners();
  const childIsolation = useChildAgentIsolation();
  type AgentCallDuration = {
    step: StepName;
    agentKey: V2AgentKey;
    startedAt: string;
    finishedAt: string;
    elapsedMs: number;
    timeoutMs: number;
    mode: "child" | "in_process";
    status: "ok" | "error";
    error?: string;
  };
  const agentDurations: AgentCallDuration[] = [];

  async function writeIntermediateJson(step: StepName, name: string, obj: unknown): Promise<void> {
    await writeJsonFile(path.join(runIntermediateDirAbs(runId), name), obj);
    await runs.addArtifact(runId, step, name);
  }

  async function writeIntermediateText(step: StepName, name: string, text: string): Promise<void> {
    await writeTextFile(path.join(runIntermediateDirAbs(runId), name), text);
    await runs.addArtifact(runId, step, name);
  }

  async function writeFinalJson(step: StepName, name: string, obj: unknown): Promise<void> {
    await writeJsonFile(path.join(runFinalDirAbs(runId), name), obj);
    await runs.addArtifact(runId, step, name);
  }

  async function writeFinalText(step: StepName, name: string, text: string): Promise<void> {
    await writeTextFile(path.join(runFinalDirAbs(runId), name), text);
    await runs.addArtifact(runId, step, name);
  }

  async function persistAgentDurations(step: StepName): Promise<void> {
    const base = {
      schema_version: "1.0.0",
      workflow: "v2_micro_detectives",
      run_id: runId,
      updated_at: nowIso()
    };
    await writeIntermediateJson(step, "agent_call_durations.json", {
      ...base,
      calls: agentDurations
    });
    await writeIntermediateJson(step, `agent_call_durations_${step}.json`, {
      ...base,
      calls: agentDurations.filter((row) => row.step === step)
    });
  }

  async function runPhase4Packaging(step: StepName): Promise<void> {
    const deckSpec = DeckSpecSchema.parse(await readJsonArtifact(runId, "deck_spec.json"));
    const diseaseDossier = DiseaseDossierSchema.parse(await readJsonArtifact(runId, "disease_dossier.json"));
    const truthModel = TruthModelSchema.parse(await readJsonArtifact(runId, "truth_model.json"));
    const differentialCast = DifferentialCastSchema.parse(await readJsonArtifact(runId, "differential_cast.json"));
    const clueGraph = ClueGraphSchema.parse(await readJsonArtifact(runId, "clue_graph.json"));

    const microWorldMap = MicroWorldMapSchema.parse(generateMicroWorldMap(deckSpec, diseaseDossier, truthModel));
    const dramaPlan = DramaPlanSchema.parse(generateDramaPlan(deckSpec, truthModel));
    const setpiecePlan = SetpiecePlanSchema.parse(generateSetpiecePlan(deckSpec, microWorldMap, diseaseDossier));
    const templateRegistry = V2TemplateRegistrySchema.parse(buildTemplateRegistry(deckSpec));

    const mainDeckRenderPlanMd = buildMainDeckRenderPlanMd({
      deck: deckSpec,
      truthModel,
      clueGraph,
      differentialCast,
      microWorldMap,
      setpiecePlan
    });
    const appendixRenderPlanMd = buildAppendixRenderPlanMd(deckSpec);
    const speakerNotesBundleMd = buildSpeakerNotesWithCitationsMd(deckSpec);

    await writeIntermediateJson(step, "micro_world_map.json", microWorldMap);
    await writeIntermediateJson(step, "drama_plan.json", dramaPlan);
    await writeIntermediateJson(step, "setpiece_plan.json", setpiecePlan);
    await writeIntermediateJson(step, V2_PHASE4_FINAL_ARTIFACTS.templateRegistry, templateRegistry);
    await writeIntermediateJson(step, "v2_phase4_packaging_manifest.json", {
      schema_version: "1.0.0",
      generated_at: nowIso(),
      final_artifacts: [
        "deck_spec.json",
        V2_PHASE4_FINAL_ARTIFACTS.mainDeckRenderPlan,
        V2_PHASE4_FINAL_ARTIFACTS.appendixRenderPlan,
        V2_PHASE4_FINAL_ARTIFACTS.speakerNotesBundle,
        V2_PHASE4_FINAL_ARTIFACTS.templateRegistry
      ]
    });

    await writeFinalJson(step, "deck_spec.json", deckSpec);
    await writeFinalJson(step, V2_PHASE4_FINAL_ARTIFACTS.templateRegistry, templateRegistry);
    await writeFinalText(step, V2_PHASE4_FINAL_ARTIFACTS.mainDeckRenderPlan, mainDeckRenderPlanMd);
    await writeFinalText(step, V2_PHASE4_FINAL_ARTIFACTS.appendixRenderPlan, appendixRenderPlanMd);
    await writeFinalText(step, V2_PHASE4_FINAL_ARTIFACTS.speakerNotesBundle, speakerNotesBundleMd);

    runs.log(runId, "Phase 4 packaging artifacts written.", step);
  }

  async function runIsolatedAgentOutput<T>(args: {
    step: StepName;
    agentKey: V2AgentKey;
    agent: unknown;
    prompt: string;
    maxTurns: number;
    timeoutMs: number;
    signal?: AbortSignal;
    vectorStoreId?: string;
  }): Promise<T> {
    const activeSignal = args.signal ?? signal;
    if (activeSignal.aborted) throw abortErrorFromSignal(activeSignal);

    const started = Date.now();
    const startedAt = nowIso();
    const mode: "child" | "in_process" = childIsolation ? "child" : "in_process";
    try {
      const output = childIsolation
        ? ((await runV2AgentInChild({
            runId,
            step: args.step,
            agentKey: args.agentKey,
            prompt: args.prompt,
            maxTurns: args.maxTurns,
            timeoutMs: args.timeoutMs,
            signal: activeSignal,
            vectorStoreId: args.vectorStoreId
          })) as T)
        : ((await withHardTimeout(
            runStructuredAgentOutput<T>({
              runId,
              runs,
              step: args.step,
              runnerBundle,
              agent: args.agent as never,
              prompt: args.prompt,
              signal: withAgentTimeout(activeSignal, args.timeoutMs),
              maxTurns: args.maxTurns
            }),
            args.timeoutMs,
            `${args.step}:${args.agentKey}`
          )) as T);

      agentDurations.push({
        step: args.step,
        agentKey: args.agentKey,
        startedAt,
        finishedAt: nowIso(),
        elapsedMs: Math.max(0, Date.now() - started),
        timeoutMs: args.timeoutMs,
        mode,
        status: "ok"
      });
      await persistAgentDurations(args.step);
      return output;
    } catch (err) {
      const effectiveErr =
        activeSignal.aborted && !isAbortLikeMessage(err instanceof Error ? err.message : String(err)) ? abortErrorFromSignal(activeSignal) : err;
      const msg = effectiveErr instanceof Error ? effectiveErr.message : String(effectiveErr);
      agentDurations.push({
        step: args.step,
        agentKey: args.agentKey,
        startedAt,
        finishedAt: nowIso(),
        elapsedMs: Math.max(0, Date.now() - started),
        timeoutMs: args.timeoutMs,
        mode,
        status: "error",
        error: msg
      });
      await persistAgentDurations(args.step);
      throw effectiveErr;
    }
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

  function shouldAbortOnError(err: unknown, scopedSignal?: AbortSignal): boolean {
    if (signal.aborted) return true;
    if (scopedSignal?.aborted) return true;
    const msg = err instanceof Error ? err.message : String(err);
    return isAbortLikeMessage(msg);
  }

  async function requireGateApproval(step: StepName, gateId: V2GateId, message: string, nextAction: string): Promise<HumanReviewEntry | null> {
    const gateRequirement = V2GateRequirementSchema.parse({
      gate_id: gateId,
      workflow: "v2_micro_detectives",
      status: "review_required",
      message,
      next_action: nextAction
    });
    await writeIntermediateJson(step, gateRequirementArtifactName(gateId), gateRequirement);
    const reviewStore = await readHumanReviewStore(runId);
    const latest = latestGateDecision(reviewStore, gateId);
    if (latest?.status === "approve") {
      runs.log(runId, `${gateId} approved`, step);
      return latest;
    }
    throw new PipelinePause(gateId, gateResumeStep(gateId), message);
  }

  runs.log(runId, `V2 micro-detectives pipeline start (startFrom=${startFrom})`);

  await withTrace(`MicroDetectivesV2:${runId}`, async (trace) => {
    await runs.setTraceId(runId, trace.traceId);
    await writeFinalJson("KB0", "trace.json", { traceId: trace.traceId, workflow: "v2_micro_detectives", phase: "phase2-3" });

    const assets = await loadV2Assets();
    const kbAgent = makeKbCompilerAgent(vectorStoreId);
    const diseaseResearchAgent = makeV2DiseaseResearchAgent(assets);
    const episodePitchAgent = makeV2EpisodePitchAgent(assets);
    const truthModelAgent = makeV2TruthModelAgent(assets);
    const differentialCastAgent = makeV2DifferentialCastAgent(assets);
    const clueArchitectAgent = makeV2ClueArchitectAgent(assets);
    const plotDirectorDeckSpecAgent = makeV2PlotDirectorDeckSpecAgent(assets);
    const readerSimAgent = makeV2ReaderSimAgent(assets);
    const medFactcheckAgent = makeV2MedFactcheckAgent(assets);

    let kbContext = "";
    if (shouldRun("KB0")) {
      kbContext = await runStep<string>("KB0", async () => {
        const prompt =
          `TOPIC:\n${topic}\n\n` +
          `CANONICAL PROFILE (markdown):\n${canonicalProfile.combined_markdown}\n\n` +
          `Compile KB context for v2 disease dossier + truth lock + deck spec + QA generation.`;
        try {
          const timeoutMs = kb0TimeoutMs();
          const out = await runIsolatedAgentOutput<{ kb_context: string }>({
            step: "KB0",
            agentKey: "kbCompiler",
            agent: kbAgent as never,
            prompt,
            maxTurns: 8,
            timeoutMs,
            vectorStoreId
          });
          if (!out?.kb_context || out.kb_context.trim().length === 0) {
            throw new Error("KB0 output missing kb_context");
          }
          return out.kb_context;
        } catch (err) {
          if (shouldAbortOnError(err)) throw err;
          if (adherenceMode === "strict") throw err;
          const msg = err instanceof Error ? err.message : String(err);
          runs.log(runId, `KB0 fallback activated (${msg}).`, "KB0");
          return fallbackKbContext(topic, canonicalProfile.combined_markdown);
        }
      });
      await writeIntermediateText("KB0", "kb_context.md", kbContext);
      if (canonicalProfile.foundAny) {
        await writeIntermediateText("KB0", "canonical_profile.md", canonicalProfile.combined_markdown);
        await writeIntermediateJson("KB0", "canonical_profile_sources.json", canonicalProfile.paths);
      }
    } else {
      const reused = await resolveArtifactPathAbs(runId, "kb_context.md");
      if (!reused) throw new Error("Missing required artifact: kb_context.md");
      kbContext = await fs.readFile(reused, "utf8").catch(() => "");
      runs.log(runId, "Reusing KB0 artifacts", "KB0");
    }

    const fallbackBase = { topic, deckLengthMain: expectedDeckLength, audienceLevel, kbContext } as const;
    const abTimeoutMs = stepABAgentTimeoutMs();

    let diseaseDossier = shouldRun("A")
      ? await runStep("A", async () => {
          const diseasePrompt =
            `CASE REQUEST (json):\n${JSON.stringify(
              {
                disease_topic: topic,
                target_level: audienceLevel,
                deck_length_main: expectedDeckLength
              },
              null,
              2
            )}\n\n` +
            `KB CONTEXT (markdown):\n${kbContext}\n\n` +
            `CANONICAL PROFILE (markdown):\n${canonicalProfile.combined_markdown}`;
          let dossier: ReturnType<typeof DiseaseDossierSchema.parse>;
          try {
            dossier = DiseaseDossierSchema.parse(
              await runIsolatedAgentOutput({
                step: "A",
                agentKey: "diseaseResearch",
                agent: diseaseResearchAgent,
                prompt: diseasePrompt,
                maxTurns: 12,
                timeoutMs: abTimeoutMs
              })
            );
          } catch (err) {
            if (shouldAbortOnError(err)) throw err;
            if (adherenceMode === "strict") throw err;
            const msg = err instanceof Error ? err.message : String(err);
            runs.log(runId, `DiseaseResearch agent fallback activated (${msg}).`, "A");
            dossier = DiseaseDossierSchema.parse(generateDiseaseDossierFallback(fallbackBase));
          }
          dossier = normalizeDossierCitationIds(dossier, topic);

          const pitchPrompt =
            `TOPIC:\n${topic}\n\n` +
            `TARGET SETTINGS (json):\n${JSON.stringify({ deckLengthMain: expectedDeckLength, audienceLevel }, null, 2)}\n\n` +
            `DISEASE DOSSIER (json):\n${JSON.stringify(dossier, null, 2)}\n\n` +
            `KB CONTEXT (markdown):\n${kbContext}`;
          let pitch: ReturnType<typeof EpisodePitchSchema.parse>;
          try {
            pitch = EpisodePitchSchema.parse(
              await runIsolatedAgentOutput({
                step: "A",
                agentKey: "episodePitch",
                agent: episodePitchAgent,
                prompt: pitchPrompt,
                maxTurns: 8,
                timeoutMs: abTimeoutMs
              })
            );
          } catch (err) {
            if (shouldAbortOnError(err)) throw err;
            if (adherenceMode === "strict") throw err;
            const msg = err instanceof Error ? err.message : String(err);
            runs.log(runId, `EpisodePitch agent fallback activated (${msg}).`, "A");
            pitch = EpisodePitchSchema.parse(generateEpisodePitchFallback(fallbackBase, dossier));
          }

          await writeIntermediateJson("A", "disease_dossier.json", dossier);
          await writeIntermediateJson("A", "episode_pitch.json", pitch);
          await writeIntermediateJson("A", "v2_assets_manifest.json", {
            root: assets.root,
            sourceRoot: assets.sourceRoot,
            usingSourceOverlay: assets.usingSourceOverlay,
            schemaFiles: Object.keys(assets.schemaFiles),
            promptFiles: Object.keys(assets.promptFiles),
            promptMarkers: assets.manifest.promptMarkers
          });
          return dossier;
        })
      : DiseaseDossierSchema.parse(await readJsonArtifact(runId, "disease_dossier.json"));
    diseaseDossier = normalizeDossierCitationIds(DiseaseDossierSchema.parse(diseaseDossier), topic);
    if (!shouldRun("A")) runs.log(runId, "Reusing A artifacts", "A");

    if (startFrom !== "C") {
      await requireGateApproval(
        "A",
        "GATE_1_PITCH",
        "Gate 1: review episode_pitch.json before truth lock generation.",
        "Submit /api/runs/:runId/gates/GATE_1_PITCH/submit with status=approve, then call /api/runs/:runId/resume."
      );
    }

    const episodePitch = EpisodePitchSchema.parse(await readJsonArtifact(runId, "episode_pitch.json"));

    const gate1Review = latestGateDecision(await readHumanReviewStore(runId), "GATE_1_PITCH");
    const gate1Feedback = gateFeedbackForPrompt(gate1Review);

    const truthModel = shouldRun("B")
      ? TruthModelSchema.parse(
          await runStep("B", async () => {
            const truthPrompt =
              `TOPIC:\n${topic}\n\n` +
              `TARGET SETTINGS (json):\n${JSON.stringify({ deckLengthMain: expectedDeckLength, audienceLevel }, null, 2)}\n\n` +
              `DISEASE DOSSIER (json):\n${JSON.stringify(diseaseDossier, null, 2)}\n\n` +
              `EPISODE PITCH (json):\n${JSON.stringify(episodePitch, null, 2)}\n\n` +
              `GATE 1 FEEDBACK:\n${gate1Feedback}\n\n` +
              `KB CONTEXT (markdown):\n${kbContext}`;
            let truth: ReturnType<typeof TruthModelSchema.parse>;
            try {
              truth = TruthModelSchema.parse(
                await runIsolatedAgentOutput({
                  step: "B",
                  agentKey: "truthModel",
                  agent: truthModelAgent,
                  prompt: truthPrompt,
                  maxTurns: 10,
                  timeoutMs: abTimeoutMs
                })
              );
            } catch (err) {
              if (shouldAbortOnError(err)) throw err;
              if (adherenceMode === "strict") throw err;
              const msg = err instanceof Error ? err.message : String(err);
              runs.log(runId, `TruthModel agent fallback activated (${msg}).`, "B");
              truth = TruthModelSchema.parse(generateTruthModelFallback(fallbackBase, diseaseDossier, episodePitch));
            }
            await writeIntermediateJson("B", "truth_model.json", truth);
            return truth;
          })
        )
      : TruthModelSchema.parse(await readJsonArtifact(runId, "truth_model.json"));
    if (!shouldRun("B")) runs.log(runId, "Reusing B artifacts", "B");

    await requireGateApproval(
      "B",
      "GATE_2_TRUTH_LOCK",
      "Gate 2: review truth_model.json before deck specification.",
      "Submit /api/runs/:runId/gates/GATE_2_TRUTH_LOCK/submit with status=approve, then call /api/runs/:runId/resume."
    );

    const gate3Latest = latestGateDecision(await readHumanReviewStore(runId), "GATE_3_STORYBOARD");
    const gate3Approved = gate3Latest?.status === "approve";

    if (shouldRun("C") && !gate3Approved) {
      await runStep("C", async () => {
        const cWatchdogMs = stepCHardWatchdogMs();
        const cWatchdogController = new AbortController();
        const cSignal = mergeAbortSignals([signal, cWatchdogController.signal]);
        const cWatchdogTimer = setTimeout(() => {
          cWatchdogController.abort(new Error(`V2 step C watchdog timed out after ${cWatchdogMs}ms`));
        }, cWatchdogMs);

        if (cSignal.aborted) throw abortErrorFromSignal(cSignal, "Cancelled");
        try {
          const gate2Review = latestGateDecision(await readHumanReviewStore(runId), "GATE_2_TRUTH_LOCK");
          const gate2Feedback = compactGateFeedback(gateFeedbackForPrompt(gate2Review));
          const cTimeoutMs = stepCAgentTimeoutMs();
          const deckSpecTimeoutMs = stepCDeckSpecTimeoutMs();
          const fallbackEvents: Array<{
            mode: "agent_retry" | "deterministic_fallback" | "deterministic_arbitration";
            stage: string;
            reason: string;
          }> = [];
          const recordFallback = (
            mode: "agent_retry" | "deterministic_fallback" | "deterministic_arbitration",
            stage: string,
            reason: string
          ): void => {
            fallbackEvents.push({
              mode,
              stage,
              reason: clampText(reason, 240)
            });
          };
          const fallbackSeedDeck = DeckSpecSchema.parse(
            generateV2DeckSpec({
              topic,
              deckLengthMain: expectedDeckLength,
              audienceLevel
            })
          );
          const planningDeckMeta = {
            schema_version: "1.0.0",
            episode_slug: topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
            episode_title: `${topic} — Micro-Detectives Case`,
            deck_length_main: String(expectedDeckLength),
            audience_level: audienceLevel,
            tone: episodePitch.tone,
            story_dominance_target_ratio: 0.75,
            max_words_on_slide: 24,
            one_major_med_concept_per_slide: true,
            appendix_unlimited: true
          };

        const differentialPrompt =
          `TOPIC:\n${topic}\n\n` +
          `DECK META (json):\n${JSON.stringify(planningDeckMeta, null, 2)}\n\n` +
          `DISEASE DOSSIER (json):\n${JSON.stringify(diseaseDossier, null, 2)}\n\n` +
          `TRUTH MODEL (json):\n${JSON.stringify(truthModel, null, 2)}\n\n` +
          `GATE 2 FEEDBACK:\n${gate2Feedback}`;

        let workingDifferential: ReturnType<typeof DifferentialCastSchema.parse>;
        try {
          workingDifferential = DifferentialCastSchema.parse(
            await runIsolatedAgentOutput({
              step: "C",
              agentKey: "differentialCast",
              agent: differentialCastAgent,
              prompt: differentialPrompt,
              maxTurns: 8,
              timeoutMs: cTimeoutMs,
              signal: cSignal
            })
          );
        } catch (err) {
          if (shouldAbortOnError(err, cSignal)) throw err;
          if (adherenceMode === "strict") throw err;
          const msg = err instanceof Error ? err.message : String(err);
          runs.log(runId, `DifferentialCast agent fallback activated (${msg}).`, "C");
          recordFallback("deterministic_fallback", "differentialCast", msg);
          workingDifferential = DifferentialCastSchema.parse(generateDifferentialCast(fallbackSeedDeck, diseaseDossier, truthModel));
        }
        await writeIntermediateJson("C", "differential_cast.json", workingDifferential);

        const cluePrompt =
          `TOPIC:\n${topic}\n\n` +
          `DISEASE DOSSIER (json):\n${JSON.stringify(diseaseDossier, null, 2)}\n\n` +
          `TRUTH MODEL (json):\n${JSON.stringify(truthModel, null, 2)}\n\n` +
          `DIFFERENTIAL CAST (json):\n${JSON.stringify(workingDifferential, null, 2)}\n\n` +
          `DECK META (json):\n${JSON.stringify(planningDeckMeta, null, 2)}`;
        let workingClueGraph: ReturnType<typeof ClueGraphSchema.parse>;
        try {
          workingClueGraph = ClueGraphSchema.parse(
            await runIsolatedAgentOutput({
              step: "C",
              agentKey: "clueArchitect",
              agent: clueArchitectAgent,
              prompt: cluePrompt,
              maxTurns: 8,
              timeoutMs: cTimeoutMs,
              signal: cSignal
            })
          );
        } catch (err) {
          if (shouldAbortOnError(err, cSignal)) throw err;
          if (adherenceMode === "strict") throw err;
          const msg = err instanceof Error ? err.message : String(err);
          runs.log(runId, `ClueGraph agent fallback activated (${msg}).`, "C");
          recordFallback("deterministic_fallback", "clueArchitect", msg);
          workingClueGraph = ClueGraphSchema.parse(generateClueGraph(fallbackSeedDeck, diseaseDossier, workingDifferential));
        }
        await writeIntermediateJson("C", "clue_graph.json", workingClueGraph);

        const microWorldMap = MicroWorldMapSchema.parse(generateMicroWorldMap(fallbackSeedDeck, diseaseDossier, truthModel));
        const dramaPlan = DramaPlanSchema.parse(generateDramaPlan(fallbackSeedDeck, truthModel));
        const setPiecePlan = SetpiecePlanSchema.parse(generateSetpiecePlan(fallbackSeedDeck, microWorldMap, diseaseDossier));
        const caseRequest = {
          disease_topic: topic,
          deck_length_main: expectedDeckLength,
          audience_level: audienceLevel,
          story_dominance_target_ratio_min: 0.7,
          one_major_med_concept_per_slide: true
        };

        const truthSummary = {
          final_diagnosis: truthModel.final_diagnosis,
          cover_story: clampText(
            typeof truthModel.cover_story === "string" ? truthModel.cover_story : JSON.stringify(truthModel.cover_story),
            360
          ),
          twist_blueprint: truthModel.twist_blueprint,
          key_history: truthModel.patient_profile.key_history.slice(0, 8).map((item) => clampText(item, 180))
        };

        const dossierDigestPrimary = {
          canonical_name: diseaseDossier.canonical_name,
          sections: (diseaseDossier.sections ?? []).slice(0, 8).map((section) => ({
            section: section.section,
            key_points: (section.key_points ?? []).slice(0, 2).map((point) => clampText(point, 220)),
            citation_ids: (section.citations ?? []).slice(0, 2).map((citation) => citation.citation_id)
          })),
          high_value_citations: (diseaseDossier.citations ?? []).slice(0, 10).map((citation) => ({
            citation_id: citation.citation_id,
            claim: clampText(citation.claim, 180),
            locator: clampText(String(citation.locator ?? ""), 120)
          })),
          learning_objectives: (diseaseDossier.learning_objectives ?? []).slice(0, 10).map((objective) => clampText(objective, 160))
        };

        const microWorldObj = asObject(microWorldMap);
        const dramaObj = asObject(dramaPlan);
        const setpieceObj = asObject(setPiecePlan);
        const clueDigest = {
          exhibits: workingClueGraph.exhibits.slice(0, 6).map((exhibit) => ({
            exhibit_id: exhibit.exhibit_id,
            purpose: clampText(exhibit.purpose, 120)
          })),
          clues: workingClueGraph.clues.slice(0, 10).map((clue) => ({
            clue_id: clue.clue_id,
            observed: clampText(clue.observed, 120),
            wrong_inference: clampText(clue.wrong_inference, 120),
            correct_inference: clampText(clue.correct_inference, 120),
            first_seen_slide_id: clue.first_seen_slide_id,
            payoff_slide_id: clue.payoff_slide_id
          })),
          red_herrings: workingClueGraph.red_herrings.slice(0, 5).map((item) => ({
            rh_id: item.rh_id,
            rooted_truth: clampText(item.rooted_truth, 120),
            payoff_slide_id: item.payoff_slide_id
          })),
          twist_support_matrix: asArray(workingClueGraph.twist_support_matrix).slice(0, 10)
        };

        const differentialDigest = {
          suspects: workingDifferential.primary_suspects.slice(0, 5).map((suspect) => ({
            dx_id: suspect.dx_id,
            name: suspect.name,
            signature_fingerprint: suspect.signature_fingerprint.slice(0, 2).map((fingerprint) => clampText(fingerprint.statement, 120))
          })),
          rotation_plan: workingDifferential.rotation_plan
        };

        const microWorldDigest = {
          zones: asArray<Record<string, unknown>>(microWorldObj["zones"]).slice(0, 8).map((zone) => ({
            zone_id: String(zone["zone_id"] ?? ""),
            label: clampText(String(zone["label"] ?? ""), 90),
            story_function: clampText(String(zone["story_function"] ?? ""), 120)
          })),
          recurring_constraints: asArray<string>(microWorldObj["recurring_constraints"]).slice(0, 8).map((item) => clampText(item, 120)),
          style_tokens: asArray<string>(microWorldObj["style_tokens"]).slice(0, 8).map((item) => clampText(item, 90))
        };

        const dramaDigest = {
          acts: asArray<Record<string, unknown>>(dramaObj["acts"]).slice(0, 4).map((act) => ({
            act_id: String(act["act_id"] ?? ""),
            objective: clampText(String(act["objective"] ?? ""), 120),
            pressure: clampText(String(act["pressure"] ?? ""), 120)
          })),
          pacing_intent: clampText(String(dramaObj["pacing_intent"] ?? ""), 180)
        };

        const setpieceDigest = {
          setpieces: asArray<Record<string, unknown>>(setpieceObj["setpieces"]).slice(0, 6).map((setpiece) => ({
            id: String(setpiece["id"] ?? ""),
            zone_ref: String(setpiece["zone_ref"] ?? ""),
            action_core: clampText(String(setpiece["action_core"] ?? ""), 160)
          }))
        };

        const deckSpecPrimaryPrompt =
          `CASE REQUEST (json):\n${JSON.stringify(caseRequest, null, 2)}\n\n` +
          `TRUTH SUMMARY (json):\n${JSON.stringify(truthSummary, null, 2)}\n\n` +
          `DOSSIER DIGEST (json):\n${JSON.stringify(dossierDigestPrimary, null, 2)}\n\n` +
          `MICRO WORLD DIGEST (json):\n${JSON.stringify(microWorldDigest, null, 2)}\n\n` +
          `TOP DIFFERENTIAL SUSPECTS (json):\n${JSON.stringify(differentialDigest, null, 2)}\n\n` +
          `CLUE SUMMARY (json):\n${JSON.stringify(clueDigest, null, 2)}\n\n` +
          `DRAMA DIGEST (json):\n${JSON.stringify(dramaDigest, null, 2)}\n\n` +
          `SETPIECE DIGEST (json):\n${JSON.stringify(setpieceDigest, null, 2)}\n\n` +
          `GATE 2 FEEDBACK:\n${gate2Feedback}`;

        const deckSpecUltraCompactPrompt =
          `CASE REQUEST (json):\n${JSON.stringify(caseRequest, null, 2)}\n\n` +
          `TRUTH SUMMARY (json):\n${JSON.stringify(truthSummary, null, 2)}\n\n` +
          `TOP DIFFERENTIAL SUSPECTS (json):\n${JSON.stringify(differentialDigest, null, 2)}\n\n` +
          `CLUE SUMMARY (json):\n${JSON.stringify(clueDigest, null, 2)}\n\n` +
          `LEARNING OBJECTIVES (json):\n${JSON.stringify((diseaseDossier.learning_objectives ?? []).slice(0, 10), null, 2)}\n\n` +
          `GATE 2 FEEDBACK:\n${gate2Feedback}`;

        const deckSpecKernelPrompt =
          `CASE REQUEST (json):\n${JSON.stringify(caseRequest, null, 2)}\n\n` +
          `TRUTH SUMMARY (json):\n${JSON.stringify(
            {
              final_diagnosis: truthModel.final_diagnosis,
              twist_blueprint: truthModel.twist_blueprint
            },
            null,
            2
          )}\n\n` +
          `KEY CLUES (json):\n${JSON.stringify(clueDigest.clues.slice(0, 6), null, 2)}\n\n` +
          `TOP LEARNING OBJECTIVES (json):\n${JSON.stringify((diseaseDossier.learning_objectives ?? []).slice(0, 6), null, 2)}\n\n` +
          `GATE 2 FEEDBACK SUMMARY:\n${clampText(gate2Feedback, 400)}`;

        const deckSpecMode = deckSpecGenerationMode(adherenceMode);
        const deckRefineTimeoutMs = stepCDeckRefineTimeoutMs();
        let workingDeck: ReturnType<typeof DeckSpecSchema.parse> = fallbackSeedDeck;
        let deckUsedDeterministicFallback = false;

        if (deckSpecMode === "deterministic_refine") {
          runs.log(runId, "DeckSpec mode=deterministic_refine: seeded deterministic deck before lightweight model refinement.", "C");
          try {
            const refinedDeck = DeckSpecSchema.parse(
              await runIsolatedAgentOutput({
                step: "C",
                agentKey: "plotDirectorDeckSpec",
                agent: plotDirectorDeckSpecAgent,
                prompt: deckSpecKernelPrompt,
                maxTurns: 6,
                timeoutMs: Math.max(90_000, Math.min(deckRefineTimeoutMs, 220_000)),
                signal: cSignal
              })
            );
            workingDeck = refinedDeck;
            runs.log(runId, "DeckSpec lightweight refinement succeeded.", "C");
          } catch (refineErr) {
            if (shouldAbortOnError(refineErr, cSignal)) throw refineErr;
            const refineMsg = refineErr instanceof Error ? refineErr.message : String(refineErr);
            if (adherenceMode === "strict") throw refineErr;
            runs.log(runId, `DeckSpec lightweight refinement unavailable; using deterministic seed (${refineMsg}).`, "C");
            recordFallback("agent_retry", "plotDirectorDeckSpec.refinement", refineMsg);
          }
        } else {
          try {
            workingDeck = DeckSpecSchema.parse(
              await runIsolatedAgentOutput({
                step: "C",
                agentKey: "plotDirectorDeckSpec",
                agent: plotDirectorDeckSpecAgent,
                prompt: deckSpecPrimaryPrompt,
                maxTurns: 10,
                timeoutMs: deckSpecTimeoutMs,
                signal: cSignal
              })
            );
          } catch (err) {
            if (shouldAbortOnError(err, cSignal)) throw err;
            const msg = err instanceof Error ? err.message : String(err);
            runs.log(runId, `DeckSpec primary attempt failed; retrying compact prompts (${msg}).`, "C");
            recordFallback("agent_retry", "plotDirectorDeckSpec.primary", msg);
            let recovered = false;
            try {
              workingDeck = DeckSpecSchema.parse(
                await runIsolatedAgentOutput({
                  step: "C",
                  agentKey: "plotDirectorDeckSpec",
                  agent: plotDirectorDeckSpecAgent,
                  prompt: deckSpecUltraCompactPrompt,
                  maxTurns: 8,
                  timeoutMs: Math.max(150_000, Math.min(deckSpecTimeoutMs, 280_000)),
                  signal: cSignal
                })
              );
              recovered = true;
              runs.log(runId, "DeckSpec ultra-compact retry succeeded.", "C");
              recordFallback("agent_retry", "plotDirectorDeckSpec.ultra_compact", "succeeded");
            } catch (compactErr) {
              if (shouldAbortOnError(compactErr, cSignal)) throw compactErr;
              const compactMsg = compactErr instanceof Error ? compactErr.message : String(compactErr);
              runs.log(runId, `DeckSpec ultra-compact retry failed; trying kernel prompt (${compactMsg}).`, "C");
              recordFallback("agent_retry", "plotDirectorDeckSpec.ultra_compact", compactMsg);
              try {
                workingDeck = DeckSpecSchema.parse(
                  await runIsolatedAgentOutput({
                    step: "C",
                    agentKey: "plotDirectorDeckSpec",
                    agent: plotDirectorDeckSpecAgent,
                    prompt: deckSpecKernelPrompt,
                    maxTurns: 6,
                    timeoutMs: Math.max(120_000, Math.min(deckSpecTimeoutMs, 220_000)),
                    signal: cSignal
                  })
                );
                recovered = true;
                runs.log(runId, "DeckSpec kernel retry succeeded.", "C");
                recordFallback("agent_retry", "plotDirectorDeckSpec.kernel", "succeeded");
              } catch (kernelErr) {
                if (shouldAbortOnError(kernelErr, cSignal)) throw kernelErr;
                if (adherenceMode === "strict") throw kernelErr;
                const kernelMsg = kernelErr instanceof Error ? kernelErr.message : String(kernelErr);
                const timeoutHint = isLikelyTimeoutError(kernelMsg) || isLikelyTimeoutError(compactMsg) || isLikelyTimeoutError(msg);
                const reason = timeoutHint ? "timed_out_or_aborted_after_retries" : "schema_or_runtime_error_after_retries";
                runs.log(
                  runId,
                  `DeckSpec deterministic fallback activated (${reason}; primary=${msg}; compact=${compactMsg}; kernel=${kernelMsg}).`,
                  "C"
                );
                recordFallback("deterministic_fallback", "plotDirectorDeckSpec", `${reason}; kernel=${kernelMsg}`);
                workingDeck = fallbackSeedDeck;
                deckUsedDeterministicFallback = true;
              }
            }
            if (!recovered && adherenceMode === "strict") {
              throw err;
            }
          }
        }
        if (deckUsedDeterministicFallback || deckNeedsSemanticPolish(workingDeck)) {
          runs.log(runId, "DeckSpec triggered semantic polish guardrails.", "C");
          if (deckNeedsSemanticPolish(workingDeck)) {
            recordFallback("deterministic_arbitration", "deckSpecSemanticPolish", "placeholder_or_low-semantic signal detected");
          }
        }
        workingDeck = DeckSpecSchema.parse(
          polishDeckSpecForFallback({
            deckSpec: workingDeck,
            dossier: diseaseDossier,
            differentialCast: workingDifferential,
            clueGraph: workingClueGraph,
            truthModel,
            topic
          })
        );
        runs.log(runId, "Applied deterministic semantic polish to DeckSpec.", "C");
        await writeIntermediateJson("C", "deck_spec_seed.json", workingDeck);

        const maxPatchLoops = maxQaPatchLoops();
        const maxAttempts = maxPatchLoops + 1;
        let finalLintReport = V2DeckSpecLintReportSchema.parse(lintDeckSpecPhase1(workingDeck, expectedDeckLength));
        let finalReader!: ReturnType<typeof ReaderSimReportSchema.parse>;
        let finalFactcheck!: ReturnType<typeof MedFactcheckReportSchema.parse>;
        let finalQa!: ReturnType<typeof V2QaReportSchema.parse>;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          if (cSignal.aborted) throw abortErrorFromSignal(cSignal, "Cancelled");
          finalLintReport = V2DeckSpecLintReportSchema.parse(lintDeckSpecPhase1(workingDeck, expectedDeckLength));
          await writeIntermediateJson("C", `deck_spec_loop${attempt}.json`, workingDeck);
          await writeIntermediateJson("C", `deck_spec_lint_report_loop${attempt}.json`, finalLintReport);

          const readerPrompt =
            `DECK SPEC (json):\n${JSON.stringify(workingDeck, null, 2)}\n\n` +
            `TRUTH MODEL (json):\n${JSON.stringify(truthModel, null, 2)}\n\n` +
            `DIFFERENTIAL CAST (json):\n${JSON.stringify(workingDifferential, null, 2)}\n\n` +
            `CLUE GRAPH (json):\n${JSON.stringify(workingClueGraph, null, 2)}`;
          try {
            finalReader = ReaderSimReportSchema.parse(
              await runIsolatedAgentOutput({
                step: "C",
                agentKey: "readerSim",
                agent: readerSimAgent,
                prompt: readerPrompt,
                maxTurns: 8,
                timeoutMs: cTimeoutMs,
                signal: cSignal
              })
            );
          } catch (err) {
            if (shouldAbortOnError(err, cSignal)) throw err;
            if (adherenceMode === "strict") throw err;
            const msg = err instanceof Error ? err.message : String(err);
            runs.log(runId, `ReaderSim agent fallback activated (${msg}).`, "C");
            recordFallback("deterministic_fallback", "readerSim", msg);
            finalReader = ReaderSimReportSchema.parse(generateReaderSimReport(workingDeck, truthModel, workingClueGraph));
          }
          const deterministicReader = ReaderSimReportSchema.parse(generateReaderSimReport(workingDeck, truthModel, workingClueGraph));
          if (adherenceMode !== "strict" && shouldPreferDeterministicReader(finalReader, deterministicReader)) {
            runs.log(
              runId,
              `ReaderSim deterministic arbitration applied (agent_mean=${readerScoreMean(finalReader).toFixed(2)}, deterministic_mean=${readerScoreMean(deterministicReader).toFixed(2)}).`,
              "C"
            );
            recordFallback("deterministic_arbitration", "readerSim", "deterministic_reader_score_selected");
            finalReader = deterministicReader;
          }
          await writeIntermediateJson("C", `reader_sim_report_loop${attempt}.json`, finalReader);

          const medFactPrompt =
            `DECK SPEC (json):\n${JSON.stringify(workingDeck, null, 2)}\n\n` +
            `DISEASE DOSSIER (json):\n${JSON.stringify(diseaseDossier, null, 2)}\n\n` +
            `TRUTH MODEL (json):\n${JSON.stringify(truthModel, null, 2)}`;
          try {
            finalFactcheck = MedFactcheckReportSchema.parse(
              await runIsolatedAgentOutput({
                step: "C",
                agentKey: "medFactcheck",
                agent: medFactcheckAgent,
                prompt: medFactPrompt,
                maxTurns: 8,
                timeoutMs: cTimeoutMs,
                signal: cSignal
              })
            );
          } catch (err) {
            if (shouldAbortOnError(err, cSignal)) throw err;
            if (adherenceMode === "strict") throw err;
            const msg = err instanceof Error ? err.message : String(err);
            runs.log(runId, `MedFactcheck agent fallback activated (${msg}).`, "C");
            recordFallback("deterministic_fallback", "medFactcheck", msg);
            finalFactcheck = MedFactcheckReportSchema.parse(generateMedFactcheckReport(workingDeck, diseaseDossier));
          }
          const deterministicFactcheck = MedFactcheckReportSchema.parse(generateMedFactcheckReport(workingDeck, diseaseDossier));
          if (adherenceMode !== "strict" && shouldPreferDeterministicFactcheck(finalFactcheck, deterministicFactcheck)) {
            runs.log(
              runId,
              `MedFactcheck deterministic arbitration applied (agent_issues=${finalFactcheck.issues.length}, deterministic_issues=${deterministicFactcheck.issues.length}).`,
              "C"
            );
            recordFallback("deterministic_arbitration", "medFactcheck", "deterministic_factcheck_selected");
            finalFactcheck = deterministicFactcheck;
          }
          await writeIntermediateJson("C", `med_factcheck_report_loop${attempt}.json`, finalFactcheck);

          finalQa = V2QaReportSchema.parse(
            buildCombinedQaReport({
              lintReport: finalLintReport,
              readerSimReport: finalReader,
              medFactcheckReport: finalFactcheck,
              deckSpec: workingDeck
            })
          );
          await writeIntermediateJson("C", `qa_report_loop${attempt}.json`, finalQa);

          const strictFailed = !finalLintReport.pass || !finalFactcheck.pass || !finalQa.accept;
          if (!strictFailed) break;
          if (attempt >= maxAttempts) break;

          const patch = applyTargetedQaPatches({
            deckSpec: workingDeck,
            clueGraph: workingClueGraph,
            differentialCast: workingDifferential,
            qaReport: finalQa,
            loopIndex: attempt
          });
          workingDeck = DeckSpecSchema.parse(
            polishDeckSpecForFallback({
              deckSpec: patch.deck,
              dossier: diseaseDossier,
              differentialCast: patch.differentialCast,
              clueGraph: patch.clueGraph,
              truthModel,
              topic
            })
          );
          workingClueGraph = ClueGraphSchema.parse(patch.clueGraph);
          workingDifferential = DifferentialCastSchema.parse(patch.differentialCast);
          await writeIntermediateJson("C", `deck_spec_patched_loop${attempt}.json`, workingDeck);
          await writeIntermediateJson("C", `clue_graph_patched_loop${attempt}.json`, workingClueGraph);
          await writeIntermediateJson("C", `differential_cast_patched_loop${attempt}.json`, workingDifferential);
          await writeIntermediateJson("C", `qa_patch_notes_loop${attempt}.json`, {
            schema_version: "1.0.0",
            loop: attempt,
            patch_notes: patch.patchNotes,
            deck_changes: patch.deckChanges,
            clue_changes: patch.clueChanges,
            differential_changes: patch.differentialChanges
          });
          runs.log(
            runId,
            `QA loop ${attempt} requested fixes; applied targeted patches (deck=${patch.deckChanges}, clues=${patch.clueChanges}, differentials=${patch.differentialChanges}).`,
            "C"
          );
        }

        await writeIntermediateJson("C", "differential_cast.json", workingDifferential);
        await writeIntermediateJson("C", "clue_graph.json", workingClueGraph);
        await writeIntermediateJson("C", "deck_spec.json", workingDeck);
        await writeIntermediateJson("C", "deck_spec_lint_report.json", finalLintReport);
        await writeIntermediateJson("C", "reader_sim_report.json", finalReader);
        await writeIntermediateJson("C", "med_factcheck_report.json", finalFactcheck);
        await writeIntermediateJson("C", "qa_report.json", finalQa);

        const citationTraceability = buildCitationTraceabilityReport({
          dossier: diseaseDossier,
          artifacts: {
            disease_dossier: diseaseDossier,
            episode_pitch: episodePitch,
            truth_model: truthModel,
            deck_spec: workingDeck,
            differential_cast: workingDifferential,
            clue_graph: workingClueGraph,
            reader_sim_report: finalReader,
            med_factcheck_report: finalFactcheck,
            qa_report: finalQa
          }
        });
        await writeIntermediateJson("C", "citation_traceability.json", citationTraceability);
        const deterministicFallbackEventCount = fallbackEvents.filter((event) => event.mode === "deterministic_fallback").length;
        const agentRetryEventCount = fallbackEvents.filter((event) => event.mode === "agent_retry").length;
        const deterministicArbitrationEventCount = fallbackEvents.filter((event) => event.mode === "deterministic_arbitration").length;
        await writeIntermediateJson("C", "fallback_usage.json", {
          schema_version: "1.0.0",
          workflow: "v2_micro_detectives",
          step: "C",
          used: fallbackEvents.length > 0,
          deterministic_fallback_used: deterministicFallbackEventCount > 0,
          deterministic_fallback_event_count: deterministicFallbackEventCount,
          agent_retry_event_count: agentRetryEventCount,
          deterministic_arbitration_event_count: deterministicArbitrationEventCount,
          fallback_event_count: fallbackEvents.length,
          events: fallbackEvents
        });

        if ((!finalLintReport.pass || !finalFactcheck.pass || !finalQa.accept) && adherenceMode === "strict") {
          throw new Error(
            `V2 QA loop ended without acceptance (lint_pass=${String(finalLintReport.pass)}, med_pass=${String(finalFactcheck.pass)}, qa_accept=${String(finalQa.accept)}).`
          );
        }

        if ((!finalLintReport.pass || !finalFactcheck.pass || !finalQa.accept) && adherenceMode === "warn") {
          runs.log(
            runId,
            `Warn mode: continuing despite unresolved QA findings (lint_pass=${String(finalLintReport.pass)}, med_pass=${String(finalFactcheck.pass)}, qa_accept=${String(finalQa.accept)}).`,
            "C"
          );
        }

          const gate3 = V2StoryboardGateSchema.parse({
            gate_id: "GATE_3_STORYBOARD",
            workflow: "v2_micro_detectives",
            status: "review_required",
            message: "Phase 3 quality complete. Storyboard review marker written.",
            next_action: "Review deck_spec.json, qa_report.json, and citation_traceability.json before downstream render phases."
          });
          await writeIntermediateJson("C", "GATE_3_STORYBOARD_REQUIRED.json", gate3);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (/step C watchdog timed out/i.test(msg)) {
            await writeIntermediateJson("C", "step_c_watchdog_error.json", {
              schema_version: "1.0.0",
              step: "C",
              at: nowIso(),
              timeout_ms: cWatchdogMs,
              message: msg
            });
            runs.log(runId, `Step C watchdog hard-fail (${msg}).`, "C");
          }
          throw err;
        } finally {
          clearTimeout(cWatchdogTimer);
        }
      });
      await requireGateApproval(
        "C",
        "GATE_3_STORYBOARD",
        "Gate 3: review storyboard artifacts before final packaging.",
        "Submit /api/runs/:runId/gates/GATE_3_STORYBOARD/submit with status=approve, then call /api/runs/:runId/resume."
      );
    }

    if (shouldRun("C")) {
      await runStep("C", async () => {
        if (gate3Approved) {
          runs.log(runId, "Gate 3 approved. Running phase 4 packaging.", "C");
        } else {
          runs.log(runId, "Gate 3 approved inline. Running phase 4 packaging.", "C");
        }
        await runPhase4Packaging("C");
      });
    } else {
      runs.log(runId, "Reusing C artifacts", "C");
      await ensureArtifactExists(runId, "deck_spec.json");
      await ensureArtifactExists(runId, V2_PHASE4_FINAL_ARTIFACTS.mainDeckRenderPlan);
      await ensureArtifactExists(runId, V2_PHASE4_FINAL_ARTIFACTS.appendixRenderPlan);
      await ensureArtifactExists(runId, V2_PHASE4_FINAL_ARTIFACTS.speakerNotesBundle);
    }
  });

  runs.log(runId, "V2 micro-detectives phase 4 complete.");
}
