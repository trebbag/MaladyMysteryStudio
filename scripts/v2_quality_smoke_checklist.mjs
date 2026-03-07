#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const argv = process.argv.slice(2);

function readArg(name, fallback = "") {
  const idx = argv.findIndex((token) => token === `--${name}`);
  if (idx < 0) return fallback;
  const value = argv[idx + 1];
  return typeof value === "string" ? value : fallback;
}

function readFlag(name) {
  return argv.includes(`--${name}`);
}

const BASE_URL = (readArg("base-url", process.env.MMS_SMOKE_BASE_URL || "http://localhost:5050") || "http://localhost:5050").replace(/\/$/, "");
const TOPIC = readArg("topic", "Community-acquired pneumonia in adults").trim();
const AUDIENCE_LEVEL = readArg("audience", "PHYSICIAN_LEVEL").trim() || "PHYSICIAN_LEVEL";
const OUTPUT_DIR = readArg("output-dir", ".ci/smoke").trim() || ".ci/smoke";
const POLL_MS = Number(readArg("poll-ms", process.env.MMS_SMOKE_POLL_MS || "5000"));
const TIMEOUT_MS = Number(readArg("timeout-ms", process.env.MMS_SMOKE_TIMEOUT_MS || String(45 * 60 * 1000)));
const VERBOSE = readFlag("verbose");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function norm(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeRecommendedRunTimeoutMs(run, baselineMs) {
  const watchdogMs = Number(run?.v2DeckSpecEstimate?.adaptiveTimeoutMs?.watchdog || 0);
  if (!Number.isFinite(watchdogMs) || watchdogMs <= 0) return baselineMs;
  const preStepBufferMs = 15 * 60 * 1000;
  const postStepBufferMs = 10 * 60 * 1000;
  return Math.max(baselineMs, preStepBufferMs + watchdogMs + postStepBufferMs);
}

async function httpJson(url, init = undefined) {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText} @ ${url}${body ? ` :: ${body.slice(0, 400)}` : ""}`);
  }
  return await res.json();
}

async function cancelRunBestEffort(runId, reason = "") {
  if (!runId) return false;
  try {
    await httpJson(`${BASE_URL}/api/runs/${encodeURIComponent(runId)}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason })
    });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/run not cancellable|404|409/i.test(message)) return false;
    console.warn(`[smoke:v2:quality] best-effort cancel failed for ${runId}: ${message}`);
    return false;
  }
}

async function fetchArtifactText(runId, name) {
  const encodedRunId = encodeURIComponent(runId);
  const encodedName = encodeURIComponent(name);
  const url = `${BASE_URL}/api/runs/${encodedRunId}/artifacts/${encodedName}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Failed to fetch artifact ${name}: HTTP ${res.status} ${res.statusText}${body ? ` :: ${body.slice(0, 400)}` : ""}`);
  }
  return await res.text();
}

function markerChecks(deckSpec) {
  const slides = Array.isArray(deckSpec?.slides) ? deckSpec.slides : [];
  if (slides.length === 0) {
    return {
      openingHook: false,
      falseTheoryLockIn: false,
      midpointCollapse: false,
      ruptureRepair: false,
      endingCallback: false,
      details: { reason: "No slides in deck_spec" }
    };
  }

  const firstWindow = slides.slice(0, Math.max(3, Math.ceil(slides.length * 0.15)));
  const midpointStart = Math.floor(slides.length * 0.35);
  const midpointEnd = Math.ceil(slides.length * 0.7);
  const midpointWindow = slides.slice(midpointStart, midpointEnd);
  const finalWindow = slides.slice(Math.max(0, slides.length - Math.max(4, Math.ceil(slides.length * 0.15))));

  const firstText = norm(firstWindow.map((slide) => `${slide.title || ""}\n${slide.hook || ""}\n${slide.story_panel?.goal || ""}`).join("\n"));
  const midpointText = norm(midpointWindow.map((slide) => `${slide.title || ""}\n${slide.hook || ""}\n${slide.story_panel?.turn || ""}`).join("\n"));
  const allText = norm(slides.map((slide) => `${slide.title || ""}\n${slide.hook || ""}\n${slide.story_panel?.opposition || ""}\n${slide.story_panel?.turn || ""}\n${slide.story_panel?.decision || ""}\n${slide.speaker_notes?.narrative_notes || ""}`).join("\n"));
  const finalText = norm(finalWindow.map((slide) => `${slide.title || ""}\n${slide.hook || ""}\n${slide.speaker_notes?.narrative_notes || ""}`).join("\n"));

  const openingHook = /\b(case|urgent|mystery|dispatch|alarm|call|intake|incident|investigation)\b/.test(firstText);
  const falseTheoryLockIn = slides.some((slide) => slide?.beat_type === "false_theory_lock_in");
  const midpointCollapse =
    midpointWindow.some((slide) => ["false_theory_collapse", "reversal", "twist"].includes(String(slide?.beat_type || ""))) ||
    /\b(collapse|fracture|recontextual|breakthrough)\b/.test(midpointText);
  const ruptureRepair =
    /\b(conflict|clash|disagree|rupture|friction|argue)\b/.test(allText) &&
    /\b(repair|reconcile|trust|together|co own|alignment)\b/.test(allText);
  const endingCallback =
    /\b(callback|full circle|back at (the )?office|case closed|return(ed)? to office)\b/.test(finalText);

  return {
    openingHook,
    falseTheoryLockIn,
    midpointCollapse,
    ruptureRepair,
    endingCallback,
    details: {
      slideCount: slides.length,
      firstWindow: firstWindow.length,
      midpointWindow: midpointWindow.length,
      finalWindow: finalWindow.length
    }
  };
}

