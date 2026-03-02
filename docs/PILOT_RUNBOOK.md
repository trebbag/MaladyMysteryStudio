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
   - `deckLengthMain`: `30 | 45 | 60`
   - `audienceLevel`: appropriate for pilot cohort
3. Monitor Run Detail:
   - Verify SSE events continue flowing.
   - Verify the expanded agent timeline is visible (v2 stages `KB0`, `A1..A2`, `B1`, `C1..C10`).
   - At step C start, confirm DeckSpec estimate panel appears with:
     - estimated slide count
     - adaptive timeouts (`agent`, `deckspec`, `watchdog`)
     - abort threshold + warning state
   - If estimate exceeds pilot budget, use `Abort run` before long C generation completes.
   - Resolve gate pauses at Gate 1/2/3 using Review + Resume.
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
3. Deck main length equals configured `deckLengthMain`.
4. Story-forward ratio meets target (`>= 0.70`).
5. Intro/outro contract is present (intro beats in opening window, outro beats in closing window).
6. Hybrid-slide quality metric is acceptable (story + medical payload retained).
7. Citation grounding coverage is acceptable (payload + speaker-note citations present).
8. Med fact-check pass or documented remediation.
9. QA report accept or documented rationale for retry/patch.
10. If `deck_spec_timeout_plan.json` exists, estimate/timeout values are internally consistent with run metadata (`v2DeckSpecEstimate`).
11. For runs with high estimate warnings, operator decision is recorded (abort or continue).

## 6) Batch Validation (Real-Key)

Use the harness for batch quality scoring and reports:

1. `npm run pilot:v2:quality -- --topic "..." --topic "..."`
2. Optional enforcement:
   - `npm run pilot:v2:quality -- --enforce-slo ...`
3. Reports:
   - `.ci/pilot/v2-pilot-quality-latest.json`
   - `.ci/pilot/v2-pilot-quality-latest.md`

## 7) Semantic Threshold Calibration

After collecting pilot batch results, calibrate semantic defaults from observed quality metrics:

1. `npm run pilot:v2:calibrate:semantic`
2. Output:
   - `.ci/pilot/v2-semantic-calibration-latest.json`
3. Apply recommended defaults from the output in env vars:
   - `MMS_V2_MIN_STORY_FORWARD_RATIO`
   - `MMS_V2_MIN_HYBRID_SLIDE_QUALITY`
   - `MMS_V2_MIN_CITATION_GROUNDING_COVERAGE`
4. Re-run a quality batch to verify new thresholds before promotion.

## 8) Common Failure Triage

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

## 9) Pilot Exit Criteria

1. Pre-pilot checklist green: `npm run pilot:checklist`.
2. Real-key batch quality meets configured SLO thresholds.
3. No unresolved blocker in `docs/NEEDS_FROM_YOU.md`.
