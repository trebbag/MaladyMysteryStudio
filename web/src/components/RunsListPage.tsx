import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { listRuns, RunListItem } from "../api";

function formatTime(iso?: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function formatDuration(startedAt: string, finishedAt?: string): string {
  const start = Date.parse(startedAt);
  const end = finishedAt ? Date.parse(finishedAt) : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return "-";
  const seconds = Math.max(1, Math.round((end - start) / 1000));
  const minutes = Math.floor(seconds / 60);
  const remain = seconds % 60;
  return minutes > 0 ? `${minutes}m ${remain}s` : `${seconds}s`;
}

function statusClass(status: RunListItem["status"]): string {
  if (status === "done") return "badge badgeOk";
  if (status === "error") return "badge badgeErr";
  if (status === "paused") return "badge badgeWarn";
  return "badge";
}

const STATUS_CHIPS: Array<{ key: RunListItem["status"]; label: string }> = [
  { key: "running", label: "Active" },
  { key: "paused", label: "Paused" },
  { key: "done", label: "Done" },
  { key: "error", label: "Errors" }
];

export default function RunsListPage() {
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<RunListItem["status"] | "all">("all");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function loadRuns() {
    setBusy(true);
    setErr(null);
    try {
      const items = await listRuns();
      setRuns(items);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void loadRuns();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return runs.filter((run) => {
      if (statusFilter !== "all" && run.status !== statusFilter) return false;
      if (!q) return true;
      return run.topic.toLowerCase().includes(q) || run.runId.toLowerCase().includes(q);
    });
  }, [runs, query, statusFilter]);

  const statusCounts = useMemo(() => {
    const counts: Record<RunListItem["status"], number> = {
      queued: 0,
      running: 0,
      paused: 0,
      done: 0,
      error: 0
    };
    for (const run of runs) counts[run.status] += 1;
    return counts;
  }, [runs]);

  return (
    <div className="panel runsPageCard runsCardFigma">
      <div className="panelHeader">
        <div>
          <h2 className="sectionTitle sectionTitleGradient">Case Archive</h2>
          <p className="subtle">{runs.length} investigations on record.</p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Link className="buttonLink" to="/">
            New run
          </Link>
          <button onClick={() => void loadRuns()} disabled={busy}>
            {busy ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      <div className="panelBody">
        <div className="statusChipRow">
          {STATUS_CHIPS.map((item) => {
            const active = statusFilter === item.key;
            const count = statusCounts[item.key] ?? 0;
            return (
              <button
                key={item.key}
                type="button"
                className={`statusChip ${active ? "statusChipActive" : ""}`}
                onClick={() => setStatusFilter(active ? "all" : item.key)}
              >
                <span>{item.label}</span>
                <span className="statusChipCount mono">{count}</span>
              </button>
            );
          })}
        </div>

        <div className="runsFilters">
          <input
            aria-label="Runs search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by topic or run ID"
          />
          <select
            aria-label="Runs status filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as RunListItem["status"] | "all")}
          >
            <option value="all">All statuses</option>
            <option value="queued">queued</option>
            <option value="running">running</option>
            <option value="paused">paused</option>
            <option value="done">done</option>
            <option value="error">error</option>
          </select>
        </div>

        {err && <span className="badge badgeErr">{err}</span>}
        {!err && busy && filtered.length === 0 && <div className="subtle">Loading runs…</div>}

        {!busy && filtered.length === 0 ? (
          <div className="subtle">No runs match current filters.</div>
        ) : (
          <div className="runsTableWrap">
            <div className="runsTableHeader">
              <span>Topic</span>
              <span>Status</span>
              <span>Started</span>
              <span>Duration</span>
              <span />
            </div>
            {filtered.map((run) => (
              <div key={run.runId} className="runsTableRow">
                <div>
                  <div className="runRowTopic">{run.topic}</div>
                  <div className="mono subtle">{run.runId}</div>
                </div>
                <span className={statusClass(run.status)}>{run.status}</span>
                <span className="mono subtle">{formatTime(run.startedAt)}</span>
                <span className="mono subtle">{formatDuration(run.startedAt, run.finishedAt)}</span>
                <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
                  <Link className="badge badgeLinkCta" to={`/runs/${run.runId}`}>
                    Open
                  </Link>
                  <Link className="badge" to={`/runs/${run.runId}/workshop`}>
                    Workshop
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