function twistReceiptChecks(clueGraph) {
  const matrix = Array.isArray(clueGraph?.twist_support_matrix) ? clueGraph.twist_support_matrix : [];
  if (matrix.length === 0) {
    return { pass: false, details: ["No twist_support_matrix entries found"] };
  }
  const issues = [];
  for (const item of matrix) {
    const twistId = String(item?.twist_id || "unknown_twist");
    const supportCount = Array.isArray(item?.supporting_clue_ids) ? item.supporting_clue_ids.length : 0;
    const recontextCount = Array.isArray(item?.recontextualized_slide_ids) ? item.recontextualized_slide_ids.length : 0;
    if (supportCount < 3) issues.push(`${twistId}: supporting_clue_ids=${supportCount} (<3)`);
    if (recontextCount < 2) issues.push(`${twistId}: recontextualized_slide_ids=${recontextCount} (<2)`);
  }
  return { pass: issues.length === 0, details: issues };
}

function provenanceChecks(stageProvenance) {
  const stages = stageProvenance?.stages || {};
  const micro = stages?.micro_world_map?.source;
  const drama = stages?.drama_plan?.source;
  const setpiece = stages?.setpiece_plan?.source;
  const bad = [
    ["micro_world_map", micro],
    ["drama_plan", drama],
    ["setpiece_plan", setpiece]
  ].filter(([, source]) => source !== "agent");
  return {
    pass: bad.length === 0,
    details: bad.map(([name, source]) => `${name} source=${String(source || "missing")}`)
  };
}

async function submitGateDecision(runId, gateId, status, notes) {
  const encodedRunId = encodeURIComponent(runId);
  const encodedGateId = encodeURIComponent(gateId);
  const url = `${BASE_URL}/api/runs/${encodedRunId}/gates/${encodedGateId}/submit`;
  return await httpJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, notes, requested_changes: [] })
  });
}

async function resumeRun(runId) {
  return await httpJson(`${BASE_URL}/api/runs/${encodeURIComponent(runId)}/resume`, {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  });
}

