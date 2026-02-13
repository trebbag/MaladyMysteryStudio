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

function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
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

function summarizeResults(results, outcome) {
  const stats = (results && typeof results === "object" ? results.stats : null) || {};
  const passed = numberOrZero(stats.expected);
  const failed = numberOrZero(stats.unexpected);
  const flaky = numberOrZero(stats.flaky);
  const skipped = numberOrZero(stats.skipped);
  const total = Math.max(passed + failed + flaky + skipped, 0);
  const durationMs = numberOrZero(stats.duration);
  const computedOutcome = outcome === "failure" || failed > 0 ? "failure" : "success";

  return {
    passed,
    failed,
    flaky,
    skipped,
    total,
    durationMs,
    outcome: computedOutcome
  };
}

function entryFromSummary(summary) {
  const ts = new Date().toISOString();
  const runId = process.env.GITHUB_RUN_ID ?? "local";
  const runNumber = process.env.GITHUB_RUN_NUMBER ?? "local";
  const refName = process.env.GITHUB_REF_NAME ?? "local";
  const sha = process.env.GITHUB_SHA ?? "local";

  return {
    at: ts,
    runId,
    runNumber,
    refName,
    sha,
    outcome: summary.outcome,
    total: summary.total,
    passed: summary.passed,
    failed: summary.failed,
    flaky: summary.flaky,
    skipped: summary.skipped,
    passRate: summary.total > 0 ? Number(((summary.passed / summary.total) * 100).toFixed(2)) : 0,
    durationMs: summary.durationMs
  };
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function toHtml(history, latest) {
  const rows = history
    .slice()
    .reverse()
    .map((row) => {
      const badgeClass = row.outcome === "success" ? "ok" : "bad";
      return `<tr>
  <td>${escapeHtml(row.at)}</td>
  <td>${escapeHtml(row.runNumber)}</td>
  <td>${escapeHtml(row.refName)}</td>
  <td><span class="badge ${badgeClass}">${escapeHtml(row.outcome)}</span></td>
  <td>${row.passed}/${row.total}</td>
  <td>${row.failed}</td>
  <td>${row.flaky}</td>
  <td>${row.skipped}</td>
  <td>${row.passRate.toFixed(2)}%</td>
  <td>${escapeHtml(formatDuration(row.durationMs))}</td>
</tr>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Soak Trend History</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; color: #0f172a; }
    h1 { margin: 0 0 12px; font-size: 22px; }
    .meta { margin: 0 0 16px; color: #334155; font-size: 14px; }
    table { border-collapse: collapse; width: 100%; font-size: 13px; }
    th, td { border: 1px solid #cbd5e1; padding: 8px; text-align: left; }
    th { background: #f1f5f9; }
    .badge { border-radius: 999px; padding: 2px 8px; font-size: 12px; border: 1px solid transparent; }
    .badge.ok { background: #dcfce7; color: #166534; border-color: #86efac; }
    .badge.bad { background: #fee2e2; color: #991b1b; border-color: #fca5a5; }
  </style>
</head>
<body>
  <h1>Soak Trend History</h1>
  <p class="meta">Latest run: ${escapeHtml(latest.runNumber)} (${escapeHtml(latest.outcome)}), pass rate ${latest.passRate.toFixed(
    2
  )}%.</p>
  <table>
    <thead>
      <tr>
        <th>Timestamp</th>
        <th>Run #</th>
        <th>Ref</th>
        <th>Outcome</th>
        <th>Passed/Total</th>
        <th>Failed</th>
        <th>Flaky</th>
        <th>Skipped</th>
        <th>Pass Rate</th>
        <th>Duration</th>
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
  const resultsPath = args.results ?? "web/test-results/soak-results.json";
  const historyPath = args.history ?? ".ci/soak/soak-trend-history.json";
  const outputDir = args.outDir ?? ".ci/soak-report";
  const outcome = args.outcome ?? "success";
  const maxEntries = Math.max(1, numberOrZero(args.maxEntries) || 60);

  const results = await readJsonSafe(resultsPath, {});
  const summary = summarizeResults(results, outcome);
  const entry = entryFromSummary(summary);

  const prevHistory = await readJsonSafe(historyPath, []);
  const history = Array.isArray(prevHistory) ? prevHistory.slice() : [];
  history.push(entry);
  const clipped = history.slice(-maxEntries);

  await ensureDir(path.dirname(historyPath));
  await fs.writeFile(historyPath, `${JSON.stringify(clipped, null, 2)}\n`, "utf8");

  await ensureDir(outputDir);
  const html = toHtml(clipped, entry);
  await fs.writeFile(path.join(outputDir, "soak-trend-history.html"), html, "utf8");
  await fs.writeFile(path.join(outputDir, "soak-trend-history.json"), `${JSON.stringify(clipped, null, 2)}\n`, "utf8");
}

await main();
