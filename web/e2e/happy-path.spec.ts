import { expect, test, type Page } from "@playwright/test";

type RunState = {
  runId?: string;
  status: "queued" | "running" | "paused" | "done" | "error";
  derivedFrom?: { runId: string; startFrom: string };
  steps: Record<string, { status: "queued" | "running" | "done" | "error" }>;
};

async function startRunFromHome(page: Page, topic: string): Promise<string> {
  await page.goto("/");
  await page.getByLabel("Topic").fill(topic);
  await page.getByRole("button", { name: "Run Episode" }).click();
  await expect(page).toHaveURL(/\/runs\/[A-Za-z0-9_-]+$/);
  await expect(page.locator(".runMetaCard .panelHeader").getByText("Run metadata")).toBeVisible();
  const runId = page.url().split("/runs/")[1] ?? "";
  expect(runId.length).toBeGreaterThan(0);
  return runId;
}

test("happy path with local backend fake pipeline", async ({ page, request }) => {
  const topic = `E2E fake pipeline ${Date.now()}`;

  const runId = await startRunFromHome(page, topic);

  // SSE stream is real in this test, so confirm logs are flowing.
  await expect(page.getByText(/SSE connected/)).toBeVisible({ timeout: 15000 });

  await expect
    .poll(
      async () => {
        const res = await request.get(`/api/runs/${encodeURIComponent(runId)}`);
        expect(res.ok()).toBeTruthy();
        const body = (await res.json()) as RunState;
        return body.status;
      },
      { timeout: 20_000 }
    )
    .toBe("done");

  await expect
    .poll(
      async () => {
        const res = await request.get(`/api/runs/${encodeURIComponent(runId)}`);
        expect(res.ok()).toBeTruthy();
        const body = (await res.json()) as RunState;
        return body.steps.O?.status;
      },
      { timeout: 20_000 }
    )
    .toBe("done");

  await expect
    .poll(
      async () => {
        const res = await request.get(`/api/runs/${encodeURIComponent(runId)}/artifacts`);
        expect(res.ok()).toBeTruthy();
        const artifacts = (await res.json()) as Array<{ name: string }>;
        const names = new Set(artifacts.map((a) => a.name));
        return (
          names.has("GENSPARK_ASSET_BIBLE.md") &&
          names.has("GENSPARK_SLIDE_GUIDE.md") &&
          names.has("GENSPARK_BUILD_SCRIPT.txt") &&
          names.has("trace.json")
        );
      },
      { timeout: 20_000 }
    )
    .toBe(true);

  await page.getByRole("button", { name: /GENSPARK_ASSET_BIBLE\.md/i }).click();
  await expect(page.getByText("Genspark Asset Bible")).toBeVisible();

  const exportLink = page.getByRole("link", { name: "Export zip" });
  await expect(exportLink).toHaveAttribute("href", `/api/runs/${runId}/export`);

  const zipRes = await request.get(`/api/runs/${encodeURIComponent(runId)}/export`);
  expect(zipRes.ok()).toBeTruthy();
  expect(String(zipRes.headers()["content-type"])).toContain("application/zip");
});

