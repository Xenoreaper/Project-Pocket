# AGENTS.md — Project Pocket

Instructions for AI coding agents (opencode, Claude Code, …) working in this repository.
Read this file completely before every task. If anything here conflicts with a user prompt, ask.

---

## 1. What this project is

**Project Pocket** — "everything important from any page, in one pocket".

A university project (course: *LLM-assisted software development*, Hochschule Esslingen) by a team of two.

- A **browser extension** (Chrome **and** Firefox) lets the user right-click any web page, pick a
  category (e.g. *Recipes*), and save it into their local "pocket" (JSON in extension storage).
- Saved pages can be **synced** to a self-hosted **backend + web app** (Docker container on a server).
  The web app is multi-user: every user sees only their own pocket.
- The backend **extracts structured data** from saved pages — **script-based first** (cheap, e.g.
  schema.org JSON-LD / `recipe-scrapers`), **LLM only as a fallback**.
- Extracted items can be browsed, filtered by category/tags and **exported** (CSV, Mealie, shopping lists, …).

First project type: **recipes → Mealie**. Later: DIY projects (bill of materials), lyrics.
The current roadmap and status live in [`docs/PROGRESS.md`](docs/PROGRESS.md).

## 2. The most important rule: we must understand the code

This is a learning project. Both team members must be able to explain **every line** in an exam.
Write code for a reader who knows basic programming but **not** this framework.

- **Comments are mandatory**, not optional:
  - Every file starts with a short header comment: what this file is for and how it fits into the system.
  - Every function, class, React component, API endpoint and test gets a docstring / JSDoc comment
    (purpose, parameters, return value, side effects).
  - Inline comments for anything non-obvious, and **always** for framework "magic": decorators,
    dependency injection, React hooks, manifest permissions, async/await flows, regexes, SQL/ORM queries,
    config keys.
  - Explain the **why**, not only the what. If you chose approach A over B, say why in one line.
- Prefer **simple, readable code** over clever code. No premature abstractions.
- After every task, give the humans a **walkthrough** in your reply (see §8).

## 3. Hard rules

1. **Never commit, push, merge or rebase.** We review everything ourselves. You may stage nothing.
   At the end of a task, *propose* commit message(s) (Conventional Commits, see §7).
2. **Ask before** adding/removing/upgrading a dependency, changing the architecture or repo layout,
   changing the database schema in a non-additive way, or touching CI. Explain the options and your
   recommendation, then wait.
3. **No secrets in the repo.** No API keys, tokens, passwords, real user data. Use `.env` (git-ignored)
   and keep `.env.example` up to date with placeholder values. **Warn us explicitly** whenever a secret
   must be set somewhere (which variable, where, why).
4. **Tests are mandatory.** Every feature and bug fix gets tests. Run the relevant test suites (and
   linters/type checks) **before** you hand the work back. Never hand back red tests without saying so
   loudly. Never delete or weaken a test just to make it pass.
5. **Chrome AND Firefox.** Never use Chrome-only APIs. Use WXT's cross-browser `browser.*` API and
   build/test for both targets.
6. **Stay in scope.** Do what the task asks. Note other ideas under "Backlog" in `docs/PROGRESS.md`
   instead of implementing them.

## 4. Tech stack

| Part | Tech |
|---|---|
| Monorepo | pnpm workspaces |
| Browser extension | WXT, TypeScript, React, Manifest V3, `browser.storage.local` (JSON) |
| Web app | React, Vite, TypeScript, PWA (mobile-friendly; later wrappable with Capacitor) |
| Shared TS code | `packages/shared` — shared types and helpers for extension + web app |
| Backend | Python, FastAPI, SQLModel, SQLite, Alembic (migrations) |
| Extraction | schema.org JSON-LD parsing, `recipe-scrapers`, HTML parser; later yt-dlp/Whisper, GitHub API |
| LLM | behind a provider interface (swappable: Gemini / Anthropic / OpenAI / Ollama); fallback only |
| Export | CSV, Mealie REST API, later PDF / shopping lists |
| Tests | pytest (backend), Vitest (TS), later Playwright (E2E) |
| Lint/format | Ruff (Python), ESLint + Prettier (TS) |
| Ops | Docker Compose |

## 5. Repository layout

```
apps/
  extension/        # WXT browser extension (Chrome + Firefox)
  web/              # React + Vite PWA (the "Pocket" web app)
backend/            # FastAPI app, extraction, LLM providers, exporters
packages/
  shared/           # shared TypeScript types/helpers
docs/
  ARCHITECTURE.md   # architecture overview incl. Mermaid diagrams — keep up to date
  PROGRESS.md       # roadmap, milestones, status, backlog — keep up to date
  decisions/        # short architecture decision records (ADR), one file per decision
docker-compose.yml
docker/tools/       # Docker-only dev toolchain (Node, pnpm, uv, Python)
.env.example
AGENTS.md           # this file
CLAUDE.md           # imports AGENTS.md for Claude Code
```

