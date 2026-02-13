# Malady Mystery Studio

Local dev web app that runs a multi-agent pipeline (KB0 -> A -> ... -> P) using the OpenAI Agents SDK, streams progress live via SSE, and persists all run artifacts under `output/<runId>/`.

## Prereqs

- Node.js >= 20.19.0 (or >= 22.12.0)
- An OpenAI API key
- A Vector Store ID (for KB0 file search) like `vs_...`

## Setup

```bash
npm install
cp .env.example .env
# edit .env and set OPENAI_API_KEY and KB_VECTOR_STORE_ID
# optional: set MAX_CONCURRENT_RUNS (default 1)
# optional: set MMS_RUN_RETENTION_KEEP_LAST (default 50 terminal runs kept by cleanup policy)
# optional: set MMS_MODEL (default gpt-5.2)
# optional: set MMS_CANON_ROOT to override built-in canon folder
# optional: set explicit MMS_*_PATH overrides for individual files
# optional: set MMS_PIPELINE_MODE=fake for deterministic local test runs
# optional: tune MMS_FAKE_STEP_DELAY_MS (default 80) for fake pipeline pacing
```

### Canonical story/style files (recommended)

The app now includes canonical story/style files in-repo at:

- `data/canon/character_bible.md`
- `data/canon/series_style_bible.md`
- `data/canon/episode/deck_spec.md`
- `data/canon/episode/episode_memory.json` (read/write; updated each run)

So you do not need to keep a `Downloads` folder copy.  
If you want a different canon pack, set `MMS_CANON_ROOT` to another folder with the same structure.

### Creating a vector store (for `KB_VECTOR_STORE_ID`)

KB0 uses OpenAI File Search against a vector store. Create one in the OpenAI Platform Storage UI, upload your KB documents, then copy the Vector Store ID (looks like `vs_...`) into `.env`.

## Run (dev)

From repo root:

```bash
npm run dev
```

- Server: http://localhost:5050
- Web UI (Vite): http://localhost:5173

## Run (pilot / single process)

This serves the built web UI from the Express server so you only run one process.

```bash
npm run start
```

- App (server + UI): http://localhost:5050

## Local real-backend E2E (fake pipeline mode)

Playwright E2E starts the app in single-process pilot mode and drives real backend APIs/SSE without mocking.  
The test harness forces `MMS_PIPELINE_MODE=fake` so it does not require model access.

```bash
npm run test:e2e
# soak-only:
npm run test:e2e:soak
```

## Pilot runtime notes

- Longest/most variable steps are usually `B` (web research), `G-H-I` (story/visual generation), and `O-P` (packaging + master-doc synthesis + adherence checks).
- It is normal for a single step to appear `running` for multiple polling cycles.
- During step `M/N`, QA can loop once (QA -> Patch -> QA), so elapsed time can spike late in a run.
- If you need pilot continuity over strict gating, set run setting `adherenceMode` to `warn` (the run completes while still recording adherence findings).

## Outputs

Each run writes to:

- `output/<runId>/run.json` (run status + step metadata)
- `output/<runId>/intermediate/` (all in-between step artifacts)
  - Includes `medical_narrative_flow.json` (story backbone distilled from chapter-grade medical content)
  - Includes `medical_depth_report.json` (QA depth guard per required medical section)
- `output/<runId>/final/` (final/pilot-facing deliverables):
  - `trace.json`
  - `final_slide_spec_patched.json`
  - `reusable_visual_primer.json`
  - `medical_story_traceability_report.json`
  - `qa_report.json`
  - `constraint_adherence_report.json`
  - `GENSPARK_ASSET_BIBLE.md`
  - `GENSPARK_SLIDE_GUIDE.md`
  - `GENSPARK_BUILD_SCRIPT.txt`
  - `GENSPARK_MASTER_RENDER_PLAN.md`
  - (`GENSPARK_MASTER_RENDER_PLAN_BASE.md` is retained as an intermediate fallback/reference)

## API (backend)

- `GET /api/health`
- `POST /api/runs { topic: string, settings?: { durationMinutes?: number, targetSlides?: number, level?: "pcp"|"student", adherenceMode?: "strict"|"warn" } }`
- `GET /api/runs`
- `GET /api/runs/retention` (retention policy + run stats + disk analytics)
  - Includes `analytics` with:
    - `totalSizeBytes`, `terminalSizeBytes`, `activeSizeBytes`
    - `perRun[]` (`runId`, `sizeBytes`, `ageHours`, status)
    - `ageBuckets` (`lt_24h`, `between_1d_7d`, `between_7d_30d`, `gte_30d`)
