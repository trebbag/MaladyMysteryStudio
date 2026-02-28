import { fork } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { StepName } from "../../run_manager.js";

export type V2AgentKey =
  | "kbCompiler"
  | "diseaseResearch"
  | "episodePitch"
  | "truthModel"
  | "differentialCast"
  | "clueArchitect"
  | "plotDirectorDeckSpec"
  | "readerSim"
  | "medFactcheck";

type AgentChildRequest = {
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

type SpawnResult = {
  stdout: string;
  stderr: string;
};

function childEntryAbsPath(): string {
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  const tsPath = path.join(thisDir, "agent_child_process.ts");
  if (existsSync(tsPath)) return tsPath;
  return path.join(thisDir, "agent_child_process.js");
}

export async function runV2AgentInChild(input: {
  runId: string;
  step: StepName;
  agentKey: V2AgentKey;
  prompt: string;
  maxTurns: number;
  timeoutMs: number;
  signal?: AbortSignal;
  vectorStoreId?: string;
}): Promise<unknown> {
  if (input.signal?.aborted) {
    const reason = input.signal.reason;
    const msg = reason instanceof Error ? reason.message : typeof reason === "string" && reason.trim().length > 0 ? reason : "Cancelled";
    throw new Error(msg);
  }

  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const payload: AgentChildRequest = {
    requestId,
    runId: input.runId,
    step: input.step,
    agentKey: input.agentKey,
    prompt: input.prompt,
    maxTurns: input.maxTurns,
    timeoutMs: input.timeoutMs,
    vectorStoreId: input.vectorStoreId
  };

  const entry = childEntryAbsPath();
  const child = fork(entry, [], {
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    env: process.env,
    execArgv: process.execArgv
  });

  const logs: SpawnResult = { stdout: "", stderr: "" };
  child.stdout?.on("data", (buf: Buffer | string) => {
    logs.stdout += String(buf);
  });
  child.stderr?.on("data", (buf: Buffer | string) => {
    logs.stderr += String(buf);
  });

  return await new Promise<unknown>((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };
    const getAbortMessage = (): string => {
      const reason = input.signal?.reason;
      if (reason instanceof Error && reason.message.trim().length > 0) return reason.message;
      if (typeof reason === "string" && reason.trim().length > 0) return reason;
      return "Cancelled";
    };

    const timeout = setTimeout(() => {
      settle(() => {
        input.signal?.removeEventListener("abort", onAbort);
        child.kill("SIGKILL");
        reject(new Error(`Child timeout for ${input.step}:${input.agentKey} after ${input.timeoutMs}ms`));
      });
    }, Math.max(10_000, input.timeoutMs + 1_000));

    const onAbort = () => {
      settle(() => {
        clearTimeout(timeout);
        child.kill("SIGKILL");
        reject(new Error(getAbortMessage()));
      });
    };
    input.signal?.addEventListener("abort", onAbort, { once: true });

    child.on("message", (msg: unknown) => {
      const parsed = msg as AgentChildResponse | undefined;
      if (!parsed || parsed.requestId !== requestId) return;
      clearTimeout(timeout);
      settle(() => {
        input.signal?.removeEventListener("abort", onAbort);
        if (parsed.ok) {
          resolve(parsed.output);
          return;
        }
        const details = [parsed.error, parsed.details, logs.stderr.trim(), logs.stdout.trim()].filter(Boolean).join("\n");
        reject(new Error(details || `Child process failed for ${input.step}:${input.agentKey}`));
      });
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      settle(() => {
        input.signal?.removeEventListener("abort", onAbort);
        reject(err);
      });
    });

    child.on("exit", (code, signal) => {
      if (settled) return;
      clearTimeout(timeout);
      settle(() => {
        input.signal?.removeEventListener("abort", onAbort);
        const detail = [logs.stderr.trim(), logs.stdout.trim()].filter(Boolean).join("\n");
        reject(
          new Error(
            `Child exited before response for ${input.step}:${input.agentKey} (code=${String(code)} signal=${String(signal)}).${detail ? ` ${detail}` : ""}`
          )
        );
      });
    });

    child.send(payload);
  });
}
