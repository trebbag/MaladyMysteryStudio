import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

vi.mock("@openai/agents", () => {
  type MockAgent = { name?: string };
  type RunResult = { finalOutput?: unknown };
  type Handler = ((agent: MockAgent, prompt: string, options: unknown) => Promise<RunResult> | RunResult) | null;

  let handler: Handler = null;

  class Agent {
    name?: string;
    constructor(config: Record<string, unknown>) {
      Object.assign(this, config);
    }
  }

  class ModelBehaviorError extends Error {}
  class MaxTurnsExceededError extends Error {}

  class Runner {
    async run(agent: MockAgent, prompt: string, options: unknown): Promise<RunResult> {
      if (!handler) throw new Error("No mock runner handler");
      return await handler(agent, prompt, options);
    }
  }

  function fileSearchTool(...args: unknown[]) {
    return { type: "file_search", args };
  }

  function webSearchTool(...args: unknown[]) {
    return { type: "web_search", args };
  }

  function setDefaultOpenAIKey() {
    // no-op in tests
  }

  async function withTrace<T>(_name: string, fn: (trace: { traceId: string }) => Promise<T>): Promise<T> {
    return await fn({ traceId: "trace_v2_test" });
  }

  function __setMockRunnerHandler(next: Handler) {
    handler = next;
  }

  return {
    Agent,
    Runner,
    ModelBehaviorError,
    MaxTurnsExceededError,
    fileSearchTool,
    webSearchTool,
    setDefaultOpenAIKey,
    withTrace,
    __setMockRunnerHandler
  };
});

import * as agentsMock from "@openai/agents";
import { PipelinePause } from "../src/executor.js";
import { RunManager } from "../src/run_manager.js";
import { generateV2DeckSpec } from "../src/pipeline/v2_micro_detectives/generator.js";
import { generateDiseaseDossier, generateEpisodePitch, generateMedFactcheckReport, generateTruthModel } from "../src/pipeline/v2_micro_detectives/phase2_generator.js";
import { generateClueGraph, generateDifferentialCast, generateReaderSimReport } from "../src/pipeline/v2_micro_detectives/phase3_generator.js";
import { generateDramaPlan, generateMicroWorldMap, generateSetpiecePlan } from "../src/pipeline/v2_micro_detectives/phase4_generator.js";
import { buildActOutlineFallback, buildStoryBlueprintFallback } from "../src/pipeline/v2_micro_detectives/authoring_stages.js";
import {
  __testOnlyNormalizeMedFactcheckReport,
  __testOnlyNormalizeSlideBlockAuthorOutput,
  runMicroDetectivesPipeline
} from "../src/pipeline/v2_micro_detectives/pipeline.js";
import { appendHumanReview } from "../src/pipeline/v2_micro_detectives/reviews.js";
import { runFinalDirAbs, runIntermediateDirAbs } from "../src/pipeline/utils.js";

type MockAgentsModule = {
  __setMockRunnerHandler: (
    next: ((agent: { name?: string }, prompt: string, options: unknown) => Promise<{ finalOutput?: unknown }> | { finalOutput?: unknown }) | null
  ) => void;
};

let tmpOut: string | null = null;
let prevOpenAi: string | undefined;
let prevVector: string | undefined;
let prevDisableCanon: string | undefined;
let prevV2IsolationMode: string | undefined;

function parseTopic(prompt: string): string {
  const match = prompt.match(/TOPIC:\n([^\n]+)/);
  if (match?.[1]) return match[1].trim();
  return "Test Topic";
}

function parseDeckLength(prompt: string): 30 | 45 | 60 {
  if (
    /"deck_length_main"\s*:\s*30/.test(prompt) ||
    /"deckLengthMain"\s*:\s*30/.test(prompt) ||
    /"deck_length_main_soft_target"\s*:\s*30/.test(prompt)
  )
    return 30;
  if (
    /"deck_length_main"\s*:\s*60/.test(prompt) ||
    /"deckLengthMain"\s*:\s*60/.test(prompt) ||
    /"deck_length_main_soft_target"\s*:\s*60/.test(prompt)
  )
    return 60;
  return 45;
}

function parseDeckLengthConstraintEnabled(prompt: string): boolean {
  return (
    /"deck_length_policy"\s*:\s*"soft_target"/.test(prompt) ||
    /"deckLengthConstraintEnabled"\s*:\s*true/.test(prompt) ||
    /"deck_length_main_soft_target"\s*:\s*(30|45|60)/.test(prompt)
  );
}

function parseAudience(prompt: string): "PHYSICIAN_LEVEL" | "COLLEGE_LEVEL" {
  if (/PHYSICIAN_LEVEL/.test(prompt)) return "PHYSICIAN_LEVEL";
  if (/COLLEGE_LEVEL/.test(prompt)) return "COLLEGE_LEVEL";
  return "PHYSICIAN_LEVEL";
}

type BlockPlan = {
  blockId: string;
  actId: "ACT1" | "ACT2" | "ACT3" | "ACT4";
  start: number;
  end: number;
};

function parseBlockPlan(prompt: string): BlockPlan {
  const match = prompt.match(/BLOCK PLAN \(json\):\n([\s\S]*?)\n\nACT OBLIGATIONS/);
  if (!match?.[1]) {
    return { blockId: "ACT1_B01", actId: "ACT1", start: 1, end: 12 };
  }
  try {
    const parsed = JSON.parse(match[1]) as Record<string, unknown>;
    const actIdRaw = String(parsed.actId ?? "ACT1");
    const actId = ["ACT1", "ACT2", "ACT3", "ACT4"].includes(actIdRaw) ? (actIdRaw as BlockPlan["actId"]) : "ACT1";
    const start = Number(parsed.start ?? 1);
    const end = Number(parsed.end ?? start);
    return {
      blockId: String(parsed.blockId ?? `${actId}_B01`),
      actId,
      start: Number.isFinite(start) ? Math.max(1, Math.round(start)) : 1,
      end: Number.isFinite(end) ? Math.max(1, Math.round(end)) : 12
    };
  } catch {
    return { blockId: "ACT1_B01", actId: "ACT1", start: 1, end: 12 };
  }
}

function makeSlideBlockForTest(plan: BlockPlan, mode: "note_only" | "clue", marker: "DEGRADE" | "REGEN") {
  const overrides = [];
  for (let n = plan.start; n <= plan.end; n += 1) {
    const slideId = `S${String(n).padStart(2, "0")}`;
    overrides.push({
      slide_id: slideId,
      title: `[${marker}] ${slideId}`,
      hook: marker === "REGEN" ? "Recovered structural beat with consequence." : "Flat informational beat.",
      story_panel: {
        goal: marker === "REGEN" ? "Drive the investigation forward." : "State a detail.",
        opposition: marker === "REGEN" ? "Competing clue pressure blocks certainty." : "Mild uncertainty.",
        turn: marker === "REGEN" ? "A contradiction reframes the working theory." : "Minor update.",
        decision: marker === "REGEN" ? "Commit to the next proof action." : "Continue collecting data."
      },
      delivery_mode: mode,
      major_concept_id: `MC-${String(n).padStart(3, "0")}`,
      speaker_notes_patch:
        marker === "REGEN"
          ? "Regenerated block patch: strengthen story consequence and clue linkage."
          : "Intentional degradation for structural-regeneration integration test."
    });
  }
  return {
    schema_version: "1.0.0",
    block_id: plan.blockId,
    act_id: plan.actId,
    slide_range: { start: plan.start, end: plan.end },
    prior_block_summary: marker === "REGEN" ? "Regenerated from quality fix list." : "Initial degraded authoring block.",
    unresolved_threads_in: ["thread:test"],
    slide_overrides: overrides,
    unresolved_threads_out: marker === "REGEN" ? ["thread:resolved"] : ["thread:test"],
    block_summary_out: marker === "REGEN" ? "Block regenerated with stronger narrative turns." : "Degraded block to force QA structural fixes."
  };
}

function makeNarrativeIntensifierPass(deck: ReturnType<typeof generateV2DeckSpec>, targetBlockId = "ACT1_B01") {
  const firstSlide = deck.slides[0]!;
  return {
    schema_version: "1.0.0",
    global_intensity_findings: ["Sharpen opener specificity and maintain callback debt."],
    operations: [
      {
        op: "replace_slide" as const,
        slide_id: firstSlide.slide_id,
        replacement_slide: {
          ...firstSlide,
          title: `${firstSlide.title} Intensified`,
          hook: `${firstSlide.hook} Intensified`
        },
        reason: "Bounded narrative intensification for test coverage."
      }
    ],
    narrative_rationale: ["Tighten the opener language without changing the deck shape."],
    target_block_ids: [targetBlockId]
  };
}

beforeEach(async () => {
  tmpOut = await fs.mkdtemp(path.join(os.tmpdir(), "mms-v2-real-"));
  process.env.MMS_OUTPUT_DIR = tmpOut;

  prevOpenAi = process.env.OPENAI_API_KEY;
  prevVector = process.env.KB_VECTOR_STORE_ID;
  prevDisableCanon = process.env.MMS_DISABLE_CANON_AUTO_DISCOVERY;
  prevV2IsolationMode = process.env.MMS_V2_AGENT_ISOLATION_MODE;

  process.env.OPENAI_API_KEY = "test-key";
  process.env.KB_VECTOR_STORE_ID = "vs_test";
  delete process.env.MMS_DISABLE_CANON_AUTO_DISCOVERY;
  process.env.MMS_V2_AGENT_ISOLATION_MODE = "off";

  (agentsMock as unknown as MockAgentsModule).__setMockRunnerHandler((agent, prompt) => {
    const topic = parseTopic(prompt);
    const deckLengthMain = parseDeckLength(prompt);
    const deckLengthConstraintEnabled = parseDeckLengthConstraintEnabled(prompt);
    const audienceLevel = parseAudience(prompt);
    const base = {
      topic,
      audienceLevel,
      deckLengthMain,
      deckLengthConstraintEnabled,
      kbContext: "## Medical / Clinical KB\n- deterministic test context"
    } as const;
    const dossier = generateDiseaseDossier(base);
    const pitch = generateEpisodePitch(base, dossier);
    const truth = generateTruthModel(base, dossier, pitch);
    const deck = generateV2DeckSpec({ topic, deckLengthMain, deckLengthConstraintEnabled, audienceLevel });
    const differential = generateDifferentialCast(deck, dossier, truth);
    const clueGraph = generateClueGraph(deck, dossier, differential);
    const microWorld = generateMicroWorldMap(deck, dossier, truth);
    const dramaPlan = generateDramaPlan(deck, truth);
    const setpiecePlan = generateSetpiecePlan(deck, microWorld, dossier);
    const storyBlueprint = buildStoryBlueprintFallback({
      topic,
      clueObligations: clueGraph.clues.slice(0, 6).map((clue) => clue.clue_id)
    });
    const actOutline = buildActOutlineFallback({
      deck,
      storyBlueprint
    });

    const name = agent?.name ?? "";
    if (name === "KB Compiler") {
      return {
        finalOutput: {
          kb_context: "## Medical / Clinical KB\n- deterministic test context\n\n## Characters & Story Constraints\n- keep continuity\n\n## Visual Style / Shot Constraints\n- cinematic"
        }
      };
    }
    if (name === "V2 Disease Research Desk") return { finalOutput: dossier };
    if (name === "V2 Episode Pitch Builder") return { finalOutput: pitch };
    if (name === "V2 Truth Model Engineer") return { finalOutput: truth };
    if (name === "V2 Differential Cast Director") return { finalOutput: differential };
    if (name === "V2 Clue Architect") return { finalOutput: clueGraph };
    if (name === "V2 Micro-World Mapper") return { finalOutput: microWorld };
    if (name === "V2 Drama Architect") return { finalOutput: dramaPlan };
    if (name === "V2 Setpiece Choreographer") return { finalOutput: setpiecePlan };
    if (name === "V2 Story Blueprint Architect") return { finalOutput: storyBlueprint };
    if (name === "V2 Act Outline Architect") return { finalOutput: actOutline };
    if (name === "V2 Slide Block Author") {
      const plan = parseBlockPlan(prompt);
      return { finalOutput: makeSlideBlockForTest(plan, "clue", "REGEN") };
    }
    if (name === "V2 Deck Cohesion Pass") {
      return {
        finalOutput: {
          schema_version: "1.0.0",
          global_continuity_findings: ["Continuity pass completed."],
          act_obligation_gaps: [],
          must_fix_operations: [],
          narrative_risk_flags: []
        }
      };
    }
    if (name === "V2 Narrative Intensifier") return { finalOutput: makeNarrativeIntensifierPass(deck) };
    if (name === "V2 Plot Director DeckSpec") return { finalOutput: deck };
    if (name === "V2 Reader Simulator") return { finalOutput: generateReaderSimReport(deck, truth, clueGraph) };
    if (name === "V2 Medical Fact Checker") return { finalOutput: generateMedFactcheckReport(deck, dossier) };
    return { finalOutput: { kb_context: "## Medical / Clinical KB\n- fallback" } };
  });
});

