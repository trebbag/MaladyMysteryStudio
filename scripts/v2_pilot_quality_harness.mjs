#!/usr/bin/env node
import http from "node:http";
import https from "node:https";
import fs from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const options = {
    baseUrl: "http://localhost:5050",
    deckLengthMain: 30,
    audienceLevel: "RESIDENT",
    adherenceMode: "warn",
    phase: "pilot",
    timeoutMinutes: 45,
    outputDir: ".ci/pilot",
    topics: [],
    enforceSlo: false,
    sloTargets: {
      minQaAcceptRate: 0.66,
      minMedPassRate: 0.66,
      minAvgStoryScore: 3.2,
      minAvgTwistScore: 3.0,
      minAvgClarityScore: 3.4,
      minAvgStoryForwardRatio: 0.7,
      minAvgPackagingCompleteness: 1,
      minAvgMainRenderPlanCoverage: 0.95,
      minAvgCluePayoffCoverage: 1,
      minRenderPlanMarkerPassRate: 1,
      maxPlaceholderRunRate: 0.15,
      maxFallbackRunRate: 0.05,
      maxErrorRate: 0.2,
      maxTimeoutRate: 0.1
    },
    _fallbackThresholdExplicit: false
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
    if (arg === "--deck-length") {
      options.deckLengthMain = Number(argv[i + 1] || options.deckLengthMain);
      i += 1;
      continue;
    }
    if (arg === "--audience") {
      options.audienceLevel = argv[i + 1] || options.audienceLevel;
      i += 1;
      continue;
    }
    if (arg === "--adherence") {
      options.adherenceMode = argv[i + 1] || options.adherenceMode;
      i += 1;
      continue;
    }
    if (arg === "--phase") {
      options.phase = argv[i + 1] || options.phase;
      i += 1;
      continue;
    }
    if (arg === "--timeout-minutes") {
      options.timeoutMinutes = Number(argv[i + 1] || options.timeoutMinutes);
      i += 1;
      continue;
    }
    if (arg === "--output-dir") {
      options.outputDir = argv[i + 1] || options.outputDir;
      i += 1;
      continue;
    }
    if (arg === "--enforce-slo") {
      options.enforceSlo = true;
      continue;
    }
    if (arg === "--min-qa-accept-rate") {
      options.sloTargets.minQaAcceptRate = Number(argv[i + 1] || options.sloTargets.minQaAcceptRate);
      i += 1;
      continue;
    }
    if (arg === "--min-med-pass-rate") {
      options.sloTargets.minMedPassRate = Number(argv[i + 1] || options.sloTargets.minMedPassRate);
      i += 1;
      continue;
    }
    if (arg === "--min-story-score") {
      options.sloTargets.minAvgStoryScore = Number(argv[i + 1] || options.sloTargets.minAvgStoryScore);
      i += 1;
      continue;
    }
    if (arg === "--min-twist-score") {
      options.sloTargets.minAvgTwistScore = Number(argv[i + 1] || options.sloTargets.minAvgTwistScore);
      i += 1;
      continue;
    }
    if (arg === "--min-clarity-score") {
      options.sloTargets.minAvgClarityScore = Number(argv[i + 1] || options.sloTargets.minAvgClarityScore);
      i += 1;
      continue;
    }
    if (arg === "--min-story-forward-ratio") {
      options.sloTargets.minAvgStoryForwardRatio = Number(argv[i + 1] || options.sloTargets.minAvgStoryForwardRatio);
      i += 1;
      continue;
    }
    if (arg === "--min-packaging-completeness") {
      options.sloTargets.minAvgPackagingCompleteness = Number(argv[i + 1] || options.sloTargets.minAvgPackagingCompleteness);
      i += 1;
      continue;
    }
    if (arg === "--min-main-render-coverage") {
      options.sloTargets.minAvgMainRenderPlanCoverage = Number(argv[i + 1] || options.sloTargets.minAvgMainRenderPlanCoverage);
      i += 1;
      continue;
    }
    if (arg === "--min-clue-payoff-coverage") {
      options.sloTargets.minAvgCluePayoffCoverage = Number(argv[i + 1] || options.sloTargets.minAvgCluePayoffCoverage);
      i += 1;
      continue;
    }
    if (arg === "--min-render-plan-marker-pass-rate") {
      options.sloTargets.minRenderPlanMarkerPassRate = Number(argv[i + 1] || options.sloTargets.minRenderPlanMarkerPassRate);
      i += 1;
      continue;
    }
    if (arg === "--max-placeholder-run-rate") {
      options.sloTargets.maxPlaceholderRunRate = Number(argv[i + 1] || options.sloTargets.maxPlaceholderRunRate);
      i += 1;
      continue;
    }
    if (arg === "--max-fallback-run-rate") {
      options.sloTargets.maxFallbackRunRate = Number(argv[i + 1] || options.sloTargets.maxFallbackRunRate);
      options._fallbackThresholdExplicit = true;
      i += 1;
      continue;
    }
    if (arg === "--max-error-rate") {
      options.sloTargets.maxErrorRate = Number(argv[i + 1] || options.sloTargets.maxErrorRate);
      i += 1;
      continue;
    }
    if (arg === "--max-timeout-rate") {
      options.sloTargets.maxTimeoutRate = Number(argv[i + 1] || options.sloTargets.maxTimeoutRate);
      i += 1;
      continue;
    }
  }
  if (options.topics.length === 0) {
    options.topics = [
      "Community-acquired pneumonia in adults",
      "Diabetic ketoacidosis in adults",
      "Nephrotic syndrome in adults"
    ];
  }
  if (![30, 45, 60].includes(options.deckLengthMain)) {
    throw new Error(`Invalid --deck-length value ${String(options.deckLengthMain)} (allowed: 30, 45, 60).`);
  }
  if (!["pilot", "promotion"].includes(String(options.phase))) {
    throw new Error(`Invalid --phase value ${String(options.phase)} (allowed: pilot, promotion).`);
  }
  if (options.phase === "promotion" && !options._fallbackThresholdExplicit) {
    options.sloTargets.maxFallbackRunRate = 0;
  }
  return options;
}

