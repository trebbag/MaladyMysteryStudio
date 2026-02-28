import { setDefaultOpenAIKey } from "@openai/agents";
import type { RunManager, StepName } from "../../run_manager.js";
import { makeKbCompilerAgent } from "../agents.js";
import { loadV2Assets } from "./assets.js";
import {
  makeV2ClueArchitectAgent,
  makeV2DifferentialCastAgent,
  makeV2DiseaseResearchAgent,
  makeV2EpisodePitchAgent,
  makeV2MedFactcheckAgent,
  makeV2PlotDirectorDeckSpecAgent,
  makeV2ReaderSimAgent,
  makeV2TruthModelAgent
} from "./agents.js";
import { createStructuredRunners, runStructuredAgentOutput } from "./agent_runner.js";
import type { V2AgentKey } from "./agent_child_runner.js";

export type AgentChildRequest = {
  requestId: string;
  runId: string;
  step: StepName;
  agentKey: V2AgentKey;
  prompt: string;
  maxTurns: number;
  timeoutMs: number;
  vectorStoreId?: string;
};

type AgentChildResponse =
  | {
      requestId: string;
      ok: true;
      output: unknown;
    }
  | {
      requestId: string;
      ok: false;
      error: string;
      details?: string;
    };

function send(payload: AgentChildResponse): void {
  if (!process.send) return;
  process.send(payload);
}

export function makeNoopRunsLogger(): RunManager {
  return { log: () => undefined } as unknown as RunManager;
}

export async function runChildRequest(req: AgentChildRequest): Promise<unknown> {
  const openAiKey = process.env.OPENAI_API_KEY?.trim();
  if (openAiKey) setDefaultOpenAIKey(openAiKey);

  const assets = await loadV2Assets();
  const agent = (() => {
    if (req.agentKey === "kbCompiler") {
      const vectorStoreId = req.vectorStoreId?.trim();
      if (!vectorStoreId) throw new Error("Missing vectorStoreId for kbCompiler child request.");
      return makeKbCompilerAgent(vectorStoreId);
    }
    if (req.agentKey === "diseaseResearch") return makeV2DiseaseResearchAgent(assets);
    if (req.agentKey === "episodePitch") return makeV2EpisodePitchAgent(assets);
    if (req.agentKey === "truthModel") return makeV2TruthModelAgent(assets);
    if (req.agentKey === "differentialCast") return makeV2DifferentialCastAgent(assets);
    if (req.agentKey === "clueArchitect") return makeV2ClueArchitectAgent(assets);
    if (req.agentKey === "plotDirectorDeckSpec") return makeV2PlotDirectorDeckSpecAgent(assets);
    if (req.agentKey === "readerSim") return makeV2ReaderSimAgent(assets);
    if (req.agentKey === "medFactcheck") return makeV2MedFactcheckAgent(assets);
    throw new Error(`Unsupported agentKey: ${String(req.agentKey)}`);
  })();

  const timeoutSignal =
    Number.isFinite(req.timeoutMs) && req.timeoutMs > 0 && typeof AbortSignal.timeout === "function"
      ? AbortSignal.timeout(req.timeoutMs)
      : new AbortController().signal;

  const output = await runStructuredAgentOutput({
    runId: req.runId,
    runs: makeNoopRunsLogger(),
    step: req.step,
    runnerBundle: createStructuredRunners(),
    agent: agent as never,
    prompt: req.prompt,
    signal: timeoutSignal,
    maxTurns: req.maxTurns
  });
  return output;
}

export function registerChildProcessMessageHandler(args?: {
  sendFn?: (payload: AgentChildResponse) => void;
  exitFn?: (code: number) => void;
}): void {
  const sendFn = args?.sendFn ?? send;
  const exitFn = args?.exitFn ?? ((code: number) => process.exit(code));

  process.on("message", (message: unknown) => {
    const req = message as AgentChildRequest | undefined;
    if (!req || typeof req !== "object" || typeof req.requestId !== "string") {
      sendFn({
        requestId: "unknown",
        ok: false,
        error: "Invalid child request payload."
      });
      exitFn(1);
      return;
    }

    void (async () => {
      try {
        const output = await runChildRequest(req);
        sendFn({ requestId: req.requestId, ok: true, output });
        exitFn(0);
      } catch (err) {
        const details = err instanceof Error ? `${err.name}: ${err.message}\n${err.stack ?? ""}` : String(err);
        sendFn({
          requestId: req.requestId,
          ok: false,
          error: "Agent child execution failed.",
          details
        });
        exitFn(1);
      }
    })();
  });
}

if (process.env.MMS_V2_AGENT_CHILD_PROCESS_LISTENER !== "off") {
  registerChildProcessMessageHandler();
}
