import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { V2CanonicalSchemaFiles, V2CanonicalSchemaHashes } from "../src/pipeline/v2_micro_detectives/generated_schemas.js";

function repoRootFromTestFile(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..");
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

describe("v2 generated schema canon", () => {
  it("matches source schema file inventory and hashes", async () => {
    const repoRoot = repoRootFromTestFile();
    const sourceSchemaDir = path.join(repoRoot, "micro-detectives-schemas-prompts", "schemas");
    const entries = await fs.readdir(sourceSchemaDir, { withFileTypes: true });
    const sourceFiles = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".schema.json"))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));

    expect(sourceFiles).toEqual([...V2CanonicalSchemaFiles]);

    for (const name of sourceFiles) {
      const raw = (await fs.readFile(path.join(sourceSchemaDir, name), "utf8")).replace(/\r\n/g, "\n");
      expect(V2CanonicalSchemaHashes[name as keyof typeof V2CanonicalSchemaHashes]).toBe(sha256(raw));
    }
  });
});

