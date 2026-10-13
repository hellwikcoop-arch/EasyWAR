// Чиста логіка заставки easyWAR: таймінги, перелік плиток, прогрес завантаження.
// Без DOM, щоб її можна було перевірити в node --test. Інтерфейс — у startup-splash.js.

// Мілісекунди від початку відео. Відео має ту саму довжину (5,33 с), плитки
// починають з'являтися під його кінець, смужка завантаження — одразу після нього.
export const SPLASH = Object.freeze({
  videoMs: 5333,
  // Слоган, вшитий у відео («ОБЕРИ СВІЙ РІД ВІЙСЬК»), набирається приблизно з 2,6 с.
  // Табличка з новим текстом накриває його до цього моменту, текст з'являється, коли логотип уже зібрався.
  plateInMs: 2450,
  sloganInMs: 3500,
  tilesStartMs: 4800,
  tileStaggerMs: 280,
  progressMinMs: 1300,
  holdMs: 250,
  fadeOutMs: 550,
  // Якщо відео не стартувало за цей час, заставка не затримує запуск.
  startTimeoutMs: 2500,
});

// Ті самі роди військ і командування, що на стартовому екрані. Лише підписи, без посилань:
// заставка не є навігацією.
export const SPLASH_TILES = Object.freeze([
  Object.freeze({ id: 'air', label: 'Повітряні Сили' }),
  Object.freeze({ id: 'rocket', label: 'Ракетні Війська' }),
  Object.freeze({ id: 'artillery', label: 'Артилерія' }),
  Object.freeze({ id: 'pvk', label: 'ПВК' }),
  Object.freeze({ id: 'dshv', label: 'УДШВ' }),
]);

// Слоган під логотипом. Змінити текст можна тут, більше ніде.
export const SPLASH_SLOGAN = 'Оперативний облік і аналітика. Локально.';

// Відео повільно віддаляється від центру (≈ 50% × 37,5% кадру): масштаб 1,07 → 1,0.
// Виміряно за шириною слова «easyWAR» і старого слогана. Табличка зі слоганом їде за тим самим
// масштабом, тож відстань до логотипа не змінюється. Ключі: [мс від початку відео, масштаб].
export const VIDEO_ZOOM_KEYS = Object.freeze([[0, 1.07], [3600, 1.07], [4000, 1.054], [5333, 1.0]]);

export function videoZoom(clockMs, keys = VIDEO_ZOOM_KEYS) {
  if (clockMs <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i += 1) {
    const [t1, z1] = keys[i];
    if (clockMs <= t1) {
      const [t0, z0] = keys[i - 1];
      return z0 + ((z1 - z0) * (clockMs - t0)) / (t1 - t0);
    }
  }
  return keys[keys.length - 1][1];
}

export function tileDelayMs(index, plan = SPLASH) {
  return plan.tilesStartMs + Math.max(0, index) * plan.tileStaggerMs;
}

// Скільки плиток уже має бути видно в момент clockMs.
export function visibleTileCount(clockMs, count = SPLASH_TILES.length, plan = SPLASH) {
  let shown = 0;
  for (let i = 0; i < count; i += 1) if (clockMs >= tileDelayMs(i, plan)) shown = i + 1;
  return shown;
}

// Заставка потрібна, якщо користувач не просив менше руху.
export function shouldRunSplash({ reducedMotion = false } = {}) {
  return !reducedMotion;
}

// Частка заповнення смужки 0..1. До готовності лаунчера не доходить до кінця,
// тож смужка не обіцяє більше, ніж є насправді.
export function progressValue(loadingElapsedMs, ready, plan = SPLASH) {
  const base = Math.min(1, Math.max(0, loadingElapsedMs) / plan.progressMinMs);
  return ready ? base : Math.min(base, 0.9);
}

export function splashFinished(loadingElapsedMs, ready, plan = SPLASH) {
  return Boolean(ready) && loadingElapsedMs >= plan.progressMinMs + plan.holdMs;
}

// Годинник заставки: поки відео йде — його поточний час, після кінця (або помилки) — час,
// що минув від кінця, плюс довжина відео, щоб плитки й смужка не залежали від відео.
export function splashClockMs({ videoTimeSec, videoEnded, msSinceEnd }, plan = SPLASH) {
  if (videoEnded) return plan.videoMs + Math.max(0, msSinceEnd || 0);
  return Math.min(plan.videoMs, Math.max(0, (videoTimeSec || 0) * 1000));
}
