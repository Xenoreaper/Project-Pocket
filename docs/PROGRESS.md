# Progress

Roadmap and status for Project Pocket. Tick a checkbox only when the **Definition of Done**
(`AGENTS.md` §8) is met, not when the code merely compiles.

Legend: `[x]` done · `[ ]` not started · `[~]` in progress.

## M0 — Scaffold (done)

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

## M1 — Local-first saving in the extension (current)

Goal: right-click a page, choose a category, save it locally; works offline.

- [x] Context menu `Save to Pocket ▸ category`, with one item per built-in and custom category
- [x] Save URL, title, favicon, metadata, category, tags, note and timestamps to
      `browser.storage.local`
- [x] Bounded page snapshot for M3: parsed JSON-LD + cleaned visible text, no full HTML
- [x] Repeated saves of the same normalised URL upsert the page (no silent duplicates)
- [x] Popup lists pages, searches, filters by category, opens links and deletes with confirmation
- [x] Popup recategorise, tag and note editing; custom category creation
- [x] Toolbar badge feedback (`✓` saved, `↻` updated, `!` error)
- [x] Cross-browser WebExtension APIs only (`browser.*`, Chrome + Firefox MV3 builds)
- [x] Vitest tests for shared model, storage, capture, menu/save flow and popup (62 tests)
- [~] Manual smoke test in Chrome and Firefox (load both builds, save/edit/delete a real page)

**Verified with:** `make lint`, `make typecheck`, `make format-check`, `make test` and
`make build-all`. The manual browser smoke test is intentionally left for the team. Decisions and
data format are documented in
[`decisions/0002-local-first-storage.md`](decisions/0002-local-first-storage.md).

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

New feature ideas are added here as ready-to-paste GitHub issue drafts before they are implemented.
Copy the title, description and acceptance criteria into GitHub Projects; do not implement directly
from the backlog without agreeing on scope.

### Rename and delete custom categories

**Title:** `feat(extension): rename and delete custom categories`

**Description:** M1 can create custom categories, but they cannot be renamed or removed. Add
management controls that keep existing pages valid.

**Acceptance criteria:**

- Renaming a category changes only its label; existing pages keep the same category ID.
- Deleting a category asks what to do with its pages (move to `other` by default).
- The context menu and popup update after either operation.
- Tests cover both actions and a missing category definition on an existing page.

### Normalise tracking parameters before duplicate detection

**Title:** `feat(extension): strip tracking parameters when comparing saved URLs`

**Description:** Duplicate detection currently removes only the fragment. `utm_*`, `fbclid` and
similar parameters can create two records for the same page.

**Acceptance criteria:**

- A documented allow/deny list removes common tracking parameters without removing content IDs.
- Existing pages with the same normalised URL are merged without losing tags/notes.
- The popup warns before merging or shows a single updated result.
- Unit tests cover query strings that must stay distinct (`?id=`, pagination, search).

### Export and import the local pocket

**Title:** `feat(extension): export and import local pocket JSON`

**Description:** Local data is currently trapped in the browser profile. A JSON backup/restore is a
useful safeguard before sync and makes manual testing easier.

**Acceptance criteria:**

- Export downloads a versioned JSON file containing pages and custom categories.
- Import validates every record with the shared guards, merges by normalised URL and reports skipped
  records.
- No server or account is required.
- Tests use in-memory files/fixtures; no real downloads in unit tests.

### Quick-save keyboard shortcut

**Title:** `feat(extension): add a quick-save keyboard shortcut`

**Description:** Saving currently requires finding a page area, right-clicking and choosing a
category. Add a command that saves with a user-selected default category.

**Acceptance criteria:**

- `commands` manifest entry works in Chrome and Firefox.
- The default category is configurable in the popup.
- The same capture/save/badge workflow is reused (no duplicated save logic).
- Tests cover the command-to-save wiring and invalid/missing tab cases.

### Sidebar view for the pocket

**Title:** `feat(extension): add a sidebar/side-panel view`

**Description:** A popup closes when the user clicks the page. A persistent sidebar would make
browsing and sorting easier while reading.

**Acceptance criteria:**

- Chrome uses `sidePanel`; Firefox uses `sidebar_action` (or a documented cross-browser abstraction).
- The saved-page list component is shared with the popup, not copied.
- Both browsers are built and manually tested.
- An ADR records the extra permissions/API differences.

### Storage health and usage panel

**Title:** `feat(extension): show pocket storage usage and repair invalid records`

**Description:** Storage quota errors and corrupted records are handled defensively, but the user
cannot see how much space the pocket uses or which record was skipped.

**Acceptance criteria:**

- The popup shows approximate bytes used by pocket keys.
- Invalid records can be inspected and removed individually or exported for debugging.
- A full/over-quota state has a clear message and suggested action.
- Tests cover invalid records and quota failures without touching the real browser quota.
