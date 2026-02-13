import type { RunAdherenceMode, RunLevel } from "../run_manager.js";
import type { EditorOutput, MedicalNarrativeFlowOutput, PatchOutput, QaOutput } from "./schemas.js";

const MEDICAL_SECTIONS = [
  "normal_physiology",
  "pathophysiology",
  "epidemiology_risk",
  "clinical_presentation",
  "diagnosis_workup",
  "differential",
  "treatment_acute",
  "treatment_long_term",
  "prognosis_complications",
  "patient_counseling_prevention"
] as const;

type MedicalSection = (typeof MEDICAL_SECTIONS)[number];

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "to",
  "with"
]);

type MedicalDepthThresholds = {
  failMinItemsPerSection: number;
  warnMinItemsPerSection: number;
};

export type MedicalDepthSectionResult = {
  section: MedicalSection;
  items: number;
  citations: number;
  status: "ok" | "warn" | "fail";
};

export type MedicalDepthReport = {
  checked_at: string;
  level: RunLevel;
  mode: RunAdherenceMode;
  thresholds: MedicalDepthThresholds;
  status: "pass" | "warn" | "fail";
  failures: string[];
  warnings: string[];
  sections: MedicalDepthSectionResult[];
};

export type MedicalStoryTraceabilityReport = {
  created_at: string;
  stage_traces: Array<{
    stage: string;
    matched_slide_ids: string[];
    status: "covered" | "partial" | "missing";
    coverage_ratio: number;
    teaching_point_hits: Array<{
      teaching_point: string;
      matched_slide_ids: string[];
      matched: boolean;
    }>;
  }>;
  plot_event_traces: Array<{
    event: string;
    matched_slide_ids: string[];
    matched: boolean;
  }>;
  summary: {
    total_stages: number;
    covered_stages: number;
    partial_stages: number;
    missing_stages: number;
    total_plot_events: number;
    matched_plot_events: number;
    status: "pass" | "warn" | "fail";
  };
};

function thresholdsForLevel(level: RunLevel): MedicalDepthThresholds {
  if (level === "pcp") {
    return {
      failMinItemsPerSection: 3,
      warnMinItemsPerSection: 5
    };
  }
  return {
    failMinItemsPerSection: 1,
    warnMinItemsPerSection: 2
  };
}

function countCitations(
  chapter: EditorOutput["facts_library_clean"],
  section: MedicalSection
): number {
  return chapter[section].reduce((sum, item) => sum + item.citations.length, 0);
}

export function evaluateMedicalDepth(
  chapter: EditorOutput["facts_library_clean"],
  opts: { level: RunLevel; mode: RunAdherenceMode; checkedAt: string }
): MedicalDepthReport {
  const thresholds = thresholdsForLevel(opts.level);
  const failures: string[] = [];
  const warnings: string[] = [];

  const sections: MedicalDepthSectionResult[] = MEDICAL_SECTIONS.map((section) => {
    const items = chapter[section].length;
    const citations = countCitations(chapter, section);

    if (items < thresholds.failMinItemsPerSection) {
      failures.push(
        `Section "${section}" has ${items} item(s), below fail minimum ${thresholds.failMinItemsPerSection} for level=${opts.level}.`
      );
      return { section, items, citations, status: "fail" };
    }
    if (items < thresholds.warnMinItemsPerSection) {
      warnings.push(
        `Section "${section}" has ${items} item(s), below recommended ${thresholds.warnMinItemsPerSection} for level=${opts.level}.`
      );
      return { section, items, citations, status: "warn" };
    }
    return { section, items, citations, status: "ok" };
  });

  let status: "pass" | "warn" | "fail" = "pass";
  if (failures.length > 0) {
    status = opts.mode === "strict" ? "fail" : "warn";
  } else if (warnings.length > 0) {
    status = "warn";
  }

  return {
    checked_at: opts.checkedAt,
    level: opts.level,
    mode: opts.mode,
    thresholds,
    status,
    failures,
    warnings,
    sections
  };
}

