import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "");

  return {
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    build: {
      chunkSizeWarningLimit: 800,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) {
              return undefined;
            }

            if (
              id.includes("node_modules/react") ||
              id.includes("node_modules/react-dom") ||
              id.includes("react-router-dom")
            ) {
              return "react-vendor";
            }

            if (id.includes("firebase")) {
              return "firebase";
            }

            if (id.includes("jspdf") || id.includes("html2canvas")) {
              return "pdf-tools";
            }

            if (
              id.includes("d3-geo") ||
              id.includes("topojson") ||
              id.includes("world-atlas")
            ) {
              return "maps-geo";
            }

            if (id.includes("@google/generative-ai")) {
              return "google-gen-ai";
            }

            return undefined;
          },
        },
      },
    },
    server: {
      proxy: {
        "/api": {
          target: env.VITE_DEV_API_PROXY ?? "http://localhost:3001",
          changeOrigin: true,
        },
      },
    },
    base: "/",
  };
});
