// «Основні показники» модуля ПС (src/air.html): картки складаються за описами плиток із вбудованого
// каталогу (src/catalogs/ps-builtin.js), а числа рахує src/tiles-core.js.
//
// Цей модуль — перехідник між сторінкою й ядром, без DOM: сторінка передає розібрані рядки таблиці,
// період і готові допоміжні функції, а отримує конфігурації карток у тому вигляді, який малює `kpiCard`.
// Сторінка підключає його як `window.PSKpi.buildCards(...)`.

import { validateCatalog } from './catalog-core.js';
import { computeTiles } from './tiles-core.js';
import { PS_CATALOG } from './catalogs/ps-builtin.js';

const checked = validateCatalog(PS_CATALOG);
if (!checked.ok) throw new Error(`Вбудований каталог ПС не пройшов перевірку: ${checked.errors[0].path} — ${checked.errors[0].message}`);

/** Перевірений вбудований каталог ПС. */
export const CATALOG = checked.catalog;

/** Плитки блоку «Основні показники» у порядку каталогу. */
export const KPI_TILES = Object.freeze(CATALOG.blocks.find((block) => block.id === 'block.ps-kpis').tiles.slice());

/** Результат ураження за ознакою, яку виставляє парсер таблиці (`row.kind`). */
export const RESULT_BY_KIND = Object.freeze({ hit: 'Уражено', part: 'Пошкоджено', miss: 'Не уражено', unk: 'Не відомо' });

/** Розділ сторінки, куди веде кнопка «Докладніше», за блоком каталогу. */
export const VIEW_BY_BLOCK = Object.freeze({ 'block.ps-ops': 'ops', 'block.ps-mun': 'mun' });

/** Який ряд `kpiSeries` сторінки малює лінію картки, коли місяців для стовпчиків замало. */
export const SERIES_BY_TILE = Object.freeze({
  'tile.ps-sorties': 'n',
  'tile.ps-munitions': 'mun',
  'tile.ps-hit': 'hit',
  'tile.ps-partial': 'part',
  'tile.ps-miss': 'miss',
  'tile.ps-unknown': 'unk',
});

/** Підпис зміни залежно від бази порівняння. */
export const COMPARE_LABEL = Object.freeze({
  previous: 'до попереднього періоду',
  halves: 'друга половина до першої',
  none: 'немає бази для порівняння',
});

/** Рядок, який розібрав парсер таблиці, → запис за id стовпців каталогу. */
export function toRecord(row) {
  return {
    'col.date': row.date || '',
    'col.munition': row.munition || '',
    'col.munition-count': row.count,
    'col.result': RESULT_BY_KIND[row.kind] || '',
    'col.abort': !!row.abort,
  };
}

/**
 * Збирає картки «Основних показників».
 *
 * @param input { rows, from, to, prevRows?, halves?, series, axis }
 *   rows — рядки вибраного періоду; from/to — його межі `рррр-мм-дд`;
 *   prevRows — рядки попереднього періоду такої ж тривалості (порожньо чи немає — бази немає);
 *   halves — [рядки першої половини, рядки другої], коли попереднього періоду немає;
 *   series — ряди `kpiSeries` сторінки; axis — підписи осі часу.
 * @param deps { mkDelta, colors, monthNames } — допоміжні речі сторінки: оцінка зміни, палітра тонів,
 *   короткі назви місяців.
 * @returns масив конфігурацій для `kpiCard`; картки, що ховаються, не повертаються.
 */
export function buildCards(input, deps) {
  const rows = input.rows.map(toRecord);
  let compare = null;
  let label = COMPARE_LABEL.none;
  if (input.prevRows && input.prevRows.length) {
    compare = { kind: 'previous', rows: input.prevRows.map(toRecord) };
    label = COMPARE_LABEL.previous;
  } else if (input.halves) {
    compare = { kind: 'halves', first: input.halves[0].map(toRecord), second: input.halves[1].map(toRecord) };
    label = COMPARE_LABEL.halves;
  }

  const models = computeTiles(CATALOG, KPI_TILES, { rows, period: { from: input.from, to: input.to }, compare });
  return models.filter((model) => !model.hidden).map((model) => {
    const card = {
      tone: model.tone,
      ic: model.icon,
      label: model.label,
      sub: model.sub,
      val: model.value.text,
      go: VIEW_BY_BLOCK[model.opens],
      delta: deps.mkDelta(model.delta ? model.delta.pct : null, model.delta ? model.delta.mode : 'neutral'),
      dlLabel: label,
      series: input.series[SERIES_BY_TILE[model.id]],
      color: deps.colors[model.tone],
      labels: input.axis,
      info: model.info,
    };
    if (model.visual === 'bars') {
      card.bars = model.bars.map((bar) => ({ t: deps.monthNames[Number(bar.key.slice(5, 7)) - 1], v: bar.value }));
      const wide = model.extras[0];
      card.wide = wide ? { ic: wide.icon, l: wide.label, v: wide.text } : null;
    } else if (model.visual === 'ring') {
      card.ring = model.ring.percent;
      card.ringL = model.ring.label;
      card.cap = model.ring.caption;
    }
    return card;
  });
}

if (typeof window !== 'undefined') window.PSKpi = Object.freeze({ buildCards });
