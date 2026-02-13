import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ChatStart from "./ChatStart";

vi.mock("../api", () => {
  return {
    createRun: vi.fn(async () => ({ runId: "r1" })),
    listRuns: vi.fn(async () => []),
    getRunRetention: vi.fn(async () => ({
      policy: { keepLastTerminalRuns: 50 },
      stats: { totalRuns: 0, terminalRuns: 0, activeRuns: 0 },
      analytics: {
        generatedAt: "2026-02-11T00:00:00.000Z",
        totalSizeBytes: 0,
        terminalSizeBytes: 0,
        activeSizeBytes: 0,
        perRun: [],
        ageBuckets: {
          lt_24h: { count: 0, sizeBytes: 0 },
          between_1d_7d: { count: 0, sizeBytes: 0 },
          between_7d_30d: { count: 0, sizeBytes: 0 },
          gte_30d: { count: 0, sizeBytes: 0 }
        }
      }
    })),
    cleanupRuns: vi.fn(async () => ({
      keepLast: 50,
      dryRun: true,
      scannedTerminalRuns: 0,
      keptRunIds: [],
      deletedRunIds: [],
      reclaimedBytes: 0,
      deletedRuns: [],
      stats: { totalRuns: 0, terminalRuns: 0, activeRuns: 0 },
      analytics: {
        generatedAt: "2026-02-11T00:00:00.000Z",
        totalSizeBytes: 0,
        terminalSizeBytes: 0,
        activeSizeBytes: 0,
        perRun: [],
        ageBuckets: {
          lt_24h: { count: 0, sizeBytes: 0 },
          between_1d_7d: { count: 0, sizeBytes: 0 },
          between_7d_30d: { count: 0, sizeBytes: 0 },
          gte_30d: { count: 0, sizeBytes: 0 }
        }
      }
    })),
    getSloPolicy: vi.fn(async () => ({
      policy: {
        thresholdsMs: {
          KB0: 180000,
          A: 90000,
          B: 240000,
          C: 120000,
          D: 120000,
          E: 120000,
          F: 120000,
          G: 150000,
          H: 180000,
          I: 150000,
          J: 90000,
          K: 90000,
          L: 180000,
          M: 120000,
          N: 120000,
          O: 90000
        },
        updatedAt: "2026-02-11T00:00:00.000Z"
      },
      bounds: { minMs: 5000, maxMs: 1800000 },
      defaults: {
        KB0: 180000,
        A: 90000,
        B: 240000,
        C: 120000,
        D: 120000,
        E: 120000,
        F: 120000,
        G: 150000,
        H: 180000,
        I: 150000,
        J: 90000,
        K: 90000,
        L: 180000,
        M: 120000,
        N: 120000,
        O: 90000
      }
    })),
    updateSloPolicy: vi.fn(async () => ({
      policy: {
        thresholdsMs: {
          KB0: 180000,
          A: 90000,
          B: 240000,
          C: 120000,
          D: 120000,
          E: 120000,
          F: 120000,
          G: 150000,
          H: 180000,
          I: 150000,
          J: 90000,
          K: 90000,
          L: 180000,
          M: 120000,
          N: 120000,
          O: 90000
        },
        updatedAt: "2026-02-11T00:00:00.000Z"
      },
      bounds: { minMs: 5000, maxMs: 1800000 },
      defaults: {
        KB0: 180000,
        A: 90000,
        B: 240000,
        C: 120000,
        D: 120000,
        E: 120000,
        F: 120000,
        G: 150000,
        H: 180000,
        I: 150000,
        J: 90000,
        K: 90000,
        L: 180000,
        M: 120000,
        N: 120000,
        O: 90000
      }
    }))
  };
});

import { cleanupRuns, createRun, getRunRetention, getSloPolicy, listRuns, updateSloPolicy } from "../api";

