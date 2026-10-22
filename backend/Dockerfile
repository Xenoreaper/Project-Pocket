# Dockerfile for the FastAPI backend.
#
# The image is based on uv's official Python 3.12 image, which already contains
# the uv package manager. Dependencies are installed from uv.lock, so the
# container gets exactly the versions the tests ran against.

FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

# Byte-compile installed packages for faster startup; copy (not symlink)
# packages from uv's cache into the venv so the image is self-contained.
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Layer 1: dependencies only. Re-run `docker compose build` without cache if a
# dependency was added.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev

# Layer 2: application code and migrations.
COPY app ./app
COPY alembic ./alembic
COPY alembic.ini ./

# Install the project itself (editable) into .venv.
RUN uv sync --frozen --no-dev

# Put the virtualenv's binaries (uvicorn, alembic) on PATH.
ENV PATH="/app/.venv/bin:$PATH"

# SQLite lives on the Compose volume mounted at /app/data.
EXPOSE 8000

# Apply pending migrations, then start the API server. `exec` replaces the
# shell process so Docker can stop the server with SIGTERM properly.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000"]
