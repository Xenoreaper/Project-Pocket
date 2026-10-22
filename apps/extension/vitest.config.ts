// Vitest configuration for the extension popup.
//
// WXT's own build pipeline is not used for tests; we render the React
// component directly with Testing Library in a simulated browser (jsdom).
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    include: ["entrypoints/**/*.test.{ts,tsx}"],
  },
});
