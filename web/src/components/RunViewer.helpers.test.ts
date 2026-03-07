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

  it("normalizes stage provenance and story-beat alignment reports", () => {
    const provenance = __runViewerTestables.normalizeV2StageAuthoringProvenance({
      generation_profile: "pilot",
      stages: {
        micro_world_map: { source: "deterministic_fallback", reason: "budget_guard" },
        drama_plan: { source: "agent" },
        setpiece_plan: { source: "agent" }
      }
    });
    expect(provenance.generation_profile).toBe("pilot");
    expect(provenance.stages.micro_world_map.source).toBe("deterministic_fallback");
    expect(provenance.stages.micro_world_map.reason).toContain("budget_guard");

    const alignment = __runViewerTestables.normalizeV2StoryBeatsAlignmentReport({
      story_beats_present: true,
      chapter_outline_present: true,
      lint_status: "warn",
      warnings: ["coverage low"],
      required_markers: {
        opener_motif: true,
        midpoint_false_theory_collapse: false,
        ending_callback: true,
        detective_deputy_rupture_repair: false
      },
      coverage: {
        total_beats: 10,
        mapped_beats: 7,
        mapped_ratio: 0.7,
        block_aligned_beats: 6,
        block_aligned_ratio: 0.6
      },
      block_coverage: [{ block_id: "ACT1_B01", expected_beats: 3, mapped_beats: 2, mapped_ratio: 0.666 }],
      beat_slide_map: [
        {
          beat_id: "1.1",
          expected_act_id: "ACT1",
          matched_slide_id: "S03",
          matched_act_id: "ACT1",
          matched_block_id: "ACT1_B01",
          overlap_ratio: 0.32,
          overlap_tokens: 5,
          mapped: true,
          block_aligned: true
        }
      ]
    });
    expect(alignment.lint_status).toBe("warn");
    expect(alignment.coverage.mapped_beats).toBe(7);
    expect(alignment.coverage.block_aligned_beats).toBe(6);
    expect(alignment.block_coverage[0]?.block_id).toBe("ACT1_B01");
    expect(alignment.beat_slide_map[0]?.matched_slide_id).toBe("S03");
    expect(alignment.required_markers.midpoint_false_theory_collapse).toBe(false);

    const narrativeState = __runViewerTestables.normalizeV2NarrativeState({
      block_id: "ACT2_B01",
      current_false_theory: "Mimic lock-in",
      relationship_state_detective_deputy: "Tense",
      unresolved_emotional_thread: "Trust fracture",
      active_clue_obligations: ["C1"],
      active_motif_callback_lexicon: ["caseboard"],
      pressure_channels: ["time"],
      recent_slide_excerpts: ["S12 clue"],
      active_differential_ordering: ["DX-1"],
      delta_from_previous_block: "Shifted to fracture"
    });
    expect(narrativeState.block_id).toBe("ACT2_B01");
    expect(narrativeState.active_clue_obligations).toEqual(["C1"]);

    const manifest = __runViewerTestables.normalizeV2AuthoringContextManifest({
      generated_at: "2026-02-09T00:00:00.000Z",
      generation_profile: "pilot",
      attempts: [
        {
          attempt_id: "a1",
          prompt_variant: "primary",
          context_mode: "compact",
          reason: "retry",
          result: "error",
          details: "timeout"
        },
        {
          attempt_id: "",
          prompt_variant: "ignored",
          context_mode: "full",
          reason: "ignored",
          result: "success"
        }
      ]
    });
    expect(manifest.generation_profile).toBe("pilot");
    expect(manifest.attempts).toHaveLength(1);
    expect(manifest.attempts[0]?.result).toBe("error");

    const regen = __runViewerTestables.normalizeV2BlockRegenTrace({
      loop: 2,
      fix_count: 3,
      fix_types: ["increase_story_turn"],
      routes: ["regen_block"],
      regenerated_blocks: ["ACT2_B01"],
      warnings: ["warn"]
    });
    expect(regen.loop).toBe(2);
    expect(regen.regenerated_blocks).toEqual(["ACT2_B01"]);

    const heatmap = __runViewerTestables.normalizeV2QaBlockHeatmap({
      loop: 1,
      blocks: [
        {
          block_id: "ACT3_B02",
          act_id: "ACT3",
          severity_score: 0.92,
          repeated_template_density: 0.24,
          generic_language_rate: 0.19,
          story_forward_deficit_ratio: 0.22,
          hybrid_deficit_ratio: 0.18,
          clue_twist_debt_count: 3
        }
      ]
    });
    expect(heatmap.blocks[0]?.block_id).toBe("ACT3_B02");

    const intensifier = __runViewerTestables.normalizeV2NarrativeIntensifierPass({
      global_intensity_findings: ["Callback debt is underpaid."],
      narrative_rationale: ["Act III needs sharper motif reuse."],
      target_block_ids: ["ACT3_B02"],
      operations: [{ op: "replace_window", start_slide_id: "S31", end_slide_id: "S36", reason: "raise stakes" }]
    });
    expect(intensifier.operations[0]?.op).toBe("replace_window");

    const sourceReport = __runViewerTestables.normalizeV2DiseaseResearchSourceReport({
      topic: "Community-acquired pneumonia in adults",
      sections: [
        {
          section: "diagnosis_workup",
          curated_citations: 4,
          web_citations: 1,
          dominant_source: "curated"
        }
      ]
    });
    expect(sourceReport.sections[0]?.dominant_source).toBe("curated");

    expect(__runViewerTestables.regenTraceLoopFromName("block_regen_trace_loop2.json")).toBe(2);
    expect(__runViewerTestables.regenTraceLoopFromName("block_regen_trace_loopX.json")).toBe(-1);
    expect(__runViewerTestables.regenTraceLoopFromName("not-a-trace.json")).toBe(-1);
    expect(__runViewerTestables.qaHeatmapLoopFromName("qa_block_heatmap_loop2.json")).toBe(2);
    expect(__runViewerTestables.qaHeatmapLoopFromName("qa_block_heatmap_loopX.json")).toBe(-1);
    expect(__runViewerTestables.qaHeatmapLoopFromName("not-a-heatmap.json")).toBe(-1);
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

    expect(__runViewerTestables.liveFeedBadgeClass("connected")).toContain("badgeOk");
    expect(__runViewerTestables.liveFeedBadgeClass("reconnecting")).toContain("badgeWarn");
    expect(__runViewerTestables.liveFeedBadgeClass("connecting")).toBe("badge");
    expect(__runViewerTestables.liveFeedBadgeClass("offline")).toContain("badgeErr");

    expect(__runViewerTestables.liveFeedLabel("connected")).toBe("live");
    expect(__runViewerTestables.liveFeedLabel("reconnecting")).toBe("reconnecting");
    expect(__runViewerTestables.liveFeedLabel("connecting")).toBe("connecting");
    expect(__runViewerTestables.liveFeedLabel("offline")).toBe("offline");
  });
});
