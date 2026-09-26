import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  root: "src",
  base: "./",
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    target:
      process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: !process.env.TAURI_ENV_DEBUG,
    // The preserved launcher CSS contains browser-tolerated declarations that
    // the CSS minifier rejects; keep the source styles unchanged.
    cssMinify: false,
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
    // Launcher plus the two branch modules it opens in same-origin iframes.
    rolldownOptions: {
      input: {
        index: fileURLToPath(new URL("./src/index.html", import.meta.url)),
        air: fileURLToPath(new URL("./src/air.html", import.meta.url)),
        rocket: fileURLToPath(new URL("./src/rocket.html", import.meta.url)),
      },
    },
  },
});
