/* Рендер PPTX: малює модель колоди з presentation-core.js за еталоном дизайну власника
   (тло F6F4F1, шапка кольору роду військ із емблемою, білі картки з тінню, панель висновків із акцентною смугою).
   Тут немає аналітики, лише верстка. Діаграми рідні (редаговані у PowerPoint/Keynote).
   Шрифт Arial: є на macOS і Windows, кирилиця без вбудовування. */

import PptxGenJS from 'pptxgenjs';

export const THEMES = {
  light: {
    label: 'Світлий, за еталоном',
    bg: 'F6F4F1', card: 'FFFFFF', panel: 'FFFFFF', line: 'D9DDE3', text: '111827', muted: '6B7280', soft: 'F2DADD',
    accent: '7A1F2B', good: '1F8F5F', bad: 'C00000',
    series: ['7A1F2B', 'D98E04', '2F6EA5', 'C9A7AD'],
    // Колір шапки й акцентів за родом військ: ДШВ, ПС, РВіА.
    brands: { dshv: '7A1F2B', ps: '293657', rvia: '6A6539' },
  },
};

const W = 13.33;
const H = 7.5;
const M = 0.5;
const PANEL_Y = 2.82;
const PANEL_H = 1.89;
const SHADOW = { type: 'outer', color: '000000', opacity: 0.14, blur: 6, offset: 2, angle: 90 };
const ART_SIZE = { 'logo-dshv': [144, 166], 'logo-ps': [374, 170], 'logo-sv': [355, 141] };

const lines = (text, charsPerLine) => Math.max(1, Math.ceil(String(text).length / charsPerLine));

/** Зображення за ключем із збереженням пропорцій у рамці (x, y, h — висота). */
function drawLogo(slide, art, key, x, y, h) {
  if (!art || !art[key]) return false;
  const [w0, h0] = ART_SIZE[key];
  slide.addImage({ data: art[key], x, y, w: (h * w0) / h0, h });
  return true;
}

function footer(slide, theme, deck, number, left) {
  slide.addText(left, { x: M, y: 7.1, w: 8.96, h: 0.23, fontFace: theme.font, fontSize: 8.6, color: theme.muted, margin: 0 });
  slide.addText(String(number), { x: 11.88, y: 7.1, w: 0.94, h: 0.23, fontFace: theme.font, fontSize: 8.6, color: theme.muted, align: 'right', margin: 0 });
}

function tileColors(tile, theme) {
  if (tile.deltaPercent == null || tile.delta == null) return theme.muted;
  if (tile.better === 'down') return tile.delta < 0 ? theme.good : tile.delta > 0 ? theme.bad : theme.muted;
  if (tile.better === 'up') return tile.delta > 0 ? theme.good : tile.delta < 0 ? theme.bad : theme.muted;
  return theme.text;
}

/** Виноска «Наші втрати за N діб — M» (одна на слайд періоду). */
function drawOwnCallout(slide, theme, callout, brand) {
  if (!callout) return;
  slide.addShape('roundRect', { x: 8.12, y: 0.98, w: 4.69, h: 0.26, rectRadius: 0.06, fill: { color: theme.card }, line: { color: brand, width: 1 } });
  slide.addText([
    { text: callout.text, options: { bold: true, color: brand, fontSize: 10.5 } },
    { text: `   (${callout.detail})`, options: { color: theme.muted, fontSize: 7.5 } },
  ], { x: 8.25, y: 0.98, w: 4.44, h: 0.26, fontFace: theme.font, valign: 'middle', align: 'right', margin: 0, fit: 'shrink' });
}

