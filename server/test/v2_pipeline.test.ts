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

  return { Agent, Runner, fileSearchTool, webSearchTool, setDefaultOpenAIKey, withTrace, __setMockRunnerHandler };
});

import * as agentsMock from "@openai/agents";
import { PipelinePause } from "../src/executor.js";
import { RunManager } from "../src/run_manager.js";
import { generateV2DeckSpec } from "../src/pipeline/v2_micro_detectives/generator.js";
import { generateDiseaseDossier, generateEpisodePitch, generateMedFactcheckReport, generateTruthModel } from "../src/pipeline/v2_micro_detectives/phase2_generator.js";
import { generateClueGraph, generateDifferentialCast, generateReaderSimReport } from "../src/pipeline/v2_micro_detectives/phase3_generator.js";
import { runMicroDetectivesPipeline } from "../src/pipeline/v2_micro_detectives/pipeline.js";
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
    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "citation_traceability.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "agent_call_durations.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "GATE_3_STORYBOARD_REQUIRED.json"))).resolves.toBeTruthy();

    await appendHumanReview(run.runId, {
      schema_version: "1.0.0",
      gate_id: "GATE_3_STORYBOARD",
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
        const differential = generateDifferentialCast(degradedDeck, dossier, truth);
        const clueGraph = generateClueGraph(degradedDeck, dossier, differential);

        const name = agent?.name ?? "";
        if (name === "KB Compiler") {
          return { finalOutput: { kb_context: "## Medical / Clinical KB\n- deterministic test context" } };
        }
        if (name === "V2 Disease Research Desk") return { finalOutput: dossier };
        if (name === "V2 Episode Pitch Builder") return { finalOutput: pitch };
        if (name === "V2 Truth Model Engineer") return { finalOutput: truth };
        if (name === "V2 Differential Cast Director") return { finalOutput: differential };
        if (name === "V2 Clue Architect") return { finalOutput: clueGraph };
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
      ).rejects.toThrow(/without acceptance/i);
    } finally {
      if (prevHybridThreshold === undefined) delete process.env.MMS_V2_MIN_HYBRID_SLIDE_QUALITY;
      else process.env.MMS_V2_MIN_HYBRID_SLIDE_QUALITY = prevHybridThreshold;
      if (prevCitationThreshold === undefined) delete process.env.MMS_V2_MIN_CITATION_GROUNDING_COVERAGE;
      else process.env.MMS_V2_MIN_CITATION_GROUNDING_COVERAGE = prevCitationThreshold;
    }

    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "semantic_acceptance_report.json"))).resolves.toBeTruthy();
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
        if (name === "V2 Differential Cast Director") return { finalOutput: differential };
        if (name === "V2 Plot Director DeckSpec") return { finalOutput: deck };
        if (name === "V2 Reader Simulator") return { finalOutput: generateReaderSimReport(deck, truth, generateClueGraph(deck, dossier, differential)) };
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

      const name = agent?.name ?? "";
      if (name === "V2 Differential Cast Director") return { finalOutput: differential };
      if (name === "V2 Clue Architect") return { finalOutput: clueGraph };
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
    process.env.MMS_V2_STEP_C_WATCHDOG_MS = "120000";
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
    }

    const fallbackRaw = await fs.readFile(path.join(runIntermediateDirAbs(run.runId), "fallback_usage.json"), "utf8");
    const fallback = JSON.parse(fallbackRaw) as { used: boolean; events?: Array<{ reason?: string }> };
    expect(fallback.used).toBe(false);
    expect(fallback.events ?? []).toHaveLength(0);
    await expect(fs.stat(path.join(runIntermediateDirAbs(run.runId), "step_c_watchdog_error.json"))).rejects.toThrow();
    const status = runs.getRun(run.runId);
    expect(status?.steps.C.status).toBe("done");
  });
});
