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
- If you want adherence checks to be non-blocking during pilots, use run setting `adherenceMode: "warn"` from the UI/API.
- For deterministic local UI/e2e checks without model calls, set `MMS_PIPELINE_MODE=fake` (optional) before `npm run dev`.

If `KB_VECTOR_STORE_ID` is missing, the pipeline will fail at step `KB0`.
