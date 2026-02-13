import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RunManager, type StepName } from "../src/run_manager.js";
import { runFakeStudioPipeline } from "../src/pipeline/fake_pipeline.js";
import { artifactAbsPath, readJsonFile, runOutputDirAbs } from "../src/pipeline/utils.js";

let tmpOut: string | null = null;
let tmpCanon: string | null = null;

const envSnapshot = {
  MMS_OUTPUT_DIR: process.env.MMS_OUTPUT_DIR,
  MMS_CANON_ROOT: process.env.MMS_CANON_ROOT,
  MMS_DISABLE_CANON_AUTO_DISCOVERY: process.env.MMS_DISABLE_CANON_AUTO_DISCOVERY,
  MMS_FAKE_STEP_DELAY_MS: process.env.MMS_FAKE_STEP_DELAY_MS
};

beforeEach(async () => {
  tmpOut = await fs.mkdtemp(path.join(os.tmpdir(), "mms-fake-out-"));
  tmpCanon = await fs.mkdtemp(path.join(os.tmpdir(), "mms-fake-canon-"));
  await fs.mkdir(path.join(tmpCanon, "episode"), { recursive: true });
  await fs.writeFile(path.join(tmpCanon, "character_bible.md"), "# Dr. Ada Vega\n# Nurse Lee\n", "utf8");
  await fs.writeFile(path.join(tmpCanon, "series_style_bible.md"), "Always keep overlays legible.\nAvoid gore.\n", "utf8");
  await fs.writeFile(path.join(tmpCanon, "episode", "deck_spec.md"), "Use concise educational framing.\n", "utf8");

  process.env.MMS_OUTPUT_DIR = tmpOut;
  process.env.MMS_CANON_ROOT = tmpCanon;
  process.env.MMS_DISABLE_CANON_AUTO_DISCOVERY = "1";
  process.env.MMS_FAKE_STEP_DELAY_MS = "1";
});

afterEach(async () => {
  if (envSnapshot.MMS_OUTPUT_DIR === undefined) delete process.env.MMS_OUTPUT_DIR;
  else process.env.MMS_OUTPUT_DIR = envSnapshot.MMS_OUTPUT_DIR;

  if (envSnapshot.MMS_CANON_ROOT === undefined) delete process.env.MMS_CANON_ROOT;
  else process.env.MMS_CANON_ROOT = envSnapshot.MMS_CANON_ROOT;

  if (envSnapshot.MMS_DISABLE_CANON_AUTO_DISCOVERY === undefined) delete process.env.MMS_DISABLE_CANON_AUTO_DISCOVERY;
  else process.env.MMS_DISABLE_CANON_AUTO_DISCOVERY = envSnapshot.MMS_DISABLE_CANON_AUTO_DISCOVERY;

  if (envSnapshot.MMS_FAKE_STEP_DELAY_MS === undefined) delete process.env.MMS_FAKE_STEP_DELAY_MS;
  else process.env.MMS_FAKE_STEP_DELAY_MS = envSnapshot.MMS_FAKE_STEP_DELAY_MS;

  if (tmpOut) await fs.rm(tmpOut, { recursive: true, force: true }).catch(() => undefined);
  if (tmpCanon) await fs.rm(tmpCanon, { recursive: true, force: true }).catch(() => undefined);
  tmpOut = null;
  tmpCanon = null;
});

