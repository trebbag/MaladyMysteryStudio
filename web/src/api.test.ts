import { describe, expect, it, vi } from "vitest";
import {
  cancelRun,
  cleanupRuns,
  createRun,
  exportZipUrl,
  fetchArtifact,
  getGateHistory,
  getHealth,
  getSloPolicy,
  getRunRetention,
  getRun,
  listArtifacts,
  listRuns,
  resumeRun,
  rerunFrom,
  submitGateReview,
  updateSloPolicy,
  sseUrl
} from "./api";

describe("api", () => {
  it("builds an SSE url", () => {
    expect(sseUrl("abc123")).toBe("/api/runs/abc123/events");
  });

  it("builds an export zip url", () => {
    expect(exportZipUrl("abc123")).toBe("/api/runs/abc123/export");
  });

  it("POST /api/runs sends topic + settings", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
      return new Response(JSON.stringify({ runId: "r1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    await createRun("My topic", { durationMinutes: 20, targetSlides: 12, level: "student", adherenceMode: "strict" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    expect(call).toBeTruthy();
    const [url, init] = call as unknown as [string, RequestInit];
    expect(url).toBe("/api/runs");
    expect(init.method).toBe("POST");
    expect(String(init.body)).toContain("My topic");
    expect(String(init.body)).toContain("durationMinutes");
    expect(String(init.body)).toContain("adherenceMode");
  });

  it("GET /api/health fetches health status", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ ok: true, hasKey: true, hasVectorStoreId: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const h = await getHealth();
    expect(h.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("/api/health", expect.anything());
  });

  it("GET /api/runs lists runs", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify([{ runId: "r1", topic: "t", status: "done", startedAt: "s" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const r = await listRuns();
    expect(r[0]?.runId).toBe("r1");
    expect(fetchMock).toHaveBeenCalledWith("/api/runs", expect.anything());
  });

  it("GET /api/runs/retention fetches retention policy + stats", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          policy: { keepLastTerminalRuns: 25 },
          stats: { totalRuns: 10, terminalRuns: 8, activeRuns: 2 },
          analytics: {
            generatedAt: "2026-02-11T00:00:00.000Z",
            totalSizeBytes: 1234,
            terminalSizeBytes: 1000,
            activeSizeBytes: 234,
            ageBuckets: {
              lt_24h: { count: 1, sizeBytes: 100 },
              between_1d_7d: { count: 2, sizeBytes: 200 },
              between_7d_30d: { count: 3, sizeBytes: 300 },
              gte_30d: { count: 4, sizeBytes: 400 }
            },
            perRun: []
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const retention = await getRunRetention();
    expect(retention.policy.keepLastTerminalRuns).toBe(25);
    expect(fetchMock).toHaveBeenCalledWith("/api/runs/retention", expect.anything());
  });

  it("POST /api/runs/cleanup sends keepLast + dryRun", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          keepLast: 10,
          dryRun: true,
          scannedTerminalRuns: 12,
          keptRunIds: ["a"],
          deletedRunIds: ["b"],
          reclaimedBytes: 1024,
          deletedRuns: [],
          stats: { totalRuns: 11, terminalRuns: 10, activeRuns: 1 },
          analytics: {
            generatedAt: "2026-02-11T00:00:00.000Z",
            totalSizeBytes: 1234,
            terminalSizeBytes: 1000,
            activeSizeBytes: 234,
            ageBuckets: {
              lt_24h: { count: 1, sizeBytes: 100 },
              between_1d_7d: { count: 2, sizeBytes: 200 },
              between_7d_30d: { count: 3, sizeBytes: 300 },
              gte_30d: { count: 4, sizeBytes: 400 }
            },
            perRun: []
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const res = await cleanupRuns(10, true);
    expect(res.dryRun).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/runs/cleanup");
    expect(init.method).toBe("POST");
    expect(String(init.body)).toContain("\"keepLast\":10");
    expect(String(init.body)).toContain("\"dryRun\":true");
  });

  it("GET /api/slo-policy fetches persisted thresholds", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          policy: { thresholdsMs: { A: 1000 }, updatedAt: "2026-02-11T00:00:00.000Z" },
          bounds: { minMs: 5000, maxMs: 1800000 },
          defaults: { A: 90000 }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const policy = await getSloPolicy();
    expect(policy.policy.thresholdsMs.A).toBe(1000);
    expect(fetchMock).toHaveBeenCalledWith("/api/slo-policy", expect.anything());
  });

  it("PUT /api/slo-policy updates overrides", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          policy: { thresholdsMs: { A: 11000 }, updatedAt: "2026-02-11T00:00:00.000Z" },
          bounds: { minMs: 5000, maxMs: 1800000 },
          defaults: { A: 90000 }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const policy = await updateSloPolicy({ thresholdsMs: { A: 11_000 } });
    expect(policy.policy.thresholdsMs.A).toBe(11000);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/slo-policy");
    expect(init.method).toBe("PUT");
    expect(String(init.body)).toContain("\"A\":11000");
  });

  it("GET /api/runs/:runId fetches a run (URI-encoded)", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
      return new Response(JSON.stringify({ runId: "a/b", topic: "t", status: "done", startedAt: "s", outputFolder: "o", steps: {} }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const r = await getRun("a/b");
    expect(r.runId).toBe("a/b");
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/api/runs/a%2Fb");
  });

  it("POST /api/runs/:runId/cancel cancels a run", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    await cancelRun("r1");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/runs/r1/cancel");
    expect(init.method).toBe("POST");
  });

  it("POST /api/runs/:runId/rerun sends startFrom", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ runId: "child" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    await rerunFrom("parent", "M");
    const call = fetchMock.mock.calls[0];
    expect(call).toBeTruthy();
    const [_url, init] = call as unknown as [string, RequestInit];
    expect(String(init.body)).toContain("\"startFrom\":\"M\"");
  });

  it("POST /api/runs/:runId/gates/:gateId/submit sends gate decision", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ ok: true, gateId: "GATE_1_PITCH", recommendedAction: "resume" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    await submitGateReview("r1", "GATE_1_PITCH", { status: "approve", notes: "ok", requested_changes: [] });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/runs/r1/gates/GATE_1_PITCH/submit");
    expect(init.method).toBe("POST");
    expect(String(init.body)).toContain("\"status\":\"approve\"");
  });

  it("POST /api/runs/:runId/resume resumes paused run", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ ok: true, runId: "r1", startFrom: "B", resumeMode: "regenerate" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const res = await resumeRun("r1");
    expect(res.ok).toBe(true);
    expect(res.startFrom).toBe("B");
    expect(res.resumeMode).toBe("regenerate");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/runs/r1/resume");
    expect(init.method).toBe("POST");
  });

  it("GET /api/runs/:runId/gates/history fetches gate review history", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          schema_version: "1.0.0",
          latest_by_gate: { GATE_1_PITCH: null },
          history: []
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const history = await getGateHistory("r1");
    expect(history.schema_version).toBe("1.0.0");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/runs/r1/gates/history");
    expect(init.method).toBeUndefined();
  });

  it("GET /api/runs/:runId/artifacts lists artifacts", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
      return new Response(JSON.stringify([{ name: "run.json", size: 10, mtimeMs: 1 }]), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const a = await listArtifacts("r1");
    expect(a[0]?.name).toBe("run.json");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/runs/r1/artifacts");
  });

  it("fetchArtifact returns text + contentType", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response("{\"ok\":true}", {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" }
      });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const res = await fetchArtifact("r1", "run.json");
    expect(res.contentType).toContain("application/json");
    expect(res.text).toContain("\"ok\":true");
  });

  it("fetchArtifact throws on non-2xx responses (includes body text when available)", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response("nope", { status: 404, statusText: "Not Found" });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    await expect(fetchArtifact("r1", "missing.json")).rejects.toThrow(/HTTP 404 Not Found: nope/);
  });

  it("fetchArtifact throws on non-2xx responses (no body text)", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response("", { status: 404, statusText: "Not Found" });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    await expect(fetchArtifact("r1", "missing.json")).rejects.toThrow(/HTTP 404 Not Found$/);
  });

  it("fetchArtifact defaults contentType to text/plain when missing", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response("hi", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const res = await fetchArtifact("r1", "notes.txt");
    expect(res.contentType).toContain("text/plain");
    expect(res.text).toBe("hi");
  });

  it("throws a useful error on non-2xx responses", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response("nope", { status: 500, statusText: "Internal Server Error" });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    await expect(createRun("t")).rejects.toThrow(/HTTP 500/);
  });

  it("throws a useful error on non-2xx responses even when body is empty", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response("", { status: 500, statusText: "Internal Server Error" });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    await expect(getHealth()).rejects.toThrow(/HTTP 500 Internal Server Error$/);
  });
});
