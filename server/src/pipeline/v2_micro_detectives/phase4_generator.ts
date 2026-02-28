import { slug } from "../utils.js";
import type {
  ClueGraph,
  DeckSpec,
  DifferentialCast,
  DiseaseDossier,
  DramaPlan,
  MicroWorldMap,
  SetpiecePlan,
  TruthModel,
  V2TemplateRegistry
} from "./schemas.js";
import { DramaPlanSchema, MicroWorldMapSchema, SetpiecePlanSchema, V2TemplateRegistrySchema } from "./schemas.js";

type Citation = {
  citation_id: string;
  claim: string;
  chunk_id?: string;
  locator?: string;
};

function firstCitation(dossier: DiseaseDossier): Citation {
  const first = dossier.citations[0];
  if (first) return first;
  return {
    citation_id: "CIT-KB-001",
    claim: `Fallback grounding for ${dossier.canonical_name || "episode"}`,
    locator: "kb_context.md"
  };
}

function uniqueActIds(deck: DeckSpec): Array<"ACT1" | "ACT2" | "ACT3" | "ACT4"> {
  const acts = new Set<"ACT1" | "ACT2" | "ACT3" | "ACT4">();
  for (const slide of deck.slides) {
    if (slide.act_id !== "APPENDIX") acts.add(slide.act_id);
  }
  return [...acts.values()];
}

function safeChunk(input: string | undefined, fallback = ""): string {
  const text = (input || "").trim();
  return text.length > 0 ? text : fallback;
}

export function generateMicroWorldMap(deck: DeckSpec, dossier: DiseaseDossier, truth: TruthModel): MicroWorldMap {
  const cite = firstCitation(dossier);
  const episodeSlug = deck.deck_meta.episode_slug || slug(dossier.canonical_name || "episode");
  const baseZone = slug(dossier.canonical_name || "core").toUpperCase().slice(0, 12) || "CORE";

  return MicroWorldMapSchema.parse({
    schema_version: "1.0.0",
    episode_slug: episodeSlug,
    primary_organs: [safeChunk(dossier.disease_request.setting_focus, "multi_system")],
    zones: [
      {
        zone_id: `Z-${baseZone}-ENTRY`,
        name: "Case Entry Corridor",
        anatomic_location: `${dossier.disease_request.setting_focus} intake zone`,
        scale_notes: "Cell-scale transit with readable evidence overlays.",
        physical_properties: ["high flow variability", "restricted maneuvering space"],
        resident_actors: ["endothelial cells", "resident immune sentinels"],
        environmental_gradients: ["oxygen gradient", "inflammatory mediator gradient"],
        narrative_motifs: ["forensic glow trails", "evidence stamps"],
        citations: [cite]
      },
      {
        zone_id: `Z-${baseZone}-CORE`,
        name: "Primary Conflict Basin",
        anatomic_location: safeChunk(truth.final_diagnosis.name, dossier.canonical_name),
        scale_notes: "Compression and hazard-heavy tissue geometry.",
        physical_properties: ["pressure pockets", "edema-prone matrix"],
        resident_actors: ["target tissue cells", "activated immune actors"],
        environmental_gradients: ["pH shift", "cytokine spike"],
        narrative_motifs: ["hazard sirens", "diagnostic holograms"],
        citations: [cite]
      }
    ],
    hazards: [
      {
        hazard_id: "HZ-01",
        type: "immune_attack",
        description: "Immune over-response disrupts evidence collection and transit.",
        how_it_appears_visually: "Swarming sentinel silhouettes and expanding threat halos.",
        how_characters_survive: "Route discipline and timed cover through low-pressure windows.",
        links_to_pathophysiology: safeChunk(truth.final_diagnosis.one_sentence_mechanism, "Immune dysregulation drives micro hazard intensity."),
        citations: [cite]
      },
      {
        hazard_id: "HZ-02",
        type: "edema_pressure",
        description: "Rising tissue pressure narrows movement corridors and obscures clues.",
        how_it_appears_visually: "Progressive corridor collapse and distortion waves.",
        how_characters_survive: "Exploit mapped relief pockets before closure.",
        links_to_pathophysiology: "Inflammatory mechanisms alter compliance and obstruct flow.",
        citations: [cite]
      }
    ],
    routes: [
      {
        route_id: "RT-01",
        from_zone_id: `Z-${baseZone}-ENTRY`,
        to_zone_id: `Z-${baseZone}-CORE`,
        mode: "bloodstream",
        constraints: ["time-limited pass window", "immune checkpoint density"],
        story_use: "Act I dive and initial clue acquisition.",
        citations: [cite]
      }
    ],
    immune_law_enforcement_metaphors: [
      {
        actor: "Neutrophil patrol",
        metaphor: "Rapid-response riot unit",
        accuracy_notes: "Depict pursuit pressure without implying intent beyond innate response.",
        citations: [cite]
      }
    ],
    visual_style_guide: {
      palette_notes: "High-contrast forensic noir with readable evidence overlays.",
      recurring_ui_elements: ["Case timer", "Evidence stamp", "Differential board chips"],
      labeling_rules: ["Use short labels at first mention", "Favor arrows over dense paragraphs"],
      citations: [cite]
    }
  });
}

