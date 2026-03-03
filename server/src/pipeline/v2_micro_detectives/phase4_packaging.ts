import type {
  ClueGraph,
  DeckSpec,
  DifferentialCast,
  MicroWorldMap,
  SetpiecePlan,
  TruthModel,
  V2TemplateRegistry
} from "./schemas.js";
import { V2TemplateRegistrySchema } from "./schemas.js";

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
