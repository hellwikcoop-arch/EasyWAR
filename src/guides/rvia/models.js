// Файли моделей довідника. Шлях у new URL(...) має бути дослівним, щоб Vite поклав файл у збірку.
export const MODEL_URLS = {
  sapsan: new URL('./models/sapsan.glb', import.meta.url).href,
  tochka: new URL('./models/tochka.glb', import.meta.url).href,
  uragan: new URL('./models/uragan.glb', import.meta.url).href,
  bastion: new URL('./models/bastion.glb', import.meta.url).href,
  caesar: new URL('./models/caesar.glb', import.meta.url).href,
  bogdana: new URL('./models/bogdana.glb', import.meta.url).href,
  m10: new URL('./models/m10.glb', import.meta.url).href,
  giatsint: new URL('./models/giatsint.glb', import.meta.url).href,
  d30: new URL('./models/d30.glb', import.meta.url).href,
  fh70: new URL('./models/fh70.glb', import.meta.url).href,
  m198: new URL('./models/m198.glb', import.meta.url).href,
  vilkha: new URL('./models/vilkha.glb', import.meta.url).href,
};

// Ландшафт (фотограмметрія), що рухається під машиною; спільний файл довідників наземних систем.
export const LAND_URL = new URL('../shared/landscape-ground.glb', import.meta.url).href;
