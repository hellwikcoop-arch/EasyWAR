// Чиста логіка 3D-емблем стартового екрана: які картки мають рендер, скільки кадрів у смузі,
// який кадр показати за положенням курсора. Без DOM, щоб перевіряти в node --test.
// Показ — start-emblems.js, стилі — start-emblems.css, смуги кадрів — public/emblem-3d/ (копіюються у збірку як є, бо шлях будує скрипт).

// Кожна емблема відрендерена у Blender як металевий рельєф: 13 кадрів повороту від −30° до +30°
// за віссю Y (і −7°…+7° за X), перспективна камера; центральний кадр 6 — пряме положення.
// Смуга — один webp, кадри зліва направо, кожен 320 px завширшки; пропорції = ширина / висота кадру.
export const EMBLEM_FRAMES = 13;

// Картки стартового екрана → файл смуги і пропорції кадру (ширина / висота).
// ПВК і УДШВ — картки командувань (`data-cmd-card`), решта — `.branch-card[data-branch]`.
export const EMBLEMS = Object.freeze({
  air: Object.freeze({ file: 'air.webp', aspect: 320 / 188 }),
  rocket: Object.freeze({ file: 'rocket.webp', aspect: 320 / 326 }),
  artillery: Object.freeze({ file: 'artillery.webp', aspect: 320 / 188 }),
  army: Object.freeze({ file: 'army.webp', aspect: 320 / 266 }),
  pvk: Object.freeze({ file: 'pvk.webp', aspect: 320 / 279 }),
  dshv: Object.freeze({ file: 'dshv.webp', aspect: 320 / 287 }),
});

export const EMBLEM_DIR = './emblem-3d/';

// Картка командування → ключ емблеми (атрибут aria-controls плитки: pvk-tile → pvk).
export function commandEmblemKey(ariaControls) {
  const key = String(ariaControls || '').replace(/-tile$/, '');
  return Object.hasOwn(EMBLEMS, key) ? key : null;
}

export const CENTER_FRAME = (EMBLEM_FRAMES - 1) / 2;

// Положення курсора по ширині картки (−1 ліворуч … 1 праворуч, як --ew-tx у start-tech) → номер кадру.
// Поза межами — крайні кадри; не число — центральний.
export function frameIndex(tx, frames = EMBLEM_FRAMES) {
  const t = Number(tx);
  if (!Number.isFinite(t)) return (frames - 1) / 2;
  const clamped = Math.max(-1, Math.min(1, t));
  return Math.round((clamped + 1) / 2 * (frames - 1));
}

// Відсоток для background-position-x смуги: кадр k з N → k / (N − 1) · 100 %.
export function framePosition(frame, frames = EMBLEM_FRAMES) {
  return `${(frame / (frames - 1) * 100).toFixed(3)}%`;
}

// Коли емблема має крутитися за курсором: не при «зменшити рух» і не з вимкненими анімаціями.
export function shouldTurn({ reducedMotion = false, motionOff = false } = {}) {
  return !reducedMotion && !motionOff;
}
