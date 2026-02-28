import { describe, expect, it } from "vitest";
import { generateDiseaseDossier } from "../src/pipeline/v2_micro_detectives/phase2_generator.js";
import { buildCitationTraceabilityReport } from "../src/pipeline/v2_micro_detectives/citation_traceability.js";

describe("v2 citation traceability", () => {
  it("indexes citation references and flags unresolved ids", () => {
    const dossier = generateDiseaseDossier({
      topic: "COPD",
      audienceLevel: "RESIDENT",
      deckLengthMain: 45,
      kbContext: "## Medical / Clinical KB\n- source notes"
    });

    const report = buildCitationTraceabilityReport({
      dossier,
      artifacts: {
        test_a: {
          citations: [{ citation_id: dossier.citations[0]!.citation_id, claim: "valid claim" }]
        },
        test_b: {
          citations: [{ citation_id: "CIT-NOT-IN-DOSSIER", claim: "unknown claim" }]
        }
      }
    });

    expect(report.total_references).toBe(2);
    expect(report.unique_reference_ids).toBe(2);
    expect(report.citations.some((c) => c.citation_id === dossier.citations[0]!.citation_id)).toBe(true);
    expect(report.unresolved_references.some((r) => r.citation_id === "CIT-NOT-IN-DOSSIER")).toBe(true);
  });
});