afterEach(async () => {
  (agentsMock as unknown as MockAgentsModule).__setMockRunnerHandler(null);
  if (tmpOut) await fs.rm(tmpOut, { recursive: true, force: true }).catch(() => undefined);
  tmpOut = null;

  if (prevOpenAi === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = prevOpenAi;
  if (prevVector === undefined) delete process.env.KB_VECTOR_STORE_ID;
  else process.env.KB_VECTOR_STORE_ID = prevVector;
  if (prevDisableCanon === undefined) delete process.env.MMS_DISABLE_CANON_AUTO_DISCOVERY;
  else process.env.MMS_DISABLE_CANON_AUTO_DISCOVERY = prevDisableCanon;
  if (prevV2IsolationMode === undefined) delete process.env.MMS_V2_AGENT_ISOLATION_MODE;
  else process.env.MMS_V2_AGENT_ISOLATION_MODE = prevV2IsolationMode;
  delete process.env.MMS_OUTPUT_DIR;
});

describe("v2 real pipeline", () => {
  it("pauses at Gate 1 after writing dossier + pitch artifacts", async () => {
    const runs = new RunManager();
    const run = await runs.createRun("Pneumonia", {
      workflow: "v2_micro_detectives",
      deckLengthMain: 45,
      deckLengthConstraintEnabled: true,
      audienceLevel: "PHYSICIAN_LEVEL",
      adherenceMode: "strict"
    });

    await expect(
      runMicroDetectivesPipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "KB0" }
      )
    ).rejects.toBeInstanceOf(PipelinePause);

    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "kb_context.md"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "disease_dossier.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "disease_research_source_report.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "episode_pitch.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "GATE_1_PITCH_REQUIRED.json"))).resolves.toBeTruthy();

    const status = runs.getRun(run.runId);
    expect(status?.steps.KB0.status).toBe("done");
    expect(status?.steps.A.status).toBe("done");
    expect(status?.steps.B.status).toBe("queued");
  });

  it("pauses at Gate 2 after Gate 1 approval and truth model generation", async () => {
    const runs = new RunManager();
    const run = await runs.createRun("Heart failure", {
      workflow: "v2_micro_detectives",
      deckLengthMain: 45,
      deckLengthConstraintEnabled: true,
      audienceLevel: "COLLEGE_LEVEL",
      adherenceMode: "strict"
    });

    await expect(
      runMicroDetectivesPipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "KB0" }
      )
    ).rejects.toBeInstanceOf(PipelinePause);

    await appendHumanReview(run.runId, {
      schema_version: "1.0.0",
      gate_id: "GATE_1_PITCH",
      status: "approve",
      notes: "ok",
      requested_changes: [],
      submitted_at: new Date().toISOString()
    });

    await expect(
      runMicroDetectivesPipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "B" }
      )
    ).rejects.toBeInstanceOf(PipelinePause);

    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "truth_model.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "GATE_2_TRUTH_LOCK_REQUIRED.json"))).resolves.toBeTruthy();

    const status = runs.getRun(run.runId);
    expect(status?.steps.B.status).toBe("done");
    expect(status?.steps.C.status).toBe("queued");
  });

  it("retries disease research once with a compact prompt after a transport abort in quality mode", async () => {
    let diseaseResearchCalls = 0;
    (agentsMock as unknown as MockAgentsModule).__setMockRunnerHandler((agent, prompt) => {
      const topic = parseTopic(prompt);
      const deckLengthMain = parseDeckLength(prompt);
      const deckLengthConstraintEnabled = parseDeckLengthConstraintEnabled(prompt);
      const audienceLevel = parseAudience(prompt);
      const base = {
        topic,
        audienceLevel,
        deckLengthMain,
        deckLengthConstraintEnabled,
        kbContext: "## Medical / Clinical KB\n- deterministic test context"
      } as const;
      const dossier = generateDiseaseDossier(base);
      const pitch = generateEpisodePitch(base, dossier);
      const truth = generateTruthModel(base, dossier, pitch);
      const deck = generateV2DeckSpec({ topic, deckLengthMain, deckLengthConstraintEnabled, audienceLevel });
      const differential = generateDifferentialCast(deck, dossier, truth);
      const clueGraph = generateClueGraph(deck, dossier, differential);
      const microWorld = generateMicroWorldMap(deck, dossier, truth);
      const dramaPlan = generateDramaPlan(deck, truth);
      const setpiecePlan = generateSetpiecePlan(deck, microWorld, dossier);

      const name = agent?.name ?? "";
      if (name === "KB Compiler") {
        return {
          finalOutput: {
            kb_context: "## Medical / Clinical KB\n- deterministic test context\n\n## Characters & Story Constraints\n- keep continuity\n\n## Visual Style / Shot Constraints\n- cinematic"
          }
        };
      }
      if (name === "V2 Disease Research Desk") {
        diseaseResearchCalls += 1;
        if (diseaseResearchCalls === 1) throw new Error("Request was aborted.");
        return { finalOutput: dossier };
      }
      if (name === "V2 Episode Pitch Builder") return { finalOutput: pitch };
      if (name === "V2 Truth Model Engineer") return { finalOutput: truth };
      if (name === "V2 Differential Cast Director") return { finalOutput: differential };
      if (name === "V2 Clue Architect") return { finalOutput: clueGraph };
      if (name === "V2 Micro-World Mapper") return { finalOutput: microWorld };
      if (name === "V2 Drama Architect") return { finalOutput: dramaPlan };
      if (name === "V2 Setpiece Choreographer") return { finalOutput: setpiecePlan };
      if (name === "V2 Deck Cohesion Pass") {
        return {
          finalOutput: {
            schema_version: "1.0.0",
            global_continuity_findings: ["Continuity pass completed."],
            act_obligation_gaps: [],
            must_fix_operations: [],
            narrative_risk_flags: []
          }
        };
      }
      if (name === "V2 Plot Director DeckSpec") return { finalOutput: deck };
      if (name === "V2 Reader Simulator") return { finalOutput: generateReaderSimReport(deck, truth, clueGraph) };
      if (name === "V2 Medical Fact Checker") return { finalOutput: generateMedFactcheckReport(deck, dossier) };
      return { finalOutput: { kb_context: "## Medical / Clinical KB\n- fallback" } };
    });

    const runs = new RunManager();
    const run = await runs.createRun("Disease research retry", {
      workflow: "v2_micro_detectives",
      generationProfile: "quality",
      adherenceMode: "strict",
      audienceLevel: "PHYSICIAN_LEVEL",
      deckLengthConstraintEnabled: false
    });

    await expect(
      runMicroDetectivesPipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "KB0" }
      )
    ).rejects.toBeInstanceOf(PipelinePause);

    expect(diseaseResearchCalls).toBe(2);
    const durations = JSON.parse(
      await fs.readFile(path.join(runIntermediateDirAbs(run.runId), "agent_call_durations_A.json"), "utf8")
    ) as { calls: Array<{ agentKey: string; status: string }> };
    const diseaseRows = durations.calls.filter((row) => row.agentKey === "diseaseResearch");
    expect(diseaseRows.map((row) => row.status)).toEqual(["error", "ok"]);
  });

  it("retries KB0 once with a compact prompt after a transport abort in quality mode", async () => {
    let kbCalls = 0;
    (agentsMock as unknown as MockAgentsModule).__setMockRunnerHandler((agent) => {
      const name = agent?.name ?? "";
      if (name === "KB Compiler") {
        kbCalls += 1;
        if (kbCalls === 1) throw new Error("Request was aborted.");
        return {
          finalOutput: {
            kb_context: "## Medical / Clinical KB\n- deterministic test context\n\n## Characters & Story Constraints\n- keep continuity\n\n## Visual Style / Shot Constraints\n- cinematic"
          }
        };
      }
      return {
        finalOutput: {
          kb_context: "## Medical / Clinical KB\n- deterministic test context"
        }
      };
    });

    const runs = new RunManager();
    const run = await runs.createRun("KB retry", {
      workflow: "v2_micro_detectives",
      generationProfile: "quality",
      adherenceMode: "warn",
      audienceLevel: "PHYSICIAN_LEVEL",
      deckLengthConstraintEnabled: false
    });

    await expect(
      runMicroDetectivesPipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "KB0" }
      )
    ).rejects.toBeInstanceOf(PipelinePause);

    expect(kbCalls).toBe(2);
    const durations = JSON.parse(
      await fs.readFile(path.join(runIntermediateDirAbs(run.runId), "agent_call_durations_KB0.json"), "utf8")
    ) as { calls: Array<{ agentKey: string; status: string }> };
    const kbRows = durations.calls.filter((row) => row.agentKey === "kbCompiler");
    expect(kbRows.map((row) => row.status)).toEqual(["error", "ok"]);
  });

  it("retries episode pitch once with a compact prompt after a timeout-like failure in quality mode", async () => {
    let episodePitchCalls = 0;
    (agentsMock as unknown as MockAgentsModule).__setMockRunnerHandler((agent, prompt) => {
      const topic = parseTopic(prompt);
      const deckLengthMain = parseDeckLength(prompt);
      const deckLengthConstraintEnabled = parseDeckLengthConstraintEnabled(prompt);
      const audienceLevel = parseAudience(prompt);
      const base = {
        topic,
        audienceLevel,
        deckLengthMain,
        deckLengthConstraintEnabled,
        kbContext: "## Medical / Clinical KB\n- deterministic test context"
      } as const;
      const dossier = generateDiseaseDossier(base);
      const pitch = generateEpisodePitch(base, dossier);
      const truth = generateTruthModel(base, dossier, pitch);
      const deck = generateV2DeckSpec({ topic, deckLengthMain, deckLengthConstraintEnabled, audienceLevel });
      const differential = generateDifferentialCast(deck, dossier, truth);
      const clueGraph = generateClueGraph(deck, dossier, differential);
      const microWorld = generateMicroWorldMap(deck, dossier, truth);
      const dramaPlan = generateDramaPlan(deck, truth);
      const setpiecePlan = generateSetpiecePlan(deck, microWorld, dossier);

      const name = agent?.name ?? "";
      if (name === "KB Compiler") {
        return {
          finalOutput: {
            kb_context: "## Medical / Clinical KB\n- deterministic test context\n\n## Characters & Story Constraints\n- keep continuity\n\n## Visual Style / Shot Constraints\n- cinematic"
          }
        };
      }
      if (name === "V2 Disease Research Desk") return { finalOutput: dossier };
      if (name === "V2 Episode Pitch Builder") {
        episodePitchCalls += 1;
        if (episodePitchCalls === 1) throw new Error("Child timeout for A:episodePitch after 300000ms");
        return { finalOutput: pitch };
      }
      if (name === "V2 Truth Model Engineer") return { finalOutput: truth };
      if (name === "V2 Differential Cast Director") return { finalOutput: differential };
      if (name === "V2 Clue Architect") return { finalOutput: clueGraph };
      if (name === "V2 Micro-World Mapper") return { finalOutput: microWorld };
      if (name === "V2 Drama Architect") return { finalOutput: dramaPlan };
      if (name === "V2 Setpiece Choreographer") return { finalOutput: setpiecePlan };
      if (name === "V2 Deck Cohesion Pass") {
        return {
          finalOutput: {
            schema_version: "1.0.0",
            global_continuity_findings: ["Continuity pass completed."],
            act_obligation_gaps: [],
            must_fix_operations: [],
            narrative_risk_flags: []
          }
        };
      }
      if (name === "V2 Plot Director DeckSpec") return { finalOutput: deck };
      if (name === "V2 Reader Simulator") return { finalOutput: generateReaderSimReport(deck, truth, clueGraph) };
      if (name === "V2 Medical Fact Checker") return { finalOutput: generateMedFactcheckReport(deck, dossier) };
      return { finalOutput: { kb_context: "## Medical / Clinical KB\n- fallback" } };
    });

    const runs = new RunManager();
    const run = await runs.createRun("Episode pitch retry", {
      workflow: "v2_micro_detectives",
      generationProfile: "quality",
      adherenceMode: "strict",
      audienceLevel: "PHYSICIAN_LEVEL",
      deckLengthConstraintEnabled: false
    });

    await expect(
      runMicroDetectivesPipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "KB0" }
      )
    ).rejects.toBeInstanceOf(PipelinePause);

    expect(episodePitchCalls).toBe(2);
    const durations = JSON.parse(
      await fs.readFile(path.join(runIntermediateDirAbs(run.runId), "agent_call_durations_A.json"), "utf8")
    ) as { calls: Array<{ agentKey: string; status: string }> };
    const pitchRows = durations.calls.filter((row) => row.agentKey === "episodePitch");
    expect(pitchRows.map((row) => row.status)).toEqual(["error", "ok"]);
  });

  it("retries truth model once with a compact prompt after a timeout-like failure in quality mode", async () => {
    let truthModelCalls = 0;
    (agentsMock as unknown as MockAgentsModule).__setMockRunnerHandler((agent, prompt) => {
      const topic = parseTopic(prompt);
      const deckLengthMain = parseDeckLength(prompt);
      const deckLengthConstraintEnabled = parseDeckLengthConstraintEnabled(prompt);
      const audienceLevel = parseAudience(prompt);
      const base = {
        topic,
        audienceLevel,
        deckLengthMain,
        deckLengthConstraintEnabled,
        kbContext: "## Medical / Clinical KB\n- deterministic test context"
      } as const;
      const dossier = generateDiseaseDossier(base);
      const pitch = generateEpisodePitch(base, dossier);
      const truth = generateTruthModel(base, dossier, pitch);
      const deck = generateV2DeckSpec({ topic, deckLengthMain, deckLengthConstraintEnabled, audienceLevel });
      const differential = generateDifferentialCast(deck, dossier, truth);
      const clueGraph = generateClueGraph(deck, dossier, differential);
      const microWorld = generateMicroWorldMap(deck, dossier, truth);
      const dramaPlan = generateDramaPlan(deck, truth);
      const setpiecePlan = generateSetpiecePlan(deck, microWorld, dossier);

      const name = agent?.name ?? "";
      if (name === "KB Compiler") {
        return {
          finalOutput: {
            kb_context: "## Medical / Clinical KB\n- deterministic test context\n\n## Characters & Story Constraints\n- keep continuity\n\n## Visual Style / Shot Constraints\n- cinematic"
          }
        };
      }
      if (name === "V2 Disease Research Desk") return { finalOutput: dossier };
      if (name === "V2 Episode Pitch Builder") return { finalOutput: pitch };
      if (name === "V2 Truth Model Engineer") {
        truthModelCalls += 1;
        if (truthModelCalls === 1) throw new Error("Child timeout for B:truthModel after 120000ms");
        return { finalOutput: truth };
      }
      if (name === "V2 Differential Cast Director") return { finalOutput: differential };
      if (name === "V2 Clue Architect") return { finalOutput: clueGraph };
      if (name === "V2 Micro-World Mapper") return { finalOutput: microWorld };
      if (name === "V2 Drama Architect") return { finalOutput: dramaPlan };
      if (name === "V2 Setpiece Choreographer") return { finalOutput: setpiecePlan };
      if (name === "V2 Deck Cohesion Pass") {
        return {
          finalOutput: {
            schema_version: "1.0.0",
            global_continuity_findings: ["Continuity pass completed."],
            act_obligation_gaps: [],
            must_fix_operations: [],
            narrative_risk_flags: []
          }
        };
      }
      if (name === "V2 Plot Director DeckSpec") return { finalOutput: deck };
      if (name === "V2 Reader Simulator") return { finalOutput: generateReaderSimReport(deck, truth, clueGraph) };
      if (name === "V2 Medical Fact Checker") return { finalOutput: generateMedFactcheckReport(deck, dossier) };
      return { finalOutput: { kb_context: "## Medical / Clinical KB\n- fallback" } };
    });

    const runs = new RunManager();
    const run = await runs.createRun("Truth model retry", {
      workflow: "v2_micro_detectives",
      generationProfile: "quality",
      adherenceMode: "strict",
      audienceLevel: "PHYSICIAN_LEVEL",
      deckLengthConstraintEnabled: false
    });

    await expect(
      runMicroDetectivesPipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "KB0" }
      )
    ).rejects.toBeInstanceOf(PipelinePause);

    await appendHumanReview(run.runId, {
      schema_version: "1.0.0",
      gate_id: "GATE_1_PITCH",
      status: "approve",
      notes: "",
      requested_changes: [],
      submitted_at: new Date().toISOString()
    });

    await expect(
      runMicroDetectivesPipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "B" }
      )
    ).rejects.toBeInstanceOf(PipelinePause);

    expect(truthModelCalls).toBe(2);
    const durations = JSON.parse(
      await fs.readFile(path.join(runIntermediateDirAbs(run.runId), "agent_call_durations_B.json"), "utf8")
    ) as { calls: Array<{ agentKey: string; status: string }> };
    const truthRows = durations.calls.filter((row) => row.agentKey === "truthModel");
    expect(truthRows.map((row) => row.status)).toEqual(["error", "ok"]);
  });

  it("retries MicroWorldMap once with a compact prompt after a timeout-like failure in quality mode", async () => {
    let microWorldCalls = 0;
    (agentsMock as unknown as MockAgentsModule).__setMockRunnerHandler((agent, prompt) => {
      const topic = parseTopic(prompt);
      const deckLengthMain = parseDeckLength(prompt);
      const deckLengthConstraintEnabled = parseDeckLengthConstraintEnabled(prompt);
      const audienceLevel = parseAudience(prompt);
      const base = {
        topic,
        audienceLevel,
        deckLengthMain,
        deckLengthConstraintEnabled,
        kbContext: "## Medical / Clinical KB\n- deterministic test context"
      } as const;
      const dossier = generateDiseaseDossier(base);
      const pitch = generateEpisodePitch(base, dossier);
      const truth = generateTruthModel(base, dossier, pitch);
      const deck = generateV2DeckSpec({ topic, deckLengthMain, deckLengthConstraintEnabled, audienceLevel });
      const differential = generateDifferentialCast(deck, dossier, truth);
      const clueGraph = generateClueGraph(deck, dossier, differential);
      const microWorld = generateMicroWorldMap(deck, dossier, truth);
      const dramaPlan = generateDramaPlan(deck, truth);
      const setpiecePlan = generateSetpiecePlan(deck, microWorld, dossier);

      const name = agent?.name ?? "";
      if (name === "KB Compiler") {
        return {
          finalOutput: {
            kb_context: "## Medical / Clinical KB\n- deterministic test context\n\n## Characters & Story Constraints\n- keep continuity\n\n## Visual Style / Shot Constraints\n- cinematic"
          }
        };
      }
      if (name === "V2 Disease Research Desk") return { finalOutput: dossier };
      if (name === "V2 Episode Pitch Builder") return { finalOutput: pitch };
      if (name === "V2 Truth Model Engineer") return { finalOutput: truth };
      if (name === "V2 Differential Cast Director") return { finalOutput: differential };
      if (name === "V2 Clue Architect") return { finalOutput: clueGraph };
      if (name === "V2 Micro-World Mapper") {
        microWorldCalls += 1;
        if (microWorldCalls === 1) throw new Error("Child timeout for C:microWorldMap after 360000ms");
        return { finalOutput: microWorld };
      }
      if (name === "V2 Drama Architect") return { finalOutput: dramaPlan };
      if (name === "V2 Setpiece Choreographer") return { finalOutput: setpiecePlan };
      if (name === "V2 Story Blueprint Architect") return { finalOutput: buildStoryBlueprintFallback({ topic, clueObligations: clueGraph.clues.map((clue) => clue.clue_id) }) };
      if (name === "V2 Act Outline Architect") {
        return {
          finalOutput: buildActOutlineFallback({
            deck,
            storyBlueprint: buildStoryBlueprintFallback({ topic, clueObligations: clueGraph.clues.map((clue) => clue.clue_id) })
          })
        };
      }
      if (name === "V2 Slide Block Author") {
        const plan = parseBlockPlan(prompt);
        return { finalOutput: makeSlideBlockForTest(plan, "clue", "REGEN") };
      }
      if (name === "V2 Deck Cohesion Pass") {
        return {
          finalOutput: {
            schema_version: "1.0.0",
            global_continuity_findings: ["Continuity pass completed."],
            act_obligation_gaps: [],
            must_fix_operations: [],
            narrative_risk_flags: []
          }
        };
      }
      if (name === "V2 Plot Director DeckSpec") return { finalOutput: deck };
      if (name === "V2 Reader Simulator") return { finalOutput: generateReaderSimReport(deck, truth, clueGraph) };
      if (name === "V2 Medical Fact Checker") return { finalOutput: generateMedFactcheckReport(deck, dossier) };
      return { finalOutput: { kb_context: "## Medical / Clinical KB\n- fallback" } };
    });

    const runs = new RunManager();
    const run = await runs.createRun("Micro world retry", {
      workflow: "v2_micro_detectives",
      generationProfile: "quality",
      adherenceMode: "strict",
      audienceLevel: "PHYSICIAN_LEVEL",
      deckLengthConstraintEnabled: false
    });

    await expect(
      runMicroDetectivesPipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "KB0" }
      )
    ).rejects.toBeInstanceOf(PipelinePause);

    await appendHumanReview(run.runId, {
      schema_version: "1.0.0",
      gate_id: "GATE_1_PITCH",
      status: "approve",
      notes: "",
      requested_changes: [],
      submitted_at: new Date().toISOString()
    });

    await expect(
      runMicroDetectivesPipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "B" }
      )
    ).rejects.toBeInstanceOf(PipelinePause);

    await appendHumanReview(run.runId, {
      schema_version: "1.0.0",
      gate_id: "GATE_2_TRUTH_LOCK",
      status: "approve",
      notes: "",
      requested_changes: [],
      submitted_at: new Date().toISOString()
    });

    await runMicroDetectivesPipeline(
      { runId: run.runId, topic: run.topic, settings: run.settings },
      runs,
      { signal: new AbortController().signal, startFrom: "C" }
    ).catch(() => undefined);

    expect(microWorldCalls).toBe(2);
    const durations = JSON.parse(
      await fs.readFile(path.join(runIntermediateDirAbs(run.runId), "agent_call_durations_C.json"), "utf8")
    ) as { calls: Array<{ agentKey: string; status: string }> };
    const rows = durations.calls.filter((row) => row.agentKey === "microWorldMap");
    expect(rows.map((row) => row.status)).toEqual(["error", "ok"]);
  });

  it("backfills empty MicroWorld citation buckets before persisting the authored artifact", async () => {
    (agentsMock as unknown as MockAgentsModule).__setMockRunnerHandler((agent, prompt) => {
      const topic = parseTopic(prompt);
      const deckLengthMain = parseDeckLength(prompt);
      const deckLengthConstraintEnabled = parseDeckLengthConstraintEnabled(prompt);
      const audienceLevel = parseAudience(prompt);
      const base = {
        topic,
        audienceLevel,
        deckLengthMain,
        deckLengthConstraintEnabled,
        kbContext: "## Medical / Clinical KB\n- deterministic test context"
      } as const;
      const dossier = generateDiseaseDossier(base);
      const pitch = generateEpisodePitch(base, dossier);
      const truth = generateTruthModel(base, dossier, pitch);
      const deck = generateV2DeckSpec({ topic, deckLengthMain, deckLengthConstraintEnabled, audienceLevel });
      const differential = generateDifferentialCast(deck, dossier, truth);
      const clueGraph = generateClueGraph(deck, dossier, differential);
      const microWorld = generateMicroWorldMap(deck, dossier, truth);
      const dramaPlan = generateDramaPlan(deck, truth);
      const setpiecePlan = generateSetpiecePlan(deck, microWorld, dossier);
      const storyBlueprint = buildStoryBlueprintFallback({ topic, clueObligations: clueGraph.clues.map((clue) => clue.clue_id) });
      const actOutline = buildActOutlineFallback({ deck, storyBlueprint });

      const name = agent?.name ?? "";
      if (name === "KB Compiler") {
        return {
          finalOutput: {
            kb_context: "## Medical / Clinical KB\n- deterministic test context\n\n## Characters & Story Constraints\n- keep continuity\n\n## Visual Style / Shot Constraints\n- cinematic"
          }
        };
      }
      if (name === "V2 Disease Research Desk") return { finalOutput: dossier };
      if (name === "V2 Episode Pitch Builder") return { finalOutput: pitch };
      if (name === "V2 Truth Model Engineer") return { finalOutput: truth };
      if (name === "V2 Differential Cast Director") return { finalOutput: differential };
      if (name === "V2 Clue Architect") return { finalOutput: clueGraph };
      if (name === "V2 Micro-World Mapper") {
        return {
          finalOutput: {
            ...microWorld,
            zones: microWorld.zones.map((zone) => ({ ...zone, citations: [] })),
            hazards: microWorld.hazards.map((hazard) => ({ ...hazard, citations: [] })),
            routes: microWorld.routes.map((route) => ({ ...route, citations: [] })),
            immune_law_enforcement_metaphors: microWorld.immune_law_enforcement_metaphors?.map((entry) => ({
              ...entry,
              citations: []
            })),
            visual_style_guide: {
              ...microWorld.visual_style_guide,
              citations: []
            }
          }
        };
      }
      if (name === "V2 Drama Architect") return { finalOutput: dramaPlan };
      if (name === "V2 Setpiece Choreographer") return { finalOutput: setpiecePlan };
      if (name === "V2 Story Blueprint Architect") return { finalOutput: storyBlueprint };
      if (name === "V2 Act Outline Architect") return { finalOutput: actOutline };
      if (name === "V2 Slide Block Author") {
        const plan = parseBlockPlan(prompt);
        return { finalOutput: makeSlideBlockForTest(plan, "clue", "REGEN") };
      }
      if (name === "V2 Deck Cohesion Pass") {
        return {
          finalOutput: {
            schema_version: "1.0.0",
            global_continuity_findings: ["Continuity pass completed."],
            act_obligation_gaps: [],
            must_fix_operations: [],
            narrative_risk_flags: []
          }
        };
      }
      if (name === "V2 Plot Director DeckSpec") return { finalOutput: deck };
      if (name === "V2 Reader Simulator") return { finalOutput: generateReaderSimReport(deck, truth, clueGraph) };
      if (name === "V2 Medical Fact Checker") return { finalOutput: generateMedFactcheckReport(deck, dossier) };
      return { finalOutput: { kb_context: "## Medical / Clinical KB\n- fallback" } };
    });

    const runs = new RunManager();
    const run = await runs.createRun("Micro world citation repair", {
      workflow: "v2_micro_detectives",
      generationProfile: "quality",
      adherenceMode: "strict",
      audienceLevel: "PHYSICIAN_LEVEL",
      deckLengthConstraintEnabled: false
    });

    await expect(
      runMicroDetectivesPipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "KB0" }
      )
    ).rejects.toBeInstanceOf(PipelinePause);

    await appendHumanReview(run.runId, {
      schema_version: "1.0.0",
      gate_id: "GATE_1_PITCH",
      status: "approve",
      notes: "",
      requested_changes: [],
      submitted_at: new Date().toISOString()
    });

    await expect(
      runMicroDetectivesPipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "B" }
      )
    ).rejects.toBeInstanceOf(PipelinePause);

    await appendHumanReview(run.runId, {
      schema_version: "1.0.0",
      gate_id: "GATE_2_TRUTH_LOCK",
      status: "approve",
      notes: "",
      requested_changes: [],
      submitted_at: new Date().toISOString()
    });

    await runMicroDetectivesPipeline(
      { runId: run.runId, topic: run.topic, settings: run.settings },
      runs,
      { signal: new AbortController().signal, startFrom: "C" }
    ).catch(() => undefined);

    const microWorldArtifact = JSON.parse(
      await fs.readFile(path.join(runIntermediateDirAbs(run.runId), "micro_world_map.json"), "utf8")
    ) as {
      zones: Array<{ citations: unknown[] }>;
      hazards: Array<{ citations: unknown[] }>;
      routes: Array<{ citations: unknown[] }>;
      immune_law_enforcement_metaphors?: Array<{ citations: unknown[] }>;
      visual_style_guide: { citations: unknown[] };
    };
    expect(microWorldArtifact.zones.every((zone) => zone.citations.length > 0)).toBe(true);
    expect(microWorldArtifact.hazards.every((hazard) => hazard.citations.length > 0)).toBe(true);
    expect(microWorldArtifact.routes.every((route) => route.citations.length > 0)).toBe(true);
    expect(microWorldArtifact.visual_style_guide.citations.length).toBeGreaterThan(0);
    expect(
      microWorldArtifact.immune_law_enforcement_metaphors?.every((entry) => entry.citations.length > 0) ?? true
    ).toBe(true);
  });

  it("backfills missing DramaPlan act debts before persisting the authored artifact", async () => {
    (agentsMock as unknown as MockAgentsModule).__setMockRunnerHandler((agent, prompt) => {
      const topic = parseTopic(prompt);
      const deckLengthMain = parseDeckLength(prompt);
      const deckLengthConstraintEnabled = parseDeckLengthConstraintEnabled(prompt);
      const audienceLevel = parseAudience(prompt);
      const base = {
        topic,
        audienceLevel,
        deckLengthMain,
        deckLengthConstraintEnabled,
        kbContext: "## Medical / Clinical KB\n- deterministic test context"
      } as const;
      const dossier = generateDiseaseDossier(base);
      const pitch = generateEpisodePitch(base, dossier);
      const truth = generateTruthModel(base, dossier, pitch);
      const deck = generateV2DeckSpec({ topic, deckLengthMain, deckLengthConstraintEnabled, audienceLevel });
      const differential = generateDifferentialCast(deck, dossier, truth);
      const clueGraph = generateClueGraph(deck, dossier, differential);
      const microWorld = generateMicroWorldMap(deck, dossier, truth);
      const dramaPlan = generateDramaPlan(deck, truth);
      const setpiecePlan = generateSetpiecePlan(deck, microWorld, dossier);
      const storyBlueprint = buildStoryBlueprintFallback({ topic, clueObligations: clueGraph.clues.map((clue) => clue.clue_id) });
      const actOutline = buildActOutlineFallback({ deck, storyBlueprint });

      const name = agent?.name ?? "";
      if (name === "KB Compiler") {
        return {
          finalOutput: {
            kb_context: "## Medical / Clinical KB\n- deterministic test context\n\n## Characters & Story Constraints\n- keep continuity\n\n## Visual Style / Shot Constraints\n- cinematic"
          }
        };
      }
      if (name === "V2 Disease Research Desk") return { finalOutput: dossier };
      if (name === "V2 Episode Pitch Builder") return { finalOutput: pitch };
      if (name === "V2 Truth Model Engineer") return { finalOutput: truth };
      if (name === "V2 Differential Cast Director") return { finalOutput: differential };
      if (name === "V2 Clue Architect") return { finalOutput: clueGraph };
      if (name === "V2 Micro-World Mapper") return { finalOutput: microWorld };
      if (name === "V2 Drama Architect") {
        return {
          finalOutput: {
            ...dramaPlan,
            chapter_or_act_setups: (dramaPlan.chapter_or_act_setups ?? []).map((setup) => {
              const { must_pay_by_end_of_act: _unusedMustPay, ...rest } = setup;
              return rest;
            })
          }
        };
      }
      if (name === "V2 Setpiece Choreographer") return { finalOutput: setpiecePlan };
      if (name === "V2 Story Blueprint Architect") return { finalOutput: storyBlueprint };
      if (name === "V2 Act Outline Architect") return { finalOutput: actOutline };
      if (name === "V2 Slide Block Author") {
        const plan = parseBlockPlan(prompt);
        return { finalOutput: makeSlideBlockForTest(plan, "clue", "REGEN") };
      }
      if (name === "V2 Narrative Intensifier") {
        return {
          finalOutput: {
            schema_version: "1.0.0",
            rationale: ["Tighten callbacks without changing act obligations."],
            operations: []
          }
        };
      }
      if (name === "V2 Deck Cohesion Pass") {
        return {
          finalOutput: {
            schema_version: "1.0.0",
            global_continuity_findings: ["Continuity pass completed."],
            act_obligation_gaps: [],
            must_fix_operations: [],
            narrative_risk_flags: []
          }
        };
      }
      if (name === "V2 Plot Director DeckSpec") return { finalOutput: deck };
      if (name === "V2 Reader Simulator") return { finalOutput: generateReaderSimReport(deck, truth, clueGraph) };
      if (name === "V2 Medical Fact Checker") return { finalOutput: generateMedFactcheckReport(deck, dossier) };
      return { finalOutput: { kb_context: "## Medical / Clinical KB\n- fallback" } };
    });

    const runs = new RunManager();
    const run = await runs.createRun("Drama debt repair", {
      workflow: "v2_micro_detectives",
      generationProfile: "quality",
      adherenceMode: "strict",
      audienceLevel: "PHYSICIAN_LEVEL",
      deckLengthConstraintEnabled: false
    });

    await expect(
      runMicroDetectivesPipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "KB0" }
      )
    ).rejects.toBeInstanceOf(PipelinePause);

    await appendHumanReview(run.runId, {
      schema_version: "1.0.0",
      gate_id: "GATE_1_PITCH",
      status: "approve",
      notes: "",
      requested_changes: [],
      submitted_at: new Date().toISOString()
    });

    await expect(
      runMicroDetectivesPipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "B" }
      )
    ).rejects.toBeInstanceOf(PipelinePause);

    await appendHumanReview(run.runId, {
      schema_version: "1.0.0",
      gate_id: "GATE_2_TRUTH_LOCK",
      status: "approve",
      notes: "",
      requested_changes: [],
      submitted_at: new Date().toISOString()
    });

    await runMicroDetectivesPipeline(
      { runId: run.runId, topic: run.topic, settings: run.settings },
      runs,
      { signal: new AbortController().signal, startFrom: "C" }
    ).catch(() => undefined);

    const dramaArtifact = JSON.parse(
      await fs.readFile(path.join(runIntermediateDirAbs(run.runId), "drama_plan.json"), "utf8")
    ) as { chapter_or_act_setups?: Array<{ must_pay_by_end_of_act?: string[] }> };
    expect(dramaArtifact.chapter_or_act_setups?.every((setup) => (setup.must_pay_by_end_of_act ?? []).length > 0)).toBe(true);
  });

  it("retries the first slide block once with a compact prompt after a timeout-like failure in quality mode", async () => {
    let blockCalls = 0;
    (agentsMock as unknown as MockAgentsModule).__setMockRunnerHandler((agent, prompt) => {
      const topic = parseTopic(prompt);
      const deckLengthMain = parseDeckLength(prompt);
      const deckLengthConstraintEnabled = parseDeckLengthConstraintEnabled(prompt);
      const audienceLevel = parseAudience(prompt);
      const base = {
        topic,
        audienceLevel,
        deckLengthMain,
        deckLengthConstraintEnabled,
        kbContext: "## Medical / Clinical KB\n- deterministic test context"
      } as const;
      const dossier = generateDiseaseDossier(base);
      const pitch = generateEpisodePitch(base, dossier);
      const truth = generateTruthModel(base, dossier, pitch);
      const deck = generateV2DeckSpec({ topic, deckLengthMain, deckLengthConstraintEnabled, audienceLevel });
      const differential = generateDifferentialCast(deck, dossier, truth);
      const clueGraph = generateClueGraph(deck, dossier, differential);
      const microWorld = generateMicroWorldMap(deck, dossier, truth);
      const dramaPlan = generateDramaPlan(deck, truth);
      const setpiecePlan = generateSetpiecePlan(deck, microWorld, dossier);
      const storyBlueprint = buildStoryBlueprintFallback({ topic, clueObligations: clueGraph.clues.map((clue) => clue.clue_id) });
      const actOutline = buildActOutlineFallback({ deck, storyBlueprint });

      const name = agent?.name ?? "";
      if (name === "KB Compiler") {
        return { finalOutput: { kb_context: "## Medical / Clinical KB\n- deterministic test context" } };
      }
      if (name === "V2 Disease Research Desk") return { finalOutput: dossier };
      if (name === "V2 Episode Pitch Builder") return { finalOutput: pitch };
      if (name === "V2 Truth Model Engineer") return { finalOutput: truth };
      if (name === "V2 Differential Cast Director") return { finalOutput: differential };
      if (name === "V2 Clue Architect") return { finalOutput: clueGraph };
      if (name === "V2 Micro-World Mapper") return { finalOutput: microWorld };
      if (name === "V2 Drama Architect") return { finalOutput: dramaPlan };
      if (name === "V2 Setpiece Choreographer") return { finalOutput: setpiecePlan };
      if (name === "V2 Story Blueprint Architect") return { finalOutput: storyBlueprint };
      if (name === "V2 Act Outline Architect") return { finalOutput: actOutline };
      if (name === "V2 Slide Block Author") {
        blockCalls += 1;
        if (blockCalls === 1) throw new Error("Child timeout for C:slideBlockAuthor after 300000ms");
        const plan = parseBlockPlan(prompt);
        return { finalOutput: makeSlideBlockForTest(plan, "clue", "REGEN") };
      }
      if (name === "V2 Deck Cohesion Pass") {
        return {
          finalOutput: {
            schema_version: "1.0.0",
            global_continuity_findings: ["Continuity pass completed."],
            act_obligation_gaps: [],
            must_fix_operations: [],
            narrative_risk_flags: []
          }
        };
      }
      if (name === "V2 Plot Director DeckSpec") return { finalOutput: deck };
      if (name === "V2 Reader Simulator") return { finalOutput: generateReaderSimReport(deck, truth, clueGraph) };
      if (name === "V2 Medical Fact Checker") return { finalOutput: generateMedFactcheckReport(deck, dossier) };
      return { finalOutput: { kb_context: "## Medical / Clinical KB\n- fallback" } };
    });

    const runs = new RunManager();
    const run = await runs.createRun("Block retry", {
      workflow: "v2_micro_detectives",
      generationProfile: "quality",
      adherenceMode: "strict",
      audienceLevel: "PHYSICIAN_LEVEL",
      deckLengthConstraintEnabled: false
    });

    await expect(
      runMicroDetectivesPipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "KB0" }
      )
    ).rejects.toBeInstanceOf(PipelinePause);
    await appendHumanReview(run.runId, {
      schema_version: "1.0.0",
      gate_id: "GATE_1_PITCH",
      status: "approve",
      notes: "",
      requested_changes: [],
      submitted_at: new Date().toISOString()
    });

    await expect(
      runMicroDetectivesPipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "B" }
      )
    ).rejects.toBeInstanceOf(PipelinePause);

    await appendHumanReview(run.runId, {
      schema_version: "1.0.0",
      gate_id: "GATE_2_TRUTH_LOCK",
      status: "approve",
      notes: "",
      requested_changes: [],
      submitted_at: new Date().toISOString()
    });

    await runMicroDetectivesPipeline(
      { runId: run.runId, topic: run.topic, settings: run.settings },
      runs,
      { signal: new AbortController().signal, startFrom: "C" }
    ).catch(() => undefined);

    expect(blockCalls).toBeGreaterThan(1);
    const durations = JSON.parse(
      await fs.readFile(path.join(runIntermediateDirAbs(run.runId), "agent_call_durations_C.json"), "utf8")
    ) as { calls: Array<{ agentKey: string; status: string }> };
    const rows = durations.calls.filter((row) => row.agentKey === "slideBlockAuthor");
    expect(rows[0]?.status).toBe("error");
    expect(rows[1]?.status).toBe("ok");
  });

  it("normalizes authored note_only and exhibit main-deck slides into story-forward modes in quality mode", async () => {
    const runs = new RunManager();
    const run = await runs.createRun("Delivery normalization", {
      workflow: "v2_micro_detectives",
      generationProfile: "quality",
      adherenceMode: "warn",
      audienceLevel: "PHYSICIAN_LEVEL",
      deckLengthConstraintEnabled: false
    });

    (agentsMock as unknown as MockAgentsModule).__setMockRunnerHandler((agent, prompt) => {
      const topic = parseTopic(prompt);
      const deckLengthMain = parseDeckLength(prompt);
      const deckLengthConstraintEnabled = parseDeckLengthConstraintEnabled(prompt);
      const audienceLevel = parseAudience(prompt);
      const base = {
        topic,
        audienceLevel,
        deckLengthMain,
        deckLengthConstraintEnabled,
        kbContext: "## Medical / Clinical KB\n- deterministic test context"
      } as const;
      const dossier = generateDiseaseDossier(base);
      const pitch = generateEpisodePitch(base, dossier);
      const truth = generateTruthModel(base, dossier, pitch);
      const deck = generateV2DeckSpec({ topic, deckLengthMain, deckLengthConstraintEnabled, audienceLevel });
      const differential = generateDifferentialCast(deck, dossier, truth);
      const clueGraph = generateClueGraph(deck, dossier, differential);
      const microWorld = generateMicroWorldMap(deck, dossier, truth);
      const dramaPlan = generateDramaPlan(deck, truth);
      const setpiecePlan = generateSetpiecePlan(deck, microWorld, dossier);
      const storyBlueprint = buildStoryBlueprintFallback({
        topic,
        clueObligations: clueGraph.clues.slice(0, 6).map((clue) => clue.clue_id)
      });
      const actOutline = buildActOutlineFallback({
        deck,
        storyBlueprint
      });

      const name = agent?.name ?? "";
      if (name === "KB Compiler") {
        return { finalOutput: { kb_context: "## Medical / Clinical KB\n- deterministic test context" } };
      }
      if (name === "V2 Disease Research Desk") return { finalOutput: dossier };
      if (name === "V2 Episode Pitch Builder") return { finalOutput: pitch };
      if (name === "V2 Truth Model Engineer") return { finalOutput: truth };
      if (name === "V2 Differential Cast Director") return { finalOutput: differential };
      if (name === "V2 Clue Architect") return { finalOutput: clueGraph };
      if (name === "V2 Micro-World Mapper") return { finalOutput: microWorld };
      if (name === "V2 Drama Architect") return { finalOutput: dramaPlan };
      if (name === "V2 Setpiece Choreographer") return { finalOutput: setpiecePlan };
      if (name === "V2 Story Blueprint Architect") return { finalOutput: storyBlueprint };
      if (name === "V2 Act Outline Architect") return { finalOutput: actOutline };
      if (name === "V2 Slide Block Author") {
        const plan = parseBlockPlan(prompt);
        const replacementSlides = deck.slides
          .filter((slide) => {
            const slideNumber = Number(slide.slide_id.replace(/^S/i, ""));
            return Number.isFinite(slideNumber) && slideNumber >= plan.start && slideNumber <= plan.end;
          })
          .map((slide, index) => {
            if (index === 0) {
              return {
                ...slide,
                medical_payload: {
                  ...slide.medical_payload,
                  delivery_mode: "note_only" as const
                }
              };
            }
            if (index === 1) {
              return {
                ...slide,
                medical_payload: {
                  ...slide.medical_payload,
                  delivery_mode: "exhibit" as const
                }
              };
            }
            return slide;
          });
        return {
          finalOutput: {
            schema_version: "1.0.0",
            block_id: plan.blockId,
            act_id: plan.actId,
            slide_range: { start: plan.start, end: plan.end },
            operations: [
              {
                op: "replace_window",
                start_slide_id: String(plan.start),
                end_slide_id: String(plan.end),
                replacement_slides: replacementSlides.map((slide) => ({
                  ...slide,
                  slide_id: `S${Number(slide.slide_id.replace(/^S/i, ""))}`
                })),
                reason: "Force authored non-story-forward modes for normalization coverage."
              }
            ],
            block_summary_out: "Normalized authored block."
          }
        };
      }
      if (name === "V2 Deck Cohesion Pass") {
        return {
          finalOutput: {
            schema_version: "1.0.0",
            global_continuity_findings: ["Continuity pass completed."],
            act_obligation_gaps: [],
            must_fix_operations: [],
            narrative_risk_flags: []
          }
        };
      }
      if (name === "V2 Plot Director DeckSpec") return { finalOutput: deck };
      if (name === "V2 Reader Simulator") return { finalOutput: generateReaderSimReport(deck, truth, clueGraph) };
      if (name === "V2 Medical Fact Checker") return { finalOutput: generateMedFactcheckReport(deck, dossier) };
      return { finalOutput: { kb_context: "## Medical / Clinical KB\n- fallback" } };
    });

    await expect(
      runMicroDetectivesPipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "KB0" }
      )
    ).rejects.toBeInstanceOf(PipelinePause);
    await appendHumanReview(run.runId, {
      schema_version: "1.0.0",
      gate_id: "GATE_1_PITCH",
      status: "approve",
      notes: "",
      requested_changes: [],
      submitted_at: new Date().toISOString()
    });
    await expect(
      runMicroDetectivesPipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "B" }
      )
    ).rejects.toBeInstanceOf(PipelinePause);
    await appendHumanReview(run.runId, {
      schema_version: "1.0.0",
      gate_id: "GATE_2_TRUTH_LOCK",
      status: "approve",
      notes: "",
      requested_changes: [],
      submitted_at: new Date().toISOString()
    });

    await runMicroDetectivesPipeline(
      { runId: run.runId, topic: run.topic, settings: run.settings },
      runs,
      { signal: new AbortController().signal, startFrom: "C" }
    ).catch(() => undefined);

    const adjustmentsRaw = await fs.readFile(
      path.join(runIntermediateDirAbs(run.runId), "quality_delivery_mode_adjustments_seed.json"),
      "utf8"
    );
    const adjustments = JSON.parse(adjustmentsRaw) as { adjustments: Array<{ slide_id: string; from: string; to: string }> };
    expect(adjustments.adjustments.some((row) => row.from === "note_only")).toBe(true);
    expect(adjustments.adjustments.some((row) => row.from === "exhibit")).toBe(true);
    expect(adjustments.adjustments.every((row) => ["clue", "dialogue", "action"].includes(row.to))).toBe(true);

    const deckSeedRaw = await fs.readFile(path.join(runIntermediateDirAbs(run.runId), "deck_spec_seed.json"), "utf8");
    const deckSeed = JSON.parse(deckSeedRaw) as {
      deck_meta: {
        authoring_provenance_counts?: {
          agent_authored?: number;
        };
      };
      slides: Array<{ slide_id: string; authoring_provenance?: string; medical_payload: { delivery_mode: string } }>;
    };
    expect(["clue", "dialogue", "action"]).toContain(
      deckSeed.slides.find((slide) => slide.slide_id === "S01")?.medical_payload.delivery_mode
    );
    expect(["clue", "dialogue", "action"]).toContain(
      deckSeed.slides.find((slide) => slide.slide_id === "S02")?.medical_payload.delivery_mode
    );
    expect(deckSeed.deck_meta.authoring_provenance_counts?.agent_authored).toBeGreaterThan(0);
    expect(deckSeed.slides.find((slide) => slide.slide_id === "S01")?.authoring_provenance).toBe("agent_authored");
  });

  it("retries deck cohesion pass with compact context after a transport abort in quality mode", async () => {
    const runs = new RunManager();
    const run = await runs.createRun("Cohesion retry", {
      workflow: "v2_micro_detectives",
      generationProfile: "quality",
      adherenceMode: "strict",
      audienceLevel: "PHYSICIAN_LEVEL",
      deckLengthConstraintEnabled: false
    });

    (agentsMock as unknown as MockAgentsModule).__setMockRunnerHandler((agent, prompt) => {
      const topic = parseTopic(prompt);
      const deckLengthMain = parseDeckLength(prompt);
      const deckLengthConstraintEnabled = parseDeckLengthConstraintEnabled(prompt);
      const audienceLevel = parseAudience(prompt);
      const base = {
        topic,
        audienceLevel,
        deckLengthMain,
        deckLengthConstraintEnabled,
        kbContext: "## Medical / Clinical KB\n- deterministic test context"
      } as const;
      const dossier = generateDiseaseDossier(base);
      const pitch = generateEpisodePitch(base, dossier);
      const truth = generateTruthModel(base, dossier, pitch);
      const deck = generateV2DeckSpec({ topic, deckLengthMain, deckLengthConstraintEnabled, audienceLevel });
      const differential = generateDifferentialCast(deck, dossier, truth);
      const clueGraph = generateClueGraph(deck, dossier, differential);
      const microWorld = generateMicroWorldMap(deck, dossier, truth);
      const dramaPlan = generateDramaPlan(deck, truth);
      const setpiecePlan = generateSetpiecePlan(deck, microWorld, dossier);
      const storyBlueprint = buildStoryBlueprintFallback({
        topic,
        clueObligations: clueGraph.clues.slice(0, 6).map((clue) => clue.clue_id)
      });
      const actOutline = buildActOutlineFallback({
        deck,
        storyBlueprint
      });

      const name = agent?.name ?? "";
      if (name === "KB Compiler") {
        return { finalOutput: { kb_context: "## Medical / Clinical KB\n- deterministic test context" } };
      }
      if (name === "V2 Disease Research Desk") return { finalOutput: dossier };
      if (name === "V2 Episode Pitch Builder") return { finalOutput: pitch };
      if (name === "V2 Truth Model Engineer") return { finalOutput: truth };
      if (name === "V2 Differential Cast Director") return { finalOutput: differential };
      if (name === "V2 Clue Architect") return { finalOutput: clueGraph };
      if (name === "V2 Micro-World Mapper") return { finalOutput: microWorld };
      if (name === "V2 Drama Architect") return { finalOutput: dramaPlan };
      if (name === "V2 Setpiece Choreographer") return { finalOutput: setpiecePlan };
      if (name === "V2 Story Blueprint Architect") return { finalOutput: storyBlueprint };
      if (name === "V2 Act Outline Architect") return { finalOutput: actOutline };
      if (name === "V2 Slide Block Author") {
        const plan = parseBlockPlan(prompt);
        const replacementSlides = deck.slides.filter((slide) => {
          const slideNumber = Number(slide.slide_id.replace(/^S/i, ""));
          return Number.isFinite(slideNumber) && slideNumber >= plan.start && slideNumber <= plan.end;
        });
        return {
          finalOutput: {
            schema_version: "1.0.0",
            block_id: plan.blockId,
            act_id: plan.actId,
            slide_range: { start: plan.start, end: plan.end },
            operations: [
              {
                op: "replace_window",
                start_slide_id: String(plan.start),
                end_slide_id: String(plan.end),
                replacement_slides: replacementSlides.map((slide) => ({
                  ...slide,
                  slide_id: `S${Number(slide.slide_id.replace(/^S/i, ""))}`
                })),
                reason: "Compact cohesion retry test."
              }
            ],
            block_summary_out: "Authored block."
          }
        };
      }
      if (name === "V2 Deck Cohesion Pass") {
        if (!prompt.includes("DECK SPEC SUMMARY")) {
          throw new Error("Request was aborted");
        }
        return {
          finalOutput: {
            schema_version: "1.0.0",
            global_continuity_findings: ["Compact retry restored continuity review."],
            act_obligation_gaps: [],
            must_fix_operations: [],
            narrative_risk_flags: []
          }
        };
      }
      if (name === "V2 Narrative Intensifier") return { finalOutput: makeNarrativeIntensifierPass(deck) };
      if (name === "V2 Plot Director DeckSpec") return { finalOutput: deck };
      if (name === "V2 Reader Simulator") return { finalOutput: generateReaderSimReport(deck, truth, clueGraph) };
      if (name === "V2 Medical Fact Checker") return { finalOutput: generateMedFactcheckReport(deck, dossier) };
      return { finalOutput: { kb_context: "## Medical / Clinical KB\n- fallback" } };
    });

    await expect(
      runMicroDetectivesPipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "KB0" }
      )
    ).rejects.toBeInstanceOf(PipelinePause);
    await appendHumanReview(run.runId, {
      schema_version: "1.0.0",
      gate_id: "GATE_1_PITCH",
      status: "approve",
      notes: "",
      requested_changes: [],
      submitted_at: new Date().toISOString()
    });
    await expect(
      runMicroDetectivesPipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "B" }
      )
    ).rejects.toBeInstanceOf(PipelinePause);
    await appendHumanReview(run.runId, {
      schema_version: "1.0.0",
      gate_id: "GATE_2_TRUTH_LOCK",
      status: "approve",
      notes: "",
      requested_changes: [],
      submitted_at: new Date().toISOString()
    });

    await runMicroDetectivesPipeline(
      { runId: run.runId, topic: run.topic, settings: run.settings },
      runs,
      { signal: new AbortController().signal, startFrom: "C" }
    ).catch(() => undefined);

    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "deck_cohesion_pass.json"))).resolves.toBeTruthy();
    const manifestRaw = await fs.readFile(path.join(runIntermediateDirAbs(run.runId), "deck_authoring_context_manifest.json"), "utf8");
    const manifest = JSON.parse(manifestRaw) as {
      attempts: Array<{ attempt_id: string; context_mode: string; result: string }>;
    };
    expect(
      manifest.attempts.some((attempt) => attempt.attempt_id === "deckCohesionPass.primary" && attempt.result === "error")
    ).toBe(true);
    expect(
      manifest.attempts.some((attempt) => attempt.attempt_id === "deckCohesionPass.primary" && attempt.context_mode === "compact" && attempt.result === "success")
    ).toBe(true);
  });

  it("rejects cohesion-pass operations that compress large act windows in quality mode", async () => {
    const runs = new RunManager();
    const run = await runs.createRun("Guardrail CAP", {
      workflow: "v2_micro_detectives",
      generationProfile: "quality",
      adherenceMode: "strict",
      audienceLevel: "PHYSICIAN_LEVEL",
      deckLengthConstraintEnabled: false
    });

    (agentsMock as unknown as MockAgentsModule).__setMockRunnerHandler((agent, prompt) => {
      const topic = parseTopic(prompt);
      const deckLengthMain = parseDeckLength(prompt);
      const deckLengthConstraintEnabled = parseDeckLengthConstraintEnabled(prompt);
      const audienceLevel = parseAudience(prompt);
      const base = {
        topic,
        audienceLevel,
        deckLengthMain,
        deckLengthConstraintEnabled,
        kbContext: "## Medical / Clinical KB\n- deterministic test context"
      } as const;
      const dossier = generateDiseaseDossier(base);
      const pitch = generateEpisodePitch(base, dossier);
      const truth = generateTruthModel(base, dossier, pitch);
      const deck = generateV2DeckSpec({ topic, deckLengthMain, deckLengthConstraintEnabled, audienceLevel });
      const differential = generateDifferentialCast(deck, dossier, truth);
      const clueGraph = generateClueGraph(deck, dossier, differential);
      const microWorld = generateMicroWorldMap(deck, dossier, truth);
      const dramaPlan = generateDramaPlan(deck, truth);
      const setpiecePlan = generateSetpiecePlan(deck, microWorld, dossier);
      const storyBlueprint = buildStoryBlueprintFallback({
        topic,
        clueObligations: clueGraph.clues.slice(0, 6).map((clue) => clue.clue_id)
      });
      const actOutline = buildActOutlineFallback({
        deck,
        storyBlueprint
      });

      const name = agent?.name ?? "";
      if (name === "KB Compiler") {
        return { finalOutput: { kb_context: "## Medical / Clinical KB\n- deterministic test context" } };
      }
      if (name === "V2 Disease Research Desk") return { finalOutput: dossier };
      if (name === "V2 Episode Pitch Builder") return { finalOutput: pitch };
      if (name === "V2 Truth Model Engineer") return { finalOutput: truth };
      if (name === "V2 Differential Cast Director") return { finalOutput: differential };
      if (name === "V2 Clue Architect") return { finalOutput: clueGraph };
      if (name === "V2 Micro-World Mapper") return { finalOutput: microWorld };
      if (name === "V2 Drama Architect") return { finalOutput: dramaPlan };
      if (name === "V2 Setpiece Choreographer") return { finalOutput: setpiecePlan };
      if (name === "V2 Story Blueprint Architect") return { finalOutput: storyBlueprint };
      if (name === "V2 Act Outline Architect") return { finalOutput: actOutline };
      if (name === "V2 Slide Block Author") {
        const plan = parseBlockPlan(prompt);
        const replacementSlides = deck.slides.filter((slide) => {
          const slideNumber = Number(slide.slide_id.replace(/^S/i, ""));
          return Number.isFinite(slideNumber) && slideNumber >= plan.start && slideNumber <= plan.end;
        });
        return {
          finalOutput: {
            schema_version: "1.0.0",
            block_id: plan.blockId,
            act_id: plan.actId,
            slide_range: { start: plan.start, end: plan.end },
            operations: [
              {
                op: "replace_window",
                start_slide_id: String(plan.start),
                end_slide_id: String(plan.end),
                replacement_slides: replacementSlides.map((slide) => ({
                  ...slide,
                  slide_id: `S${Number(slide.slide_id.replace(/^S/i, ""))}`
                })),
                reason: "Primary authored block."
              }
            ],
            block_summary_out: "Authored block."
          }
        };
      }
      if (name === "V2 Deck Cohesion Pass") {
        return {
          finalOutput: {
            schema_version: "1.0.0",
            global_continuity_findings: ["Attempted large-window compression."],
            act_obligation_gaps: ["Act windows are repetitive."],
            must_fix_operations: [
              {
                op: "replace_window",
                start_slide_id: "S02",
                end_slide_id: "S21",
                replacement_slides: deck.slides.slice(1, 8),
                reason: "Illegally compress Act I into a short canonical sequence."
              },
              {
                op: "replace_window",
                start_slide_id: "S22",
                end_slide_id: "S41",
                replacement_slides: deck.slides.slice(21, 25),
                reason: "Illegally compress Act II."
              }
            ],
            narrative_risk_flags: []
          }
        };
      }
      if (name === "V2 Narrative Intensifier") return { finalOutput: makeNarrativeIntensifierPass(deck) };
      if (name === "V2 Plot Director DeckSpec") return { finalOutput: deck };
      if (name === "V2 Reader Simulator") return { finalOutput: generateReaderSimReport(deck, truth, clueGraph) };
      if (name === "V2 Medical Fact Checker") return { finalOutput: generateMedFactcheckReport(deck, dossier) };
      return { finalOutput: { kb_context: "## Medical / Clinical KB\n- fallback" } };
    });

    await expect(
      runMicroDetectivesPipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "KB0" }
      )
    ).rejects.toBeInstanceOf(PipelinePause);
    await appendHumanReview(run.runId, {
      schema_version: "1.0.0",
      gate_id: "GATE_1_PITCH",
      status: "approve",
      notes: "",
      requested_changes: [],
      submitted_at: new Date().toISOString()
    });
    await expect(
      runMicroDetectivesPipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "B" }
      )
    ).rejects.toBeInstanceOf(PipelinePause);
    await appendHumanReview(run.runId, {
      schema_version: "1.0.0",
      gate_id: "GATE_2_TRUTH_LOCK",
      status: "approve",
      notes: "",
      requested_changes: [],
      submitted_at: new Date().toISOString()
    });

    await runMicroDetectivesPipeline(
      { runId: run.runId, topic: run.topic, settings: run.settings },
      runs,
      { signal: new AbortController().signal, startFrom: "C" }
    ).catch(() => undefined);

    const guardRaw = await fs.readFile(path.join(runIntermediateDirAbs(run.runId), "deck_cohesion_pass_guardrail.json"), "utf8");
    const guard = JSON.parse(guardRaw) as {
      accepted_operation_count: number;
      warnings: string[];
    };
    expect(guard.accepted_operation_count).toBe(0);
    expect(guard.warnings.some((warning) => warning.includes("over-compress") || warning.includes("span="))).toBe(true);

    const assembledRaw = await fs.readFile(path.join(runIntermediateDirAbs(run.runId), "deck_spec_assembled.json"), "utf8");
    const seedRaw = await fs.readFile(path.join(runIntermediateDirAbs(run.runId), "deck_spec_seed.json"), "utf8");
    const assembled = JSON.parse(assembledRaw) as { slides: Array<unknown> };
    const seed = JSON.parse(seedRaw) as { slides: Array<unknown> };
    expect(seed.slides).toHaveLength(assembled.slides.length);
    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "deck_spec_after_cohesion_pass.json"))).rejects.toThrow();
  });

  it("pauses at Gate 3 after phase-3 artifacts, then resumes C for phase-4 packaging", async () => {
    const runs = new RunManager();
    const run = await runs.createRun("COPD", {
      workflow: "v2_micro_detectives",
      deckLengthMain: 30,
      deckLengthConstraintEnabled: true,
      audienceLevel: "PHYSICIAN_LEVEL",
      adherenceMode: "warn"
    });

    await expect(
      runMicroDetectivesPipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "KB0" }
      )
    ).rejects.toBeInstanceOf(PipelinePause);

    await appendHumanReview(run.runId, {
      schema_version: "1.0.0",
      gate_id: "GATE_1_PITCH",
      status: "approve",
      notes: "",
      requested_changes: [],
      submitted_at: new Date().toISOString()
    });
    await expect(
      runMicroDetectivesPipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "B" }
      )
    ).rejects.toBeInstanceOf(PipelinePause);

    await appendHumanReview(run.runId, {
      schema_version: "1.0.0",
      gate_id: "GATE_2_TRUTH_LOCK",
      status: "approve",
      notes: "",
      requested_changes: [],
      submitted_at: new Date().toISOString()
    });

    await expect(
      runMicroDetectivesPipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "C" }
      )
    ).rejects.toBeInstanceOf(PipelinePause);

    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "deck_spec.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "deck_spec_lint_report.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "differential_cast.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "clue_graph.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "reader_sim_report.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "med_factcheck_report.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "qa_report.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "semantic_acceptance_report.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "qa_block_heatmap_loop1.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "narrative_intensifier_pass.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "v2_stage_authoring_provenance.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "story_beats_alignment_report.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "citation_traceability.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "agent_call_durations.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "story_blueprint.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "act_outline.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "slide_block_plan.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "slide_block_checkpoint_index.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "deck_assembly_report.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "deck_spec_assembled.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "narrative_state_current.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "deck_authoring_context_manifest.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "GATE_3_STORYBOARD_REQUIRED.json"))).resolves.toBeTruthy();
    const filesBeforeGate3 = await fs.readdir(runIntermediateDirAbs(run.runId));
    expect(filesBeforeGate3.some((name) => /^slide_block_ACT\d_B\d+\.json$/i.test(name))).toBe(true);
    expect(filesBeforeGate3.some((name) => /^narrative_state_block_ACT\d_B\d+\.json$/i.test(name))).toBe(true);
    expect(filesBeforeGate3.some((name) => /^block_authoring_ops_ACT\d_B\d+\.json$/i.test(name))).toBe(true);
    const contextManifestRaw = await fs.readFile(path.join(runIntermediateDirAbs(run.runId), "deck_authoring_context_manifest.json"), "utf8");
    const contextManifest = JSON.parse(contextManifestRaw) as {
      attempts: Array<{ context_mode: "full" | "compact"; result: "success" | "error" | "skipped" }>;
    };
    expect(contextManifest.attempts.length).toBeGreaterThan(0);
    expect(contextManifest.attempts.some((attempt) => attempt.context_mode === "full")).toBe(true);
    expect(contextManifest.attempts.some((attempt) => attempt.result === "success")).toBe(true);
    const deckSeedRaw = await fs.readFile(path.join(runIntermediateDirAbs(run.runId), "deck_spec_seed.json"), "utf8");
    const deckSeed = JSON.parse(deckSeedRaw) as {
      deck_meta: { episode_title: string };
      appendix_slides: Array<{ title: string; hook?: string }>;
    };
    expect(deckSeed.deck_meta.episode_title).not.toContain("[SCAFFOLD]");
    expect(deckSeed.appendix_slides.every((slide) => !slide.title.includes("[SCAFFOLD]") && !(slide.hook ?? "").includes("[SCAFFOLD]"))).toBe(true);

    await appendHumanReview(run.runId, {
      schema_version: "1.0.0",
      gate_id: "GATE_3_STORYBOARD",
      status: "approve",
      notes: "",
      requested_changes: [],
      submitted_at: new Date().toISOString()
    });

    await expect(
      runMicroDetectivesPipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "C" }
      )
    ).rejects.toBeInstanceOf(PipelinePause);

    await appendHumanReview(run.runId, {
      schema_version: "1.0.0",
      gate_id: "GATE_4_FINAL",
      status: "approve",
      notes: "",
      requested_changes: [],
      submitted_at: new Date().toISOString()
    });

    await runMicroDetectivesPipeline(
      { runId: run.runId, topic: run.topic, settings: run.settings },
      runs,
      { signal: new AbortController().signal, startFrom: "C" }
    );

    await expect(fs.stat(path.join(runFinalDirAbs(run.runId), "deck_spec.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runFinalDirAbs(run.runId), "V2_MAIN_DECK_RENDER_PLAN.md"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runFinalDirAbs(run.runId), "V2_APPENDIX_RENDER_PLAN.md"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runFinalDirAbs(run.runId), "V2_SPEAKER_NOTES_WITH_CITATIONS.md"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "micro_world_map.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "drama_plan.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "setpiece_plan.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runFinalDirAbs(run.runId), "v2_template_registry.json"))).resolves.toBeTruthy();

    const status = runs.getRun(run.runId);
    expect(status?.steps.C.status).toBe("done");
  });

  it("backfills supporting citations when the med-factcheck agent returns empty citation arrays", () => {
    const topic = "Community acquired pneumonia";
    const deckLengthMain = 30 as const;
    const deckLengthConstraintEnabled = true;
    const audienceLevel = "PHYSICIAN_LEVEL" as const;
    const base = {
      topic,
      audienceLevel,
      deckLengthMain,
      deckLengthConstraintEnabled,
      kbContext: "## Medical / Clinical KB\n- deterministic test context"
    } as const;
    const dossier = generateDiseaseDossier(base);
    const deck = generateV2DeckSpec({ topic, deckLengthMain, deckLengthConstraintEnabled, audienceLevel });
    const deterministic = generateMedFactcheckReport(deck, dossier);
    const baseIssue = deterministic.issues[0] ?? {
      issue_id: "MED-EMPTY-001",
      severity: "major",
      type: "unsupported_inference" as const,
      claim: "Slide S01 overstates certainty.",
      why_wrong: "The claim is not grounded in cited dossier evidence.",
      suggested_fix: "Re-anchor S01 to the dossier evidence.",
      supporting_citations: []
    };

    const normalized = __testOnlyNormalizeMedFactcheckReport(
      {
        ...deterministic,
        pass: false,
        issues: [
          {
            ...baseIssue,
            claim: baseIssue.claim.includes("S01") ? baseIssue.claim : `Slide S01: ${baseIssue.claim}`,
            supporting_citations: []
          }
        ],
        required_fixes: [
          {
            fix_id: "MED-FIX-001",
            type: "medical_correction",
            priority: "must",
            description: baseIssue.suggested_fix,
            targets: ["S01"]
          }
        ],
        summary: "Agent returned an issue without citations."
      },
      deck,
      dossier
    );

    expect(normalized.issues.length).toBeGreaterThan(0);
    expect(normalized.issues.every((issue) => issue.supporting_citations.length > 0)).toBe(true);
  });

  it("backfills missing slide-block differential updates before strict parsing", () => {
    const deck = generateV2DeckSpec({
      topic: "Community acquired pneumonia",
      deckLengthMain: 30,
      deckLengthConstraintEnabled: true,
      audienceLevel: "PHYSICIAN_LEVEL"
    });
    const baseSlide = deck.slides[0]!;

    const normalized = __testOnlyNormalizeSlideBlockAuthorOutput(
      {
        schema_version: "1.0.0",
        block_id: "ACT1_B01",
        act_id: "ACT1",
        slide_range: { start: 1, end: 1 },
        operations: [
          {
            op: "replace_slide",
            slide_id: baseSlide.slide_id,
            replacement_slide: {
              ...baseSlide,
              title: "Reauthored title",
              speaker_notes: {
                narrative_notes: "Updated narrative notes.",
                medical_reasoning: baseSlide.speaker_notes.medical_reasoning,
                citations: baseSlide.speaker_notes.citations
              }
            }
          }
        ],
        block_summary_out: "Updated block"
      },
      deck
    );

    expect(normalized.operations?.[0]?.replacement_slide?.speaker_notes.differential_update.top_dx_ids.length).toBeGreaterThan(0);
    expect(normalized.operations?.[0]?.replacement_slide?.speaker_notes.differential_update.why).toBeTruthy();
  });

  it("normalizes invalid slide-block beat types before strict parsing", () => {
    const deck = generateV2DeckSpec({
      topic: "Community acquired pneumonia",
      deckLengthMain: 30,
      deckLengthConstraintEnabled: true,
      audienceLevel: "PHYSICIAN_LEVEL"
    });
    const baseSlide = deck.slides[5]!;

    const normalized = __testOnlyNormalizeSlideBlockAuthorOutput(
      {
        schema_version: "1.0.0",
        block_id: "ACT1_B01",
        act_id: "ACT1",
        slide_range: { start: 1, end: 1 },
        operations: [
          {
            op: "replace_slide",
            slide_id: baseSlide.slide_id,
            replacement_slide: {
              ...baseSlide,
              beat_type: "bureaucratic_detour",
              title: "Reauthored title",
              speaker_notes: {
                ...baseSlide.speaker_notes
              }
            }
          }
        ],
        block_summary_out: "Updated block"
      },
      deck
    );

    expect(normalized.operations?.[0]?.replacement_slide?.beat_type).toBe(baseSlide.beat_type);
  });

  it("ignores non-canonical root keys on slide-block agent output before strict parsing", () => {
    const deck = generateV2DeckSpec({
      topic: "Community acquired pneumonia",
      deckLengthMain: 30,
      deckLengthConstraintEnabled: true,
      audienceLevel: "PHYSICIAN_LEVEL"
    });
    const baseSlide = deck.slides[0]!;

    const normalized = __testOnlyNormalizeSlideBlockAuthorOutput(
      {
        schema_version: "1.0.0",
        block_id: "ACT1_B01",
        act_id: "ACT1",
        slide_range: { start: 1, end: 1 },
        reason: "extra commentary from the model",
        operations: [
          {
            op: "replace_slide",
            slide_id: baseSlide.slide_id,
            replacement_slide: {
              ...baseSlide,
              speaker_notes: {
                ...baseSlide.speaker_notes
              }
            }
          }
        ],
        block_summary_out: "Updated block"
      },
      deck
    );

    expect(normalized.block_id).toBe("ACT1_B01");
    expect(normalized.operations?.[0]?.replacement_slide?.slide_id).toBe(baseSlide.slide_id);
  });

  it("fails phase-4 packaging in quality mode when authored micro/drama/setpiece artifacts are missing", async () => {
    const runs = new RunManager();
    const run = await runs.createRun("Interstitial nephritis", {
      workflow: "v2_micro_detectives",
      deckLengthMain: 30,
      deckLengthConstraintEnabled: true,
      audienceLevel: "PHYSICIAN_LEVEL",
      generationProfile: "quality",
      adherenceMode: "warn"
    });

    await expect(
      runMicroDetectivesPipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "KB0" }
      )
    ).rejects.toBeInstanceOf(PipelinePause);

    await appendHumanReview(run.runId, {
      schema_version: "1.0.0",
      gate_id: "GATE_1_PITCH",
      status: "approve",
      notes: "",
      requested_changes: [],
      submitted_at: new Date().toISOString()
    });
    await expect(
      runMicroDetectivesPipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "B" }
      )
    ).rejects.toBeInstanceOf(PipelinePause);

    await appendHumanReview(run.runId, {
      schema_version: "1.0.0",
      gate_id: "GATE_2_TRUTH_LOCK",
      status: "approve",
      notes: "",
      requested_changes: [],
      submitted_at: new Date().toISOString()
    });
    await expect(
      runMicroDetectivesPipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "C" }
      )
    ).rejects.toBeInstanceOf(PipelinePause);

    await appendHumanReview(run.runId, {
      schema_version: "1.0.0",
      gate_id: "GATE_3_STORYBOARD",
      status: "approve",
      notes: "",
      requested_changes: [],
      submitted_at: new Date().toISOString()
    });

    await fs.unlink(path.join(runIntermediateDirAbs(run.runId), "micro_world_map.json"));

    await expect(
      runMicroDetectivesPipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "C" }
      )
    ).rejects.toThrow(/Missing required authored artifact micro_world_map\.json/i);
  });

  it("writes story-beats alignment warnings when beats exist without chapter outline in warn mode", async () => {
    const runs = new RunManager();
    const run = await runs.createRun("Story beats warn branch", {
      workflow: "v2_micro_detectives",
      deckLengthMain: 30,
      deckLengthConstraintEnabled: true,
      audienceLevel: "PHYSICIAN_LEVEL",
      generationProfile: "quality",
      adherenceMode: "warn"
    });

    await expect(
      runMicroDetectivesPipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "KB0" }
      )
    ).rejects.toBeInstanceOf(PipelinePause);

    await appendHumanReview(run.runId, {
      schema_version: "1.0.0",
      gate_id: "GATE_1_PITCH",
      status: "approve",
      notes: "",
      requested_changes: [],
      submitted_at: new Date().toISOString()
    });
    await expect(
      runMicroDetectivesPipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "B" }
      )
    ).rejects.toBeInstanceOf(PipelinePause);

    await appendHumanReview(run.runId, {
      schema_version: "1.0.0",
      gate_id: "GATE_2_TRUTH_LOCK",
      status: "approve",
      notes: "",
      requested_changes: [],
      submitted_at: new Date().toISOString()
    });

    const beatsPath = path.join(runIntermediateDirAbs(run.runId), "story_beats.json");
    await fs.mkdir(path.dirname(beatsPath), { recursive: true });
    await fs.writeFile(
      beatsPath,
      JSON.stringify(
        {
          schema_version: "1.0.0",
          topic: run.topic,
          intro: {
            user_notes: "",
            beat_md: "Quirky office opening before the case call.",
            generation_count: 1
          },
          outro: {
            user_notes: "",
            beat_md: "Back at the office for a full-circle callback ending.",
            generation_count: 1
          },
          topic_area_beats: {},
          updated_at: new Date().toISOString()
        },
        null,
        2
      ),
      "utf8"
    );

    await expect(
      runMicroDetectivesPipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "C" }
      )
    ).rejects.toBeInstanceOf(PipelinePause);

    const alignmentRaw = await fs.readFile(path.join(runIntermediateDirAbs(run.runId), "story_beats_alignment_report.json"), "utf8");
    const alignment = JSON.parse(alignmentRaw) as {
      lint_status: string;
      warnings: string[];
      chapter_outline_present: boolean;
      coverage?: { block_aligned_beats?: number; block_aligned_ratio?: number };
      block_coverage?: Array<{ block_id: string }>;
      beat_slide_map?: Array<{ beat_id: string }>;
    };
    expect(alignment.lint_status).toBe("warn");
    expect(alignment.chapter_outline_present).toBe(false);
    expect(alignment.warnings.some((warning) => warning.toLowerCase().includes("chapter outline missing"))).toBe(true);
    expect(Number(alignment.coverage?.block_aligned_beats ?? -1)).toBeGreaterThanOrEqual(0);
    expect(Number(alignment.coverage?.block_aligned_ratio ?? -1)).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(alignment.block_coverage)).toBe(true);
    expect(Array.isArray(alignment.beat_slide_map)).toBe(true);
  });

  it("fails step C in strict mode when semantic acceptance thresholds are not met", async () => {
    const runs = new RunManager();
    const run = await runs.createRun("Semantic threshold strict fail", {
      workflow: "v2_micro_detectives",
      deckLengthMain: 30,
      deckLengthConstraintEnabled: true,
      audienceLevel: "PHYSICIAN_LEVEL",
      adherenceMode: "strict"
    });

    await expect(
      runMicroDetectivesPipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "KB0" }
      )
    ).rejects.toBeInstanceOf(PipelinePause);

    await appendHumanReview(run.runId, {
      schema_version: "1.0.0",
      gate_id: "GATE_1_PITCH",
      status: "approve",
      notes: "",
      requested_changes: [],
      submitted_at: new Date().toISOString()
    });
    await expect(
      runMicroDetectivesPipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "B" }
      )
    ).rejects.toBeInstanceOf(PipelinePause);

    await appendHumanReview(run.runId, {
      schema_version: "1.0.0",
      gate_id: "GATE_2_TRUTH_LOCK",
      status: "approve",
      notes: "",
      requested_changes: [],
      submitted_at: new Date().toISOString()
    });

    const prevHybridThreshold = process.env.MMS_V2_MIN_HYBRID_SLIDE_QUALITY;
    const prevCitationThreshold = process.env.MMS_V2_MIN_CITATION_GROUNDING_COVERAGE;
    process.env.MMS_V2_MIN_HYBRID_SLIDE_QUALITY = "1";
    process.env.MMS_V2_MIN_CITATION_GROUNDING_COVERAGE = "1";

    try {
      (agentsMock as unknown as MockAgentsModule).__setMockRunnerHandler((agent, prompt) => {
        const topic = parseTopic(prompt);
        const deckLengthMain = parseDeckLength(prompt);
        const deckLengthConstraintEnabled = parseDeckLengthConstraintEnabled(prompt);
        const audienceLevel = parseAudience(prompt);
        const base = {
          topic,
          audienceLevel,
          deckLengthMain,
          deckLengthConstraintEnabled,
          kbContext: "## Medical / Clinical KB\n- deterministic test context"
        } as const;
        const dossier = generateDiseaseDossier(base);
        const pitch = generateEpisodePitch(base, dossier);
        const truth = generateTruthModel(base, dossier, pitch);
        const deck = generateV2DeckSpec({ topic, deckLengthMain, deckLengthConstraintEnabled, audienceLevel });
        const degradedDeck = {
          ...deck,
          slides: deck.slides.map((slide) => ({
            ...slide,
            medical_payload: {
              ...slide.medical_payload,
              delivery_mode: "note_only" as const,
              dossier_citations: []
            },
            speaker_notes: {
              ...slide.speaker_notes,
              citations: []
            }
          }))
        };
        const storyBlueprint = buildStoryBlueprintFallback({
          topic,
          clueObligations: []
        });
        const actOutline = buildActOutlineFallback({
          deck: degradedDeck,
          storyBlueprint
        });
        const differential = generateDifferentialCast(degradedDeck, dossier, truth);
        const clueGraph = generateClueGraph(degradedDeck, dossier, differential);
        const microWorld = generateMicroWorldMap(degradedDeck, dossier, truth);
        const dramaPlan = generateDramaPlan(degradedDeck, truth);
        const setpiecePlan = generateSetpiecePlan(degradedDeck, microWorld, dossier);

        const name = agent?.name ?? "";
        if (name === "KB Compiler") {
          return { finalOutput: { kb_context: "## Medical / Clinical KB\n- deterministic test context" } };
        }
        if (name === "V2 Disease Research Desk") return { finalOutput: dossier };
        if (name === "V2 Episode Pitch Builder") return { finalOutput: pitch };
        if (name === "V2 Truth Model Engineer") return { finalOutput: truth };
        if (name === "V2 Differential Cast Director") return { finalOutput: differential };
        if (name === "V2 Clue Architect") return { finalOutput: clueGraph };
        if (name === "V2 Micro-World Mapper") return { finalOutput: microWorld };
        if (name === "V2 Drama Architect") return { finalOutput: dramaPlan };
        if (name === "V2 Setpiece Choreographer") return { finalOutput: setpiecePlan };
        if (name === "V2 Story Blueprint Architect") return { finalOutput: storyBlueprint };
        if (name === "V2 Act Outline Architect") return { finalOutput: actOutline };
        if (name === "V2 Slide Block Author") {
          const plan = parseBlockPlan(prompt);
          return { finalOutput: makeSlideBlockForTest(plan, "note_only", "DEGRADE") };
        }
        if (name === "V2 Deck Cohesion Pass") {
          return {
            finalOutput: {
              schema_version: "1.0.0",
              global_continuity_findings: ["Continuity pass completed."],
              act_obligation_gaps: [],
              must_fix_operations: [],
              narrative_risk_flags: []
            }
          };
        }
        if (name === "V2 Narrative Intensifier") return { finalOutput: makeNarrativeIntensifierPass(degradedDeck) };
        if (name === "V2 Plot Director DeckSpec") return { finalOutput: degradedDeck };
        if (name === "V2 Reader Simulator") return { finalOutput: generateReaderSimReport(degradedDeck, truth, clueGraph) };
        if (name === "V2 Medical Fact Checker") return { finalOutput: generateMedFactcheckReport(degradedDeck, dossier) };
        return { finalOutput: { kb_context: "## Medical / Clinical KB\n- fallback" } };
      });

      await expect(
        runMicroDetectivesPipeline(
          { runId: run.runId, topic: run.topic, settings: run.settings },
          runs,
          { signal: new AbortController().signal, startFrom: "C" }
        )
      ).rejects.toThrow(/without acceptance|Quality finalization blocked/i);
    } finally {
      if (prevHybridThreshold === undefined) delete process.env.MMS_V2_MIN_HYBRID_SLIDE_QUALITY;
      else process.env.MMS_V2_MIN_HYBRID_SLIDE_QUALITY = prevHybridThreshold;
      if (prevCitationThreshold === undefined) delete process.env.MMS_V2_MIN_CITATION_GROUNDING_COVERAGE;
      else process.env.MMS_V2_MIN_CITATION_GROUNDING_COVERAGE = prevCitationThreshold;
    }

    const semFinalPath = path.join(runIntermediateDirAbs(run.runId), "semantic_acceptance_report.json");
    const semLoopPath = path.join(runIntermediateDirAbs(run.runId), "semantic_acceptance_report_loop1.json");
    await expect(Promise.any([fs.stat(semFinalPath), fs.stat(semLoopPath)])).resolves.toBeTruthy();
    const status = runs.getRun(run.runId);
    expect(status?.steps.C.status).toBe("error");
  });

  it("rejects invalid v2 startFrom", async () => {
    const runs = new RunManager();
    const run = await runs.createRun("Bad start", {
      workflow: "v2_micro_detectives",
      deckLengthMain: 45,
      deckLengthConstraintEnabled: true,
      audienceLevel: "PHYSICIAN_LEVEL"
    });

    await expect(
      runMicroDetectivesPipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "D" }
      )
    ).rejects.toThrow(/Invalid startFrom/);
  });

  it("fails when OPENAI_API_KEY is missing", async () => {
    delete process.env.OPENAI_API_KEY;
    const runs = new RunManager();
    const run = await runs.createRun("Missing key", {
      workflow: "v2_micro_detectives",
      deckLengthMain: 45,
      deckLengthConstraintEnabled: true,
      audienceLevel: "PHYSICIAN_LEVEL"
    });
    await expect(
      runMicroDetectivesPipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "KB0" }
      )
    ).rejects.toThrow(/OPENAI_API_KEY/);
  });

  it("fails when KB0 agent output does not contain kb_context", async () => {
    (agentsMock as unknown as MockAgentsModule).__setMockRunnerHandler(() => ({
      finalOutput: { unexpected: true }
    }));

    const runs = new RunManager();
    const run = await runs.createRun("Bad KB0 output", {
      workflow: "v2_micro_detectives",
      deckLengthMain: 45,
      deckLengthConstraintEnabled: true,
      audienceLevel: "PHYSICIAN_LEVEL",
      adherenceMode: "strict"
    });

    await expect(
      runMicroDetectivesPipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "KB0" }
      )
    ).rejects.toThrow(/kb_context/);

    const status = runs.getRun(run.runId);
    expect(status?.steps.KB0.status).toBe("error");
  });

  it("hard-fails step C with watchdog artifact when a C-agent stalls", async () => {
    const runs = new RunManager();
    const run = await runs.createRun("Watchdog C", {
      workflow: "v2_micro_detectives",
      deckLengthMain: 30,
      deckLengthConstraintEnabled: true,
      audienceLevel: "COLLEGE_LEVEL",
      adherenceMode: "strict"
    });

    await expect(
      runMicroDetectivesPipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "KB0" }
      )
    ).rejects.toBeInstanceOf(PipelinePause);

    await appendHumanReview(run.runId, {
      schema_version: "1.0.0",
      gate_id: "GATE_1_PITCH",
      status: "approve",
      notes: "",
      requested_changes: [],
      submitted_at: new Date().toISOString()
    });
    await expect(
      runMicroDetectivesPipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "B" }
      )
    ).rejects.toBeInstanceOf(PipelinePause);

    await appendHumanReview(run.runId, {
      schema_version: "1.0.0",
      gate_id: "GATE_2_TRUTH_LOCK",
      status: "approve",
      notes: "",
      requested_changes: [],
      submitted_at: new Date().toISOString()
    });

    const prevWatchdog = process.env.MMS_V2_STEP_C_WATCHDOG_MS;
    process.env.MMS_V2_STEP_C_WATCHDOG_MS = "1000";
    (agentsMock as unknown as MockAgentsModule).__setMockRunnerHandler((agent, prompt, options) => {
      const name = agent?.name ?? "";
      if (name !== "V2 Clue Architect") {
        const topic = parseTopic(prompt);
        const deckLengthMain = parseDeckLength(prompt);
        const deckLengthConstraintEnabled = parseDeckLengthConstraintEnabled(prompt);
        const audienceLevel = parseAudience(prompt);
        const base = {
          topic,
          audienceLevel,
          deckLengthMain,
          deckLengthConstraintEnabled,
          kbContext: "## Medical / Clinical KB\n- deterministic test context"
        } as const;
        const dossier = generateDiseaseDossier(base);
        const pitch = generateEpisodePitch(base, dossier);
        const truth = generateTruthModel(base, dossier, pitch);
        const deck = generateV2DeckSpec({ topic, deckLengthMain, deckLengthConstraintEnabled, audienceLevel });
        const differential = generateDifferentialCast(deck, dossier, truth);
        const clueGraph = generateClueGraph(deck, dossier, differential);
        const microWorld = generateMicroWorldMap(deck, dossier, truth);
        const dramaPlan = generateDramaPlan(deck, truth);
        const setpiecePlan = generateSetpiecePlan(deck, microWorld, dossier);
        if (name === "V2 Differential Cast Director") return { finalOutput: differential };
        if (name === "V2 Clue Architect") return { finalOutput: clueGraph };
        if (name === "V2 Micro-World Mapper") return { finalOutput: microWorld };
        if (name === "V2 Drama Architect") return { finalOutput: dramaPlan };
        if (name === "V2 Setpiece Choreographer") return { finalOutput: setpiecePlan };
        if (name === "V2 Deck Cohesion Pass") {
          return {
            finalOutput: {
              schema_version: "1.0.0",
              global_continuity_findings: ["Continuity pass completed."],
              act_obligation_gaps: [],
              must_fix_operations: [],
              narrative_risk_flags: []
            }
          };
        }
        if (name === "V2 Plot Director DeckSpec") return { finalOutput: deck };
        if (name === "V2 Reader Simulator") return { finalOutput: generateReaderSimReport(deck, truth, clueGraph) };
        if (name === "V2 Medical Fact Checker") return { finalOutput: generateMedFactcheckReport(deck, dossier) };
      }
      if (name === "V2 Clue Architect") {
        return new Promise<{ finalOutput?: unknown }>((_resolve, reject) => {
          const signal = (options as { signal?: AbortSignal } | undefined)?.signal;
          if (!signal) return;
          if (signal.aborted) {
            reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
            return;
          }
          signal.addEventListener(
            "abort",
            () => reject(signal.reason instanceof Error ? signal.reason : new Error("aborted")),
            { once: true }
          );
        });
      }
      return { finalOutput: { kb_context: "## Medical / Clinical KB\n- deterministic test context" } };
    });

    try {
      await expect(
        runMicroDetectivesPipeline(
          { runId: run.runId, topic: run.topic, settings: run.settings },
          runs,
          { signal: new AbortController().signal, startFrom: "C" }
        )
      ).rejects.toThrow(/watchdog timed out/i);
    } finally {
      if (prevWatchdog === undefined) delete process.env.MMS_V2_STEP_C_WATCHDOG_MS;
      else process.env.MMS_V2_STEP_C_WATCHDOG_MS = prevWatchdog;
    }

    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "step_c_watchdog_error.json"))).resolves.toBeTruthy();
    const status = runs.getRun(run.runId);
    expect(status?.steps.C.status).toBe("error");
  });

  it("uses warn-mode fallback when plotDirector returns transport-level aborted error", async () => {
    const runs = new RunManager();
    const run = await runs.createRun("Fallback transport abort", {
      workflow: "v2_micro_detectives",
      deckLengthMain: 30,
      deckLengthConstraintEnabled: true,
      audienceLevel: "COLLEGE_LEVEL",
      generationProfile: "pilot",
      adherenceMode: "warn"
    });

    await expect(
      runMicroDetectivesPipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "KB0" }
      )
    ).rejects.toBeInstanceOf(PipelinePause);

    await appendHumanReview(run.runId, {
      schema_version: "1.0.0",
      gate_id: "GATE_1_PITCH",
      status: "approve",
      notes: "",
      requested_changes: [],
      submitted_at: new Date().toISOString()
    });
    await expect(
      runMicroDetectivesPipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "B" }
      )
    ).rejects.toBeInstanceOf(PipelinePause);

    await appendHumanReview(run.runId, {
      schema_version: "1.0.0",
      gate_id: "GATE_2_TRUTH_LOCK",
      status: "approve",
      notes: "",
      requested_changes: [],
      submitted_at: new Date().toISOString()
    });

    (agentsMock as unknown as MockAgentsModule).__setMockRunnerHandler((agent, prompt) => {
      const topic = parseTopic(prompt);
      const deckLengthMain = parseDeckLength(prompt);
      const deckLengthConstraintEnabled = parseDeckLengthConstraintEnabled(prompt);
      const audienceLevel = parseAudience(prompt);
      const base = {
        topic,
        audienceLevel,
        deckLengthMain,
        deckLengthConstraintEnabled,
        kbContext: "## Medical / Clinical KB\n- deterministic test context"
      } as const;
      const dossier = generateDiseaseDossier(base);
      const pitch = generateEpisodePitch(base, dossier);
      const truth = generateTruthModel(base, dossier, pitch);
      const deck = generateV2DeckSpec({ topic, deckLengthMain, deckLengthConstraintEnabled, audienceLevel });
      const differential = generateDifferentialCast(deck, dossier, truth);
      const clueGraph = generateClueGraph(deck, dossier, differential);
      const microWorld = generateMicroWorldMap(deck, dossier, truth);
      const dramaPlan = generateDramaPlan(deck, truth);
      const setpiecePlan = generateSetpiecePlan(deck, microWorld, dossier);

      const name = agent?.name ?? "";
      if (name === "V2 Differential Cast Director") return { finalOutput: differential };
      if (name === "V2 Clue Architect") return { finalOutput: clueGraph };
      if (name === "V2 Micro-World Mapper") return { finalOutput: microWorld };
      if (name === "V2 Drama Architect") return { finalOutput: dramaPlan };
      if (name === "V2 Setpiece Choreographer") return { finalOutput: setpiecePlan };
      if (name === "V2 Deck Cohesion Pass") {
        return {
          finalOutput: {
            schema_version: "1.0.0",
            global_continuity_findings: ["Continuity pass completed."],
            act_obligation_gaps: [],
            must_fix_operations: [],
            narrative_risk_flags: []
          }
        };
      }
      if (name === "V2 Plot Director DeckSpec") throw new Error("Request was aborted.");
      if (name === "V2 Reader Simulator") return { finalOutput: generateReaderSimReport(deck, truth, clueGraph) };
      if (name === "V2 Medical Fact Checker") return { finalOutput: generateMedFactcheckReport(deck, dossier) };
      return { finalOutput: { kb_context: "## Medical / Clinical KB\n- deterministic test context" } };
    });

    const prevRefineMode = process.env.MMS_V2_PLOTDIRECTOR_REFINEMENT_MODE;
    process.env.MMS_V2_PLOTDIRECTOR_REFINEMENT_MODE = "on";
    try {
      await expect(
        runMicroDetectivesPipeline(
          { runId: run.runId, topic: run.topic, settings: run.settings },
          runs,
          { signal: new AbortController().signal, startFrom: "C" }
        )
      ).rejects.toBeInstanceOf(PipelinePause);
    } finally {
      if (prevRefineMode === undefined) delete process.env.MMS_V2_PLOTDIRECTOR_REFINEMENT_MODE;
      else process.env.MMS_V2_PLOTDIRECTOR_REFINEMENT_MODE = prevRefineMode;
    }

    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "deck_spec.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "GATE_3_STORYBOARD_REQUIRED.json"))).resolves.toBeTruthy();
    const fallbackRaw = await fs.readFile(path.join(runIntermediateDirAbs(run.runId), "fallback_usage.json"), "utf8");
    const fallback = JSON.parse(fallbackRaw) as { used: boolean; fallback_event_count: number };
    expect(fallback.used).toBe(true);
    expect(fallback.fallback_event_count).toBeGreaterThan(0);
    const status = runs.getRun(run.runId);
    expect(status?.steps.C.status).toBe("done");
  });

  it("uses step-C budget guard fallbacks when watchdog budget is tight in warn mode", async () => {
    const runs = new RunManager();
    const run = await runs.createRun("Budget guard C", {
      workflow: "v2_micro_detectives",
      deckLengthMain: 30,
      deckLengthConstraintEnabled: true,
      audienceLevel: "COLLEGE_LEVEL",
      generationProfile: "pilot",
      adherenceMode: "warn"
    });

    await expect(
      runMicroDetectivesPipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "KB0" }
      )
    ).rejects.toBeInstanceOf(PipelinePause);

    await appendHumanReview(run.runId, {
      schema_version: "1.0.0",
      gate_id: "GATE_1_PITCH",
      status: "approve",
      notes: "",
      requested_changes: [],
      submitted_at: new Date().toISOString()
    });
    await expect(
      runMicroDetectivesPipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "B" }
      )
    ).rejects.toBeInstanceOf(PipelinePause);

    await appendHumanReview(run.runId, {
      schema_version: "1.0.0",
      gate_id: "GATE_2_TRUTH_LOCK",
      status: "approve",
      notes: "",
      requested_changes: [],
      submitted_at: new Date().toISOString()
    });

    const prevWatchdog = process.env.MMS_V2_STEP_C_WATCHDOG_MS;
    const prevPlanningMode = process.env.MMS_V2_STEP_C_PLANNING_MODE;
    const prevDeckSpecMode = process.env.MMS_V2_DECKSPEC_MODE;
    const prevRefineMode = process.env.MMS_V2_PLOTDIRECTOR_REFINEMENT_MODE;
    process.env.MMS_V2_STEP_C_WATCHDOG_MS = "120000";
    process.env.MMS_V2_STEP_C_PLANNING_MODE = "agent_first";
    process.env.MMS_V2_DECKSPEC_MODE = "agent_full";
    process.env.MMS_V2_PLOTDIRECTOR_REFINEMENT_MODE = "on";
    try {
      await expect(
        runMicroDetectivesPipeline(
          { runId: run.runId, topic: run.topic, settings: run.settings },
          runs,
          { signal: new AbortController().signal, startFrom: "C" }
        )
      ).rejects.toBeInstanceOf(PipelinePause);
    } finally {
      if (prevWatchdog === undefined) delete process.env.MMS_V2_STEP_C_WATCHDOG_MS;
      else process.env.MMS_V2_STEP_C_WATCHDOG_MS = prevWatchdog;
      if (prevPlanningMode === undefined) delete process.env.MMS_V2_STEP_C_PLANNING_MODE;
      else process.env.MMS_V2_STEP_C_PLANNING_MODE = prevPlanningMode;
      if (prevDeckSpecMode === undefined) delete process.env.MMS_V2_DECKSPEC_MODE;
      else process.env.MMS_V2_DECKSPEC_MODE = prevDeckSpecMode;
      if (prevRefineMode === undefined) delete process.env.MMS_V2_PLOTDIRECTOR_REFINEMENT_MODE;
      else process.env.MMS_V2_PLOTDIRECTOR_REFINEMENT_MODE = prevRefineMode;
    }

    const fallbackRaw = await fs.readFile(path.join(runIntermediateDirAbs(run.runId), "fallback_usage.json"), "utf8");
    const fallback = JSON.parse(fallbackRaw) as { used: boolean; events?: Array<{ reason?: string }> };
    expect(fallback.used).toBe(true);
    expect((fallback.events ?? []).length).toBeGreaterThan(0);
    expect((fallback.events ?? []).some((event) => String(event.reason ?? "").includes("budget_guard"))).toBe(true);
    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "step_c_watchdog_error.json"))).rejects.toThrow();
    const status = runs.getRun(run.runId);
    expect(status?.steps.C.status).toBe("done");
  });

  it("routes structural QA fixes through slide-block regeneration and records regen artifacts", async () => {
    const runs = new RunManager();
    const run = await runs.createRun("Structural regen integration", {
      workflow: "v2_micro_detectives",
      deckLengthMain: 30,
      deckLengthConstraintEnabled: true,
      audienceLevel: "COLLEGE_LEVEL",
      generationProfile: "quality",
      adherenceMode: "warn"
    });

    await expect(
      runMicroDetectivesPipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "KB0" }
      )
    ).rejects.toBeInstanceOf(PipelinePause);

    await appendHumanReview(run.runId, {
      schema_version: "1.0.0",
      gate_id: "GATE_1_PITCH",
      status: "approve",
      notes: "",
      requested_changes: [],
      submitted_at: new Date().toISOString()
    });
    await expect(
      runMicroDetectivesPipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "B" }
      )
    ).rejects.toBeInstanceOf(PipelinePause);

    await appendHumanReview(run.runId, {
      schema_version: "1.0.0",
      gate_id: "GATE_2_TRUTH_LOCK",
      status: "approve",
      notes: "",
      requested_changes: [],
      submitted_at: new Date().toISOString()
    });

    (agentsMock as unknown as MockAgentsModule).__setMockRunnerHandler((agent, prompt) => {
      const topic = parseTopic(prompt);
      const deckLengthMain = parseDeckLength(prompt);
      const deckLengthConstraintEnabled = parseDeckLengthConstraintEnabled(prompt);
      const audienceLevel = parseAudience(prompt);
      const base = {
        topic,
        audienceLevel,
        deckLengthMain,
        deckLengthConstraintEnabled,
        kbContext: "## Medical / Clinical KB\n- deterministic test context"
      } as const;
      const dossier = generateDiseaseDossier(base);
      const pitch = generateEpisodePitch(base, dossier);
      const truth = generateTruthModel(base, dossier, pitch);
      const deck = generateV2DeckSpec({ topic, deckLengthMain, deckLengthConstraintEnabled, audienceLevel });
      const differential = generateDifferentialCast(deck, dossier, truth);
      const clueGraph = generateClueGraph(deck, dossier, differential);
      const microWorld = generateMicroWorldMap(deck, dossier, truth);
      const dramaPlan = generateDramaPlan(deck, truth);
      const setpiecePlan = generateSetpiecePlan(deck, microWorld, dossier);

      const name = agent?.name ?? "";
      if (name === "KB Compiler") {
        return { finalOutput: { kb_context: "## Medical / Clinical KB\n- deterministic test context" } };
      }
      if (name === "V2 Disease Research Desk") return { finalOutput: dossier };
      if (name === "V2 Episode Pitch Builder") return { finalOutput: pitch };
      if (name === "V2 Truth Model Engineer") return { finalOutput: truth };
      if (name === "V2 Differential Cast Director") return { finalOutput: differential };
      if (name === "V2 Clue Architect") return { finalOutput: clueGraph };
      if (name === "V2 Micro-World Mapper") return { finalOutput: microWorld };
      if (name === "V2 Drama Architect") return { finalOutput: dramaPlan };
      if (name === "V2 Setpiece Choreographer") return { finalOutput: setpiecePlan };
      if (name === "V2 Deck Cohesion Pass") {
        return {
          finalOutput: {
            schema_version: "1.0.0",
            global_continuity_findings: ["Continuity pass completed."],
            act_obligation_gaps: [],
            must_fix_operations: [],
            narrative_risk_flags: []
          }
        };
      }
      if (name === "V2 Plot Director DeckSpec") return { finalOutput: deck };
      if (name === "V2 Reader Simulator") return { finalOutput: generateReaderSimReport(deck, truth, clueGraph) };
      if (name === "V2 Medical Fact Checker") return { finalOutput: generateMedFactcheckReport(deck, dossier) };
      if (name === "V2 Slide Block Author") {
        const plan = parseBlockPlan(prompt);
        const isRegen = prompt.includes("QUALITY REGEN FIXES FOR THIS BLOCK");
        return { finalOutput: makeSlideBlockForTest(plan, isRegen ? "clue" : "note_only", isRegen ? "REGEN" : "DEGRADE") };
      }
      return { finalOutput: { kb_context: "## Medical / Clinical KB\n- fallback" } };
    });

    await expect(
      runMicroDetectivesPipeline(
        { runId: run.runId, topic: run.topic, settings: run.settings },
        runs,
        { signal: new AbortController().signal, startFrom: "C" }
      )
    ).rejects.toBeInstanceOf(PipelinePause);

    const intermediateDir = runIntermediateDirAbs(run.runId);
    const files = await fs.readdir(intermediateDir);
    expect(files.some((name) => /slide_block_.*_regen_loop1\.json/i.test(name))).toBe(true);

    const qaPatchRaw = await fs.readFile(path.join(intermediateDir, "qa_patch_notes_loop1.json"), "utf8");
    const qaPatch = JSON.parse(qaPatchRaw) as { structural_regeneration?: { used?: boolean; regenerated_block_count?: number } };
    expect(qaPatch.structural_regeneration?.used).toBe(true);
    expect(Number(qaPatch.structural_regeneration?.regenerated_block_count ?? 0)).toBeGreaterThan(0);

    const regenFiles = files.filter((name) => /slide_block_.*_regen_loop1\.json/i.test(name));
    expect(regenFiles.length).toBeGreaterThan(0);
    const regenBlocks = await Promise.all(
      regenFiles.map(async (name) => {
        const raw = await fs.readFile(path.join(intermediateDir, name), "utf8");
        return JSON.parse(raw) as Record<string, unknown>;
      })
    );
    expect(regenBlocks.every((block) => typeof block === "object" && block !== null)).toBe(true);
  });
});
