import { slug } from "../utils.js";
import type { DeckSpec, DeckSlideSpec } from "./schemas.js";
import { V2_AUDIENCE_LEVELS } from "./schemas.js";

type DeckLengthMain = 30 | 45 | 60;
type AudienceLevel = "MED_SCHOOL_ADVANCED" | "RESIDENT" | "FELLOWSHIP";
type DeckMainActId = DeckSpec["acts"][number]["act_id"];

export type GenerateV2DeckSpecInput = {
  topic: string;
  deckLengthMain: DeckLengthMain;
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

function topicToken(topic: string): string {
  return slug(topic || "case")
    .replace(/-/g, "_")
    .slice(0, 24);
}

function beatStoryTemplate(beat: DeckSlideSpec["beat_type"], topic: string): DeckSlideSpec["story_panel"] {
  const focus = topic || "the case";
  if (beat === "cold_open") {
    return {
      goal: `Spot the first anomaly in ${focus}.`,
      opposition: "Background noise makes the pattern easy to dismiss.",
      turn: "A visual clue confirms this is an active case.",
      decision: "Open a formal investigation immediately.",
      consequence: "The team commits before the signal fades."
    };
  }
  if (beat === "red_herring") {
    return {
      goal: "Test the leading suspect against fresh evidence.",
      opposition: "A convincing mimic matches part of the pattern.",
      turn: "One discriminator breaks the false match.",
      decision: "Keep the suspect but lower its probability.",
      consequence: "The clock advances while certainty drops."
    };
  }
  if (beat === "twist") {
    return {
      goal: "Reconcile conflicting clues into one mechanism.",
      opposition: "Earlier assumptions resist revision.",
      turn: "A previously minor clue reframes the whole case.",
      decision: "Pivot to the corrected causal pathway.",
      consequence: "All downstream actions must be re-prioritized."
    };
  }
  if (beat === "showdown" || beat === "proof") {
    return {
      goal: "Prove the final diagnosis with decisive evidence.",
      opposition: "Residual uncertainty threatens commitment.",
      turn: "Converging findings eliminate remaining alternatives.",
      decision: "Lock diagnosis and execute targeted plan.",
      consequence: "Outcome trajectory improves with timely action."
    };
  }
  return {
    goal: `Advance ${focus} using the newest clue.`,
    opposition: "Competing explanations still fit part of the data.",
    turn: "Current evidence shifts differential weighting.",
    decision: "Run the next highest-yield diagnostic action.",
    consequence: "Case pressure escalates as options narrow."
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
  const majorConcept = `mc_${topicToken(topic).toLowerCase()}_${String(slideNumber).padStart(2, "0")}`;
  const hook = slideNumber === total ? "Case closed. What did we miss?" : `What does ${id} imply for the next move?`;
  const storyPanel = beatStoryTemplate(beatType, topic);
  const beatLabel = beatType.replace(/_/g, " ");
  const citation = {
    citation_id: "CIT-KB-001",
    chunk_id: "kb_context.md",
    locator: `slide_${id.toLowerCase()}`,
    claim: `Fallback grounding for ${topic} on ${id}.`
  };

  return {
    slide_id: id,
    act_id: actId,
    beat_type: beatType,
    template_id: templateId,
    title: `${beatLabel} — ${topic}`,
    on_slide_text: {
      headline: `${id}: ${beatLabel}`,
      subtitle: `Case focus: ${topic}`,
      callouts: ["Observe", "Discriminate", "Commit"],
      labels: [`Act ${actId.replace("ACT", "")}`, id]
    },
    visual_description: `Cinematic micro-scene for ${topic} at ${id}; evidence overlays visible and legible.`,
    exhibit_ids: [`EX-${String(slideNumber).padStart(2, "0")}`],
    story_panel: storyPanel,
    medical_payload: {
      major_concept_id: majorConcept,
      supporting_details: isNoNewConcept ? ["Consolidate prior clue", "Bridge to next decision"] : ["Key finding linked to mechanism", "One practical implication"],
      delivery_mode: deliveryMode,
      linked_learning_objectives: isNoNewConcept ? [] : [`LO-${String(Math.max(1, Math.ceil(slideNumber / 3))).padStart(2, "0")}`],
      dossier_citations: [citation]
    },
    pressure_channels_advanced: ["physical", "institutional"],
    hook,
    appendix_links: [`A-${String(Math.max(1, Math.ceil(slideNumber / 10))).padStart(2, "0")}`],
    speaker_notes: {
      narrative_notes: "Keep momentum on the evolving case while preserving fair-play clues.",
      medical_reasoning: `Clinical reasoning checkpoint for ${topic}: discriminate alternatives using current evidence only.`,
      what_this_slide_teaches: ["How this clue updates pre-test probability"],
      differential_update: {
        top_dx_ids: ["DX_PRIMARY", "DX_ALTERNATE"],
        eliminated_dx_ids: slideNumber % 4 === 0 ? ["DX_MIMIC"] : [],
        why: "Observed pattern aligns with the primary diagnosis better than competing options."
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
    title: `${topic} Appendix ${idx + 1}`,
    on_slide_text: { headline: `${topic} appendix evidence` },
    visual_description: "Dense reference visual for deeper review.",
    exhibit_ids: [`EX-A-${String(idx + 1).padStart(2, "0")}`],
    story_panel: {
      goal: "Document supporting evidence.",
      opposition: "Complex details can obscure the key principle.",
      turn: "The appendix consolidates the pattern.",
      decision: "Reference this slide for deep-dive Q&A."
    },
    medical_payload: {
      major_concept_id: `mc_${topicToken(topic).toLowerCase()}_appendix_${String(idx + 1).padStart(2, "0")}`,
      delivery_mode: "note_only",
      dossier_citations: [
        {
          citation_id: "CIT-KB-001",
          chunk_id: "kb_context.md",
          locator: `appendix_${id.toLowerCase()}`,
          claim: "Appendix fallback reference grounding."
        }
      ]
    },
    hook: "Return to the main narrative.",
    appendix_links: [],
    speaker_notes: {
      medical_reasoning: "Expanded reference material and nuance for advanced learners.",
      differential_update: {
        top_dx_ids: [`DX_${topicToken(topic)}`],
        eliminated_dx_ids: [],
        why: "Appendix supports final differential confidence."
      },
      citations: [
        {
          citation_id: "CIT-KB-001",
          chunk_id: "kb_context.md",
          locator: `appendix_${id.toLowerCase()}`,
          claim: "Appendix backing source."
        }
      ]
    }
  };
}

function normalizeAudience(audienceLevel: AudienceLevel): AudienceLevel {
  if ((V2_AUDIENCE_LEVELS as readonly string[]).includes(audienceLevel)) return audienceLevel;
  return "MED_SCHOOL_ADVANCED";
}

export function generateV2DeckSpec(input: GenerateV2DeckSpecInput): DeckSpec {
  const deckLengthMain = input.deckLengthMain;
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
      episode_title: `${input.topic} — Micro-Detectives Case File`,
      deck_length_main: String(deckLengthMain) as "30" | "45" | "60",
      tone: "thriller",
      audience_level: audienceLevel,
      story_dominance_target_ratio: 0.7,
      max_words_on_slide: 24,
      one_major_med_concept_per_slide: true,
      appendix_unlimited: true
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
