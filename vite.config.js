import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

// Офлайн-кеш для мобільного перегляду (viewer.html): після збірки записує dist/sw.js
// зі списком усіх файлів. Версія кешу береться з package.json, тож нова збірка
// замінює старий кеш. 3D-моделі (.glb), переглядач літаків (aircraft-viewer.html, aircraft-3d/),
// відео заставки (.mp4) і ресурси 3D-карти (map-assets, >100 МБ) у кеш не входять: у вікнах
// командування вони не потрібні, моделі важать десятки мегабайтів, а заставка є лише в застосунку.
// Сервіс-воркер реєструє лише viewer.html; у застосунку Tauri його немає.
function viewerServiceWorker() {
  return {
    name: "easywar-viewer-sw",
    apply: "build",
    closeBundle() {
      const out = fileURLToPath(new URL("./dist", import.meta.url));
      const files = [];
      const walk = (dir) => {
        for (const name of readdirSync(dir)) {
          const full = join(dir, name);
          if (statSync(full).isDirectory()) walk(full);
          else if (name !== "sw.js" && !name.endsWith(".map") && !name.endsWith(".glb") && !name.endsWith(".mp4") && name !== "aircraft-viewer.html" && !full.includes(`${sep}aircraft-3d${sep}`) && !relative(out, full).split("\\").join("/").startsWith("map-assets/")) files.push("./" + relative(out, full).split("\\").join("/"));
        }
      };
      walk(out);
      const version = JSON.parse(readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8")).version;
      const source = `// Згенеровано vite.config.js. Не редагувати.
const CACHE = "easywar-viewer-${version}";
const FILES = ${JSON.stringify(files.sort())};
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE && key.startsWith("easywar-viewer-")).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(caches.match(event.request, { ignoreSearch: true }).then((hit) => hit || fetch(event.request)));
});
`;
      writeFileSync(join(out, "sw.js"), source);
    },
  };
}

export default defineConfig({
  root: "src",
  plugins: [viewerServiceWorker()],
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
    // Launcher plus the branch modules it opens in same-origin iframes; map.html — 3D-карта, яку вкладки «Карта» ПС і РВ вбудовують в iframe.
    rolldownOptions: {
      input: {
        index: fileURLToPath(new URL("./src/index.html", import.meta.url)),
        air: fileURLToPath(new URL("./src/air.html", import.meta.url)),
        rocket: fileURLToPath(new URL("./src/rocket.html", import.meta.url)),
        artillery: fileURLToPath(new URL("./src/artillery.html", import.meta.url)),
        map: fileURLToPath(new URL("./src/map.html", import.meta.url)),
        viewer: fileURLToPath(new URL("./src/viewer.html", import.meta.url)),
        // Літаки у вкладці «Довідник» (ПС): окрема сторінка зі своєю сценою, відкривається в кадрі.
        aircraftViewer: fileURLToPath(new URL("./src/aircraft-viewer.html", import.meta.url)),
      },
    },
  },
});
