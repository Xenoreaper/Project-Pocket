# Project Pocket 📌

A self-hosted "save for later" app with a **web UI**, a **REST API**, and a **browser extension**.

## Features

| Area | What it does |
|---|---|
| Backend (FastAPI) | Save pages, auto-fetch title/description, tag, mark as recipe, full-text search |
| Frontend (Nginx) | Browse all pages, filter by tag/domain, view recipes, inline editing |
| Browser Extension | One-click save of the current tab with tags and notes |

## Stack

- **Backend**: Python 3.12, FastAPI, SQLAlchemy, SQLite
- **Frontend**: Vanilla HTML/CSS/JS, Nginx
- **Browser Extension**: Manifest V3 (Chrome, Edge, Brave)

---

## Getting Started

### 1. Run with Docker Compose

Copy env template first:

```bash
cp .env.example .env
```

```bash
cd Project-Pocket_(Save_for_later)
docker compose up --build -d
```

Open **http://localhost:3000** in your browser.

### 1.1 Environment Variables

Use `.env` for local/private configuration. Key variables:

- `DATABASE_URL` (backend DB connection)
- `BACKEND_CORS_ORIGINS` (comma-separated list, or `*`)

### 2. Install the Browser Extension

1. Open `chrome://extensions` (or `edge://extensions`)
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `extension/` folder
4. Click the 📌 icon in the toolbar to save any page

> By default the extension talks to `http://localhost:3000`.
> You can change this in the extension's **Settings** panel.

---

## API Reference

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/pages` | List pages (`?search=`, `?tag=`, `?domain=`, `?is_recipe=`) |
| `POST` | `/api/pages` | Save a new page |
| `GET` | `/api/pages/{id}` | Get a single page |
| `PATCH` | `/api/pages/{id}` | Update title / tags / notes |
| `DELETE` | `/api/pages/{id}` | Delete a page |
| `GET` | `/api/domains` | List all distinct domains |
| `GET` | `/api/tags` | List all distinct tags |

Interactive docs: **http://localhost:3000/api/docs** (served by FastAPI)

---

## Project Structure

```
Project-Pocket_(Save_for_later)/
├── docker-compose.yml
├── backend/
│   ├── Dockerfile
│   ├── main.py          # FastAPI app & routes
│   ├── models.py        # SQLAlchemy models
│   ├── schemas.py       # Pydantic schemas
│   ├── database.py      # DB engine & session
│   └── requirements.txt
├── frontend/
│   ├── Dockerfile
│   ├── nginx.conf
│   └── html/
│       ├── index.html
│       ├── style.css
│       └── app.js
└── extension/
    ├── manifest.json
    ├── popup.html
    ├── popup.js
    └── icons/
```
