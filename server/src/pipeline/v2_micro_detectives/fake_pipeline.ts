import path from "node:path";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { PipelinePause } from "../../executor.js";
import type { RunManager, RunSettings, StepName } from "../../run_manager.js";
import { resolveCanonicalProfilePaths } from "../canon.js";
import { resolveArtifactPathAbs, runFinalDirAbs, runIntermediateDirAbs, writeJsonFile, writeTextFile } from "../utils.js";
import { loadV2Assets } from "./assets.js";
import { buildCitationTraceabilityReport } from "./citation_traceability.js";
import { generateV2DeckSpec } from "./generator.js";
import { lintDeckSpecPhase1 } from "./lints.js";
import { generateDiseaseDossier, generateEpisodePitch, generateMedFactcheckReport, generateTruthModel } from "./phase2_generator.js";
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
import { applyTargetedQaPatches, buildCombinedQaReport } from "./phase3_quality.js";
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
const V2_PHASE4_FINAL_ARTIFACTS = {
  mainDeckRenderPlan: "V2_MAIN_DECK_RENDER_PLAN.md",
  appendixRenderPlan: "V2_APPENDIX_RENDER_PLAN.md",
  speakerNotesBundle: "V2_SPEAKER_NOTES_WITH_CITATIONS.md",
  templateRegistry: "v2_template_registry.json"
} as const;

function parseDelayMs(): number {
  const raw = Number(process.env.MMS_FAKE_STEP_DELAY_MS ?? 80);
  if (!Number.isFinite(raw) || raw < 0) return 80;
  return Math.min(2000, raw);
}

function maxQaPatchLoops(): number {
  const raw = Number(process.env.MMS_V2_QA_MAX_LOOPS ?? 2);
  if (!Number.isFinite(raw)) return 2;
  return Math.max(0, Math.min(5, Math.round(raw)));
}

function forceFakeDeckFallback(topic: string): boolean {
  const env = (process.env.MMS_V2_FAKE_FORCE_DECK_FALLBACK ?? "").trim();
  if (env === "1" || env.toLowerCase() === "true") return true;
  return /\bforce[-_ ]?fallback\b/i.test(topic);
}

function isV2Step(step: StepName): boolean {
  return V2_STEPS.includes(step);
}

function stepIndex(step: StepName): number {
  return V2_STEPS.indexOf(step);
}

function gateResumeStep(gateId: V2GateId): StepName {
  if (gateId === "GATE_1_PITCH") return "B";
  if (gateId === "GATE_2_TRUTH_LOCK") return "C";
  return "C";
}

async function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Cancelled"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(new Error("Cancelled"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function readJsonArtifact<T>(runId: string, name: string): Promise<T> {
  const resolved = await resolveArtifactPathAbs(runId, name);
  if (!resolved) throw new Error(`Missing required artifact: ${name}`);
  const raw = await fs.readFile(resolved, "utf8");
  return JSON.parse(raw) as T;
}

