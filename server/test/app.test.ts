import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { RunManager } from "../src/run_manager.js";
import { createApp } from "../src/app.js";
import { artifactAbsPath, runFinalDirAbs, runIntermediateDirAbs, runOutputDirAbs } from "../src/pipeline/utils.js";

let tmpOut: string | null = null;

beforeEach(async () => {
  tmpOut = await fs.mkdtemp(path.join(os.tmpdir(), "mms-out-"));
  process.env.MMS_OUTPUT_DIR = tmpOut;
});

afterEach(async () => {
  delete process.env.MMS_OUTPUT_DIR;
  if (tmpOut) await fs.rm(tmpOut, { recursive: true, force: true }).catch(() => undefined);
  tmpOut = null;
});

type ExecutorLike = {
  enqueue: (runId: string, options?: { startFrom?: string }) => boolean;
  cancel: (runId: string) => boolean;
  isRunning: (runId: string) => boolean;
};

function makeExecutor(overrides?: Partial<ExecutorLike>): ExecutorLike {
  return {
    enqueue: () => true,
    cancel: () => true,
    isRunning: () => false,
    ...(overrides ?? {})
  };
}

describe("server app", () => {
  it("GET /api/health", async () => {
    const runs = new RunManager();
    const app = createApp(runs, makeExecutor() as never);
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("ok", true);
    expect(res.body).toHaveProperty("hasKey");
    expect(res.body).toHaveProperty("hasVectorStoreId");
  });

  it("GET /api/health reports env var presence", async () => {
    const runs = new RunManager();
    const app = createApp(runs, makeExecutor() as never);

    const prevKey = process.env.OPENAI_API_KEY;
    const prevVs = process.env.KB_VECTOR_STORE_ID;
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.KB_VECTOR_STORE_ID = "vs_test";

    try {
      const res = await request(app).get("/api/health");
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ ok: true, hasKey: true, hasVectorStoreId: true });
    } finally {
      if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prevKey;
      if (prevVs === undefined) delete process.env.KB_VECTOR_STORE_ID;
      else process.env.KB_VECTOR_STORE_ID = prevVs;
    }
  });

  it("GET /api/health reports canonical profile detection", async () => {
    const runs = new RunManager();
    const app = createApp(runs, makeExecutor() as never);

    const canonRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mms-canon-health-"));
    await fs.mkdir(path.join(canonRoot, "episode"), { recursive: true });
    await fs.writeFile(path.join(canonRoot, "character_bible.md"), "c", "utf8");
    await fs.writeFile(path.join(canonRoot, "series_style_bible.md"), "s", "utf8");
    await fs.writeFile(path.join(canonRoot, "episode", "deck_spec.md"), "d", "utf8");

    const prevCanonRoot = process.env.MMS_CANON_ROOT;
    process.env.MMS_CANON_ROOT = canonRoot;

    try {
      const res = await request(app).get("/api/health");
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        ok: true,
        hasCanonicalProfileFiles: true,
        canonicalTemplateRoot: canonRoot
      });
      expect(String(res.body.episodeMemoryPath)).toContain(path.join(canonRoot, "episode", "episode_memory.json"));
    } finally {
      if (prevCanonRoot === undefined) delete process.env.MMS_CANON_ROOT;
      else process.env.MMS_CANON_ROOT = prevCanonRoot;
      await fs.rm(canonRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("POST /api/runs validates input", async () => {
    const runs = new RunManager();
    const app = createApp(runs, makeExecutor() as never);
    const res = await request(app).post("/api/runs").send({ topic: "" });
    expect(res.status).toBe(400);
  });

  it("POST /api/runs queues the run via executor.enqueue", async () => {
    const runs = new RunManager();
    const enqueue = vi.fn(() => true);
    const app = createApp(runs, makeExecutor({ enqueue }) as never);

    const res = await request(app).post("/api/runs").send({ topic: "test topic" });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("runId");
    expect(enqueue).toHaveBeenCalledWith(res.body.runId);
  });

  it("GET /api/runs lists runs newest-first", async () => {
    const runs = new RunManager();
    const app = createApp(runs, makeExecutor() as never);

    const r1 = await request(app).post("/api/runs").send({ topic: "first" });
    const r2 = await request(app).post("/api/runs").send({ topic: "second" });
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    const list = await request(app).get("/api/runs");
    expect(list.status).toBe(200);
    expect(list.body[0].runId).toBe(r2.body.runId);
    expect(list.body[1].runId).toBe(r1.body.runId);
  });

  it("GET /api/runs/:runId returns 404 for missing run", async () => {
    const runs = new RunManager();
    const app = createApp(runs, makeExecutor() as never);
    const res = await request(app).get("/api/runs/nope");
    expect(res.status).toBe(404);
  });

  it("GET /api/runs/retention returns policy + stats", async () => {
    const runs = new RunManager();
    const app = createApp(runs, makeExecutor() as never);
    await runs.createRun("t1");
    await runs.createRun("t2");

    const res = await request(app).get("/api/runs/retention");
    expect(res.status).toBe(200);
    expect(res.body.policy.keepLastTerminalRuns).toBeTypeOf("number");
    expect(res.body.stats).toMatchObject({
      totalRuns: 2,
      terminalRuns: 0,
      activeRuns: 2
    });
    expect(res.body.analytics).toBeTruthy();
    expect(res.body.analytics.perRun).toHaveLength(2);
    expect(res.body.analytics.ageBuckets).toHaveProperty("lt_24h");
  });

  it("GET /api/runs/retention falls back to default policy when env is invalid", async () => {
    const prev = process.env.MMS_RUN_RETENTION_KEEP_LAST;
    process.env.MMS_RUN_RETENTION_KEEP_LAST = "not-a-number";

    const runs = new RunManager();
    const app = createApp(runs, makeExecutor() as never);
    const res = await request(app).get("/api/runs/retention");
    expect(res.status).toBe(200);
    expect(res.body.policy.keepLastTerminalRuns).toBe(50);

    if (prev === undefined) delete process.env.MMS_RUN_RETENTION_KEEP_LAST;
    else process.env.MMS_RUN_RETENTION_KEEP_LAST = prev;
  });

  it("POST /api/runs/cleanup validates payload", async () => {
    const runs = new RunManager();
    const app = createApp(runs, makeExecutor() as never);
    const res = await request(app).post("/api/runs/cleanup").send({ keepLast: -1 });
    expect(res.status).toBe(400);
  });

  it("POST /api/runs/cleanup handles an empty request body", async () => {
    const runs = new RunManager();
    const app = createApp(runs, makeExecutor() as never);

    const res = await request(app).post("/api/runs/cleanup");
    expect(res.status).toBe(200);
    expect(res.body.keepLast).toBeTypeOf("number");
  });

  it("POST /api/runs/cleanup supports dry-run and real deletion", async () => {
    const runs = new RunManager();
    const app = createApp(runs, makeExecutor() as never);
    const r1 = await runs.createRun("old done");
    const r2 = await runs.createRun("new done");
    const r3 = await runs.createRun("active");

    await runs.setRunStatus(r1.runId, "done");
    await runs.setRunStatus(r2.runId, "done");
    await runs.setRunStatus(r3.runId, "running");

    const internal1 = runs.getInternal(r1.runId);
    const internal2 = runs.getInternal(r2.runId);
    if (!internal1 || !internal2) throw new Error("missing internals");
    internal1.startedAt = "2020-01-01T00:00:00.000Z";
    internal2.startedAt = "2020-01-02T00:00:00.000Z";

    const preview = await request(app).post("/api/runs/cleanup").send({ keepLast: 1, dryRun: true });
    expect(preview.status).toBe(200);
    expect(preview.body.deletedRunIds).toEqual([r1.runId]);
    expect(preview.body.reclaimedBytes).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(preview.body.deletedRuns)).toBe(true);
    expect(preview.body.analytics).toBeTruthy();
    expect(runs.getRun(r1.runId)).not.toBeNull();

    const apply = await request(app).post("/api/runs/cleanup").send({ keepLast: 1, dryRun: false });
    expect(apply.status).toBe(200);
    expect(apply.body.deletedRunIds).toEqual([r1.runId]);
    expect(runs.getRun(r1.runId)).toBeNull();
    expect(runs.getRun(r2.runId)).not.toBeNull();
    expect(runs.getRun(r3.runId)).not.toBeNull();
  });

  it("POST /api/runs/cleanup uses default keepLast + dryRun=false when omitted", async () => {
    const prev = process.env.MMS_RUN_RETENTION_KEEP_LAST;
    process.env.MMS_RUN_RETENTION_KEEP_LAST = "0";

    const runs = new RunManager();
    const app = createApp(runs, makeExecutor() as never);
    const r1 = await runs.createRun("done");
    await runs.setRunStatus(r1.runId, "done");

    const res = await request(app).post("/api/runs/cleanup").send({});
    expect(res.status).toBe(200);
    expect(res.body.keepLast).toBe(0);
    expect(res.body.dryRun).toBe(false);
    expect(res.body.deletedRunIds).toContain(r1.runId);
    expect(runs.getRun(r1.runId)).toBeNull();

    if (prev === undefined) delete process.env.MMS_RUN_RETENTION_KEEP_LAST;
    else process.env.MMS_RUN_RETENTION_KEEP_LAST = prev;
  });

  it("GET /api/slo-policy returns persisted/default policy envelope", async () => {
    const runs = new RunManager();
    const app = createApp(runs, makeExecutor() as never);

    const res = await request(app).get("/api/slo-policy");
    expect(res.status).toBe(200);
    expect(res.body.policy.thresholdsMs.A).toBeTypeOf("number");
    expect(res.body.bounds).toMatchObject({ minMs: 5000, maxMs: 1800000 });
    expect(res.body.defaults).toHaveProperty("KB0");
  });

  it("PUT /api/slo-policy updates thresholds and influences run stepSlo evaluation", async () => {
    const runs = new RunManager();
    const app = createApp(runs, makeExecutor() as never);
    const run = await runs.createRun("topic");

    await runs.setStepNoEvent(run.runId, "A", {
      status: "done",
      startedAt: "2020-01-01T00:00:00.000Z",
      finishedAt: "2020-01-01T00:01:00.000Z",
      artifacts: []
    });

    const put = await request(app).put("/api/slo-policy").send({ thresholdsMs: { A: 5_000 } });
    expect(put.status).toBe(200);
    expect(put.body.policy.thresholdsMs.A).toBe(5000);

    const runRes = await request(app).get(`/api/runs/${run.runId}`);
    expect(runRes.status).toBe(200);
    expect(runRes.body.stepSlo.evaluations.A.status).toBe("warn");
    expect(runRes.body.stepSlo.evaluations.A.thresholdMs).toBe(5000);
  });

  it("PUT /api/slo-policy reset restores defaults", async () => {
    const runs = new RunManager();
    const app = createApp(runs, makeExecutor() as never);

    const putCustom = await request(app).put("/api/slo-policy").send({ thresholdsMs: { A: 5000 } });
    expect(putCustom.status).toBe(200);
    expect(putCustom.body.policy.thresholdsMs.A).toBe(5000);

    const putReset = await request(app).put("/api/slo-policy").send({ reset: true });
    expect(putReset.status).toBe(200);
    expect(putReset.body.policy.thresholdsMs.A).toBe(90000);
  });

  it("PUT /api/slo-policy validates payload", async () => {
    const runs = new RunManager();
    const app = createApp(runs, makeExecutor() as never);

    const bad = await request(app).put("/api/slo-policy").send({ thresholdsMs: { NOPE: 10 } });
    expect(bad.status).toBe(400);
  });

  it("PUT /api/slo-policy accepts empty body and keeps prior thresholds", async () => {
    const runs = new RunManager();
    const app = createApp(runs, makeExecutor() as never);

    const res = await request(app).put("/api/slo-policy");
    expect(res.status).toBe(200);
    expect(res.body.policy.thresholdsMs.KB0).toBeTypeOf("number");
  });

  it("GET /api/runs/:runId includes stepSlo evaluations and warning steps", async () => {
    const runs = new RunManager();
    const app = createApp(runs, makeExecutor() as never);
    const run = await runs.createRun("topic");

    await runs.setStepNoEvent(run.runId, "A", {
      status: "done",
      startedAt: "2020-01-01T00:00:00.000Z",
      finishedAt: "2020-01-01T00:10:00.000Z",
      artifacts: []
    });

    const res = await request(app).get(`/api/runs/${run.runId}`);
    expect(res.status).toBe(200);
    expect(res.body.stepSlo).toBeTruthy();
    expect(res.body.stepSlo.evaluations.A.status).toBe("warn");
    expect(res.body.stepSlo.warningSteps).toContain("A");
    expect(res.body.stepSlo.evaluations.KB0.status).toBe("n/a");
    expect(res.body.stepSlo.evaluations.P.status).toBe("n/a");
  });

  it("GET /api/runs/:runId includes stepSlo ok/n-a branches", async () => {
    const runs = new RunManager();
    const app = createApp(runs, makeExecutor() as never);
    const run = await runs.createRun("topic");

    await runs.setStepNoEvent(run.runId, "B", {
      status: "running",
      startedAt: new Date().toISOString(),
      artifacts: []
    });
    await runs.setStepNoEvent(run.runId, "C", {
      status: "done",
      startedAt: "bad-iso",
      finishedAt: "also-bad",
      artifacts: []
    });

    const res = await request(app).get(`/api/runs/${run.runId}`);
    expect(res.status).toBe(200);
    expect(res.body.stepSlo.evaluations.B.status).toBe("ok");
    expect(res.body.stepSlo.evaluations.C.status).toBe("n/a");
  });

  it("POST /api/runs accepts settings", async () => {
    const runs = new RunManager();
    const app = createApp(runs, makeExecutor() as never);

    const res = await request(app)
      .post("/api/runs")
      .send({ topic: "test topic", settings: { durationMinutes: 20, targetSlides: 12, level: "student", adherenceMode: "warn" } });

    expect(res.status).toBe(200);
    const runId = String(res.body.runId);

    const runRes = await request(app).get(`/api/runs/${runId}`);
    expect(runRes.status).toBe(200);
    expect(runRes.body.settings).toMatchObject({ durationMinutes: 20, targetSlides: 12, level: "student", adherenceMode: "warn" });
  });

  it("POST /api/runs accepts an empty settings object (stores as undefined)", async () => {
    const runs = new RunManager();
    const app = createApp(runs, makeExecutor() as never);

    const res = await request(app).post("/api/runs").send({ topic: "test topic", settings: {} });
    expect(res.status).toBe(200);

    const runId = String(res.body.runId);
    const runRes = await request(app).get(`/api/runs/${runId}`);
    expect(runRes.status).toBe(200);
    expect(runRes.body.settings).toBeUndefined();
  });

  it("POST /api/runs rejects invalid settings", async () => {
    const runs = new RunManager();
    const app = createApp(runs, makeExecutor() as never);

    const res = await request(app).post("/api/runs").send({ topic: "ok topic", settings: { durationMinutes: 1 } });
    expect(res.status).toBe(400);
  });

  it("POST /api/runs rejects invalid adherence mode", async () => {
    const runs = new RunManager();
    const app = createApp(runs, makeExecutor() as never);

    const res = await request(app).post("/api/runs").send({ topic: "ok topic", settings: { adherenceMode: "loose" } });
    expect(res.status).toBe(400);
  });

  it("POST /api/runs/:runId/cancel returns 404 if run missing", async () => {
    const runs = new RunManager();
    const app = createApp(runs, makeExecutor() as never);
    const res = await request(app).post("/api/runs/nope/cancel").send({});
    expect(res.status).toBe(404);
  });

  it("POST /api/runs/:runId/cancel returns 409 if executor cannot cancel", async () => {
    const runs = new RunManager();
    const run = await runs.createRun("topic");
    const app = createApp(runs, makeExecutor({ cancel: () => false }) as never);
    const res = await request(app).post(`/api/runs/${run.runId}/cancel`).send({});
    expect(res.status).toBe(409);
  });

  it("POST /api/runs/:runId/cancel returns ok on success", async () => {
    const runs = new RunManager();
    const run = await runs.createRun("topic");
    const app = createApp(runs, makeExecutor({ cancel: () => true }) as never);
    const res = await request(app).post(`/api/runs/${run.runId}/cancel`).send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("POST /api/runs/:runId/rerun returns 404 if parent missing", async () => {
    const runs = new RunManager();
    const app = createApp(runs, makeExecutor() as never);
    const res = await request(app).post("/api/runs/nope/rerun").send({ startFrom: "C" });
    expect(res.status).toBe(404);
  });

  it("POST /api/runs/:runId/rerun returns 409 if parent is running", async () => {
    const runs = new RunManager();
    const parent = await runs.createRun("topic");
    const app = createApp(runs, makeExecutor({ isRunning: () => true }) as never);
    const res = await request(app).post(`/api/runs/${parent.runId}/rerun`).send({ startFrom: "C" });
    expect(res.status).toBe(409);
  });

  it("POST /api/runs/:runId/rerun validates startFrom", async () => {
    const runs = new RunManager();
    const parent = await runs.createRun("topic");
    const app = createApp(runs, makeExecutor() as never);
    const res = await request(app).post(`/api/runs/${parent.runId}/rerun`).send({ startFrom: "ZZZ" });
    expect(res.status).toBe(400);
  });

  it("POST /api/runs/:runId/rerun accepts startFrom=P enum value", async () => {
    const runs = new RunManager();
    const parent = await runs.createRun("topic");
    const app = createApp(runs, makeExecutor() as never);
    const res = await request(app).post(`/api/runs/${parent.runId}/rerun`).send({ startFrom: "P" });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain("cannot reuse step");
  });

  it("POST /api/runs/:runId/rerun rejects when parent prerequisites are not done", async () => {
    const runs = new RunManager();
    const parent = await runs.createRun("topic");
    const app = createApp(runs, makeExecutor() as never);

    const res = await request(app).post(`/api/runs/${parent.runId}/rerun`).send({ startFrom: "C" });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain("cannot reuse step");
  });

  it("POST /api/runs/:runId/rerun rejects when a required artifact is missing", async () => {
    const runs = new RunManager();
    const parent = await runs.createRun("topic");
    const app = createApp(runs, makeExecutor() as never);

    // Mark KB0 done but claim an artifact that doesn't exist on disk.
    await runs.setStepNoEvent(parent.runId, "KB0", {
      status: "done",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      artifacts: ["kb_context.md"]
    });
    await runs.setStepNoEvent(parent.runId, "A", {
      status: "done",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      artifacts: ["producer_brief.json"]
    });

    const res = await request(app).post(`/api/runs/${parent.runId}/rerun`).send({ startFrom: "B" });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain("missing artifact");
  });

  it("POST /api/runs/:runId/rerun creates a derived run and copies prerequisite artifacts", async () => {
    const runs = new RunManager();
    const app = createApp(runs, makeExecutor() as never);

    const parent = await runs.createRun("rerun topic");
    const parentDir = runOutputDirAbs(parent.runId);

    const prereq = [
      { step: "KB0", file: "kb_context.md", content: "kb" },
      { step: "A", file: "producer_brief.json", content: "{\"producer_brief\":{}}" },
      { step: "B", file: "facts_library_raw.json", content: "{\"facts_library\":[]}" }
    ] as const;

    for (const p of prereq) {
      await fs.writeFile(path.join(parentDir, p.file), p.content, "utf8");
      await runs.setStepNoEvent(parent.runId, p.step, {
        status: "done",
        // Omit startedAt/finishedAt so the rerun path exercises fallback timestamps.
        artifacts: p.step === "KB0" ? [p.file, "bad/evil.txt"] : [p.file]
      });
    }

    const res = await request(app).post(`/api/runs/${parent.runId}/rerun`).send({ startFrom: "C" });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("runId");
    const childRunId = String(res.body.runId);

    const childRes = await request(app).get(`/api/runs/${childRunId}`);
    expect(childRes.status).toBe(200);
    expect(childRes.body.derivedFrom).toMatchObject({ runId: parent.runId, startFrom: "C" });

    await expect(fs.stat(artifactAbsPath(childRunId, "kb_context.md"))).resolves.toBeTruthy();
    await expect(fs.stat(artifactAbsPath(childRunId, "producer_brief.json"))).resolves.toBeTruthy();
    await expect(fs.stat(artifactAbsPath(childRunId, "facts_library_raw.json"))).resolves.toBeTruthy();

    // Unsafe artifacts should be ignored and not copied.
    const childRun = await request(app).get(`/api/runs/${childRunId}`);
    expect(childRun.status).toBe(200);
    expect(childRun.body.steps.KB0.artifacts).not.toContain("bad/evil.txt");
  });

  it("POST /api/runs/:runId/rerun tolerates missing artifacts array via fallback", async () => {
    const runs = new RunManager();
    const app = createApp(runs, makeExecutor() as never);

    const parent = await runs.createRun("rerun topic");
    const p = runs.getInternal(parent.runId);
    if (!p) throw new Error("missing parent");
    p.steps.KB0.status = "done";
    p.steps.KB0.startedAt = "2020-01-01T00:00:00.000Z";
    p.steps.KB0.finishedAt = "2020-01-01T00:01:00.000Z";
    // Exercise `parent.steps[step]?.artifacts ?? []` fallback.
    (p.steps.KB0 as unknown as { artifacts?: string[] }).artifacts = undefined;

    const res = await request(app).post(`/api/runs/${parent.runId}/rerun`).send({ startFrom: "A" });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("runId");
  });

  it("POST /api/runs/:runId/rerun supports startFrom=P for sparse legacy parent runs", async () => {
    const runs = new RunManager();
    const enqueue = vi.fn(() => true);
    const app = createApp(runs, makeExecutor({ enqueue }) as never);

    const parent = await runs.createRun("legacy sparse parent");
    const p = runs.getInternal(parent.runId);
    if (!p) throw new Error("missing parent");

    const now = "2026-02-11T00:00:00.000Z";
    for (const step of Object.keys(p.steps) as Array<keyof typeof p.steps>) {
      if (step === "P") continue;
      p.steps[step].status = "done";
      p.steps[step].startedAt = now;
      p.steps[step].finishedAt = now;
      (p.steps[step] as unknown as { artifacts?: string[] }).artifacts = undefined;
    }

    const res = await request(app).post(`/api/runs/${parent.runId}/rerun`).send({ startFrom: "P" });
    expect(res.status).toBe(200);
    const childRunId = String(res.body.runId);
    expect(childRunId.length).toBeGreaterThan(0);
    expect(enqueue).toHaveBeenCalledWith(childRunId, { startFrom: "P" });

    const child = await request(app).get(`/api/runs/${childRunId}`);
    expect(child.status).toBe(200);
    expect(child.body.derivedFrom).toMatchObject({ runId: parent.runId, startFrom: "P" });
    expect(child.body.steps.O.status).toBe("done");
    expect(child.body.steps.O.artifacts).toEqual([]);
    expect(child.body.steps.P.status).toBe("queued");
  });

  it("GET /api/runs/:runId/export returns 404 for missing run", async () => {
    const runs = new RunManager();
    const app = createApp(runs, makeExecutor() as never);
    const res = await request(app).get("/api/runs/nope/export");
    expect(res.status).toBe(404);
  });

  it("GET /api/runs/:runId/export returns a zip payload", async () => {
    const runs = new RunManager();
    const app = createApp(runs, makeExecutor() as never);
    const run = await runs.createRun("zip topic");

    // Add at least one file.
    await fs.writeFile(path.join(runOutputDirAbs(run.runId), "hello.txt"), "hello\n", "utf8");

    const res = await request(app)
      .get(`/api/runs/${run.runId}/export`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(String(res.headers["content-type"])).toContain("application/zip");
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(res.body.slice(0, 2).toString("utf8")).toBe("PK"); // zip magic
  });

  it("serves the built web UI when a webDistDir with index.html is provided (pilot mode)", async () => {
    const runs = new RunManager();

    const tmpWeb = await fs.mkdtemp(path.join(os.tmpdir(), "mms-web-"));
    try {
      await fs.mkdir(path.join(tmpWeb, "assets"));
      await fs.writeFile(path.join(tmpWeb, "index.html"), "<!doctype html><html><body>HELLO_UI</body></html>", "utf8");
      await fs.writeFile(path.join(tmpWeb, "assets", "x.txt"), "asset", "utf8");

      const app = createApp(runs, makeExecutor() as never, { webDistDir: tmpWeb });

      const res = await request(app).get("/");
      expect(res.status).toBe(200);
      expect(res.text).toContain("HELLO_UI");

      // SPA fallback (deep links).
      const deep = await request(app).get("/runs/abc123");
      expect(deep.status).toBe(200);
      expect(deep.text).toContain("HELLO_UI");

      // Static assets.
      const assetRes = await request(app).get("/assets/x.txt");
      expect(assetRes.status).toBe(200);
      expect(assetRes.text).toBe("asset");

      // API routes still work and are not shadowed by the SPA fallback.
      const health = await request(app).get("/api/health");
      expect(health.status).toBe(200);
      expect(health.body).toHaveProperty("ok", true);

      // Unknown /api routes should not be handled by the SPA fallback (must call next()).
      const apiNope = await request(app).get("/api/nope");
      expect(apiNope.status).toBe(404);
    } finally {
      await fs.rm(tmpWeb, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("does not serve the web UI when webDistDir is missing index.html", async () => {
    const runs = new RunManager();
    const tmpWeb = await fs.mkdtemp(path.join(os.tmpdir(), "mms-web-empty-"));
    try {
      const app = createApp(runs, makeExecutor() as never, { webDistDir: tmpWeb });
      const res = await request(app).get("/");
      expect(res.status).toBe(404);
    } finally {
      await fs.rm(tmpWeb, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("GET /api/runs/:runId/artifacts returns 404 for missing run", async () => {
    const runs = new RunManager();
    const app = createApp(runs, makeExecutor() as never);
    const res = await request(app).get("/api/runs/nope/artifacts");
    expect(res.status).toBe(404);
  });

  it("GET /api/runs/:runId/artifacts lists files with size + mtime + folder labels", async () => {
    const runs = new RunManager();
    const app = createApp(runs, makeExecutor() as never);
    const run = await runs.createRun("topic");
    const dir = runOutputDirAbs(run.runId);
    const intermediateDir = runIntermediateDirAbs(run.runId);
    const finalDir = runFinalDirAbs(run.runId);

    // Include a subdirectory (should be skipped by the listing).
    await fs.mkdir(path.join(dir, "subdir"));

    // Include a normal file (should be included).
    await fs.writeFile(path.join(dir, "note.txt"), "hi\n", "utf8");
    await fs.writeFile(path.join(intermediateDir, "mid.txt"), "mid\n", "utf8");
    await fs.writeFile(path.join(finalDir, "final.txt"), "final\n", "utf8");
    // Duplicate name across folders: most recent mtime should win and carry its folder label.
    await fs.writeFile(path.join(intermediateDir, "dup.txt"), "old\n", "utf8");
    await fs.writeFile(path.join(finalDir, "dup.txt"), "new\n", "utf8");
    // Exercise the "do not overwrite with older duplicate" branch.
    const rootDupPath = path.join(dir, "dup_root.txt");
    const intermediateDupPath = path.join(intermediateDir, "dup_root.txt");
    await fs.writeFile(rootDupPath, "root-new\n", "utf8");
    await fs.writeFile(intermediateDupPath, "intermediate-old\n", "utf8");
    const newer = new Date("2026-02-11T00:00:05.000Z");
    const older = new Date("2026-02-11T00:00:01.000Z");
    await fs.utimes(rootDupPath, newer, newer);
    await fs.utimes(intermediateDupPath, older, older);

    // Include a file that will fail stat (should be skipped).
    await fs.writeFile(path.join(dir, "gone.txt"), "bye\n", "utf8");

    const realStat = fs.stat;
    const statSpy = vi.spyOn(fs, "stat").mockImplementation(async (p) => {
      if (String(p).endsWith(`${path.sep}gone.txt`)) throw new Error("stat failed");
      return await realStat(p);
    });

    try {
      const res = await request(app).get(`/api/runs/${run.runId}/artifacts`);
      expect(res.status).toBe(200);
      const list = res.body as unknown as Array<{ name: string; size: number; mtimeMs: number; folder: string }>;
      expect(
        list.some((x) => x.name === "note.txt" && x.folder === "root" && typeof x.size === "number" && typeof x.mtimeMs === "number")
      ).toBe(true);
      expect(list.some((x) => x.name === "mid.txt" && x.folder === "intermediate")).toBe(true);
      expect(list.some((x) => x.name === "final.txt" && x.folder === "final")).toBe(true);
      expect(list.some((x) => x.name === "dup.txt" && x.folder === "final")).toBe(true);
      expect(list.some((x) => x.name === "dup_root.txt" && x.folder === "root")).toBe(true);
      expect(list.some((x) => x.name === "gone.txt")).toBe(false);
      expect(list.some((x) => x.name === "subdir")).toBe(false);
    } finally {
      statSpy.mockRestore();
    }
  });

  it("GET /api/runs/:runId/artifacts/:name validates safe names", async () => {
    const runs = new RunManager();
    const app = createApp(runs, makeExecutor() as never);
    const run = await runs.createRun("topic");

    const res = await request(app).get(`/api/runs/${run.runId}/artifacts/..%2Fsecret`);
    expect(res.status).toBe(400);
  });

  it("GET /api/runs/:runId/artifacts/:name returns 404 when missing", async () => {
    const runs = new RunManager();
    const app = createApp(runs, makeExecutor() as never);
    const run = await runs.createRun("topic");

    const res = await request(app).get(`/api/runs/${run.runId}/artifacts/missing.txt`);
    expect(res.status).toBe(404);
  });

  it("GET /api/runs/:runId/artifacts/:name returns 404 if run missing", async () => {
    const runs = new RunManager();
    const app = createApp(runs, makeExecutor() as never);
    const res = await request(app).get(`/api/runs/nope/artifacts/a.json`);
    expect(res.status).toBe(404);
  });

  it("GET /api/runs/:runId/artifacts/:name returns correct content-type", async () => {
    const runs = new RunManager();
    const app = createApp(runs, makeExecutor() as never);
    const run = await runs.createRun("topic");
    const dir = runOutputDirAbs(run.runId);

    await fs.writeFile(path.join(dir, "a.json"), "{\"a\":1}\n", "utf8");
    await fs.writeFile(path.join(dir, "b.md"), "# hi\n", "utf8");
    await fs.writeFile(path.join(dir, "c.txt"), "ok\n", "utf8");

    const j = await request(app).get(`/api/runs/${run.runId}/artifacts/a.json`);
    expect(String(j.headers["content-type"])).toContain("application/json");

    const m = await request(app).get(`/api/runs/${run.runId}/artifacts/b.md`);
    expect(String(m.headers["content-type"])).toContain("text/markdown");

    const t = await request(app).get(`/api/runs/${run.runId}/artifacts/c.txt`);
    expect(String(t.headers["content-type"])).toContain("text/plain");
  });

  it("GET /api/runs/:runId/artifacts/:name returns 404 when readFile throws unexpectedly", async () => {
    const runs = new RunManager();
    const app = createApp(runs, makeExecutor() as never);
    const run = await runs.createRun("topic");
    await fs.writeFile(path.join(runOutputDirAbs(run.runId), "x.txt"), "ok\n", "utf8");

    const realReadFile = fs.readFile;
    const readSpy = vi.spyOn(fs, "readFile").mockImplementation(async (p, opts) => {
      if (String(p).endsWith(`${path.sep}x.txt`)) throw new Error("boom");
      return await realReadFile(p, opts as never);
    });

    try {
      const res = await request(app).get(`/api/runs/${run.runId}/artifacts/x.txt`);
      expect(res.status).toBe(404);
      expect(res.text).toContain("artifact not found");
    } finally {
      readSpy.mockRestore();
    }
  });

  it("GET /api/runs/:runId/events streams SSE events", async () => {
    const runs = new RunManager();
    const run = await runs.createRun("topic");
    const app = createApp(runs, makeExecutor() as never);

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("unexpected server address");

    const url = `http://127.0.0.1:${addr.port}/api/runs/${run.runId}/events`;
    const controller = new AbortController();

    try {
      const res = await fetch(url, { signal: controller.signal });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");

      const reader = res.body?.getReader();
      if (!reader) throw new Error("missing response body reader");

      async function readChunk(
        bodyReader: ReadableStreamDefaultReader<Uint8Array>,
        timeoutMs: number
      ): Promise<string> {
        const r = await Promise.race([
          bodyReader.read(),
          new Promise<{ done: boolean; value?: Uint8Array }>((_resolve, reject) =>
            setTimeout(() => reject(new Error("timeout waiting for SSE chunk")), timeoutMs)
          )
        ]);
        return new TextDecoder().decode(r.value ?? new Uint8Array());
      }

      // First chunk should include "SSE connected".
      const firstText = await readChunk(reader, 500);
      expect(firstText).toContain("event: log");
      expect(firstText).toContain("SSE connected");

      // Emit a log event and read another chunk.
      runs.log(run.runId, "hello");
      const secondText = await readChunk(reader, 500);
      expect(secondText).toContain("hello");
    } finally {
      controller.abort();
      server.close();
    }
  });

  it("GET /api/runs/:runId/events returns 404 for missing runs", async () => {
    const runs = new RunManager();
    const app = createApp(runs, makeExecutor() as never);
    const res = await request(app).get("/api/runs/nope/events");
    expect(res.status).toBe(404);
  });

  it("GET /api/runs/:runId/events sends ping events (keep-alive)", async () => {
    const runs = new RunManager();
    const run = await runs.createRun("topic");
    const app = createApp(runs, makeExecutor() as never);

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("unexpected server address");

    const url = `http://127.0.0.1:${addr.port}/api/runs/${run.runId}/events`;
    const controller = new AbortController();

    const pingCallbacks: Array<() => void> = [];
    const intervalSpy = vi.spyOn(global, "setInterval").mockImplementation(((cb: () => void) => {
      pingCallbacks.push(cb);
      return 123 as unknown as NodeJS.Timeout;
    }) as never);
    const clearSpy = vi.spyOn(global, "clearInterval").mockImplementation((() => undefined) as never);

    try {
      const res = await fetch(url, { signal: controller.signal });
      expect(res.status).toBe(200);

      const reader = res.body?.getReader();
      if (!reader) throw new Error("missing response body reader");

      async function readChunk(
        bodyReader: ReadableStreamDefaultReader<Uint8Array>,
        timeoutMs: number
      ): Promise<string> {
        const r = await Promise.race([
          bodyReader.read(),
          new Promise<{ done: boolean; value?: Uint8Array }>((_resolve, reject) =>
            setTimeout(() => reject(new Error("timeout waiting for SSE chunk")), timeoutMs)
          )
        ]);
        return new TextDecoder().decode(r.value ?? new Uint8Array());
      }

      // Flush the initial "connected" log.
      await readChunk(reader, 500);

      // Trigger the ping interval callback manually.
      expect(pingCallbacks.length).toBeGreaterThanOrEqual(1);
      pingCallbacks[0]?.();

      const pingText = await readChunk(reader, 500);
      expect(pingText).toContain("event: ping");
    } finally {
      controller.abort();
      server.close();
      intervalSpy.mockRestore();
      clearSpy.mockRestore();
    }
  });
});
