import { expect, test, type Page } from "@playwright/test";

type RunState = {
  status: "queued" | "running" | "done" | "error";
};

async function startRunFromHome(page: Page, topic: string): Promise<string> {
  await page.goto("/");
  await page.getByLabel("Topic").fill(topic);
  await page.getByRole("button", { name: "Run Episode" }).click();
  await expect(page).toHaveURL(/\/runs\/[A-Za-z0-9_-]+$/);
  const runId = page.url().split("/runs/")[1] ?? "";
  expect(runId.length).toBeGreaterThan(0);
  return runId;
}

test("soak: completes 5 sequential episodes and keeps artifact APIs responsive", async ({ page, request }) => {
  test.setTimeout(120_000);
  const runIds: string[] = [];

  for (let i = 0; i < 5; i += 1) {
    const runId = await startRunFromHome(page, `E2E soak ${Date.now()} #${i + 1}`);
    runIds.push(runId);

    await expect(page.getByText(/SSE connected/i)).toBeVisible({ timeout: 12_000 });

    await expect
      .poll(
        async () => {
          const res = await request.get(`/api/runs/${encodeURIComponent(runId)}`);
          expect(res.ok()).toBeTruthy();
          const body = (await res.json()) as RunState;
          return body.status;
        },
        { timeout: 30_000 }
      )
      .toBe("done");

    await expect
      .poll(async () => {
        const res = await request.get(`/api/runs/${encodeURIComponent(runId)}/artifacts`);
        expect(res.ok()).toBeTruthy();
        const artifacts = (await res.json()) as Array<{ name: string }>;
        const names = new Set(artifacts.map((a) => a.name));
        return names.has("trace.json") && names.has("final_slide_spec_patched.json");
      })
      .toBe(true);
  }

  const listRes = await request.get("/api/runs");
  expect(listRes.ok()).toBeTruthy();
  const listed = (await listRes.json()) as Array<{ runId: string }>;
  const listedIds = new Set(listed.map((r) => r.runId));
  for (const runId of runIds) {
    expect(listedIds.has(runId)).toBe(true);
  }
});

