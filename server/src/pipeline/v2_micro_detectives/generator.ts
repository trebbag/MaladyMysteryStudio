import { slug } from "../utils.js";
import type { DeckSpec, DeckSlideSpec } from "./schemas.js";
import { V2_AUDIENCE_LEVELS } from "./schemas.js";

type DeckLengthMain = 30 | 45 | 60;
type AudienceLevel = "PHYSICIAN_LEVEL" | "COLLEGE_LEVEL";
type DeckMainActId = DeckSpec["acts"][number]["act_id"];

export type GenerateV2DeckSpecInput = {
  topic: string;
  deckLengthMain?: DeckLengthMain;
  deckLengthConstraintEnabled?: boolean;
  audienceLevel: AudienceLevel;
};

function toSlideId(idx: number): string {
  return `S${String(idx).padStart(2, "0")}`;
}

function beatTypeForIndex(idx: number): DeckSlideSpec["beat_type"] {
  const map: DeckSlideSpec["beat_type"][] = [
    "cold_open",
    "case_intake",
    "first_dive",
    "clue_discovery",
    "suspect_intro",
    "red_herring",
    "setback",
    "reversal",
    "action_setpiece",
    "theory_update",
    "false_theory_lock_in",
    "false_theory_collapse",
    "twist",
    "proof",
    "showdown",
    "aftermath"
  ];
  return map[idx % map.length] ?? "clue_discovery";
}

function templateForBeat(beat: DeckSlideSpec["beat_type"]): DeckSlideSpec["template_id"] {
  switch (beat) {
    case "cold_open":
      return "T01_COLD_OPEN_MICRO_CRIME_SCENE";
    case "case_intake":
      return "T02_CASE_INTAKE_MACRO";
    case "first_dive":
      return "T03_SHRINK_DIVE_SEQUENCE";
    case "red_herring":
    case "reversal":
      return "T07_RED_HERRING_REVERSAL";
    case "action_setpiece":
      return "T08_ACTION_SET_PIECE_MICRO_HAZARD";
    case "twist":
      return "T09_TWIST_RECONTEXTUALIZATION";
    case "proof":
      return "T10_PROOF_TRAP";
    case "aftermath":
      return "T11_AFTERCARE_AFTERMATH";
    case "theory_update":
    case "false_theory_lock_in":
    case "false_theory_collapse":
      return "T06_DIFFERENTIAL_BOARD_UPDATE";
    default:
      return "T04_CLUE_DISCOVERY";
  }
}

function actRanges(total: number): Array<{ id: DeckMainActId; start: number; end: number; name: string; goal: string }> {
  const q1 = Math.max(1, Math.round(total * 0.25));
  const q2 = Math.max(q1 + 1, Math.round(total * 0.5));
  const q3 = Math.max(q2 + 1, Math.round(total * 0.75));
  return [
    { id: "ACT1", start: 1, end: q1, name: "Setup + First Clues", goal: "Establish case, suspects, and early clue chain." },
    { id: "ACT2", start: q1 + 1, end: q2, name: "Complications", goal: "Escalate pressure and test wrong theories." },
    { id: "ACT3", start: q2 + 1, end: q3, name: "Reversal + Twist", goal: "Flip assumptions and expose true mechanism." },
    { id: "ACT4", start: q3 + 1, end: total, name: "Proof + Resolution", goal: "Confirm diagnosis and close the mystery." }
  ];
}

function actIdForSlide(slideNumber: number, ranges: Array<{ id: DeckMainActId; start: number; end: number }>): DeckMainActId {
  for (const range of ranges) {
    if (slideNumber >= range.start && slideNumber <= range.end) return range.id;
  }
  return "ACT4";
}

function storyDeliveryModeByPosition(index: number, storyForwardCutoff: number): DeckSlideSpec["medical_payload"]["delivery_mode"] {
  if (index <= storyForwardCutoff) {
    const modes: DeckSlideSpec["medical_payload"]["delivery_mode"][] = ["clue", "dialogue", "action"];
    return modes[index % modes.length] ?? "clue";
  }
  return index % 2 === 0 ? "exhibit" : "note_only";
}

function beatStoryTemplate(beat: DeckSlideSpec["beat_type"], topic: string): DeckSlideSpec["story_panel"] {
  const beatLabel = beat.replace(/_/g, " ");
  return {
    goal: `[SCAFFOLD] Define a concrete ${beatLabel} goal for "${topic}".`,
    opposition: `[SCAFFOLD] Add credible opposition for ${beatLabel}.`,
    turn: `[SCAFFOLD] Specify the exact turning event for ${beatLabel}.`,
    decision: `[SCAFFOLD] Choose the next action after this turn.`,
    consequence: `[SCAFFOLD] State immediate consequence for this decision.`
  };
}

