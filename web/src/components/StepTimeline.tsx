import { StepStatus } from "../api";

const LEGACY_ORDER = ["KB0", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P"];
const V2_PHASE1_ORDER = ["KB0", "A", "B", "C"];

const LABELS: Record<string, string> = {
  KB0: "KB Compiler",
  A: "Producer",
  B: "Medical Researcher",
  C: "Medical Editor",
  D: "Curriculum Architect",
  E: "Assessment Designer",
  F: "Slide Architect",
  G: "Story Seed",
  H: "Showrunner",
  I: "Visual Director",
  J: "Pacing Editor",
  K: "Mapper",
  L: "Slide Writer",
  M: "QA Suite",
  N: "Patch Applier",
  O: "Genspark Packager",
  P: "Genspark Master Doc"
};

const V2_LABELS: Record<string, string> = {
  KB0: "KB Compiler",
  A: "Disease Dossier + Gate 1",
  B: "Truth Model + Gate 2",
  C: "DeckSpec + QA + Gate 3 + Packaging"
};

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

function isStuckStep(s: StepStatus | undefined, nowMs: number, stuckThresholdMs: number): boolean {
  if (!s || s.status !== "running") return false;
  const startedMs = parseIsoMs(s.startedAt);
  if (startedMs === null) return false;
  return nowMs - startedMs >= stuckThresholdMs;
}

function dotClass(s: StepStatus | undefined, stuck: boolean, recovered: boolean, slow: boolean): string {
  if (stuck) return "dot dotStuck";
  if (recovered) return "dot dotRecovered";
  if (slow) return "dot dotSlow";
  if (!s) return "dot";
  if (s.status === "running") return "dot dotRunning";
  if (s.status === "done") return "dot dotDone";
  if (s.status === "error") return "dot dotErr";
  return "dot";
}

export default function StepTimeline({
  steps,
  workflow = "legacy",
  nowMs = Date.now(),
  stuckThresholdMs = 90_000,
  recoveredSteps = [],
  slowSteps = []
}: {
  steps: Record<string, StepStatus>;
  workflow?: string;
  nowMs?: number;
  stuckThresholdMs?: number;
  recoveredSteps?: string[];
  slowSteps?: string[];
}) {
  const order = workflow === "v2_micro_detectives" ? V2_PHASE1_ORDER : LEGACY_ORDER;
  const labels = workflow === "v2_micro_detectives" ? V2_LABELS : LABELS;
  const recoveredSet = new Set(recoveredSteps);
  const slowSet = new Set(slowSteps);
  const completedCount = order.filter((name) => steps[name]?.status === "done").length;
  const errorStep = order.find((name) => steps[name]?.status === "error");
  const runningStep = order.find((name) => steps[name]?.status === "running");
  const stuckStep = order.find((name) => isStuckStep(steps[name], nowMs, stuckThresholdMs));
  const slowStep = order.find((name) => slowSet.has(name));
  const recoveredStep = order.find((name) => recoveredSet.has(name));
  const stuckElapsedMs =
    stuckStep && steps[stuckStep]?.startedAt ? Math.max(0, nowMs - (parseIsoMs(steps[stuckStep]?.startedAt) ?? nowMs)) : 0;
  const progress = Math.round((completedCount / order.length) * 100);

  return (
    <div className="timelineWrap panel">
      <div className="panelHeader">
        <div>
          <div style={{ fontWeight: 600 }}>Pipeline progress</div>
          <div className="subtle">
            {errorStep
              ? `Error at ${errorStep}`
              : stuckStep
                ? `Possible stall at ${stuckStep} (${formatElapsed(stuckElapsedMs)})`
                : recoveredStep
                  ? `Recovered after stall at ${recoveredStep}`
                : slowStep
                    ? `SLO warning at ${slowStep}`
                : runningStep
                  ? `Running ${runningStep}`
                  : completedCount === order.length
                    ? "Complete"
                    : "In progress"}
          </div>
        </div>
        <div className="timelineStats mono">
          {completedCount}/{order.length} ({progress}%)
        </div>
      </div>

      <div className="panelBody">
        <div className="timelineBarTrack">
          <div
            className={`timelineBarFill ${errorStep ? "timelineBarFillErr" : ""}`}
            style={{ width: `${Math.max(0, Math.min(progress, 100))}%` }}
          />
        </div>

        <div className="stepList stepListGrid">
          {order.map((name) => {
            const s = steps[name];
            const stuck = isStuckStep(s, nowMs, stuckThresholdMs);
            const slow = slowSet.has(name) && !stuck;
            const recovered = recoveredSet.has(name) && !stuck && s?.status !== "error" && s?.status !== "queued";
            const stateText = stuck
              ? "running (stuck)"
              : recovered
                ? `${s?.status ?? "done"} (recovered)`
                : slow && s?.status && s.status !== "queued"
                  ? `${s.status} (slow)`
                  : (s?.status ?? "queued");
            return (
              <div
                key={name}
                className={`step ${stuck ? "stepStuck" : ""} ${recovered ? "stepRecovered" : ""} ${slow ? "stepSlow" : ""}`}
                title={s?.error ? s.error : ""}
              >
                <span className={dotClass(s, stuck, recovered, slow)} />
                <div className="stepMeta">
                  <span className="stepCode">{name}</span>
                  <span className="stepLabel">{labels[name] ?? name}</span>
                </div>
                <span className={`stepState ${stuck ? "stepStateWarn" : ""} ${recovered ? "stepStateRecovered" : ""} ${slow ? "stepStateSlow" : ""}`}>
                  {stateText}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
