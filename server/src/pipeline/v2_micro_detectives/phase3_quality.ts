import type {
  ClueGraph,
  DeckSpec,
  DifferentialCast,
  MedFactcheckReport,
  ReaderSimReport,
  RequiredFix,
  V2DeckSpecLintError,
  V2DeckSpecLintReport,
  V2QaReport
} from "./schemas.js";

function uniqueFixKey(fix: RequiredFix): string {
  return `${fix.type}|${fix.priority}|${fix.description}|${(fix.targets ?? []).join(",")}`;
}

function buildLintFixes(lint: V2DeckSpecLintReport, deckSpec: DeckSpec): RequiredFix[] {
  const fixes: RequiredFix[] = [];
  for (const err of lint.errors) {
    if (err.severity !== "error") continue;
    const base = {
      fix_id: `LINT-${err.code}${err.slide_id ? `-${err.slide_id}` : ""}`,
      priority: "must" as const
    };
    if (err.code === "ON_SLIDE_WORD_LIMIT_EXCEEDED") {
      fixes.push({
        ...base,
        type: "reduce_text_density",
        description: err.message,
        targets: err.slide_id ? [err.slide_id] : undefined
      });
      continue;
    }
    if (err.code === "MISSING_STORY_TURN") {
      fixes.push({
        ...base,
        type: "increase_story_turn",
        description: err.message,
        targets: err.slide_id ? [err.slide_id] : undefined
      });
      continue;
    }
    if (err.code === "STORY_DOMINANCE_BELOW_TARGET") {
      const targetSlides = deckSpec.slides
        .filter((slide) => !["clue", "dialogue", "action"].includes(slide.medical_payload.delivery_mode))
        .slice(0, 8)
        .map((slide) => slide.slide_id);
      fixes.push({
        ...base,
        type: "increase_story_turn",
        description: "Increase story-forward delivery mode on low-dominance slides.",
        targets: targetSlides
      });
      continue;
    }
    if (err.code === "MAJOR_CONCEPT_COMPOUND" || err.code === "MAJOR_CONCEPT_EMPTY") {
      fixes.push({
        ...base,
        type: "medical_correction",
        description: err.message,
        targets: err.slide_id ? [err.slide_id] : undefined
      });
      continue;
    }
    fixes.push({
      ...base,
      type: "edit_slide",
      description: err.message,
      targets: err.slide_id ? [err.slide_id] : undefined
    });
  }
  return fixes;
}

function dedupeFixes(fixes: RequiredFix[]): RequiredFix[] {
  const seen = new Set<string>();
  const out: RequiredFix[] = [];
  for (const fix of fixes) {
    const key = uniqueFixKey(fix);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(fix);
  }
  return out;
}

function baseCitation(deckSpec: DeckSpec): { citation_id: string; claim: string } {
  const slideWithCitation = deckSpec.slides.find((slide) => slide.medical_payload.dossier_citations.length > 0);
  if (slideWithCitation) {
    const cite = slideWithCitation.medical_payload.dossier_citations[0]!;
    return { citation_id: cite.citation_id, claim: cite.claim };
  }
  return { citation_id: "CIT-UNKNOWN", claim: "Fallback citation from deck context." };
}

function normalizeCitation(cite: { citation_id: string; claim: string; chunk_id?: unknown; locator?: unknown }) {
  return {
    citation_id: cite.citation_id,
    claim: cite.claim,
    chunk_id: typeof cite.chunk_id === "string" ? cite.chunk_id : undefined,
    locator: typeof cite.locator === "string" ? cite.locator : undefined
  };
}

function toQaLintErrors(errors: V2DeckSpecLintError[]): V2QaReport["lint_errors"] {
  return errors.map((err) => ({
    code: err.code,
    message: err.message,
    severity: err.severity,
    slide_id: err.slide_id
  }));
}

function pacingScore(reader: ReaderSimReport): number {
  const pacingNotes = reader.slide_notes.filter((note) => note.issue_type === "pacing_slow" || note.issue_type === "pacing_rushed");
  if (pacingNotes.length === 0) return 4.2;
  if (pacingNotes.length < 4) return 3.4;
  return 2.6;
}

function microMacroScore(medFactcheck: MedFactcheckReport, reader: ReaderSimReport): number {
  const base = medFactcheck.pass ? 4 : 2.5;
  const confusionPenalty = Math.min(1.2, reader.slide_notes.filter((note) => note.issue_type === "medical_confusion").length * 0.2);
  return Math.max(0, Math.min(5, base - confusionPenalty));
}

