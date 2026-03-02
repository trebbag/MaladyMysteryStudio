import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PipelinePause } from "../src/executor.js";
import { RunManager } from "../src/run_manager.js";
import { runMicroDetectivesFakePipeline } from "../src/pipeline/v2_micro_detectives/fake_pipeline.js";
import { appendHumanReview } from "../src/pipeline/v2_micro_detectives/reviews.js";
import { runFinalDirAbs, runIntermediateDirAbs } from "../src/pipeline/utils.js";

let tmpOut: string | null = null;

beforeEach(async () => {
  tmpOut = await fs.mkdtemp(path.join(os.tmpdir(), "mms-v2-fake-"));
  process.env.MMS_OUTPUT_DIR = tmpOut;
});

afterEach(async () => {
  if (tmpOut) await fs.rm(tmpOut, { recursive: true, force: true }).catch(() => undefined);
  tmpOut = null;
  delete process.env.MMS_OUTPUT_DIR;
  delete process.env.MMS_FAKE_STEP_DELAY_MS;
  delete process.env.MMS_V2_DECKSPEC_ABORT_WARNING_SLIDES;
});

async function advanceToGate3Pause(runs: RunManager, runId: string, topic: string, settings: Parameters<RunManager["createRun"]>[1]) {
  await expect(
    runMicroDetectivesFakePipeline(
      { runId, topic, settings },
      runs,
      { signal: new AbortController().signal, startFrom: "KB0" }
    )
  ).rejects.toBeInstanceOf(PipelinePause);

  await appendHumanReview(runId, {
    schema_version: "1.0.0",
    gate_id: "GATE_1_PITCH",
    status: "approve",
    notes: "",
    requested_changes: [],
    submitted_at: new Date().toISOString()
  });

  await expect(
    runMicroDetectivesFakePipeline(
      { runId, topic, settings },
      runs,
      { signal: new AbortController().signal, startFrom: "B" }
    )
  ).rejects.toBeInstanceOf(PipelinePause);

  await appendHumanReview(runId, {
    schema_version: "1.0.0",
    gate_id: "GATE_2_TRUTH_LOCK",
    status: "approve",
    notes: "",
    requested_changes: [],
    submitted_at: new Date().toISOString()
  });

  await expect(
    runMicroDetectivesFakePipeline(
      { runId, topic, settings },
      runs,
      { signal: new AbortController().signal, startFrom: "C" }
    )
  ).rejects.toBeInstanceOf(PipelinePause);
}