function toHeaderRecord(input) {
  if (!input) return {};
  if (Array.isArray(input)) return Object.fromEntries(input);
  return { ...input };
}

async function fetchJson(url, init = {}) {
  const target = new URL(url);
  const method = String(init.method || "GET").toUpperCase();
  const headers = toHeaderRecord(init.headers);
  const body = typeof init.body === "string" ? init.body : undefined;
  if (body && headers["content-length"] === undefined && headers["Content-Length"] === undefined) {
    headers["content-length"] = String(Buffer.byteLength(body));
  }

  const client = target.protocol === "https:" ? https : http;
  const text = await new Promise((resolve, reject) => {
    const req = client.request(target, { method, headers }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        const status = Number(res.statusCode || 0);
        if (status >= 200 && status < 300) {
          resolve(data);
          return;
        }
        reject(new Error(`${url} failed (${status}): ${data}`));
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });

  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { raw: text };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function storyForwardRatio(deckSpec) {
  const slides = Array.isArray(deckSpec?.slides) ? deckSpec.slides : [];
  if (slides.length === 0) return 0;
  const storyForward = slides.filter((slide) => ["clue", "dialogue", "action"].includes(slide?.medical_payload?.delivery_mode)).length;
  return storyForward / slides.length;
}

function requiredPackagingNames() {
  return [
    "micro_world_map.json",
    "drama_plan.json",
    "setpiece_plan.json",
    "V2_MAIN_DECK_RENDER_PLAN.md",
    "V2_APPENDIX_RENDER_PLAN.md",
    "V2_SPEAKER_NOTES_WITH_CITATIONS.md",
    "v2_template_registry.json"
  ];
}

function packagingCompletenessRatio(artifactNames) {
  const required = requiredPackagingNames();
  const present = required.filter((name) => artifactNames.has(name)).length;
  return required.length === 0 ? 1 : present / required.length;
}

function renderPlanMarkerPass(mainRenderPlanText) {
  if (!mainRenderPlanText || typeof mainRenderPlanText !== "string") return false;
  const requiredMarkers = ["## Recurring Constraints", "## Zone + Setpiece Mapping", "## Slide Blocks"];
  return requiredMarkers.every((marker) => mainRenderPlanText.includes(marker));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mainRenderPlanCoverage(deckSpec, mainRenderPlanText) {
  if (!deckSpec || typeof mainRenderPlanText !== "string") return null;
  const slides = Array.isArray(deckSpec?.slides) ? deckSpec.slides : [];
  if (slides.length === 0) return null;
  let matched = 0;
  for (const slide of slides) {
    const slideId = String(slide?.slide_id || "");
    if (!slideId) continue;
    const byHeading = new RegExp(`^###\\s+${escapeRegExp(slideId)}\\b`, "m");
    if (byHeading.test(mainRenderPlanText)) matched += 1;
  }
  return matched / slides.length;
}

function placeholderSignals(deckSpec) {
  const text = JSON.stringify(deckSpec || {});
  const flags = [];
  if (/"citation_id":"CIT-00\d"/.test(text)) flags.push("legacy_citation_ids");
  if (/"major_concept_id":"NONE"/.test(text)) flags.push("none_major_concepts");
  if (/"dx_id":"DX-\d/.test(text)) flags.push("legacy_dx_ids");
  if (/— S\d{2,3}"/.test(text)) flags.push("generic_slide_titles");
  if (/"headline":"[^"]*TBD/i.test(text)) flags.push("headline_tbd");
  if (/"headline":"[^"]*TODO/i.test(text)) flags.push("headline_todo");
  if (/lorem ipsum/i.test(text)) flags.push("lorem_ipsum");
  if (/"medical_reasoning":"[^"]*placeholder/i.test(text)) flags.push("placeholder_reasoning");
  return flags;
}

function cluePayoffCoverage(clueGraph) {
  const redHerrings = Array.isArray(clueGraph?.red_herrings) ? clueGraph.red_herrings : [];
  if (redHerrings.length === 0) return 1;
  const withPayoff = redHerrings.filter((item) => typeof item?.payoff_slide_id === "string" && item.payoff_slide_id.trim().length > 0).length;
  return withPayoff / redHerrings.length;
}

function errorAgents(agentDurations) {
  const calls = Array.isArray(agentDurations?.calls) ? agentDurations.calls : [];
  return [...new Set(calls.filter((call) => call.status === "error").map((call) => call.agentKey))];
}

function maxAgentMs(agentDurations) {
  const calls = Array.isArray(agentDurations?.calls) ? agentDurations.calls : [];
  if (calls.length === 0) return 0;
  return Math.max(...calls.map((call) => Number(call.elapsedMs || 0)));
}

async function runOne(options, topic) {
  const settings = {
    workflow: "v2_micro_detectives",
    deckLengthMain: options.deckLengthMain,
    audienceLevel: options.audienceLevel,
    adherenceMode: options.adherenceMode
  };
  const started = await fetchJson(`${options.baseUrl}/api/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ topic, settings })
  });
  const runId = String(started?.runId || "");
  if (!runId) throw new Error("Run start did not return runId.");

  const timeoutAt = Date.now() + options.timeoutMinutes * 60_000;
  while (Date.now() < timeoutAt) {
    const run = await fetchJson(`${options.baseUrl}/api/runs/${encodeURIComponent(runId)}`);
    if (run.status === "paused" && run.activeGate?.gateId) {
      const gateId = run.activeGate.gateId;
      await fetchJson(`${options.baseUrl}/api/runs/${encodeURIComponent(runId)}/gates/${encodeURIComponent(gateId)}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: "approve",
          notes: "Auto-approved by v2 pilot harness",
          requested_changes: []
        })
      });
      await fetchJson(`${options.baseUrl}/api/runs/${encodeURIComponent(runId)}/resume`, { method: "POST" });
      await sleep(1000);
      continue;
    }
    if (run.status === "done" || run.status === "error") {
      const artifacts = await fetchJson(
        `${options.baseUrl}/api/runs/${encodeURIComponent(runId)}/artifacts`
      ).catch(() => []);
      const artifactNames = new Set(
        (Array.isArray(artifacts) ? artifacts : [])
          .map((row) => String(row?.name || "").trim())
          .filter((name) => name.length > 0)
      );
      const deckSpec = await fetchJson(
        `${options.baseUrl}/api/runs/${encodeURIComponent(runId)}/artifacts/deck_spec.json`
      ).catch(() => null);
      const qaReport = await fetchJson(
        `${options.baseUrl}/api/runs/${encodeURIComponent(runId)}/artifacts/qa_report.json`
      ).catch(() => null);
      const medFactcheck = await fetchJson(
        `${options.baseUrl}/api/runs/${encodeURIComponent(runId)}/artifacts/med_factcheck_report.json`
      ).catch(() => null);
      const readerSim = await fetchJson(
        `${options.baseUrl}/api/runs/${encodeURIComponent(runId)}/artifacts/reader_sim_report.json`
      ).catch(() => null);
      const clueGraph = await fetchJson(
        `${options.baseUrl}/api/runs/${encodeURIComponent(runId)}/artifacts/clue_graph.json`
      ).catch(() => null);
      const durations = await fetchJson(
        `${options.baseUrl}/api/runs/${encodeURIComponent(runId)}/artifacts/agent_call_durations.json`
      ).catch(() => null);
      const fallbackUsage = await fetchJson(
        `${options.baseUrl}/api/runs/${encodeURIComponent(runId)}/artifacts/fallback_usage.json`
      ).catch(() => null);
      const mainRenderPlanRaw = await fetchJson(
        `${options.baseUrl}/api/runs/${encodeURIComponent(runId)}/artifacts/V2_MAIN_DECK_RENDER_PLAN.md`
      ).catch(() => null);
      const mainRenderPlanText = typeof mainRenderPlanRaw?.raw === "string" ? mainRenderPlanRaw.raw : "";

      const placeholder = placeholderSignals(deckSpec);
      const packagingCompleteness = Number(packagingCompletenessRatio(artifactNames).toFixed(3));
      const renderCoverage = mainRenderPlanCoverage(deckSpec, mainRenderPlanText);
      const clueCoverage = cluePayoffCoverage(clueGraph);

      return {
        runId,
        topic,
        status: run.status,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        qaAccept: qaReport?.accept ?? null,
        medPass: medFactcheck?.pass ?? null,
        storyScore: readerSim?.overall_story_dominance_score_0_to_5 ?? null,
        twistScore: readerSim?.overall_twist_quality_score_0_to_5 ?? null,
        clarityScore: readerSim?.overall_clarity_score_0_to_5 ?? null,
        requiredFixes: Array.isArray(qaReport?.required_fixes) ? qaReport.required_fixes.length : null,
        storyForwardRatio: Number(storyForwardRatio(deckSpec).toFixed(3)),
        packagingCompleteness,
        mainRenderPlanCoverage: renderCoverage === null ? null : Number(renderCoverage.toFixed(3)),
        cluePayoffCoverage: Number(clueCoverage.toFixed(3)),
        renderPlanMarkerPass: renderPlanMarkerPass(mainRenderPlanText),
        placeholderSignals: placeholder,
        fallbackUsed: Boolean(fallbackUsage?.used),
        fallbackEventCount: Number(fallbackUsage?.fallback_event_count || 0),
        deterministicFallbackUsed: Boolean(fallbackUsage?.deterministic_fallback_used ?? fallbackUsage?.used),
        deterministicFallbackEventCount: Number(
          (fallbackUsage?.deterministic_fallback_event_count ?? fallbackUsage?.fallback_event_count) || 0
        ),
        agentRetryEventCount: Number(fallbackUsage?.agent_retry_event_count || 0),
        errorAgents: errorAgents(durations),
        maxAgentMs: maxAgentMs(durations)
      };
    }
    await sleep(5000);
  }

  return {
    runId,
    topic,
    status: "timeout",
    qaAccept: null,
    medPass: null,
    storyScore: null,
    twistScore: null,
    clarityScore: null,
    requiredFixes: null,
    storyForwardRatio: 0,
    packagingCompleteness: 0,
    mainRenderPlanCoverage: null,
    cluePayoffCoverage: null,
    renderPlanMarkerPass: false,
    placeholderSignals: ["timeout"],
    fallbackUsed: false,
    fallbackEventCount: 0,
    deterministicFallbackUsed: false,
    deterministicFallbackEventCount: 0,
    agentRetryEventCount: 0,
    errorAgents: [],
    maxAgentMs: 0
  };
}

