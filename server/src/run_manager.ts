import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import {
  ensureDir,
  nowIso,
  outputRootAbs,
  runFinalDirAbs,
  runIntermediateDirAbs,
  runOutputDirAbs,
  slug,
  tryReadJsonFile,
  writeJsonFile
} from "./pipeline/utils.js";
import type { ConstraintAdherenceSummary } from "./pipeline/constraint_checks.js";
import type { CanonicalProfilePaths } from "./pipeline/canon.js";

export const STEP_ORDER = [
  "KB0",
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
  "M",
  "N",
  "O",
  "P"
] as const;

export type StepName = (typeof STEP_ORDER)[number];

export type RunLevel = "pcp" | "student";
export type RunAdherenceMode = "strict" | "warn";
export type RunWorkflow = "legacy" | "v2_micro_detectives";
export type RunV2DeckLengthMain = 30 | 45 | 60;
export type RunV2AudienceLevel = "MED_SCHOOL_ADVANCED" | "RESIDENT" | "FELLOWSHIP";

export type RunSettings = {
  workflow?: RunWorkflow;
  durationMinutes?: number;
  targetSlides?: number;
  level?: RunLevel;
  deckLengthMain?: RunV2DeckLengthMain;
  audienceLevel?: RunV2AudienceLevel;
  adherenceMode?: RunAdherenceMode;
};

export type RunDerivedFrom = {
  runId: string;
  startFrom: StepName;
  createdAt: string;
};

export type RunGateState = {
  gateId: string;
  resumeFrom: StepName;
  message: string;
  at: string;
  awaiting: "review_submission" | "resume" | "changes_requested";
  submittedDecision?: "approve" | "request_changes" | "regenerate";
  submittedAt?: string;
  reviewArtifact?: string;
  resumedAt?: string;
};

export type StepRecord = {
  name: StepName;
  status: "queued" | "running" | "done" | "error";
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  artifacts: string[];
};

export type RunStatus = {
  runId: string;
  topic: string;
  settings?: RunSettings;
  derivedFrom?: RunDerivedFrom;
  activeGate?: RunGateState;
  canonicalSources?: CanonicalProfilePaths & { foundAny: boolean };
  constraintAdherence?: ConstraintAdherenceSummary;
  status: "queued" | "running" | "paused" | "done" | "error";
  startedAt: string;
  finishedAt?: string;
  traceId?: string;
  steps: Record<StepName, StepRecord>;
  outputFolder: string;
};

type RunInternal = RunStatus & {
  emitter: EventEmitter;
};

export type RunListItem = Pick<RunStatus, "runId" | "topic" | "status" | "startedAt" | "finishedAt">;

export type RunRetentionStats = {
  totalRuns: number;
  terminalRuns: number;
  activeRuns: number;
};

export type RunStorageRecord = {
  runId: string;
  topic: string;
  status: RunStatus["status"];
  startedAt: string;
  finishedAt?: string;
  ageHours: number;
  sizeBytes: number;
};

export type RunAgeBucket = "lt_24h" | "between_1d_7d" | "between_7d_30d" | "gte_30d";

export type RunRetentionAnalytics = {
  generatedAt: string;
  totalSizeBytes: number;
  terminalSizeBytes: number;
  activeSizeBytes: number;
  perRun: RunStorageRecord[];
  ageBuckets: Record<RunAgeBucket, { count: number; sizeBytes: number }>;
};

export type CleanupRunsResult = {
  keepLast: number;
  dryRun: boolean;
  scannedTerminalRuns: number;
  keptRunIds: string[];
  deletedRunIds: string[];
  reclaimedBytes: number;
  deletedRuns: RunStorageRecord[];
};

const RUN_ID_SLUG_MAX = 48;
const RUN_ID_SUFFIX_LEN = 8;
const RUN_ID_MAX_ATTEMPTS = 10;
const RUN_ID_SUFFIX_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomRunSuffix(length: number): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += RUN_ID_SUFFIX_ALPHABET[bytes[i] % RUN_ID_SUFFIX_ALPHABET.length];
  }
  return out;
}

function isTerminalRunStatus(status: RunStatus["status"]): boolean {
  return status === "done" || status === "error";
}

function recoverStaleLoadedRun(run: RunStatus): RunStatus {
  if (isTerminalRunStatus(run.status) || run.status === "paused") return run;
  const recoveredAt = nowIso();
  const recoveredSteps = { ...run.steps };

  for (const stepName of STEP_ORDER) {
    const step = recoveredSteps[stepName];
    if (!step) continue;
    if (step.status === "running" || step.status === "queued") {
      recoveredSteps[stepName] = {
        ...step,
        status: "error",
        error: step.error ?? "Recovered after server restart while run was active.",
        finishedAt: step.finishedAt ?? recoveredAt
      };
    }
  }

  return {
    ...run,
    status: "error",
    finishedAt: run.finishedAt ?? recoveredAt,
    steps: recoveredSteps
  };
}

