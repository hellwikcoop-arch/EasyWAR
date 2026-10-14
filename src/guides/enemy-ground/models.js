// Файли моделей довідника. Шлях у new URL(...) має бути дослівним, щоб Vite поклав файл у збірку.
export const MODEL_URLS = {
  pan: new URL('./models/pan.glb', import.meta.url).href,
  tung: new URL('./models/tung.glb', import.meta.url).href,
  buk1: new URL('./models/buk1.glb', import.meta.url).href,
  buk2: new URL('./models/buk2.glb', import.meta.url).href,
  s400: new URL('./models/s400.glb', import.meta.url).href,
  sa12: new URL('./models/sa12.glb', import.meta.url).href,
  r96: new URL('./models/r96.glb', import.meta.url).href,
  osa: new URL('./models/osa.glb', import.meta.url).href,
  isk: new URL('./models/isk.glb', import.meta.url).href,
  btr: new URL('./models/btr.glb', import.meta.url).href,
  mtl: new URL('./models/mtl.glb', import.meta.url).href,
  rp: new URL('./models/rp.glb', import.meta.url).href,
};

// Ландшафт (фотограмметрія), що рухається під машиною; спільний файл довідників наземних систем.
export const LAND_URL = new URL('../shared/landscape-ground.glb', import.meta.url).href;
