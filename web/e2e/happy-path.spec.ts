import { expect, test, type Page } from "@playwright/test";

type RunState = {
  runId?: string;
  status: "queued" | "running" | "done" | "error";
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
