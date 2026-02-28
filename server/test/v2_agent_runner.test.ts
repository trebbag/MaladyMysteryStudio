import { MaxTurnsExceededError, ModelBehaviorError, type Runner } from "@openai/agents";
import { describe, expect, it, vi } from "vitest";
import { runStructuredAgentOutput } from "../src/pipeline/v2_micro_detectives/agent_runner.js";
import type { RunManager } from "../src/run_manager.js";

function runnerMock(
  impl: (agent: unknown, prompt: string, options: { maxTurns: number; signal: AbortSignal }) => Promise<{ finalOutput?: unknown }>
): Runner {
  return { run: vi.fn(impl) } as unknown as Runner;
}

function schemaError(message: string, previousOutputText?: string): ModelBehaviorError {
  const err = new ModelBehaviorError(message);
  if (previousOutputText) {
    (err as unknown as { state: unknown }).state = {
      _modelResponses: [
        {
          output: [
            {
              role: "assistant",
              content: [{ type: "output_text", text: previousOutputText }]
            }
          ]
        }
      ]
    };
  }
  return err;
}

describe("v2 agent runner schema resilience", () => {
  it("returns first-pass output when primary runner succeeds", async () => {
    const run = vi.fn(async () => ({ finalOutput: { ok: true } }));
    const bundle = {
      runner: { run } as unknown as Runner,
      deterministicRunner: runnerMock(async () => ({ finalOutput: { unreachable: true } })),
      repairRunner: runnerMock(async () => ({ finalOutput: { unreachable: true } }))
    };
    const runs = { log: vi.fn() } as unknown as RunManager;

    const out = await runStructuredAgentOutput<{ ok: boolean }>({
      runId: "run_ok",
      runs,
      step: "C",
      runnerBundle: bundle,
      agent: { name: "DeckSpec" },
      prompt: "prompt",
      signal: new AbortController().signal,
      maxTurns: 6
    });

    expect(out).toEqual({ ok: true });
    expect(run).toHaveBeenCalledTimes(1);
    expect(runs.log).not.toHaveBeenCalled();
  });

  it("rethrows non-schema errors without attempting repair", async () => {
    const bundle = {
      runner: runnerMock(async () => {
        throw new Error("network broke");
      }),
      deterministicRunner: runnerMock(async () => ({ finalOutput: { retry: true } })),
      repairRunner: runnerMock(async () => ({ finalOutput: { repaired: true } }))
    };
    const runs = { log: vi.fn() } as unknown as RunManager;

    await expect(
      runStructuredAgentOutput({
        runId: "run_error",
        runs,
        step: "C",
        runnerBundle: bundle,
        agent: { name: "DeckSpec" },
        prompt: "prompt",
        signal: new AbortController().signal,
        maxTurns: 6
      })
    ).rejects.toThrow(/network broke/);

    expect(runs.log).not.toHaveBeenCalled();
  });

  it("repairs schema failure when previous assistant output can be extracted", async () => {
    const bundle = {
      runner: runnerMock(async () => {
        throw schemaError("schema fail", "{\"bad\":true}");
      }),
      deterministicRunner: runnerMock(async () => ({ finalOutput: { retry: true } })),
      repairRunner: runnerMock(async (_agent, prompt) => {
        expect(prompt).toContain("PREVIOUS OUTPUT");
        expect(prompt).toContain("{\"bad\":true}");
        return { finalOutput: { repaired: true } };
      })
    };
    const runs = { log: vi.fn() } as unknown as RunManager;

    const out = await runStructuredAgentOutput<{ repaired: boolean }>({
      runId: "run_repair",
      runs,
      step: "C",
      runnerBundle: bundle,
      agent: { name: "DeckSpec" },
      prompt: "prompt",
      signal: new AbortController().signal,
      maxTurns: 6
    });

    expect(out).toEqual({ repaired: true });
    expect(runs.log).toHaveBeenCalledWith(
      "run_repair",
      expect.stringContaining('Schema validation failed for "DeckSpec". Attempting repair...'),
      "C"
    );
    expect(runs.log).toHaveBeenCalledWith("run_repair", expect.stringContaining("Schema repair succeeded"), "C");
  });

  it("retries deterministically when repair fails", async () => {
    const bundle = {
      runner: runnerMock(async () => {
        const err = new MaxTurnsExceededError("schema timeout");
        (err as unknown as { state: unknown }).state = {
          _modelResponses: [
            {
              output: [
                {
                  role: "assistant",
                  content: [{ type: "output_text", text: "{\"x\":1}" }]
                }
              ]
            }
          ]
        };
        throw err;
      }),
      deterministicRunner: runnerMock(async () => ({ finalOutput: { retry: true } })),
      repairRunner: runnerMock(async () => {
        throw new Error("repair broke");
      })
    };
    const runs = { log: vi.fn() } as unknown as RunManager;

    const out = await runStructuredAgentOutput<{ retry: boolean }>({
      runId: "run_retry",
      runs,
      step: "C",
      runnerBundle: bundle,
      agent: { name: "DeckSpec" },
      prompt: "prompt",
      signal: new AbortController().signal,
      maxTurns: 6
    });

    expect(out).toEqual({ retry: true });
    expect(runs.log).toHaveBeenCalledWith("run_retry", expect.stringContaining("Schema repair failed (repair broke)"), "C");
    expect(runs.log).toHaveBeenCalledWith("run_retry", expect.stringContaining("Schema retry succeeded"), "C");
  });

  it("skips repair prompt when schema error has no extractable assistant output", async () => {
    const err = schemaError("schema fail");
    (err as unknown as { state: unknown }).state = {
      _modelResponses: [{ output: [{ role: "assistant", content: [{ type: "ignored_type", text: "x" }] }] }]
    };

    const bundle = {
      runner: runnerMock(async () => {
        throw err;
      }),
      deterministicRunner: runnerMock(async () => ({ finalOutput: { retry: true } })),
      repairRunner: runnerMock(async () => ({ finalOutput: { repaired: true } }))
    };
    const runs = { log: vi.fn() } as unknown as RunManager;

    const out = await runStructuredAgentOutput<{ retry: boolean }>({
      runId: "run_no_extract",
      runs,
      step: "C",
      runnerBundle: bundle,
      agent: {},
      prompt: "prompt",
      signal: new AbortController().signal,
      maxTurns: 6
    });

    expect(out).toEqual({ retry: true });
    expect((bundle.repairRunner as unknown as { run: ReturnType<typeof vi.fn> }).run).not.toHaveBeenCalled();
    expect(runs.log).toHaveBeenCalledWith(
      "run_no_extract",
      expect.stringContaining("raw output could not be extracted"),
      "C"
    );
  });

  it("uses custom no-final-output message", async () => {
    const bundle = {
      runner: runnerMock(async () => ({ finalOutput: undefined })),
      deterministicRunner: runnerMock(async () => ({ finalOutput: { retry: true } })),
      repairRunner: runnerMock(async () => ({ finalOutput: { repaired: true } }))
    };
    const runs = { log: vi.fn() } as unknown as RunManager;

    await expect(
      runStructuredAgentOutput({
        runId: "run_empty",
        runs,
        step: "C",
        runnerBundle: bundle,
        agent: {},
        prompt: "prompt",
        signal: new AbortController().signal,
        maxTurns: 6,
        noFinalOutputMessage: "custom empty output"
      })
    ).rejects.toThrow(/custom empty output/);
  });
});