function dedupePatchList(
  patchList: QaOutput["qa_report"]["patch_list"]
): QaOutput["qa_report"]["patch_list"] {
  const seen = new Set<string>();
  const out: QaOutput["qa_report"]["patch_list"] = [];
  for (const patch of patchList) {
    const key = `${patch.target}|${patch.instruction}|${patch.severity}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(patch);
  }
  return out;
}

export function applyMedicalDepthGuardToQa(
  qa: QaOutput["qa_report"],
  depth: MedicalDepthReport
): QaOutput["qa_report"] {
  const notes = [...qa.notes];
  const patchList = [...qa.patch_list];

  if (depth.warnings.length > 0) {
    notes.push(`Medical depth warnings: ${depth.warnings.length}`);
  }
  if (depth.failures.length > 0) {
    notes.push(`Medical depth failures: ${depth.failures.length}`);
  }

  for (const section of depth.sections) {
    if (section.status === "ok") continue;
    patchList.push({
      target: `medical-depth:${section.section}`,
      instruction:
        `Increase depth for section "${section.section}" to PCP-ready completeness. ` +
        `Ensure standalone teaching bullets and practical decision detail appear in slides.`,
      severity: section.status === "fail" ? "must" : "should"
    });
  }

  const forceFail = depth.status === "fail";
  return {
    pass: forceFail ? false : qa.pass,
    patch_list: dedupePatchList(patchList),
    notes
  };
}

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 4 && !STOP_WORDS.has(w));
}

function tokensOverlap(a: string, b: string): number {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let hit = 0;
  for (const token of ta) {
    if (tb.has(token)) hit += 1;
  }
  return hit / ta.size;
}

function slideSearchText(slide: PatchOutput["final_slide_spec_patched"]["slides"][number]): string {
  return [
    slide.title,
    slide.content_md,
    slide.speaker_notes,
    slide.hud_panel_bullets.join(" "),
    slide.location_description,
    slide.evidence_visual_description,
    slide.character_staging,
    slide.story_and_dialogue
  ].join("\n");
}

function matchedSlidesForText(
  text: string,
  slides: PatchOutput["final_slide_spec_patched"]["slides"],
  minOverlap: number
): string[] {
  const matches: string[] = [];
  for (const slide of slides) {
    const overlap = tokensOverlap(text, slideSearchText(slide));
    if (overlap >= minOverlap) matches.push(slide.slide_id);
  }
  return matches;
}

export function buildMedicalStoryTraceabilityReport(input: {
  createdAt: string;
  narrativeFlow: MedicalNarrativeFlowOutput["medical_narrative_flow"];
  finalPatched: PatchOutput["final_slide_spec_patched"];
}): MedicalStoryTraceabilityReport {
  const slides = input.finalPatched.slides;

  const stageTraces = input.narrativeFlow.progression.map((stage) => {
    const stageNeedle = `${stage.stage}\n${stage.medical_logic}\n${stage.key_teaching_points.join("\n")}`;
    const stageMatches = matchedSlidesForText(stageNeedle, slides, 0.12);

    const teachingPointHits = stage.key_teaching_points.map((point) => {
      const matched = matchedSlidesForText(point, slides, 0.12);
      return {
        teaching_point: point,
        matched_slide_ids: matched,
        matched: matched.length > 0
      };
    });

    const totalPoints = Math.max(1, teachingPointHits.length);
    const hitPoints = teachingPointHits.filter((tp) => tp.matched).length;
    const coverageRatio = hitPoints / totalPoints;

    let status: "covered" | "partial" | "missing" = "covered";
    if (hitPoints === 0 && stageMatches.length === 0) status = "missing";
    else if (hitPoints < totalPoints) status = "partial";

    return {
      stage: stage.stage,
      matched_slide_ids: stageMatches,
      status,
      coverage_ratio: Number(coverageRatio.toFixed(3)),
      teaching_point_hits: teachingPointHits
    };
  });

  const plotEventTraces = input.narrativeFlow.required_plot_events.map((event) => {
    const matches = matchedSlidesForText(event, slides, 0.1);
    return {
      event,
      matched_slide_ids: matches,
      matched: matches.length > 0
    };
  });

  const coveredStages = stageTraces.filter((s) => s.status === "covered").length;
  const partialStages = stageTraces.filter((s) => s.status === "partial").length;
  const missingStages = stageTraces.filter((s) => s.status === "missing").length;
  const matchedPlotEvents = plotEventTraces.filter((p) => p.matched).length;

  let status: "pass" | "warn" | "fail" = "pass";
  if (missingStages > 1 || (plotEventTraces.length > 0 && matchedPlotEvents === 0)) {
    status = "fail";
  } else if (missingStages > 0 || partialStages > 0 || matchedPlotEvents < plotEventTraces.length) {
    status = "warn";
  }

  return {
    created_at: input.createdAt,
    stage_traces: stageTraces,
    plot_event_traces: plotEventTraces,
    summary: {
      total_stages: stageTraces.length,
      covered_stages: coveredStages,
      partial_stages: partialStages,
      missing_stages: missingStages,
      total_plot_events: plotEventTraces.length,
      matched_plot_events: matchedPlotEvents,
      status
    }
  };
}