export class RunManager {
  private runs = new Map<string, RunInternal>();

  retentionStats(): RunRetentionStats {
    const totalRuns = this.runs.size;
    const terminalRuns = [...this.runs.values()].filter((r) => r.status === "done" || r.status === "error").length;
    const activeRuns = totalRuns - terminalRuns;
    return { totalRuns, terminalRuns, activeRuns };
  }

  async retentionAnalytics(nowMs = Date.now()): Promise<RunRetentionAnalytics> {
    const ageBuckets: Record<RunAgeBucket, { count: number; sizeBytes: number }> = {
      lt_24h: { count: 0, sizeBytes: 0 },
      between_1d_7d: { count: 0, sizeBytes: 0 },
      between_7d_30d: { count: 0, sizeBytes: 0 },
      gte_30d: { count: 0, sizeBytes: 0 }
    };

    const perRun: RunStorageRecord[] = [];
    for (const run of this.runs.values()) {
      const startedMs = Date.parse(run.startedAt);
      const ageHours = Number.isFinite(startedMs) ? Math.max(0, (nowMs - startedMs) / (1000 * 60 * 60)) : 0;
      const sizeBytes = await this.dirSizeBytes(runOutputDirAbs(run.runId));
      const row: RunStorageRecord = {
        runId: run.runId,
        topic: run.topic,
        status: run.status,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        ageHours,
        sizeBytes
      };
      perRun.push(row);

      const bucket = this.ageBucket(ageHours);
      ageBuckets[bucket].count += 1;
      ageBuckets[bucket].sizeBytes += sizeBytes;
    }

    perRun.sort((a, b) => b.sizeBytes - a.sizeBytes);
    const totalSizeBytes = perRun.reduce((sum, row) => sum + row.sizeBytes, 0);
    const terminalSizeBytes = perRun
      .filter((row) => row.status === "done" || row.status === "error")
      .reduce((sum, row) => sum + row.sizeBytes, 0);

    return {
      generatedAt: nowIso(),
      totalSizeBytes,
      terminalSizeBytes,
      activeSizeBytes: Math.max(0, totalSizeBytes - terminalSizeBytes),
      perRun,
      ageBuckets
    };
  }