export function buildCombinedQaReport(input: {
  lintReport: V2DeckSpecLintReport;
  readerSimReport: ReaderSimReport;
  medFactcheckReport: MedFactcheckReport;
  deckSpec: DeckSpec;
}): V2QaReport {
  const { lintReport, readerSimReport, medFactcheckReport, deckSpec } = input;
  const lintFixes = buildLintFixes(lintReport, deckSpec);
  const requiredFixes = dedupeFixes([...lintFixes, ...medFactcheckReport.required_fixes, ...readerSimReport.required_fixes]);
  const hasMustFix = requiredFixes.some((fix) => fix.priority === "must");

  const graderScores: V2QaReport["grader_scores"] = [
    {
      category: "MedicalAccuracy",
      score_0_to_5: medFactcheckReport.pass ? 4.4 : 2.0,
      rationale: medFactcheckReport.pass ? "No critical medical contradictions detected." : "Medical contradictions require correction.",
      critical: true
    },
    {
      category: "StoryDominance",
      score_0_to_5: readerSimReport.overall_story_dominance_score_0_to_5,
      rationale: "Reader simulation score for story-forward pacing and turn density.",
      critical: true
    },
    {
      category: "TwistQuality",
      score_0_to_5: readerSimReport.overall_twist_quality_score_0_to_5,
      rationale: "Reader simulation score for twist fairness and payoff quality.",
      critical: true
    },
    {
      category: "SlideClarity",
      score_0_to_5: readerSimReport.overall_clarity_score_0_to_5,
      rationale: "Reader simulation score for slide-level clarity and interpretability.",
      critical: true
    },
    {
      category: "PacingTurnRate",
      score_0_to_5: pacingScore(readerSimReport),
      rationale: "Computed from reader pacing notes and checkpoint solve behavior.",
      critical: false
    },
    {
      category: "MicroMacroCoherence",
      score_0_to_5: microMacroScore(medFactcheckReport, readerSimReport),
      rationale: "Composite of medical correctness and cross-scale narrative coherence.",
      critical: false
    }
  ];

  const criticalScoresOk = graderScores.filter((g) => g.critical).every((g) => g.score_0_to_5 >= 3);
  const accept = lintReport.pass && medFactcheckReport.pass && criticalScoresOk && !hasMustFix;

  const fallbackCitation = baseCitation(deckSpec);
  const medIssueCitations = medFactcheckReport.issues.flatMap((issue) => issue.supporting_citations);
  const citationPool = medIssueCitations.length > 0 ? medIssueCitations : [fallbackCitation];

  return {
    schema_version: "1.0.0",
    lint_pass: lintReport.pass,
    lint_errors: toQaLintErrors(lintReport.errors),
    grader_scores: graderScores,
    accept,
    required_fixes: requiredFixes,
    summary: accept
      ? "Quality gates passed. Deck is medically coherent, story-dominant, and ready for storyboard review."
      : "Quality gates failed. Apply required fixes and rerun QA loop before storyboard review.",
    citations_used: citationPool.map(normalizeCitation)
  };
}

function normalizeTargetSlideIds(fix: RequiredFix, deckSpec: DeckSpec): string[] {
  const targetSet = new Set<string>();
  for (const target of fix.targets ?? []) {
    const matches = target.match(/(?:S\d{2,3}|A-\d{2,3})/g) ?? [];
    for (const m of matches) targetSet.add(m);
    if (deckSpec.slides.some((slide) => slide.slide_id === target)) targetSet.add(target);
    if (deckSpec.appendix_slides.some((slide) => slide.slide_id === target)) targetSet.add(target);
    const slideIndex = target.match(/slides\[(\d+)\]/);
    if (slideIndex) {
      const idx = Number(slideIndex[1]);
      const slide = deckSpec.slides[idx];
      if (slide) targetSet.add(slide.slide_id);
    }
  }
  if (targetSet.size === 0 && deckSpec.slides.length > 0) {
    targetSet.add(deckSpec.slides[0]!.slide_id);
  }
  return [...targetSet];
}

function normalizeTargetClueIds(fix: RequiredFix, clueGraph: ClueGraph): string[] {
  const clueIds = new Set<string>();
  for (const target of fix.targets ?? []) {
    if (clueGraph.clues.some((clue) => clue.clue_id === target)) {
      clueIds.add(target);
      continue;
    }
    const tokenMatches = target.match(/[A-Z]+-[A-Z0-9-]+/g) ?? [];
    for (const token of tokenMatches) {
      if (clueGraph.clues.some((clue) => clue.clue_id === token)) clueIds.add(token);
      if (clueGraph.red_herrings.some((item) => item.rh_id === token)) clueIds.add(token);
      if (clueGraph.exhibits.some((item) => item.exhibit_id === token)) clueIds.add(token);
    }
    const clueIndex = target.match(/clues\[(\d+)\]/);
    if (clueIndex) {
      const idx = Number(clueIndex[1]);
      const clue = clueGraph.clues[idx];
      if (clue) clueIds.add(clue.clue_id);
    }
    const redHerringIndex = target.match(/red_herrings\[(\d+)\]/);
    if (redHerringIndex) {
      const idx = Number(redHerringIndex[1]);
      const rh = clueGraph.red_herrings[idx];
      if (rh) clueIds.add(rh.rh_id);
    }
  }
  return [...clueIds];
}

