import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5173",
    headless: true
  },
  webServer: {
    command: "MMS_PIPELINE_MODE=fake MMS_FAKE_STEP_DELAY_MS=180 npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: false,
    cwd: repoRoot,
    timeout: 180_000
  }
});
