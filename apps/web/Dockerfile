# Dockerfile for the web app.
#
# Stage 1 builds the static files with Node + pnpm (inside the container, so
# nobody needs Node on their laptop). Stage 2 serves them with nginx and
# proxies /api to the backend container. The build context is the repo root
# because the app imports @project-pocket/shared from packages/shared.

FROM node:24-bookworm-slim AS build

# Install the exact pnpm version from package.json's "packageManager" field.
RUN npm install -g pnpm@12.15.0

WORKDIR /repo

# Copy only manifests/lockfile first: this layer is cached until dependencies
# change, so source edits do not reinstall node_modules.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/extension/package.json apps/extension/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json

# Install the web app and its workspace dependencies only (not the extension).
RUN pnpm install --frozen-lockfile --filter web...

# Now copy the sources needed for the build.
COPY packages/shared packages/shared
COPY apps/web apps/web

# Vite writes the production bundle to apps/web/dist.
RUN pnpm --filter web build

# ── Runtime image ────────────────────────────────────────────────────────────
FROM nginx:1.29-alpine

# Our nginx config replaces the default site config.
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

# Static files produced in the build stage.
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html

EXPOSE 80

# nginx's official image already defines the foreground CMD.
