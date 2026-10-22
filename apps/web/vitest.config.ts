// Vitest configuration for the web app.
//
// The React plugin is needed to transform JSX. jsdom provides `document` so
// we can render components without a real browser.
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