function buildMainSlide(
  topic: string,
  slideNumber: number,
  total: number,
  actId: DeckSlideSpec["act_id"],
  deliveryMode: DeckSlideSpec["medical_payload"]["delivery_mode"]
): DeckSlideSpec {
  const id = toSlideId(slideNumber);
  const beatType = beatTypeForIndex(slideNumber - 1);
  const templateId = templateForBeat(beatType);
  const isNoNewConcept = deliveryMode === "note_only" || deliveryMode === "none";
  const majorConcept = `MC-PATCH-${id}`;
  const hook = `[SCAFFOLD] Replace with authored hook for ${id}.`;
  const storyPanel = beatStoryTemplate(beatType, topic);
  const beatLabel = beatType.replace(/_/g, " ").toUpperCase();
  const citation = {
    citation_id: "CIT-KB-001",
    chunk_id: "kb_context.md",
    locator: `scaffold_${id.toLowerCase()}`,
    claim: `[SCAFFOLD] Placeholder grounding for ${topic} at ${id}.`
  };

  return {
    slide_id: id,
    act_id: actId,
    beat_type: beatType,
    template_id: templateId,
    title: `[SCAFFOLD] ${id} ${beatLabel}`,
    on_slide_text: {
      headline: `[SCAFFOLD] ${id} placeholder`,
      subtitle: "Replace headline/subtitle with authored narrative-medical text.",
      callouts: ["[SCAFFOLD] callout 1", "[SCAFFOLD] callout 2"],
      labels: ["[SCAFFOLD]", id]
    },
    visual_description: `[SCAFFOLD] Define scene, framing, and medical visual payload for ${id}.`,
    exhibit_ids: [`EX-${String(slideNumber).padStart(2, "0")}`],
    story_panel: storyPanel,
    medical_payload: {
      major_concept_id: majorConcept,
      supporting_details: isNoNewConcept
        ? ["[SCAFFOLD] Consolidation-only bridge."]
        : ["[SCAFFOLD] One major concept only.", "[SCAFFOLD] Link concept to action."],
      delivery_mode: deliveryMode,
      linked_learning_objectives: isNoNewConcept ? [] : [`LO-SCAFFOLD-${String(Math.max(1, Math.ceil(slideNumber / 3))).padStart(2, "0")}`],
      dossier_citations: [citation]
    },
    pressure_channels_advanced: ["physical", "institutional"],
    hook,
    authoring_provenance: "deterministic_scaffold",
    appendix_links: [`A-${String(Math.max(1, Math.ceil(slideNumber / 10))).padStart(2, "0")}`],
    speaker_notes: {
      narrative_notes: "[SCAFFOLD] Replace with authored story action + continuity notes.",
      medical_reasoning: "[SCAFFOLD] Replace with grounded medical reasoning tied to citations.",
      what_this_slide_teaches: ["[SCAFFOLD] Teaching point placeholder."],
      differential_update: {
        top_dx_ids: ["DX_PRIMARY", "DX_ALTERNATE"],
        eliminated_dx_ids: slideNumber % 4 === 0 ? ["DX_MIMIC"] : [],
        why: "[SCAFFOLD] Replace with authored differential rationale."
      },
      citations: [citation]
    }
  };
}

function buildAppendixSlide(topic: string, idx: number): DeckSlideSpec {
  const id = `A-${String(idx + 1).padStart(2, "0")}`;
  return {
    slide_id: id,
    act_id: "APPENDIX",
    beat_type: "appendix",
    template_id: "T90_APPENDIX_DEEP_DIVE",
    title: `[SCAFFOLD] ${topic} Appendix ${idx + 1}`,
    on_slide_text: { headline: "[SCAFFOLD] Appendix placeholder content" },
    visual_description: "[SCAFFOLD] Replace with appendix-specific reference visual details.",
    exhibit_ids: [`EX-A-${String(idx + 1).padStart(2, "0")}`],
    story_panel: {
      goal: "[SCAFFOLD] Appendix goal placeholder.",
      opposition: "[SCAFFOLD] Appendix opposition placeholder.",
      turn: "[SCAFFOLD] Appendix turn placeholder.",
      decision: "[SCAFFOLD] Appendix decision placeholder."
    },
    medical_payload: {
      major_concept_id: `MC-PATCH-${id}`,
      delivery_mode: "note_only",
      dossier_citations: [
        {
          citation_id: "CIT-KB-001",
          chunk_id: "kb_context.md",
          locator: `scaffold_appendix_${id.toLowerCase()}`,
          claim: "[SCAFFOLD] Appendix placeholder reference."
        }
      ]
    },
    hook: "[SCAFFOLD] Appendix hook placeholder.",
    authoring_provenance: "deterministic_scaffold",
    appendix_links: [],
    speaker_notes: {
      medical_reasoning: "[SCAFFOLD] Replace with authored appendix reasoning.",
      differential_update: {
        top_dx_ids: ["DX_PRIMARY"],
        eliminated_dx_ids: [],
        why: "[SCAFFOLD] Appendix differential rationale placeholder."
      },
      citations: [
        {
          citation_id: "CIT-KB-001",
          chunk_id: "kb_context.md",
          locator: `scaffold_appendix_${id.toLowerCase()}`,
          claim: "[SCAFFOLD] Appendix placeholder source."
        }
      ]
    }
  };
}

