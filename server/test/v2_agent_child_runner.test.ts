import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const forkMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  fork: forkMock
}));

import { runV2AgentInChild } from "../src/pipeline/v2_micro_detectives/agent_child_runner.js";

type MockChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
  send: (payload: unknown) => void;
};

function makeMockChild(sendImpl: (child: MockChild, payload: Record<string, unknown>) => void): MockChild {
  const child = new EventEmitter() as MockChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  child.send = (payload: unknown) => sendImpl(child, payload as Record<string, unknown>);
  return child;
}

beforeEach(() => {
  forkMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("v2 agent child runner", () => {
  it("returns output when child responds with ok=true", async () => {
    forkMock.mockImplementation(() =>
      makeMockChild((child, payload) => {
        setImmediate(() => {
          child.emit("message", {
            requestId: payload.requestId,
            ok: true,
            output: { success: true, source: "child" }
          });
        });
      })
    );

    const out = await runV2AgentInChild({
      runId: "run_test",
      step: "C",
      agentKey: "plotDirectorDeckSpec",
      prompt: "prompt",
      maxTurns: 4,
      timeoutMs: 90_000
    });

    expect(out).toEqual({ success: true, source: "child" });
    expect(forkMock).toHaveBeenCalledTimes(1);
  });

  it("throws combined error details when child responds with ok=false", async () => {
    forkMock.mockImplementation(() =>
      makeMockChild((child, payload) => {
        child.stderr.emit("data", "stderr context");
        setImmediate(() => {
          child.emit("message", {
            requestId: payload.requestId,
            ok: false,
            error: "Agent child execution failed.",
            details: "validation broke"
          });
        });
      })
    );

    await expect(
      runV2AgentInChild({
        runId: "run_test",
        step: "C",
        agentKey: "differentialCast",
        prompt: "prompt",
        maxTurns: 4,
        timeoutMs: 90_000
      })
    ).rejects.toThrow(/validation broke/);
  });

  it("throws when child exits before emitting a response", async () => {
    forkMock.mockImplementation(() =>
      makeMockChild((child) => {
        setImmediate(() => {
          child.emit("exit", 1, null);
        });
      })
    );

    await expect(
      runV2AgentInChild({
        runId: "run_test",
        step: "C",
        agentKey: "clueArchitect",
        prompt: "prompt",
        maxTurns: 4,
        timeoutMs: 90_000
      })
    ).rejects.toThrow(/exited before response/);
  });

  it("ignores mismatched requestId messages until matching response arrives", async () => {
    forkMock.mockImplementation(() =>
      makeMockChild((child, payload) => {
        setImmediate(() => {
          child.emit("message", {
            requestId: "wrong-id",
            ok: true,
            output: { ignored: true }
          });
          child.emit("message", {
            requestId: payload.requestId,
            ok: true,
            output: { accepted: true }
          });
        });
      })
    );

    const out = await runV2AgentInChild({
      runId: "run_test",
      step: "C",
      agentKey: "plotDirectorDeckSpec",
      prompt: "prompt",
      maxTurns: 4,
      timeoutMs: 90_000
    });

    expect(out).toEqual({ accepted: true });
  });

  it("rejects when child emits an error event", async () => {
    forkMock.mockImplementation(() =>
      makeMockChild((child) => {
        setImmediate(() => {
          child.emit("error", new Error("child ipc failed"));
        });
      })
    );

    await expect(
      runV2AgentInChild({
        runId: "run_test",
        step: "C",
        agentKey: "clueArchitect",
        prompt: "prompt",
        maxTurns: 4,
        timeoutMs: 90_000
      })
    ).rejects.toThrow(/child ipc failed/);
  });

  it("includes stderr/stdout detail when child exits before response", async () => {
    forkMock.mockImplementation(() =>
      makeMockChild((child) => {
        child.stderr.emit("data", "stderr details");
        child.stdout.emit("data", "stdout details");
        setImmediate(() => {
          child.emit("exit", 1, "SIGTERM");
        });
      })
    );

    await expect(
      runV2AgentInChild({
        runId: "run_test",
        step: "C",
        agentKey: "differentialCast",
        prompt: "prompt",
        maxTurns: 4,
        timeoutMs: 90_000
      })
    ).rejects.toThrow(/stderr details/);
  });

  it("kills child and rejects on timeout", async () => {
    vi.useFakeTimers();
    let childRef: MockChild | null = null;
    forkMock.mockImplementation(() => {
      childRef = makeMockChild(() => {
        // Intentionally never emit message/exit to force timeout path.
      });
      return childRef;
    });

    const promise = runV2AgentInChild({
      runId: "run_test",
      step: "C",
      agentKey: "readerSim",
      prompt: "prompt",
      maxTurns: 4,
      timeoutMs: 1_000
    });
    const caught = promise.catch((error) => error);

    await vi.advanceTimersByTimeAsync(11_500);
    const timeoutError = await caught;
    expect(timeoutError).toBeInstanceOf(Error);
    expect(String((timeoutError as Error).message)).toMatch(/Child timeout/);
    if (!childRef) throw new Error("Expected child process reference for timeout assertion.");
    const timeoutChild = childRef as unknown as { kill: ReturnType<typeof vi.fn> };
    expect(timeoutChild.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("kills child and rejects when parent signal aborts", async () => {
    let childRef: MockChild | null = null;
    forkMock.mockImplementation(() => {
      childRef = makeMockChild(() => {
        // Intentionally never emit message/exit to force abort path.
      });
      return childRef;
    });

    const controller = new AbortController();
    const promise = runV2AgentInChild({
      runId: "run_test",
      step: "C",
      agentKey: "plotDirectorDeckSpec",
      prompt: "prompt",
      maxTurns: 4,
      timeoutMs: 90_000,
      signal: controller.signal
    });
    setImmediate(() => controller.abort(new Error("manual cancel")));

    await expect(promise).rejects.toThrow(/manual cancel/);
    if (!childRef) throw new Error("Expected child process reference for abort assertion.");
    const timeoutChild = childRef as unknown as { kill: ReturnType<typeof vi.fn> };
    expect(timeoutChild.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("fails fast when signal is already aborted before spawn", async () => {
    const controller = new AbortController();
    controller.abort(new Error("already cancelled"));

    await expect(
      runV2AgentInChild({
        runId: "run_test",
        step: "C",
        agentKey: "clueArchitect",
        prompt: "prompt",
        maxTurns: 4,
        timeoutMs: 90_000,
        signal: controller.signal
      })
    ).rejects.toThrow(/already cancelled/);

    expect(forkMock).not.toHaveBeenCalled();
  });
});
