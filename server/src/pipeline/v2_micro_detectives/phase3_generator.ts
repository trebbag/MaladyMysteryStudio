import type { DeckSpec, DifferentialCast, DiseaseDossier, ReaderSimReport, TruthModel, ClueGraph } from "./schemas.js";
import { ClueGraphSchema, DifferentialCastSchema, ReaderSimReportSchema } from "./schemas.js";

function firstCitation(dossier: DiseaseDossier): { citation_id: string; claim: string } {
  return dossier.citations[0] ?? { citation_id: "CIT-UNKNOWN", claim: "Fallback citation." };
}

function topicToken(value: string): string {
  return String(value || "core")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
}

function slideId(deck: DeckSpec, index: number): string {
  if (deck.slides.length === 0) return "S01";
  return deck.slides[Math.max(0, Math.min(deck.slides.length - 1, index))]!.slide_id;
}

export function generateDifferentialCast(deck: DeckSpec, dossier: DiseaseDossier, truthModel: TruthModel): DifferentialCast {
  const cite = firstCitation(dossier);
  const base = topicToken(truthModel.final_diagnosis.name || dossier.canonical_name);
  const finalDxId = truthModel.final_diagnosis.dx_id || `DX_${base}`;
  const fallbackNames = ["Mimic syndrome", "Iatrogenic process", "Dual-process overlap", "Localization trap"];
  const primary = [0, 1, 2, 3].map((idx) => ({
    dx_id: idx === 0 ? finalDxId : `DX_MIMIC_${base}_${idx}`,
    name: idx === 0 ? truthModel.final_diagnosis.name : fallbackNames[idx] ?? `Differential ${idx + 1}`,
    why_tempting: "Early observations make this diagnosis appear plausible.",
    signature_fingerprint: [
      {
        type: "pattern",
        statement: "Key discriminator pattern used in reasoning.",
        citations: [cite]
      }
    ],
    danger_if_wrong: "Anchoring here can delay correct intervention.",
    what_it_mimics: [finalDxId],
    citations: [cite]
  }));

  return DifferentialCastSchema.parse({
    schema_version: "1.0.0",
    primary_suspects: primary,
    rotation_plan: {
      act1_focus_dx_ids: primary.slice(0, 2).map((s) => s.dx_id),
      act2_expansion_dx_ids: primary.slice(2).map((s) => s.dx_id),
      act3_collapse_dx_ids: primary.slice(1).map((s) => s.dx_id),
      act4_final_dx_id: finalDxId
    },
    elimination_milestones: [
      {
        milestone_id: "MS-01",
        slide_id: slideId(deck, Math.floor(deck.slides.length * 0.5)),
        eliminated_dx_ids: [primary[2]!.dx_id],
        evidence_clue_ids: ["CLUE_MICRO_MISMATCH", "CLUE_RESPONSE_BREAK"],
        reasoning_summary: "Midpoint evidence weakens a key mimic.",
        citations: [cite]
      }
    ],
    citations_used: [cite]
  });
}

