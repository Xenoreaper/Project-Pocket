# Architecture

> Status: **M0 scaffold**. Solid boxes exist and run; dashed boxes are planned. This document is
> updated whenever components or data flows change.

Project Pocket has four cooperating parts:

1. **Browser extension** (WXT + React, Chrome + Firefox): local-first saving, works offline.
2. **Web app** (React + Vite PWA): browse, filter and export the synced pocket.
3. **Backend** (FastAPI + SQLModel + SQLite): source of truth for synced data and the API contract.
4. **Extraction pipeline** (script-based first, LLM fallback): turns saved pages into structured
   items (recipes first) and feeds exporters such as Mealie.

## Component diagram

```mermaid
flowchart LR
    subgraph Browser["Browser"]
        Ext["Browser extension<br/>WXT + React<br/>(built: popup shell)"]
        Store[("browser.storage.local<br/>JSON pocket<br/>(planned)")]
    end

    Web["Web app<br/>React + Vite PWA<br/>(built: health page)"]

    subgraph Server["Self-hosted server (Docker Compose)"]
        API["FastAPI backend<br/>(built: /api/health)"]
        DB[("SQLite<br/>SQLModel + Alembic<br/>(built: empty schema)")]
        Extract["Extraction plugins<br/>recipe / DIY / lyrics<br/>(planned)"]
        LLM["LLM provider interface<br/>(built) + providers<br/>(planned)"]
        Export["Exporters<br/>CSV / Mealie<br/>(planned)"]
    end

    Mealie["Mealie instance<br/>(planned)"]

    Ext -->|"save locally"| Store
    Ext -.->|"sync (planned)"| API
    Web -->|"GET /api/health (built)"| API
    Web -.->|"browse / export (planned)"| API
    API --> DB
    API -.-> Extract
    Extract -.->|"fallback only"| LLM
    API -.-> Export
    Export -.->|"REST API"| Mealie

    classDef built fill:#1f3d2b,stroke:#58d68d,color:#e8e8f0;
    classDef planned fill:#2a2a36,stroke:#9a9aae,stroke-dasharray:5 5,color:#e8e8f0;
    class Ext,Web,API,DB,LLM built;
    class Store,Extract,Export,Mealie planned;
```

Reading the diagram: the extension is useful without the server (local-first). Sync is an explicit
action. The backend never scrapes on behalf of the extension without being asked; extraction happens
when the user syncs or explicitly requests it.

## Planned main flow

This is the flow we build towards; nothing below except saving the backend URL/health check exists
yet.

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Ext as Browser extension
    participant Local as browser.storage.local
    participant API as FastAPI backend
    participant DB as SQLite
    participant Ex as Extraction plugin
    participant LLM as LLM provider
    participant Export as Exporter
    participant Mealie as Mealie

    User->>Ext: Right-click page → choose category (e.g. Recipes)
    Ext->>Local: Store page (URL, title, category, timestamp)
    Note over Ext,Local: Works offline, no account required (planned M1)

    User->>Ext: Click "Sync"
    Ext->>API: POST /api/items (JSON)
    API->>DB: Upsert item for current user
    API-->>Ext: Synced item (id, extraction status)

    API->>Ex: Extract structured data
    Ex->>Ex: schema.org JSON-LD / recipe-scrapers (cheap, deterministic)
    alt Script-based extraction failed
        Ex->>LLM: Send page text, ask for structured JSON
        LLM-->>Ex: Structured JSON (validated by Pydantic)
    end
    Ex->>DB: Save validated Recipe/item

    User->>API: Browse, filter by category/tag
    API-->>User: Item list (served by PWA)

    User->>API: Export (CSV or Mealie)
    API->>Export: Convert internal JSON
    Export-->>User: CSV download
    Export->>Mealie: POST recipe (REST API)
    Mealie-->>User: Recipe in Mealie
```

## Data model (planned)

The internal format stays JSON. Recipes follow [schema.org/Recipe] as closely as practical, so
script-based extraction and later LLM output can be validated against one model. A first sketch
(from the old prototype, to be formalised in M1/M3):

| Field                               | Meaning                                                                |
| ----------------------------------- | ---------------------------------------------------------------------- |
| `id`, `url`, `title`, `description` | Identity and basic page metadata                                       |
| `category`                          | `recipes`, `diy`, `lyrics` (see `packages/shared`)                     |
| `tags[]`                            | Free-form labels, used for filtering                                   |
| `notes`                             | User's own note                                                        |
| `created_at`, `updated_at`          | Timestamps (UTC)                                                       |
| `recipe`                            | Optional structured recipe (ingredients, instructions, servings, time) |

CSV is an **export format only**, never the storage format.

## API

The backend owns the contract. FastAPI generates OpenAPI docs automatically at `/docs`.

| Endpoint                             | Status  | Purpose                                    |
| ------------------------------------ | ------- | ------------------------------------------ |
| `GET /api/health`                    | built   | Liveness + version, used by Docker/web app |
| `POST /api/items`                    | planned | Sync a saved item                          |
| `GET /api/items`                     | planned | List/filter the current user's items       |
| `POST /api/items/{id}/extract`       | planned | Run extraction explicitly                  |
| `GET /api/items/export.csv`          | planned | CSV export                                 |
| `POST /api/items/{id}/export/mealie` | planned | Push a recipe to Mealie                    |

## Key design decisions

- **Local-first extension.** Saving a page must never depend on a server being reachable. Sync is
  separate and retryable.
- **Script-based extraction before LLM.** Deterministic parsers are cheap, testable and private;
  the LLM is only a fallback behind a provider interface (`backend/app/llm/base.py`). Tests mock it,
  never call a real API.
- **One internal JSON model, many exporters.** Mealie/CSV/PDF are adapters, so adding an export
  target never changes storage.
- **Backend as the source of truth for synced data.** The web app and extension talk to it over a
  documented REST API; they do not share a database.
- **Same-origin API calls in production.** nginx proxies `/api` to FastAPI so the PWA needs no CORS
  and no hard-coded backend URL. CORS remains available for the extension.
- **Reproducible toolchain in Docker.** Node/pnpm/Python/uv live in `docker/tools`, so no local
  toolchain drift between the two team members and CI.

[schema.org/Recipe]: https://schema.org/Recipe
