# Progress

Roadmap and status for Project Pocket. Tick a checkbox only when the **Definition of Done**
(`AGENTS.md` §8) is met, not when the code merely compiles.

Legend: `[x]` done · `[ ]` not started · `[~]` in progress.

## M0 — Scaffold (current)

Goal: a monorepo where every part installs, builds, runs and has at least one test.

- [x] pnpm workspace, shared tsconfig, ESLint + Prettier, EditorConfig, `.gitignore`, `.env.example`
- [x] `packages/shared` with the `Category` type and a Vitest test
- [x] `apps/extension`: WXT + React popup, empty background script, Chrome + Firefox builds, Vitest test
- [x] `apps/web`: React + Vite PWA start page, backend health call, Vitest tests
- [x] `backend`: FastAPI app factory, pydantic-settings, `/api/health`, SQLModel/Alembic wiring,
      documented `extraction/`, `llm/`, `exporters/` packages, pytest tests
- [x] Dockerfiles for backend + web, Compose stack with SQLite named volume
- [x] Docker-only developer toolchain (Node, pnpm, uv, Python) + Makefile
- [x] CI workflow (lint, format, type check, tests, both extension builds, web build)
- [x] README, architecture diagrams, this roadmap, ADR 0001 tech stack, `CLAUDE.md`

**Verified with:** `make verify` and `docker compose build` (see README).

## M1 — Local-first saving in the extension

Goal: right-click a page, choose a category, save it locally; works offline.

- [ ] Context menu with one entry per category
- [ ] Save URL, title, category, timestamp to `browser.storage.local`
- [ ] Popup lists saved items and allows deleting one
- [ ] Chrome + Firefox manual test, Vitest unit tests for the storage helper
- [ ] Cross-browser storage wrapper (no Chrome-only APIs)

## M2 — Sync and multi-user

Goal: an explicit sync sends local items to the self-hosted backend; every user sees only their own
pocket.

- [ ] User accounts (registration/login) and session handling
- [ ] `SavedItem` SQLModel model + first real Alembic migration
- [ ] `POST /api/items` and `GET /api/items` scoped to the authenticated user
- [ ] Extension sync button with retry and conflict handling (no data loss offline)
- [ ] Web app login and item list

## M3 — Extraction (recipes first)

Goal: script-based extraction first, LLM only as a validated fallback.

- [ ] Extraction plugin interface per project type
- [ ] Recipe plugin: schema.org JSON-LD → `recipe-scrapers` → HTML heuristics
- [ ] Pydantic validation of extracted recipes
- [ ] LLM provider interface implementation (at least one provider) behind a config flag
- [ ] Tests with saved HTML fixtures; LLM mocked, no network

## M4 — Browse, filter, tags

Goal: the web app becomes the pocket UI.

- [ ] Category/tag filters, search, sorting
- [ ] Item detail view (recipe ingredients/instructions)
- [ ] Manual tags and notes
- [ ] Responsive/mobile check, PWA install test

## M5 — Export

Goal: get data out of the pocket.

- [ ] CSV export (and import as a later follow-up)
- [ ] Mealie export via its REST API (URL + token from environment, never committed)
- [ ] Shopping-list export (later)
- [ ] Tests for every exporter; no real Mealie instance required in tests

## M6 — Polish & course deliverables

- [ ] End-to-end test (Playwright)
- [ ] Error states, empty states, accessibility pass
- [ ] Final documentation, exam-ready walkthrough, demo script

## Backlog

_Empty for now — new feature ideas are added here as ready-to-paste GitHub issue drafts
(title + short description + acceptance criteria) before they are implemented._
