import { Link, useNavigate, useParams } from "react-router-dom";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
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

type V2PackagingSummaryPreview = {
  schema_version?: string;
  workflow?: string;
  generated_at?: string;
  deck: {
    episode_title: string;
    main_slide_count: number;
    appendix_slide_count: number;
  };
  package: {
    template_count: number;
    files: Record<string, string>;
  };
};

type V2SemanticAcceptanceReport = {
  checked_at: string;
  pass: boolean;
  failures: string[];
  thresholds: {
    min_story_forward_ratio: number;
    min_hybrid_slide_quality: number;
    min_citation_grounding_coverage: number;
  };
  metrics: {
    main_slide_count: number;
    story_forward_ratio: number;
    hybrid_slide_quality: number;
    citation_grounding_coverage: number;
  };
};

type V2QaGraderScorePreview = {
  category: string;
  score_0_to_5: number;
  rationale: string;
  critical: boolean;
};

type V2QaReportPreview = {
  accept: boolean;
  summary: string;
  required_fix_count: number;
  narrative_scores: V2QaGraderScorePreview[];
};

type V2StageAuthoringSource = "agent" | "deterministic_fallback";

type V2StageAuthoringProvenancePreview = {
  generation_profile: "quality" | "pilot";
  stages: {
    micro_world_map: { source: V2StageAuthoringSource; reason?: string };
    drama_plan: { source: V2StageAuthoringSource; reason?: string };
    setpiece_plan: { source: V2StageAuthoringSource; reason?: string };
  };
};

type V2StoryBeatsAlignmentPreview = {
  story_beats_present: boolean;
  chapter_outline_present: boolean;
  lint_status: "pass" | "warn" | "fail";
  warnings: string[];
  required_markers: {
    opener_motif: boolean;
    midpoint_false_theory_collapse: boolean;
    ending_callback: boolean;
    detective_deputy_rupture_repair: boolean;
  };
  coverage: {
    total_beats: number;
    mapped_beats: number;
    mapped_ratio: number;
    block_aligned_beats: number;
    block_aligned_ratio: number;
  };
  block_coverage: Array<{
    block_id: string;
    expected_beats: number;
    mapped_beats: number;
    mapped_ratio: number;
  }>;
  beat_slide_map: Array<{
    beat_id: string;
    expected_act_id?: "ACT1" | "ACT2" | "ACT3" | "ACT4";
    matched_slide_id?: string;
    matched_act_id?: "ACT1" | "ACT2" | "ACT3" | "ACT4";
    matched_block_id?: string;
    overlap_ratio: number;
    overlap_tokens: number;
    mapped: boolean;
    block_aligned: boolean;
  }>;
};

type V2NarrativeStatePreview = {
  block_id: string;
  current_false_theory: string;
  relationship_state_detective_deputy: string;
  unresolved_emotional_thread: string;
  active_clue_obligations: string[];
  active_motif_callback_lexicon: string[];
  pressure_channels: string[];
  recent_slide_excerpts: string[];
  active_differential_ordering: string[];
  delta_from_previous_block: string;
};

type V2AuthoringContextAttemptPreview = {
  attempt_id: string;
  prompt_variant: string;
  context_mode: "full" | "compact";
  reason: string;
  result: "success" | "error" | "skipped";
  details?: string;
};

type V2AuthoringContextManifestPreview = {
  generated_at: string;
  generation_profile: "quality" | "pilot";
  attempts: V2AuthoringContextAttemptPreview[];
};

type V2BlockRegenTracePreview = {
  loop: number;
  fix_count: number;
  fix_types: string[];
  routes: string[];
  regenerated_blocks: string[];
  warnings: string[];
};

type V2QaBlockHeatmapPreview = {
  loop: number;
  blocks: Array<{
    block_id: string;
    act_id: string;
    severity_score: number;
    repeated_template_density: number;
    generic_language_rate: number;
    story_forward_deficit_ratio: number;
    hybrid_deficit_ratio: number;
    clue_twist_debt_count: number;
  }>;
};

type V2NarrativeIntensifierPassPreview = {
  global_intensity_findings: string[];
  narrative_rationale: string[];
  target_block_ids: string[];
  operations: Array<{
    op: string;
    reason?: string;
    slide_id?: string;
    after_slide_id?: string;
    start_slide_id?: string;
    end_slide_id?: string;
  }>;
};

type V2DiseaseResearchSourceReportPreview = {
  topic: string;
  sections: Array<{
    section: string;
    curated_citations: number;
    web_citations: number;
    dominant_source: "curated" | "web" | "mixed";
    fallback_reason?: string;
  }>;
};

type V2InspectorTab = "world" | "drama" | "setpieces" | "templates" | "packaging";

type DiffTargetStep = "KB0" | "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J" | "K" | "L" | "M" | "N" | "O" | "P";
type ArtifactFolderFilter = "all" | "root" | "intermediate" | "final";
type SummaryTab = "narrative" | "visual";
type LiveFeedState = "connecting" | "connected" | "reconnecting" | "offline";