If the actual layout differs from this, trust the code, then point out the mismatch so we can fix this file.

## 6. Architecture principles

- **Local first in the extension:** saving a page must work offline and without an account.
  Sync to the backend is an explicit, optional step.
- **Backend is the source of truth** for synced data and for the API contract (OpenAPI).
- **Extraction = plugin per project type** (recipe, DIY, lyrics, …). Each plugin: tries script-based
  extraction first → LLM fallback → validates the result against a schema (Pydantic / JSON schema).
- **Internal format is JSON** (recipes modelled after schema.org/Recipe). CSV is an **export** format only.
- **LLM calls are never required for tests**: mock providers in tests, no network in unit tests.
- Keep the extension, web app and backend loosely coupled via a documented REST API.

## 7. Workflow & conventions

- **Language:** code, comments, docs, commit messages → **English**. You may answer the user in German
  if they write in German.
- **Conventional Commits:** `feat(extension): add context menu for saving pages`,
  `fix(backend): …`, `test(web): …`, `docs: …`, `chore: …`, `refactor: …`.
  Scopes: `extension`, `web`, `backend`, `shared`, `docs`, `ci`, `docker`.
- Small, focused changes are preferred. One logical change per proposed commit.
- When a task is big, first post a short **plan** (steps, files to touch, open questions) and wait for OK.
- Update `docs/PROGRESS.md` when a task changes the status of a milestone. Update `docs/ARCHITECTURE.md`
  when components or data flows change. Add an ADR in `docs/decisions/` for every significant decision.
- Feature ideas: add them to the *Backlog* in `PROGRESS.md` as ready-to-paste GitHub issue drafts
  (title + short description + acceptance criteria). We create the issues in GitHub Projects ourselves.

## 8. Definition of Done (check before handing back)

- [ ] Feature works as requested, in **Chrome and Firefox** (if extension-related)
- [ ] Tests written and **passing**; linters and type checks clean (show the commands you ran)
- [ ] Every new/changed file is commented as described in §2
- [ ] No secrets added; `.env.example` updated if new config was introduced (and you warned us)
- [ ] `docs/PROGRESS.md` / `docs/ARCHITECTURE.md` updated if affected
- [ ] Your reply contains:
  1. **Summary** — what changed and why (3–6 bullets)
  2. **Walkthrough** — the key files in reading order, explaining how the pieces connect
  3. **How to try it** — exact commands / clicks
  4. **Test results** — commands run and outcome
  5. **Proposed commit message(s)**
  6. **Open questions / risks**

## 9. Commands

> Keep this section accurate. Update it whenever scripts change.
>
> **No local Node/Python toolchain is required.** Everything runs inside the `tools` Docker
> service (`docker/tools/Dockerfile`), wrapped by the Makefile targets below. Run `make install`
> once after cloning; then use the targets. `make help` lists all of them.

```bash
# ── One-time setup ───────────────────────────────────────────────────────────
cp .env.example .env              # local configuration (no secrets yet)
make install                      # pnpm install + uv sync, inside Docker

# ── Quality checks (TypeScript) ───────────────────────────────────────────────
make lint                         # ESLint (all TS packages)
make format                       # Prettier write
make format-check                 # Prettier check (CI)
make typecheck                    # tsc --noEmit (shared, extension, web)
make test                         # Vitest (shared, extension, web)

# ── Builds ────────────────────────────────────────────────────────────────────
make build                        # extension (Chrome) + web app
make build-firefox                # extension (Firefox)
make build-all                    # extension (Chrome + Firefox) + web app

# ── Backend ───────────────────────────────────────────────────────────────────
make backend-lint                 # Ruff check + format check
make backend-test                 # pytest
make backend-dev                  # uvicorn --reload on http://localhost:8000
make dev-web                      # Vite dev server on http://localhost:5173

# ── Run the stack ─────────────────────────────────────────────────────────────
docker compose up --build         # backend + web app
docker compose down               # stop (SQLite volume is kept)

# ── Everything at once (Definition of Done) ───────────────────────────────────
make verify
```

Raw escape hatch (same container, explicit commands):

```bash
docker compose run --rm -T tools pnpm -r test
docker compose run --rm -T tools sh -c "cd backend && uv run pytest"
docker compose run --rm -T tools sh -c "cd backend && uv run alembic upgrade head"
```
