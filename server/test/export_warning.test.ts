import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RunManager } from "../src/run_manager.js";

let tmpOut: string | null = null;

beforeEach(async () => {
  tmpOut = await fs.mkdtemp(path.join(os.tmpdir(), "mms-out-"));
  process.env.MMS_OUTPUT_DIR = tmpOut;

  vi.resetModules();
  vi.doMock("archiver", () => {
    return {
      default: () => {
        const handlers: Record<string, ((err: Error) => void) | undefined> = {};
        let res: { write?: (chunk: string) => void; end?: () => void } | null = null;
        const archive = {
          on: (evt: string, cb: (err: Error) => void) => {
            handlers[evt] = cb;
            return archive;
          },
          pipe: (nextRes: unknown) => {
            res = nextRes as typeof res;
          },
          directory: () => undefined,
          finalize: () => {
            handlers.warning?.(new Error("warn"));
            // Write minimal zip magic so the response completes.
            res?.write?.("PK");
            res?.end?.();
          }
        };
        return archive;
      }
    };
  });
});

afterEach(async () => {
  delete process.env.MMS_OUTPUT_DIR;
  vi.doUnmock("archiver");
  vi.resetModules();
  if (tmpOut) await fs.rm(tmpOut, { recursive: true, force: true }).catch(() => undefined);
  tmpOut = null;
});

describe("export zip warning handling", () => {
  it("logs warnings when archiver emits one", async () => {
    const { createApp } = await import("../src/app.js");
    const runs = new RunManager();
    const exec = { enqueue: () => true, cancel: () => true, isRunning: () => false };

    const run = await runs.createRun("topic");

    const logs: string[] = [];
    const unsub = runs.subscribe(run.runId, (type, payload) => {
      if (type !== "log") return;
      const msg = (payload as { message?: string }).message;
      if (msg) logs.push(msg);
    });

    const app = createApp(runs, exec as never);
    const res = await request(app).get(`/api/runs/${run.runId}/export`);
    expect(res.status).toBe(200);

    unsub?.();

    expect(logs.some((l) => l.includes("zip warning: warn"))).toBe(true);
  });
});

