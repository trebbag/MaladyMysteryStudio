import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setDefaultOpenAIKeyMock = vi.hoisted(() => vi.fn());
const loadV2AssetsMock = vi.hoisted(() => vi.fn(async () => ({ promptFiles: {} })));
const makeKbCompilerAgentMock = vi.hoisted(() => vi.fn(() => ({ name: "kbCompilerAgent" })));
const makeV2DiseaseResearchAgentMock = vi.hoisted(() => vi.fn(() => ({ name: "diseaseResearchAgent" })));
const makeV2EpisodePitchAgentMock = vi.hoisted(() => vi.fn(() => ({ name: "episodePitchAgent" })));
const makeV2TruthModelAgentMock = vi.hoisted(() => vi.fn(() => ({ name: "truthModelAgent" })));
const makeV2DifferentialCastAgentMock = vi.hoisted(() => vi.fn(() => ({ name: "differentialCastAgent" })));
const makeV2ClueArchitectAgentMock = vi.hoisted(() => vi.fn(() => ({ name: "clueArchitectAgent" })));
const makeV2PlotDirectorDeckSpecAgentMock = vi.hoisted(() => vi.fn(() => ({ name: "plotDirectorAgent" })));
const makeV2ReaderSimAgentMock = vi.hoisted(() => vi.fn(() => ({ name: "readerSimAgent" })));
const makeV2MedFactcheckAgentMock = vi.hoisted(() => vi.fn(() => ({ name: "medFactcheckAgent" })));
const createStructuredRunnersMock = vi.hoisted(() => vi.fn(() => ({ runner: {}, deterministicRunner: {}, repairRunner: {} })));
const runStructuredAgentOutputMock = vi.hoisted(() => vi.fn(async () => ({ ok: true })));

vi.mock("@openai/agents", () => ({
  setDefaultOpenAIKey: setDefaultOpenAIKeyMock
}));

vi.mock("../src/pipeline/agents.js", () => ({
  makeKbCompilerAgent: makeKbCompilerAgentMock
}));

vi.mock("../src/pipeline/v2_micro_detectives/assets.js", () => ({
  loadV2Assets: loadV2AssetsMock
}));

vi.mock("../src/pipeline/v2_micro_detectives/agents.js", () => ({
  makeV2DiseaseResearchAgent: makeV2DiseaseResearchAgentMock,
  makeV2EpisodePitchAgent: makeV2EpisodePitchAgentMock,
  makeV2TruthModelAgent: makeV2TruthModelAgentMock,
  makeV2DifferentialCastAgent: makeV2DifferentialCastAgentMock,
  makeV2ClueArchitectAgent: makeV2ClueArchitectAgentMock,
  makeV2PlotDirectorDeckSpecAgent: makeV2PlotDirectorDeckSpecAgentMock,
  makeV2ReaderSimAgent: makeV2ReaderSimAgentMock,
  makeV2MedFactcheckAgent: makeV2MedFactcheckAgentMock
}));

vi.mock("../src/pipeline/v2_micro_detectives/agent_runner.js", () => ({
  createStructuredRunners: createStructuredRunnersMock,
  runStructuredAgentOutput: runStructuredAgentOutputMock
}));

async function loadModule() {
  vi.resetModules();
  process.env.MMS_V2_AGENT_CHILD_PROCESS_LISTENER = "off";
  return await import("../src/pipeline/v2_micro_detectives/agent_child_process.js");
}

beforeEach(() => {
  setDefaultOpenAIKeyMock.mockReset();
  loadV2AssetsMock.mockClear();
  makeKbCompilerAgentMock.mockClear();
  createStructuredRunnersMock.mockClear();
  runStructuredAgentOutputMock.mockReset();
  runStructuredAgentOutputMock.mockResolvedValue({ ok: true });
  process.env.OPENAI_API_KEY = "sk-test";
});

afterEach(() => {
  delete process.env.MMS_V2_AGENT_CHILD_PROCESS_LISTENER;
});

describe("v2 agent child process helpers", () => {
  it("throws for kbCompiler requests when vectorStoreId is missing", async () => {
    const mod = await loadModule();

    await expect(
      mod.runChildRequest({
        requestId: "r1",
        runId: "run_test",
        step: "KB0",
        agentKey: "kbCompiler",
        prompt: "prompt",
        maxTurns: 4,
        timeoutMs: 10_000
      })
    ).rejects.toThrow(/Missing vectorStoreId/);
  });

  it("throws for unsupported agent keys", async () => {
    const mod = await loadModule();

    await expect(
      mod.runChildRequest({
        requestId: "r2",
        runId: "run_test",
        step: "C",
        agentKey: "not_real_agent" as never,
        prompt: "prompt",
        maxTurns: 4,
        timeoutMs: 10_000
      })
    ).rejects.toThrow(/Unsupported agentKey/);
  });

  it("registerChildProcessMessageHandler sends invalid payload error and exits", async () => {
    const mod = await loadModule();
    const sendFn = vi.fn();
    const exitFn = vi.fn();

    const previous = process.listeners("message");
    process.removeAllListeners("message");
    try {
      mod.registerChildProcessMessageHandler({ sendFn, exitFn });
      (process as unknown as { emit: (eventName: string, payload: unknown) => boolean }).emit("message", null);
    } finally {
      process.removeAllListeners("message");
      for (const handler of previous) process.on("message", handler as never);
    }

    expect(sendFn).toHaveBeenCalledWith({
      requestId: "unknown",
      ok: false,
      error: "Invalid child request payload."
    });
    expect(exitFn).toHaveBeenCalledWith(1);
  });

  it("runChildRequest dispatches to kbCompiler with vectorStoreId and structured runner", async () => {
    const mod = await loadModule();

    const out = await mod.runChildRequest({
      requestId: "r3",
      runId: "run_test",
      step: "KB0",
      agentKey: "kbCompiler",
      prompt: "prompt",
      maxTurns: 4,
      timeoutMs: 10_000,
      vectorStoreId: "vs_123"
    });

    expect(out).toEqual({ ok: true });
    expect(makeKbCompilerAgentMock).toHaveBeenCalledWith("vs_123");
    expect(runStructuredAgentOutputMock).toHaveBeenCalledTimes(1);
    expect(setDefaultOpenAIKeyMock).toHaveBeenCalledWith("sk-test");
  });
});
