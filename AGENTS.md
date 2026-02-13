# AGENTS.md (Malady Mystery Studio)

These instructions apply to all agentic work in this repo.

## Global non-negotiables

- Always deliver production-ready work: tests, security hygiene, docs, and verification steps.
- Always discover and use the repo’s real install/lint/typecheck/test/build commands.
- Prefer stable foundations (security/auth/data/deploy), but aim for premium UX and thoughtful workflows.
- Never commit secrets. Always provide `.env.example` + clear setup docs.
- If progress requires something from the user (keys, DB, accounts), record it in `docs/NEEDS_FROM_YOU.md` and state it in your response.

## Progress reporting requirement

In your responses:

- Keep track of the core items needed for piloting the MVP.
- Include a short MVP gap analysis: what remains to be implemented before pilot.
- Give % complete for each core area.
- Then list the next concrete tasks to implement.

## Project scope (MVP)

Build a local macOS web app called **Malady Mystery Studio**:

- TypeScript everywhere.
- Node.js backend + React (Vite) frontend.
- No Next.js.
- Local-dev friendly.
- npm workspaces at repo root.
- Backend is the only place that uses `OPENAI_API_KEY`. Frontend must not contain secrets.

### Backend

- Express server + SSE for live progress.
- Use `@openai/agents` for orchestration.
- Steps run in order: `KB0 -> A -> ... -> O`.
- Use `fileSearchTool(vectorStoreId)` to fetch KB context.
- Use `webSearchTool` for the medical researcher step.
- Use zod schemas for every agent output (no empty schemas).
- Wrap each run in `withTrace` and persist trace id to `output/<runId>/trace.json`.
- Persist every step output as artifact files under `output/<runId>/`.
- Minimal QA loop: `QA (M) -> Patch (N) -> QA` up to 2 iterations.

### Frontend

- Chat box to start runs.
- Live step timeline + logs via SSE.
- Artifact browser and viewer (JSON pretty print; MD render).
- Trace ID display.

### Repo layout

See `README.md` for the canonical commands and how to run.