export function generateDramaPlan(deck: DeckSpec, _truth: TruthModel): DramaPlan {
  const acts = uniqueActIds(deck);
  const detective = deck.characters.detective.name;
  const deputy = deck.characters.deputy.name;
  const patient = deck.characters.patient.label;

  return DramaPlanSchema.parse({
    schema_version: "1.0.0",
    series_bible_constraints: ["Case must be solved under shrinking time constraints", "Clues must be fair-play and evidence-linked"],
    character_arcs: [
      {
        character_id: "detective",
        name: detective,
        core_need: "Convert fragmented clues into a defensible diagnosis under pressure.",
        core_fear: "Anchoring too early and causing avoidable harm.",
        wound_or_backstory: "Prior case where elegant but wrong inference delayed treatment.",
        moral_line: "Will not lock diagnosis without converging receipts.",
        act_turns: acts.map((actId) => ({
          act_id: actId,
          pressure: `${actId} evidence ambiguity escalates.`,
          choice: `${detective} must choose between speed and certainty.`,
          change: `${detective} increases transparency and evidence discipline.`
        }))
      },
      {
        character_id: "deputy",
        name: deputy,
        core_need: "Balance rapid clue collection with reasoning rigor.",
        core_fear: "Missing a hidden discriminator while chasing momentum.",
        wound_or_backstory: "Past near-miss caused by overvaluing flashy clues.",
        moral_line: "Will not suppress contradictory evidence for narrative neatness.",
        act_turns: acts.map((actId) => ({
          act_id: actId,
          pressure: `${actId} route hazards reduce observation windows.`,
          choice: `${deputy} must decide which clue thread to pursue.`,
          change: `${deputy} improves signal prioritization and handoff clarity.`
        }))
      },
      {
        character_id: "patient",
        name: patient,
        core_need: "Timely, accurate diagnosis and intervention.",
        core_fear: "Progressive deterioration before mechanism is recognized.",
        moral_line: "Clinical truth must overrule convenience.",
        act_turns: acts.map((actId) => ({
          act_id: actId,
          pressure: `${actId} physiologic instability shifts clinical stakes.`,
          choice: "Team must decide whether current evidence is sufficient to act.",
          change: "Diagnostic certainty improves as clues converge."
        }))
      }
    ],
    relationship_arcs: [
      {
        pair: "detective_deputy",
        starting_dynamic: "Fast-paced partnership with occasional inference friction.",
        friction_points: ["Competing hypotheses at midpoint", "Risk tolerance mismatch in Act III"],
        repair_moments: ["Shared evidence board reset", "Joint proof trap setup"],
        climax_resolution: "Unified differential logic before final diagnosis lock."
      },
      {
        pair: "aliens_patient",
        starting_dynamic: "Indirect trust mediated through clinical evidence.",
        friction_points: ["Patient trajectory worsens before diagnosis is locked"],
        repair_moments: ["Mechanism explained in plain language at resolution"],
        climax_resolution: "Team actions align to patient-centered, evidence-based plan."
      }
    ],
    pressure_ladder: {
      physical: ["Initial hazard exposure", "Constrained micro transit", "Peak instability before proof"],
      institutional: ["Time pressure from care setting", "Need to justify decisive intervention", "Post-resolution debrief constraints"],
      relational: ["Team disagreement on early mimic", "Trust stress under uncertainty", "Convergence through shared evidence"],
      moral: ["Act before certainty?", "Risk overtreatment vs undertreatment", "Responsibility for delayed recognition"]
    },
    chapter_or_act_setups: acts.map((actId) => ({
      act_id: actId,
      required_emotional_beats: ["Tension rise", "Evidence-based pivot"],
      required_choices: ["Choose next test/action", "Update differential explicitly"],
      notes: `${actId} must preserve story-forward pacing.`
    }))
  });
}

