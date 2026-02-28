import { nowIso } from "../utils.js";
import type { DiseaseDossier } from "./schemas.js";

type CitationOccurrence = {
  artifact: string;
  json_path: string;
  citation_id: string;
  claim?: string;
  locator?: string;
  chunk_id?: string;
};

export type CitationTraceabilityReport = {
  schema_version: string;
  generated_at: string;
  known_citation_ids: string[];
  total_references: number;
  unique_reference_ids: number;
  citations: Array<{
    citation_id: string;
    occurrence_count: number;
    artifacts: string[];
    claims: string[];
    locators: string[];
    chunk_ids: string[];
  }>;
  unresolved_references: Array<{
    citation_id: string;
    artifact: string;
    json_path: string;
    reason: string;
  }>;
};

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter((v) => v.trim().length > 0))].sort((a, b) => a.localeCompare(b));
}

function scanCitations(value: unknown, artifact: string, pathPrefix = "$"): CitationOccurrence[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, idx) => scanCitations(item, artifact, `${pathPrefix}[${idx}]`));
  }

  if (!value || typeof value !== "object") return [];
  const rec = value as Record<string, unknown>;
  const own: CitationOccurrence[] = [];

  if (typeof rec.citation_id === "string" && rec.citation_id.trim().length > 0) {
    own.push({
      artifact,
      json_path: pathPrefix,
      citation_id: rec.citation_id.trim(),
      claim: typeof rec.claim === "string" ? rec.claim.trim() : undefined,
      locator: typeof rec.locator === "string" ? rec.locator.trim() : undefined,
      chunk_id: typeof rec.chunk_id === "string" ? rec.chunk_id.trim() : undefined
    });
  }

  for (const [key, next] of Object.entries(rec)) {
    own.push(...scanCitations(next, artifact, `${pathPrefix}.${key}`));
  }
  return own;
}

function knownCitationIdsFromDossier(dossier: DiseaseDossier): string[] {
  return uniqueSorted((dossier.citations ?? []).map((c) => c.citation_id));
}

export function buildCitationTraceabilityReport(input: {
  dossier: DiseaseDossier;
  artifacts: Record<string, unknown>;
}): CitationTraceabilityReport {
  const knownIds = new Set(knownCitationIdsFromDossier(input.dossier));
  const occurrences = Object.entries(input.artifacts).flatMap(([artifact, value]) => scanCitations(value, artifact));

  const byId = new Map<string, CitationOccurrence[]>();
  for (const occ of occurrences) {
    const list = byId.get(occ.citation_id) ?? [];
    list.push(occ);
    byId.set(occ.citation_id, list);
  }

  const citations = [...byId.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([citationId, refs]) => ({
      citation_id: citationId,
      occurrence_count: refs.length,
      artifacts: uniqueSorted(refs.map((r) => r.artifact)),
      claims: uniqueSorted(refs.map((r) => r.claim ?? "")),
      locators: uniqueSorted(refs.map((r) => r.locator ?? "")),
      chunk_ids: uniqueSorted(refs.map((r) => r.chunk_id ?? ""))
    }));

  const unresolved = occurrences
    .filter((occ) => !knownIds.has(occ.citation_id))
    .map((occ) => ({
      citation_id: occ.citation_id,
      artifact: occ.artifact,
      json_path: occ.json_path,
      reason: "citation_id not present in disease_dossier.citations"
    }));

  return {
    schema_version: "1.0.0",
    generated_at: nowIso(),
    known_citation_ids: [...knownIds].sort((a, b) => a.localeCompare(b)),
    total_references: occurrences.length,
    unique_reference_ids: byId.size,
    citations,
    unresolved_references: unresolved
  };
}

