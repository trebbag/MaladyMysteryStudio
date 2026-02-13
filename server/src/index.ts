import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../");

dotenv.config({ path: path.resolve(repoRoot, ".env") });

// Dynamic imports so `.env` is loaded before any modules read process.env at import-time.
const { RunManager } = await import("./run_manager.js");
const { RunExecutor } = await import("./executor.js");
const { createApp } = await import("./app.js");
const { runStudioPipeline } = await import("./pipeline/studio_pipeline.js");
const { runFakeStudioPipeline } = await import("./pipeline/fake_pipeline.js");

function portFromEnv(): number {
  const port = process.env.PORT ? Number(process.env.PORT) : 5050;
  return Number.isFinite(port) && port > 0 ? port : 5050;
}

function useFakePipeline(): boolean {
  const mode = process.env.MMS_PIPELINE_MODE?.trim().toLowerCase();
  if (mode === "fake") return true;

  const legacy = process.env.MMS_FAKE_PIPELINE?.trim().toLowerCase();
  return legacy === "1" || legacy === "true" || legacy === "yes";
}

const runs = new RunManager();
await runs.initFromDisk();

const fakePipeline = useFakePipeline();
if (fakePipeline) {
  console.log("server pipeline mode: fake (MMS_PIPELINE_MODE=fake)");
}

const maxConcurrentRuns = process.env.MAX_CONCURRENT_RUNS ? Number(process.env.MAX_CONCURRENT_RUNS) : 1;
const executor = new RunExecutor(runs, fakePipeline ? runFakeStudioPipeline : runStudioPipeline, {
  concurrency: Number.isFinite(maxConcurrentRuns) && maxConcurrentRuns > 0 ? maxConcurrentRuns : 1
});
const app = createApp(runs, executor, { webDistDir: path.resolve(repoRoot, "web/dist") });

const port = portFromEnv();
app.listen(port, () => {
  console.log(`server listening on http://localhost:${port}`);
});
