# Project Pocket

> Everything important from any page, in one pocket.

Project Pocket is a self-hosted "save for later" app for web pages. A browser extension saves a
page into a local pocket, an optional sync sends it to your own server, and the backend extracts
structured data (recipes first) so you can browse, filter and export it.

This repository is currently an **M0 scaffold**: every part builds, runs and has tests, but the
product features (saving, syncing, extracting, exporting) are not implemented yet. See
[`docs/PROGRESS.md`](docs/PROGRESS.md) for the roadmap.

## What is in the box

| Part                                 | Path                 | Status                                                                                 |
| ------------------------------------ | -------------------- | -------------------------------------------------------------------------------------- |
| Browser extension (Chrome + Firefox) | `apps/extension`     | WXT + React popup, empty background script                                             |
| Web app (PWA)                        | `apps/web`           | React + Vite start page that calls the backend health endpoint                         |
| Shared TypeScript types              | `packages/shared`    | `Category` type + guard, used by both frontends                                        |
| Backend API                          | `backend`            | FastAPI health endpoint, SQLModel/Alembic wiring, empty extraction/LLM/export packages |
| Local stack                          | `docker-compose.yml` | Backend + web app + optional tooling container                                         |

More background: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and
[`docs/decisions/0001-tech-stack.md`](docs/decisions/0001-tech-stack.md).

## Prerequisites

- **Docker Desktop** (or Docker Engine + Compose v2) — the only required toolchain.
- **Git** and **Make** (Make is preinstalled on macOS; on Linux install `make`).
- For manually loading the extension: Chrome/Chromium or Firefox.

You do **not** need Node, pnpm, Python or uv on your machine. All commands run inside a Docker
container (`docker/tools/Dockerfile`), so every teammate and CI use the same versions. The
`node_modules/` and `backend/.venv/` folders that appear after installation contain Linux binaries
on purpose — use the Docker commands below instead of a native toolchain.

## Quick start

```bash
# 1. Local configuration (no secrets yet, safe defaults)
cp .env.example .env

# 2. Install JS dependencies and the Python virtualenv (inside Docker)
make install

# 3. Start backend + web app
docker compose up --build
```

Open:

- Web app: <http://localhost:3000>
- API docs: <http://localhost:8000/docs>
- Health check: <http://localhost:8000/api/health> → `{"status":"ok","version":"0.1.0"}`

The web app should show "Backend is healthy — version 0.1.0". Stop the stack with `Ctrl+C` or
`docker compose down` (the SQLite volume is kept).

## Everyday commands

All commands are wrappers around the Docker tools image. Run `make help` for the full list.

| Command                             | What it does                                               |
| ----------------------------------- | ---------------------------------------------------------- |
| `make install`                      | `pnpm install` + `uv sync` inside Docker                   |
| `make lint`                         | ESLint for all TypeScript packages                         |
| `make format` / `make format-check` | Prettier write / check                                     |
| `make typecheck`                    | `tsc --noEmit` for shared, extension and web               |
| `make test`                         | Vitest for shared, extension and web                       |
| `make backend-lint`                 | Ruff check + format check                                  |
| `make backend-test`                 | pytest                                                     |
| `make build`                        | Extension (Chrome) + web app production build              |
| `make build-firefox`                | Extension (Firefox) production build                       |
| `make verify`                       | The complete Definition of Done locally                    |
| `make up` / `make down`             | Start / stop backend + web app                             |
| `make backend-dev`                  | Backend with auto-reload on <http://localhost:8000>        |
| `make dev-web`                      | Vite dev server with hot reload on <http://localhost:5173> |

Raw form if you prefer it:

```bash
docker compose run --rm -T tools pnpm -r test
docker compose run --rm -T tools sh -c "cd backend && uv run pytest"
```

## Load the extension

Build it first (Chrome: `make build`, Firefox: `make build-firefox`).

### Chrome / Chromium / Edge

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select `apps/extension/.output/chrome-mv3`.
4. Click the Project Pocket icon in the toolbar → the popup shows "Project Pocket — hello".

### Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…**.
3. Select `apps/extension/.output/firefox-mv3/manifest.json`.
4. Open the extension popup from the toolbar.

