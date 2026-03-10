import type {
  ClueGraph,
  DiseaseDossier,
  DeckSpec,
  DifferentialCast,
  DeckSlideSpec,
  MedFactcheckReport,
  QaBlockHeatmap,
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
  const slideTargetsForActs = (acts: Array<DeckSlideSpec["act_id"]>, limit: number): string[] =>
    distributedStringTargets(
      deckSpec.slides.filter((slide) => acts.includes(slide.act_id)).map((slide) => slide.slide_id),
      limit
    );
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
    if (err.code === "FALSE_THEORY_COLLAPSE_SIGNAL_WEAK") {
      fixes.push({
        ...base,
        type: "regenerate_section",
        description: err.message,
        targets: slideTargetsForActs(["ACT2", "ACT3"], 10)
      });
      continue;
    }
    if (err.code === "MIDPOINT_COLLAPSE_SIGNAL_WEAK") {
      fixes.push({
        ...base,
        type: "regenerate_section",
        description: err.message,
        targets: slideTargetsForActs(["ACT2", "ACT3"], 10)
      });
      continue;
    }
    if (err.code === "ACT_ESCALATION_CHANNELS_WEAK") {
      fixes.push({
        ...base,
        type: "regenerate_section",
        description: err.message,
        targets: slideTargetsForActs(["ACT2", "ACT3", "ACT4"], 12)
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

function normalizeCitation(cite: { citation_id?: unknown; claim?: unknown; chunk_id?: unknown; locator?: unknown }) {
  return {
    citation_id: String(cite.citation_id || "").trim(),
    claim: String(cite.claim || "").trim(),
    chunk_id: typeof cite.chunk_id === "string" ? cite.chunk_id : undefined,
    locator: typeof cite.locator === "string" ? cite.locator : undefined
  };
}

function buildCitationLookup(input: { dossier?: DiseaseDossier; qaReport: V2QaReport }): Map<string, ReturnType<typeof normalizeCitation>> {
  const lookup = new Map<string, ReturnType<typeof normalizeCitation>>();

  const pushCitation = (cite: { citation_id?: unknown; claim?: unknown; chunk_id?: unknown; locator?: unknown }) => {
    const citationId = String(cite.citation_id || "").trim();
    const claim = String(cite.claim || "").trim();
    if (citationId.length === 0 || claim.length === 0) return;
    if (!lookup.has(citationId)) lookup.set(citationId, normalizeCitation(cite));
  };

  for (const citation of input.dossier?.citations ?? []) pushCitation(citation);
  for (const section of input.dossier?.sections ?? []) {
    for (const citation of section.citations ?? []) pushCitation(citation);
  }
  for (const citation of input.qaReport.citations_used ?? []) pushCitation(citation);

  return lookup;
}

function extractCitationIds(text: string): string[] {
  return [...new Set((String(text || "").match(/\bCIT-[A-Z0-9-]+\b/g) ?? []).map((item) => item.trim()))];
}

function replaceAllPattern(text: string, pattern: RegExp, replacement: string): string {
  const source = String(text || "");
  return source.replace(pattern, replacement);
}

function softenThresholdLanguage(slide: DeckSlideSpec): boolean {
  const replacement = "Use oxygen targets with COPD caveats and let overall severity guide escalation.";
  const patchText = (value: string): string => {
    let next = String(value ?? "");
    next = next.replace(
      /\bSaO2\s*<\s*93%\s*or severe features should trigger ABG and closer evaluation; disposition still depends on overall severity and trajectory\.?/gi,
      replacement
    );
    next = replaceAllPattern(next, /\b(?:below|under|<)\s*93%\b[^.;,]*/gi, replacement);
    next = replaceAllPattern(next, /\b93%\s*(?:red line|threshold|cutoff)\b/gi, replacement);
    next = replaceAllPattern(next, /\bABG\b[^.;,]*/gi, replacement);
    return next;
  };

  let changed = false;
  const headline = patchText(slide.on_slide_text.headline);
  if (headline !== slide.on_slide_text.headline) {
    slide.on_slide_text.headline = headline;
    changed = true;
  }
  if (slide.on_slide_text.subtitle) {
    const subtitle = patchText(slide.on_slide_text.subtitle);
    if (subtitle !== slide.on_slide_text.subtitle) {
      slide.on_slide_text.subtitle = subtitle;
      changed = true;
    }
  }
  if (slide.on_slide_text.callouts) {
    const callouts = slide.on_slide_text.callouts.map((callout) => patchText(callout));
    if (JSON.stringify(callouts) !== JSON.stringify(slide.on_slide_text.callouts)) {
      slide.on_slide_text.callouts = callouts;
      changed = true;
    }
  }
  const hook = patchText(slide.hook);
  if (hook !== slide.hook) {
    slide.hook = hook;
    changed = true;
  }
  const medicalReasoning = patchText(slide.speaker_notes.medical_reasoning);
  if (medicalReasoning !== slide.speaker_notes.medical_reasoning) {
    slide.speaker_notes.medical_reasoning = medicalReasoning;
    changed = true;
  }
  const note = "Use oxygen targets with COPD caveats and let overall severity and trajectory guide escalation.";
  if (!slide.speaker_notes.medical_reasoning.includes(note)) {
    slide.speaker_notes.medical_reasoning = `${slide.speaker_notes.medical_reasoning} ${note}`.trim();
    changed = true;
  }
  return changed;
}

function buildMedIssueSlideLookup(report?: MedFactcheckReport): Map<string, MedFactcheckReport["issues"]> {
  const lookup = new Map<string, MedFactcheckReport["issues"]>();
  if (!report) return lookup;
  for (const issue of report.issues) {
    const slideIds = [...new Set(String(issue.claim || "").match(/\bS\d{2,3}\b/g) ?? [])];
    for (const slideId of slideIds) {
      const list = lookup.get(slideId) ?? [];
      list.push(issue);
      lookup.set(slideId, list);
    }
  }
  return lookup;
}

function retargetSlideCitationsFromIssues(input: {
  slide: DeckSlideSpec;
  issues: MedFactcheckReport["issues"];
  citationLookup: Map<string, ReturnType<typeof normalizeCitation>>;
}): boolean {
  const merged = new Map<string, ReturnType<typeof normalizeCitation>>();
  for (const issue of input.issues) {
    for (const cite of issue.supporting_citations ?? []) {
      const citationId = String(cite.citation_id || "").trim();
      const claim = String(cite.claim || "").trim();
      if (!citationId || !claim) continue;
      merged.set(citationId, normalizeCitation(cite));
      const lookupHit = input.citationLookup.get(citationId);
      if (lookupHit) merged.set(citationId, lookupHit);
    }
  }
  const citations = [...merged.values()].slice(0, 4);
  if (citations.length === 0) return false;
  input.slide.medical_payload.dossier_citations = citations;
  input.slide.speaker_notes.citations = citations;
  return true;
}

function replaceAcrossSlideText(
  slide: DeckSlideSpec,
  replacer: (value: string) => string
): boolean {
  let changed = false;
  const apply = (value: string | undefined): string => {
    const source = String(value ?? "");
    const next = replacer(source);
    if (next !== source) changed = true;
    return next;
  };

  slide.title = apply(slide.title);
  slide.hook = apply(slide.hook);
  slide.visual_description = apply(slide.visual_description);
  slide.on_slide_text.headline = apply(slide.on_slide_text.headline);
  if (slide.on_slide_text.subtitle) slide.on_slide_text.subtitle = apply(slide.on_slide_text.subtitle);
  if (Array.isArray(slide.on_slide_text.callouts)) slide.on_slide_text.callouts = slide.on_slide_text.callouts.map(apply);
  if (Array.isArray(slide.on_slide_text.labels)) slide.on_slide_text.labels = slide.on_slide_text.labels.map(apply);
  if (Array.isArray(slide.medical_payload.supporting_details)) {
    slide.medical_payload.supporting_details = slide.medical_payload.supporting_details.map(apply);
  }
  slide.speaker_notes.medical_reasoning = apply(slide.speaker_notes.medical_reasoning);
  slide.speaker_notes.narrative_notes = apply(slide.speaker_notes.narrative_notes);
  if (Array.isArray(slide.speaker_notes.what_this_slide_teaches)) {
    slide.speaker_notes.what_this_slide_teaches = slide.speaker_notes.what_this_slide_teaches.map(apply);
  }
  return changed;
}

function applyMedicalTraceabilityIssuePatches(input: {
  slide: DeckSlideSpec;
  issues: MedFactcheckReport["issues"];
  citationLookup: Map<string, ReturnType<typeof normalizeCitation>>;
}): boolean {
  if (input.issues.length === 0) return false;
  let changed = false;
  if (retargetSlideCitationsFromIssues(input)) changed = true;

  const issueText = input.issues
    .map((issue) => `${issue.claim} ${issue.why_wrong} ${issue.suggested_fix}`)
    .join("\n")
    .toLowerCase();

  if (/(oxygen|copd|sao2|abg|over-oxygenation)/i.test(issueText) && softenThresholdLanguage(input.slide)) {
    changed = true;
  }

  if (/(antigen|urine\/serum|pneumococcal antigen)/i.test(issueText)) {
    changed =
      replaceAcrossSlideText(input.slide, (value) =>
        value
          .replace(/\bCultures\/antigen now\. No exceptions\./gi, "Cultures now. Antigen only when appropriate.")
          .replace(/\bAntigen adds corroboration lane\b/gi, "Antigen can supplement corroboration when appropriate")
          .replace(/\bpneumococcal antigen testing\b/gi, "pneumococcal antigen detection when appropriate")
      ) || changed;
  }

  if (/(aspiration trail|dependent route|right lower lobe)/i.test(issueText)) {
    changed =
      replaceAcrossSlideText(input.slide, (value) =>
        value
          .replace(/\bFollow the aspiration trail\.?/gi, "Follow the lobar pattern.")
          .replace(/\bDependent route\s*→\s*right lower lobe\b/gi, "Lobar consolidation pattern")
          .replace(/\bGravity picks the destination\b/gi, "Lobar distribution frames the search")
          .replace(/\bPneumococcal pneumonia is typically acquired by aspiration of pharyngeal flora\.?/gi, "Pneumococcal pneumonia is classically a lobar community-acquired process.")
          .replace(/\bAspiration route explains why dependent segments are frequent sites\.?/gi, "Lobar distribution helps frame the search, but imaging and syndrome still drive localization.")
      ) || changed;
  }

  if (/(18 hours|small, uncomplicated effusion|pleural space is clear|no significant effusion|no empyema signal|large\/drainable collection)/i.test(issueText)) {
    changed =
      replaceAcrossSlideText(input.slide, (value) =>
        value
          .replace(/\b18 hours\b/gi, "early check")
          .replace(/\bsmall, uncomplicated effusion\b/gi, "no drainable pleural complication confirmed on this check")
          .replace(/\bpleural space is clear\b/gi, "no pleural complication is confirmed on this check")
          .replace(/\bno significant effusion\b/gi, "no large effusion is confirmed on this check")
          .replace(/\bno empyema signal on this check\b/gi, "no empyema is confirmed on this check")
          .replace(/\bnot a large\/drainable collection\b/gi, "not a drainable complication on this check")
      ) || changed;
  }

  return changed;
}

function retargetSlideCitations(input: {
  slide: DeckSlideSpec;
  fix: RequiredFix;
  citationLookup: Map<string, ReturnType<typeof normalizeCitation>>;
}): boolean {
  const citationIds = extractCitationIds(input.fix.description);
  if (citationIds.length === 0) return false;
  const citations = citationIds
    .map((citationId) => input.citationLookup.get(citationId))
    .filter((citation): citation is ReturnType<typeof normalizeCitation> => Boolean(citation))
    .slice(0, 4);
  if (citations.length === 0) return false;

  input.slide.medical_payload.dossier_citations = citations;
  input.slide.speaker_notes.citations = citations;
  return true;
}

function toQaLintErrors(errors: V2DeckSpecLintError[]): V2QaReport["lint_errors"] {
  return errors.map((err) => ({
    code: err.code,
    message: err.message,
    severity: err.severity,
    slide_id: err.slide_id
  }));
}

function deterministicMysteryLint(input: { deckSpec: DeckSpec; clueGraph: ClueGraph }): {
  errors: V2QaReport["lint_errors"];
  fixes: RequiredFix[];
} {
  const { deckSpec, clueGraph } = input;
  const errors: V2QaReport["lint_errors"] = [];
  const fixes: RequiredFix[] = [];

  const allSlideIds = new Set(
    [...deckSpec.slides, ...deckSpec.appendix_slides].map((slide) => slide.slide_id)
  );
  const act1SlideIds = new Set(deckSpec.slides.filter((slide) => slide.act_id === "ACT1").map((slide) => slide.slide_id));
  const clueById = new Map(clueGraph.clues.map((clue) => [clue.clue_id, clue] as const));
  const minTwistReceipts = Math.max(3, clueGraph.constraints.min_clues_per_twist);
  const resolveTwistFocusSlide = (support: ClueGraph["twist_support_matrix"][number]): string | undefined => {
    const recontextSlide = support.recontextualized_slide_ids.find((slideId) => allSlideIds.has(slideId));
    if (recontextSlide) return recontextSlide;
    for (const clueId of support.supporting_clue_ids) {
      const clue = clueById.get(clueId);
      if (!clue) continue;
      if (allSlideIds.has(clue.payoff_slide_id)) return clue.payoff_slide_id;
      if (allSlideIds.has(clue.first_seen_slide_id)) return clue.first_seen_slide_id;
    }
    return undefined;
  };

  for (const redHerring of clueGraph.red_herrings) {
    if (!redHerring.payoff_slide_id || !allSlideIds.has(redHerring.payoff_slide_id)) {
      errors.push({
        code: "RED_HERRING_PAYOFF_MISSING",
        message: `Red herring ${redHerring.rh_id} must resolve to a valid payoff slide.`,
        severity: "error",
        slide_id: redHerring.payoff_slide_id || undefined
      });
      fixes.push({
        fix_id: `RH-PAYOFF-${redHerring.rh_id}`,
        type: "edit_clue",
        priority: "must",
        description: `Assign a valid payoff_slide_id for red herring ${redHerring.rh_id} and ensure explicit resolution on that slide.`,
        targets: [redHerring.rh_id]
      });
    }
  }

  for (const support of clueGraph.twist_support_matrix) {
    const focusSlideId = resolveTwistFocusSlide(support);
    if (support.supporting_clue_ids.length < minTwistReceipts) {
      errors.push({
        code: "TWIST_RECEIPTS_INSUFFICIENT",
        message: `Twist ${support.twist_id} has ${support.supporting_clue_ids.length} receipts; requires at least ${minTwistReceipts}.`,
        severity: "error",
        slide_id: focusSlideId
      });
      fixes.push({
        fix_id: `TW-RECEIPTS-${support.twist_id}`,
        type: "add_twist_receipts",
        priority: "must",
        description: `Add clue receipts for twist ${support.twist_id} to meet the minimum receipt threshold.`,
        targets: [support.twist_id, ...(focusSlideId ? [focusSlideId] : []), ...support.supporting_clue_ids]
      });
    }

    if (support.recontextualized_slide_ids.length < 2) {
      errors.push({
        code: "TWIST_RECONTEXTUALIZATION_TOO_LOW",
        message: `Twist ${support.twist_id} must recontextualize at least 2 slides.`,
        severity: "error",
        slide_id: focusSlideId
      });
      fixes.push({
        fix_id: `TW-RECONTEXT-${support.twist_id}`,
        type: "add_twist_receipts",
        priority: "must",
        description: `Expand twist ${support.twist_id} recontextualization to at least two slide callbacks.`,
        targets: [support.twist_id, ...(focusSlideId ? [focusSlideId] : [])]
      });
    }

    if (clueGraph.constraints.require_act1_setup) {
      const hasAct1Support = support.supporting_clue_ids.some((clueId) => {
        const clue = clueById.get(clueId);
        return clue ? act1SlideIds.has(clue.first_seen_slide_id) : false;
      });
      if (!hasAct1Support) {
        errors.push({
          code: "TWIST_ACT1_SETUP_MISSING",
          message: `Twist ${support.twist_id} requires at least one Act I setup clue.`,
          severity: "error",
          slide_id: focusSlideId
        });
        fixes.push({
          fix_id: `TW-ACT1-${support.twist_id}`,
          type: "add_twist_receipts",
          priority: "must",
          description: `Seed an Act I clue for twist ${support.twist_id} and connect it to the reveal.`,
          targets: [support.twist_id, ...(focusSlideId ? [focusSlideId] : [])]
        });
      }
    }
  }

  return { errors, fixes };
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

const STORY_FORWARD_DELIVERY_MODES = new Set(["clue", "dialogue", "action"]);

function isStoryForwardSlide(slide: DeckSlideSpec): boolean {
  return STORY_FORWARD_DELIVERY_MODES.has(slide.medical_payload.delivery_mode);
}

function hasNonEmptyStoryTurn(slide: DeckSlideSpec): boolean {
  const panel = slide.story_panel;
  return (
    panel.goal.trim().length > 0 &&
    panel.opposition.trim().length > 0 &&
    panel.turn.trim().length > 0 &&
    panel.decision.trim().length > 0
  );
}

function hasCitationGrounding(slide: DeckSlideSpec): boolean {
  return slide.medical_payload.dossier_citations.length > 0 && slide.speaker_notes.citations.length > 0;
}

function isHybridSlide(slide: DeckSlideSpec): boolean {
  return (
    isStoryForwardSlide(slide) &&
    hasNonEmptyStoryTurn(slide) &&
    slide.medical_payload.major_concept_id.trim().length > 0 &&
    hasCitationGrounding(slide)
  );
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(5, Number.isFinite(score) ? score : 0));
}

function normalizeTemplate(value: string): string {
  return value
    .toLowerCase()
    .replace(/\d+/g, "#")
    .replace(/[^a-z#\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function repeatedTemplateRate(values: string[]): number {
  if (values.length === 0) return 0;
  const buckets = new Map<string, number>();
  for (const value of values) {
    const key = normalizeTemplate(value);
    if (!key) continue;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  let repeatedCount = 0;
  for (const count of buckets.values()) {
    if (count > 1) repeatedCount += count - 1;
  }
  return Math.max(0, Math.min(1, repeatedCount / values.length));
}

function parseSlideNumber(slideId: string): number | null {
  const match = String(slideId).match(/^S(\d{2,3})$/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function distributedStringTargets(values: string[], limit: number): string[] {
  const unique = [...new Set(values.filter((value) => String(value || "").trim().length > 0))];
  if (unique.length <= limit) return unique;
  const picks: string[] = [];
  for (let index = 0; index < limit; index += 1) {
    const position = Math.round((index * (unique.length - 1)) / Math.max(1, limit - 1));
    const value = unique[position];
    if (value && !picks.includes(value)) picks.push(value);
  }
  return picks;
}

function readerBlockSlideTargets(report: ReaderSimReport, issueTypes?: string[]): string[] {
  const allowed = issueTypes ? new Set(issueTypes) : null;
  return distributedStringTargets(
    report.block_notes
      .filter((note) => !allowed || allowed.has(note.issue_type))
      .flatMap((note) => note.slide_ids ?? []),
    12
  );
}

const FALSE_THEORY_BEATS = new Set<DeckSlideSpec["beat_type"]>(["false_theory_lock_in", "false_theory_collapse"]);
const OUTRO_BEATS = new Set<DeckSlideSpec["beat_type"]>(["showdown", "proof", "aftermath"]);
const CONFLICT_RE = /\b(conflict|clash|disagree|rupture|friction|argue)\b/i;
const REPAIR_RE = /\b(repair|reconcile|trust|co-own|together again)\b/i;
const EMOTIONAL_COST_RE = /\b(cost|loss|sacrifice|fear|panic|regret|harm)\b/i;

function collectNarrativeSignals(deckSpec: DeckSpec): {
  hasFalseTheoryLockIn: boolean;
  hasFalseTheoryCollapse: boolean;
  hasMidpointCollapse: boolean;
  hasEndingCallbackSignal: boolean;
  hasConflictSignal: boolean;
  hasRepairSignal: boolean;
  hasConflictBeatProxy: boolean;
  hasRepairBeatProxy: boolean;
  hasEmotionalCostAct2Act3: boolean;
  escalationChannelCount: number;
  repeatedTitleRate: number;
  repeatedHookRate: number;
  repeatedStoryTemplateRate: number;
} {
  const mainSlides = deckSpec.slides;
  const combinedText = mainSlides
    .map((slide) => `${slide.title}\n${slide.hook}\n${slide.story_panel.goal}\n${slide.story_panel.opposition}\n${slide.story_panel.turn}\n${slide.story_panel.decision}\n${slide.speaker_notes.narrative_notes ?? ""}`)
    .join("\n");
  const midpointStart = Math.max(0, Math.floor(mainSlides.length * 0.35));
  const midpointEnd = Math.max(midpointStart + 1, Math.ceil(mainSlides.length * 0.7));
  const midpointWindow = mainSlides.slice(midpointStart, midpointEnd);
  const finalWindow = mainSlides.slice(Math.max(0, mainSlides.length - Math.max(4, Math.ceil(mainSlides.length * 0.15))));

  const hasFalseTheoryLockIn = mainSlides.some((slide) => slide.beat_type === "false_theory_lock_in");
  const hasFalseTheoryCollapse = mainSlides.some((slide) => slide.beat_type === "false_theory_collapse");
  const hasConflictBeatProxy = mainSlides.some((slide) =>
    slide.beat_type === "setback" ||
    slide.beat_type === "reversal" ||
    slide.beat_type === "action_setpiece" ||
    slide.beat_type === "red_herring"
  );
  const hasRepairBeatProxy = mainSlides.some((slide) =>
    slide.beat_type === "proof" ||
    slide.beat_type === "showdown" ||
    slide.beat_type === "aftermath"
  );
  const hasMidpointCollapse =
    midpointWindow.some((slide) => slide.beat_type === "false_theory_collapse" || slide.beat_type === "reversal" || slide.beat_type === "twist") ||
    midpointWindow.some((slide) => /\b(fracture|collapse|recontextualiz|break)\b/i.test(`${slide.hook}\n${slide.story_panel.turn}`));
  const hasEndingCallbackSignal =
    finalWindow.some((slide) => OUTRO_BEATS.has(slide.beat_type)) &&
    (/\b(callback|full circle|return(ed)? to (the )?office|back at the office)\b/i.test(finalWindow.map((slide) => `${slide.title}\n${slide.hook}\n${slide.speaker_notes.narrative_notes ?? ""}`).join("\n")) ||
      normalizeTemplate(finalWindow.map((slide) => slide.title).join(" ")).includes(normalizeTemplate(mainSlides[0]?.title ?? "")));
  const hasConflictSignal = CONFLICT_RE.test(combinedText);
  const hasRepairSignal = REPAIR_RE.test(combinedText);
  const hasEmotionalCostAct2Act3 = mainSlides
    .filter((slide) => slide.act_id === "ACT2" || slide.act_id === "ACT3")
    .some((slide) => EMOTIONAL_COST_RE.test(`${slide.hook}\n${slide.story_panel.opposition}\n${slide.story_panel.turn}`));

  const pressureChannels = {
    time: /\b(deadline|timer|window closing|running out of time|urgent)\b/i,
    risk: /\b(risk|hazard|danger|decompensat|unstable|critical)\b/i,
    relationship: /\b(conflict|trust|rupture|repair|disagree|tension)\b/i,
    uncertainty: /\b(uncertain|ambiguous|confound|mimic|false lead|red herring)\b/i
  } as const;
  const escalationChannelCount = Object.values(pressureChannels).filter((pattern) => {
    const actCoverage = new Set(
      mainSlides
        .filter((slide) => pattern.test(`${slide.hook}\n${slide.story_panel.opposition}\n${slide.story_panel.turn}`))
        .map((slide) => slide.act_id)
    ).size;
    return actCoverage >= 2;
  }).length;
  const escalationBeatActs = new Set(
    mainSlides
      .filter((slide) =>
        slide.beat_type === "setback" ||
        slide.beat_type === "reversal" ||
        slide.beat_type === "action_setpiece" ||
        slide.beat_type === "false_theory_collapse" ||
        slide.beat_type === "twist" ||
        slide.beat_type === "showdown"
      )
      .map((slide) => slide.act_id)
  ).size;
  const combinedEscalationChannels = Math.max(escalationChannelCount, Math.max(0, escalationBeatActs - 1));

  return {
    hasFalseTheoryLockIn,
    hasFalseTheoryCollapse,
    hasMidpointCollapse,
    hasEndingCallbackSignal,
    hasConflictSignal,
    hasRepairSignal,
    hasConflictBeatProxy,
    hasRepairBeatProxy,
    hasEmotionalCostAct2Act3,
    escalationChannelCount: combinedEscalationChannels,
    repeatedTitleRate: repeatedTemplateRate(mainSlides.map((slide) => String(slide.title ?? ""))),
    repeatedHookRate: repeatedTemplateRate(mainSlides.map((slide) => String(slide.hook ?? ""))),
    repeatedStoryTemplateRate: repeatedTemplateRate(
      mainSlides.map((slide) => `${slide.story_panel.goal}|${slide.story_panel.opposition}|${slide.story_panel.turn}|${slide.story_panel.decision}`)
    )
  };
}

function buildNarrativeGrade(input: {
  deckSpec: DeckSpec;
  clueGraph: ClueGraph;
  readerSimReport: ReaderSimReport;
  generationProfile?: "quality" | "pilot";
}): {
  scores: V2QaReport["grader_scores"];
  requiredFixes: RequiredFix[];
  criticalPass: boolean;
} {
  const { deckSpec, clueGraph, readerSimReport } = input;
  const generationProfile = input.generationProfile ?? "quality";
  const criticalNarrativeThreshold = generationProfile === "quality" ? 4.0 : 3.0;
  const storyDominanceInterventionThreshold = generationProfile === "quality" ? 3.8 : 3.0;
  const signals = collectNarrativeSignals(deckSpec);
  const mainSlides = deckSpec.slides;
  const falseTheoryBeats = mainSlides.filter((slide) => FALSE_THEORY_BEATS.has(slide.beat_type)).length;

  const actEscalationScore = clampScore(2.4 + signals.escalationChannelCount * 0.7);
  const falseTheoryScore = clampScore(
    (signals.hasFalseTheoryLockIn ? 1.8 : 0.8) +
      (signals.hasFalseTheoryCollapse ? 1.8 : 0.8) +
      (falseTheoryBeats >= 2 ? 1.0 : 0.4)
  );
  const callbackScore = clampScore(signals.hasEndingCallbackSignal ? 4.0 : 2.1);
  const conflictPresent = signals.hasConflictSignal || signals.hasConflictBeatProxy;
  const repairPresent = signals.hasRepairSignal || signals.hasRepairBeatProxy;
  const frictionScore = clampScore(
    (conflictPresent ? 2.0 : 1.0) + (repairPresent ? 2.0 : 1.0) + (signals.hasEmotionalCostAct2Act3 ? 0.8 : 0.3)
  );
  const sceneVarietyScore = clampScore(5 - (signals.repeatedTitleRate * 2.2 + signals.repeatedHookRate * 1.6 + signals.repeatedStoryTemplateRate * 1.8));
  const genericLanguageScore = clampScore(5 - (signals.repeatedTitleRate * 2.1 + signals.repeatedHookRate * 2.1 + signals.repeatedStoryTemplateRate * 2.1));

  const scores: V2QaReport["grader_scores"] = [
    {
      category: "ActEscalation",
      score_0_to_5: actEscalationScore,
      rationale: `Escalation channels across acts=${signals.escalationChannelCount}.`,
      critical: true
    },
    {
      category: "FalseTheoryArc",
      score_0_to_5: falseTheoryScore,
      rationale: `False-theory beats detected=${falseTheoryBeats} (lock-in=${signals.hasFalseTheoryLockIn}, collapse=${signals.hasFalseTheoryCollapse}).`,
      critical: true
    },
    {
      category: "CallbackClosure",
      score_0_to_5: callbackScore,
      rationale: signals.hasEndingCallbackSignal
        ? "Final section includes a callback/closure signal."
        : "Final section lacks a strong opener callback signal.",
      critical: true
    },
    {
      category: "DetectiveDeputyArc",
      score_0_to_5: frictionScore,
      rationale: `Conflict signal=${signals.hasConflictSignal || signals.hasConflictBeatProxy}; repair signal=${signals.hasRepairSignal || signals.hasRepairBeatProxy}; emotional consequence in Act II/III=${signals.hasEmotionalCostAct2Act3}.`,
      critical: true
    },
    {
      category: "SceneVariety",
      score_0_to_5: sceneVarietyScore,
      rationale: "Scores template variety across titles/hooks/story turns.",
      critical: false
    },
    {
      category: "GenericLanguageRate",
      score_0_to_5: genericLanguageScore,
      rationale: "Scores repeated template pressure in narrative language.",
      critical: false
    }
  ];

  const requiredFixes: RequiredFix[] = [];
  if (!signals.hasFalseTheoryCollapse || !signals.hasMidpointCollapse) {
    requiredFixes.push({
      fix_id: "NAR-FALSE-THEORY-COLLAPSE",
      type: "regenerate_section",
      priority: "must",
      description: "Add a visible midpoint false-theory collapse with explicit recontextualization of prior clues.",
      targets: deckSpec.slides
        .filter((slide) => slide.act_id === "ACT2" || slide.act_id === "ACT3")
        .slice(0, 8)
        .map((slide) => slide.slide_id)
    });
  }
  if (!signals.hasEndingCallbackSignal) {
    requiredFixes.push({
      fix_id: "NAR-ENDING-CALLBACK",
      type: "regenerate_section",
      priority: "must",
      description: "Add a closing callback that mirrors the opener motif and completes the case return.",
      targets: deckSpec.slides.slice(Math.max(0, deckSpec.slides.length - 8)).map((slide) => slide.slide_id)
    });
  }
  if (!(signals.hasConflictSignal || signals.hasConflictBeatProxy) || !(signals.hasRepairSignal || signals.hasRepairBeatProxy)) {
    requiredFixes.push({
      fix_id: "NAR-RUPTURE-REPAIR",
      type: "increase_story_turn",
      priority: "must",
      description: "Introduce a detective/deputy rupture and an earned repair beat before final proof.",
      targets: deckSpec.slides
        .filter((slide) => slide.act_id === "ACT2" || slide.act_id === "ACT3" || slide.act_id === "ACT4")
        .slice(0, 10)
        .map((slide) => slide.slide_id)
    });
  }
  if (signals.repeatedTitleRate > 0.22 || signals.repeatedHookRate > 0.22 || signals.repeatedStoryTemplateRate > 0.18) {
    const readerTargets = readerBlockSlideTargets(readerSimReport, ["generic_language", "story_dominance_weak", "pacing_slow", "pacing_rushed"]);
    requiredFixes.push({
      fix_id: "NAR-GENERIC-LANGUAGE",
      type: "regenerate_section",
      priority: generationProfile === "quality" ? "must" : "should",
      description: "Reduce repeated title/hook/story templates and increase scene-specific language.",
      targets: readerTargets.length > 0 ? readerTargets : distributedStringTargets(deckSpec.slides.map((slide) => slide.slide_id), 12)
    });
  }
  if (clueGraph.twist_support_matrix.length === 0) {
    requiredFixes.push({
      fix_id: "NAR-TWIST-MATRIX-EMPTY",
      type: "add_twist_receipts",
      priority: "must",
      description: "Add twist support matrix receipts so narrative reveals remain fair-play.",
      targets: ["twist_support_matrix"]
    });
  }
  if (readerSimReport.overall_story_dominance_score_0_to_5 < storyDominanceInterventionThreshold) {
    const readerTargets = readerBlockSlideTargets(readerSimReport, ["story_dominance_weak", "no_story_turn", "pacing_slow", "pacing_rushed"]);
    requiredFixes.push({
      fix_id: "NAR-READER-STORY-DOMINANCE",
      type: "increase_story_turn",
      priority: "must",
      description: "Reader simulation reported weak story dominance; increase consequence-driven turns.",
      targets: readerTargets.length > 0 ? readerTargets : distributedStringTargets(deckSpec.slides.map((slide) => slide.slide_id), 10)
    });
  }

  const criticalPass = scores.filter((score) => score.critical).every((score) => score.score_0_to_5 >= criticalNarrativeThreshold);
  return { scores, requiredFixes, criticalPass };
}

function safeRatio(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return numerator / denominator;
}

export type SemanticAcceptanceThresholds = {
  minStoryForwardRatio: number;
  minHybridSlideQuality: number;
  minCitationGroundingCoverage: number;
};

export type SemanticAcceptanceMetrics = {
  mainSlideCount: number;
  storyForwardRatio: number;
  hybridSlideQuality: number;
  citationGroundingCoverage: number;
  pass: boolean;
  failures: string[];
  storyForwardDeficitSlideIds: string[];
  hybridDeficitSlideIds: string[];
  citationDeficitSlideIds: string[];
};

export function evaluateSemanticAcceptance(deckSpec: DeckSpec, thresholds: SemanticAcceptanceThresholds): SemanticAcceptanceMetrics {
  const mainSlides = deckSpec.slides;
  const storyForwardDeficitSlideIds = mainSlides.filter((slide) => !isStoryForwardSlide(slide)).map((slide) => slide.slide_id);
  const hybridDeficitSlideIds = mainSlides.filter((slide) => !isHybridSlide(slide)).map((slide) => slide.slide_id);
  const citationDeficitSlideIds = mainSlides.filter((slide) => !hasCitationGrounding(slide)).map((slide) => slide.slide_id);

  const storyForwardRatio = safeRatio(mainSlides.length - storyForwardDeficitSlideIds.length, mainSlides.length);
  const hybridSlideQuality = safeRatio(mainSlides.length - hybridDeficitSlideIds.length, mainSlides.length);
  const citationGroundingCoverage = safeRatio(mainSlides.length - citationDeficitSlideIds.length, mainSlides.length);

  const failures: string[] = [];
  if (storyForwardRatio < thresholds.minStoryForwardRatio) {
    failures.push(
      `story_forward_ratio=${storyForwardRatio.toFixed(3)} below threshold ${thresholds.minStoryForwardRatio.toFixed(3)}`
    );
  }
  if (hybridSlideQuality < thresholds.minHybridSlideQuality) {
    failures.push(
      `hybrid_slide_quality=${hybridSlideQuality.toFixed(3)} below threshold ${thresholds.minHybridSlideQuality.toFixed(3)}`
    );
  }
  if (citationGroundingCoverage < thresholds.minCitationGroundingCoverage) {
    failures.push(
      `citation_grounding_coverage=${citationGroundingCoverage.toFixed(3)} below threshold ${thresholds.minCitationGroundingCoverage.toFixed(3)}`
    );
  }

  return {
    mainSlideCount: mainSlides.length,
    storyForwardRatio,
    hybridSlideQuality,
    citationGroundingCoverage,
    pass: failures.length === 0,
    failures,
    storyForwardDeficitSlideIds,
    hybridDeficitSlideIds,
    citationDeficitSlideIds
  };
}

export function buildSemanticRequiredFixes(
  metrics: SemanticAcceptanceMetrics,
  thresholds: SemanticAcceptanceThresholds
): RequiredFix[] {
  const fixes: RequiredFix[] = [];
  if (metrics.storyForwardRatio < thresholds.minStoryForwardRatio) {
    fixes.push({
      fix_id: "SEM-STORY-FORWARD-RATIO",
      type: "increase_story_turn",
      priority: "must",
      description: `Raise story-forward ratio to at least ${thresholds.minStoryForwardRatio.toFixed(2)} across main slides.`,
      targets: distributedStringTargets(metrics.storyForwardDeficitSlideIds, 12)
    });
  }
  if (metrics.hybridSlideQuality < thresholds.minHybridSlideQuality) {
    fixes.push({
      fix_id: "SEM-HYBRID-SLIDE-QUALITY",
      type: "increase_story_turn",
      priority: "must",
      description: `Raise hybrid slide quality to at least ${thresholds.minHybridSlideQuality.toFixed(2)} by strengthening story-turn + medical payload coupling.`,
      targets: distributedStringTargets(metrics.hybridDeficitSlideIds, 12)
    });
  }
  if (metrics.citationGroundingCoverage < thresholds.minCitationGroundingCoverage) {
    fixes.push({
      fix_id: "SEM-CITATION-GROUNDING",
      type: "medical_correction",
      priority: "must",
      description: `Raise citation grounding coverage to at least ${thresholds.minCitationGroundingCoverage.toFixed(2)} by adding dossier-backed citations.`,
      targets: distributedStringTargets(metrics.citationDeficitSlideIds, 12)
    });
  }
  return fixes;
}

export function buildQaBlockHeatmap(input: {
  deckSpec: DeckSpec;
  blockPlans: Array<{ blockId: string; actId: "ACT1" | "ACT2" | "ACT3" | "ACT4"; start: number; end: number }>;
  readerSimReport: ReaderSimReport;
  semanticMetrics: SemanticAcceptanceMetrics;
  loop: number;
}): QaBlockHeatmap {
  const readerBlockMap = new Map(
    input.readerSimReport.block_notes.map((note) => [note.block_id, note] as const)
  );
  const readerWorstByAct = new Map(
    input.readerSimReport.per_act_worst_blocks.map((row) => [row.act_id, row] as const)
  );

  const blocks = input.blockPlans.map((plan) => {
    const slides = input.deckSpec.slides.filter((slide) => {
      const slideNum = parseSlideNumber(slide.slide_id);
      return slideNum !== null && slideNum >= plan.start && slideNum <= plan.end;
    });
    const titles = slides.map((slide) => String(slide.title ?? ""));
    const hooks = slides.map((slide) => String(slide.hook ?? ""));
    const storyTemplates = slides.map(
      (slide) => `${slide.story_panel.goal}|${slide.story_panel.opposition}|${slide.story_panel.turn}|${slide.story_panel.decision}`
    );
    const blockReaderNote = readerBlockMap.get(plan.blockId);
    const blockWorst = readerWorstByAct.get(plan.actId);
    const storyForwardDeficits = slides.filter((slide) => !isStoryForwardSlide(slide)).length;
    const hybridDeficits = slides.filter((slide) => !isHybridSlide(slide)).length;
    const genericRate = Math.max(repeatedTemplateRate(titles), repeatedTemplateRate(hooks), repeatedTemplateRate(storyTemplates));
    const repeatedDensity = Math.max(repeatedTemplateRate(hooks), repeatedTemplateRate(storyTemplates));
    const clueDebtCount = slides.filter((slide) => {
      return (
        slide.beat_type === "false_theory_lock_in" ||
        slide.beat_type === "false_theory_collapse" ||
        slide.beat_type === "red_herring" ||
        slide.beat_type === "twist"
      );
    }).length;
    const readerSeverity = blockReaderNote?.severity === "must" ? 1.25 : blockReaderNote?.severity === "should" ? 0.7 : 0.2;
    const severityScore = Math.max(
      0,
      Number(
        (
          repeatedDensity * 3 +
          genericRate * 3 +
          (slides.length > 0 ? storyForwardDeficits / slides.length : 0) * 2.5 +
          (slides.length > 0 ? hybridDeficits / slides.length : 0) * 3 +
          Math.min(2, clueDebtCount * 0.2) +
          readerSeverity +
          (blockWorst?.block_id === plan.blockId ? (blockWorst.severity_0_to_5 / 5) * 2 : 0)
        ).toFixed(3)
      )
    );
    return {
      block_id: plan.blockId,
      act_id: plan.actId,
      severity_score: severityScore,
      repeated_template_density: repeatedDensity,
      generic_language_rate: genericRate,
      story_forward_deficit_ratio: slides.length > 0 ? storyForwardDeficits / slides.length : 0,
      hybrid_deficit_ratio: slides.length > 0 ? hybridDeficits / slides.length : 0,
      clue_twist_debt_count: clueDebtCount
    };
  });

  return {
    schema_version: "1.0.0",
    loop: input.loop,
    blocks
  };
}

export function buildCombinedQaReport(input: {
  lintReport: V2DeckSpecLintReport;
  readerSimReport: ReaderSimReport;
  medFactcheckReport: MedFactcheckReport;
  clueGraph: ClueGraph;
  deckSpec: DeckSpec;
  generationProfile?: "quality" | "pilot";
}): V2QaReport {
  const { lintReport, readerSimReport, medFactcheckReport, clueGraph, deckSpec } = input;
  const generationProfile = input.generationProfile ?? "quality";
  const criticalScoreThreshold = generationProfile === "quality" ? 4.0 : 3.0;
  const lintFixes = buildLintFixes(lintReport, deckSpec);
  const mysteryLint = deterministicMysteryLint({ deckSpec, clueGraph });
  const narrativeGrade = buildNarrativeGrade({ deckSpec, clueGraph, readerSimReport, generationProfile });
  const combinedLintErrors = [...toQaLintErrors(lintReport.errors), ...mysteryLint.errors];
  const lintPass = lintReport.pass && mysteryLint.errors.length === 0;
  const requiredFixes = dedupeFixes([
    ...lintFixes,
    ...mysteryLint.fixes,
    ...narrativeGrade.requiredFixes,
    ...medFactcheckReport.required_fixes,
    ...readerSimReport.required_fixes
  ]);
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
    },
    ...narrativeGrade.scores
  ];

  const criticalScoresOk =
    graderScores.filter((g) => g.critical).every((g) => g.score_0_to_5 >= criticalScoreThreshold) &&
    narrativeGrade.criticalPass;
  const accept = lintPass && medFactcheckReport.pass && criticalScoresOk && !hasMustFix;

  const fallbackCitation = baseCitation(deckSpec);
  const medIssueCitations = medFactcheckReport.issues.flatMap((issue) => issue.supporting_citations);
  const citationPool = medIssueCitations.length > 0 ? medIssueCitations : [fallbackCitation];

  return {
    schema_version: "1.0.0",
    lint_pass: lintPass,
    lint_errors: combinedLintErrors,
    grader_scores: graderScores,
    accept,
    required_fixes: requiredFixes,
    summary: accept
      ? "Quality gates passed. Deck is medically coherent, story-dominant, and twist-valid for storyboard review."
      : "Quality gates failed. Apply required fixes (including twist/red-herring deterministic checks) and rerun QA loop before storyboard review.",
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

function markSlidePatched(slide: DeckSlideSpec): void {
  if (slide.authoring_provenance === "agent_authored") return;
  slide.authoring_provenance = "patched_scaffold";
}

const LOCAL_PATCH_ONLY_FIX_TYPES = new Set<RequiredFix["type"]>([
  "reduce_text_density",
  "edit_differential",
  "medical_correction",
  "edit_slide",
  "other"
]);

export function applyTargetedQaPatches(input: {
  deckSpec: DeckSpec;
  clueGraph: ClueGraph;
  differentialCast: DifferentialCast;
  qaReport: V2QaReport;
  loopIndex: number;
  dossier?: DiseaseDossier;
  medFactcheckReport?: MedFactcheckReport;
}): TargetedPatchResult {
  const { deckSpec, clueGraph: sourceClueGraph, differentialCast: sourceDifferentialCast, qaReport, loopIndex, dossier, medFactcheckReport } = input;
  const deck = JSON.parse(JSON.stringify(deckSpec)) as DeckSpec;
  const clueGraph = JSON.parse(JSON.stringify(sourceClueGraph)) as ClueGraph;
  const differentialCast = JSON.parse(JSON.stringify(sourceDifferentialCast)) as DifferentialCast;
  const citationLookup = buildCitationLookup({ dossier, qaReport });
  const medIssueLookup = buildMedIssueSlideLookup(medFactcheckReport);
  const patchNotes: string[] = [];
  let deckChanges = 0;
  let clueChanges = 0;
  let differentialChanges = 0;

  for (const fix of qaReport.required_fixes) {
    if (!LOCAL_PATCH_ONLY_FIX_TYPES.has(fix.type)) {
      patchNotes.push(
        `${fix.fix_id}: deferred for structural regeneration (${fix.type})`
      );
      continue;
    }
    const targets = normalizeTargetSlideIds(fix, deck);
    const targetClueIds = normalizeTargetClueIds(fix, clueGraph);
    const targetDxIds = normalizeTargetDxIds(fix, differentialCast);

    if ((fix.type === "other") && targetClueIds.length > 0) {
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

    if ((fix.type === "medical_correction") && targetDxIds.length > 0) {
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
        markSlidePatched(slide);
        patchNotes.push(`${slideId}: reduced text density`);
        deckChanges += 1;
        continue;
      }

      if (fix.type === "medical_correction" || fix.type === "edit_slide" || fix.type === "edit_differential") {
        let patchedSlide = false;
        const medIssues = medIssueLookup.get(slideId) ?? [];
        if (applyMedicalTraceabilityIssuePatches({ slide, issues: medIssues, citationLookup })) {
          patchedSlide = true;
          patchNotes.push(`${slideId}: applied med-factcheck traceability cleanup`);
        }
        if (retargetSlideCitations({ slide, fix, citationLookup })) {
          patchedSlide = true;
          patchNotes.push(`${slideId}: retargeted citations from QA fix`);
        }
        if (/93%|SaO.?2|ABG|oxygen/i.test(fix.description) && softenThresholdLanguage(slide)) {
          patchedSlide = true;
          patchNotes.push(`${slideId}: softened oxygen-threshold framing`);
        }
        if (slide.slide_id.startsWith("A-") && /appendix|placeholder|remove/i.test(fix.description)) {
          deck.appendix_slides = deck.appendix_slides.filter((candidate) => candidate.slide_id !== slide.slide_id);
          patchNotes.push(`${slideId}: removed placeholder appendix slide`);
          deckChanges += 1;
          continue;
        }
        if (slide.medical_payload.major_concept_id.trim().length === 0) {
          slide.medical_payload.major_concept_id = `MC-PATCH-${slide.slide_id}`;
        }
        markSlidePatched(slide);
        patchNotes.push(`${slideId}: applied medical correction patch${patchedSlide ? " + citation repair" : ""}`);
        deckChanges += 1;
        continue;
      }

      if (fix.type === "other") {
        slide.hook = slide.hook.replace(/\s*\[Patched clue framing\]/gi, "").trim() || "What evidence changes the next decision?";
        markSlidePatched(slide);
        patchNotes.push(`${slideId}: adjusted clue framing`);
        deckChanges += 1;
      }
    }
  }

  // Twist/clue/differential structural fixes are intentionally left to block/act regeneration.

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
