# Project Pocket

> Everything important from any page, in one pocket.

Project Pocket is a self-hosted "save for later" app for web pages. A browser extension saves a
page into a local pocket, an optional sync sends it to your own server, and the backend extracts
structured data (recipes first) so you can browse, filter and export it.

**M1 (local-first saving) is implemented in the extension.** Right-click a page, choose
_Save to Pocket ▸ category_, and the page is stored in the browser. The popup lists, searches,
filters, opens, edits and deletes saved pages. Sync, extraction and export are still planned; see
[`docs/PROGRESS.md`](docs/PROGRESS.md) for the roadmap.

## What is in the box

| Part                                 | Path                 | Status                                                                                 |
| ------------------------------------ | -------------------- | -------------------------------------------------------------------------------------- |
| Browser extension (Chrome + Firefox) | `apps/extension`     | M1: context-menu saving, local pocket, popup with search/filter/edit/delete            |
| Web app (PWA)                        | `apps/web`           | React + Vite start page that calls the backend health endpoint                         |
| Shared TypeScript types              | `packages/shared`    | `SavedPage`, categories, snapshots and runtime guards                                  |
| Backend API                          | `backend`            | FastAPI health endpoint, SQLModel/Alembic wiring, empty extraction/LLM/export packages |
| Local stack                          | `docker-compose.yml` | Backend + web app + optional tooling container                                         |

More background: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md),
[ADR 0001 (tech stack)](docs/decisions/0001-tech-stack.md) and
[ADR 0002 (local-first storage)](docs/decisions/0002-local-first-storage.md).

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
| `make build-all`                    | Extension (Chrome + Firefox) + web app production build    |
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

Build both browser targets first:

```bash
make build-all          # Chrome + Firefox extension, plus the web app
```

The outputs are `apps/extension/.output/chrome-mv3` and `apps/extension/.output/firefox-mv3`.
Run `make build` for Chrome only or `make build-firefox` for Firefox only.

`.output` starts with a dot, so file dialogs often hide it. Press `Ctrl+H` to show hidden files, or
`Ctrl+L` to type the path directly. If the folder is missing, the build has not run yet: `make verify`
only reaches the build step after formatting, lint, type checks and tests have passed.

### Chrome / Chromium / Edge

This install stays across browser restarts.

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select the folder `apps/extension/.output/chrome-mv3`.
4. Pin **Project Pocket** to the toolbar if it is hidden in the puzzle-piece menu.

If **Load unpacked** does nothing on Linux, the file dialog could not open. Either drag the
`chrome-mv3` folder onto `chrome://extensions` or start the browser with the extension loaded. The
second option lasts only for browser sessions started with this flag, and all Chromium windows must
be closed first:

```bash
chromium --load-extension="$PWD/apps/extension/.output/chrome-mv3"
```

The usual fix for the dialog is to install the `xdg-desktop-portal` package that matches your
desktop (for example `xdg-desktop-portal-kde`, `-gnome` or `-gtk`).

### Firefox (temporary, for development)

A temporary add-on works in every Firefox edition but disappears when Firefox closes.

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…**.
3. Select the file `apps/extension/.output/firefox-mv3/manifest.json`.

### Firefox (permanent install)

Regular Firefox only keeps signed add-ons. Without a signature, use Firefox Developer Edition:

1. Build the archive:
   ```bash
   docker compose run --rm -T tools pnpm --filter extension zip:firefox
   ```
2. Open `about:config` in Firefox Developer Edition and set `xpinstall.signatures.required` to
   `false`.
3. Open `about:addons`, click the gear icon and choose **Install Add-on From File…**.
4. Select `apps/extension/.output/extension-0.1.0-firefox.zip`, not the `-sources.zip` file. The
   version in the file name follows the extension version.
5. Restart Firefox and check that **Project Pocket** is still listed.

### Update after a code change

An installed extension does not update itself. Rebuild it first (`make build` for Chrome,
`make build-firefox` for Firefox), then:

- Chrome/Chromium: click **Reload** on the extension card in `chrome://extensions`.
- Temporary Firefox add-on: click **Reload** in `about:debugging`.
- Permanent Firefox install: repeat the permanent install steps with a new archive.

Saved pages live in the browser profile, and browsers normally delete them when an extension is
removed. Do not rely on a temporary install to keep real data.

### Smoke test

Run this list in both browsers before ticking off an extension feature. Unit tests replace the
browser APIs with fakes, so only this test proves that capturing a real page works. Use a real
recipe page, and keep Project Pocket pinned so the toolbar badge is visible.

1. Right-click the page and choose **Save to Pocket ▸ Recipes**. Expected: the badge shows `✓`.
2. Save the **same URL** again. Expected: the badge shows `↻` and the popup still has one card.
3. Save a different page in **DIY Projects**, then use the search box and category chips in the
   popup. Expected: the list follows the search and filter.
4. Click a card title. Expected: the page opens in a new tab.
5. Change the card's category, then click **Edit** to add comma-separated tags and a note. Close and
   reopen the popup. Expected: the changes are still there.
6. Add a custom category at the bottom of the popup, then right-click a page. Expected: the new
   category is in the **Save to Pocket** submenu.
7. Click **Delete** on a card and confirm. Expected: the card is gone.
8. Try to save `chrome://settings` or `about:preferences`. Expected: the badge shows `!` and nothing
   is saved.

Step 8 is a browser security rule, not an extension bug: restricted pages (`chrome://…`, `about:…`,
browser stores, some PDF viewers) cannot be injected.

To check for errors, open the extension's console: the **service worker** link on the extension card
in `chrome://extensions`, or **Inspect** in `about:debugging` for Firefox.

### Browser for AI agents (MCP)

The repository contains an MCP server that gives AI agents such as Claude Code a browser: a
headless Chromium in Docker with the extension loaded. The agent can open the popup, click, read the
page and take screenshots. Details for agents are in `AGENTS.md` §9.

1. Build the extension: `make build`.
2. Start Claude Code in the repository and approve the `pocket-browser` server when asked (or run
   `/mcp`). Claude Code starts `docker/playwright-mcp/run.sh` itself.

Only Docker is needed. The server cannot use the native right-click menu or Firefox, so the manual
smoke test above stays necessary.

### Extension development

WXT's `dev` mode wants to launch a browser, which is not possible from inside a container. The
workflow in this Docker-only setup is: edit code → `make build` (or `make build-firefox`) → click
**Reload** on the extension card in Chrome, or reload the temporary add-on in Firefox. Tests run
without a browser (`make test`).

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

**Secrets:** M1 needs none. When an LLM API key is added, it must live only in `.env`
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

| Layer          | Tool                     | Command                         |
| -------------- | ------------------------ | ------------------------------- |
| Shared package | Vitest                   | `make test` (runs all TS tests) |
| Extension      | Vitest + Testing Library | `make test`                     |
| Web start page | Vitest + Testing Library | `make test`                     |
| Backend        | pytest                   | `make backend-test`             |

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
