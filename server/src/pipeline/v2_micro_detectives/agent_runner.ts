import { MaxTurnsExceededError, ModelBehaviorError, Runner } from "@openai/agents";
import type { RunManager, StepName } from "../../run_manager.js";

type RunnerBundle = {
  runner: Runner;
  deterministicRunner: Runner;
  repairRunner: Runner;
};

type ModelResponseLike = { output?: unknown[] } | null | undefined;
type ErrorStateLike = { _modelResponses?: ModelResponseLike[] } | null | undefined;

function assistantTextFromItem(item: unknown): string | null {
  if (!item || typeof item !== "object") return null;
  const rec = item as Record<string, unknown>;
  if (rec.role !== "assistant") return null;
  const content = rec.content;
  if (!Array.isArray(content)) return null;

  const parts: string[] = [];
  for (const c of content) {
    if (!c || typeof c !== "object") continue;
    const cre = c as Record<string, unknown>;
    if (cre.type === "output_text" && typeof cre.text === "string") parts.push(cre.text);
    if (cre.type === "refusal" && typeof cre.refusal === "string") parts.push(cre.refusal);
  }

  const text = parts.join("").trim();
  return text.length > 0 ? text : null;
}

function lastAssistantTextFromModelResponses(modelResponses: ModelResponseLike[]): string | null {
  for (let i = modelResponses.length - 1; i >= 0; i--) {
    const out = modelResponses[i]?.output;
    if (!Array.isArray(out)) continue;
    for (let j = out.length - 1; j >= 0; j--) {
      const text = assistantTextFromItem(out[j]);
      if (text) return text;
    }
  }
  return null;
}

function lastAssistantTextFromAgentsError(err: unknown): string | null {
  const state = (err as { state?: unknown } | null | undefined)?.state as ErrorStateLike;
  const responses = state?._modelResponses;
  if (!responses || !Array.isArray(responses)) return null;
  return lastAssistantTextFromModelResponses(responses);
}

export function createStructuredRunners(): RunnerBundle {
  return {
    runner: new Runner(),
    deterministicRunner: new Runner({ modelSettings: { temperature: 0 } }),
    repairRunner: new Runner({ modelSettings: { temperature: 0, toolChoice: "none" } })
  };
}

export async function runStructuredAgentOutput<T>(args: {
  runId: string;
  runs: RunManager;
  step: StepName;
  runnerBundle: RunnerBundle;
  agent: { name?: string };
  prompt: string;
  signal: AbortSignal;
  maxTurns: number;
  noFinalOutputMessage?: string;
}): Promise<T> {
  const { runId, runs, step, runnerBundle, agent, prompt, signal, maxTurns, noFinalOutputMessage } = args;

  const execute = async (runner: Runner): Promise<T> => {
    const result = await runner.run(agent as never, prompt, { maxTurns, signal });
    if (!result.finalOutput) throw new Error(noFinalOutputMessage ?? `${step} produced no final output`);
    return result.finalOutput as T;
  };

  try {
    return await execute(runnerBundle.runner);
  } catch (err) {
    const isSchemaFailure = err instanceof ModelBehaviorError || err instanceof MaxTurnsExceededError;
    if (!isSchemaFailure) throw err;

    const agentName = agent?.name ?? step;
    runs.log(runId, `Schema validation failed for "${agentName}". Attempting repair...`, step);
    const badOutput = lastAssistantTextFromAgentsError(err);

    if (badOutput) {
      const repairPrompt =
        `Your previous response failed JSON/schema validation for the required output schema.\n` +
        `Repair it so it conforms exactly.\n\n` +
        `Rules:\n` +
        `- Return ONLY JSON (no markdown fences)\n` +
        `- Do not add extra top-level keys\n` +
        `- Prefer minimal edits to preserve meaning\n\n` +
        `PREVIOUS OUTPUT:\n` +
        badOutput;

      try {
        const result = await runnerBundle.repairRunner.run(agent as never, repairPrompt, { maxTurns: 4, signal });
        if (!result.finalOutput) throw new Error(`${step} produced no final output (repair)`);
        runs.log(runId, `Schema repair succeeded for "${agentName}".`, step);
        return result.finalOutput as T;
      } catch (repairErr) {
        const msg = repairErr instanceof Error ? repairErr.message : String(repairErr);
        runs.log(runId, `Schema repair failed (${msg}). Retrying once from scratch...`, step);
      }
    } else {
      runs.log(runId, "Schema validation failed, but raw output could not be extracted. Retrying once from scratch...", step);
    }

    const retried = await execute(runnerBundle.deterministicRunner);
    runs.log(runId, `Schema retry succeeded for "${agentName}".`, step);
    return retried;
  }
}