function summarize(results) {
  const completed = results.filter((item) => item.status === "done");
  const avg = (values) => {
    const nums = values.filter((v) => Number.isFinite(v));
    if (nums.length === 0) return null;
    return Number((nums.reduce((acc, value) => acc + value, 0) / nums.length).toFixed(3));
  };
  return {
    runCount: results.length,
    doneCount: completed.length,
    errorCount: results.filter((item) => item.status === "error").length,
    timeoutCount: results.filter((item) => item.status === "timeout").length,
    qaAcceptRate: avg(completed.map((item) => (item.qaAccept ? 1 : 0))),
    medPassRate: avg(completed.map((item) => (item.medPass ? 1 : 0))),
    avgStoryScore: avg(completed.map((item) => item.storyScore)),
    avgTwistScore: avg(completed.map((item) => item.twistScore)),
    avgClarityScore: avg(completed.map((item) => item.clarityScore)),
    avgStoryForwardRatio: avg(completed.map((item) => item.storyForwardRatio)),
    avgPackagingCompleteness: avg(completed.map((item) => item.packagingCompleteness)),
    avgMainRenderPlanCoverage: avg(completed.map((item) => item.mainRenderPlanCoverage)),
    avgCluePayoffCoverage: avg(completed.map((item) => item.cluePayoffCoverage)),
    renderPlanMarkerPassRate: avg(completed.map((item) => (item.renderPlanMarkerPass ? 1 : 0))),
    placeholderRunRate: avg(completed.map((item) => (item.placeholderSignals.length > 0 ? 1 : 0))),
    fallbackRunRate: avg(completed.map((item) => (item.deterministicFallbackUsed ? 1 : 0))),
    avgFallbackEventCount: avg(completed.map((item) => item.deterministicFallbackEventCount)),
    avgAgentRetryEventCount: avg(completed.map((item) => item.agentRetryEventCount))
  };
}

