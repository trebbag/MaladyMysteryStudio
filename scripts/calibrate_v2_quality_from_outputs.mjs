#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const out = {
    outputRoot: "output",
    outJson: ".ci/pilot/v2-threshold-calibration-from-runs.json",
    outMd: ".ci/pilot/v2-threshold-calibration-from-runs.md",
    workflow: "v2_micro_detectives",
    generationProfile: "quality",
    minRuns: 3,
    strictMinRuns: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--output-root") {
      out.outputRoot = argv[i + 1] || out.outputRoot;
      i += 1;
      continue;
    }
    if (arg === "--out-json") {
      out.outJson = argv[i + 1] || out.outJson;
      i += 1;
      continue;
    }
    if (arg === "--out-md") {
      out.outMd = argv[i + 1] || out.outMd;
      i += 1;
      continue;
    }
    if (arg === "--workflow") {
      out.workflow = argv[i + 1] || out.workflow;
      i += 1;
      continue;
    }
    if (arg === "--generation-profile") {
      out.generationProfile = argv[i + 1] || out.generationProfile;
      i += 1;
      continue;
    }
    if (arg === "--min-runs") {
      out.minRuns = Number(argv[i + 1] || out.minRuns);
      i += 1;
      continue;
    }
    if (arg === "--strict-min-runs") {
      out.strictMinRuns = true;
      continue;
    }
  }
  if (!Number.isFinite(out.minRuns) || out.minRuns < 1) out.minRuns = 3;
  return out;
}

async function readJsonIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function clamp(value, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return min;
  return Math.max(min, Math.min(max, num));
}

function to3(value) {
  return Number(Number(value).toFixed(3));
}

function quantile(values, q) {
  const nums = values.map((v) => Number(v)).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (nums.length === 0) return 0;
  const pos = (nums.length - 1) * clamp(q, 0, 1);
  const base = Math.floor(pos);
  const rest = pos - base;
  const lower = nums[base] ?? nums[0];
  const upper = nums[Math.min(base + 1, nums.length - 1)] ?? lower;
  return lower + rest * (upper - lower);
}

function mean(values) {
  const nums = values.map((v) => Number(v)).filter((v) => Number.isFinite(v));
  if (nums.length === 0) return 0;
  return nums.reduce((sum, n) => sum + n, 0) / nums.length;
}

function getNarrativeScore(qaReport, category) {
  const scores = Array.isArray(qaReport?.grader_scores) ? qaReport.grader_scores : [];
  const row = scores.find((item) => String(item?.category || "") === category);
  const num = Number(row?.score_0_to_5);
  return Number.isFinite(num) ? num : null;
}

async function collectRuns(options) {
  const rows = [];
  const dirs = await fs.readdir(options.outputRoot, { withFileTypes: true }).catch(() => []);
  for (const dirent of dirs) {
    if (!dirent.isDirectory()) continue;
    const runId = dirent.name;
    const runDir = path.join(options.outputRoot, runId);
    const runJson = await readJsonIfExists(path.join(runDir, "run.json"));
    if (!runJson || typeof runJson !== "object") continue;

    const workflow = String(runJson?.settings?.workflow || "legacy");
    const generationProfile = String(runJson?.settings?.generationProfile || "quality");
    const status = String(runJson?.status || "");
    if (workflow !== options.workflow) continue;
    if (options.generationProfile && generationProfile !== options.generationProfile) continue;
    if (status !== "done") continue;

    const intermediateDir = path.join(runDir, "intermediate");
    const semantic = await readJsonIfExists(path.join(intermediateDir, "semantic_acceptance_report.json"));
    const qa = await readJsonIfExists(path.join(intermediateDir, "qa_report.json"));
    const fallback = await readJsonIfExists(path.join(intermediateDir, "fallback_usage.json"));
    if (!semantic || !qa) continue;

    const storyForwardRatio = Number(semantic?.metrics?.story_forward_ratio);
    const hybridSlideQuality = Number(semantic?.metrics?.hybrid_slide_quality);
    const citationGroundingCoverage = Number(semantic?.metrics?.citation_grounding_coverage);
    if (![storyForwardRatio, hybridSlideQuality, citationGroundingCoverage].every((n) => Number.isFinite(n))) continue;

    rows.push({
      runId,
      topic: String(runJson?.topic || ""),
      startedAt: String(runJson?.startedAt || ""),
      finishedAt: String(runJson?.finishedAt || ""),
      storyForwardRatio,
      hybridSlideQuality,
      citationGroundingCoverage,
      qaAccept: Boolean(qa?.accept),
      narrativeScores: {
        story: getNarrativeScore(qa, "StoryDominance"),
        twist: getNarrativeScore(qa, "TwistInevitability"),
        clarity: getNarrativeScore(qa, "MedicalClarity"),
        actEscalation: getNarrativeScore(qa, "ActEscalation"),
        falseTheoryArc: getNarrativeScore(qa, "FalseTheoryArc"),
        callbackClosure: getNarrativeScore(qa, "CallbackClosure"),
        detectiveDeputyArc: getNarrativeScore(qa, "DetectiveDeputyArc"),
        genericLanguageRate: getNarrativeScore(qa, "GenericLanguageRate")
      },
      deterministicFallbackUsed: Boolean(fallback?.deterministic_fallback_used ?? fallback?.used),
      fallbackEventCount: Number(fallback?.deterministic_fallback_event_count ?? fallback?.fallback_event_count ?? 0)
    });
  }
  return rows.sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
}