describe("v2 fake pipeline", () => {
  it("pauses at Gate 1 with dossier + pitch artifacts written", async () => {
    const runs = new RunManager();
    const run = await runs.createRun("V2 topic", {
      workflow: "v2_micro_detectives",
      deckLengthMain: 45,
      deckLengthConstraintEnabled: true,
      audienceLevel: "PHYSICIAN_LEVEL",
      adherenceMode: "strict"
    });

    await expect(
      runMicroDetectivesFakePipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "KB0" }
      )
    ).rejects.toBeInstanceOf(PipelinePause);

    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "disease_dossier.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "episode_pitch.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "GATE_1_PITCH_REQUIRED.json"))).resolves.toBeTruthy();
  });

  it("pauses at Gate 2 after gate 1 approval", async () => {
    const runs = new RunManager();
    const run = await runs.createRun("V2 gate2", {
      workflow: "v2_micro_detectives",
      deckLengthMain: 45,
      deckLengthConstraintEnabled: true,
      audienceLevel: "PHYSICIAN_LEVEL",
      adherenceMode: "strict"
    });

    await expect(
      runMicroDetectivesFakePipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "KB0" }
      )
    ).rejects.toBeInstanceOf(PipelinePause);

    await appendHumanReview(run.runId, {
      schema_version: "1.0.0",
      gate_id: "GATE_1_PITCH",
      status: "approve",
      notes: "",
      requested_changes: [],
      submitted_at: new Date().toISOString()
    });

    await expect(
      runMicroDetectivesFakePipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "B" }
      )
    ).rejects.toBeInstanceOf(PipelinePause);

    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "truth_model.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "GATE_2_TRUTH_LOCK_REQUIRED.json"))).resolves.toBeTruthy();
  });

  it("pauses at Gate 3, then completes C packaging after Gate 3 approval", async () => {
    const runs = new RunManager();
    const run = await runs.createRun("V2 done", {
      workflow: "v2_micro_detectives",
      deckLengthMain: 30,
      deckLengthConstraintEnabled: true,
      audienceLevel: "COLLEGE_LEVEL",
      adherenceMode: "strict"
    });

    await expect(
      runMicroDetectivesFakePipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "KB0" }
      )
    ).rejects.toBeInstanceOf(PipelinePause);
    await appendHumanReview(run.runId, {
      schema_version: "1.0.0",
      gate_id: "GATE_1_PITCH",
      status: "approve",
      notes: "",
      requested_changes: [],
      submitted_at: new Date().toISOString()
    });
    await expect(
      runMicroDetectivesFakePipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "B" }
      )
    ).rejects.toBeInstanceOf(PipelinePause);
    await appendHumanReview(run.runId, {
      schema_version: "1.0.0",
      gate_id: "GATE_2_TRUTH_LOCK",
      status: "approve",
      notes: "",
      requested_changes: [],
      submitted_at: new Date().toISOString()
    });

    await expect(
      runMicroDetectivesFakePipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "C" }
      )
    ).rejects.toBeInstanceOf(PipelinePause);

    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "deck_spec.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "deck_spec_lint_report.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "differential_cast.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "clue_graph.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "reader_sim_report.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "med_factcheck_report.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "qa_report.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "semantic_acceptance_report.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "citation_traceability.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "GATE_3_STORYBOARD_REQUIRED.json"))).resolves.toBeTruthy();

    await appendHumanReview(run.runId, {
      schema_version: "1.0.0",
      gate_id: "GATE_3_STORYBOARD",
      status: "approve",
      notes: "",
      requested_changes: [],
      submitted_at: new Date().toISOString()
    });

    await runMicroDetectivesFakePipeline(
      { runId: run.runId, topic: run.topic, settings: run.settings },
      runs,
      { signal: new AbortController().signal, startFrom: "C" }
    );

    await expect(fs.stat(path.join(runFinalDirAbs(run.runId), "deck_spec.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runFinalDirAbs(run.runId), "V2_MAIN_DECK_RENDER_PLAN.md"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runFinalDirAbs(run.runId), "V2_APPENDIX_RENDER_PLAN.md"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runFinalDirAbs(run.runId), "V2_SPEAKER_NOTES_WITH_CITATIONS.md"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "micro_world_map.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "drama_plan.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "setpiece_plan.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runFinalDirAbs(run.runId), "v2_template_registry.json"))).resolves.toBeTruthy();
  });

  it("writes fallback_usage when fake forced fallback marker is present", async () => {
    const runs = new RunManager();
    const run = await runs.createRun("V2 FORCE_FALLBACK coverage", {
      workflow: "v2_micro_detectives",
      deckLengthMain: 30,
      deckLengthConstraintEnabled: true,
      audienceLevel: "COLLEGE_LEVEL",
      adherenceMode: "warn"
    });

    await expect(
      runMicroDetectivesFakePipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "KB0" }
      )
    ).rejects.toBeInstanceOf(PipelinePause);
    await appendHumanReview(run.runId, {
      schema_version: "1.0.0",
      gate_id: "GATE_1_PITCH",
      status: "approve",
      notes: "",
      requested_changes: [],
      submitted_at: new Date().toISOString()
    });
    await expect(
      runMicroDetectivesFakePipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "B" }
      )
    ).rejects.toBeInstanceOf(PipelinePause);
    await appendHumanReview(run.runId, {
      schema_version: "1.0.0",
      gate_id: "GATE_2_TRUTH_LOCK",
      status: "approve",
      notes: "",
      requested_changes: [],
      submitted_at: new Date().toISOString()
    });
    await expect(
      runMicroDetectivesFakePipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "C" }
      )
    ).rejects.toBeInstanceOf(PipelinePause);

    const fallbackRaw = await fs.readFile(path.join(runIntermediateDirAbs(run.runId), "fallback_usage.json"), "utf8");
    const fallback = JSON.parse(fallbackRaw) as { used: boolean; fallback_event_count: number };
    expect(fallback.used).toBe(true);
    expect(fallback.fallback_event_count).toBeGreaterThan(0);
  });

  it("writes adaptive timeout plan + unconstrained estimate details before Gate 3", async () => {
    const runs = new RunManager();
    const run = await runs.createRun(
      "Very long unconstrained storyline to force a large estimated deck size with many detail terms and clinical branches",
      {
        workflow: "v2_micro_detectives",
        deckLengthConstraintEnabled: false,
        audienceLevel: "PHYSICIAN_LEVEL",
        adherenceMode: "warn"
      }
    );

    process.env.MMS_V2_DECKSPEC_ABORT_WARNING_SLIDES = "500";
    await advanceToGate3Pause(runs, run.runId, run.topic, run.settings);

    const timeoutPlanRaw = await fs.readFile(path.join(runIntermediateDirAbs(run.runId), "deck_spec_timeout_plan.json"), "utf8");
    const timeoutPlan = JSON.parse(timeoutPlanRaw) as {
      estimate: { main_slide_count: number; deck_length_policy: string; deck_length_soft_target: number | null };
      adaptive_timeouts_ms: { agent: number; deck_spec: number; watchdog: number };
      abort_threshold_slides: number;
      abort_recommended: boolean;
    };

    expect(timeoutPlan.estimate.deck_length_policy).toBe("unconstrained");
    expect(timeoutPlan.estimate.deck_length_soft_target).toBeNull();
    expect(timeoutPlan.estimate.main_slide_count).toBeGreaterThan(45);
    expect(timeoutPlan.adaptive_timeouts_ms.agent).toBeGreaterThanOrEqual(180_000);
    expect(timeoutPlan.adaptive_timeouts_ms.deck_spec).toBeGreaterThanOrEqual(300_000);
    expect(timeoutPlan.adaptive_timeouts_ms.watchdog).toBeGreaterThanOrEqual(900_000);
    expect(timeoutPlan.abort_threshold_slides).toBe(500);
    expect(timeoutPlan.abort_recommended).toBe(false);

    const status = runs.getRun(run.runId);
    expect(status?.v2DeckSpecEstimate?.deckLengthPolicy).toBe("unconstrained");
    expect(status?.v2DeckSpecEstimate?.adaptiveTimeoutMs.deckSpec).toBe(timeoutPlan.adaptive_timeouts_ms.deck_spec);
    expect(status?.v2DeckSpecEstimate?.abortRecommended).toBe(false);
  });

  it("flags abort recommendation when estimate exceeds threshold", async () => {
    const runs = new RunManager();
    const run = await runs.createRun("Unconstrained threshold hit topic with multiple words to increase deck size", {
      workflow: "v2_micro_detectives",
      deckLengthConstraintEnabled: false,
      audienceLevel: "COLLEGE_LEVEL",
      adherenceMode: "warn"
    });

    process.env.MMS_V2_DECKSPEC_ABORT_WARNING_SLIDES = "45";
    await advanceToGate3Pause(runs, run.runId, run.topic, run.settings);

    const timeoutPlanRaw = await fs.readFile(path.join(runIntermediateDirAbs(run.runId), "deck_spec_timeout_plan.json"), "utf8");
    const timeoutPlan = JSON.parse(timeoutPlanRaw) as { abort_threshold_slides: number; abort_recommended: boolean };
    expect(timeoutPlan.abort_threshold_slides).toBe(45);
    expect(timeoutPlan.abort_recommended).toBe(true);

    const status = runs.getRun(run.runId);
    expect(status?.v2DeckSpecEstimate?.abortThresholdSlides).toBe(45);
    expect(status?.v2DeckSpecEstimate?.abortRecommended).toBe(true);
  });

  it("rejects invalid startFrom", async () => {
    const runs = new RunManager();
    const run = await runs.createRun("V2 bad start", {
      workflow: "v2_micro_detectives",
      deckLengthMain: 45,
      deckLengthConstraintEnabled: true,
      audienceLevel: "PHYSICIAN_LEVEL",
      adherenceMode: "strict"
    });

    await expect(
      runMicroDetectivesFakePipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "D" }
      )
    ).rejects.toThrow(/Invalid startFrom/);
  });
});
