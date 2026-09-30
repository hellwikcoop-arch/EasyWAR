/* Рендерер PPTX: малює модель колоди з presentation-core.js.
   Тут немає аналітики, лише верстка. Діаграми рідні (редаговані у PowerPoint/Keynote).
   Шрифт Arial: є на macOS і Windows, кирилиця без вбудовування. */

import PptxGenJS from 'pptxgenjs';

export const THEMES = {
  light: {
    label: 'Світлий мінімалістичний',
    bg: 'FFFFFF', panel: 'F3F4F6', line: 'DDE1E7', text: '111827', muted: '6B7280',
    accent: '7A1F2B', good: '1F8F5F', bad: 'C2303F',
    series: ['7A1F2B', 'D98E04', '2F6EA5', 'C9A7AD'],
  },
};

const FONT = 'Arial';
const W = 13.33;
const H = 7.5;
const M = 0.5;

const lines = (text, charsPerLine) => Math.max(1, Math.ceil(String(text).length / charsPerLine));

function footer(slide, theme, deck, number, left) {
  slide.addText(left, { x: M, y: 7.08, w: 9, h: 0.25, fontFace: FONT, fontSize: 9, color: theme.muted, margin: 0 });
  slide.addText(String(number), { x: W - M - 1, y: 7.08, w: 1, h: 0.25, fontFace: FONT, fontSize: 9, color: theme.muted, align: 'right', margin: 0 });
}

function tileColors(tile, theme) {
  if (tile.deltaPercent == null || tile.delta == null) return theme.muted;
  if (tile.better === 'down') return tile.delta < 0 ? theme.good : tile.delta > 0 ? theme.bad : theme.muted;
  if (tile.better === 'up') return tile.delta > 0 ? theme.good : tile.delta < 0 ? theme.bad : theme.muted;
  return theme.text;
}

/** Виноска «Наші втрати за N діб — M» (одна на слайд періоду). */
function drawOwnCallout(slide, theme, callout) {
  if (!callout) return;
  slide.addShape('roundRect', { x: W - M - 4.6, y: 1.06, w: 4.6, h: 0.3, rectRadius: 0.06, fill: { color: theme.panel }, line: { color: theme.accent, width: 1 } });
  slide.addText([
    { text: callout.text, options: { bold: true, color: theme.accent, fontSize: 11 } },
    { text: `   (${callout.detail})`, options: { color: theme.muted, fontSize: 8 } },
  ], { x: W - M - 4.5, y: 1.06, w: 4.4, h: 0.3, fontFace: FONT, valign: 'middle', align: 'right', margin: 0, fit: 'shrink' });
}

function drawTiles(slide, theme, tiles) {
  const gap = 0.15;
  const width = (W - 2 * M - gap * (tiles.length - 1)) / tiles.length;
  tiles.forEach((tile, i) => {
    const x = M + i * (width + gap);
    slide.addShape('roundRect', { x, y: 1.45, w: width, h: 1.72, rectRadius: 0.08, fill: { color: theme.panel }, line: { color: theme.line, width: 0.75 } });
    slide.addText(tile.name, { x: x + 0.15, y: 1.5, w: width - 0.3, h: 0.45, fontFace: FONT, fontSize: 11, color: theme.muted, valign: 'top', margin: 0 });
    slide.addText(tile.totalText, { x: x + 0.15, y: 1.92, w: width - 0.3, h: 0.7, fontFace: FONT, fontSize: 34, bold: true, color: theme.text, valign: 'middle', margin: 0, fit: 'shrink' });
    if (tile.deltaText) {
      const arrow = tile.delta > 0 ? '▲ ' : tile.delta < 0 ? '▼ ' : '';
      const small = tile.deltaPercent == null;
      slide.addText(arrow + tile.deltaText, { x: x + 0.15, y: 2.62, w: width - 0.3, h: 0.25, fontFace: FONT, fontSize: small ? 10 : 13, bold: !small, color: tileColors(tile, theme), margin: 0 });
      if (tile.previous != null) slide.addText(`було ${formatPrevious(tile)}`, { x: x + 0.15, y: 2.86, w: width - 0.3, h: 0.22, fontFace: FONT, fontSize: 9, color: theme.muted, margin: 0 });
    }
  });
}

