// Vite configuration for the web app.
//
// Vite serves the React app in development and bundles it for production.
// The PWA plugin generates a web manifest and a service worker so the app can
// be installed on a phone (see docs/ARCHITECTURE.md).
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // "autoUpdate" makes the installed app load the newest build on the next
      // visit instead of showing a "new version available" prompt.
      registerType: "autoUpdate",
      includeAssets: ["favicon.png"],
      manifest: {
        name: "Project Pocket",
        short_name: "Pocket",
        description: "Everything important from any page, in one pocket.",
        theme_color: "#7c6af7",
        background_color: "#0f0f13",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
    }),
  ],

  server: {
    port: 5173,
    // In development the browser calls /api/... on the Vite dev server; Vite
    // forwards those requests to the FastAPI backend. This keeps relative URLs
    // identical in development and production (where nginx proxies instead).
    // Inside Docker the backend host is "backend", so the Makefile overrides
    // this variable; on a native setup the default localhost:8000 works.
    proxy: {
      "/api": {
        target: process.env.VITE_DEV_API_TARGET ?? "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
