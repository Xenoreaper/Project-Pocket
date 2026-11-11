# Development log

Where the project stands and what was done, in order. `docs/PROGRESS.md` holds the plan (milestones,
acceptance criteria, backlog); this file records what actually happened.

**How to keep it:** after every task, rewrite "Current state" and add an entry at the top of the
log: date, who, what and why, how it was verified, what is next. Facts only; say when something is
unverified. Most work is pair programming by `Tsunamie1337` and `Xenoreaper` with Claude Code as the
coding agent, following `AGENTS.md`.

## Current state

- **Milestone:** M2 (accounts and sync), task 4 of 10 done.
- **Works:** saving pages locally in the extension (Chromium + Firefox); backend with local
  accounts, optional Keycloak token check and the item sync API.
- **Next:** task 5, an optional Keycloak container with a test realm (Compose profile).
- **Open checks:** no real Keycloak has been used yet; the sync flow has no client yet.
- **Known gap:** `.env.example` still lacks the M2 settings (see 2026-11-11).

## Log

### 2026-11-11: shared API types, development log (M2 task 4)

- Added `packages/shared/src/api.ts` (import as `@project-pocket/shared/api`): endpoint paths, request
  and response types, runtime guards for server responses, `toSyncPayload()` and
  `apiErrorMessage()`. The extension and the web app will both use it from task 6 on.
- Separate entry point because `api.ts` builds on the main module; re-exporting it there would create
  a circular import.
- Added this log and the rule to keep it to `AGENTS.md`, plus a `Co-authored-by` rule for
  pair-programmed commits.
- Verified: `make format-check`, `make lint`, `make typecheck`, `make test`.

### 2026-11-11: Playwright MCP server added and removed

- Added a browser MCP server (Playwright in Docker) so the agent could test the popup. It worked, but
  the team did not like the workflow and removed it again in the same session. Testing the extension
  stays manual (README, "Smoke test").

### 2026-11-11: backend for accounts and sync (M2 tasks 1–3)

- Plan agreed: local accounts by default, Keycloak (OpenID Connect) optional by configuration, with
  its own Compose container for development. New dependencies `argon2-cffi` and `pyjwt[crypto]`.
- Built tables + migration `0002`, local login with hashed passwords and tokens, Keycloak token
  check, `POST/GET /api/items` with per-user isolation and "newest edit wins".
- Verified: 72 pytest tests, `alembic check`, `make verify`, and the Docker image in a throwaway
  stack (register, login, upload, list).
- The course grading rubric was added as `docs/Bewertungsschema.ods`.
- Not possible here: editing `.env.example` (blocked for the agent); the new settings are documented
  in `backend/app/config.py`.

### 2026-11-04: audit of the first two prompts, setup, roadmap

- Checked the scaffold and M1 against the original prompts: almost complete.
- Fixed the `make backend-dev` target and formatted the push rules (they failed the Prettier check).
- Completed the roadmap with acceptance criteria and a "Later" section, and documented installing
  and smoke-testing the extension.
- Manual smoke test of M1 passed in Chromium and Firefox; M1 marked done.

### 2026-10-30: course repository and push rules

- Merged the course repository and documented the two-remote workflow (`zz_pushrules.md`).

### 2026-10-22: scaffold and M1 (by `Xenoreaper`)

- Monorepo scaffold (extension, web app, backend, Docker, CI, docs) and M1, local-first saving in the
  extension, built from the prompts in the course material.
