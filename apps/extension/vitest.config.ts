// Vitest configuration for the extension.
//
// WXT's `WxtVitest` plugin plugs the project's real WXT config into Vitest:
// - it replaces `browser` with an in-memory fake browser,
// - it applies WXT's aliases and auto-imports,
// - it loads the React module configured in wxt.config.ts.
//
// The React plugin is therefore not imported here separately. Tests still run
// in jsdom because popup components need a DOM.
import { defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing/vitest-plugin";

export default defineConfig(async () => ({
  // WxtVitest is async because it resolves wxt.config.ts before returning the
  // Vite plugins. Top-level await (allowed in this ESM config) keeps the
  // resulting plugin array flat and easy to read.
  plugins: [await WxtVitest()],
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    include: ["entrypoints/**/*.test.{ts,tsx}", "lib/**/*.test.{ts,tsx}"],
  },
}));
