import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  cleanupRuns,
  createRun,
  getRunRetention,
  getSloPolicy,
  HealthResponse,
  listRuns,
  RunListItem,
  RunRetentionAnalytics,
  RunSettings,
  updateSloPolicy
} from "../api";

const STEP_ORDER = ["KB0", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O"] as const;

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  const decimals = value >= 10 ? 1 : 2;
  return `${value.toFixed(decimals)} ${units[idx]}`;
}

function formatAge(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return "<1h";
  if (hours < 24) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

type ChatStartProps = {
  health?: HealthResponse | null;
};

export default function ChatStart({ health }: ChatStartProps) {
  const navigate = useNavigate();
  const [topic, setTopic] = useState<string>("");
  const [durationMinutes, setDurationMinutes] = useState<string>("");
  const [targetSlides, setTargetSlides] = useState<string>("");
  const [level, setLevel] = useState<NonNullable<RunSettings["level"]>>("student");
  const [adherenceMode, setAdherenceMode] = useState<NonNullable<RunSettings["adherenceMode"]>>("strict");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [runsBusy, setRunsBusy] = useState(false);
  const [retentionKeepLast, setRetentionKeepLast] = useState<string>("50");
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [cleanupMsg, setCleanupMsg] = useState<string | null>(null);
  const [cleanupErr, setCleanupErr] = useState<string | null>(null);
  const [retentionAnalytics, setRetentionAnalytics] = useState<RunRetentionAnalytics | null>(null);
  const [sloThresholds, setSloThresholds] = useState<Record<string, string>>({});
  const [sloBounds, setSloBounds] = useState<{ minMs: number; maxMs: number }>({ minMs: 5_000, maxMs: 1_800_000 });
  const [sloBusy, setSloBusy] = useState(false);
  const [sloErr, setSloErr] = useState<string | null>(null);
  const [sloMsg, setSloMsg] = useState<string | null>(null);

  async function loadRuns() {
    setRunsBusy(true);
    try {
      const r = await listRuns();
      setRuns(r);
    } catch {
      // keep screen usable when listing runs fails
    } finally {
      setRunsBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setRunsBusy(true);
      try {
        const r = await listRuns();
        if (!cancelled) setRuns(r);
      } catch {
        // ignore list failures in home page
      } finally {
        if (!cancelled) setRunsBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const retention = await getRunRetention();
        if (!cancelled) {
          setRetentionKeepLast(String(retention.policy.keepLastTerminalRuns));
          setRetentionAnalytics(retention.analytics);
        }
      } catch {
        // keep default fallback when retention endpoint fails
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const policy = await getSloPolicy();
        if (cancelled) return;
        setSloBounds(policy.bounds);
        setSloThresholds(
          Object.fromEntries(STEP_ORDER.map((step) => [step, String(policy.policy.thresholdsMs[step] ?? policy.defaults[step] ?? 90_000)]))
        );
      } catch (e) {
        if (!cancelled) setSloErr(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  function buildSettings(): RunSettings {
    const s: RunSettings = {};
    const dur = Number(durationMinutes);
    if (durationMinutes.trim().length > 0 && Number.isFinite(dur) && dur > 0) {
      s.durationMinutes = Math.round(dur);
    }

    const slides = Number(targetSlides);
    if (targetSlides.trim().length > 0 && Number.isFinite(slides) && slides > 0) {
      s.targetSlides = Math.round(slides);
    }

    s.level = level;
    s.adherenceMode = adherenceMode;
    return s;
  }

  async function onRun() {
    setErr(null);
    setBusy(true);
    try {
      const res = await createRun(topic.trim(), buildSettings());
      navigate(`/runs/${res.runId}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onCleanup(dryRun: boolean) {
    setCleanupErr(null);
    setCleanupMsg(null);
    setCleanupBusy(true);
    const keepLastRaw = Number(retentionKeepLast);
    const keepLast = Number.isFinite(keepLastRaw) ? Math.max(0, Math.round(keepLastRaw)) : 0;
    try {
      const res = await cleanupRuns(keepLast, dryRun);
      setRetentionAnalytics(res.analytics);
      if (dryRun) {
        setCleanupMsg(
          `Preview: would delete ${res.deletedRunIds.length} terminal run(s), keep ${res.keptRunIds.length}. Reclaim ${formatBytes(
            res.reclaimedBytes
          )}.`
        );
      } else {
        setCleanupMsg(`Deleted ${res.deletedRunIds.length} terminal run(s), reclaimed ${formatBytes(res.reclaimedBytes)}.`);
        await loadRuns();
      }
    } catch (e) {
      setCleanupErr(e instanceof Error ? e.message : String(e));
    } finally {
      setCleanupBusy(false);
    }
  }

  function updateThreshold(step: string, raw: string) {
    setSloThresholds((prev) => ({ ...prev, [step]: raw }));
  }

  async function onSaveSloPolicy() {
    setSloErr(null);
    setSloMsg(null);
    setSloBusy(true);
    try {
      const thresholds: Partial<Record<string, number>> = {};
      for (const step of STEP_ORDER) {
        const raw = Number(sloThresholds[step] ?? "");
        if (!Number.isFinite(raw)) continue;
        thresholds[step] = Math.max(sloBounds.minMs, Math.min(sloBounds.maxMs, Math.round(raw)));
      }
      const updated = await updateSloPolicy({ thresholdsMs: thresholds });
      setSloBounds(updated.bounds);
      setSloThresholds(Object.fromEntries(STEP_ORDER.map((step) => [step, String(updated.policy.thresholdsMs[step])])) as Record<string, string>);
      setSloMsg("Step SLO policy saved.");
    } catch (e) {
      setSloErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSloBusy(false);
    }
  }

  async function onResetSloPolicy() {
    setSloErr(null);
    setSloMsg(null);
    setSloBusy(true);
    try {
      const updated = await updateSloPolicy({ reset: true });
      setSloBounds(updated.bounds);
      setSloThresholds(Object.fromEntries(STEP_ORDER.map((step) => [step, String(updated.policy.thresholdsMs[step])])) as Record<string, string>);
      setSloMsg("Step SLO policy reset to defaults.");
    } catch (e) {
      setSloErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSloBusy(false);
    }
  }

  const largestRuns = retentionAnalytics?.perRun.slice(0, 5) ?? [];

  return (
    <div className="homeGrid">
      <section className="panel homeStartCard">
        <div className="panelHeader">
          <div>
            <h2 className="sectionTitle">Start New Episode</h2>
            <p className="subtle">Launch KB0 to O and monitor every handoff in real time.</p>
          </div>
        </div>

        <div className="panelBody">
          <label htmlFor="topic" className="fieldLabel">
            Topic
          </label>
          <textarea
            id="topic"
            className="topicComposer"
            value={topic}
            placeholder='Example: "Diabetic ketoacidosis (DKA) diagnosis and initial management"'
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void onRun();
              }
            }}
          />

          <div className="settingsBlock">
            <div className="settingsBlockHeader">
              <div style={{ fontWeight: 600 }}>Run settings</div>
              <div className="subtle">Passed into Producer (A)</div>
            </div>

            <div className="settingsRow">
              <div>
                <div className="subtle">Duration (minutes)</div>
                <input
                  type="number"
                  min={5}
                  max={240}
                  value={durationMinutes}
                  placeholder="e.g. 20"
                  onChange={(e) => setDurationMinutes(e.target.value)}
                />
              </div>

              <div>
                <div className="subtle">Target slides</div>
                <input
                  type="number"
                  min={5}
                  max={200}
                  value={targetSlides}
                  placeholder="e.g. 12"
                  onChange={(e) => setTargetSlides(e.target.value)}
                />
              </div>

              <div>
                <div className="subtle">Level</div>
                <select value={level} onChange={(e) => setLevel(e.target.value as NonNullable<RunSettings["level"]>)}>
                  <option value="pcp">PCP</option>
                  <option value="student">Student</option>
                </select>
              </div>

              <div>
                <div className="subtle">Adherence mode</div>
                <select
                  value={adherenceMode}
                  onChange={(e) => setAdherenceMode(e.target.value as NonNullable<RunSettings["adherenceMode"]>)}
                >
                  <option value="strict">Strict (block on fail)</option>
                  <option value="warn">Warn-only (do not block)</option>
                </select>
              </div>
            </div>
          </div>

          <div className="row" style={{ marginTop: 14, justifyContent: "space-between", flexWrap: "wrap" }}>
            <button disabled={busy || topic.trim().length < 3} onClick={() => void onRun()}>
              {busy ? "Starting..." : "Run Episode"}
            </button>
            {err && <span className="badge badgeErr">{err}</span>}
          </div>
        </div>
      </section>

      <aside className="panel homeStatusCard">
        <div className="panelHeader">
          <div style={{ fontWeight: 600 }}>System status</div>
        </div>
        <div className="panelBody">
          {!health && <div className="subtle">Checking configuration…</div>}

          {health && (
            <div className="statusRows">
              <div className="statusRow">
                <span>API key</span>
                <span className={health.hasKey ? "badge badgeOk" : "badge badgeErr"}>{health.hasKey ? "Configured" : "Missing"}</span>
              </div>
              <div className="statusRow">
                <span>Vector store</span>
                <span className={health.hasVectorStoreId ? "badge badgeOk" : "badge badgeErr"}>
                  {health.hasVectorStoreId ? "Connected" : "Missing"}
                </span>
              </div>
              <div className="statusRow">
                <span>Canonical files</span>
                <span className={health.hasCanonicalProfileFiles ? "badge badgeOk" : "badge"}>
                  {health.hasCanonicalProfileFiles ? "Loaded" : "Unavailable"}
                </span>
              </div>
            </div>
          )}
        </div>
      </aside>

      <section className="panel homeRunsCard">
        <div className="panelHeader">
          <div>
            <div style={{ fontWeight: 600 }}>Recent runs</div>
            <div className="subtle">Newest first</div>
          </div>
          <button disabled={runsBusy || cleanupBusy} onClick={() => void loadRuns()}>
            {runsBusy ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <div className="panelBody">
          <div className="retentionControls">
            <label className="subtle" htmlFor="retentionKeepLast">
              Keep latest terminal runs
            </label>
            <div className="row retentionRow">
              <input
                id="retentionKeepLast"
                type="number"
                min={0}
                max={1000}
                value={retentionKeepLast}
                onChange={(e) => setRetentionKeepLast(e.target.value)}
                style={{ width: 120 }}
              />
              <button disabled={cleanupBusy} onClick={() => void onCleanup(true)}>
                {cleanupBusy ? "Working..." : "Preview cleanup"}
              </button>
              <button className="buttonDanger" disabled={cleanupBusy} onClick={() => void onCleanup(false)}>
                {cleanupBusy ? "Working..." : "Delete old runs"}
              </button>
            </div>
            {cleanupMsg && <div className="badge badgeOk">{cleanupMsg}</div>}
            {cleanupErr && <div className="badge badgeErr">{cleanupErr}</div>}

            {retentionAnalytics && (
              <div className="retentionAnalytics">
                <div className="retentionSummaryGrid">
                  <div className="retentionSummaryCard">
                    <div className="subtle">Total disk</div>
                    <div className="mono">{formatBytes(retentionAnalytics.totalSizeBytes)}</div>
                  </div>
                  <div className="retentionSummaryCard">
                    <div className="subtle">Terminal runs</div>
                    <div className="mono">{formatBytes(retentionAnalytics.terminalSizeBytes)}</div>
                  </div>
                  <div className="retentionSummaryCard">
                    <div className="subtle">Active runs</div>
                    <div className="mono">{formatBytes(retentionAnalytics.activeSizeBytes)}</div>
                  </div>
                </div>

                <div className="retentionBuckets">
                  <div className="subtle">Age buckets</div>
                  <div className="retentionBucketRow">
                    <span className="mono">&lt;24h: {retentionAnalytics.ageBuckets.lt_24h.count}</span>
                    <span className="mono">1-7d: {retentionAnalytics.ageBuckets.between_1d_7d.count}</span>
                    <span className="mono">7-30d: {retentionAnalytics.ageBuckets.between_7d_30d.count}</span>
                    <span className="mono">30d+: {retentionAnalytics.ageBuckets.gte_30d.count}</span>
                  </div>
                </div>

                {largestRuns.length > 0 && (
                  <div className="retentionLargestRuns">
                    <div className="subtle">Largest runs</div>
                    <div className="list">
                      {largestRuns.map((row) => (
                        <div key={row.runId} className="listItem runSizeRow">
                          <Link className="mono" to={`/runs/${row.runId}`}>
                            {row.runId}
                          </Link>
                          <span className="mono">{formatBytes(row.sizeBytes)}</span>
                          <span className="subtle">{formatAge(row.ageHours)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {runs.length === 0 ? (
            <div className="subtle">No runs yet.</div>
          ) : (
            <div className="list">
              {runs.map((r) => (
                <Link key={r.runId} to={`/runs/${r.runId}`} className="runRowLink">
                  <div className="listItem runRowItem">
                    <div>
                      <div className="runRowTopic">{r.topic}</div>
                      <div className="subtle mono">{r.runId}</div>
                      <div className="subtle">{formatTime(r.startedAt)}</div>
                    </div>
                    <span className={`badge ${r.status === "done" ? "badgeOk" : r.status === "error" ? "badgeErr" : ""}`}>{r.status}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="panel homeSloCard">
        <div className="panelHeader">
          <div>
            <div style={{ fontWeight: 600 }}>Step SLO policy</div>
            <div className="subtle">Per-step thresholds in milliseconds (persisted in output/slo_policy.json)</div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button disabled={sloBusy} onClick={() => void onSaveSloPolicy()}>
              {sloBusy ? "Saving..." : "Save policy"}
            </button>
            <button disabled={sloBusy} onClick={() => void onResetSloPolicy()}>
              Reset defaults
            </button>
          </div>
        </div>
        <div className="panelBody">
          <div className="subtle" style={{ marginBottom: 10 }}>
            Allowed range: {sloBounds.minMs}ms to {sloBounds.maxMs}ms
          </div>

          <div className="sloGrid">
            {STEP_ORDER.map((step) => (
              <label key={step} className="sloRow" htmlFor={`slo-${step}`}>
                <span className="mono">{step}</span>
                <input
                  id={`slo-${step}`}
                  type="number"
                  min={sloBounds.minMs}
                  max={sloBounds.maxMs}
                  value={sloThresholds[step] ?? ""}
                  onChange={(e) => updateThreshold(step, e.target.value)}
                />
              </label>
            ))}
          </div>

          {sloMsg && <div className="badge badgeOk">{sloMsg}</div>}
          {sloErr && <div className="badge badgeErr">{sloErr}</div>}
        </div>
      </section>
    </div>
  );
}
