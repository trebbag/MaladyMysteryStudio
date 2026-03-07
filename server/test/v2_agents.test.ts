import { beforeEach, describe, expect, it, vi } from "vitest";

const fileSearchToolMock = vi.hoisted(() => vi.fn((...args: unknown[]) => ({ type: "file_search", args })));
const webSearchToolMock = vi.hoisted(() => vi.fn((...args: unknown[]) => ({ type: "web_search", args })));

vi.mock("@openai/agents", () => ({
  Agent: class Agent {
    name?: string;
    model?: string;
    modelSettings?: unknown;
    tools?: unknown[];
    outputType?: unknown;
    instructions?: string;
    constructor(config: Record<string, unknown>) {
      Object.assign(this, config);
    }
  },
  fileSearchTool: fileSearchToolMock,
  webSearchTool: webSearchToolMock
}));

import { makeV2DiseaseResearchAgent, makeV2NarrativeIntensifierAgent } from "../src/pipeline/v2_micro_detectives/agents.js";

const assets = {
  promptFiles: {
    "00_global_system_prompt.md": "GLOBAL",
    "agent_disease_research_desk.md": "DISEASE",
    "agent_narrative_intensifier.md": "INTENSIFIER"
  }
} as const;

describe("v2 agents", () => {
  beforeEach(() => {
    fileSearchToolMock.mockClear();
    webSearchToolMock.mockClear();
    delete process.env.KB_VECTOR_STORE_ID;
  });

  it("configures disease research for curated-first retrieval with web supplementation", () => {
    const agent = makeV2DiseaseResearchAgent(assets as never, "vs_curated") as unknown as {
      tools: Array<{ type: string; args: unknown[] }>;
      instructions: string;
    };

    expect(fileSearchToolMock).toHaveBeenCalledWith("vs_curated", expect.objectContaining({ includeSearchResults: true }));
    expect(webSearchToolMock).toHaveBeenCalledWith(expect.objectContaining({ searchContextSize: "high" }));
    expect(agent.tools.map((tool) => tool.type)).toEqual(["file_search", "web_search"]);
    expect(agent.instructions).toContain("GLOBAL");
    expect(agent.instructions).toContain("DISEASE");
  });

  it("falls back to web-only research when no vector store id is available", () => {
    const agent = makeV2DiseaseResearchAgent(assets as never) as unknown as {
      tools: Array<{ type: string; args: unknown[] }>;
    };

    expect(fileSearchToolMock).not.toHaveBeenCalled();
    expect(webSearchToolMock).toHaveBeenCalledTimes(1);
    expect(agent.tools.map((tool) => tool.type)).toEqual(["web_search"]);
  });

  it("builds the narrative intensifier agent with the dedicated prompt", () => {
    const agent = makeV2NarrativeIntensifierAgent(assets as never) as unknown as {
      name: string;
      instructions: string;
    };

    expect(agent.name).toBe("V2 Narrative Intensifier");
    expect(agent.instructions).toContain("INTENSIFIER");
  });
});
