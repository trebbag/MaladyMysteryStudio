import type { DeckSpec, V2DeckSpecLintError, V2DeckSpecLintReport, V2StageAuthoringProvenance } from "./schemas.js";

const STORY_FORWARD_MODES = new Set(["clue", "dialogue", "action"]);
const COMPOUND_CONCEPT_TOKENS = [",", ";", "+", "/", "|", " and ", "&"];
const FALLBACK_CITATION_ID_RE = /^(CIT-KB-001|CIT-UNKNOWN|CIT-SCAFFOLD|CIT-00\d+)$/i;
const GENERIC_DX_ID_RE = /^(DX_PRIMARY|DX_ALTERNATE|DX_MIMIC|DX_UNKNOWN|DX-\d+)$/i;
const GENERIC_CALLOUT_RE = /^(observe|discriminate|commit)$/i;
const GENERIC_TITLE_RE = /\b(overview|summary|case file|topic intro)\b/i;
const GENERIC_HOOK_RE = /\b(what does s\d{2,3}|what did we miss)\b/i;
const SCAFFOLD_TITLE_RE = /\b(scaffold|fallback)\b/i;
const SCAFFOLD_HOOK_RE = /\b(next move\?|fallback)\b/i;
const SCAFFOLD_CONCEPT_ID_RE = /^(MC-PATCH-|mc_[a-z0-9_]+_\d{2,3}$)/;
const FALSE_THEORY_COLLAPSE_RE = /\b(false[-\s]?theory|wrong diagnosis|misdiagnos|collapse|debunk)\b/i;
const ENDING_CALLBACK_RE = /\b(callback|circle back|full circle|back at the office|return(ed)? to the office)\b/i;
const CONFLICT_RE = /\b(conflict|clash|disagree|rupture|friction|argue)\b/i;
const REPAIR_RE = /\b(repair|reconcile|regain trust|restore trust|team up|co-own)\b/i;
const MIDPOINT_COLLAPSE_RE = /\b(midpoint|fracture|collapse|breaks down|recontextualiz)\b/i;
const EMOTIONAL_COST_RE = /\b(cost|loss|sacrifice|fear|panic|regret|harm)\b/i;
const PRESSURE_CHANNELS: Record<string, RegExp> = {
  time: /\b(deadline|timer|window closing|running out of time|urgent)\b/i,
  risk: /\b(risk|hazard|danger|decompensat|unstable|critical)\b/i,
  relationship: /\b(conflict|trust|rupture|repair|disagree|tension)\b/i,
  uncertainty: /\b(uncertain|ambiguous|confound|mimic|false lead|red herring)\b/i
};

function countWords(text: string): number {
  const tokens = text
    .trim()
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return tokens.length;
}

function countSlideWords(slide: DeckSpec["slides"][number]): number {
  const pieces = [slide.on_slide_text.headline];
  if (slide.on_slide_text.subtitle) pieces.push(slide.on_slide_text.subtitle);
  if (Array.isArray(slide.on_slide_text.callouts)) pieces.push(...slide.on_slide_text.callouts);
  if (Array.isArray(slide.on_slide_text.labels)) pieces.push(...slide.on_slide_text.labels);
  return countWords(pieces.join(" "));
}

function isStoryForwardSlide(slide: DeckSpec["slides"][number]): boolean {
  return STORY_FORWARD_MODES.has(slide.medical_payload.delivery_mode);
}

function isCompoundMajorConceptId(conceptId: string): boolean {
  const normalized = conceptId.trim().toLowerCase();
  if (normalized === "none") return false;
  return COMPOUND_CONCEPT_TOKENS.some((token) => normalized.includes(token));
}