function smokeMarkdown(report) {
  const lines = [];
  lines.push("# V2 Quality Smoke Checklist");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Status: ${report.pass ? "PASS" : "FAIL"}`);
  lines.push(`Topic: ${report.topic}`);
  lines.push(`Run ID: ${report.runId || "n/a"}`);
  lines.push(`Audience: ${report.audienceLevel}`);
  lines.push(`Elapsed (s): ${Number(report.elapsedMs / 1000).toFixed(1)}`);
  lines.push("");
  lines.push("## Checks");
  lines.push("");
  lines.push(`- Required artifacts present: ${report.missingArtifacts.length === 0 ? "yes" : `no (${report.missingArtifacts.join(", ")})`}`);
  lines.push(`- Opening hook: ${report.markers?.openingHook ? "yes" : "no"}`);
  lines.push(`- False theory lock-in: ${report.markers?.falseTheoryLockIn ? "yes" : "no"}`);
  lines.push(`- Midpoint collapse: ${report.markers?.midpointCollapse ? "yes" : "no"}`);
  lines.push(`- Detective/Deputy rupture + repair: ${report.markers?.ruptureRepair ? "yes" : "no"}`);
  lines.push(`- Ending callback: ${report.markers?.endingCallback ? "yes" : "no"}`);
  lines.push(`- Twist receipts: ${report.twist?.pass ? "yes" : `no (${(report.twist?.details || []).join("; ") || "missing"})`}`);
  lines.push(`- Agent-authored provenance: ${report.provenance?.pass ? "yes" : `no (${(report.provenance?.details || []).join("; ") || "missing"})`}`);
  lines.push(`- Gate actions: ${report.gateActions.length > 0 ? report.gateActions.join(" | ") : "none"}`);
  if (report.errorMessage) {
    lines.push("");
    lines.push("## Failure");
    lines.push("");
    lines.push(`- ${report.errorMessage}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function writeSmokeOutputs(report) {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, "-");
  const jsonPath = path.join(OUTPUT_DIR, `v2-quality-smoke-${stamp}.json`);
  const mdPath = path.join(OUTPUT_DIR, `v2-quality-smoke-${stamp}.md`);
  const latestJsonPath = path.join(OUTPUT_DIR, "v2-quality-smoke-latest.json");
  const latestMdPath = path.join(OUTPUT_DIR, "v2-quality-smoke-latest.md");
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(mdPath, smokeMarkdown(report), "utf8");
  await fs.writeFile(latestJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(latestMdPath, smokeMarkdown(report), "utf8");
}

async function main() {
  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    topic: TOPIC,
    audienceLevel: AUDIENCE_LEVEL,
    runId: "",
    pass: false,
    gateActions: [],
    gate3Regens: 0,
    missingArtifacts: [],
    markers: null,
    twist: null,
    provenance: null,
    artifactCount: 0,
    elapsedMs: 0,
    errorMessage: ""
  };
  const startedAtMs = Date.now();
  let activeTimeoutMs = TIMEOUT_MS;
  let shouldCancelRun = false;

  console.log(`[smoke:v2:quality] baseUrl=${BASE_URL}`);
  console.log(`[smoke:v2:quality] topic=${TOPIC}`);
  console.log(`[smoke:v2:quality] audience=${AUDIENCE_LEVEL}`);
  try {
    const health = await httpJson(`${BASE_URL}/api/health`);
    assert(health?.ok === true, "Health check failed: ok !== true");
    assert(health?.hasKey === true, "Health check failed: missing OPENAI_API_KEY");
    assert(health?.hasVectorStoreId === true, "Health check failed: missing KB_VECTOR_STORE_ID");

    const runStart = await httpJson(`${BASE_URL}/api/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: TOPIC,
        settings: {
          workflow: "v2_micro_detectives",
          generationProfile: "quality",
          adherenceMode: "strict",
          audienceLevel: AUDIENCE_LEVEL,
          deckLengthConstraintEnabled: false
        }
      })
    });

    const runId = String(runStart?.runId || "").trim();
    assert(runId.length > 0, "Run creation failed: missing runId");
    report.runId = runId;
    shouldCancelRun = true;
    console.log(`[smoke:v2:quality] runId=${runId}`);

    while (true) {
      if (Date.now() - startedAtMs > activeTimeoutMs) {
        throw new Error(`Timed out after ${Math.round(activeTimeoutMs / 1000)}s waiting for completion`);
      }

      const run = await httpJson(`${BASE_URL}/api/runs/${encodeURIComponent(runId)}`);
      const recommendedTimeoutMs = computeRecommendedRunTimeoutMs(run, TIMEOUT_MS);
      if (recommendedTimeoutMs > activeTimeoutMs) {
        activeTimeoutMs = recommendedTimeoutMs;
        if (VERBOSE) {
          console.log(`[smoke:v2:quality] adaptive timeout extended to ${Math.round(activeTimeoutMs / 60000)}m`);
        }
      }
      const status = String(run?.status || "unknown");
      if (VERBOSE) {
        console.log(`[smoke:v2:quality] status=${status}`);
      }

      if (status === "done") {
        console.log("[smoke:v2:quality] run completed");
        shouldCancelRun = false;
        break;
      }
      if (status === "error") {
        shouldCancelRun = false;
        throw new Error("Run ended with status=error");
      }

      if (status === "paused" && run?.activeGate?.gateId) {
        const gateId = String(run.activeGate.gateId);
        const isGate3 = gateId === "GATE_3_STORYBOARD";
        if (VERBOSE) {
          console.log(`[smoke:v2:quality] paused at ${gateId} -> submit approve + resume`);
        }
        try {
          await submitGateDecision(runId, gateId, "approve", "Smoke checklist auto-approve");
          report.gateActions.push(`${gateId}:approve`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (isGate3 && /semantic acceptance gate failed/i.test(message)) {
            if (report.gate3Regens >= 1) {
              throw new Error("Gate 3 semantic block persisted after one regenerate attempt.");
            }
            report.gate3Regens += 1;
            await submitGateDecision(runId, gateId, "regenerate", "Smoke checklist auto-regenerate for semantic acceptance");
            report.gateActions.push(`${gateId}:regenerate`);
          } else {
            throw err;
          }
        }
        await resumeRun(runId);
        report.gateActions.push(`${gateId}:resume`);
        await sleep(Math.max(1000, Math.min(5000, POLL_MS)));
        continue;
      }

      await sleep(POLL_MS);
    }

    const artifacts = await httpJson(`${BASE_URL}/api/runs/${encodeURIComponent(runId)}/artifacts`);
    const names = new Set((Array.isArray(artifacts) ? artifacts : []).map((item) => String(item?.name || "")));
    report.artifactCount = names.size;

    const requiredArtifacts = [
      "deck_spec.json",
      "disease_dossier.json",
      "truth_model.json",
      "differential_cast.json",
      "clue_graph.json",
      "micro_world_map.json",
      "drama_plan.json",
      "setpiece_plan.json",
      "story_blueprint.json",
      "act_outline.json",
      "deck_authoring_context_manifest.json",
      "narrative_state_current.json",
      "v2_stage_authoring_provenance.json"
    ];

    report.missingArtifacts = requiredArtifacts.filter((name) => !names.has(name));
    assert(report.missingArtifacts.length === 0, `Missing required artifacts: ${report.missingArtifacts.join(", ")}`);

    const deckSpec = JSON.parse(await fetchArtifactText(runId, "deck_spec.json"));
    const clueGraph = JSON.parse(await fetchArtifactText(runId, "clue_graph.json"));
    const stageProvenance = JSON.parse(await fetchArtifactText(runId, "v2_stage_authoring_provenance.json"));

    report.markers = markerChecks(deckSpec);
    report.twist = twistReceiptChecks(clueGraph);
    report.provenance = provenanceChecks(stageProvenance);

    const markerFailures = Object.entries({
      openingHook: report.markers.openingHook,
      falseTheoryLockIn: report.markers.falseTheoryLockIn,
      midpointCollapse: report.markers.midpointCollapse,
      ruptureRepair: report.markers.ruptureRepair,
      endingCallback: report.markers.endingCallback
    })
      .filter(([, pass]) => !pass)
      .map(([name]) => name);

    assert(markerFailures.length === 0, `Narrative markers missing: ${markerFailures.join(", ")}`);
    assert(report.twist.pass, `Twist receipt checks failed: ${report.twist.details.join("; ")}`);
    assert(report.provenance.pass, `Authoring provenance checks failed: ${report.provenance.details.join("; ")}`);

    report.pass = true;
    console.log("[smoke:v2:quality] PASS");
    console.log(`[smoke:v2:quality] gateActions=${report.gateActions.join(" | ") || "none"}`);
    console.log(`[smoke:v2:quality] markerDetails=${JSON.stringify(report.markers.details)}`);
  } catch (err) {
    report.errorMessage = err instanceof Error ? err.message : String(err);
    if (shouldCancelRun && report.runId) {
      const cancelled = await cancelRunBestEffort(report.runId, "smoke_timeout_or_error");
      if (cancelled) {
        report.gateActions.push("timeout:auto_cancel");
      }
    }
    throw err;
  } finally {
    report.generatedAt = new Date().toISOString();
    report.elapsedMs = Math.max(0, Date.now() - startedAtMs);
    await writeSmokeOutputs(report);
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[smoke:v2:quality] FAIL: ${message}`);
  process.exitCode = 1;
});
