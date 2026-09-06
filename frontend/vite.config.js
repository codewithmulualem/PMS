import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, copyFileSync } from "node:fs";

const root = dirname(fileURLToPath(import.meta.url));

// The mobile prototype is a second HTML entry (prototype.html) built alongside
// the main app as a Vite multi-page app. The dev/preview servers serve it at a
// clean `/prototype` URL; on build we also emit `dist/prototype/index.html` so
// any static host can resolve `/prototype` (via `/prototype/` -> index).
function servePrototype() {
  return {
    name: "prototype-url",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = (req.url || "").split("?")[0];
        if (url === "/prototype" || url === "/prototype/") {
          req.url = "/prototype.html";
        }
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = (req.url || "").split("?")[0];
        if (url === "/prototype" || url === "/prototype/") {
          req.url = "/prototype.html";
        }
        next();
      });
    },
    closeBundle() {
      const outDir = resolve(root, "dist");
      mkdirSync(resolve(outDir, "prototype"), { recursive: true });
      copyFileSync(resolve(outDir, "prototype.html"), resolve(outDir, "prototype", "index.html"));
    },
  };
}

export default defineConfig({
  plugins: [react(), servePrototype()],
  root,
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        main: resolve(root, "index.html"),
        prototype: resolve(root, "prototype.html"),
      },
    },
  },
  server: {
    port: 5173,
    // Same-origin dev: proxy API calls to the Flask backend so browsers never
    // deal with cross-origin CORS when opening http://localhost:5173.
    proxy: {
      "/api": "http://127.0.0.1:5001",
    },
  },
  preview: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:5001",
    },
  },
});