export function generateSetpiecePlan(deck: DeckSpec, microWorldMap: MicroWorldMap, dossier: DiseaseDossier): SetpiecePlan {
  const cite = firstCitation(dossier);
  const coreZone = microWorldMap.zones[1]?.zone_id ?? microWorldMap.zones[0]?.zone_id ?? "Z-CORE";

  return SetpiecePlanSchema.parse({
    schema_version: "1.0.0",
    setpieces: [
      {
        setpiece_id: "SP-01",
        act_id: "ACT1",
        type: "transit_peril",
        location_zone_id: microWorldMap.zones[0]?.zone_id ?? coreZone,
        story_purpose: "Introduce hazards while establishing investigative objective.",
        medical_mechanism_anchor: "Early physiologic changes create unstable transit context.",
        visual_signature: "Rapid dive with evidence overlays appearing during movement.",
        constraints: ["short safe-window", "checkpoint congestion"],
        outcome_turn: "First high-value clue acquired with collateral ambiguity.",
        citations: [cite]
      },
      {
        setpiece_id: "SP-02",
        act_id: "ACT2",
        type: "environmental_hazard",
        location_zone_id: coreZone,
        story_purpose: "Escalate stakes and force differential pruning.",
        medical_mechanism_anchor: "Pathophysiology amplifies local hazard density.",
        visual_signature: "Compression wave through tissue with reactive immune swarms.",
        constraints: ["limited visibility", "false-positive clue trail"],
        outcome_turn: "Mimic narrative weakens after hazard-linked discriminator appears.",
        citations: [cite]
      },
      {
        setpiece_id: "SP-03",
        act_id: "ACT3",
        type: "proof_trap",
        location_zone_id: coreZone,
        story_purpose: "Recontextualize clues and support twist receipts.",
        medical_mechanism_anchor: "Mechanistic trigger explains earlier contradictions.",
        visual_signature: "Evidence board convergence with route and clue overlays.",
        constraints: ["single-attempt confirmation window"],
        outcome_turn: "True diagnosis locks with fair-play receipts.",
        citations: [cite]
      },
      {
        setpiece_id: "SP-04",
        act_id: "ACT4",
        type: "moral_confrontation",
        location_zone_id: coreZone,
        story_purpose: "Link diagnosis confirmation to action and aftermath.",
        medical_mechanism_anchor: "Treatment response validates causal model.",
        visual_signature: "Resolution tableau with before/after evidence overlays.",
        constraints: ["must communicate rationale clearly", "avoid overclaiming certainty"],
        outcome_turn: "Case resolves with explicit teach-back and differential closure.",
        citations: [cite]
      }
    ],
    quotas: {
      act1_social_or_ethics_confrontation: true,
      act2_micro_action_setpiece: true,
      act3_truth_bomb: true,
      act4_proof_or_showdown: true
    },
    notes: ["Keep setpieces story-dominant while preserving one major concept per main slide."]
  });
}

export function buildTemplateRegistry(deck: DeckSpec): V2TemplateRegistry {
  const templateMap = new Map<string, { name: string; purpose: string; beats: Set<string> }>();
  for (const slide of [...deck.slides, ...deck.appendix_slides]) {
    const existing = templateMap.get(slide.template_id) ?? {
      name: slide.template_id,
      purpose: "Render slide with story-forward evidence clarity.",
      beats: new Set<string>()
    };
    existing.beats.add(slide.beat_type);
    templateMap.set(slide.template_id, existing);
  }

  return V2TemplateRegistrySchema.parse({
    schema_version: "1.0.0",
    templates: [...templateMap.entries()].map(([templateId, meta]) => ({
      template_id: templateId,
      name: meta.name,
      purpose: meta.purpose,
      renderer_instructions: [
        "Keep character continuity and camera grammar stable.",
        "Preserve readable evidence overlays with explicit labels.",
        "Avoid medical-only composition in main deck slides."
      ],
      allowed_beat_types: [...meta.beats.values()]
    })),
    defaults: {
      cinematic_style: "micro-noir procedural",
      typography: "high-contrast evidence captions",
      evidence_overlay: "dual-layer overlay with clue + medical rationale"
    }
  });
}