function normalizeAudience(audienceLevel: AudienceLevel): AudienceLevel {
  if ((V2_AUDIENCE_LEVELS as readonly string[]).includes(audienceLevel)) return audienceLevel;
  return "PHYSICIAN_LEVEL";
}

function topicSeed(topic: string): number {
  const raw = topic.trim().toLowerCase();
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = (hash * 31 + raw.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function deriveMainDeckLength(input: GenerateV2DeckSpecInput): number {
  const topic = input.topic.trim();
  const seed = topicSeed(topic);
  if (input.deckLengthConstraintEnabled && typeof input.deckLengthMain === "number") {
    // Soft target only: allow drift so story/content flow can breathe.
    const driftBand = Math.max(4, Math.round(input.deckLengthMain * 0.2));
    const drift = (seed % (driftBand * 2 + 1)) - driftBand;
    const candidate = input.deckLengthMain + drift;
    return Math.max(20, candidate);
  }

  const wordCount = topic.length === 0 ? 0 : topic.split(/\s+/).filter(Boolean).length;
  const complexityBump = Math.min(48, wordCount * 3);
  const seedBump = seed % 36;
  // Unconstrained mode baseline.
  return Math.max(30, 54 + complexityBump + seedBump);
}

export function generateV2DeckScaffold(input: GenerateV2DeckSpecInput): DeckSpec {
  const deckLengthMain = deriveMainDeckLength(input);
  const audienceLevel = normalizeAudience(input.audienceLevel);
  const topicSlug = slug(input.topic || "episode");
  const ranges = actRanges(deckLengthMain);
  const storyForwardCutoff = Math.ceil(deckLengthMain * 0.75);

  const slides: DeckSpec["slides"] = [];
  for (let i = 1; i <= deckLengthMain; i++) {
    const actId = actIdForSlide(i, ranges);
    const deliveryMode = storyDeliveryModeByPosition(i, storyForwardCutoff);
    slides.push(buildMainSlide(input.topic, i, deckLengthMain, actId, deliveryMode));
  }

  const acts: DeckSpec["acts"] = ranges.map((r) => ({
    act_id: r.id,
    name: r.name,
    slide_start: r.start,
    slide_end: r.end,
    act_goal: r.goal,
    required_pressure_channels: ["physical", "institutional"]
  }));

  return {
    deck_meta: {
      schema_version: "1.0.0",
      episode_slug: topicSlug,
      episode_title: `[SCAFFOLD] ${input.topic} — Micro-Detectives Case File`,
      deck_length_main: String(deckLengthMain),
      tone: "thriller",
      audience_level: audienceLevel,
      story_dominance_target_ratio: 0.7,
      max_words_on_slide: 24,
      one_major_med_concept_per_slide: true,
      appendix_unlimited: true,
      authoring_provenance_counts: {
        agent_authored: 0,
        deterministic_scaffold: deckLengthMain,
        patched_scaffold: 0
      },
      authoring_scaffold_ratio: deckLengthMain > 0 ? 1 : 0
    },
    characters: {
      detective: {
        name: "Cyto",
        species_or_origin: "Intercellular Bureau",
        voice_style: "dry and incisive",
        competency: "Pattern-level hypothesis testing",
        blind_spot: "Overcommits when evidence appears elegant"
      },
      deputy: {
        name: "Pip",
        species_or_origin: "Intercellular Bureau",
        voice_style: "curious and kinetic",
        competency: "Rapid clue synthesis in changing terrain",
        blind_spot: "Can chase shiny clues too early"
      },
      patient: {
        label: "Index Patient",
        macro_context: "Urgent care-to-inpatient escalation"
      },
      macro_supporting_cast: [
        {
          role: "Attending",
          name_or_label: "Attending Lead",
          function: "Pressure-test key decisions"
        }
      ]
    },
    acts,
    slides,
    appendix_slides: [buildAppendixSlide(input.topic, 0)]
  };
}

// Backward-compatible export. In v2 quality mode this output is an emergency scaffold,
// not a final authoring target.
export function generateV2DeckSpec(input: GenerateV2DeckSpecInput): DeckSpec {
  return generateV2DeckScaffold(input);
}
