import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ArtifactList from "./ArtifactList";

describe("ArtifactList", () => {
  it("renders an empty state when there are no artifacts", () => {
    render(<ArtifactList artifacts={[]} selected={null} onSelect={() => undefined} />);
    expect(screen.getByText(/No artifacts yet/i)).toBeInTheDocument();
  });

  it("calls onSelect when an item is clicked", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <ArtifactList
        artifacts={[
          { name: "a.json", size: 10, mtimeMs: 1 },
          { name: "b.md", size: 20, mtimeMs: 2 }
        ]}
        selected={"a.json"}
        onSelect={onSelect}
      />
    );

    await user.click(screen.getByText("b.md"));
    expect(onSelect).toHaveBeenCalledWith("b.md");
  });

  it("calls onSelect when an item is focused and Enter is pressed", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <ArtifactList
        artifacts={[{ name: "a.json", size: 10, mtimeMs: 1 }]}
        selected={null}
        onSelect={onSelect}
      />
    );

    const item = screen.getByText("a.json").closest("[role=\"button\"]") as HTMLElement | null;
    expect(item).toBeTruthy();
    item?.focus();
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith("a.json");
  });

  it("does not call onSelect for non-Enter keys", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <ArtifactList
        artifacts={[{ name: "a.json", size: 10, mtimeMs: 1 }]}
        selected={null}
        onSelect={onSelect}
      />
    );

    const item = screen.getByText("a.json").closest("[role=\"button\"]") as HTMLElement | null;
    expect(item).toBeTruthy();
    item?.focus();
    await user.keyboard("{Escape}");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("renders file-type icons and age labels across all ranges", () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000_000);

    render(
      <ArtifactList
        artifacts={[
          { name: "x.json", size: 100, mtimeMs: 999_990 }, // just now
          { name: "y.md", size: 120, mtimeMs: 700_000 }, // 5m ago
          { name: "z.txt", size: 130, mtimeMs: 1_000_000 - 2 * 60 * 60 * 1000 }, // 2h ago
          { name: "w.log", size: 140, mtimeMs: 1_000_000 - 3 * 24 * 60 * 60 * 1000 } // 3d ago
        ]}
        selected={null}
        onSelect={() => undefined}
      />
    );

    expect(screen.getByText("just now")).toBeInTheDocument();
    expect(screen.getByText("5m ago")).toBeInTheDocument();
    expect(screen.getByText("2h ago")).toBeInTheDocument();
    expect(screen.getByText("3d ago")).toBeInTheDocument();

    // JSON/MD/TXT icon branches.
    expect(screen.getByText("{}")).toBeInTheDocument();
    expect(screen.getByText("MD")).toBeInTheDocument();
    expect(screen.getAllByText("TXT").length).toBeGreaterThanOrEqual(1);

    nowSpy.mockRestore();
  });

  it("groups artifacts by folder and shows folder labels", () => {
    render(
      <ArtifactList
        artifacts={[
          { name: "run.json", size: 100, mtimeMs: 1, folder: "root" },
          { name: "GENSPARK_ASSET_BIBLE.md", size: 120, mtimeMs: 2, folder: "final" },
          { name: "kb_context.md", size: 140, mtimeMs: 3, folder: "intermediate" }
        ]}
        selected={null}
        onSelect={() => undefined}
      />
    );

    const titles = Array.from(document.querySelectorAll(".artifactGroupTitle")).map((el) => el.textContent?.trim());
    expect(titles).toEqual(["Run metadata", "Final products", "Intermediate artifacts"]);

    expect(screen.getByText("run.json")).toBeInTheDocument();
    expect(screen.getByText("GENSPARK_ASSET_BIBLE.md")).toBeInTheDocument();
    expect(screen.getByText("kb_context.md")).toBeInTheDocument();
    expect(screen.getByText("root")).toBeInTheDocument();
    expect(screen.getByText("final")).toBeInTheDocument();
    expect(screen.getByText("intermediate")).toBeInTheDocument();
  });
});
