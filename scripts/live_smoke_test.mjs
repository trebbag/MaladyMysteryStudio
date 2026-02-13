#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const BASE_URL = process.env.MMS_SMOKE_BASE_URL?.trim() || "http://localhost:5050";
const POLL_MS = Number(process.env.MMS_SMOKE_POLL_MS || 5000);
const TIMEOUT_MS = Number(process.env.MMS_SMOKE_TIMEOUT_MS || 25 * 60 * 1000);
const TOPIC = process.argv.slice(2).join(" ").trim() || "Acute chest pain differential in urgent care";

function ensureOk(res, context) {
  if (res.ok) return;
  throw new Error(`${context} failed: HTTP ${res.status} ${res.statusText}`);
}

async function getJson(url, init) {
  const res = await fetch(url, init);
  ensureOk(res, url);
  return await res.json();
}

async function getArtifactJson(runId, name) {
  const encoded = encodeURIComponent(name);
  const res = await fetch(`${BASE_URL}/api/runs/${encodeURIComponent(runId)}/artifacts/${encoded}`);
  ensureOk(res, `artifact ${name}`);
  const text = await res.text();
  return JSON.parse(text);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractCanonicalCharacters(markdown) {
  const out = [];
  for (const line of String(markdown || "").split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const heading = t.match(/^#{1,4}\s+(.+)$/);
    if (heading?.[1]) out.push(heading[1].trim());
    const keyed = t.match(/(?:^[-*]\s*)?(?:name|character)\s*[:|-]\s*(.+)$/i);
    if (keyed?.[1]) out.push(keyed[1].trim());
  }
  return [...new Set(out)]
    .map((v) => v.replace(/[`*_#>\[\]]+/g, " ").trim())
    .filter((v) => v.length >= 3 && !/character bible|series style|deck spec/i.test(v));
}

function extractStyleMarkers(markdown) {
  const markers = [];
  for (const line of String(markdown || "").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    if (!/\b(must|required|always|ensure|keep|use)\b/i.test(t)) continue;
    const words = norm(t)
      .split(" ")
      .filter((w) => w.length >= 5)
      .slice(0, 3);
    if (words.length > 0) markers.push(words.join(" "));
  }
  return [...new Set(markers)].slice(0, 12);
}

async function main() {
  console.log(`Smoke test base URL: ${BASE_URL}`);
  console.log(`Smoke topic: ${TOPIC}`);

  const health = await getJson(`${BASE_URL}/api/health`);
  if (!health?.ok) throw new Error("Health check did not return ok=true.");
  if (!health?.hasKey) throw new Error("Health check indicates missing OPENAI_API_KEY.");
  if (!health?.hasVectorStoreId) throw new Error("Health check indicates missing KB_VECTOR_STORE_ID.");
  if (!health?.hasCanonicalProfileFiles) throw new Error("Health check indicates canonical files were not detected.");

  const runStart = await getJson(`${BASE_URL}/api/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic: TOPIC })
  });
  const runId = String(runStart?.runId || "");
  if (!runId) throw new Error("Run start did not return runId.");
  console.log(`Started run: ${runId}`);

  const startedAt = Date.now();
  let run = null;
  while (Date.now() - startedAt < TIMEOUT_MS) {
    run = await getJson(`${BASE_URL}/api/runs/${encodeURIComponent(runId)}`);
    console.log(`Run status: ${run.status}`);
    if (run.status === "done" || run.status === "error") break;
    await sleep(POLL_MS);
  }
  if (!run) throw new Error("Run status never became available.");
  if (run.status !== "done") {
    throw new Error(`Run ended with status=${run.status}.`);
  }

  const storyBibleWrap = await getArtifactJson(runId, "story_bible.json");
  const shotListWrap = await getArtifactJson(runId, "shot_list.json");
  const adherence = await getArtifactJson(runId, "constraint_adherence_report.json");

  const canonicalRoot = process.env.MMS_CANON_ROOT?.trim() || health.canonicalTemplateRoot;
  if (!canonicalRoot) throw new Error("Could not resolve canonical root for smoke assertions.");

  const [characterBible, styleBible, deckSpec] = await Promise.all([
    fs.readFile(path.join(canonicalRoot, "character_bible.md"), "utf8"),
    fs.readFile(path.join(canonicalRoot, "series_style_bible.md"), "utf8"),
    fs.readFile(path.join(canonicalRoot, "episode", "deck_spec.md"), "utf8")
  ]);

  const canonicalCharacters = extractCanonicalCharacters(characterBible);
  const styleMarkers = extractStyleMarkers(`${styleBible}\n${deckSpec}`);

  const storyText = norm(JSON.stringify(storyBibleWrap));
  const shotText = norm(JSON.stringify(shotListWrap));

  const matchedCharacters = canonicalCharacters.filter((name) => storyText.includes(norm(name)));
  const matchedStyleMarkers = styleMarkers.filter((marker) => {
    const parts = marker.split(" ").filter(Boolean);
    return parts.every((p) => shotText.includes(p));
  });

  if (matchedCharacters.length === 0) {
    throw new Error("Smoke check failed: no canonical character markers found in story_bible output.");
  }
  if (matchedStyleMarkers.length === 0) {
    throw new Error("Smoke check failed: no canonical style markers found in shot_list output.");
  }

  if (adherence?.status === "fail") {
    throw new Error(`Smoke check failed: constraint_adherence_report status=fail (${JSON.stringify(adherence.failures)})`);
  }

  console.log("Smoke checks passed.");
  console.log(`Matched canonical characters: ${matchedCharacters.slice(0, 5).join(", ")}`);
  console.log(`Matched style markers: ${matchedStyleMarkers.slice(0, 5).join(" | ")}`);
  console.log(`Constraint adherence status: ${adherence?.status ?? "unknown"}`);
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`SMOKE FAILED: ${msg}`);
  process.exitCode = 1;
});

