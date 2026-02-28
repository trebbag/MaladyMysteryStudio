#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const options = {
    baseUrl: "http://localhost:5050",
    outputDir: ".ci/pilot",
    deckLength: 30,
    timeoutMinutes: 35,
    topics: [],
    enforceSlo: true
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--topic") {
      const value = argv[i + 1];
      if (value) options.topics.push(value);
      i += 1;
      continue;
    }
    if (arg === "--base-url") {
      options.baseUrl = argv[i + 1] || options.baseUrl;
      i += 1;
      continue;
    }
    if (arg === "--output-dir") {
      options.outputDir = argv[i + 1] || options.outputDir;
      i += 1;
      continue;
    }
    if (arg === "--deck-length") {
      options.deckLength = Number(argv[i + 1] || options.deckLength);
      i += 1;
      continue;
    }
    if (arg === "--timeout-minutes") {
      options.timeoutMinutes = Number(argv[i + 1] || options.timeoutMinutes);
      i += 1;
      continue;
    }
    if (arg === "--no-enforce-slo") {
      options.enforceSlo = false;
      continue;
    }
  }
  if (options.topics.length === 0) {
    options.topics = [
      "Community-acquired pneumonia in adults",
      "Diabetic ketoacidosis in adults",
      "Acute decompensated heart failure"
    ];
  }
  return options;
}

function runCommand(name, command, args) {
  // eslint-disable-next-line no-console
  console.log(`\n[${name}] ${[command, ...args].join(" ")}`);
  const res = spawnSync(command, args, { stdio: "inherit", shell: false });
  if (res.status !== 0) {
    throw new Error(`${name} failed with exit code ${String(res.status)}`);
  }
}

function fmt(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "n/a";
  return Number(value).toFixed(3);
}

function recommendationBlock(report) {
  const summary = report?.summary ?? {};
  const recs = [];

  const lowStory = Number(summary.avgStoryScore ?? 0) < 3.2;
  const lowTwist = Number(summary.avgTwistScore ?? 0) < 3.0;
  const lowClarity = Number(summary.avgClarityScore ?? 0) < 3.4;
  const lowStoryRatio = Number(summary.avgStoryForwardRatio ?? 0) < 0.7;
  const lowPackaging = Number(summary.avgPackagingCompleteness ?? 0) < 1;
  const lowRenderCoverage = Number(summary.avgMainRenderPlanCoverage ?? 0) < 0.95;
  const lowCluePayoff = Number(summary.avgCluePayoffCoverage ?? 0) < 1;
  const highPlaceholderRate = Number(summary.placeholderRunRate ?? 0) > 0.15;
  const highFallbackRate = Number(summary.fallbackRunRate ?? 0) > 0.5;

  if (lowStory || lowStoryRatio) {
    recs.push("- Tighten `agent_plot_director_deckspec.md`: enforce stronger per-slide goal/opposition/turn/decision progression and explicit evidence-action verbs.");
  }
  if (lowTwist || lowCluePayoff) {
    recs.push("- Tighten `agent_clue_architect.md` + `agent_case_engineer_truth_model.md`: require explicit Act I receipts and payoff slide IDs for every red herring/twist.");
  }
  if (lowClarity) {
    recs.push("- Tighten `agent_qa_reader_sim.md`: raise penalties for repetitive phrasing and for unclear clue-to-decision handoffs.");
  }
  if (highPlaceholderRate) {
    recs.push("- Tighten `agent_plot_director_deckspec.md` + `agent_qa_med_factcheck.md`: hard-reject TODO/TBD/placeholder wording and non-dossier citation IDs.");
  }
  if (highFallbackRate) {
    recs.push("- Reduce `agent_plot_director_deckspec.md` prompt payload size (compact digests first) to lower transport-abort fallback frequency in step C.");
  }
  if (lowPackaging || lowRenderCoverage) {
    recs.push("- Tighten packaging outputs (`phase4_generator` + render plan markers) so every slide is represented in the main render plan with stable block structure.");
  }
  if (recs.length === 0) {
    recs.push("- No prompt-level tuning changes required from this batch; keep prompts as-is and continue monitoring trend drift.");
  }
  return recs;
}

