import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RunManager, STEP_ORDER } from "../src/run_manager.js";
import { runFinalDirAbs, runIntermediateDirAbs, runOutputDirAbs } from "../src/pipeline/utils.js";

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

describe("RunManager", () => {
  it("createRun writes run.json and initializes steps", async () => {
    const runs = new RunManager();
    const run = await runs.createRun("topic 1", { durationMinutes: 20 });

    expect(run.runId).toHaveLength(12);
    expect(run.topic).toBe("topic 1");
    expect(run.settings).toMatchObject({ durationMinutes: 20 });
    expect(run.outputFolder).toBe(`output/${run.runId}`);

    const p = path.join(runOutputDirAbs(run.runId), "run.json");
    const raw = await fs.readFile(p, "utf8");
    const onDisk = JSON.parse(raw) as typeof run;
    expect(onDisk.runId).toBe(run.runId);
    expect(onDisk.steps).toBeTruthy();
    await expect(fs.stat(runIntermediateDirAbs(run.runId))).resolves.toBeTruthy();
    await expect(fs.stat(runFinalDirAbs(run.runId))).resolves.toBeTruthy();

    for (const s of STEP_ORDER) {
      expect(onDisk.steps[s].name).toBe(s);
      expect(onDisk.steps[s].status).toBe("queued");
      expect(onDisk.steps[s].artifacts).toEqual([]);
    }
  });

  it("emits step + artifact events to subscribers", async () => {
    const runs = new RunManager();
    const run = await runs.createRun("topic 2");

    const events: Array<{ type: string; payload: unknown }> = [];
    const unsub = runs.subscribe(run.runId, (type, payload) => {
      events.push({ type, payload });
    });
    expect(unsub).toBeTypeOf("function");

    await runs.startStep(run.runId, "A");
    await runs.addArtifact(run.runId, "A", "producer_brief.json");
    await runs.finishStep(run.runId, "A", true);

    unsub?.();

    expect(events.map((e) => e.type)).toEqual(["step_started", "artifact_written", "step_finished"]);
  });

  it("error events never crash the process when unobserved", async () => {
    const runs = new RunManager();
    const run = await runs.createRun("topic 3");
    expect(() => runs.error(run.runId, "boom")).not.toThrow();
  });

  it("initFromDisk loads prior runs", async () => {
    const runs1 = new RunManager();
    const r1 = await runs1.createRun("topic 4");

    const runs2 = new RunManager();
    await runs2.initFromDisk();

    const loaded = runs2.getRun(r1.runId);
    expect(loaded).not.toBeNull();
    expect(loaded?.topic).toBe("topic 4");
  });

  it("initFromDisk skips non-directories and invalid/missing run.json files", async () => {
    // Create a valid run on disk.
    const runs1 = new RunManager();
    const r1 = await runs1.createRun("topic ok");

    // Add noise in output root: a file and two folders without valid run.json.
    const root = process.env.MMS_OUTPUT_DIR!;
    await fs.writeFile(path.join(root, "not_a_dir.txt"), "x\n", "utf8");
    await fs.mkdir(path.join(root, "orphan"), { recursive: true });
    await fs.mkdir(path.join(root, "bad"), { recursive: true });
    await fs.writeFile(path.join(root, "bad", "run.json"), "{not json", "utf8");

    const runs2 = new RunManager();
    await runs2.initFromDisk();

    expect(runs2.getRun(r1.runId)?.topic).toBe("topic ok");
    expect(runs2.getRun("orphan")).toBeNull();
    expect(runs2.getRun("bad")).toBeNull();
  });

  it("listRuns sorts newest first (covers both comparator branches)", async () => {
    const runs = new RunManager();
    const r1 = await runs.createRun("t1");
    const r2 = await runs.createRun("t2");

    // Force an ordering with predictable timestamps.
    const i1 = runs.getInternal(r1.runId);
    const i2 = runs.getInternal(r2.runId);
    if (!i1 || !i2) throw new Error("missing internal run");

    i1.startedAt = "2020-01-01T00:00:00.000Z";
    i2.startedAt = "2020-01-02T00:00:00.000Z";

    const first = runs.listRuns();
    expect(first[0]?.runId).toBe(r2.runId);

    // Swap to exercise the other comparator branch.
    i1.startedAt = "2020-01-03T00:00:00.000Z";
    i2.startedAt = "2020-01-02T00:00:00.000Z";

    const second = runs.listRuns();
    expect(second[0]?.runId).toBe(r1.runId);
  });

  it("setRunStatus applies optional patch fields and is a no-op for missing runs", async () => {
    const runs = new RunManager();
    const run = await runs.createRun("topic");

    await expect(runs.setRunStatus("missing", "done")).resolves.toBeUndefined();

    await runs.setRunStatus(run.runId, "done", {
      finishedAt: new Date("2020-01-01T00:00:00.000Z").toISOString(),
      traceId: "trace_x",
      settings: { durationMinutes: 10, targetSlides: 12, level: "student" },
      derivedFrom: { runId: "parent", startFrom: "C", createdAt: new Date("2020-01-01T00:00:00.000Z").toISOString() },
      canonicalSources: {
        foundAny: true,
        templateRoot: "/repo/data/canon",
        characterBiblePath: "/repo/data/canon/character_bible.md",
        seriesStyleBiblePath: "/repo/data/canon/series_style_bible.md",
        deckSpecPath: "/repo/data/canon/episode/deck_spec.md"
      },
      constraintAdherence: {
        status: "warn",
        failureCount: 0,
        warningCount: 1,
        checkedAt: new Date("2020-01-01T00:05:00.000Z").toISOString()
      }
    });

    const updated = runs.getRun(run.runId);
    expect(updated?.status).toBe("done");
    expect(updated?.traceId).toBe("trace_x");
    expect(updated?.settings?.targetSlides).toBe(12);
    expect(updated?.derivedFrom?.runId).toBe("parent");
    expect(updated?.canonicalSources?.foundAny).toBe(true);
    expect(updated?.constraintAdherence?.status).toBe("warn");
  });

  it("setCanonicalSources/setConstraintAdherence are no-ops for missing runs and persist for existing runs", async () => {
    const runs = new RunManager();
    const run = await runs.createRun("topic");

    await expect(
      runs.setCanonicalSources("missing", { foundAny: false, templateRoot: "/x", characterBiblePath: "/x/a", seriesStyleBiblePath: "/x/b", deckSpecPath: "/x/c" })
    ).resolves.toBeUndefined();
    await expect(
      runs.setConstraintAdherence("missing", { status: "pass", failureCount: 0, warningCount: 0, checkedAt: "t" })
    ).resolves.toBeUndefined();

    await runs.setCanonicalSources(run.runId, {
      foundAny: true,
      templateRoot: "/repo/data/canon",
      characterBiblePath: "/repo/data/canon/character_bible.md",
      seriesStyleBiblePath: "/repo/data/canon/series_style_bible.md",
      deckSpecPath: "/repo/data/canon/episode/deck_spec.md"
    });
    await runs.setConstraintAdherence(run.runId, {
      status: "pass",
      failureCount: 0,
      warningCount: 0,
      checkedAt: "2026-02-11T00:00:00.000Z"
    });

    const updated = runs.getRun(run.runId);
    expect(updated?.canonicalSources?.templateRoot).toContain("canon");
    expect(updated?.constraintAdherence?.status).toBe("pass");
  });

  it("finishStep records error details and emits error events only when error is provided", async () => {
    const runs = new RunManager();
    const run = await runs.createRun("topic");

    const types: string[] = [];
    const unsub = runs.subscribe(run.runId, (type) => types.push(type));

    await runs.startStep(run.runId, "A");
    await runs.finishStep(run.runId, "A", false, "boom");
    expect(runs.getRun(run.runId)?.steps.A.error).toBe("boom");

    // No error message: should not emit an additional "error" event.
    await runs.startStep(run.runId, "B");
    await runs.finishStep(run.runId, "B", false);

    unsub?.();

    expect(types).toContain("step_finished");
    expect(types).toContain("error");
  });

  it("addArtifact de-dupes artifacts and persists", async () => {
    const runs = new RunManager();
    const run = await runs.createRun("topic");

    await runs.addArtifact(run.runId, "A", "x.json");
    await runs.addArtifact(run.runId, "A", "x.json");
    expect(runs.getRun(run.runId)?.steps.A.artifacts).toEqual(["x.json"]);
  });

  it("setStepNoEvent updates fields and subscribe/unsubscribe stops delivery", async () => {
    const runs = new RunManager();
    const run = await runs.createRun("topic");

    await runs.setStepNoEvent(run.runId, "A", {
      status: "done",
      startedAt: "s",
      finishedAt: "f",
      error: "e",
      artifacts: ["a.json"]
    });

    // No-op patch should not crash and exercises the "false" branches of the patch field checks.
    await runs.setStepNoEvent(run.runId, "A", {});

    const s = runs.getRun(run.runId)?.steps.A;
    expect(s?.status).toBe("done");
    expect(s?.artifacts).toEqual(["a.json"]);

    const events: string[] = [];
    const unsub = runs.subscribe(run.runId, (type) => events.push(type));
    runs.log(run.runId, "hi");
    unsub?.();
    runs.log(run.runId, "bye");
    expect(events).toEqual(["log"]);
  });

  it("subscribe returns null for missing runs and log/error are no-ops for missing IDs", async () => {
    const runs = new RunManager();
    expect(runs.subscribe("missing", () => undefined)).toBeNull();
    expect(() => runs.log("missing", "x")).not.toThrow();
    expect(() => runs.error("missing", "x")).not.toThrow();
    await expect(runs.setTraceId("missing", "t")).resolves.toBeUndefined();
  });

  it("step mutators are safe no-ops for missing run ids", async () => {
    const runs = new RunManager();
    await expect(runs.startStep("missing", "A")).resolves.toBeUndefined();
    await expect(runs.finishStep("missing", "A", true)).resolves.toBeUndefined();
    await expect(runs.addArtifact("missing", "A", "a.json")).resolves.toBeUndefined();
    await expect(runs.setStepNoEvent("missing", "A", { status: "done" })).resolves.toBeUndefined();
  });

  it("retentionStats reports total/terminal/active counts", async () => {
    const runs = new RunManager();
    const r1 = await runs.createRun("done");
    const r2 = await runs.createRun("running");
    const r3 = await runs.createRun("error");

    await runs.setRunStatus(r1.runId, "done");
    await runs.setRunStatus(r2.runId, "running");
    await runs.setRunStatus(r3.runId, "error");

    expect(runs.retentionStats()).toEqual({
      totalRuns: 3,
      terminalRuns: 2,
      activeRuns: 1
    });
  });

  it("cleanupTerminalRuns supports dry-run and real deletion of oldest terminal runs", async () => {
    const runs = new RunManager();
    const r1 = await runs.createRun("old done");
    const r2 = await runs.createRun("new done");
    const r3 = await runs.createRun("active");

    const i1 = runs.getInternal(r1.runId);
    const i2 = runs.getInternal(r2.runId);
    if (!i1 || !i2) throw new Error("missing internals");
    i1.startedAt = "2020-01-01T00:00:00.000Z";
    i2.startedAt = "2020-01-02T00:00:00.000Z";

    await runs.setRunStatus(r1.runId, "done");
    await runs.setRunStatus(r2.runId, "done");
    await runs.setRunStatus(r3.runId, "running");

    const preview = await runs.cleanupTerminalRuns(1, true);
    expect(preview.dryRun).toBe(true);
    expect(preview.scannedTerminalRuns).toBe(2);
    expect(preview.keptRunIds).toEqual([r2.runId]);
    expect(preview.deletedRunIds).toEqual([r1.runId]);
    expect(runs.getRun(r1.runId)).not.toBeNull();

    const applied = await runs.cleanupTerminalRuns(1, false);
    expect(applied.dryRun).toBe(false);
    expect(applied.deletedRunIds).toEqual([r1.runId]);
    expect(runs.getRun(r1.runId)).toBeNull();
    expect(runs.getRun(r2.runId)).not.toBeNull();
    expect(runs.getRun(r3.runId)).not.toBeNull();
    await expect(fs.stat(runOutputDirAbs(r1.runId))).rejects.toBeTruthy();
    await expect(fs.stat(runOutputDirAbs(r2.runId))).resolves.toBeTruthy();
  });

  it("retentionAnalytics reports age buckets and per-run sizes", async () => {
    const runs = new RunManager();
    const r1 = await runs.createRun("r1");
    const r2 = await runs.createRun("r2");

    await fs.writeFile(path.join(runOutputDirAbs(r1.runId), "a.txt"), "hello", "utf8");
    await fs.writeFile(path.join(runOutputDirAbs(r2.runId), "b.txt"), "world world", "utf8");

    const i1 = runs.getInternal(r1.runId);
    const i2 = runs.getInternal(r2.runId);
    if (!i1 || !i2) throw new Error("missing internals");
    i1.startedAt = "2026-02-11T00:00:00.000Z";
    i2.startedAt = "2026-01-01T00:00:00.000Z";

    const analytics = await runs.retentionAnalytics(Date.parse("2026-02-11T12:00:00.000Z"));
    expect(analytics.perRun).toHaveLength(2);
    expect(analytics.totalSizeBytes).toBeGreaterThan(0);
    expect(analytics.ageBuckets.lt_24h.count).toBe(1);
    expect(analytics.ageBuckets.between_1d_7d.count + analytics.ageBuckets.between_7d_30d.count + analytics.ageBuckets.gte_30d.count).toBe(
      1
    );
    expect(analytics.perRun[0]?.sizeBytes).toBeGreaterThanOrEqual(analytics.perRun[1]?.sizeBytes ?? 0);
  });

  it("cleanupTerminalRuns includes deletedRuns details and reclaimed bytes", async () => {
    const runs = new RunManager();
    const r1 = await runs.createRun("done");
    await runs.setRunStatus(r1.runId, "done");
    await fs.writeFile(path.join(runOutputDirAbs(r1.runId), "payload.txt"), "1234567890", "utf8");

    const res = await runs.cleanupTerminalRuns(0, true);
    expect(res.deletedRunIds).toContain(r1.runId);
    expect(res.deletedRuns[0]?.runId).toBe(r1.runId);
    expect(res.reclaimedBytes).toBeGreaterThan(0);
  });
});
