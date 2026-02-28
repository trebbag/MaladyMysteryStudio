import { slug } from "../utils.js";
import type { ClueGraph, DeckSpec, DifferentialCast, DiseaseDossier, TruthModel } from "./schemas.js";
import { DeckSpecSchema, DiseaseDossierSchema } from "./schemas.js";

type CitationRef = {
  citation_id: string;
  claim: string;
  chunk_id?: string;
  locator?: string;
};

const GENERIC_CITATION_ID_RE = /^CIT-0*\d+$/i;
const GENERIC_MAJOR_CONCEPT_RE = /^(?:NONE|MC[-_]?0*\d+|MC[-_]?PATCH[-_A-Z0-9]*)$/i;
const GENERIC_DX_ID_RE = /^DX(?:[-_]?0*\d+|[-_]?(?:PRIMARY|UNKNOWN))$/i;
const STORY_FORWARD_MODES: Array<DeckSpec["slides"][number]["medical_payload"]["delivery_mode"]> = ["clue", "dialogue", "action"];

function shortWords(input: string, maxWords: number): string {
  const words = String(input || "")
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  if (words.length <= maxWords) return words.join(" ");
  return words.slice(0, maxWords).join(" ");
}

function sectionToken(section: string): string {
  return slug(section || "core")
    .replace(/-/g, "_")
    .slice(0, 30);
}

function sectionLabel(section: string): string {
  return section.replace(/_/g, " ").trim();
}