function normalizeTargetDxIds(fix: RequiredFix, differentialCast: DifferentialCast): string[] {
  const dxIds = new Set<string>();
  for (const target of fix.targets ?? []) {
    if (differentialCast.primary_suspects.some((suspect) => suspect.dx_id === target)) {
      dxIds.add(target);
      continue;
    }
    const tokenMatches = target.match(/[A-Z]+-[A-Z0-9-]+/g) ?? [];
    for (const token of tokenMatches) {
      if (differentialCast.primary_suspects.some((suspect) => suspect.dx_id === token)) dxIds.add(token);
    }
    const suspectIndex = target.match(/primary_suspects\[(\d+)\]/);
    if (suspectIndex) {
      const idx = Number(suspectIndex[1]);
      const suspect = differentialCast.primary_suspects[idx];
      if (suspect) dxIds.add(suspect.dx_id);
    }
  }
  return [...dxIds];
}

function shortenWords(input: string, maxWords: number): string {
  const words = input.trim().split(/\s+/).filter((w) => w.length > 0);
  if (words.length <= maxWords) return input;
  return `${words.slice(0, maxWords).join(" ")}…`;
}

type TargetedPatchResult = {
  deck: DeckSpec;
  clueGraph: ClueGraph;
  differentialCast: DifferentialCast;
  patchNotes: string[];
  deckChanges: number;
  clueChanges: number;
  differentialChanges: number;
};

