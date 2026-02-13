import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  defaultStepSloPolicy,
  loadStepSloPolicy,
  normalizeThresholdOverrides,
  saveStepSloPolicy,
  STEP_SLO_MAX_MS,
  STEP_SLO_MIN_MS,
  stepSloPolicyPathAbs
} from "../src/slo_policy.js";

let tmpOut: string | null = null;

beforeEach(async () => {
  tmpOut = await fs.mkdtemp(path.join(os.tmpdir(), "mms-slo-"));
  process.env.MMS_OUTPUT_DIR = tmpOut;
});

afterEach(async () => {
  delete process.env.MMS_OUTPUT_DIR;
  if (tmpOut) await fs.rm(tmpOut, { recursive: true, force: true }).catch(() => undefined);
  tmpOut = null;
});

describe("slo policy", () => {
  it("loads default policy when file is missing", async () => {
    const policy = await loadStepSloPolicy();
    expect(policy.thresholdsMs.A).toBeTypeOf("number");
    expect(policy.updatedAt).toBeTruthy();
  });

  it("saves and reloads policy", async () => {
    const base = defaultStepSloPolicy();
    base.thresholdsMs.A = 111_000;
    await saveStepSloPolicy(base);

    const loaded = await loadStepSloPolicy();
    expect(loaded.thresholdsMs.A).toBe(111_000);
  });

  it("falls back to defaults on invalid stored schema", async () => {
    await fs.mkdir(path.dirname(stepSloPolicyPathAbs()), { recursive: true });
    await fs.writeFile(stepSloPolicyPathAbs(), JSON.stringify({ thresholdsMs: { A: "not-number" } }), "utf8");

    const loaded = await loadStepSloPolicy();
    expect(loaded.thresholdsMs.A).toBe(defaultStepSloPolicy().thresholdsMs.A);
  });

  it("normalizes threshold overrides with clamping and finite checks", () => {
    const base = defaultStepSloPolicy().thresholdsMs;
    const next = normalizeThresholdOverrides(
      {
        A: STEP_SLO_MIN_MS - 1000,
        B: STEP_SLO_MAX_MS + 1000,
        C: 12345.6,
        D: Number.NaN
      },
      base
    );

    expect(next.A).toBe(STEP_SLO_MIN_MS);
    expect(next.B).toBe(STEP_SLO_MAX_MS);
    expect(next.C).toBe(12346);
    expect(next.D).toBe(base.D);
  });
});
