import express from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import archiver from "archiver";
import { z } from "zod";
import type { RunExecutor } from "./executor.js";
import type { RunManager, RunSettings, StepName } from "./run_manager.js";
import { STEP_ORDER } from "./run_manager.js";
import {
  artifactAbsPath,
  isSafeArtifactName,
  nowIso,
  resolveArtifactPathAbs,
  runFinalDirAbs,
  runIntermediateDirAbs,
  runOutputDirAbs,
  writeJsonFile
} from "./pipeline/utils.js";
import { resolveCanonicalProfilePaths } from "./pipeline/canon.js";
import { episodeMemoryPath } from "./pipeline/memory.js";
import { gateOwningStep, humanReviewFileName, latestGateDecision, readHumanReviewStore } from "./pipeline/v2_micro_detectives/reviews.js";
import { HumanReviewEntrySchema, HumanReviewRequestedChangeSchema, HumanReviewDecisionSchema, V2GateIdSchema } from "./pipeline/v2_micro_detectives/schemas.js";
import {
  defaultStepSloPolicy,
  loadStepSloPolicy,
  normalizeThresholdOverrides,
  saveStepSloPolicy,
  STEP_SLO_MAX_MS,
  STEP_SLO_MIN_MS,
  type StepSloPolicy
} from "./slo_policy.js";

type EnvConfig = {
  hasKey: boolean;
  hasVectorStoreId: boolean;
  hasCanonicalProfileFiles: boolean;
  canonicalTemplateRoot?: string;
  episodeMemoryPath: string;
};

type ArtifactFolder = "root" | "intermediate" | "final";
type StepSloStatus = "n/a" | "ok" | "warn";

const RETENTION_KEEP_LAST_DEFAULT = 50;
const RETENTION_KEEP_LAST_MIN = 0;
const RETENTION_KEEP_LAST_MAX = 1000;
const LEGACY_WORKFLOW = "legacy" as const;
const V2_WORKFLOW = "v2_micro_detectives" as const;

function envConfig(): EnvConfig {
  const hasKey = Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim().length > 0);
  const hasVectorStoreId = Boolean(process.env.KB_VECTOR_STORE_ID && process.env.KB_VECTOR_STORE_ID.trim().length > 0);
  const canonical = resolveCanonicalProfilePaths();
  const hasCanonicalProfileFiles = [canonical.characterBiblePath, canonical.seriesStyleBiblePath, canonical.deckSpecPath]
    .filter((p): p is string => Boolean(p))
    .some((p) => existsSync(p));

  return {
    hasKey,
    hasVectorStoreId,
    hasCanonicalProfileFiles,
    canonicalTemplateRoot: canonical.templateRoot,
    episodeMemoryPath: episodeMemoryPath()
  };
}

const RunSettingsSchema = z
  .object({
    workflow: z.enum([LEGACY_WORKFLOW, V2_WORKFLOW]).optional(),
    durationMinutes: z.number().int().min(5).max(240).optional(),
    // For legacy this remains min=100/max=500. For v2 this field is optional/ignored.
    targetSlides: z.number().int().optional(),
    level: z.enum(["pcp", "student"]).optional(),
    deckLengthMain: z
      .preprocess(
        (value) => (typeof value === "string" && value.trim().length > 0 ? Number(value) : value),
        z.union([z.literal(30), z.literal(45), z.literal(60)])
      )
      .optional(),
    audienceLevel: z.enum(["MED_SCHOOL_ADVANCED", "RESIDENT", "FELLOWSHIP"]).optional(),
    adherenceMode: z.enum(["strict", "warn"]).optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    const workflow = value.workflow ?? LEGACY_WORKFLOW;
    if (workflow === V2_WORKFLOW) {
      if (typeof value.deckLengthMain !== "number") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["deckLengthMain"],
          message: "deckLengthMain is required when workflow=v2_micro_detectives."
        });
      }
      if (typeof value.audienceLevel !== "string") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["audienceLevel"],
          message: "audienceLevel is required when workflow=v2_micro_detectives."
        });
      }
      return;
    }

    // Legacy validation branch.
    if (typeof value.targetSlides === "number" && (value.targetSlides < 100 || value.targetSlides > 500)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetSlides"],
        message: "targetSlides must be between 100 and 500 for legacy workflow."
      });
    }
    if (typeof value.deckLengthMain === "number") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["deckLengthMain"],
        message: "deckLengthMain is only valid for workflow=v2_micro_detectives."
      });
    }
    if (typeof value.audienceLevel === "string") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["audienceLevel"],
        message: "audienceLevel is only valid for workflow=v2_micro_detectives."
      });
    }
  });

