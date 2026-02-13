import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("./components/ChatStart", () => {
  return { default: () => <div>chat start</div> };
});

vi.mock("./components/RunViewer", () => {
  return { default: () => <div>run viewer</div> };
});

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return {
    ...actual,
    getHealth: vi.fn(async () => ({ ok: true, hasKey: true, hasVectorStoreId: true }))
  };
});

import { getHealth } from "./api";
import App from "./App";

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders health badge and home route", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByText("chat start")).toBeInTheDocument();
    expect(await screen.findByText(/health: ok/i)).toBeInTheDocument();
    expect(getHealth).toHaveBeenCalled();
  });

  it("renders run route and refetches health when location changes", async () => {
    render(
      <MemoryRouter initialEntries={["/runs/abc"]}>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByText("run viewer")).toBeInTheDocument();
    expect(getHealth).toHaveBeenCalled();
  });

  it("renders a health error badge on failure", async () => {
    vi.mocked(getHealth).mockRejectedValueOnce(new Error("boom"));
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByText(/health error: boom/i)).toBeInTheDocument();
  });

  it("renders a badgeErr when health is not fully configured", async () => {
    vi.mocked(getHealth).mockResolvedValueOnce({ ok: true, hasKey: false, hasVectorStoreId: true });
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>
    );

    const badge = await screen.findByText(/health: ok/i);
    expect(badge).toHaveClass("badgeErr");
    expect(badge).toHaveTextContent("key: no");
  });

  it("renders a health error badge for non-Error throws", async () => {
    vi.mocked(getHealth).mockRejectedValueOnce("nope");
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByText(/health error: nope/i)).toBeInTheDocument();
  });

  it("does not update health state when unmounted before a late success", async () => {
    let resolveHealth!: (value: { ok: boolean; hasKey: boolean; hasVectorStoreId: boolean }) => void;
    vi.mocked(getHealth).mockImplementationOnce(
      async () =>
        await new Promise((resolve) => {
          resolveHealth = resolve;
        })
    );

    const { unmount } = render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>
    );

    expect(getHealth).toHaveBeenCalledTimes(1);
    unmount();
    resolveHealth({ ok: true, hasKey: true, hasVectorStoreId: true });
    await Promise.resolve();
    expect(screen.queryByText(/health: ok/i)).not.toBeInTheDocument();
  });

  it("does not update healthErr state when unmounted before a late failure", async () => {
    let rejectHealth!: (reason?: unknown) => void;
    vi.mocked(getHealth).mockImplementationOnce(
      async () =>
        await new Promise((_resolve, reject) => {
          rejectHealth = reject;
        })
    );

    const { unmount } = render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>
    );

    expect(getHealth).toHaveBeenCalledTimes(1);
    unmount();
    rejectHealth("late-failure");
    await Promise.resolve();
    expect(screen.queryByText(/health error:/i)).not.toBeInTheDocument();
  });
});
