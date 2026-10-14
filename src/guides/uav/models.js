// Файли моделей довідника. Шлях у new URL(...) має бути дослівним, щоб Vite поклав файл у збірку.
export const MODEL_URLS = {
  tb2: new URL('./models/tb2.glb', import.meta.url).href,
  d1l: new URL('./models/d1l.glb', import.meta.url).href,
  sky: new URL('./models/sky.glb', import.meta.url).href,
  sh: new URL('./models/sh.glb', import.meta.url).href,
};

// Ландшафт для польоту (спільний файл БпАК і авіації).
export const LAND_URL = new URL('../shared/landscape-flight.glb', import.meta.url).href;