const CreateRunBodySchema = z
  .object({
    topic: z.string().trim().min(3).max(500),
    settings: RunSettingsSchema.optional()
  })
  .strict();

const AllowedRerunStartFromSchema = z.enum([
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
]);

const RerunBodySchema = z
  .object({
    startFrom: AllowedRerunStartFromSchema
  })
  .strict();

const CleanupRunsBodySchema = z
  .object({
    keepLast: z.number().int().min(RETENTION_KEEP_LAST_MIN).max(RETENTION_KEEP_LAST_MAX).optional(),
    dryRun: z.boolean().optional()
  })
  .strict();

const StepThresholdOverridesShape = Object.fromEntries(
  STEP_ORDER.map((step) => [step, z.number().int().min(STEP_SLO_MIN_MS).max(STEP_SLO_MAX_MS)])
) as Record<StepName, z.ZodNumber>;

const StepThresholdOverridesSchema = z.object(StepThresholdOverridesShape).partial().strict();

const UpdateSloPolicyBodySchema = z
  .object({
    reset: z.boolean().optional(),
    thresholdsMs: StepThresholdOverridesSchema.optional()
  })
  .strict();

const GateReviewBodySchema = z
  .object({
    status: HumanReviewDecisionSchema,
    notes: z.string().max(10000).optional(),
    requested_changes: z.array(HumanReviewRequestedChangeSchema).optional()
  })
  .strict();

function normalizeSettings(settings: RunSettings | undefined): RunSettings | undefined {
  if (!settings) return undefined;
  const workflow = settings.workflow ?? LEGACY_WORKFLOW;
  const s: RunSettings = {};
  s.workflow = workflow;
  if (typeof settings.durationMinutes === "number") s.durationMinutes = settings.durationMinutes;
  if (workflow === V2_WORKFLOW) {
    if (typeof settings.deckLengthMain === "number") s.deckLengthMain = settings.deckLengthMain;
    if (settings.audienceLevel) s.audienceLevel = settings.audienceLevel;
  } else {
    if (typeof settings.targetSlides === "number") s.targetSlides = settings.targetSlides;
    if (settings.level) s.level = settings.level;
  }
  if (settings.adherenceMode) s.adherenceMode = settings.adherenceMode;
  if (Object.keys(s).length === 1 && s.workflow === LEGACY_WORKFLOW) return undefined;
  return s;
}

function parseIsoMs(iso?: string): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function retentionKeepLastDefault(): number {
  const raw = Number(process.env.MMS_RUN_RETENTION_KEEP_LAST ?? RETENTION_KEEP_LAST_DEFAULT);
  if (!Number.isFinite(raw)) return RETENTION_KEEP_LAST_DEFAULT;
  return Math.min(RETENTION_KEEP_LAST_MAX, Math.max(RETENTION_KEEP_LAST_MIN, Math.round(raw)));
}

function attachStepSlo<T extends { status: string; steps: Record<string, { status: string; startedAt?: string; finishedAt?: string }> }>(
  run: T,
  thresholdsMs: Record<StepName, number>
): T & {
  stepSlo: {
    warningSteps: string[];
    thresholdsMs: Record<string, number>;
    evaluations: Record<string, { status: StepSloStatus; thresholdMs: number; elapsedMs: number | null }>;
  };
} {
  const now = Date.now();
  const evaluations: Record<string, { status: StepSloStatus; thresholdMs: number; elapsedMs: number | null }> = {};
  const warningSteps: string[] = [];

  for (const step of STEP_ORDER) {
    const thresholdMs = thresholdsMs[step];
    const record = run.steps[step];
    const startedMs = parseIsoMs(record?.startedAt);
    const finishedMs = parseIsoMs(record?.finishedAt);

    if (!record || record.status === "queued" || startedMs === null) {
      evaluations[step] = { status: "n/a", thresholdMs, elapsedMs: null };
      continue;
    }

    const endMs = finishedMs ?? now;
    const elapsedMs = Math.max(0, endMs - startedMs);
    const status: StepSloStatus = elapsedMs > thresholdMs ? "warn" : "ok";
    if (status === "warn") warningSteps.push(step);
    evaluations[step] = { status, thresholdMs, elapsedMs };
  }

  return {
    ...run,
    stepSlo: {
      warningSteps,
      thresholdsMs,
      evaluations
    }
  };
}

