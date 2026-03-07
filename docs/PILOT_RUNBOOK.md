# Pilot Runbook (MVP)

This runbook is the operator checklist for piloting `workflow=v2_micro_detectives` while preserving legacy workflow behavior.

## 1) Preconditions

1. `npm install`
2. `.env` contains valid `OPENAI_API_KEY` and `KB_VECTOR_STORE_ID`
3. Canonical files exist under `data/canon/` (or `MMS_CANON_ROOT` points to an equivalent structure)
4. App boots cleanly:
   - `npm run typecheck`
   - `npm run lint`
   - `npm test`
   - `npm run build`
   - `npm run test:coverage`

## 2) Launch Modes

1. Dev mode (two processes): `npm run dev`
2. Pilot mode (single process, built UI served by server): `npm run start`

## 3) Pilot Execution SOP

1. Start app (`npm run start`) and open `http://localhost:5050`.
2. Create a run from Home:
   - `workflow`: `v2_micro_detectives`
   - `generationProfile`: `quality` (default) for authoring depth, or `pilot` for resilience-first execution
   - `adherenceMode`: `strict` for hard gates, `warn` for continuity
   - `audienceLevel`: `PHYSICIAN_LEVEL` or `COLLEGE_LEVEL`
   - Deck length controls are optional:
     - default: unconstrained (no soft target)
     - optional: enable soft target and set `deckLengthMain` (advisory only)
3. Monitor Run Detail:
   - Verify SSE events continue flowing.
   - Verify the expanded agent timeline is visible (v2 stages `KB0`, `A1..A2`, `B1`, `C1..C10`).
   - At step C start, confirm DeckSpec estimate panel appears with:
     - estimated slide count
     - adaptive timeouts (`agent`, `deckspec`, `watchdog`)
     - abort threshold + warning state
   - If estimate exceeds pilot budget, use `Abort run` before long C generation completes.
   - Resolve gate pauses at Gate 1/2/3 using Review + Resume.
   - In quality runs, verify the v2 diagnostics panels are populated:
     - `V2 stage provenance`
     - `Story beats alignment`
     - `V2 block authoring diagnostics` (`narrative_state_current`, `deck_authoring_context_manifest`, latest `block_regen_trace_loopN`)
4. Inspect artifacts:
   - `deck_spec.json`
   - `disease_dossier.json`
   - `truth_model.json`
   - `med_factcheck_report.json`
   - `clue_graph.json`
   - `reader_sim_report.json`
   - `qa_report.json`
   - `V2_MAIN_DECK_RENDER_PLAN.md`
5. Export run package: `GET /api/runs/:runId/export`.

## 4) Gate Decision Matrix

1. `approve`: continue from gate `resumeFrom`.
   - Gate 3 only: approve is blocked when `semantic_acceptance_report.json` has `pass=false`.
2. `regenerate`: continue from gate-owning step with current feedback.
3. `request_changes`: keep run paused; submit `approve` or `regenerate` before resuming.

## 5) Acceptance Checklist (Per Run)

1. Run status is `done`.
2. No missing required final artifacts in `output/<runId>/final/`.
3. If a deck soft target is enabled, final main length is reasonably close to `deckLengthMain` (advisory, not strict).
4. If no soft target is enabled, deck length is unconstrained and evaluated on quality/cost fit for the pilot.
5. Story-forward ratio meets target (`>= 0.70`).
6. Intro/outro contract is present (intro beats in opening window, outro beats in closing window).
7. Hybrid-slide quality metric is acceptable (story + medical payload retained).
8. Citation grounding coverage is acceptable (payload + speaker-note citations present).
9. Med fact-check pass or documented remediation.
10. QA report accept or documented rationale for retry/patch.
11. Narrative grader shows required markers (false-theory collapse, opener/ending callback, detective/deputy rupture+repair) at acceptable scores.
12. If `deck_spec_timeout_plan.json` exists, estimate/timeout values are internally consistent with run metadata (`v2DeckSpecEstimate`).
13. For runs with high estimate warnings, operator decision is recorded (abort or continue).

## 6) Batch Validation (Real-Key)

Use the harness for batch quality scoring and reports:

1. `npm run pilot:v2:quality -- --topic "..." --topic "..."`
2. Optional enforcement:
   - `npm run pilot:v2:quality -- --enforce-slo ...`
3. Reports:
   - `.ci/pilot/v2-pilot-quality-latest.json`
   - `.ci/pilot/v2-pilot-quality-latest.md`

## 7) Real-Key Quality Smoke Checklist (Single-Run)

Use this when you need one deterministic operator check (not a full harness batch):

1. Start app (`npm run start`).
2. Run smoke checklist:
   - `npm run smoke:v2:quality -- --topic "Community-acquired pneumonia in adults"`
3. What it enforces:
   - Gate-aware completion (auto approve/resume through Gate 1/2/3/4).
   - Final run status `done`.
   - Required v2 authored/planning artifacts present.
   - Narrative markers in generated deck:
     - opening hook signal
     - false-theory lock-in
     - midpoint collapse
     - detective/deputy rupture + repair
     - ending callback signal
   - Twist receipts in clue graph.
   - Story-planning provenance is fully agent-authored in quality mode.
