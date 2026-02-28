import { Agent, webSearchTool } from "@openai/agents";
import type { V2AssetBundle } from "./assets.js";
import {
  ClueGraphSchema,
  DeckSpecSchema,
  DifferentialCastSchema,
  DiseaseDossierSchema,
  EpisodePitchSchema,
  MedFactcheckReportSchema,
  ReaderSimReportSchema,
  TruthModelSchema
} from "./schemas.js";

const DEFAULT_MODEL = "gpt-5.2";
const baseModel = (process.env.MMS_MODEL && process.env.MMS_MODEL.trim().length > 0 ? process.env.MMS_MODEL.trim() : DEFAULT_MODEL);
const baseSettings = { temperature: 0.2 };
const conciseJsonSettings = { ...baseSettings, maxOutputTokens: 6000 };
const deckSpecSettings = { ...baseSettings, maxOutputTokens: 11000 };

function instructionsFromAssets(assets: V2AssetBundle, promptFile: string): string {
  const globalPrompt = assets.promptFiles["00_global_system_prompt.md"] ?? "";
  const rolePrompt = assets.promptFiles[promptFile] ?? "";
  return [globalPrompt, rolePrompt].filter((part) => part.trim().length > 0).join("\n\n");
}

export function makeV2DiseaseResearchAgent(assets: V2AssetBundle) {
  return new Agent({
    name: "V2 Disease Research Desk",
    model: baseModel,
    modelSettings: { ...baseSettings, toolChoice: "required" },
    tools: [webSearchTool({ searchContextSize: "high" })],
    outputType: DiseaseDossierSchema,
    instructions: instructionsFromAssets(assets, "agent_disease_research_desk.md")
  });
}

export function makeV2EpisodePitchAgent(assets: V2AssetBundle) {
  return new Agent({
    name: "V2 Episode Pitch Builder",
    model: baseModel,
    modelSettings: baseSettings,
    tools: [],
    outputType: EpisodePitchSchema,
    instructions: instructionsFromAssets(assets, "agent_episode_pitch.md")
  });
}

export function makeV2TruthModelAgent(assets: V2AssetBundle) {
  return new Agent({
    name: "V2 Truth Model Engineer",
    model: baseModel,
    modelSettings: baseSettings,
    tools: [],
    outputType: TruthModelSchema,
    instructions: instructionsFromAssets(assets, "agent_case_engineer_truth_model.md")
  });
}

export function makeV2DifferentialCastAgent(assets: V2AssetBundle) {
  return new Agent({
    name: "V2 Differential Cast Director",
    model: baseModel,
    modelSettings: conciseJsonSettings,
    tools: [],
    outputType: DifferentialCastSchema,
    instructions: instructionsFromAssets(assets, "agent_differential_cast_director.md")
  });
}

export function makeV2ClueArchitectAgent(assets: V2AssetBundle) {
  return new Agent({
    name: "V2 Clue Architect",
    model: baseModel,
    modelSettings: conciseJsonSettings,
    tools: [],
    outputType: ClueGraphSchema,
    instructions: instructionsFromAssets(assets, "agent_clue_architect.md")
  });
}

export function makeV2PlotDirectorDeckSpecAgent(assets: V2AssetBundle) {
  return new Agent({
    name: "V2 Plot Director DeckSpec",
    model: baseModel,
    modelSettings: deckSpecSettings,
    tools: [],
    outputType: DeckSpecSchema,
    instructions: instructionsFromAssets(assets, "agent_plot_director_deckspec.md")
  });
}

export function makeV2ReaderSimAgent(assets: V2AssetBundle) {
  return new Agent({
    name: "V2 Reader Simulator",
    model: baseModel,
    modelSettings: baseSettings,
    tools: [],
    outputType: ReaderSimReportSchema,
    instructions: instructionsFromAssets(assets, "agent_qa_reader_sim.md")
  });
}

export function makeV2MedFactcheckAgent(assets: V2AssetBundle) {
  return new Agent({
    name: "V2 Medical Fact Checker",
    model: baseModel,
    modelSettings: baseSettings,
    tools: [],
    outputType: MedFactcheckReportSchema,
    instructions: instructionsFromAssets(assets, "agent_qa_med_factcheck.md")
  });
}