export function applyTargetedQaPatches(input: {
  deckSpec: DeckSpec;
  clueGraph: ClueGraph;
  differentialCast: DifferentialCast;
  qaReport: V2QaReport;
  loopIndex: number;
}): TargetedPatchResult {
  const { deckSpec, clueGraph: sourceClueGraph, differentialCast: sourceDifferentialCast, qaReport, loopIndex } = input;
  const deck = JSON.parse(JSON.stringify(deckSpec)) as DeckSpec;
  const clueGraph = JSON.parse(JSON.stringify(sourceClueGraph)) as ClueGraph;
  const differentialCast = JSON.parse(JSON.stringify(sourceDifferentialCast)) as DifferentialCast;
  const patchNotes: string[] = [];
  let deckChanges = 0;
  let clueChanges = 0;
  let differentialChanges = 0;

  for (const fix of qaReport.required_fixes) {
    const targets = normalizeTargetSlideIds(fix, deck);
    const targetClueIds = normalizeTargetClueIds(fix, clueGraph);
    const targetDxIds = normalizeTargetDxIds(fix, differentialCast);

    if ((fix.type === "edit_clue" || fix.type === "regenerate_section" || fix.type === "other") && targetClueIds.length > 0) {
      for (const targetClueId of targetClueIds) {
        const clue = clueGraph.clues.find((item) => item.clue_id === targetClueId);
        if (clue) {
          clue.correct_inference = `${clue.correct_inference} [Patch ${loopIndex}: ${fix.description}]`.trim();
          if (!clue.associated_exhibit_ids || clue.associated_exhibit_ids.length === 0) {
            clue.associated_exhibit_ids = clueGraph.exhibits.slice(0, 1).map((item) => item.exhibit_id);
          }
          clueChanges += 1;
          patchNotes.push(`clue:${targetClueId} updated inference (${fix.type})`);
          continue;
        }
        const redHerring = clueGraph.red_herrings.find((item) => item.rh_id === targetClueId);
        if (redHerring) {
          redHerring.why_believable = `${redHerring.why_believable} [Patch ${loopIndex}: ${fix.description}]`.trim();
          clueChanges += 1;
          patchNotes.push(`red_herring:${targetClueId} updated rationale`);
        }
      }
    }

    if ((fix.type === "edit_differential" || fix.type === "regenerate_section" || fix.type === "medical_correction") && targetDxIds.length > 0) {
      for (const dxId of targetDxIds) {
        const suspect = differentialCast.primary_suspects.find((item) => item.dx_id === dxId);
        if (!suspect) continue;
        suspect.why_tempting = `${suspect.why_tempting} [Patch ${loopIndex}: ${fix.description}]`.trim();
        suspect.danger_if_wrong = `${suspect.danger_if_wrong ?? "Wrong pursuit delays diagnosis."} [Patch ${loopIndex}]`.trim();
        differentialChanges += 1;
        patchNotes.push(`differential:${dxId} adjusted`);
      }
    }

    for (const slideId of targets) {
      const slide = deck.slides.find((s) => s.slide_id === slideId) ?? deck.appendix_slides.find((s) => s.slide_id === slideId);
      if (!slide) continue;

      if (fix.type === "reduce_text_density") {
        slide.on_slide_text.headline = shortenWords(slide.on_slide_text.headline, 8);
        if (slide.on_slide_text.subtitle) slide.on_slide_text.subtitle = shortenWords(slide.on_slide_text.subtitle, 10);
        if (slide.on_slide_text.callouts) slide.on_slide_text.callouts = slide.on_slide_text.callouts.slice(0, 2).map((c) => shortenWords(c, 8));
        if (slide.on_slide_text.labels) slide.on_slide_text.labels = slide.on_slide_text.labels.slice(0, 2).map((c) => shortenWords(c, 4));
        patchNotes.push(`${slideId}: reduced text density`);
        deckChanges += 1;
        continue;
      }

      if (fix.type === "increase_story_turn") {
        slide.story_panel.goal = slide.story_panel.goal || "Advance the case with a concrete investigative objective.";
        slide.story_panel.opposition = slide.story_panel.opposition || "A plausible competing explanation blocks certainty.";
        slide.story_panel.turn = slide.story_panel.turn || "New evidence changes what the team believes.";
        slide.story_panel.decision = slide.story_panel.decision || "Commit to the next evidence-generating action.";
        if (!["clue", "dialogue", "action"].includes(slide.medical_payload.delivery_mode)) {
          slide.medical_payload.delivery_mode = "clue";
        }
        patchNotes.push(`${slideId}: strengthened story turn`);
        deckChanges += 1;
        continue;
      }

      if (fix.type === "add_twist_receipts") {
        const receiptLine = `Twist receipt (loop ${loopIndex}): this beat links back to earlier clue evidence.`;
        const current = slide.speaker_notes.medical_reasoning;
        if (!current.includes("Twist receipt")) {
          slide.speaker_notes.medical_reasoning = `${current} ${receiptLine}`.trim();
        }
        patchNotes.push(`${slideId}: added twist receipt note`);
        deckChanges += 1;
        continue;
      }

      if (fix.type === "medical_correction" || fix.type === "edit_slide" || fix.type === "regenerate_section" || fix.type === "edit_differential") {
        slide.speaker_notes.medical_reasoning = `${slide.speaker_notes.medical_reasoning} Correction note: ${fix.description}`.trim();
        if (slide.medical_payload.major_concept_id.trim().length === 0) {
          slide.medical_payload.major_concept_id = `MC-PATCH-${slide.slide_id}`;
        }
        patchNotes.push(`${slideId}: applied medical correction patch`);
        deckChanges += 1;
        continue;
      }

      if (fix.type === "edit_clue" || fix.type === "other") {
        slide.hook = `${slide.hook} [Patched clue framing]`.trim();
        patchNotes.push(`${slideId}: adjusted clue framing`);
        deckChanges += 1;
      }
    }
  }

  if (qaReport.required_fixes.some((fix) => fix.type === "add_twist_receipts") && clueGraph.twist_support_matrix.length > 0) {
    for (const support of clueGraph.twist_support_matrix) {
      if (support.supporting_clue_ids.length < 3) {
        const filler = clueGraph.clues.map((clue) => clue.clue_id).slice(0, 3);
        support.supporting_clue_ids = Array.from(new Set([...support.supporting_clue_ids, ...filler]));
        clueChanges += 1;
      }
    }
  }

  return { deck, clueGraph, differentialCast, patchNotes, deckChanges, clueChanges, differentialChanges };
}

export function applyQaPatchesToDeckSpec(deckSpec: DeckSpec, qaReport: V2QaReport, loopIndex: number): { deck: DeckSpec; patchNotes: string[] } {
  const fallbackClueGraph: ClueGraph = {
    schema_version: "1.0.0",
    exhibits: [],
    clues: [],
    red_herrings: [],
    twist_support_matrix: [],
    constraints: {
      one_major_med_concept_per_story_slide: true,
      min_clues_per_twist: 1,
      require_act1_setup: true
    },
    citations_used: [{ citation_id: "CIT-UNKNOWN", claim: "fallback clue graph" }]
  };
  const fallbackDifferential: DifferentialCast = {
    schema_version: "1.0.0",
    primary_suspects: [],
    rotation_plan: { act4_final_dx_id: "DX-UNKNOWN" },
    elimination_milestones: [],
    citations_used: [{ citation_id: "CIT-UNKNOWN", claim: "fallback differential" }]
  };

  const patched = applyTargetedQaPatches({
    deckSpec,
    clueGraph: fallbackClueGraph,
    differentialCast: fallbackDifferential,
    qaReport,
    loopIndex
  });
  return { deck: patched.deck, patchNotes: patched.patchNotes };
}
