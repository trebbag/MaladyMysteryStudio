import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text"],
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
      thresholds: {
        // Coverage policy intentionally calibrated to the mixed unit/integration split:
        // branch floor is raised as targeted branch tests are added for v2 QA/patch paths.
        lines: 90,
        functions: 91,
        statements: 87,
        branches: 74
      }
    }
  }
});