function evaluateSlo(summary, targets) {
  const violations = [];
  const checkMin = (name, value, minimum) => {
    if (!Number.isFinite(minimum)) return;
    if (!Number.isFinite(value)) {
      violations.push(`${name} unavailable`);
      return;
    }
    if (value < minimum) {
      violations.push(`${name} ${value.toFixed(3)} < ${minimum.toFixed(3)}`);
    }
  };
  const checkMax = (name, value, maximum) => {
    if (!Number.isFinite(maximum)) return;
    if (!Number.isFinite(value)) {
      violations.push(`${name} unavailable`);
      return;
    }
    if (value > maximum) {
      violations.push(`${name} ${value.toFixed(3)} > ${maximum.toFixed(3)}`);
    }
  };

  const runCount = Math.max(1, Number(summary.runCount || 0));
  const errorRate = Number(summary.errorCount || 0) / runCount;
  const timeoutRate = Number(summary.timeoutCount || 0) / runCount;

  checkMin("qaAcceptRate", summary.qaAcceptRate, targets.minQaAcceptRate);
  checkMin("medPassRate", summary.medPassRate, targets.minMedPassRate);
  checkMin("avgStoryScore", summary.avgStoryScore, targets.minAvgStoryScore);
  checkMin("avgTwistScore", summary.avgTwistScore, targets.minAvgTwistScore);
  checkMin("avgClarityScore", summary.avgClarityScore, targets.minAvgClarityScore);
  checkMin("avgStoryForwardRatio", summary.avgStoryForwardRatio, targets.minAvgStoryForwardRatio);
  checkMin("avgPackagingCompleteness", summary.avgPackagingCompleteness, targets.minAvgPackagingCompleteness);
  checkMin("avgMainRenderPlanCoverage", summary.avgMainRenderPlanCoverage, targets.minAvgMainRenderPlanCoverage);
  checkMin("avgCluePayoffCoverage", summary.avgCluePayoffCoverage, targets.minAvgCluePayoffCoverage);
  checkMin("renderPlanMarkerPassRate", summary.renderPlanMarkerPassRate, targets.minRenderPlanMarkerPassRate);
  checkMax("placeholderRunRate", summary.placeholderRunRate, targets.maxPlaceholderRunRate);
  checkMax("fallbackRunRate", summary.fallbackRunRate, targets.maxFallbackRunRate);
  checkMax("errorRate", errorRate, targets.maxErrorRate);
  checkMax("timeoutRate", timeoutRate, targets.maxTimeoutRate);

  return {
    pass: violations.length === 0,
    errorRate: Number(errorRate.toFixed(3)),
    timeoutRate: Number(timeoutRate.toFixed(3)),
    violations
  };
}