function cleanNarrativeText(value: string): string {
  return String(value || "")
    .replace(/\bCLUE[_-]?[A-Z0-9_-]+\b/g, "signal")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanCitation(citation: CitationRef): CitationRef {
  return {
    citation_id: String(citation.citation_id || "").trim(),
    claim: String(citation.claim || "").trim() || "Dossier-grounded claim.",
    ...(citation.chunk_id ? { chunk_id: citation.chunk_id } : {}),
    ...(citation.locator ? { locator: citation.locator } : {})
  };
}

function slideCitationPool(dossier: DiseaseDossier): CitationRef[] {
  const bySection = dossier.sections.flatMap((section) =>
    section.citations.map((citation) =>
      cleanCitation({
        citation_id: citation.citation_id,
        claim: citation.claim,
        chunk_id: citation.chunk_id,
        locator: citation.locator
      })
    )
  );
  const base = dossier.citations.map((citation) =>
    cleanCitation({
      citation_id: citation.citation_id,
      claim: citation.claim,
      chunk_id: citation.chunk_id,
      locator: citation.locator
    })
  );
  const all = [...bySection, ...base];
  const dedup = new Map<string, CitationRef>();
  for (const citation of all) {
    if (!citation?.citation_id) continue;
    const key = `${citation.citation_id}::${citation.claim}`;
    if (!dedup.has(key)) dedup.set(key, citation);
  }
  if (dedup.size > 0) return [...dedup.values()];
  return [
    {
      citation_id: "CIT_KB_FALLBACK_01",
      chunk_id: "kb_context.md",
      locator: "fallback",
      claim: "Fallback KB grounding."
    }
  ];
}

function ensureStoryForwardRatio(deck: DeckSpec, targetRatio: number): void {
  const target = Math.max(0.75, Math.min(0.95, targetRatio));
  const required = Math.ceil(deck.slides.length * target);
  let current = deck.slides.filter((slide) => STORY_FORWARD_MODES.includes(slide.medical_payload.delivery_mode)).length;
  if (current >= required) return;

  for (const slide of deck.slides) {
    if (current >= required) break;
    if (STORY_FORWARD_MODES.includes(slide.medical_payload.delivery_mode)) continue;
    slide.medical_payload.delivery_mode = current % 2 === 0 ? "clue" : "dialogue";
    current += 1;
  }
}

function normalizeDxIds(ids: string[], validDxIds: string[], fallbackA: string, fallbackB: string): string[] {
  const canonical = (value: string): string => String(value || "").trim().replace(/_/g, "-").toUpperCase();
  const validByCanonical = new Map(validDxIds.map((id) => [canonical(id), id] as const));
  const resolved = ids
    .map((id) => String(id || "").trim())
    .filter((id) => id.length > 0)
    .map((id, idx) => {
      const normalized = canonical(id);
      const match = validByCanonical.get(normalized);
      if (match && !GENERIC_DX_ID_RE.test(match)) return match;
      return idx === 0 ? fallbackA : fallbackB;
    });
  return [...new Set(resolved)];
}

function normalizeMajorConceptId(raw: string, section: string, index: number): string {
  const value = String(raw || "").trim();
  if (value.length === 0 || GENERIC_MAJOR_CONCEPT_RE.test(value)) {
    return `mc_${sectionToken(section)}_${String(index + 1).padStart(2, "0")}`;
  }
  return slug(value).replace(/-/g, "_").slice(0, 48);
}

function nextCitationId(sectionHint: string, used: Set<string>, counterRef: { value: number }): string {
  const base = `CIT_${sectionToken(sectionHint || "source").toUpperCase()}`.slice(0, 32);
  while (true) {
    const candidate = `${base}_${String(counterRef.value).padStart(2, "0")}`;
    counterRef.value += 1;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}

export function normalizeDossierCitationIds(dossier: DiseaseDossier, topic: string): DiseaseDossier {
  const copy = JSON.parse(JSON.stringify(dossier)) as DiseaseDossier;
  const used = new Set<string>();
  const generated = new Map<string, string>();
  const counterRef = { value: 1 };

  const remap = (citation: CitationRef, sectionHint: string): CitationRef => {
    const currentId = String(citation.citation_id || "").trim();
    if (!currentId) {
      return {
        ...citation,
        citation_id: nextCitationId(sectionHint, used, counterRef)
      };
    }
    if (!GENERIC_CITATION_ID_RE.test(currentId)) {
      used.add(currentId);
      return citation;
    }
    const key = `${currentId}::${String(citation.claim || "").trim()}`;
    const existing = generated.get(key);
    if (existing) {
      return { ...citation, citation_id: existing };
    }
    const nextId = nextCitationId(sectionHint || topic || "source", used, counterRef);
    generated.set(key, nextId);
    return { ...citation, citation_id: nextId };
  };

  copy.sections = copy.sections.map((section, idx) => ({
    ...section,
    citations: section.citations.map((citation) =>
      remap(
        {
          citation_id: citation.citation_id,
          claim: citation.claim,
          chunk_id: citation.chunk_id,
          locator: citation.locator
        },
        section.section || `section_${idx + 1}`
      )
    )
  }));

  copy.citations = copy.citations.map((citation, idx) =>
    remap(
      {
        citation_id: citation.citation_id,
        claim: citation.claim,
        chunk_id: citation.chunk_id,
        locator: citation.locator
      },
      `source_${idx + 1}_${topic || copy.canonical_name}`
    )
  );
  return DiseaseDossierSchema.parse(copy);
}

export function polishDeckSpecForFallback(input: {
  deckSpec: DeckSpec;
  dossier: DiseaseDossier;
  differentialCast: DifferentialCast;
  clueGraph: ClueGraph;
  truthModel: TruthModel;
  topic: string;
}): DeckSpec {
  const { deckSpec, dossier, differentialCast, clueGraph, truthModel, topic } = input;
  const deck = JSON.parse(JSON.stringify(deckSpec)) as DeckSpec;
  const sections =
    dossier.sections.length > 0
      ? dossier.sections
      : [
          {
            section: "core",
            key_points: [`Core mechanism for ${topic}`],
            citations: slideCitationPool(dossier)
          }
        ];
  const citations = slideCitationPool(dossier);
  const validCitationIds = new Set(citations.map((citation) => citation.citation_id));
  const canonicalDx = (value: string): string => String(value || "").trim().replace(/_/g, "-").toUpperCase();
  const validDxIds = [
    ...new Map(
      [truthModel.final_diagnosis.dx_id, ...differentialCast.primary_suspects.map((suspect) => suspect.dx_id)].map((dxId) => [canonicalDx(dxId), canonicalDx(dxId)])
    ).values()
  ];
  const clues = clueGraph.clues;
  const exhibits = clueGraph.exhibits.map((exhibit) => exhibit.exhibit_id);
  const turnVerbs = ["discover", "exclude", "reframe", "confirm", "falsify"];
  const oppositionTemplates = [
    "A plausible mimic still fits part of the pattern.",
    "A red herring interpretation stalls certainty.",
    "Conflicting signals force a careful re-check."
  ];
  const decisionTemplates = [
    "Run the next discriminator now.",
    "Test the highest-yield contradiction.",
    "Commit to evidence that can falsify the mimic."
  ];
  const consequenceTemplates = [
    "The suspect board narrows under pressure.",
    "The timeline tightens and options shrink.",
    "The team gains leverage for the final proof."
  ];

  for (let idx = 0; idx < deck.slides.length; idx++) {
    const slide = deck.slides[idx]!;
    const section = sections[idx % sections.length]!;
    const sectionTitle = sectionLabel(section.section);
    const sectionPointA = shortWords(`Key ${sectionTitle.toLowerCase()} evidence updates diagnostic probability.`, 13);
    const sectionPointB = shortWords(`Use cited ${sectionTitle.toLowerCase()} guidance for the next clinical decision.`, 13);
    const clue = clues[idx % Math.max(1, clues.length)];
    const evidencePhrase = shortWords(
      cleanNarrativeText(clue?.observed ?? clue?.correct_inference ?? sectionPointA) || shortWords(`${sectionTitle} signal`, 4),
      6
    );
    const sectionCitations = section.citations.map((citation) =>
      cleanCitation({
        citation_id: citation.citation_id,
        claim: citation.claim,
        chunk_id: citation.chunk_id,
        locator: citation.locator
      })
    );
    const preferredCitation =
      sectionCitations.find((citation) => validCitationIds.has(citation.citation_id) && !GENERIC_CITATION_ID_RE.test(citation.citation_id)) ??
      sectionCitations[0] ??
      citations[idx % citations.length]!;
    const topDxA = validDxIds[idx % validDxIds.length] ?? canonicalDx(truthModel.final_diagnosis.dx_id);
    const topDxB = validDxIds[(idx + 1) % validDxIds.length] ?? canonicalDx(truthModel.final_diagnosis.dx_id);
    const eliminated = normalizeDxIds(clue?.eliminates_dx_ids ?? [], validDxIds, topDxA, topDxB)
      .filter((dxId) => dxId !== topDxA && dxId !== topDxB)
      .slice(0, 1);
    const actVerb = turnVerbs[idx % turnVerbs.length]!;

    slide.title = `${slide.slide_id}: ${shortWords(`${sectionTitle} ${evidencePhrase}`, 8)}`;
    slide.on_slide_text.headline = shortWords(`${sectionTitle}`, 4);
    slide.on_slide_text.subtitle = shortWords(`${evidencePhrase}`, 4);
    slide.on_slide_text.callouts = [shortWords(sectionPointA, 4), shortWords(`${actVerb} signal`, 3)];
    slide.on_slide_text.labels = [slide.slide_id, `Act ${slide.act_id.replace("ACT", "")}`];

    slide.story_panel.goal = shortWords(`${actVerb} this signal at ${slide.slide_id} to advance ${sectionTitle}.`, 12);
    slide.story_panel.opposition = shortWords(oppositionTemplates[idx % oppositionTemplates.length]!, 11);
    slide.story_panel.turn = shortWords(cleanNarrativeText(sectionPointA), 12);
    slide.story_panel.decision = shortWords(decisionTemplates[idx % decisionTemplates.length]!, 9);
    slide.story_panel.consequence = shortWords(consequenceTemplates[idx % consequenceTemplates.length]!, 9);
    slide.hook = shortWords(`How does this signal reweight suspects?`, 8);

    slide.medical_payload.major_concept_id = normalizeMajorConceptId(slide.medical_payload.major_concept_id, section.section, idx);
    slide.medical_payload.supporting_details = [sectionPointA, sectionPointB];
    if (!STORY_FORWARD_MODES.includes(slide.medical_payload.delivery_mode)) {
      slide.medical_payload.delivery_mode = STORY_FORWARD_MODES[idx % STORY_FORWARD_MODES.length]!;
    }
    slide.medical_payload.linked_learning_objectives = [`lo_${sectionToken(section.section)}`, `lo_${sectionToken(truthModel.final_diagnosis.name)}`];
    slide.medical_payload.dossier_citations = [preferredCitation];

    if (clue?.associated_exhibit_ids?.length) {
      slide.exhibit_ids = clue.associated_exhibit_ids.slice(0, 2);
    } else if (exhibits.length > 0) {
      slide.exhibit_ids = [exhibits[idx % exhibits.length]!];
    }

    slide.speaker_notes.medical_reasoning = shortWords(`Evidence anchor: ${cleanNarrativeText(sectionPointA)} ${cleanNarrativeText(sectionPointB)}`, 26);
    slide.speaker_notes.what_this_slide_teaches = [shortWords(`How ${sectionTitle} shifts differential priorities.`, 10)];
    slide.speaker_notes.differential_update.top_dx_ids = normalizeDxIds(
      slide.speaker_notes.differential_update.top_dx_ids ?? [topDxA, topDxB],
      validDxIds,
      topDxA,
      topDxB
    ).slice(0, 2);
    if (slide.speaker_notes.differential_update.top_dx_ids.length < 2) {
      slide.speaker_notes.differential_update.top_dx_ids = [topDxA, topDxB];
    }
    slide.speaker_notes.differential_update.eliminated_dx_ids = normalizeDxIds(
      slide.speaker_notes.differential_update.eliminated_dx_ids ?? eliminated,
      validDxIds,
      topDxA,
      topDxB
    ).filter((dxId) => !slide.speaker_notes.differential_update.top_dx_ids.includes(dxId));
    slide.speaker_notes.differential_update.why = shortWords(
      `${sectionTitle} evidence supports ${truthModel.final_diagnosis.name} over weaker mimics.`,
      15
    );
    slide.speaker_notes.citations = [preferredCitation];
  }

  for (let idx = 0; idx < deck.appendix_slides.length; idx++) {
    const slide = deck.appendix_slides[idx]!;
    const citation = citations[idx % citations.length]!;
    slide.medical_payload.major_concept_id = normalizeMajorConceptId(
      slide.medical_payload.major_concept_id,
      `appendix_${topic || truthModel.final_diagnosis.name}`,
      idx
    );
    slide.medical_payload.dossier_citations = [citation];
    slide.speaker_notes.citations = [citation];
    slide.speaker_notes.differential_update.top_dx_ids = [canonicalDx(truthModel.final_diagnosis.dx_id)];
    slide.speaker_notes.differential_update.eliminated_dx_ids = [];
    slide.speaker_notes.differential_update.why = shortWords("Appendix evidence supports final diagnostic lock.", 12);
  }

  ensureStoryForwardRatio(deck, Math.max(deck.deck_meta.story_dominance_target_ratio, 0.8));
  deck.deck_meta.story_dominance_target_ratio = Math.max(deck.deck_meta.story_dominance_target_ratio, 0.8);
  deck.deck_meta.max_words_on_slide = Math.min(deck.deck_meta.max_words_on_slide, 22);
  return DeckSpecSchema.parse(deck);
}
