import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import RunsListPage from "./RunsListPage";

vi.mock("../api", () => {
  return {
    listRuns: vi.fn(async () => [])
  };
});

import { listRuns } from "../api";

describe("RunsListPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads and renders runs, then filters by search", async () => {
    vi.mocked(listRuns).mockResolvedValueOnce([
      { runId: "run_1", topic: "DKA", status: "done", startedAt: "2026-02-28T10:00:00.000Z", finishedAt: "2026-02-28T10:04:00.000Z" },
      { runId: "run_2", topic: "Sepsis", status: "running", startedAt: "2026-02-28T11:00:00.000Z" }
    ]);

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <RunsListPage />
      </MemoryRouter>
    );

    expect(await screen.findByText("DKA")).toBeInTheDocument();
    expect(screen.getByText("Sepsis")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Runs search"), "run_2");
    expect(screen.queryByText("DKA")).not.toBeInTheDocument();
    expect(screen.getByText("Sepsis")).toBeInTheDocument();
  });

  it("shows API errors", async () => {
    vi.mocked(listRuns).mockRejectedValueOnce(new Error("boom"));

    render(
      <MemoryRouter>
        <RunsListPage />
      </MemoryRouter>
    );

    expect(await screen.findByText("boom")).toBeInTheDocument();
  });

  it("supports status filtering and refresh reload", async () => {
    vi.mocked(listRuns)
      .mockResolvedValueOnce([
        { runId: "run_done", topic: "Done topic", status: "done", startedAt: "2026-02-28T10:00:00.000Z" },
        { runId: "run_running", topic: "Run topic", status: "running", startedAt: "2026-02-28T10:05:00.000Z" }
      ])
      .mockResolvedValueOnce([{ runId: "run_refresh", topic: "Refreshed", status: "done", startedAt: "2026-02-28T11:00:00.000Z" }]);

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <RunsListPage />
      </MemoryRouter>
    );

    expect(await screen.findByText("Done topic")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Runs status filter"), "done");
    expect(screen.getByText("Done topic")).toBeInTheDocument();
    expect(screen.queryByText("Run topic")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByText("Refreshed")).toBeInTheDocument();
  });

  it("handles non-Error throws", async () => {
    vi.mocked(listRuns).mockRejectedValueOnce("string-fail");

    render(
      <MemoryRouter>
        <RunsListPage />
      </MemoryRouter>
    );

    expect(await screen.findByText("string-fail")).toBeInTheDocument();
  });
});
