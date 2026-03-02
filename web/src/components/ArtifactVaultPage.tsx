import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArtifactInfo, fetchArtifact, listArtifacts } from "../api";
import ArtifactList from "./ArtifactList";
import ArtifactViewer from "./ArtifactViewer";

type ArtifactFolderFilter = "all" | "root" | "intermediate" | "final";
const FOLDER_CHIPS: Array<{ key: ArtifactFolderFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "final", label: "Final" },
  { key: "intermediate", label: "Intermediate" },
  { key: "root", label: "Root" }
];

function stepOrderKey(name: string): number {
  const order = ["run.json", "trace.json"];
  const idx = order.indexOf(name);
  return idx === -1 ? 999 : idx;
}

export default function ArtifactVaultPage() {
  const { runId } = useParams<{ runId: string }>();
  const safeRunId = runId ?? "";
  const [artifacts, setArtifacts] = useState<ArtifactInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [folderFilter, setFolderFilter] = useState<ArtifactFolderFilter>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");

  async function loadArtifacts() {
    if (!safeRunId) return;
    setBusy(true);
    setErr(null);
    try {
      const next = await listArtifacts(safeRunId);
      next.sort((x, y) => {
        const k1 = stepOrderKey(x.name);
        const k2 = stepOrderKey(y.name);
        if (k1 !== k2) return k1 - k2;
        return y.mtimeMs - x.mtimeMs;
      });
      setArtifacts(next);
      if (!selected && next.length > 0) {
        setSelected(next[0]!.name);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function loadArtifact(name: string) {
    if (!safeRunId) return;
    setSelected(name);
    setContent("Loading...");
    try {
      const { text } = await fetchArtifact(safeRunId, name);
      setContent(text);
    } catch (e) {
      setContent(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    setArtifacts([]);
    setSelected(null);
    setContent("");
    setErr(null);
    void loadArtifacts();
  }, [safeRunId]);

  useEffect(() => {
    if (!selected) return;
    void loadArtifact(selected);
  }, [selected]);

  const visibleArtifacts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return artifacts.filter((a) => {
      if (folderFilter !== "all" && (a.folder ?? "intermediate") !== folderFilter) return false;
      if (!q) return true;
      return a.name.toLowerCase().includes(q);
    });
  }, [artifacts, query, folderFilter]);

  const folderCounts = useMemo(() => {
    const counts: Record<Exclude<ArtifactFolderFilter, "all">, number> = {
      root: 0,
      intermediate: 0,
      final: 0
    };
    for (const artifact of artifacts) {
      const key = artifact.folder ?? "intermediate";
      counts[key] += 1;
    }
    return counts;
  }, [artifacts]);

  const selectedArtifact = useMemo(() => artifacts.find((item) => item.name === selected) ?? null, [artifacts, selected]);

  return (
    <div className="panel artifactVaultCard artifactVaultFigma">
      <div className="panelHeader">
        <div>
          <h2 className="sectionTitle sectionTitleGradient">Artifact vault</h2>
          <p className="subtle mono">{safeRunId || "-"}</p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Link className="buttonLink" to={`/runs/${safeRunId}`}>
            Back to run
          </Link>
          <button onClick={() => void loadArtifacts()} disabled={busy}>
            {busy ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>
      <div className="panelBody">
        <div className="statusChipRow artifactFolderChipRow">
          {FOLDER_CHIPS.map((item) => {
            const active = folderFilter === item.key;
            const count = item.key === "all" ? artifacts.length : folderCounts[item.key];
            return (
              <button
                key={item.key}
                type="button"
                className={`statusChip ${active ? "statusChipActive" : ""}`}
                onClick={() => setFolderFilter(item.key)}
              >
                <span>{item.label}</span>
                <span className="statusChipCount mono">{count}</span>
              </button>
            );
          })}
        </div>

        <div className="artifactVaultStats">
          <div className="artifactVaultStat">
            <div className="metaKey">visible</div>
            <div className="mono">{visibleArtifacts.length}</div>
          </div>
          <div className="artifactVaultStat">
            <div className="metaKey">all artifacts</div>
            <div className="mono">{artifacts.length}</div>
          </div>
          <div className="artifactVaultStat artifactVaultStatWide">
            <div className="metaKey">selected</div>
            <div className="mono">{selectedArtifact ? `${selectedArtifact.name} (${selectedArtifact.folder ?? "intermediate"})` : "none"}</div>
          </div>
        </div>

        <div className="artifactFilterBar">
          <input
            aria-label="Artifact vault search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search artifacts…"
          />
          <select
            aria-label="Artifact vault folder filter"
            value={folderFilter}
            onChange={(e) => setFolderFilter(e.target.value as ArtifactFolderFilter)}
          >
            <option value="all">All folders</option>
            <option value="root">Root</option>
            <option value="final">Final</option>
            <option value="intermediate">Intermediate</option>
          </select>
        </div>

        {err && <span className="badge badgeErr">{err}</span>}

        <div className="row artifactVaultActions" style={{ gap: 8 }}>
          <Link className="badge badgeLinkCta" to={safeRunId ? `/runs/${safeRunId}` : "/runs"}>
            Run detail
          </Link>
          <Link className="badge" to={safeRunId ? `/runs/${safeRunId}/workshop` : "/runs"}>
            Workshop
          </Link>
        </div>

        <div className="split runArtifactSplit">
          <ArtifactList
            artifacts={visibleArtifacts}
            selected={selected}
            onSelect={(name) => {
              void loadArtifact(name);
            }}
            emptyMessage={busy ? "Loading artifacts..." : "No artifacts match current filters."}
          />
          <div>{selected ? <ArtifactViewer name={selected} content={content} /> : <div className="subtle">Select an artifact to view.</div>}</div>
        </div>
      </div>
    </div>
  );
}
