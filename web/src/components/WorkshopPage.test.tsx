import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import WorkshopPage from "./WorkshopPage";

vi.mock("../api", () => {
  const baseOutline = {
    chapter_outline: {
      categories: [
        {
          order: 1,
          title: "Common Initial Complaints",
          topic_areas: [{ id: "1.1", title: "Upper airway", subtopics: [{ id: "1.1.1", title: "Dyspnea", content_md: "Clinical clue" }] }]
        }
      ]
    }
  };

  const baseStoryBeats = {
    schema_version: "1.0.0" as const,
    topic: "topic",
    intro: { user_notes: "", beat_md: "", generation_count: 0 },
    outro: { user_notes: "", beat_md: "", generation_count: 0 },
    topic_area_beats: {
      "1.1": {
        topic_area_id: "1.1",
        category_title: "Common Initial Complaints",
        topic_area_title: "Upper airway",
        outline_md: "outline",
        user_notes: "",
        beat_md: "",
        generation_count: 0
      }
    }
  };

  return {
    getRun: vi.fn(async () => ({
      runId: "r1",
      topic: "topic",
      settings: { workflow: "v2_micro_detectives" },
      status: "paused",
      startedAt: "2026-02-28T00:00:00.000Z",
      outputFolder: "output/r1",
      steps: {}
    })),
    getChapterOutline: vi.fn(async () => baseOutline),
    getStoryBeats: vi.fn(async () => baseStoryBeats),
    updateStoryBeats: vi.fn(async () => baseStoryBeats),
    generateStoryBeat: vi.fn(async () => ({ topicAreaId: "1.1", beat_md: "Generated beat", story_beats: baseStoryBeats })),
    rerunFrom: vi.fn(async () => ({ runId: "child-1" }))
  };
});

import { generateStoryBeat, getChapterOutline, getRun, getStoryBeats, rerunFrom, updateStoryBeats } from "../api";

function renderWorkshop() {
  return render(
    <MemoryRouter initialEntries={["/runs/r1/workshop"]}>
      <Routes>
        <Route path="/runs/:runId/workshop" element={<WorkshopPage />} />
        <Route path="/runs/:runId" element={<div>run page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("WorkshopPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders 3-column workshop rows from outline", async () => {
    renderWorkshop();

    expect(await screen.findByText("Beat workshop")).toBeInTheDocument();
    expect(await screen.findByText("Outline (locked)")).toBeInTheDocument();
    expect(await screen.findByText("Your Notes")).toBeInTheDocument();
    expect(await screen.findByText("Generated Beat")).toBeInTheDocument();
    expect(await screen.findByText(/1\.1 Upper airway/i, { selector: "strong" })).toBeInTheDocument();
    expect(await screen.findByText(/Intro Beat/i, { selector: "strong" })).toBeInTheDocument();
    expect(await screen.findByText(/Outro Beat/i, { selector: "strong" })).toBeInTheDocument();
  });

  it("saves notes for a row", async () => {
    const user = userEvent.setup();
    renderWorkshop();

    const textareas = await screen.findAllByLabelText("Notes");
    const textarea = textareas[0];
    await user.type(textarea, "Use basement membrane clue");
    await user.click(screen.getAllByRole("button", { name: "Save Notes" })[0]);

    expect(updateStoryBeats).toHaveBeenCalled();
  });

  it("generates beat for a row", async () => {
    const nextStoryBeats = {
      schema_version: "1.0.0" as const,
      topic: "topic",
      intro: { user_notes: "", beat_md: "Intro beat", generation_count: 1 },
      outro: { user_notes: "", beat_md: "Outro beat", generation_count: 1 },
      topic_area_beats: {
        "1.1": {
          topic_area_id: "1.1",
          category_title: "Common Initial Complaints",
          topic_area_title: "Upper airway",
          outline_md: "outline",
          user_notes: "notes",
          beat_md: "Generated beat",
          generation_count: 1
        }
      }
    };

    vi.mocked(generateStoryBeat).mockResolvedValueOnce({
      topicAreaId: "1.1",
      beat_md: "Generated beat",
      story_beats: nextStoryBeats
    });

    const user = userEvent.setup();
    renderWorkshop();

    const generateButtons = await screen.findAllByRole("button", { name: "Generate Beat" });
    await user.click(generateButtons[1]);

    expect(generateStoryBeat).toHaveBeenCalledWith("r1", expect.objectContaining({ topicAreaId: "1.1" }));
    expect(await screen.findByText(/Generated beat/i, { selector: "p" })).toBeInTheDocument();
  });

  it("starts rerun from D when all beats exist", async () => {
    vi.mocked(getStoryBeats).mockResolvedValueOnce({
      schema_version: "1.0.0",
      topic: "topic",
      intro: { user_notes: "", beat_md: "intro", generation_count: 1 },
      outro: { user_notes: "", beat_md: "outro", generation_count: 1 },
      topic_area_beats: {
        "1.1": {
          topic_area_id: "1.1",
          category_title: "Common Initial Complaints",
          topic_area_title: "Upper airway",
          outline_md: "outline",
          user_notes: "",
          beat_md: "beat",
          generation_count: 1
        }
      }
    });

    const user = userEvent.setup();
    renderWorkshop();

    const button = await screen.findByRole("button", { name: /Continue to Full Build/i });
    await user.click(button);
    expect(rerunFrom).toHaveBeenCalledWith("r1", "D");
  });

  it("shows rerun errors when full-build handoff fails", async () => {
    vi.mocked(getStoryBeats).mockResolvedValueOnce({
      schema_version: "1.0.0",
      topic: "topic",
      intro: { user_notes: "", beat_md: "intro", generation_count: 1 },
      outro: { user_notes: "", beat_md: "outro", generation_count: 1 },
      topic_area_beats: {
        "1.1": {
          topic_area_id: "1.1",
          category_title: "Common Initial Complaints",
          topic_area_title: "Upper airway",
          outline_md: "outline",
          user_notes: "",
          beat_md: "beat",
          generation_count: 1
        }
      }
    });
    vi.mocked(rerunFrom).mockRejectedValueOnce("rerun-failed");

    const user = userEvent.setup();
    renderWorkshop();

    const button = await screen.findByRole("button", { name: /Continue to Full Build/i });
    await user.click(button);

    expect(await screen.findByText("rerun-failed")).toBeInTheDocument();
  });

  it("shows non-v2 warning", async () => {
    vi.mocked(getRun).mockResolvedValueOnce({
      runId: "r1",
      topic: "topic",
      settings: { workflow: "legacy" },
      status: "done",
      startedAt: "2026-02-28T00:00:00.000Z",
      outputFolder: "output/r1",
      steps: {}
    } as Awaited<ReturnType<typeof getRun>>);

    renderWorkshop();

    expect(await screen.findByText(/Workshop is intended for v2 runs/i)).toBeInTheDocument();
  });

  it("shows top-level load errors", async () => {
    vi.mocked(getChapterOutline).mockRejectedValueOnce("outline-missing");

    renderWorkshop();

    expect(await screen.findByText("outline-missing")).toBeInTheDocument();
  });
});
