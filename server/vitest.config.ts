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
        lines: 95,
        functions: 95,
        statements: 95,
        // Branches in orchestration code include many defensive/error/recovery guards.
        // Keep this strict but realistic while preserving high statement/line/function floors.
        branches: 87
      }
    }
  }
});