function toMarkdown(report) {
  const lines = [
    "# V2 Pilot Quality Harness Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Phase: ${String(report.options?.phase || "pilot")}`,
    "",
    "## Summary",
    "",
    `- Run count: ${report.summary.runCount}`,
    `- Done: ${report.summary.doneCount}`,
    `- Error: ${report.summary.errorCount}`,
    `- Timeout: ${report.summary.timeoutCount}`,
    `- QA accept rate: ${String(report.summary.qaAcceptRate)}`,
    `- Med pass rate: ${String(report.summary.medPassRate)}`,
    `- Avg story score: ${String(report.summary.avgStoryScore)}`,
    `- Avg twist score: ${String(report.summary.avgTwistScore)}`,
    `- Avg clarity score: ${String(report.summary.avgClarityScore)}`,
    `- Avg story-forward ratio: ${String(report.summary.avgStoryForwardRatio)}`,
    `- Avg packaging completeness: ${String(report.summary.avgPackagingCompleteness)}`,
    `- Avg main render-plan coverage: ${String(report.summary.avgMainRenderPlanCoverage)}`,
    `- Avg clue payoff coverage: ${String(report.summary.avgCluePayoffCoverage)}`,
    `- Render-plan marker pass rate: ${String(report.summary.renderPlanMarkerPassRate)}`,
    `- Placeholder run rate: ${String(report.summary.placeholderRunRate)}`,
    `- Fallback run rate: ${String(report.summary.fallbackRunRate)}`,
    `- Avg fallback event count: ${String(report.summary.avgFallbackEventCount)}`,
    `- Avg agent-retry event count: ${String(report.summary.avgAgentRetryEventCount)}`,
    `- Error rate: ${String(report.slo.evaluation.errorRate)}`,
    `- Timeout rate: ${String(report.slo.evaluation.timeoutRate)}`,
    `- SLO pass: ${report.slo.evaluation.pass ? "true" : "false"}`,
    "",
    "## SLO Targets",
    "",
    `- minQaAcceptRate: ${String(report.slo.targets.minQaAcceptRate)}`,
    `- minMedPassRate: ${String(report.slo.targets.minMedPassRate)}`,
    `- minAvgStoryScore: ${String(report.slo.targets.minAvgStoryScore)}`,
    `- minAvgTwistScore: ${String(report.slo.targets.minAvgTwistScore)}`,
    `- minAvgClarityScore: ${String(report.slo.targets.minAvgClarityScore)}`,
    `- minAvgStoryForwardRatio: ${String(report.slo.targets.minAvgStoryForwardRatio)}`,
    `- minAvgPackagingCompleteness: ${String(report.slo.targets.minAvgPackagingCompleteness)}`,
    `- minAvgMainRenderPlanCoverage: ${String(report.slo.targets.minAvgMainRenderPlanCoverage)}`,
    `- minAvgCluePayoffCoverage: ${String(report.slo.targets.minAvgCluePayoffCoverage)}`,
    `- minRenderPlanMarkerPassRate: ${String(report.slo.targets.minRenderPlanMarkerPassRate)}`,
    `- maxPlaceholderRunRate: ${String(report.slo.targets.maxPlaceholderRunRate)}`,
    `- maxFallbackRunRate: ${String(report.slo.targets.maxFallbackRunRate)}`,
    `- maxErrorRate: ${String(report.slo.targets.maxErrorRate)}`,
    `- maxTimeoutRate: ${String(report.slo.targets.maxTimeoutRate)}`,
    "",
    "## SLO Violations",
    ""
  ];

  if (report.slo.evaluation.violations.length === 0) {
    lines.push("- none");
  } else {
    for (const violation of report.slo.evaluation.violations) lines.push(`- ${violation}`);
  }

  lines.push(
    "",
    "## Runs",
    "",
    "| Topic | Run ID | Status | QA Accept | Med Pass | Story/Twist/Clarity | Story Ratio | Packaging | Render Cov | Clue Payoff | Placeholders | Fallback | Error Agents |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"
  );

  for (const run of report.results) {
    const scores = [run.storyScore, run.twistScore, run.clarityScore].map((v) => (v === null ? "n/a" : String(v))).join("/");
    const errors = run.errorAgents.length > 0 ? run.errorAgents.join(", ") : "-";
    const placeholders = run.placeholderSignals.length > 0 ? run.placeholderSignals.join(", ") : "-";
    const fallback = run.deterministicFallbackUsed
      ? `deterministic (${run.deterministicFallbackEventCount})`
      : run.fallbackUsed
        ? `retry-only (${run.agentRetryEventCount})`
        : "no";
    lines.push(
      `| ${run.topic} | ${run.runId} | ${run.status} | ${String(run.qaAccept)} | ${String(run.medPass)} | ${scores} | ${String(run.storyForwardRatio)} | ${String(run.packagingCompleteness)} | ${String(run.mainRenderPlanCoverage)} | ${String(run.cluePayoffCoverage)} | ${placeholders} | ${fallback} | ${errors} |`
    );
  }

  return `${lines.join("\n")}\n`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const health = await fetchJson(`${options.baseUrl}/api/health`);
  if (!health?.ok) throw new Error("Health endpoint did not return ok=true.");
  if (!health?.hasKey) throw new Error("OPENAI_API_KEY is missing for backend.");
  if (!health?.hasVectorStoreId) throw new Error("KB_VECTOR_STORE_ID is missing for backend.");

  const results = [];
  for (const topic of options.topics) {
    // eslint-disable-next-line no-console
    console.log(`Running pilot topic: ${topic}`);
    const result = await runOne(options, topic);
    results.push(result);
    // eslint-disable-next-line no-console
    console.log(`Completed run ${result.runId}: status=${result.status}, qaAccept=${String(result.qaAccept)}, medPass=${String(result.medPass)}`);
  }

  const summary = summarize(results);
  const report = {
    generatedAt: new Date().toISOString(),
    options,
    summary,
    slo: {
      targets: options.sloTargets,
      evaluation: evaluateSlo(summary, options.sloTargets)
    },
    results
  };

  await fs.mkdir(options.outputDir, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, "-");
  const jsonPath = path.join(options.outputDir, `v2-pilot-quality-${stamp}.json`);
  const mdPath = path.join(options.outputDir, `v2-pilot-quality-${stamp}.md`);
  const latestJsonPath = path.join(options.outputDir, "v2-pilot-quality-latest.json");
  const latestMdPath = path.join(options.outputDir, "v2-pilot-quality-latest.md");

  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(mdPath, toMarkdown(report), "utf8");
  await fs.writeFile(latestJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(latestMdPath, toMarkdown(report), "utf8");

  // eslint-disable-next-line no-console
  console.log(`Report written: ${jsonPath}`);
  // eslint-disable-next-line no-console
  console.log(`Report written: ${mdPath}`);

  if (options.enforceSlo && !report.slo.evaluation.pass) {
    throw new Error(`Pilot SLO failed: ${report.slo.evaluation.violations.join("; ")}`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  // eslint-disable-next-line no-console
  console.error(`V2 pilot quality harness failed: ${message}`);
  process.exitCode = 1;
});
