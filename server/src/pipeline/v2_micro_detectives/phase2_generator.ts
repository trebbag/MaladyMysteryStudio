import { nowIso, slug } from "../utils.js";
import type {
  DeckSpec,
  DiseaseDossier,
  EpisodePitch,
  MedFactcheckReport,
  TruthModel
} from "./schemas.js";
import {
  DiseaseDossierSchema,
  EpisodePitchSchema,
  MedFactcheckReportSchema,
  TruthModelSchema,
  type V2AudienceLevel
} from "./schemas.js";

type CitationRef = {
  citation_id: string;
  claim: string;
  chunk_id?: string;
  locator?: string;
};

type BuildPhase2Input = {
  topic: string;
  audienceLevel: V2AudienceLevel;
  deckLengthMain: 30 | 45 | 60;
  kbContext: string;
};

function topicDxToken(topic: string): string {
  return slug(topic || "diagnosis")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
}

function kbCitation(topic: string): CitationRef {
  return {
    citation_id: "CIT-KB-001",
    claim: `Canonical KB grounding for ${topic}`,
    locator: "kb_context.md"
  };
}

function requiredSections(): string[] {
  return [
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
  ];
}

function teaserTemplate(idx: number): string {
  const templates = ["T01_COLD_OPEN_MICRO_CRIME_SCENE", "T03_SHRINK_DIVE_SEQUENCE", "T04_CLUE_DISCOVERY"];
  return templates[idx % templates.length] ?? "T04_CLUE_DISCOVERY";
}

export function generateDiseaseDossier(input: BuildPhase2Input): DiseaseDossier {
  const cite = kbCitation(input.topic);
  const sections = requiredSections().map((section) => ({
    section,
    key_points: [
      `PCP-relevant checkpoint for ${section.replaceAll("_", " ")} in ${input.topic}.`,
      `High-yield discriminator for ${input.topic} in ${section.replaceAll("_", " ")}.`
    ],
    citations: [cite]
  }));

  return DiseaseDossierSchema.parse({
    schema_version: "1.0.0",
    created_at: nowIso(),
    disease_request: {
      disease_topic: input.topic,
      target_level: input.audienceLevel,
      setting_focus: "multi_system",
      constraints: ["story-forward", "fixed-length main deck", "citation-grounded"]
    },
    canonical_name: input.topic,
    aliases: [slug(input.topic).replaceAll("-", " ")],
    learning_objectives: [
      `Recognize key patterns in ${input.topic}.`,
      `Differentiate likely vs unlikely diagnoses in ${input.topic}.`,
      `Execute practical initial management for ${input.topic}.`
    ],
    sections,
    citations: [cite]
  });
}

export function generateEpisodePitch(input: BuildPhase2Input, dossier: DiseaseDossier): EpisodePitch {
  const cite = dossier.citations[0] ?? kbCitation(input.topic);
  const titleTopic = input.topic.trim() || "Case";
  const episodeTitle = `${titleTopic} — The Missing Mechanism`;
  return EpisodePitchSchema.parse({
    schema_version: "1.0.0",
    pitch_id: `PITCH-${slug(input.topic).slice(0, 18) || "episode"}-${Date.now()}`,
    episode_title: episodeTitle,
    logline: `Cyto and Pip chase conflicting clues to explain ${titleTopic} before time runs out.`,
    target_deck_length: String(input.deckLengthMain),
    tone: "thriller",
    patient_stub: {
      age: 52,
      sex: "unknown",
      one_sentence_context: "Unexpected deterioration after a routine day.",
      presenting_problem: `${titleTopic} pattern with mixed and misleading signs.`,
      stakes_if_missed: "Delay risks preventable harm and escalating instability."
    },
    macro_hook: "At first glance, the pattern fits the wrong diagnosis too neatly.",
    micro_hook: "Inside the body, the first clue points in the opposite direction.",
    proposed_twist_type: "dual_process",
    teaser_storyboard: [1, 2, 3, 4].map((n) => ({
      slide_id: `S${String(n).padStart(2, "0")}`,
      template_id: teaserTemplate(n - 1),
      title: `${episodeTitle} teaser ${n}`,
      one_line_story: `Beat ${n} reveals a new contradiction in the case.`,
      visual: `Micro-scale evidence tableau ${n} with clinicians and detectives cross-checking signals.`,
      hook: `What does contradiction ${n} actually prove?`,
      medical_payload_brief: `One high-yield ${titleTopic} discriminator.`
    })),
    citations_used: [cite]
  });
}

