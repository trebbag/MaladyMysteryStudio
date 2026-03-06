#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      out[key] = "true";
      continue;
    }
    out[key] = value;
    i += 1;
  }
  return out;
}

async function readJsonSafe(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function markerPass(report) {
  return Boolean(
    report?.markers?.openingHook &&
      report?.markers?.falseTheoryLockIn &&
      report?.markers?.midpointCollapse &&
      report?.markers?.ruptureRepair &&
      report?.markers?.endingCallback
  );
}

function entryFromReport(report) {
  return {
    at: report?.generatedAt ?? new Date().toISOString(),
    runId: report?.runId ?? "unknown",
    topic: report?.topic ?? "unknown",
    pass: Boolean(report?.pass),
    elapsedMs: Number(report?.elapsedMs || 0),
    artifactCount: Number(report?.artifactCount || 0),
    missingArtifacts: Array.isArray(report?.missingArtifacts) ? report.missingArtifacts : [],
    markerPass: markerPass(report),
    openingHook: Boolean(report?.markers?.openingHook),
    falseTheoryLockIn: Boolean(report?.markers?.falseTheoryLockIn),
    midpointCollapse: Boolean(report?.markers?.midpointCollapse),
    ruptureRepair: Boolean(report?.markers?.ruptureRepair),
    endingCallback: Boolean(report?.markers?.endingCallback),
    slideCount: numberOrNull(report?.markers?.details?.slideCount),
    twistPass: Boolean(report?.twist?.pass),
    provenancePass: Boolean(report?.provenance?.pass),
    gateActionCount: Array.isArray(report?.gateActions) ? report.gateActions.length : 0,
    gate3Regens: Number(report?.gate3Regens || 0),
    errorMessage: report?.errorMessage ? String(report.errorMessage) : ""
  };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmt(value, digits = 2) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : "n/a";
}

function toMarkdown(history) {
  const latest = history[history.length - 1];
  const lines = [];
  lines.push("# V2 Quality Smoke Trend");
  lines.push("");
  lines.push(`Latest run: ${latest?.runId ?? "n/a"} (${latest?.pass ? "PASS" : "FAIL"})`);
  lines.push("");
  lines.push("| Timestamp | Run ID | Status | Slide Count | Markers | Twist | Provenance | Gate Actions | Missing Artifacts |");
  lines.push("| --- | --- | --- | ---: | --- | --- | --- | ---: | --- |");
  for (const row of history.slice().reverse()) {
    lines.push(
      `| ${row.at} | ${row.runId} | ${row.pass ? "PASS" : "FAIL"} | ${fmt(row.slideCount, 0)} | ${row.markerPass ? "PASS" : "FAIL"} | ${row.twistPass ? "PASS" : "FAIL"} | ${row.provenancePass ? "PASS" : "FAIL"} | ${row.gateActionCount} | ${row.missingArtifacts.length > 0 ? row.missingArtifacts.join(", ") : "-"} |`
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function toHtml(history) {
  const latest = history[history.length - 1];
  const rows = history
    .slice()
    .reverse()
    .map((row) => {
      const passBadge = row.pass ? "ok" : "bad";
      return `<tr>
  <td>${escapeHtml(row.at)}</td>
  <td>${escapeHtml(row.runId)}</td>
  <td>${escapeHtml(row.topic)}</td>
  <td><span class="badge ${passBadge}">${row.pass ? "PASS" : "FAIL"}</span></td>
  <td>${fmt(row.slideCount, 0)}</td>
  <td>${row.markerPass ? "PASS" : "FAIL"}</td>
  <td>${row.twistPass ? "PASS" : "FAIL"}</td>
  <td>${row.provenancePass ? "PASS" : "FAIL"}</td>
  <td>${row.gateActionCount}</td>
  <td>${row.gate3Regens}</td>
  <td>${fmt(row.elapsedMs / 1000)}</td>
  <td>${escapeHtml(row.missingArtifacts.length > 0 ? row.missingArtifacts.join(", ") : "-")}</td>
  <td>${escapeHtml(row.errorMessage || "-")}</td>
</tr>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>V2 Quality Smoke Trend</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; color: #0f172a; }
    h1 { margin: 0 0 12px; font-size: 22px; }
    .meta { margin: 0 0 16px; color: #334155; font-size: 14px; }
    table { border-collapse: collapse; width: 100%; font-size: 12px; }
    th, td { border: 1px solid #cbd5e1; padding: 8px; text-align: left; vertical-align: top; }
    th { background: #f1f5f9; }
    .badge { border-radius: 999px; padding: 2px 8px; font-size: 12px; border: 1px solid transparent; }
    .badge.ok { background: #dcfce7; color: #166534; border-color: #86efac; }
    .badge.bad { background: #fee2e2; color: #991b1b; border-color: #fca5a5; }
  </style>
</head>
<body>
  <h1>V2 Quality Smoke Trend</h1>
  <p class="meta">Latest run ${escapeHtml(latest?.runId ?? "n/a")} is ${latest?.pass ? "PASS" : "FAIL"}.</p>
  <table>
    <thead>
      <tr>
        <th>Timestamp</th>
        <th>Run ID</th>
        <th>Topic</th>
        <th>Status</th>
        <th>Slides</th>
        <th>Markers</th>
        <th>Twist</th>
        <th>Provenance</th>
        <th>Gate Actions</th>
        <th>Gate 3 Regens</th>
        <th>Elapsed (s)</th>
        <th>Missing Artifacts</th>
        <th>Error</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
</body>
</html>`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const reportPath = args.report ?? ".ci/smoke/v2-quality-smoke-latest.json";
  const historyPath = args.history ?? ".ci/smoke/v2-quality-smoke-trend-history.json";
  const outputDir = args.outDir ?? ".ci/smoke-report";
  const maxEntries = Math.max(1, Number(args.maxEntries || 60));

  const prevHistory = await readJsonSafe(historyPath, []);
  const history = Array.isArray(prevHistory) ? prevHistory.slice() : [];
  const report = await readJsonSafe(reportPath, null);
  if (report) {
    history.push(entryFromReport(report));
  }
  const clipped = history.slice(-maxEntries);

  await ensureDir(path.dirname(historyPath));
  await fs.writeFile(historyPath, `${JSON.stringify(clipped, null, 2)}\n`, "utf8");

  await ensureDir(outputDir);
  await fs.writeFile(path.join(outputDir, "v2-quality-smoke-trend-history.json"), `${JSON.stringify(clipped, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(outputDir, "v2-quality-smoke-trend-history.md"), toMarkdown(clipped), "utf8");
  await fs.writeFile(path.join(outputDir, "v2-quality-smoke-trend-history.html"), toHtml(clipped), "utf8");
}

await main();