  async initFromDisk(): Promise<void> {
    await ensureDir(outputRootAbs());
    const entries = await fs.readdir(outputRootAbs(), { withFileTypes: true }).catch(() => []);
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const runId = ent.name;
      const runJsonPath = path.join(runOutputDirAbs(runId), "run.json");
      const data = await tryReadJsonFile<RunStatus>(runJsonPath);
      if (!data) continue;
      const recovered = recoverStaleLoadedRun(data);
      if (recovered !== data) {
        await writeJsonFile(runJsonPath, recovered).catch(() => undefined);
      }
      const emitter = new EventEmitter();
      // Node treats "error" events specially: if nobody is listening, it throws.
      // We always want errors to be an optional event stream, never a process crash.
      emitter.on("error", () => undefined);
      this.runs.set(runId, { ...recovered, emitter });
    }
  }

  listRuns(): RunListItem[] {
    return [...this.runs.values()]
      .map((r) => ({ runId: r.runId, topic: r.topic, status: r.status, startedAt: r.startedAt, finishedAt: r.finishedAt }))
      .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  }

  async cleanupTerminalRuns(keepLast: number, dryRun: boolean): Promise<CleanupRunsResult> {
    const keep = Math.max(0, Math.floor(keepLast));
    const terminalRuns = [...this.runs.values()]
      .filter((r) => r.status === "done" || r.status === "error")
      .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
    const kept = terminalRuns.slice(0, keep);
    const toDelete = terminalRuns.slice(keep);

    const nowMs = Date.now();
    const deletedRuns: RunStorageRecord[] = [];
    let reclaimedBytes = 0;

    for (const run of toDelete) {
      const startedMs = Date.parse(run.startedAt);
      const ageHours = Number.isFinite(startedMs) ? Math.max(0, (nowMs - startedMs) / (1000 * 60 * 60)) : 0;
      const sizeBytes = await this.dirSizeBytes(runOutputDirAbs(run.runId));
      reclaimedBytes += sizeBytes;
      deletedRuns.push({
        runId: run.runId,
        topic: run.topic,
        status: run.status,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        ageHours,
        sizeBytes
      });

      if (!dryRun) {
        await fs.rm(runOutputDirAbs(run.runId), { recursive: true, force: true }).catch(() => undefined);
        this.runs.delete(run.runId);
      }
    }

    return {
      keepLast: keep,
      dryRun,
      scannedTerminalRuns: terminalRuns.length,
      keptRunIds: kept.map((r) => r.runId),
      deletedRunIds: toDelete.map((r) => r.runId),
      reclaimedBytes,
      deletedRuns
    };
  }

  getRun(runId: string): RunStatus | null {
    const r = this.runs.get(runId);
    if (!r) return null;
    const { emitter: _emitter, ...pub } = r;
    return pub;
  }

  getInternal(runId: string): RunInternal | null {
    return this.runs.get(runId) ?? null;
  }

  private async runIdExists(runId: string): Promise<boolean> {
    if (this.runs.has(runId)) return true;
    const onDisk = await fs
      .stat(runOutputDirAbs(runId))
      .then((st) => st.isDirectory())
      .catch(() => false);
    return onDisk;
  }

  private async nextRunId(topic: string): Promise<string> {
    const topicSlug = (slug(topic).slice(0, RUN_ID_SLUG_MAX).replace(/^-+|-+$/g, "") || "untitled").toLowerCase();
    for (let attempt = 0; attempt < RUN_ID_MAX_ATTEMPTS; attempt++) {
      const runId = `${topicSlug}-${randomRunSuffix(RUN_ID_SUFFIX_LEN)}`;
      if (!(await this.runIdExists(runId))) return runId;
    }
    throw new Error("Unable to allocate unique runId after retries");
  }

  async createRun(topic: string, settings?: RunSettings, derivedFrom?: RunDerivedFrom): Promise<RunStatus> {
    const runId = await this.nextRunId(topic);
    const startedAt = nowIso();
    const outputFolder = path.join("output", runId);

    const steps = {} as Record<StepName, StepRecord>;
    for (const name of STEP_ORDER) {
      steps[name] = { name, status: "queued", artifacts: [] };
    }

    const emitter = new EventEmitter();
    emitter.on("error", () => undefined);

    const run: RunInternal = {
      runId,
      topic,
      settings,
      derivedFrom,
      status: "queued",
      startedAt,
      steps,
      outputFolder,
      emitter
    };

    await ensureDir(runOutputDirAbs(runId));
    await ensureDir(runIntermediateDirAbs(runId));
    await ensureDir(runFinalDirAbs(runId));
    await writeJsonFile(path.join(runOutputDirAbs(runId), "run.json"), this.snapshot(run));

    this.runs.set(runId, run);
    return this.snapshot(run);
  }

  async setRunStatus(runId: string, status: RunStatus["status"], patch?: Partial<RunStatus>): Promise<void> {
    const r = this.runs.get(runId);
    if (!r) return;
    r.status = status;
    if (status !== "paused") delete r.activeGate;
    if (patch?.finishedAt) r.finishedAt = patch.finishedAt;
    if (patch?.traceId) r.traceId = patch.traceId;
    if (patch?.settings) r.settings = patch.settings;
    if (patch?.derivedFrom) r.derivedFrom = patch.derivedFrom;
    if (patch?.activeGate) r.activeGate = patch.activeGate;
    if (patch?.canonicalSources) r.canonicalSources = patch.canonicalSources;
    if (patch?.constraintAdherence) r.constraintAdherence = patch.constraintAdherence;
    await this.persist(r);
  }

  async setCanonicalSources(runId: string, sources: CanonicalProfilePaths & { foundAny: boolean }): Promise<void> {
    const r = this.runs.get(runId);
    if (!r) return;
    r.canonicalSources = sources;
    await this.persist(r);
  }

  async setConstraintAdherence(runId: string, summary: ConstraintAdherenceSummary): Promise<void> {
    const r = this.runs.get(runId);
    if (!r) return;
    r.constraintAdherence = summary;
    await this.persist(r);
  }

  async setTraceId(runId: string, traceId: string): Promise<void> {
    const r = this.runs.get(runId);
    if (!r) return;
    r.traceId = traceId;
    await this.persist(r);
  }

  async startStep(runId: string, step: StepName): Promise<void> {
    const r = this.runs.get(runId);
    if (!r) return;
    const s = r.steps[step];
    s.status = "running";
    s.startedAt = nowIso();
    await this.persist(r);
    r.emitter.emit("step_started", { step, at: s.startedAt });
  }

  async finishStep(runId: string, step: StepName, ok: boolean, error?: string): Promise<void> {
    const r = this.runs.get(runId);
    if (!r) return;
    const s = r.steps[step];
    s.status = ok ? "done" : "error";
    s.finishedAt = nowIso();
    if (!ok && error) s.error = error;
    await this.persist(r);
    r.emitter.emit("step_finished", { step, at: s.finishedAt, ok });
    if (!ok && error) r.emitter.emit("error", { step, message: error, at: s.finishedAt });
  }

  async addArtifact(runId: string, step: StepName, name: string): Promise<void> {
    const r = this.runs.get(runId);
    if (!r) return;
    const s = r.steps[step];
    if (!s.artifacts.includes(name)) s.artifacts.push(name);
    await this.persist(r);
    r.emitter.emit("artifact_written", { step, name, at: nowIso() });
  }

  async setStepNoEvent(
    runId: string,
    step: StepName,
    patch: Partial<Pick<StepRecord, "status" | "startedAt" | "finishedAt" | "error" | "artifacts">>
  ): Promise<void> {
    const r = this.runs.get(runId);
    if (!r) return;
    const s = r.steps[step];
    if (patch.status) s.status = patch.status;
    if (patch.startedAt) s.startedAt = patch.startedAt;
    if (patch.finishedAt) s.finishedAt = patch.finishedAt;
    if (patch.error) s.error = patch.error;
    if (patch.artifacts) s.artifacts = [...patch.artifacts];
    await this.persist(r);
  }

  log(runId: string, message: string, step?: StepName): void {
    const r = this.runs.get(runId);
    if (!r) return;
    r.emitter.emit("log", { message, step, at: nowIso() });
  }

  error(runId: string, message: string, step?: StepName): void {
    const r = this.runs.get(runId);
    if (!r) return;
    r.emitter.emit("error", { message, step, at: nowIso() });
  }

  subscribe(runId: string, onEvent: (type: string, payload: unknown) => void): (() => void) | null {
    const r = this.runs.get(runId);
    if (!r) return null;

    const handler = (type: string) => (payload: unknown) => onEvent(type, payload);

    const evHandlers = {
      step_started: handler("step_started"),
      step_finished: handler("step_finished"),
      artifact_written: handler("artifact_written"),
      gate_required: handler("gate_required"),
      gate_submitted: handler("gate_submitted"),
      run_resumed: handler("run_resumed"),
      log: handler("log"),
      error: handler("error")
    };

    r.emitter.on("step_started", evHandlers.step_started);
    r.emitter.on("step_finished", evHandlers.step_finished);
    r.emitter.on("artifact_written", evHandlers.artifact_written);
    r.emitter.on("gate_required", evHandlers.gate_required);
    r.emitter.on("gate_submitted", evHandlers.gate_submitted);
    r.emitter.on("run_resumed", evHandlers.run_resumed);
    r.emitter.on("log", evHandlers.log);
    r.emitter.on("error", evHandlers.error);

    return () => {
      r.emitter.off("step_started", evHandlers.step_started);
      r.emitter.off("step_finished", evHandlers.step_finished);
      r.emitter.off("artifact_written", evHandlers.artifact_written);
      r.emitter.off("gate_required", evHandlers.gate_required);
      r.emitter.off("gate_submitted", evHandlers.gate_submitted);
      r.emitter.off("run_resumed", evHandlers.run_resumed);
      r.emitter.off("log", evHandlers.log);
      r.emitter.off("error", evHandlers.error);
    };
  }

  gateRequired(
    runId: string,
    payload: {
      gateId: string;
      resumeFrom: StepName;
      message: string;
      at: string;
      reviewArtifact?: string;
    }
  ): void {
    const r = this.runs.get(runId);
    if (!r) return;
    r.emitter.emit("gate_required", payload);
  }

  gateSubmitted(
    runId: string,
    payload: {
      gateId: string;
      status: "approve" | "request_changes" | "regenerate";
      submittedAt: string;
    }
  ): void {
    const r = this.runs.get(runId);
    if (!r) return;
    r.emitter.emit("gate_submitted", payload);
  }

  runResumed(
    runId: string,
    payload: {
      gateId: string;
      startFrom: StepName;
      mode: "resume" | "regenerate";
      resumedAt: string;
    }
  ): void {
    const r = this.runs.get(runId);
    if (!r) return;
    r.emitter.emit("run_resumed", payload);
  }

  private snapshot(run: RunInternal): RunStatus {
    const { emitter: _emitter, ...pub } = run;
    return pub;
  }

  private async persist(run: RunInternal): Promise<void> {
    await writeJsonFile(path.join(runOutputDirAbs(run.runId), "run.json"), this.snapshot(run));
  }

  private ageBucket(ageHours: number): RunAgeBucket {
    if (ageHours < 24) return "lt_24h";
    if (ageHours < 24 * 7) return "between_1d_7d";
    if (ageHours < 24 * 30) return "between_7d_30d";
    return "gte_30d";
  }

  private async dirSizeBytes(dir: string): Promise<number> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    let sum = 0;
    for (const ent of entries) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        sum += await this.dirSizeBytes(p);
        continue;
      }
      if (!ent.isFile()) continue;
      const st = await fs.stat(p).catch(() => null);
      if (st) sum += st.size;
    }
    return sum;
  }
}