function recommendThresholds(rows) {
  const storyForward = rows.map((r) => r.storyForwardRatio);
  const hybrid = rows.map((r) => r.hybridSlideQuality);
  const citation = rows.map((r) => r.citationGroundingCoverage);
  const fallbackRate = mean(rows.map((r) => (r.deterministicFallbackUsed ? 1 : 0)));
  const qaAcceptRate = mean(rows.map((r) => (r.qaAccept ? 1 : 0)));

  const metric = (values, floor, margin = 0.02, ceiling = 0.98) => to3(clamp(quantile(values, 0.25) - margin, floor, ceiling));

  const envThresholds = {
    MMS_V2_MIN_STORY_FORWARD_RATIO: metric(storyForward, 0.65, 0.02, 0.95),
    MMS_V2_MIN_HYBRID_SLIDE_QUALITY: metric(hybrid, 0.75, 0.025, 0.98),
    MMS_V2_MIN_CITATION_GROUNDING_COVERAGE: metric(citation, 0.8, 0.02, 0.99)
  };

  const qaMetric = (key, floor, margin = 0.2) => {
    const values = rows.map((row) => Number(row.narrativeScores[key])).filter((v) => Number.isFinite(v));
    return to3(clamp(quantile(values, 0.25) - margin, floor, 5));
  };

  return {
    sample: {
      runCount: rows.length,
      qaAcceptRate: to3(qaAcceptRate),
      deterministicFallbackRunRate: to3(fallbackRate),
      avgFallbackEventCount: to3(mean(rows.map((r) => r.fallbackEventCount)))
    },
    observedMeans: {
      storyForwardRatio: to3(mean(storyForward)),
      hybridSlideQuality: to3(mean(hybrid)),
      citationGroundingCoverage: to3(mean(citation)),
      storyScore: to3(mean(rows.map((r) => Number(r.narrativeScores.story)).filter((v) => Number.isFinite(v)))),
      twistScore: to3(mean(rows.map((r) => Number(r.narrativeScores.twist)).filter((v) => Number.isFinite(v)))),
      clarityScore: to3(mean(rows.map((r) => Number(r.narrativeScores.clarity)).filter((v) => Number.isFinite(v))))
    },
    envThresholds,
    suggestedHarnessTargets: {
      minStoryForwardRatio: envThresholds.MMS_V2_MIN_STORY_FORWARD_RATIO,
      minHybridSlideQuality: envThresholds.MMS_V2_MIN_HYBRID_SLIDE_QUALITY,
      minCitationGroundingCoverage: envThresholds.MMS_V2_MIN_CITATION_GROUNDING_COVERAGE,
      minStoryScore: qaMetric("story", 2.6, 0.18),
      minTwistScore: qaMetric("twist", 2.4, 0.2),
      minClarityScore: qaMetric("clarity", 2.8, 0.18),
      minActEscalation: qaMetric("actEscalation", 2.5, 0.2),
      minFalseTheoryArc: qaMetric("falseTheoryArc", 2.4, 0.2),
      minCallbackClosure: qaMetric("callbackClosure", 2.4, 0.2),
      minDetectiveDeputyArc: qaMetric("detectiveDeputyArc", 2.2, 0.2),
      minGenericLanguageScore: qaMetric("genericLanguageRate", 2.2, 0.2)
    }
  };
}

