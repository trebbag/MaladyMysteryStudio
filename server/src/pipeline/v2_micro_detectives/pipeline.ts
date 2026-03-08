import fs from "node:fs/promises";
import path from "node:path";
import { setDefaultOpenAIKey, withTrace } from "@openai/agents";
import { z } from "zod";
import { PipelinePause } from "../../executor.js";
import type { RunManager, RunSettings, StepName } from "../../run_manager.js";
import { loadCanonicalProfile } from "../canon.js";
import { loadEpisodeMemory } from "../memory.js";
import { makeKbCompilerAgent } from "../agents.js";
import { nowIso, resolveArtifactPathAbs, runFinalDirAbs, runIntermediateDirAbs, writeJsonFile, writeTextFile } from "../utils.js";
import { parseChapterOutlineArtifact, StoryBeatsSchema } from "../workshop.js";
import { loadV2Assets } from "./assets.js";
import { createStructuredRunners, runStructuredAgentOutput } from "./agent_runner.js";
import { runV2AgentInChild, type V2AgentKey } from "./agent_child_runner.js";
import {
  makeV2ActOutlineAgent,
  makeV2ClueArchitectAgent,
  makeV2DeckCohesionPassAgent,
  makeV2DifferentialCastAgent,
  makeV2DiseaseResearchAgent,
  makeV2DramaPlanAgent,
  makeV2EpisodePitchAgent,
  makeV2MedFactcheckAgent,
  makeV2MicroWorldMapAgent,
  makeV2NarrativeIntensifierAgent,
  makeV2PlotDirectorDeckSpecAgent,
  makeV2ReaderSimAgent,
  makeV2SetpiecePlanAgent,
  makeV2SlideBlockAuthorAgent,
  makeV2StoryBlueprintAgent,
  makeV2TruthModelAgent
} from "./agents.js";
import {
  assembleDeckFromSlideBlocks,
  buildNarrativeStateForBlock,
  buildActOutlineFallback,
  buildBlockPromptContext,
  buildSlideBlockFallback,
  buildStoryBlueprintFallback,
  collectBlockAuthoredSlideIds,
  normalizeSlideBlockOperations,
  planSlideBlocksFromOutline
} from "./authoring_stages.js";
import { buildCitationTraceabilityReport } from "./citation_traceability.js";
import { generateV2DeckSpec } from "./generator.js";
import { lintDeckSpecPhase1 } from "./lints.js";
import {
  applyTargetedQaPatches,
  buildQaBlockHeatmap,
  buildCombinedQaReport,
  buildSemanticRequiredFixes,
  evaluateSemanticAcceptance,
  type SemanticAcceptanceThresholds
} from "./phase3_quality.js";
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
  buildTemplateRegistry
} from "./phase4_packaging.js";
import {
  generateDramaPlan,
  generateMicroWorldMap,
  generateSetpiecePlan
} from "./phase4_generator.js";
import { normalizeDossierCitationIds, polishDeckSpecForFallback } from "./quality_polish.js";
import { gateRequirementArtifactName, latestGateDecision, readHumanReviewStore } from "./reviews.js";
import {
  ClueGraphSchema,
  CitationRefSchema,
  BeatTypeSchema,
  DeckAssemblyReportSchema,
  DeckCohesionPassSchema,
  DeckSpecSchema,
  DifferentialCastSchema,
  DramaPlanAgentOutputSchema,
  DramaPlanSchema,
  DiseaseDossierSchema,
  DiseaseResearchSourceReportSchema,
  EpisodePitchSchema,
  ActOutlineSchema,
  MedFactcheckAgentOutputSchema,
  MedFactcheckReportSchema,
  MicroWorldMapAgentOutputSchema,
  MicroWorldMapSchema,
  NarrativeIntensifierPassSchema,
  ReaderSimReportSchema,
  NarrativeStateSchema,
  QaBlockHeatmapSchema,
  SetpiecePlanSchema,
  SlideBlockAgentOutputSchema,
  SlideBlockSchema,
  StoryBlueprintSchema,
  TruthModelSchema,
  V2DeckSpecLintReportSchema,
  V2GateRequirementSchema,
  V2QaReportSchema,
  V2SemanticAcceptanceReportSchema,
  V2StageAuthoringProvenanceSchema,
  V2TemplateRegistrySchema,
  V2StoryboardGateSchema,
  StoryBeatsAlignmentReportSchema,
  type DeckSlideSpec,
  type SlideBlockOperation,
  type HumanReviewEntry,
  type DiseaseDossier,
  type ClueGraph,
  type DeckSpec,
  type DramaPlan,
  type MedFactcheckAgentOutput,
  type MedFactcheckReport,
  type ActOutline,
  type RequiredFix,
  type ReaderSimReport,
  type SetpiecePlan,
  type StoryBlueprint,
  type TruthModel,
  type V2GateId,
  type V2StageAuthoringProvenance
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

type GenerationProfile = "quality" | "pilot";

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

function resolveQaLoopBudget(input?: { estimatedMainSlides?: number; blockCount?: number }): number {
  const override = Number(process.env.MMS_V2_QA_MAX_LOOPS ?? Number.NaN);
  if (Number.isFinite(override)) return Math.max(0, Math.min(5, Math.round(override)));

  const estimatedMainSlides = Math.max(0, Math.round(input?.estimatedMainSlides ?? 0));
  if (estimatedMainSlides > 0) {
    if (estimatedMainSlides <= 40) return 2;
    if (estimatedMainSlides <= 80) return 3;
    if (estimatedMainSlides <= 140) return 4;
    return 5;
  }

  const blockCount = Math.max(0, Math.round(input?.blockCount ?? 0));
  if (blockCount <= 5) return 2;
  if (blockCount <= 9) return 3;
  if (blockCount <= 14) return 4;
  if (blockCount > 0) return 5;
  return 2;
}

function clampRatio(raw: number, fallback: number): number {
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(0, Math.min(1, raw));
}

function semanticAcceptanceThresholds(settings?: RunSettings): SemanticAcceptanceThresholds {
  const storyForward = clampRatio(
    typeof settings?.minStoryForwardRatio === "number"
      ? settings.minStoryForwardRatio
      : Number(process.env.MMS_V2_MIN_STORY_FORWARD_RATIO ?? 0.7),
    0.7
  );
  const hybrid = clampRatio(
    typeof settings?.minHybridSlideQuality === "number"
      ? settings.minHybridSlideQuality
      : Number(process.env.MMS_V2_MIN_HYBRID_SLIDE_QUALITY ?? 0.82),
    0.82
  );
  const citation = clampRatio(
    typeof settings?.minCitationGroundingCoverage === "number"
      ? settings.minCitationGroundingCoverage
      : Number(process.env.MMS_V2_MIN_CITATION_GROUNDING_COVERAGE ?? 0.9),
    0.9
  );
  return {
    minStoryForwardRatio: storyForward,
    minHybridSlideQuality: hybrid,
    minCitationGroundingCoverage: citation
  };
}

function resolveDeckLengthPolicy(settings?: RunSettings): {
  constraintEnabled: boolean;
  softTarget?: 30 | 45 | 60;
} {
  if (settings?.deckLengthConstraintEnabled === true) {
    return {
      constraintEnabled: true,
      softTarget: settings.deckLengthMain ?? 45
    };
  }
  return { constraintEnabled: false };
}

function resolveGenerationProfile(settings?: RunSettings): GenerationProfile {
  return settings?.generationProfile === "pilot" ? "pilot" : "quality";
}

function stepCAgentTimeoutMs(): number {
  const raw = Number(process.env.MMS_V2_STEP_C_AGENT_TIMEOUT_MS ?? 210_000);
  if (!Number.isFinite(raw)) return 210_000;
  // Step C includes the heaviest generation work (DeckSpec + QA agents). Enforce a sane floor
  // even if local env overrides were set aggressively for earlier debugging sessions.
  return Math.max(150_000, Math.min(900_000, Math.round(raw)));
}

function stepCDeckSpecTimeoutMs(): number {
  const raw = Number(process.env.MMS_V2_STEP_C_DECKSPEC_TIMEOUT_MS ?? 360_000);
  if (!Number.isFinite(raw)) return 360_000;
  // DeckSpec generation is the largest single structured output in v2.
  return Math.max(180_000, Math.min(1_200_000, Math.round(raw)));
}

function stepCHardWatchdogMs(): number {
  const raw = Number(process.env.MMS_V2_STEP_C_WATCHDOG_MS ?? 1_200_000);
  if (!Number.isFinite(raw)) return 1_200_000;
  return Math.max(1_000, Math.min(3_600_000, Math.round(raw)));
}

function stepCDeckRefineTimeoutMs(): number {
  const raw = Number(process.env.MMS_V2_STEP_C_DECKREFINE_TIMEOUT_MS ?? 180_000);
  if (!Number.isFinite(raw)) return 180_000;
  return Math.max(90_000, Math.min(600_000, Math.round(raw)));
}

function kb0TimeoutMs(generationProfile: GenerationProfile): number {
  const fallback = generationProfile === "quality" ? 300_000 : 120_000;
  const raw = Number(process.env.MMS_V2_KB0_TIMEOUT_MS ?? fallback);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(60_000, Math.min(900_000, Math.round(raw)));
}

function stepABAgentTimeoutMs(generationProfile: GenerationProfile): number {
  const fallback = generationProfile === "quality" ? 300_000 : 120_000;
  const raw = Number(process.env.MMS_V2_STEP_AB_AGENT_TIMEOUT_MS ?? fallback);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(90_000, Math.min(900_000, Math.round(raw)));
}

function storyPlannerTimeoutMs(
  baseTimeoutMs: number,
  generationProfile: GenerationProfile,
  stage: "microWorldMap" | "dramaPlan" | "setpiecePlan" | "storyBlueprint" | "actOutline"
): number {
  if (generationProfile !== "quality") return baseTimeoutMs;

  const floorByStage = {
    microWorldMap: 360_000,
    dramaPlan: 240_000,
    setpiecePlan: 330_000,
    storyBlueprint: 240_000,
    actOutline: 210_000
  } as const;
  const multiplierByStage = {
    microWorldMap: 1.3,
    dramaPlan: 1.1,
    setpiecePlan: 1.25,
    storyBlueprint: 1.15,
    actOutline: 1.05
  } as const;

  const target = Math.max(floorByStage[stage], Math.round(baseTimeoutMs * multiplierByStage[stage]));
  return clampTimeoutMs(target, baseTimeoutMs, 720_000);
}

function deckSpecAbortWarningThresholdSlides(): number {
  const raw = Number(process.env.MMS_V2_DECKSPEC_ABORT_WARNING_SLIDES ?? 180);
  if (!Number.isFinite(raw)) return 180;
  return Math.max(45, Math.min(500, Math.round(raw)));
}

function clampTimeoutMs(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function buildAdaptiveStepCTimeoutPlan(input: {
  estimatedMainSlides: number;
  baseAgentTimeoutMs: number;
  baseDeckSpecTimeoutMs: number;
  baseWatchdogMs: number;
  generationProfile: GenerationProfile;
  qaLoopBudget: number;
}): {
  estimatedMainSlides: number;
  agentTimeoutMs: number;
  deckSpecTimeoutMs: number;
  watchdogMs: number;
} {
  const baselineSlides = 45;
  const estimatedMainSlides = Math.max(1, Math.round(input.estimatedMainSlides));
  const extraSlides = Math.max(0, estimatedMainSlides - baselineSlides);
  const growthUnits = extraSlides / baselineSlides;

  // Scale up when forecasted deck size exceeds baseline. Keep lower bound at base values
  // to preserve historical behavior for typical runs.
  const agentScale = 1 + growthUnits * 0.55;
  const deckSpecScale = 1 + growthUnits * 0.9;
  const qaLoopBudget = Math.max(0, Math.min(5, Math.round(input.qaLoopBudget)));
  const loopScale =
    input.generationProfile === "quality"
      ? 1 + qaLoopBudget * 0.42
      : 1 + Math.min(1, qaLoopBudget) * 0.2;
  const narrativeTailScale = input.generationProfile === "quality" ? 1.35 : 1.05;
  const watchdogScale = (1 + growthUnits * 0.8) * loopScale * narrativeTailScale;

  return {
    estimatedMainSlides,
    agentTimeoutMs: clampTimeoutMs(input.baseAgentTimeoutMs * agentScale, input.baseAgentTimeoutMs, 1_500_000),
    deckSpecTimeoutMs: clampTimeoutMs(input.baseDeckSpecTimeoutMs * deckSpecScale, input.baseDeckSpecTimeoutMs, 2_400_000),
    watchdogMs: clampTimeoutMs(input.baseWatchdogMs * watchdogScale, input.baseWatchdogMs, 7_200_000)
  };
}

function deckSpecGenerationMode(generationProfile: GenerationProfile): "agent_full" | "deterministic_refine" {
  const raw = process.env.MMS_V2_DECKSPEC_MODE?.trim().toLowerCase();
  if (raw === "agent_full") return "agent_full";
  if (raw === "deterministic_refine") return "deterministic_refine";
  if (generationProfile === "pilot") return "deterministic_refine";
  return "agent_full";
}

function stepCPlanningMode(generationProfile: GenerationProfile): "agent_first" | "deterministic_first" {
  const raw = process.env.MMS_V2_STEP_C_PLANNING_MODE?.trim().toLowerCase();
  if (raw === "agent_first" || raw === "agent") return "agent_first";
  if (raw === "deterministic_first" || raw === "deterministic") return "deterministic_first";
  if (generationProfile === "pilot") return "deterministic_first";
  return "agent_first";
}

function shouldAttemptPlotDirectorRefinement(
  generationProfile: GenerationProfile,
  planningMode: "agent_first" | "deterministic_first"
): boolean {
  const raw = process.env.MMS_V2_PLOTDIRECTOR_REFINEMENT_MODE?.trim().toLowerCase();
  if (raw === "off" || raw === "false" || raw === "skip") return false;
  if (raw === "on" || raw === "true" || raw === "force") return true;
  if (generationProfile === "quality") return true;
  // Pilot mode uses "auto": only attempt on agent-first plans; remaining-budget guards
  // later in step C still decide whether the attempt is affordable.
  return planningMode === "agent_first";
}

function estimateMainSlidesFromOutline(outline: Pick<ReturnType<typeof ActOutlineSchema.parse>, "acts">): number {
  return outline.acts.reduce((total, act) => {
    const span = Math.max(0, act.target_slide_span.end - act.target_slide_span.start + 1);
    return total + span;
  }, 0);
}

function preferredBlockSize(generationProfile: GenerationProfile, estimatedMainSlides = 0): number {
  if (generationProfile === "quality") {
    const raw = Number(process.env.MMS_V2_QUALITY_BLOCK_SIZE ?? Number.NaN);
    if (Number.isFinite(raw)) return Math.max(8, Math.min(18, Math.round(raw)));
    if (estimatedMainSlides >= 140) return 12;
    if (estimatedMainSlides >= 96) return 11;
    if (estimatedMainSlides >= 72) return 10;
    return 9;
  }
  const raw = Number(process.env.MMS_V2_PILOT_BLOCK_SIZE ?? 16);
  if (!Number.isFinite(raw)) return 16;
  return Math.max(10, Math.min(20, Math.round(raw)));
}

function slideBlockAuthorTimeoutMs(
  baseTimeoutMs: number,
  generationProfile: GenerationProfile,
  plan: { start: number; end: number }
): number {
  const override = Number(process.env.MMS_V2_SLIDE_BLOCK_TIMEOUT_MS ?? Number.NaN);
  if (Number.isFinite(override) && override > 0) {
    return clampTimeoutMs(override, baseTimeoutMs, 900_000);
  }

  const slideCount = Math.max(1, plan.end - plan.start + 1);
  if (generationProfile === "quality") {
    const computed = Math.max(baseTimeoutMs + 120_000, 180_000 + slideCount * 26_000);
    return clampTimeoutMs(computed, baseTimeoutMs, 540_000);
  }

  const computed = Math.max(baseTimeoutMs, 120_000 + slideCount * 18_000);
  return clampTimeoutMs(computed, baseTimeoutMs, 360_000);
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
  if (/"citation_id":"CIT-(?:00\d|KB-001|UNKNOWN|SCAFFOLD)"/.test(text)) return true;
  if (/"dx_id":"DX-\d/.test(text)) return true;
  if (/"top_dx_ids":\["DX_(?:PRIMARY|ALTERNATE|MIMIC)/.test(text)) return true;
  if (/\[SCAFFOLD\]/.test(text)) return true;
  if (/"major_concept_id":"MC-PATCH-/.test(text)) return true;
  if (/— S\d{2,3}"/.test(text)) return true;
  return false;
}

const SCAFFOLD_SIGNAL_RE = /\[SCAFFOLD\]|CIT-KB-001|DX_(?:PRIMARY|ALTERNATE|MIMIC|UNKNOWN)|MC-PATCH-|LO-SCAFFOLD-/i;
const INTERNAL_CORRECTION_NOTE_RE = /\s*Correction note:[\s\S]*$/i;
const INTERNAL_PATCH_TAG_RE = /\s*\[(?:Patched clue framing|Patch\s+\d+:[^\]]*)\]/gi;
const INTERNAL_PLACEHOLDER_TOKEN_RE = /\b(?:placeholder|scaffold|fallback)\b/gi;
const INTERNAL_FAKE_CITATION_TEXT_RE = /\bCIT-(?:KB-001|UNKNOWN|SCAFFOLD|00\d+|SPUTUM-01|BLOOD-01|GRAM-01|BCX-01|PATH-RES-01)\b/gi;

function hasScaffoldSignal(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return SCAFFOLD_SIGNAL_RE.test(value);
}

function stripInternalQualityResidue(value: unknown): string {
  return String(value ?? "")
    .replace(INTERNAL_CORRECTION_NOTE_RE, "")
    .replace(INTERNAL_PATCH_TAG_RE, "")
    .replace(/\[SCAFFOLD\]/gi, "")
    .replace(INTERNAL_FAKE_CITATION_TEXT_RE, "")
    .replace(INTERNAL_PLACEHOLDER_TOKEN_RE, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

function isPlaceholderAppendixSlide(slide: ReturnType<typeof DeckSpecSchema.parse>["appendix_slides"][number]): boolean {
  if (hasScaffoldSignal(slide.title) || hasScaffoldSignal(slide.hook) || hasScaffoldSignal(slide.visual_description)) return true;
  if (hasScaffoldSignal(slide.on_slide_text.headline) || hasScaffoldSignal(slide.on_slide_text.subtitle)) return true;
  if ((slide.on_slide_text.callouts ?? []).some((item) => hasScaffoldSignal(item))) return true;
  if ((slide.on_slide_text.labels ?? []).some((item) => hasScaffoldSignal(item))) return true;
  if (hasScaffoldSignal(slide.story_panel.goal) || hasScaffoldSignal(slide.story_panel.opposition) || hasScaffoldSignal(slide.story_panel.turn) || hasScaffoldSignal(slide.story_panel.decision)) return true;
  if (hasScaffoldSignal(slide.medical_payload.major_concept_id)) return true;
  if ((slide.medical_payload.supporting_details ?? []).some((item) => hasScaffoldSignal(item))) return true;
  if ((slide.medical_payload.linked_learning_objectives ?? []).some((item) => hasScaffoldSignal(item))) return true;
  if ((slide.medical_payload.dossier_citations ?? []).some((citation) => hasScaffoldSignal(citation.citation_id) || hasScaffoldSignal(citation.claim))) return true;
  if (hasScaffoldSignal(slide.speaker_notes.narrative_notes) || hasScaffoldSignal(slide.speaker_notes.medical_reasoning)) return true;
  if ((slide.speaker_notes.what_this_slide_teaches ?? []).some((item) => hasScaffoldSignal(item))) return true;
  if ((slide.speaker_notes.differential_update.top_dx_ids ?? []).some((item) => hasScaffoldSignal(item))) return true;
  if ((slide.speaker_notes.differential_update.eliminated_dx_ids ?? []).some((item) => hasScaffoldSignal(item))) return true;
  if (hasScaffoldSignal(slide.speaker_notes.differential_update.why)) return true;
  if ((slide.speaker_notes.citations ?? []).some((citation) => hasScaffoldSignal(citation.citation_id) || hasScaffoldSignal(citation.claim))) return true;
  return false;
}

function stabilizeQualityDeckArtifacts(input: {
  deck: ReturnType<typeof DeckSpecSchema.parse>;
  topic: string;
  episodeTitle: string;
  generationProfile: "quality" | "pilot";
  dossier: DiseaseDossier;
}): ReturnType<typeof DeckSpecSchema.parse> {
  const deck = JSON.parse(JSON.stringify(input.deck)) as ReturnType<typeof DeckSpecSchema.parse>;
  const dossierCitationIds = collectDossierCitationIds(input.dossier);
  const citationPool = collectDossierCitationPool(input.dossier);

  const sanitizeCitationList = (
    citations: unknown,
    fallbackClaim: string
  ): Array<z.infer<typeof CitationRefSchema>> => {
    const normalized = normalizeCitationRefs(citations).filter(
      (citation) =>
        dossierCitationIds.has(citation.citation_id) &&
        !hasScaffoldSignal(citation.citation_id) &&
        !hasScaffoldSignal(citation.claim) &&
        !/placeholder|scaffold|fallback/i.test(citation.claim)
    );
    if (normalized.length > 0) return normalized.slice(0, 4);
    return [fallbackCitationFromPool(citationPool, fallbackClaim)];
  };

  const sanitizeSlideText = (value: unknown, fallbackText: string): string => {
    const cleaned = stripInternalQualityResidue(value);
    return cleaned.length > 0 ? cleaned : fallbackText;
  };

  const sanitizeSlide = (
    slide: ReturnType<typeof DeckSpecSchema.parse>["slides"][number] | ReturnType<typeof DeckSpecSchema.parse>["appendix_slides"][number],
    defaults: {
      title: string;
      hook: string;
      visualDescription: string;
      headline: string;
      subtitle?: string;
      narrativeNotes: string;
      medicalReasoning: string;
      teachingPoint: string;
      differentialWhy: string;
      conceptId: string;
    }
  ): void => {
    slide.title = sanitizeSlideText(slide.title, defaults.title);
    slide.hook = sanitizeSlideText(slide.hook, defaults.hook);
    slide.visual_description = sanitizeSlideText(slide.visual_description, defaults.visualDescription);
    slide.on_slide_text.headline = sanitizeSlideText(slide.on_slide_text.headline, defaults.headline);
    if (slide.on_slide_text.subtitle) {
      const cleanedSubtitle = stripInternalQualityResidue(slide.on_slide_text.subtitle);
      slide.on_slide_text.subtitle = cleanedSubtitle.length > 0 ? cleanedSubtitle : defaults.subtitle;
    }
    if (Array.isArray(slide.on_slide_text.callouts)) {
      slide.on_slide_text.callouts = slide.on_slide_text.callouts
        .map((callout) => stripInternalQualityResidue(callout))
        .filter((callout) => callout.length > 0);
    }
    if (Array.isArray(slide.on_slide_text.labels)) {
      slide.on_slide_text.labels = slide.on_slide_text.labels
        .map((label) => stripInternalQualityResidue(label))
        .filter((label) => label.length > 0);
    }
    slide.story_panel.goal = sanitizeSlideText(slide.story_panel.goal, `Advance ${slide.slide_id} with a concrete objective.`);
    slide.story_panel.opposition = sanitizeSlideText(slide.story_panel.opposition, "A credible obstacle blocks the next move.");
    slide.story_panel.turn = sanitizeSlideText(slide.story_panel.turn, "New evidence reframes the case.");
    slide.story_panel.decision = sanitizeSlideText(slide.story_panel.decision, "Choose the next testable action.");
    if (slide.story_panel.consequence) {
      const consequence = stripInternalQualityResidue(slide.story_panel.consequence);
      slide.story_panel.consequence = consequence.length > 0 ? consequence : undefined;
    }
    slide.medical_payload.major_concept_id = hasScaffoldSignal(slide.medical_payload.major_concept_id) || slide.medical_payload.major_concept_id.trim().length === 0
      ? defaults.conceptId
      : slide.medical_payload.major_concept_id.trim();
    if (Array.isArray(slide.medical_payload.supporting_details)) {
      slide.medical_payload.supporting_details = slide.medical_payload.supporting_details
        .map((detail) => stripInternalQualityResidue(detail))
        .filter((detail) => detail.length > 0);
    }
    const supportingDetails = slide.medical_payload.supporting_details ?? [];
    if (Array.isArray(slide.medical_payload.linked_learning_objectives)) {
      slide.medical_payload.linked_learning_objectives = slide.medical_payload.linked_learning_objectives.filter(
        (objective) => !hasScaffoldSignal(objective) && String(objective || "").trim().length > 0
      );
    }
    if (supportingDetails.length === 0) {
      slide.medical_payload.supporting_details = [defaults.teachingPoint];
    }
    const combinedCitations = [
      ...(slide.medical_payload.dossier_citations ?? []),
      ...(slide.speaker_notes.citations ?? [])
    ];
    const fallbackClaim = stripInternalQualityResidue(slide.speaker_notes.medical_reasoning) || `${slide.title} grounding`;
    const cleanedCitations = sanitizeCitationList(combinedCitations, fallbackClaim);
    slide.medical_payload.dossier_citations = cleanedCitations;
    slide.speaker_notes.citations = cleanedCitations;
    slide.speaker_notes.narrative_notes = sanitizeSlideText(slide.speaker_notes.narrative_notes, defaults.narrativeNotes);
    slide.speaker_notes.medical_reasoning = sanitizeSlideText(slide.speaker_notes.medical_reasoning, defaults.medicalReasoning);
    slide.speaker_notes.what_this_slide_teaches = (slide.speaker_notes.what_this_slide_teaches ?? [])
      .map((item) => stripInternalQualityResidue(item))
      .filter((item) => item.length > 0);
    if (slide.speaker_notes.what_this_slide_teaches.length === 0) {
      slide.speaker_notes.what_this_slide_teaches = [defaults.teachingPoint];
    }
    slide.speaker_notes.differential_update.top_dx_ids = (slide.speaker_notes.differential_update.top_dx_ids ?? [])
      .filter((dxId) => !hasScaffoldSignal(dxId) && String(dxId || "").trim().length > 0);
    slide.speaker_notes.differential_update.eliminated_dx_ids = (slide.speaker_notes.differential_update.eliminated_dx_ids ?? [])
      .filter((dxId) => !hasScaffoldSignal(dxId) && String(dxId || "").trim().length > 0);
    slide.speaker_notes.differential_update.why = sanitizeSlideText(
      slide.speaker_notes.differential_update.why,
      defaults.differentialWhy
    );
  };

  if (input.generationProfile === "quality") {
    if (hasScaffoldSignal(deck.deck_meta.episode_title) || String(deck.deck_meta.episode_title || "").trim().length === 0) {
      deck.deck_meta.episode_title = input.episodeTitle.trim().length > 0
        ? input.episodeTitle.trim()
        : `${input.topic} — Micro-Detectives Case`;
    }
    const retainedAppendix = deck.appendix_slides.filter((slide) => !isPlaceholderAppendixSlide(slide));
    if (retainedAppendix.length !== deck.appendix_slides.length) {
      const retainedIds = new Set(retainedAppendix.map((slide) => slide.slide_id));
      deck.appendix_slides = retainedAppendix;
      deck.slides = deck.slides.map((slide) => ({
        ...slide,
        appendix_links: (slide.appendix_links ?? []).filter((link) => retainedIds.has(link))
      }));
    }

    deck.slides.forEach((slide) => {
      sanitizeSlide(slide, {
        title: `${slide.slide_id}: ${input.topic}`,
        hook: "What evidence changes the next decision?",
        visualDescription: "Describe the scene, the medical evidence, and the pressure on the detectives.",
        headline: `${slide.slide_id} Case Update`,
        subtitle: `Act ${slide.act_id.replace("ACT", "")} evidence shift`,
        narrativeNotes: "Keep the case moving with a concrete action, clue, or decision.",
        medicalReasoning: "Tie the visible evidence to the diagnosis and next management decision using dossier-grounded claims.",
        teachingPoint: "Use dossier-grounded evidence to teach one major concept on this slide.",
        differentialWhy: "Explain how this slide changes the differential.",
        conceptId: `MC_${slide.slide_id}`
      });
      const callouts = slide.on_slide_text.callouts ?? [];
      if (callouts.length === 0) {
        slide.on_slide_text.callouts = [stripInternalQualityResidue(slide.title) || `${input.topic} evidence`];
      }
      if (slide.speaker_notes.differential_update.top_dx_ids.length === 0) {
        slide.speaker_notes.differential_update.top_dx_ids = [deck.characters.patient.label ? "DX-CASE-PRIMARY" : `DX-${slide.slide_id}`];
      }
    });

    deck.appendix_slides.forEach((slide) => {
      sanitizeSlide(slide, {
        title: `${slide.slide_id}: Appendix`,
        hook: "Reference detail that supports the main deck.",
        visualDescription: "Reference visual for a medically grounded appendix deep dive.",
        headline: `${slide.slide_id} Reference`,
        subtitle: "Appendix detail",
        narrativeNotes: "Appendix slide supporting the main caseboard.",
        medicalReasoning: "Reference appendix detail grounded in the disease dossier.",
        teachingPoint: "Provide concise appendix support for the deck’s medical reasoning.",
        differentialWhy: "Appendix detail supporting differential closure.",
        conceptId: `MC_${slide.slide_id.replace(/-/g, "_")}`
      });
      if (slide.speaker_notes.differential_update.top_dx_ids.length === 0) {
        slide.speaker_notes.differential_update.top_dx_ids = ["DX-APPENDIX-REFERENCE"];
      }
    });
  }
  return DeckSpecSchema.parse(deck);
}

function hasInvalidRequiredFields(input: ReturnType<typeof DeckSpecSchema.parse>): boolean {
  const slides = [...input.slides, ...input.appendix_slides];
  for (const slide of slides) {
    if (String(slide.title ?? "").trim().length === 0) return true;
    if (String(slide.hook ?? "").trim().length === 0) return true;
    if (String(slide.on_slide_text.headline ?? "").trim().length === 0) return true;
    if (String(slide.story_panel.goal ?? "").trim().length === 0) return true;
    if (String(slide.story_panel.opposition ?? "").trim().length === 0) return true;
    if (String(slide.story_panel.turn ?? "").trim().length === 0) return true;
    if (String(slide.story_panel.decision ?? "").trim().length === 0) return true;
    if (String(slide.medical_payload.major_concept_id ?? "").trim().length === 0) return true;
    if (!Array.isArray(slide.medical_payload.dossier_citations) || slide.medical_payload.dossier_citations.length === 0) return true;
    if (!Array.isArray(slide.speaker_notes.citations) || slide.speaker_notes.citations.length === 0) return true;
    if (
      !Array.isArray(slide.speaker_notes.differential_update.top_dx_ids) ||
      slide.speaker_notes.differential_update.top_dx_ids.length === 0
    ) {
      return true;
    }
  }
  return false;
}

function shouldRunFallbackPolish(input: {
  deck: ReturnType<typeof DeckSpecSchema.parse>;
  seedFromDeterministic: boolean;
}): { shouldRun: boolean; mode: "repair_only" | "scaffold_enrichment"; reason: string } {
  if (input.seedFromDeterministic) {
    return {
      shouldRun: true,
      mode: "scaffold_enrichment",
      reason: "deterministic_seed"
    };
  }
  if (hasInvalidRequiredFields(input.deck)) {
    return {
      shouldRun: true,
      mode: "repair_only",
      reason: "required_field_repair"
    };
  }
  return {
    shouldRun: false,
    mode: "repair_only",
    reason: "authored_deck_valid"
  };
}

function scaffoldSlideLimit(mainSlideCount: number): number {
  return Math.max(1, Math.ceil(mainSlideCount * 0.02));
}

function resolveSlideBlockSummary(block: ReturnType<typeof SlideBlockSchema.parse>): string {
  const summary = String(block.block_summary_out ?? "").trim();
  if (summary.length > 0) return summary;
  return `Block ${block.block_id} advances ${block.act_id} from slide ${block.slide_range.start} to ${block.slide_range.end}.`;
}

function withResolvedSlideBlockSummary(block: ReturnType<typeof SlideBlockSchema.parse>) {
  return {
    ...block,
    block_summary_out: resolveSlideBlockSummary(block)
  };
}

const STRUCTURAL_REGEN_FIX_TYPES = new Set<RequiredFix["type"]>([
  "increase_story_turn",
  "add_twist_receipts",
  "regenerate_section",
  "edit_clue",
  "edit_differential"
]);

function isStructuralRegenFix(fix: RequiredFix): boolean {
  if (STRUCTURAL_REGEN_FIX_TYPES.has(fix.type)) return true;
  const desc = `${fix.fix_id} ${fix.description}`.toLowerCase();
  return (
    /\b(false[-\s]?theory|midpoint|collapse|twist)\b/.test(desc) ||
    /\b(relationship|detective|deputy|rupture|repair|arc)\b/.test(desc) ||
    /\b(generic language|boilerplate|repetition|template)\b/.test(desc)
  );
}

function parseSlideNumber(slideId: string): number | null {
  const match = String(slideId).match(/^S(\d{2,3})$/);
  if (!match) return null;
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function extractSlideIdsFromFixes(fixes: RequiredFix[]): Set<string> {
  const ids = new Set<string>();
  for (const fix of fixes) {
    for (const target of fix.targets ?? []) {
      if (/^S\d{2,3}$/.test(target)) ids.add(target);
      const tokens = target.match(/S\d{2,3}/g) ?? [];
      for (const token of tokens) ids.add(token);
      const slideIndex = target.match(/slides\[(\d+)\]/);
      if (slideIndex) {
        const idx = Number(slideIndex[1]);
        if (Number.isFinite(idx) && idx >= 0) ids.add(`S${String(idx + 1).padStart(2, "0")}`);
      }
    }
  }
  return ids;
}

function inferOutlineActForPlan(
  plan: { start: number; end: number; actId: "ACT1" | "ACT2" | "ACT3" | "ACT4" },
  actOutline: ActOutline
): "ACT1" | "ACT2" | "ACT3" | "ACT4" | null {
  const midpoint = Math.round((plan.start + plan.end) / 2);
  const match = actOutline.acts.find(
    (act) => midpoint >= act.target_slide_span.start && midpoint <= act.target_slide_span.end
  );
  return match?.act_id ?? null;
}

function resolveStructuralBlockIndexes(
  fixes: RequiredFix[],
  blockPlans: Array<{ blockId: string; actId: "ACT1" | "ACT2" | "ACT3" | "ACT4"; start: number; end: number }>,
  heatmap?: { blocks: Array<{ block_id: string; act_id: "ACT1" | "ACT2" | "ACT3" | "ACT4"; severity_score: number; repeated_template_density: number }> }
): number[] {
  const slideIds = extractSlideIdsFromFixes(fixes);
  const indexes = new Set<number>();
  const widenWindow = fixes.some((fix) => fix.type === "increase_story_turn" || fix.type === "regenerate_section");
  const explicitBlockIds = new Set<string>();
  for (const fix of fixes) {
    for (const target of fix.targets ?? []) {
      const blockMatches = target.match(/ACT[1-4]_B\d{2}/g) ?? [];
      for (const match of blockMatches) explicitBlockIds.add(match);
    }
  }
  for (let i = 0; i < blockPlans.length; i += 1) {
    if (explicitBlockIds.has(blockPlans[i]!.blockId)) indexes.add(i);
  }
  for (const slideId of slideIds) {
    const slideNumber = parseSlideNumber(slideId);
    if (slideNumber === null) continue;
    for (let i = 0; i < blockPlans.length; i += 1) {
      const plan = blockPlans[i]!;
      if (slideNumber >= plan.start && slideNumber <= plan.end) {
        indexes.add(i);
        if (widenWindow) {
          if (i > 0) indexes.add(i - 1);
          if (i + 1 < blockPlans.length) indexes.add(i + 1);
        }
        break;
      }
    }
  }
  if (heatmap) {
    const highestByAct = new Map<string, { block_id: string; severity_score: number }>();
    for (const block of heatmap.blocks) {
      const current = highestByAct.get(block.act_id);
      if (!current || block.severity_score > current.severity_score) {
        highestByAct.set(block.act_id, { block_id: block.block_id, severity_score: block.severity_score });
      }
      if (block.repeated_template_density >= 0.18) explicitBlockIds.add(block.block_id);
    }
    for (const [actId, block] of highestByAct) {
      if (block.severity_score <= 0) continue;
      const idx = blockPlans.findIndex((plan) => plan.blockId === block.block_id && plan.actId === actId);
      if (idx >= 0) indexes.add(idx);
    }
    for (const blockId of explicitBlockIds) {
      const idx = blockPlans.findIndex((plan) => plan.blockId === blockId);
      if (idx >= 0) indexes.add(idx);
    }
  }
  if (indexes.size === 0 && blockPlans.length > 0) {
    const fallbackIndex = heatmap
      ? blockPlans.findIndex((plan) =>
          heatmap.blocks.some((block) => block.block_id === plan.blockId && block.severity_score > 0)
        )
      : 0;
    indexes.add(fallbackIndex >= 0 ? fallbackIndex : 0);
  }
  return [...indexes].sort((a, b) => a - b);
}

function shouldAllowStoryStageDeterministicFallback(
  generationProfile: GenerationProfile,
  adherenceMode: "strict" | "warn"
): boolean {
  if (generationProfile === "pilot") return true;
  return adherenceMode === "warn";
}

function buildStageAuthoringProvenance(input: {
  generationProfile: GenerationProfile;
  microWorld: { source: "agent" | "deterministic_fallback"; reason?: string };
  drama: { source: "agent" | "deterministic_fallback"; reason?: string };
  setpiece: { source: "agent" | "deterministic_fallback"; reason?: string };
}) {
  const at = nowIso();
  return V2StageAuthoringProvenanceSchema.parse({
    schema_version: "1.0.0",
    workflow: "v2_micro_detectives",
    generated_at: at,
    generation_profile: input.generationProfile,
    stages: {
      micro_world_map: { source: input.microWorld.source, reason: input.microWorld.reason, timestamp: at },
      drama_plan: { source: input.drama.source, reason: input.drama.reason, timestamp: at },
      setpiece_plan: { source: input.setpiece.source, reason: input.setpiece.reason, timestamp: at }
    }
  });
}

function clipExcerpt(text: string, maxChars = 1800): string {
  const normalized = String(text ?? "").replace(/\r\n/g, "\n").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars)}\n[TRUNCATED]`;
}

function buildCanonicalProfileExcerpt(canonicalProfile: Awaited<ReturnType<typeof loadCanonicalProfile>>): string {
  const sections = [
    canonicalProfile.character_bible_md ?? "",
    canonicalProfile.series_style_bible_md ?? "",
    canonicalProfile.deck_spec_md ?? ""
  ]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join("\n\n");
  return clipExcerpt(sections.length > 0 ? sections : canonicalProfile.combined_markdown, 1200);
}

function buildEpisodeMemoryExcerpt(memory: Awaited<ReturnType<typeof loadEpisodeMemory>>): string {
  const recent = memory.recent.slice(0, 8);
  if (recent.length === 0) return "No prior episode memory entries.";
  const lines = recent.map((entry, index) => {
    const motifs = entry.variety?.motifs?.slice(0, 3).join(", ") || "none";
    return `${index + 1}. ${entry.runId} | key=${entry.key} | genre=${entry.variety?.genre_wrapper ?? "unknown"} | body=${entry.variety?.body_setting ?? "unknown"} | motifs=${motifs}`;
  });
  return clipExcerpt(lines.join("\n"), 800);
}

function recentSlideExcerpts(deck: ReturnType<typeof DeckSpecSchema.parse>, start: number, end: number): string[] {
  const inWindow = deck.slides
    .filter((slide) => {
      const n = parseSlideNumber(slide.slide_id);
      return n !== null && n >= start && n <= end;
    })
    .slice(0, 3);
  return inWindow.map((slide) =>
    clipExcerpt(`${slide.slide_id} ${slide.title}\n${slide.hook}\n${slide.story_panel.turn}\n${slide.speaker_notes.narrative_notes ?? ""}`, 180)
  );
}

function trimList(values: string[] | undefined, maxItems: number, maxChars: number): string[] {
  return (values ?? [])
    .map((value) => clampText(value, maxChars))
    .filter((value) => value.trim().length > 0)
    .slice(0, maxItems);
}

function compactMedicalSliceForBlock(input: {
  plan: { start: number; end: number; actId?: "ACT1" | "ACT2" | "ACT3" | "ACT4" };
  diseaseDossier: ReturnType<typeof DiseaseDossierSchema.parse>;
  truthModel: ReturnType<typeof TruthModelSchema.parse>;
  differentialCast: ReturnType<typeof DifferentialCastSchema.parse>;
  clueGraph: ReturnType<typeof ClueGraphSchema.parse>;
  microWorldMap: ReturnType<typeof MicroWorldMapSchema.parse>;
  dramaPlan: ReturnType<typeof DramaPlanSchema.parse>;
  setpiecePlan: ReturnType<typeof SetpiecePlanSchema.parse>;
}) {
  const actId = input.plan.actId ?? "ACT1";
  const clueWindow = input.clueGraph.clues.filter((clue) => {
    const firstSeen = parseSlideNumber(clue.first_seen_slide_id);
    const payoff = parseSlideNumber(clue.payoff_slide_id);
    return (
      (firstSeen !== null && firstSeen >= input.plan.start - 6 && firstSeen <= input.plan.end + 6) ||
      (payoff !== null && payoff >= input.plan.start - 6 && payoff <= input.plan.end + 6)
    );
  });
  return {
    dossier_focus: {
      canonical_name: input.diseaseDossier.canonical_name,
      top_sections: input.diseaseDossier.sections.slice(0, 2).map((section) => ({
        section: section.section,
        key_points: section.key_points.slice(0, 2).map((point) => clampText(point, 160)),
        citations: section.citations.slice(0, 1).map((cite) => cite.citation_id)
      }))
    },
    truth_focus: {
      final_diagnosis: {
        dx_id: input.truthModel.final_diagnosis.dx_id,
        name: input.truthModel.final_diagnosis.name,
        one_sentence_mechanism: clampText(input.truthModel.final_diagnosis.one_sentence_mechanism, 180)
      },
      twist_blueprint: {
        setup: clampText(input.truthModel.twist_blueprint.setup, 180),
        reveal: clampText(input.truthModel.twist_blueprint.reveal, 180),
        receipts: trimList(input.truthModel.twist_blueprint.receipts, 4, 140)
      },
      cover_story: {
        initial_working_dx_ids: input.truthModel.cover_story.initial_working_dx_ids.slice(0, 4),
        why_it_seems_right: clampText(input.truthModel.cover_story.why_it_seems_right, 180),
        what_it_gets_wrong: clampText(input.truthModel.cover_story.what_it_gets_wrong, 180)
      }
    },
    differential_focus: {
      suspects: input.differentialCast.primary_suspects.slice(0, 5).map((suspect) => ({
        dx_id: suspect.dx_id,
        name: suspect.name,
        why_tempting: clampText(suspect.why_tempting, 140)
      })),
      rotation_plan: input.differentialCast.rotation_plan
    },
    clue_focus: {
      clues: clueWindow.slice(0, 4).map((clue) => ({
        clue_id: clue.clue_id,
        first_seen_slide_id: clue.first_seen_slide_id,
        payoff_slide_id: clue.payoff_slide_id,
        observed: clampText(clue.observed, 140),
        correct_inference: clampText(clue.correct_inference, 140)
      })),
      red_herrings: input.clueGraph.red_herrings.slice(0, 2).map((item) => ({
        rh_id: item.rh_id,
        payoff_slide_id: item.payoff_slide_id,
        why_believable: clampText(item.why_believable, 140)
      })),
      twist_support_matrix: input.clueGraph.twist_support_matrix.slice(0, 3).map((item) => ({
        twist_id: item.twist_id,
        supporting_clue_ids: item.supporting_clue_ids.slice(0, 4),
        recontextualized_slide_ids: item.recontextualized_slide_ids.slice(0, 4)
      }))
    },
    micro_world_focus: {
      zones: input.microWorldMap.zones.slice(0, 2).map((zone) => ({
        zone_id: zone.zone_id,
        name: zone.name,
        anatomic_location: zone.anatomic_location,
        scale_notes: clampText(zone.scale_notes ?? "", 140),
        narrative_motifs: trimList(zone.narrative_motifs, 2, 100)
      })),
      hazards: input.microWorldMap.hazards.slice(0, 2).map((hazard) => ({
        hazard_id: hazard.hazard_id,
        type: hazard.type,
        description: clampText(hazard.description, 140),
        links_to_pathophysiology: clampText(hazard.links_to_pathophysiology, 140)
      }))
    },
    drama_focus: {
      relationship_arcs: input.dramaPlan.relationship_arcs.slice(0, 2).map((arc) => ({
        pair: arc.pair,
        starting_dynamic: clampText(arc.starting_dynamic, 140),
        named_recurring_tensions: trimList(arc.named_recurring_tensions, 3, 100),
        friction_points: trimList(arc.friction_points, 3, 120),
        repair_moments: trimList(arc.repair_moments, 3, 120),
        relationship_change_by_act: arc.relationship_change_by_act
          .filter((item) => item.act_id === actId)
          .slice(0, 1),
        climax_resolution: clampText(arc.climax_resolution, 140)
      })),
      pressure_ladder: input.dramaPlan.pressure_ladder,
      chapter_or_act_setups: (input.dramaPlan.chapter_or_act_setups ?? [])
        .filter((setup) => setup.act_id === actId)
        .slice(0, 1)
        .map((setup) => ({
          act_id: setup.act_id,
          required_emotional_beats: trimList(setup.required_emotional_beats, 3, 120),
          required_choices: trimList(setup.required_choices, 3, 120),
          relationship_change_due_to_case: clampText(setup.relationship_change_due_to_case, 140),
          act_specific_emotionally_costly_clue: clampText(setup.act_specific_emotionally_costly_clue, 140),
          must_pay_by_end_of_act: trimList(setup.must_pay_by_end_of_act, 3, 120),
          notes: clampText(setup.notes ?? "", 120)
        }))
    },
    setpiece_focus: {
      setpieces: input.setpiecePlan.setpieces
        .filter((sp) => sp.act_id === actId)
        .slice(0, 2)
        .map((sp) => ({
          setpiece_id: sp.setpiece_id,
          act_id: sp.act_id,
          type: sp.type,
          location_zone_id: sp.location_zone_id,
          story_purpose: clampText(sp.story_purpose, 140),
          clue_obligation_paid: clampText(sp.clue_obligation_paid, 140),
          emotional_cost: clampText(sp.emotional_cost, 140),
          relationship_shift: clampText(sp.relationship_shift, 140),
          outcome_turn: clampText(sp.outcome_turn, 140)
        })),
      act_debts: input.setpiecePlan.act_debts.filter((item) => item.act_id === actId).slice(0, 1)
    }
  };
}

const STORY_FORWARD_QUALITY_MODES = new Set(["clue", "dialogue", "action"]);

function preferredStoryForwardModeForSlide(slide: ReturnType<typeof DeckSpecSchema.parse>["slides"][number]): "clue" | "dialogue" | "action" {
  switch (slide.beat_type) {
    case "cold_open":
    case "first_dive":
    case "setback":
    case "reversal":
    case "action_setpiece":
    case "showdown":
      return "action";
    case "suspect_intro":
    case "theory_update":
    case "false_theory_lock_in":
    case "false_theory_collapse":
    case "aftermath":
      return "dialogue";
    default:
      return "clue";
  }
}

function isStrongStoryForwardCandidate(slide: ReturnType<typeof DeckSpecSchema.parse>["slides"][number]): boolean {
  return (
    slide.act_id !== "APPENDIX" &&
    slide.story_panel.goal.trim().length > 0 &&
    slide.story_panel.opposition.trim().length > 0 &&
    slide.story_panel.turn.trim().length > 0 &&
    slide.story_panel.decision.trim().length > 0 &&
    (slide.story_panel.consequence?.trim().length ?? 0) > 0 &&
    slide.medical_payload.major_concept_id.trim().length > 0 &&
    slide.medical_payload.dossier_citations.length > 0 &&
    slide.speaker_notes.citations.length > 0
  );
}

function normalizeQualityDeckDeliveryModes(
  deck: ReturnType<typeof DeckSpecSchema.parse>,
  generationProfile: GenerationProfile
): { deck: ReturnType<typeof DeckSpecSchema.parse>; adjustments: Array<{ slide_id: string; from: string; to: string; reason: string }> } {
  if (generationProfile !== "quality") return { deck, adjustments: [] };

  const adjustments: Array<{ slide_id: string; from: string; to: string; reason: string }> = [];
  const slides = deck.slides.map((slide) => {
    const currentMode = slide.medical_payload.delivery_mode;
    if (STORY_FORWARD_QUALITY_MODES.has(currentMode)) return slide;
    if (!isStrongStoryForwardCandidate(slide)) return slide;
    const preferred = preferredStoryForwardModeForSlide(slide);
    if (preferred === currentMode) return slide;
    adjustments.push({
      slide_id: slide.slide_id,
      from: currentMode,
      to: preferred,
      reason: "Strong authored story turn with explicit decision/consequence should be story-forward in the main deck."
    });
    return {
      ...slide,
      medical_payload: {
        ...slide.medical_payload,
        delivery_mode: preferred
      }
    };
  });

  if (adjustments.length === 0) return { deck, adjustments };
  return {
    deck: DeckSpecSchema.parse({
      ...deck,
      slides
    }),
    adjustments
  };
}

function buildStructuralRegenGuidance(input: {
  fixes: RequiredFix[];
  plan: { blockId: string; start: number; end: number };
}): {
  policySummary: string[];
  targetSlideIds: string[];
} {
  const targetSlideIds = [...extractSlideIdsFromFixes(input.fixes)]
    .filter((slideId) => {
      const slideNum = parseSlideNumber(slideId);
      return slideNum !== null && slideNum >= input.plan.start && slideNum <= input.plan.end;
    })
    .sort();

  const hasStoryTurnFix = input.fixes.some((fix) => fix.type === "increase_story_turn");
  const hasSectionRegen = input.fixes.some((fix) => fix.type === "regenerate_section");
  const hasTwistFix = input.fixes.some((fix) => fix.type === "add_twist_receipts");
  const policySummary = [
    "If a targeted slide is note_only or passive exhibit, convert it into a clue, dialogue, or action beat with an explicit decision and consequence on the same slide.",
    "Use replace_window or split_slide when a single weak slide is carrying too much summary or too little dramatic consequence.",
    "Do not preserve flat handoff or recap slides just because they already exist; replace them with active investigation beats."
  ];
  if (hasStoryTurnFix) {
    policySummary.push("Prioritize story-forward delivery modes on targeted slides and tighten medical teaching into the same dramatic move.");
  }
  if (hasSectionRegen) {
    policySummary.push("Rebalance pacing across the whole block so the emotional turn, false-theory pressure, and clue obligations escalate together.");
  }
  if (hasTwistFix) {
    policySummary.push("Seed or pay off twist receipts inside this block instead of deferring them to appendix-style explanation.");
  }
  return { policySummary, targetSlideIds };
}

function storyBeatsMarkerCoverage(storyBeats: z.infer<typeof StoryBeatsSchema>) {
  const allBeatText = [
    storyBeats.intro.beat_md,
    storyBeats.outro.beat_md,
    ...Object.values(storyBeats.topic_area_beats).map((node) => node.beat_md)
  ]
    .filter((value) => value.trim().length > 0)
    .join("\n");

  const markerCoverage = {
    opener_motif: /\b(cold open|quirky opening|opening motif|case intake)\b/i.test(allBeatText),
    midpoint_false_theory_collapse: /\b(false[-\s]?theory|midpoint|collapse|recontextualiz)\b/i.test(allBeatText),
    ending_callback: /\b(callback|full circle|back at the office|return(ed)? to the office)\b/i.test(allBeatText),
    detective_deputy_rupture_repair: /\b(rupture|conflict|disagree|friction)\b[\s\S]{0,180}\b(repair|reconcile|restore trust|team up)\b/i.test(allBeatText)
  };
  return markerCoverage;
}

const STORY_ALIGNMENT_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "over",
  "after",
  "before",
  "when",
  "where",
  "your",
  "their",
  "have",
  "has",
  "had",
  "were",
  "will",
  "would",
  "could",
  "should",
  "case",
  "slide",
  "story"
]);

function semanticTokens(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !STORY_ALIGNMENT_STOPWORDS.has(token));
}

function overlapScore(a: string[], b: string[]): { ratio: number; overlap: number } {
  if (a.length === 0 || b.length === 0) return { ratio: 0, overlap: 0 };
  const bSet = new Set(b);
  let overlap = 0;
  for (const token of a) {
    if (bSet.has(token)) overlap += 1;
  }
  return { ratio: overlap / Math.max(1, a.length), overlap };
}

function expectedActForBeat(
  beatId: string,
  categoryIndex: number | null,
  categoryCount: number
): "ACT1" | "ACT2" | "ACT3" | "ACT4" | undefined {
  if (beatId === "INTRO") return "ACT1";
  if (beatId === "OUTRO") return "ACT4";
  if (categoryIndex === null || categoryCount <= 0) return undefined;
  const normalized = categoryCount <= 1 ? 0 : categoryIndex / Math.max(1, categoryCount - 1);
  if (normalized <= 0.24) return "ACT1";
  if (normalized <= 0.49) return "ACT2";
  if (normalized <= 0.74) return "ACT3";
  return "ACT4";
}

function expectedBlockIndex(beatIndex: number, totalBeats: number, blockCount: number): number {
  if (blockCount <= 1 || totalBeats <= 1) return 0;
  const progress = beatIndex / Math.max(1, totalBeats - 1);
  const idx = Math.round(progress * (blockCount - 1));
  return Math.max(0, Math.min(blockCount - 1, idx));
}

function buildStoryBeatsAlignmentReport(input: {
  storyBeats: z.infer<typeof StoryBeatsSchema> | null;
  chapterOutline: ReturnType<typeof parseChapterOutlineArtifact> | null;
  deck: ReturnType<typeof DeckSpecSchema.parse>;
  blockPlans?: Array<{ blockId: string; actId: "ACT1" | "ACT2" | "ACT3" | "ACT4"; start: number; end: number }>;
  adherenceMode: "strict" | "warn";
}) {
  if (!input.storyBeats) {
    return StoryBeatsAlignmentReportSchema.parse({
      schema_version: "1.0.0",
      workflow: "v2_micro_detectives",
      generated_at: nowIso(),
      story_beats_present: false,
      chapter_outline_present: Boolean(input.chapterOutline),
      required_markers: {
        opener_motif: false,
        midpoint_false_theory_collapse: false,
        ending_callback: false,
        detective_deputy_rupture_repair: false
      },
      coverage: {
        total_beats: 0,
        mapped_beats: 0,
        mapped_ratio: 0,
        block_aligned_beats: 0,
        block_aligned_ratio: 0
      },
      block_coverage: [],
      beat_slide_map: [],
      mapped_topic_area_ids: [],
      missing_topic_area_ids: [],
      lint_status: "pass",
      warnings: []
    });
  }

  const categoryByTopicAreaId = new Map<string, { index: number; title: string }>();
  if (input.chapterOutline) {
    for (const [categoryIndex, category] of input.chapterOutline.chapter_outline.categories.entries()) {
      for (const topic of category.topic_areas) {
        categoryByTopicAreaId.set(topic.id, { index: categoryIndex, title: category.title });
      }
    }
  }

  const topicalBeatNodes = Object.values(input.storyBeats.topic_area_beats).filter((node) => node.beat_md.trim().length > 0);
  const introBeat = input.storyBeats.intro.beat_md.trim().length > 0 ? [{ id: "INTRO", text: input.storyBeats.intro.beat_md }] : [];
  const outroBeat = input.storyBeats.outro.beat_md.trim().length > 0 ? [{ id: "OUTRO", text: input.storyBeats.outro.beat_md }] : [];
  const beatRows = [
    ...topicalBeatNodes.map((node) => ({
      id: node.topic_area_id,
      text: `${node.topic_area_title}\n${node.outline_md}\n${node.user_notes}\n${node.beat_md}`,
      categoryIndex: categoryByTopicAreaId.get(node.topic_area_id)?.index ?? null
    })),
    ...introBeat.map((row) => ({ ...row, categoryIndex: null as number | null })),
    ...outroBeat.map((row) => ({ ...row, categoryIndex: null as number | null }))
  ];

  const blockPlans =
    input.blockPlans && input.blockPlans.length > 0
      ? input.blockPlans
      : [
          {
            blockId: "AUTO_BLOCK_01",
            actId: "ACT1" as const,
            start: 1,
            end: Math.max(1, input.deck.slides.length)
          }
        ];
  const slideToBlock = new Map<string, { blockId: string; blockIndex: number; actId: "ACT1" | "ACT2" | "ACT3" | "ACT4" }>();
  for (const [idx, plan] of blockPlans.entries()) {
    for (let n = Math.max(1, Math.round(plan.start)); n <= Math.max(1, Math.round(plan.end)); n += 1) {
      slideToBlock.set(`S${String(n).padStart(2, "0")}`, { blockId: plan.blockId, blockIndex: idx, actId: plan.actId });
      slideToBlock.set(`S${String(n).padStart(3, "0")}`, { blockId: plan.blockId, blockIndex: idx, actId: plan.actId });
    }
  }

  const deckRows = input.deck.slides.map((slide) => ({
    slideId: slide.slide_id,
    beatType: slide.beat_type,
    actId: slide.act_id,
    block: slideToBlock.get(slide.slide_id),
    tokens: semanticTokens(
      `${slide.title ?? ""}\n${slide.hook}\n${slide.story_panel.goal}\n${slide.story_panel.opposition}\n${slide.story_panel.turn}\n${slide.story_panel.decision}\n${
        slide.speaker_notes.narrative_notes ?? ""
      }\n${slide.speaker_notes.medical_reasoning}`
    )
  }));

  const mappedIds: string[] = [];
  const missingIds: string[] = [];
  const beatSlideMap: Array<{
    beat_id: string;
    expected_act_id?: "ACT1" | "ACT2" | "ACT3" | "ACT4";
    matched_slide_id?: string;
    matched_act_id?: "ACT1" | "ACT2" | "ACT3" | "ACT4";
    matched_block_id?: string;
    overlap_ratio: number;
    overlap_tokens: number;
    mapped: boolean;
    block_aligned: boolean;
  }> = [];
  const blockExpected = new Map<string, number>();
  const blockMapped = new Map<string, number>();
  let blockAlignedCount = 0;
  for (const [beatIdx, beat] of beatRows.entries()) {
    const beatTokens = semanticTokens(beat.text);
    const expectedAct = expectedActForBeat(
      beat.id,
      beat.categoryIndex,
      input.chapterOutline ? input.chapterOutline.chapter_outline.categories.length : 0
    );
    const expectedBlockIdx = expectedBlockIndex(beatIdx, beatRows.length, blockPlans.length);
    const expectedBlockId = blockPlans[expectedBlockIdx]?.blockId ?? blockPlans[0]?.blockId;
    if (expectedBlockId) blockExpected.set(expectedBlockId, (blockExpected.get(expectedBlockId) ?? 0) + 1);
    if (beatTokens.length === 0) {
      missingIds.push(beat.id);
      beatSlideMap.push({
        beat_id: beat.id,
        expected_act_id: expectedAct,
        overlap_ratio: 0,
        overlap_tokens: 0,
        mapped: false,
        block_aligned: false
      });
      continue;
    }
    let bestRatio = 0;
    let bestOverlap = 0;
    let bestBeatType = "";
    let bestSlideId = "";
    let bestActId: "ACT1" | "ACT2" | "ACT3" | "ACT4" | undefined;
    let bestBlockId: string | undefined;
    let bestBlockIndex = -1;
    for (const slide of deckRows) {
      const { ratio: rowRatio, overlap } = overlapScore(beatTokens, slide.tokens);
      if (rowRatio > bestRatio || (rowRatio === bestRatio && overlap > bestOverlap)) {
        bestRatio = rowRatio;
        bestOverlap = overlap;
        bestBeatType = slide.beatType;
        bestSlideId = slide.slideId;
        bestActId = slide.actId === "ACT1" || slide.actId === "ACT2" || slide.actId === "ACT3" || slide.actId === "ACT4" ? slide.actId : undefined;
        bestBlockId = slide.block?.blockId;
        bestBlockIndex = slide.block?.blockIndex ?? -1;
      }
    }
    const passesOverlap = bestOverlap >= 2 && bestRatio >= 0.18;
    const introOutroBeatTypeOk =
      beat.id !== "INTRO" && beat.id !== "OUTRO"
        ? true
        : beat.id === "INTRO"
          ? ["cold_open", "case_intake", "first_dive"].includes(bestBeatType)
          : ["showdown", "proof", "aftermath"].includes(bestBeatType);
    const expectedActSatisfied =
      !expectedAct ||
      (bestActId === expectedAct ||
        (expectedAct === "ACT2" && bestActId === "ACT3") ||
        (expectedAct === "ACT3" && bestActId === "ACT2"));
    const blockAligned = bestBlockIndex >= 0 && Math.abs(bestBlockIndex - expectedBlockIdx) <= 1;
    if (passesOverlap && introOutroBeatTypeOk && expectedActSatisfied) {
      mappedIds.push(beat.id);
      if (bestBlockId) blockMapped.set(bestBlockId, (blockMapped.get(bestBlockId) ?? 0) + 1);
      if (blockAligned) blockAlignedCount += 1;
    } else {
      missingIds.push(beat.id);
    }
    beatSlideMap.push({
      beat_id: beat.id,
      expected_act_id: expectedAct,
      matched_slide_id: bestSlideId || undefined,
      matched_act_id: bestActId,
      matched_block_id: bestBlockId,
      overlap_ratio: bestRatio,
      overlap_tokens: bestOverlap,
      mapped: passesOverlap && introOutroBeatTypeOk && expectedActSatisfied,
      block_aligned: blockAligned
    });
  }

  const totalBeats = beatRows.length;
  const ratio = totalBeats > 0 ? mappedIds.length / totalBeats : 0;
  const blockAlignedRatio = totalBeats > 0 ? blockAlignedCount / totalBeats : 0;
  const blockCoverage = blockPlans.map((plan) => {
    const expectedBeats = blockExpected.get(plan.blockId) ?? 0;
    const mappedBeats = blockMapped.get(plan.blockId) ?? 0;
    return {
      block_id: plan.blockId,
      expected_beats: expectedBeats,
      mapped_beats: mappedBeats,
      mapped_ratio: expectedBeats > 0 ? mappedBeats / expectedBeats : mappedBeats > 0 ? 1 : 0
    };
  });
  const markers = storyBeatsMarkerCoverage(input.storyBeats);
  const warnings: string[] = [];

  if (!input.chapterOutline) warnings.push("Chapter outline missing; topic-area beat alignment cannot use outline grounding.");
  if (totalBeats === 0) warnings.push("No generated beats found (intro/outro/topic beats are empty).");
  if (ratio < 0.82) warnings.push(`Story-beat mapping coverage is low (${Math.round(ratio * 100)}%).`);
  if (blockAlignedRatio < 0.72) warnings.push(`Story-beat block alignment is low (${Math.round(blockAlignedRatio * 100)}%).`);
  if (!markers.opener_motif) warnings.push("Story beats missing clear opener motif signal.");
  if (!markers.midpoint_false_theory_collapse) warnings.push("Story beats missing midpoint false-theory collapse signal.");
  if (!markers.ending_callback) warnings.push("Story beats missing ending callback signal.");
  if (!markers.detective_deputy_rupture_repair) warnings.push("Story beats missing detective/deputy rupture+repair signal.");
  if (!mappedIds.includes("INTRO") && introBeat.length > 0) warnings.push("Intro beat did not map cleanly to ACT1 opening slides.");
  if (!mappedIds.includes("OUTRO") && outroBeat.length > 0) warnings.push("Outro beat did not map cleanly to ACT4 closing slides.");

  const lintStatus: "pass" | "warn" | "fail" =
    warnings.length === 0 ? "pass" : input.adherenceMode === "strict" ? "fail" : "warn";

  return StoryBeatsAlignmentReportSchema.parse({
    schema_version: "1.0.0",
    workflow: "v2_micro_detectives",
    generated_at: nowIso(),
    story_beats_present: true,
    chapter_outline_present: Boolean(input.chapterOutline),
    required_markers: markers,
    coverage: {
      total_beats: totalBeats,
      mapped_beats: mappedIds.length,
      mapped_ratio: ratio,
      block_aligned_beats: blockAlignedCount,
      block_aligned_ratio: blockAlignedRatio
    },
    block_coverage: blockCoverage,
    beat_slide_map: beatSlideMap,
    mapped_topic_area_ids: mappedIds,
    missing_topic_area_ids: missingIds,
    lint_status: lintStatus,
    warnings
  });
}

function stampDeckProvenance(
  deck: ReturnType<typeof DeckSpecSchema.parse>,
  options?: { seedFromDeterministic?: boolean }
): ReturnType<typeof DeckSpecSchema.parse> {
  const seedFromDeterministic = options?.seedFromDeterministic === true;
  const slides = deck.slides.map((slide) => ({
    ...slide,
    authoring_provenance: seedFromDeterministic
      ? "deterministic_scaffold"
      : slide.authoring_provenance ?? "agent_authored"
  }));
  const counts = {
    agent_authored: slides.filter((slide) => slide.authoring_provenance === "agent_authored").length,
    deterministic_scaffold: slides.filter((slide) => slide.authoring_provenance === "deterministic_scaffold").length,
    patched_scaffold: slides.filter((slide) => slide.authoring_provenance === "patched_scaffold").length
  };
  const scaffoldCount = counts.deterministic_scaffold + counts.patched_scaffold;
  const scaffoldRatio = slides.length > 0 ? scaffoldCount / slides.length : 0;
  return DeckSpecSchema.parse({
    ...deck,
    deck_meta: {
      ...deck.deck_meta,
      authoring_provenance_counts: counts,
      authoring_scaffold_ratio: scaffoldRatio
    },
    slides
  });
}

function canonicalSlideIdKey(slideId: string | undefined | null): string {
  const raw = String(slideId ?? "").trim();
  if (raw.length === 0) return "";
  const numeric = raw.match(/\d+/)?.[0];
  if (numeric) {
    const normalized = String(Number(numeric));
    return normalized === "NaN" ? raw.toUpperCase() : normalized;
  }
  return raw.toUpperCase();
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

function collectDossierCitationIds(dossier: DiseaseDossier): Set<string> {
  const ids = new Set<string>();
  for (const citation of dossier.citations) {
    const id = String(citation.citation_id || "").trim();
    if (id.length > 0) ids.add(id);
  }
  for (const section of dossier.sections) {
    for (const citation of section.citations) {
      const id = String(citation.citation_id || "").trim();
      if (id.length > 0) ids.add(id);
    }
  }
  return ids;
}

function collectDossierCitationPool(dossier: DiseaseDossier): DiseaseDossier["citations"] {
  const out: DiseaseDossier["citations"] = [];
  const seen = new Set<string>();

  const pushCitation = (citation: DiseaseDossier["citations"][number]): void => {
    const citationId = String(citation.citation_id || "").trim();
    const claim = String(citation.claim || "").trim();
    if (citationId.length === 0 || claim.length === 0) return;
    const chunkId = typeof citation.chunk_id === "string" && citation.chunk_id.trim().length > 0 ? citation.chunk_id.trim() : undefined;
    const locator = typeof citation.locator === "string" && citation.locator.trim().length > 0 ? citation.locator.trim() : undefined;
    const key = `${citationId}::${claim}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      citation_id: citationId,
      claim,
      ...(chunkId ? { chunk_id: chunkId } : {}),
      ...(locator ? { locator } : {})
    });
  };

  for (const citation of dossier.citations) pushCitation(citation);
  for (const section of dossier.sections) {
    for (const citation of section.citations) pushCitation(citation);
  }

  if (out.length === 0) {
    out.push({
      citation_id: "CIT-KB-001",
      claim: `Fallback grounding for ${dossier.canonical_name || dossier.disease_request.disease_topic || "episode"}`,
      locator: "kb_context.md"
    });
  }

  return out;
}

function fallbackCitationFromPool(
  citationPool: DiseaseDossier["citations"],
  claim: string
): DiseaseDossier["citations"][number] {
  const first = citationPool[0] ?? {
    citation_id: "CIT-KB-001",
    claim: "Fallback grounding for episode.",
    locator: "kb_context.md"
  };
  return {
    citation_id: first.citation_id,
    claim: String(claim || "").trim() || first.claim,
    ...(first.chunk_id ? { chunk_id: first.chunk_id } : {}),
    ...(first.locator ? { locator: first.locator } : {})
  };
}

function normalizeCitationRefs(citations: unknown): Array<z.infer<typeof CitationRefSchema>> {
  if (!Array.isArray(citations)) return [];
  const out: Array<z.infer<typeof CitationRefSchema>> = [];
  const seen = new Set<string>();

  for (const raw of citations) {
    if (!raw || typeof raw !== "object") continue;
    const citationId = String((raw as { citation_id?: unknown }).citation_id ?? "").trim();
    const claim = String((raw as { claim?: unknown }).claim ?? "").trim();
    if (citationId.length === 0 || claim.length === 0) continue;
    const chunkIdRaw = (raw as { chunk_id?: unknown }).chunk_id;
    const locatorRaw = (raw as { locator?: unknown }).locator;
    const chunkId = typeof chunkIdRaw === "string" ? chunkIdRaw.trim() : "";
    const locator = typeof locatorRaw === "string" ? locatorRaw.trim() : "";
    const key = `${citationId}::${claim}::${chunkId}::${locator}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      citation_id: citationId,
      claim,
      ...(chunkId.length > 0 ? { chunk_id: chunkId } : {}),
      ...(locator.length > 0 ? { locator } : {})
    });
  }

  return out;
}

function extractIssueSlideIds(issue: MedFactcheckReport["issues"][number]): string[] {
  const joined = [issue.claim, issue.why_wrong, issue.suggested_fix].join(" ");
  const matches = joined.match(/\b(?:S\d{1,3}|A-\d{1,3})\b/g) ?? [];
  const out: string[] = [];
  const seen = new Set<string>();

  for (const match of matches) {
    const normalized = canonicalSlideIdKey(match);
    if (normalized.length === 0 || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(match);
  }

  return out;
}

function collectSlideCitationRefs(slide: DeckSlideSpec): Array<z.infer<typeof CitationRefSchema>> {
  return normalizeCitationRefs([...(slide.medical_payload.dossier_citations ?? []), ...(slide.speaker_notes.citations ?? [])]);
}

const VALID_BEAT_TYPES = new Set(BeatTypeSchema.options);

function normalizeBeatType(
  rawBeatType: unknown,
  baseSlide?: DeckSlideSpec,
  fallbackActId?: string
): z.infer<typeof BeatTypeSchema> {
  const normalized = String(rawBeatType ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");

  if (VALID_BEAT_TYPES.has(normalized as z.infer<typeof BeatTypeSchema>)) {
    return normalized as z.infer<typeof BeatTypeSchema>;
  }

  const aliasMap: Record<string, z.infer<typeof BeatTypeSchema>> = {
    intro: "cold_open",
    opening: "cold_open",
    opening_hook: "cold_open",
    opening_scene: "cold_open",
    case_intro: "case_intake",
    intake: "case_intake",
    first_entry: "first_dive",
    dive: "first_dive",
    clue: "clue_discovery",
    suspect: "suspect_intro",
    redherring: "red_herring",
    red_herring_reveal: "red_herring",
    action: "action_setpiece",
    action_sequence: "action_setpiece",
    action_scene: "action_setpiece",
    action_set_piece: "action_setpiece",
    setpiece: "action_setpiece",
    set_piece: "action_setpiece",
    theory: "theory_update",
    false_theory: "false_theory_lock_in",
    lock_in: "false_theory_lock_in",
    collapse: "false_theory_collapse",
    twist_reveal: "twist",
    reveal: "twist",
    proof_trap: "proof",
    finale: "showdown",
    final_showdown: "showdown",
    resolution: "aftermath",
    outro: "aftermath",
    appendix_slide: "appendix"
  };

  if (aliasMap[normalized]) return aliasMap[normalized];

  if (normalized.includes("action") || normalized.includes("setpiece")) return "action_setpiece";
  if (normalized.includes("false") && normalized.includes("collapse")) return "false_theory_collapse";
  if (normalized.includes("false") && normalized.includes("theory")) return "false_theory_lock_in";
  if (normalized.includes("twist") || normalized.includes("reveal")) return "twist";
  if (normalized.includes("showdown") || normalized.includes("finale")) return "showdown";
  if (normalized.includes("after")) return "aftermath";
  if (normalized.includes("proof")) return "proof";
  if (normalized.includes("clue")) return "clue_discovery";
  if (normalized.includes("suspect")) return "suspect_intro";
  if (normalized.includes("red") && normalized.includes("herring")) return "red_herring";
  if (normalized.includes("dive")) return "first_dive";

  if (baseSlide) return baseSlide.beat_type;

  switch (String(fallbackActId ?? "").trim().toUpperCase()) {
    case "ACT1":
      return "clue_discovery";
    case "ACT2":
      return "red_herring";
    case "ACT3":
      return "reversal";
    case "ACT4":
      return "showdown";
    case "APPENDIX":
      return "appendix";
    default:
      return "clue_discovery";
  }
}

function normalizeSlideBlockAuthorOutput(
  raw: z.infer<typeof SlideBlockAgentOutputSchema>,
  currentDeck: DeckSpec
): z.infer<typeof SlideBlockSchema> {
  const slideMap = new Map<string, DeckSlideSpec>();
  for (const slide of [...currentDeck.slides, ...currentDeck.appendix_slides]) {
    slideMap.set(canonicalSlideIdKey(slide.slide_id), slide);
  }

  const normalizeReplacementSlide = (slide: Record<string, unknown>): Record<string, unknown> => {
    const slideId = String(slide.slide_id ?? "").trim();
    const baseSlide = slideMap.get(canonicalSlideIdKey(slideId));
    const speakerNotesRaw =
      slide.speaker_notes && typeof slide.speaker_notes === "object"
        ? ({ ...(slide.speaker_notes as Record<string, unknown>) })
        : {};
    const medicalPayloadRaw =
      slide.medical_payload && typeof slide.medical_payload === "object"
        ? (slide.medical_payload as Record<string, unknown>)
        : {};
    const supportingDetails = Array.isArray(medicalPayloadRaw.supporting_details)
      ? medicalPayloadRaw.supporting_details.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
    const medicalReasoning =
      String(speakerNotesRaw.medical_reasoning ?? "").trim() ||
      baseSlide?.speaker_notes.medical_reasoning ||
      supportingDetails[0] ||
      `Explain how ${String(medicalPayloadRaw.major_concept_id ?? "the current major concept").trim() || "this slide"} updates the working diagnosis.`;
    const citations = normalizeCitationRefs([
      ...(Array.isArray(speakerNotesRaw.citations) ? speakerNotesRaw.citations : []),
      ...(Array.isArray(medicalPayloadRaw.dossier_citations) ? medicalPayloadRaw.dossier_citations : []),
      ...(baseSlide ? collectSlideCitationRefs(baseSlide) : [])
    ]);
    const rawDifferential =
      speakerNotesRaw.differential_update && typeof speakerNotesRaw.differential_update === "object"
        ? (speakerNotesRaw.differential_update as Record<string, unknown>)
        : null;
    const baseDifferential = baseSlide?.speaker_notes.differential_update;
    const rawTopDxIds = Array.isArray(rawDifferential?.top_dx_ids) ? rawDifferential.top_dx_ids : null;
    const rawEliminatedDxIds = Array.isArray(rawDifferential?.eliminated_dx_ids) ? rawDifferential.eliminated_dx_ids : null;
    const topDxIds = (rawTopDxIds ?? baseDifferential?.top_dx_ids ?? [])
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0);
    const eliminatedDxIds = (rawEliminatedDxIds ?? baseDifferential?.eliminated_dx_ids ?? []).filter(
      (item): item is string => typeof item === "string" && item.trim().length > 0
    );
    const differentialWhy =
      String(rawDifferential?.why ?? "").trim() ||
      baseDifferential?.why ||
      `Reassess ${String(medicalPayloadRaw.major_concept_id ?? "the working diagnosis").trim() || "the working diagnosis"} after this beat.`;
    const beatType = normalizeBeatType(slide.beat_type, baseSlide, String(slide.act_id ?? baseSlide?.act_id ?? ""));
    const actId = String(slide.act_id ?? baseSlide?.act_id ?? "ACT1").trim().toUpperCase();
    const resolvedActId = actId === "ACT2" || actId === "ACT3" || actId === "ACT4" || actId === "APPENDIX" ? actId : "ACT1";

    return {
      slide_id: slideId || baseSlide?.slide_id || "S01",
      act_id: resolvedActId,
      beat_type: beatType,
      template_id: String(slide.template_id ?? baseSlide?.template_id ?? "T04_CLUE_DISCOVERY"),
      title: slide.title,
      on_slide_text: slide.on_slide_text ?? baseSlide?.on_slide_text,
      visual_description: slide.visual_description ?? baseSlide?.visual_description ?? "Describe the visual evidence in scene.",
      exhibit_ids: slide.exhibit_ids ?? baseSlide?.exhibit_ids,
      story_panel: slide.story_panel ?? baseSlide?.story_panel,
      medical_payload: slide.medical_payload ?? baseSlide?.medical_payload,
      pressure_channels_advanced: slide.pressure_channels_advanced ?? baseSlide?.pressure_channels_advanced,
      hook: slide.hook ?? baseSlide?.hook ?? "Advance the case with a concrete clue.",
      authoring_provenance: slide.authoring_provenance ?? baseSlide?.authoring_provenance ?? "agent_authored",
      appendix_links: slide.appendix_links ?? baseSlide?.appendix_links,
      speaker_notes: {
        ...(baseSlide?.speaker_notes ?? {}),
        ...speakerNotesRaw,
        medical_reasoning: medicalReasoning,
        differential_update: {
          top_dx_ids: topDxIds.length > 0 ? topDxIds : ["DX_CAP_ADULT"],
          eliminated_dx_ids: eliminatedDxIds,
          why: differentialWhy
        },
        citations
      }
    };
  };

  const normalizedOperations = (raw.operations ?? []).map((operation) => {
    const normalized: Record<string, unknown> = {
      op: operation.op,
      slide_id: operation.slide_id,
      after_slide_id: operation.after_slide_id,
      start_slide_id: operation.start_slide_id,
      end_slide_id: operation.end_slide_id,
      reason: operation.reason
    };
    if (operation.replacement_slide && typeof operation.replacement_slide === "object") {
      normalized.replacement_slide = normalizeReplacementSlide(operation.replacement_slide as Record<string, unknown>);
    }
    if (Array.isArray(operation.replacement_slides)) {
      normalized.replacement_slides = operation.replacement_slides.map((slide) =>
        normalizeReplacementSlide(slide as Record<string, unknown>)
      );
    }
    return normalized;
  });

  const normalizedBlock: Record<string, unknown> = {
    schema_version: raw.schema_version,
    block_id: raw.block_id,
    act_id: raw.act_id,
    slide_range: raw.slide_range,
    prior_block_summary: raw.prior_block_summary,
    unresolved_threads_in: raw.unresolved_threads_in,
    slide_overrides: raw.slide_overrides,
    operations: normalizedOperations,
    unresolved_threads_out: raw.unresolved_threads_out,
    block_summary_out: raw.block_summary_out
  };

  return SlideBlockSchema.parse({
    ...normalizedBlock
  });
}

export { normalizeSlideBlockAuthorOutput as __testOnlyNormalizeSlideBlockAuthorOutput };
export { resolveQaLoopBudget as __testOnlyResolveQaLoopBudget };
export { inferOutlineActForPlan as __testOnlyInferOutlineActForPlan };
export { resolveStructuralBlockIndexes as __testOnlyResolveStructuralBlockIndexes };
export { compactMedicalSliceForBlock as __testOnlyCompactMedicalSliceForBlock };
export { buildDiseaseResearchSourceReport as __testOnlyBuildDiseaseResearchSourceReport };
export { preferredBlockSize as __testOnlyPreferredBlockSize };
export { stripInternalQualityResidue as __testOnlyStripInternalQualityResidue };
export { stabilizeQualityDeckArtifacts as __testOnlyStabilizeQualityDeckArtifacts };

function normalizeMedFactcheckReport(
  report: MedFactcheckAgentOutput | MedFactcheckReport,
  deck: DeckSpec,
  dossier: DiseaseDossier
): MedFactcheckReport {
  const citationPool = collectDossierCitationPool(dossier);
  const slideMap = new Map<string, DeckSlideSpec>();
  for (const slide of [...deck.slides, ...deck.appendix_slides]) {
    slideMap.set(canonicalSlideIdKey(slide.slide_id), slide);
  }

  const issues = report.issues.map((issue, index) => {
    let supportingCitations = normalizeCitationRefs(issue.supporting_citations);

    if (supportingCitations.length === 0) {
      const recovered: Array<z.infer<typeof CitationRefSchema>> = [];
      for (const slideId of extractIssueSlideIds(issue)) {
        const slide = slideMap.get(canonicalSlideIdKey(slideId));
        if (!slide) continue;
        recovered.push(...collectSlideCitationRefs(slide));
      }
      supportingCitations = normalizeCitationRefs(recovered);
    }

    if (supportingCitations.length === 0) {
      supportingCitations = [
        fallbackCitationFromPool(
          citationPool,
          issue.claim || issue.suggested_fix || issue.why_wrong || `Med factcheck issue ${issue.issue_id || index + 1}`
        )
      ];
    }

    return {
      ...issue,
      supporting_citations: supportingCitations
    };
  });

  const pass = issues.length === 0;
  const requiredFixes =
    Array.isArray(report.required_fixes) && report.required_fixes.length > 0
      ? report.required_fixes
      : pass
        ? []
        : issues.map((issue, idx) => ({
            fix_id: `MED-FIX-${String(idx + 1).padStart(3, "0")}`,
            type: medIssueToFixType(issue.type),
            priority: issue.severity === "critical" ? "must" : issue.severity === "major" ? "should" : "could",
            description: issue.suggested_fix,
            targets: [issue.claim.match(/\b(?:S\d{2,3}|A-\d{2,3})\b/)?.[0] ?? "deck_spec.json"]
          }));

  return MedFactcheckReportSchema.parse({
    ...report,
    pass,
    issues,
    summary:
      String(report.summary || "").trim() ||
      (pass ? "Medical factcheck passed after normalization." : `Medical factcheck found ${issues.length} issue(s).`),
    required_fixes: requiredFixes
  });
}

export { normalizeMedFactcheckReport as __testOnlyNormalizeMedFactcheckReport };

function applyDiseaseResearchGroundingChecks(input: {
  report: MedFactcheckReport;
  sourceReport: ReturnType<typeof DiseaseResearchSourceReportSchema.parse> | null;
  dossier: DiseaseDossier;
  generationProfile: GenerationProfile;
}): MedFactcheckReport {
  if (!input.sourceReport) return input.report;

  const webDominantSections = input.sourceReport.sections.filter(
    (section) => section.dominant_source === "web" && section.curated_citations === 0 && section.fallback_reason
  );
  if (webDominantSections.length === 0) return input.report;

  const citationPool = collectDossierCitationPool(input.dossier);
  const issues = [...input.report.issues];
  const requiredFixes = [...input.report.required_fixes];

  for (const [index, section] of webDominantSections.entries()) {
    const token = section.section.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || `SECTION_${index + 1}`;
    const issueId = `GROUNDING-${token}`;
    if (!issues.some((issue) => issue.issue_id === issueId)) {
      issues.push({
        issue_id: issueId,
        severity: input.generationProfile === "quality" ? "major" : "minor",
        type: "other",
        claim: `Section "${section.section}" relies on web-only grounding despite curated evidence availability.`,
        why_wrong: section.fallback_reason!,
        suggested_fix: `Reground the "${section.section}" section with vector-store / KB evidence before using web-only support.`,
        supporting_citations: [fallbackCitationFromPool(citationPool, `${section.section} curated grounding fallback`)]
      });
    }
    const fixId = `GROUNDING-FIX-${token}`;
    if (!requiredFixes.some((fix) => fix.fix_id === fixId)) {
      requiredFixes.push({
        fix_id: fixId,
        type: "medical_correction",
        priority: input.generationProfile === "quality" ? "must" : "should",
        description: `Replace web-only grounding in "${section.section}" with curated/vector evidence where available.`,
        targets: ["disease_dossier.json", section.section]
      });
    }
  }

  return MedFactcheckReportSchema.parse({
    ...input.report,
    pass: false,
    issues,
    summary: `${input.report.summary} Added ${webDominantSections.length} curated-grounding warning(s).`.trim(),
    required_fixes: requiredFixes
  });
}

export { applyDiseaseResearchGroundingChecks as __testOnlyApplyDiseaseResearchGroundingChecks };

function normalizeMicroWorldMapOutput(
  raw: unknown,
  dossier: DiseaseDossier,
  truth: TruthModel,
  topic: string
): { microWorldMap: ReturnType<typeof MicroWorldMapSchema.parse>; repairedCitationBuckets: number } {
  const parsed = MicroWorldMapAgentOutputSchema.parse(raw);
  const citationPool = collectDossierCitationPool(dossier);
  let repairedCitationBuckets = 0;

  const ensureCitations = (
    citations: DiseaseDossier["citations"] | undefined,
    fallbackClaim: string
  ): DiseaseDossier["citations"] => {
    if (Array.isArray(citations) && citations.length > 0) return citations;
    repairedCitationBuckets += 1;
    return [fallbackCitationFromPool(citationPool, fallbackClaim)];
  };

  const normalized = {
    ...parsed,
    zones: parsed.zones.map((zone, index) => ({
      ...zone,
      citations: ensureCitations(
        zone.citations,
        `${zone.name || `Zone ${index + 1}`} anchors the ${topic} micro-world geography at ${zone.anatomic_location}.`
      )
    })),
    hazards: parsed.hazards.map((hazard, index) => ({
      ...hazard,
      citations: ensureCitations(
        hazard.citations,
        `${hazard.hazard_id || `hazard-${index + 1}`} reflects ${hazard.links_to_pathophysiology || truth.final_diagnosis.name}.`
      )
    })),
    routes: parsed.routes.map((route, index) => ({
      ...route,
      citations: ensureCitations(
        route.citations,
        `${route.route_id || `route-${index + 1}`} connects ${route.from_zone_id} to ${route.to_zone_id} for the ${topic} case map.`
      )
    })),
    immune_law_enforcement_metaphors: parsed.immune_law_enforcement_metaphors?.map((entry, index) => ({
      ...entry,
      citations: ensureCitations(
        entry.citations,
        `${entry.actor || `Immune actor ${index + 1}`} metaphor stays grounded in the ${truth.final_diagnosis.name} immune response.`
      )
    })),
    visual_style_guide: {
      ...parsed.visual_style_guide,
      citations: ensureCitations(
        parsed.visual_style_guide.citations,
        `Visual style guidance for ${topic} preserves readable medically grounded micro-world scenes.`
      )
    }
  };

  return {
    microWorldMap: MicroWorldMapSchema.parse(normalized),
    repairedCitationBuckets
  };
}

function normalizeDramaPlanOutput(
  raw: unknown,
  truth: TruthModel
): { dramaPlan: ReturnType<typeof DramaPlanSchema.parse>; repairedDebtBuckets: number } {
  const parsed = DramaPlanAgentOutputSchema.parse(raw);
  let repairedDebtBuckets = 0;

  const normalized = {
    ...parsed,
    chapter_or_act_setups: (parsed.chapter_or_act_setups ?? []).map((setup) => {
      const debtSeed = trimList(setup.must_pay_by_end_of_act, 3, 180);
      if (debtSeed.length > 0) {
        return {
          ...setup,
          must_pay_by_end_of_act: debtSeed
        };
      }
      repairedDebtBuckets += 1;
      const fallbackDebt = trimList(
        [
          setup.relationship_change_due_to_case,
          setup.act_specific_emotionally_costly_clue,
          ...setup.required_choices,
          ...setup.required_emotional_beats,
          `${setup.act_id} must visibly pay off the evolving ${truth.final_diagnosis.name} case pressure.`
        ],
        3,
        180
      );
      return {
        ...setup,
        must_pay_by_end_of_act:
          fallbackDebt.length > 0
            ? fallbackDebt
            : [`${setup.act_id} must pay a concrete case debt before the act ends.`]
      };
    })
  };

  return {
    dramaPlan: DramaPlanSchema.parse(normalized),
    repairedDebtBuckets
  };
}

function validateTruthLockCitations(dossier: DiseaseDossier, truth: TruthModel): { pass: boolean; issues: string[]; knownCitationCount: number } {
  const issues: string[] = [];
  const knownCitationIds = collectDossierCitationIds(dossier);

  if (knownCitationIds.size === 0) {
    issues.push("Disease dossier has no citation IDs available for truth-lock validation.");
  }

  const finalDxId = String(truth.final_diagnosis.dx_id || "")
    .trim()
    .toUpperCase();
  const coverStoryDxIds = truth.cover_story.initial_working_dx_ids
    .map((dxId) => String(dxId || "").trim().toUpperCase())
    .filter((dxId) => dxId.length > 0);
  if (finalDxId.length > 0 && coverStoryDxIds.includes(finalDxId)) {
    issues.push(`Truth lock violation: final diagnosis ${finalDxId} appears in cover_story.initial_working_dx_ids.`);
  }

  const seenTimelineCitationIds = new Set<string>();
  const validateTimeline = (
    label: "macro_timeline" | "micro_timeline",
    events: Array<{ event_id: string; citations: Array<{ citation_id: string }> }>
  ): void => {
    for (const [eventIdx, event] of events.entries()) {
      for (const [citationIdx, citation] of event.citations.entries()) {
        const citationId = String(citation.citation_id || "").trim();
        if (citationId.length === 0) {
          issues.push(`${label}[${eventIdx}] (${event.event_id}) has an empty citation_id at index ${citationIdx}.`);
          continue;
        }
        seenTimelineCitationIds.add(citationId);
        if (!knownCitationIds.has(citationId)) {
          issues.push(`${label}[${eventIdx}] (${event.event_id}) references unknown citation_id ${citationId}.`);
        }
      }
    }
  };

  validateTimeline("macro_timeline", truth.macro_timeline);
  validateTimeline("micro_timeline", truth.micro_timeline);

  if (seenTimelineCitationIds.size === 0) {
    issues.push("Truth model timelines have no citation IDs after normalization.");
  }

  return {
    pass: issues.length === 0,
    issues,
    knownCitationCount: knownCitationIds.size
  };
}

function normalizeTruthModelForTruthLock(truth: TruthModel): { truthModel: TruthModel; repairs: string[] } {
  const repairs: string[] = [];
  const finalDxId = String(truth.final_diagnosis.dx_id || "")
    .trim()
    .toUpperCase();
  const seen = new Set<string>();
  const filteredWorkingDxIds = truth.cover_story.initial_working_dx_ids
    .map((dxId) => String(dxId || "").trim())
    .filter((dxId) => dxId.length > 0)
    .filter((dxId) => {
      const normalized = dxId.toUpperCase();
      if (normalized === finalDxId) {
        repairs.push(`removed_final_dx_from_cover_story:${dxId}`);
        return false;
      }
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });

  const baseAltToken = finalDxId.length > 0 ? finalDxId.replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "") : "DX-ALT";
  let altIndex = 0;
  while (filteredWorkingDxIds.length < 2) {
    const candidate = `${baseAltToken}-ALT-${String.fromCharCode(65 + altIndex)}`;
    altIndex += 1;
    const normalized = candidate.toUpperCase();
    if (normalized === finalDxId || seen.has(normalized)) continue;
    filteredWorkingDxIds.push(candidate);
    seen.add(normalized);
    repairs.push(`inserted_cover_story_mimic:${candidate}`);
  }

  if (repairs.length === 0) {
    return { truthModel: truth, repairs };
  }

  return {
    truthModel: TruthModelSchema.parse({
      ...truth,
      cover_story: {
        ...truth.cover_story,
        initial_working_dx_ids: filteredWorkingDxIds
      }
    }),
    repairs
  };
}

function medIssueToFixType(type: MedFactcheckReport["issues"][number]["type"]): MedFactcheckReport["required_fixes"][number]["type"] {
  if (type === "contradiction_with_dossier") return "edit_differential";
  if (type === "unsupported_inference" || type === "wrong_test_interpretation") return "edit_slide";
  if (type === "incorrect_fact" || type === "wrong_timecourse" || type === "wrong_treatment_response") return "medical_correction";
  return "other";
}

function mergeStrictMedFactcheckReports(agent: MedFactcheckReport, deterministic: MedFactcheckReport): MedFactcheckReport {
  const issueMap = new Map<string, MedFactcheckReport["issues"][number]>();
  for (const issue of [...agent.issues, ...deterministic.issues]) {
    const key = [issue.issue_id, issue.type, issue.claim, issue.why_wrong, issue.suggested_fix].join("|");
    const existing = issueMap.get(key);
    if (!existing) {
      issueMap.set(key, issue);
      continue;
    }
    issueMap.set(key, {
      ...existing,
      supporting_citations: normalizeCitationRefs([...(existing.supporting_citations ?? []), ...(issue.supporting_citations ?? [])])
    });
  }
  const mergedIssues = [...issueMap.values()];
  const pass = mergedIssues.length === 0;
  return MedFactcheckReportSchema.parse({
    schema_version: agent.schema_version || deterministic.schema_version || "1.0.0",
    pass,
    issues: mergedIssues,
    summary: pass
      ? "Strict med factcheck enforcement passed (agent + deterministic validators)."
      : `Strict med factcheck enforcement found ${mergedIssues.length} issue(s) (agent=${agent.issues.length}, deterministic=${deterministic.issues.length}).`,
    required_fixes: pass
      ? []
      : mergedIssues.map((issue, idx) => ({
          fix_id: `STRICT-FIX-${String(idx + 1).padStart(3, "0")}`,
          type: medIssueToFixType(issue.type),
          priority: issue.severity === "critical" ? "must" : issue.severity === "major" ? "should" : "could",
          description: issue.suggested_fix,
          targets: [issue.claim.match(/\b(?:S\d{2,3}|A-\d{2,3})\b/)?.[0] ?? "deck_spec.json"]
        }))
  });
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

function clipJsonForPrompt<T>(value: T, maxChars = 4_000): string {
  return clipExcerpt(JSON.stringify(value, null, 2), maxChars);
}

function buildDeckCohesionPrompt(input: {
  deck: ReturnType<typeof DeckSpecSchema.parse>;
  storyBlueprint: StoryBlueprint;
  actOutline: ActOutline;
  clueGraph: ClueGraph;
  dramaPlan: DramaPlan;
  setpiecePlan: SetpiecePlan;
  gate2Feedback: string;
  compact: boolean;
}): string {
  const guardrails =
    "COHESION PASS GUARDRAILS:\n" +
    "- This is a bounded continuity repair pass, not a second deck-authoring pass.\n" +
    "- Preserve the authored deck length and act structure; do not compress an act into a summary window.\n" +
    "- Prefer replace_slide, split_slide, or insert_after for local repairs.\n" +
    "- Use replace_window only for local beat clusters no larger than 6 contiguous slides, and keep replacement length nearly the same.\n" +
    "- Never rewrite multiple whole acts or collapse repeated beats into a short canonical mini-deck.\n" +
    "- Preserve clue/payoff fairness, midpoint collapse, rupture+repair, and ending callback without reducing story scope.";
  if (!input.compact) {
    return (
      `DECK SPEC (json):\n${JSON.stringify(input.deck, null, 2)}\n\n` +
      `STORY BLUEPRINT (json):\n${JSON.stringify(input.storyBlueprint, null, 2)}\n\n` +
      `ACT OUTLINE (json):\n${JSON.stringify(input.actOutline, null, 2)}\n\n` +
      `CLUE GRAPH (json):\n${JSON.stringify(input.clueGraph, null, 2)}\n\n` +
      `DRAMA PLAN (json):\n${JSON.stringify(input.dramaPlan, null, 2)}\n\n` +
      `SETPIECE PLAN (json):\n${JSON.stringify(input.setpiecePlan, null, 2)}\n\n` +
      `${guardrails}\n\n` +
      `GATE 2 FEEDBACK:\n${input.gate2Feedback}`
    );
  }

  const compactDeck = {
    deck_meta: input.deck.deck_meta,
    acts: input.deck.acts,
    slides: input.deck.slides.map((slide) => ({
      slide_id: slide.slide_id,
      act_id: slide.act_id,
      beat_type: slide.beat_type,
      title: clampText(String(slide.title ?? ""), 90),
      hook: clampText(String(slide.hook ?? ""), 120),
      story_panel: {
        goal: clampText(String(slide.story_panel.goal ?? ""), 120),
        opposition: clampText(String(slide.story_panel.opposition ?? ""), 120),
        turn: clampText(String(slide.story_panel.turn ?? ""), 120),
        decision: clampText(String(slide.story_panel.decision ?? ""), 120),
        consequence: clampText(String(slide.story_panel.consequence ?? ""), 120)
      },
      delivery_mode: slide.medical_payload.delivery_mode,
      major_concept_id: slide.medical_payload.major_concept_id,
      top_dx_ids: slide.speaker_notes.differential_update.top_dx_ids.slice(0, 3),
      exhibit_ids: (slide.exhibit_ids ?? []).slice(0, 4)
    }))
  };
  const compactClueGraph = {
    clue_count: input.clueGraph.clues.length,
    exhibit_count: input.clueGraph.exhibits.length,
    clues: input.clueGraph.clues.map((clue: ClueGraph["clues"][number]) => ({
      clue_id: clue.clue_id,
      macro_or_micro: clue.macro_or_micro,
      observed: clampText(clue.observed, 140),
      correct_inference: clampText(clue.correct_inference, 140),
      first_seen_slide_id: clue.first_seen_slide_id,
      payoff_slide_id: clue.payoff_slide_id
    })),
    twist_support_matrix: input.clueGraph.twist_support_matrix
  };
  const compactDramaPlan = {
    character_arcs: input.dramaPlan.character_arcs.map((arc) => ({
      character_id: arc.character_id,
      name: arc.name,
      core_need: clampText(arc.core_need, 120),
      core_fear: clampText(arc.core_fear, 120)
    })),
    relationship_arcs: input.dramaPlan.relationship_arcs.map((arc) => ({
      pair: arc.pair,
      starting_dynamic: clampText(arc.starting_dynamic, 140),
      friction_points: (arc.friction_points ?? []).slice(0, 4),
      repair_moments: (arc.repair_moments ?? []).slice(0, 4),
      climax_resolution: clampText(arc.climax_resolution, 140)
    })),
    pressure_ladder: input.dramaPlan.pressure_ladder,
    chapter_or_act_setups: input.dramaPlan.chapter_or_act_setups ?? []
  };
  const compactSetpiecePlan = {
    notes: (input.setpiecePlan.notes ?? []).map((note) => clampText(note, 140)),
    quotas: input.setpiecePlan.quotas,
    setpieces: input.setpiecePlan.setpieces.map((setpiece: SetpiecePlan["setpieces"][number]) => ({
      setpiece_id: setpiece.setpiece_id,
      act_id: setpiece.act_id,
      type: setpiece.type,
      location_zone_id: setpiece.location_zone_id,
      purpose: clampText(setpiece.story_purpose, 140),
      medical_mechanism_anchor: clampText(setpiece.medical_mechanism_anchor, 140),
      visual_signature: clampText(setpiece.visual_signature, 140),
      outcome_turn: clampText(setpiece.outcome_turn, 140)
    }))
  };

  return (
    `DECK SPEC SUMMARY (json):\n${clipJsonForPrompt(compactDeck, 24_000)}\n\n` +
    `STORY BLUEPRINT (json):\n${clipJsonForPrompt(input.storyBlueprint, 5_000)}\n\n` +
    `ACT OUTLINE (json):\n${clipJsonForPrompt(input.actOutline, 5_000)}\n\n` +
    `CLUE GRAPH SUMMARY (json):\n${clipJsonForPrompt(compactClueGraph, 9_000)}\n\n` +
    `DRAMA PLAN SUMMARY (json):\n${clipJsonForPrompt(compactDramaPlan, 5_000)}\n\n` +
    `SETPIECE PLAN SUMMARY (json):\n${clipJsonForPrompt(compactSetpiecePlan, 5_000)}\n\n` +
    `${guardrails}\n\n` +
    `GATE 2 FEEDBACK:\n${compactGateFeedback(input.gate2Feedback)}`
  );
}

function findDeckSlideIndex(slides: DeckSlideSpec[], slideId: string): number {
  const targetKey = canonicalSlideIdKey(slideId);
  return slides.findIndex((slide) => canonicalSlideIdKey(slide.slide_id) === targetKey);
}

function sanitizeDeckCohesionOperations(input: {
  deck: ReturnType<typeof DeckSpecSchema.parse>;
  operations: SlideBlockOperation[];
  generationProfile: "quality" | "pilot";
}): {
  operations: SlideBlockOperation[];
  warnings: string[];
  projectedMainSlideCount: number;
} {
  if (input.generationProfile !== "quality") {
    return {
      operations: input.operations,
      warnings: [],
      projectedMainSlideCount: input.deck.slides.length
    };
  }

  const warnings: string[] = [];
  const maxWindowSpan = Math.max(6, Math.ceil(input.deck.slides.length * 0.08));
  const maxTotalSlideDelta = Math.max(2, Math.ceil(input.deck.slides.length * 0.05));
  let previewDeck = input.deck;
  const accepted: SlideBlockOperation[] = [];

  for (const operation of input.operations) {
    if (operation.op === "replace_window") {
      const startIdx = operation.start_slide_id ? findDeckSlideIndex(previewDeck.slides, operation.start_slide_id) : -1;
      const endIdx = operation.end_slide_id ? findDeckSlideIndex(previewDeck.slides, operation.end_slide_id) : -1;
      const replacementCount = operation.replacement_slides?.length ?? 0;
      if (startIdx < 0 || endIdx < 0 || replacementCount === 0) {
        warnings.push(
          `Rejected cohesion operation replace_window(${operation.start_slide_id ?? "?"}..${operation.end_slide_id ?? "?"}) due to missing anchors or empty replacement.`
        );
        continue;
      }
      const span = Math.abs(endIdx - startIdx) + 1;
      if (span > maxWindowSpan) {
        warnings.push(
          `Rejected cohesion replace_window(${operation.start_slide_id}..${operation.end_slide_id}) because span=${span} exceeds local limit=${maxWindowSpan}.`
        );
        continue;
      }
      if (replacementCount < Math.max(1, span - 2)) {
        warnings.push(
          `Rejected cohesion replace_window(${operation.start_slide_id}..${operation.end_slide_id}) because replacement_count=${replacementCount} would over-compress span=${span}.`
        );
        continue;
      }
    }

    const previewBlock = SlideBlockSchema.parse({
      schema_version: "1.0.0",
      block_id: "COHESION_PREVIEW",
      act_id: "ACT4",
      slide_range: { start: 1, end: Math.max(1, previewDeck.slides.length) },
      operations: [operation],
      block_summary_out: "Preview cohesion operation."
    });
    const previewAssembly = assembleDeckFromSlideBlocks({
      scaffoldDeck: previewDeck,
      blocks: [previewBlock]
    });
    const delta = Math.abs(previewAssembly.deck.slides.length - previewDeck.slides.length);
    if (delta > maxTotalSlideDelta) {
      warnings.push(
        `Rejected cohesion ${operation.op} because it would change deck length by ${delta} slides (limit=${maxTotalSlideDelta}).`
      );
      continue;
    }
    previewDeck = previewAssembly.deck;
    accepted.push(operation);
  }

  const totalDelta = Math.abs(previewDeck.slides.length - input.deck.slides.length);
  if (totalDelta > maxTotalSlideDelta) {
    warnings.push(
      `Rejected all cohesion operations because cumulative deck-length delta=${totalDelta} exceeds quality limit=${maxTotalSlideDelta}.`
    );
    return {
      operations: [],
      warnings,
      projectedMainSlideCount: input.deck.slides.length
    };
  }

  return {
    operations: accepted,
    warnings,
    projectedMainSlideCount: previewDeck.slides.length
  };
}

function compactKbExcerpt(kbContext: string): string {
  return clipExcerpt(kbContext, 4_000);
}

function buildDiseaseDossierCompactPrompt(dossier: DiseaseDossier): string {
  return clipJsonForPrompt({
    canonical_name: dossier.canonical_name,
    aliases: dossier.aliases.slice(0, 4),
    disease_request: dossier.disease_request,
    learning_objectives: dossier.learning_objectives.slice(0, 8),
    sections: dossier.sections.slice(0, 8).map((section) => ({
      section: section.section,
      key_points: section.key_points.slice(0, 3),
      citations: section.citations.slice(0, 3).map((citation) => ({
        citation_id: citation.citation_id,
        claim: clampText(citation.claim, 180),
        locator: clampText(String(citation.locator ?? ""), 80)
      }))
    })),
    citations: dossier.citations.slice(0, 10).map((citation) => ({
      citation_id: citation.citation_id,
      claim: clampText(citation.claim, 180),
      locator: clampText(String(citation.locator ?? ""), 80)
    }))
  });
}

function buildEpisodePitchCompactPrompt(pitch: ReturnType<typeof EpisodePitchSchema.parse>): string {
  return clipJsonForPrompt({
    episode_title: pitch.episode_title,
    logline: pitch.logline,
    target_deck_length: pitch.target_deck_length,
    tone: pitch.tone,
    patient_stub: pitch.patient_stub,
    macro_hook: pitch.macro_hook,
    micro_hook: pitch.micro_hook,
    proposed_twist_type: pitch.proposed_twist_type,
    teaser_storyboard: pitch.teaser_storyboard.slice(0, 4).map((slide) => ({
      slide_id: slide.slide_id,
      title: slide.title,
      hook: slide.hook,
      medical_payload_brief: slide.medical_payload_brief ?? ""
    }))
  });
}

function buildMicroWorldCompactPrompt(input: {
  topic: string;
  caseRequest: Record<string, unknown>;
  dossierDigest: unknown;
  truthDigest: unknown;
  clueGraph: ReturnType<typeof ClueGraphSchema.parse>;
  gate2Feedback: string;
}): string {
  return [
    `TOPIC:\n${input.topic}`,
    `CASE REQUEST (json):\n${JSON.stringify(input.caseRequest, null, 2)}`,
    `DISEASE DOSSIER DIGEST (json):\n${JSON.stringify(input.dossierDigest, null, 2)}`,
    `TRUTH MODEL DIGEST (json):\n${JSON.stringify(input.truthDigest, null, 2)}`,
    `CLUE GRAPH DIGEST (json):\n${JSON.stringify(
      {
        clues: input.clueGraph.clues.slice(0, 8).map((clue) => ({
          clue_id: clue.clue_id,
          observed: clampText(clue.observed, 140),
          correct_inference: clampText(clue.correct_inference, 140),
          first_seen_slide_id: clue.first_seen_slide_id,
          payoff_slide_id: clue.payoff_slide_id
        })),
        red_herrings: input.clueGraph.red_herrings.slice(0, 4).map((item) => ({
          rh_id: item.rh_id,
          rooted_truth: clampText(item.rooted_truth, 140),
          payoff_slide_id: item.payoff_slide_id
        }))
      },
      null,
      2
    )}`,
    `GATE 2 FEEDBACK:\n${clampText(input.gate2Feedback, 500)}`
  ].join("\n\n");
}

function buildSetpieceCompactPrompt(input: {
  topic: string;
  truthDigest: unknown;
  clueDigest: unknown;
  microWorldDigest: unknown;
  dramaDigest: unknown;
  gate2Feedback: string;
}): string {
  return [
    `TOPIC:\n${input.topic}`,
    `TRUTH MODEL DIGEST (json):\n${JSON.stringify(input.truthDigest, null, 2)}`,
    `CLUE GRAPH DIGEST (json):\n${JSON.stringify(input.clueDigest, null, 2)}`,
    `MICRO WORLD DIGEST (json):\n${JSON.stringify(input.microWorldDigest, null, 2)}`,
    `DRAMA DIGEST (json):\n${JSON.stringify(input.dramaDigest, null, 2)}`,
    `GATE 2 FEEDBACK:\n${clampText(input.gate2Feedback, 500)}`
  ].join("\n\n");
}

function buildStoryBeatsPromptSection(input: {
  storyBeats: z.infer<typeof StoryBeatsSchema> | null;
  chapterOutline: ReturnType<typeof parseChapterOutlineArtifact> | null;
}): string {
  if (!input.storyBeats) {
    return "STORY BEATS: none provided for this run.";
  }
  const topical = Object.values(input.storyBeats.topic_area_beats)
    .filter((node) => node.beat_md.trim().length > 0)
    .slice(0, 40)
    .map((node) => ({
      topic_area_id: node.topic_area_id,
      topic_area_title: node.topic_area_title,
      beat_md: clampText(node.beat_md, 700),
      continuity_hook: clampText(node.continuity_hook ?? "", 240)
    }));
  const categoryTitles = input.chapterOutline
    ? input.chapterOutline.chapter_outline.categories.map((c) => c.title)
    : [];
  return [
    "STORY BEATS (author-guidance; high-priority constraints):",
    JSON.stringify(
      {
        intro: clampText(input.storyBeats.intro.beat_md, 900),
        outro: clampText(input.storyBeats.outro.beat_md, 900),
        topical_beats: topical,
        chapter_outline_categories: categoryTitles
      },
      null,
      2
    ),
    "STORY-BEAT RULES:",
    "- Preserve the story-beat arc unless it conflicts with safety or hard factual constraints.",
    "- Keep midpoint false-theory collapse and ending callback signals visible.",
    "- Preserve detective/deputy rupture-and-repair continuity."
  ].join("\n");
}

function storyBeatHintsForPlan(input: {
  plan: { actId: "ACT1" | "ACT2" | "ACT3" | "ACT4" };
  storyBeats: z.infer<typeof StoryBeatsSchema> | null;
  chapterOutline: ReturnType<typeof parseChapterOutlineArtifact> | null;
}): string[] {
  if (!input.storyBeats) return [];
  const hints: string[] = [];
  if (input.plan.actId === "ACT1" && input.storyBeats.intro.beat_md.trim().length > 0) {
    hints.push(clampText(input.storyBeats.intro.beat_md, 240));
  }
  if (input.plan.actId === "ACT4" && input.storyBeats.outro.beat_md.trim().length > 0) {
    hints.push(clampText(input.storyBeats.outro.beat_md, 240));
  }
  const categoryByTopicAreaId = new Map<string, number>();
  const categoryCount = input.chapterOutline?.chapter_outline.categories.length ?? 0;
  if (input.chapterOutline) {
    for (const [categoryIndex, category] of input.chapterOutline.chapter_outline.categories.entries()) {
      for (const topic of category.topic_areas) {
        categoryByTopicAreaId.set(topic.id, categoryIndex);
      }
    }
  }
  for (const node of Object.values(input.storyBeats.topic_area_beats)) {
    const categoryIndex = categoryByTopicAreaId.get(node.topic_area_id) ?? null;
    const expectedAct = expectedActForBeat(node.topic_area_id, categoryIndex, categoryCount);
    if (expectedAct === input.plan.actId && node.beat_md.trim().length > 0) {
      hints.push(clampText(node.beat_md, 220));
    }
  }
  return [...new Set(hints)].slice(0, 6);
}

function compactMicroWorldDigest(microWorldMap: ReturnType<typeof MicroWorldMapSchema.parse>) {
  return {
    primary_organs: microWorldMap.primary_organs.slice(0, 6),
    zones: microWorldMap.zones.slice(0, 8).map((zone) => ({
      zone_id: zone.zone_id,
      name: clampText(zone.name, 90),
      anatomic_location: clampText(zone.anatomic_location, 120),
      narrative_motifs: (zone.narrative_motifs ?? []).slice(0, 3).map((item) => clampText(item, 80))
    })),
    hazards: microWorldMap.hazards.slice(0, 8).map((hazard) => ({
      hazard_id: hazard.hazard_id,
      type: hazard.type,
      description: clampText(hazard.description, 140),
      links_to_pathophysiology: clampText(hazard.links_to_pathophysiology, 140)
    })),
    routes: microWorldMap.routes.slice(0, 8).map((route) => ({
      route_id: route.route_id,
      from_zone_id: route.from_zone_id,
      to_zone_id: route.to_zone_id,
      mode: route.mode,
      story_use: clampText(route.story_use ?? "", 120)
    }))
  };
}

function compactDramaDigest(dramaPlan: ReturnType<typeof DramaPlanSchema.parse>) {
  return {
    character_arcs: dramaPlan.character_arcs.slice(0, 6).map((arc) => ({
      character_id: arc.character_id,
      core_need: clampText(arc.core_need, 120),
      core_fear: clampText(arc.core_fear, 120),
      act_turns: arc.act_turns.slice(0, 4).map((turn) => ({
        act_id: turn.act_id,
        pressure: clampText(turn.pressure, 120),
        choice: clampText(turn.choice, 120),
        change: clampText(turn.change, 120)
      }))
    })),
    relationship_arcs: dramaPlan.relationship_arcs.slice(0, 6).map((arc) => ({
      pair: arc.pair,
      starting_dynamic: clampText(arc.starting_dynamic, 140),
      named_recurring_tensions: arc.named_recurring_tensions.slice(0, 4).map((item) => clampText(item, 100)),
      relationship_change_by_act: arc.relationship_change_by_act.slice(0, 4),
      climax_resolution: clampText(arc.climax_resolution, 140)
    })),
    pressure_ladder: dramaPlan.pressure_ladder
  };
}

function compactSetpieceDigest(setpiecePlan: ReturnType<typeof SetpiecePlanSchema.parse>) {
  return {
      setpieces: setpiecePlan.setpieces.slice(0, 8).map((setpiece) => ({
      setpiece_id: setpiece.setpiece_id,
      act_id: setpiece.act_id,
      type: setpiece.type,
      location_zone_id: setpiece.location_zone_id,
      story_purpose: clampText(setpiece.story_purpose, 140),
      clue_obligation_paid: clampText(setpiece.clue_obligation_paid, 120),
      medical_mechanism_anchor: clampText(setpiece.medical_mechanism_anchor, 140),
      emotional_cost: clampText(setpiece.emotional_cost, 120),
      relationship_shift: clampText(setpiece.relationship_shift, 120),
      outcome_turn: clampText(setpiece.outcome_turn, 140)
    })),
    quotas: setpiecePlan.quotas,
    act_debts: setpiecePlan.act_debts.slice(0, 4)
  };
}

function classifyCitationSource(citation: { citation_id?: string; locator?: string; chunk_id?: string }): "curated" | "web" {
  const citationId = String(citation.citation_id ?? "").toUpperCase();
  const locator = String(citation.locator ?? "").toLowerCase();
  const chunkId = String(citation.chunk_id ?? "").toLowerCase();
  if (
    citationId.includes("KB") ||
    locator.includes("kb_context") ||
    locator.includes("canonical") ||
    locator.includes("vector") ||
    chunkId.includes("file_search") ||
    /^turn\d+file\d+$/i.test(chunkId) ||
    locator.includes("robbins") ||
    locator.includes("davidson") ||
    locator.includes("harrison") ||
    locator.includes("goodman") ||
    locator.includes("bates")
  ) {
    return "curated";
  }
  return "web";
}

function webDominantDiseaseResearchSections(
  sourceReport: ReturnType<typeof DiseaseResearchSourceReportSchema.parse> | null,
  curatedEvidenceAvailable: boolean
) {
  if (!sourceReport || !curatedEvidenceAvailable) return [];
  return sourceReport.sections.filter(
    (section) => section.dominant_source === "web" && section.curated_citations === 0 && Boolean(section.fallback_reason)
  );
}

function buildDiseaseResearchSourceReport(input: {
  topic: string;
  dossier: DiseaseDossier;
  curatedEvidenceAvailable: boolean;
}) {
  return DiseaseResearchSourceReportSchema.parse({
    schema_version: "1.0.0",
    topic: input.topic,
    sections: input.dossier.sections.map((section) => {
      const curatedCitations = section.citations.filter((citation) => classifyCitationSource(citation) === "curated").length;
      const webCitations = section.citations.filter((citation) => classifyCitationSource(citation) === "web").length;
      const dominantSource =
        curatedCitations > 0 && webCitations > 0
          ? "mixed"
          : webCitations > 0
            ? "web"
            : "curated";
      return {
        section: section.section,
        curated_citations: curatedCitations,
        web_citations: webCitations,
        dominant_source: dominantSource,
        fallback_reason:
          dominantSource === "web" && input.curatedEvidenceAvailable
            ? "Web evidence dominated even though curated evidence was available; review grounding quality."
            : undefined
      };
    })
  });
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
  templateRegistry: "v2_template_registry.json",
  packagingSummary: "V2_PACKAGING_SUMMARY.json"
} as const;

async function readJsonArtifact<T>(runId: string, name: string): Promise<T> {
  const resolved = await resolveArtifactPathAbs(runId, name);
  if (!resolved) throw new Error(`Missing required artifact: ${name}`);
  const raw = await fs.readFile(resolved, "utf8");
  return JSON.parse(raw) as T;
}

async function readJsonArtifactIfPresent<T>(runId: string, name: string): Promise<T | null> {
  const resolved = await resolveArtifactPathAbs(runId, name);
  if (!resolved) return null;
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
  const generationProfile = resolveGenerationProfile(settings);
  const adherenceMode = settings?.adherenceMode ?? "strict";
  const startFrom = options.startFrom ?? "KB0";

  if (!isV2Step(startFrom)) {
    throw new Error(`Invalid startFrom for v2: ${startFrom}. Supported: ${V2_STEPS.join(", ")}`);
  }

  const shouldRun = (step: StepName): boolean => V2_STEPS.indexOf(step) >= V2_STEPS.indexOf(startFrom);
  const deckLengthPolicy = resolveDeckLengthPolicy(settings);
  const audienceLevel = settings?.audienceLevel ?? "PHYSICIAN_LEVEL";

  const openaiKey = requireEnv("OPENAI_API_KEY");
  const vectorStoreId = requireEnv("KB_VECTOR_STORE_ID");
  setDefaultOpenAIKey(openaiKey);

  const canonicalProfile = await loadCanonicalProfile();
  await runs.setCanonicalSources(runId, { ...canonicalProfile.paths, foundAny: canonicalProfile.foundAny });
  const canonicalProfileExcerpt = buildCanonicalProfileExcerpt(canonicalProfile);
  const episodeMemory = await loadEpisodeMemory().catch(() => ({ recent: [] as Array<{
    at: string;
    runId: string;
    key: string;
    variety: {
      genre_wrapper: string;
      body_setting: string;
      antagonist_archetype: string;
      twist_type: string;
      signature_gadget: string;
      motifs: string[];
    };
  }> }));
  const episodeMemoryExcerpt = buildEpisodeMemoryExcerpt(episodeMemory);

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
    const stageProvenanceRaw = await readJsonArtifactIfPresent<unknown>(runId, "v2_stage_authoring_provenance.json");
    const stageProvenance = stageProvenanceRaw ? V2StageAuthoringProvenanceSchema.parse(stageProvenanceRaw) : null;

    const canSynthesizeForStage = (stage: keyof V2StageAuthoringProvenance["stages"]): boolean =>
      generationProfile === "pilot" || stageProvenance?.stages?.[stage]?.source === "deterministic_fallback";

    const microWorldRaw = await readJsonArtifactIfPresent<unknown>(runId, "micro_world_map.json");
    const microWorldSynthesized = !microWorldRaw;
    if (microWorldSynthesized && !canSynthesizeForStage("micro_world_map")) {
      throw new Error("Missing required authored artifact micro_world_map.json for phase-4 packaging in quality mode.");
    }
    const microWorldMap = MicroWorldMapSchema.parse(
      microWorldRaw ?? generateMicroWorldMap(deckSpec, diseaseDossier, truthModel)
    );
    if (microWorldSynthesized) {
      runs.log(runId, "Packaging synthesized micro_world_map.json from deterministic fallback policy.", step);
      await writeIntermediateJson(step, "micro_world_map.json", microWorldMap);
    }

    const dramaRaw = await readJsonArtifactIfPresent<unknown>(runId, "drama_plan.json");
    const dramaSynthesized = !dramaRaw;
    if (dramaSynthesized && !canSynthesizeForStage("drama_plan")) {
      throw new Error("Missing required authored artifact drama_plan.json for phase-4 packaging in quality mode.");
    }
    const dramaPlan = DramaPlanSchema.parse(dramaRaw ?? generateDramaPlan(deckSpec, truthModel));
    if (dramaSynthesized) {
      runs.log(runId, "Packaging synthesized drama_plan.json from deterministic fallback policy.", step);
      await writeIntermediateJson(step, "drama_plan.json", dramaPlan);
    }

    const setpieceRaw = await readJsonArtifactIfPresent<unknown>(runId, "setpiece_plan.json");
    const setpieceSynthesized = !setpieceRaw;
    if (setpieceSynthesized && !canSynthesizeForStage("setpiece_plan")) {
      throw new Error("Missing required authored artifact setpiece_plan.json for phase-4 packaging in quality mode.");
    }
    const setpiecePlan = SetpiecePlanSchema.parse(
      setpieceRaw ?? generateSetpiecePlan(deckSpec, microWorldMap, diseaseDossier)
    );
    if (setpieceSynthesized) {
      runs.log(runId, "Packaging synthesized setpiece_plan.json from deterministic fallback policy.", step);
      await writeIntermediateJson(step, "setpiece_plan.json", setpiecePlan);
    }
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
    const packagingSummary = {
      schema_version: "1.0.0",
      workflow: "v2_micro_detectives",
      generated_at: nowIso(),
      deck: {
        episode_title: deckSpec.deck_meta.episode_title,
        main_slide_count: deckSpec.slides.length,
        appendix_slide_count: deckSpec.appendix_slides.length
      },
      package: {
        template_count: templateRegistry.templates.length,
        files: {
          deck_spec: "deck_spec.json",
          template_registry: V2_PHASE4_FINAL_ARTIFACTS.templateRegistry,
          main_render_plan: V2_PHASE4_FINAL_ARTIFACTS.mainDeckRenderPlan,
          appendix_render_plan: V2_PHASE4_FINAL_ARTIFACTS.appendixRenderPlan,
          speaker_notes_with_citations: V2_PHASE4_FINAL_ARTIFACTS.speakerNotesBundle
        }
      }
    };

    await writeIntermediateJson(step, V2_PHASE4_FINAL_ARTIFACTS.templateRegistry, templateRegistry);
    await writeIntermediateJson(step, "v2_phase4_packaging_summary.json", packagingSummary);
    await writeIntermediateJson(step, "v2_phase4_packaging_manifest.json", {
      schema_version: "1.0.0",
      generated_at: nowIso(),
      final_artifacts: [
        "deck_spec.json",
        V2_PHASE4_FINAL_ARTIFACTS.mainDeckRenderPlan,
        V2_PHASE4_FINAL_ARTIFACTS.appendixRenderPlan,
        V2_PHASE4_FINAL_ARTIFACTS.speakerNotesBundle,
        V2_PHASE4_FINAL_ARTIFACTS.templateRegistry,
        V2_PHASE4_FINAL_ARTIFACTS.packagingSummary
      ]
    });

    await writeFinalJson(step, "deck_spec.json", deckSpec);
    await writeFinalJson(step, V2_PHASE4_FINAL_ARTIFACTS.templateRegistry, templateRegistry);
    await writeFinalJson(step, V2_PHASE4_FINAL_ARTIFACTS.packagingSummary, packagingSummary);
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

  async function runIsolatedAgentWithCompactRetry<T>(args: {
    step: StepName;
    agentKey: V2AgentKey;
    agent: unknown;
    prompt: string;
    compactPrompt: string;
    maxTurns: number;
    timeoutMs: number;
    signal?: AbortSignal;
    vectorStoreId?: string;
    retryLabel: string;
    compactRetryTimeoutMs?: number;
  }): Promise<T> {
    try {
      return await runIsolatedAgentOutput<T>({
        step: args.step,
        agentKey: args.agentKey,
        agent: args.agent,
        prompt: args.prompt,
        maxTurns: args.maxTurns,
        timeoutMs: args.timeoutMs,
        signal: args.signal,
        vectorStoreId: args.vectorStoreId
      });
    } catch (err) {
      if (shouldAbortOnError(err, args.signal)) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!isLikelyTimeoutError(msg)) throw err;
      runs.log(runId, `${args.retryLabel} primary attempt failed; retrying compact prompt (${msg}).`, args.step);
      try {
        const retried = await runIsolatedAgentOutput<T>({
          step: args.step,
          agentKey: args.agentKey,
          agent: args.agent,
          prompt: args.compactPrompt,
          maxTurns: Math.max(4, Math.min(args.maxTurns, 8)),
          timeoutMs: Math.max(args.compactRetryTimeoutMs ?? 180_000, args.timeoutMs),
          signal: args.signal,
          vectorStoreId: args.vectorStoreId
        });
        runs.log(runId, `${args.retryLabel} compact retry succeeded.`, args.step);
        return retried;
      } catch (compactErr) {
        if (shouldAbortOnError(compactErr, args.signal)) throw compactErr;
        const compactMsg = compactErr instanceof Error ? compactErr.message : String(compactErr);
        runs.log(runId, `${args.retryLabel} compact retry failed (${compactMsg}).`, args.step);
        throw compactErr;
      }
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

  runs.log(runId, `V2 micro-detectives pipeline start (startFrom=${startFrom}; profile=${generationProfile}; adherence=${adherenceMode})`);

  await withTrace(`MicroDetectivesV2:${runId}`, async (trace) => {
    await runs.setTraceId(runId, trace.traceId);
    await writeFinalJson("KB0", "trace.json", { traceId: trace.traceId, workflow: "v2_micro_detectives", phase: "phase2-3" });

    const assets = await loadV2Assets();
    const kbAgent = makeKbCompilerAgent(vectorStoreId);
    const diseaseResearchAgent = makeV2DiseaseResearchAgent(assets, vectorStoreId);
    const episodePitchAgent = makeV2EpisodePitchAgent(assets);
    const truthModelAgent = makeV2TruthModelAgent(assets);
    const differentialCastAgent = makeV2DifferentialCastAgent(assets);
    const clueArchitectAgent = makeV2ClueArchitectAgent(assets);
    const microWorldMapAgent = makeV2MicroWorldMapAgent(assets);
    const dramaPlanAgent = makeV2DramaPlanAgent(assets);
    const setpiecePlanAgent = makeV2SetpiecePlanAgent(assets);
    const storyBlueprintAgent = makeV2StoryBlueprintAgent(assets);
    const actOutlineAgent = makeV2ActOutlineAgent(assets);
    const slideBlockAuthorAgent = makeV2SlideBlockAuthorAgent(assets);
    const deckCohesionPassAgent = makeV2DeckCohesionPassAgent(assets);
    const narrativeIntensifierAgent = makeV2NarrativeIntensifierAgent(assets);
    const plotDirectorDeckSpecAgent = makeV2PlotDirectorDeckSpecAgent(assets);
    const readerSimAgent = makeV2ReaderSimAgent(assets);
    const medFactcheckAgent = makeV2MedFactcheckAgent(assets);
    let diseaseResearchSourceReport: ReturnType<typeof DiseaseResearchSourceReportSchema.parse> | null = null;

    let kbContext = "";
    if (shouldRun("KB0")) {
      kbContext = await runStep<string>("KB0", async () => {
        const prompt =
          `TOPIC:\n${topic}\n\n` +
          `CANONICAL PROFILE (markdown):\n${canonicalProfile.combined_markdown}\n\n` +
          `Compile KB context for v2 disease dossier + truth lock + deck spec + QA generation.`;
        const compactPrompt =
          `TOPIC:\n${topic}\n\n` +
          `CANONICAL PROFILE EXCERPT (markdown):\n${canonicalProfileExcerpt}\n\n` +
          "Compile only the essential KB context sections needed for disease dossier, truth lock, deck authoring, and QA.";
        try {
          const timeoutMs = kb0TimeoutMs(generationProfile);
          const out = await runIsolatedAgentWithCompactRetry<{ kb_context: string }>({
            step: "KB0",
            agentKey: "kbCompiler",
            agent: kbAgent as never,
            prompt,
            compactPrompt,
            maxTurns: 8,
            timeoutMs,
            vectorStoreId,
            retryLabel: "KB0"
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

    const targetSettings = {
      audienceLevel,
      generationProfile,
      deckLengthConstraintEnabled: deckLengthPolicy.constraintEnabled,
      deckLengthMain: deckLengthPolicy.softTarget ?? null,
      deckLengthDirective: deckLengthPolicy.constraintEnabled
        ? `Use deck length as a soft target around ${deckLengthPolicy.softTarget}; do not force exact count if it harms story/content flow.`
        : "No deck length constraint. Let story and medical content dictate natural length."
    } as const;
    const fallbackBase = {
      topic,
      deckLengthConstraintEnabled: deckLengthPolicy.constraintEnabled,
      deckLengthMain: deckLengthPolicy.softTarget,
      audienceLevel,
      kbContext
    } as const;
    const abTimeoutMs = stepABAgentTimeoutMs(generationProfile);

    let diseaseDossier = shouldRun("A")
      ? await runStep("A", async () => {
          const diseasePrompt =
            `CASE REQUEST (json):\n${JSON.stringify(
              {
                disease_topic: topic,
                target_level: audienceLevel,
                deck_length_policy: deckLengthPolicy.constraintEnabled ? "soft_target" : "unconstrained",
                ...(deckLengthPolicy.constraintEnabled ? { deck_length_main_soft_target: deckLengthPolicy.softTarget } : {})
              },
              null,
              2
            )}\n\n` +
            `KB CONTEXT (markdown):\n${kbContext}\n\n` +
            `CANONICAL PROFILE (markdown):\n${canonicalProfile.combined_markdown}`;
          const diseaseCompactPrompt =
            `TOPIC:\n${topic}\n\n` +
            `CASE REQUEST (json):\n${JSON.stringify(
              {
                disease_topic: topic,
                target_level: audienceLevel,
                deck_length_policy: deckLengthPolicy.constraintEnabled ? "soft_target" : "unconstrained",
                ...(deckLengthPolicy.constraintEnabled ? { deck_length_main_soft_target: deckLengthPolicy.softTarget } : {})
              },
              null,
              2
            )}\n\n` +
            `KB CONTEXT EXCERPT (markdown):\n${compactKbExcerpt(kbContext)}\n\n` +
            `CANONICAL PROFILE EXCERPT (markdown):\n${canonicalProfileExcerpt}`;
          let dossier: ReturnType<typeof DiseaseDossierSchema.parse>;
          try {
            dossier = DiseaseDossierSchema.parse(
              await runIsolatedAgentWithCompactRetry({
                step: "A",
                agentKey: "diseaseResearch",
                agent: diseaseResearchAgent,
                prompt: diseasePrompt,
                compactPrompt: diseaseCompactPrompt,
                maxTurns: 12,
                timeoutMs: abTimeoutMs,
                retryLabel: "DiseaseResearch"
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
          diseaseResearchSourceReport = buildDiseaseResearchSourceReport({
            topic,
            dossier,
            curatedEvidenceAvailable: kbContext.trim().length > 0
          });
          let webDominantSections = webDominantDiseaseResearchSections(diseaseResearchSourceReport, kbContext.trim().length > 0);
          if (webDominantSections.length > 0 && generationProfile === "quality") {
            runs.log(
              runId,
              `Disease research grounding retry: regrounding ${webDominantSections.length} web-dominant section(s) against curated/vector evidence.`,
              "A"
            );
            const groundingRepairPrompt =
              `${diseasePrompt}\n\n` +
              `CURATED GROUNDING REPAIR REQUIRED:\n` +
              `The following sections were web-dominant despite curated/vector evidence being available:\n` +
              `${webDominantSections.map((section) => `- ${section.section}`).join("\n")}\n\n` +
              `Return the full dossier again. For each listed section, add curated/vector-backed citations when available and do not rely on web-only grounding if curated evidence exists. Keep legitimate web citations only as secondary support.`;
            const groundingRepairCompactPrompt =
              `${diseaseCompactPrompt}\n\n` +
              `CURATED GROUNDING REPAIR REQUIRED FOR:\n${webDominantSections.map((section) => `- ${section.section}`).join("\n")}\n\n` +
              `Return the full dossier with curated/vector citations present in those sections whenever KB evidence exists.`;
            try {
              dossier = normalizeDossierCitationIds(
                DiseaseDossierSchema.parse(
                  await runIsolatedAgentWithCompactRetry({
                    step: "A",
                    agentKey: "diseaseResearch",
                    agent: diseaseResearchAgent,
                    prompt: groundingRepairPrompt,
                    compactPrompt: groundingRepairCompactPrompt,
                    maxTurns: 10,
                    timeoutMs: Math.max(abTimeoutMs, 240_000),
                    retryLabel: "DiseaseResearch grounding repair"
                  })
                ),
                topic
              );
              diseaseResearchSourceReport = buildDiseaseResearchSourceReport({
                topic,
                dossier,
                curatedEvidenceAvailable: kbContext.trim().length > 0
              });
              webDominantSections = webDominantDiseaseResearchSections(diseaseResearchSourceReport, kbContext.trim().length > 0);
            } catch (repairErr) {
              if (shouldAbortOnError(repairErr)) throw repairErr;
              const repairMsg = repairErr instanceof Error ? repairErr.message : String(repairErr);
              if (adherenceMode === "strict") {
                throw new Error(`Disease research curated-grounding repair failed: ${repairMsg}`);
              }
              runs.log(runId, `Disease research grounding repair failed; continuing with current dossier (${repairMsg}).`, "A");
            }
          }
          if (webDominantSections.length > 0) {
            runs.log(
              runId,
              `Disease research sections are web-dominant despite curated evidence availability: ${webDominantSections.map((section) => section.section).join(", ")}.`,
              "A"
            );
          }

          const pitchPrompt =
            `TOPIC:\n${topic}\n\n` +
            `TARGET SETTINGS (json):\n${JSON.stringify(targetSettings, null, 2)}\n\n` +
            `DISEASE DOSSIER (json):\n${JSON.stringify(dossier, null, 2)}\n\n` +
            `KB CONTEXT (markdown):\n${kbContext}`;
          const pitchCompactPrompt =
            `TOPIC:\n${topic}\n\n` +
            `TARGET SETTINGS (json):\n${JSON.stringify(targetSettings, null, 2)}\n\n` +
            `DISEASE DOSSIER DIGEST (json):\n${buildDiseaseDossierCompactPrompt(dossier)}\n\n` +
            `KB CONTEXT EXCERPT (markdown):\n${compactKbExcerpt(kbContext)}\n\n` +
            `CANONICAL PROFILE EXCERPT (markdown):\n${canonicalProfileExcerpt}`;
          let pitch: ReturnType<typeof EpisodePitchSchema.parse>;
          try {
            pitch = EpisodePitchSchema.parse(
              await runIsolatedAgentWithCompactRetry({
                step: "A",
                agentKey: "episodePitch",
                agent: episodePitchAgent,
                prompt: pitchPrompt,
                compactPrompt: pitchCompactPrompt,
                maxTurns: 8,
                timeoutMs: abTimeoutMs,
                retryLabel: "EpisodePitch"
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
          await writeIntermediateJson("A", "disease_research_source_report.json", diseaseResearchSourceReport);
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
    if (!shouldRun("A")) {
      diseaseResearchSourceReport = await readJsonArtifact(runId, "disease_research_source_report.json")
        .then((value) => DiseaseResearchSourceReportSchema.parse(value))
        .catch(() => null);
    }
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

    let truthModel = shouldRun("B")
      ? TruthModelSchema.parse(
          await runStep("B", async () => {
            const truthPrompt =
              `TOPIC:\n${topic}\n\n` +
              `TARGET SETTINGS (json):\n${JSON.stringify(targetSettings, null, 2)}\n\n` +
              `DISEASE DOSSIER (json):\n${JSON.stringify(diseaseDossier, null, 2)}\n\n` +
            `EPISODE PITCH (json):\n${JSON.stringify(episodePitch, null, 2)}\n\n` +
            `GATE 1 FEEDBACK:\n${gate1Feedback}\n\n` +
            `KB CONTEXT (markdown):\n${kbContext}`;
            const truthCompactPrompt =
              `TOPIC:\n${topic}\n\n` +
              `TARGET SETTINGS (json):\n${JSON.stringify(targetSettings, null, 2)}\n\n` +
              `DISEASE DOSSIER DIGEST (json):\n${buildDiseaseDossierCompactPrompt(diseaseDossier)}\n\n` +
              `EPISODE PITCH DIGEST (json):\n${buildEpisodePitchCompactPrompt(episodePitch)}\n\n` +
              `GATE 1 FEEDBACK:\n${compactGateFeedback(gate1Feedback)}\n\n` +
              `KB CONTEXT EXCERPT (markdown):\n${compactKbExcerpt(kbContext)}`;
            let truth: ReturnType<typeof TruthModelSchema.parse>;
            try {
              truth = TruthModelSchema.parse(
                await runIsolatedAgentWithCompactRetry({
                  step: "B",
                  agentKey: "truthModel",
                  agent: truthModelAgent,
                  prompt: truthPrompt,
                  compactPrompt: truthCompactPrompt,
                  maxTurns: 10,
                  timeoutMs: abTimeoutMs,
                  retryLabel: "TruthModel"
                })
              );
            } catch (err) {
              if (shouldAbortOnError(err)) throw err;
              if (adherenceMode === "strict") throw err;
              const msg = err instanceof Error ? err.message : String(err);
              runs.log(runId, `TruthModel agent fallback activated (${msg}).`, "B");
              truth = TruthModelSchema.parse(generateTruthModelFallback(fallbackBase, diseaseDossier, episodePitch));
            }
            const normalizedTruth = normalizeTruthModelForTruthLock(truth);
            if (normalizedTruth.repairs.length > 0) {
              runs.log(
                runId,
                `TruthModel normalized before truth-lock validation (${normalizedTruth.repairs.join(", ")}).`,
                "B"
              );
            }
            truth = normalizedTruth.truthModel;
            await writeIntermediateJson("B", "truth_model.json", truth);
            return truth;
          })
        )
      : TruthModelSchema.parse(await readJsonArtifact(runId, "truth_model.json"));
    if (!shouldRun("B")) runs.log(runId, "Reusing B artifacts", "B");
    const normalizedTruth = normalizeTruthModelForTruthLock(truthModel);
    truthModel = normalizedTruth.truthModel;
    if (normalizedTruth.repairs.length > 0) {
      runs.log(
        runId,
        `Normalized reused truth_model.json before truth-lock validation (${normalizedTruth.repairs.join(", ")}).`,
        "B"
      );
      await writeIntermediateJson("B", "truth_model.json", truthModel);
    }

    const truthLockValidation = validateTruthLockCitations(diseaseDossier, truthModel);
    await writeIntermediateJson("B", "truth_lock_validation.json", {
      schema_version: "1.0.0",
      workflow: "v2_micro_detectives",
      checked_at: nowIso(),
      pass: truthLockValidation.pass,
      known_citation_count: truthLockValidation.knownCitationCount,
      issues: truthLockValidation.issues
    });
    if (!truthLockValidation.pass) {
      const summary = `Truth lock citation validation failed (${truthLockValidation.issues.length} issue(s)).`;
      if (adherenceMode === "strict") {
        throw new Error(`${summary} ${truthLockValidation.issues.join(" ")}`);
      }
      runs.log(runId, `Warn mode: ${summary}`, "B");
    }

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
        const fallbackSeedDeck = DeckSpecSchema.parse(
          generateV2DeckSpec({
            topic,
            deckLengthConstraintEnabled: deckLengthPolicy.constraintEnabled,
            deckLengthMain: deckLengthPolicy.softTarget,
            audienceLevel
          })
        );
        const estimatedMainSlides = Math.max(1, fallbackSeedDeck.slides.length);
        const adaptiveTimeouts = buildAdaptiveStepCTimeoutPlan({
          estimatedMainSlides,
          baseAgentTimeoutMs: stepCAgentTimeoutMs(),
          baseDeckSpecTimeoutMs: stepCDeckSpecTimeoutMs(),
          baseWatchdogMs: stepCHardWatchdogMs(),
          generationProfile,
          qaLoopBudget: resolveQaLoopBudget({ estimatedMainSlides })
        });
        const abortThresholdSlides = deckSpecAbortWarningThresholdSlides();
        const abortRecommended = adaptiveTimeouts.estimatedMainSlides >= abortThresholdSlides;

        await runs.setV2DeckSpecEstimate(runId, {
          estimatedMainSlides: adaptiveTimeouts.estimatedMainSlides,
          deckLengthPolicy: deckLengthPolicy.constraintEnabled ? "soft_target" : "unconstrained",
          softTarget: deckLengthPolicy.constraintEnabled ? deckLengthPolicy.softTarget : undefined,
          computedAt: nowIso(),
          adaptiveTimeoutMs: {
            agent: adaptiveTimeouts.agentTimeoutMs,
            deckSpec: adaptiveTimeouts.deckSpecTimeoutMs,
            watchdog: adaptiveTimeouts.watchdogMs
          },
          abortThresholdSlides,
          abortRecommended
        });
        await writeIntermediateJson("C", "deck_spec_timeout_plan.json", {
          schema_version: "1.0.0",
          workflow: "v2_micro_detectives",
          computed_at: nowIso(),
          estimate: {
            main_slide_count: adaptiveTimeouts.estimatedMainSlides,
            deck_length_policy: deckLengthPolicy.constraintEnabled ? "soft_target" : "unconstrained",
            deck_length_soft_target: deckLengthPolicy.constraintEnabled ? deckLengthPolicy.softTarget : null
          },
          adaptive_timeouts_ms: {
            agent: adaptiveTimeouts.agentTimeoutMs,
            deck_spec: adaptiveTimeouts.deckSpecTimeoutMs,
            watchdog: adaptiveTimeouts.watchdogMs
          },
          abort_threshold_slides: abortThresholdSlides,
          abort_recommended: abortRecommended
        });
        runs.log(
          runId,
          `DeckSpec estimate: ${adaptiveTimeouts.estimatedMainSlides} main slides (${deckLengthPolicy.constraintEnabled ? `soft_target=${String(deckLengthPolicy.softTarget)}` : "unconstrained"}). Adaptive timeouts: agent=${adaptiveTimeouts.agentTimeoutMs}ms deckspec=${adaptiveTimeouts.deckSpecTimeoutMs}ms watchdog=${adaptiveTimeouts.watchdogMs}ms.${abortRecommended ? " Recommend abort if this exceeds your pilot budget." : ""}`,
          "C"
        );

        const cWatchdogMs = adaptiveTimeouts.watchdogMs;
        const cWatchdogController = new AbortController();
        const cSignal = mergeAbortSignals([signal, cWatchdogController.signal]);
        const cStartedAtMs = Date.now();
        const remainingWatchdogMs = (): number => Math.max(0, cWatchdogMs - (Date.now() - cStartedAtMs));
        const cWatchdogTimer = setTimeout(() => {
          cWatchdogController.abort(new Error(`V2 step C watchdog timed out after ${cWatchdogMs}ms`));
        }, cWatchdogMs);

        if (cSignal.aborted) throw abortErrorFromSignal(cSignal, "Cancelled");
        try {
          const gate2Review = latestGateDecision(await readHumanReviewStore(runId), "GATE_2_TRUTH_LOCK");
          const gate2Feedback = compactGateFeedback(gateFeedbackForPrompt(gate2Review));
          const cTimeoutMs = adaptiveTimeouts.agentTimeoutMs;
          const deckSpecTimeoutMs = adaptiveTimeouts.deckSpecTimeoutMs;
          const planningMode = stepCPlanningMode(generationProfile);
          const deterministicPlanning = planningMode === "deterministic_first";
          const attemptPlotDirectorRefinement = shouldAttemptPlotDirectorRefinement(generationProfile, planningMode);
          if (deterministicPlanning) {
            runs.log(runId, "Step C planning mode=deterministic_first (warn-mode reliability path).", "C");
          }
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
          const fallbackForLowBudget = (stage: string, minRemainingMs: number): boolean => {
            if (adherenceMode === "strict") return false;
            const remaining = remainingWatchdogMs();
            if (remaining >= minRemainingMs) return false;
            const reason = `budget_guard remaining=${remaining}ms < required=${minRemainingMs}ms`;
            recordFallback("deterministic_fallback", stage, reason);
            runs.log(runId, `Step C budget guard activated for ${stage} (${reason}).`, "C");
            return true;
          };
          let storyBeats: z.infer<typeof StoryBeatsSchema> | null = null;
          let chapterOutline: ReturnType<typeof parseChapterOutlineArtifact> | null = null;
          try {
            const rawStoryBeats = await readJsonArtifactIfPresent<unknown>(runId, "story_beats.json");
            if (rawStoryBeats) storyBeats = StoryBeatsSchema.parse(rawStoryBeats);
          } catch (err) {
            runs.log(runId, `story_beats.json ignored due to parse error (${err instanceof Error ? err.message : String(err)}).`, "C");
          }
          try {
            const rawChapterOutline = await readJsonArtifactIfPresent<unknown>(runId, "chapter_outline.json");
            if (rawChapterOutline) chapterOutline = parseChapterOutlineArtifact(rawChapterOutline);
          } catch (err) {
            runs.log(runId, `chapter_outline.json ignored due to parse error (${err instanceof Error ? err.message : String(err)}).`, "C");
          }
          const storyBeatsPromptSection = buildStoryBeatsPromptSection({ storyBeats, chapterOutline });
          const planningDeckMeta = {
            schema_version: "1.0.0",
            episode_slug: topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
            episode_title: `${topic} — Micro-Detectives Case`,
            deck_length_main: String(fallbackSeedDeck.deck_meta.deck_length_main),
            audience_level: audienceLevel,
            tone: episodePitch.tone,
            story_dominance_target_ratio: 0.75,
            max_words_on_slide: 24,
            one_major_med_concept_per_slide: true,
            appendix_unlimited: true
          };

        const dossierPromptDigest = {
          canonical_name: diseaseDossier.canonical_name,
          aliases: diseaseDossier.aliases.slice(0, 4),
          learning_objectives: diseaseDossier.learning_objectives.slice(0, 8).map((objective) => clampText(objective, 180)),
          sections: diseaseDossier.sections.slice(0, 8).map((section) => ({
            section: section.section,
            key_points: section.key_points.slice(0, 2).map((point) => clampText(point, 180))
          })),
          citation_ids: diseaseDossier.citations.slice(0, 18).map((citation) => citation.citation_id)
        };
        const truthPromptDigest = {
          final_diagnosis: truthModel.final_diagnosis,
          case_logline: clampText(truthModel.case_logline, 260),
          cover_story: {
            initial_working_dx_ids: truthModel.cover_story.initial_working_dx_ids.slice(0, 6),
            why_it_seems_right: clampText(truthModel.cover_story.why_it_seems_right, 220),
            what_it_gets_wrong: clampText(truthModel.cover_story.what_it_gets_wrong, 220)
          },
          macro_timeline: truthModel.macro_timeline.slice(0, 6).map((event) => ({
            t: event.t,
            event_id: event.event_id,
            what_happens: clampText(event.what_happens, 200)
          })),
          micro_timeline: truthModel.micro_timeline.slice(0, 6).map((event) => ({
            t: event.t,
            event_id: event.event_id,
            zone_id: event.zone_id,
            what_happens: clampText(event.what_happens, 200)
          })),
          twist_blueprint: truthModel.twist_blueprint
        };
        const differentialPrompt =
          `TOPIC:\n${topic}\n\n` +
          `DECK META (json):\n${JSON.stringify(planningDeckMeta, null, 2)}\n\n` +
          `DISEASE DOSSIER DIGEST (json):\n${JSON.stringify(dossierPromptDigest, null, 2)}\n\n` +
          `TRUTH MODEL DIGEST (json):\n${JSON.stringify(truthPromptDigest, null, 2)}\n\n` +
          `GATE 2 FEEDBACK:\n${gate2Feedback}`;

        let workingDifferential: ReturnType<typeof DifferentialCastSchema.parse>;
          if (deterministicPlanning) {
            workingDifferential = DifferentialCastSchema.parse(generateDifferentialCast(fallbackSeedDeck, diseaseDossier, truthModel));
          } else if (fallbackForLowBudget("differentialCast.preflight", Math.max(90_000, Math.round(cTimeoutMs * 0.75)))) {
            workingDifferential = DifferentialCastSchema.parse(generateDifferentialCast(fallbackSeedDeck, diseaseDossier, truthModel));
          } else {
            try {
              workingDifferential = DifferentialCastSchema.parse(
                await runIsolatedAgentOutput({
                  step: "C",
                  agentKey: "differentialCast",
                  agent: differentialCastAgent,
                  prompt: differentialPrompt,
                  maxTurns: 6,
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
          }
        await writeIntermediateJson("C", "differential_cast.json", workingDifferential);

        const differentialPromptDigest = {
          primary_suspects: workingDifferential.primary_suspects.slice(0, 8).map((suspect) => ({
            dx_id: suspect.dx_id,
            name: suspect.name,
            why_tempting: clampText(suspect.why_tempting, 180),
            signature_fingerprint: suspect.signature_fingerprint.slice(0, 2).map((item) => ({
              type: item.type,
              statement: clampText(item.statement, 180)
            }))
          })),
          rotation_plan: workingDifferential.rotation_plan,
          elimination_milestones: workingDifferential.elimination_milestones.slice(0, 12).map((milestone) => ({
            milestone_id: milestone.milestone_id,
            slide_id: milestone.slide_id,
            eliminated_dx_ids: milestone.eliminated_dx_ids.slice(0, 6),
            evidence_clue_ids: milestone.evidence_clue_ids.slice(0, 6),
            reasoning_summary: clampText(milestone.reasoning_summary ?? "", 180)
          }))
        };
        const cluePrompt =
          `TOPIC:\n${topic}\n\n` +
          `DECK META (json):\n${JSON.stringify(planningDeckMeta, null, 2)}\n\n` +
          `DISEASE DOSSIER DIGEST (json):\n${JSON.stringify(dossierPromptDigest, null, 2)}\n\n` +
          `TRUTH MODEL DIGEST (json):\n${JSON.stringify(truthPromptDigest, null, 2)}\n\n` +
          `DIFFERENTIAL CAST DIGEST (json):\n${JSON.stringify(differentialPromptDigest, null, 2)}`;
        let workingClueGraph: ReturnType<typeof ClueGraphSchema.parse>;
          if (deterministicPlanning) {
            workingClueGraph = ClueGraphSchema.parse(generateClueGraph(fallbackSeedDeck, diseaseDossier, workingDifferential));
          } else if (fallbackForLowBudget("clueArchitect.preflight", Math.max(90_000, Math.round(cTimeoutMs * 0.75)))) {
            workingClueGraph = ClueGraphSchema.parse(generateClueGraph(fallbackSeedDeck, diseaseDossier, workingDifferential));
          } else {
            try {
              workingClueGraph = ClueGraphSchema.parse(
                await runIsolatedAgentOutput({
                  step: "C",
                  agentKey: "clueArchitect",
                  agent: clueArchitectAgent,
                  prompt: cluePrompt,
                  maxTurns: 6,
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
          }
        await writeIntermediateJson("C", "clue_graph.json", workingClueGraph);

        const microWorldPrompt =
          `TOPIC:\n${topic}\n\n` +
          `CASE REQUEST (json):\n${JSON.stringify(
            {
              disease_topic: topic,
              deck_length_policy: deckLengthPolicy.constraintEnabled ? "soft_target" : "unconstrained",
              ...(deckLengthPolicy.constraintEnabled ? { deck_length_main_soft_target: deckLengthPolicy.softTarget } : {}),
              audience_level: audienceLevel
            },
            null,
            2
          )}\n\n` +
          `DISEASE DOSSIER (json):\n${JSON.stringify(diseaseDossier, null, 2)}\n\n` +
          `TRUTH MODEL (json):\n${JSON.stringify(truthModel, null, 2)}\n\n` +
          `CLUE GRAPH (json):\n${JSON.stringify(workingClueGraph, null, 2)}\n\n` +
          `GATE 2 FEEDBACK:\n${gate2Feedback}`;
        const microWorldCompactPrompt = buildMicroWorldCompactPrompt({
          topic,
          caseRequest: {
            disease_topic: topic,
            deck_length_policy: deckLengthPolicy.constraintEnabled ? "soft_target" : "unconstrained",
            ...(deckLengthPolicy.constraintEnabled ? { deck_length_main_soft_target: deckLengthPolicy.softTarget } : {}),
            audience_level: audienceLevel
          },
          dossierDigest: dossierPromptDigest,
          truthDigest: truthPromptDigest,
          clueGraph: workingClueGraph,
          gate2Feedback
        });
        const microWorldTimeoutMs = storyPlannerTimeoutMs(cTimeoutMs, generationProfile, "microWorldMap");
        const allowStoryStageFallback = shouldAllowStoryStageDeterministicFallback(generationProfile, adherenceMode);
        let microWorldAuthoring: { source: "agent" | "deterministic_fallback"; reason?: string } = { source: "agent" };
        let workingMicroWorldMap: ReturnType<typeof MicroWorldMapSchema.parse>;
        if (deterministicPlanning) {
          if (!allowStoryStageFallback) {
            throw new Error("Quality mode disallows deterministic MicroWorld fallback in deterministic planning mode.");
          }
          microWorldAuthoring = { source: "deterministic_fallback", reason: "deterministic_planning_mode" };
          workingMicroWorldMap = MicroWorldMapSchema.parse(generateMicroWorldMap(fallbackSeedDeck, diseaseDossier, truthModel));
        } else if (
          generationProfile === "pilot" &&
          fallbackForLowBudget("microWorldMap.preflight", Math.max(90_000, Math.round(cTimeoutMs * 0.75)))
        ) {
          microWorldAuthoring = { source: "deterministic_fallback", reason: "budget_guard_preflight" };
          workingMicroWorldMap = MicroWorldMapSchema.parse(generateMicroWorldMap(fallbackSeedDeck, diseaseDossier, truthModel));
        } else {
          try {
            const normalizedMicroWorld = normalizeMicroWorldMapOutput(
              await runIsolatedAgentWithCompactRetry({
                step: "C",
                agentKey: "microWorldMap",
                agent: microWorldMapAgent,
                prompt: microWorldPrompt,
                compactPrompt: microWorldCompactPrompt,
                maxTurns: 8,
                timeoutMs: microWorldTimeoutMs,
                compactRetryTimeoutMs: Math.max(microWorldTimeoutMs, 420_000),
                signal: cSignal,
                retryLabel: "[C] MicroWorldMap"
              }),
              diseaseDossier,
              truthModel,
              topic
            );
            workingMicroWorldMap = normalizedMicroWorld.microWorldMap;
            if (normalizedMicroWorld.repairedCitationBuckets > 0) {
              runs.log(
                runId,
                `MicroWorldMap citation repair backfilled ${normalizedMicroWorld.repairedCitationBuckets} empty citation bucket(s).`,
                "C"
              );
            }
          } catch (err) {
            if (shouldAbortOnError(err, cSignal)) throw err;
            const msg = err instanceof Error ? err.message : String(err);
            if (!allowStoryStageFallback) throw err;
            microWorldAuthoring = { source: "deterministic_fallback", reason: msg };
            runs.log(runId, `MicroWorldMap agent fallback activated (${msg}).`, "C");
            recordFallback("deterministic_fallback", "microWorldMap", msg);
            workingMicroWorldMap = MicroWorldMapSchema.parse(generateMicroWorldMap(fallbackSeedDeck, diseaseDossier, truthModel));
          }
        }
        await writeIntermediateJson("C", "micro_world_map.json", workingMicroWorldMap);

        const dramaPrompt =
          `TOPIC:\n${topic}\n\n` +
          `TRUTH MODEL (json):\n${JSON.stringify(truthModel, null, 2)}\n\n` +
          `DIFFERENTIAL CAST (json):\n${JSON.stringify(workingDifferential, null, 2)}\n\n` +
          `CLUE GRAPH (json):\n${JSON.stringify(workingClueGraph, null, 2)}\n\n` +
          `MICRO WORLD MAP (json):\n${JSON.stringify(workingMicroWorldMap, null, 2)}\n\n` +
          `GATE 2 FEEDBACK:\n${gate2Feedback}`;
        let dramaAuthoring: { source: "agent" | "deterministic_fallback"; reason?: string } = { source: "agent" };
        let workingDramaPlan: ReturnType<typeof DramaPlanSchema.parse>;
        if (deterministicPlanning) {
          if (!allowStoryStageFallback) {
            throw new Error("Quality mode disallows deterministic Drama fallback in deterministic planning mode.");
          }
          dramaAuthoring = { source: "deterministic_fallback", reason: "deterministic_planning_mode" };
          workingDramaPlan = DramaPlanSchema.parse(generateDramaPlan(fallbackSeedDeck, truthModel));
        } else if (
          generationProfile === "pilot" &&
          fallbackForLowBudget("dramaPlan.preflight", Math.max(90_000, Math.round(cTimeoutMs * 0.75)))
        ) {
          dramaAuthoring = { source: "deterministic_fallback", reason: "budget_guard_preflight" };
          workingDramaPlan = DramaPlanSchema.parse(generateDramaPlan(fallbackSeedDeck, truthModel));
        } else {
          try {
            const normalizedDrama = normalizeDramaPlanOutput(
              await runIsolatedAgentOutput({
                step: "C",
                agentKey: "dramaPlan",
                agent: dramaPlanAgent,
                prompt: dramaPrompt,
                maxTurns: 8,
                timeoutMs: storyPlannerTimeoutMs(cTimeoutMs, generationProfile, "dramaPlan"),
                signal: cSignal
              }),
              truthModel
            );
            workingDramaPlan = normalizedDrama.dramaPlan;
            if (normalizedDrama.repairedDebtBuckets > 0) {
              runs.log(
                runId,
                `DramaPlan debt repair backfilled ${normalizedDrama.repairedDebtBuckets} missing must_pay_by_end_of_act bucket(s).`,
                "C"
              );
            }
          } catch (err) {
            if (shouldAbortOnError(err, cSignal)) throw err;
            const msg = err instanceof Error ? err.message : String(err);
            if (!allowStoryStageFallback) throw err;
            dramaAuthoring = { source: "deterministic_fallback", reason: msg };
            runs.log(runId, `DramaPlan agent fallback activated (${msg}).`, "C");
            recordFallback("deterministic_fallback", "dramaPlan", msg);
            workingDramaPlan = DramaPlanSchema.parse(generateDramaPlan(fallbackSeedDeck, truthModel));
          }
        }
        await writeIntermediateJson("C", "drama_plan.json", workingDramaPlan);

        const setpiecePrompt =
          `TOPIC:\n${topic}\n\n` +
          `TRUTH MODEL (json):\n${JSON.stringify(truthModel, null, 2)}\n\n` +
          `DISEASE DOSSIER (json):\n${JSON.stringify(diseaseDossier, null, 2)}\n\n` +
          `MICRO WORLD MAP (json):\n${JSON.stringify(workingMicroWorldMap, null, 2)}\n\n` +
          `DRAMA PLAN (json):\n${JSON.stringify(workingDramaPlan, null, 2)}\n\n` +
          `CLUE GRAPH (json):\n${JSON.stringify(workingClueGraph, null, 2)}\n\n` +
          `GATE 2 FEEDBACK:\n${gate2Feedback}`;
        const setpieceCompactPrompt = buildSetpieceCompactPrompt({
          topic,
          truthDigest: truthPromptDigest,
          clueDigest: {
            clues: workingClueGraph.clues.slice(0, 8).map((clue) => ({
              clue_id: clue.clue_id,
              observed: clampText(clue.observed, 140),
              correct_inference: clampText(clue.correct_inference, 140),
              payoff_slide_id: clue.payoff_slide_id
            })),
            red_herrings: workingClueGraph.red_herrings.slice(0, 4).map((item) => ({
              rh_id: item.rh_id,
              rooted_truth: clampText(item.rooted_truth, 140),
              payoff_slide_id: item.payoff_slide_id
            }))
          },
          microWorldDigest: compactMicroWorldDigest(workingMicroWorldMap),
          dramaDigest: compactDramaDigest(workingDramaPlan),
          gate2Feedback
        });
        const setpieceTimeoutMs = storyPlannerTimeoutMs(cTimeoutMs, generationProfile, "setpiecePlan");
        let setpieceAuthoring: { source: "agent" | "deterministic_fallback"; reason?: string } = { source: "agent" };
        let workingSetpiecePlan: ReturnType<typeof SetpiecePlanSchema.parse>;
        if (deterministicPlanning) {
          if (!allowStoryStageFallback) {
            throw new Error("Quality mode disallows deterministic Setpiece fallback in deterministic planning mode.");
          }
          setpieceAuthoring = { source: "deterministic_fallback", reason: "deterministic_planning_mode" };
          workingSetpiecePlan = SetpiecePlanSchema.parse(generateSetpiecePlan(fallbackSeedDeck, workingMicroWorldMap, diseaseDossier));
        } else if (
          generationProfile === "pilot" &&
          fallbackForLowBudget("setpiecePlan.preflight", Math.max(90_000, Math.round(cTimeoutMs * 0.75)))
        ) {
          setpieceAuthoring = { source: "deterministic_fallback", reason: "budget_guard_preflight" };
          workingSetpiecePlan = SetpiecePlanSchema.parse(generateSetpiecePlan(fallbackSeedDeck, workingMicroWorldMap, diseaseDossier));
        } else {
          try {
            workingSetpiecePlan = SetpiecePlanSchema.parse(
              await runIsolatedAgentWithCompactRetry({
                step: "C",
                agentKey: "setpiecePlan",
                agent: setpiecePlanAgent,
                prompt: setpiecePrompt,
                compactPrompt: setpieceCompactPrompt,
                maxTurns: 8,
                timeoutMs: setpieceTimeoutMs,
                compactRetryTimeoutMs: Math.max(setpieceTimeoutMs, 390_000),
                signal: cSignal,
                retryLabel: "[C] SetpiecePlan"
              })
            );
          } catch (err) {
            if (shouldAbortOnError(err, cSignal)) throw err;
            const msg = err instanceof Error ? err.message : String(err);
            if (!allowStoryStageFallback) throw err;
            setpieceAuthoring = { source: "deterministic_fallback", reason: msg };
            runs.log(runId, `SetpiecePlan agent fallback activated (${msg}).`, "C");
            recordFallback("deterministic_fallback", "setpiecePlan", msg);
            workingSetpiecePlan = SetpiecePlanSchema.parse(generateSetpiecePlan(fallbackSeedDeck, workingMicroWorldMap, diseaseDossier));
          }
        }
        await writeIntermediateJson("C", "setpiece_plan.json", workingSetpiecePlan);
        const stageAuthoringProvenance: V2StageAuthoringProvenance = buildStageAuthoringProvenance({
          generationProfile,
          microWorld: microWorldAuthoring,
          drama: dramaAuthoring,
          setpiece: setpieceAuthoring
        });
        await writeIntermediateJson("C", "v2_stage_authoring_provenance.json", stageAuthoringProvenance);

        const caseRequest = {
          disease_topic: topic,
          deck_length_policy: deckLengthPolicy.constraintEnabled ? "soft_target" : "unconstrained",
          ...(deckLengthPolicy.constraintEnabled ? { deck_length_main_soft_target: deckLengthPolicy.softTarget } : {}),
          audience_level: audienceLevel,
          generation_profile: generationProfile,
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
          twist_support_matrix: workingClueGraph.twist_support_matrix.slice(0, 10)
        };

        const differentialDigest = {
          suspects: workingDifferential.primary_suspects.slice(0, 5).map((suspect) => ({
            dx_id: suspect.dx_id,
            name: suspect.name,
            signature_fingerprint: suspect.signature_fingerprint.slice(0, 2).map((fingerprint) => clampText(fingerprint.statement, 120))
          })),
          rotation_plan: workingDifferential.rotation_plan
        };

        const microWorldDigest = compactMicroWorldDigest(workingMicroWorldMap);
        const dramaDigest = compactDramaDigest(workingDramaPlan);
        const setpieceDigest = compactSetpieceDigest(workingSetpiecePlan);
        const deckAuthoringContextManifest: {
          schema_version: "1.0.0";
          workflow: "v2_micro_detectives";
          generated_at: string;
          generation_profile: GenerationProfile;
          attempts: Array<{
            attempt_id: string;
            prompt_variant: string;
            context_mode: "full" | "compact";
            reason: string;
            result: "success" | "error" | "skipped";
            details?: string;
          }>;
        } = {
          schema_version: "1.0.0",
          workflow: "v2_micro_detectives",
          generated_at: nowIso(),
          generation_profile: generationProfile,
          attempts: []
        };

        const deckSpecPrimaryPrompt =
          `CASE REQUEST (json):\n${JSON.stringify(caseRequest, null, 2)}\n\n` +
          `TRUTH MODEL (json):\n${JSON.stringify(truthModel, null, 2)}\n\n` +
          `DISEASE DOSSIER (json):\n${JSON.stringify(diseaseDossier, null, 2)}\n\n` +
          `DIFFERENTIAL CAST (json):\n${JSON.stringify(workingDifferential, null, 2)}\n\n` +
          `CLUE GRAPH (json):\n${JSON.stringify(workingClueGraph, null, 2)}\n\n` +
          `MICRO WORLD MAP (json):\n${JSON.stringify(workingMicroWorldMap, null, 2)}\n\n` +
          `DRAMA PLAN (json):\n${JSON.stringify(workingDramaPlan, null, 2)}\n\n` +
          `SETPIECE PLAN (json):\n${JSON.stringify(workingSetpiecePlan, null, 2)}\n\n` +
          `GATE 2 FEEDBACK:\n${gate2Feedback}`;

        const deckSpecUltraCompactPrompt =
          `CASE REQUEST (json):\n${JSON.stringify(caseRequest, null, 2)}\n\n` +
          `TRUTH SUMMARY (json):\n${JSON.stringify(truthSummary, null, 2)}\n\n` +
          `DOSSIER DIGEST (json):\n${JSON.stringify(dossierDigestPrimary, null, 2)}\n\n` +
          `MICRO WORLD DIGEST (json):\n${JSON.stringify(microWorldDigest, null, 2)}\n\n` +
          `DRAMA DIGEST (json):\n${JSON.stringify(dramaDigest, null, 2)}\n\n` +
          `SETPIECE DIGEST (json):\n${JSON.stringify(setpieceDigest, null, 2)}\n\n` +
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

        const storyBlueprintPrompt =
          `TOPIC:\n${topic}\n\n` +
          `CASE REQUEST (json):\n${JSON.stringify(caseRequest, null, 2)}\n\n` +
          `DISEASE DOSSIER (json):\n${JSON.stringify(diseaseDossier, null, 2)}\n\n` +
          `TRUTH MODEL (json):\n${JSON.stringify(truthModel, null, 2)}\n\n` +
          `DIFFERENTIAL CAST (json):\n${JSON.stringify(workingDifferential, null, 2)}\n\n` +
          `CLUE GRAPH (json):\n${JSON.stringify(workingClueGraph, null, 2)}\n\n` +
          `DRAMA PLAN (json):\n${JSON.stringify(workingDramaPlan, null, 2)}\n\n` +
          `SETPIECE PLAN (json):\n${JSON.stringify(workingSetpiecePlan, null, 2)}\n\n` +
          `${storyBeatsPromptSection}\n\n` +
          `GATE 2 FEEDBACK:\n${gate2Feedback}`;
        let storyBlueprint = buildStoryBlueprintFallback({
          topic,
          clueObligations: workingClueGraph.clues.slice(0, 8).map((clue) => clue.clue_id)
        });
        if (!deterministicPlanning && !fallbackForLowBudget("storyBlueprint.preflight", Math.max(90_000, Math.round(cTimeoutMs * 0.75)))) {
          try {
            storyBlueprint = StoryBlueprintSchema.parse(
              await runIsolatedAgentOutput({
                step: "C",
                agentKey: "storyBlueprint",
                agent: storyBlueprintAgent,
                prompt: storyBlueprintPrompt,
                maxTurns: 8,
                timeoutMs: storyPlannerTimeoutMs(cTimeoutMs, generationProfile, "storyBlueprint"),
                signal: cSignal
              })
            );
          } catch (err) {
            if (shouldAbortOnError(err, cSignal)) throw err;
            const msg = err instanceof Error ? err.message : String(err);
            runs.log(runId, `StoryBlueprint agent fallback activated (${msg}).`, "C");
            recordFallback("deterministic_fallback", "storyBlueprint", msg);
          }
        }
        await writeIntermediateJson("C", "story_blueprint.json", storyBlueprint);

        const actOutlinePrompt =
          `TOPIC:\n${topic}\n\n` +
          `STORY BLUEPRINT (json):\n${JSON.stringify(storyBlueprint, null, 2)}\n\n` +
          `DECK SCAFFOLD ACTS (json):\n${JSON.stringify(fallbackSeedDeck.acts, null, 2)}\n\n` +
          `TRUTH MODEL (json):\n${JSON.stringify(truthModel, null, 2)}\n\n` +
          `CLUE GRAPH (json):\n${JSON.stringify(workingClueGraph, null, 2)}\n\n` +
          `${storyBeatsPromptSection}`;
        let actOutline = buildActOutlineFallback({
          deck: fallbackSeedDeck,
          storyBlueprint
        });
        if (!deterministicPlanning && !fallbackForLowBudget("actOutline.preflight", Math.max(90_000, Math.round(cTimeoutMs * 0.75)))) {
          try {
            actOutline = ActOutlineSchema.parse(
              await runIsolatedAgentOutput({
                step: "C",
                agentKey: "actOutline",
                agent: actOutlineAgent,
                prompt: actOutlinePrompt,
                maxTurns: 8,
                timeoutMs: storyPlannerTimeoutMs(cTimeoutMs, generationProfile, "actOutline"),
                signal: cSignal
              })
            );
          } catch (err) {
            if (shouldAbortOnError(err, cSignal)) throw err;
            const msg = err instanceof Error ? err.message : String(err);
            runs.log(runId, `ActOutline agent fallback activated (${msg}).`, "C");
            recordFallback("deterministic_fallback", "actOutline", msg);
          }
        }
        await writeIntermediateJson("C", "act_outline.json", actOutline);

        let blockPlans = planSlideBlocksFromOutline(
          actOutline,
          preferredBlockSize(generationProfile, estimateMainSlidesFromOutline(actOutline))
        );
        await writeIntermediateJson(
          "C",
          "slide_block_plan.json",
          {
            schema_version: "1.0.0",
            block_count: blockPlans.length,
            blocks: blockPlans
          }
        );
        const blockCheckpointIndex: {
          schema_version: "1.0.0";
          generated_at: string;
          total_blocks: number;
          blocks: Array<{
            index: number;
            block_id: string;
            act_id: "ACT1" | "ACT2" | "ACT3" | "ACT4";
            start: number;
            end: number;
            status: "pending" | "agent_authored" | "deterministic_fallback";
            completed_at?: string;
          }>;
        } = {
          schema_version: "1.0.0",
          generated_at: nowIso(),
          total_blocks: blockPlans.length,
          blocks: blockPlans.map((plan, index) => ({
            index,
            block_id: plan.blockId,
            act_id: plan.actId,
            start: plan.start,
            end: plan.end,
            status: "pending"
          }))
        };
        await writeIntermediateJson("C", "slide_block_checkpoint_index.json", blockCheckpointIndex);

        const authoredBlocks: ReturnType<typeof SlideBlockSchema.parse>[] = [];
        const agentAuthoredSlideIds = new Set<string>();
        const actContextWarnings: string[] = [];
        let assembledForNarrativeState = DeckSpecSchema.parse(fallbackSeedDeck);
        let currentNarrativeState = NarrativeStateSchema.parse(
          buildNarrativeStateForBlock({
            blockId: "INIT",
            actId: "ACT1",
            storyBlueprint,
            actOutline,
            unresolvedThreads: storyBlueprint.unresolved_threads.slice(0, 8),
            priorBlockSummary: "Initial narrative state before block authoring.",
            recentSlideExcerpts: recentSlideExcerpts(fallbackSeedDeck, 1, Math.min(4, fallbackSeedDeck.slides.length)),
            activeDifferentialOrdering: [
              ...(workingDifferential.rotation_plan.act1_focus_dx_ids ?? []),
              ...(workingDifferential.rotation_plan.act2_expansion_dx_ids ?? []),
              ...(workingDifferential.rotation_plan.act3_collapse_dx_ids ?? []),
              workingDifferential.rotation_plan.act4_final_dx_id
            ]
              .filter((dx): dx is string => typeof dx === "string" && dx.trim().length > 0)
              .slice(0, 6),
            canonicalProfileExcerpt,
            episodeMemoryExcerpt,
            differentialCast: workingDifferential,
            clueGraph: workingClueGraph,
            dramaPlan: workingDramaPlan,
            setpiecePlan: workingSetpiecePlan,
            storyBeatHints: storyBeatHintsForPlan({
              plan: { actId: "ACT1" },
              storyBeats,
              chapterOutline
            })
          })
        );
        await writeIntermediateJson("C", "narrative_state_current.json", currentNarrativeState);
        let priorSummary = "No prior block summary.";
        let unresolvedThreads = storyBlueprint.unresolved_threads.slice(0, 8);
        for (const [planIndex, plan] of blockPlans.entries()) {
          const outlineActId = inferOutlineActForPlan(plan, actOutline);
          if (outlineActId && outlineActId !== plan.actId) {
            actContextWarnings.push(
              `Plan ${plan.blockId} uses actId=${plan.actId} but outline span resolves to ${outlineActId}; using plan.actId as canonical block context.`
            );
          }
          const beatHints = storyBeatHintsForPlan({
            plan,
            storyBeats,
            chapterOutline
          });
          const narrativeState = NarrativeStateSchema.parse(
            buildNarrativeStateForBlock({
              blockId: plan.blockId,
              actId: plan.actId,
              storyBlueprint,
              actOutline,
              unresolvedThreads,
              priorBlockSummary: priorSummary,
              recentSlideExcerpts: recentSlideExcerpts(assembledForNarrativeState, Math.max(1, plan.start - 4), Math.min(assembledForNarrativeState.slides.length, plan.start + 2)),
              activeDifferentialOrdering: [
                ...(workingDifferential.rotation_plan.act1_focus_dx_ids ?? []),
                ...(workingDifferential.rotation_plan.act2_expansion_dx_ids ?? []),
                ...(workingDifferential.rotation_plan.act3_collapse_dx_ids ?? []),
                workingDifferential.rotation_plan.act4_final_dx_id
              ]
                .filter((dx): dx is string => typeof dx === "string" && dx.trim().length > 0)
                .slice(0, 6),
              canonicalProfileExcerpt,
              episodeMemoryExcerpt,
              differentialCast: workingDifferential,
              clueGraph: workingClueGraph,
              dramaPlan: workingDramaPlan,
              setpiecePlan: workingSetpiecePlan,
              storyBeatHints: beatHints,
              previousState: currentNarrativeState
            })
          );
          currentNarrativeState = narrativeState;
          await writeIntermediateJson("C", `narrative_state_block_${plan.blockId}.json`, narrativeState);

          const medicalSlice = compactMedicalSliceForBlock({
            plan,
            diseaseDossier,
            truthModel,
            differentialCast: workingDifferential,
            clueGraph: workingClueGraph,
            microWorldMap: workingMicroWorldMap,
            dramaPlan: workingDramaPlan,
            setpiecePlan: workingSetpiecePlan
          });
          const blockTimeoutMs = slideBlockAuthorTimeoutMs(cTimeoutMs, generationProfile, plan);

          let block = buildSlideBlockFallback({
            deck: fallbackSeedDeck,
            plan,
            priorSummary
          });
          let blockFromAgent = false;
          const blockPreflightSkipped =
            deterministicPlanning || fallbackForLowBudget(`slideBlock.${plan.blockId}.preflight`, Math.max(80_000, Math.round(cTimeoutMs * 0.6)));
          if (!blockPreflightSkipped) {
            try {
              const rawBlock = SlideBlockAgentOutputSchema.parse(
                await runIsolatedAgentWithCompactRetry({
                  step: "C",
                  agentKey: "slideBlockAuthor",
                  agent: slideBlockAuthorAgent,
                  prompt: buildBlockPromptContext({
                    topic,
                    plan,
                    storyBlueprint,
                    actOutline,
                    narrativeState,
                    medicalSlice
                  }) + `\n\n${storyBeatsPromptSection}`,
                  compactPrompt:
                    buildBlockPromptContext({
                      topic,
                      plan,
                      storyBlueprint,
                      actOutline,
                      narrativeState,
                      medicalSlice,
                      mode: "retry_compact"
                    }) + `\n\n${clampText(storyBeatsPromptSection, 1800)}`,
                  maxTurns: 8,
                  timeoutMs: blockTimeoutMs,
                  signal: cSignal,
                  compactRetryTimeoutMs: Math.max(blockTimeoutMs, 300_000),
                  retryLabel: `[C] SlideBlockAuthor ${plan.blockId}`
                })
              );
              block = withResolvedSlideBlockSummary(
                normalizeSlideBlockAuthorOutput(rawBlock, assembledForNarrativeState)
              );
              blockFromAgent = true;
              deckAuthoringContextManifest.attempts.push({
                attempt_id: `slideBlockAuthor.${plan.blockId}.primary`,
                prompt_variant: "block_primary",
                context_mode: "compact",
                reason: "block_authoring",
                result: "success"
              });
            } catch (err) {
              if (shouldAbortOnError(err, cSignal)) throw err;
              const msg = err instanceof Error ? err.message : String(err);
              if (!allowStoryStageFallback) throw err;
              runs.log(runId, `SlideBlockAuthor agent fallback activated (${plan.blockId}; ${msg}).`, "C");
              recordFallback("deterministic_fallback", `slideBlockAuthor.${plan.blockId}`, msg);
              deckAuthoringContextManifest.attempts.push({
                attempt_id: `slideBlockAuthor.${plan.blockId}.primary`,
                prompt_variant: "block_primary",
                context_mode: "compact",
                reason: "block_authoring",
                result: "error",
                details: clampText(msg, 320)
              });
            }
          } else {
            deckAuthoringContextManifest.attempts.push({
              attempt_id: `slideBlockAuthor.${plan.blockId}.primary`,
              prompt_variant: "block_primary",
              context_mode: "compact",
              reason: deterministicPlanning ? "deterministic_planning_mode" : "budget_guard_preflight",
              result: "skipped"
            });
          }
          const normalizedOps = normalizeSlideBlockOperations({
            block,
            currentSlides: assembledForNarrativeState.slides
          });
          await writeIntermediateJson("C", `block_authoring_ops_${plan.blockId}.json`, {
            schema_version: "1.0.0",
            block_id: plan.blockId,
            operations: normalizedOps.operations,
            warnings: normalizedOps.warnings
          });
          if (blockFromAgent) {
            for (const slideId of collectBlockAuthoredSlideIds(block)) agentAuthoredSlideIds.add(slideId);
          }
          authoredBlocks.push(block);
          priorSummary = resolveSlideBlockSummary(block);
          unresolvedThreads = (block.unresolved_threads_out ?? unresolvedThreads).slice(0, 12);
          await writeIntermediateJson("C", `slide_block_${plan.blockId}.json`, block);
          blockCheckpointIndex.blocks[planIndex] = {
            ...blockCheckpointIndex.blocks[planIndex]!,
            status: blockFromAgent ? "agent_authored" : "deterministic_fallback",
            completed_at: nowIso()
          };
          await writeIntermediateJson("C", "slide_block_checkpoint_index.json", blockCheckpointIndex);
          const partialAssembly = assembleDeckFromSlideBlocks({
            scaffoldDeck: fallbackSeedDeck,
            blocks: authoredBlocks
          });
          assembledForNarrativeState = DeckSpecSchema.parse(partialAssembly.deck);
          await writeIntermediateJson("C", "narrative_state_current.json", currentNarrativeState);
        }
        if (actContextWarnings.length > 0) {
          await writeIntermediateJson("C", "block_act_context_warnings.json", {
            schema_version: "1.0.0",
            workflow: "v2_micro_detectives",
            generated_at: nowIso(),
            warnings: [...new Set(actContextWarnings)]
          });
        }

        const assembled = (() => {
          const out = assembleDeckFromSlideBlocks({
            scaffoldDeck: fallbackSeedDeck,
            blocks: authoredBlocks
          });
          const deckWithBlockProvenance = DeckSpecSchema.parse({
            ...out.deck,
            slides: out.deck.slides.map((slide) =>
              agentAuthoredSlideIds.has(canonicalSlideIdKey(slide.slide_id))
                ? { ...slide, authoring_provenance: "agent_authored" as const }
                : slide
            )
          });
          return {
            deck: deckWithBlockProvenance,
            report: DeckAssemblyReportSchema.parse(out.report)
          };
        })();
        await writeIntermediateJson("C", "deck_assembly_report.json", assembled.report);
        await writeIntermediateJson("C", "deck_spec_assembled.json", assembled.deck);

        let deckSpecMode = deckSpecGenerationMode(generationProfile);
        const deckRefineTimeoutMs = stepCDeckRefineTimeoutMs();
        let workingDeck: ReturnType<typeof DeckSpecSchema.parse> = assembled.deck;
        let deckUsedDeterministicFallback = false;
        const useMonolithicDeckAuthoring = generationProfile === "pilot" || deterministicPlanning;
        if (!useMonolithicDeckAuthoring) {
          try {
            const runCohesionPassAttempt = async (variant: "full" | "compact") =>
              DeckCohesionPassSchema.parse(
                await runIsolatedAgentOutput({
                  step: "C",
                  agentKey: "deckCohesionPass",
                  agent: deckCohesionPassAgent,
                  prompt: buildDeckCohesionPrompt({
                    deck: workingDeck,
                    storyBlueprint,
                    actOutline,
                    clueGraph: workingClueGraph,
                    dramaPlan: workingDramaPlan,
                    setpiecePlan: workingSetpiecePlan,
                    gate2Feedback,
                    compact: variant === "compact"
                  }),
                  maxTurns: 6,
                  timeoutMs:
                    variant === "full"
                      ? Math.max(120_000, Math.round(cTimeoutMs * 0.8))
                      : Math.max(120_000, Math.round(cTimeoutMs * 0.55)),
                  signal: cSignal
                })
              );

            let cohesionPass: ReturnType<typeof DeckCohesionPassSchema.parse>;
            let cohesionSuccessContext: "full" | "compact" = "full";
            try {
              cohesionPass = await runCohesionPassAttempt("full");
            } catch (cohesionPrimaryErr) {
              if (shouldAbortOnError(cohesionPrimaryErr, cSignal)) throw cohesionPrimaryErr;
              const primaryMsg = cohesionPrimaryErr instanceof Error ? cohesionPrimaryErr.message : String(cohesionPrimaryErr);
              deckAuthoringContextManifest.attempts.push({
                attempt_id: "deckCohesionPass.primary",
                prompt_variant: "cohesion_pass",
                context_mode: "full",
                reason: "quality_continuity_pass",
                result: "error",
                details: clampText(primaryMsg, 320)
              });
              if (!isLikelyTimeoutError(primaryMsg)) throw cohesionPrimaryErr;
              runs.log(runId, `Deck cohesion pass full-context retry downgraded to compact (${primaryMsg}).`, "C");
              recordFallback("agent_retry", "deckCohesionPass.primary", primaryMsg);
              cohesionPass = await runCohesionPassAttempt("compact");
              cohesionSuccessContext = "compact";
            }
            deckAuthoringContextManifest.attempts.push({
              attempt_id: "deckCohesionPass.primary",
              prompt_variant: "cohesion_pass",
              context_mode: cohesionSuccessContext,
              reason: cohesionSuccessContext === "full" ? "quality_continuity_pass" : "transport_retry",
              result: "success"
            });
            await writeIntermediateJson("C", "deck_cohesion_pass.json", cohesionPass);
            if (cohesionPass.must_fix_operations.length > 0) {
              const cohesionGuard = sanitizeDeckCohesionOperations({
                deck: workingDeck,
                operations: cohesionPass.must_fix_operations,
                generationProfile
              });
              await writeIntermediateJson("C", "deck_cohesion_pass_guardrail.json", {
                schema_version: "1.0.0",
                generated_at: nowIso(),
                original_operation_count: cohesionPass.must_fix_operations.length,
                accepted_operation_count: cohesionGuard.operations.length,
                projected_main_slide_count: cohesionGuard.projectedMainSlideCount,
                warnings: cohesionGuard.warnings
              });
              if (cohesionGuard.warnings.length > 0) {
                runs.log(
                  runId,
                  `Deck cohesion pass guardrails filtered ${cohesionPass.must_fix_operations.length - cohesionGuard.operations.length} operation(s).`,
                  "C"
                );
              }
              if (cohesionGuard.operations.length === 0) {
                runs.log(runId, "Deck cohesion pass produced no acceptable bounded operations; keeping assembled deck.", "C");
              }
              if (cohesionGuard.operations.length > 0) {
              const cohesionBlock = SlideBlockSchema.parse({
                schema_version: "1.0.0",
                block_id: "COHESION_PASS",
                act_id: "ACT4",
                slide_range: { start: 1, end: Math.max(1, workingDeck.slides.length) },
                operations: cohesionGuard.operations,
                block_summary_out: "Applied deck cohesion pass operations."
              });
              for (const slideId of collectBlockAuthoredSlideIds(cohesionBlock)) agentAuthoredSlideIds.add(slideId);
              const cohesionOps = normalizeSlideBlockOperations({
                block: cohesionBlock,
                currentSlides: workingDeck.slides
              });
              await writeIntermediateJson("C", "block_authoring_ops_COHESION_PASS.json", {
                schema_version: "1.0.0",
                block_id: "COHESION_PASS",
                operations: cohesionOps.operations,
                warnings: cohesionOps.warnings
              });
              const cohesionAssembly = assembleDeckFromSlideBlocks({
                scaffoldDeck: workingDeck,
                blocks: [cohesionBlock]
              });
              workingDeck = DeckSpecSchema.parse({
                ...cohesionAssembly.deck,
                slides: cohesionAssembly.deck.slides.map((slide) =>
                  agentAuthoredSlideIds.has(canonicalSlideIdKey(slide.slide_id))
                    ? { ...slide, authoring_provenance: "agent_authored" as const }
                    : slide
                )
              });
              await writeIntermediateJson("C", "deck_assembly_report_cohesion_pass.json", DeckAssemblyReportSchema.parse(cohesionAssembly.report));
              await writeIntermediateJson("C", "deck_spec_after_cohesion_pass.json", workingDeck);
              runs.log(runId, `Applied ${cohesionGuard.operations.length} cohesion-pass operation(s).`, "C");
              }
            }
          } catch (cohesionErr) {
            if (shouldAbortOnError(cohesionErr, cSignal)) throw cohesionErr;
            const msg = cohesionErr instanceof Error ? cohesionErr.message : String(cohesionErr);
            deckAuthoringContextManifest.attempts.push({
              attempt_id: "deckCohesionPass.compact",
              prompt_variant: "cohesion_pass",
              context_mode: "compact",
              reason: "quality_continuity_pass",
              result: "error",
              details: clampText(msg, 320)
            });
            if (adherenceMode === "strict" && !isLikelyTimeoutError(msg)) throw cohesionErr;
            runs.log(runId, `Deck cohesion pass unavailable; continuing with assembled deck (${msg}).`, "C");
            recordFallback("agent_retry", "deckCohesionPass", msg);
          }
        }
        if (useMonolithicDeckAuthoring) {
          if (
            deckSpecMode === "agent_full" &&
            fallbackForLowBudget("plotDirectorDeckSpec.preflight", Math.max(120_000, Math.round(deckSpecTimeoutMs * 0.8)))
          ) {
            deckSpecMode = "deterministic_refine";
          }

          if (deckSpecMode === "deterministic_refine") {
            runs.log(runId, "DeckSpec mode=deterministic_refine: seeded deterministic deck before lightweight model refinement.", "C");
            if (!attemptPlotDirectorRefinement) {
              runs.log(runId, "DeckSpec lightweight refinement skipped by policy.", "C");
              deckAuthoringContextManifest.attempts.push({
                attempt_id: "plotDirectorDeckSpec.refinement",
                prompt_variant: "kernel",
                context_mode: "compact",
                reason: "policy_skip",
                result: "skipped"
              });
            } else if (fallbackForLowBudget("plotDirectorDeckSpec.refinement.preflight", 90_000)) {
              runs.log(runId, "DeckSpec lightweight refinement skipped due to remaining step-C budget.", "C");
              deckAuthoringContextManifest.attempts.push({
                attempt_id: "plotDirectorDeckSpec.refinement",
                prompt_variant: "kernel",
                context_mode: "compact",
                reason: "budget_guard_preflight",
                result: "skipped"
              });
            } else {
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
                deckAuthoringContextManifest.attempts.push({
                  attempt_id: "plotDirectorDeckSpec.refinement",
                  prompt_variant: "kernel",
                  context_mode: "compact",
                  reason: "deterministic_seed_refinement",
                  result: "success"
                });
              } catch (refineErr) {
                if (shouldAbortOnError(refineErr, cSignal)) throw refineErr;
                const refineMsg = refineErr instanceof Error ? refineErr.message : String(refineErr);
                deckAuthoringContextManifest.attempts.push({
                  attempt_id: "plotDirectorDeckSpec.refinement",
                  prompt_variant: "kernel",
                  context_mode: "compact",
                  reason: "deterministic_seed_refinement",
                  result: "error",
                  details: clampText(refineMsg, 320)
                });
                if (adherenceMode === "strict") throw refineErr;
                runs.log(runId, `DeckSpec lightweight refinement unavailable; using deterministic seed (${refineMsg}).`, "C");
                recordFallback("agent_retry", "plotDirectorDeckSpec.refinement", refineMsg);
              }
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
              deckAuthoringContextManifest.attempts.push({
                attempt_id: "plotDirectorDeckSpec.primary",
                prompt_variant: "primary",
                context_mode: "full",
                reason: "primary_attempt",
                result: "success"
              });
            } catch (err) {
              if (shouldAbortOnError(err, cSignal)) throw err;
              const msg = err instanceof Error ? err.message : String(err);
              deckAuthoringContextManifest.attempts.push({
                attempt_id: "plotDirectorDeckSpec.primary",
                prompt_variant: "primary",
                context_mode: "full",
                reason: "primary_attempt",
                result: "error",
                details: clampText(msg, 320)
              });
              runs.log(runId, `DeckSpec primary attempt failed; retrying compact prompts (${msg}).`, "C");
              recordFallback("agent_retry", "plotDirectorDeckSpec.primary", msg);
              let recovered = false;
              try {
                if (fallbackForLowBudget("plotDirectorDeckSpec.ultra_compact.preflight", 140_000)) throw new Error("budget_guard");
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
                deckAuthoringContextManifest.attempts.push({
                  attempt_id: "plotDirectorDeckSpec.ultra_compact",
                  prompt_variant: "ultra_compact",
                  context_mode: "compact",
                  reason: "primary_retry",
                  result: "success"
                });
              } catch (compactErr) {
                if (shouldAbortOnError(compactErr, cSignal)) throw compactErr;
                const compactMsg = compactErr instanceof Error ? compactErr.message : String(compactErr);
                deckAuthoringContextManifest.attempts.push({
                  attempt_id: "plotDirectorDeckSpec.ultra_compact",
                  prompt_variant: "ultra_compact",
                  context_mode: "compact",
                  reason: "primary_retry",
                  result: "error",
                  details: clampText(compactMsg, 320)
                });
                runs.log(runId, `DeckSpec ultra-compact retry failed; trying kernel prompt (${compactMsg}).`, "C");
                recordFallback("agent_retry", "plotDirectorDeckSpec.ultra_compact", compactMsg);
                try {
                  if (fallbackForLowBudget("plotDirectorDeckSpec.kernel.preflight", 110_000)) throw new Error("budget_guard");
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
                  deckAuthoringContextManifest.attempts.push({
                    attempt_id: "plotDirectorDeckSpec.kernel",
                    prompt_variant: "kernel",
                    context_mode: "compact",
                    reason: "ultra_compact_retry",
                    result: "success"
                  });
                } catch (kernelErr) {
                  if (shouldAbortOnError(kernelErr, cSignal)) throw kernelErr;
                  if (adherenceMode === "strict") throw kernelErr;
                  const kernelMsg = kernelErr instanceof Error ? kernelErr.message : String(kernelErr);
                  deckAuthoringContextManifest.attempts.push({
                    attempt_id: "plotDirectorDeckSpec.kernel",
                    prompt_variant: "kernel",
                    context_mode: "compact",
                    reason: "ultra_compact_retry",
                    result: "error",
                    details: clampText(kernelMsg, 320)
                  });
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
        } else {
          runs.log(
            runId,
            "Quality block-authoring path active: using assembled slide blocks as primary DeckSpec and skipping monolithic Plot Director generation.",
            "C"
          );
          deckAuthoringContextManifest.attempts.push({
            attempt_id: "block_authoring.primary",
            prompt_variant: "assembled_blocks",
            context_mode: "full",
            reason: "quality_block_primary",
            result: "success"
          });
        }
        const intensifierPromptDigest = {
          deck_meta: workingDeck.deck_meta,
          acts: workingDeck.acts,
          slides: workingDeck.slides.map((slide) => ({
            slide_id: slide.slide_id,
            act_id: slide.act_id,
            beat_type: slide.beat_type,
            title: slide.title,
            hook: slide.hook,
            story_panel: slide.story_panel,
            delivery_mode: slide.medical_payload.delivery_mode
          }))
        };
        const intensifierCompactDigest = {
          deck_meta: workingDeck.deck_meta,
          slides_by_act: ["ACT1", "ACT2", "ACT3", "ACT4"].map((actId) => ({
            act_id: actId,
            slides: workingDeck.slides
              .filter((slide) => slide.act_id === actId)
              .slice(0, 12)
              .map((slide) => ({
                slide_id: slide.slide_id,
                title: slide.title,
                hook: clampText(slide.hook, 120),
                turn: clampText(slide.story_panel.turn, 120)
              }))
          }))
        };
        const shouldAttemptIntensifier = generationProfile === "quality" || !fallbackForLowBudget("narrativeIntensifier.preflight", 90_000);
        if (shouldAttemptIntensifier) {
          try {
            const intensifierPass = NarrativeIntensifierPassSchema.parse(
              await runIsolatedAgentWithCompactRetry({
                step: "C",
                agentKey: "narrativeIntensifier",
                agent: narrativeIntensifierAgent,
                prompt:
                  `DECK DIGEST (json):\n${JSON.stringify(intensifierPromptDigest, null, 2)}\n\n` +
                  `STORY BLUEPRINT (json):\n${JSON.stringify(storyBlueprint, null, 2)}\n\n` +
                  `ACT OUTLINE (json):\n${JSON.stringify(actOutline, null, 2)}\n\n` +
                  `CLUE GRAPH DIGEST (json):\n${JSON.stringify(clueDigest, null, 2)}\n\n` +
                  `DRAMA DIGEST (json):\n${JSON.stringify(dramaDigest, null, 2)}\n\n` +
                  `SETPIECE DIGEST (json):\n${JSON.stringify(setpieceDigest, null, 2)}\n\n` +
                  `${storyBeatsPromptSection}`,
                compactPrompt:
                  `DECK DIGEST (json):\n${JSON.stringify(intensifierCompactDigest, null, 2)}\n\n` +
                  `STORY BLUEPRINT DIGEST (json):\n${JSON.stringify(
                    {
                      opener_motif: storyBlueprint.opener_motif,
                      opener_motif_vocabulary: storyBlueprint.opener_motif_vocabulary,
                      ending_callback: storyBlueprint.ending_callback,
                      ending_callback_vocabulary: storyBlueprint.ending_callback_vocabulary,
                      act_debts: storyBlueprint.act_debts
                    },
                    null,
                    2
                  )}\n\n` +
                  `${clampText(storyBeatsPromptSection, 1400)}`,
                maxTurns: 6,
                timeoutMs: Math.max(120_000, Math.round(cTimeoutMs * 0.8)),
                signal: cSignal,
                compactRetryTimeoutMs: Math.max(150_000, Math.round(cTimeoutMs * 0.9)),
                retryLabel: "[C] NarrativeIntensifier"
              })
            );
            await writeIntermediateJson("C", "narrative_intensifier_pass.json", intensifierPass);
            const intensifierBlock = SlideBlockSchema.parse({
              schema_version: "1.0.0",
              block_id: "NARRATIVE_INTENSIFIER",
              act_id: "ACT4",
              slide_range: { start: 1, end: Math.max(1, workingDeck.slides.length) },
              operations: intensifierPass.operations,
              block_summary_out: intensifierPass.narrative_rationale.join(" ").slice(0, 400)
            });
            const normalizedOps = normalizeSlideBlockOperations({
              block: intensifierBlock,
              currentSlides: workingDeck.slides
            });
            await writeIntermediateJson("C", "block_authoring_ops_NARRATIVE_INTENSIFIER.json", {
              schema_version: "1.0.0",
              block_id: "NARRATIVE_INTENSIFIER",
              operations: normalizedOps.operations,
              warnings: normalizedOps.warnings
            });
            for (const slideId of collectBlockAuthoredSlideIds(intensifierBlock)) agentAuthoredSlideIds.add(slideId);
            const intensifierAssembly = assembleDeckFromSlideBlocks({
              scaffoldDeck: workingDeck,
              blocks: [intensifierBlock]
            });
            workingDeck = DeckSpecSchema.parse({
              ...intensifierAssembly.deck,
              slides: intensifierAssembly.deck.slides.map((slide) =>
                agentAuthoredSlideIds.has(canonicalSlideIdKey(slide.slide_id))
                  ? { ...slide, authoring_provenance: "agent_authored" as const }
                  : slide
              )
            });
            await writeIntermediateJson("C", "deck_spec_after_narrative_intensifier.json", workingDeck);
            await writeIntermediateJson("C", "deck_assembly_report_narrative_intensifier.json", DeckAssemblyReportSchema.parse(intensifierAssembly.report));
          } catch (err) {
            if (shouldAbortOnError(err, cSignal)) throw err;
            const msg = err instanceof Error ? err.message : String(err);
            if (generationProfile === "quality" && adherenceMode === "strict") throw err;
            runs.log(runId, `Narrative intensifier unavailable; continuing without it (${msg}).`, "C");
            await writeIntermediateJson("C", "narrative_intensifier_pass.json", {
              schema_version: "1.0.0",
              global_intensity_findings: ["Narrative intensifier unavailable; noop fallback recorded."],
              operations: [
                {
                  op: "replace_slide",
                  slide_id: workingDeck.slides[0]?.slide_id ?? "S01",
                  replacement_slide: workingDeck.slides[0] ?? fallbackSeedDeck.slides[0],
                  reason: `noop due to intensifier failure: ${clampText(msg, 180)}`
                }
              ],
              narrative_rationale: ["Pilot/noop fallback path used for narrative intensifier."],
              target_block_ids: [blockPlans[0]?.blockId ?? "ACT1_B01"]
            });
          }
        }
        const seedFromDeterministic = deckSpecMode === "deterministic_refine" || deckUsedDeterministicFallback;
        const semanticPolishSignal = deckNeedsSemanticPolish(workingDeck);
        if (deckUsedDeterministicFallback || semanticPolishSignal) {
          runs.log(runId, "DeckSpec triggered semantic polish guardrails.", "C");
          if (semanticPolishSignal) {
            recordFallback("deterministic_arbitration", "deckSpecSemanticPolish", "placeholder_or_low-semantic signal detected");
          }
        }
        const polishDecision = shouldRunFallbackPolish({
          deck: workingDeck,
          seedFromDeterministic
        });
        if (polishDecision.shouldRun) {
          workingDeck = DeckSpecSchema.parse(
            polishDeckSpecForFallback({
              deckSpec: workingDeck,
              dossier: diseaseDossier,
              differentialCast: workingDifferential,
              clueGraph: workingClueGraph,
              truthModel,
              topic,
              mode: polishDecision.mode
            })
          );
          runs.log(runId, `Applied fallback polish (${polishDecision.mode}; reason=${polishDecision.reason}).`, "C");
        } else {
          runs.log(runId, "Skipped fallback polish; using authored DeckSpec content unchanged.", "C");
        }
        const initialDeliveryNormalization = normalizeQualityDeckDeliveryModes(workingDeck, generationProfile);
        workingDeck = initialDeliveryNormalization.deck;
        if (initialDeliveryNormalization.adjustments.length > 0) {
          runs.log(
            runId,
            `Normalized ${initialDeliveryNormalization.adjustments.length} main-deck delivery mode(s) to story-forward labels.`,
            "C"
          );
          await writeIntermediateJson("C", "quality_delivery_mode_adjustments_seed.json", {
            schema_version: "1.0.0",
            workflow: "v2_micro_detectives",
            generated_at: nowIso(),
            adjustments: initialDeliveryNormalization.adjustments
          });
        }
        workingDeck = stabilizeQualityDeckArtifacts({
          deck: workingDeck,
          topic,
          episodeTitle: episodePitch.episode_title,
          generationProfile,
          dossier: diseaseDossier
        });
        workingDeck = stampDeckProvenance(workingDeck, { seedFromDeterministic });
        await writeIntermediateJson("C", "deck_authoring_context_manifest.json", deckAuthoringContextManifest);
        await writeIntermediateJson("C", "deck_spec_seed.json", workingDeck);

        const maxPatchLoops = resolveQaLoopBudget({
          estimatedMainSlides: workingDeck.slides.length,
          blockCount: blockPlans.length
        });
        const maxAttempts = maxPatchLoops + 1;
        const semanticThresholds = semanticAcceptanceThresholds(settings);
        let finalLintReport = V2DeckSpecLintReportSchema.parse(
          lintDeckSpecPhase1(workingDeck, {
            deckLengthConstraintEnabled: deckLengthPolicy.constraintEnabled,
            targetDeckLengthMain: deckLengthPolicy.softTarget,
            generationProfile,
            enforceQualityLints: generationProfile === "quality" && adherenceMode === "strict",
            stageAuthoringProvenance
          })
        );
        let finalReader!: ReturnType<typeof ReaderSimReportSchema.parse>;
        let finalFactcheck!: ReturnType<typeof MedFactcheckReportSchema.parse>;
        let finalQa!: ReturnType<typeof V2QaReportSchema.parse>;
        let finalSemantic = V2SemanticAcceptanceReportSchema.parse({
          schema_version: "1.0.0",
          workflow: "v2_micro_detectives",
          checked_at: nowIso(),
          thresholds: {
            min_story_forward_ratio: semanticThresholds.minStoryForwardRatio,
            min_hybrid_slide_quality: semanticThresholds.minHybridSlideQuality,
            min_citation_grounding_coverage: semanticThresholds.minCitationGroundingCoverage
          },
          metrics: {
            main_slide_count: 0,
            story_forward_ratio: 0,
            hybrid_slide_quality: 0,
            citation_grounding_coverage: 0
          },
          pass: false,
          failures: ["semantic acceptance not computed"],
          required_fixes: []
        });

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          if (cSignal.aborted) throw abortErrorFromSignal(cSignal, "Cancelled");
          const attemptDeliveryNormalization = normalizeQualityDeckDeliveryModes(workingDeck, generationProfile);
          workingDeck = attemptDeliveryNormalization.deck;
          if (attemptDeliveryNormalization.adjustments.length > 0) {
            await writeIntermediateJson("C", `quality_delivery_mode_adjustments_loop${attempt}.json`, {
              schema_version: "1.0.0",
              workflow: "v2_micro_detectives",
              generated_at: nowIso(),
              adjustments: attemptDeliveryNormalization.adjustments
            });
          }
          finalLintReport = V2DeckSpecLintReportSchema.parse(
            lintDeckSpecPhase1(workingDeck, {
              deckLengthConstraintEnabled: deckLengthPolicy.constraintEnabled,
              targetDeckLengthMain: deckLengthPolicy.softTarget,
              generationProfile,
              enforceQualityLints: generationProfile === "quality" && adherenceMode === "strict",
              stageAuthoringProvenance
            })
          );
          await writeIntermediateJson("C", `deck_spec_loop${attempt}.json`, workingDeck);
          await writeIntermediateJson("C", `deck_spec_lint_report_loop${attempt}.json`, finalLintReport);

          const readerPrompt =
            `DECK SPEC (json):\n${JSON.stringify(workingDeck, null, 2)}\n\n` +
            `TRUTH MODEL (json):\n${JSON.stringify(truthModel, null, 2)}\n\n` +
            `DIFFERENTIAL CAST (json):\n${JSON.stringify(workingDifferential, null, 2)}\n\n` +
            `CLUE GRAPH (json):\n${JSON.stringify(workingClueGraph, null, 2)}`;
          if (deterministicPlanning) {
            finalReader = ReaderSimReportSchema.parse(generateReaderSimReport(workingDeck, truthModel, workingClueGraph));
          } else if (fallbackForLowBudget("readerSim.preflight", Math.max(120_000, Math.round(cTimeoutMs * 0.9)))) {
            finalReader = ReaderSimReportSchema.parse(generateReaderSimReport(workingDeck, truthModel, workingClueGraph));
          } else {
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
          if (deterministicPlanning) {
            finalFactcheck = normalizeMedFactcheckReport(
              MedFactcheckReportSchema.parse(generateMedFactcheckReport(workingDeck, diseaseDossier)),
              workingDeck,
              diseaseDossier
            );
          } else if (fallbackForLowBudget("medFactcheck.preflight", Math.max(120_000, Math.round(cTimeoutMs * 0.9)))) {
            finalFactcheck = normalizeMedFactcheckReport(
              MedFactcheckReportSchema.parse(generateMedFactcheckReport(workingDeck, diseaseDossier)),
              workingDeck,
              diseaseDossier
            );
          } else {
            try {
              finalFactcheck = normalizeMedFactcheckReport(
                MedFactcheckAgentOutputSchema.parse(
                  await runIsolatedAgentOutput({
                    step: "C",
                    agentKey: "medFactcheck",
                    agent: medFactcheckAgent,
                    prompt: medFactPrompt,
                    maxTurns: 8,
                    timeoutMs: cTimeoutMs,
                    signal: cSignal
                  })
                ),
                workingDeck,
                diseaseDossier
              );
            } catch (err) {
              if (shouldAbortOnError(err, cSignal)) throw err;
              if (adherenceMode === "strict") throw err;
              const msg = err instanceof Error ? err.message : String(err);
              runs.log(runId, `MedFactcheck agent fallback activated (${msg}).`, "C");
              recordFallback("deterministic_fallback", "medFactcheck", msg);
              finalFactcheck = normalizeMedFactcheckReport(
                MedFactcheckReportSchema.parse(generateMedFactcheckReport(workingDeck, diseaseDossier)),
                workingDeck,
                diseaseDossier
              );
            }
          }
          const deterministicFactcheck = normalizeMedFactcheckReport(
            MedFactcheckReportSchema.parse(generateMedFactcheckReport(workingDeck, diseaseDossier)),
            workingDeck,
            diseaseDossier
          );
          if (adherenceMode === "strict") {
            const mergedFactcheck = normalizeMedFactcheckReport(
              mergeStrictMedFactcheckReports(finalFactcheck, deterministicFactcheck),
              workingDeck,
              diseaseDossier
            );
            if (mergedFactcheck.issues.length > finalFactcheck.issues.length) {
              runs.log(
                runId,
                `Strict med factcheck overlay injected ${mergedFactcheck.issues.length - finalFactcheck.issues.length} deterministic issue(s).`,
                "C"
              );
            }
            finalFactcheck = mergedFactcheck;
          } else if (shouldPreferDeterministicFactcheck(finalFactcheck, deterministicFactcheck)) {
            runs.log(
              runId,
              `MedFactcheck deterministic arbitration applied (agent_issues=${finalFactcheck.issues.length}, deterministic_issues=${deterministicFactcheck.issues.length}).`,
              "C"
            );
            recordFallback("deterministic_arbitration", "medFactcheck", "deterministic_factcheck_selected");
            finalFactcheck = deterministicFactcheck;
          }
          const groundedFactcheck = applyDiseaseResearchGroundingChecks({
            report: finalFactcheck,
            sourceReport: diseaseResearchSourceReport,
            dossier: diseaseDossier,
            generationProfile
          });
          if (groundedFactcheck.issues.length > finalFactcheck.issues.length) {
            runs.log(
              runId,
              `Curated-grounding QA injected ${groundedFactcheck.issues.length - finalFactcheck.issues.length} disease-research issue(s).`,
              "C"
            );
          }
          finalFactcheck = groundedFactcheck;
          await writeIntermediateJson("C", `med_factcheck_report_loop${attempt}.json`, finalFactcheck);

          finalQa = V2QaReportSchema.parse(
            buildCombinedQaReport({
              lintReport: finalLintReport,
              readerSimReport: finalReader,
              medFactcheckReport: finalFactcheck,
              clueGraph: workingClueGraph,
              deckSpec: workingDeck,
              generationProfile
            })
          );
          const semanticMetrics = evaluateSemanticAcceptance(workingDeck, semanticThresholds);
          const semanticFixes = buildSemanticRequiredFixes(semanticMetrics, semanticThresholds);
          finalSemantic = V2SemanticAcceptanceReportSchema.parse({
            schema_version: "1.0.0",
            workflow: "v2_micro_detectives",
            checked_at: nowIso(),
            thresholds: {
              min_story_forward_ratio: semanticThresholds.minStoryForwardRatio,
              min_hybrid_slide_quality: semanticThresholds.minHybridSlideQuality,
              min_citation_grounding_coverage: semanticThresholds.minCitationGroundingCoverage
            },
            metrics: {
              main_slide_count: semanticMetrics.mainSlideCount,
              story_forward_ratio: semanticMetrics.storyForwardRatio,
              hybrid_slide_quality: semanticMetrics.hybridSlideQuality,
              citation_grounding_coverage: semanticMetrics.citationGroundingCoverage
            },
            pass: semanticMetrics.pass,
            failures: semanticMetrics.failures,
            required_fixes: semanticFixes
          });
          if (!finalSemantic.pass) {
            const mergedRequiredFixes = [...finalQa.required_fixes, ...semanticFixes];
            const seenFixes = new Set<string>();
            finalQa = V2QaReportSchema.parse({
              ...finalQa,
              accept: false,
              required_fixes: mergedRequiredFixes.filter((fix) => {
                if (seenFixes.has(fix.fix_id)) return false;
                seenFixes.add(fix.fix_id);
                return true;
              }),
              summary: `${finalQa.summary} Semantic acceptance gate failed: ${finalSemantic.failures.join("; ")}.`
            });
          }
          await writeIntermediateJson("C", `qa_report_loop${attempt}.json`, finalQa);
          await writeIntermediateJson("C", `semantic_acceptance_report_loop${attempt}.json`, finalSemantic);
          const qaHeatmap = QaBlockHeatmapSchema.parse(
            buildQaBlockHeatmap({
              deckSpec: workingDeck,
              blockPlans,
              readerSimReport: finalReader,
              semanticMetrics,
              loop: attempt
            })
          );
          await writeIntermediateJson("C", `qa_block_heatmap_loop${attempt}.json`, qaHeatmap);

          const strictFailed = !finalLintReport.pass || !finalFactcheck.pass || !finalQa.accept;
          if (!strictFailed) break;
          if (attempt >= maxAttempts) break;

          const structuralFixes = finalQa.required_fixes.filter((fix) => isStructuralRegenFix(fix));
          let structuralRegeneratedBlocks = 0;
          let structuralRegenApplied = false;

          if (generationProfile === "quality" && structuralFixes.length > 0) {
            const structuralTrace: {
              schema_version: "1.0.0";
              loop: number;
              fix_count: number;
              fix_types: string[];
              routes: string[];
              regenerated_blocks: string[];
              warnings: string[];
            } = {
              schema_version: "1.0.0",
              loop: attempt,
              fix_count: structuralFixes.length,
              fix_types: [...new Set(structuralFixes.map((fix) => fix.type))],
              routes: [],
              regenerated_blocks: [],
              warnings: []
            };
            const requiresArcRegen = structuralFixes.some(
              (fix) =>
                fix.type === "increase_story_turn" ||
                fix.type === "regenerate_section" ||
                fix.type === "add_twist_receipts"
            );
            if (requiresArcRegen) {
              const arcFixSummary = structuralFixes
                .map((fix) => `${fix.type}: ${fix.description}`)
                .slice(0, 16);
              try {
                storyBlueprint = StoryBlueprintSchema.parse(
                  await runIsolatedAgentOutput({
                    step: "C",
                    agentKey: "storyBlueprint",
                    agent: storyBlueprintAgent,
                    prompt:
                      `${storyBlueprintPrompt}\n\n` +
                      `STRUCTURAL QUALITY FIXES (json):\n${JSON.stringify(arcFixSummary, null, 2)}\n\n` +
                      "REGEN OBJECTIVE:\n" +
                      "- Strengthen false-theory lock/collapse and detective/deputy rupture+repair continuity.\n" +
                      "- Preserve clue fairness and ending callback closure.",
                    maxTurns: 8,
                    timeoutMs: Math.max(90_000, Math.round(cTimeoutMs * 0.75)),
                    signal: cSignal
                  })
                );
                structuralTrace.routes.push("story_blueprint_regen");
                await writeIntermediateJson("C", `story_blueprint_regen_loop${attempt}.json`, storyBlueprint);
              } catch (storyRegenErr) {
                if (shouldAbortOnError(storyRegenErr, cSignal)) throw storyRegenErr;
                const msg = storyRegenErr instanceof Error ? storyRegenErr.message : String(storyRegenErr);
                structuralTrace.warnings.push(`story_blueprint_regen_failed: ${msg}`);
                if (adherenceMode === "strict") throw storyRegenErr;
                runs.log(runId, `Story blueprint regeneration unavailable (${msg}); continuing with prior blueprint.`, "C");
              }

              try {
                actOutline = ActOutlineSchema.parse(
                  await runIsolatedAgentOutput({
                    step: "C",
                    agentKey: "actOutline",
                    agent: actOutlineAgent,
                    prompt:
                      `TOPIC:\n${topic}\n\n` +
                      `STORY BLUEPRINT (json):\n${JSON.stringify(storyBlueprint, null, 2)}\n\n` +
                      `TRUTH MODEL (json):\n${JSON.stringify(truthModel, null, 2)}\n\n` +
                      `CLUE GRAPH (json):\n${JSON.stringify(workingClueGraph, null, 2)}\n\n` +
                      `STRUCTURAL QUALITY FIXES (json):\n${JSON.stringify(arcFixSummary, null, 2)}\n\n` +
                      `${storyBeatsPromptSection}`,
                    maxTurns: 8,
                    timeoutMs: Math.max(90_000, Math.round(cTimeoutMs * 0.75)),
                    signal: cSignal
                  })
                );
                structuralTrace.routes.push("act_outline_regen");
                await writeIntermediateJson("C", `act_outline_regen_loop${attempt}.json`, actOutline);
                const nextPlans = planSlideBlocksFromOutline(
                  actOutline,
                  preferredBlockSize(generationProfile, estimateMainSlidesFromOutline(actOutline))
                );
                if (nextPlans.length === blockPlans.length) {
                  blockPlans = nextPlans;
                } else {
                  structuralTrace.warnings.push(
                    `act_outline_regen produced ${nextPlans.length} blocks; keeping prior block plan count=${blockPlans.length}`
                  );
                }
              } catch (actRegenErr) {
                if (shouldAbortOnError(actRegenErr, cSignal)) throw actRegenErr;
                const msg = actRegenErr instanceof Error ? actRegenErr.message : String(actRegenErr);
                structuralTrace.warnings.push(`act_outline_regen_failed: ${msg}`);
                if (adherenceMode === "strict") throw actRegenErr;
                runs.log(runId, `Act outline regeneration unavailable (${msg}); continuing with prior outline.`, "C");
              }
            }

            const blockIndexes = resolveStructuralBlockIndexes(structuralFixes, blockPlans, qaHeatmap);
            for (const blockIndex of blockIndexes) {
              const plan = blockPlans[blockIndex];
              if (!plan) continue;
              const priorBlockSummary = blockIndex > 0
                ? authoredBlocks[blockIndex - 1]?.block_summary_out ?? "No prior block summary."
                : "No prior block summary.";
              const unresolvedThreadsIn = blockIndex > 0
                ? authoredBlocks[blockIndex - 1]?.unresolved_threads_out ?? storyBlueprint.unresolved_threads.slice(0, 8)
                : storyBlueprint.unresolved_threads.slice(0, 8);
              const blockFixDescriptions = structuralFixes
                .filter((fix) => {
                  const targetSlideIds = extractSlideIdsFromFixes([fix]);
                  if (targetSlideIds.size === 0) return true;
                  for (const targetSlideId of targetSlideIds) {
                    const targetSlideNum = parseSlideNumber(targetSlideId);
                    if (targetSlideNum === null) continue;
                    if (targetSlideNum >= plan.start && targetSlideNum <= plan.end) return true;
                  }
                  return false;
                })
                .map((fix) => `${fix.type}: ${fix.description}`);
              const regenGuidance = buildStructuralRegenGuidance({
                fixes: structuralFixes,
                plan
              });
              const regenNarrativeState = NarrativeStateSchema.parse(
                buildNarrativeStateForBlock({
                  blockId: `${plan.blockId}:regen_loop${attempt}`,
                  actId: plan.actId,
                  storyBlueprint,
                  actOutline,
                  unresolvedThreads: unresolvedThreadsIn,
                  priorBlockSummary,
                  recentSlideExcerpts: recentSlideExcerpts(workingDeck, plan.start, plan.end),
                  activeDifferentialOrdering: [
                    ...(workingDifferential.rotation_plan.act1_focus_dx_ids ?? []),
                    ...(workingDifferential.rotation_plan.act2_expansion_dx_ids ?? []),
                    ...(workingDifferential.rotation_plan.act3_collapse_dx_ids ?? []),
                    workingDifferential.rotation_plan.act4_final_dx_id
                  ]
                    .filter((dx): dx is string => typeof dx === "string" && dx.trim().length > 0)
                    .slice(0, 6),
                  canonicalProfileExcerpt,
                  episodeMemoryExcerpt,
                  differentialCast: workingDifferential,
                  clueGraph: workingClueGraph,
                  dramaPlan: workingDramaPlan,
                  setpiecePlan: workingSetpiecePlan,
                  storyBeatHints: storyBeatHintsForPlan({
                    plan,
                    storyBeats,
                    chapterOutline
                  }),
                  previousState: currentNarrativeState
                })
              );
              const regenMedicalSlice = compactMedicalSliceForBlock({
                plan,
                diseaseDossier,
                truthModel,
                differentialCast: workingDifferential,
                clueGraph: workingClueGraph,
                microWorldMap: workingMicroWorldMap,
                dramaPlan: workingDramaPlan,
                setpiecePlan: workingSetpiecePlan
              });

              try {
                const rawRegenerated = SlideBlockAgentOutputSchema.parse(
                  await runIsolatedAgentOutput({
                    step: "C",
                    agentKey: "slideBlockAuthor",
                    agent: slideBlockAuthorAgent,
                    prompt:
                      `${buildBlockPromptContext({
                        topic,
                        plan,
                        storyBlueprint,
                        actOutline,
                        narrativeState: regenNarrativeState,
                        medicalSlice: regenMedicalSlice
                      })}\n\n` +
                      `${storyBeatsPromptSection}\n\n` +
                      `QUALITY REGEN FIXES FOR THIS BLOCK:\n${JSON.stringify(blockFixDescriptions, null, 2)}\n\n` +
                      `QUALITY REGEN TARGET SLIDES:\n${JSON.stringify(regenGuidance.targetSlideIds, null, 2)}\n\n` +
                      `QUALITY REGEN POLICY:\n${JSON.stringify(regenGuidance.policySummary, null, 2)}\n\n` +
                      "REGEN RULES:\n" +
                      "- Resolve the listed quality fixes in this block.\n" +
                      "- Convert passive note_only or weak exhibit slides into clue, dialogue, or action beats when they carry a full story turn.\n" +
                      "- If a slide remains exhibit, the exhibit must force a decision or consequence on that same slide.\n" +
                      "- Prefer replace_window or split_slide if multiple weak slides are flattening pacing across this window.\n" +
                      "- Preserve clue continuity and unresolved thread handoffs.\n" +
                      "- Do not add placeholder/fallback wording.",
                    maxTurns: 8,
                    timeoutMs: Math.max(120_000, Math.round(slideBlockAuthorTimeoutMs(cTimeoutMs, generationProfile, plan) * 0.85)),
                    signal: cSignal
                  })
                );
                const regenerated = withResolvedSlideBlockSummary(
                  normalizeSlideBlockAuthorOutput(rawRegenerated, workingDeck)
                );
                authoredBlocks[blockIndex] = regenerated;
                for (const slideId of collectBlockAuthoredSlideIds(regenerated)) agentAuthoredSlideIds.add(slideId);
                await writeIntermediateJson("C", `slide_block_${plan.blockId}_regen_loop${attempt}.json`, regenerated);
                await writeIntermediateJson("C", `narrative_state_block_${plan.blockId}_regen_loop${attempt}.json`, regenNarrativeState);
                const regenOps = normalizeSlideBlockOperations({
                  block: regenerated,
                  currentSlides: workingDeck.slides
                });
                await writeIntermediateJson("C", `block_authoring_ops_${plan.blockId}_regen_loop${attempt}.json`, {
                  schema_version: "1.0.0",
                  block_id: plan.blockId,
                  operations: regenOps.operations,
                  warnings: regenOps.warnings
                });
                structuralRegeneratedBlocks += 1;
                structuralRegenApplied = true;
                structuralTrace.regenerated_blocks.push(plan.blockId);
              } catch (regenErr) {
                if (shouldAbortOnError(regenErr, cSignal)) throw regenErr;
                const regenMsg = regenErr instanceof Error ? regenErr.message : String(regenErr);
                runs.log(runId, `Slide-block structural regeneration fallback (${plan.blockId}; ${regenMsg}).`, "C");
                recordFallback("deterministic_fallback", `slideBlockRegen.${plan.blockId}`, regenMsg);
                const fallbackBlock = buildSlideBlockFallback({
                  deck: workingDeck,
                  plan,
                  priorSummary: priorBlockSummary
                });
                authoredBlocks[blockIndex] = fallbackBlock;
                await writeIntermediateJson("C", `slide_block_${plan.blockId}_regen_fallback_loop${attempt}.json`, fallbackBlock);
                structuralRegeneratedBlocks += 1;
                structuralRegenApplied = true;
                structuralTrace.regenerated_blocks.push(plan.blockId);
                structuralTrace.warnings.push(`slideBlockRegen fallback used for ${plan.blockId}: ${regenMsg}`);
              }
            }

            if (structuralRegenApplied) {
              const structuralAssembly = assembleDeckFromSlideBlocks({
                scaffoldDeck: workingDeck,
                blocks: authoredBlocks
              });
              workingDeck = stabilizeQualityDeckArtifacts({
                deck: DeckSpecSchema.parse({
                  ...structuralAssembly.deck,
                  slides: structuralAssembly.deck.slides.map((slide) =>
                    agentAuthoredSlideIds.has(canonicalSlideIdKey(slide.slide_id))
                      ? { ...slide, authoring_provenance: "agent_authored" as const }
                      : slide
                  )
                }),
                topic,
                episodeTitle: episodePitch.episode_title,
                generationProfile,
                dossier: diseaseDossier
              });
              await writeIntermediateJson("C", `deck_assembly_report_regen_loop${attempt}.json`, DeckAssemblyReportSchema.parse(structuralAssembly.report));
              await writeIntermediateJson("C", `deck_spec_regen_loop${attempt}.json`, workingDeck);
              assembledForNarrativeState = workingDeck;
              await writeIntermediateJson("C", "narrative_state_current.json", currentNarrativeState);
            }
            await writeIntermediateJson("C", `block_regen_trace_loop${attempt}.json`, structuralTrace);
          }

          const patchFixes = structuralRegenApplied
            ? finalQa.required_fixes.filter((fix) => !isStructuralRegenFix(fix))
            : finalQa.required_fixes;
          const patchQa = patchFixes.length === finalQa.required_fixes.length
            ? finalQa
            : V2QaReportSchema.parse({
                ...finalQa,
                required_fixes: patchFixes
              });
          const patch = applyTargetedQaPatches({
            deckSpec: workingDeck,
            clueGraph: workingClueGraph,
            differentialCast: workingDifferential,
            qaReport: patchQa,
            loopIndex: attempt,
            dossier: diseaseDossier
          });
          const patchedDeckCandidate = DeckSpecSchema.parse(patch.deck);
          const patchPolishDecision = shouldRunFallbackPolish({
            deck: patchedDeckCandidate,
            seedFromDeterministic
          });
          workingDeck = patchPolishDecision.shouldRun
            ? DeckSpecSchema.parse(
                polishDeckSpecForFallback({
                  deckSpec: patchedDeckCandidate,
                  dossier: diseaseDossier,
                  differentialCast: patch.differentialCast,
                  clueGraph: patch.clueGraph,
                  truthModel,
                  topic,
                  mode: patchPolishDecision.mode
                })
              )
            : patchedDeckCandidate;
          if (patchPolishDecision.shouldRun) {
            runs.log(
              runId,
              `Applied post-patch fallback polish (${patchPolishDecision.mode}; reason=${patchPolishDecision.reason}) in QA loop ${attempt}.`,
              "C"
            );
          }
          workingDeck = stabilizeQualityDeckArtifacts({
            deck: workingDeck,
            topic,
            episodeTitle: episodePitch.episode_title,
            generationProfile,
            dossier: diseaseDossier
          });
          workingDeck = stampDeckProvenance(workingDeck);
          workingClueGraph = ClueGraphSchema.parse(patch.clueGraph);
          workingDifferential = DifferentialCastSchema.parse(patch.differentialCast);
          await writeIntermediateJson("C", `deck_spec_patched_loop${attempt}.json`, workingDeck);
          await writeIntermediateJson("C", `clue_graph_patched_loop${attempt}.json`, workingClueGraph);
          await writeIntermediateJson("C", `differential_cast_patched_loop${attempt}.json`, workingDifferential);
          await writeIntermediateJson("C", `qa_patch_notes_loop${attempt}.json`, {
            schema_version: "1.0.0",
            loop: attempt,
            structural_regeneration: structuralRegenApplied
              ? {
                  used: true,
                  regenerated_block_count: structuralRegeneratedBlocks
                }
              : {
                  used: false,
                  regenerated_block_count: 0
                },
            patch_notes: patch.patchNotes,
            deck_changes: patch.deckChanges,
            clue_changes: patch.clueChanges,
            differential_changes: patch.differentialChanges
          });
          runs.log(
            runId,
            `QA loop ${attempt} requested fixes; ${
              structuralRegenApplied ? `structural block regeneration=${structuralRegeneratedBlocks}, ` : ""
            }targeted patches (deck=${patch.deckChanges}, clues=${patch.clueChanges}, differentials=${patch.differentialChanges}).`,
            "C"
          );
        }

        workingDeck = stampDeckProvenance(workingDeck);
        const provenance = workingDeck.deck_meta.authoring_provenance_counts ?? {
          agent_authored: 0,
          deterministic_scaffold: 0,
          patched_scaffold: 0
        };
        const scaffoldCount = provenance.deterministic_scaffold + provenance.patched_scaffold;
        const scaffoldLimit = scaffoldSlideLimit(workingDeck.slides.length);
        if (
          generationProfile === "quality" &&
          adherenceMode === "strict" &&
          finalLintReport.pass &&
          finalFactcheck.pass &&
          finalQa.accept &&
          scaffoldCount > scaffoldLimit
        ) {
          throw new Error(
            `Quality finalization blocked: scaffold-derived slides=${scaffoldCount} exceed limit=${scaffoldLimit} (mainSlides=${workingDeck.slides.length}).`
          );
        }
        if (generationProfile === "quality" && adherenceMode === "strict" && deckNeedsSemanticPolish(workingDeck)) {
          throw new Error(
            "Quality finalization blocked: deck still contains scaffold placeholder markers after QA/regeneration."
          );
        }

        await writeIntermediateJson("C", "differential_cast.json", workingDifferential);
        await writeIntermediateJson("C", "clue_graph.json", workingClueGraph);
        await writeIntermediateJson("C", "deck_spec.json", workingDeck);
        await writeIntermediateJson("C", "deck_spec_lint_report.json", finalLintReport);
        await writeIntermediateJson("C", "reader_sim_report.json", finalReader);
        await writeIntermediateJson("C", "med_factcheck_report.json", finalFactcheck);
        await writeIntermediateJson("C", "qa_report.json", finalQa);
        await writeIntermediateJson("C", "semantic_acceptance_report.json", finalSemantic);
        const storyBeatsAlignmentReport = buildStoryBeatsAlignmentReport({
          storyBeats,
          chapterOutline,
          deck: workingDeck,
          blockPlans,
          adherenceMode
        });
        await writeIntermediateJson("C", "story_beats_alignment_report.json", storyBeatsAlignmentReport);
        if (storyBeatsAlignmentReport.lint_status === "fail") {
          throw new Error(
            `Story beats alignment failed in strict mode: ${storyBeatsAlignmentReport.warnings.join("; ")}`
          );
        }
        if (storyBeatsAlignmentReport.lint_status === "warn") {
          runs.log(
            runId,
            `Story beats alignment warning: ${storyBeatsAlignmentReport.warnings.join("; ")}`,
            "C"
          );
        }

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
      await requireGateApproval(
        "C",
        "GATE_4_FINAL",
        "Gate 4: review final packaging artifacts before run completion.",
        "Submit /api/runs/:runId/gates/GATE_4_FINAL/submit with status=approve, then call /api/runs/:runId/resume."
      );
    } else {
      runs.log(runId, "Reusing C artifacts", "C");
      await ensureArtifactExists(runId, "deck_spec.json");
      await ensureArtifactExists(runId, V2_PHASE4_FINAL_ARTIFACTS.mainDeckRenderPlan);
      await ensureArtifactExists(runId, V2_PHASE4_FINAL_ARTIFACTS.appendixRenderPlan);
      await ensureArtifactExists(runId, V2_PHASE4_FINAL_ARTIFACTS.speakerNotesBundle);
      await ensureArtifactExists(runId, V2_PHASE4_FINAL_ARTIFACTS.packagingSummary);
    }
  });

  runs.log(runId, "V2 micro-detectives phase 4 complete.");
}
