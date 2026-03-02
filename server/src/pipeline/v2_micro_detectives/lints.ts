import type { DeckSpec, V2DeckSpecLintError, V2DeckSpecLintReport } from "./schemas.js";

const STORY_FORWARD_MODES = new Set(["clue", "dialogue", "action"]);
const COMPOUND_CONCEPT_TOKENS = [",", ";", "+", "/", "|", " and ", "&"];

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
};

function normalizeDeckLengthLintConfig(input: 30 | 45 | 60 | DeckLengthLintConfig | undefined): {
  deckLengthConstraintEnabled: boolean;
  targetDeckLengthMain?: 30 | 45 | 60;
  softTargetToleranceSlides?: number;
} {
  if (typeof input === "number") {
    return {
      deckLengthConstraintEnabled: true,
      targetDeckLengthMain: input
    };
  }
  if (!input) {
    return {
      deckLengthConstraintEnabled: false
    };
  }
  return {
    deckLengthConstraintEnabled: input.deckLengthConstraintEnabled === true,
    targetDeckLengthMain: input.targetDeckLengthMain,
    softTargetToleranceSlides: input.softTargetToleranceSlides
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

  const report: V2DeckSpecLintReport = {
    workflow: "v2_micro_detectives",
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
    pass: errors.filter((e) => e.severity === "error").length === 0,
    errorCount: errors.filter((e) => e.severity === "error").length,
    warningCount: errors.filter((e) => e.severity === "warning").length,
    errors
  };
  return report;
}
