#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

function parseArgs(argv) {
  const options = {
    port: 5065,
    outputDir: ".ci/pilot",
    timeoutMs: 60_000,
    fakeStepDelayMs: 80,
    forceFallback: false,
    passThrough: []
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--port") {
      options.port = Number(argv[i + 1] || options.port);
      i += 1;
      continue;
    }
    if (arg === "--output-dir") {
      options.outputDir = argv[i + 1] || options.outputDir;
      i += 1;
      continue;
    }
    if (arg === "--health-timeout-ms") {
      options.timeoutMs = Number(argv[i + 1] || options.timeoutMs);
      i += 1;
      continue;
    }
    if (arg === "--fake-step-delay-ms") {
      options.fakeStepDelayMs = Number(argv[i + 1] || options.fakeStepDelayMs);
      i += 1;
      continue;
    }
    if (arg === "--force-fallback") {
      options.forceFallback = true;
      continue;
    }
    options.passThrough.push(arg);
  }
  if (!Number.isFinite(options.port) || options.port <= 0) {
    throw new Error(`Invalid --port: ${String(options.port)}`);
  }
  return options;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${url} failed (${res.status}): ${body}`);
  }
  return await res.json();
}

async function waitForHealth(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const body = await fetchJson(`${baseUrl}/api/health`);
      if (body?.ok === true) return;
    } catch {
      // keep retrying until timeout
    }
    await sleep(800);
  }
  throw new Error(`Timed out waiting for ${baseUrl}/api/health`);
}

function runCommand(label, command, args, env, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(undefined);
        return;
      }
      reject(new Error(`${label} failed with exit code ${String(code)}`));
    });
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = process.cwd();
  const baseUrl = `http://localhost:${String(options.port)}`;
  const tsxBin = path.join(repoRoot, "node_modules", ".bin", "tsx");

  const serverEnv = {
    ...process.env,
    PORT: String(options.port),
    MMS_PIPELINE_MODE: "fake",
    MMS_FAKE_STEP_DELAY_MS: String(options.fakeStepDelayMs),
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || "sk-fake-local-dev",
    KB_VECTOR_STORE_ID: process.env.KB_VECTOR_STORE_ID || "vs_fake_local_dev"
  };
  if (options.forceFallback) serverEnv.MMS_V2_FAKE_FORCE_DECK_FALLBACK = "1";

  const server = spawn(tsxBin, ["server/src/index.ts"], {
    cwd: repoRoot,
    env: serverEnv,
    stdio: "inherit"
  });

  let serverExitedEarly = false;
  server.on("exit", () => {
    serverExitedEarly = true;
  });

  try {
    await waitForHealth(baseUrl, options.timeoutMs);
    if (serverExitedEarly) throw new Error("Fake server exited before health check.");

    const harnessArgs = [
      "scripts/v2_pilot_quality_harness.mjs",
      "--base-url",
      baseUrl,
      "--output-dir",
      options.outputDir,
      "--enforce-slo",
      ...options.passThrough
    ];
    await runCommand("v2_pilot_quality_harness", process.execPath, harnessArgs, process.env, repoRoot);
  } finally {
    if (server.exitCode === null && server.signalCode === null) {
      server.kill("SIGTERM");
      await sleep(500);
      if (server.exitCode === null && server.signalCode === null) {
        server.kill("SIGKILL");
      }
    }
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  // eslint-disable-next-line no-console
  console.error(`v2_pilot_quality_fake_batch failed: ${message}`);
  process.exitCode = 1;
});
