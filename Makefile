# Project Pocket — developer commands.
#
# Everything runs inside Docker, so no Node, pnpm, Python or uv is required on
# the host. `make install` is always the first step after cloning.
#
# The tools container is defined in docker-compose.yml (profile "tools") and
# bind-mounts the repo at /workspace.
COMPOSE ?= docker compose
TOOLS = $(COMPOSE) run --rm -T tools

.PHONY: help install lint lint-fix format format-check typecheck test build build-firefox build-all backend-lint backend-test verify up down logs dev-web dev-backend

help: ## Show this help
	@grep -E '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

install: ## Install JS dependencies and the Python virtualenv (in Docker)
	$(TOOLS) sh -c "pnpm install && cd backend && uv sync"

lint: ## Run ESLint over all TypeScript packages
	$(TOOLS) pnpm lint

lint-fix: ## Auto-fix ESLint issues
	$(TOOLS) pnpm lint:fix

format: ## Format all files with Prettier
	$(TOOLS) pnpm format

format-check: ## Check formatting without writing changes
	$(TOOLS) pnpm format:check

typecheck: ## TypeScript type check for shared, extension and web
	$(TOOLS) pnpm typecheck

test: ## Run all TypeScript tests (Vitest)
	$(TOOLS) pnpm test

build: ## Build the extension for Chrome and the web app
	$(TOOLS) pnpm build

build-firefox: ## Build the extension for Firefox
	$(TOOLS) pnpm build:firefox

build-all: ## Build extension (Chrome + Firefox) and web app
	$(TOOLS) pnpm build
	$(TOOLS) pnpm build:firefox

backend-lint: ## Ruff check + format check for the backend
	$(TOOLS) sh -c "cd backend && uv run ruff check . && uv run ruff format --check ."

backend-test: ## Run backend tests (pytest)
	$(TOOLS) sh -c "cd backend && uv run pytest"

verify: install format-check lint typecheck test build-all backend-lint backend-test ## Run the full Definition of Done locally

up: ## Start backend + web app with Docker
	$(COMPOSE) up --build

down: ## Stop the stack and remove containers (data volume is kept)
	$(COMPOSE) down

logs: ## Follow logs of the running stack
	$(COMPOSE) logs -f

dev-backend: ## Run the backend with auto-reload on http://localhost:8000
	$(COMPOSE) run --rm -T -p 8000:8000 tools sh -c "cd backend && uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"

dev-web: ## Run the Vite dev server on http://localhost:5173 (a backend must be running)
	$(COMPOSE) run --rm -T -p 5173:5173 -e VITE_DEV_API_TARGET=http://host.docker.internal:8000 tools pnpm --filter web dev --host 0.0.0.0
