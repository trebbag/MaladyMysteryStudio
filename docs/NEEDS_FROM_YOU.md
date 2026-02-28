# Needs From You

To run the MVP locally you must provide:

- `OPENAI_API_KEY` in `.env`
- `KB_VECTOR_STORE_ID` in `.env` (vector store id like `vs_...`)
- An OpenAI project/account with sufficient billing/quota enabled for the chosen `MMS_MODEL`
  - If you see `429 You exceeded your current quota`, enable billing or increase quota/spend limits for that project, then retry.

Optional:

- `PORT` (defaults to `5050`)
- `MAX_CONCURRENT_RUNS` (defaults to `1`)
- `MMS_RUN_RETENTION_KEEP_LAST` (defaults to `50` terminal runs, used by cleanup policy)
- `MMS_MODEL` (defaults to `gpt-5.2`; set this if your key doesn't have access to the default model)
- `MMS_V2_KB0_TIMEOUT_MS` (optional; defaults to `120000`, minimum effective `60000`) to cap KB0 wait time in v2 before warn-mode fallback
- `MMS_V2_STEP_AB_AGENT_TIMEOUT_MS` (optional; defaults to `120000`, minimum effective `90000`) to cap v2 A/B agent wait time before warn-mode fallback
- `MMS_V2_STEP_C_AGENT_TIMEOUT_MS` (optional; defaults to `180000`, minimum effective `150000`) to cap v2 C-agent waits before warn-mode fallback
- `MMS_V2_STEP_C_DECKSPEC_TIMEOUT_MS` (optional; defaults to `300000`, minimum effective `180000`) dedicated timeout for v2 DeckSpec generation turn
- `MMS_V2_AGENT_ISOLATION_MODE` (optional; defaults to child-process isolation; set `off` to run v2 agent calls in-process for debugging/tests)
- `MMS_CANON_ROOT` (optional override): path to canonical story/style files
  - expects:
    - `<root>/character_bible.md`
    - `<root>/series_style_bible.md`
    - `<root>/episode/deck_spec.md`
    - `<root>/episode/episode_memory.json` (updated each run)
- `MMS_EPISODE_MEMORY_PATH` (optional explicit override for memory file location)

By default, the app uses in-repo canonical files under `data/canon` and does not require an external `Downloads` folder.

Optional pilot validation:

- Run `npm run smoke:live` while the app is running locally to execute one real episode and verify canonical marker adherence in `story_bible.json` and `shot_list.json`.
- Run `npm run pilot:v2:quality` while the app is running locally to execute a multi-topic v2 quality batch and produce `.ci/pilot/v2-pilot-quality-latest.json`.
- Use `npm run pilot:v2:quality -- --enforce-slo --min-qa-accept-rate 0.66 --min-med-pass-rate 0.66` to hard-fail the batch when pilot quality SLO targets are missed.
- Run `npm run pilot:v2:trend` after pilot batches to refresh `.ci/pilot-report/v2-pilot-trend-history.html`.
- If you want adherence checks to be non-blocking during pilots, use run setting `adherenceMode: "warn"` from the UI/API.
- For deterministic local UI/e2e checks without model calls, set `MMS_PIPELINE_MODE=fake` (optional) before `npm run dev`.

If `KB_VECTOR_STORE_ID` is missing, the pipeline will fail at step `KB0`.
