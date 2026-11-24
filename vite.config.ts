import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, "index.html"),
        monitor: resolve(import.meta.dirname, "monitor.html"),
        admin: resolve(import.meta.dirname, "admin.html"),
        spettatore: resolve(import.meta.dirname, "spettatore.html"),
      },
    },
  },
});
