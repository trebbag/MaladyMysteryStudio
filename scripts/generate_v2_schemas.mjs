#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import process from "node:process";

function repoRoot() {
  return process.cwd();
}

function sourceSchemaDir() {
  return path.join(repoRoot(), "micro-detectives-schemas-prompts", "schemas");
}

function outputPath() {
  return path.join(repoRoot(), "server", "src", "pipeline", "v2_micro_detectives", "generated_schemas.ts");
}

function normalizeEol(value) {
  return value.replace(/\r\n/g, "\n");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function parseArgs(argv) {
  return {
    check: argv.includes("--check")
  };
}

async function listSchemaFilesOrThrow(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".schema.json"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
  if (files.length === 0) {
    throw new Error(`No *.schema.json files found in ${dirPath}`);
  }
  return files;
}

async function buildGeneratedSource() {
  const dirPath = sourceSchemaDir();
  const files = await listSchemaFilesOrThrow(dirPath);
  const schemas = {};
  const hashes = {};

  for (const name of files) {
    const raw = normalizeEol(await fs.readFile(path.join(dirPath, name), "utf8"));
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid JSON in ${name}: ${msg}`);
    }
    schemas[name] = parsed;
    hashes[name] = sha256(raw);
  }

  return `/* AUTO-GENERATED FILE. DO NOT EDIT.
 * Source: micro-detectives-schemas-prompts/schemas
 * Generator: scripts/generate_v2_schemas.mjs
 */

export const V2CanonicalSchemaFiles = ${JSON.stringify(files, null, 2)} as const;

export const V2CanonicalSchemaHashes = ${JSON.stringify(hashes, null, 2)} as const;

export const V2CanonicalSchemas = ${JSON.stringify(schemas, null, 2)} as const;

export type V2CanonicalSchemaFile = (typeof V2CanonicalSchemaFiles)[number];

export function getV2CanonicalSchema(name: V2CanonicalSchemaFile): (typeof V2CanonicalSchemas)[V2CanonicalSchemaFile] {
  return V2CanonicalSchemas[name];
}
`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const generated = normalizeEol(await buildGeneratedSource());
  const target = outputPath();
  if (args.check) {
    const current = normalizeEol(await fs.readFile(target, "utf8"));
    if (current !== generated) {
      throw new Error("generated_schemas.ts is out of date. Run: npm run v2:schemas:generate");
    }
    console.log("generated_schemas.ts is up to date.");
    return;
  }

  await fs.writeFile(target, generated, "utf8");
  console.log(`Wrote ${target}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`generate_v2_schemas failed: ${message}`);
  process.exitCode = 1;
});