describe("runFakeStudioPipeline", () => {
  it("writes deterministic artifacts and updates run metadata", async () => {
    const runs = new RunManager();
    const run = await runs.createRun("DKA management", {
      durationMinutes: 20,
      targetSlides: 12,
      level: "student",
      adherenceMode: "warn"
    });

    await runFakeStudioPipeline(
      {
        runId: run.runId,
        topic: run.topic,
        settings: run.settings
      },
      runs,
      { signal: new AbortController().signal }
    );

    const status = runs.getRun(run.runId);
    expect(status).toBeTruthy();
    expect(status?.traceId).toBe(`trace_fake_${run.runId}`);
    expect(status?.steps.KB0.status).toBe("done");
    expect(status?.steps.O.status).toBe("done");
    expect(status?.steps.P.status).toBe("done");
    expect(status?.canonicalSources?.foundAny).toBe(true);
    expect(status?.constraintAdherence?.status).toBe("pass");

    const dir = runOutputDirAbs(run.runId);
    await expect(fs.stat(path.join(dir, "run.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(dir, "intermediate"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(dir, "final"))).resolves.toBeTruthy();
    await expect(fs.stat(artifactAbsPath(run.runId, "trace.json"))).resolves.toBeTruthy();
    await expect(fs.stat(artifactAbsPath(run.runId, "kb_context.md"))).resolves.toBeTruthy();
    await expect(fs.stat(artifactAbsPath(run.runId, "final_slide_spec.json"))).resolves.toBeTruthy();
    await expect(fs.stat(artifactAbsPath(run.runId, "medical_narrative_flow.json"))).resolves.toBeTruthy();
    await expect(fs.stat(artifactAbsPath(run.runId, "medical_depth_report.json"))).resolves.toBeTruthy();
    await expect(fs.stat(artifactAbsPath(run.runId, "qa_report_iter1.json"))).resolves.toBeTruthy();
    await expect(fs.stat(artifactAbsPath(run.runId, "final_slide_spec_patched_iter1.json"))).resolves.toBeTruthy();
    await expect(fs.stat(artifactAbsPath(run.runId, "final_slide_spec_patched.json"))).resolves.toBeTruthy();
    await expect(fs.stat(artifactAbsPath(run.runId, "reusable_visual_primer.json"))).resolves.toBeTruthy();
    await expect(fs.stat(artifactAbsPath(run.runId, "medical_story_traceability_report.json"))).resolves.toBeTruthy();
    await expect(fs.stat(artifactAbsPath(run.runId, "qa_report.json"))).resolves.toBeTruthy();
    await expect(fs.stat(artifactAbsPath(run.runId, "GENSPARK_ASSET_BIBLE.md"))).resolves.toBeTruthy();
    await expect(fs.stat(artifactAbsPath(run.runId, "GENSPARK_SLIDE_GUIDE.md"))).resolves.toBeTruthy();
    await expect(fs.stat(artifactAbsPath(run.runId, "GENSPARK_BUILD_SCRIPT.txt"))).resolves.toBeTruthy();
    await expect(fs.stat(artifactAbsPath(run.runId, "GENSPARK_MASTER_RENDER_PLAN_BASE.md"))).resolves.toBeTruthy();
    await expect(fs.stat(artifactAbsPath(run.runId, "GENSPARK_MASTER_RENDER_PLAN.md"))).resolves.toBeTruthy();
    await expect(fs.stat(artifactAbsPath(run.runId, "constraint_adherence_report.json"))).resolves.toBeTruthy();

    const adherence = await readJsonFile<{ status: string; failures: string[]; warnings: string[] }>(
      artifactAbsPath(run.runId, "constraint_adherence_report.json")
    );
    expect(adherence.status).toBe("pass");
    expect(adherence.failures).toHaveLength(0);
    expect(adherence.warnings).toHaveLength(0);
  });

  it("supports startFrom=O and still produces required final artifacts", async () => {
    const runs = new RunManager();
    const run = await runs.createRun("Chest pain workup");

    await runFakeStudioPipeline(
      {
        runId: run.runId,
        topic: run.topic,
        settings: run.settings
      },
      runs,
      { signal: new AbortController().signal, startFrom: "O" }
    );

    const status = runs.getRun(run.runId);
    expect(status?.steps.KB0.status).toBe("queued");
    expect(status?.steps.O.status).toBe("done");
    expect(status?.steps.P.status).toBe("done");

    await expect(fs.stat(artifactAbsPath(run.runId, "final_slide_spec_patched.json"))).resolves.toBeTruthy();
    await expect(fs.stat(artifactAbsPath(run.runId, "reusable_visual_primer.json"))).resolves.toBeTruthy();
    await expect(fs.stat(artifactAbsPath(run.runId, "qa_report.json"))).resolves.toBeTruthy();
    await expect(fs.stat(artifactAbsPath(run.runId, "GENSPARK_ASSET_BIBLE.md"))).resolves.toBeTruthy();
    await expect(fs.stat(artifactAbsPath(run.runId, "GENSPARK_MASTER_RENDER_PLAN.md"))).resolves.toBeTruthy();
  });

  it("throws for invalid startFrom values", async () => {
    const runs = new RunManager();
    const run = await runs.createRun("Invalid startFrom");

    await expect(
      runFakeStudioPipeline(
        {
          runId: run.runId,
          topic: run.topic
        },
        runs,
        { signal: new AbortController().signal, startFrom: "ZZZ" as unknown as "KB0" }
      )
    ).rejects.toThrow(/Invalid startFrom/);
  });

  it("handles cancellation that occurs between startStep and wait", async () => {
    class AbortOnStartRunManager extends RunManager {
      constructor(private readonly controller: AbortController) {
        super();
      }

      override async startStep(runId: string, step: StepName): Promise<void> {
        await super.startStep(runId, step);
        this.controller.abort();
      }
    }

    const controller = new AbortController();
    const runs = new AbortOnStartRunManager(controller);
    const run = await runs.createRun("Abort path");

    await expect(
      runFakeStudioPipeline(
        {
          runId: run.runId,
          topic: run.topic
        },
        runs,
        { signal: controller.signal }
      )
    ).rejects.toThrow(/Cancelled/);

    const status = runs.getRun(run.runId);
    expect(status?.steps.KB0.status).toBe("error");
  });

  it("handles cancellation after wait has started (abort listener path)", async () => {
    class AbortDuringWaitRunManager extends RunManager {
      constructor(private readonly controller: AbortController) {
        super();
      }

      override async startStep(runId: string, step: StepName): Promise<void> {
        await super.startStep(runId, step);
        // Abort shortly after startStep so wait() has already attached the abort listener.
        setTimeout(() => this.controller.abort(), 1);
      }
    }

    process.env.MMS_FAKE_STEP_DELAY_MS = "50";
    const controller = new AbortController();
    const runs = new AbortDuringWaitRunManager(controller);
    const run = await runs.createRun("Abort during wait");

    await expect(
      runFakeStudioPipeline(
        {
          runId: run.runId,
          topic: run.topic
        },
        runs,
        { signal: controller.signal }
      )
    ).rejects.toThrow(/Cancelled/);

    const status = runs.getRun(run.runId);
    expect(status?.steps.KB0.status).toBe("error");
  });

  it("marks the active step as error when artifact writing throws a non-Error value", async () => {
    class ThrowingArtifactRunManager extends RunManager {
      private artifactCalls = 0;

      override async addArtifact(runId: string, step: StepName, name: string): Promise<void> {
        this.artifactCalls += 1;
        if (this.artifactCalls >= 3) throw "artifact-fail";
        await super.addArtifact(runId, step, name);
      }
    }

    const runs = new ThrowingArtifactRunManager();
    const run = await runs.createRun("Throw path");

    await expect(
      runFakeStudioPipeline(
        {
          runId: run.runId,
          topic: run.topic
        },
        runs,
        { signal: new AbortController().signal }
      )
    ).rejects.toBe("artifact-fail");

    const status = runs.getRun(run.runId);
    expect(status?.steps.KB0.status).toBe("error");
    expect(status?.steps.KB0.error).toContain("artifact-fail");
  });

  it("supports runs without canonical files and with zero step delay", async () => {
    delete process.env.MMS_CANON_ROOT;
    process.env.MMS_DISABLE_CANON_AUTO_DISCOVERY = "1";
    process.env.MMS_FAKE_STEP_DELAY_MS = "0";

    const runs = new RunManager();
    const run = await runs.createRun("No canon");

    await runFakeStudioPipeline(
      {
        runId: run.runId,
        topic: run.topic
      },
      runs,
      { signal: new AbortController().signal, startFrom: "O" }
    );

    const status = runs.getRun(run.runId);
    expect(status?.canonicalSources?.foundAny).toBe(false);
    expect(status?.steps.O.status).toBe("done");
    expect(status?.steps.P.status).toBe("done");
  });
});