describe("ChatStart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("disables Run Episode until the topic is at least 3 chars", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<ChatStart />} />
        </Routes>
      </MemoryRouter>
    );

    const runBtn = screen.getByRole("button", { name: "Run Episode" });
    expect(runBtn).toBeDisabled();

    await user.type(screen.getByPlaceholderText(/Example:/), "ab");
    expect(runBtn).toBeDisabled();

    await user.type(screen.getByPlaceholderText(/Example:/), "c");
    expect(runBtn).toBeEnabled();
  });

  it("starts a run with settings and navigates to run viewer", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<ChatStart />} />
          <Route path="/runs/:runId" element={<div>run viewer</div>} />
        </Routes>
      </MemoryRouter>
    );

    await user.type(screen.getByPlaceholderText(/Example:/), "DKA management");
    await user.type(screen.getByPlaceholderText("e.g. 20"), "25");
    await user.type(screen.getByPlaceholderText("e.g. 12"), "10");
    await user.selectOptions(screen.getByDisplayValue("Student"), "pcp");

    await user.click(screen.getByRole("button", { name: "Run Episode" }));

    expect(createRun).toHaveBeenCalledWith("DKA management", {
      durationMinutes: 25,
      targetSlides: 10,
      level: "pcp",
      adherenceMode: "strict"
    });
    expect(await screen.findByText("run viewer")).toBeInTheDocument();
  });

  it("omits invalid numeric settings and keeps the default level", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<ChatStart />} />
          <Route path="/runs/:runId" element={<div>run viewer</div>} />
        </Routes>
      </MemoryRouter>
    );

    await user.type(screen.getByPlaceholderText(/Example:/), "DKA management");
    await user.type(screen.getByPlaceholderText("e.g. 20"), "0");
    await user.type(screen.getByPlaceholderText("e.g. 12"), "-5");
    await user.click(screen.getByRole("button", { name: "Run Episode" }));

    expect(createRun).toHaveBeenCalledWith("DKA management", { level: "student", adherenceMode: "strict" });
  });

  it("allows warn-only adherence mode", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<ChatStart />} />
          <Route path="/runs/:runId" element={<div>run viewer</div>} />
        </Routes>
      </MemoryRouter>
    );

    await user.type(screen.getByPlaceholderText(/Example:/), "DKA management");
    await user.selectOptions(screen.getByDisplayValue("Strict (block on fail)"), "warn");
    await user.click(screen.getByRole("button", { name: "Run Episode" }));

    expect(createRun).toHaveBeenCalledWith("DKA management", { level: "student", adherenceMode: "warn" });
  });

  it("shows an error when createRun fails (non-Error throw)", async () => {
    vi.mocked(createRun).mockRejectedValueOnce("nope");
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<ChatStart />} />
        </Routes>
      </MemoryRouter>
    );

    await user.type(screen.getByPlaceholderText(/Example:/), "DKA management");
    await user.click(screen.getByRole("button", { name: "Run Episode" }));

    expect(await screen.findByText(/nope/)).toBeInTheDocument();
  });

  it("renders recent runs and refreshes the list", async () => {
    vi.mocked(listRuns).mockResolvedValueOnce([
      { runId: "r1", topic: "t1", status: "done", startedAt: "s1" },
      { runId: "r2", topic: "t2", status: "error", startedAt: "s2" },
      { runId: "r3", topic: "t3", status: "running", startedAt: "s3" }
    ]);
    vi.mocked(listRuns).mockResolvedValueOnce([
      { runId: "r4", topic: "t4", status: "done", startedAt: "s4" }
    ]);

    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<ChatStart />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("t1")).toBeInTheDocument();
    expect(screen.getByText("t2")).toBeInTheDocument();
    expect(screen.getByText("t3")).toBeInTheDocument();

    const runningBadge = screen.getByText("running");
    expect(runningBadge).not.toHaveClass("badgeOk");
    expect(runningBadge).not.toHaveClass("badgeErr");

    await user.click(screen.getByRole("button", { name: "Refresh" }));
    expect(listRuns).toHaveBeenCalledTimes(2);
    expect(await screen.findByText("t4")).toBeInTheDocument();
  });

  it("ignores failures when loading recent runs", async () => {
    vi.mocked(listRuns).mockRejectedValueOnce(new Error("nope"));

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<ChatStart />} />
        </Routes>
      </MemoryRouter>
    );

    // Should still render without surfacing listRuns errors.
    expect(await screen.findByText(/Recent runs/i)).toBeInTheDocument();
  });

  it("pressing Enter in the topic input starts a run", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<ChatStart />} />
          <Route path="/runs/:runId" element={<div>run viewer</div>} />
        </Routes>
      </MemoryRouter>
    );

    const input = screen.getByPlaceholderText(/Example:/);
    await user.type(input, "DKA management{Enter}");
    expect(createRun).toHaveBeenCalled();
  });

  it("does not set state after unmount while loading recent runs", async () => {
    let resolve!: (value: Array<{ runId: string; topic: string; status: "done"; startedAt: string }>) => void;
    vi.mocked(listRuns).mockImplementationOnce(
      async () =>
        await new Promise((res) => {
          resolve = res;
        })
    );

    const { unmount } = render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<ChatStart />} />
        </Routes>
      </MemoryRouter>
    );

    expect(listRuns).toHaveBeenCalledTimes(1);
    unmount();
    resolve([{ runId: "r1", topic: "t1", status: "done", startedAt: "s1" }]);

    // Let microtasks flush; the test passes if no state-update-on-unmounted warnings occur.
    await Promise.resolve();
  });

  it("renders system status badges from the health prop", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route
            path="/"
            element={<ChatStart health={{ ok: true, hasKey: false, hasVectorStoreId: true, hasCanonicalProfileFiles: false }} />}
          />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("Missing")).toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
  });

  it("loads retention policy and allows cleanup preview + delete", async () => {
    const user = userEvent.setup();
    vi.mocked(cleanupRuns)
      .mockResolvedValueOnce({
        keepLast: 10,
        dryRun: true,
        scannedTerminalRuns: 12,
        keptRunIds: ["r11", "r12"],
        deletedRunIds: ["r1"],
        reclaimedBytes: 1024,
        deletedRuns: [],
        stats: { totalRuns: 12, terminalRuns: 11, activeRuns: 1 },
        analytics: {
          generatedAt: "2026-02-11T00:00:00.000Z",
          totalSizeBytes: 3000,
          terminalSizeBytes: 2000,
          activeSizeBytes: 1000,
          perRun: [],
          ageBuckets: {
            lt_24h: { count: 1, sizeBytes: 1000 },
            between_1d_7d: { count: 1, sizeBytes: 1000 },
            between_7d_30d: { count: 1, sizeBytes: 1000 },
            gte_30d: { count: 0, sizeBytes: 0 }
          }
        }
      })
      .mockResolvedValueOnce({
        keepLast: 10,
        dryRun: false,
        scannedTerminalRuns: 12,
        keptRunIds: ["r11", "r12"],
        deletedRunIds: ["r1"],
        reclaimedBytes: 1024,
        deletedRuns: [],
        stats: { totalRuns: 11, terminalRuns: 10, activeRuns: 1 },
        analytics: {
          generatedAt: "2026-02-11T00:00:00.000Z",
          totalSizeBytes: 2000,
          terminalSizeBytes: 1000,
          activeSizeBytes: 1000,
          perRun: [],
          ageBuckets: {
            lt_24h: { count: 1, sizeBytes: 1000 },
            between_1d_7d: { count: 1, sizeBytes: 1000 },
            between_7d_30d: { count: 0, sizeBytes: 0 },
            gte_30d: { count: 0, sizeBytes: 0 }
          }
        }
      });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<ChatStart />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByDisplayValue("50")).toBeInTheDocument();
    expect(getRunRetention).toHaveBeenCalledTimes(1);

    const input = screen.getByLabelText("Keep latest terminal runs");
    await user.clear(input);
    await user.type(input, "10");
    await user.click(screen.getByRole("button", { name: "Preview cleanup" }));
    expect(cleanupRuns).toHaveBeenCalledWith(10, true);
    expect(await screen.findByText(/would delete 1 terminal run/i)).toBeInTheDocument();
    expect(await screen.findByText(/Reclaim 1.00 KB/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete old runs" }));
    expect(cleanupRuns).toHaveBeenCalledWith(10, false);
    expect(await screen.findByText(/Deleted 1 terminal run/i)).toBeInTheDocument();
    expect(await screen.findByText(/reclaimed 1.00 KB/i)).toBeInTheDocument();
  });

  it("shows cleanup errors", async () => {
    const user = userEvent.setup();
    vi.mocked(cleanupRuns).mockRejectedValueOnce("cleanup failed");

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<ChatStart />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText(/Recent runs/i);
    await user.click(screen.getByRole("button", { name: "Preview cleanup" }));
    expect(await screen.findByText(/cleanup failed/i)).toBeInTheDocument();
  });

  it("renders retention analytics cards and largest run links", async () => {
    vi.mocked(getRunRetention).mockResolvedValueOnce({
      policy: { keepLastTerminalRuns: 12 },
      stats: { totalRuns: 2, terminalRuns: 2, activeRuns: 0 },
      analytics: {
        generatedAt: "2026-02-11T00:00:00.000Z",
        totalSizeBytes: 4096,
        terminalSizeBytes: 4096,
        activeSizeBytes: 0,
        perRun: [
          {
            runId: "abc123",
            topic: "run 1",
            status: "done",
            startedAt: "2026-02-10T00:00:00.000Z",
            ageHours: 36,
            sizeBytes: 3072
          },
          {
            runId: "xyz789",
            topic: "run 2",
            status: "error",
            startedAt: "2026-02-09T00:00:00.000Z",
            ageHours: 48,
            sizeBytes: 1024
          }
        ],
        ageBuckets: {
          lt_24h: { count: 0, sizeBytes: 0 },
          between_1d_7d: { count: 2, sizeBytes: 4096 },
          between_7d_30d: { count: 0, sizeBytes: 0 },
          gte_30d: { count: 0, sizeBytes: 0 }
        }
      }
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<ChatStart />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText(/Total disk/i)).toBeInTheDocument();
    expect((await screen.findAllByText(/4.00 KB/i)).length).toBeGreaterThanOrEqual(1);
    expect(await screen.findByText(/1-7d: 2/i)).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "abc123" })).toHaveAttribute("href", "/runs/abc123");
  });

  it("saves and resets SLO policy from the home panel", async () => {
    const user = userEvent.setup();

    vi.mocked(updateSloPolicy)
      .mockResolvedValueOnce({
        policy: {
          thresholdsMs: {
            KB0: 180000,
            A: 110000,
            B: 240000,
            C: 120000,
            D: 120000,
            E: 120000,
            F: 120000,
            G: 150000,
            H: 180000,
            I: 150000,
            J: 90000,
            K: 90000,
            L: 180000,
            M: 120000,
            N: 120000,
            O: 90000
          },
          updatedAt: "2026-02-11T00:00:00.000Z"
        },
        bounds: { minMs: 5000, maxMs: 1800000 },
        defaults: {}
      })
      .mockResolvedValueOnce({
        policy: {
          thresholdsMs: {
            KB0: 180000,
            A: 90000,
            B: 240000,
            C: 120000,
            D: 120000,
            E: 120000,
            F: 120000,
            G: 150000,
            H: 180000,
            I: 150000,
            J: 90000,
            K: 90000,
            L: 180000,
            M: 120000,
            N: 120000,
            O: 90000
          },
          updatedAt: "2026-02-11T00:00:01.000Z"
        },
        bounds: { minMs: 5000, maxMs: 1800000 },
        defaults: {}
      });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<ChatStart />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("Step SLO policy")).toBeInTheDocument();
    expect(getSloPolicy).toHaveBeenCalledTimes(1);

    const aInput = screen.getByLabelText("A");
    await user.clear(aInput);
    await user.type(aInput, "110000");
    await user.click(screen.getByRole("button", { name: "Save policy" }));

    expect(updateSloPolicy).toHaveBeenCalledWith(
      expect.objectContaining({
        thresholdsMs: expect.objectContaining({ A: 110000 })
      })
    );
    expect(await screen.findByText(/policy saved/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reset defaults" }));
    expect(updateSloPolicy).toHaveBeenLastCalledWith({ reset: true });
    expect(await screen.findByText(/reset to defaults/i)).toBeInTheDocument();
  });

  it("shows slo policy load/save errors", async () => {
    const user = userEvent.setup();
    vi.mocked(getSloPolicy).mockRejectedValueOnce("slo load failed");
    vi.mocked(updateSloPolicy).mockRejectedValueOnce("slo save failed");

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<ChatStart />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText(/slo load failed/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save policy" }));
    expect(await screen.findByText(/slo save failed/i)).toBeInTheDocument();
  });
});