function buildMarkdown(report) {
  const lines = [];
  lines.push("# V2 Quality Threshold Calibration (From Existing Runs)");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Workflow: ${report.filters.workflow}`);
  lines.push(`Generation profile: ${report.filters.generationProfile}`);
  lines.push("");
  lines.push("## Sample");
  lines.push("");
  lines.push(`- Runs used: ${report.recommendation.sample.runCount}`);
  lines.push(`- QA accept rate: ${report.recommendation.sample.qaAcceptRate}`);
  lines.push(`- Deterministic fallback run rate: ${report.recommendation.sample.deterministicFallbackRunRate}`);
  lines.push(`- Avg fallback event count: ${report.recommendation.sample.avgFallbackEventCount}`);
  lines.push("");
  lines.push("## Recommended Env Thresholds");
  lines.push("");
  lines.push(`- MMS_V2_MIN_STORY_FORWARD_RATIO=${report.recommendation.envThresholds.MMS_V2_MIN_STORY_FORWARD_RATIO}`);
  lines.push(`- MMS_V2_MIN_HYBRID_SLIDE_QUALITY=${report.recommendation.envThresholds.MMS_V2_MIN_HYBRID_SLIDE_QUALITY}`);
  lines.push(`- MMS_V2_MIN_CITATION_GROUNDING_COVERAGE=${report.recommendation.envThresholds.MMS_V2_MIN_CITATION_GROUNDING_COVERAGE}`);
  lines.push("");
  lines.push("## Suggested Harness SLO Targets");
  lines.push("");
  for (const [key, value] of Object.entries(report.recommendation.suggestedHarnessTargets)) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("- This report does not trigger model runs; it calibrates from persisted run artifacts in output/.");
  lines.push("- Re-run after each real-key pilot batch before updating production defaults.");
  if (!report.sampleAdequate) {
    lines.push("- Sample is below requested minimum; treat recommendations as provisional.");
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const rows = await collectRuns(options);
  const recommendation = recommendThresholds(rows);
  const sampleAdequate = rows.length >= options.minRuns;

  const report = {
    generatedAt: new Date().toISOString(),
    filters: {
      outputRoot: options.outputRoot,
      workflow: options.workflow,
      generationProfile: options.generationProfile
    },
    sampleAdequate,
    minRunsRequired: options.minRuns,
    runIds: rows.map((row) => row.runId),
    recommendation
  };

  await fs.mkdir(path.dirname(options.outJson), { recursive: true });
  await fs.mkdir(path.dirname(options.outMd), { recursive: true });
  await fs.writeFile(options.outJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(options.outMd, buildMarkdown(report), "utf8");

  // eslint-disable-next-line no-console
  console.log(`Wrote ${options.outJson}`);
  // eslint-disable-next-line no-console
  console.log(`Wrote ${options.outMd}`);
  // eslint-disable-next-line no-console
  console.log(
    `Recommended env: MMS_V2_MIN_STORY_FORWARD_RATIO=${String(
      report.recommendation.envThresholds.MMS_V2_MIN_STORY_FORWARD_RATIO
    )} MMS_V2_MIN_HYBRID_SLIDE_QUALITY=${String(
      report.recommendation.envThresholds.MMS_V2_MIN_HYBRID_SLIDE_QUALITY
    )} MMS_V2_MIN_CITATION_GROUNDING_COVERAGE=${String(
      report.recommendation.envThresholds.MMS_V2_MIN_CITATION_GROUNDING_COVERAGE
    )}`
  );

  if (!sampleAdequate && options.strictMinRuns) {
    throw new Error(`Calibration sample too small: found ${rows.length}, required ${options.minRuns}.`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  // eslint-disable-next-line no-console
  console.error(`calibrate_v2_quality_from_outputs failed: ${message}`);
  process.exitCode = 1;
});

