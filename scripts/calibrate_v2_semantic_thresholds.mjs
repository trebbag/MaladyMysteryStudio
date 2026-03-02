#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const out = {
    report: ".ci/pilot/v2-pilot-quality-latest.json",
    out: ".ci/pilot/v2-semantic-calibration-latest.json"
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
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function round3(value) {
  return Number(clamp01(value).toFixed(3));
}

function avg(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const numeric = values.map((v) => Number(v)).filter((v) => Number.isFinite(v));
  if (numeric.length === 0) return 0;
  return numeric.reduce((sum, v) => sum + v, 0) / numeric.length;
}

function pickMetric(summary, results, key) {
  const summaryValue = Number(summary?.[key]);
  if (Number.isFinite(summaryValue)) return clamp01(summaryValue);
  return clamp01(avg((results ?? []).map((row) => Number(row?.[key]))));
}

function computeCalibration(report) {
  const summary = report?.summary ?? {};
  const results = Array.isArray(report?.results) ? report.results : [];
  const runCount = Number(summary.runCount ?? results.length ?? 0);
  const doneCount = Number(summary.doneCount ?? results.filter((row) => row?.status === "done").length ?? 0);

  const observed = {
    avgStoryForwardRatio: pickMetric(summary, results, "avgStoryForwardRatio"),
    avgHybridSlideQuality: pickMetric(summary, results, "avgHybridSlideQuality"),
    avgCitationGroundingCoverage: pickMetric(summary, results, "avgCitationGroundingCoverage")
  };

  const defaults = {
    minStoryForwardRatio: round3(Math.max(0.65, observed.avgStoryForwardRatio - 0.05)),
    minHybridSlideQuality: round3(Math.max(0.75, observed.avgHybridSlideQuality - 0.05)),
    minCitationGroundingCoverage: round3(Math.max(0.8, observed.avgCitationGroundingCoverage - 0.04))
  };

  const stretch = {
    minStoryForwardRatio: round3(Math.max(defaults.minStoryForwardRatio, observed.avgStoryForwardRatio - 0.01)),
    minHybridSlideQuality: round3(Math.max(defaults.minHybridSlideQuality, observed.avgHybridSlideQuality - 0.01)),
    minCitationGroundingCoverage: round3(Math.max(defaults.minCitationGroundingCoverage, observed.avgCitationGroundingCoverage - 0.01))
  };

  return {
    generatedAt: new Date().toISOString(),
    sourceReportGeneratedAt: report?.generatedAt ?? null,
    sourceReportPath: report?.reportPath ?? null,
    sample: { runCount, doneCount },
    observed,
    recommendation: {
      defaults,
      stretch,
      rationale:
        "Defaults are observed means minus a safety margin to reduce false semantic gate blocks while preserving quality pressure."
    },
    env: {
      MMS_V2_MIN_STORY_FORWARD_RATIO: defaults.minStoryForwardRatio,
      MMS_V2_MIN_HYBRID_SLIDE_QUALITY: defaults.minHybridSlideQuality,
      MMS_V2_MIN_CITATION_GROUNDING_COVERAGE: defaults.minCitationGroundingCoverage
    },
    cli: {
      defaults:
        `MMS_V2_MIN_STORY_FORWARD_RATIO=${String(defaults.minStoryForwardRatio)} ` +
        `MMS_V2_MIN_HYBRID_SLIDE_QUALITY=${String(defaults.minHybridSlideQuality)} ` +
        `MMS_V2_MIN_CITATION_GROUNDING_COVERAGE=${String(defaults.minCitationGroundingCoverage)}`,
      stretch:
        `MMS_V2_MIN_STORY_FORWARD_RATIO=${String(stretch.minStoryForwardRatio)} ` +
        `MMS_V2_MIN_HYBRID_SLIDE_QUALITY=${String(stretch.minHybridSlideQuality)} ` +
        `MMS_V2_MIN_CITATION_GROUNDING_COVERAGE=${String(stretch.minCitationGroundingCoverage)}`
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
  console.log(`Recommended defaults: ${calibration.cli.defaults}`);
  // eslint-disable-next-line no-console
  console.log(`Recommended stretch: ${calibration.cli.stretch}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  // eslint-disable-next-line no-console
  console.error(`calibrate_v2_semantic_thresholds failed: ${message}`);
  process.exitCode = 1;
});

