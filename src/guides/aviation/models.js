// Файли моделей довідника. Шлях у new URL(...) має бути дослівним, щоб Vite поклав файл у збірку.
export const MODEL_URLS = {
  ka52: new URL('./models/ka52.glb', import.meta.url).href,
  ka50: new URL('./models/ka50.glb', import.meta.url).href,
  ka27: new URL('./models/ka27.glb', import.meta.url).href,
  mi26: new URL('./models/mi26.glb', import.meta.url).href,
  mi35: new URL('./models/mi35.glb', import.meta.url).href,
  mi8tv: new URL('./models/mi8tv.glb', import.meta.url).href,
  mi2: new URL('./models/mi2.glb', import.meta.url).href,
  an26: new URL('./models/an26.glb', import.meta.url).href,
  an225: new URL('./models/an225.glb', import.meta.url).href,
  tu22: new URL('./models/tu22.glb', import.meta.url).href,
  tu95: new URL('./models/tu95.glb', import.meta.url).href,
  fp5: new URL('./models/fp5.glb', import.meta.url).href,
  fp7: new URL('./models/fp7.glb', import.meta.url).href,
};

// Ландшафт для польотного режиму (спільний файл БпАК і авіації).
export const LAND_URL = new URL('../shared/landscape-flight.glb', import.meta.url).href;
