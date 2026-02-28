import { Link, useNavigate, useParams } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { createTwoFilesPatch } from "diff";
import {
  cancelRun,
  exportZipUrl,
  fetchArtifact,
  GateHistoryResponse,
  getRun,
  getGateHistory,
  listArtifacts,
  resumeRun,
  rerunFrom,
  RunStatus,
  submitGateReview,
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

type V2DeckSpecSlide = {
  slide_id: string;
  title?: string;
  act_id?: string;
  beat_type?: string;
  template_id?: string;
  visual_description?: string;
  exhibit_ids?: string[];
  on_slide_text?: {
    headline?: string;
    subtitle?: string;
    callouts?: string[];
    labels?: string[];
  };
  story_panel?: {
    goal?: string;
    opposition?: string;
    turn?: string;
    decision?: string;
  };
  medical_payload?: {
    major_concept_id?: string;
    delivery_mode?: string;
    dossier_citations?: Array<{ citation_id?: string; claim?: string }>;
  };
  speaker_notes?: {
    medical_reasoning?: string;
    narrative_notes?: string;
  };
};

type V2DeckSpecPreview = {
  deck_meta?: {
    episode_title?: string;
    deck_length_main?: string;
  };
  slides: V2DeckSpecSlide[];
  appendix_slides: V2DeckSpecSlide[];
};

type V2TemplateRegistryPreview = {
  templates: Array<{
    template_id: string;
    purpose?: string;
    renderer_instructions?: string[];
    allowed_beat_types?: string[];
  }>;
};

type V2ClueGraphPreview = {
  exhibits: Array<{
    exhibit_id: string;
    purpose?: string;
  }>;
};

type V2MicroWorldMapPreview = {
  zones: Array<{
    zone_id: string;
    name?: string;
    anatomic_location?: string;
    resident_actors?: string[];
    environmental_gradients?: string[];
    narrative_motifs?: string[];
  }>;
  hazards: Array<{
    hazard_id: string;
    type?: string;
    description?: string;
    links_to_pathophysiology?: string;
  }>;
  routes: Array<{
    route_id: string;
    from_zone_id?: string;
    to_zone_id?: string;
    mode?: string;
    story_use?: string;
  }>;
};

type V2DramaPlanPreview = {
  character_arcs: Array<{
    character_id?: string;
    name?: string;
    core_need?: string;
    core_fear?: string;
    act_turns?: Array<{
      act_id?: string;
      pressure?: string;
      choice?: string;
      change?: string;
    }>;
  }>;
  relationship_arcs: Array<{
    pair?: string;
    starting_dynamic?: string;
    friction_points?: string[];
    repair_moments?: string[];
    climax_resolution?: string;
  }>;
  pressure_ladder?: Record<string, string[]>;
};

type V2SetpiecePlanPreview = {
  setpieces: Array<{
    setpiece_id: string;
    act_id?: string;
    type?: string;
    location_zone_id?: string;
    story_purpose?: string;
    outcome_turn?: string;
    constraints?: string[];
  }>;
  quotas?: Record<string, boolean>;
};

type V2InspectorTab = "world" | "drama" | "setpieces" | "templates";

type DiffTargetStep = "KB0" | "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J" | "K" | "L" | "M" | "N" | "O" | "P";
type ArtifactFolderFilter = "all" | "root" | "intermediate" | "final";
type SummaryTab = "narrative" | "visual";

const LEGACY_STEP_ORDER: DiffTargetStep[] = ["KB0", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P"];
const V2_PHASE1_STEP_ORDER: DiffTargetStep[] = ["KB0", "A", "B", "C"];
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

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function normalizeV2Slide(value: unknown): V2DeckSpecSlide {
  const row = asRecord(value);
  return {
    slide_id: typeof row.slide_id === "string" ? row.slide_id : "",
    title: typeof row.title === "string" ? row.title : undefined,
    act_id: typeof row.act_id === "string" ? row.act_id : undefined,
    beat_type: typeof row.beat_type === "string" ? row.beat_type : undefined,
    template_id: typeof row.template_id === "string" ? row.template_id : undefined,
    visual_description: typeof row.visual_description === "string" ? row.visual_description : undefined,
    exhibit_ids: asStringArray(row.exhibit_ids),
    on_slide_text: asRecord(row.on_slide_text),
    story_panel: asRecord(row.story_panel),
    medical_payload: asRecord(row.medical_payload),
    speaker_notes: asRecord(row.speaker_notes)
  };
}

function normalizeV2DeckSpec(value: unknown): V2DeckSpecPreview {
  const root = asRecord(value);
  const slides = Array.isArray(root.slides) ? root.slides.map(normalizeV2Slide).filter((slide) => slide.slide_id.length > 0) : [];
  const appendixSlides = Array.isArray(root.appendix_slides)
    ? root.appendix_slides.map(normalizeV2Slide).filter((slide) => slide.slide_id.length > 0)
    : [];
  if (slides.length === 0 && appendixSlides.length === 0) {
    throw new Error("deck_spec.json has no slide records.");
  }
  return {
    deck_meta: asRecord(root.deck_meta),
    slides,
    appendix_slides: appendixSlides
  };
}

function normalizeV2TemplateRegistry(value: unknown): V2TemplateRegistryPreview {
  const root = asRecord(value);
  const templates = Array.isArray(root.templates)
    ? root.templates
        .map((row) => {
          const rec = asRecord(row);
          return {
            template_id: typeof rec.template_id === "string" ? rec.template_id : "",
            purpose: typeof rec.purpose === "string" ? rec.purpose : undefined,
            renderer_instructions: asStringArray(rec.renderer_instructions),
            allowed_beat_types: asStringArray(rec.allowed_beat_types)
          };
        })
        .filter((row) => row.template_id.length > 0)
    : [];
  return { templates };
}

function normalizeV2ClueGraph(value: unknown): V2ClueGraphPreview {
  const root = asRecord(value);
  const exhibits = Array.isArray(root.exhibits)
    ? root.exhibits
        .map((row) => {
          const rec = asRecord(row);
          return {
            exhibit_id: typeof rec.exhibit_id === "string" ? rec.exhibit_id : "",
            purpose: typeof rec.purpose === "string" ? rec.purpose : undefined
          };
        })
        .filter((row) => row.exhibit_id.length > 0)
    : [];
  return { exhibits };
}

function normalizeV2MicroWorldMap(value: unknown): V2MicroWorldMapPreview {
  const root = asRecord(value);
  const zones = Array.isArray(root.zones)
    ? root.zones
        .map((row) => {
          const rec = asRecord(row);
          return {
            zone_id: typeof rec.zone_id === "string" ? rec.zone_id : "",
            name: typeof rec.name === "string" ? rec.name : undefined,
            anatomic_location: typeof rec.anatomic_location === "string" ? rec.anatomic_location : undefined,
            resident_actors: asStringArray(rec.resident_actors),
            environmental_gradients: asStringArray(rec.environmental_gradients),
            narrative_motifs: asStringArray(rec.narrative_motifs)
          };
        })
        .filter((row) => row.zone_id.length > 0)
    : [];
  const hazards = Array.isArray(root.hazards)
    ? root.hazards
        .map((row) => {
          const rec = asRecord(row);
          return {
            hazard_id: typeof rec.hazard_id === "string" ? rec.hazard_id : "",
            type: typeof rec.type === "string" ? rec.type : undefined,
            description: typeof rec.description === "string" ? rec.description : undefined,
            links_to_pathophysiology:
              typeof rec.links_to_pathophysiology === "string" ? rec.links_to_pathophysiology : undefined
          };
        })
        .filter((row) => row.hazard_id.length > 0)
    : [];
  const routes = Array.isArray(root.routes)
    ? root.routes
        .map((row) => {
          const rec = asRecord(row);
          return {
            route_id: typeof rec.route_id === "string" ? rec.route_id : "",
            from_zone_id: typeof rec.from_zone_id === "string" ? rec.from_zone_id : undefined,
            to_zone_id: typeof rec.to_zone_id === "string" ? rec.to_zone_id : undefined,
            mode: typeof rec.mode === "string" ? rec.mode : undefined,
            story_use: typeof rec.story_use === "string" ? rec.story_use : undefined
          };
        })
        .filter((row) => row.route_id.length > 0)
    : [];
  return { zones, hazards, routes };
}

function normalizeV2DramaPlan(value: unknown): V2DramaPlanPreview {
  const root = asRecord(value);
  const characterArcs = Array.isArray(root.character_arcs)
    ? root.character_arcs.map((row) => {
        const rec = asRecord(row);
        const turnsRaw = Array.isArray(rec.act_turns) ? rec.act_turns : [];
        return {
          character_id: typeof rec.character_id === "string" ? rec.character_id : undefined,
          name: typeof rec.name === "string" ? rec.name : undefined,
          core_need: typeof rec.core_need === "string" ? rec.core_need : undefined,
          core_fear: typeof rec.core_fear === "string" ? rec.core_fear : undefined,
          act_turns: turnsRaw.map((turn) => {
            const turnRec = asRecord(turn);
            return {
              act_id: typeof turnRec.act_id === "string" ? turnRec.act_id : undefined,
              pressure: typeof turnRec.pressure === "string" ? turnRec.pressure : undefined,
              choice: typeof turnRec.choice === "string" ? turnRec.choice : undefined,
              change: typeof turnRec.change === "string" ? turnRec.change : undefined
            };
          })
        };
      })
    : [];
  const relationshipArcs = Array.isArray(root.relationship_arcs)
    ? root.relationship_arcs.map((row) => {
        const rec = asRecord(row);
        return {
          pair: typeof rec.pair === "string" ? rec.pair : undefined,
          starting_dynamic: typeof rec.starting_dynamic === "string" ? rec.starting_dynamic : undefined,
          friction_points: asStringArray(rec.friction_points),
          repair_moments: asStringArray(rec.repair_moments),
          climax_resolution: typeof rec.climax_resolution === "string" ? rec.climax_resolution : undefined
        };
      })
    : [];
  const pressureLadder = asRecord(root.pressure_ladder);
  return {
    character_arcs: characterArcs,
    relationship_arcs: relationshipArcs,
    pressure_ladder: Object.keys(pressureLadder).length > 0 ? pressureLadder as Record<string, string[]> : undefined
  };
}

function normalizeV2SetpiecePlan(value: unknown): V2SetpiecePlanPreview {
  const root = asRecord(value);
  const setpieces = Array.isArray(root.setpieces)
    ? root.setpieces
        .map((row) => {
          const rec = asRecord(row);
          return {
            setpiece_id: typeof rec.setpiece_id === "string" ? rec.setpiece_id : "",
            act_id: typeof rec.act_id === "string" ? rec.act_id : undefined,
            type: typeof rec.type === "string" ? rec.type : undefined,
            location_zone_id: typeof rec.location_zone_id === "string" ? rec.location_zone_id : undefined,
            story_purpose: typeof rec.story_purpose === "string" ? rec.story_purpose : undefined,
            outcome_turn: typeof rec.outcome_turn === "string" ? rec.outcome_turn : undefined,
            constraints: asStringArray(rec.constraints)
          };
        })
        .filter((row) => row.setpiece_id.length > 0)
    : [];
  const quotas = asRecord(root.quotas);
  return {
    setpieces,
    quotas: Object.keys(quotas).length > 0 ? quotas as Record<string, boolean> : undefined
  };
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
  if (status === "paused") return "badge badgeWarn";
  if (status === "error") return "badge badgeErr";
  return "badge";
}

function constraintBadgeClass(status: NonNullable<RunStatus["constraintAdherence"]>["status"]): string {
  if (status === "fail") return "badge badgeErr";
  if (status === "pass") return "badge badgeOk";
  return "badge";
}

export const __runViewerTestables = {
  iterationNumber,
  isPatchedIter,
  stableSort,
  stableJson,
  parseJsonOrThrow,
  asRecord,
  asStringArray,
  normalizeV2Slide,
  normalizeV2DeckSpec,
  normalizeV2TemplateRegistry,
  normalizeV2ClueGraph,
  normalizeV2MicroWorldMap,
  normalizeV2DramaPlan,
  normalizeV2SetpiecePlan,
  extractKeyOrFallback,
  formatTime,
  parseIsoMs,
  formatElapsed,
  clampWatchdogThresholdSeconds,
  initialWatchdogThresholdSeconds,
  statusBadgeClass,
  constraintBadgeClass
};

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
  const [v2DeckSpecPreview, setV2DeckSpecPreview] = useState<V2DeckSpecPreview | null>(null);
  const [v2TemplateRegistryPreview, setV2TemplateRegistryPreview] = useState<V2TemplateRegistryPreview | null>(null);
  const [v2ClueGraphPreview, setV2ClueGraphPreview] = useState<V2ClueGraphPreview | null>(null);
  const [v2MicroWorldPreview, setV2MicroWorldPreview] = useState<V2MicroWorldMapPreview | null>(null);
  const [v2DramaPlanPreview, setV2DramaPlanPreview] = useState<V2DramaPlanPreview | null>(null);
  const [v2SetpiecePlanPreview, setV2SetpiecePlanPreview] = useState<V2SetpiecePlanPreview | null>(null);
  const [v2InspectorTab, setV2InspectorTab] = useState<V2InspectorTab>("world");
  const [v2DrilldownBusy, setV2DrilldownBusy] = useState(false);
  const [v2DrilldownErr, setV2DrilldownErr] = useState<string | null>(null);
  const [v2DrilldownSlideId, setV2DrilldownSlideId] = useState<string>("");
  const [v2ZoneId, setV2ZoneId] = useState<string>("");
  const [v2DramaCharacterId, setV2DramaCharacterId] = useState<string>("");
  const [gateDecision, setGateDecision] = useState<"approve" | "request_changes" | "regenerate">("approve");
  const [gateNotes, setGateNotes] = useState<string>("");
  const [gateBusy, setGateBusy] = useState(false);
  const [gateErr, setGateErr] = useState<string | null>(null);
  const [gateMsg, setGateMsg] = useState<string | null>(null);
  const [gateRecoveryHint, setGateRecoveryHint] = useState<string | null>(null);
  const [gateHistory, setGateHistory] = useState<GateHistoryResponse | null>(null);
  const [gateHistoryErr, setGateHistoryErr] = useState<string | null>(null);
  const [gateHistoryBusy, setGateHistoryBusy] = useState(false);
  const [resumeBusy, setResumeBusy] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const previousStuckRef = useRef<Map<string, number>>(new Map());

  const safeRunId = useMemo(() => runId ?? "", [runId]);
  const workflow = run?.settings?.workflow ?? "legacy";
  const stepOrder = useMemo(() => (workflow === "v2_micro_detectives" ? V2_PHASE1_STEP_ORDER : LEGACY_STEP_ORDER), [workflow]);
  const v2PackagingNames = useMemo(
    () => [
      "micro_world_map.json",
      "drama_plan.json",
      "setpiece_plan.json",
      "V2_MAIN_DECK_RENDER_PLAN.md",
      "V2_APPENDIX_RENDER_PLAN.md",
      "V2_SPEAKER_NOTES_WITH_CITATIONS.md",
      "v2_template_registry.json"
    ],
    []
  );
  const storyboardReviewRequired = useMemo(
    () => workflow === "v2_micro_detectives" && artifacts.some((a) => a.name === "GATE_3_STORYBOARD_REQUIRED.json"),
    [workflow, artifacts]
  );
  const v2PackagingReadyCount = useMemo(() => {
    if (workflow !== "v2_micro_detectives") return 0;
    const names = new Set(artifacts.map((a) => a.name));
    return v2PackagingNames.filter((name) => names.has(name)).length;
  }, [workflow, artifacts, v2PackagingNames]);
  const gateHistoryRows = gateHistory?.history ?? [];

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

  async function refreshGateHistory() {
    if (!safeRunId) return;
    setGateHistoryBusy(true);
    try {
      const history = await getGateHistory(safeRunId);
      setGateHistory(history);
      setGateHistoryErr(null);
    } catch (e) {
      setGateHistory(null);
      setGateHistoryErr(e instanceof Error ? e.message : String(e));
    } finally {
      setGateHistoryBusy(false);
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
    setV2DeckSpecPreview(null);
    setV2TemplateRegistryPreview(null);
    setV2ClueGraphPreview(null);
    setV2MicroWorldPreview(null);
    setV2DramaPlanPreview(null);
    setV2SetpiecePlanPreview(null);
    setV2InspectorTab("world");
    setV2DrilldownBusy(false);
    setV2DrilldownErr(null);
    setV2DrilldownSlideId("");
    setV2ZoneId("");
    setV2DramaCharacterId("");
    setGateDecision("approve");
    setGateNotes("");
    setGateBusy(false);
    setGateErr(null);
    setGateMsg(null);
    setGateRecoveryHint(null);
    setGateHistory(null);
    setGateHistoryErr(null);
    setGateHistoryBusy(false);
    setResumeBusy(false);

    void refreshRun();
    void refreshArtifacts();
    void refreshGateHistory();
  }, [safeRunId]);

  useEffect(() => {
    if (stepOrder.includes(rerunStartFrom)) return;
    setRerunStartFrom(stepOrder[0] ?? "KB0");
  }, [stepOrder, rerunStartFrom]);

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
    const hasDeckSpec = artifacts.some((a) => a.name === "deck_spec.json");
    const hasTemplateRegistry = artifacts.some((a) => a.name === "v2_template_registry.json");
    const hasClueGraph = artifacts.some((a) => a.name === "clue_graph.json");
    const hasMicroWorld = artifacts.some((a) => a.name === "micro_world_map.json");
    const hasDramaPlan = artifacts.some((a) => a.name === "drama_plan.json");
    const hasSetpiecePlan = artifacts.some((a) => a.name === "setpiece_plan.json");

    if (!safeRunId || workflow !== "v2_micro_detectives" || !hasDeckSpec) {
      setV2DeckSpecPreview(null);
      setV2TemplateRegistryPreview(null);
      setV2ClueGraphPreview(null);
      setV2MicroWorldPreview(null);
      setV2DramaPlanPreview(null);
      setV2SetpiecePlanPreview(null);
      setV2DrilldownErr(null);
      setV2DrilldownBusy(false);
      return;
    }

    let cancelled = false;
    setV2DrilldownBusy(true);
    setV2DrilldownErr(null);

    void (async () => {
      try {
        const [deckRaw, templateRaw, clueRaw, microWorldRaw, dramaRaw, setpieceRaw] = await Promise.all([
          fetchArtifact(safeRunId, "deck_spec.json"),
          hasTemplateRegistry ? fetchArtifact(safeRunId, "v2_template_registry.json") : Promise.resolve(null),
          hasClueGraph ? fetchArtifact(safeRunId, "clue_graph.json") : Promise.resolve(null),
          hasMicroWorld ? fetchArtifact(safeRunId, "micro_world_map.json") : Promise.resolve(null),
          hasDramaPlan ? fetchArtifact(safeRunId, "drama_plan.json") : Promise.resolve(null),
          hasSetpiecePlan ? fetchArtifact(safeRunId, "setpiece_plan.json") : Promise.resolve(null)
        ]);
        if (cancelled) return;

        const deckParsed = normalizeV2DeckSpec(parseJsonOrThrow(deckRaw.text));
        const templateParsed = templateRaw ? normalizeV2TemplateRegistry(parseJsonOrThrow(templateRaw.text)) : null;
        const clueParsed = clueRaw ? normalizeV2ClueGraph(parseJsonOrThrow(clueRaw.text)) : null;
        const microWorldParsed = microWorldRaw ? normalizeV2MicroWorldMap(parseJsonOrThrow(microWorldRaw.text)) : null;
        const dramaParsed = dramaRaw ? normalizeV2DramaPlan(parseJsonOrThrow(dramaRaw.text)) : null;
        const setpieceParsed = setpieceRaw ? normalizeV2SetpiecePlan(parseJsonOrThrow(setpieceRaw.text)) : null;

        setV2DeckSpecPreview(deckParsed);
        setV2TemplateRegistryPreview(templateParsed);
        setV2ClueGraphPreview(clueParsed);
        setV2MicroWorldPreview(microWorldParsed);
        setV2DramaPlanPreview(dramaParsed);
        setV2SetpiecePlanPreview(setpieceParsed);
        setV2DrilldownErr(null);
      } catch (e) {
        if (cancelled) return;
        setV2DeckSpecPreview(null);
        setV2TemplateRegistryPreview(null);
        setV2ClueGraphPreview(null);
        setV2MicroWorldPreview(null);
        setV2DramaPlanPreview(null);
        setV2SetpiecePlanPreview(null);
        setV2DrilldownErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setV2DrilldownBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [safeRunId, artifacts, workflow]);

  useEffect(() => {
    if (patchedIterNames.length > 0 && !diffTarget) {
      setDiffTarget(patchedIterNames[patchedIterNames.length - 1]!);
    }
  }, [patchedIterNames, diffTarget]);

  useEffect(() => {
    if (!safeRunId) return;
    if (run?.status === "paused" || artifacts.some((a) => a.name === "human_review.json")) {
      void refreshGateHistory();
    }
  }, [safeRunId, run?.status, artifacts]);

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

    es.addEventListener("gate_required", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as { gateId: string; resumeFrom: string; message: string };
        pushLog(`gate required: ${data.gateId} (resumeFrom=${data.resumeFrom}) ${data.message}`);
      } catch {
        pushLog("gate_required (unparseable)");
      }
      void refreshRun();
      void refreshGateHistory();
    });

    es.addEventListener("gate_submitted", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as { gateId: string; status: string };
        pushLog(`gate submitted: ${data.gateId} => ${data.status}`);
      } catch {
        pushLog("gate_submitted (unparseable)");
      }
      void refreshRun();
      void refreshGateHistory();
    });

    es.addEventListener("run_resumed", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as { gateId: string; startFrom: string; mode: string };
        pushLog(`run resumed from ${data.gateId} at ${data.startFrom} (mode=${data.mode})`);
      } catch {
        pushLog("run_resumed (unparseable)");
      }
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

  async function onSubmitGateReview() {
    if (!safeRunId || !run?.activeGate) return;
    setGateErr(null);
    setGateMsg(null);
    setGateRecoveryHint(null);
    setGateBusy(true);
    try {
      const res = await submitGateReview(safeRunId, run.activeGate.gateId, {
        status: gateDecision,
        notes: gateNotes,
        requested_changes: []
      });
      setGateMsg(`Submitted ${gateDecision} for ${run.activeGate.gateId}.`);
      if (res.recommendedAction === "resume") {
        setGateRecoveryHint(`Ready to resume from ${res.suggestedResumeFrom ?? run.activeGate.resumeFrom}.`);
      } else if (res.recommendedAction === "resume_regenerate") {
        setGateRecoveryHint(`Ready to regenerate from ${res.suggestedResumeFrom ?? "gate step"}. Click Resume run to restart that step.`);
      } else {
        setGateRecoveryHint("Feedback saved. Run will stay paused until you submit approve or regenerate.");
      }
      await refreshArtifacts();
      await refreshRun();
      await refreshGateHistory();
    } catch (e) {
      setGateErr(e instanceof Error ? e.message : String(e));
    } finally {
      setGateBusy(false);
    }
  }

  async function onResume() {
    if (!safeRunId) return;
    setGateErr(null);
    setGateMsg(null);
    setGateRecoveryHint(null);
    setResumeBusy(true);
    try {
      const res = await resumeRun(safeRunId);
      setGateMsg(
        res.resumeMode === "regenerate"
          ? `Regeneration requested from ${res.startFrom}.`
          : `Resume requested from ${res.startFrom}.`
      );
      await refreshRun();
      await refreshGateHistory();
    } catch (e) {
      setGateErr(e instanceof Error ? e.message : String(e));
    } finally {
      setResumeBusy(false);
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

    return stepOrder.map((step) => ({ step, status: run.steps[step] }))
      .filter((row) => row.status?.status === "running")
      .map((row) => {
        const startedMs = parseIsoMs(row.status?.startedAt);
        return {
          step: row.step,
          elapsedMs: startedMs === null ? 0 : Math.max(0, nowMs - startedMs)
        };
      })
      .filter((row) => row.elapsedMs >= stuckThresholdMs);
  }, [run, nowMs, stuckThresholdMs, stepOrder]);

  const recoveredStepNames = useMemo(() => recoveredSteps.map((r) => r.step), [recoveredSteps]);

  const v2DrilldownSlides = useMemo(() => {
    if (!v2DeckSpecPreview) return [] as V2DeckSpecSlide[];
    return [...v2DeckSpecPreview.slides, ...v2DeckSpecPreview.appendix_slides];
  }, [v2DeckSpecPreview]);

  useEffect(() => {
    if (v2DrilldownSlides.length === 0) {
      setV2DrilldownSlideId("");
      return;
    }
    if (v2DrilldownSlides.some((slide) => slide.slide_id === v2DrilldownSlideId)) return;
    setV2DrilldownSlideId(v2DrilldownSlides[0]!.slide_id);
  }, [v2DrilldownSlides, v2DrilldownSlideId]);

  const v2SelectedSlide = useMemo(() => {
    if (v2DrilldownSlides.length === 0) return null;
    return v2DrilldownSlides.find((slide) => slide.slide_id === v2DrilldownSlideId) ?? v2DrilldownSlides[0]!;
  }, [v2DrilldownSlides, v2DrilldownSlideId]);

  const v2SelectedTemplate = useMemo(() => {
    if (!v2SelectedSlide?.template_id || !v2TemplateRegistryPreview) return null;
    return v2TemplateRegistryPreview.templates.find((template) => template.template_id === v2SelectedSlide.template_id) ?? null;
  }, [v2SelectedSlide, v2TemplateRegistryPreview]);

  const v2SelectedExhibits = useMemo(() => {
    const ids = v2SelectedSlide?.exhibit_ids ?? [];
    if (ids.length === 0) return [] as Array<{ exhibitId: string; purpose?: string }>;
    const purposeMap = new Map(
      (v2ClueGraphPreview?.exhibits ?? []).map((row) => [row.exhibit_id, row.purpose] as const)
    );
    return ids.map((exhibitId) => ({ exhibitId, purpose: purposeMap.get(exhibitId) }));
  }, [v2SelectedSlide, v2ClueGraphPreview]);

  useEffect(() => {
    const zones = v2MicroWorldPreview?.zones ?? [];
    if (zones.length === 0) {
      setV2ZoneId("");
      return;
    }
    if (zones.some((zone) => zone.zone_id === v2ZoneId)) return;
    setV2ZoneId(zones[0]!.zone_id);
  }, [v2MicroWorldPreview, v2ZoneId]);

  const v2SelectedZone = useMemo(() => {
    const zones = v2MicroWorldPreview?.zones ?? [];
    if (zones.length === 0) return null;
    return zones.find((zone) => zone.zone_id === v2ZoneId) ?? zones[0]!;
  }, [v2MicroWorldPreview, v2ZoneId]);

  useEffect(() => {
    const characters = v2DramaPlanPreview?.character_arcs ?? [];
    if (characters.length === 0) {
      setV2DramaCharacterId("");
      return;
    }
    const hasCurrent = characters.some((arc) => (arc.character_id ?? arc.name) === v2DramaCharacterId);
    if (hasCurrent) return;
    setV2DramaCharacterId(characters[0]?.character_id ?? characters[0]?.name ?? "");
  }, [v2DramaPlanPreview, v2DramaCharacterId]);

  const v2SelectedDramaArc = useMemo(() => {
    const characters = v2DramaPlanPreview?.character_arcs ?? [];
    if (characters.length === 0) return null;
    return (
      characters.find((arc) => (arc.character_id ?? arc.name) === v2DramaCharacterId) ??
      characters[0]!
    );
  }, [v2DramaPlanPreview, v2DramaCharacterId]);

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
                    {stepOrder.map((s) => (
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

          {run.status === "paused" && run.activeGate && (
            <div className="panel runGateCard">
              <div className="panelHeader">
                <div style={{ fontWeight: 600 }}>Gate review required</div>
                <span className="badge badgeWarn">{run.activeGate.gateId}</span>
              </div>
              <div className="panelBody">
                <div className="subtle" style={{ marginBottom: 10 }}>
                  {run.activeGate.message}
                </div>
                <div className="mono" style={{ marginBottom: 10 }}>
                  resumeFrom={run.activeGate.resumeFrom}
                </div>
                <div className="mono subtle" style={{ marginBottom: 10 }}>
                  awaiting={run.activeGate.awaiting ?? "review_submission"}
                  {run.activeGate.submittedDecision ? ` · submitted=${run.activeGate.submittedDecision}` : ""}
                </div>
                <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                  <div>
                    <div className="subtle">Decision</div>
                    <select aria-label="Gate decision" value={gateDecision} onChange={(e) => setGateDecision(e.target.value as typeof gateDecision)}>
                      <option value="approve">approve</option>
                      <option value="request_changes">request_changes</option>
                      <option value="regenerate">regenerate</option>
                    </select>
                  </div>
                  <div style={{ minWidth: 320, flex: 1 }}>
                    <div className="subtle">Notes</div>
                    <textarea
                      aria-label="Gate notes"
                      value={gateNotes}
                      onChange={(e) => setGateNotes(e.target.value)}
                      placeholder="Optional feedback for this gate"
                      style={{ minHeight: 78 }}
                    />
                  </div>
                  <button disabled={gateBusy} onClick={() => void onSubmitGateReview()}>
                    {gateBusy ? "Submitting..." : "Submit gate review"}
                  </button>
                  <div className="subtle" style={{ minWidth: 220 }}>
                    {gateDecision === "request_changes" && "request_changes keeps this run paused for further edits."}
                    {gateDecision === "regenerate" && "regenerate restarts from the gate-owning step after Resume."}
                  </div>
                  <button disabled={resumeBusy} onClick={() => void onResume()}>
                    {resumeBusy ? "Resuming..." : "Resume run"}
                  </button>
                </div>
                {gateErr && (
                  <div style={{ marginTop: 10 }}>
                    <span className="badge badgeErr">{gateErr}</span>
                  </div>
                )}
                {gateMsg && (
                  <div style={{ marginTop: 10 }}>
                    <span className="badge badgeOk">{gateMsg}</span>
                  </div>
                )}
                {gateRecoveryHint && (
                  <div style={{ marginTop: 10 }}>
                    <span className="badge">{gateRecoveryHint}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {workflow === "v2_micro_detectives" && (
            <div className="panel runGateCard">
              <div className="panelHeader">
                <div style={{ fontWeight: 600 }}>Gate history</div>
                <button onClick={() => void refreshGateHistory()}>Refresh</button>
              </div>
              <div className="panelBody">
                {gateHistoryBusy && <div className="subtle">Loading gate history…</div>}
                {gateHistoryErr && <span className="badge badgeErr">{gateHistoryErr}</span>}
                {!gateHistoryBusy && !gateHistoryErr && gateHistoryRows.length === 0 && (
                  <div className="subtle">No gate reviews submitted yet.</div>
                )}
                {!gateHistoryBusy && !gateHistoryErr && gateHistoryRows.length > 0 && (
                  <div className="log mono" style={{ maxHeight: 180 }}>
                    {gateHistoryRows
                      .slice()
                      .reverse()
                      .slice(0, 10)
                      .map((entry, idx) => (
                        <div key={`${entry.gate_id}-${entry.submitted_at}-${idx}`} className="logLine">
                          {entry.submitted_at} [{entry.gate_id}] {entry.status}
                          {entry.notes ? ` — ${entry.notes}` : ""}
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {workflow === "v2_micro_detectives" && (
            <div className="panel runGateCard">
              <div className="panelHeader">
                <div style={{ fontWeight: 600 }}>V2 packaging status</div>
              </div>
              <div className="panelBody">
                <div className="subtle" style={{ marginBottom: 10 }}>
                  {v2PackagingReadyCount}/{v2PackagingNames.length} packaging artifacts present
                </div>
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  {v2PackagingNames.map((name) => {
                    const ok = artifacts.some((a) => a.name === name);
                    return (
                      <span key={name} className={`badge ${ok ? "badgeOk" : ""}`}>
                        {ok ? "ready" : "pending"} · {name}
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

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

          {storyboardReviewRequired && run.status === "done" && (
            <div className="panel runGateCard">
              <div className="panelBody">
                <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <span className="badge badgeWarn">Storyboard review required</span>
                  <span className="mono">Phase 1 complete. Review `deck_spec.json`, then rerun from A or B after edits.</span>
                </div>
              </div>
            </div>
          )}

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
            workflow={workflow}
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

              {workflow === "v2_micro_detectives" && (
                <div className="panel">
                  <div className="panelHeader">
                    <div style={{ fontWeight: 600 }}>V2 slide drilldown</div>
                  </div>
                  <div className="panelBody">
                    {v2DrilldownBusy && <div className="subtle">Loading deck drilldown…</div>}
                    {v2DrilldownErr && <span className="badge badgeErr">{v2DrilldownErr}</span>}
                    {!v2DrilldownBusy && !v2DrilldownErr && !v2DeckSpecPreview && (
                      <div className="subtle">No deck_spec.json artifact yet.</div>
                    )}

                    {!v2DrilldownBusy && !v2DrilldownErr && v2DeckSpecPreview && (
                      <div className="v2DrilldownWrap">
                        <div className="subtle">
                          {v2DeckSpecPreview.deck_meta?.episode_title ?? "Deck"} · main{" "}
                          {v2DeckSpecPreview.deck_meta?.deck_length_main ?? String(v2DeckSpecPreview.slides.length)} slides
                        </div>
                        <div className="row" style={{ gap: 8, marginTop: 8 }}>
                          <span className="subtle">Slide</span>
                          <select
                            aria-label="V2 drilldown slide"
                            value={v2SelectedSlide?.slide_id ?? ""}
                            onChange={(e) => setV2DrilldownSlideId(e.target.value)}
                            style={{ minWidth: 240, flex: 1 }}
                          >
                            {v2DrilldownSlides.map((slide) => (
                              <option key={slide.slide_id} value={slide.slide_id}>
                                {slide.slide_id} · {slide.title ?? slide.on_slide_text?.headline ?? "Untitled"}
                              </option>
                            ))}
                          </select>
                        </div>

                        {v2SelectedSlide && (
                          <>
                            <div className="row v2DrilldownBadges">
                              <span className="badge">{v2SelectedSlide.act_id ?? "ACT?"}</span>
                              <span className="badge">{v2SelectedSlide.beat_type ?? "beat?"}</span>
                              <span className="badge badgeOk">{v2SelectedSlide.template_id ?? "template?"}</span>
                              <span className="badge">{v2SelectedSlide.medical_payload?.delivery_mode ?? "delivery?"}</span>
                            </div>

                            <details className="diagnosticDetails" open>
                              <summary>Template + panel details</summary>
                              <div className="diagnosticKv">
                                <div>headline</div>
                                <div>{v2SelectedSlide.on_slide_text?.headline ?? "-"}</div>
                                <div>subtitle</div>
                                <div>{v2SelectedSlide.on_slide_text?.subtitle ?? "-"}</div>
                                <div>major concept</div>
                                <div className="mono">{v2SelectedSlide.medical_payload?.major_concept_id ?? "-"}</div>
                                <div>visual description</div>
                                <div>{v2SelectedSlide.visual_description ?? "-"}</div>
                              </div>
                            </details>

                            <details className="diagnosticDetails">
                              <summary>Story turn + notes</summary>
                              <div className="diagnosticKv">
                                <div>goal</div>
                                <div>{v2SelectedSlide.story_panel?.goal ?? "-"}</div>
                                <div>opposition</div>
                                <div>{v2SelectedSlide.story_panel?.opposition ?? "-"}</div>
                                <div>turn</div>
                                <div>{v2SelectedSlide.story_panel?.turn ?? "-"}</div>
                                <div>decision</div>
                                <div>{v2SelectedSlide.story_panel?.decision ?? "-"}</div>
                                <div>medical reasoning</div>
                                <div>{v2SelectedSlide.speaker_notes?.medical_reasoning ?? "-"}</div>
                              </div>
                            </details>

                            <details className="diagnosticDetails" open>
                              <summary>Exhibits + citations</summary>
                              <div className="diagnosticKv">
                                <div>exhibit count</div>
                                <div className="mono">{v2SelectedExhibits.length}</div>
                                <div>citations</div>
                                <div className="mono">{v2SelectedSlide.medical_payload?.dossier_citations?.length ?? 0}</div>
                              </div>
                              {v2SelectedExhibits.length === 0 ? (
                                <div className="subtle">No exhibit IDs on this slide.</div>
                              ) : (
                                <ul className="diagnosticList">
                                  {v2SelectedExhibits.map((row) => (
                                    <li key={row.exhibitId}>
                                      <span className="mono">{row.exhibitId}</span>
                                      {row.purpose ? ` — ${row.purpose}` : ""}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </details>

                            {v2SelectedTemplate && (
                              <details className="diagnosticDetails" open>
                                <summary>Template guidance</summary>
                                <div className="diagnosticKv">
                                  <div>purpose</div>
                                  <div>{v2SelectedTemplate.purpose ?? "-"}</div>
                                  <div>allowed beats</div>
                                  <div>{v2SelectedTemplate.allowed_beat_types?.join(", ") || "-"}</div>
                                </div>
                                {v2SelectedTemplate.renderer_instructions && v2SelectedTemplate.renderer_instructions.length > 0 && (
                                  <ul className="diagnosticList">
                                    {v2SelectedTemplate.renderer_instructions.map((instruction, idx) => (
                                      <li key={`tpl-ins-${idx}`}>{instruction}</li>
                                    ))}
                                  </ul>
                                )}
                              </details>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {workflow === "v2_micro_detectives" && (
                <div className="panel">
                  <div className="panelHeader">
                    <div style={{ fontWeight: 600 }}>V2 artifact inspectors</div>
                  </div>
                  <div className="panelBody">
                    <div className="summaryTabs">
                      <button
                        className={`summaryTabButton ${v2InspectorTab === "world" ? "summaryTabButtonActive" : ""}`}
                        onClick={() => setV2InspectorTab("world")}
                      >
                        Micro World
                      </button>
                      <button
                        className={`summaryTabButton ${v2InspectorTab === "drama" ? "summaryTabButtonActive" : ""}`}
                        onClick={() => setV2InspectorTab("drama")}
                      >
                        Drama Plan
                      </button>
                      <button
                        className={`summaryTabButton ${v2InspectorTab === "setpieces" ? "summaryTabButtonActive" : ""}`}
                        onClick={() => setV2InspectorTab("setpieces")}
                      >
                        Setpieces
                      </button>
                      <button
                        className={`summaryTabButton ${v2InspectorTab === "templates" ? "summaryTabButtonActive" : ""}`}
                        onClick={() => setV2InspectorTab("templates")}
                      >
                        Templates
                      </button>
                    </div>

                    {v2DrilldownBusy && <div className="subtle">Loading v2 inspectors…</div>}
                    {v2DrilldownErr && <span className="badge badgeErr">{v2DrilldownErr}</span>}

                    {!v2DrilldownBusy && !v2DrilldownErr && v2InspectorTab === "world" && (
                      <>
                        {!v2MicroWorldPreview && <div className="subtle">No micro_world_map.json artifact yet.</div>}
                        {v2MicroWorldPreview && (
                          <div className="summaryCardList">
                            <div className="row" style={{ gap: 8 }}>
                              <span className="subtle">Zone</span>
                              <select
                                aria-label="V2 inspector zone"
                                value={v2SelectedZone?.zone_id ?? ""}
                                onChange={(e) => setV2ZoneId(e.target.value)}
                                style={{ flex: 1 }}
                              >
                                {(v2MicroWorldPreview.zones ?? []).map((zone) => (
                                  <option key={zone.zone_id} value={zone.zone_id}>
                                    {zone.zone_id} · {zone.name ?? "Unnamed zone"}
                                  </option>
                                ))}
                              </select>
                            </div>
                            {v2SelectedZone && (
                              <details className="diagnosticDetails" open>
                                <summary>Zone details</summary>
                                <div className="diagnosticKv">
                                  <div>name</div>
                                  <div>{v2SelectedZone.name ?? "-"}</div>
                                  <div>anatomic location</div>
                                  <div>{v2SelectedZone.anatomic_location ?? "-"}</div>
                                  <div>resident actors</div>
                                  <div>{v2SelectedZone.resident_actors?.join(", ") || "-"}</div>
                                  <div>environmental gradients</div>
                                  <div>{v2SelectedZone.environmental_gradients?.join(", ") || "-"}</div>
                                </div>
                              </details>
                            )}
                            <details className="diagnosticDetails">
                              <summary>Hazards ({v2MicroWorldPreview.hazards.length})</summary>
                              <ul className="diagnosticList">
                                {v2MicroWorldPreview.hazards.map((hazard) => (
                                  <li key={hazard.hazard_id}>
                                    <strong>{hazard.hazard_id}</strong>
                                    {hazard.type ? ` (${hazard.type})` : ""}: {hazard.description ?? "-"}
                                  </li>
                                ))}
                              </ul>
                            </details>
                            <details className="diagnosticDetails">
                              <summary>Routes ({v2MicroWorldPreview.routes.length})</summary>
                              <ul className="diagnosticList">
                                {v2MicroWorldPreview.routes.map((route) => (
                                  <li key={route.route_id}>
                                    <span className="mono">{route.route_id}</span>: {route.from_zone_id ?? "?"} →{" "}
                                    {route.to_zone_id ?? "?"} ({route.mode ?? "mode?"})
                                  </li>
                                ))}
                              </ul>
                            </details>
                          </div>
                        )}
                      </>
                    )}

                    {!v2DrilldownBusy && !v2DrilldownErr && v2InspectorTab === "drama" && (
                      <>
                        {!v2DramaPlanPreview && <div className="subtle">No drama_plan.json artifact yet.</div>}
                        {v2DramaPlanPreview && (
                          <div className="summaryCardList">
                            <div className="row" style={{ gap: 8 }}>
                              <span className="subtle">Character</span>
                              <select
                                aria-label="V2 inspector character"
                                value={v2SelectedDramaArc?.character_id ?? v2SelectedDramaArc?.name ?? ""}
                                onChange={(e) => setV2DramaCharacterId(e.target.value)}
                                style={{ flex: 1 }}
                              >
                                {(v2DramaPlanPreview.character_arcs ?? []).map((arc, idx) => {
                                  const value = arc.character_id ?? arc.name ?? `arc-${idx}`;
                                  return (
                                    <option key={value} value={value}>
                                      {arc.name ?? arc.character_id ?? `Character ${idx + 1}`}
                                    </option>
                                  );
                                })}
                              </select>
                            </div>
                            {v2SelectedDramaArc && (
                              <details className="diagnosticDetails" open>
                                <summary>Character arc details</summary>
                                <div className="diagnosticKv">
                                  <div>core need</div>
                                  <div>{v2SelectedDramaArc.core_need ?? "-"}</div>
                                  <div>core fear</div>
                                  <div>{v2SelectedDramaArc.core_fear ?? "-"}</div>
                                </div>
                                <ul className="diagnosticList">
                                  {(v2SelectedDramaArc.act_turns ?? []).map((turn, idx) => (
                                    <li key={`turn-${idx}`}>
                                      <strong>{turn.act_id ?? "ACT?"}</strong>: {turn.pressure ?? "-"} / {turn.choice ?? "-"} /{" "}
                                      {turn.change ?? "-"}
                                    </li>
                                  ))}
                                </ul>
                              </details>
                            )}
                            <details className="diagnosticDetails">
                              <summary>Relationship arcs ({v2DramaPlanPreview.relationship_arcs.length})</summary>
                              <ul className="diagnosticList">
                                {v2DramaPlanPreview.relationship_arcs.map((arc, idx) => (
                                  <li key={`rel-${idx}`}>
                                    <strong>{arc.pair ?? `Pair ${idx + 1}`}</strong>: {arc.starting_dynamic ?? "-"}
                                  </li>
                                ))}
                              </ul>
                            </details>
                          </div>
                        )}
                      </>
                    )}

                    {!v2DrilldownBusy && !v2DrilldownErr && v2InspectorTab === "setpieces" && (
                      <>
                        {!v2SetpiecePlanPreview && <div className="subtle">No setpiece_plan.json artifact yet.</div>}
                        {v2SetpiecePlanPreview && (
                          <div className="summaryCardList">
                            <details className="diagnosticDetails" open>
                              <summary>Setpieces ({v2SetpiecePlanPreview.setpieces.length})</summary>
                              <ul className="diagnosticList">
                                {v2SetpiecePlanPreview.setpieces.map((item) => (
                                  <li key={item.setpiece_id}>
                                    <strong>{item.setpiece_id}</strong> [{item.act_id ?? "ACT?"}] {item.type ?? "type?"}:{" "}
                                    {item.story_purpose ?? "-"}
                                  </li>
                                ))}
                              </ul>
                            </details>
                            {v2SetpiecePlanPreview.quotas && (
                              <details className="diagnosticDetails">
                                <summary>Quota checks</summary>
                                <div className="diagnosticKv">
                                  {Object.entries(v2SetpiecePlanPreview.quotas).map(([key, value]) => (
                                    <div key={key} style={{ display: "contents" }}>
                                      <div>{key}</div>
                                      <div className="mono">{value ? "yes" : "no"}</div>
                                    </div>
                                  ))}
                                </div>
                              </details>
                            )}
                          </div>
                        )}
                      </>
                    )}

                    {!v2DrilldownBusy && !v2DrilldownErr && v2InspectorTab === "templates" && (
                      <>
                        {!v2TemplateRegistryPreview && <div className="subtle">No v2_template_registry.json artifact yet.</div>}
                        {v2TemplateRegistryPreview && (
                          <div className="summaryCardList">
                            <details className="diagnosticDetails" open>
                              <summary>Template registry ({v2TemplateRegistryPreview.templates.length})</summary>
                              <ul className="diagnosticList">
                                {v2TemplateRegistryPreview.templates.map((template) => (
                                  <li key={template.template_id}>
                                    <span className="mono">{template.template_id}</span>: {template.purpose ?? "-"}
                                  </li>
                                ))}
                              </ul>
                            </details>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}

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
