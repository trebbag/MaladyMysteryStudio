# V2 Stabilization PR Sequence

## Goal
Break the current mixed worktree into reviewable, low-risk PRs while preserving legacy behavior and keeping v2 pilot momentum.

## Branching Rule
- Use `codex/<short-name>` branches.
- Keep each PR independently green on:
  - `npm run typecheck`
  - `npm run lint`
  - `npm run test`
  - `npm run test:coverage`
  - `npm run build`
  - `npm run test:e2e`

## PR 1: V2 Runtime + API Contracts
- Scope:
  - v2 workflow settings validation and routing.
  - gate pause/resume runtime model and API surface.
  - no prompt/content tuning in this PR.
- Primary files:
  - `server/src/app.ts`
  - `server/src/index.ts`
  - `server/src/executor.ts`
  - `server/src/run_manager.ts`
  - `web/src/api.ts`
- Must-pass tests:
  - `server/test/app.test.ts`
  - `server/test/executor.test.ts`
  - `server/test/run_manager.test.ts`
  - `web/src/api.test.ts`

## PR 2: V2 Pipeline + Assets + Deterministic Lints
- Scope:
  - `server/src/pipeline/v2_micro_detectives/*`
  - prompt/schema loader, lock enforcement, phase generators, deterministic linting.
- Primary files:
  - `server/src/pipeline/v2_micro_detectives/`
  - `scripts/build_v2_asset_lock.mjs`
  - `micro-detectives-schemas-prompts/`
- Must-pass tests:
  - `server/test/v2_assets.test.ts`
  - `server/test/v2_pipeline.test.ts`
  - `server/test/v2_fake_pipeline.test.ts`
  - `server/test/v2_lints.test.ts`

## PR 3: V2 QA/Quality + Child-Process Reliability
- Scope:
  - phase-2/3 quality checks, citation traceability, reader-sim logic, child-runner reliability.
- Primary files:
  - `server/src/pipeline/v2_micro_detectives/phase*_generator.ts`
  - `server/src/pipeline/v2_micro_detectives/agent_*.ts`
- Must-pass tests:
  - `server/test/v2_phase2_generator.test.ts`
  - `server/test/v2_phase3_quality.test.ts`
  - `server/test/v2_citation_traceability.test.ts`
  - `server/test/v2_agent_child_process.test.ts`
  - `server/test/v2_agent_child_runner.test.ts`

## PR 4: Frontend V2 UX + Inspectors + Coverage Lift
- Scope:
  - workflow-aware controls, gate state UX, artifact inspectors, run viewer branch tests.
- Primary files:
  - `web/src/components/ChatStart.tsx`
  - `web/src/components/RunViewer.tsx`
  - `web/src/components/StepTimeline.tsx`
  - `web/src/styles.css`
- Must-pass tests:
  - `web/src/components/ChatStart.test.tsx`
  - `web/src/components/RunViewer.test.tsx`
  - `web/src/components/RunViewer.helpers.test.ts`
  - `web/src/components/StepTimeline.test.tsx`

## PR 5: CI + Pilot Tooling + Docs
- Scope:
  - targeted v2 gate e2e CI job
  - pilot quality/tuning scripts
  - pre-pilot checklist scripts
  - docs and artifact retention policy (`.ci/*` git-ignore).
- Primary files:
  - `.github/workflows/ci.yml`
  - `scripts/v2_pilot_quality_harness.mjs`
  - `scripts/v2_prompt_tuning_cycle.mjs`
  - `scripts/run_prepilot_checklist.mjs`
  - `README.md`
  - `.gitignore`

## PR 6: Prompt Quality Iterations (Real-Key Evidence Based)
- Scope:
  - only prompt text adjustments based on measured real-key harness reports.
- Primary files:
  - `micro-detectives-schemas-prompts/prompts/*.md`
  - `server/src/pipeline/v2_micro_detectives/assets/prompts/*.md`
  - `server/src/pipeline/v2_micro_detectives/assets/PROMPT_LOCK.json`
- Exit criteria:
  - attach latest report:
    - `.ci/pilot/v2-prompt-tuning-latest.md`
  - maintain schema validity and no regression in e2e gate flow.

## Merge/Release Checklist
1. Rebase each PR branch onto latest main before final merge.
2. Re-run full checklist:
   - `npm run pilot:checklist`
3. Verify lock integrity:
   - `npm run v2:assets:lock:check`
4. For pilot release branch only:
   - run real-key batch with SLO:
   - `npm run pilot:v2:tune -- --enforce-slo`
