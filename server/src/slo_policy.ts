import path from "node:path";
import { z } from "zod";
import { STEP_ORDER, type StepName } from "./run_manager.js";
import { ensureDir, nowIso, outputRootAbs, tryReadJsonFile, writeJsonFile } from "./pipeline/utils.js";

export const DEFAULT_STEP_SLO_THRESHOLDS_MS: Record<StepName, number> = {
  KB0: 180_000,
  A: 90_000,
  B: 240_000,
  C: 120_000,
  D: 120_000,
  E: 120_000,
  F: 120_000,
  G: 150_000,
  H: 180_000,
  I: 150_000,
  J: 90_000,
  K: 90_000,
  L: 180_000,
  M: 120_000,
  N: 120_000,
  O: 90_000,
  P: 90_000
};

export const STEP_SLO_MIN_MS = 5_000;
export const STEP_SLO_MAX_MS = 30 * 60 * 1000;

const StepNameSchema = z.enum(STEP_ORDER);

const SloPolicySchema = z
  .object({
    thresholdsMs: z.record(StepNameSchema, z.number().int().min(STEP_SLO_MIN_MS).max(STEP_SLO_MAX_MS)),
    updatedAt: z.string().datetime().optional()
  })
  .strict();

export type StepSloPolicy = {
  thresholdsMs: Record<StepName, number>;
  updatedAt: string;
};

export function stepSloPolicyPathAbs(): string {
  return path.join(outputRootAbs(), "slo_policy.json");
}

export function defaultStepSloPolicy(): StepSloPolicy {
  return {
    thresholdsMs: { ...DEFAULT_STEP_SLO_THRESHOLDS_MS },
    updatedAt: nowIso()
  };
}

export async function loadStepSloPolicy(): Promise<StepSloPolicy> {
  await ensureDir(outputRootAbs());
  const raw = await tryReadJsonFile<unknown>(stepSloPolicyPathAbs());
  if (!raw) return defaultStepSloPolicy();

  const parsed = SloPolicySchema.safeParse(raw);
  if (!parsed.success) return defaultStepSloPolicy();

  return {
    thresholdsMs: { ...DEFAULT_STEP_SLO_THRESHOLDS_MS, ...parsed.data.thresholdsMs },
    updatedAt: parsed.data.updatedAt ?? nowIso()
  };
}

export async function saveStepSloPolicy(policy: StepSloPolicy): Promise<void> {
  await ensureDir(outputRootAbs());
  await writeJsonFile(stepSloPolicyPathAbs(), policy);
}

export function normalizeThresholdOverrides(
  overrides: Partial<Record<StepName, number>>,
  base: Record<StepName, number>
): Record<StepName, number> {
  const next: Record<StepName, number> = { ...base };
  for (const step of STEP_ORDER) {
    const value = overrides[step];
    if (value === undefined) continue;
    if (!Number.isFinite(value)) continue;
    const rounded = Math.round(value);
    next[step] = Math.min(STEP_SLO_MAX_MS, Math.max(STEP_SLO_MIN_MS, rounded));
  }
  return next;
}
