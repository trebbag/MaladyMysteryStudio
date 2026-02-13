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
  runOutputDirAbs
} from "./pipeline/utils.js";
import { resolveCanonicalProfilePaths } from "./pipeline/canon.js";
import { episodeMemoryPath } from "./pipeline/memory.js";
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
    durationMinutes: z.number().int().min(5).max(240).optional(),
    targetSlides: z.number().int().min(5).max(200).optional(),
    level: z.enum(["pcp", "student"]).optional(),
    adherenceMode: z.enum(["strict", "warn"]).optional()
  })
  .strict();

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
  "O"
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

function normalizeSettings(settings: RunSettings | undefined): RunSettings | undefined {
  if (!settings) return undefined;
  const s: RunSettings = {};
  if (typeof settings.durationMinutes === "number") s.durationMinutes = settings.durationMinutes;
  if (typeof settings.targetSlides === "number") s.targetSlides = settings.targetSlides;
  if (settings.level) s.level = settings.level;
  if (settings.adherenceMode) s.adherenceMode = settings.adherenceMode;
  return Object.keys(s).length > 0 ? s : undefined;
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
          res.status(400).json({ error: `missing artifact in parent run: ${name}` });
          return;
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
