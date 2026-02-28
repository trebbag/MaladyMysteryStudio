#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const out = {
    report: ".ci/pilot-real/v2-pilot-quality-latest.json",
    out: ".ci/pilot-real/v2-fallback-calibration-latest.json"
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--report") {
      out.report = argv[i + 1] || out.report;
      i += 1;
      continue;
    }
    if (token === "--out") {
      out.out = argv[i + 1] || out.out;
      i += 1;
      continue;
    }
  }
  return out;
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(1, value));
}

function round3(value) {
  return Number(clamp01(value).toFixed(3));
}

function computeCalibration(report) {
  const summary = report?.summary ?? {};
  const runCount = Number(summary.runCount ?? 0);
  const doneCount = Number(summary.doneCount ?? 0);
  const fallbackRunRate = clamp01(Number(summary.fallbackRunRate ?? 1));
  const avgFallbackEventCount = Number(summary.avgFallbackEventCount ?? 0);
  const avgAgentRetryEventCount = Number(summary.avgAgentRetryEventCount ?? 0);
  const avgStoryScore = Number(summary.avgStoryScore ?? 0);
  const avgTwistScore = Number(summary.avgTwistScore ?? 0);
  const avgClarityScore = Number(summary.avgClarityScore ?? 0);

  const strictTarget = round3(Math.max(0, fallbackRunRate - 0.2));
  const enforceMax = round3(Math.min(1, fallbackRunRate + 0.05));

  return {
    generatedAt: new Date().toISOString(),
    sourceReportGeneratedAt: report?.generatedAt ?? null,
    sample: { runCount, doneCount },
    observed: {
      deterministicFallbackRunRate: round3(fallbackRunRate),
      avgFallbackEventCount: Number(avgFallbackEventCount.toFixed(3)),
      avgAgentRetryEventCount: Number(avgAgentRetryEventCount.toFixed(3)),
      avgStoryScore: Number(avgStoryScore.toFixed(3)),
      avgTwistScore: Number(avgTwistScore.toFixed(3)),
      avgClarityScore: Number(avgClarityScore.toFixed(3))
    },
    recommendation: {
      maxFallbackRunRate_enforced: enforceMax,
      fallbackRunRate_improvementTarget: strictTarget,
      rationale:
        "Set enforced max to observed+5% (clamped to 1) to avoid false negatives while tracking improvement target as observed-20%."
    },
    cli: {
      enforceNow: `--max-fallback-run-rate ${String(enforceMax)}`,
      improvementTargetOnly: `--max-fallback-run-rate ${String(strictTarget)}`
    }
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const raw = await fs.readFile(args.report, "utf8");
  const report = JSON.parse(raw);
  const calibration = computeCalibration(report);

  await fs.mkdir(path.dirname(args.out), { recursive: true });
  await fs.writeFile(args.out, `${JSON.stringify(calibration, null, 2)}\n`, "utf8");
  // eslint-disable-next-line no-console
  console.log(`Wrote ${args.out}`);
  // eslint-disable-next-line no-console
  console.log(`Recommended now: ${calibration.cli.enforceNow}`);
  // eslint-disable-next-line no-console
  console.log(`Improvement target: ${calibration.cli.improvementTargetOnly}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  // eslint-disable-next-line no-console
  console.error(`calibrate_v2_fallback_slo failed: ${message}`);
  process.exitCode = 1;
});
