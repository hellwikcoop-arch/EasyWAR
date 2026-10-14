// Файли моделей довідника. Шлях у new URL(...) має бути дослівним, щоб Vite поклав файл у збірку.
export const MODEL_URLS = {
  abrams: new URL('./models/abrams.glb', import.meta.url).href,
  bradley: new URL('./models/bradley.glb', import.meta.url).href,
  marder: new URL('./models/marder.glb', import.meta.url).href,
  boxer: new URL('./models/boxer.glb', import.meta.url).href,
  hmmwv: new URL('./models/hmmwv.glb', import.meta.url).href,
  hemtt: new URL('./models/hemtt.glb', import.meta.url).href,
  goliath: new URL('./models/goliath.glb', import.meta.url).href,
  pk_m1a1: new URL('./models/pk_m1a1.glb', import.meta.url).href,
  pk_leopard1a4: new URL('./models/pk_leopard1a4.glb', import.meta.url).href,
  pk_m60: new URL('./models/pk_m60.glb', import.meta.url).href,
  pk_m48a2: new URL('./models/pk_m48a2.glb', import.meta.url).href,
  pk_m48a3: new URL('./models/pk_m48a3.glb', import.meta.url).href,
  pk_m4a3e8: new URL('./models/pk_m4a3e8.glb', import.meta.url).href,
  pk_centurion8: new URL('./models/pk_centurion8.glb', import.meta.url).href,
  pk_t3485: new URL('./models/pk_t3485.glb', import.meta.url).href,
  pk_pt76: new URL('./models/pk_pt76.glb', import.meta.url).href,
  pk_t55: new URL('./models/pk_t55.glb', import.meta.url).href,
  pk_t62: new URL('./models/pk_t62.glb', import.meta.url).href,
  pk_t72: new URL('./models/pk_t72.glb', import.meta.url).href,
  pk_t80: new URL('./models/pk_t80.glb', import.meta.url).href,
  pk_t90: new URL('./models/pk_t90.glb', import.meta.url).href,
  pk_type99tank: new URL('./models/pk_type99tank.glb', import.meta.url).href,
  pk_ee9: new URL('./models/pk_ee9.glb', import.meta.url).href,
};

// Ландшафт (фотограмметрія), що рухається під машиною; спільний файл довідників наземних систем.
export const LAND_URL = new URL('../shared/landscape-ground.glb', import.meta.url).href;
