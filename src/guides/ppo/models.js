// Файли моделей довідника. Шлях у new URL(...) має бути дослівним, щоб Vite поклав файл у збірку.
export const MODEL_URLS = {
  patriot: new URL('./models/patriot.glb', import.meta.url).href,
  nasams: new URL('./models/nasams.glb', import.meta.url).href,
  iris: new URL('./models/iris.glb', import.meta.url).href,
  sky: new URL('./models/sky.glb', import.meta.url).href,
  mamba: new URL('./models/mamba.glb', import.meta.url).href,
  shilka: new URL('./models/shilka.glb', import.meta.url).href,
  kub: new URL('./models/kub.glb', import.meta.url).href,
  nomads: new URL('./models/nomads.glb', import.meta.url).href,
};

// Ландшафт (фотограмметрія), що рухається під машиною; спільний файл довідників наземних систем.
export const LAND_URL = new URL('../shared/landscape-ground.glb', import.meta.url).href;
