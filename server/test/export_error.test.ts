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
        return {
          on: (evt: string, cb: (err: Error) => void) => {
            handlers[evt] = cb;
            return this;
          },
          pipe: () => undefined,
          directory: () => undefined,
          finalize: () => {
            handlers.error?.(new Error("boom"));
          }
        };
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

describe("export zip error handling", () => {
  it("returns 500 when archiver emits an error", async () => {
    const { createApp } = await import("../src/app.js");
    const runs = new RunManager();
    const exec = { enqueue: () => true, cancel: () => true, isRunning: () => false };

    const run = await runs.createRun("topic");
    const app = createApp(runs, exec as never);

    const res = await request(app).get(`/api/runs/${run.runId}/export`);
    expect(res.status).toBe(500);
  });
});