A temporary Firefox add-on disappears when Firefox closes; that is normal for local development.
`docker compose run --rm -T tools pnpm --filter extension zip` (or `zip:firefox`) will later
produce store-ready archives.

### Extension development

WXT's `dev` mode wants to launch a browser, which is not possible from inside a container. The
workflow in this Docker-only setup is: edit code → `make build` (or `make build-firefox`) → click
**Reload** on the extension card in Chrome, or reload the temporary add-on in Firefox. The popup
test runs without a browser (`make test`).

## Backend development

```bash
make backend-dev        # uvicorn with --reload on port 8000
```

Useful inside the tools container:

```bash
# Create a migration after adding/changing SQLModel models
docker compose run --rm -T tools sh -c "cd backend && uv run alembic revision --autogenerate -m 'add pages'"

# Apply migrations
docker compose run --rm -T tools sh -c "cd backend && uv run alembic upgrade head"
```

The initial migration (`backend/alembic/versions/0001_initial.py`) is empty: there are no tables
yet, it only proves the pipeline works.

## Web app development

```bash
make dev-web            # http://localhost:5173, proxies /api to the backend
```

Start a backend first (`make backend-dev` or `docker compose up -d backend`). Vite proxies `/api`
to `http://host.docker.internal:8000`, so the browser only ever talks to one origin.

The production container serves the built files with nginx, which proxies `/api` to the `backend`
Compose service. The PWA service worker/manifest are generated by `vite-plugin-pwa`.

## Configuration

Copy `.env.example` to `.env`; Docker Compose reads it automatically.

| Variable              | Default                                       | Meaning                                   |
| --------------------- | --------------------------------------------- | ----------------------------------------- |
| `POCKET_ENVIRONMENT`  | `development`                                 | Environment label (logging/display).      |
| `POCKET_CORS_ORIGINS` | `http://localhost:5173,http://localhost:3000` | Origins allowed to call the API directly. |
| `WEB_PORT`            | `3000`                                        | Host port of the web container.           |
| `BACKEND_PORT`        | `8000`                                        | Host port of the backend container.       |

The backend loads settings via `pydantic-settings` with the `POCKET_` prefix
(`backend/app/config.py`). `POCKET_DATABASE_URL` is set to an absolute path inside the container by
`docker-compose.yml`; locally the default is `sqlite:///./data/pocket.db`.

**Secrets:** this scaffold needs none. When an LLM API key is added, it must live only in `.env`
(git-ignored) and be documented as a placeholder in `.env.example` — never commit a real key.

## Docker

| File                      | Purpose                                                                   |
| ------------------------- | ------------------------------------------------------------------------- |
| `docker/tools/Dockerfile` | Dev toolchain: Node 24, pnpm 12, uv, Python 3.12 (not used in production) |
| `backend/Dockerfile`      | FastAPI image; runs `alembic upgrade head` then uvicorn                   |
| `apps/web/Dockerfile`     | Multi-stage: build with Node, serve static files with nginx               |
| `docker-compose.yml`      | Backend + web + optional `tools` profile                                  |

The SQLite database lives on the named volume `pocket-data` (mounted at `/app/data`). Removing the
volume deletes all data: `docker compose down -v`.

## Tests

| Layer           | Tool                     | Command                         |
| --------------- | ------------------------ | ------------------------------- |
| Shared package  | Vitest                   | `make test` (runs all TS tests) |
| Extension popup | Vitest + Testing Library | `make test`                     |
| Web start page  | Vitest + Testing Library | `make test`                     |
| Backend         | pytest                   | `make backend-test`             |

CI (`.github/workflows/ci.yml`) runs lint, format check, type check, tests and both extension
builds plus the web build on every push/PR.

## Troubleshooting

- **"Cannot connect to the Docker daemon"** → start Docker Desktop.
- **Port already in use** → change `WEB_PORT` / `BACKEND_PORT` in `.env`.
- **Install after switching host OS/arch** → delete `node_modules/` and `backend/.venv/`, then
  `make install` again (they contain Linux binaries).
- **Web app says it cannot reach the backend** → check `docker compose ps` and
  <http://localhost:8000/api/health>.

## License

MIT — see [`LICENSE`](LICENSE).
