/* Рендерер PPTX: малює модель колоди з presentation-core.js.
   Тут немає аналітики, лише верстка. Діаграми рідні (редаговані у PowerPoint/Keynote).
   Шрифт Arial: є на macOS і Windows, кирилиця без вбудовування. */

import PptxGenJS from 'pptxgenjs';

export const THEMES = {
  light: {
    label: 'Світлий мінімалістичний',
    bg: 'FFFFFF', panel: 'F3F4F6', line: 'DDE1E7', text: '111827', muted: '6B7280',
    accent: '7A1F2B', stripe: '7A1F2B', good: '1F8F5F', bad: 'C2303F',
    series: ['7A1F2B', 'D98E04', '2F6EA5', 'C9A7AD'],
  },
};

const FONT = 'Arial';
const W = 13.33;
const H = 7.5;
const M = 0.5;

const lines = (text, charsPerLine) => Math.max(1, Math.ceil(String(text).length / charsPerLine));

const ART_SIZE = { soldiers: [640, 616], f16: [760, 317], himars: [760, 372] };

/** Праворуч марунова смуга: єдиний елемент стилю всіх слайдів. */
function drawStripe(slide, theme) {
  slide.addShape('rect', { x: W - 0.25, y: 0, w: 0.25, h: H, fill: { color: theme.stripe }, line: { color: theme.stripe, width: 0 } });
}

/** Коротка акцентна лінія під заголовком слайда. */
function drawUnderline(slide, theme) {
  slide.addShape('rect', { x: M, y: 0.3, w: 0.7, h: 0.05, fill: { color: theme.accent }, line: { color: theme.accent, width: 0 } });
}

/** Вирізана ілюстрація в заданій рамці з збереженням пропорцій, вирівнювання по правому краю. */
function drawArt(slide, art, key, box) {
  if (!art || !art[key]) return;
  const [w, h] = ART_SIZE[key];
  const scale = Math.min(box.w / w, box.h / h);
  const width = w * scale, height = h * scale;
  slide.addImage({ data: art[key], x: box.x + (box.align === 'left' ? 0 : box.w - width), y: box.y + (box.valign === 'top' ? 0 : box.h - height), w: width, h: height });
}

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
  const labels = { day: 'добово', week: 'щотижнево', month: 'щомісячно' };
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

function periodSlide(pptx, theme, deck, data, number, art) {
  const slide = pptx.addSlide();
  slide.background = { color: theme.bg };
  drawStripe(slide, theme);
  drawUnderline(slide, theme);
  const emblem = { 'group:ps': 'f16', 'group:rvia': 'himars' }[data.id];
  if (emblem) drawArt(slide, art, emblem, { x: 6.2, y: 0.2, w: 2.3, h: 0.72, valign: 'top' });
  slide.addText(data.title, { x: M, y: 0.4, w: 8.3, h: 0.6, fontFace: FONT, fontSize: 28, bold: true, color: theme.text, margin: 0 });
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
  drawStripe(slide, theme);
  drawUnderline(slide, theme);
  slide.addText(data.title, { x: M, y: 0.4, w: 8.3, h: 0.6, fontFace: FONT, fontSize: 28, bold: true, color: theme.text, margin: 0 });
  slide.addShape('roundRect', { x: M, y: 1.4, w: W - 2 * M, h: 5.2, rectRadius: 0.08, fill: { color: theme.panel }, line: { color: theme.line, width: 1, dashType: 'dash' } });
  slide.addText(data.message, { x: M + 0.5, y: 1.4, w: W - 2 * M - 1, h: 5.2, fontFace: FONT, fontSize: 20, color: theme.muted, align: 'center', valign: 'middle', margin: 0 });
  footer(slide, theme, deck, number, `${deck.slides[0].owner || 'EasyWAR'} · ${deck.focusLabel}`);
}

