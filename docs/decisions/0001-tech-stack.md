# ADR 0001 — Technology stack

- **Status:** accepted
- **Date:** 2026-10-22
- **Deciders:** Project Pocket team (2 people)

## Context

Project Pocket is a university project for the course _LLM-assisted software development_. Two
students build and must be able to explain every line in an exam. The product needs:

- a browser extension for **Chrome and Firefox** that saves pages locally,
- a **mobile-friendly web app** for browsing and exporting the pocket,
- a **Python backend** that extracts structured data from pages, script-based first and with an
  **LLM fallback**,
- a **self-hosted** deployment (one Docker Compose file), ideally on a small server,
- **tests** for every part, with no network access in unit tests.

The repository started as a working prototype with vanilla JS, hand-written manifests and
SQLAlchemy models. It proved the idea but had no tests, two hand-maintained extension manifests,
and a 3,500-line backend file. We want a maintainable learning codebase instead.

## Decision

| Area        | Choice                                                            | Why                                                                                                                                                                                                  |
| ----------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo    | **pnpm workspaces**                                               | One lockfile, fast installs, local package linking; no extra build orchestrator needed for four packages.                                                                                            |
| Extension   | **WXT + React + TypeScript**                                      | Generates correct MV3 manifests for Chrome _and_ Firefox, hot reload, typed browser API, no hand-maintained manifest duplication.                                                                    |
| Web app     | **React + Vite + TypeScript + `vite-plugin-pwa`**                 | Minimal, fast, well documented; PWA installability for mobile; can later be wrapped with Capacitor.                                                                                                  |
| Shared code | **`packages/shared`**                                             | Types (`Category`, later `SavedItem`/`Recipe`) defined once for extension and web.                                                                                                                   |
| Backend     | **FastAPI + SQLModel + SQLite + Alembic**                         | FastAPI gives typed endpoints and free OpenAPI; SQLModel combines ORM and Pydantic models (less duplication for learners); SQLite needs no extra service; Alembic gives real, reviewable migrations. |
| Extraction  | **schema.org JSON-LD / `recipe-scrapers` first, LLM fallback**    | Deterministic, cheap and testable; LLM only where parsing fails.                                                                                                                                     |
| LLM         | **Provider protocol, no vendor lock-in**                          | Gemini/Anthropic/OpenAI/Ollama can be swapped; tests use fakes, never real APIs.                                                                                                                     |
| Tooling     | **Docker-only dev container (Node 24, pnpm 12, uv, Python 3.12)** | Both students and CI run identical versions without installing language runtimes on their machines; avoids "works on my machine".                                                                    |
| Quality     | **Vitest + Testing Library, pytest, ESLint/Prettier, Ruff**       | Standard, low-config tools with good error messages for beginners.                                                                                                                                   |
| Ops         | **Docker Compose + nginx**                                        | One command to self-host; nginx serves the PWA and proxies `/api` (same origin, no CORS in production).                                                                                              |

## Consequences

**Positive**

- One repository, one install command, one CI workflow.
- Cross-browser extension with no duplicated manifests or Chrome-only APIs.
- Shared types catch extension/web drift at compile time.
- Backend schema changes are explicit Alembic migrations, reviewable in pull requests.
- No local Node/Python installation; onboarding is "install Docker, run `make install`".

**Negative / trade-offs**

- WXT is an extra abstraction on top of the WebExtension API; we must read its docs to explain
  generated output in the exam.
- SQLModel hides some SQLAlchemy details; complex queries may later require plain SQLAlchemy.
- A Docker-only toolchain means IDE type resolution depends on the mounted Linux `node_modules`
  and `.venv`; editors may warn if they expect a native toolchain.
- Vite 8 / React 19 / WXT 0.21 are recent, so some tutorials use older APIs.

## Alternatives considered

- **Vanilla JS extension + hand-written manifests** (the old prototype): fewer abstractions, but
  manual Chrome/Firefox divergence and no type safety — rejected.
- **Django** instead of FastAPI: batteries included, but heavier and less natural for a JSON API
  with an OpenAPI contract — rejected.
- **Next.js** for the web app: server rendering is unnecessary for a local-first pocket and would
  add a Node runtime in production — rejected.
- **PostgreSQL** instead of SQLite: better concurrency, but an extra service to operate; SQLite is
  enough for a self-hosted two-user project and can be swapped later because we use SQLModel.
- **Nx/Turborepo**: more features than four packages need; pnpm workspaces plus a small Makefile
  are easier to explain — rejected.
