import { Link, useNavigate, useParams } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { createTwoFilesPatch } from "diff";
import {
  cancelRun,
  exportZipUrl,
  fetchArtifact,
  getRun,
  listArtifacts,
  rerunFrom,
  RunStatus,
  sseUrl,
  ArtifactInfo,
  StepStatus
} from "../api";
import StepTimeline from "./StepTimeline";
import ArtifactList from "./ArtifactList";
import ArtifactViewer from "./ArtifactViewer";
import UnifiedDiffViewer from "./UnifiedDiffViewer";

type LogLine = { at: string; msg: string };
type RecoveredStep = { step: string; recoveredAt: string; stalledForMs: number };
type ConstraintReport = {
  status: "pass" | "warn" | "fail";
  checked_at: string;
  failures: string[];
  warnings: string[];
  details: {
    canonical_characters: string[];
    matched_story_characters: string[];
    missing_story_characters: string[];
    required_style_rules_checked: number;
    required_style_rule_hits: number;
    forbidden_style_hits: string[];
    slide_mode_counts?: {
      hybrid: number;
      story_transition: number;
    };
    intro_outro_contract_status?: {
      status: "pass" | "fail";
      issues: string[];
    };
    medical_only_violations?: string[];
    master_doc_validation_status?: "not_checked" | "pass" | "warn" | "fail";
    semantic_similarity?: {
      closest_run_id: string;
      score: number;
      threshold: number;
      retried: boolean;
    };
  };
};

type NarrativeBackbone = {
  medical_narrative_flow: {
    chapter_summary: string;
    progression: Array<{
      stage: string;
      medical_logic: string;
      key_teaching_points: string[];
      story_implication: string;
    }>;
    metaphor_map: Array<{
      medical_element: string;
      mystery_expression: string;
      pedagogy_reason: string;
    }>;
    required_plot_events: string[];
  };
};

type ReusableVisualPrimer = {
  reusable_visual_primer: {
    character_descriptions: string[];
    recurring_scene_descriptions: string[];
    reusable_visual_elements: string[];
    continuity_rules: string[];
  };
};

type DiffTargetStep = "KB0" | "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J" | "K" | "L" | "M" | "N" | "O" | "P";
type ArtifactFolderFilter = "all" | "root" | "intermediate" | "final";
type SummaryTab = "narrative" | "visual";

const STEP_ORDER: DiffTargetStep[] = ["KB0", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P"];
const DEFAULT_STUCK_THRESHOLD_SECONDS = 90;
const STUCK_THRESHOLD_MIN_SECONDS = 10;
const STUCK_THRESHOLD_MAX_SECONDS = 1200;
const WATCHDOG_STORAGE_KEY = "mms_watchdog_threshold_seconds";

function isoNow(): string {
  return new Date().toISOString();
}

function stepOrderKey(name: string): number {
  const order = ["run.json", "trace.json"];
  const idx = order.indexOf(name);
  return idx === -1 ? 999 : idx;
}

function iterationNumber(name: string): number {
  const m = name.match(/final_slide_spec_patched_iter(\d+)\.json$/);
  if (!m) return -1;
  return Number(m[1]);
}

function isPatchedIter(name: string): boolean {
  return /^final_slide_spec_patched_iter\d+\.json$/.test(name);
}

function stableSort(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableSort);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort((a, b) => a.localeCompare(b))) {
      out[k] = stableSort(obj[k]);
    }
    return out;
  }
  return value;
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(stableSort(value), null, 2)}\n`;
}

function parseJsonOrThrow(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid JSON artifact: ${msg}`);
  }
}

function extractKeyOrFallback(obj: unknown, key: string): unknown {
  if (obj && typeof obj === "object" && key in (obj as Record<string, unknown>)) {
    return (obj as Record<string, unknown>)[key];
  }
  return obj;
}

