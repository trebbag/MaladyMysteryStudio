import { Agent, webSearchTool } from "@openai/agents";
import type { V2AssetBundle } from "./assets.js";
import {
  ActOutlineSchema,
  ClueGraphSchema,
  DeckSpecSchema,
  SlideBlockSchema,
  StoryBlueprintSchema,
  DifferentialCastSchema,
  DramaPlanSchema,
  DiseaseDossierSchema,
  EpisodePitchSchema,
  MedFactcheckReportSchema,
  MicroWorldMapSchema,
  ReaderSimReportSchema,
  SetpiecePlanSchema,
  TruthModelSchema
} from "./schemas.js";

const DEFAULT_MODEL = "gpt-5.2";
const baseModel = (process.env.MMS_MODEL && process.env.MMS_MODEL.trim().length > 0 ? process.env.MMS_MODEL.trim() : DEFAULT_MODEL);
const baseSettings = { temperature: 0.2 };
export const factcheckSettings = { ...baseSettings, temperature: 0.1, maxOutputTokens: 7000 };
export const structureSettings = { ...baseSettings, maxOutputTokens: 12000 };
export const storySettings = { ...baseSettings, temperature: 0.55, maxOutputTokens: 22000 };
export const deckBlockSettings = { ...baseSettings, temperature: 0.5, maxOutputTokens: 24000 };
export const storyBlueprintSettings = { ...storySettings, temperature: 0.58, maxOutputTokens: 24000 };
export const actOutlineSettings = { ...structureSettings, temperature: 0.35, maxOutputTokens: 16000 };
export const plotDirectorSettings = { ...deckBlockSettings, temperature: 0.48, maxOutputTokens: 26000 };

function instructionsFromAssets(assets: V2AssetBundle, promptFile: string): string {
  const globalPrompt = assets.promptFiles["00_global_system_prompt.md"] ?? "";
  const rolePrompt = assets.promptFiles[promptFile] ?? "";
  return [globalPrompt, rolePrompt].filter((part) => part.trim().length > 0).join("\n\n");
}

export function makeV2DiseaseResearchAgent(assets: V2AssetBundle) {
  return new Agent({
    name: "V2 Disease Research Desk",
    model: baseModel,
    modelSettings: { ...structureSettings, toolChoice: "required" },
    tools: [webSearchTool({ searchContextSize: "high" })],
    outputType: DiseaseDossierSchema,
    instructions: instructionsFromAssets(assets, "agent_disease_research_desk.md")
  });
}

export function makeV2EpisodePitchAgent(assets: V2AssetBundle) {
  return new Agent({
    name: "V2 Episode Pitch Builder",
    model: baseModel,
    modelSettings: storySettings,
    tools: [],
    outputType: EpisodePitchSchema,
    instructions: instructionsFromAssets(assets, "agent_episode_pitch.md")
  });
}

export function makeV2TruthModelAgent(assets: V2AssetBundle) {
  return new Agent({
    name: "V2 Truth Model Engineer",
    model: baseModel,
    modelSettings: structureSettings,
    tools: [],
    outputType: TruthModelSchema,
    instructions: instructionsFromAssets(assets, "agent_case_engineer_truth_model.md")
  });
}

export function makeV2DifferentialCastAgent(assets: V2AssetBundle) {
  return new Agent({
    name: "V2 Differential Cast Director",
    model: baseModel,
    modelSettings: structureSettings,
    tools: [],
    outputType: DifferentialCastSchema,
    instructions: instructionsFromAssets(assets, "agent_differential_cast_director.md")
  });
}

export function makeV2ClueArchitectAgent(assets: V2AssetBundle) {
  return new Agent({
    name: "V2 Clue Architect",
    model: baseModel,
    modelSettings: structureSettings,
    tools: [],
    outputType: ClueGraphSchema,
    instructions: instructionsFromAssets(assets, "agent_clue_architect.md")
  });
}

export function makeV2PlotDirectorDeckSpecAgent(assets: V2AssetBundle) {
  return new Agent({
    name: "V2 Plot Director DeckSpec",
    model: baseModel,
    modelSettings: plotDirectorSettings,
    tools: [],
    outputType: DeckSpecSchema,
    instructions: instructionsFromAssets(assets, "agent_plot_director_deckspec.md")
  });
}

export function makeV2MicroWorldMapAgent(assets: V2AssetBundle) {
  return new Agent({
    name: "V2 Micro-World Mapper",
    model: baseModel,
    modelSettings: storySettings,
    tools: [],
    outputType: MicroWorldMapSchema,
    instructions: instructionsFromAssets(assets, "agent_micro_world_mapper.md")
  });
}

export function makeV2DramaPlanAgent(assets: V2AssetBundle) {
  return new Agent({
    name: "V2 Drama Architect",
    model: baseModel,
    modelSettings: storySettings,
    tools: [],
    outputType: DramaPlanSchema,
    instructions: instructionsFromAssets(assets, "agent_drama_architect.md")
  });
}

export function makeV2SetpiecePlanAgent(assets: V2AssetBundle) {
  return new Agent({
    name: "V2 Setpiece Choreographer",
    model: baseModel,
    modelSettings: storySettings,
    tools: [],
    outputType: SetpiecePlanSchema,
    instructions: instructionsFromAssets(assets, "agent_setpiece_choreographer.md")
  });
}

export function makeV2StoryBlueprintAgent(assets: V2AssetBundle) {
  return new Agent({
    name: "V2 Story Blueprint Architect",
    model: baseModel,
    modelSettings: storyBlueprintSettings,
    tools: [],
    outputType: StoryBlueprintSchema,
    instructions: instructionsFromAssets(assets, "agent_story_blueprint.md")
  });
}

export function makeV2ActOutlineAgent(assets: V2AssetBundle) {
  return new Agent({
    name: "V2 Act Outline Architect",
    model: baseModel,
    modelSettings: actOutlineSettings,
    tools: [],
    outputType: ActOutlineSchema,
    instructions: instructionsFromAssets(assets, "agent_act_outline.md")
  });
}

export function makeV2SlideBlockAuthorAgent(assets: V2AssetBundle) {
  return new Agent({
    name: "V2 Slide Block Author",
    model: baseModel,
    modelSettings: deckBlockSettings,
    tools: [],
    outputType: SlideBlockSchema,
    instructions: instructionsFromAssets(assets, "agent_slide_block_author.md")
  });
}

export function makeV2ReaderSimAgent(assets: V2AssetBundle) {
  return new Agent({
    name: "V2 Reader Simulator",
    model: baseModel,
    modelSettings: factcheckSettings,
    tools: [],
    outputType: ReaderSimReportSchema,
    instructions: instructionsFromAssets(assets, "agent_qa_reader_sim.md")
  });
}

export function makeV2MedFactcheckAgent(assets: V2AssetBundle) {
  return new Agent({
    name: "V2 Medical Fact Checker",
    model: baseModel,
    modelSettings: factcheckSettings,
    tools: [],
    outputType: MedFactcheckReportSchema,
    instructions: instructionsFromAssets(assets, "agent_qa_med_factcheck.md")
  });
}
