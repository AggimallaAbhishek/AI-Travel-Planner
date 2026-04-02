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
    server: {
      proxy: {
        "/api": {
          target: env.VITE_DEV_API_PROXY ?? "http://localhost:3001",
          changeOrigin: true,
        },
      },
    },
    build: {
      chunkSizeWarningLimit: 650,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("node_modules/react-router-dom")) return "vendor-react";
            if (id.includes("node_modules/react-dom")) return "vendor-react";
            if (id.includes("node_modules/react")) return "vendor-react";
            if (id.includes("node_modules/jspdf")) return "vendor-pdf";
            if (id.includes("node_modules/d3-geo")) return "vendor-maps";
            if (id.includes("node_modules/topojson-client")) return "vendor-maps";
            if (id.includes("node_modules/react-icons")) return "vendor-ui";
            if (id.includes("node_modules/react-toastify")) return "vendor-ui";
            if (id.includes("node_modules/lucide-react")) return "vendor-ui";
            if (id.includes("src/components/voyagr/data.js")) return "voyagr-data";
            if (id.includes("src/data/indiaFeatured.generated.js")) return "india-featured";
            if (id.includes("shared/indiaDestinationIndex.generated.js")) return "india-index";
            return undefined;
          },
        },
      },
    },
    base: "/",
  };
});