function buildMd(report, options) {
  const summary = report?.summary ?? {};
  const lines = [];
  lines.push("# V2 Prompt Tuning Report");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Base URL: ${options.baseUrl}`);
  lines.push(`Topics: ${options.topics.join(", ")}`);
  lines.push("");
  lines.push("## Batch Summary");
  lines.push("");
  lines.push(`- runCount: ${String(summary.runCount ?? "n/a")}`);
  lines.push(`- doneCount: ${String(summary.doneCount ?? "n/a")}`);
  lines.push(`- qaAcceptRate: ${fmt(summary.qaAcceptRate)}`);
  lines.push(`- medPassRate: ${fmt(summary.medPassRate)}`);
  lines.push(`- avgStoryScore: ${fmt(summary.avgStoryScore)}`);
  lines.push(`- avgTwistScore: ${fmt(summary.avgTwistScore)}`);
  lines.push(`- avgClarityScore: ${fmt(summary.avgClarityScore)}`);
  lines.push(`- avgStoryForwardRatio: ${fmt(summary.avgStoryForwardRatio)}`);
  lines.push(`- avgPackagingCompleteness: ${fmt(summary.avgPackagingCompleteness)}`);
  lines.push(`- avgMainRenderPlanCoverage: ${fmt(summary.avgMainRenderPlanCoverage)}`);
  lines.push(`- avgCluePayoffCoverage: ${fmt(summary.avgCluePayoffCoverage)}`);
  lines.push(`- renderPlanMarkerPassRate: ${fmt(summary.renderPlanMarkerPassRate)}`);
  lines.push(`- placeholderRunRate: ${fmt(summary.placeholderRunRate)}`);
  lines.push(`- fallbackRunRate: ${fmt(summary.fallbackRunRate)}`);
  lines.push(`- avgFallbackEventCount: ${fmt(summary.avgFallbackEventCount)}`);
  lines.push("");
  lines.push("## Prompt Recommendations");
  lines.push("");
  for (const line of recommendationBlock(report)) lines.push(line);
  lines.push("");
  lines.push("## Prompt Lock");
  lines.push("");
  lines.push("- Prompt/schema lock regenerated after this batch via `npm run v2:assets:lock`.");
  lines.push("- Verify lock before commit with `npm run v2:assets:lock:check`.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const harnessArgs = [
    "scripts/v2_pilot_quality_harness.mjs",
    "--base-url",
    options.baseUrl,
    "--output-dir",
    options.outputDir,
    "--deck-length",
    String(options.deckLength),
    "--timeout-minutes",
    String(options.timeoutMinutes),
    "--min-qa-accept-rate",
    "0.66",
    "--min-med-pass-rate",
    "0.66",
    "--min-story-score",
    "3.2",
    "--min-twist-score",
    "3.0",
    "--min-clarity-score",
    "3.4",
    "--min-story-forward-ratio",
    "0.7",
    "--min-packaging-completeness",
    "1",
    "--min-main-render-coverage",
    "0.95",
    "--min-clue-payoff-coverage",
    "1",
    "--min-render-plan-marker-pass-rate",
    "1",
    "--max-placeholder-run-rate",
    "0.15",
    "--max-fallback-run-rate",
    "0.05",
    "--max-error-rate",
    "0.2",
    "--max-timeout-rate",
    "0.1"
  ];
  if (options.enforceSlo) harnessArgs.push("--enforce-slo");
  for (const topic of options.topics) {
    harnessArgs.push("--topic", topic);
  }

  runCommand("v2-pilot-quality", "node", harnessArgs);
  runCommand("v2-pilot-trend", "node", ["scripts/build_v2_pilot_trend_report.mjs"]);
  runCommand("v2-asset-lock", "node", ["scripts/build_v2_asset_lock.mjs"]);

  const latestReportPath = path.join(options.outputDir, "v2-pilot-quality-latest.json");
  const latestRaw = await fs.readFile(latestReportPath, "utf8");
  const latest = JSON.parse(latestRaw);
  const md = buildMd(latest, options);

  await fs.mkdir(options.outputDir, { recursive: true });
  const outJsonPath = path.join(options.outputDir, "v2-prompt-tuning-latest.json");
  const outMdPath = path.join(options.outputDir, "v2-prompt-tuning-latest.md");
  await fs.writeFile(
    outJsonPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        options,
        summary: latest?.summary ?? {},
        recommendations: recommendationBlock(latest)
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await fs.writeFile(outMdPath, md, "utf8");

  // eslint-disable-next-line no-console
  console.log(`Wrote ${outJsonPath}`);
  // eslint-disable-next-line no-console
  console.log(`Wrote ${outMdPath}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  // eslint-disable-next-line no-console
  console.error(`v2_prompt_tuning_cycle failed: ${message}`);
  process.exitCode = 1;
});