export async function runMicroDetectivesFakePipeline(input: RunInput, runs: RunManager, options: PipelineOptions): Promise<void> {
  const { runId, topic, settings } = input;
  const { signal } = options;
  const delayMs = parseDelayMs();
  const adherenceMode = settings?.adherenceMode ?? "strict";
  const startFrom = options.startFrom ?? "KB0";
  const expectedDeckLength = settings?.deckLengthMain ?? 45;
  const audienceLevel = settings?.audienceLevel ?? "MED_SCHOOL_ADVANCED";
  const fakeForceDeckFallback = forceFakeDeckFallback(topic);

  if (!isV2Step(startFrom)) {
    throw new Error(`Invalid startFrom for v2: ${startFrom}. Supported: ${V2_STEPS.join(", ")}`);
  }

  const shouldRun = (step: StepName): boolean => stepIndex(step) >= stepIndex(startFrom);

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

    await writeIntermediateJson(step, "micro_world_map.json", microWorldMap);
    await writeIntermediateJson(step, "drama_plan.json", dramaPlan);
    await writeIntermediateJson(step, "setpiece_plan.json", setpiecePlan);
    await writeIntermediateJson(step, V2_PHASE4_FINAL_ARTIFACTS.templateRegistry, templateRegistry);
    await writeIntermediateJson(step, "v2_phase4_packaging_manifest.json", {
      schema_version: "1.0.0",
      mode: "fake",
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
    await writeFinalText(
      step,
      V2_PHASE4_FINAL_ARTIFACTS.mainDeckRenderPlan,
      buildMainDeckRenderPlanMd({
        deck: deckSpec,
        truthModel,
        clueGraph,
        differentialCast,
        microWorldMap,
        setpiecePlan
      })
    );
    await writeFinalText(step, V2_PHASE4_FINAL_ARTIFACTS.appendixRenderPlan, buildAppendixRenderPlanMd(deckSpec));
    await writeFinalText(step, V2_PHASE4_FINAL_ARTIFACTS.speakerNotesBundle, buildSpeakerNotesWithCitationsMd(deckSpec));
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
      const msg = err instanceof Error ? err.message : String(err);
      await runs.finishStep(runId, step, false, msg);
      throw err;
    }
  }

  async function requireGateApproval(step: StepName, gateId: V2GateId, message: string, nextAction: string): Promise<void> {
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
      return;
    }
    throw new PipelinePause(gateId, gateResumeStep(gateId), message);
  }

  runs.log(runId, `V2 micro-detectives phase 4 start (fake mode, startFrom=${startFrom})`);
  await writeFinalJson("KB0", "trace.json", { traceId: `trace_fake_v2_${runId}`, workflow: "v2_micro_detectives", phase: "phase4", mode: "fake" });

  const canonicalPaths = resolveCanonicalProfilePaths();
  const foundAny =
    (canonicalPaths.characterBiblePath ? existsSync(canonicalPaths.characterBiblePath) : false) ||
    (canonicalPaths.seriesStyleBiblePath ? existsSync(canonicalPaths.seriesStyleBiblePath) : false) ||
    (canonicalPaths.deckSpecPath ? existsSync(canonicalPaths.deckSpecPath) : false);
  await runs.setCanonicalSources(runId, { ...canonicalPaths, foundAny });

  let kbContext = "";
  await runStep("KB0", async () => {
    kbContext = [
      "## Medical / Clinical KB",
      "Deterministic fake-mode KB context for v2 phase 2.",
      "",
      "## Characters & Story Constraints",
      "Maintain recurring character continuity.",
      "",
      "## Visual Style / Shot Constraints",
      "Keep visual language readable and story-forward."
    ].join("\n");
    await writeIntermediateText("KB0", "kb_context.md", kbContext);
    await writeIntermediateJson("KB0", "canonical_profile_sources.json", canonicalPaths);
  });
  if (!shouldRun("KB0")) {
    const reused = await resolveArtifactPathAbs(runId, "kb_context.md");
    if (!reused) throw new Error("Missing required artifact: kb_context.md");
    kbContext = await fs.readFile(reused, "utf8").catch(() => "");
  }

  let diseaseDossier = shouldRun("A")
    ? generateDiseaseDossier({
        topic,
        deckLengthMain: expectedDeckLength,
        audienceLevel,
        kbContext
      })
    : DiseaseDossierSchema.parse(await readJsonArtifact(runId, "disease_dossier.json"));
  diseaseDossier = normalizeDossierCitationIds(DiseaseDossierSchema.parse(diseaseDossier), topic);

  await runStep("A", async () => {
    diseaseDossier = DiseaseDossierSchema.parse(
      generateDiseaseDossier({
        topic,
        deckLengthMain: expectedDeckLength,
        audienceLevel,
        kbContext
      })
    );
    diseaseDossier = normalizeDossierCitationIds(diseaseDossier, topic);
    const pitch = generateEpisodePitch({ topic, deckLengthMain: expectedDeckLength, audienceLevel, kbContext }, diseaseDossier);
    await writeIntermediateJson("A", "disease_dossier.json", diseaseDossier);
    await writeIntermediateJson("A", "episode_pitch.json", pitch);
    const assets = await loadV2Assets();
    await writeIntermediateJson("A", "v2_assets_manifest.json", {
      root: assets.root,
      sourceRoot: assets.sourceRoot,
      usingSourceOverlay: assets.usingSourceOverlay,
      schemaFiles: Object.keys(assets.schemaFiles),
      promptFiles: Object.keys(assets.promptFiles),
      promptMarkers: assets.manifest.promptMarkers
    });
  });

  if (startFrom !== "C") {
    await requireGateApproval(
      "A",
      "GATE_1_PITCH",
      "Gate 1: review episode_pitch.json before truth lock generation.",
      "Submit /api/runs/:runId/gates/GATE_1_PITCH/submit with status=approve, then call /api/runs/:runId/resume."
    );
  }

  const episodePitch = EpisodePitchSchema.parse(await readJsonArtifact(runId, "episode_pitch.json"));

  let truthModel = shouldRun("B")
    ? generateTruthModel({ topic, deckLengthMain: expectedDeckLength, audienceLevel, kbContext }, diseaseDossier, episodePitch)
    : TruthModelSchema.parse(await readJsonArtifact(runId, "truth_model.json"));
  truthModel = TruthModelSchema.parse(truthModel);

  await runStep("B", async () => {
    truthModel = TruthModelSchema.parse(
      generateTruthModel({ topic, deckLengthMain: expectedDeckLength, audienceLevel, kbContext }, diseaseDossier, episodePitch)
    );
    await writeIntermediateJson("B", "truth_model.json", truthModel);
  });

  await requireGateApproval(
    "B",
    "GATE_2_TRUTH_LOCK",
    "Gate 2: review truth_model.json before deck specification.",
    "Submit /api/runs/:runId/gates/GATE_2_TRUTH_LOCK/submit with status=approve, then call /api/runs/:runId/resume."
  );

  const gate3Latest = latestGateDecision(await readHumanReviewStore(runId), "GATE_3_STORYBOARD");
  const gate3Approved = gate3Latest?.status === "approve";

  if (!gate3Approved) {
    await runStep("C", async () => {
      const fallbackEvents: Array<{
        mode: "agent_retry" | "deterministic_fallback" | "deterministic_arbitration";
        stage: string;
        reason: string;
      }> = [];
      let workingDeck = DeckSpecSchema.parse(
        generateV2DeckSpec({
          topic,
          deckLengthMain: expectedDeckLength,
          audienceLevel
        })
      );
      if (fakeForceDeckFallback) {
        fallbackEvents.push({
          mode: "deterministic_fallback",
          stage: "plotDirectorDeckSpec",
          reason: "forced_by_fake_mode"
        });
        runs.log(runId, "Fake mode forced fallback path for DeckSpec enabled.", "C");
      }

      let workingDifferential = DifferentialCastSchema.parse(generateDifferentialCast(workingDeck, diseaseDossier, truthModel));
      await writeIntermediateJson("C", "differential_cast.json", workingDifferential);
      let workingClueGraph = ClueGraphSchema.parse(generateClueGraph(workingDeck, diseaseDossier, workingDifferential));
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
      await writeIntermediateJson("C", "clue_graph.json", workingClueGraph);

      const maxPatchLoops = maxQaPatchLoops();
      const maxAttempts = maxPatchLoops + 1;
      let finalLint = V2DeckSpecLintReportSchema.parse(lintDeckSpecPhase1(workingDeck, expectedDeckLength));
      let finalReader: ReturnType<typeof ReaderSimReportSchema.parse>;
      let finalFactcheck: ReturnType<typeof MedFactcheckReportSchema.parse>;
      let finalQa: ReturnType<typeof V2QaReportSchema.parse>;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        finalLint = V2DeckSpecLintReportSchema.parse(lintDeckSpecPhase1(workingDeck, expectedDeckLength));
        await writeIntermediateJson("C", `deck_spec_loop${attempt}.json`, workingDeck);
        await writeIntermediateJson("C", `deck_spec_lint_report_loop${attempt}.json`, finalLint);

        finalReader = ReaderSimReportSchema.parse(generateReaderSimReport(workingDeck, truthModel, workingClueGraph));
        await writeIntermediateJson("C", `reader_sim_report_loop${attempt}.json`, finalReader);

        finalFactcheck = MedFactcheckReportSchema.parse(generateMedFactcheckReport(workingDeck, diseaseDossier));
        await writeIntermediateJson("C", `med_factcheck_report_loop${attempt}.json`, finalFactcheck);

        finalQa = V2QaReportSchema.parse(
          buildCombinedQaReport({
            lintReport: finalLint,
            readerSimReport: finalReader,
            medFactcheckReport: finalFactcheck,
            deckSpec: workingDeck
          })
        );
        await writeIntermediateJson("C", `qa_report_loop${attempt}.json`, finalQa);

        const strictFailed = !finalLint.pass || !finalFactcheck.pass || !finalQa.accept;
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
      }

      await writeIntermediateJson("C", "differential_cast.json", workingDifferential);
      await writeIntermediateJson("C", "clue_graph.json", workingClueGraph);
      await writeIntermediateJson("C", "deck_spec.json", workingDeck);
      await writeIntermediateJson("C", "deck_spec_lint_report.json", finalLint);
      await writeIntermediateJson("C", "reader_sim_report.json", finalReader!);
      await writeIntermediateJson("C", "med_factcheck_report.json", finalFactcheck!);
      await writeIntermediateJson("C", "qa_report.json", finalQa!);
      await writeIntermediateJson(
        "C",
        "citation_traceability.json",
        buildCitationTraceabilityReport({
          dossier: diseaseDossier,
          artifacts: {
            disease_dossier: diseaseDossier,
            episode_pitch: episodePitch,
            truth_model: truthModel,
            deck_spec: workingDeck,
            differential_cast: workingDifferential,
            clue_graph: workingClueGraph,
            reader_sim_report: finalReader!,
            med_factcheck_report: finalFactcheck!,
            qa_report: finalQa!
          }
        })
      );
      await writeIntermediateJson("C", "fallback_usage.json", {
        schema_version: "1.0.0",
        workflow: "v2_micro_detectives",
        step: "C",
        used: fallbackEvents.length > 0,
        deterministic_fallback_used: fallbackEvents.some((event) => event.mode === "deterministic_fallback"),
        deterministic_fallback_event_count: fallbackEvents.filter((event) => event.mode === "deterministic_fallback").length,
        agent_retry_event_count: fallbackEvents.filter((event) => event.mode === "agent_retry").length,
        deterministic_arbitration_event_count: fallbackEvents.filter((event) => event.mode === "deterministic_arbitration").length,
        fallback_event_count: fallbackEvents.length,
        events: fallbackEvents
      });

      if ((!finalLint.pass || !finalFactcheck!.pass || !finalQa!.accept) && adherenceMode === "strict") {
        throw new Error(
          `V2 QA loop ended without acceptance (lint_pass=${String(finalLint.pass)}, med_pass=${String(finalFactcheck!.pass)}, qa_accept=${String(finalQa!.accept)}).`
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
    });

    await requireGateApproval(
      "C",
      "GATE_3_STORYBOARD",
      "Gate 3: review storyboard artifacts before final packaging.",
      "Submit /api/runs/:runId/gates/GATE_3_STORYBOARD/submit with status=approve, then call /api/runs/:runId/resume."
    );
  }

  await runStep("C", async () => {
    await runPhase4Packaging("C");
  });

  runs.log(runId, "V2 micro-detectives phase 4 complete.");
}