4. Output:
   - success/fail summary in terminal with per-check diagnostics
   - `.ci/smoke/v2-quality-smoke-latest.json`
   - `.ci/smoke/v2-quality-smoke-latest.md`
   - timestamped smoke snapshots are now treated as local diagnostics and ignored by git; only `latest` and trend-history artifacts are intended to stay in source control
5. Refresh smoke trend history after repeated checks:
   - `npm run smoke:v2:quality:trend`
6. Smoke trend outputs:
   - `.ci/smoke-report/v2-quality-smoke-trend-history.json`
   - `.ci/smoke-report/v2-quality-smoke-trend-history.md`
   - `.ci/smoke-report/v2-quality-smoke-trend-history.html`

## 8) Semantic Threshold Calibration

After collecting pilot batch results, calibrate semantic defaults from observed quality metrics:

1. `npm run pilot:v2:calibrate:semantic`
2. Optional (no new model spend): calibrate directly from persisted real-run artifacts:
   - `npm run pilot:v2:calibrate:runs -- --output-root output --min-runs 5`
3. Output:
   - `.ci/pilot/v2-semantic-calibration-latest.json`
   - `.ci/pilot/v2-threshold-calibration-from-runs.json`
   - `.ci/pilot/v2-threshold-calibration-from-runs.md`
4. Apply recommended defaults from the output in env vars:
   - `MMS_V2_MIN_STORY_FORWARD_RATIO`
   - `MMS_V2_MIN_HYBRID_SLIDE_QUALITY`
   - `MMS_V2_MIN_CITATION_GROUNDING_COVERAGE`
5. Re-run a quality batch to verify new thresholds before promotion.

## 9) Real-Key Batch Defaults

1. `npm run pilot:v2:quality` now defaults to:
   - `generationProfile=quality`
   - `adherenceMode=strict`
   - unconstrained deck length
2. Use `--deck-length 30|45|60` only when you intentionally want a soft-target batch.
3. Use `--generation-profile pilot --adherence warn` only for resilience-first soak/harness runs.
4. Promotion semantics:
   - `--phase promotion` treats timeout runs as diagnostic-only and bases go/no-go on completed runs
   - `--phase pilot` still counts timeouts in the batch SLO report because it is intended for resilience diagnostics

## 10) Common Failure Triage

### Current Real-Key Timing Baseline (March 7, 2026)

Use these as the current v2 quality-mode operator expectations from live runs on `Community-acquired pneumonia in adults`:

1. Early-step reliability:
   - `KB0` now clears in quality mode with compact retry support; observed completion was about `37s`.
   - `A` and `B` now clear in quality mode with compact retry support and longer budgets.
2. Step `C` long poles currently observed:
   - `differentialCast`: about `40s`
   - `clueArchitect`: about `83s`
   - `microWorldMap`: about `83s`
   - `dramaPlan`: about `124s` after the act-debt normalization fix
   - `setpiecePlan`: about `70s`
   - `slideBlockAuthor`: observed blocks from about `58s` to `221s`
   - `deckCohesionPass`: about `93s`
   - `narrativeIntensifier`: about `194s`
   - `readerSim`: about `63s`
   - `medFactcheck`: about `67s`
3. Late-stage quality implication from the March 7, 2026 CAP run:
   - A `55`-slide unconstrained quality run reached `qa_report_loop1.json`, `semantic_acceptance_report_loop1.json`, `qa_block_heatmap_loop1.json`, and structural regeneration artifacts before the smoke watchdog aborted at `45m`.
   - Step `C` is therefore capable of full authoring + QA on real-key runs, but a quality run that enters regeneration should currently be budgeted closer to `60m+` than `45m`.
   - Until Step `C` throughput is reduced, do not use the smoke timeout as a semantic pass/fail proxy.
4. Operator timeout policy:
   - `npm run smoke:v2:quality` now extends its timeout dynamically from `v2DeckSpecEstimate.adaptiveTimeoutMs.watchdog` once step `C` publishes the estimate.
   - Promotion batches should use the same adaptive budget logic rather than a fixed pre-step `C` wall clock.
3. Practical operator implication:
   - Do not treat a `C` run as stuck merely because nothing visible happens in the first few minutes.
   - The current expected hot spots are late slide-block calls, the narrative intensifier, and regeneration loops after loop-1 QA.
   - If you lower local watchdog/SLO settings below these observed ranges, you will create false alarms.

1. Gate stuck in `request_changes`:
   - Submit `approve` or `regenerate`, then call resume.
2. `resume` conflict:
   - Ensure run is truly `paused` and has a submitted review for the active gate.
3. Sparse legacy rerun from `P`:
   - Ensure at least one patched spec is available (`final_slide_spec_patched.json` or `final_slide_spec_patched_iterN.json`).
4. Citation failures:
   - Confirm `disease_dossier` citation IDs are propagated into deck payload and speaker notes.
5. SSE drops:
   - UI auto-retries, but verify server health and event stream endpoint.
6. Step C appears stalled:
   - Check `deck_spec_timeout_plan.json` for expected timeout scaling.
   - Review `fallback_usage.json` and `agent_call_durations_C.json` for slow/failing agent calls.
   - If estimated length is above threshold, abort and restart with tighter constraints or narrower topic scope.

## 11) Pilot Exit Criteria

1. Pre-pilot checklist green: `npm run pilot:checklist`.
2. Real-key batch quality meets configured SLO thresholds.
3. No unresolved blocker in `docs/NEEDS_FROM_YOU.md`.
