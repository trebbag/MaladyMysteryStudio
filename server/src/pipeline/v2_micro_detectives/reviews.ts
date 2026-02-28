import fs from "node:fs/promises";
import path from "node:path";
import { runIntermediateDirAbs, writeJsonFile } from "../utils.js";
import {
  HumanReviewEntrySchema,
  HumanReviewStoreSchema,
  V2_GATE_IDS,
  type HumanReviewEntry,
  type HumanReviewStore,
  type V2GateId
} from "./schemas.js";

const HUMAN_REVIEW_FILE = "human_review.json";

function emptyLatestByGate(): Record<V2GateId, HumanReviewEntry | null> {
  return Object.fromEntries(V2_GATE_IDS.map((gate) => [gate, null])) as Record<V2GateId, HumanReviewEntry | null>;
}

export function emptyHumanReviewStore(): HumanReviewStore {
  return {
    schema_version: "1.0.0",
    latest_by_gate: emptyLatestByGate(),
    history: []
  };
}

export function humanReviewFileName(): string {
  return HUMAN_REVIEW_FILE;
}

export function gateRequirementArtifactName(gateId: V2GateId): string {
  if (gateId === "GATE_1_PITCH") return "GATE_1_PITCH_REQUIRED.json";
  if (gateId === "GATE_2_TRUTH_LOCK") return "GATE_2_TRUTH_LOCK_REQUIRED.json";
  if (gateId === "GATE_3_STORYBOARD") return "GATE_3_STORYBOARD_REQUIRED.json";
  return "GATE_4_FINAL_REQUIRED.json";
}

export function gateOwningStep(gateId: V2GateId): "A" | "B" | "C" {
  if (gateId === "GATE_1_PITCH") return "A";
  if (gateId === "GATE_2_TRUTH_LOCK") return "B";
  return "C";
}

export async function readHumanReviewStore(runId: string): Promise<HumanReviewStore> {
  const filePath = path.join(runIntermediateDirAbs(runId), HUMAN_REVIEW_FILE);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return HumanReviewStoreSchema.parse(parsed);
  } catch {
    return emptyHumanReviewStore();
  }
}

export async function writeHumanReviewStore(runId: string, store: HumanReviewStore): Promise<void> {
  const filePath = path.join(runIntermediateDirAbs(runId), HUMAN_REVIEW_FILE);
  await writeJsonFile(filePath, HumanReviewStoreSchema.parse(store));
}

export async function appendHumanReview(runId: string, entryInput: unknown): Promise<HumanReviewStore> {
  const entry = HumanReviewEntrySchema.parse(entryInput);
  const current = await readHumanReviewStore(runId);
  const next: HumanReviewStore = {
    schema_version: current.schema_version || "1.0.0",
    latest_by_gate: {
      ...emptyLatestByGate(),
      ...current.latest_by_gate,
      [entry.gate_id]: entry
    },
    history: [...current.history, entry]
  };
  await writeHumanReviewStore(runId, next);
  return next;
}

export function latestGateDecision(store: HumanReviewStore, gateId: V2GateId): HumanReviewEntry | null {
  return store.latest_by_gate[gateId] ?? null;
}
