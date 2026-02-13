import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

function tryPrettyJson(text: string): string {
  try {
    const obj = JSON.parse(text) as unknown;
    return JSON.stringify(obj, null, 2);
  } catch {
    return text;
  }
}

export default function ArtifactViewer({ name, content }: { name: string; content: string }) {
  const lower = name.toLowerCase();
  const [copied, setCopied] = useState(false);

  const normalized = useMemo(() => {
    if (lower.endsWith(".json")) return tryPrettyJson(content);
    return content;
  }, [content, lower]);

  async function onCopy() {
    await navigator.clipboard.writeText(normalized);
    setCopied(true);
    setTimeout(() => setCopied(false), 1300);
  }

  return (
    <div className="viewerWrap">
      <div className="viewerToolbar">
        <div className="mono viewerFileName">{name}</div>
        <button onClick={() => void onCopy()}>{copied ? "Copied" : "Copy"}</button>
      </div>

      {lower.endsWith(".md") ? (
        <div className="viewer viewerMarkdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      ) : (
        <div className="viewer mono">
          <pre style={{ margin: 0 }}>{normalized}</pre>
        </div>
      )}
    </div>
  );
}