function drawTiles(slide, theme, tiles) {
  const gap = 0.16;
  const width = 1.92;
  tiles.forEach((tile, i) => {
    const x = M + i * (width + gap);
    slide.addShape('roundRect', { x, y: 1.29, w: width, h: 1.38, rectRadius: 0.1, fill: { color: theme.card }, line: { color: theme.line, width: 0.5 }, shadow: SHADOW });
    slide.addText(tile.name, { x: x + 0.15, y: 1.38, w: width - 0.3, h: 0.35, fontFace: theme.font, fontSize: 10.5, color: theme.muted, valign: 'top', margin: 0 });
    slide.addText(tile.totalText, { x: x + 0.15, y: 1.72, w: width - 0.3, h: 0.5, fontFace: theme.font, fontSize: 30, bold: true, color: theme.text, valign: 'middle', margin: 0, fit: 'shrink' });
    if (tile.deltaText) {
      const arrow = tile.delta > 0 ? '▲ ' : tile.delta < 0 ? '▼ ' : '';
      const small = tile.deltaPercent == null;
      slide.addText(arrow + tile.deltaText, { x: x + 0.15, y: 2.21, w: width - 0.3, h: 0.23, fontFace: theme.font, fontSize: small ? 9 : 11.25, bold: !small, color: tileColors(tile, theme), margin: 0 });
      if (tile.previous != null) slide.addText(`було ${formatPrevious(tile)}`, { x: x + 0.15, y: 2.45, w: width - 0.3, h: 0.18, fontFace: theme.font, fontSize: 8.6, color: theme.muted, margin: 0 });
    }
  });
}

