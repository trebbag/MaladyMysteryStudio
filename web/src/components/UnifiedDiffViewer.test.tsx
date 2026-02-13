import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import UnifiedDiffViewer from "./UnifiedDiffViewer";

describe("UnifiedDiffViewer", () => {
  it("adds classes for hunk/add/del lines", () => {
    render(<UnifiedDiffViewer diff={"--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new\n"} />);

    expect(screen.getByText("@@ -1 +1 @@").className).toContain("diffHunk");
    expect(screen.getByText("+new").className).toContain("diffAdd");
    expect(screen.getByText("-old").className).toContain("diffDel");
  });
});

