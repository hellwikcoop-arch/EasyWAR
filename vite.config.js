import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

// Офлайн-кеш для мобільного перегляду (viewer.html): після збірки записує dist/sw.js
// зі списком усіх файлів. Версія кешу береться з package.json, тож нова збірка
// замінює старий кеш. 3D-моделі (.glb), переглядач літаків (aircraft-viewer.html, aircraft-3d/),
// відео заставки (.mp4), ресурси 3D-карти (map-assets, >100 МБ) і 3D-довідники (сторінки й
// скрипти guides*, їхні шрифти .woff2), а також прототип EasySlide (workspace/easyslide/, deckcraft-web*) у кеш не входять: у вікнах командування вони не потрібні,
// моделі важать десятки мегабайтів, а заставка є лише в застосунку.
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
          else {
            const rel = relative(out, full).split("\\").join("/");
            if (name !== "sw.js" && !name.endsWith(".map") && !name.endsWith(".glb") && !name.endsWith(".mp4") && !name.endsWith(".woff2") && name !== "aircraft-viewer.html" && !full.includes(`${sep}aircraft-3d${sep}`) && !/(^|\/)guides[-/]/.test(rel) && !rel.startsWith("map-assets/") && !rel.startsWith("workspace/easyslide/") && !/deckcraft-web|easyslide/.test(rel)) files.push("./" + rel);
          }
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
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE && key.startsWith("easywar-viewer-")).map((key) => caches.delete(key)))).then(() => self.clients.claim()).catch(() => {}));
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
        // EasySlide (прототип): редактор презентацій на веб-збірці DeckCraft для модуля «Робоче середовище» → «Офіс».
        easyslide: fileURLToPath(new URL("./src/workspace/easyslide/index.html", import.meta.url)),
        // 3D-довідники: хаб і шість довідників; лаунчер відкриває хаб в iframe-накладці (src/guides-launcher.js).
        guides: fileURLToPath(new URL("./src/guides/index.html", import.meta.url)),
        "guides-rvia": fileURLToPath(new URL("./src/guides/rvia/index.html", import.meta.url)),
        "guides-ppo": fileURLToPath(new URL("./src/guides/ppo/index.html", import.meta.url)),
        "guides-ground-forces": fileURLToPath(new URL("./src/guides/ground-forces/index.html", import.meta.url)),
        "guides-uav": fileURLToPath(new URL("./src/guides/uav/index.html", import.meta.url)),
        "guides-aviation": fileURLToPath(new URL("./src/guides/aviation/index.html", import.meta.url)),
        "guides-enemy-ground": fileURLToPath(new URL("./src/guides/enemy-ground/index.html", import.meta.url)),
      },
    },
  },
});
