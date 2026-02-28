import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  appendHumanReview,
  emptyHumanReviewStore,
  gateOwningStep,
  gateRequirementArtifactName,
  humanReviewFileName,
  latestGateDecision,
  readHumanReviewStore
} from "../src/pipeline/v2_micro_detectives/reviews.js";

let tmpOut: string | null = null;

beforeEach(async () => {
  tmpOut = await fs.mkdtemp(path.join(os.tmpdir(), "mms-v2-reviews-"));
  process.env.MMS_OUTPUT_DIR = tmpOut;
});

afterEach(async () => {
  if (tmpOut) await fs.rm(tmpOut, { recursive: true, force: true }).catch(() => undefined);
  tmpOut = null;
  delete process.env.MMS_OUTPUT_DIR;
});

describe("v2 review store helpers", () => {
  it("returns empty store when no review file exists", async () => {
    const store = await readHumanReviewStore("run-x");
    expect(store).toEqual(emptyHumanReviewStore());
  });

  it("appends reviews and tracks latest decision by gate", async () => {
    const runId = "run-y";
    const s1 = await appendHumanReview(runId, {
      schema_version: "1.0.0",
      gate_id: "GATE_1_PITCH",
      status: "request_changes",
      notes: "add more tension",
      requested_changes: [],
      submitted_at: "2026-02-23T00:00:00.000Z"
    });
    expect(s1.history).toHaveLength(1);
    expect(latestGateDecision(s1, "GATE_1_PITCH")?.status).toBe("request_changes");

    const s2 = await appendHumanReview(runId, {
      schema_version: "1.0.0",
      gate_id: "GATE_1_PITCH",
      status: "approve",
      notes: "looks good",
      requested_changes: [],
      submitted_at: "2026-02-23T00:05:00.000Z"
    });
    expect(s2.history).toHaveLength(2);
    expect(latestGateDecision(s2, "GATE_1_PITCH")?.status).toBe("approve");
  });

  it("maps gate ids to artifact names and owning steps", () => {
    expect(gateRequirementArtifactName("GATE_1_PITCH")).toBe("GATE_1_PITCH_REQUIRED.json");
    expect(gateRequirementArtifactName("GATE_2_TRUTH_LOCK")).toBe("GATE_2_TRUTH_LOCK_REQUIRED.json");
    expect(gateRequirementArtifactName("GATE_3_STORYBOARD")).toBe("GATE_3_STORYBOARD_REQUIRED.json");
    expect(gateRequirementArtifactName("GATE_4_FINAL")).toBe("GATE_4_FINAL_REQUIRED.json");
    expect(gateOwningStep("GATE_1_PITCH")).toBe("A");
    expect(gateOwningStep("GATE_2_TRUTH_LOCK")).toBe("B");
    expect(gateOwningStep("GATE_3_STORYBOARD")).toBe("C");
    expect(humanReviewFileName()).toBe("human_review.json");
  });
});
