# Development toolchain image (Node + pnpm + uv + Python).
#
# This image is NOT used in production. It exists so every developer and CI-like
# check runs the same versions without installing Node or Python on the host:
#
#   docker compose run --rm -T tools pnpm -r test
#   docker compose run --rm -T tools sh -c "cd backend && uv run pytest"
#
# The repository is bind-mounted at /workspace by docker-compose.yml, so edits
# on the host are visible immediately. node_modules and .venv are created
# inside that mount (Linux binaries): that is intended — use this image, not a
# native toolchain, to stay reproducible.

FROM node:24-bookworm-slim

# curl is used to install uv; ca-certificates makes HTTPS downloads work.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# Pin pnpm to the version in package.json ("packageManager") so the lockfile
# is always interpreted by the same release.
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH
RUN npm install -g pnpm@12.15.0 \
    && pnpm config set store-dir /pnpm/store --global

# uv manages the Python toolchain: it downloads a standalone CPython 3.12 into
# the image, so no system Python or pyenv is needed.
ENV UV_PYTHON=3.12
RUN curl -LsSf https://astral.sh/uv/install.sh | sh \
    && mv /root/.local/bin/uv /usr/local/bin/uv \
    && mv /root/.local/bin/uvx /usr/local/bin/uvx \
    && uv python install 3.12

WORKDIR /workspace

# Interactive fallback when someone runs the container without a command.
CMD ["bash"]
