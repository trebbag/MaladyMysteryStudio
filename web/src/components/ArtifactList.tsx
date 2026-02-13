import { ArtifactInfo } from "../api";

function formatAge(ms: number): string {
  const delta = Date.now() - ms;
  if (delta < 60_000) return "just now";
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function fileIcon(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".json")) return "{}";
  if (lower.endsWith(".md")) return "MD";
  return "TXT";
}

type ArtifactGroupKey = "root" | "final" | "intermediate";

function groupKey(folder?: ArtifactInfo["folder"]): ArtifactGroupKey {
  if (folder === "root") return "root";
  if (folder === "final") return "final";
  return "intermediate";
}

function groupLabel(key: ArtifactGroupKey): string {
  if (key === "root") return "Run metadata";
  if (key === "final") return "Final products";
  return "Intermediate artifacts";
}

export default function ArtifactList({
  artifacts,
  selected,
  onSelect,
  emptyMessage = "No artifacts yet."
}: {
  artifacts: ArtifactInfo[];
  selected: string | null;
  onSelect: (name: string) => void;
  emptyMessage?: string;
}) {
  if (artifacts.length === 0) return <div className="subtle">{emptyMessage}</div>;

  const groups: Record<ArtifactGroupKey, ArtifactInfo[]> = { root: [], final: [], intermediate: [] };
  for (const artifact of artifacts) {
    groups[groupKey(artifact.folder)].push(artifact);
  }
  const orderedGroups: ArtifactGroupKey[] = ["root", "final", "intermediate"];

  return (
    <div className="artifactGroups">
      {orderedGroups
        .filter((key) => groups[key].length > 0)
        .map((key) => (
          <section key={key} className="artifactGroup">
            <div className="artifactGroupTitle subtle">{groupLabel(key)}</div>
            <div className="list artifactRows">
              {groups[key].map((a) => {
                const isActive = selected === a.name;
                return (
                  <button
                    key={a.name}
                    className={`listItem artifactRowButton ${isActive ? "listItemActive" : ""}`}
                    onClick={() => onSelect(a.name)}
                    title={a.name}
                    role="button"
                  >
                    <div className="artifactIcon mono">{fileIcon(a.name)}</div>
                    <div className="artifactMeta">
                      <div className="mono artifactName">{a.name}</div>
                      <div className="subtle artifactSubMeta">
                        <span>{key}</span>
                        <span>{Math.max(1, Math.round(a.size / 1024))}kb</span>
                        <span>{formatAge(a.mtimeMs)}</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
    </div>
  );
}
