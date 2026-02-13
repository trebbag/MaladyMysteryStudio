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
    baseURL: "http://localhost:5150",
    headless: true
  },
  webServer: {
    command: "PORT=5150 MMS_PIPELINE_MODE=fake MMS_FAKE_STEP_DELAY_MS=180 npm run start",
    url: "http://localhost:5150",
    reuseExistingServer: false,
    cwd: repoRoot,
    timeout: 180_000
  }
});
