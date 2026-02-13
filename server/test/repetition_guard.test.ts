import { describe, expect, it } from "vitest";
import { buildStoryFingerprint, closestFingerprint, cosineSimilarity } from "../src/pipeline/repetition_guard.js";

describe("pipeline/repetition_guard", () => {
  it("buildStoryFingerprint joins the key narrative fields", () => {
    const fp = buildStoryFingerprint("A detective doctor hunts a clue", "ED night shift", ["Dr. Nova"], "patient declines");
    expect(fp).toContain("detective");
    expect(fp).toContain("ED night shift");
    expect(fp).toContain("Dr. Nova");
  });

  it("cosineSimilarity is higher for semantically closer text", () => {
    const near = cosineSimilarity("doctor solves chest pain mystery in emergency department", "emergency doctor investigates chest pain mystery");
    const far = cosineSimilarity("doctor solves chest pain mystery in emergency department", "astronaut repairs a satellite in deep space");
    expect(near).toBeGreaterThan(far);
    expect(near).toBeGreaterThan(0.3);
  });

  it("cosineSimilarity returns 0 when either side has no informative tokens", () => {
    expect(cosineSimilarity("the and of", "doctor investigates case")).toBe(0);
    expect(cosineSimilarity("doctor investigates case", "the and of")).toBe(0);
  });

  it("closestFingerprint returns the most similar prior story", () => {
    const best = closestFingerprint("doctor investigates sepsis during a night shift", [
      { runId: "r1", fingerprint: "courtroom drama with insurance fraud" },
      { runId: "r2", fingerprint: "night shift doctor investigates sepsis deterioration" },
      { runId: "r3", fingerprint: "astronauts repairing engines in orbit" }
    ]);
    expect(best?.runId).toBe("r2");
    expect((best?.score ?? 0) > 0).toBe(true);
  });

  it("closestFingerprint returns null for empty history", () => {
    expect(closestFingerprint("abc", [])).toBeNull();
  });
});