- `POST /api/runs/cleanup { keepLast?: number, dryRun?: boolean }`
  - Deletes oldest terminal (`done`/`error`) runs beyond `keepLast` (active runs are never deleted)
  - Returns `reclaimedBytes`, `deletedRuns[]`, and post-cleanup `analytics`
- `GET /api/slo-policy`
  - Returns persisted step SLO thresholds (`policy.thresholdsMs`) + min/max bounds + defaults
- `PUT /api/slo-policy { reset?: boolean, thresholdsMs?: Partial<Record<StepName, number>> }`
  - Persists per-step threshold overrides to `output/slo_policy.json`
- `GET /api/runs/:runId`
  - Includes `canonicalSources` (resolved file paths used for this run, plus `foundAny`)
  - Includes `constraintAdherence` summary (`status`, failure/warning counts, timestamp)
  - Includes `stepSlo` with per-step elapsed/threshold evaluations and `warningSteps`
- `POST /api/runs/:runId/cancel`
- `POST /api/runs/:runId/rerun { startFrom: "KB0"|"A"|...|"P" }` (creates a new derived runId)
- `GET /api/runs/:runId/events` (SSE)
- `GET /api/runs/:runId/export` (zip download)
- `GET /api/runs/:runId/artifacts`
  - Returns `[{ name, size, mtimeMs, folder }]` where `folder` is one of:
    - `root` (`output/<runId>/`)
    - `intermediate` (`output/<runId>/intermediate/`)
    - `final` (`output/<runId>/final/`)
- `GET /api/runs/:runId/artifacts/:name`

## Common errors

- Missing `OPENAI_API_KEY`: the server health check will show `hasKey: false` and runs will fail early.
- Missing `KB_VECTOR_STORE_ID`: runs will fail at step `KB0`.
- Model access error (e.g. "does not exist or you do not have access"): set `MMS_MODEL` in `.env` to a model your key can use (default is `gpt-5.2`).
- Canon profile not being applied:
  - Check `GET /api/health` and confirm `hasCanonicalProfileFiles: true`.
  - By default this should resolve to `data/canon`; if you override `MMS_CANON_ROOT`, ensure that folder contains `character_bible.md`, `series_style_bible.md`, and `episode/deck_spec.md`.
  - Confirm write permissions for `episode/episode_memory.json`.
- JSON parse / schema errors: an agent returned output that does not match the required zod schema. The pipeline will try an automatic repair and then one deterministic retry; if it still fails, the run is marked failed and the SSE stream will emit an `error` event.
- Medical depth guard failures in step `M` (most common for PCP runs): if section depth is below threshold, QA forces `pass=false` and emits `medical_depth_report.json`. In `adherenceMode: "warn"`, the same condition is downgraded to warning.

## Live smoke test

Runs a real episode through the local server and checks canonical markers in `story_bible.json` + `shot_list.json`.

```bash
# Start app first in another shell: npm run dev  (or npm run start)
npm run smoke:live
```

Optional envs:

- `MMS_SMOKE_BASE_URL` (default `http://localhost:5050`)
- `MMS_SMOKE_TIMEOUT_MS` (default 25 minutes)
- `MMS_SMOKE_POLL_MS` (default 5000)

## CI

- `validate` job (push/PR): typecheck + lint + unit tests + build
- `e2e_soak` job (nightly UTC + optional workflow_dispatch input `run_e2e_soak=true`): executes the fake-backend soak Playwright suite
  - Publishes artifacts:
    - `soak-playwright-html-report` (Playwright HTML report)
    - `soak-json-results` (raw Playwright JSON results)
    - `soak-trend-history` (`soak-trend-history.html` + `soak-trend-history.json`)
  - Attempts to restore the latest prior `soak-trend-history` artifact and append a new entry each run
- `live_smoke` job (manual only): optional `workflow_dispatch` input `run_live_smoke=true`
  - Requires repo secrets `OPENAI_API_KEY` and `KB_VECTOR_STORE_ID`
  - Starts app in single-process pilot mode (`npm run start`) and runs `npm run smoke:live`

### Smoke troubleshooting

- `SMOKE FAILED: fetch failed`:
  - The server is not running on `MMS_SMOKE_BASE_URL`; start `npm run dev` or `npm run start` first.
- `Run ended with status=error`:
  - Open `output/<runId>/run.json` and check `steps.<step>.error`.
  - Review `output/<runId>/constraint_adherence_report.json`; strict mode can block completion on adherence fail.
  - For pilot continuity, rerun with `adherenceMode: "warn"`.
- Very long run times:
  - Increase `MMS_SMOKE_TIMEOUT_MS` (for example `3600000` for 60 minutes).
- Canonical marker check failures:
  - Verify canonical files are loaded (`GET /api/health` => `hasCanonicalProfileFiles: true`).
  - Confirm `data/canon` content matches the current project expectations.
