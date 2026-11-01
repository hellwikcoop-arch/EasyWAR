// Окрема збірка EasyFLY для телефона (iPhone): лише сторінка src/mobile/easyfly/index.html і код,
// який вона імпортує (спільне ядро src/workspace/easyfly/). Без 3D-моделей, карт і решти
// EasyWAR, тож dist-easyfly-phone/ важить менше мегабайта; саме цю теку бере iOS-оболонка
// mobile/easyfly-ios/ (frontendDist). Основна збірка `npm run build` цієї сторінки не містить.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  root: "src/mobile/easyfly",
  publicDir: "public",
  base: "./",
  clearScreen: false,
  server: { port: 5174, strictPort: true, host: process.env.TAURI_DEV_HOST || false },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    outDir: "../../../dist-easyfly-phone",
    emptyOutDir: true,
    target: "safari15",
    minify: !process.env.TAURI_ENV_DEBUG,
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
    rolldownOptions: {
      input: { index: fileURLToPath(new URL("./src/mobile/easyfly/index.html", import.meta.url)) },
    },
  },
});
