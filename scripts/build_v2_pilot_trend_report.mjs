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

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

function entryFromReport(report) {
  const summary = report?.summary ?? {};
  const slo = report?.slo?.evaluation ?? {};
  return {
    at: report?.generatedAt ?? new Date().toISOString(),
    runId: process.env.GITHUB_RUN_ID ?? "local",
    runNumber: process.env.GITHUB_RUN_NUMBER ?? "local",
    refName: process.env.GITHUB_REF_NAME ?? "local",
    sha: process.env.GITHUB_SHA ?? "local",
    runCount: Number(summary.runCount || 0),
    doneCount: Number(summary.doneCount || 0),
    errorCount: Number(summary.errorCount || 0),
    timeoutCount: Number(summary.timeoutCount || 0),
    qaAcceptRate: numberOrNull(summary.qaAcceptRate),
    medPassRate: numberOrNull(summary.medPassRate),
    avgStoryScore: numberOrNull(summary.avgStoryScore),
    avgTwistScore: numberOrNull(summary.avgTwistScore),
    avgClarityScore: numberOrNull(summary.avgClarityScore),
    avgStoryForwardRatio: numberOrNull(summary.avgStoryForwardRatio),
    avgPackagingCompleteness: numberOrNull(summary.avgPackagingCompleteness),
    avgMainRenderPlanCoverage: numberOrNull(summary.avgMainRenderPlanCoverage),
    avgCluePayoffCoverage: numberOrNull(summary.avgCluePayoffCoverage),
    renderPlanMarkerPassRate: numberOrNull(summary.renderPlanMarkerPassRate),
    placeholderRunRate: numberOrNull(summary.placeholderRunRate),
    fallbackRunRate: numberOrNull(summary.fallbackRunRate),
    avgFallbackEventCount: numberOrNull(summary.avgFallbackEventCount),
    avgAgentRetryEventCount: numberOrNull(summary.avgAgentRetryEventCount),
    errorRate: numberOrNull(slo.errorRate),
    timeoutRate: numberOrNull(slo.timeoutRate),
    sloPass: Boolean(slo.pass),
    violations: Array.isArray(slo.violations) ? slo.violations : []
  };
}

function fmt(value, digits = 3) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : "n/a";
}

function toHtml(history, latest) {
  const rows = history
    .slice()
    .reverse()
    .map((row) => {
      const badgeClass = row.sloPass ? "ok" : "bad";
      const violations = row.violations.length > 0 ? row.violations.join("; ") : "-";
      return `<tr>
  <td>${escapeHtml(row.at)}</td>
  <td>${escapeHtml(row.runNumber)}</td>
  <td>${escapeHtml(row.refName)}</td>
  <td><span class="badge ${badgeClass}">${row.sloPass ? "pass" : "fail"}</span></td>
  <td>${row.doneCount}/${row.runCount}</td>
  <td>${fmt(row.qaAcceptRate)}</td>
  <td>${fmt(row.medPassRate)}</td>
  <td>${fmt(row.avgStoryScore, 2)}</td>
  <td>${fmt(row.avgTwistScore, 2)}</td>
  <td>${fmt(row.avgClarityScore, 2)}</td>
  <td>${fmt(row.avgStoryForwardRatio)}</td>
  <td>${fmt(row.avgPackagingCompleteness)}</td>
  <td>${fmt(row.avgMainRenderPlanCoverage)}</td>
  <td>${fmt(row.avgCluePayoffCoverage)}</td>
  <td>${fmt(row.renderPlanMarkerPassRate)}</td>
  <td>${fmt(row.placeholderRunRate)}</td>
  <td>${fmt(row.fallbackRunRate)}</td>
  <td>${fmt(row.avgFallbackEventCount, 2)}</td>
  <td>${fmt(row.avgAgentRetryEventCount, 2)}</td>
  <td>${fmt(row.errorRate)}</td>
  <td>${fmt(row.timeoutRate)}</td>
  <td>${escapeHtml(violations)}</td>
</tr>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>V2 Pilot Quality Trend</title>
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
  <h1>V2 Pilot Quality Trend</h1>
  <p class="meta">Latest run #${escapeHtml(latest.runNumber)} SLO ${latest.sloPass ? "pass" : "fail"}.</p>
  <table>
    <thead>
      <tr>
        <th>Timestamp</th>
        <th>Run #</th>
        <th>Ref</th>
        <th>SLO</th>
        <th>Done/Total</th>
        <th>QA Accept</th>
        <th>Med Pass</th>
        <th>Story</th>
        <th>Twist</th>
        <th>Clarity</th>
        <th>Story Ratio</th>
        <th>Packaging</th>
        <th>Render Cov</th>
        <th>Clue Payoff</th>
        <th>Marker Pass</th>
        <th>Placeholders</th>
        <th>Fallback Rate</th>
        <th>Fallback Events</th>
        <th>Retry Events</th>
        <th>Error Rate</th>
        <th>Timeout Rate</th>
        <th>Violations</th>
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
  const reportPath = args.report ?? ".ci/pilot/v2-pilot-quality-latest.json";
  const historyPath = args.history ?? ".ci/pilot/v2-pilot-trend-history.json";
  const outputDir = args.outDir ?? ".ci/pilot-report";
  const maxEntries = Math.max(1, Number(args.maxEntries || 60));

  const report = await readJsonSafe(reportPath, null);
  if (!report) throw new Error(`Missing report json at ${reportPath}`);

  const prevHistory = await readJsonSafe(historyPath, []);
  const history = Array.isArray(prevHistory) ? prevHistory.slice() : [];
  history.push(entryFromReport(report));
  const clipped = history.slice(-maxEntries);

  await ensureDir(path.dirname(historyPath));
  await fs.writeFile(historyPath, `${JSON.stringify(clipped, null, 2)}\n`, "utf8");

  await ensureDir(outputDir);
  await fs.writeFile(path.join(outputDir, "v2-pilot-trend-history.json"), `${JSON.stringify(clipped, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(outputDir, "v2-pilot-trend-history.html"), toHtml(clipped, clipped[clipped.length - 1]), "utf8");
}

await main();
