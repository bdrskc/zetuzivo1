import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// ZET uživo frontend. HTTP and WebSocket are proxied to the Python backend
// so the page and the feed share one origin (see docs/BUILD.md).
const port = Number(process.env.VOZLINIA_WEB_PORT || 5173);

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port,
    strictPort: true,
    proxy: {
      "/ws": { target: "http://127.0.0.1:5000", ws: true },
      "/static": { target: "http://127.0.0.1:5000", changeOrigin: true },
      "/news": { target: "http://127.0.0.1:5000", changeOrigin: true },
      "/api": { target: "http://127.0.0.1:5000", changeOrigin: true },
      "/privacy.html": { target: "http://127.0.0.1:5000", changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    target: "es2020",
  },
});