export function buildMainDeckRenderPlanMd(input: {
  deck: DeckSpec;
  truthModel: TruthModel;
  clueGraph: ClueGraph;
  differentialCast: DifferentialCast;
  microWorldMap: MicroWorldMap;
  setpiecePlan: SetpiecePlan;
}): string {
  const { deck, truthModel, clueGraph, differentialCast, microWorldMap, setpiecePlan } = input;
  const lines: string[] = [];
  lines.push("# Main Deck Render Plan");
  lines.push("");
  lines.push(`- Episode: ${deck.deck_meta.episode_title}`);
  lines.push(`- Final diagnosis anchor: ${truthModel.final_diagnosis.name} (${truthModel.final_diagnosis.dx_id})`);
  lines.push(`- Main slide count: ${deck.slides.length}`);
  lines.push(`- Story dominance target: ${Math.round(deck.deck_meta.story_dominance_target_ratio * 100)}%`);
  lines.push("");
  lines.push("## Recurring Constraints");
  lines.push("- Preserve one major medical concept per main slide.");
  lines.push("- Keep clues/payoffs consistent with clue graph.");
  lines.push("- Use template registry instructions for each template_id.");
  lines.push("");
  lines.push("## Zone + Setpiece Mapping");
  for (const zone of microWorldMap.zones) {
    lines.push(`- ${zone.zone_id}: ${zone.name} (${zone.anatomic_location})`);
  }
  for (const sp of setpiecePlan.setpieces) {
    lines.push(`- ${sp.setpiece_id} (${sp.act_id}): ${sp.story_purpose}`);
  }
  lines.push("");
  lines.push("## Slide Blocks");

  for (const slide of deck.slides) {
    const clueHits = clueGraph.clues.filter((clue) => clue.first_seen_slide_id === slide.slide_id || clue.payoff_slide_id === slide.slide_id);
    const differentialTop = slide.speaker_notes.differential_update.top_dx_ids.slice(0, 3).join(", ") || "(none)";
    lines.push(`### ${slide.slide_id} — ${slide.title || slide.on_slide_text.headline}`);
    lines.push(`- Act/Beat: ${slide.act_id} / ${slide.beat_type}`);
    lines.push(`- Template: ${slide.template_id}`);
    lines.push(`- Story turn: goal=${slide.story_panel.goal}; opposition=${slide.story_panel.opposition}; turn=${slide.story_panel.turn}; decision=${slide.story_panel.decision}`);
    lines.push(`- Medical concept: ${slide.medical_payload.major_concept_id} (${slide.medical_payload.delivery_mode})`);
    lines.push(`- Differential update: top=${differentialTop}`);
    lines.push(`- Clues: ${clueHits.map((clue) => clue.clue_id).join(", ") || "(none)"}`);
    lines.push(`- Visual: ${slide.visual_description}`);
    lines.push(`- Speaker notes: ${slide.speaker_notes.medical_reasoning}`);
    lines.push("");
  }

  lines.push("## Differential Cast Snapshot");
  for (const suspect of differentialCast.primary_suspects.slice(0, 6)) {
    lines.push(`- ${suspect.dx_id}: ${suspect.name} — ${suspect.why_tempting}`);
  }

  return `${lines.join("\n")}\n`;
}

export function buildAppendixRenderPlanMd(deck: DeckSpec): string {
  const lines: string[] = [];
  lines.push("# Appendix Render Plan");
  lines.push("");
  lines.push(`- Appendix slide count: ${deck.appendix_slides.length}`);
  lines.push("- Appendix slides are exempt from main deck concept-density constraints.");
  lines.push("");
  for (const slide of deck.appendix_slides) {
    lines.push(`## ${slide.slide_id} — ${slide.title || slide.on_slide_text.headline}`);
    lines.push(`- Template: ${slide.template_id}`);
    lines.push(`- Focus: ${slide.medical_payload.major_concept_id}`);
    lines.push(`- Visual: ${slide.visual_description}`);
    lines.push(`- Notes: ${slide.speaker_notes.medical_reasoning}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

export function buildSpeakerNotesWithCitationsMd(deck: DeckSpec): string {
  const lines: string[] = [];
  lines.push("# Speaker Notes With Citations");
  lines.push("");
  for (const slide of [...deck.slides, ...deck.appendix_slides]) {
    lines.push(`## ${slide.slide_id} — ${slide.title || slide.on_slide_text.headline}`);
    lines.push(`- Narrative notes: ${slide.speaker_notes.narrative_notes || "(none)"}`);
    lines.push(`- Medical reasoning: ${slide.speaker_notes.medical_reasoning}`);
    lines.push("- Citations:");
    for (const cite of slide.speaker_notes.citations) {
      lines.push(`  - ${cite.citation_id}: ${cite.claim}${cite.locator ? ` (${cite.locator})` : ""}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}
