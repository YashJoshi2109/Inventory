import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Builds the PWA that the host embeds and serves from localhost.
 *
 * Everything is bundled and emitted relative: the page has to load from a file
 * inside a PyInstaller bundle on a machine that has never had internet. No CDN
 * links, no external fonts, no absolute asset paths.
 */
export default defineConfig({
  root: "app",
  base: "./",
  plugins: [react()],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    target: "es2020",
    // One JS file and one CSS file keeps the bundle trivially inspectable and
    // avoids any chance of a lazy chunk failing to resolve offline.
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: "assets/app.js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
});
