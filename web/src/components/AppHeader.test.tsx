import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Runs" })).toHaveAttribute("href", "/runs");
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

  it("toggles the mobile nav menu and closes it when a mobile nav link is clicked", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <MemoryRouter>
        <AppHeader health={null} healthErr={null} />
      </MemoryRouter>
    );

    const menuButton = screen.getByRole("button", { name: /open navigation/i });
    const mobileNav = container.querySelector(".headerMobileNav");
    expect(mobileNav).not.toHaveClass("headerMobileNavOpen");

    await user.click(menuButton);
    expect(screen.getByRole("button", { name: /close navigation/i })).toBeInTheDocument();
    expect(mobileNav).toHaveClass("headerMobileNavOpen");

    const mobileCaseBoardLink = screen.getAllByRole("link", { name: "Case Board" })[1];
    await user.click(mobileCaseBoardLink);
    expect(screen.getByRole("button", { name: /open navigation/i })).toBeInTheDocument();
    expect(mobileNav).not.toHaveClass("headerMobileNavOpen");
  });
});