export type AppOptions = {
  /**
   * If set (and contains an `index.html`), serve the built Vite app from this folder.
   * This enables a single-process "pilot" mode.
   */
  webDistDir?: string;
};

export function createApp(runs: RunManager, executor: RunExecutor, options: AppOptions = {}) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "2mb" }));
  let sloPolicy: StepSloPolicy | null = null;

  async function ensureSloPolicy(): Promise<StepSloPolicy> {
    if (sloPolicy) return sloPolicy;
    sloPolicy = await loadStepSloPolicy();
    return sloPolicy;
  }

  async function policyEnvelope(): Promise<{
    policy: StepSloPolicy;
    bounds: { minMs: number; maxMs: number };
    defaults: Record<StepName, number>;
  }> {
    const policy = await ensureSloPolicy();
    const defaults = defaultStepSloPolicy().thresholdsMs;
    return {
      policy,
      bounds: { minMs: STEP_SLO_MIN_MS, maxMs: STEP_SLO_MAX_MS },
      defaults
    };
  }

  app.get("/api/health", (_req, res) => {
    const env = envConfig();
    res.json({
      ok: true,
      hasKey: env.hasKey,
      hasVectorStoreId: env.hasVectorStoreId,
      hasCanonicalProfileFiles: env.hasCanonicalProfileFiles,
      canonicalTemplateRoot: env.canonicalTemplateRoot,
      episodeMemoryPath: env.episodeMemoryPath
    });
  });

  app.post("/api/runs", async (req, res) => {
    const parsed = CreateRunBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const settings = normalizeSettings(parsed.data.settings);
    const run = await runs.createRun(parsed.data.topic, settings);
    res.json({ runId: run.runId });

    executor.enqueue(run.runId);
  });

  app.get("/api/runs", (_req, res) => {
    res.json(runs.listRuns());
  });

  app.get("/api/runs/retention", async (_req, res) => {
    const keepLast = retentionKeepLastDefault();
    const analytics = await runs.retentionAnalytics();
    res.json({
      policy: { keepLastTerminalRuns: keepLast },
      stats: runs.retentionStats(),
      analytics
    });
  });

  app.post("/api/runs/cleanup", async (req, res) => {
    const parsed = CleanupRunsBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const keepLast = parsed.data.keepLast ?? retentionKeepLastDefault();
    const dryRun = parsed.data.dryRun ?? false;
    const result = await runs.cleanupTerminalRuns(keepLast, dryRun);
    const analytics = await runs.retentionAnalytics();
    res.json({ ...result, stats: runs.retentionStats(), analytics });
  });

  app.get("/api/slo-policy", async (_req, res) => {
    res.json(await policyEnvelope());
  });

  app.put("/api/slo-policy", async (req, res) => {
    const parsed = UpdateSloPolicyBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const base = parsed.data.reset ? defaultStepSloPolicy() : await ensureSloPolicy();
    const thresholdsMs = normalizeThresholdOverrides(parsed.data.thresholdsMs ?? {}, base.thresholdsMs);
    const next: StepSloPolicy = {
      thresholdsMs,
      updatedAt: nowIso()
    };
    await saveStepSloPolicy(next);
    sloPolicy = next;
    res.json(await policyEnvelope());
  });

  app.get("/api/runs/:runId", async (req, res) => {
    const run = runs.getRun(req.params.runId);
    if (!run) {
      res.status(404).json({ error: "run not found" });
      return;
    }
    const policy = await ensureSloPolicy();
    res.json(attachStepSlo(run, policy.thresholdsMs));
  });

  app.post("/api/runs/:runId/cancel", (req, res) => {
    const run = runs.getRun(req.params.runId);
    if (!run) {
      res.status(404).json({ error: "run not found" });
      return;
    }

    const ok = executor.cancel(run.runId);
    if (!ok) {
      res.status(409).json({ error: "run not cancellable" });
      return;
    }

    res.json({ ok: true });
  });

  app.get("/api/runs/:runId/gates/history", async (req, res) => {
    const runId = req.params.runId;
    const run = runs.getRun(runId);
    if (!run) {
      res.status(404).json({ error: "run not found" });
      return;
    }

    const store = await readHumanReviewStore(runId);
    res.json({
      schema_version: store.schema_version,
      latest_by_gate: store.latest_by_gate,
      history: store.history
    });
  });

  app.post("/api/runs/:runId/gates/:gateId/submit", async (req, res) => {
    const runId = req.params.runId;
    const run = runs.getRun(runId);
    if (!run) {
      res.status(404).json({ error: "run not found" });
      return;
    }

    const gateParsed = V2GateIdSchema.safeParse(req.params.gateId);
    if (!gateParsed.success) {
      res.status(400).json({ error: gateParsed.error.flatten() });
      return;
    }

    const bodyParsed = GateReviewBodySchema.safeParse(req.body ?? {});
    if (!bodyParsed.success) {
      res.status(400).json({ error: bodyParsed.error.flatten() });
      return;
    }

    const gateId = gateParsed.data;
    const entry = HumanReviewEntrySchema.parse({
      schema_version: "1.0.0",
      gate_id: gateId,
      status: bodyParsed.data.status,
      notes: bodyParsed.data.notes ?? "",
      requested_changes: bodyParsed.data.requested_changes ?? [],
      submitted_at: nowIso()
    });

    const reviewStore = await readHumanReviewStore(runId);
    const nextStore = {
      schema_version: reviewStore.schema_version || "1.0.0",
      latest_by_gate: {
        ...reviewStore.latest_by_gate,
        [gateId]: entry
      },
      history: [...reviewStore.history, entry]
    };
    await writeJsonFile(path.join(runIntermediateDirAbs(runId), humanReviewFileName()), nextStore);
    await runs.addArtifact(runId, gateOwningStep(gateId), humanReviewFileName());
    runs.log(runId, `Gate review submitted: ${gateId} => ${entry.status}`, gateOwningStep(gateId));
    runs.gateSubmitted(runId, {
      gateId,
      status: entry.status,
      submittedAt: entry.submitted_at
    });

    if (run.status === "paused" && run.activeGate?.gateId === gateId) {
      const awaiting = entry.status === "request_changes" ? "changes_requested" : "resume";
      await runs.setRunStatus(runId, "paused", {
        activeGate: {
          ...run.activeGate,
          awaiting,
          submittedDecision: entry.status,
          submittedAt: entry.submitted_at,
          reviewArtifact: path.join("output", runId, "intermediate", humanReviewFileName())
        }
      });
    }

    const recommendedAction = entry.status === "approve" ? "resume" : entry.status === "regenerate" ? "resume_regenerate" : "wait_for_changes";
    const suggestedResumeFrom = entry.status === "regenerate" ? gateOwningStep(gateId) : run.activeGate?.resumeFrom;

    res.json({
      ok: true,
      gateId,
      review: entry,
      latest: nextStore.latest_by_gate[gateId],
      recommendedAction,
      suggestedResumeFrom
    });
  });

  app.post("/api/runs/:runId/resume", async (req, res) => {
    const runId = req.params.runId;
    const run = runs.getRun(runId);
    if (!run) {
      res.status(404).json({ error: "run not found" });
      return;
    }

    if (executor.isRunning(runId)) {
      res.status(409).json({ error: "run is currently running" });
      return;
    }

    if (run.status !== "paused" || !run.activeGate) {
      res.status(409).json({ error: "run is not paused at a gate" });
      return;
    }

    const gateIdParsed = V2GateIdSchema.safeParse(run.activeGate.gateId);
    if (!gateIdParsed.success) {
      res.status(409).json({ error: `invalid paused gate id: ${run.activeGate.gateId}` });
      return;
    }
    const gateId = gateIdParsed.data;
    const reviewStore = await readHumanReviewStore(runId);
    const latest = latestGateDecision(reviewStore, gateId);
    if (!latest) {
      res.status(409).json({ error: `gate ${gateId} has no submitted review` });
      return;
    }

    if (latest.status === "request_changes") {
      res.status(409).json({ error: `gate ${gateId} is in request_changes. Submit approve or regenerate before resume.` });
      return;
    }

    const resumeFrom = latest.status === "regenerate" ? gateOwningStep(gateId) : run.activeGate.resumeFrom;
    const gateState = run.activeGate;
    await runs.setRunStatus(runId, "queued");
    const queued = executor.enqueue(runId, { startFrom: resumeFrom });
    if (!queued) {
      await runs.setRunStatus(runId, "paused", { activeGate: gateState });
      res.status(409).json({ error: "run could not be resumed" });
      return;
    }

    const resumeMode = latest.status === "regenerate" ? "regenerate" : "resume";
    runs.runResumed(runId, {
      gateId,
      startFrom: resumeFrom,
      mode: resumeMode,
      resumedAt: nowIso()
    });
    runs.log(runId, `Resumed from ${gateId} at ${resumeFrom} (mode=${resumeMode})`);
    res.json({ ok: true, runId, startFrom: resumeFrom, resumeMode });
  });

  app.post("/api/runs/:runId/rerun", async (req, res) => {
    const parentRunId = req.params.runId;
    const parent = runs.getRun(parentRunId);
    if (!parent) {
      res.status(404).json({ error: "run not found" });
      return;
    }

    if (executor.isRunning(parentRunId)) {
      res.status(409).json({ error: "run is currently running; cancel it first" });
      return;
    }

    const parsed = RerunBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const startFrom = parsed.data.startFrom as StepName;
    const startIdx = STEP_ORDER.indexOf(startFrom);

    for (const step of STEP_ORDER.slice(0, startIdx)) {
      const s = parent.steps[step];
      if (!s || s.status !== "done") {
        res.status(400).json({ error: `cannot reuse step ${step} from parent run (not done)` });
        return;
      }
    }

    const derivedFrom = { runId: parentRunId, startFrom, createdAt: nowIso() };
    const child = await runs.createRun(parent.topic, parent.settings, derivedFrom);

    // Copy artifacts for steps strictly before startFrom.
    for (const step of STEP_ORDER.slice(0, startIdx)) {
      const files = parent.steps[step]?.artifacts ?? [];
      const copied: string[] = [];
      for (const name of files) {
        if (!isSafeArtifactName(name)) continue;
        const src = await resolveArtifactPathAbs(parentRunId, name);
        const dst = artifactAbsPath(child.runId, name);
        try {
          if (!src) throw new Error("missing source");
          await fs.copyFile(src, dst);
          copied.push(name);
        } catch {
          if (startFrom === "P") {
            // Legacy compatibility: very old runs can have stale artifact metadata
            // (listed names no longer present on disk). For startFrom=P, we tolerate
            // these misses and still enforce the required patched spec explicitly below.
            continue;
          }
          res.status(400).json({ error: `missing artifact in parent run: ${name}` });
          return;
        }
      }

      // Legacy compatibility: parent run metadata may not list required artifacts.
      // For `startFrom=P`, ensure the patched spec exists so master-doc assembly can succeed.
      if (startFrom === "P" && step === "N") {
        const required = "final_slide_spec_patched.json";
        if (!copied.includes(required)) {
          const src = await resolveArtifactPathAbs(parentRunId, required);
          if (!src) {
            res.status(400).json({ error: `missing required artifact in parent run for startFrom=P: ${required}` });
            return;
          }
          try {
            await fs.copyFile(src, artifactAbsPath(child.runId, required));
            copied.push(required);
          } catch {
            res.status(400).json({ error: `failed to copy required artifact for startFrom=P: ${required}` });
            return;
          }
        }
      }

      await runs.setStepNoEvent(child.runId, step, {
        status: "done",
        startedAt: parent.steps[step].startedAt ?? nowIso(),
        finishedAt: parent.steps[step].finishedAt ?? nowIso(),
        artifacts: copied
      });
    }

    res.json({ runId: child.runId });
    executor.enqueue(child.runId, { startFrom });
  });

  app.get("/api/runs/:runId/events", (req, res) => {
    const runId = req.params.runId;
    const run = runs.getInternal(runId);
    if (!run) {
      res.status(404).end();
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const send = (type: string, payload: unknown) => {
      res.write(`event: ${type}\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    const unsubscribe = runs.subscribe(runId, send);
    send("log", { message: "SSE connected" });

    const ping = setInterval(() => {
      res.write("event: ping\n");
      res.write("data: {}\n\n");
    }, 15000);

    req.on("close", () => {
      clearInterval(ping);
      unsubscribe?.();
      res.end();
    });
  });

  app.get("/api/runs/:runId/export", (req, res) => {
    const runId = req.params.runId;
    const run = runs.getRun(runId);
    if (!run) {
      res.status(404).json({ error: "run not found" });
      return;
    }

    const dir = runOutputDirAbs(runId);

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="run-${runId}.zip"`);

    const archive = archiver("zip", { zlib: { level: 9 } });

    archive.on("warning", (err) => {
      runs.log(runId, `zip warning: ${err.message}`);
    });

    archive.on("error", (err) => {
      runs.error(runId, `zip error: ${err.message}`);
      res.status(500).end();
    });

    archive.pipe(res);
    archive.directory(dir, false);
    void archive.finalize();
  });

  app.get("/api/runs/:runId/artifacts", async (req, res) => {
    const runId = req.params.runId;
    const run = runs.getRun(runId);
    if (!run) {
      res.status(404).json({ error: "run not found" });
      return;
    }

    const scanDirs: Array<{ dir: string; folder: ArtifactFolder }> = [
      { dir: runOutputDirAbs(runId), folder: "root" },
      { dir: runIntermediateDirAbs(runId), folder: "intermediate" },
      { dir: runFinalDirAbs(runId), folder: "final" }
    ];
    const byName = new Map<string, { name: string; size: number; mtimeMs: number; folder: ArtifactFolder }>();

    for (const scan of scanDirs) {
      const entries = await fs.readdir(scan.dir, { withFileTypes: true }).catch(() => []);
      for (const ent of entries) {
        if (!ent.isFile()) continue;
        const p = path.join(scan.dir, ent.name);
        const st = await fs.stat(p).catch(() => null);
        if (!st) continue;

        const next = { name: ent.name, size: st.size, mtimeMs: st.mtimeMs, folder: scan.folder };
        const prev = byName.get(ent.name);
        if (!prev || next.mtimeMs >= prev.mtimeMs) byName.set(ent.name, next);
      }
    }

    const infos = [...byName.values()].sort((a, b) => b.mtimeMs - a.mtimeMs);
    res.json(infos);
  });

  app.get("/api/runs/:runId/artifacts/:name", async (req, res) => {
    const runId = req.params.runId;
    const name = req.params.name;

    if (!isSafeArtifactName(name)) {
      res.status(400).send("invalid artifact name");
      return;
    }

    const run = runs.getRun(runId);
    if (!run) {
      res.status(404).send("run not found");
      return;
    }

    const filePath = await resolveArtifactPathAbs(runId, name);
    if (!filePath) {
      res.status(404).send("artifact not found");
      return;
    }

    try {
      const data = await fs.readFile(filePath);
      const lower = name.toLowerCase();
      if (lower.endsWith(".json")) res.setHeader("Content-Type", "application/json; charset=utf-8");
      else if (lower.endsWith(".md")) res.setHeader("Content-Type", "text/markdown; charset=utf-8");
      else res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.send(data);
    } catch {
      res.status(404).send("artifact not found");
    }
  });

  // ------------------------------------------------------------
  // Optional: serve built web UI (web/dist) for a one-process pilot mode.
  // ------------------------------------------------------------
  const webDistDir = options.webDistDir ?? process.env.MMS_WEB_DIST_DIR ?? path.resolve(process.cwd(), "../web/dist");
  const webIndex = path.join(webDistDir, "index.html");
  if (existsSync(webIndex)) {
    // Serve static assets (e.g. /assets/*) and fall back to index.html for SPA routes.
    app.use(express.static(webDistDir));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api")) return next();
      res.sendFile(webIndex);
    });
  }

  return app;
}
