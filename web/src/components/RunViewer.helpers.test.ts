import { describe, expect, it, vi } from "vitest";
import { __runViewerTestables } from "./RunViewer";

describe("RunViewer helpers", () => {
  it("parses JSON and wraps parse failures", () => {
    expect(__runViewerTestables.parseJsonOrThrow("{\"ok\":true}")).toEqual({ ok: true });

    const parseSpy = vi.spyOn(JSON, "parse").mockImplementationOnce(() => {
      throw "bad-json";
    });
    expect(() => __runViewerTestables.parseJsonOrThrow("{bad")).toThrow(/Invalid JSON artifact: bad-json/);
    parseSpy.mockRestore();
  });

  it("normalizes deck spec with slide + appendix filtering", () => {
    const normalized = __runViewerTestables.normalizeV2DeckSpec({
      deck_meta: { episode_title: "Case" },
      slides: [{ slide_id: "S01", title: "Intro" }, { title: "missing id" }],
      appendix_slides: [{ slide_id: "A01", title: "Appendix" }, { slide_id: "" }]
    });
    expect(normalized.slides).toHaveLength(1);
    expect(normalized.appendix_slides).toHaveLength(1);
  });

  it("throws when deck spec has no usable slides", () => {
    expect(() => __runViewerTestables.normalizeV2DeckSpec({ slides: [{ title: "x" }] })).toThrow(/no slide records/i);
  });

  it("normalizes template registry, clue graph, and primitive helpers", () => {
    const templates = __runViewerTestables.normalizeV2TemplateRegistry({
      templates: [{ template_id: "T01", purpose: "Lead", renderer_instructions: ["One"], allowed_beat_types: ["clue"] }, {}]
    });
    expect(templates.templates).toHaveLength(1);

    const clues = __runViewerTestables.normalizeV2ClueGraph({
      exhibits: [{ exhibit_id: "EX1", purpose: "X-ray" }, { purpose: "missing id" }]
    });
    expect(clues.exhibits).toEqual([{ exhibit_id: "EX1", purpose: "X-ray" }]);

    expect(__runViewerTestables.asRecord(null)).toEqual({});
    expect(__runViewerTestables.asRecord({ ok: true })).toEqual({ ok: true });
    expect(__runViewerTestables.asStringArray(["a", 1, "b"])).toEqual(["a", "b"]);
    expect(__runViewerTestables.asStringArray("bad")).toEqual([]);
  });

  it("normalizes micro world map with strict type guards", () => {
    const world = __runViewerTestables.normalizeV2MicroWorldMap({
      zones: [
        { zone_id: "Z1", name: "Airway", resident_actors: ["Macrophage"], environmental_gradients: ["O2"], narrative_motifs: ["Fog"] },
        { zone_id: 9 }
      ],
      hazards: [{ hazard_id: "H1", type: "toxin", description: "irritant" }, {}],
      routes: [{ route_id: "R1", from_zone_id: "Z1", to_zone_id: "Z2", mode: "crawl" }, { route_id: "" }]
    });

    expect(world.zones).toHaveLength(1);
    expect(world.hazards).toHaveLength(1);
    expect(world.routes).toHaveLength(1);
  });

  it("normalizes drama and setpiece plans for empty/non-empty map branches", () => {
    const drama = __runViewerTestables.normalizeV2DramaPlan({
      character_arcs: [{ character_id: "cyto", name: "Cyto", core_need: "Need", core_fear: "Fear", act_turns: [{ act_id: "ACT1", pressure: "P", choice: "C", change: "Delta" }] }],
      relationship_arcs: [{ pair: "cyto-pip", starting_dynamic: "tense", friction_points: ["fp"], repair_moments: ["rp"], climax_resolution: "aligned" }],
      pressure_ladder: { ACT1: ["s1"] }
    });
    expect(drama.character_arcs).toHaveLength(1);
    expect(drama.relationship_arcs).toHaveLength(1);
    expect(drama.pressure_ladder).toEqual({ ACT1: ["s1"] });

    const dramaEmpty = __runViewerTestables.normalizeV2DramaPlan({});
    expect(dramaEmpty.pressure_ladder).toBeUndefined();

    const setpieces = __runViewerTestables.normalizeV2SetpiecePlan({
      setpieces: [{ setpiece_id: "SP1", act_id: "ACT1", type: "chase", location_zone_id: "Z1", story_purpose: "raise stakes", outcome_turn: "win", constraints: ["tight"] }, {}],
      quotas: { action: true }
    });
    expect(setpieces.setpieces).toHaveLength(1);
    expect(setpieces.quotas).toEqual({ action: true });

    const setpiecesEmpty = __runViewerTestables.normalizeV2SetpiecePlan({});
    expect(setpiecesEmpty.quotas).toBeUndefined();
  });

  it("formats values and badge classes across edge cases", () => {
    expect(__runViewerTestables.iterationNumber("final_slide_spec_patched_iter7.json")).toBe(7);
    expect(__runViewerTestables.iterationNumber("nope.json")).toBe(-1);
    expect(__runViewerTestables.isPatchedIter("final_slide_spec_patched_iter1.json")).toBe(true);
    expect(__runViewerTestables.isPatchedIter("other.json")).toBe(false);

    expect(__runViewerTestables.stableJson({ b: 1, a: { d: 2, c: 1 } })).toContain("\"a\"");
    expect(__runViewerTestables.extractKeyOrFallback({ inner: 2 }, "inner")).toBe(2);
    expect(__runViewerTestables.extractKeyOrFallback("x", "inner")).toBe("x");

    expect(__runViewerTestables.formatTime(undefined)).toBe("-");
    expect(__runViewerTestables.formatTime("not-a-date")).toBe("not-a-date");
    expect(__runViewerTestables.parseIsoMs(undefined)).toBeNull();
    expect(__runViewerTestables.parseIsoMs("not-a-date")).toBeNull();
    expect(__runViewerTestables.formatElapsed(45_000)).toBe("45s");
    expect(__runViewerTestables.formatElapsed(120_000)).toContain("m");

    expect(__runViewerTestables.clampWatchdogThresholdSeconds(Number.NaN)).toBe(90);
    expect(__runViewerTestables.clampWatchdogThresholdSeconds(1)).toBe(10);
    expect(__runViewerTestables.clampWatchdogThresholdSeconds(5000)).toBe(1200);
    expect(__runViewerTestables.clampWatchdogThresholdSeconds(91.7)).toBe(92);

    window.localStorage.removeItem("mms_watchdog_threshold_seconds");
    expect(__runViewerTestables.initialWatchdogThresholdSeconds()).toBe(90);
    window.localStorage.setItem("mms_watchdog_threshold_seconds", "5");
    expect(__runViewerTestables.initialWatchdogThresholdSeconds()).toBe(10);
    window.localStorage.setItem("mms_watchdog_threshold_seconds", "invalid");
    expect(__runViewerTestables.initialWatchdogThresholdSeconds()).toBe(90);

    expect(__runViewerTestables.statusBadgeClass("done")).toContain("badgeOk");
    expect(__runViewerTestables.statusBadgeClass("paused")).toContain("badgeWarn");
    expect(__runViewerTestables.statusBadgeClass("error")).toContain("badgeErr");
    expect(__runViewerTestables.statusBadgeClass("running")).toBe("badge");

    expect(__runViewerTestables.constraintBadgeClass("fail")).toContain("badgeErr");
    expect(__runViewerTestables.constraintBadgeClass("pass")).toContain("badgeOk");
    expect(__runViewerTestables.constraintBadgeClass("warn")).toBe("badge");
  });
});
