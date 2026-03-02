import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ArtifactVaultPage from "./ArtifactVaultPage";

vi.mock("../api", () => {
  return {
    listArtifacts: vi.fn(async () => []),
    fetchArtifact: vi.fn(async () => ({ text: "{}", contentType: "application/json" }))
  };
});

import { fetchArtifact, listArtifacts } from "../api";

describe("ArtifactVaultPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads artifact list and renders selected content", async () => {
    vi.mocked(listArtifacts).mockResolvedValueOnce([
      { name: "run.json", size: 1200, mtimeMs: Date.now(), folder: "root" },
      { name: "deck_spec.json", size: 3200, mtimeMs: Date.now() - 1_000, folder: "intermediate" }
    ]);
    vi.mocked(fetchArtifact).mockResolvedValue({ text: "{\"ok\":true}", contentType: "application/json" });

    render(
      <MemoryRouter initialEntries={["/runs/r1/artifacts"]}>
        <Routes>
          <Route path="/runs/:runId/artifacts" element={<ArtifactVaultPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect((await screen.findAllByText("run.json")).length).toBeGreaterThan(0);
    expect(await screen.findByText("Artifact vault")).toBeInTheDocument();
    expect(fetchArtifact).toHaveBeenCalledWith("r1", "run.json");
  });

  it("filters artifacts by folder and query", async () => {
    vi.mocked(listArtifacts).mockResolvedValueOnce([
      { name: "trace.json", size: 2200, mtimeMs: Date.now(), folder: "final" },
      { name: "notes.md", size: 2100, mtimeMs: Date.now(), folder: "intermediate" }
    ]);

    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/runs/r2/artifacts"]}>
        <Routes>
          <Route path="/runs/:runId/artifacts" element={<ArtifactVaultPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect((await screen.findAllByText("trace.json")).length).toBeGreaterThan(0);
    await user.selectOptions(screen.getByLabelText("Artifact vault folder filter"), "final");
    expect(screen.getAllByText("trace.json").length).toBeGreaterThan(0);
    expect(screen.queryByText("notes.md")).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Artifact vault search"), "missing");
    expect(await screen.findByText(/No artifacts match current filters/i)).toBeInTheDocument();
  });

  it("handles list and artifact fetch failures (including non-Error throws)", async () => {
    vi.mocked(listArtifacts).mockRejectedValueOnce("list-fail");

    render(
      <MemoryRouter initialEntries={["/runs/r3/artifacts"]}>
        <Routes>
          <Route path="/runs/:runId/artifacts" element={<ArtifactVaultPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("list-fail")).toBeInTheDocument();

    vi.mocked(listArtifacts).mockResolvedValueOnce([
      { name: "bad.json", size: 1000, mtimeMs: Date.now(), folder: "intermediate" },
      { name: "good.json", size: 1000, mtimeMs: Date.now() - 1000, folder: "intermediate" }
    ]);
    vi.mocked(fetchArtifact).mockRejectedValueOnce("artifact-fail").mockResolvedValueOnce({ text: "{\"ok\":1}", contentType: "application/json" });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Refresh" }));

    expect(await screen.findByText("artifact-fail")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /good\.json/i }));
    expect(fetchArtifact).toHaveBeenCalledWith("r3", "good.json");
  });

  it("renders safely when runId route param is missing", async () => {
    render(
      <MemoryRouter initialEntries={["/artifacts"]}>
        <Routes>
          <Route path="/artifacts" element={<ArtifactVaultPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole("heading", { name: "Artifact vault" })).toBeInTheDocument();
    expect(screen.getByText("-")).toBeInTheDocument();
  });
});
