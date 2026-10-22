# Project Pocket

Project Pocket is a self-hosted "save for later" system with:

- a token-authenticated web app
- a dedicated admin panel
- a FastAPI backend (proxied through Nginx)
- a browser extension (Manifest V3)

## Current Capabilities

- User authentication with persistent bearer sessions
- Role-based routing sends admins to `admin.html` and non-admin users to `index.html`
- Forced password change flow lets admins reset/force passwords and blocks affected users until they set a new password
- Saving supports tags, notes, recipe/music flags, and source metadata (`device`, `saved_via`)
- New saves auto-extract metadata (title, description, favicon) and recipe instructions/ingredients when available
- Re-saving the same URL increments `resave_count` and merges tags/notes instead of duplicating records
- Multi-profile saves per authenticated user via `X-Pocket-Profile`
- View and filtering tools include All Pages, Recipes, Music, and By Domain views
- Server-side list API supports search, domain/tag filters, include/exclude tag filters, sort modes, `limit`, and `offset`
- CSV workflows include native export/import and third-party Pocket CSV import
- Auto-tag rules (domain/url/title/device matching, including wildcard variants)
- Ingredient canonicalization endpoint for recipe matching support
- Theme modes across UI: Light, Dark, OLED

## Architecture

- `frontend` container serves static app and proxies `/api/*` to backend
- `backend` container runs FastAPI + SQLAlchemy
- SQLite data is persisted in Docker volume `pocket-db`
- Lightweight DB migrations run automatically at backend startup

## Stack

- Backend: Python 3.12, FastAPI, SQLAlchemy, SQLite
- Frontend: Vanilla HTML/CSS/JS, Nginx
- Extension: Manifest V3 (`chrome`, `edge`, Brave-compatible)

## Quick Start

### 1. Configure environment

```bash
cp .env.example .env
```

Important variables in `.env`:

- `DATABASE_URL` (default SQLite path in container volume)
- `BACKEND_CORS_ORIGINS` (`*` or comma-separated origins)
- `ADMIN_USERNAME` (bootstrap/update admin account on startup)
- `ADMIN_PASSWORD` (bootstrap/update admin password on startup)

### 2. Start the stack

```bash
docker compose up --build -d
```

Open `http://localhost:3000`.

### 3. API docs

- OpenAPI docs: `http://localhost:3000/api/docs`

## Web App Routes

- `login.html`: sign in/register + forced password-change modal
- `index.html`: main user app (all saves, recipes, music, domains, settings)
- `admin.html`: admin-only user/role management

## Browser Extension

Install locally:

1. Open `chrome://extensions` (or `edge://extensions`)
2. Enable Developer mode
3. Load unpacked extension from `extension/`

Extension behavior:

- Save current tab with optional tags, notes, recipe/music flags
- Optional YouTube timestamp injection
- Uses backend auth token for authenticated saves
- Supports server URL, profile, and popup theme settings
- Provides tag/profile suggestions from `/api/tags` and `/api/profiles`

Default server URL is `http://localhost:3000`.

## API Summary

Authentication:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/change-password`
- `POST /api/auth/enforce-password-change`
- `POST /api/auth/logout`

Admin:

- `GET /api/users`
- `PATCH /api/users/{username}`
- `DELETE /api/users/{username}`
- `POST /api/users/{username}/password/reset`
- `POST /api/users/{username}/password/force-change`

Pages and metadata:

- `GET /api/pages` (filters, sorting, `limit`, `offset`)
- `POST /api/pages`
- `GET /api/pages/{page_id}`
- `PATCH /api/pages/{page_id}`
- `DELETE /api/pages/{page_id}`
- `DELETE /api/pages?confirm=DELETE%20ALL`
- `GET /api/music/genius-search`

Import/export and lookups:

- `GET /api/pages/export.csv`
- `POST /api/pages/import.csv?source=native|pocket`
- `GET /api/domains`
- `GET /api/tags`
- `GET /api/profiles`
- `POST /api/ingredients/canonicalize`

Auto-tag rules:

- `GET /api/auto-tag-rules`
- `POST /api/auto-tag-rules`
- `DELETE /api/auto-tag-rules/{rule_id}`

## Project Structure

```text
Project-Pocket_(Save_for_later)/
├── docker-compose.yml
├── .env.example
├── backend/
│   ├── main.py
│   ├── models.py
│   ├── schemas.py
│   ├── database.py
│   ├── requirements.txt
│   ├── Dockerfile
│   └── admin_ui_bundle.js
├── frontend/
│   ├── nginx.conf
│   ├── Dockerfile
│   └── html/
│       ├── login.html
│       ├── index.html
│       ├── admin.html
│       ├── login.js
│       ├── app.js
│       ├── admin.js
│       └── style.css
└── extension/
    ├── manifest.json
    ├── background.js
    ├── popup.html
    ├── popup.js
    └── icons/
```
