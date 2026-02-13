import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RunExecutor, type PipelineFn } from "../src/executor.js";
import { RunManager } from "../src/run_manager.js";
import { artifactAbsPath } from "../src/pipeline/utils.js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(fn: () => boolean | Promise<boolean>, timeoutMs = 1500): Promise<void> {
  const start = Date.now();
  // Basic polling is fine here; these are tiny local async state changes.
  while (Date.now() - start < timeoutMs) {
    // Support async predicates to avoid flaky timing in I/O assertions.
    if (await fn()) return;
    await sleep(10);
  }
  throw new Error("timeout");
}

type Deferred = { promise: Promise<void>; resolve: () => void; reject: (err: Error) => void };

function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

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

describe("RunExecutor", () => {
  it("defaults concurrency to 1 when options are omitted", async () => {
    const runs = new RunManager();
    const gate = deferred();
    let firstRunId: string | null = null;

    const pipeline: PipelineFn = async (input, _runs, options) => {
      if (!firstRunId) firstRunId = input.runId;
      if (input.runId === firstRunId) {
        if (options.signal.aborted) throw new Error("Cancelled");
        await gate.promise;
      }
    };

    const exec = new RunExecutor(runs, pipeline); // no options
    const r1 = await runs.createRun("t1");
    const r2 = await runs.createRun("t2");

    exec.enqueue(r1.runId);
    exec.enqueue(r2.runId);

    await waitFor(() => runs.getRun(r1.runId)?.status === "running");
    expect(runs.getRun(r2.runId)?.status).toBe("queued");

    gate.resolve();
    await waitFor(() => runs.getRun(r2.runId)?.status === "done");
  });

  it("respects concurrency=1 (queues second run until first finishes)", async () => {
    const runs = new RunManager();
    const gates = new Map<string, Deferred>();

    const pipeline: PipelineFn = async (input, _runs, options) => {
      const d = gates.get(input.runId) ?? deferred();
      gates.set(input.runId, d);
      if (options.signal.aborted) throw new Error("Cancelled");
      await d.promise;
    };

    const exec = new RunExecutor(runs, pipeline, { concurrency: 1 });

    const r1 = await runs.createRun("t1");
    const r2 = await runs.createRun("t2");
    gates.set(r1.runId, deferred());
    gates.set(r2.runId, deferred());

    exec.enqueue(r1.runId);
    exec.enqueue(r2.runId);

    await waitFor(() => runs.getRun(r1.runId)?.status === "running");
    expect(exec.isRunning(r1.runId)).toBe(true);
    expect(exec.isRunning(r2.runId)).toBe(false);
    expect(runs.getRun(r2.runId)?.status).toBe("queued");

    gates.get(r1.runId)?.resolve();
    await waitFor(() => runs.getRun(r1.runId)?.status === "done");

    await waitFor(() => runs.getRun(r2.runId)?.status === "running");
    gates.get(r2.runId)?.resolve();
    await waitFor(() => runs.getRun(r2.runId)?.status === "done");
  });

  it("enqueue is idempotent for already-queued runs (no duplicate execution)", async () => {
    const runs = new RunManager();
    const gate = deferred();
    const calls = new Map<string, number>();
    let firstRunId: string | null = null;

    const pipeline: PipelineFn = async (input, _runs, options) => {
      calls.set(input.runId, (calls.get(input.runId) ?? 0) + 1);
      if (!firstRunId) firstRunId = input.runId;
      if (input.runId === firstRunId) {
        if (options.signal.aborted) throw new Error("Cancelled");
        await gate.promise;
      }
    };

    const exec = new RunExecutor(runs, pipeline, { concurrency: 1 });
    const r1 = await runs.createRun("t1");
    const r2 = await runs.createRun("t2");

    exec.enqueue(r1.runId);
    await waitFor(() => runs.getRun(r1.runId)?.status === "running");

    exec.enqueue(r2.runId);
    expect(runs.getRun(r2.runId)?.status).toBe("queued");
    // Second enqueue should be a no-op and return true (already queued).
    expect(exec.enqueue(r2.runId)).toBe(true);

    gate.resolve();
    await waitFor(() => runs.getRun(r1.runId)?.status === "done");
    await waitFor(() => runs.getRun(r2.runId)?.status === "done");
    expect(calls.get(r2.runId)).toBe(1);
  });

  it("enqueue returns false when the run is already running", async () => {
    const runs = new RunManager();
    const pipeline: PipelineFn = async (_input, _runs, options) => {
      if (options.signal.aborted) throw new Error("Cancelled");
      await sleep(50);
    };

    const exec = new RunExecutor(runs, pipeline, { concurrency: 1 });
    const r1 = await runs.createRun("t1");

    exec.enqueue(r1.runId);
    await waitFor(() => runs.getRun(r1.runId)?.status === "running");
    expect(exec.enqueue(r1.runId)).toBe(false);
    await waitFor(() => runs.getRun(r1.runId)?.status !== "running");
  });

  it("emits error messages for non-abort failures and for non-Error throws", async () => {
    const runs = new RunManager();
    const msgs: string[] = [];
    const r1 = await runs.createRun("t1");
    const r2 = await runs.createRun("t2");

    const unsub1 = runs.subscribe(r1.runId, (type, payload) => {
      if (type !== "error") return;
      const rec = payload as { message?: string };
      if (rec.message) msgs.push(rec.message);
    });

    const unsub2 = runs.subscribe(r2.runId, (type, payload) => {
      if (type !== "error") return;
      const rec = payload as { message?: string };
      if (rec.message) msgs.push(rec.message);
    });

    // r1 throws Error, r2 throws a string.
    let which = 0;
    const pipeline: PipelineFn = async () => {
      which += 1;
      if (which === 1) throw new Error("Boom");
      throw "string-fail";
    };

    const exec = new RunExecutor(runs, pipeline, { concurrency: 1 });
    exec.enqueue(r1.runId);
    await waitFor(() => runs.getRun(r1.runId)?.status === "error");
    exec.enqueue(r2.runId);
    await waitFor(() => runs.getRun(r2.runId)?.status === "error");

    unsub1?.();
    unsub2?.();

    expect(msgs).toContain("Boom");
    expect(msgs).toContain("string-fail");
  });

  it("can cancel a running run and writes CANCELLED.txt", async () => {
    const runs = new RunManager();
    const pipeline: PipelineFn = async (_input, _runs, options) => {
      await new Promise<void>((_resolve, reject) => {
        const onAbort = () => reject(new Error("Cancelled"));
        if (options.signal.aborted) return reject(new Error("Cancelled"));
        options.signal.addEventListener("abort", onAbort, { once: true });
      });
    };

    const exec = new RunExecutor(runs, pipeline, { concurrency: 1 });
    const r1 = await runs.createRun("t1");

    exec.enqueue(r1.runId);
    await waitFor(() => runs.getRun(r1.runId)?.status === "running");

    expect(exec.cancel(r1.runId)).toBe(true);
    await waitFor(() => runs.getRun(r1.runId)?.status === "error");

    const marker = artifactAbsPath(r1.runId, "CANCELLED.txt");
    await waitFor(async () => {
      try {
        await fs.stat(marker);
        return true;
      } catch {
        return false;
      }
    });
  });

  it("can cancel a queued run", async () => {
    const runs = new RunManager();
    const gate = deferred();
    let firstRunId: string | null = null;

    const pipeline: PipelineFn = async (input, _runs, options) => {
      if (!firstRunId) firstRunId = input.runId;
      if (input.runId === firstRunId) {
        if (options.signal.aborted) throw new Error("Cancelled");
        await gate.promise;
      }
    };

    const exec = new RunExecutor(runs, pipeline, { concurrency: 1 });

    // We'll create two runs and block the first by never resolving the gate until after cancellation.
    const r1 = await runs.createRun("t1");
    const r2 = await runs.createRun("t2");

    exec.enqueue(r1.runId);
    await waitFor(() => runs.getRun(r1.runId)?.status === "running");
    exec.enqueue(r2.runId);

    expect(runs.getRun(r2.runId)?.status).toBe("queued");
    expect(exec.cancel(r2.runId)).toBe(true);
    expect(runs.getRun(r2.runId)?.status).toBe("error");

    // Clean shutdown for the first run.
    gate.resolve();
    await waitFor(() => runs.getRun(r1.runId)?.status === "done");
  });

  it("returns false when cancelling an idle run", async () => {
    const runs = new RunManager();
    const exec = new RunExecutor(runs, async () => undefined, { concurrency: 1 });
    const r1 = await runs.createRun("t1");

    expect(exec.cancel(r1.runId)).toBe(false);
    expect(exec.cancel("missing")).toBe(false);
  });

  it("returns false when enqueueing a missing run", async () => {
    const runs = new RunManager();
    const exec = new RunExecutor(runs, async () => undefined, { concurrency: 1 });
    expect(exec.enqueue("missing")).toBe(false);
  });
});
