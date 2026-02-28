import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import RunViewer from "./RunViewer";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    getRun: vi.fn(),
    getGateHistory: vi.fn(),
    listArtifacts: vi.fn(),
    fetchArtifact: vi.fn(),
    cancelRun: vi.fn(),
    rerunFrom: vi.fn(),
    submitGateReview: vi.fn(),
    resumeRun: vi.fn()
  };
});

import { cancelRun, fetchArtifact, getGateHistory, getRun, listArtifacts, rerunFrom, resumeRun, submitGateReview } from "../api";

type Listener = (ev: MessageEvent) => void;

class FakeEventSource {
  static last: FakeEventSource | null = null;
  url: string;
  onerror: null | (() => void) = null;
  closed = false;
  private listeners = new Map<string, Listener[]>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.last = this;
  }

  addEventListener(type: string, cb: unknown) {
    const arr = this.listeners.get(type) ?? [];
    arr.push(cb as Listener);
    this.listeners.set(type, arr);
  }

  emit(type: string, data: string) {
    const ev = { data } as MessageEvent;
    for (const cb of this.listeners.get(type) ?? []) cb(ev);
  }

  close() {
    this.closed = true;
  }
}

const STEP_ORDER = ["KB0", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P"] as const;

function makeSteps(status: "queued" | "running" | "done" | "error" = "queued") {
  const steps: Record<string, { name: string; status: "queued" | "running" | "done" | "error"; artifacts: string[] }> = {};
  for (const s of STEP_ORDER) steps[s] = { name: s, status, artifacts: [] };
  return steps;
}

function RouteNavButton() {
  const navigate = useNavigate();
  return <button onClick={() => navigate("/runs/def456")}>go-run-2</button>;
}

describe("RunViewer", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    window.localStorage.clear();
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
    (FakeEventSource as unknown as { last: FakeEventSource | null }).last = null;

    vi.mocked(getRun).mockResolvedValue({
      runId: "abc123",
      topic: "topic",
      status: "done",
      startedAt: "2026-02-09T00:00:00.000Z",
      finishedAt: "2026-02-09T00:10:00.000Z",
      outputFolder: "output/abc123",
      traceId: "trace_test",
      settings: { durationMinutes: 20, targetSlides: 12, level: "student" },
      derivedFrom: { runId: "parent", startFrom: "C", createdAt: "2026-02-09T00:00:00.000Z" },
      canonicalSources: {
        foundAny: true,
        templateRoot: "/repo/data/canon",
        characterBiblePath: "/repo/data/canon/character_bible.md",
        seriesStyleBiblePath: "/repo/data/canon/series_style_bible.md",
        deckSpecPath: "/repo/data/canon/episode/deck_spec.md"
      },
      constraintAdherence: {
        status: "warn",
        failureCount: 0,
        warningCount: 2,
        checkedAt: "2026-02-09T00:09:59.000Z"
      },
      steps: makeSteps("done")
    });
    vi.mocked(getGateHistory).mockResolvedValue({
      schema_version: "1.0.0",
      latest_by_gate: {},
      history: []
    });

    vi.mocked(listArtifacts).mockResolvedValue([]);
    vi.mocked(fetchArtifact).mockImplementation(async (_runId: string, name: string) => {
      if (name === "deck_spec.json") {
        return {
          contentType: "application/json",
          text: JSON.stringify({
            deck_meta: { episode_title: "Test deck", deck_length_main: "30" },
            slides: [
              {
                slide_id: "S01",
                act_id: "ACT1",
                beat_type: "clue_discovery",
                template_id: "T04_CLUE_DISCOVERY",
                on_slide_text: { headline: "S01 clue" },
                story_panel: { goal: "g", opposition: "o", turn: "t", decision: "d" },
                medical_payload: { major_concept_id: "MC-01", delivery_mode: "clue", dossier_citations: [{ citation_id: "C1", claim: "x" }] },
                speaker_notes: { medical_reasoning: "reason" },
                visual_description: "visual",
                exhibit_ids: ["EX-01"]
              }
            ],
            appendix_slides: []
          })
        };
      }
      if (name === "v2_template_registry.json") {
        return {
          contentType: "application/json",
          text: JSON.stringify({
            templates: [{ template_id: "T04_CLUE_DISCOVERY", purpose: "Clue frame", renderer_instructions: ["Keep overlays legible"], allowed_beat_types: ["clue_discovery"] }]
          })
        };
      }
      if (name === "clue_graph.json") {
        return {
          contentType: "application/json",
          text: JSON.stringify({
            exhibits: [{ exhibit_id: "EX-01", purpose: "Chest x-ray discriminator" }]
          })
        };
      }
      return { contentType: "text/plain", text: "ok" };
    });
    vi.mocked(cancelRun).mockResolvedValue({ ok: true });
    vi.mocked(rerunFrom).mockResolvedValue({ runId: "child" });
    vi.mocked(submitGateReview).mockResolvedValue({
      ok: true,
      gateId: "GATE_1_PITCH",
      recommendedAction: "resume",
      suggestedResumeFrom: "B"
    });
    vi.mocked(resumeRun).mockResolvedValue({ ok: true, runId: "abc123", startFrom: "B", resumeMode: "resume" });
  });

  it("renders run metadata and can copy the trace id", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/runs/abc123"]}>
        <Routes>
          <Route path="/runs/:runId" element={<RunViewer />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("Slide spec diffs")).toBeInTheDocument();
    expect(await screen.findByText("parent parent")).toBeInTheDocument();
    expect(screen.getByText("trace_test")).toBeInTheDocument();
    expect(screen.getByText(/character_bible\.md/)).toBeInTheDocument();
    expect(screen.getByText("warn")).toBeInTheDocument();

    const copyBtn = screen.getByRole("button", { name: "Copy" });
    expect(copyBtn).toBeEnabled();

    await user.click(copyBtn);
    expect(await screen.findByText(/trace id copied/i)).toBeInTheDocument();
  });

  it("shows storyboard-review banner and phase-1 rerun options for v2 runs", async () => {
    vi.mocked(getRun).mockResolvedValueOnce({
      runId: "v2run",
      topic: "v2 topic",
      status: "done",
      startedAt: "2026-02-09T00:00:00.000Z",
      finishedAt: "2026-02-09T00:10:00.000Z",
      outputFolder: "output/v2run",
      traceId: "trace_v2",
      settings: { workflow: "v2_micro_detectives", deckLengthMain: 45, audienceLevel: "MED_SCHOOL_ADVANCED", adherenceMode: "strict" },
      steps: makeSteps("queued")
    } as never);
    vi.mocked(listArtifacts).mockResolvedValueOnce([
      { name: "deck_spec.json", size: 100, mtimeMs: 20, folder: "final" },
      { name: "GATE_3_STORYBOARD_REQUIRED.json", size: 20, mtimeMs: 19, folder: "intermediate" }
    ]);

    render(
      <MemoryRouter initialEntries={["/runs/v2run"]}>
        <Routes>
          <Route path="/runs/:runId" element={<RunViewer />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText(/Storyboard review required/i)).toBeInTheDocument();
    expect(await screen.findByText(/No gate reviews submitted yet/i)).toBeInTheDocument();

    const rerunSelect = screen.getByRole("combobox", { name: /rerun start step/i });
    const optionValues = within(rerunSelect)
      .getAllByRole("option")
      .map((opt) => (opt as HTMLOptionElement).value);
    expect(optionValues).toEqual(["KB0", "A", "B", "C"]);
  });

  it("renders v2 slide drilldown with template guidance and exhibit purpose", async () => {
    const user = userEvent.setup();
    vi.mocked(getRun).mockResolvedValueOnce({
      runId: "v2drill",
      topic: "v2 drill topic",
      status: "done",
      startedAt: "2026-02-09T00:00:00.000Z",
      finishedAt: "2026-02-09T00:10:00.000Z",
      outputFolder: "output/v2drill",
      settings: { workflow: "v2_micro_detectives", deckLengthMain: 45, audienceLevel: "MED_SCHOOL_ADVANCED", adherenceMode: "strict" },
      steps: makeSteps("done")
    } as never);
    vi.mocked(listArtifacts).mockResolvedValueOnce([
      { name: "deck_spec.json", size: 100, mtimeMs: 20, folder: "final" },
      { name: "v2_template_registry.json", size: 50, mtimeMs: 19, folder: "final" },
      { name: "clue_graph.json", size: 50, mtimeMs: 18, folder: "intermediate" },
      { name: "micro_world_map.json", size: 50, mtimeMs: 17, folder: "intermediate" },
      { name: "drama_plan.json", size: 50, mtimeMs: 16, folder: "intermediate" },
      { name: "setpiece_plan.json", size: 50, mtimeMs: 15, folder: "intermediate" }
    ]);
    vi.mocked(fetchArtifact).mockImplementation(async (_runId: string, name: string) => {
      if (name === "deck_spec.json") {
        return {
          contentType: "application/json",
          text: JSON.stringify({
            deck_meta: { episode_title: "Pilot deck", deck_length_main: "45" },
            slides: [
              {
                slide_id: "S01",
                act_id: "ACT1",
                beat_type: "clue_discovery",
                template_id: "T04_CLUE_DISCOVERY",
                title: "Slide one",
                on_slide_text: { headline: "S01 clue" },
                story_panel: { goal: "g", opposition: "o", turn: "t", decision: "d" },
                medical_payload: { major_concept_id: "MC-01", delivery_mode: "clue", dossier_citations: [{ citation_id: "C1", claim: "x" }] },
                speaker_notes: { medical_reasoning: "reason-1" },
                visual_description: "visual-1",
                exhibit_ids: ["EX-01"]
              }
            ],
            appendix_slides: [
              {
                slide_id: "A-01",
                act_id: "APPENDIX",
                beat_type: "appendix",
                template_id: "T90_APPENDIX_DEEP_DIVE",
                title: "Appendix",
                on_slide_text: { headline: "A01 appendix" },
                story_panel: { goal: "ag", opposition: "ao", turn: "at", decision: "ad" },
                medical_payload: { major_concept_id: "MC-A01", delivery_mode: "note_only", dossier_citations: [] },
                speaker_notes: { medical_reasoning: "reason-a1" },
                visual_description: "visual-a1",
                exhibit_ids: ["EX-A01"]
              }
            ]
          })
        };
      }
      if (name === "v2_template_registry.json") {
        return {
          contentType: "application/json",
          text: JSON.stringify({
            templates: [
              {
                template_id: "T04_CLUE_DISCOVERY",
                purpose: "Clue-first framing",
                renderer_instructions: ["Keep overlays legible", "Anchor one key exhibit"],
                allowed_beat_types: ["clue_discovery"]
              },
              {
                template_id: "T90_APPENDIX_DEEP_DIVE",
                purpose: "Appendix deep dive",
                renderer_instructions: ["Use compact labels"],
                allowed_beat_types: ["appendix"]
              }
            ]
          })
        };
      }
      if (name === "clue_graph.json") {
        return {
          contentType: "application/json",
          text: JSON.stringify({
            exhibits: [
              { exhibit_id: "EX-01", purpose: "Chest x-ray discriminator" },
              { exhibit_id: "EX-A01", purpose: "Appendix evidence table" }
            ]
          })
        };
      }
      if (name === "micro_world_map.json") {
        return {
          contentType: "application/json",
          text: JSON.stringify({
            zones: [
              { zone_id: "Z-LUNG-ENTRY", name: "Entry Zone", anatomic_location: "Upper airway", resident_actors: ["Sentinel A"] },
              { zone_id: "Z-LUNG-CORE", name: "Core Zone", anatomic_location: "Alveoli", resident_actors: ["Sentinel B"] }
            ],
            hazards: [{ hazard_id: "HZ-01", type: "immune_attack", description: "Immune surge blocks route" }],
            routes: [{ route_id: "RT-01", from_zone_id: "Z-LUNG-ENTRY", to_zone_id: "Z-LUNG-CORE", mode: "bloodstream", story_use: "Act I dive" }]
          })
        };
      }
      if (name === "drama_plan.json") {
        return {
          contentType: "application/json",
          text: JSON.stringify({
            character_arcs: [
              {
                character_id: "detective",
                name: "Cyto",
                core_need: "Lock diagnosis fast",
                core_fear: "Miss fatal discriminator",
                act_turns: [{ act_id: "ACT1", pressure: "Time pressure", choice: "Dive early", change: "Trusts Pip's signal" }]
              },
              {
                character_id: "deputy",
                core_need: "Challenge assumptions",
                core_fear: "Being ignored",
                act_turns: [{ act_id: "ACT2", pressure: "Contradictory clues", choice: "Push back", change: "Improves teamwork" }]
              }
            ],
            relationship_arcs: [{ pair: "detective_deputy", starting_dynamic: "Fast but tense" }]
          })
        };
      }
      if (name === "setpiece_plan.json") {
        return {
          contentType: "application/json",
          text: JSON.stringify({
            setpieces: [
              { setpiece_id: "SP-01", act_id: "ACT1", type: "transit_peril", location_zone_id: "Z-LUNG-ENTRY", story_purpose: "Introduce stakes" }
            ],
            quotas: { act1_social_or_ethics_confrontation: true }
          })
        };
      }
      return { contentType: "text/plain", text: "ok" };
    });

    render(
      <MemoryRouter initialEntries={["/runs/v2drill"]}>
        <Routes>
          <Route path="/runs/:runId" element={<RunViewer />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("V2 slide drilldown")).toBeInTheDocument();
    expect(await screen.findByText(/Clue-first framing/i)).toBeInTheDocument();
    expect(await screen.findByText(/EX-01/)).toBeInTheDocument();
    expect(await screen.findByText(/Chest x-ray discriminator/)).toBeInTheDocument();
    expect(await screen.findByText("V2 artifact inspectors")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Micro World" }));
    expect(await screen.findByText(/Zone details/i)).toBeInTheDocument();
    expect(await screen.findByText(/Upper airway/i)).toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: /V2 inspector zone/i }), "Z-LUNG-CORE");
    expect(await screen.findByText(/Alveoli/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Drama Plan" }));
    expect(await screen.findByText(/Character arc details/i)).toBeInTheDocument();
    expect(await screen.findByText(/Lock diagnosis fast/i)).toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: /V2 inspector character/i }), "deputy");
    expect(await screen.findByText(/Challenge assumptions/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Setpieces" }));
    expect(await screen.findByText(/SP-01/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Templates" }));
    expect(await screen.findByText(/Template registry/i)).toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: /V2 drilldown slide/i }), "A-01");
    expect((await screen.findAllByText(/Appendix deep dive/)).length).toBeGreaterThan(0);
    expect(await screen.findByText(/EX-A01/)).toBeInTheDocument();
    expect(await screen.findByText(/Appendix evidence table/)).toBeInTheDocument();
  });

  it("shows v2 drilldown parse errors when deck spec is invalid JSON", async () => {
    vi.mocked(getRun).mockResolvedValueOnce({
      runId: "v2broken",
      topic: "v2 broken topic",
      status: "done",
      startedAt: "2026-02-09T00:00:00.000Z",
      finishedAt: "2026-02-09T00:10:00.000Z",
      outputFolder: "output/v2broken",
      settings: { workflow: "v2_micro_detectives", deckLengthMain: 30, audienceLevel: "RESIDENT", adherenceMode: "strict" },
      steps: makeSteps("done")
    } as never);
    vi.mocked(listArtifacts).mockResolvedValueOnce([{ name: "deck_spec.json", size: 12, mtimeMs: 1, folder: "final" }]);
    vi.mocked(fetchArtifact).mockResolvedValueOnce({ contentType: "application/json", text: "{bad-json" });

    render(
      <MemoryRouter initialEntries={["/runs/v2broken"]}>
        <Routes>
          <Route path="/runs/:runId" element={<RunViewer />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("V2 slide drilldown")).toBeInTheDocument();
    expect((await screen.findAllByText(/Invalid JSON artifact/i)).length).toBeGreaterThan(0);
  });

  it("shows empty v2 inspector states when optional inspector artifacts are absent", async () => {
    const user = userEvent.setup();
    vi.mocked(getRun).mockResolvedValueOnce({
      runId: "v2inspect-empty",
      topic: "v2 inspector empty",
      status: "done",
      startedAt: "2026-02-09T00:00:00.000Z",
      finishedAt: "2026-02-09T00:10:00.000Z",
      outputFolder: "output/v2inspect-empty",
      settings: { workflow: "v2_micro_detectives", deckLengthMain: 30, audienceLevel: "RESIDENT", adherenceMode: "strict" },
      steps: makeSteps("done")
    } as never);
    vi.mocked(listArtifacts).mockResolvedValueOnce([{ name: "deck_spec.json", size: 40, mtimeMs: 20, folder: "final" }]);
    vi.mocked(fetchArtifact).mockResolvedValueOnce({
      contentType: "application/json",
      text: JSON.stringify({
        deck_meta: { episode_title: "Pilot deck", deck_length_main: "30" },
        slides: [
          {
            slide_id: "S01",
            title: "Slide one",
            story_panel: { goal: "g", opposition: "o", turn: "t", decision: "d" },
            medical_payload: { major_concept_id: "MC-01", delivery_mode: "clue" },
            speaker_notes: { medical_reasoning: "r" }
          }
        ],
        appendix_slides: []
      })
    });

    render(
      <MemoryRouter initialEntries={["/runs/v2inspect-empty"]}>
        <Routes>
          <Route path="/runs/:runId" element={<RunViewer />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("V2 artifact inspectors")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Micro World" }));
    expect(await screen.findByText(/No micro_world_map\.json artifact yet/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Drama Plan" }));
    expect(await screen.findByText(/No drama_plan\.json artifact yet/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Setpieces" }));
    expect(await screen.findByText(/No setpiece_plan\.json artifact yet/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Templates" }));
    expect(await screen.findByText(/No v2_template_registry\.json artifact yet/i)).toBeInTheDocument();
  });

  it("renders paused gate controls and submits review/resume actions", async () => {
    const user = userEvent.setup();
    vi.mocked(getRun).mockResolvedValue({
      runId: "pausedrun",
      topic: "v2 paused topic",
      status: "paused",
      startedAt: "2026-02-09T00:00:00.000Z",
      outputFolder: "output/pausedrun",
      settings: { workflow: "v2_micro_detectives", deckLengthMain: 45, audienceLevel: "MED_SCHOOL_ADVANCED", adherenceMode: "strict" },
      activeGate: {
        gateId: "GATE_1_PITCH",
        resumeFrom: "B",
        message: "Gate 1 review required.",
        at: "2026-02-09T00:03:00.000Z"
      },
      steps: makeSteps("queued")
    } as never);
    vi.mocked(getGateHistory).mockResolvedValue({
      schema_version: "1.0.0",
      latest_by_gate: { GATE_1_PITCH: null },
      history: []
    });

    render(
      <MemoryRouter initialEntries={["/runs/pausedrun"]}>
        <Routes>
          <Route path="/runs/:runId" element={<RunViewer />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText(/Gate review required/i)).toBeInTheDocument();
    expect(screen.getByText("GATE_1_PITCH")).toBeInTheDocument();
    expect(screen.getByText(/resumeFrom=B/i)).toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: /decision/i }), "approve");
    await user.type(screen.getByLabelText(/gate notes/i), "Approved for continuation.");
    await user.click(screen.getByRole("button", { name: /Submit gate review/i }));
    expect(submitGateReview).toHaveBeenCalledWith(
      "pausedrun",
      "GATE_1_PITCH",
      expect.objectContaining({ status: "approve", notes: expect.stringContaining("Approved") })
    );

    await user.click(screen.getByRole("button", { name: /Resume run/i }));
    expect(resumeRun).toHaveBeenCalledWith("pausedrun");
  });

  it("renders gate history entries when available", async () => {
    vi.mocked(getRun).mockResolvedValue({
      runId: "v2history",
      topic: "v2 history topic",
      status: "done",
      startedAt: "2026-02-09T00:00:00.000Z",
      outputFolder: "output/v2history",
      settings: { workflow: "v2_micro_detectives", deckLengthMain: 45, audienceLevel: "MED_SCHOOL_ADVANCED", adherenceMode: "strict" },
      steps: makeSteps("done")
    } as never);
    vi.mocked(getGateHistory).mockResolvedValue({
      schema_version: "1.0.0",
      latest_by_gate: {},
      history: [
        {
          schema_version: "1.0.0",
          gate_id: "GATE_1_PITCH",
          status: "approve",
          notes: "looks good",
          requested_changes: [],
          submitted_at: "2026-02-09T00:05:00.000Z"
        }
      ]
    });

    render(
      <MemoryRouter initialEntries={["/runs/v2history"]}>
        <Routes>
          <Route path="/runs/:runId" element={<RunViewer />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText(/Gate history/i)).toBeInTheDocument();
    expect(await screen.findByText(/GATE_1_PITCH/)).toBeInTheDocument();
    expect(await screen.findByText(/looks good/)).toBeInTheDocument();
  });

  it("shows paused-run recovery guidance for request_changes and regenerate decisions", async () => {
    const user = userEvent.setup();
    vi.mocked(getRun).mockResolvedValue({
      runId: "pausedrun",
      topic: "v2 paused topic",
      status: "paused",
      startedAt: "2026-02-09T00:00:00.000Z",
      outputFolder: "output/pausedrun",
      settings: { workflow: "v2_micro_detectives", deckLengthMain: 45, audienceLevel: "MED_SCHOOL_ADVANCED", adherenceMode: "strict" },
      activeGate: {
        gateId: "GATE_1_PITCH",
        resumeFrom: "B",
        message: "Gate 1 review required.",
        at: "2026-02-09T00:03:00.000Z"
      },
      steps: makeSteps("queued")
    } as never);
    vi.mocked(getGateHistory).mockResolvedValue({
      schema_version: "1.0.0",
      latest_by_gate: { GATE_1_PITCH: null },
      history: []
    });
    vi.mocked(submitGateReview)
      .mockResolvedValueOnce({
        ok: true,
        gateId: "GATE_1_PITCH",
        recommendedAction: "wait_for_changes"
      })
      .mockResolvedValueOnce({
        ok: true,
        gateId: "GATE_1_PITCH",
        recommendedAction: "resume_regenerate",
        suggestedResumeFrom: "A"
      });

    render(
      <MemoryRouter initialEntries={["/runs/pausedrun"]}>
        <Routes>
          <Route path="/runs/:runId" element={<RunViewer />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText(/Gate review required/i)).toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: /decision/i }), "request_changes");
    await user.click(screen.getByRole("button", { name: /Submit gate review/i }));
    expect(await screen.findByText(/will stay paused/i)).toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: /decision/i }), "regenerate");
    await user.click(screen.getByRole("button", { name: /Submit gate review/i }));
    expect(await screen.findByText(/Ready to regenerate from A/i)).toBeInTheDocument();
  });

  it("surfaces gate review submission failures when backend throws non-Error values", async () => {
    const user = userEvent.setup();
    vi.mocked(getRun).mockResolvedValue({
      runId: "pausedrun",
      topic: "v2 paused topic",
      status: "paused",
      startedAt: "2026-02-09T00:00:00.000Z",
      outputFolder: "output/pausedrun",
      settings: { workflow: "v2_micro_detectives", deckLengthMain: 45, audienceLevel: "MED_SCHOOL_ADVANCED", adherenceMode: "strict" },
      activeGate: {
        gateId: "GATE_1_PITCH",
        resumeFrom: "B",
        message: "Gate 1 review required.",
        at: "2026-02-09T00:03:00.000Z"
      },
      steps: makeSteps("queued")
    } as never);
    vi.mocked(getGateHistory).mockResolvedValue({
      schema_version: "1.0.0",
      latest_by_gate: { GATE_1_PITCH: null },
      history: []
    });
    vi.mocked(submitGateReview).mockRejectedValueOnce("submit-nope");

    render(
      <MemoryRouter initialEntries={["/runs/pausedrun"]}>
        <Routes>
          <Route path="/runs/:runId" element={<RunViewer />} />
        </Routes>
      </MemoryRouter>
    );

    await user.click(await screen.findByRole("button", { name: /Submit gate review/i }));
    expect(await screen.findByText(/submit-nope/i)).toBeInTheDocument();
  });

  it("shows regenerate resume messaging when backend returns resumeMode=regenerate", async () => {
    const user = userEvent.setup();
    vi.mocked(getRun).mockResolvedValue({
      runId: "pausedrun",
      topic: "v2 paused topic",
      status: "paused",
      startedAt: "2026-02-09T00:00:00.000Z",
      outputFolder: "output/pausedrun",
      settings: { workflow: "v2_micro_detectives", deckLengthMain: 45, audienceLevel: "MED_SCHOOL_ADVANCED", adherenceMode: "strict" },
      activeGate: {
        gateId: "GATE_2_TRUTH_LOCK",
        resumeFrom: "C",
        message: "Gate 2 review required.",
        at: "2026-02-09T00:03:00.000Z"
      },
      steps: makeSteps("queued")
    } as never);
    vi.mocked(getGateHistory).mockResolvedValue({
      schema_version: "1.0.0",
      latest_by_gate: { GATE_2_TRUTH_LOCK: null },
      history: []
    });
    vi.mocked(resumeRun).mockResolvedValueOnce({ ok: true, runId: "pausedrun", startFrom: "B", resumeMode: "regenerate" });

    render(
      <MemoryRouter initialEntries={["/runs/pausedrun"]}>
        <Routes>
          <Route path="/runs/:runId" element={<RunViewer />} />
        </Routes>
      </MemoryRouter>
    );

    await user.click(await screen.findByRole("button", { name: /Resume run/i }));
    expect(await screen.findByText(/Regeneration requested from B/i)).toBeInTheDocument();
  });

  it("surfaces non-Error resume failures for paused runs", async () => {
    const user = userEvent.setup();
    vi.mocked(getRun).mockResolvedValue({
      runId: "pausedrun",
      topic: "v2 paused topic",
      status: "paused",
      startedAt: "2026-02-09T00:00:00.000Z",
      outputFolder: "output/pausedrun",
      settings: { workflow: "v2_micro_detectives", deckLengthMain: 45, audienceLevel: "MED_SCHOOL_ADVANCED", adherenceMode: "strict" },
      activeGate: {
        gateId: "GATE_2_TRUTH_LOCK",
        resumeFrom: "C",
        message: "Gate 2 review required.",
        at: "2026-02-09T00:03:00.000Z"
      },
      steps: makeSteps("queued")
    } as never);
    vi.mocked(getGateHistory).mockResolvedValue({
      schema_version: "1.0.0",
      latest_by_gate: { GATE_2_TRUTH_LOCK: null },
      history: []
    });
    vi.mocked(resumeRun).mockRejectedValueOnce("resume-nope");

    render(
      <MemoryRouter initialEntries={["/runs/pausedrun"]}>
        <Routes>
          <Route path="/runs/:runId" element={<RunViewer />} />
        </Routes>
      </MemoryRouter>
    );

    await user.click(await screen.findByRole("button", { name: /Resume run/i }));
    expect(await screen.findByText(/resume-nope/i)).toBeInTheDocument();
  });

  it("refreshes v2 gate history from the panel refresh action", async () => {
    const user = userEvent.setup();
    vi.mocked(getRun).mockResolvedValue({
      runId: "v2history",
      topic: "v2 history topic",
      status: "done",
      startedAt: "2026-02-09T00:00:00.000Z",
      outputFolder: "output/v2history",
      settings: { workflow: "v2_micro_detectives", deckLengthMain: 45, audienceLevel: "MED_SCHOOL_ADVANCED", adherenceMode: "strict" },
      steps: makeSteps("done")
    } as never);
    vi.mocked(getGateHistory).mockResolvedValue({
      schema_version: "1.0.0",
      latest_by_gate: {},
      history: []
    });

    render(
      <MemoryRouter initialEntries={["/runs/v2history"]}>
        <Routes>
          <Route path="/runs/:runId" element={<RunViewer />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText(/Gate history/i)).toBeInTheDocument();
    const gateHistoryHeader = screen.getByText("Gate history").closest(".panelHeader") as HTMLElement | null;
    if (!gateHistoryHeader) throw new Error("missing gate history header");
    await user.click(within(gateHistoryHeader).getByRole("button", { name: "Refresh" }));
    expect(getGateHistory).toHaveBeenCalledTimes(2);
  });

  it("selects artifacts, displays content, and shows fetch errors", async () => {
    const user = userEvent.setup();

    vi.mocked(listArtifacts).mockResolvedValueOnce([
      { name: "run.json", size: 10, mtimeMs: 2 },
      { name: "trace.json", size: 11, mtimeMs: 1 },
      { name: "notes.txt", size: 12, mtimeMs: 3 }
    ]);

    vi.mocked(fetchArtifact).mockImplementation(async (_runId: string, name: string) => {
      if (name === "run.json") return { contentType: "application/json", text: "{\"ok\":true}" };
      throw new Error("fetch failed");
    });

    render(
      <MemoryRouter initialEntries={["/runs/abc123"]}>
        <Routes>
          <Route path="/runs/:runId" element={<RunViewer />} />
        </Routes>
      </MemoryRouter>
    );

    // Artifacts panel exists after the run loads.
    expect(await screen.findByText("Artifacts")).toBeInTheDocument();

    await user.click(screen.getByText("run.json"));
    expect(await screen.findByText(/"ok": true/)).toBeInTheDocument();

    await user.click(screen.getByText("notes.txt"));
    expect(await screen.findByText(/fetch failed/)).toBeInTheDocument();
  });

  it("updates steps and logs from SSE events (including unparseable payloads)", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/runs/abc123"]}>
        <Routes>
          <Route path="/runs/:runId" element={<RunViewer />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("Live logs")).toBeInTheDocument();

    const es = FakeEventSource.last;
    if (!es) throw new Error("missing EventSource instance");

    es.emit("step_started", JSON.stringify({ step: "A", at: "t" }));
    const timeline = document.querySelector<HTMLElement>(".stepList");
    if (!timeline) throw new Error("missing step timeline");
    const stepA = within(timeline).getByText("A").closest(".step");
    expect(stepA).toBeTruthy();
    await waitFor(() => expect(stepA).toHaveTextContent("running"));

    es.emit("step_finished", JSON.stringify({ step: "A", at: "t2", ok: true }));
    await waitFor(() => expect(stepA).toHaveTextContent("done"));

    // step_finished triggers a refreshRun call.
    await waitFor(() => expect(getRun).toHaveBeenCalledTimes(2));

    // ok=false marks the step as error.
    es.emit("step_started", JSON.stringify({ step: "B", at: "t" }));
    const stepB = within(timeline).getByText("B").closest(".step");
    expect(stepB).toBeTruthy();
    await waitFor(() => expect(stepB).toHaveTextContent("running"));
    // Prevent the step_finished-triggered refreshRun from immediately overwriting the SSE-updated status.
    vi.mocked(getRun).mockImplementationOnce(async () => await new Promise<Awaited<ReturnType<typeof getRun>>>(() => undefined));
    es.emit("step_finished", JSON.stringify({ step: "B", at: "t2", ok: false }));
    await waitFor(() => expect(within(timeline).getByText("B").closest(".step")).toHaveTextContent("error"));
    expect(await screen.findByText(/\[B\] finished \(error\)/)).toBeInTheDocument();

    es.emit("artifact_written", JSON.stringify({ step: "A", name: "x.json" }));
    await waitFor(() => expect(listArtifacts).toHaveBeenCalledTimes(2));

    es.emit("gate_required", JSON.stringify({ gateId: "GATE_1_PITCH", resumeFrom: "B", message: "review" }));
    expect(await screen.findByText(/gate required: GATE_1_PITCH/i)).toBeInTheDocument();
    es.emit("gate_required", "not json");
    expect(await screen.findByText(/gate_required \(unparseable\)/i)).toBeInTheDocument();

    es.emit("gate_submitted", JSON.stringify({ gateId: "GATE_1_PITCH", status: "approve" }));
    expect(await screen.findByText(/gate submitted: GATE_1_PITCH => approve/i)).toBeInTheDocument();
    es.emit("gate_submitted", "not json");
    expect(await screen.findByText(/gate_submitted \(unparseable\)/i)).toBeInTheDocument();

    es.emit("run_resumed", JSON.stringify({ gateId: "GATE_1_PITCH", startFrom: "B", mode: "resume" }));
    expect(await screen.findByText(/run resumed from GATE_1_PITCH at B \(mode=resume\)/i)).toBeInTheDocument();
    es.emit("run_resumed", "not json");
    expect(await screen.findByText(/run_resumed \(unparseable\)/i)).toBeInTheDocument();

    es.emit("log", JSON.stringify({ message: "hello", step: "A" }));
    expect(await screen.findByText(/hello/)).toBeInTheDocument();

    es.emit("log", JSON.stringify({ message: "no step" }));
    expect(await screen.findByText(/no step/)).toBeInTheDocument();

    // Unparseable payloads hit the fallback branches.
    es.emit("step_started", "not json");
    expect(await screen.findByText(/step_started \(unparseable\)/)).toBeInTheDocument();
    es.emit("step_finished", "not json");
    expect(await screen.findByText(/step_finished \(unparseable\)/)).toBeInTheDocument();
    es.emit("artifact_written", "not json");
    expect(await screen.findByText(/artifact_written \(unparseable\)/)).toBeInTheDocument();

    es.emit("log", "raw log line");
    expect(await screen.findByText(/raw log line/)).toBeInTheDocument();

    es.emit("error", JSON.stringify({ message: "boom", step: "A" }));
    expect(await screen.findByText(/ERROR: boom/)).toBeInTheDocument();

    const before = vi.mocked(getRun).mock.calls.length;
    es.emit("error", "not json");
    await waitFor(() => expect(getRun).toHaveBeenCalledTimes(before + 1));

    es.onerror?.();
    expect(await screen.findByText(/SSE connection error/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(await screen.findByText(/\(no logs yet\)/i)).toBeInTheDocument();
  });

  it("shows action errors when cancel/rerun fails (non-Error throws)", async () => {
    const user = userEvent.setup();
    vi.mocked(cancelRun).mockRejectedValueOnce("nope");
    vi.mocked(rerunFrom).mockRejectedValueOnce("nope2");
    vi.mocked(getRun).mockResolvedValueOnce({
      runId: "abc123",
      topic: "topic",
      status: "queued",
      startedAt: "2026-02-09T00:00:00.000Z",
      outputFolder: "output/abc123",
      traceId: "trace_test",
      steps: makeSteps("queued")
    });

    render(
      <MemoryRouter initialEntries={["/runs/abc123"]}>
        <Routes>
          <Route path="/runs/:runId" element={<RunViewer />} />
        </Routes>
      </MemoryRouter>
    );

    const cancelBtn = await screen.findByRole("button", { name: "Cancel run" });
    await user.click(cancelBtn);
    expect(await screen.findByText(/nope/)).toBeInTheDocument();

    const rerunBtn = await screen.findByRole("button", { name: "Rerun" });
    await user.click(rerunBtn);
    expect(await screen.findByText(/nope2/)).toBeInTheDocument();
  });

  it("navigates to derived rerun on success", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/runs/abc123"]}>
        <Routes>
          <Route path="/runs/child" element={<div>child page</div>} />
          <Route path="/runs/:runId" element={<RunViewer />} />
        </Routes>
      </MemoryRouter>
    );

    // Ensure the run loads.
    expect(await screen.findByText("Slide spec diffs")).toBeInTheDocument();

    vi.mocked(rerunFrom).mockResolvedValueOnce({ runId: "child" });
    await user.click(screen.getByRole("button", { name: "Rerun" }));
    expect(await screen.findByText("child page")).toBeInTheDocument();
  });

  it("computes unified diff and surfaces invalid JSON errors", async () => {
    const user = userEvent.setup();

    vi.mocked(listArtifacts).mockResolvedValueOnce([
      { name: "final_slide_spec.json", size: 100, mtimeMs: 3 },
      { name: "final_slide_spec_patched_iter1.json", size: 110, mtimeMs: 4 },
      { name: "final_slide_spec_patched_iter2.json", size: 120, mtimeMs: 5 }
    ]);

    render(
      <MemoryRouter initialEntries={["/runs/abc123"]}>
        <Routes>
          <Route path="/runs/:runId" element={<RunViewer />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole("button", { name: "Diff" })).toBeInTheDocument();

    // Default diff target is the latest patched iter; change it to iter1.
    const diffButton = screen.getByRole("button", { name: "Diff" });
    const diffControls = diffButton.closest(".row") as HTMLElement | null;
    if (!diffControls) throw new Error("missing diff controls");
    const diffSelect = within(diffControls).getByRole("combobox");
    await user.selectOptions(diffSelect, "final_slide_spec_patched_iter1.json");

    // First: valid diff.
    vi.mocked(fetchArtifact).mockImplementationOnce(async () => ({
      contentType: "application/json",
      text: JSON.stringify({ final_slide_spec: { title: "Base", slides: [{ slide_id: "S1", title: "t", content_md: "a", speaker_notes: "n" }], sources: [] } })
    }));
    vi.mocked(fetchArtifact).mockImplementationOnce(async () => ({
      contentType: "application/json",
      text: JSON.stringify({
        final_slide_spec_patched: { title: "Patched", slides: [{ slide_id: "S1", title: "t", content_md: "b", speaker_notes: "n" }], sources: [] }
      })
    }));

    await user.click(await screen.findByRole("button", { name: "Diff" }));
    expect(await screen.findByText(/\+\+\+/)).toBeInTheDocument();

    // Now: invalid JSON triggers diff error.
    vi.mocked(fetchArtifact).mockResolvedValueOnce({ contentType: "application/json", text: "{bad json" });
    vi.mocked(fetchArtifact).mockResolvedValueOnce({ contentType: "application/json", text: "{}" });
    await user.click(await screen.findByRole("button", { name: "Diff" }));
    expect(await screen.findByText(/Invalid JSON artifact/)).toBeInTheDocument();

    // Missing keys fall back to diffing the full object.
    vi.mocked(fetchArtifact).mockResolvedValueOnce({ contentType: "application/json", text: "{\"foo\":1}" });
    vi.mocked(fetchArtifact).mockResolvedValueOnce({ contentType: "application/json", text: "{\"bar\":2}" });
    await user.click(await screen.findByRole("button", { name: "Diff" }));
    expect(await screen.findByText(/\+\+\+/)).toBeInTheDocument();
  });

  it("shows diff status badges when baseline/patched artifacts are missing", async () => {
    vi.mocked(listArtifacts).mockResolvedValueOnce([{ name: "final_slide_spec.json", size: 100, mtimeMs: 1 }]);

    render(
      <MemoryRouter initialEntries={["/runs/abc123"]}>
        <Routes>
          <Route path="/runs/:runId" element={<RunViewer />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText(/No patched iter artifacts yet/i)).toBeInTheDocument();
  });

  it("refreshes the artifact list on demand", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/runs/abc123"]}>
        <Routes>
          <Route path="/runs/:runId" element={<RunViewer />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("Artifacts")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    expect(listArtifacts).toHaveBeenCalledTimes(2);
  });

  it("shows placeholders when optional run fields are missing", async () => {
    vi.mocked(getRun).mockResolvedValueOnce({
      runId: "abc123",
      topic: "topic",
      status: "error",
      startedAt: "2026-02-09T00:00:00.000Z",
      outputFolder: "output/abc123",
      steps: makeSteps("error")
    });

    render(
      <MemoryRouter initialEntries={["/runs/abc123"]}>
        <Routes>
          <Route path="/runs/:runId" element={<RunViewer />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("Run")).toBeInTheDocument();

    // Status badge uses badgeErr for error.
    const header = screen.getByText("Run").closest(".panelHeader") as HTMLElement | null;
    if (!header) throw new Error("missing header");
    expect(within(header).getByText("error")).toHaveClass("badgeErr");

    const metaPanel = screen.getByText("Run metadata").closest(".panel") as HTMLElement | null;
    if (!metaPanel) throw new Error("missing run metadata panel");
    const meta = within(metaPanel);

    const settingsLabel = meta.getByText("settings");
    expect(settingsLabel.closest(".metaPair")).toHaveTextContent("-");

    const derivedLabel = meta.getByText("derived");
    expect(derivedLabel.closest(".metaPair")).toHaveTextContent("-");

    const finishedLabel = meta.getByText("finished");
    expect(finishedLabel.closest(".metaPair")).toHaveTextContent("-");

    expect(screen.getByRole("button", { name: "Copy" })).toBeDisabled();
  });

  it("shows empty v2 drilldown state when deck spec artifact has not been produced yet", async () => {
    vi.mocked(getRun).mockResolvedValueOnce({
      runId: "v2empty",
      topic: "v2 empty topic",
      status: "done",
      startedAt: "2026-02-09T00:00:00.000Z",
      outputFolder: "output/v2empty",
      settings: { workflow: "v2_micro_detectives", deckLengthMain: 30, audienceLevel: "RESIDENT", adherenceMode: "strict" },
      steps: makeSteps("done")
    } as never);
    vi.mocked(listArtifacts).mockResolvedValueOnce([{ name: "GATE_3_STORYBOARD_REQUIRED.json", size: 20, mtimeMs: 19, folder: "intermediate" }]);

    render(
      <MemoryRouter initialEntries={["/runs/v2empty"]}>
        <Routes>
          <Route path="/runs/:runId" element={<RunViewer />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("V2 slide drilldown")).toBeInTheDocument();
    expect(await screen.findByText(/No deck_spec\.json artifact yet/i)).toBeInTheDocument();
  });

  it("surfaces run fetch failures", async () => {
    vi.mocked(getRun).mockRejectedValueOnce("run fetch failed");

    render(
      <MemoryRouter initialEntries={["/runs/abc123"]}>
        <Routes>
          <Route path="/runs/:runId" element={<RunViewer />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText(/run fetch failed/i)).toBeInTheDocument();
    expect(screen.queryByText("Run metadata")).not.toBeInTheDocument();
  });

  it("renders canonical miss state and zero-item diagnostics details", async () => {
    vi.mocked(getRun).mockResolvedValueOnce({
      runId: "abc123",
      topic: "topic",
      status: "done",
      startedAt: "bad-start",
      finishedAt: "bad-finish",
      outputFolder: "output/abc123",
      traceId: "trace_test",
      canonicalSources: {
        foundAny: false,
        templateRoot: "/repo/data/canon",
        characterBiblePath: "/repo/data/canon/character_bible.md",
        seriesStyleBiblePath: "/repo/data/canon/series_style_bible.md",
        deckSpecPath: "/repo/data/canon/episode/deck_spec.md"
      },
      constraintAdherence: {
        status: "pass",
        failureCount: 0,
        warningCount: 0,
        checkedAt: "not-a-date"
      },
      steps: makeSteps("done")
    });
    vi.mocked(listArtifacts).mockResolvedValueOnce([{ name: "constraint_adherence_report.json", size: 100, mtimeMs: 10 }]);
    vi.mocked(fetchArtifact).mockResolvedValueOnce({
      contentType: "application/json",
      text: JSON.stringify({
        status: "warn",
        checked_at: "not-a-date",
        failures: [],
        warnings: [],
        details: {
          canonical_characters: ["Dr. Ada", "Nurse Lee"],
          matched_story_characters: ["Dr. Ada", "Nurse Lee"],
          missing_story_characters: [],
          required_style_rules_checked: 4,
          required_style_rule_hits: 4,
          forbidden_style_hits: [],
          semantic_similarity: {
            closest_run_id: "prev_run_2",
            score: 0.4,
            threshold: 0.82,
            retried: false
          }
        }
      })
    });

    render(
      <MemoryRouter initialEntries={["/runs/abc123"]}>
        <Routes>
          <Route path="/runs/:runId" element={<RunViewer />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("no canonical source files found")).toBeInTheDocument();
    expect(await screen.findByText("bad-start")).toBeInTheDocument();
    expect(await screen.findByText("bad-finish")).toBeInTheDocument();
    expect((await screen.findAllByText("not-a-date")).length).toBeGreaterThanOrEqual(1);
    expect(await screen.findByText(/Failures \(0\)/)).toBeInTheDocument();
    expect(await screen.findByText(/Warnings \(0\)/)).toBeInTheDocument();
    expect(await screen.findAllByText("none")).toHaveLength(2);
    expect(await screen.findByText(/Semantic repetition guard/i)).toBeInTheDocument();
    expect(await screen.findByText(/^no$/i)).toBeInTheDocument();
  });

  it("surfaces non-Error artifact fetch failures", async () => {
    const user = userEvent.setup();
    vi.mocked(listArtifacts).mockResolvedValueOnce([{ name: "notes.txt", size: 1, mtimeMs: 1 }]);
    vi.mocked(fetchArtifact).mockRejectedValueOnce("nope");

    render(
      <MemoryRouter initialEntries={["/runs/abc123"]}>
        <Routes>
          <Route path="/runs/:runId" element={<RunViewer />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("Artifacts")).toBeInTheDocument();
    await user.click(screen.getByText("notes.txt"));
    expect(await screen.findByText(/nope/)).toBeInTheDocument();
  });

  it("can cancel a running run and logs the request", async () => {
    const user = userEvent.setup();
    vi.mocked(getRun).mockResolvedValueOnce({
      runId: "abc123",
      topic: "topic",
      status: "running",
      startedAt: "2026-02-09T00:00:00.000Z",
      outputFolder: "output/abc123",
      traceId: "trace_test",
      steps: makeSteps("running")
    });

    render(
      <MemoryRouter initialEntries={["/runs/abc123"]}>
        <Routes>
          <Route path="/runs/:runId" element={<RunViewer />} />
        </Routes>
      </MemoryRouter>
    );

    const cancelBtn = await screen.findByRole("button", { name: "Cancel run" });
    expect(cancelBtn).toBeEnabled();

    await user.click(cancelBtn);
    expect(cancelRun).toHaveBeenCalledWith("abc123");
    expect(await screen.findByText(/cancel requested/i)).toBeInTheDocument();
  });

  it("shows a watchdog alert for long-running steps", async () => {
    vi.mocked(getRun).mockResolvedValueOnce({
      runId: "abc123",
      topic: "topic",
      status: "running",
      startedAt: "2026-02-09T00:00:00.000Z",
      outputFolder: "output/abc123",
      traceId: "trace_test",
      steps: {
        ...makeSteps("queued"),
        J: {
          name: "J",
          status: "running",
          startedAt: "2026-02-09T00:00:00.000Z",
          artifacts: []
        }
      }
    });

    render(
      <MemoryRouter initialEntries={["/runs/abc123"]}>
        <Routes>
          <Route path="/runs/:runId" element={<RunViewer />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText(/^Watchdog$/)).toBeInTheDocument();
    expect(await screen.findByText(/J running/i)).toBeInTheDocument();
  });

  it("allows configuring the watchdog threshold from run settings UI", async () => {
    const startedAt = new Date(Date.now() - 120_000).toISOString();
    vi.mocked(getRun).mockResolvedValueOnce({
      runId: "abc123",
      topic: "topic",
      status: "running",
      startedAt: "2026-02-09T00:00:00.000Z",
      outputFolder: "output/abc123",
      traceId: "trace_test",
      steps: {
        ...makeSteps("queued"),
        J: {
          name: "J",
          status: "running",
          startedAt,
          artifacts: []
        }
      }
    });

    render(
      <MemoryRouter initialEntries={["/runs/abc123"]}>
        <Routes>
          <Route path="/runs/:runId" element={<RunViewer />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText(/^Watchdog$/)).toBeInTheDocument();
    const threshold = screen.getByLabelText("Watchdog threshold (seconds)");
    fireEvent.change(threshold, { target: { value: "900" } });

    await waitFor(() => expect(screen.queryByText(/^Watchdog$/)).not.toBeInTheDocument());
    expect(window.localStorage.getItem("mms_watchdog_threshold_seconds")).toBe("900");
  });

  it("shows explicit recovered status when a stuck step finishes", async () => {
    const running = {
      runId: "abc123",
      topic: "topic",
      status: "running" as const,
      startedAt: "2026-02-09T00:00:00.000Z",
      outputFolder: "output/abc123",
      traceId: "trace_test",
      steps: {
        ...makeSteps("queued"),
        J: {
          name: "J",
          status: "running" as const,
          startedAt: "2026-02-09T00:00:00.000Z",
          artifacts: []
        }
      }
    };
    const recovered = {
      ...running,
      status: "done" as const,
      steps: {
        ...running.steps,
        J: {
          name: "J",
          status: "done" as const,
          startedAt: "2026-02-09T00:00:00.000Z",
          finishedAt: "2026-02-09T00:03:00.000Z",
          artifacts: []
        }
      }
    };
    let calls = 0;
    vi.mocked(getRun).mockImplementation(async () => {
      calls += 1;
      return calls <= 1 ? running : recovered;
    });

    render(
      <MemoryRouter initialEntries={["/runs/abc123"]}>
        <Routes>
          <Route path="/runs/:runId" element={<RunViewer />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText(/^Watchdog$/)).toBeInTheDocument();
    const es = FakeEventSource.last;
    if (!es) throw new Error("missing EventSource instance");
    es.emit("step_finished", JSON.stringify({ step: "J", at: "2026-02-09T00:03:00.000Z", ok: true }));

    expect(await screen.findByText(/^Recovered$/)).toBeInTheDocument();
    expect(await screen.findByText(/J recovered after/i)).toBeInTheDocument();
    expect(await screen.findByText(/done \(recovered\)/i)).toBeInTheDocument();
  });

  it("resets watchdog threshold back to default from run metadata controls", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("mms_watchdog_threshold_seconds", "1200");
    const startedAt = new Date(Date.now() - 120_000).toISOString();
    vi.mocked(getRun).mockResolvedValueOnce({
      runId: "abc123",
      topic: "topic",
      status: "running",
      startedAt: "2026-02-09T00:00:00.000Z",
      outputFolder: "output/abc123",
      traceId: "trace_test",
      steps: {
        ...makeSteps("queued"),
        J: {
          name: "J",
          status: "running",
          startedAt,
          artifacts: []
        }
      }
    });

    render(
      <MemoryRouter initialEntries={["/runs/abc123"]}>
        <Routes>
          <Route path="/runs/:runId" element={<RunViewer />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("Run metadata")).toBeInTheDocument();
    expect(screen.queryByText(/^Watchdog$/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reset" }));

    expect(await screen.findByText(/^Watchdog$/)).toBeInTheDocument();
    expect(window.localStorage.getItem("mms_watchdog_threshold_seconds")).toBe("90");
  });

  it("allows changing rerun start step before rerunning", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/runs/abc123"]}>
        <Routes>
          <Route path="/runs/:runId" element={<RunViewer />} />
        </Routes>
      </MemoryRouter>
    );

    const rerunSelect = await screen.findByDisplayValue("KB0");
    await user.selectOptions(rerunSelect, "J");
    await user.click(screen.getByRole("button", { name: "Rerun" }));
    expect(rerunFrom).toHaveBeenLastCalledWith("abc123", "J");
  });

  it("closes the existing EventSource when the route runId changes", async () => {
    const user = userEvent.setup();
    vi.mocked(getRun).mockResolvedValue({
      runId: "abc123",
      topic: "topic",
      status: "done",
      startedAt: "2026-02-09T00:00:00.000Z",
      outputFolder: "output/abc123",
      traceId: "trace_test",
      steps: makeSteps("done")
    });

    render(
      <MemoryRouter initialEntries={["/runs/abc123"]}>
        <Routes>
          <Route
            path="/runs/:runId"
            element={
              <>
                <RouteNavButton />
                <RunViewer />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("Run metadata")).toBeInTheDocument();
    const firstEs = FakeEventSource.last;
    if (!firstEs) throw new Error("missing first EventSource");

    await user.click(screen.getByRole("button", { name: "go-run-2" }));
    expect(await screen.findByText("Run metadata")).toBeInTheDocument();
    expect(firstEs.closed).toBe(true);
  });

  it("sorts artifacts with run.json and trace.json at the top", async () => {
    vi.mocked(listArtifacts).mockResolvedValueOnce([
      { name: "notes.txt", size: 1, mtimeMs: 10 },
      { name: "trace.json", size: 2, mtimeMs: 5 },
      { name: "run.json", size: 3, mtimeMs: 6 }
    ]);

    render(
      <MemoryRouter initialEntries={["/runs/abc123"]}>
        <Routes>
          <Route path="/runs/:runId" element={<RunViewer />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("Artifacts")).toBeInTheDocument();

    const panel = screen.getByText("Artifacts").closest(".panel") as HTMLElement | null;
    if (!panel) throw new Error("missing artifacts panel");
    const buttons = within(panel).getAllByRole("button");
    const names = buttons.map((b) => b.textContent).filter(Boolean) as string[];
    // Artifact entries include the file names; run.json should appear before trace.json.
    const idxRun = names.findIndex((t) => t.includes("run.json"));
    const idxTrace = names.findIndex((t) => t.includes("trace.json"));
    expect(idxRun).toBeGreaterThanOrEqual(0);
    expect(idxTrace).toBeGreaterThanOrEqual(0);
    expect(idxRun).toBeLessThan(idxTrace);
  });

  it("filters artifacts by search text and folder", async () => {
    const user = userEvent.setup();
    vi.mocked(listArtifacts).mockResolvedValueOnce([
      { name: "run.json", size: 3, mtimeMs: 6, folder: "root" },
      { name: "GENSPARK_MASTER_RENDER_PLAN.md", size: 14, mtimeMs: 5, folder: "final" },
      { name: "GENSPARK_SLIDE_GUIDE.md", size: 10, mtimeMs: 4, folder: "final" },
      { name: "kb_context.md", size: 11, mtimeMs: 3, folder: "intermediate" }
    ]);

    render(
      <MemoryRouter initialEntries={["/runs/abc123"]}>
        <Routes>
          <Route path="/runs/:runId" element={<RunViewer />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("Artifacts")).toBeInTheDocument();

    const search = screen.getByLabelText("Artifact search");
    await user.type(search, "guide");
    expect(screen.getByText("GENSPARK_SLIDE_GUIDE.md")).toBeInTheDocument();
    expect(screen.queryByText("GENSPARK_MASTER_RENDER_PLAN.md")).not.toBeInTheDocument();
    expect(screen.queryByText("run.json")).not.toBeInTheDocument();

    await user.clear(search);
    await user.selectOptions(screen.getByLabelText("Artifact folder filter"), "root");
    expect(screen.getByText("run.json")).toBeInTheDocument();
    expect(screen.queryByText("GENSPARK_SLIDE_GUIDE.md")).not.toBeInTheDocument();
  });

  it("shows step SLO warning summary from run payload", async () => {
    vi.mocked(getRun).mockResolvedValueOnce({
      runId: "abc123",
      topic: "topic",
      status: "done",
      startedAt: "2026-02-09T00:00:00.000Z",
      finishedAt: "2026-02-09T00:10:00.000Z",
      outputFolder: "output/abc123",
      traceId: "trace_test",
      steps: makeSteps("done"),
      stepSlo: {
        warningSteps: ["J"],
        thresholdsMs: { J: 90_000 },
        evaluations: {
          J: { status: "warn", thresholdMs: 90_000, elapsedMs: 600_000 }
        }
      }
    });

    render(
      <MemoryRouter initialEntries={["/runs/abc123"]}>
        <Routes>
          <Route path="/runs/:runId" element={<RunViewer />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("Step SLO warnings")).toBeInTheDocument();
    expect(await screen.findByText(/J 10m 0s > 1m 30s/i)).toBeInTheDocument();
  });

  it("renders constraint diagnostics drilldown when adherence artifact is present", async () => {
    vi.mocked(listArtifacts).mockResolvedValueOnce([{ name: "constraint_adherence_report.json", size: 100, mtimeMs: 10 }]);
    vi.mocked(fetchArtifact).mockResolvedValueOnce({
      contentType: "application/json",
      text: JSON.stringify({
        status: "fail",
        checked_at: "2026-02-09T00:09:59.000Z",
        failures: ["No canonical character reused"],
        warnings: ["semantic similarity remains elevated"],
        details: {
          canonical_characters: ["Dr. Ada", "Nurse Lee"],
          matched_story_characters: ["Dr. Ada"],
          missing_story_characters: ["Nurse Lee"],
          required_style_rules_checked: 3,
          required_style_rule_hits: 1,
          forbidden_style_hits: ["avoid gore"],
          semantic_similarity: {
            closest_run_id: "prev_run_1",
            score: 0.88,
            threshold: 0.82,
            retried: true
          }
        }
      })
    });

    render(
      <MemoryRouter initialEntries={["/runs/abc123"]}>
        <Routes>
          <Route path="/runs/:runId" element={<RunViewer />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("Constraint diagnostics")).toBeInTheDocument();
    expect(await screen.findByText(/Failures \(1\)/)).toBeInTheDocument();
    expect(await screen.findByText(/No canonical character reused/)).toBeInTheDocument();
    expect(await screen.findByText(/semantic similarity remains elevated/)).toBeInTheDocument();
    expect(await screen.findByText(/closest run/i)).toBeInTheDocument();
    expect(await screen.findByText(/prev_run_1/)).toBeInTheDocument();
  });

  it("renders summary tabs and switches between narrative backbone and visual primer", async () => {
    const user = userEvent.setup();
    vi.mocked(listArtifacts).mockResolvedValueOnce([
      { name: "medical_narrative_flow.json", size: 100, mtimeMs: 10 },
      { name: "reusable_visual_primer.json", size: 120, mtimeMs: 11 }
    ]);
    vi.mocked(fetchArtifact).mockImplementation(async (_runId: string, name: string) => {
      if (name === "medical_narrative_flow.json") {
        return {
          contentType: "application/json",
          text: JSON.stringify({
            medical_narrative_flow: {
              chapter_summary: "Baseline to intervention flow.",
              progression: [
                {
                  stage: "Baseline",
                  medical_logic: "normal state",
                  key_teaching_points: ["normal state"],
                  story_implication: "peace before disruption"
                }
              ],
              metaphor_map: [],
              required_plot_events: ["evidence checkpoint"]
            }
          })
        };
      }
      if (name === "reusable_visual_primer.json") {
        return {
          contentType: "application/json",
          text: JSON.stringify({
            reusable_visual_primer: {
              character_descriptions: ["Dr. Ada profile"],
              recurring_scene_descriptions: ["Immune district HQ"],
              reusable_visual_elements: ["Evidence board"],
              continuity_rules: ["Keep style stable"]
            }
          })
        };
      }
      return { contentType: "text/plain", text: "ok" };
    });

    render(
      <MemoryRouter initialEntries={["/runs/abc123"]}>
        <Routes>
          <Route path="/runs/:runId" element={<RunViewer />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("Story + visual summaries")).toBeInTheDocument();
    expect(await screen.findByText(/Baseline to intervention flow\./)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reusable Visual Primer" }));
    expect(await screen.findByText(/Dr\. Ada profile/)).toBeInTheDocument();
    expect(await screen.findByText(/Evidence board/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Narrative Backbone" }));
    expect(await screen.findByText(/Required plot events/i)).toBeInTheDocument();
  });

  it("shows diagnostics parse errors when adherence artifact cannot be loaded", async () => {
    vi.mocked(listArtifacts).mockResolvedValueOnce([{ name: "constraint_adherence_report.json", size: 100, mtimeMs: 10 }]);
    vi.mocked(fetchArtifact).mockRejectedValueOnce("diag-oops");

    render(
      <MemoryRouter initialEntries={["/runs/abc123"]}>
        <Routes>
          <Route path="/runs/:runId" element={<RunViewer />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("Constraint diagnostics")).toBeInTheDocument();
    expect(await screen.findByText(/diag-oops/i)).toBeInTheDocument();
  });

  it("shows summary parse errors when narrative artifact JSON is invalid", async () => {
    vi.mocked(listArtifacts).mockResolvedValueOnce([{ name: "medical_narrative_flow.json", size: 100, mtimeMs: 10 }]);
    vi.mocked(fetchArtifact).mockImplementation(async (_runId: string, name: string) => {
      if (name === "medical_narrative_flow.json") {
        return { contentType: "application/json", text: "{bad-json" };
      }
      return { contentType: "text/plain", text: "ok" };
    });

    render(
      <MemoryRouter initialEntries={["/runs/abc123"]}>
        <Routes>
          <Route path="/runs/:runId" element={<RunViewer />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("Story + visual summaries")).toBeInTheDocument();
    expect(await screen.findByText(/Invalid JSON artifact/i)).toBeInTheDocument();
  });
});
