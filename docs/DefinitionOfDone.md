Micro‑Detectives v2 (Slide‑Deck) — Definition of Done by Phase
Global constraints (apply to all phases)

These are the “always true” invariants of v2:

v2 runs are selected explicitly via a new run setting: settings.workflow = "v2_micro_detectives". Legacy remains default.

Main deck length is fixed (deckLengthMain ∈ {30,45,60}) and does not expand based on medical content. Appendix slides may be unlimited.

Main deck story dominance: ≥70% of main slides are story-forward (goal→oppositi

Overview

One major medical concept per main slide (appendix exempt). 

Overview

e schema-validated** at every stage; a failure must fail the step (wi

Overview

sistent with existing pipeline behavior).

All v2 artifacts are persisted under output/<runId>/intermediate/ and final deliverables under output/<runId>/final/ consistent with current project conventions.

Phase 1 — “V2 wiring + DeckSpec-first + hard lints + storyboard review”

Goal: Add a new workflow option that generates a schema-valid DeckSpec (fixed-length story deck), with deterministic lints and a storyboard review gate, without touching legacy behavior.

Backend DoD

RunSettings extended to include:

workflow?: "legacy" | "v2_micro_detectives" (default legacy)

deckLengthMain?: 30|45|60 (only used in v2)

audienceLevel?: "med_school_advanced" (or similar v2-only field)

Server request validation updated:

POST /api/runs accepts v2 fields without requiring targetSlides or forcing min 100.

Legacy still enforces targetSlides: min 100, max 500.

Pipeline router added:

In server/src/index.ts, replace the single pipeline function with a router that dispatches to:

runStudioPipeline (legacy)

runMicroDetectivesPipeline (v2)

v2 pipeline skeleton added:

Implements at minimum: KB0 (reuse canon/KB compile) → DeckSpec generation step → lint step → finalize.

Writes deck_spec.json to intermediate and a copy (or patched version) to final.

Deterministic linting implemented (must hard-fail in strict mode):

Slide count equals deckLengthMain

Every main slide includes a story_turn object (goal/opposition/turn/decision not empty)

On-slide text under max word limit

Max 1 major medical concept per main slide

Story dominance ratio target met (≥70% story slides)

Artifacts saved + registered per step via runs.addArtifact(...) (so UI shows them).

Frontend DoD

web/src/components/ChatStart.tsx adds:

workflow selector (Legacy vs Micro‑Detectives v2)

deck length selector (30/45/60) shown only for v2

hides or disables targetSlides when v2 is selected

keeps current defaults for legacy (targetSlides default 120 but min 100 enforced)

Run display page can show v2’s deck_spec.json artifact without crashing.

QA/UX DoD

“Storyboard Review” gate implemented in some form:

Minimal acceptable implementation: after DeckSpec + lints pass, v2 writes GATE_3_STORYBOARD_REQUIRED.json and stops further v2 steps, and the UI clearly tells the user “review required; rerun from step X after edits.”

Preferred implementation starts in Phase 2: true pause/resume.

Test DoD

Fake pipeline mode can produce a deterministic v2 DeckSpec (even if simplistic) for E2E tests.

At least 1 unit test validates lint failures trigger step error.

Phase 1 is done when:
A user can run workflow=v2_micro_detectives and reliably get a fixed-length deck_spec.json that passes deterministic lints, with legacy behavior unchanged.

Phase 2 — “True grounding + citations + medical fact-check QA + pause/resume gates”

Goal: Introduce the real v2 backbone: DiseaseDossier grounding with citations, a TruthModel, and medical correctness QA. Add real pause/resume gates.

Backend DoD

Add v2 assets to repo:

/schemas and /prompts directories (from the zip) committed under a clear path (e.g., server/src/pipeline/v2_micro_detectives/assets/...).

Structured output enforcement:

All v2 agent calls produce schema-valid JSON; failures follow the existing schema repair pattern you already use in legacy (ModelBehaviorError → repair prompt → retry once).

Implement these v2 steps + artifacts:

`DiseaseD

Overview

 with citations)

TruthModel (locked diagnosis + aligned macro/micro timeline + twist blueprint)

MedFactcheckReport (QA agent verifies DeckSpec claims trace to dossier citations)

Add pause/resume to runtime:

Extend run status enum beyond queued|running|done|error in RunManager (e.g., add paused).

Modify RunExecutor so it does not set status to done if the pipeline indicates “paused.”

Add endpoints:

POST /api/runs/:runId/gates/:gateId/submit (stores human_review.json)

POST /api/runs/:runId/resume

Gate 1 + Gate 2 introduced:

GATE_1_PITCH: v2 produces episode_pitch.json, pauses, awaits approval

GATE_2_TRUTH_LOCK: v2 produces TruthModel summary, pauses, awaits approval

POST /api/runs/:runId/rerun behavior preserved (still works for legacy and v2).

Frontend DoD

UI supports paused runs:

shows gate reason + preview artifact (pitch/truth summary)

provides approve/request-changes/regenerate actions

resumes run when approved

Medical correctness DoD

DiseaseDossier requires citations for “load-bearing” claims (mechanisms, discriminators, test confounders).

Med fact checker rejects any slide where reasoning uses non-dossier facts.

Test DoD

Add E2E test for pause/resume:

run pauses at GATE_1

submit approval

run continues and produces TruthModel + DeckSpec

Phase 2 is done when:
v2 produces dossier + truth model + deck spec with citations, and the app can pause/resume cleanly at gates without breaking SSE or artifact listing.

Phase 3 — “ClueGraph + ReaderSim QA + QA loop with patching + Truth-first twists”

Goal: Upgrade from “a correct deck” to “a mystery deck”: controlled clues, red herrings, twist receipts, and an adversarial reader sim that forces story quality.

Backend DoD

Implement these v2 steps + artifacts:

DifferentialCast (suspect roster)

ClueGraph (macro+micro clues, red herrings, payoffs, twist support matrix)

ReaderSimReport (adversarial solve attempt at multiple checkpoints)

Combined QAReport (lint + reader sim + med factcheck → accept/reject + fix list)

Implement QA loop (within v2 pipeline):

If QA rejects: run PatchApplier (or targeted regeneration) and rerun QA up to N loops (configurable)

Persist every loop’s report artifacts for audit (e.g., qa_report_loop1.json, qa_report_loop2.json)

Add Gate 3 properly:

GATE_3_STORYBOARD pauses after a “good” DeckSpec but before rendering/export steps

Uses JSONPath-based requested changes to patch only specific slides/sections

Story quality DoD

ReaderSim must check:

solvability (not obvious, but fair)

twist i

Overview

orting clues, ≥1 in Act I, ≥2 slides recontextualized)

pacing (no “lecture slides”)

Deterministic lints now enforce:

every red herring has a payoff

every twist has required receipts

Test DoD

Unit tests cover:

twist receipt lint failures

red herring payoff requirement

E2E test covers:

QA rejection triggers patch loop once

QA pass exits loop and pauses at GATE_3

Phase 3 is done when:
v2 consistently produces a deck where twists are supported, red herrings pay off, QA can reject and patch without “regenerating the whole world,” and the storyboard gate is usable.

Phase 4 — “MicroWorldMap + SetpiecePlan + template registry + stronger visuals + final packaging”

Goal: The deck becomes visually distinctive and action-forward at micro scale (immune “police,” barrier infiltrations, tissue geography) while staying medically coherent and story-dominant.

Backend DoD

Implement v2 steps + artifacts:

MicroWorldMap

DramaPlan

SetpiecePlan

DeckSpec generation upgraded to reference:

template IDs for slide layouts

exhibit IDs for labs/histo/pathway visuals

appendix links for deep dives (not counted against main deck length)

Rendering/Packaging DoD

Introduce a v2 template registry:

template_id → renderer instructions

Export includes:

main deck render plan

appendix render plan

speaker notes with citations

Final outputs appear under output/<runId>/final/ alongside current legacy deliverables conventions.

Frontend DoD

Run viewer supports:

previewing template + exhibits per slide spec

distinguishing “main deck” vs “appendix”

Quality DoD

Measured story dominance metrics displayed 

Overview

 Med-school depth is present primarily in speaker notes/appendix, not as on-slide blocks.

Phase 4 is done when:
v2 produces a visually-consistent, action-forward micro-scale deck with a stable template system, strong story pacing, and fully traceable medical depth in notes/appendix—without inflating main slide count.