function formatPrevious(tile) {
  const value = tile.previous;
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return String(rounded).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function drawBlocks(slide, theme, data, brand) {
  const sections = [
    ['Що змінилось', data.changes, 'Суттєвих змін (від 20 %) не виявлено.'],
    ['На що звернути увагу', data.attention, 'Відхилень не виявлено.'],
    [data.thirdTitle || 'Можливі причини', data.hypotheses, 'Змін і відхилень, що потребують пояснення, немає.'],
  ];
  const perLine = 52;
  const total = sections.reduce((sum, [, items, empty]) => sum + 1 + (items.length ? items : [{ text: empty }]).reduce((s, i) => s + lines(i.text, perLine), 0), 0);
  const size = total > 19 ? 9.5 : total > 15 ? 10.5 : 11;
  slide.addShape('roundRect', { x: 7.92, y: PANEL_Y, w: 4.9, h: 3.85, rectRadius: 0.1, fill: { color: theme.card }, line: { color: theme.line, width: 0.5 }, shadow: SHADOW });
  slide.addShape('rect', { x: 7.92, y: PANEL_Y, w: 0.05, h: 3.85, fill: { color: brand }, line: { color: brand, width: 0 } });
  const runs = [];
  sections.forEach(([title, items, empty], index) => {
    runs.push({ text: title, options: { bold: true, color: brand, fontSize: 12, breakLine: true, paraSpaceBefore: index ? 8 : 0, paraSpaceAfter: 3 } });
    const list = items.length ? items : [{ text: empty, muted: true }];
    for (const item of list) runs.push({ text: item.text, options: { color: item.muted ? theme.muted : theme.text, fontSize: size, bullet: { indent: 12 }, breakLine: true, paraSpaceAfter: 3 } });
  });
  slide.addText(runs, { x: 8.15, y: 2.98, w: 4.42, h: 3.54, fontFace: theme.font, valign: 'top', margin: 0 });
}

function drawCharts(slide, theme, pptx, charts) {
  const labels = { day: 'добово', week: 'щотижнево', month: 'щомісячно' };
  const height = 1.6;
  charts.forEach((chart, i) => {
    const y = PANEL_Y + i * (PANEL_H + 0.08) + 0.06;
    slide.addShape('roundRect', { x: M, y: y - 0.06 + 0, w: 7.12, h: PANEL_H, rectRadius: 0.1, fill: { color: theme.card }, line: { color: theme.line, width: 0.5 }, shadow: SHADOW });
    const title = chart.bucket ? `${chart.title}, ${labels[chart.bucket] || ''}` : chart.title;
    slide.addText(title, { x: M + 0.17, y: y + 0.03, w: 6.67, h: 0.24, fontFace: theme.font, fontSize: 11, bold: true, color: theme.accent, margin: 0 });
    const data = chart.series.map(s => ({ name: s.name, labels: chart.categories, values: s.values }));
    const peak = Math.max(0, ...chart.series.flatMap(s => s.values));
    const whole = chart.series.every(s => s.values.every(Number.isInteger));
    const colors = { personnel: [theme.series[0], theme.series[3]], targets: [theme.series[1], theme.series[2]], 'own-personnel': [theme.series[0], theme.series[3], theme.series[1]], 'own-causes': [theme.series[0]], 'strike-results': [theme.good, theme.series[1], theme.bad, theme.muted], 'strike-reasons': [theme.series[0]], 'strike-types': [theme.series[2]] }[chart.id] || theme.series;
    slide.addChart(pptx.charts.BAR, data, {
      x: M + 0.05, y: y + 0.27, w: 6.95, h: height - 0.12,
      barDir: chart.horizontal ? 'bar' : 'col', barGrouping: chart.grouping || 'clustered', barGapWidthPct: 35,
      chartColors: colors.slice(0, data.length),
      catAxisLabelFontFace: theme.font, catAxisLabelFontSize: 8, catAxisLabelColor: theme.muted,
      catAxisLabelRotate: !chart.horizontal && chart.categories.length > 14 ? 270 : 0,
      catAxisOrientation: chart.horizontal ? 'maxMin' : 'minMax',
      valAxisLabelFontFace: theme.font, valAxisLabelFontSize: 8, valAxisLabelColor: theme.muted, ...(whole && peak <= 8 ? { valAxisMajorUnit: 1 } : {}),
      valGridLine: { color: theme.line, size: 0.5 }, catGridLine: { style: 'none' },
      catAxisLineShow: false, valAxisLineShow: false,
      showLegend: data.length > 1, legendPos: 'r', legendFontFace: theme.font, legendFontSize: 8, legendColor: theme.muted,
      showValue: Boolean(chart.horizontal), dataLabelFontFace: theme.font, dataLabelFontSize: 8, dataLabelColor: theme.text,
    });
  });
}

function header(slide, theme, data, art, brandKey, dateText, compareText) {
  const brand = theme.brands[brandKey] || theme.brands.dshv;
  const tall = brandKey !== 'dshv';
  slide.background = { color: theme.bg };
  slide.addShape('rect', { x: 0, y: 0, w: W, h: tall ? 1.0 : 0.92, fill: { color: brand }, line: { color: brand, width: 0 } });
  let titleX = 0.74;
  if (brandKey === 'ps' && drawLogo(slide, art, 'logo-ps', 0, 0.02, 0.96)) titleX = 2.7;
  else if (brandKey === 'rvia' && drawLogo(slide, art, 'logo-sv', 0, 0.05, 0.9)) titleX = 2.8;
  else if (drawLogo(slide, art, 'logo-dshv', 0.1, 0.02, 0.86)) titleX = 0.95;
  slide.addText(data.heading || data.title, { x: titleX, y: tall ? 0.12 : 0.17, w: 7.92 - (titleX - 0.74), h: tall ? 0.78 : 0.54, fontFace: theme.font, fontSize: 27, bold: true, color: 'FFFFFF', valign: 'middle', margin: 0, fit: 'shrink' });
  slide.addText(dateText, { x: 8.85, y: 0.19, w: 3.96, h: 0.29, fontFace: theme.font, fontSize: 13.5, color: 'FFFFFF', align: 'right', margin: 0 });
  slide.addText(compareText, { x: 7.92, y: 0.52, w: 4.9, h: 0.25, fontFace: theme.font, fontSize: 10, color: theme.soft, align: 'right', margin: 0 });
  return brand;
}

function periodSlide(pptx, theme, deck, data, number, art) {
  const slide = pptx.addSlide();
  const compare = data.previous ? (data.previous.complete ? `Порівняння з ${data.previous.text}` : `Порівняння з ${data.previous.text} неповне`) : 'Без порівняння з попереднім відрізком';
  const brand = header(slide, theme, data, art, data.theme || 'dshv', data.period.text, compare);
  slide.addText(data.strip || `${data.period.activeDays} із ${data.period.days} діб з даними`, { x: M, y: data.theme && data.theme !== 'dshv' ? 1.03 : 0.98, w: 7.5, h: 0.23, fontFace: theme.font, fontSize: 8.6, color: theme.muted, margin: 0, fit: 'shrink' });
  drawOwnCallout(slide, theme, data.ownCallout, brand);
  drawTiles(slide, theme, data.tiles);
  drawCharts(slide, theme, pptx, data.charts);
  drawBlocks(slide, theme, data, brand);
  if (data.notes.length) slide.addText(data.notes.join(' '), { x: M, y: 6.82, w: W - 2 * M, h: 0.22, fontFace: theme.font, fontSize: 8.6, italic: true, color: theme.muted, margin: 0 });
  footer(slide, theme, deck, number, `${deck.slides[0].owner || 'EasyWAR'} · ${deck.focusLabel}`);
}

function reservedSlide(pptx, theme, deck, data, number, art) {
  const slide = pptx.addSlide();
  header(slide, theme, data, art, 'dshv', '', '');
  slide.addShape('roundRect', { x: M, y: 1.4, w: W - 2 * M, h: 5.2, rectRadius: 0.1, fill: { color: theme.card }, line: { color: theme.line, width: 1, dashType: 'dash' } });
  slide.addText(data.message, { x: M + 0.5, y: 1.4, w: W - 2 * M - 1, h: 5.2, fontFace: theme.font, fontSize: 20, color: theme.muted, align: 'center', valign: 'middle', margin: 0 });
  footer(slide, theme, deck, number, `${deck.slides[0].owner || 'EasyWAR'} · ${deck.focusLabel}`);
}

function titleSlide(pptx, theme, deck, data, art) {
  const slide = pptx.addSlide();
  const brand = theme.brands.dshv;
  slide.background = { color: brand };
  slide.addText(data.titleText || 'Аналітика', { x: 0.75, y: 1.49, w: 11.8, h: 1.3, fontFace: theme.font, fontSize: 36, bold: true, color: 'FFFFFF', valign: 'top', margin: 0, fit: 'shrink' });
  const sub = [data.owner, deck.focusLabel].filter(Boolean).join(' · ');
  slide.addText(sub, { x: 0.75, y: 2.95, w: 11.8, h: 0.5, fontFace: theme.font, fontSize: 15, bold: true, color: 'FFFFFF', valign: 'top', margin: 0, fit: 'shrink' });
  if (drawLogo(slide, art, 'logo-dshv', 0.62, 5.87, 1.02)) slide.addText('Десантно-штурмові війська', { x: 1.74, y: 5.8, w: 3.4, h: 1.15, fontFace: theme.font, fontSize: 20, bold: true, color: 'FFFFFF', valign: 'middle', margin: 0 });
}

/** Будує об'єкт PptxGenJS за моделлю колоди. theme: 'light' (єдина затверджена). */
export function renderDeck(deck, options = {}) {
  const theme = { ...(THEMES[options.theme] || THEMES.light), font: options.font || 'Arial' };
  const pptx = options.target || new PptxGenJS(); // target: інший виконавець із тим самим інтерфейсом (PDF)
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = `Аналітика: ${deck.slides[0].owner || 'EasyWAR'}`;
  pptx.author = 'EasyWAR';
  titleSlide(pptx, theme, deck, deck.slides[0], options.art);
  deck.slides.slice(1).forEach((data, i) => (data.status === 'no_source' ? reservedSlide(pptx, theme, deck, data, i + 2, options.art) : periodSlide(pptx, theme, deck, data, i + 2, options.art)));
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

/** Повертає Uint8Array готового файлу .pdf (шрифти — options.fonts: { regular, bold, italic }). */
export async function renderDeckToPdfBytes(deck, options = {}) {
  const { PdfDeck } = await import('./presentation-pdf.js');
  const target = new PdfDeck({ fonts: options.fonts });
  renderDeck(deck, { ...options, target });
  return target.finish();
}

/** Повертає Uint8Array готового файлу .pptx. options.transition: 'fade' (за замовчуванням) | 'push' | 'wipe' | 'none'. */
export async function renderDeckToBytes(deck, options = {}) {
  const bytes = await renderDeck(deck, options).write({ outputType: 'uint8array' });
  return addTransitions(bytes, options.transition === undefined ? 'fade' : options.transition);
}