function titleSlide(pptx, theme, deck, data, art) {
  const slide = pptx.addSlide();
  slide.background = { color: theme.bg };
  // Праворуч марунова панель із ілюстраціями; зліва текст на білому тлі.
  const panelX = 8.75;
  slide.addShape('rect', { x: panelX, y: 0, w: W - panelX, h: H, fill: { color: theme.stripe }, line: { color: theme.stripe, width: 0 } });
  drawArt(slide, art, 'f16', { x: panelX + 0.2, y: 0.55, w: W - panelX - 0.4, h: 1.7 });
  drawArt(slide, art, 'himars', { x: panelX + 0.2, y: 2.55, w: W - panelX - 0.4, h: 1.9 });
  drawArt(slide, art, 'soldiers', { x: panelX + 0.2, y: 4.55, w: W - panelX - 0.4, h: 2.95 });
  slide.addShape('rect', { x: 0.9, y: 1.0, w: 0.9, h: 0.06, fill: { color: theme.accent }, line: { color: theme.accent, width: 0 } });
  slide.addText('АНАЛІТИКА', { x: 0.9, y: 1.2, w: 7, h: 0.4, fontFace: FONT, fontSize: 16, bold: true, color: theme.accent, charSpacing: 6, margin: 0 });
  slide.addText(data.owner || 'Назву власника не вказано', { x: 0.9, y: 1.7, w: 7.4, h: 1.5, fontFace: FONT, fontSize: 40, bold: true, color: theme.text, valign: 'top', margin: 0, fit: 'shrink' });
  slide.addText(deck.focusLabel, { x: 0.9, y: 3.3, w: 7, h: 0.4, fontFace: FONT, fontSize: 16, color: theme.muted, margin: 0 });
  // Вміст титулу (крім назви й фокусу) узгоджується окремо.
  slide.addText(`Дані: ${data.dataRange.text}`, { x: 0.9, y: 3.9, w: 7.4, h: 0.35, fontFace: FONT, fontSize: 14, color: theme.muted, margin: 0 });
  const parts = [data.generatedOn ? `Сформовано ${data.generatedOn}` : '', `Остання дата з даними ${data.anchor.split('-').reverse().join('.')}`, data.marking].filter(Boolean);
  slide.addText(parts.join(' · '), { x: 0.9, y: 6.6, w: 7.4, h: 0.3, fontFace: FONT, fontSize: 11, color: theme.muted, margin: 0 });
}

/** Будує об'єкт PptxGenJS за моделлю колоди. theme: 'light' (єдина затверджена). */
export function renderDeck(deck, options = {}) {
  const theme = THEMES[options.theme] || THEMES.light;
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = `Аналітика: ${deck.slides[0].owner || 'EasyWAR'}`;
  pptx.author = 'EasyWAR';
  titleSlide(pptx, theme, deck, deck.slides[0], options.art);
  deck.slides.slice(1).forEach((data, i) => (data.status === 'no_source' ? reservedSlide(pptx, theme, deck, data, i + 2) : periodSlide(pptx, theme, deck, data, i + 2, options.art)));
  return pptx;
}

const TRANSITIONS = {
  fade: '<p:fade/>',
  push: '<p:push dir="u"/>',
  wipe: '<p:wipe dir="r"/>',
};

/** Додає до кожного слайда перехід PowerPoint. Порядок у слайді: cSld, clrMapOvr, transition. */
async function addTransitions(bytes, kind) {
  const effect = TRANSITIONS[kind];
  if (!effect) return bytes;
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  for (const name of names) {
    const xml = await zip.file(name).async('string');
    if (xml.includes('<p:transition')) continue;
    zip.file(name, xml.replace('</p:clrMapOvr>', `</p:clrMapOvr><p:transition spd="med">${effect}</p:transition>`));
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

/** Повертає Uint8Array готового файлу .pptx. options.transition: 'fade' (за замовчуванням) | 'push' | 'wipe' | 'none'. */
export async function renderDeckToBytes(deck, options = {}) {
  const bytes = await renderDeck(deck, options).write({ outputType: 'uint8array' });
  return addTransitions(bytes, options.transition === undefined ? 'fade' : options.transition);
}