test("rerun-from-step flow with real fake backend", async ({ page, request }) => {
  const parentRunId = await startRunFromHome(page, `E2E rerun parent ${Date.now()}`);
  const parentUrl = page.url();

  await expect
    .poll(
      async () => {
        const res = await request.get(`/api/runs/${encodeURIComponent(parentRunId)}`);
        expect(res.ok()).toBeTruthy();
        const body = (await res.json()) as RunState;
        return body.status;
      },
      { timeout: 20_000 }
    )
    .toBe("done");

  await expect(page.locator(".runSummaryCard .badge").filter({ hasText: /^done$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Rerun" })).toBeEnabled();
  await page.getByLabel("Rerun start step").selectOption("J");
  const rerunResPromise = page.waitForResponse(
    (res) => res.url().includes(`/api/runs/${encodeURIComponent(parentRunId)}/rerun`) && res.request().method() === "POST",
    { timeout: 10_000 }
  );
  await page.getByRole("button", { name: "Rerun" }).click();
  const rerunRes = await rerunResPromise;
  expect(rerunRes.ok()).toBeTruthy();
  const rerunPayload = (await rerunRes.json()) as { runId: string };
  expect(rerunPayload.runId.length).toBeGreaterThan(0);

  await expect.poll(() => page.url()).not.toBe(parentUrl);
  await expect.poll(() => page.url()).toContain(`/runs/${rerunPayload.runId}`);
  const childRunId = page.url().split("/runs/")[1] ?? "";
  expect(childRunId).toBe(rerunPayload.runId);

  await expect
    .poll(
      async () => {
        const res = await request.get(`/api/runs/${encodeURIComponent(childRunId)}`);
        expect(res.ok()).toBeTruthy();
        const body = (await res.json()) as RunState;
        return body.status;
      },
      { timeout: 20_000 }
    )
    .toBe("done");

  const childRunRes = await request.get(`/api/runs/${encodeURIComponent(childRunId)}`);
  expect(childRunRes.ok()).toBeTruthy();
  const childRun = (await childRunRes.json()) as RunState;
  expect(childRun.derivedFrom?.runId).toBe(parentRunId);
  expect(childRun.derivedFrom?.startFrom).toBe("J");
});

test("cancel flow with real fake backend", async ({ page, request }) => {
  const runId = await startRunFromHome(page, `E2E cancel ${Date.now()}`);

  await expect
    .poll(
      async () => {
        const res = await request.get(`/api/runs/${encodeURIComponent(runId)}`);
        expect(res.ok()).toBeTruthy();
        const body = (await res.json()) as RunState;
        return body.status;
      },
      { timeout: 20_000 }
    )
    .toBe("running");

  const cancelButton = page.getByRole("button", { name: "Cancel run" });
  await expect(cancelButton).toBeEnabled();
  await cancelButton.click();

  await expect
    .poll(
      async () => {
        const res = await request.get(`/api/runs/${encodeURIComponent(runId)}`);
        expect(res.ok()).toBeTruthy();
        const body = (await res.json()) as RunState;
        return body.status;
      },
      { timeout: 20_000 }
    )
    .toBe("error");

  await expect
    .poll(
      async () => {
        const res = await request.get(`/api/runs/${encodeURIComponent(runId)}/artifacts`);
        expect(res.ok()).toBeTruthy();
        const artifacts = (await res.json()) as Array<{ name: string }>;
        return artifacts.some((a) => a.name === "CANCELLED.txt");
      },
      { timeout: 20_000 }
    )
    .toBe(true);
});

test("v2 workflow run pauses at gates and resumes to final deck spec artifacts", async ({ page, request }) => {
  await page.goto("/");
  const topic = `E2E v2 workflow ${Date.now()}`;
  await page.getByLabel("Topic").fill(topic);

  const workflowSelect = page.locator(".settingsRow > div").filter({ hasText: "Workflow" }).locator("select");
  await workflowSelect.selectOption("v2_micro_detectives");

  const deckLengthSelect = page.locator(".settingsRow > div").filter({ hasText: "Deck length (main)" }).locator("select");
  await deckLengthSelect.selectOption("30");
  const audienceSelect = page.locator(".settingsRow > div").filter({ hasText: "Audience" }).locator("select");
  await audienceSelect.selectOption("RESIDENT");

  await page.getByRole("button", { name: "Run Episode" }).click();
  await expect(page).toHaveURL(/\/runs\/[A-Za-z0-9_-]+$/);
  const runId = page.url().split("/runs/")[1] ?? "";
  expect(runId.length).toBeGreaterThan(0);

  await expect
    .poll(
      async () => {
        const res = await request.get(`/api/runs/${encodeURIComponent(runId)}`);
        expect(res.ok()).toBeTruthy();
        const body = (await res.json()) as RunState;
        return body.status;
      },
      { timeout: 20_000 }
    )
    .toBe("paused");

  let gateRes = await request.post(`/api/runs/${encodeURIComponent(runId)}/gates/GATE_1_PITCH/submit`, {
    data: { status: "approve", requested_changes: [] }
  });
  expect(gateRes.ok()).toBeTruthy();
  let resumeRes = await request.post(`/api/runs/${encodeURIComponent(runId)}/resume`);
  expect(resumeRes.ok()).toBeTruthy();

  await expect
    .poll(
      async () => {
        const res = await request.get(`/api/runs/${encodeURIComponent(runId)}`);
        expect(res.ok()).toBeTruthy();
        const body = (await res.json()) as RunState;
        return body.status;
      },
      { timeout: 20_000 }
    )
    .toBe("paused");

  gateRes = await request.post(`/api/runs/${encodeURIComponent(runId)}/gates/GATE_2_TRUTH_LOCK/submit`, {
    data: { status: "approve", requested_changes: [] }
  });
  expect(gateRes.ok()).toBeTruthy();
  resumeRes = await request.post(`/api/runs/${encodeURIComponent(runId)}/resume`);
  expect(resumeRes.ok()).toBeTruthy();

  await expect
    .poll(
      async () => {
        const res = await request.get(`/api/runs/${encodeURIComponent(runId)}`);
        expect(res.ok()).toBeTruthy();
        const body = (await res.json()) as RunState;
        return body.status;
      },
      { timeout: 20_000 }
    )
    .toBe("paused");

  gateRes = await request.post(`/api/runs/${encodeURIComponent(runId)}/gates/GATE_3_STORYBOARD/submit`, {
    data: { status: "approve", requested_changes: [] }
  });
  expect(gateRes.ok()).toBeTruthy();
  resumeRes = await request.post(`/api/runs/${encodeURIComponent(runId)}/resume`);
  expect(resumeRes.ok()).toBeTruthy();

  await expect
    .poll(
      async () => {
        const res = await request.get(`/api/runs/${encodeURIComponent(runId)}`);
        expect(res.ok()).toBeTruthy();
        const body = (await res.json()) as RunState;
        return body.status;
      },
      { timeout: 20_000 }
    )
    .toBe("done");

  const runRes = await request.get(`/api/runs/${encodeURIComponent(runId)}`);
  expect(runRes.ok()).toBeTruthy();
  const runBody = (await runRes.json()) as RunState & { settings?: { workflow?: string; deckLengthMain?: number } };
  expect(runBody.settings?.workflow).toBe("v2_micro_detectives");
  expect(runBody.settings?.deckLengthMain).toBe(30);
  expect(runBody.steps.C?.status).toBe("done");
  expect(runBody.steps.D?.status).toBe("queued");

  await expect
    .poll(
      async () => {
        const res = await request.get(`/api/runs/${encodeURIComponent(runId)}/artifacts`);
        expect(res.ok()).toBeTruthy();
        const artifacts = (await res.json()) as Array<{ name: string }>;
        const names = new Set(artifacts.map((a) => a.name));
        return (
          names.has("disease_dossier.json") &&
          names.has("episode_pitch.json") &&
          names.has("truth_model.json") &&
          names.has("deck_spec.json") &&
          names.has("deck_spec_lint_report.json") &&
          names.has("differential_cast.json") &&
          names.has("clue_graph.json") &&
          names.has("reader_sim_report.json") &&
          names.has("med_factcheck_report.json") &&
          names.has("qa_report.json") &&
          names.has("citation_traceability.json") &&
          names.has("GATE_1_PITCH_REQUIRED.json") &&
          names.has("GATE_2_TRUTH_LOCK_REQUIRED.json") &&
          names.has("GATE_3_STORYBOARD_REQUIRED.json") &&
          names.has("micro_world_map.json") &&
          names.has("drama_plan.json") &&
          names.has("setpiece_plan.json") &&
          names.has("V2_MAIN_DECK_RENDER_PLAN.md") &&
          names.has("V2_APPENDIX_RENDER_PLAN.md") &&
          names.has("V2_SPEAKER_NOTES_WITH_CITATIONS.md") &&
          names.has("trace.json")
        );
      },
      { timeout: 20_000 }
    )
    .toBe(true);

  await expect(page.getByText("Storyboard review required")).toBeVisible();
});

test("v2 fake fallback path records fallback_usage and still packages final outputs", async ({ request }) => {
  const topic = `E2E v2 force fallback ${Date.now()} FORCE_FALLBACK`;
  const createRes = await request.post("/api/runs", {
    data: {
      topic,
      settings: {
        workflow: "v2_micro_detectives",
        deckLengthMain: 30,
        audienceLevel: "RESIDENT",
        adherenceMode: "warn"
      }
    }
  });
  expect(createRes.ok()).toBeTruthy();
  const createBody = (await createRes.json()) as { runId: string };
  const runId = createBody.runId;
  expect(runId.length).toBeGreaterThan(0);

  await expect
    .poll(
      async () => {
        const res = await request.get(`/api/runs/${encodeURIComponent(runId)}`);
        expect(res.ok()).toBeTruthy();
        const body = (await res.json()) as RunState;
        return body.status;
      },
      { timeout: 20_000 }
    )
    .toBe("paused");
  let gateRes = await request.post(`/api/runs/${encodeURIComponent(runId)}/gates/GATE_1_PITCH/submit`, {
    data: { status: "approve", requested_changes: [] }
  });
  expect(gateRes.ok()).toBeTruthy();
  let resumeRes = await request.post(`/api/runs/${encodeURIComponent(runId)}/resume`);
  expect(resumeRes.ok()).toBeTruthy();

  await expect
    .poll(
      async () => {
        const res = await request.get(`/api/runs/${encodeURIComponent(runId)}`);
        expect(res.ok()).toBeTruthy();
        const body = (await res.json()) as RunState;
        return body.status;
      },
      { timeout: 20_000 }
    )
    .toBe("paused");
  gateRes = await request.post(`/api/runs/${encodeURIComponent(runId)}/gates/GATE_2_TRUTH_LOCK/submit`, {
    data: { status: "approve", requested_changes: [] }
  });
  expect(gateRes.ok()).toBeTruthy();
  resumeRes = await request.post(`/api/runs/${encodeURIComponent(runId)}/resume`);
  expect(resumeRes.ok()).toBeTruthy();

  await expect
    .poll(
      async () => {
        const res = await request.get(`/api/runs/${encodeURIComponent(runId)}`);
        expect(res.ok()).toBeTruthy();
        const body = (await res.json()) as RunState;
        return body.status;
      },
      { timeout: 20_000 }
    )
    .toBe("paused");
  gateRes = await request.post(`/api/runs/${encodeURIComponent(runId)}/gates/GATE_3_STORYBOARD/submit`, {
    data: { status: "approve", requested_changes: [] }
  });
  expect(gateRes.ok()).toBeTruthy();
  resumeRes = await request.post(`/api/runs/${encodeURIComponent(runId)}/resume`);
  expect(resumeRes.ok()).toBeTruthy();

  await expect
    .poll(
      async () => {
        const res = await request.get(`/api/runs/${encodeURIComponent(runId)}`);
        expect(res.ok()).toBeTruthy();
        const body = (await res.json()) as RunState;
        return body.status;
      },
      { timeout: 20_000 }
    )
    .toBe("done");

  const fallbackRes = await request.get(`/api/runs/${encodeURIComponent(runId)}/artifacts/fallback_usage.json`);
  expect(fallbackRes.ok()).toBeTruthy();
  const fallbackUsage = (await fallbackRes.json()) as { used: boolean; fallback_event_count: number };
  expect(fallbackUsage.used).toBe(true);
  expect(fallbackUsage.fallback_event_count).toBeGreaterThan(0);

  const artifactsRes = await request.get(`/api/runs/${encodeURIComponent(runId)}/artifacts`);
  expect(artifactsRes.ok()).toBeTruthy();
  const artifacts = (await artifactsRes.json()) as Array<{ name: string }>;
  const names = new Set(artifacts.map((a) => a.name));
  expect(names.has("deck_spec.json")).toBe(true);
  expect(names.has("V2_MAIN_DECK_RENDER_PLAN.md")).toBe(true);
  expect(names.has("V2_APPENDIX_RENDER_PLAN.md")).toBe(true);
  expect(names.has("V2_SPEAKER_NOTES_WITH_CITATIONS.md")).toBe(true);
});