export function generateTruthModel(input: BuildPhase2Input, dossier: DiseaseDossier, pitch: EpisodePitch): TruthModel {
  const cite = dossier.citations[0] ?? kbCitation(input.topic);
  const dxToken = topicDxToken(dossier.canonical_name);
  const finalDxId = `DX_${dxToken}`;
  return TruthModelSchema.parse({
    schema_version: "1.0.0",
    episode_title: pitch.episode_title,
    final_diagnosis: {
      dx_id: finalDxId,
      name: dossier.canonical_name,
      one_sentence_mechanism: `A progressive chain of events explains ${dossier.canonical_name} from early clue to definitive intervention.`
    },
    case_logline: pitch.logline,
    patient_profile: {
      sex: pitch.patient_stub.sex,
      key_history: [pitch.patient_stub.one_sentence_context]
    },
    cover_story: {
      initial_working_dx_ids: [`DX_MIMIC_${dxToken}_A`, `DX_MIMIC_${dxToken}_B`],
      why_it_seems_right: "Initial tests highlight common mimics and conceal the true driver.",
      what_it_gets_wrong: "The timeline and response pattern conflict with the cover diagnosis."
    },
    macro_timeline: [
      {
        t: "T0",
        event_id: "ME-01",
        what_happens: "Presenting syndrome triggers broad differential and urgent triage.",
        citations: [cite]
      },
      {
        t: "T+6h",
        event_id: "ME-02",
        what_happens: "Contradictory findings force differential revision toward the true diagnosis.",
        citations: [cite]
      }
    ],
    micro_timeline: [
      {
        t: "T0",
        event_id: "mE-01",
        zone_id: "ZONE-01",
        what_happens: "Early micro-scale dysfunction appears before obvious macro decompensation.",
        citations: [cite]
      },
      {
        t: "T+6h",
        event_id: "mE-02",
        zone_id: "ZONE-02",
        what_happens: "Mechanistic trigger becomes visible and explains earlier false leads.",
        citations: [cite]
      }
    ],
    twist_blueprint: {
      setup: "Early clues are fair but interpretable as a common mimic.",
      reveal: "A cross-domain clue recontextualizes the whole timeline.",
      receipts: ["Act I clue", "Act II contradiction", "Act III mechanism confirmation"]
    }
  });
}

