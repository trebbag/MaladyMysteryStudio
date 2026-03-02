import { StepStatus } from "../api";

const LEGACY_ORDER = ["KB0", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P"];

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

const V2_AGENT_ORDER = [
  "KB0",
  "A1",
  "A2",
  "B1",
  "C1",
  "C2",
  "C3",
  "C4",
  "C5",
  "C6",
  "C7",
  "C8",
  "C9",
  "C10"
];

const V2_AGENT_LABELS: Record<string, string> = {
  KB0: "KB Compiler",
  A1: "Disease Research Desk",
  A2: "Episode Pitch Builder",
  B1: "Truth Model Engineer",
  C1: "Differential Cast Director",
  C2: "Clue Architect",
  C3: "Plot Director DeckSpec",
  C4: "Reader Simulator",
  C5: "Medical Fact Checker",
  C6: "QA Loop + Semantic Gate",
  C7: "Micro World Mapper",
  C8: "Drama Architect",
  C9: "Setpiece Choreographer",
  C10: "Final Packager"
};

type TimelineStageStatus = {
  status: "queued" | "running" | "done" | "error";
  startedAt?: string;
  finishedAt?: string;
  error?: string;
};

type TimelineStage = {
  code: string;
  label: string;
  state: TimelineStageStatus;
};

const V2_PACKAGING_ARTIFACTS = [
  "V2_MAIN_DECK_RENDER_PLAN.md",
  "V2_APPENDIX_RENDER_PLAN.md",
  "V2_SPEAKER_NOTES_WITH_CITATIONS.md",
  "v2_template_registry.json",
  "V2_PACKAGING_SUMMARY.json"
];

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

function isStuckStep(s: TimelineStageStatus | undefined, nowMs: number, stuckThresholdMs: number): boolean {
  if (!s || s.status !== "running") return false;
  const startedMs = parseIsoMs(s.startedAt);
  if (startedMs === null) return false;
  return nowMs - startedMs >= stuckThresholdMs;
}

function dotClass(s: TimelineStageStatus | undefined, stuck: boolean, recovered: boolean, slow: boolean): string {
  if (stuck) return "dot dotStuck";
  if (recovered) return "dot dotRecovered";
  if (slow) return "dot dotSlow";
  if (!s) return "dot";
  if (s.status === "running") return "dot dotRunning";
  if (s.status === "done") return "dot dotDone";
  if (s.status === "error") return "dot dotErr";
  return "dot";
}

function fromStep(step: StepStatus | undefined): TimelineStageStatus {
  if (!step) return { status: "queued" };
  return {
    status: step.status,
    startedAt: step.startedAt,
    finishedAt: step.finishedAt,
    error: step.error
  };
}

function toState(args: {
  done: boolean;
  running: boolean;
  error: boolean;
  startedAt?: string;
  finishedAt?: string;
  errorMessage?: string;
}): TimelineStageStatus {
  if (args.done) return { status: "done", startedAt: args.startedAt, finishedAt: args.finishedAt };
  if (args.error) return { status: "error", startedAt: args.startedAt, finishedAt: args.finishedAt, error: args.errorMessage };
  if (args.running) return { status: "running", startedAt: args.startedAt };
  return { status: "queued" };
}

function buildV2Stages(
  steps: Record<string, StepStatus>,
  artifacts: Array<{ name: string }>
): TimelineStage[] {
  const names = new Set(artifacts.map((a) => a.name));
  const has = (name: string): boolean => names.has(name);

  const kb0 = steps.KB0;
  const stepA = steps.A;
  const stepB = steps.B;
  const stepC = steps.C;

  const cRunning = stepC?.status === "running";
  const cError = stepC?.status === "error";
  const cStartedAt = stepC?.startedAt;
  const cFinishedAt = stepC?.finishedAt;

  const diseaseDone = has("disease_dossier.json") || stepA?.status === "done";
  const pitchDone = has("episode_pitch.json") || stepA?.status === "done";
  const truthDone = has("truth_model.json") || stepB?.status === "done";
  const differentialDone = has("differential_cast.json");
  const clueDone = has("clue_graph.json");
  const deckDone = has("deck_spec.json") || has("deck_spec_seed.json");
  const readerDone = has("reader_sim_report.json");
  const medDone = has("med_factcheck_report.json");
  const qaDone = has("qa_report.json") && has("semantic_acceptance_report.json");
  const microWorldDone = has("micro_world_map.json");
  const dramaDone = has("drama_plan.json");
  const setpieceDone = has("setpiece_plan.json");
  const packagingDone = V2_PACKAGING_ARTIFACTS.every((name) => has(name));

  return [
    {
      code: "KB0",
      label: V2_AGENT_LABELS.KB0,
      state: fromStep(kb0)
    },
    {
      code: "A1",
      label: V2_AGENT_LABELS.A1,
      state: toState({
        done: diseaseDone,
        running: stepA?.status === "running" && !diseaseDone,
        error: stepA?.status === "error" && !diseaseDone,
        startedAt: stepA?.startedAt,
        finishedAt: stepA?.finishedAt,
        errorMessage: stepA?.error
      })
    },
    {
      code: "A2",
      label: V2_AGENT_LABELS.A2,
      state: toState({
        done: pitchDone,
        running: stepA?.status === "running" && diseaseDone && !pitchDone,
        error: stepA?.status === "error" && !pitchDone,
        startedAt: stepA?.startedAt,
        finishedAt: stepA?.finishedAt,
        errorMessage: stepA?.error
      })
    },
    {
      code: "B1",
      label: V2_AGENT_LABELS.B1,
      state: toState({
        done: truthDone,
        running: stepB?.status === "running" && !truthDone,
        error: stepB?.status === "error" && !truthDone,
        startedAt: stepB?.startedAt,
        finishedAt: stepB?.finishedAt,
        errorMessage: stepB?.error
      })
    },
    {
      code: "C1",
      label: V2_AGENT_LABELS.C1,
      state: toState({
        done: differentialDone,
        running: cRunning && !differentialDone,
        error: cError && !differentialDone,
        startedAt: cStartedAt,
        finishedAt: cFinishedAt,
        errorMessage: stepC?.error
      })
    },
    {
      code: "C2",
      label: V2_AGENT_LABELS.C2,
      state: toState({
        done: clueDone,
        running: cRunning && differentialDone && !clueDone,
        error: cError && !clueDone,
        startedAt: cStartedAt,
        finishedAt: cFinishedAt,
        errorMessage: stepC?.error
      })
    },
    {
      code: "C3",
      label: V2_AGENT_LABELS.C3,
      state: toState({
        done: deckDone,
        running: cRunning && clueDone && !deckDone,
        error: cError && !deckDone,
        startedAt: cStartedAt,
        finishedAt: cFinishedAt,
        errorMessage: stepC?.error
      })
    },
    {
      code: "C4",
      label: V2_AGENT_LABELS.C4,
      state: toState({
        done: readerDone,
        running: cRunning && deckDone && !readerDone,
        error: cError && !readerDone,
        startedAt: cStartedAt,
        finishedAt: cFinishedAt,
        errorMessage: stepC?.error
      })
    },
    {
      code: "C5",
      label: V2_AGENT_LABELS.C5,
      state: toState({
        done: medDone,
        running: cRunning && deckDone && !medDone,
        error: cError && !medDone,
        startedAt: cStartedAt,
        finishedAt: cFinishedAt,
        errorMessage: stepC?.error
      })
    },
    {
      code: "C6",
      label: V2_AGENT_LABELS.C6,
      state: toState({
        done: qaDone,
        running: cRunning && (readerDone || medDone) && !qaDone,
        error: cError && !qaDone,
        startedAt: cStartedAt,
        finishedAt: cFinishedAt,
        errorMessage: stepC?.error
      })
    },
    {
      code: "C7",
      label: V2_AGENT_LABELS.C7,
      state: toState({
        done: microWorldDone,
        running: cRunning && qaDone && !microWorldDone,
        error: cError && !microWorldDone,
        startedAt: cStartedAt,
        finishedAt: cFinishedAt,
        errorMessage: stepC?.error
      })
    },
    {
      code: "C8",
      label: V2_AGENT_LABELS.C8,
      state: toState({
        done: dramaDone,
        running: cRunning && microWorldDone && !dramaDone,
        error: cError && !dramaDone,
        startedAt: cStartedAt,
        finishedAt: cFinishedAt,
        errorMessage: stepC?.error
      })
    },
    {
      code: "C9",
      label: V2_AGENT_LABELS.C9,
      state: toState({
        done: setpieceDone,
        running: cRunning && dramaDone && !setpieceDone,
        error: cError && !setpieceDone,
        startedAt: cStartedAt,
        finishedAt: cFinishedAt,
        errorMessage: stepC?.error
      })
    },
    {
      code: "C10",
      label: V2_AGENT_LABELS.C10,
      state: toState({
        done: packagingDone,
        running: cRunning && setpieceDone && !packagingDone,
        error: cError && !packagingDone,
        startedAt: cStartedAt,
        finishedAt: cFinishedAt,
        errorMessage: stepC?.error
      })
    }
  ];
}

export default function StepTimeline({
  steps,
  workflow = "legacy",
  artifacts = [],
  nowMs = Date.now(),
  stuckThresholdMs = 90_000,
  recoveredSteps = [],
  slowSteps = []
}: {
  steps: Record<string, StepStatus>;
  workflow?: string;
  artifacts?: Array<{ name: string }>;
  nowMs?: number;
  stuckThresholdMs?: number;
  recoveredSteps?: string[];
  slowSteps?: string[];
}) {
  const stages: TimelineStage[] =
    workflow === "v2_micro_detectives"
      ? buildV2Stages(steps, artifacts)
      : LEGACY_ORDER.map((code) => ({ code, label: LABELS[code] ?? code, state: fromStep(steps[code]) }));
  const order = workflow === "v2_micro_detectives" ? V2_AGENT_ORDER : LEGACY_ORDER;
  const stagesByCode = new Map(stages.map((stage) => [stage.code, stage]));
  const recoveredSet = new Set(recoveredSteps);
  const slowSet = new Set(slowSteps);
  const completedCount = order.filter((name) => stagesByCode.get(name)?.state.status === "done").length;
  const errorStep = order.find((name) => stagesByCode.get(name)?.state.status === "error");
  const runningStep = order.find((name) => stagesByCode.get(name)?.state.status === "running");
  const stuckStep = order.find((name) => isStuckStep(stagesByCode.get(name)?.state, nowMs, stuckThresholdMs));
  const slowStep = order.find((name) => slowSet.has(name));
  const recoveredStep = order.find((name) => recoveredSet.has(name));
  const stuckElapsedMs =
    stuckStep && stagesByCode.get(stuckStep)?.state.startedAt
      ? Math.max(0, nowMs - (parseIsoMs(stagesByCode.get(stuckStep)?.state.startedAt) ?? nowMs))
      : 0;
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
            const stage = stagesByCode.get(name);
            const s = stage?.state;
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
                  <span className="stepLabel">{stage?.label ?? name}</span>
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
