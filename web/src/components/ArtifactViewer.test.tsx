import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ArtifactViewer from "./ArtifactViewer";

describe("ArtifactViewer", () => {
  it("pretty prints JSON", () => {
    render(<ArtifactViewer name="x.json" content='{"a":1}' />);
    expect(screen.getByText(/"a": 1/)).toBeInTheDocument();
  });

  it("falls back to raw text when JSON is invalid", () => {
    render(<ArtifactViewer name="x.json" content="{not json" />);
    expect(screen.getByText("{not json")).toBeInTheDocument();
  });

  it("renders markdown", () => {
    render(<ArtifactViewer name="x.md" content={"# Title\n\n- item"} />);
    expect(screen.getByRole("heading", { name: "Title" })).toBeInTheDocument();
    expect(screen.getByText("item")).toBeInTheDocument();
  });

  it("renders plain text for non-json/non-md", () => {
    render(<ArtifactViewer name="x.txt" content={"hello"} />);
    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  it("copies normalized content and resets the copied state", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true
    });

    render(<ArtifactViewer name="x.json" content='{"a":1}' />);

    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith('{\n  "a": 1\n}');
    await waitFor(() => expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument());
  });
});
