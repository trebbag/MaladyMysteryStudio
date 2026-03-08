# Self Test Checklist (Current Main)

This checklist is the fastest honest validation pass for the current `main` branch.

## Goal

Verify that a real-key `workflow="v2_micro_detectives"` run:

1. clears `KB0`, `A`, and `B`
2. enters deep `C` block authoring and QA loops
3. produces the expected v2 diagnostics artifacts
4. either completes, or fails with a concrete content-quality reason rather than transport/schema/runtime instability

## Preconditions

1. `.env` contains valid `OPENAI_API_KEY` and `KB_VECTOR_STORE_ID`
2. `npm install`
3. `npm run lint`
4. `npm run typecheck`
5. `npm test`
6. `npm run build`

## Launch

1. From `/Users/gregorygabbert/Documents/MaladyMyteryStudioApp`, run:
   - `npm run start`
2. Open:
   - `http://localhost:5050`

## Recommended Manual Test

Use this exact setup first, because it is the path most recently validated:

1. Topic: `Pneumococcal pneumonia`
2. Workflow: `v2_micro_detectives`
3. Generation profile: `quality`
4. Adherence mode: `strict`
5. Audience: `COLLEGE_LEVEL`
6. Enable soft target: `on`
7. Soft target length: `30`

This is still a real quality run. The soft target is advisory only.

## What Success Looks Like In-App

1. `KB0`, `A`, and `B` finish without quota/schema failures.
2. `C` produces:
   - `disease_dossier.json`
   - `truth_model.json`
   - `differential_cast.json`
   - `clue_graph.json`
   - `micro_world_map.json`
   - `drama_plan.json`
   - `setpiece_plan.json`
   - `story_blueprint.json`
   - `act_outline.json`
   - `slide_block_plan.json`
3. The run detail view shows the v2 diagnostics panels.
4. `C` continues into:
   - `reader_sim_report_loop1.json`
   - `med_factcheck_report_loop1.json`
   - `qa_report_loop1.json`
   - `qa_block_heatmap_loop1.json`
5. If the run fails, it fails with content-quality findings, not transport/schema/runtime instability.

## Artifacts To Inspect First

After the run starts, inspect these under `output/<runId>/intermediate/`:

1. `agent_call_durations_C.json`
2. `deck_spec_timeout_plan.json`
3. `deck_authoring_context_manifest.json`
4. `narrative_intensifier_pass.json`
5. `qa_block_heatmap_loop1.json`
6. `reader_sim_report_loop1.json`
7. `med_factcheck_report_loop1.json`
8. `qa_report_loop1.json`

If the run reaches later loops, inspect:

1. `qa_report_loop2.json`
2. `qa_report_loop3.json`
3. `block_regen_trace_loop1.json`
4. `block_regen_trace_loop2.json`

## Current Known Expected Risk

As of March 8, 2026, the latest real-key narrowed promotion run:

- cleared `KB0`, `A`, and `B`
- cleared deep `C` authoring
- survived repeated late-loop `readerSim` and `medFactcheck`
- terminated on QA/content issues, not runtime instability

The latest concrete blocker set is:

1. medical traceability / dossier-grounding defects in `med_factcheck_report.json`
2. on-slide word-limit overruns on a handful of slides
3. weak midpoint / false-theory collapse signaling in final QA

That means the current self-test is primarily validating content quality and late-loop repair behavior, not basic plumbing.

## Fast CLI Alternative

If you want the harness rather than the UI:

```bash
npm run pilot:v2:quality -- --phase promotion --topic "Pneumococcal pneumonia" --audience COLLEGE_LEVEL --deck-length 30 --timeout-minutes 120
```

## How To Judge The Result

Treat the run as a good test if all of the following are true:

1. it gets past `B`
2. it writes looped QA artifacts in `C`
3. it does not fail on quota, schema, malformed response-format output, or transport aborts
4. any failure is clearly explained by `qa_report.json` and `med_factcheck_report.json`

## After Your Test

If you want a quick triage pass, bring back:

1. `output/<runId>/run.json`
2. `output/<runId>/intermediate/qa_report.json`
3. `output/<runId>/intermediate/med_factcheck_report.json`
4. `output/<runId>/intermediate/agent_call_durations_C.json`
