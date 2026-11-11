#!/bin/sh
# Start the Playwright MCP server for testing the browser extension.
#
# MCP (Model Context Protocol) lets an AI agent such as Claude Code use tools.
# This server gives the agent a browser: it can open pages, click, type, read
# the page and take screenshots. `.mcp.json` in the repo root tells Claude Code
# to start this script; the agent talks to it over stdin/stdout.
#
# Everything runs in Microsoft's official Docker image, so no Node.js is needed
# on the host. The image contains a headless Chromium; the Chrome build of our
# extension is loaded into it (see config.json next to this file).
#
# Limits: the native right-click menu cannot be clicked, and Firefox cannot load
# the extension this way. Saving via the context menu stays a manual test.

# Stop on the first failing command.
set -e

# Work from the repo root, wherever the script is started from.
cd "$(dirname "$0")/../.."

EXTENSION_DIR="$PWD/apps/extension/.output/chrome-mv3"
if [ ! -f "$EXTENSION_DIR/manifest.json" ]; then
  # stdout belongs to the MCP protocol, so messages for humans go to stderr.
  echo "Extension build missing. Run 'make build' first." >&2
  exit 1
fi

# `exec` replaces this shell with Docker, so stopping the server stops Docker.
# -i             keep stdin open; MCP messages arrive there
# --rm           delete the container when the session ends
# --init         forward stop signals to the server process
# --network host the browser reaches the local stack on localhost:3000/8000
# -v ...:/ext:ro the extension, read-only, always under the same path; Chromium
#                derives the extension ID from that path, so the ID stays fixed
# The image is pinned by digest (version 0.0.85), so every run uses the same
# browser and server. To update, pull the new image and replace the digest.
exec docker run -i --rm --init --network host \
  -v "$EXTENSION_DIR:/ext:ro" \
  -v "$PWD/docker/playwright-mcp/config.json:/config/config.json:ro" \
  mcr.microsoft.com/playwright/mcp@sha256:91838ad4927e574dcf787dd677e63c924b80f4adba6fe8ce47b92fab4a7841d6 \
  --config /config/config.json
