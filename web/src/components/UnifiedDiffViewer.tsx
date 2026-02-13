function diffLineClass(line: string): string {
  if (line.startsWith("@@")) return "diffLine diffHunk";
  if (line.startsWith("+++ ") || line.startsWith("--- ")) return "diffLine diffFile";
  if (line.startsWith("+") && !line.startsWith("+++")) return "diffLine diffAdd";
  if (line.startsWith("-") && !line.startsWith("---")) return "diffLine diffDel";
  return "diffLine";
}

export default function UnifiedDiffViewer({ diff }: { diff: string }) {
  const lines = diff.split("\n");
  return (
    <div className="viewer mono">
      <div className="diffBlock">
        {lines.map((line, i) => (
          <div key={i} className={diffLineClass(line)}>
            {line.length === 0 ? "\u00A0" : line}
          </div>
        ))}
      </div>
    </div>
  );
}

