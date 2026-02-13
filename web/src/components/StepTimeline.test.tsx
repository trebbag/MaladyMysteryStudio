import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import StepTimeline from "./StepTimeline";

describe("StepTimeline", () => {
  it("renders all steps and uses correct status labels", () => {
    render(
      <StepTimeline
        steps={{
          KB0: { name: "KB0", status: "done", artifacts: ["kb_context.md"] },
          A: { name: "A", status: "running", artifacts: [] },
          B: { name: "B", status: "queued", artifacts: [] },
          C: { name: "C", status: "error", artifacts: [], error: "boom" }
        }}
      />
    );

    expect(screen.getByText("KB0")).toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
    expect(screen.getByText("C")).toBeInTheDocument();

    // Spot-check status text
    expect(screen.getAllByText("done").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("running").length).toBeGreaterThanOrEqual(1);
  });

  it("marks long-running steps as stuck when above the watchdog threshold", () => {
    const now = Date.parse("2026-02-11T12:10:00.000Z");
    render(
      <StepTimeline
        nowMs={now}
        stuckThresholdMs={30_000}
        steps={{
          A: {
            name: "A",
            status: "running",
            startedAt: "2026-02-11T12:08:30.000Z",
            artifacts: []
          }
        }}
      />
    );

    expect(screen.getByText(/Possible stall at A/i)).toBeInTheDocument();
    expect(screen.getByText(/running \(stuck\)/i)).toBeInTheDocument();
  });

  it("shows recovered state when a previously stuck step has resumed", () => {
    render(
      <StepTimeline
        recoveredSteps={["J"]}
        steps={{
          J: {
            name: "J",
            status: "done",
            artifacts: []
          }
        }}
      />
    );

    expect(screen.getByText(/Recovered after stall at J/i)).toBeInTheDocument();
    expect(screen.getByText(/done \(recovered\)/i)).toBeInTheDocument();
  });

  it("shows SLO warning state for slow steps", () => {
    render(
      <StepTimeline
        slowSteps={["L"]}
        steps={{
          L: {
            name: "L",
            status: "done",
            artifacts: []
          }
        }}
      />
    );

    expect(screen.getByText(/SLO warning at L/i)).toBeInTheDocument();
    expect(screen.getByText(/done \(slow\)/i)).toBeInTheDocument();
  });
});