const LEGACY_STEP_ORDER: DiffTargetStep[] = ["KB0", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P"];
const V2_PHASE1_STEP_ORDER: DiffTargetStep[] = ["KB0", "A", "B", "C"];
const DEFAULT_STUCK_THRESHOLD_SECONDS = 90;
const STUCK_THRESHOLD_MIN_SECONDS = 10;
const STUCK_THRESHOLD_MAX_SECONDS = 1200;
const WATCHDOG_STORAGE_KEY = "mms_watchdog_threshold_seconds";
const V2_NARRATIVE_GRADER_CATEGORIES = new Set([
  "ActEscalation",
  "FalseTheoryArc",
  "CallbackClosure",
  "DetectiveDeputyArc",
  "SceneVariety",
  "GenericLanguageRate"
]);

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

function normalizeV2PackagingSummary(value: unknown): V2PackagingSummaryPreview {
  const root = asRecord(value);
  const deck = asRecord(root.deck);
  const pkg = asRecord(root.package);
  const files = asRecord(pkg.files);
  const rawEpisodeTitle = typeof deck.episode_title === "string" ? deck.episode_title.trim() : "";
  return {
    schema_version: typeof root.schema_version === "string" ? root.schema_version : undefined,
    workflow: typeof root.workflow === "string" ? root.workflow : undefined,
    generated_at: typeof root.generated_at === "string" ? root.generated_at : undefined,
    deck: {
      episode_title: rawEpisodeTitle.length > 0 ? rawEpisodeTitle : "-",
      main_slide_count: Number.isFinite(Number(deck.main_slide_count)) ? Math.max(0, Math.round(Number(deck.main_slide_count))) : 0,
      appendix_slide_count:
        Number.isFinite(Number(deck.appendix_slide_count)) ? Math.max(0, Math.round(Number(deck.appendix_slide_count))) : 0
    },
    package: {
      template_count: Number.isFinite(Number(pkg.template_count)) ? Math.max(0, Math.round(Number(pkg.template_count))) : 0,
      files: Object.fromEntries(Object.entries(files).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
    }
  };
}

function toRatio(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(1, Math.max(0, parsed));
}

function normalizeV2SemanticAcceptanceReport(value: unknown): V2SemanticAcceptanceReport {
  const root = asRecord(value);
  const thresholds = asRecord(root.thresholds);
  const metrics = asRecord(root.metrics);
  return {
    checked_at: typeof root.checked_at === "string" ? root.checked_at : "",
    pass: Boolean(root.pass),
    failures: asStringArray(root.failures),
    thresholds: {
      min_story_forward_ratio: toRatio(thresholds.min_story_forward_ratio),
      min_hybrid_slide_quality: toRatio(thresholds.min_hybrid_slide_quality),
      min_citation_grounding_coverage: toRatio(thresholds.min_citation_grounding_coverage)
    },
    metrics: {
      main_slide_count: Number.isFinite(Number(metrics.main_slide_count)) ? Math.max(0, Math.round(Number(metrics.main_slide_count))) : 0,
      story_forward_ratio: toRatio(metrics.story_forward_ratio),
      hybrid_slide_quality: toRatio(metrics.hybrid_slide_quality),
      citation_grounding_coverage: toRatio(metrics.citation_grounding_coverage)
    }
  };
}

function toScore0to5(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(5, parsed));
}

function normalizeV2QaReport(value: unknown): V2QaReportPreview {
  const root = asRecord(value);
  const graderScores = Array.isArray(root.grader_scores)
    ? root.grader_scores
        .map((row) => {
          const rec = asRecord(row);
          return {
            category: typeof rec.category === "string" ? rec.category : "",
            score_0_to_5: toScore0to5(rec.score_0_to_5),
            rationale: typeof rec.rationale === "string" ? rec.rationale : "",
            critical: Boolean(rec.critical)
          };
        })
        .filter((row) => row.category.length > 0)
    : [];
  return {
    accept: Boolean(root.accept),
    summary: typeof root.summary === "string" ? root.summary : "",
    required_fix_count: Array.isArray(root.required_fixes) ? root.required_fixes.length : 0,
    narrative_scores: graderScores.filter((row) => V2_NARRATIVE_GRADER_CATEGORIES.has(row.category))
  };
}

function toStageAuthoringSource(value: unknown): V2StageAuthoringSource {
  return value === "deterministic_fallback" ? "deterministic_fallback" : "agent";
}

function normalizeV2StageAuthoringProvenance(value: unknown): V2StageAuthoringProvenancePreview {
  const root = asRecord(value);
  const stages = asRecord(root.stages);
  const asStage = (raw: unknown): { source: V2StageAuthoringSource; reason?: string } => {
    const rec = asRecord(raw);
    return {
      source: toStageAuthoringSource(rec.source),
      reason: typeof rec.reason === "string" ? rec.reason : undefined
    };
  };
  return {
    generation_profile: root.generation_profile === "pilot" ? "pilot" : "quality",
    stages: {
      micro_world_map: asStage(stages.micro_world_map),
      drama_plan: asStage(stages.drama_plan),
      setpiece_plan: asStage(stages.setpiece_plan)
    }
  };
}

function normalizeV2StoryBeatsAlignmentReport(value: unknown): V2StoryBeatsAlignmentPreview {
  const root = asRecord(value);
  const markers = asRecord(root.required_markers);
  const coverage = asRecord(root.coverage);
  const blockCoverageRaw = Array.isArray(root.block_coverage) ? root.block_coverage : [];
  const beatSlideMapRaw = Array.isArray(root.beat_slide_map) ? root.beat_slide_map : [];
  return {
    story_beats_present: Boolean(root.story_beats_present),
    chapter_outline_present: Boolean(root.chapter_outline_present),
    lint_status: root.lint_status === "fail" ? "fail" : root.lint_status === "warn" ? "warn" : "pass",
    warnings: asStringArray(root.warnings),
    required_markers: {
      opener_motif: Boolean(markers.opener_motif),
      midpoint_false_theory_collapse: Boolean(markers.midpoint_false_theory_collapse),
      ending_callback: Boolean(markers.ending_callback),
      detective_deputy_rupture_repair: Boolean(markers.detective_deputy_rupture_repair)
    },
    coverage: {
      total_beats: Number.isFinite(Number(coverage.total_beats)) ? Math.max(0, Math.round(Number(coverage.total_beats))) : 0,
      mapped_beats: Number.isFinite(Number(coverage.mapped_beats)) ? Math.max(0, Math.round(Number(coverage.mapped_beats))) : 0,
      mapped_ratio: toRatio(coverage.mapped_ratio),
      block_aligned_beats:
        Number.isFinite(Number(coverage.block_aligned_beats)) ? Math.max(0, Math.round(Number(coverage.block_aligned_beats))) : 0,
      block_aligned_ratio: toRatio(coverage.block_aligned_ratio)
    },
    block_coverage: blockCoverageRaw.map((item) => {
      const row = asRecord(item);
      return {
        block_id: typeof row.block_id === "string" ? row.block_id : "",
        expected_beats: Number.isFinite(Number(row.expected_beats)) ? Math.max(0, Math.round(Number(row.expected_beats))) : 0,
        mapped_beats: Number.isFinite(Number(row.mapped_beats)) ? Math.max(0, Math.round(Number(row.mapped_beats))) : 0,
        mapped_ratio: toRatio(row.mapped_ratio)
      };
    }).filter((row) => row.block_id.length > 0),
    beat_slide_map: beatSlideMapRaw.map((item) => {
      const row = asRecord(item);
      const expectedAct: "ACT1" | "ACT2" | "ACT3" | "ACT4" | undefined =
        row.expected_act_id === "ACT1" || row.expected_act_id === "ACT2" || row.expected_act_id === "ACT3" || row.expected_act_id === "ACT4"
          ? row.expected_act_id
          : undefined;
      const matchedAct: "ACT1" | "ACT2" | "ACT3" | "ACT4" | undefined =
        row.matched_act_id === "ACT1" || row.matched_act_id === "ACT2" || row.matched_act_id === "ACT3" || row.matched_act_id === "ACT4"
          ? row.matched_act_id
          : undefined;
      return {
        beat_id: typeof row.beat_id === "string" ? row.beat_id : "",
        expected_act_id: expectedAct,
        matched_slide_id: typeof row.matched_slide_id === "string" ? row.matched_slide_id : undefined,
        matched_act_id: matchedAct,
        matched_block_id: typeof row.matched_block_id === "string" ? row.matched_block_id : undefined,
        overlap_ratio: toRatio(row.overlap_ratio),
        overlap_tokens: Number.isFinite(Number(row.overlap_tokens)) ? Math.max(0, Math.round(Number(row.overlap_tokens))) : 0,
        mapped: Boolean(row.mapped),
        block_aligned: Boolean(row.block_aligned)
      };
    }).filter((row) => row.beat_id.length > 0)
  };
}

function normalizeV2NarrativeState(value: unknown): V2NarrativeStatePreview {
  const root = asRecord(value);
  return {
    block_id: typeof root.block_id === "string" ? root.block_id : "",
    current_false_theory: typeof root.current_false_theory === "string" ? root.current_false_theory : "",
    relationship_state_detective_deputy:
      typeof root.relationship_state_detective_deputy === "string" ? root.relationship_state_detective_deputy : "",
    unresolved_emotional_thread: typeof root.unresolved_emotional_thread === "string" ? root.unresolved_emotional_thread : "",
    active_clue_obligations: asStringArray(root.active_clue_obligations),
    active_motif_callback_lexicon: asStringArray(root.active_motif_callback_lexicon),
    pressure_channels: asStringArray(root.pressure_channels),
    recent_slide_excerpts: asStringArray(root.recent_slide_excerpts),
    active_differential_ordering: asStringArray(root.active_differential_ordering),
    delta_from_previous_block: typeof root.delta_from_previous_block === "string" ? root.delta_from_previous_block : ""
  };
}

function normalizeV2AuthoringContextManifest(value: unknown): V2AuthoringContextManifestPreview {
  const root = asRecord(value);
  const attempts = Array.isArray(root.attempts)
    ? root.attempts
        .map((row) => {
          const rec = asRecord(row);
          const contextMode = rec.context_mode === "compact" ? "compact" : "full";
          const result = rec.result === "error" ? "error" : rec.result === "skipped" ? "skipped" : "success";
          return {
            attempt_id: typeof rec.attempt_id === "string" ? rec.attempt_id : "",
            prompt_variant: typeof rec.prompt_variant === "string" ? rec.prompt_variant : "",
            context_mode: contextMode,
            reason: typeof rec.reason === "string" ? rec.reason : "",
            result,
            details: typeof rec.details === "string" ? rec.details : undefined
          } as V2AuthoringContextAttemptPreview;
        })
        .filter((row) => row.attempt_id.length > 0)
    : [];
  return {
    generated_at: typeof root.generated_at === "string" ? root.generated_at : "",
    generation_profile: root.generation_profile === "pilot" ? "pilot" : "quality",
    attempts
  };
}

function normalizeV2BlockRegenTrace(value: unknown): V2BlockRegenTracePreview {
  const root = asRecord(value);
  return {
    loop: Number.isFinite(Number(root.loop)) ? Math.max(0, Math.round(Number(root.loop))) : 0,
    fix_count: Number.isFinite(Number(root.fix_count)) ? Math.max(0, Math.round(Number(root.fix_count))) : 0,
    fix_types: asStringArray(root.fix_types),
    routes: asStringArray(root.routes),
    regenerated_blocks: asStringArray(root.regenerated_blocks),
    warnings: asStringArray(root.warnings)
  };
}

function normalizeV2QaBlockHeatmap(value: unknown): V2QaBlockHeatmapPreview {
  const root = asRecord(value);
  const blocks = Array.isArray(root.blocks)
    ? root.blocks
        .map((entry) => {
          const row = asRecord(entry);
          return {
            block_id: typeof row.block_id === "string" ? row.block_id : "",
            act_id: typeof row.act_id === "string" ? row.act_id : "",
            severity_score: Number.isFinite(Number(row.severity_score)) ? Number(row.severity_score) : 0,
            repeated_template_density:
              Number.isFinite(Number(row.repeated_template_density)) ? Number(row.repeated_template_density) : 0,
            generic_language_rate: Number.isFinite(Number(row.generic_language_rate)) ? Number(row.generic_language_rate) : 0,
            story_forward_deficit_ratio:
              Number.isFinite(Number(row.story_forward_deficit_ratio)) ? Number(row.story_forward_deficit_ratio) : 0,
            hybrid_deficit_ratio: Number.isFinite(Number(row.hybrid_deficit_ratio)) ? Number(row.hybrid_deficit_ratio) : 0,
            clue_twist_debt_count: Number.isFinite(Number(row.clue_twist_debt_count))
              ? Math.max(0, Math.round(Number(row.clue_twist_debt_count)))
              : 0
          };
        })
        .filter((row) => row.block_id.length > 0)
    : [];
  return {
    loop: Number.isFinite(Number(root.loop)) ? Math.max(0, Math.round(Number(root.loop))) : 0,
    blocks
  };
}

function normalizeV2NarrativeIntensifierPass(value: unknown): V2NarrativeIntensifierPassPreview {
  const root = asRecord(value);
  const operations = Array.isArray(root.operations)
    ? root.operations
        .map((entry) => {
          const row = asRecord(entry);
          return {
            op: typeof row.op === "string" ? row.op : "",
            reason: typeof row.reason === "string" ? row.reason : undefined,
            slide_id: typeof row.slide_id === "string" ? row.slide_id : undefined,
            after_slide_id: typeof row.after_slide_id === "string" ? row.after_slide_id : undefined,
            start_slide_id: typeof row.start_slide_id === "string" ? row.start_slide_id : undefined,
            end_slide_id: typeof row.end_slide_id === "string" ? row.end_slide_id : undefined
          };
        })
        .filter((row) => row.op.length > 0)
    : [];
  return {
    global_intensity_findings: asStringArray(root.global_intensity_findings),
    narrative_rationale: asStringArray(root.narrative_rationale),
    target_block_ids: asStringArray(root.target_block_ids),
    operations
  };
}

function normalizeV2DiseaseResearchSourceReport(value: unknown): V2DiseaseResearchSourceReportPreview {
  const root = asRecord(value);
  const sections = Array.isArray(root.sections)
    ? root.sections
        .map((entry) => {
          const row = asRecord(entry);
          const dominantSource: "curated" | "web" | "mixed" =
            row.dominant_source === "web" || row.dominant_source === "mixed" ? row.dominant_source : "curated";
          return {
            section: typeof row.section === "string" ? row.section : "",
            curated_citations: Number.isFinite(Number(row.curated_citations)) ? Math.max(0, Math.round(Number(row.curated_citations))) : 0,
            web_citations: Number.isFinite(Number(row.web_citations)) ? Math.max(0, Math.round(Number(row.web_citations))) : 0,
            dominant_source: dominantSource,
            fallback_reason: typeof row.fallback_reason === "string" ? row.fallback_reason : undefined
          };
        })
        .filter((row) => row.section.length > 0)
    : [];
  return {
    topic: typeof root.topic === "string" ? root.topic : "",
    sections
  };
}

function regenTraceLoopFromName(name: string): number {
  const match = name.match(/block_regen_trace_loop(\d+)\.json$/i);
  if (!match?.[1]) return -1;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : -1;
}

function qaHeatmapLoopFromName(name: string): number {
  const match = name.match(/qa_block_heatmap_loop(\d+)\.json$/i);
  if (!match?.[1]) return -1;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : -1;
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

function formatRatioAsPercent(value: number): string {
  const clamped = Math.max(0, Math.min(1, value));
  return `${Math.round(clamped * 100)}%`;
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

function liveFeedBadgeClass(state: LiveFeedState): string {
  if (state === "connected") return "badge badgeOk";
  if (state === "reconnecting") return "badge badgeWarn";
  if (state === "connecting") return "badge";
  return "badge badgeErr";
}

function liveFeedLabel(state: LiveFeedState): string {
  if (state === "connected") return "live";
  if (state === "reconnecting") return "reconnecting";
  if (state === "connecting") return "connecting";
  return "offline";
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
  normalizeV2SemanticAcceptanceReport,
  normalizeV2QaReport,
  normalizeV2StageAuthoringProvenance,
  normalizeV2StoryBeatsAlignmentReport,
  normalizeV2NarrativeState,
  normalizeV2AuthoringContextManifest,
  normalizeV2BlockRegenTrace,
  normalizeV2QaBlockHeatmap,
  normalizeV2NarrativeIntensifierPass,
  normalizeV2DiseaseResearchSourceReport,
  regenTraceLoopFromName,
  qaHeatmapLoopFromName,
  extractKeyOrFallback,
  formatTime,
  parseIsoMs,
  formatElapsed,
  clampWatchdogThresholdSeconds,
  initialWatchdogThresholdSeconds,
  statusBadgeClass,
  constraintBadgeClass,
  liveFeedBadgeClass,
  liveFeedLabel
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
  const [v2PackagingSummaryPreview, setV2PackagingSummaryPreview] = useState<V2PackagingSummaryPreview | null>(null);
  const [v2SemanticReportPreview, setV2SemanticReportPreview] = useState<V2SemanticAcceptanceReport | null>(null);
  const [v2QaReportPreview, setV2QaReportPreview] = useState<V2QaReportPreview | null>(null);
  const [v2StageProvenancePreview, setV2StageProvenancePreview] = useState<V2StageAuthoringProvenancePreview | null>(null);
  const [v2StoryBeatsAlignmentPreview, setV2StoryBeatsAlignmentPreview] = useState<V2StoryBeatsAlignmentPreview | null>(null);
  const [v2NarrativeStatePreview, setV2NarrativeStatePreview] = useState<V2NarrativeStatePreview | null>(null);
  const [v2AuthoringContextManifestPreview, setV2AuthoringContextManifestPreview] = useState<V2AuthoringContextManifestPreview | null>(null);
  const [v2BlockRegenTracePreview, setV2BlockRegenTracePreview] = useState<V2BlockRegenTracePreview | null>(null);
  const [v2QaBlockHeatmapPreview, setV2QaBlockHeatmapPreview] = useState<V2QaBlockHeatmapPreview | null>(null);
  const [v2NarrativeIntensifierPreview, setV2NarrativeIntensifierPreview] =
    useState<V2NarrativeIntensifierPassPreview | null>(null);
  const [v2DiseaseResearchSourceReportPreview, setV2DiseaseResearchSourceReportPreview] =
    useState<V2DiseaseResearchSourceReportPreview | null>(null);
  const [v2LatestRegenTraceName, setV2LatestRegenTraceName] = useState<string>("");
  const [v2LatestQaHeatmapName, setV2LatestQaHeatmapName] = useState<string>("");
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
  const [liveFeedState, setLiveFeedState] = useState<LiveFeedState>("connecting");
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
  const v2RegenTraceNames = useMemo(
    () =>
      artifacts
        .map((a) => a.name)
        .filter((name) => /block_regen_trace_loop\d+\.json$/i.test(name))
        .sort((a, b) => regenTraceLoopFromName(b) - regenTraceLoopFromName(a)),
    [artifacts]
  );
  const gateHistoryRows = gateHistory?.history ?? [];
  const gate3SemanticBlocked =
    run?.activeGate?.gateId === "GATE_3_STORYBOARD" && v2SemanticReportPreview !== null && !v2SemanticReportPreview.pass;

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
    setLiveFeedState("connecting");

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
    const hasPackagingSummary = artifacts.some(
      (a) => a.name === "V2_PACKAGING_SUMMARY.json" || a.name === "v2_phase4_packaging_summary.json"
    );
    const hasSemanticReport = artifacts.some((a) => a.name === "semantic_acceptance_report.json");
    const hasQaReport = artifacts.some((a) => a.name === "qa_report.json");
    const hasStageProvenance = artifacts.some((a) => a.name === "v2_stage_authoring_provenance.json");
    const hasStoryBeatsAlignment = artifacts.some((a) => a.name === "story_beats_alignment_report.json");
    const hasNarrativeState = artifacts.some((a) => a.name === "narrative_state_current.json");
    const hasAuthoringContextManifest = artifacts.some((a) => a.name === "deck_authoring_context_manifest.json");
    const hasNarrativeIntensifier = artifacts.some((a) => a.name === "narrative_intensifier_pass.json");
    const hasDiseaseResearchSourceReport = artifacts.some((a) => a.name === "disease_research_source_report.json");
    const latestRegenTraceName = artifacts
      .map((a) => a.name)
      .filter((name) => /block_regen_trace_loop\d+\.json$/i.test(name))
      .sort((a, b) => regenTraceLoopFromName(b) - regenTraceLoopFromName(a))[0] ?? null;
    const latestQaHeatmapName = artifacts
      .map((a) => a.name)
      .filter((name) => /qa_block_heatmap_loop\d+\.json$/i.test(name))
      .sort((a, b) => qaHeatmapLoopFromName(b) - qaHeatmapLoopFromName(a))[0] ?? null;

    if (!safeRunId || workflow !== "v2_micro_detectives" || !hasDeckSpec) {
      setV2DeckSpecPreview(null);
      setV2TemplateRegistryPreview(null);
      setV2ClueGraphPreview(null);
      setV2MicroWorldPreview(null);
      setV2DramaPlanPreview(null);
      setV2SetpiecePlanPreview(null);
      setV2PackagingSummaryPreview(null);
      setV2SemanticReportPreview(null);
      setV2QaReportPreview(null);
      setV2StageProvenancePreview(null);
      setV2StoryBeatsAlignmentPreview(null);
      setV2NarrativeStatePreview(null);
      setV2AuthoringContextManifestPreview(null);
      setV2BlockRegenTracePreview(null);
      setV2QaBlockHeatmapPreview(null);
      setV2NarrativeIntensifierPreview(null);
      setV2DiseaseResearchSourceReportPreview(null);
      setV2LatestRegenTraceName("");
      setV2LatestQaHeatmapName("");
      setV2DrilldownErr(null);
      setV2DrilldownBusy(false);
      return;
    }

    let cancelled = false;
    setV2DrilldownBusy(true);
    setV2DrilldownErr(null);

    void (async () => {
      try {
        const [
          deckRaw,
          templateRaw,
          clueRaw,
          microWorldRaw,
          dramaRaw,
          setpieceRaw,
          packagingRaw,
          semanticRaw,
          qaRaw,
          stageProvenanceRaw,
          storyBeatsAlignmentRaw,
          narrativeStateRaw,
          authoringContextRaw,
          latestRegenTraceRaw,
          latestQaHeatmapRaw,
          narrativeIntensifierRaw,
          diseaseResearchSourceRaw
        ] = await Promise.all([
          fetchArtifact(safeRunId, "deck_spec.json"),
          hasTemplateRegistry ? fetchArtifact(safeRunId, "v2_template_registry.json") : Promise.resolve(null),
          hasClueGraph ? fetchArtifact(safeRunId, "clue_graph.json") : Promise.resolve(null),
          hasMicroWorld ? fetchArtifact(safeRunId, "micro_world_map.json") : Promise.resolve(null),
          hasDramaPlan ? fetchArtifact(safeRunId, "drama_plan.json") : Promise.resolve(null),
          hasSetpiecePlan ? fetchArtifact(safeRunId, "setpiece_plan.json") : Promise.resolve(null),
          hasPackagingSummary
            ? fetchArtifact(
                safeRunId,
                artifacts.some((item) => item.name === "V2_PACKAGING_SUMMARY.json")
                  ? "V2_PACKAGING_SUMMARY.json"
                  : "v2_phase4_packaging_summary.json"
              )
            : Promise.resolve(null),
          hasSemanticReport ? fetchArtifact(safeRunId, "semantic_acceptance_report.json") : Promise.resolve(null),
          hasQaReport ? fetchArtifact(safeRunId, "qa_report.json") : Promise.resolve(null),
          hasStageProvenance ? fetchArtifact(safeRunId, "v2_stage_authoring_provenance.json") : Promise.resolve(null),
          hasStoryBeatsAlignment ? fetchArtifact(safeRunId, "story_beats_alignment_report.json") : Promise.resolve(null),
          hasNarrativeState ? fetchArtifact(safeRunId, "narrative_state_current.json") : Promise.resolve(null),
          hasAuthoringContextManifest ? fetchArtifact(safeRunId, "deck_authoring_context_manifest.json") : Promise.resolve(null),
          latestRegenTraceName ? fetchArtifact(safeRunId, latestRegenTraceName) : Promise.resolve(null),
          latestQaHeatmapName ? fetchArtifact(safeRunId, latestQaHeatmapName) : Promise.resolve(null),
          hasNarrativeIntensifier ? fetchArtifact(safeRunId, "narrative_intensifier_pass.json") : Promise.resolve(null),
          hasDiseaseResearchSourceReport ? fetchArtifact(safeRunId, "disease_research_source_report.json") : Promise.resolve(null)
        ]);
        if (cancelled) return;

        const deckParsed = normalizeV2DeckSpec(parseJsonOrThrow(deckRaw.text));
        const templateParsed = templateRaw ? normalizeV2TemplateRegistry(parseJsonOrThrow(templateRaw.text)) : null;
        const clueParsed = clueRaw ? normalizeV2ClueGraph(parseJsonOrThrow(clueRaw.text)) : null;
        const microWorldParsed = microWorldRaw ? normalizeV2MicroWorldMap(parseJsonOrThrow(microWorldRaw.text)) : null;
        const dramaParsed = dramaRaw ? normalizeV2DramaPlan(parseJsonOrThrow(dramaRaw.text)) : null;
        const setpieceParsed = setpieceRaw ? normalizeV2SetpiecePlan(parseJsonOrThrow(setpieceRaw.text)) : null;
        const packagingParsed = packagingRaw ? normalizeV2PackagingSummary(parseJsonOrThrow(packagingRaw.text)) : null;
        const semanticParsed = semanticRaw ? normalizeV2SemanticAcceptanceReport(parseJsonOrThrow(semanticRaw.text)) : null;
        const qaParsed = qaRaw ? normalizeV2QaReport(parseJsonOrThrow(qaRaw.text)) : null;
        const stageProvenanceParsed = stageProvenanceRaw
          ? normalizeV2StageAuthoringProvenance(parseJsonOrThrow(stageProvenanceRaw.text))
          : null;
        const storyBeatsAlignmentParsed = storyBeatsAlignmentRaw
          ? normalizeV2StoryBeatsAlignmentReport(parseJsonOrThrow(storyBeatsAlignmentRaw.text))
          : null;
        const narrativeStateParsed = narrativeStateRaw
          ? normalizeV2NarrativeState(parseJsonOrThrow(narrativeStateRaw.text))
          : null;
        const authoringContextParsed = authoringContextRaw
          ? normalizeV2AuthoringContextManifest(parseJsonOrThrow(authoringContextRaw.text))
          : null;
        const blockRegenTraceParsed = latestRegenTraceRaw
          ? normalizeV2BlockRegenTrace(parseJsonOrThrow(latestRegenTraceRaw.text))
          : null;
        const qaBlockHeatmapParsed = latestQaHeatmapRaw
          ? normalizeV2QaBlockHeatmap(parseJsonOrThrow(latestQaHeatmapRaw.text))
          : null;
        const narrativeIntensifierParsed = narrativeIntensifierRaw
          ? normalizeV2NarrativeIntensifierPass(parseJsonOrThrow(narrativeIntensifierRaw.text))
          : null;
        const diseaseResearchSourceParsed = diseaseResearchSourceRaw
          ? normalizeV2DiseaseResearchSourceReport(parseJsonOrThrow(diseaseResearchSourceRaw.text))
          : null;

        setV2DeckSpecPreview(deckParsed);
        setV2TemplateRegistryPreview(templateParsed);
        setV2ClueGraphPreview(clueParsed);
        setV2MicroWorldPreview(microWorldParsed);
        setV2DramaPlanPreview(dramaParsed);
        setV2SetpiecePlanPreview(setpieceParsed);
        setV2PackagingSummaryPreview(packagingParsed);
        setV2SemanticReportPreview(semanticParsed);
        setV2QaReportPreview(qaParsed);
        setV2StageProvenancePreview(stageProvenanceParsed);
        setV2StoryBeatsAlignmentPreview(storyBeatsAlignmentParsed);
        setV2NarrativeStatePreview(narrativeStateParsed);
        setV2AuthoringContextManifestPreview(authoringContextParsed);
        setV2BlockRegenTracePreview(blockRegenTraceParsed);
        setV2QaBlockHeatmapPreview(qaBlockHeatmapParsed);
        setV2NarrativeIntensifierPreview(narrativeIntensifierParsed);
        setV2DiseaseResearchSourceReportPreview(diseaseResearchSourceParsed);
        setV2LatestRegenTraceName(latestRegenTraceName ?? "");
        setV2LatestQaHeatmapName(latestQaHeatmapName ?? "");
        setV2DrilldownErr(null);
      } catch (e) {
        if (cancelled) return;
        setV2DeckSpecPreview(null);
        setV2TemplateRegistryPreview(null);
        setV2ClueGraphPreview(null);
        setV2MicroWorldPreview(null);
        setV2DramaPlanPreview(null);
        setV2SetpiecePlanPreview(null);
        setV2PackagingSummaryPreview(null);
        setV2SemanticReportPreview(null);
        setV2QaReportPreview(null);
        setV2StageProvenancePreview(null);
        setV2StoryBeatsAlignmentPreview(null);
        setV2NarrativeStatePreview(null);
        setV2AuthoringContextManifestPreview(null);
        setV2BlockRegenTracePreview(null);
        setV2QaBlockHeatmapPreview(null);
        setV2NarrativeIntensifierPreview(null);
        setV2DiseaseResearchSourceReportPreview(null);
        setV2LatestRegenTraceName("");
        setV2LatestQaHeatmapName("");
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
    if (!gate3SemanticBlocked) return;
    if (gateDecision === "approve") setGateDecision("regenerate");
  }, [gate3SemanticBlocked, gateDecision]);

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

    setLiveFeedState("connecting");
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

    es.addEventListener("deckspec_estimate", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as NonNullable<RunStatus["v2DeckSpecEstimate"]>;
        setRun((prev) => (prev ? { ...prev, v2DeckSpecEstimate: data } : prev));
        const deckPolicy = data.deckLengthPolicy === "soft_target" ? `soft target ${String(data.softTarget ?? "?")}` : "unconstrained";
        pushLog(
          `[C] DeckSpec estimate: ${String(data.estimatedMainSlides)} slides (${deckPolicy}), timeouts agent=${String(data.adaptiveTimeoutMs.agent)}ms deckspec=${String(data.adaptiveTimeoutMs.deckSpec)}ms watchdog=${String(data.adaptiveTimeoutMs.watchdog)}ms`
        );
      } catch {
        pushLog("deckspec_estimate (unparseable)");
      }
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

    es.onopen = () => {
      setLiveFeedState("connected");
    };

    es.onerror = () => {
      setLiveFeedState((prev) => (prev === "connected" ? "reconnecting" : "offline"));
      pushLog("SSE connection error (will auto-retry)");
    };

    return () => {
      es.close();
      esRef.current = null;
      setLiveFeedState("offline");
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
      const message = e instanceof Error ? e.message : String(e);
      setGateErr(message);
      if (message.toLowerCase().includes("semantic acceptance gate failed")) {
        setGateRecoveryHint("Gate 3 approval is blocked by semantic acceptance checks. Submit regenerate, then Resume run.");
      }
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
      const message = e instanceof Error ? e.message : String(e);
      setGateErr(message);
      if (message.includes("request_changes")) {
        setGateRecoveryHint("This run is still in request_changes. Submit approve or regenerate, then click Resume run.");
      } else if (message.includes("no submitted review")) {
        setGateRecoveryHint("Submit a gate decision first, then resume.");
      } else if (message.includes("not paused")) {
        setGateRecoveryHint("Resume is only available while the run is paused at an active gate.");
      } else if (message.toLowerCase().includes("semantic acceptance gate failed")) {
        setGateRecoveryHint("Semantic acceptance failed. Use regenerate at Gate 3 to rebuild C artifacts before resume.");
      }
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
                  <span className={liveFeedBadgeClass(liveFeedState)}>events: {liveFeedLabel(liveFeedState)}</span>
                  {run.activeGate?.gateId && <span className="badge badgeWarn">gate: {run.activeGate.gateId}</span>}
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

                <Link className="buttonLink" to={`/runs/${safeRunId}/artifacts`}>
                  Artifact vault
                </Link>

                {workflow === "v2_micro_detectives" && (
                  <Link className="buttonLink" to={`/runs/${safeRunId}/workshop`}>
                    Beat workshop
                  </Link>
                )}

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
                {gate3SemanticBlocked && (
                  <div className="runSemanticGateAlert">
                    <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                      <span className="badge badgeErr">Semantic acceptance failed</span>
                      <span className="mono subtle">Approve is disabled until you regenerate/fix C artifacts.</span>
                    </div>
                    <ul className="diagnosticList" style={{ marginTop: 8 }}>
                      {v2SemanticReportPreview.failures.map((failure, idx) => (
                        <li key={`semantic-gate-failure-${idx}`}>{failure}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="gateDecisionGuide">
                  <div className="gateDecisionGuideItem">
                    <span className="badge badgeOk">approve</span>
                    <span className="subtle">Continue from resumeFrom.</span>
                  </div>
                  <div className="gateDecisionGuideItem">
                    <span className="badge badgeWarn">regenerate</span>
                    <span className="subtle">Restart from gate-owning step with your notes applied.</span>
                  </div>
                  <div className="gateDecisionGuideItem">
                    <span className="badge">request_changes</span>
                    <span className="subtle">Keep paused until you submit approve or regenerate.</span>
                  </div>
                </div>
                <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                  <div>
                    <div className="subtle">Decision</div>
                    <select aria-label="Gate decision" value={gateDecision} onChange={(e) => setGateDecision(e.target.value as typeof gateDecision)}>
                      <option value="approve" disabled={gate3SemanticBlocked}>
                        approve
                      </option>
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

          {workflow === "v2_micro_detectives" && (
            <div className="panel runGateCard">
              <div className="panelHeader">
                <div style={{ fontWeight: 600 }}>V2 semantic acceptance</div>
              </div>
              <div className="panelBody">
                {!v2SemanticReportPreview && <div className="subtle">No semantic_acceptance_report.json artifact yet.</div>}
                {v2SemanticReportPreview && (
                  <div className="summaryCardList">
                    <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                      <span className={v2SemanticReportPreview.pass ? "badge badgeOk" : "badge badgeErr"}>
                        {v2SemanticReportPreview.pass ? "pass" : "fail"}
                      </span>
                      <span className="mono subtle">{formatTime(v2SemanticReportPreview.checked_at)}</span>
                    </div>
                    <div className="diagnosticKv">
                      <div>main slides</div>
                      <div className="mono">{v2SemanticReportPreview.metrics.main_slide_count}</div>
                      <div>story-forward ratio</div>
                      <div className="mono">
                        {formatRatioAsPercent(v2SemanticReportPreview.metrics.story_forward_ratio)} / min{" "}
                        {formatRatioAsPercent(v2SemanticReportPreview.thresholds.min_story_forward_ratio)}
                      </div>
                      <div>hybrid slide quality</div>
                      <div className="mono">
                        {formatRatioAsPercent(v2SemanticReportPreview.metrics.hybrid_slide_quality)} / min{" "}
                        {formatRatioAsPercent(v2SemanticReportPreview.thresholds.min_hybrid_slide_quality)}
                      </div>
                      <div>citation grounding coverage</div>
                      <div className="mono">
                        {formatRatioAsPercent(v2SemanticReportPreview.metrics.citation_grounding_coverage)} / min{" "}
                        {formatRatioAsPercent(v2SemanticReportPreview.thresholds.min_citation_grounding_coverage)}
                      </div>
                    </div>
                    <details className="diagnosticDetails" open={!v2SemanticReportPreview.pass}>
                      <summary>Failures ({v2SemanticReportPreview.failures.length})</summary>
                      {v2SemanticReportPreview.failures.length === 0 ? (
                        <div className="subtle">none</div>
                      ) : (
                        <ul className="diagnosticList">
                          {v2SemanticReportPreview.failures.map((failure, idx) => (
                            <li key={`semantic-failure-${idx}`}>{failure}</li>
                          ))}
                        </ul>
                      )}
                    </details>
                  </div>
                )}
              </div>
            </div>
          )}

          {workflow === "v2_micro_detectives" && (
            <div className="panel runGateCard">
              <div className="panelHeader">
                <div style={{ fontWeight: 600 }}>V2 narrative grader</div>
              </div>
              <div className="panelBody">
                {!v2QaReportPreview && <div className="subtle">No qa_report.json artifact yet.</div>}
                {v2QaReportPreview && (
                  <div className="summaryCardList">
                    <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                      <span className={v2QaReportPreview.accept ? "badge badgeOk" : "badge badgeErr"}>
                        {v2QaReportPreview.accept ? "qa accept" : "qa reject"}
                      </span>
                      <span className="badge">required fixes: {v2QaReportPreview.required_fix_count}</span>
                    </div>
                    <div className="summaryText">{v2QaReportPreview.summary || "No QA summary text."}</div>
                    <details className="diagnosticDetails" open>
                      <summary>Narrative scores ({v2QaReportPreview.narrative_scores.length})</summary>
                      {v2QaReportPreview.narrative_scores.length === 0 ? (
                        <div className="subtle">No narrative-grade categories present in qa_report.json.</div>
                      ) : (
                        <div className="diagnosticKv">
                          {v2QaReportPreview.narrative_scores.map((score) => (
                            <Fragment key={score.category}>
                              <div>
                                {score.category}
                                {score.critical ? " (critical)" : ""}
                              </div>
                              <div className="mono">{score.score_0_to_5.toFixed(2)} / 5</div>
                            </Fragment>
                          ))}
                        </div>
                      )}
                    </details>
                  </div>
                )}
              </div>
            </div>
          )}

          {workflow === "v2_micro_detectives" && (
            <div className="panel runGateCard">
              <div className="panelHeader">
                <div style={{ fontWeight: 600 }}>V2 stage provenance</div>
              </div>
              <div className="panelBody">
                {!v2StageProvenancePreview && <div className="subtle">No v2_stage_authoring_provenance.json artifact yet.</div>}
                {v2StageProvenancePreview && (
                  <div className="summaryCardList">
                    <div className="diagnosticPanelLead">Writer&apos;s-room source integrity for authored story-planning artifacts.</div>
                    <div className="diagnosticOverviewGrid">
                      <div className="diagnosticOverviewCard">
                        <div className="diagnosticOverviewLabel">profile</div>
                        <div className="diagnosticOverviewValue mono">{v2StageProvenancePreview.generation_profile}</div>
                      </div>
                      <div className="diagnosticOverviewCard">
                        <div className="diagnosticOverviewLabel">overall source</div>
                        <div
                          className={`diagnosticOverviewValue ${
                            [
                              v2StageProvenancePreview.stages.micro_world_map.source,
                              v2StageProvenancePreview.stages.drama_plan.source,
                              v2StageProvenancePreview.stages.setpiece_plan.source
                            ].every((source) => source === "agent")
                              ? "statusOk"
                              : "statusWarn"
                          }`}
                        >
                          {[
                            v2StageProvenancePreview.stages.micro_world_map.source,
                            v2StageProvenancePreview.stages.drama_plan.source,
                            v2StageProvenancePreview.stages.setpiece_plan.source
                          ].filter((source) => source !== "agent").length === 0
                            ? "agent-authored"
                            : "fallback detected"}
                        </div>
                      </div>
                      <div className="diagnosticOverviewCard">
                        <div className="diagnosticOverviewLabel">micro world map</div>
                        <div className="diagnosticOverviewValue mono">{v2StageProvenancePreview.stages.micro_world_map.source}</div>
                      </div>
                      <div className="diagnosticOverviewCard">
                        <div className="diagnosticOverviewLabel">drama plan</div>
                        <div className="diagnosticOverviewValue mono">{v2StageProvenancePreview.stages.drama_plan.source}</div>
                      </div>
                      <div className="diagnosticOverviewCard">
                        <div className="diagnosticOverviewLabel">setpiece plan</div>
                        <div className="diagnosticOverviewValue mono">{v2StageProvenancePreview.stages.setpiece_plan.source}</div>
                      </div>
                    </div>
                    <details className="diagnosticDetails">
                      <summary>Fallback reasons</summary>
                      <ul className="diagnosticList">
                        <li>micro_world_map: {v2StageProvenancePreview.stages.micro_world_map.reason ?? "none"}</li>
                        <li>drama_plan: {v2StageProvenancePreview.stages.drama_plan.reason ?? "none"}</li>
                        <li>setpiece_plan: {v2StageProvenancePreview.stages.setpiece_plan.reason ?? "none"}</li>
                      </ul>
                    </details>
                  </div>
                )}
              </div>
            </div>
          )}

          {workflow === "v2_micro_detectives" && (
            <div className="panel runGateCard">
              <div className="panelHeader">
                <div style={{ fontWeight: 600 }}>Story beats alignment</div>
              </div>
              <div className="panelBody">
                {!v2StoryBeatsAlignmentPreview && <div className="subtle">No story_beats_alignment_report.json artifact yet.</div>}
                {v2StoryBeatsAlignmentPreview && (
                  <div className="summaryCardList">
                    <div className="diagnosticPanelLead">Beat-workshop guidance coverage, contract markers, and block mapping health.</div>
                    <div className="diagnosticOverviewGrid">
                      <div className="diagnosticOverviewCard">
                        <div className="diagnosticOverviewLabel">lint status</div>
                        <div
                          className={`diagnosticOverviewValue ${
                            v2StoryBeatsAlignmentPreview.lint_status === "fail"
                              ? "statusErr"
                              : v2StoryBeatsAlignmentPreview.lint_status === "warn"
                                ? "statusWarn"
                                : "statusOk"
                          }`}
                        >
                          {v2StoryBeatsAlignmentPreview.lint_status}
                        </div>
                      </div>
                      <div className="diagnosticOverviewCard">
                        <div className="diagnosticOverviewLabel">story inputs</div>
                        <div className="diagnosticOverviewValue mono">
                          beats: {v2StoryBeatsAlignmentPreview.story_beats_present ? "present" : "absent"} · outline:{" "}
                          {v2StoryBeatsAlignmentPreview.chapter_outline_present ? "present" : "absent"}
                        </div>
                      </div>
                      <div className="diagnosticOverviewCard">
                        <div className="diagnosticOverviewLabel">mapped beats</div>
                        <div className="diagnosticOverviewValue mono">
                          {v2StoryBeatsAlignmentPreview.coverage.mapped_beats}/{v2StoryBeatsAlignmentPreview.coverage.total_beats} (
                          {formatRatioAsPercent(v2StoryBeatsAlignmentPreview.coverage.mapped_ratio)})
                        </div>
                      </div>
                      <div className="diagnosticOverviewCard">
                        <div className="diagnosticOverviewLabel">block alignment</div>
                        <div className="diagnosticOverviewValue mono">
                          {v2StoryBeatsAlignmentPreview.coverage.block_aligned_beats}/{v2StoryBeatsAlignmentPreview.coverage.total_beats} (
                          {formatRatioAsPercent(v2StoryBeatsAlignmentPreview.coverage.block_aligned_ratio)})
                        </div>
                      </div>
                      <div className="diagnosticOverviewCard">
                        <div className="diagnosticOverviewLabel">opener motif</div>
                        <div className="diagnosticOverviewValue mono">
                          {v2StoryBeatsAlignmentPreview.required_markers.opener_motif ? "yes" : "no"}
                        </div>
                      </div>
                      <div className="diagnosticOverviewCard">
                        <div className="diagnosticOverviewLabel">midpoint collapse</div>
                        <div className="diagnosticOverviewValue mono">
                          {v2StoryBeatsAlignmentPreview.required_markers.midpoint_false_theory_collapse ? "yes" : "no"}
                        </div>
                      </div>
                      <div className="diagnosticOverviewCard">
                        <div className="diagnosticOverviewLabel">ending callback</div>
                        <div className="diagnosticOverviewValue mono">
                          {v2StoryBeatsAlignmentPreview.required_markers.ending_callback ? "yes" : "no"}
                        </div>
                      </div>
                      <div className="diagnosticOverviewCard">
                        <div className="diagnosticOverviewLabel">rupture + repair</div>
                        <div className="diagnosticOverviewValue mono">
                          {v2StoryBeatsAlignmentPreview.required_markers.detective_deputy_rupture_repair ? "yes" : "no"}
                        </div>
                      </div>
                    </div>
                    <details className="diagnosticDetails">
                      <summary>Block coverage ({v2StoryBeatsAlignmentPreview.block_coverage.length})</summary>
                      {v2StoryBeatsAlignmentPreview.block_coverage.length === 0 ? (
                        <div className="subtle">No block coverage map available.</div>
                      ) : (
                        <div className="diagnosticKv">
                          {v2StoryBeatsAlignmentPreview.block_coverage.map((row) => (
                            <Fragment key={`block-coverage-${row.block_id}`}>
                              <div>{row.block_id}</div>
                              <div className="mono">
                                {row.mapped_beats}/{row.expected_beats} ({formatRatioAsPercent(row.mapped_ratio)})
                              </div>
                            </Fragment>
                          ))}
                        </div>
                      )}
                    </details>
                    <details className="diagnosticDetails">
                      <summary>Beat-to-slide map ({v2StoryBeatsAlignmentPreview.beat_slide_map.length})</summary>
                      {v2StoryBeatsAlignmentPreview.beat_slide_map.length === 0 ? (
                        <div className="subtle">No beat-to-slide mappings found.</div>
                      ) : (
                        <div className="diagnosticKv">
                          {v2StoryBeatsAlignmentPreview.beat_slide_map.slice(0, 14).map((row) => (
                            <Fragment key={`beat-slide-map-${row.beat_id}`}>
                              <div>{row.beat_id}</div>
                              <div className="mono">
                                {row.matched_slide_id ?? "unmapped"} · {row.matched_act_id ?? "n/a"} ·{" "}
                                {row.block_aligned ? "aligned" : "off-block"} · {formatRatioAsPercent(row.overlap_ratio)}
                              </div>
                            </Fragment>
                          ))}
                        </div>
                      )}
                    </details>
                    <details className="diagnosticDetails" open={v2StoryBeatsAlignmentPreview.warnings.length > 0}>
                      <summary>Warnings ({v2StoryBeatsAlignmentPreview.warnings.length})</summary>
                      {v2StoryBeatsAlignmentPreview.warnings.length === 0 ? (
                        <div className="subtle">none</div>
                      ) : (
                        <ul className="diagnosticList">
                          {v2StoryBeatsAlignmentPreview.warnings.map((warning, idx) => (
                            <li key={`story-beats-warning-${idx}`}>{warning}</li>
                          ))}
                        </ul>
                      )}
                    </details>
                  </div>
                )}
              </div>
            </div>
          )}

          {workflow === "v2_micro_detectives" && (
            <div className="panel runGateCard">
              <div className="panelHeader">
                <div style={{ fontWeight: 600 }}>V2 block authoring diagnostics</div>
              </div>
              <div className="panelBody">
                {!v2NarrativeStatePreview && !v2AuthoringContextManifestPreview && !v2BlockRegenTracePreview && (
                  <div className="subtle">No NarrativeState/context/regen-trace diagnostics artifacts yet.</div>
                )}
                {(v2NarrativeStatePreview || v2AuthoringContextManifestPreview || v2BlockRegenTracePreview) && (
                  <div className="summaryCardList">
                    <div className="diagnosticPanelLead">Continuity memory, prompt-context selection, and structural rewrite traces for the current run.</div>
                    <div className="diagnosticOverviewGrid">
                      <div className="diagnosticOverviewCard">
                        <div className="diagnosticOverviewLabel">narrative state</div>
                        <div className={`diagnosticOverviewValue ${v2NarrativeStatePreview ? "statusOk" : "statusMuted"}`}>
                          narrative_state_current: {v2NarrativeStatePreview ? "present" : "missing"}
                        </div>
                      </div>
                      <div className="diagnosticOverviewCard">
                        <div className="diagnosticOverviewLabel">context manifest</div>
                        <div className={`diagnosticOverviewValue ${v2AuthoringContextManifestPreview ? "statusOk" : "statusMuted"}`}>
                          authoring_context_manifest: {v2AuthoringContextManifestPreview ? "present" : "missing"}
                        </div>
                      </div>
                      <div className="diagnosticOverviewCard">
                        <div className="diagnosticOverviewLabel">regen trace</div>
                        <div className={`diagnosticOverviewValue ${v2BlockRegenTracePreview ? "statusOk" : "statusMuted"}`}>
                          regen_trace: {v2BlockRegenTracePreview ? "present" : "missing"}
                        </div>
                      </div>
                      <div className="diagnosticOverviewCard">
                        <div className="diagnosticOverviewLabel">regen traces total</div>
                        <div className="diagnosticOverviewValue mono">{v2RegenTraceNames.length}</div>
                      </div>
                    </div>

                    {v2NarrativeStatePreview && (
                      <details className="diagnosticDetails" open>
                        <summary>Narrative state ({v2NarrativeStatePreview.block_id || "unknown block"})</summary>
                        <div className="diagnosticKv">
                          <div>current false theory</div>
                          <div className="mono">{v2NarrativeStatePreview.current_false_theory || "-"}</div>
                          <div>relationship state</div>
                          <div className="mono">{v2NarrativeStatePreview.relationship_state_detective_deputy || "-"}</div>
                          <div>unresolved emotional thread</div>
                          <div className="mono">{v2NarrativeStatePreview.unresolved_emotional_thread || "-"}</div>
                          <div>clue obligations</div>
                          <div className="mono">{v2NarrativeStatePreview.active_clue_obligations.length}</div>
                          <div>pressure channels</div>
                          <div className="mono">{v2NarrativeStatePreview.pressure_channels.length}</div>
                          <div>active differentials</div>
                          <div className="mono">{v2NarrativeStatePreview.active_differential_ordering.length}</div>
                        </div>
                        {v2NarrativeStatePreview.recent_slide_excerpts.length > 0 && (
                          <details className="diagnosticDetails">
                            <summary>Recent slide excerpts ({v2NarrativeStatePreview.recent_slide_excerpts.length})</summary>
                            <ul className="diagnosticList">
                              {v2NarrativeStatePreview.recent_slide_excerpts.map((excerpt, idx) => (
                                <li key={`narrative-excerpt-${idx}`}>{excerpt}</li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </details>
                    )}

                    {v2AuthoringContextManifestPreview && (
                      <details className="diagnosticDetails" open>
                        <summary>Authoring context manifest</summary>
                        <div className="diagnosticKv">
                          <div>profile</div>
                          <div className="mono">{v2AuthoringContextManifestPreview.generation_profile}</div>
                          <div>generated at</div>
                          <div className="mono">{formatTime(v2AuthoringContextManifestPreview.generated_at)}</div>
                          <div>attempts</div>
                          <div className="mono">{v2AuthoringContextManifestPreview.attempts.length}</div>
                          <div>full-context attempts</div>
                          <div className="mono">
                            {v2AuthoringContextManifestPreview.attempts.filter((attempt) => attempt.context_mode === "full").length}
                          </div>
                          <div>compact-context attempts</div>
                          <div className="mono">
                            {v2AuthoringContextManifestPreview.attempts.filter((attempt) => attempt.context_mode === "compact").length}
                          </div>
                        </div>
                        <details className="diagnosticDetails">
                          <summary>Attempt log ({v2AuthoringContextManifestPreview.attempts.length})</summary>
                          {v2AuthoringContextManifestPreview.attempts.length === 0 ? (
                            <div className="subtle">No attempt log entries.</div>
                          ) : (
                            <ul className="diagnosticList">
                              {v2AuthoringContextManifestPreview.attempts.slice(0, 12).map((attempt) => (
                                <li key={attempt.attempt_id}>
                                  {attempt.attempt_id}: {attempt.prompt_variant} · {attempt.context_mode} · {attempt.result}
                                  {attempt.reason ? ` · ${attempt.reason}` : ""}
                                </li>
                              ))}
                            </ul>
                          )}
                        </details>
                      </details>
                    )}

                    {(v2BlockRegenTracePreview || v2RegenTraceNames.length > 0) && (
                      <details className="diagnosticDetails" open={Boolean(v2BlockRegenTracePreview)}>
                        <summary>Latest regen trace ({v2LatestRegenTraceName || "none"})</summary>
                        {!v2BlockRegenTracePreview ? (
                          <div className="subtle">No parsed regen trace payload for the latest loop artifact.</div>
                        ) : (
                          <>
                            <div className="diagnosticKv">
                              <div>loop</div>
                              <div className="mono">{v2BlockRegenTracePreview.loop}</div>
                              <div>fix count</div>
                              <div className="mono">{v2BlockRegenTracePreview.fix_count}</div>
                              <div>regenerated blocks</div>
                              <div className="mono">{v2BlockRegenTracePreview.regenerated_blocks.length}</div>
                              <div>warnings</div>
                              <div className="mono">{v2BlockRegenTracePreview.warnings.length}</div>
                            </div>
                            <details className="diagnosticDetails">
                              <summary>Fix types ({v2BlockRegenTracePreview.fix_types.length})</summary>
                              {v2BlockRegenTracePreview.fix_types.length === 0 ? (
                                <div className="subtle">none</div>
                              ) : (
                                <ul className="diagnosticList">
                                  {v2BlockRegenTracePreview.fix_types.map((fixType) => (
                                    <li key={`regen-fix-${fixType}`}>{fixType}</li>
                                  ))}
                                </ul>
                              )}
                            </details>
                          </>
                        )}
                        {v2RegenTraceNames.length > 0 && (
                          <details className="diagnosticDetails">
                            <summary>Available regen traces ({v2RegenTraceNames.length})</summary>
                            <ul className="diagnosticList">
                              {v2RegenTraceNames.slice(0, 12).map((name) => (
                                <li key={name}>{name}</li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </details>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {workflow === "v2_micro_detectives" && (
            <div className="panel runGateCard">
              <div className="panelHeader">
                <div style={{ fontWeight: 600 }}>V2 quality diagnostics</div>
              </div>
              <div className="panelBody">
                {!v2QaBlockHeatmapPreview && !v2NarrativeIntensifierPreview && !v2DiseaseResearchSourceReportPreview && (
                  <div className="subtle">No heatmap / intensifier / research-source diagnostics artifacts yet.</div>
                )}
                {(v2QaBlockHeatmapPreview || v2NarrativeIntensifierPreview || v2DiseaseResearchSourceReportPreview) && (
                  <div className="summaryCardList">
                    <div className="diagnosticPanelLead">Whole-deck weak-block targeting, story intensification, and curated-vs-web grounding coverage for the current run.</div>
                    <div className="diagnosticOverviewGrid">
                      <div className="diagnosticOverviewCard">
                        <div className="diagnosticOverviewLabel">QA heatmap</div>
                        <div className={`diagnosticOverviewValue ${v2QaBlockHeatmapPreview ? "statusOk" : "statusMuted"}`}>
                          {v2LatestQaHeatmapName || "missing"}
                        </div>
                      </div>
                      <div className="diagnosticOverviewCard">
                        <div className="diagnosticOverviewLabel">intensifier</div>
                        <div className={`diagnosticOverviewValue ${v2NarrativeIntensifierPreview ? "statusOk" : "statusMuted"}`}>
                          {v2NarrativeIntensifierPreview ? "present" : "missing"}
                        </div>
                      </div>
                      <div className="diagnosticOverviewCard">
                        <div className="diagnosticOverviewLabel">research source mix</div>
                        <div className={`diagnosticOverviewValue ${v2DiseaseResearchSourceReportPreview ? "statusOk" : "statusMuted"}`}>
                          {v2DiseaseResearchSourceReportPreview ? "present" : "missing"}
                        </div>
                      </div>
                    </div>

                    {v2QaBlockHeatmapPreview && (
                      <details className="diagnosticDetails" open>
                        <summary>QA block heatmap ({v2LatestQaHeatmapName || `loop ${v2QaBlockHeatmapPreview.loop}`})</summary>
                        <div className="diagnosticKv">
                          <div>loop</div>
                          <div className="mono">{v2QaBlockHeatmapPreview.loop}</div>
                          <div>blocks scored</div>
                          <div className="mono">{v2QaBlockHeatmapPreview.blocks.length}</div>
                        </div>
                        <details className="diagnosticDetails">
                          <summary>Worst blocks</summary>
                          <div className="diagnosticKv">
                            {v2QaBlockHeatmapPreview.blocks
                              .slice()
                              .sort((a, b) => b.severity_score - a.severity_score)
                              .slice(0, 8)
                              .map((row) => (
                                <Fragment key={`heatmap-${row.block_id}`}>
                                  <div>{row.block_id}</div>
                                  <div className="mono">
                                    {row.act_id} · sev {row.severity_score.toFixed(2)} · rep {formatRatioAsPercent(row.repeated_template_density)} ·
                                    generic {formatRatioAsPercent(row.generic_language_rate)}
                                  </div>
                                </Fragment>
                              ))}
                          </div>
                        </details>
                      </details>
                    )}

                    {v2NarrativeIntensifierPreview && (
                      <details className="diagnosticDetails" open>
                        <summary>Narrative intensifier</summary>
                        <div className="diagnosticKv">
                          <div>target blocks</div>
                          <div className="mono">{v2NarrativeIntensifierPreview.target_block_ids.length}</div>
                          <div>operations</div>
                          <div className="mono">{v2NarrativeIntensifierPreview.operations.length}</div>
                          <div>findings</div>
                          <div className="mono">{v2NarrativeIntensifierPreview.global_intensity_findings.length}</div>
                        </div>
                        <details className="diagnosticDetails">
                          <summary>Global findings ({v2NarrativeIntensifierPreview.global_intensity_findings.length})</summary>
                          <ul className="diagnosticList">
                            {v2NarrativeIntensifierPreview.global_intensity_findings.map((finding, idx) => (
                              <li key={`intensifier-finding-${idx}`}>{finding}</li>
                            ))}
                          </ul>
                        </details>
                        <details className="diagnosticDetails">
                          <summary>Operations ({v2NarrativeIntensifierPreview.operations.length})</summary>
                          <ul className="diagnosticList">
                            {v2NarrativeIntensifierPreview.operations.slice(0, 10).map((op, idx) => (
                              <li key={`intensifier-op-${idx}`}>
                                {op.op}
                                {op.slide_id ? ` · ${op.slide_id}` : ""}
                                {op.start_slide_id || op.end_slide_id ? ` · ${op.start_slide_id ?? "-"}..${op.end_slide_id ?? "-"}` : ""}
                                {op.reason ? ` · ${op.reason}` : ""}
                              </li>
                            ))}
                          </ul>
                        </details>
                      </details>
                    )}

                    {v2DiseaseResearchSourceReportPreview && (
                      <details className="diagnosticDetails" open>
                        <summary>Disease research source mix</summary>
                        <div className="diagnosticKv">
                          <div>topic</div>
                          <div className="mono">{v2DiseaseResearchSourceReportPreview.topic || "-"}</div>
                          <div>sections</div>
                          <div className="mono">{v2DiseaseResearchSourceReportPreview.sections.length}</div>
                        </div>
                        <details className="diagnosticDetails">
                          <summary>Section breakdown ({v2DiseaseResearchSourceReportPreview.sections.length})</summary>
                          <div className="diagnosticKv">
                            {v2DiseaseResearchSourceReportPreview.sections.slice(0, 12).map((section) => (
                              <Fragment key={`source-report-${section.section}`}>
                                <div>{section.section}</div>
                                <div className="mono">
                                  curated {section.curated_citations} · web {section.web_citations} · {section.dominant_source}
                                  {section.fallback_reason ? ` · ${section.fallback_reason}` : ""}
                                </div>
                              </Fragment>
                            ))}
                          </div>
                        </details>
                      </details>
                    )}
                  </div>
                )}
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

          {workflow === "v2_micro_detectives" && run.v2DeckSpecEstimate && (
            <div className="panel runWatchdogCard">
              <div className="panelBody">
                <div className="row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div>
                    <div className="row" style={{ gap: 8, alignItems: "center" }}>
                      <span className={`badge ${run.v2DeckSpecEstimate.abortRecommended ? "badgeWarn" : "badgeOk"}`}>DeckSpec estimate</span>
                      <span className="mono">
                        {run.v2DeckSpecEstimate.estimatedMainSlides} slides ({run.v2DeckSpecEstimate.deckLengthPolicy}
                        {run.v2DeckSpecEstimate.deckLengthPolicy === "soft_target" ? `:${String(run.v2DeckSpecEstimate.softTarget ?? "-")}` : ""})
                      </span>
                    </div>
                    <div className="mono subtle" style={{ marginTop: 6 }}>
                      adaptive timeouts: agent {formatElapsed(run.v2DeckSpecEstimate.adaptiveTimeoutMs.agent)} · deckspec{" "}
                      {formatElapsed(run.v2DeckSpecEstimate.adaptiveTimeoutMs.deckSpec)} · watchdog{" "}
                      {formatElapsed(run.v2DeckSpecEstimate.adaptiveTimeoutMs.watchdog)}
                    </div>
                    <div className="mono subtle" style={{ marginTop: 4 }}>
                      abort threshold: {run.v2DeckSpecEstimate.abortThresholdSlides} slides
                    </div>
                  </div>
                  <div className="row" style={{ gap: 8, alignItems: "center" }}>
                    {run.v2DeckSpecEstimate.abortRecommended && (
                      <span className="badge badgeWarn">Estimated length exceeds abort threshold</span>
                    )}
                    <button
                      className="buttonDanger"
                      disabled={cancelBusy || (run.status !== "running" && run.status !== "queued")}
                      onClick={() => void onCancel()}
                    >
                      {cancelBusy ? "Cancelling..." : "Abort run"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

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
            artifacts={artifacts}
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
                      <button
                        className={`summaryTabButton ${v2InspectorTab === "packaging" ? "summaryTabButtonActive" : ""}`}
                        onClick={() => setV2InspectorTab("packaging")}
                      >
                        Packaging
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

                    {!v2DrilldownBusy && !v2DrilldownErr && v2InspectorTab === "packaging" && (
                      <>
                        {!v2PackagingSummaryPreview && <div className="subtle">No V2 packaging summary artifact yet.</div>}
                        {v2PackagingSummaryPreview && (
                          <div className="summaryCardList">
                            <details className="diagnosticDetails" open>
                              <summary>Deck package summary</summary>
                              <div className="diagnosticKv">
                                <div>episode</div>
                                <div>{v2PackagingSummaryPreview.deck.episode_title}</div>
                                <div>main slides</div>
                                <div className="mono">{v2PackagingSummaryPreview.deck.main_slide_count}</div>
                                <div>appendix slides</div>
                                <div className="mono">{v2PackagingSummaryPreview.deck.appendix_slide_count}</div>
                                <div>template count</div>
                                <div className="mono">{v2PackagingSummaryPreview.package.template_count}</div>
                              </div>
                            </details>
                            <details className="diagnosticDetails" open>
                              <summary>Final package files</summary>
                              <ul className="diagnosticList">
                                {Object.entries(v2PackagingSummaryPreview.package.files).map(([label, file]) => (
                                  <li key={label}>
                                    <span className="mono">{label}</span>: <span className="mono">{file}</span>
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