export function generateMedFactcheckReport(deckSpec: DeckSpec, dossier: DiseaseDossier): MedFactcheckReport {
  const cite = dossier.citations[0] ?? kbCitation(dossier.canonical_name);
  const validCitationIds = new Set(
    [
      ...dossier.citations.map((citation) => citation.citation_id),
      ...dossier.sections.flatMap((section) => section.citations.map((citation) => citation.citation_id))
    ]
      .map((id) => String(id || "").trim())
      .filter((id) => id.length > 0)
  );
  const isGenericConcept = (value: string): boolean => /^(?:NONE|MC[-_]?0*\d+|MC[-_]?PATCH[-_A-Z0-9]*)$/i.test(String(value || "").trim());
  const hasPlaceholderToken = (value: string): boolean => /\bCLUE[_-]?[A-Z0-9_-]+\b/.test(String(value || ""));
  const issues: MedFactcheckReport["issues"] = [];
  if (deckSpec.slides.length !== Number(deckSpec.deck_meta.deck_length_main)) {
    issues.push({
      issue_id: "MED-ERR-001",
      severity: "critical",
      type: "contradiction_with_dossier",
      claim: "Deck length mismatch can break coverage mapping and citation traceability.",
      why_wrong: "Main deck length must stay fixed to the agreed spec.",
      suggested_fix: "Regenerate deck spec with exact main length.",
      supporting_citations: [cite]
    });
  }
  for (const slide of deckSpec.slides) {
    const slideCitationIds = slide.medical_payload.dossier_citations.map((citation) => citation.citation_id);
    if (slideCitationIds.length === 0) {
      issues.push({
        issue_id: `MED-CITE-MISSING-${slide.slide_id}`,
        severity: "critical",
        type: "contradiction_with_dossier",
        claim: `${slide.slide_id} has no dossier citations on medical payload.`,
        why_wrong: "All main slides must be traceable to dossier citations.",
        suggested_fix: "Attach at least one valid dossier citation to medical_payload and speaker notes for this slide.",
        supporting_citations: [cite]
      });
    }
    for (const citationId of slideCitationIds) {
      if (!validCitationIds.has(String(citationId || "").trim())) {
        issues.push({
          issue_id: `MED-CITE-UNKNOWN-${slide.slide_id}-${citationId}`,
          severity: "critical",
          type: "unsupported_inference",
          claim: `${slide.slide_id} cites unknown citation_id ${citationId}.`,
          why_wrong: "Citation IDs must come from this run's disease dossier.",
          suggested_fix: "Replace unknown citation IDs with IDs that exist in the current disease dossier.",
          supporting_citations: [cite]
        });
      }
    }
    if (isGenericConcept(slide.medical_payload.major_concept_id)) {
      issues.push({
        issue_id: `MED-CONCEPT-GENERIC-${slide.slide_id}`,
        severity: "major",
        type: "other",
        claim: `${slide.slide_id} uses generic major_concept_id ${slide.medical_payload.major_concept_id}.`,
        why_wrong: "Major concepts should be specific and topic-grounded for traceability.",
        suggested_fix: "Replace generic concept IDs with topic-specific concept IDs aligned to the slide’s teaching point.",
        supporting_citations: [cite]
      });
    }
    const topSet = new Set(slide.speaker_notes.differential_update.top_dx_ids.map((dx) => String(dx || "").trim()));
    const overlap = slide.speaker_notes.differential_update.eliminated_dx_ids
      .map((dx) => String(dx || "").trim())
      .find((dx) => topSet.has(dx));
    if (overlap) {
      issues.push({
        issue_id: `MED-DIFF-CONFLICT-${slide.slide_id}`,
        severity: "critical",
        type: "contradiction_with_dossier",
        claim: `${slide.slide_id} lists ${overlap} in both top and eliminated differential sets.`,
        why_wrong: "A diagnosis cannot be simultaneously prioritized and eliminated.",
        suggested_fix: "Remove overlapping differential IDs and keep elimination logic consistent with presented evidence.",
        supporting_citations: [cite]
      });
    }
    const visibleText = [
      slide.title,
      slide.on_slide_text.headline,
      slide.on_slide_text.subtitle ?? "",
      ...(slide.on_slide_text.callouts ?? []),
      ...(slide.on_slide_text.labels ?? []),
      slide.story_panel.goal,
      slide.story_panel.opposition,
      slide.story_panel.turn,
      slide.story_panel.decision,
      slide.hook
    ].join(" ");
    if (hasPlaceholderToken(visibleText)) {
      issues.push({
        issue_id: `MED-PLACEHOLDER-TOKEN-${slide.slide_id}`,
        severity: "major",
        type: "other",
        claim: `${slide.slide_id} contains placeholder clue tokens in learner-visible text.`,
        why_wrong: "Placeholder tokens reduce clarity and can break pedagogic traceability.",
        suggested_fix: "Replace placeholder clue tokens with explicit, medically meaningful language.",
        supporting_citations: [cite]
      });
    }
  }
  for (const slide of deckSpec.appendix_slides) {
    if (isGenericConcept(slide.medical_payload.major_concept_id)) {
      issues.push({
        issue_id: `MED-APPENDIX-CONCEPT-GENERIC-${slide.slide_id}`,
        severity: "minor",
        type: "other",
        claim: `${slide.slide_id} uses a generic appendix major concept id.`,
        why_wrong: "Appendix concepts should still be traceable to specific domains.",
        suggested_fix: "Use topic-specific appendix major concept IDs.",
        supporting_citations: [cite]
      });
    }
  }
  const pass = issues.length === 0;
  const toFixType = (issueType: MedFactcheckReport["issues"][number]["type"]): MedFactcheckReport["required_fixes"][number]["type"] => {
    if (issueType === "contradiction_with_dossier") return "edit_differential";
    if (issueType === "unsupported_inference" || issueType === "wrong_test_interpretation") return "edit_slide";
    if (issueType === "incorrect_fact" || issueType === "wrong_timecourse" || issueType === "wrong_treatment_response") return "medical_correction";
    return "other";
  };
  return MedFactcheckReportSchema.parse({
    schema_version: "1.0.0",
    pass,
    issues,
    summary: pass
      ? "No critical medical correctness contradictions detected against the dossier."
      : "Critical contradictions detected between deck spec and dossier constraints.",
    required_fixes: pass
      ? []
      : issues.map((issue, idx) => ({
          fix_id: `FIX-${String(idx + 1).padStart(3, "0")}`,
          type: toFixType(issue.type),
          priority: issue.severity === "critical" ? "must" : issue.severity === "major" ? "should" : "could",
          description: issue.suggested_fix,
          targets: [issue.claim.match(/\bS\d{2,3}\b/)?.[0] ?? "deck_spec.json"]
        }))
  });
}
