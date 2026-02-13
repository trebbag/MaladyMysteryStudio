import type { CanonicalProfile, CanonicalProfilePaths } from "./canon.js";
import type { PatchOutput, ShowrunnerOutput, VisualDirectorOutput } from "./schemas.js";
import type { SimilarityMatch } from "./repetition_guard.js";

const TOKEN_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
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

const RULE_REQUIRED_RE = /\b(must|required|always|ensure|keep|use)\b/i;
const RULE_FORBIDDEN_RE = /\b(do not|don't|never|avoid|forbidden|no)\b/i;
const FORBIDDEN_DIRECTIVE_TOKENS = new Set([
  "avoid",
  "never",
  "forbidden",
  "dont",
  "do",
  "not",
  "no",
  "keep",
  "always",
  "ensure",
  "must",
  "required",
  "use"
]);

export type ConstraintAdherenceStatus = "pass" | "warn" | "fail";

export type ConstraintAdherenceSummary = {
  status: ConstraintAdherenceStatus;
  failureCount: number;
  warningCount: number;
  checkedAt: string;
};

export type ConstraintAdherenceReport = {
  status: ConstraintAdherenceStatus;
  checked_at: string;
  canonical_sources: CanonicalProfilePaths & { foundAny: boolean };
  failures: string[];
  warnings: string[];
  details: {
    canonical_characters: string[];
    matched_story_characters: string[];
    missing_story_characters: string[];
    required_style_rules_checked: number;
    required_style_rule_hits: number;
    forbidden_style_hits: string[];
    slide_mode_counts: {
      hybrid: number;
      story_transition: number;
    };
    intro_outro_contract_status: {
      status: "pass" | "fail";
      issues: string[];
    };
    medical_only_violations: string[];
    master_doc_validation_status: "not_checked" | "pass" | "warn" | "fail";
    semantic_similarity?: {
      closest_run_id: string;
      score: number;
      threshold: number;
      retried: boolean;
    };
  };
};

export type ConstraintCheckInput = {
  canonical: CanonicalProfile;
  storyBible: ShowrunnerOutput["story_bible"];
  beatSheet: ShowrunnerOutput["beat_sheet"];
  shotList: VisualDirectorOutput["shot_list"];
  finalPatched: PatchOutput["final_slide_spec_patched"];
  semanticSimilarity?: {
    closest: SimilarityMatch;
    threshold: number;
    retried: boolean;
  } | null;
  masterDocValidation?: {
    status: "pass" | "warn" | "fail";
    errors: string[];
  } | null;
  checkedAt: string;
};

function norm(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

function cleanName(input: string): string {
  return input
    .replace(/[`*_#>[\]]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(input: string): string[] {
  return norm(input)
    .split(" ")
    .map((w) => w.trim())
    .filter((w) => w.length >= 4 && !TOKEN_STOP_WORDS.has(w));
}

function extractCharacterCandidates(markdown: string | undefined): string[] {
  if (!markdown) return [];
  const lines = markdown.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const heading = trimmed.match(/^#{1,4}\s+(.+)$/);
    if (heading?.[1]) out.push(cleanName(heading[1]));

    const keyed = trimmed.match(/(?:^[-*]\s*)?(?:name|character)\s*[:|-]\s*(.+)$/i);
    if (keyed?.[1]) out.push(cleanName(keyed[1]));
  }

  return uniq(
    out.filter((v) => {
      if (!v || v.length < 3 || v.length > 60) return false;
      const n = norm(v);
      if (!n) return false;
      if (n.includes("character bible")) return false;
      if (n.includes("series style")) return false;
      if (n.includes("deck spec")) return false;
      return true;
    })
  );
}

type RuleLine = {
  raw: string;
  required: boolean;
  forbidden: boolean;
  markerTokens: string[];
};

function extractRuleLines(markdown: string | undefined): RuleLine[] {
  if (!markdown) return [];
  const lines = markdown.split(/\r?\n/);
  const out: RuleLine[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const required = RULE_REQUIRED_RE.test(trimmed);
    const forbidden = RULE_FORBIDDEN_RE.test(trimmed);
    if (!required && !forbidden) continue;

    let markerTokens = tokens(trimmed).slice(0, 5);
    if (forbidden) {
      // For forbidden rules, use only the first clause and strip directive verbs.
      // This focuses on violation terms (e.g., "gore") and avoids false positives
      // when the model repeats safe policy language (e.g., "avoid gore").
      const firstClause = trimmed.split(/[.;:]/)[0] ?? trimmed;
      markerTokens = tokens(firstClause)
        .filter((t) => !FORBIDDEN_DIRECTIVE_TOKENS.has(t))
        .slice(0, 4);
    }

    out.push({ raw: trimmed, required, forbidden, markerTokens });
  }
  return out;
}

function tokenHitForForbiddenRule(haystack: string, token: string): boolean {
  if (!haystack.includes(token)) return false;

  // If the token is only mentioned in negated policy text, treat it as compliant.
  // We match compact normalized phrases against normalized output text.
  const safePhrases = [`avoid ${token}`, `never ${token}`, `do not ${token}`, `dont ${token}`, `no ${token}`];
  if (safePhrases.some((phrase) => haystack.includes(phrase))) {
    return false;
  }

  return true;
}

function ruleHit(rule: RuleLine, haystack: string): boolean {
  if (rule.markerTokens.length === 0) return false;
  const hitCount = rule.forbidden
    ? rule.markerTokens.filter((t) => tokenHitForForbiddenRule(haystack, t)).length
    : rule.markerTokens.filter((t) => haystack.includes(t)).length;
  if (rule.forbidden) return hitCount >= Math.min(2, rule.markerTokens.length);
  return hitCount >= 1;
}

export function evaluateConstraintAdherence(input: ConstraintCheckInput): ConstraintAdherenceReport {
  const failures: string[] = [];
  const warnings: string[] = [];

  const canonicalChars = extractCharacterCandidates(input.canonical.character_bible_md);
  const storyChars = uniq([
    ...input.storyBible.cast.map((c) => c.name),
    ...input.beatSheet.flatMap((b) => b.characters)
  ]).map(cleanName);

  const storyNormSet = new Set(storyChars.map((c) => norm(c)));
  const matchedChars = canonicalChars.filter((c) => {
    const n = norm(c);
    if (!n) return false;
    if (storyNormSet.has(n)) return true;
    return [...storyNormSet].some((x) => x.includes(n) || n.includes(x));
  });
  const missingChars = canonicalChars.filter((c) => !matchedChars.includes(c));

  if (canonicalChars.length > 0 && matchedChars.length === 0) {
    failures.push("No canonical character from character_bible was reused in story_bible/beat_sheet.");
  } else if (canonicalChars.length > 1 && matchedChars.length / canonicalChars.length < 0.25) {
    warnings.push("Only a small fraction of canonical characters were reused.");
  }

  const styleText = [input.canonical.series_style_bible_md, input.canonical.deck_spec_md].filter(Boolean).join("\n");
  const rules = extractRuleLines(styleText);
  const requiredRules = rules.filter((r) => r.required && !r.forbidden);
  const forbiddenRules = rules.filter((r) => r.forbidden);

  const visualOutText = norm(
    JSON.stringify({
      story_bible: input.storyBible,
      shot_list: input.shotList,
      final_slide_spec_patched: input.finalPatched
    })
  );

  let requiredHits = 0;
  for (const rule of requiredRules) {
    if (ruleHit(rule, visualOutText)) requiredHits += 1;
  }
  if (requiredRules.length > 0 && requiredHits === 0) {
    warnings.push("No canonical style-rule markers were detected in output visuals/slides.");
  }

  const forbiddenHits = forbiddenRules.filter((rule) => ruleHit(rule, visualOutText)).map((r) => r.raw);
  if (forbiddenHits.length > 0) {
    warnings.push(`Detected canonical forbidden-style marker hit(s): ${forbiddenHits.slice(0, 3).join(" | ")}`);
  }

  const slides = input.finalPatched.slides as Array<Record<string, unknown>>;
  const slideModeCounts = {
    hybrid: slides.filter((s) => s.slide_mode === "hybrid").length,
    story_transition: slides.filter((s) => s.slide_mode === "story_transition").length
  };

  const medicalOnlyViolations: string[] = [];
  const requiredFieldViolations: string[] = [];
  const transitionViolations: string[] = [];
  const recurringAssetViolations: string[] = [];
  const recurringCharacterViolations: string[] = [];

  const primerAssets = new Set(input.finalPatched.reusable_visual_primer.reusable_visual_elements.map((v) => norm(v)));
  const castNames = new Set(input.storyBible.cast.map((c) => norm(c.name)));

  for (const slideRaw of slides) {
    const slideId = String(slideRaw.slide_id ?? "unknown");
    const requiredKeys = [
      "slide_mode",
      "medical_visual_mode",
      "used_assets",
      "used_characters",
      "scene_description",
      "narrative_phase",
      "location_description",
      "character_staging",
      "story_and_dialogue"
    ];
    for (const key of requiredKeys) {
      const value = slideRaw[key];
      const missing =
        value === undefined ||
        value === null ||
        (typeof value === "string" && value.trim().length === 0) ||
        (Array.isArray(value) && value.length === 0);
      if (missing) requiredFieldViolations.push(`${slideId}:${key}`);
    }

    const mode = String(slideRaw.slide_mode ?? "");
    const hud = Array.isArray(slideRaw.hud_panel_bullets) ? (slideRaw.hud_panel_bullets as unknown[]).map((v) => String(v).trim()) : [];
    const usedCharacters = Array.isArray(slideRaw.used_characters) ? (slideRaw.used_characters as unknown[]).map((v) => String(v).trim()) : [];
    const usedAssets = Array.isArray(slideRaw.used_assets) ? (slideRaw.used_assets as unknown[]).map((v) => String(v).trim()) : [];

    if (mode === "hybrid") {
      if (hud.length === 0) medicalOnlyViolations.push(slideId);
    }
    if (mode === "story_transition" && hud.length > 0) {
      transitionViolations.push(`${slideId}: story_transition must not contain hud_panel_bullets`);
    }

    for (const asset of usedAssets) {
      if (!primerAssets.has(norm(asset))) recurringAssetViolations.push(`${slideId}:${asset}`);
    }
    for (const character of usedCharacters) {
      if (!castNames.has(norm(character))) recurringCharacterViolations.push(`${slideId}:${character}`);
    }
  }

  if (medicalOnlyViolations.length > 0) {
    failures.push(`Medical-only slide violation(s): ${medicalOnlyViolations.join(", ")}`);
  }
  if (requiredFieldViolations.length > 0) {
    failures.push(`Missing required slide field(s): ${requiredFieldViolations.join(" | ")}`);
  }
  if (transitionViolations.length > 0) {
    failures.push(`Transition-slide field violation(s): ${transitionViolations.join(" | ")}`);
  }

  const maxTransitionWarn = Math.max(2, Math.ceil(slides.length * 0.25));
  const maxTransitionFail = Math.max(3, Math.ceil(slides.length * 0.5));
  if (slideModeCounts.story_transition > maxTransitionFail) {
    failures.push(`Too many story_transition slides (${slideModeCounts.story_transition}/${slides.length}).`);
  } else if (slideModeCounts.story_transition > maxTransitionWarn) {
    warnings.push(`High story_transition slide count (${slideModeCounts.story_transition}/${slides.length}).`);
  }

  if (recurringAssetViolations.length > 0) {
    warnings.push(`Found slide assets not in reusable primer: ${recurringAssetViolations.slice(0, 8).join(" | ")}`);
  }
  if (recurringCharacterViolations.length > 0) {
    warnings.push(`Found slide characters not in story_bible.cast: ${recurringCharacterViolations.slice(0, 8).join(" | ")}`);
  }

  const arc = input.finalPatched.story_arc_contract as Record<string, unknown>;
  const allSlideIds = new Set(slides.map((s) => String(s.slide_id ?? "")).filter((v) => v.length > 0));
  const introIds = Array.isArray(arc.intro_slide_ids) ? arc.intro_slide_ids.map((v) => String(v)) : [];
  const outroIds = Array.isArray(arc.outro_slide_ids) ? arc.outro_slide_ids.map((v) => String(v)) : [];
  const entryToBody = String(arc.entry_to_body_slide_id ?? "");
  const returnToOffice = String(arc.return_to_office_slide_id ?? "");
  const callback = String(arc.callback_slide_id ?? "");
  const introOutroIssues: string[] = [];

  if (introIds.length !== 3) introOutroIssues.push(`intro_slide_ids must contain 3 ids (found ${introIds.length})`);
  if (outroIds.length !== 2) introOutroIssues.push(`outro_slide_ids must contain 2 ids (found ${outroIds.length})`);
  for (const id of [...introIds, ...outroIds, entryToBody, returnToOffice, callback]) {
    if (!id || !allSlideIds.has(id)) introOutroIssues.push(`contract references missing slide_id: ${id || "(empty)"}`);
  }
  if (new Set([...introIds, ...outroIds]).size !== introIds.length + outroIds.length) {
    introOutroIssues.push("intro/outro slide IDs must not overlap");
  }
  if (introOutroIssues.length > 0) failures.push(`Intro/outro contract violation(s): ${introOutroIssues.join(" | ")}`);

  let masterDocValidationStatus: "not_checked" | "pass" | "warn" | "fail" = "not_checked";
  if (input.masterDocValidation) {
    masterDocValidationStatus = input.masterDocValidation.status;
    if (input.masterDocValidation.status === "fail") {
      failures.push(`Master doc validation failed: ${input.masterDocValidation.errors.join(" | ")}`);
    } else if (input.masterDocValidation.status === "warn") {
      warnings.push(`Master doc validation warning: ${input.masterDocValidation.errors.join(" | ")}`);
    }
  }

  if (input.semanticSimilarity) {
    const { closest, threshold, retried } = input.semanticSimilarity;
    if (closest.score >= 0.93) {
      failures.push(`Story is too similar to prior run ${closest.runId} (score=${closest.score.toFixed(3)}).`);
    } else if (closest.score >= threshold) {
      warnings.push(`Story remains semantically similar to prior run ${closest.runId} (score=${closest.score.toFixed(3)}).`);
    }
    if (!retried && closest.score >= threshold) {
      warnings.push("Semantic repetition guard did not retry even though threshold was hit.");
    }
  }

  let status: ConstraintAdherenceStatus = "pass";
  if (failures.length > 0) status = "fail";
  else if (warnings.length > 0) status = "warn";

  return {
    status,
    checked_at: input.checkedAt,
    canonical_sources: {
      ...input.canonical.paths,
      foundAny: input.canonical.foundAny
    },
    failures,
    warnings,
    details: {
      canonical_characters: canonicalChars,
      matched_story_characters: matchedChars,
      missing_story_characters: missingChars,
      required_style_rules_checked: requiredRules.length,
      required_style_rule_hits: requiredHits,
      forbidden_style_hits: forbiddenHits,
      slide_mode_counts: slideModeCounts,
      intro_outro_contract_status: {
        status: introOutroIssues.length === 0 ? "pass" : "fail",
        issues: introOutroIssues
      },
      medical_only_violations: medicalOnlyViolations,
      master_doc_validation_status: masterDocValidationStatus,
      semantic_similarity: input.semanticSimilarity
        ? {
            closest_run_id: input.semanticSimilarity.closest.runId,
            score: input.semanticSimilarity.closest.score,
            threshold: input.semanticSimilarity.threshold,
            retried: input.semanticSimilarity.retried
          }
        : undefined
    }
  };
}

export function summarizeConstraintAdherence(report: ConstraintAdherenceReport): ConstraintAdherenceSummary {
  return {
    status: report.status,
    failureCount: report.failures.length,
    warningCount: report.warnings.length,
    checkedAt: report.checked_at
  };
}
