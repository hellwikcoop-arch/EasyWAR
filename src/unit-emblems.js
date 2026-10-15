// Емблеми підрозділів для модулів і дашбордів: адреси файлів із src/unit-art (лише у збірці Vite; у Node адрес немає).
import { emblemFile } from './unit-emblems-core.js';

let URLS = {};
try { URLS = import.meta.glob('./unit-art/*.webp', { eager: true, query: '?url', import: 'default' }); } catch { URLS = {}; }

/** Адреса емблеми за назвою підрозділу або null. */
export const emblemOf = name => {
  const file = emblemFile(name);
  return file ? URLS[`./unit-art/${file}.webp`] || null : null;
};

/** <img class="crest …"> для підрозділу; cls — додатковий клас розміру. Без емблеми: null, а з placeholder — порожній блок того ж розміру,
 *  щоб назви в колонці стояли рівно. */
export function crestImg(name, cls = '', placeholder = false) {
  const src = emblemOf(name);
  if (!src) {
    if (!placeholder) return null;
    const ph = document.createElement('span');
    ph.className = `crest crest-ph ${cls}`.trim();
    ph.setAttribute('aria-hidden', 'true');
    return ph;
  }
  const img = document.createElement('img');
  img.className = `crest ${cls}`.trim();
  img.src = src; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
  return img;
}