function normalizeNarrativeTemplate(value: string): string {
  return value
    .toLowerCase()
    .replace(/\d+/g, "#")
    .replace(/[^a-z#\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function collectDuplicateGroups(items: Array<{ key: string; slideId: string }>, minGroupSize: number): Array<{ key: string; slideIds: string[] }> {
  const buckets = new Map<string, string[]>();
  for (const item of items) {
    if (!item.key) continue;
    const list = buckets.get(item.key) ?? [];
    list.push(item.slideId);
    buckets.set(item.key, list);
  }
  const groups: Array<{ key: string; slideIds: string[] }> = [];
  for (const [key, slideIds] of buckets.entries()) {
    if (slideIds.length >= minGroupSize) groups.push({ key, slideIds });
  }
  return groups;
}

function pushError(errors: V2DeckSpecLintError[], code: string, message: string, slideId?: string): void {
  errors.push({
    code,
    message,
    severity: "error",
    ...(slideId ? { slide_id: slideId } : {})
  });
}

type DeckLengthLintConfig = {
  deckLengthConstraintEnabled?: boolean;
  targetDeckLengthMain?: 30 | 45 | 60;
  softTargetToleranceSlides?: number;
  generationProfile?: "quality" | "pilot";
  maxScaffoldSlides?: number;
  enforceQualityLints?: boolean;
  stageAuthoringProvenance?: V2StageAuthoringProvenance;
};

function normalizeDeckLengthLintConfig(input: 30 | 45 | 60 | DeckLengthLintConfig | undefined): {
  deckLengthConstraintEnabled: boolean;
  targetDeckLengthMain?: 30 | 45 | 60;
  softTargetToleranceSlides?: number;
  generationProfile: "quality" | "pilot";
  maxScaffoldSlides?: number;
  enforceQualityLints: boolean;
  stageAuthoringProvenance?: V2StageAuthoringProvenance;
} {
  if (typeof input === "number") {
    return {
      deckLengthConstraintEnabled: true,
      targetDeckLengthMain: input,
      generationProfile: "quality",
      enforceQualityLints: false
    };
  }
  if (!input) {
    return {
      deckLengthConstraintEnabled: false,
      generationProfile: "quality",
      enforceQualityLints: false
    };
  }
  return {
    deckLengthConstraintEnabled: input.deckLengthConstraintEnabled === true,
    targetDeckLengthMain: input.targetDeckLengthMain,
    softTargetToleranceSlides: input.softTargetToleranceSlides,
    generationProfile: input.generationProfile ?? "quality",
    maxScaffoldSlides: input.maxScaffoldSlides,
    enforceQualityLints: input.enforceQualityLints === true,
    stageAuthoringProvenance: input.stageAuthoringProvenance
  };
}

function pushWarning(errors: V2DeckSpecLintError[], code: string, message: string, slideId?: string): void {
  errors.push({
    code,
    message,
    severity: "warning",
    ...(slideId ? { slide_id: slideId } : {})
  });
}

export function lintDeckSpecPhase1(
  deck: DeckSpec,
  options?: 30 | 45 | 60 | DeckLengthLintConfig
): V2DeckSpecLintReport {
  const deckLengthConfig = normalizeDeckLengthLintConfig(options);
  const errors: V2DeckSpecLintError[] = [];
  const mainSlides = deck.slides;
  const measuredDeckLengthMain = mainSlides.length;
  const strictQualityNarrative = deckLengthConfig.enforceQualityLints && deckLengthConfig.generationProfile === "quality";
  const pushNarrativeSignal = (code: string, message: string, slideId?: string) => {
    if (strictQualityNarrative) {
      pushError(errors, code, message, slideId);
      return;
    }
    pushWarning(errors, code, message, slideId);
  };

  const declaredLength = Number(deck.deck_meta.deck_length_main);
  if (!Number.isFinite(declaredLength)) {
    pushError(errors, "DECK_META_LENGTH_INVALID", "deck_meta.deck_length_main must be a numeric string.");
  } else if (declaredLength !== measuredDeckLengthMain) {
    pushError(
      errors,
      "DECK_META_LENGTH_MISMATCH",
      `deck_meta.deck_length_main=${declaredLength} but measured main slide count=${measuredDeckLengthMain}.`
    );
  }

  if (deckLengthConfig.deckLengthConstraintEnabled && typeof deckLengthConfig.targetDeckLengthMain === "number") {
    const tolerance =
      typeof deckLengthConfig.softTargetToleranceSlides === "number"
        ? Math.max(0, Math.round(deckLengthConfig.softTargetToleranceSlides))
        : Math.max(4, Math.round(deckLengthConfig.targetDeckLengthMain * 0.2));
    const delta = Math.abs(measuredDeckLengthMain - deckLengthConfig.targetDeckLengthMain);
    if (delta > tolerance) {
      pushWarning(
        errors,
        "MAIN_SLIDE_COUNT_OUTSIDE_SOFT_TARGET",
        `Main deck has ${measuredDeckLengthMain} slides; soft target=${deckLengthConfig.targetDeckLengthMain} (tolerance ±${tolerance}).`
      );
    }
    if (Number.isFinite(declaredLength) && declaredLength !== deckLengthConfig.targetDeckLengthMain) {
      pushWarning(
        errors,
        "DECK_META_LENGTH_OUTSIDE_SOFT_TARGET",
        `deck_meta.deck_length_main=${declaredLength} differs from soft target ${deckLengthConfig.targetDeckLengthMain}.`
      );
    }
  }

  for (const slide of mainSlides) {
    if (!slide.story_panel.goal.trim() || !slide.story_panel.opposition.trim() || !slide.story_panel.turn.trim() || !slide.story_panel.decision.trim()) {
      pushError(errors, "MISSING_STORY_TURN", "Main slide must include non-empty story_panel goal/opposition/turn/decision.", slide.slide_id);
    }

    const words = countSlideWords(slide);
    if (words > deck.deck_meta.max_words_on_slide) {
      pushError(
        errors,
        "ON_SLIDE_WORD_LIMIT_EXCEEDED",
        `Slide has ${words} words; max_words_on_slide=${deck.deck_meta.max_words_on_slide}.`,
        slide.slide_id
      );
    }

    if (!slide.medical_payload.major_concept_id.trim()) {
      pushError(errors, "MAJOR_CONCEPT_EMPTY", "major_concept_id cannot be empty.", slide.slide_id);
    } else if (isCompoundMajorConceptId(slide.medical_payload.major_concept_id)) {
      pushError(
        errors,
        "MAJOR_CONCEPT_COMPOUND",
        "major_concept_id appears compound; only one major concept may be introduced per main slide.",
        slide.slide_id
      );
    }

    if (deckLengthConfig.enforceQualityLints) {
      if (SCAFFOLD_CONCEPT_ID_RE.test(slide.medical_payload.major_concept_id)) {
        pushError(errors, "SCAFFOLD_CONCEPT_ID", "major_concept_id appears scaffold-like; replace with authored concept ID.", slide.slide_id);
      }
      const allCitationIds = [
        ...slide.medical_payload.dossier_citations.map((citation) => citation.citation_id),
        ...slide.speaker_notes.citations.map((citation) => citation.citation_id)
      ];
      if (allCitationIds.some((citationId) => FALLBACK_CITATION_ID_RE.test(citationId))) {
        pushError(errors, "FALLBACK_CITATION_ID", "Slide includes fallback citation IDs; replace with grounded dossier citations.", slide.slide_id);
      }

      if ((slide.speaker_notes.differential_update.top_dx_ids ?? []).some((dxId) => GENERIC_DX_ID_RE.test(dxId))) {
        pushError(errors, "GENERIC_DX_ID", "Differential IDs include scaffold placeholders; replace with specific diagnosis IDs.", slide.slide_id);
      }

      if (slide.title && GENERIC_TITLE_RE.test(slide.title)) {
        pushError(errors, "GENERIC_SLIDE_TITLE", "Slide title is generic/scaffold-like; provide a specific authored title.", slide.slide_id);
      }
      if (slide.title && SCAFFOLD_TITLE_RE.test(slide.title)) {
        pushError(errors, "SCAFFOLD_SLIDE_TITLE", "Slide title contains scaffold/fallback markers; replace with authored title.", slide.slide_id);
      }
      if (GENERIC_HOOK_RE.test(slide.hook)) {
        pushError(errors, "GENERIC_SLIDE_HOOK", "Slide hook appears scaffold-like; provide a concrete authored hook.", slide.slide_id);
      }
      if (SCAFFOLD_HOOK_RE.test(slide.hook)) {
        pushError(errors, "SCAFFOLD_SLIDE_HOOK", "Slide hook contains scaffold/fallback phrasing; replace with authored hook.", slide.slide_id);
      }
      if ((slide.on_slide_text.callouts ?? []).every((callout) => GENERIC_CALLOUT_RE.test(callout)) && (slide.on_slide_text.callouts ?? []).length > 0) {
        pushError(errors, "GENERIC_CALLOUTS", "Slide callouts are scaffold defaults; replace with authored, context-specific callouts.", slide.slide_id);
      }
    }
  }

  if (deckLengthConfig.enforceQualityLints && deckLengthConfig.generationProfile === "quality" && deckLengthConfig.stageAuthoringProvenance) {
    const stages = deckLengthConfig.stageAuthoringProvenance.stages;
    if (stages.micro_world_map.source !== "agent") {
      pushError(
        errors,
        "STORY_STAGE_DETERMINISTIC_FALLBACK",
        `micro_world_map used deterministic fallback (${stages.micro_world_map.reason ?? "unknown"}).`
      );
    }
    if (stages.drama_plan.source !== "agent") {
      pushError(
        errors,
        "STORY_STAGE_DETERMINISTIC_FALLBACK",
        `drama_plan used deterministic fallback (${stages.drama_plan.reason ?? "unknown"}).`
      );
    }
    if (stages.setpiece_plan.source !== "agent") {
      pushError(
        errors,
        "STORY_STAGE_DETERMINISTIC_FALLBACK",
        `setpiece_plan used deterministic fallback (${stages.setpiece_plan.reason ?? "unknown"}).`
      );
    }
  }

  const storyForwardCount = mainSlides.filter((slide) => isStoryForwardSlide(slide)).length;
  const storyForwardRatio = measuredDeckLengthMain > 0 ? storyForwardCount / measuredDeckLengthMain : 0;
  const storyForwardTargetRatio = Math.max(0.7, deck.deck_meta.story_dominance_target_ratio);
  if (storyForwardRatio < storyForwardTargetRatio) {
    pushError(
      errors,
      "STORY_DOMINANCE_BELOW_TARGET",
      `Story-forward ratio=${storyForwardRatio.toFixed(3)} below target=${storyForwardTargetRatio.toFixed(3)}.`
    );
  }

  const scaffoldDerivedMainSlides = mainSlides.filter((slide) => slide.authoring_provenance !== "agent_authored").length;
  const scaffoldLimitMainSlides =
    typeof deckLengthConfig.maxScaffoldSlides === "number"
      ? Math.max(0, Math.round(deckLengthConfig.maxScaffoldSlides))
      : Math.max(1, Math.ceil(measuredDeckLengthMain * 0.02));
  if (deckLengthConfig.enforceQualityLints && deckLengthConfig.generationProfile === "quality" && scaffoldDerivedMainSlides > scaffoldLimitMainSlides) {
    pushError(
      errors,
      "SCAFFOLD_PROVENANCE_EXCEEDED",
      `Scaffold-derived main slides=${scaffoldDerivedMainSlides} exceed quality limit=${scaffoldLimitMainSlides}.`
    );
  }

  if (deckLengthConfig.enforceQualityLints) {
    const duplicateTitleGroups = collectDuplicateGroups(
      mainSlides.map((slide) => ({ key: normalizeNarrativeTemplate(String(slide.title ?? "")), slideId: slide.slide_id })),
      3
    );
    for (const group of duplicateTitleGroups) {
      pushNarrativeSignal(
        "REPEATED_SLIDE_TITLE_TEMPLATE",
        `Slides reuse the same title template across ${group.slideIds.length} slides (${group.slideIds.slice(0, 5).join(", ")}).`,
        group.slideIds[0]
      );
    }

    const duplicateHookGroups = collectDuplicateGroups(
      mainSlides.map((slide) => ({ key: normalizeNarrativeTemplate(String(slide.hook ?? "")), slideId: slide.slide_id })),
      3
    );
    for (const group of duplicateHookGroups) {
      pushNarrativeSignal(
        "REPEATED_HOOK_TEMPLATE",
        `Slides reuse the same hook template across ${group.slideIds.length} slides (${group.slideIds.slice(0, 5).join(", ")}).`,
        group.slideIds[0]
      );
    }

    const duplicateStoryPanelGroups = collectDuplicateGroups(
      mainSlides.map((slide) => ({
        key: normalizeNarrativeTemplate(
          `${slide.story_panel.goal}|${slide.story_panel.opposition}|${slide.story_panel.turn}|${slide.story_panel.decision}`
        ),
        slideId: slide.slide_id
      })),
      3
    );
    for (const group of duplicateStoryPanelGroups) {
      pushNarrativeSignal(
        "REPEATED_STORY_PANEL_TEMPLATE",
        `Slides reuse the same story-panel template across ${group.slideIds.length} slides (${group.slideIds.slice(0, 5).join(", ")}).`,
        group.slideIds[0]
      );
    }

    const joinedDeckText = mainSlides
      .map((slide) => `${slide.title}\n${slide.hook}\n${slide.story_panel.goal}\n${slide.story_panel.opposition}\n${slide.story_panel.turn}\n${slide.story_panel.decision}\n${slide.speaker_notes.narrative_notes ?? ""}`)
      .join("\n");
    if (!FALSE_THEORY_COLLAPSE_RE.test(joinedDeckText)) {
      pushNarrativeSignal("FALSE_THEORY_COLLAPSE_SIGNAL_WEAK", "No strong false-theory collapse signal was detected in deck narrative text.");
    }

    const finalWindowStart = Math.max(0, mainSlides.length - Math.max(4, Math.ceil(mainSlides.length * 0.15)));
    const finalWindowText = mainSlides
      .slice(finalWindowStart)
      .map((slide) => `${slide.title}\n${slide.hook}\n${slide.speaker_notes.narrative_notes ?? ""}`)
      .join("\n");
    if (!ENDING_CALLBACK_RE.test(finalWindowText)) {
      pushNarrativeSignal("ENDING_CALLBACK_SIGNAL_WEAK", "Final-act slides do not show a strong opener-callback signal.");
    }

    if (!(CONFLICT_RE.test(joinedDeckText) && REPAIR_RE.test(joinedDeckText))) {
      pushNarrativeSignal("DETECTIVE_DEPUTY_ARC_SIGNAL_WEAK", "Deck narrative lacks clear conflict + repair signals for the detective/deputy arc.");
    }

    const midpointWindowStart = Math.max(0, Math.floor(mainSlides.length * 0.35));
    const midpointWindowEnd = Math.min(mainSlides.length, Math.ceil(mainSlides.length * 0.7));
    const midpointText = mainSlides
      .slice(midpointWindowStart, midpointWindowEnd)
      .map((slide) => `${slide.title}\n${slide.hook}\n${slide.story_panel.turn}`)
      .join("\n");
    if (!MIDPOINT_COLLAPSE_RE.test(midpointText)) {
      pushNarrativeSignal("MIDPOINT_COLLAPSE_SIGNAL_WEAK", "Midpoint section does not show a clear collapse/recontextualization signal.");
    }

    const act23Slides = mainSlides.filter((slide) => slide.act_id === "ACT2" || slide.act_id === "ACT3");
    const act23Text = act23Slides
      .map((slide) => `${slide.title}\n${slide.hook}\n${slide.story_panel.opposition}\n${slide.story_panel.turn}`)
      .join("\n");
    if (act23Slides.length > 0 && !EMOTIONAL_COST_RE.test(act23Text)) {
      pushNarrativeSignal("EMOTIONAL_COST_SIGNAL_WEAK", "Acts II/III do not show clear emotional/consequence language.");
    }

    const channelCoverage = Object.entries(PRESSURE_CHANNELS).map(([channel, re]) => ({
      channel,
      actCoverage: new Set(
        mainSlides
          .filter((slide) => {
            const text = `${slide.title}\n${slide.hook}\n${slide.story_panel.opposition}\n${slide.story_panel.turn}`;
            return re.test(text);
          })
          .map((slide) => slide.act_id)
      ).size
    }));
    const strongChannels = channelCoverage.filter((item) => item.actCoverage >= 2).length;
    if (strongChannels < 2) {
      pushNarrativeSignal(
        "ACT_ESCALATION_CHANNELS_WEAK",
        `Only ${strongChannels} pressure channels escalate across at least two acts; target is >= 2.`
      );
    }

    let exhibitStreak = 0;
    let maxExhibitStreak = 0;
    for (const slide of mainSlides) {
      if (slide.medical_payload.delivery_mode === "exhibit") {
        exhibitStreak += 1;
        if (exhibitStreak > maxExhibitStreak) maxExhibitStreak = exhibitStreak;
      } else {
        exhibitStreak = 0;
      }
    }
    if (maxExhibitStreak > 6) {
      pushError(errors, "EXHIBIT_STREAK_TOO_LONG", `Found ${maxExhibitStreak} consecutive exhibit-heavy slides; limit is 6.`);
    } else if (maxExhibitStreak > 4) {
      pushWarning(errors, "EXHIBIT_STREAK_HIGH", `Found ${maxExhibitStreak} consecutive exhibit-heavy slides; target <= 4.`);
    }

    const theoryUpdates = mainSlides.filter((slide) => slide.beat_type === "theory_update" || slide.beat_type === "false_theory_lock_in");
    const weakTheoryConsequence = theoryUpdates.filter((slide) => {
      const consequence = `${slide.story_panel.consequence ?? ""} ${slide.story_panel.turn}`.trim();
      return consequence.length < 20 || !/(cost|risk|stakes|loss|harm|deadline|urgent|fracture|collapse|consequence)/i.test(consequence);
    });
    if (theoryUpdates.length > 0) {
      const weakRatio = weakTheoryConsequence.length / theoryUpdates.length;
      if (weakRatio > 0.55 && strictQualityNarrative) {
        pushError(
          errors,
          "THEORY_UPDATE_LOW_CONSEQUENCE",
          `${weakTheoryConsequence.length}/${theoryUpdates.length} theory-update slides lack clear dramatic consequence.`
        );
      } else if (weakRatio > 0.4) {
        pushWarning(
          errors,
          "THEORY_UPDATE_LOW_CONSEQUENCE",
          `${weakTheoryConsequence.length}/${theoryUpdates.length} theory-update slides lack clear dramatic consequence.`
        );
      }
    }

    const act23ClueSlides = mainSlides.filter(
      (slide) =>
        (slide.act_id === "ACT2" || slide.act_id === "ACT3") &&
        (slide.beat_type === "clue_discovery" || slide.beat_type === "reversal" || slide.beat_type === "twist")
    );
    const emotionalCostClueSlides = act23ClueSlides.filter((slide) =>
      EMOTIONAL_COST_RE.test(`${slide.hook}\n${slide.story_panel.opposition}\n${slide.story_panel.turn}\n${slide.story_panel.consequence ?? ""}`)
    );
    if (act23ClueSlides.length > 0 && emotionalCostClueSlides.length === 0) {
      pushNarrativeSignal(
        "EMOTIONAL_COST_CLUE_MISSING",
        "Acts II/III clue-driven slides lack an emotionally costly clue moment."
      );
    }
  }

  const report: V2DeckSpecLintReport = {
    workflow: "v2_micro_detectives",
    generationProfile: deckLengthConfig.generationProfile,
    deckLengthConstraintEnabled: deckLengthConfig.deckLengthConstraintEnabled,
    expectedDeckLengthMain: deckLengthConfig.deckLengthConstraintEnabled ? deckLengthConfig.targetDeckLengthMain : undefined,
    softTargetToleranceSlides:
      deckLengthConfig.deckLengthConstraintEnabled && typeof deckLengthConfig.targetDeckLengthMain === "number"
        ? typeof deckLengthConfig.softTargetToleranceSlides === "number"
          ? Math.max(0, Math.round(deckLengthConfig.softTargetToleranceSlides))
          : Math.max(4, Math.round(deckLengthConfig.targetDeckLengthMain * 0.2))
        : undefined,
    measuredDeckLengthMain,
    storyForwardRatio,
    storyForwardTargetRatio,
    scaffoldDerivedMainSlides,
    scaffoldLimitMainSlides,
    pass: errors.filter((e) => e.severity === "error").length === 0,
    errorCount: errors.filter((e) => e.severity === "error").length,
    warningCount: errors.filter((e) => e.severity === "warning").length,
    errors
  };
  return report;
}
