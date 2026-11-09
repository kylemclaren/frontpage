import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// The Bun API server runs on API_PORT in dev (see scripts/dev.ts); Vite proxies /api to it.
const apiPort = process.env.API_PORT || "4792"
// Absolute origin for social preview tags in index.html (link previews need absolute URLs).
const siteUrl = (process.env.SITE_URL || "http://localhost:4791").replace(/\/$/, "")

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    { name: "site-url", transformIndexHtml: (html) => html.replaceAll("%SITE_URL%", siteUrl) },
  ],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    port: Number(process.env.PORT || 4791),
    strictPort: true,
    proxy: { "/api": `http://localhost:${apiPort}` },
  },
})