function formatPrevious(tile) {
  const value = tile.previous;
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return String(rounded).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function drawBlocks(slide, theme, data) {
  const sections = [
    ['Що змінилось', data.changes, 'Суттєвих змін (від 20 %) не виявлено.'],
    ['На що звернути увагу', data.attention, 'Відхилень не виявлено.'],
    [data.thirdTitle || 'Можливі причини', data.hypotheses, 'Змін і відхилень, що потребують пояснення, немає.'],
  ];
  const width = 5.53;
  const perLine = 58;
  const total = sections.reduce((sum, [, items, empty]) => sum + 1 + (items.length ? items : [{ text: empty }]).reduce((s, i) => s + lines(i.text, perLine), 0), 0);
  const size = total > 17 ? 10 : 11;
  const runs = [];
  sections.forEach(([title, items, empty], index) => {
    runs.push({ text: title, options: { bold: true, color: theme.accent, fontSize: 12, breakLine: true, paraSpaceBefore: index ? 8 : 0, paraSpaceAfter: 3 } });
    const list = items.length ? items : [{ text: empty, muted: true }];
    for (const item of list) runs.push({ text: item.text, options: { color: item.muted ? theme.muted : theme.text, fontSize: size, bullet: { indent: 12 }, breakLine: true, paraSpaceAfter: 3 } });
  });
  slide.addText(runs, { x: 7.3, y: 3.35, w: width, h: 3.55, fontFace: FONT, valign: 'top', margin: 0 });
}

function drawCharts(slide, theme, pptx, charts) {
  const labels = { day: 'по добах', week: 'по тижнях', month: 'по місяцях' };
  const height = 1.55;
  charts.forEach((chart, i) => {
    const y = 3.3 + i * (height + 0.32);
    const title = chart.bucket ? `${chart.title}, ${labels[chart.bucket] || ''}` : chart.title;
    slide.addText(title, { x: M, y, w: 6.5, h: 0.26, fontFace: FONT, fontSize: 11, bold: true, color: theme.accent, margin: 0 });
    const data = chart.series.map(s => ({ name: s.name, labels: chart.categories, values: s.values }));
    const peak = Math.max(0, ...chart.series.flatMap(s => s.values));
    const whole = chart.series.every(s => s.values.every(Number.isInteger));
    const colors = { personnel: [theme.series[0], theme.series[3]], targets: [theme.series[1], theme.series[2]], 'own-personnel': [theme.series[0], theme.series[3], theme.series[1]], 'own-causes': [theme.series[0]], 'strike-results': [theme.good, theme.series[1], theme.bad, theme.muted], 'strike-reasons': [theme.series[0]], 'strike-types': [theme.series[2]] }[chart.id] || theme.series;
    slide.addChart(pptx.charts.BAR, data, {
      x: M - 0.1, y: y + 0.24, w: 6.8, h: height,
      barDir: chart.horizontal ? 'bar' : 'col', barGrouping: chart.grouping || 'clustered', barGapWidthPct: 35,
      chartColors: colors.slice(0, data.length),
      catAxisLabelFontFace: FONT, catAxisLabelFontSize: 8, catAxisLabelColor: theme.muted,
      catAxisLabelRotate: !chart.horizontal && chart.categories.length > 14 ? 270 : 0,
      catAxisOrientation: chart.horizontal ? 'maxMin' : 'minMax',
      valAxisLabelFontFace: FONT, valAxisLabelFontSize: 8, valAxisLabelColor: theme.muted, ...(whole && peak <= 8 ? { valAxisMajorUnit: 1 } : {}),
      valGridLine: { color: theme.line, size: 0.5 }, catGridLine: { style: 'none' },
      catAxisLineShow: false, valAxisLineShow: false,
      showLegend: data.length > 1, legendPos: 'r', legendFontFace: FONT, legendFontSize: 8, legendColor: theme.muted,
      showValue: Boolean(chart.horizontal), dataLabelFontFace: FONT, dataLabelFontSize: 8, dataLabelColor: theme.text,
    });
  });
}

function periodSlide(pptx, theme, deck, data, number) {
  const slide = pptx.addSlide();
  slide.background = { color: theme.bg };
  slide.addText(data.title, { x: M, y: 0.35, w: 8.3, h: 0.6, fontFace: FONT, fontSize: 28, bold: true, color: theme.text, margin: 0 });
  slide.addText(data.period.text, { x: W - M - 4.2, y: 0.4, w: 4.2, h: 0.35, fontFace: FONT, fontSize: 16, color: theme.text, align: 'right', margin: 0 });
  const compare = data.previous ? (data.previous.complete ? `Порівняння з ${data.previous.text}` : `Порівняння з ${data.previous.text} неповне`) : 'Без порівняння з попереднім відрізком';
  slide.addText(compare, { x: W - M - 6, y: 0.78, w: 6, h: 0.28, fontFace: FONT, fontSize: 11, color: theme.muted, align: 'right', margin: 0 });
  slide.addText(data.strip || `${data.period.activeDays} із ${data.period.days} діб з даними`, { x: M, y: 0.95, w: 8.3, h: 0.28, fontFace: FONT, fontSize: 11, color: theme.muted, margin: 0 });
  drawOwnCallout(slide, theme, data.ownCallout);
  drawTiles(slide, theme, data.tiles);
  drawCharts(slide, theme, pptx, data.charts);
  drawBlocks(slide, theme, data);
  if (data.notes.length) slide.addText(data.notes.join(' '), { x: M, y: 6.85, w: W - 2 * M, h: 0.22, fontFace: FONT, fontSize: 9, italic: true, color: theme.muted, margin: 0 });
  footer(slide, theme, deck, number, `${deck.slides[0].owner || 'EasyWAR'} · ${deck.focusLabel}`);
}

function reservedSlide(pptx, theme, deck, data, number) {
  const slide = pptx.addSlide();
  slide.background = { color: theme.bg };
  slide.addText(data.title, { x: M, y: 0.35, w: 8.3, h: 0.6, fontFace: FONT, fontSize: 28, bold: true, color: theme.text, margin: 0 });
  slide.addShape('roundRect', { x: M, y: 1.4, w: W - 2 * M, h: 5.2, rectRadius: 0.08, fill: { color: theme.panel }, line: { color: theme.line, width: 1, dashType: 'dash' } });
  slide.addText(data.message, { x: M + 0.5, y: 1.4, w: W - 2 * M - 1, h: 5.2, fontFace: FONT, fontSize: 20, color: theme.muted, align: 'center', valign: 'middle', margin: 0 });
  footer(slide, theme, deck, number, `${deck.slides[0].owner || 'EasyWAR'} · ${deck.focusLabel}`);
}

function titleSlide(pptx, theme, deck, data) {
  const slide = pptx.addSlide();
  slide.background = { color: theme.bg };
  slide.addShape('rect', { x: 0, y: 0, w: 0.25, h: H, fill: { color: theme.accent }, line: { color: theme.accent, width: 0 } });
  slide.addText('АНАЛІТИКА', { x: 0.9, y: 1.1, w: 8, h: 0.4, fontFace: FONT, fontSize: 16, bold: true, color: theme.accent, charSpacing: 6, margin: 0 });
  slide.addText(data.owner || 'Назву власника не вказано', { x: 0.9, y: 1.6, w: 11.5, h: 1.0, fontFace: FONT, fontSize: 40, bold: true, color: theme.text, valign: 'top', margin: 0, fit: 'shrink' });
  slide.addText(deck.focusLabel, { x: 0.9, y: 2.6, w: 8, h: 0.4, fontFace: FONT, fontSize: 16, color: theme.muted, margin: 0 });
  // Актуальність: які підрозділи в аналізі й коли від кожного останні дані; окремо — актуальність таблиць-джерел.
  const total = data.unitsActual.length;
  const stale = data.unitsActual.filter(u => u.stale).length;
  slide.addText(`Підрозділи в аналізі: ${total}${stale ? ` · без свіжих даних: ${stale}` : ' · усі з актуальними даними'}`, { x: 0.9, y: 3.55, w: 8.3, h: 0.3, fontFace: FONT, fontSize: 13, bold: true, color: theme.accent, margin: 0 });
  slide.addText(`Дані: ${data.dataRange.text} · ${data.dataRange.activeDays} діб із даними з ${data.dataRange.days}`, { x: 0.9, y: 3.85, w: 8.3, h: 0.25, fontFace: FONT, fontSize: 10, color: theme.muted, margin: 0 });
  const head = ['Підрозділ', 'Останні дані', 'Стан'].map(text => ({ text, options: { bold: true, color: theme.muted, fontSize: 9, fill: { color: theme.panel } } }));
  const rowsOf = list => [head, ...list.map(u => [
    { text: u.name, options: { color: theme.text, fontSize: 9.5 } },
    { text: u.lastText, options: { color: u.stale ? theme.bad : theme.text, fontSize: 9.5 } },
    { text: u.lagText, options: { color: u.stale ? theme.bad : theme.good, fontSize: 9.5, bold: u.stale } },
  ])];
  const half = Math.ceil(total / 2);
  [data.unitsActual.slice(0, half), data.unitsActual.slice(half)].forEach((list, i) => {
    if (!list.length) return;
    slide.addTable(rowsOf(list), { x: 0.9 + i * 4.15, y: 4.2, w: 4.0, colW: [1.75, 1.05, 1.2], rowH: 0.27, fontFace: FONT, border: { type: 'solid', pt: 0.5, color: theme.line }, margin: [0.02, 0.06, 0.02, 0.06], valign: 'middle' });
  });
  slide.addText('Джерела даних', { x: 9.3, y: 3.55, w: 3.5, h: 0.3, fontFace: FONT, fontSize: 13, bold: true, color: theme.accent, margin: 0 });
  const sourceRuns = [];
  data.sources.forEach(src => {
    sourceRuns.push({ text: src.name, options: { bold: true, color: theme.text, fontSize: 11, breakLine: true } });
    sourceRuns.push({ text: `${src.lastText} · ${src.lagText}`, options: { color: src.stale ? theme.bad : theme.muted, fontSize: 10, bold: src.stale, breakLine: true, paraSpaceAfter: 5 } });
  });
  slide.addText(sourceRuns, { x: 9.3, y: 3.9, w: 3.5, h: 2.6, fontFace: FONT, valign: 'top', margin: 0 });
  const parts = [data.generatedOn ? `Сформовано ${data.generatedOn}` : '', `Остання дата з даними ${data.anchor.split('-').reverse().join('.')}`, data.marking].filter(Boolean);
  slide.addText(parts.join(' · '), { x: 0.9, y: 6.98, w: 11, h: 0.25, fontFace: FONT, fontSize: 11, color: theme.muted, margin: 0 });
}

/** Будує об'єкт PptxGenJS за моделлю колоди. theme: 'light' (єдина затверджена). */
export function renderDeck(deck, options = {}) {
  const theme = THEMES[options.theme] || THEMES.light;
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = `Аналітика: ${deck.slides[0].owner || 'EasyWAR'}`;
  pptx.author = 'EasyWAR';
  titleSlide(pptx, theme, deck, deck.slides[0]);
  deck.slides.slice(1).forEach((data, i) => (data.status === 'no_source' ? reservedSlide : periodSlide)(pptx, theme, deck, data, i + 2));
  return pptx;
}

/** Повертає Uint8Array готового файлу .pptx. */
export async function renderDeckToBytes(deck, options = {}) {
  return renderDeck(deck, options).write({ outputType: 'uint8array' });
}