function formatTime(iso?: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function parseIsoMs(iso?: string): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function formatElapsed(ms: number): string {
  const totalSec = Math.max(1, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function clampWatchdogThresholdSeconds(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_STUCK_THRESHOLD_SECONDS;
  return Math.min(STUCK_THRESHOLD_MAX_SECONDS, Math.max(STUCK_THRESHOLD_MIN_SECONDS, Math.round(value)));
}

function initialWatchdogThresholdSeconds(): number {
  if (typeof window === "undefined") return DEFAULT_STUCK_THRESHOLD_SECONDS;
  const raw = window.localStorage.getItem(WATCHDOG_STORAGE_KEY);
  if (!raw) return DEFAULT_STUCK_THRESHOLD_SECONDS;
  const parsed = Number(raw);
  return clampWatchdogThresholdSeconds(parsed);
}

function statusBadgeClass(status: RunStatus["status"]): string {
  if (status === "done") return "badge badgeOk";
  if (status === "error") return "badge badgeErr";
  return "badge";
}

function constraintBadgeClass(status: NonNullable<RunStatus["constraintAdherence"]>["status"]): string {
  if (status === "fail") return "badge badgeErr";
  if (status === "pass") return "badge badgeOk";
  return "badge";
}

export default function RunViewer() {
  const { runId } = useParams();
  const navigate = useNavigate();
  const [run, setRun] = useState<RunStatus | null>(null);
  const [runErr, setRunErr] = useState<string | null>(null);
  const [artifacts, setArtifacts] = useState<ArtifactInfo[]>([]);
  const [artifactQuery, setArtifactQuery] = useState<string>("");
  const [artifactFolderFilter, setArtifactFolderFilter] = useState<ArtifactFolderFilter>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [artifactContent, setArtifactContent] = useState<string>("");
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [rerunBusy, setRerunBusy] = useState(false);
  const [rerunStartFrom, setRerunStartFrom] = useState<DiffTargetStep>("KB0");
  const [diffTarget, setDiffTarget] = useState<string>("");
  const [diffBusy, setDiffBusy] = useState(false);
  const [diffErr, setDiffErr] = useState<string | null>(null);
  const [diffText, setDiffText] = useState<string>("");
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [watchdogThresholdSeconds, setWatchdogThresholdSeconds] = useState<number>(() => initialWatchdogThresholdSeconds());
  const [recoveredSteps, setRecoveredSteps] = useState<RecoveredStep[]>([]);
  const [constraintReport, setConstraintReport] = useState<ConstraintReport | null>(null);
  const [constraintReportErr, setConstraintReportErr] = useState<string | null>(null);
  const [constraintReportBusy, setConstraintReportBusy] = useState(false);
  const [summaryTab, setSummaryTab] = useState<SummaryTab>("narrative");
  const [narrativeBackbone, setNarrativeBackbone] = useState<NarrativeBackbone | null>(null);
  const [visualPrimer, setVisualPrimer] = useState<ReusableVisualPrimer | null>(null);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [summaryErr, setSummaryErr] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const previousStuckRef = useRef<Map<string, number>>(new Map());

  const safeRunId = useMemo(() => runId ?? "", [runId]);

  const baselineSpecName = useMemo(() => {
    return artifacts.some((a) => a.name === "final_slide_spec.json") ? "final_slide_spec.json" : null;
  }, [artifacts]);

  const patchedIterNames = useMemo(() => {
    return artifacts
      .map((a) => a.name)
      .filter((name) => isPatchedIter(name))
      .sort((a, b) => iterationNumber(a) - iterationNumber(b));
  }, [artifacts]);

  const visibleArtifacts = useMemo(() => {
    const query = artifactQuery.trim().toLowerCase();
    return artifacts.filter((a) => {
      const folder = (a.folder ?? "intermediate") as Exclude<ArtifactFolderFilter, "all">;
      if (artifactFolderFilter !== "all" && folder !== artifactFolderFilter) return false;
      if (!query) return true;
      return a.name.toLowerCase().includes(query);
    });
  }, [artifacts, artifactFolderFilter, artifactQuery]);

  async function refreshRun() {
    if (!safeRunId) return;
    try {
      const r = await getRun(safeRunId);
      setRun(r);
    } catch (e) {
      setRunErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function refreshArtifacts() {
    if (!safeRunId) return;
    try {
      const a = await listArtifacts(safeRunId);
      a.sort((x, y) => {
        const k1 = stepOrderKey(x.name);
        const k2 = stepOrderKey(y.name);
        if (k1 !== k2) return k1 - k2;
        return y.mtimeMs - x.mtimeMs;
      });
      setArtifacts(a);
    } catch {
      // keep UI responsive even when artifacts API fails
    }
  }

  useEffect(() => {
    setRun(null);
    setRunErr(null);
    setLogs([]);
    setArtifacts([]);
    setArtifactQuery("");
    setArtifactFolderFilter("all");
    setSelected(null);
    setArtifactContent("");
    setActionErr(null);
    setCancelBusy(false);
    setRerunBusy(false);
    setRerunStartFrom("KB0");
    setDiffTarget("");
    setDiffBusy(false);
    setDiffErr(null);
    setDiffText("");
    setNowMs(Date.now());
    setRecoveredSteps([]);
    previousStuckRef.current = new Map();
    setConstraintReport(null);
    setConstraintReportErr(null);
    setConstraintReportBusy(false);
    setSummaryTab("narrative");
    setNarrativeBackbone(null);
    setVisualPrimer(null);
    setSummaryBusy(false);
    setSummaryErr(null);

    void refreshRun();
    void refreshArtifacts();
  }, [safeRunId]);

  useEffect(() => {
    const hasDiagnosticsArtifact = artifacts.some((a) => a.name === "constraint_adherence_report.json");
    if (!safeRunId || !hasDiagnosticsArtifact) {
      setConstraintReport(null);
      setConstraintReportErr(null);
      setConstraintReportBusy(false);
      return;
    }

    let cancelled = false;
    setConstraintReportBusy(true);
    setConstraintReportErr(null);

    void (async () => {
      try {
        const report = await fetchArtifact(safeRunId, "constraint_adherence_report.json");
        const parsed = parseJsonOrThrow(report.text) as ConstraintReport;
        if (!cancelled) {
          setConstraintReport(parsed);
          setConstraintReportErr(null);
        }
      } catch (e) {
        if (!cancelled) {
          setConstraintReport(null);
          setConstraintReportErr(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setConstraintReportBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [safeRunId, artifacts]);

  useEffect(() => {
    const hasNarrativeArtifact = artifacts.some((a) => a.name === "medical_narrative_flow.json");
    const hasVisualPrimerArtifact = artifacts.some((a) => a.name === "reusable_visual_primer.json");

    if (!safeRunId || (!hasNarrativeArtifact && !hasVisualPrimerArtifact)) {
      setNarrativeBackbone(null);
      setVisualPrimer(null);
      setSummaryErr(null);
      setSummaryBusy(false);
      return;
    }

    let cancelled = false;
    setSummaryBusy(true);
    setSummaryErr(null);

    void (async () => {
      try {
        const [narrativeRaw, visualRaw] = await Promise.all([
          hasNarrativeArtifact ? fetchArtifact(safeRunId, "medical_narrative_flow.json") : Promise.resolve(null),
          hasVisualPrimerArtifact ? fetchArtifact(safeRunId, "reusable_visual_primer.json") : Promise.resolve(null)
        ]);

        if (cancelled) return;

        const narrativeParsed = narrativeRaw ? (parseJsonOrThrow(narrativeRaw.text) as NarrativeBackbone) : null;
        const visualParsed = visualRaw ? (parseJsonOrThrow(visualRaw.text) as ReusableVisualPrimer) : null;

        setNarrativeBackbone(narrativeParsed);
        setVisualPrimer(visualParsed);
        setSummaryErr(null);
      } catch (e) {
        if (cancelled) return;
        setNarrativeBackbone(null);
        setVisualPrimer(null);
        setSummaryErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setSummaryBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [safeRunId, artifacts]);

  useEffect(() => {
    if (patchedIterNames.length > 0 && !diffTarget) {
      setDiffTarget(patchedIterNames[patchedIterNames.length - 1]!);
    }
  }, [patchedIterNames, diffTarget]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(WATCHDOG_STORAGE_KEY, String(watchdogThresholdSeconds));
  }, [watchdogThresholdSeconds]);

  useEffect(() => {
    if (!run || run.status !== "running") return;
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [run?.runId, run?.status]);

  useEffect(() => {
    if (!safeRunId) return;

    const es = new EventSource(sseUrl(safeRunId));
    esRef.current = es;

    const pushLog = (msg: string) => setLogs((prev) => [...prev.slice(-399), { at: isoNow(), msg }]);

    function updateStep(name: string, patch: Partial<StepStatus>) {
      setRun((prev) => {
        if (!prev) return prev;
        const cur = prev.steps[name] ?? { name, status: "queued", artifacts: [] };
        const next = { ...cur, ...patch };
        return { ...prev, steps: { ...prev.steps, [name]: next } };
      });
    }

    es.addEventListener("step_started", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as { step: string; at: string };
        updateStep(data.step, { status: "running", startedAt: data.at });
        pushLog(`[${data.step}] started`);
      } catch {
        pushLog("step_started (unparseable)");
      }
    });

    es.addEventListener("step_finished", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as { step: string; at: string; ok: boolean };
        updateStep(data.step, { status: data.ok ? "done" : "error", finishedAt: data.at });
        pushLog(`[${data.step}] finished (${data.ok ? "ok" : "error"})`);
      } catch {
        pushLog("step_finished (unparseable)");
      }
      void refreshRun();
    });

    es.addEventListener("artifact_written", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as { step: string; name: string };
        pushLog(`[${data.step}] artifact: ${data.name}`);
      } catch {
        pushLog("artifact_written (unparseable)");
      }
      void refreshArtifacts();
      void refreshRun();
    });

    es.addEventListener("log", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as { message: string; step?: string };
        pushLog(data.step ? `[${data.step}] ${data.message}` : data.message);
      } catch {
        pushLog((ev as MessageEvent).data);
      }
    });

    es.addEventListener("error", (ev) => {
      // NOTE: EventSource also uses 'error' for transport errors.
      try {
        const data = JSON.parse((ev as MessageEvent).data) as { message: string; step?: string };
        pushLog(data.step ? `[${data.step}] ERROR: ${data.message}` : `ERROR: ${data.message}`);
      } catch {
        // transport error or server error with non-json
      }
      void refreshRun();
    });

    es.onerror = () => {
      pushLog("SSE connection error (will auto-retry)");
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [safeRunId]);

  async function onSelectArtifact(name: string) {
    setSelected(name);
    setArtifactContent("Loading...");
    try {
      const { text } = await fetchArtifact(safeRunId, name);
      setArtifactContent(text);
    } catch (e) {
      setArtifactContent(e instanceof Error ? e.message : String(e));
    }
  }

  async function copyTraceId() {
    if (!run?.traceId || !navigator.clipboard?.writeText) return;
    await navigator.clipboard.writeText(run.traceId);
    setLogs((prev) => [...prev, { at: isoNow(), msg: "trace id copied" }]);
  }

  async function onCancel() {
    if (!safeRunId) return;
    setActionErr(null);
    setCancelBusy(true);
    try {
      await cancelRun(safeRunId);
      setLogs((prev) => [...prev, { at: isoNow(), msg: "cancel requested" }]);
      await refreshRun();
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : String(e));
    } finally {
      setCancelBusy(false);
    }
  }

  async function onRerun() {
    if (!safeRunId) return;
    setActionErr(null);
    setRerunBusy(true);
    try {
      const res = await rerunFrom(safeRunId, rerunStartFrom);
      navigate(`/runs/${res.runId}`);
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRerunBusy(false);
    }
  }

  async function onComputeDiff() {
    if (!safeRunId) return;
    // The Diff button is only rendered when both are present.
    const baseline = baselineSpecName!;
    const target = diffTarget;

    setDiffErr(null);
    setDiffBusy(true);
    try {
      const [base, patched] = await Promise.all([fetchArtifact(safeRunId, baseline), fetchArtifact(safeRunId, target)]);

      const baseObj = parseJsonOrThrow(base.text);
      const patchedObj = parseJsonOrThrow(patched.text);

      const baseVal = extractKeyOrFallback(baseObj, "final_slide_spec");
      const patchedVal = extractKeyOrFallback(patchedObj, "final_slide_spec_patched");

      const baseStr = stableJson(baseVal);
      const patchedStr = stableJson(patchedVal);

      const patch = createTwoFilesPatch(baseline, target, baseStr, patchedStr, "", "", { context: 3 });
      setDiffText(patch);
    } catch (e) {
      setDiffErr(e instanceof Error ? e.message : String(e));
      setDiffText("");
    } finally {
      setDiffBusy(false);
    }
  }

  function onWatchdogThresholdChange(raw: string) {
    const parsed = Number(raw);
    setWatchdogThresholdSeconds(clampWatchdogThresholdSeconds(parsed));
  }

  const canonicalRows = run?.canonicalSources
    ? [
        { label: "template root", value: run.canonicalSources.templateRoot },
        { label: "character bible", value: run.canonicalSources.characterBiblePath },
        { label: "series style bible", value: run.canonicalSources.seriesStyleBiblePath },
        { label: "deck spec", value: run.canonicalSources.deckSpecPath }
      ]
    : [];

  const stuckThresholdMs = watchdogThresholdSeconds * 1000;

  const stuckRunningSteps = useMemo(() => {
    if (!run) return [] as Array<{ step: string; elapsedMs: number }>;

    return STEP_ORDER.map((step) => ({ step, status: run.steps[step] }))
      .filter((row) => row.status?.status === "running")
      .map((row) => {
        const startedMs = parseIsoMs(row.status?.startedAt);
        return {
          step: row.step,
          elapsedMs: startedMs === null ? 0 : Math.max(0, nowMs - startedMs)
        };
      })
      .filter((row) => row.elapsedMs >= stuckThresholdMs);
  }, [run, nowMs, stuckThresholdMs]);

  const recoveredStepNames = useMemo(() => recoveredSteps.map((r) => r.step), [recoveredSteps]);

  useEffect(() => {
    if (!run) return;

    const nextStuck = new Map(stuckRunningSteps.map((row) => [row.step, row.elapsedMs]));
    const prevStuck = previousStuckRef.current;
    const recovered: RecoveredStep[] = [];

    for (const [step, stalledForMs] of prevStuck) {
      if (nextStuck.has(step)) continue;
      const status = run.steps[step]?.status;
      if (status !== "done") continue;
      recovered.push({ step, recoveredAt: isoNow(), stalledForMs });
    }

    if (recovered.length > 0) {
      setRecoveredSteps((prev) => {
        const byStep = new Map(prev.map((row) => [row.step, row]));
        for (const row of recovered) byStep.set(row.step, row);
        return [...byStep.values()];
      });
    }

    previousStuckRef.current = nextStuck;
  }, [run, stuckRunningSteps]);

  return (
    <div className="runLayout">
      {runErr && <div className="badge badgeErr">{runErr}</div>}
      {!run && !runErr && <div className="subtle">Loading run...</div>}

      {run && (
        <>
          <div className="panel runSummaryCard">
            <div className="panelHeader">
              <div>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Run</div>
                <div className="row">
                  <Link className="badge" to="/">
                    back
                  </Link>
                  <span className={statusBadgeClass(run.status)}>{run.status}</span>
                </div>
              </div>
              <div className="subtle mono">{safeRunId}</div>
            </div>
            <div className="panelBody">
              <h2 className="runTitle">{run.topic}</h2>
              <div className="subtle">Output folder</div>
              <div className="mono">{run.outputFolder}</div>
            </div>
          </div>

          <div className="panel runActionCard">
            <div className="panelBody">
              <div className="row runActions" style={{ alignItems: "flex-end" }}>
                <button
                  className="buttonDanger"
                  disabled={cancelBusy || (run.status !== "running" && run.status !== "queued")}
                  onClick={() => void onCancel()}
                  title="Cancel a queued or running run"
                >
                  {cancelBusy ? "Cancelling..." : "Cancel run"}
                </button>

                <a className="buttonLink" href={exportZipUrl(safeRunId)} target="_blank" rel="noreferrer">
                  Export zip
                </a>

                <div className="row" style={{ gap: 10 }}>
                  <span className="subtle">Rerun from</span>
                  <select
                    aria-label="Rerun start step"
                    value={rerunStartFrom}
                    onChange={(e) => setRerunStartFrom(e.target.value as DiffTargetStep)}
                    style={{ width: 120 }}
                    disabled={rerunBusy || run.status === "running"}
                  >
                    {STEP_ORDER.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <button disabled={rerunBusy || run.status === "running"} onClick={() => void onRerun()}>
                    {rerunBusy ? "Starting..." : "Rerun"}
                  </button>
                </div>

                {actionErr && <span className="badge badgeErr">{actionErr}</span>}
              </div>
            </div>
          </div>

          <div className="panel runMetaCard">
            <div className="panelHeader">
              <div style={{ fontWeight: 600 }}>Run metadata</div>
            </div>
            <div className="panelBody runMetaGrid">
              <div className="metaPair">
                <div className="metaKey">started</div>
                <div className="mono">{formatTime(run.startedAt)}</div>
              </div>
              <div className="metaPair">
                <div className="metaKey">finished</div>
                <div className="mono">{formatTime(run.finishedAt)}</div>
              </div>
              <div className="metaPair">
                <div className="metaKey">settings</div>
                <div className="mono">{run.settings ? JSON.stringify(run.settings) : "-"}</div>
              </div>
              <div className="metaPair">
                <div className="metaKey">adherence mode</div>
                <div className="mono">{run.settings?.adherenceMode ?? "strict (default)"}</div>
              </div>
              <div className="metaPair">
                <div className="metaKey">watchdog threshold</div>
                <div className="row" style={{ gap: 8 }}>
                  <input
                    aria-label="Watchdog threshold (seconds)"
                    type="number"
                    min={STUCK_THRESHOLD_MIN_SECONDS}
                    max={STUCK_THRESHOLD_MAX_SECONDS}
                    value={watchdogThresholdSeconds}
                    onChange={(e) => onWatchdogThresholdChange(e.target.value)}
                    style={{ width: 120 }}
                  />
                  <button onClick={() => setWatchdogThresholdSeconds(DEFAULT_STUCK_THRESHOLD_SECONDS)}>Reset</button>
                </div>
              </div>
              <div className="metaPair traceRow">
                <div className="metaKey">trace</div>
                <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                  <span className="mono">{run.traceId ?? "-"}</span>
                  <button disabled={!run.traceId} onClick={() => void copyTraceId()}>
                    Copy
                  </button>
                </div>
              </div>

              <div className="metaPair" style={{ gridColumn: "1 / -1" }}>
                <div className="metaKey">derived</div>
                <div>
                  {run.derivedFrom ? (
                    <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
                      <Link className="badge" to={`/runs/${run.derivedFrom.runId}`}>
                        parent {run.derivedFrom.runId}
                      </Link>
                      <span className="mono">startFrom={run.derivedFrom.startFrom}</span>
                      <span className="subtle mono">{run.derivedFrom.createdAt}</span>
                    </div>
                  ) : (
                    <span className="subtle">-</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {stuckRunningSteps.length > 0 && (
            <div className="panel runWatchdogCard">
              <div className="panelBody">
                <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                  <span className="badge badgeWarn">Watchdog</span>
                  <span className="mono watchdogText">
                    {stuckRunningSteps[0]!.step} running {formatElapsed(stuckRunningSteps[0]!.elapsedMs)} (threshold{" "}
                    {formatElapsed(stuckThresholdMs)})
                  </span>
                </div>
              </div>
            </div>
          )}

          {recoveredSteps.length > 0 && (
            <div className="panel runWatchdogRecoveredCard">
              <div className="panelBody">
                <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                  <span className="badge badgeOk">Recovered</span>
                  <span className="mono watchdogText">
                    {recoveredSteps
                      .slice(0, 2)
                      .map((row) => `${row.step} recovered after ${formatElapsed(row.stalledForMs)}`)
                      .join(" | ")}
                  </span>
                </div>
              </div>
            </div>
          )}

          {run.stepSlo && (
            <div className="panel runSloCard">
              <div className="panelBody">
                {run.stepSlo.warningSteps.length > 0 ? (
                  <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                    <span className="badge badgeWarn">Step SLO warnings</span>
                    <span className="mono watchdogText">
                      {run.stepSlo.warningSteps
                        .slice(0, 3)
                        .map((step) => {
                          const evalRow = run.stepSlo?.evaluations?.[step];
                          if (!evalRow || evalRow.elapsedMs === null) return step;
                          return `${step} ${formatElapsed(evalRow.elapsedMs)} > ${formatElapsed(evalRow.thresholdMs)}`;
                        })
                        .join(" | ")}
                    </span>
                  </div>
                ) : (
                  <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                    <span className="badge badgeOk">Step SLOs</span>
                    <span className="mono">All completed/running steps are within threshold.</span>
                  </div>
                )}
              </div>
            </div>
          )}

          <StepTimeline
            steps={run.steps}
            nowMs={nowMs}
            stuckThresholdMs={stuckThresholdMs}
            recoveredSteps={recoveredStepNames}
            slowSteps={run.stepSlo?.warningSteps ?? []}
          />

          <div className="runContentGrid">
            <section className="panel runMainCard">
              <div className="panelHeader">
                <div style={{ fontWeight: 600 }}>Artifacts</div>
                <button onClick={() => void refreshArtifacts()}>Refresh</button>
              </div>

              <div className="panelBody">
                <div className="artifactFilterBar">
                  <input
                    aria-label="Artifact search"
                    value={artifactQuery}
                    placeholder="Search artifacts…"
                    onChange={(e) => setArtifactQuery(e.target.value)}
                  />
                  <select
                    aria-label="Artifact folder filter"
                    value={artifactFolderFilter}
                    onChange={(e) => setArtifactFolderFilter(e.target.value as ArtifactFolderFilter)}
                  >
                    <option value="all">All folders</option>
                    <option value="root">Root</option>
                    <option value="final">Final</option>
                    <option value="intermediate">Intermediate</option>
                  </select>
                </div>
                <div className="split runArtifactSplit">
                  <ArtifactList
                    artifacts={visibleArtifacts}
                    selected={selected}
                    onSelect={onSelectArtifact}
                    emptyMessage={artifacts.length > 0 ? "No artifacts match current filters." : "No artifacts yet."}
                  />
                  <div>
                    {selected ? (
                      <ArtifactViewer name={selected} content={artifactContent} />
                    ) : (
                      <div className="subtle">Select an artifact to view it.</div>
                    )}
                  </div>
                </div>

                <div className="runDiffSection">
                  <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>Slide spec diffs</div>
                      <div className="subtle">Diff `final_slide_spec.json` vs `final_slide_spec_patched_iter*.json`</div>
                    </div>

                    {baselineSpecName && patchedIterNames.length > 0 ? (
                      <div className="row" style={{ gap: 10 }}>
                        <select value={diffTarget} onChange={(e) => setDiffTarget(e.target.value)} style={{ width: 280 }}>
                          {patchedIterNames.map((n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ))}
                        </select>
                        <button disabled={diffBusy || !diffTarget} onClick={() => void onComputeDiff()}>
                          {diffBusy ? "Diffing..." : "Diff"}
                        </button>
                      </div>
                    ) : (
                      <span className="badge">{baselineSpecName ? "No patched iter artifacts yet" : "No baseline spec yet"}</span>
                    )}
                  </div>

                  {diffErr && (
                    <div style={{ marginTop: 10 }}>
                      <span className="badge badgeErr">{diffErr}</span>
                    </div>
                  )}

                  {diffText ? (
                    <div style={{ marginTop: 10 }}>
                      <UnifiedDiffViewer diff={diffText} />
                    </div>
                  ) : (
                    <div style={{ marginTop: 10 }} className="subtle">
                      {baselineSpecName && patchedIterNames.length > 0 ? "Click Diff to compute a unified diff." : ""}
                    </div>
                  )}
                </div>
              </div>
            </section>

            <aside className="runSideColumn">
              <div className="panel">
                <div className="panelHeader">
                  <div style={{ fontWeight: 600 }}>Live logs</div>
                  <button onClick={() => setLogs([])}>Clear</button>
                </div>
                <div className="panelBody">
                  <div className="log mono">
                    {logs.length === 0 ? (
                      <div className="logLine">(no logs yet)</div>
                    ) : (
                      logs.map((l, i) => (
                        <div key={i} className="logLine">
                          {l.at} {l.msg}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              <div className="panel">
                <div className="panelHeader">
                  <div style={{ fontWeight: 600 }}>Story + visual summaries</div>
                </div>
                <div className="panelBody">
                  <div className="summaryTabs">
                    <button
                      className={`summaryTabButton ${summaryTab === "narrative" ? "summaryTabButtonActive" : ""}`}
                      onClick={() => setSummaryTab("narrative")}
                    >
                      Narrative Backbone
                    </button>
                    <button
                      className={`summaryTabButton ${summaryTab === "visual" ? "summaryTabButtonActive" : ""}`}
                      onClick={() => setSummaryTab("visual")}
                    >
                      Reusable Visual Primer
                    </button>
                  </div>

                  {summaryBusy && <div className="subtle">Loading summaries…</div>}
                  {summaryErr && <span className="badge badgeErr">{summaryErr}</span>}

                  {!summaryBusy && !summaryErr && summaryTab === "narrative" && (
                    <>
                      {!narrativeBackbone && <div className="subtle">No narrative backbone artifact yet.</div>}
                      {narrativeBackbone && (
                        <div className="summaryCardList">
                          <div className="summaryCard">
                            <div className="summaryCardTitle">Chapter summary</div>
                            <div className="summaryText">{narrativeBackbone.medical_narrative_flow.chapter_summary}</div>
                          </div>
                          <details className="diagnosticDetails" open>
                            <summary>Progression ({narrativeBackbone.medical_narrative_flow.progression.length})</summary>
                            <ul className="diagnosticList">
                              {narrativeBackbone.medical_narrative_flow.progression.map((p, idx) => (
                                <li key={`prog-${idx}`}>
                                  <strong>{p.stage}:</strong> {p.story_implication}
                                </li>
                              ))}
                            </ul>
                          </details>
                          <details className="diagnosticDetails">
                            <summary>Required plot events ({narrativeBackbone.medical_narrative_flow.required_plot_events.length})</summary>
                            <ul className="diagnosticList">
                              {narrativeBackbone.medical_narrative_flow.required_plot_events.map((evt, idx) => (
                                <li key={`evt-${idx}`}>{evt}</li>
                              ))}
                            </ul>
                          </details>
                        </div>
                      )}
                    </>
                  )}

                  {!summaryBusy && !summaryErr && summaryTab === "visual" && (
                    <>
                      {!visualPrimer && <div className="subtle">No reusable visual primer artifact yet.</div>}
                      {visualPrimer && (
                        <div className="summaryCardList">
                          <details className="diagnosticDetails" open>
                            <summary>Character descriptions ({visualPrimer.reusable_visual_primer.character_descriptions.length})</summary>
                            <ul className="diagnosticList">
                              {visualPrimer.reusable_visual_primer.character_descriptions.map((item, idx) => (
                                <li key={`char-${idx}`}>{item}</li>
                              ))}
                            </ul>
                          </details>
                          <details className="diagnosticDetails">
                            <summary>Recurring scenes ({visualPrimer.reusable_visual_primer.recurring_scene_descriptions.length})</summary>
                            <ul className="diagnosticList">
                              {visualPrimer.reusable_visual_primer.recurring_scene_descriptions.map((item, idx) => (
                                <li key={`scene-${idx}`}>{item}</li>
                              ))}
                            </ul>
                          </details>
                          <details className="diagnosticDetails">
                            <summary>Reusable visual elements ({visualPrimer.reusable_visual_primer.reusable_visual_elements.length})</summary>
                            <ul className="diagnosticList">
                              {visualPrimer.reusable_visual_primer.reusable_visual_elements.map((item, idx) => (
                                <li key={`vis-${idx}`}>{item}</li>
                              ))}
                            </ul>
                          </details>
                          <details className="diagnosticDetails">
                            <summary>Continuity rules ({visualPrimer.reusable_visual_primer.continuity_rules.length})</summary>
                            <ul className="diagnosticList">
                              {visualPrimer.reusable_visual_primer.continuity_rules.map((item, idx) => (
                                <li key={`rule-${idx}`}>{item}</li>
                              ))}
                            </ul>
                          </details>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              <div className="panel">
                <div className="panelHeader">
                  <div style={{ fontWeight: 600 }}>Canonical sources loaded</div>
                </div>
                <div className="panelBody">
                  {!run.canonicalSources && <div className="subtle">No canonical metadata available.</div>}
                  {run.canonicalSources && (
                    <>
                      <div className="row" style={{ marginBottom: 8 }}>
                        <span className={`badge ${run.canonicalSources.foundAny ? "badgeOk" : ""}`}>
                          {run.canonicalSources.foundAny ? "at least one source found" : "no canonical source files found"}
                        </span>
                      </div>
                      <div className="canonicalRows">
                        {canonicalRows.map((row) => (
                          <div className="canonicalRow" key={row.label}>
                            <div className="subtle">{row.label}</div>
                            <div className="mono canonicalValue">{row.value ?? "-"}</div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="panel">
                <div className="panelHeader">
                  <div style={{ fontWeight: 600 }}>Constraint adherence</div>
                </div>
                <div className="panelBody">
                  {!run.constraintAdherence && <div className="subtle">No adherence report available.</div>}
                  {run.constraintAdherence && (
                    <div className="constraintCard">
                      <div className="row" style={{ justifyContent: "space-between" }}>
                        <span className={constraintBadgeClass(run.constraintAdherence.status)}>{run.constraintAdherence.status}</span>
                        <span className="subtle mono">{formatTime(run.constraintAdherence.checkedAt)}</span>
                      </div>
                      <div className="constraintStats">
                        <div className="constraintStat constraintFail">
                          <div className="constraintStatValue mono">{run.constraintAdherence.failureCount}</div>
                          <div className="subtle">failures</div>
                        </div>
                        <div className="constraintStat constraintWarn">
                          <div className="constraintStatValue mono">{run.constraintAdherence.warningCount}</div>
                          <div className="subtle">warnings</div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="panel">
                <div className="panelHeader">
                  <div style={{ fontWeight: 600 }}>Constraint diagnostics</div>
                </div>
                <div className="panelBody">
                  {constraintReportBusy && <div className="subtle">Loading diagnostics…</div>}
                  {!constraintReportBusy && !constraintReport && !constraintReportErr && (
                    <div className="subtle">No diagnostics artifact yet.</div>
                  )}
                  {constraintReportErr && <span className="badge badgeErr">{constraintReportErr}</span>}

                  {constraintReport && (
                    <div className="diagnosticsWrap">
                      <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
                        <span className={constraintBadgeClass(constraintReport.status)}>{constraintReport.status}</span>
                        <span className="subtle mono">{formatTime(constraintReport.checked_at)}</span>
                      </div>

                      <details className="diagnosticDetails" open={constraintReport.failures.length > 0}>
                        <summary>Failures ({constraintReport.failures.length})</summary>
                        {constraintReport.failures.length === 0 ? (
                          <div className="subtle">none</div>
                        ) : (
                          <ul className="diagnosticList">
                            {constraintReport.failures.map((item, idx) => (
                              <li key={`f-${idx}`}>{item}</li>
                            ))}
                          </ul>
                        )}
                      </details>

                      <details className="diagnosticDetails" open={constraintReport.warnings.length > 0}>
                        <summary>Warnings ({constraintReport.warnings.length})</summary>
                        {constraintReport.warnings.length === 0 ? (
                          <div className="subtle">none</div>
                        ) : (
                          <ul className="diagnosticList">
                            {constraintReport.warnings.map((item, idx) => (
                              <li key={`w-${idx}`}>{item}</li>
                            ))}
                          </ul>
                        )}
                      </details>

                      <details className="diagnosticDetails">
                        <summary>Rule drilldown</summary>
                        <div className="diagnosticKv">
                          <div>required rules checked</div>
                          <div className="mono">{constraintReport.details.required_style_rules_checked}</div>
                          <div>required rule hits</div>
                          <div className="mono">{constraintReport.details.required_style_rule_hits}</div>
                          <div>forbidden style hits</div>
                          <div className="mono">{constraintReport.details.forbidden_style_hits.length}</div>
                        </div>
                        {constraintReport.details.forbidden_style_hits.length > 0 && (
                          <ul className="diagnosticList">
                            {constraintReport.details.forbidden_style_hits.map((hit, idx) => (
                              <li key={`forbid-${idx}`}>{hit}</li>
                            ))}
                          </ul>
                        )}
                      </details>

                      <details className="diagnosticDetails">
                        <summary>Canonical character match</summary>
                        <div className="diagnosticKv">
                          <div>canonical characters</div>
                          <div className="mono">{constraintReport.details.canonical_characters.length}</div>
                          <div>matched</div>
                          <div className="mono">{constraintReport.details.matched_story_characters.length}</div>
                          <div>missing</div>
                          <div className="mono">{constraintReport.details.missing_story_characters.length}</div>
                        </div>
                        {constraintReport.details.missing_story_characters.length > 0 && (
                          <ul className="diagnosticList">
                            {constraintReport.details.missing_story_characters.map((name, idx) => (
                              <li key={`missing-${idx}`}>{name}</li>
                            ))}
                          </ul>
                        )}
                      </details>

                      {constraintReport.details.semantic_similarity && (
                        <details className="diagnosticDetails">
                          <summary>Semantic repetition guard</summary>
                          <div className="diagnosticKv">
                            <div>closest run</div>
                            <div className="mono">{constraintReport.details.semantic_similarity.closest_run_id}</div>
                            <div>score</div>
                            <div className="mono">{constraintReport.details.semantic_similarity.score.toFixed(3)}</div>
                            <div>threshold</div>
                            <div className="mono">{constraintReport.details.semantic_similarity.threshold.toFixed(3)}</div>
                            <div>retried</div>
                            <div className="mono">{constraintReport.details.semantic_similarity.retried ? "yes" : "no"}</div>
                          </div>
                        </details>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
