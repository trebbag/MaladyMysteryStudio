import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(fn: () => boolean, timeoutMs = 1500): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return;
    await sleep(10);
  }
  throw new Error("timeout");
}

let tmpOut: string | null = null;

beforeEach(async () => {
  vi.resetModules();
  vi.doMock("node:fs/promises", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:fs/promises")>();
    const patched = {
      ...actual,
      // Force the CANCELLED marker write to fail so the `.catch(() => undefined)` handler is executed.
      writeFile: vi.fn(async () => {
        throw new Error("nope");
      })
    };
    // executor.ts uses a default import of "node:fs/promises" (esModuleInterop); provide a default export too.
    return { ...patched, default: patched };
  });

  const fs = await import("node:fs/promises");
  tmpOut = await fs.mkdtemp(path.join(os.tmpdir(), "mms-out-"));
  process.env.MMS_OUTPUT_DIR = tmpOut;
});

afterEach(async () => {
  delete process.env.MMS_OUTPUT_DIR;
  const fs = await import("node:fs/promises");
  if (tmpOut) await fs.rm(tmpOut, { recursive: true, force: true }).catch(() => undefined);
  tmpOut = null;

  vi.doUnmock("node:fs/promises");
  vi.resetModules();
});

describe("RunExecutor (cancel marker best-effort)", () => {
  it("swallows fs write errors when persisting CANCELLED.txt", async () => {
    const { RunExecutor } = await import("../src/executor.js");

    const run: { runId: string; topic: string; status: "queued" | "running" | "done" | "error" } = {
      runId: "run1",
      topic: "t",
      status: "queued"
    };

    const runs = {
      getRun: (id: string) => (id === run.runId ? (run as never) : null),
      setRunStatus: async (id: string, status: string) => {
        if (id === run.runId) (run as { status: string }).status = status;
      },
      log: () => undefined,
      error: () => undefined
    } as never;

    const pipeline = async (_input: unknown, _runs: unknown, options: { signal: AbortSignal }) => {
      // Wait forever, but reject when cancelled.
      await new Promise<void>((_resolve, reject) => {
        const onAbort = () => reject(new Error("Cancelled"));
        if (options.signal.aborted) return reject(new Error("Cancelled"));
        options.signal.addEventListener("abort", onAbort, { once: true });
      });
    };

    const exec = new RunExecutor(runs, pipeline, { concurrency: 1 });
    exec.enqueue(run.runId);
    await waitFor(() => run.status === "running");

    expect(exec.cancel(run.runId)).toBe(true);
    await waitFor(() => run.status === "error");

    const fsp = await import("node:fs/promises");
    const writeFileMock = vi.mocked(fsp.writeFile);
    await waitFor(() => writeFileMock.mock.calls.length > 0);
  });
});
