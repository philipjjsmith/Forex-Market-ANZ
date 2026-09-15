import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

export default defineConfig({
  plugins: [
    react(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    // Everything used to ship as ONE chunk. Routes are code-split in App.tsx; this
    // pulls the framework out on top of that, so a deploy that only changes app code
    // does not invalidate React in everyone's cache. Heavy leaves (recharts,
    // lightweight-charts) are deliberately NOT named here - Rollup already places
    // them with the routes that import them, and naming them would force them back
    // into a chunk the entry has to wait for.
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          query: ["@tanstack/react-query"],
        },
      },
    },
    // The previous 1.27 MB single chunk sat far above the default 500 kB warning, so
    // the warning was permanent noise. Lowered to a level the split build should hold.
    chunkSizeWarningLimit: 400,
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
