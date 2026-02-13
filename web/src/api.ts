export type HealthResponse = {
  ok: boolean;
  hasKey: boolean;
  hasVectorStoreId: boolean;
  hasCanonicalProfileFiles?: boolean;
  canonicalTemplateRoot?: string;
  episodeMemoryPath?: string;
};

export type RunSettings = {
  durationMinutes?: number;
  targetSlides?: number;
  level?: "pcp" | "student";
  adherenceMode?: "strict" | "warn";
};

export type RunDerivedFrom = {
  runId: string;
  startFrom: string;
  createdAt: string;
};

export type StepStatus = {
  name: string;
  status: "queued" | "running" | "done" | "error";
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  artifacts: string[];
};

export type RunStatus = {
  runId: string;
  topic: string;
  settings?: RunSettings;
  derivedFrom?: RunDerivedFrom;
  canonicalSources?: {
    foundAny: boolean;
    templateRoot?: string;
    characterBiblePath?: string;
    seriesStyleBiblePath?: string;
    deckSpecPath?: string;
  };
  constraintAdherence?: {
    status: "pass" | "warn" | "fail";
    failureCount: number;
    warningCount: number;
    checkedAt: string;
  };
  status: "queued" | "running" | "done" | "error";
  startedAt: string;
  finishedAt?: string;
  traceId?: string;
  outputFolder: string;
  steps: Record<string, StepStatus>;
  stepSlo?: {
    warningSteps: string[];
    thresholdsMs: Record<string, number>;
    evaluations: Record<
      string,
      {
        status: "n/a" | "ok" | "warn";
        thresholdMs: number;
        elapsedMs: number | null;
      }
    >;
  };
};

export type RunListItem = {
  runId: string;
  topic: string;
  status: RunStatus["status"];
  startedAt: string;
  finishedAt?: string;
};

export type ArtifactInfo = {
  name: string;
  size: number;
  mtimeMs: number;
  folder?: "root" | "intermediate" | "final";
};

export type RunStorageRecord = {
  runId: string;
  topic: string;
  status: RunStatus["status"];
  startedAt: string;
  finishedAt?: string;
  ageHours: number;
  sizeBytes: number;
};

export type RunRetentionAnalytics = {
  generatedAt: string;
  totalSizeBytes: number;
  terminalSizeBytes: number;
  activeSizeBytes: number;
  perRun: RunStorageRecord[];
  ageBuckets: Record<
    "lt_24h" | "between_1d_7d" | "between_7d_30d" | "gte_30d",
    {
      count: number;
      sizeBytes: number;
    }
  >;
};

export type RunRetentionResponse = {
  policy: {
    keepLastTerminalRuns: number;
  };
  stats: {
    totalRuns: number;
    terminalRuns: number;
    activeRuns: number;
  };
  analytics: RunRetentionAnalytics;
};

export type CleanupRunsResponse = {
  keepLast: number;
  dryRun: boolean;
  scannedTerminalRuns: number;
  keptRunIds: string[];
  deletedRunIds: string[];
  reclaimedBytes: number;
  deletedRuns: RunStorageRecord[];
  stats: {
    totalRuns: number;
    terminalRuns: number;
    activeRuns: number;
  };
  analytics: RunRetentionAnalytics;
};

export type StepSloPolicyResponse = {
  policy: {
    thresholdsMs: Record<string, number>;
    updatedAt: string;
  };
  bounds: {
    minMs: number;
    maxMs: number;
  };
  defaults: Record<string, number>;
};

async function httpJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {})
    }
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText}${text ? `: ${text}` : ""}`);
  }
  return (await res.json()) as T;
}

export async function getHealth(): Promise<HealthResponse> {
  return httpJson<HealthResponse>("/api/health");
}

export async function createRun(topic: string, settings?: RunSettings): Promise<{ runId: string }> {
  return httpJson<{ runId: string }>("/api/runs", {
    method: "POST",
    body: JSON.stringify({ topic, settings })
  });
}

export async function listRuns(): Promise<RunListItem[]> {
  return httpJson<RunListItem[]>("/api/runs");
}

export async function getRunRetention(): Promise<RunRetentionResponse> {
  return httpJson<RunRetentionResponse>("/api/runs/retention");
}

export async function cleanupRuns(keepLast: number, dryRun: boolean): Promise<CleanupRunsResponse> {
  return httpJson<CleanupRunsResponse>("/api/runs/cleanup", {
    method: "POST",
    body: JSON.stringify({ keepLast, dryRun })
  });
}

export async function getSloPolicy(): Promise<StepSloPolicyResponse> {
  return httpJson<StepSloPolicyResponse>("/api/slo-policy");
}

export async function updateSloPolicy(payload: {
  reset?: boolean;
  thresholdsMs?: Partial<Record<string, number>>;
}): Promise<StepSloPolicyResponse> {
  return httpJson<StepSloPolicyResponse>("/api/slo-policy", {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export async function getRun(runId: string): Promise<RunStatus> {
  return httpJson<RunStatus>(`/api/runs/${encodeURIComponent(runId)}`);
}

export async function cancelRun(runId: string): Promise<{ ok: true }> {
  return httpJson<{ ok: true }>(`/api/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" });
}

export async function rerunFrom(runId: string, startFrom: string): Promise<{ runId: string }> {
  return httpJson<{ runId: string }>(`/api/runs/${encodeURIComponent(runId)}/rerun`, {
    method: "POST",
    body: JSON.stringify({ startFrom })
  });
}

export function sseUrl(runId: string): string {
  return `/api/runs/${encodeURIComponent(runId)}/events`;
}

export function exportZipUrl(runId: string): string {
  return `/api/runs/${encodeURIComponent(runId)}/export`;
}

export async function listArtifacts(runId: string): Promise<ArtifactInfo[]> {
  return httpJson<ArtifactInfo[]>(`/api/runs/${encodeURIComponent(runId)}/artifacts`);
}

export async function fetchArtifact(runId: string, name: string): Promise<{ text: string; contentType: string }> {
  const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(name)}`);
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText}${t ? `: ${t}` : ""}`);
  }
  const contentType = res.headers.get("content-type") || "text/plain";
  const text = await res.text();
  return { text, contentType };
}
