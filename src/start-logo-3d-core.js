// Чиста логіка 3D-логотипа стартового екрана: де на логотипі стоїть тризуб, як положення курсора
// стає кадром повороту. Без DOM, щоб перевіряти в node --test.
// Показ — start-logo-3d.js, стилі — start-logo-3d.css, файли — public/emblem-3d/logo-*.webp.
import { frameIndex, framePosition, shouldTurn } from './start-emblems-core.js';

export { frameIndex, framePosition, shouldTurn };

// Логотип easyWAR (src/index.html, .start-brand-art, 860 × 958 px): тризуб вирізано з нього й
// відрендерено в Blender як золотий рельєф (13 кадрів −30°…+30°, як емблеми карток);
// решта логотипа (кільце, карта, напис) лишається плоскою в logo-base.webp — тій самій картинці
// з заповненим місцем тризуба. `box` — рамка кадру смуги у пікселях логотипа-джерела:
// центральний кадр у ній збігається з плоским тризубом.
export const LOGO = Object.freeze({
  strip: 'logo-trident.webp',
  base: 'logo-base.webp',
  frames: 13,
  image: Object.freeze({ width: 860, height: 958 }),
  box: Object.freeze({ left: 274.9, top: 216.2, width: 309.7, height: 486.1 }),
  aspect: 300 / 471,
});

export const LOGO_CENTER_FRAME = (LOGO.frames - 1) / 2;

// Рамка у пікселях зображення → відсотки для position:absolute усередині обгортки логотипа.
export function boxStyle(box = LOGO.box, image = LOGO.image) {
  const pct = (v, total) => `${(v / total * 100).toFixed(3)}%`;
  return {
    left: pct(box.left, image.width),
    top: pct(box.top, image.height),
    width: pct(box.width, image.width),
    height: pct(box.height, image.height),
  };
}

// Положення курсора на екрані → нахил −1…1 відносно центра логотипа: повний поворот на відстані
// однієї ширини логотипа від його центра, далі — крайній кадр.
export function logoTilt(clientX, rect) {
  const width = Number(rect?.width);
  if (!Number.isFinite(width) || width <= 0) return 0;
  const center = rect.left + width / 2;
  return Math.max(-1, Math.min(1, (clientX - center) / width));
}
