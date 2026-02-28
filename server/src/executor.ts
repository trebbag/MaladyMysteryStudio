import fs from "node:fs/promises";
import type { RunManager, RunSettings, StepName } from "./run_manager.js";
import { artifactAbsPath, nowIso } from "./pipeline/utils.js";

export type PipelineOptions = {
  signal: AbortSignal;
  startFrom?: StepName;
};

export type PipelineFn = (
  input: { runId: string; topic: string; settings?: RunSettings },
  runs: RunManager,
  options: PipelineOptions
) => Promise<void>;

export class PipelinePause extends Error {
  gateId: string;
  resumeFrom: StepName;
  constructor(gateId: string, resumeFrom: StepName, message: string) {
    super(message);
    this.name = "PipelinePause";
    this.gateId = gateId;
    this.resumeFrom = resumeFrom;
  }
}

type QueueItem = {
  runId: string;
  startFrom?: StepName;
};

export class RunExecutor {
  private readonly concurrency: number;
  private readonly running = new Map<string, AbortController>();
  private readonly queue: QueueItem[] = [];

  constructor(
    private readonly runs: RunManager,
    private readonly pipeline: PipelineFn,
    options?: {
      concurrency?: number;
    }
  ) {
    this.concurrency = Math.max(1, options?.concurrency ?? 1);
  }

  isRunning(runId: string): boolean {
    return this.running.has(runId);
  }

  enqueue(runId: string, options?: { startFrom?: StepName }): boolean {
    const run = this.runs.getRun(runId);
    if (!run) return false;
    if (run.status === "running") return false;

    // Avoid duplicate queue entries.
    if (this.queue.some((q) => q.runId === runId) || this.running.has(runId)) return true;

    this.queue.push({ runId, startFrom: options?.startFrom });
    this.runs.log(runId, `Queued (max concurrency ${this.concurrency})`);
    this.drain();
    return true;
  }

  cancel(runId: string): boolean {
    const run = this.runs.getRun(runId);
    if (!run) return false;

    const ctrl = this.running.get(runId);
    if (ctrl) {
      this.runs.log(runId, "Cancellation requested");
      ctrl.abort();
      return true;
    }

    const idx = this.queue.findIndex((q) => q.runId === runId);
    if (idx !== -1) {
      this.queue.splice(idx, 1);
      this.runs.error(runId, "Cancelled while queued");
      void this.runs.setRunStatus(runId, "error", { finishedAt: nowIso() });
      return true;
    }

    return false;
  }

  private drain(): void {
    while (this.running.size < this.concurrency && this.queue.length > 0) {
      // Queue is non-empty due to the while condition.
      const next = this.queue.shift()!;
      void this.start(next);
    }
  }

  private async start(item: QueueItem): Promise<void> {
    const run = this.runs.getRun(item.runId);
    if (!run) return;

    const controller = new AbortController();
    this.running.set(item.runId, controller);

    await this.runs.setRunStatus(item.runId, "running");

    try {
      await this.pipeline({ runId: run.runId, topic: run.topic, settings: run.settings }, this.runs, {
        signal: controller.signal,
        startFrom: item.startFrom
      });
      await this.runs.setRunStatus(item.runId, "done", { finishedAt: nowIso() });
    } catch (err) {
      if (err instanceof PipelinePause) {
        this.runs.log(item.runId, `Paused at ${err.gateId}: ${err.message}`);
        const pausedAt = nowIso();
        this.runs.gateRequired(item.runId, {
          gateId: err.gateId,
          resumeFrom: err.resumeFrom,
          message: err.message,
          at: pausedAt
        });
        await this.runs.setRunStatus(item.runId, "paused", {
          activeGate: {
            gateId: err.gateId,
            resumeFrom: err.resumeFrom,
            message: err.message,
            at: pausedAt,
            awaiting: "review_submission"
          }
        });
        return;
      }

      const aborted = controller.signal.aborted;
      const msg = aborted ? "Cancelled" : err instanceof Error ? err.message : String(err);
      this.runs.error(item.runId, msg);
      await this.runs.setRunStatus(item.runId, "error", { finishedAt: nowIso() });

      // Persist a cancellation marker for UX.
      if (aborted) {
        await fs
          .writeFile(artifactAbsPath(item.runId, "CANCELLED.txt"), `Cancelled at ${nowIso()}\n`)
          .catch(() => undefined);
      }
    } finally {
      this.running.delete(item.runId);
      this.drain();
    }
  }
}
