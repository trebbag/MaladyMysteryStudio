import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AppHeader from "./AppHeader";

describe("AppHeader", () => {
  it("renders only branding when health and healthErr are absent", () => {
    render(
      <MemoryRouter>
        <AppHeader health={null} healthErr={null} />
      </MemoryRouter>
    );

    expect(screen.getByRole("link", { name: "Malady Mystery Studio" })).toHaveAttribute("href", "/");
    expect(screen.queryByText(/health:/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/health error:/i)).not.toBeInTheDocument();
  });

  it("renders a ready health badge when key and vector store are configured", () => {
    render(
      <MemoryRouter>
        <AppHeader health={{ ok: true, hasKey: true, hasVectorStoreId: true }} healthErr={null} />
      </MemoryRouter>
    );

    const badge = screen.getByText(/health: ok/i);
    expect(badge).toHaveClass("badgeOk");
    expect(badge).toHaveTextContent("key: yes");
    expect(badge).toHaveTextContent("vs: yes");
  });

  it("renders degraded health and error badges", () => {
    render(
      <MemoryRouter>
        <AppHeader health={{ ok: false, hasKey: false, hasVectorStoreId: false }} healthErr={"network down"} />
      </MemoryRouter>
    );

    const badge = screen.getByText(/health: bad/i);
    expect(badge).toHaveClass("badgeErr");
    expect(badge).toHaveTextContent("key: no");
    expect(badge).toHaveTextContent("vs: no");
    expect(screen.getByText(/health error: network down/i)).toBeInTheDocument();
  });
});