export function generateClueGraph(deck: DeckSpec, dossier: DiseaseDossier, differentialCast: DifferentialCast): ClueGraph {
  const cite = firstCitation(dossier);
  const s1 = slideId(deck, 0);
  const s2 = slideId(deck, 2);
  const s3 = slideId(deck, Math.floor(deck.slides.length * 0.6));
  const s4 = slideId(deck, deck.slides.length - 1);
  return ClueGraphSchema.parse({
    schema_version: "1.0.0",
    exhibits: [
      {
        exhibit_id: "EX-01",
        type: "labs_trend",
        title: "Primary evidence trend",
        purpose: "Show evolving physiological trajectory.",
        produced_on_slide_id: s1,
        data_fields: ["vitals", "key lab marker"],
        how_it_is_visualized: "Trend rail with anomaly markers.",
        citations: [cite]
      }
    ],
    clues: [
      {
        clue_id: "CLUE_MACRO_ENTRY",
        macro_or_micro: "macro",
        observed: "Initial contradictory finding appears.",
        where_found: "ER intake",
        acquisition_method: "lab",
        wrong_inference: `Supports ${differentialCast.primary_suspects[1]?.name ?? "a mimic"} exclusively.`,
        correct_inference: "Suggests a narrower mechanism when combined with timing.",
        implicates_dx_ids: [differentialCast.primary_suspects[0]!.dx_id],
        eliminates_dx_ids: [],
        first_seen_slide_id: s1,
        payoff_slide_id: s3,
        associated_exhibit_ids: ["EX-01"],
        dossier_citations: [cite]
      },
      {
        clue_id: "CLUE_MICRO_MISMATCH",
        macro_or_micro: "micro",
        observed: "Cell-scale process reveals causal mismatch.",
        where_found: "Micro terrain",
        acquisition_method: "micro_observation",
        wrong_inference: "Assumed to be incidental noise.",
        correct_inference: "Is a receipt for the true diagnosis.",
        implicates_dx_ids: [differentialCast.rotation_plan.act4_final_dx_id],
        eliminates_dx_ids: [differentialCast.primary_suspects[2]?.dx_id].filter(Boolean),
        first_seen_slide_id: s2,
        payoff_slide_id: s4,
        associated_exhibit_ids: ["EX-01"],
        dossier_citations: [cite]
      },
      {
        clue_id: "CLUE_RESPONSE_BREAK",
        macro_or_micro: "macro",
        observed: "Intervention response contradicts the cover theory.",
        where_found: "Bedside reassessment",
        acquisition_method: "intervention_response",
        wrong_inference: "Interpreted as delayed expected response.",
        correct_inference: "Demands final diagnostic pivot.",
        implicates_dx_ids: [differentialCast.rotation_plan.act4_final_dx_id],
        eliminates_dx_ids: [differentialCast.primary_suspects[1]?.dx_id].filter(Boolean),
        first_seen_slide_id: s3,
        payoff_slide_id: s4,
        associated_exhibit_ids: ["EX-01"],
        dossier_citations: [cite]
      }
    ],
    red_herrings: [
      {
        rh_id: "RH1",
        suggests_dx_id: differentialCast.primary_suspects[1]?.dx_id ?? "DX-02",
        why_believable: "It matches a common test pattern seen early.",
        rooted_truth: "Observed marker is real but incomplete.",
        payoff_slide_id: s3,
        dossier_citations: [cite]
      }
    ],
    twist_support_matrix: [
      {
        twist_id: "TW1",
        supporting_clue_ids: ["CLUE_MACRO_ENTRY", "CLUE_MICRO_MISMATCH", "CLUE_RESPONSE_BREAK"],
        recontextualized_slide_ids: [s1, s2, s3],
        act1_setup_clue_ids: ["CLUE_MACRO_ENTRY"]
      }
    ],
    constraints: {
      one_major_med_concept_per_story_slide: true,
      min_clues_per_twist: 3,
      require_act1_setup: true
    },
    citations_used: [cite]
  });
}

export function generateReaderSimReport(deck: DeckSpec, truthModel: TruthModel, clueGraph: ClueGraph): ReaderSimReport {
  const finalDx = truthModel.final_diagnosis.dx_id;
  const earlyDx = truthModel.cover_story.initial_working_dx_ids[0] ?? `${finalDx}_ALT`;
  const notes = deck.slides.length > 40
    ? []
    : [
        {
          slide_id: slideId(deck, 1),
          issue_type: "pacing_rushed",
          note: "Early clue chain resolves too quickly.",
          severity: "should"
        }
      ];

  return ReaderSimReportSchema.parse({
    schema_version: "1.0.0",
    solve_attempts: [
      {
        checkpoint: "ACT1_END",
        top_dx_guesses: [earlyDx],
        confidence_0_to_1: 0.62,
        key_clues_used: [clueGraph.clues[0]!.clue_id],
        what_was_confusing: ["Competing suspect looked equally plausible."],
        was_twist_predictable: "fairly_guessable"
      },
      {
        checkpoint: "MIDPOINT",
        top_dx_guesses: [finalDx, earlyDx],
        confidence_0_to_1: 0.68,
        key_clues_used: [clueGraph.clues[0]!.clue_id, clueGraph.clues[1]!.clue_id],
        what_was_confusing: [],
        was_twist_predictable: "surprising_but_fair"
      },
      {
        checkpoint: "ACT3_START",
        top_dx_guesses: [finalDx],
        confidence_0_to_1: 0.78,
        key_clues_used: [clueGraph.clues[1]!.clue_id, clueGraph.clues[2]!.clue_id],
        what_was_confusing: [],
        was_twist_predictable: "surprising_but_fair"
      },
      {
        checkpoint: "ACT3_END",
        top_dx_guesses: [finalDx],
        confidence_0_to_1: 0.9,
        key_clues_used: clueGraph.clues.map((c) => c.clue_id),
        what_was_confusing: [],
        was_twist_predictable: "surprising_but_fair"
      }
    ],
    overall_story_dominance_score_0_to_5: 3.8,
    overall_twist_quality_score_0_to_5: 3.7,
    overall_clarity_score_0_to_5: 3.6,
    biggest_strengths: ["Consistent clue payoffs", "Twist supported by receipts"],
    biggest_risks: notes.length > 0 ? ["Pacing pressure in shorter decks"] : [],
    slide_notes: notes,
    required_fixes: notes.length > 0
      ? [
          {
            fix_id: "RS-FIX-01",
            type: "increase_story_turn",
            priority: "should",
            description: "Strengthen act transitions to maintain fair-play pacing.",
            targets: [slideId(deck, 1), slideId(deck, 2)]
          }
        ]
      : []
  });
}
