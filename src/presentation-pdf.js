/* PDF-виконавець презентації. Реалізує той самий інтерфейс, що й PptxGenJS (addSlide/addShape/addText/addImage/addChart),
   тож верстка в presentation-pptx.js спільна для .pptx і .pdf. Шрифт вбудовується (Liberation Sans, OFL),
   тому вигляд однаковий на будь-якому пристрої. Повністю локально, без мережі. */

import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

const PT = 72; // точок на дюйм
const PAGE_W = 13.33 * PT;
const PAGE_H = 7.5 * PT;
const color = hex => { const v = String(hex || '000000'); return rgb(parseInt(v.slice(0, 2), 16) / 255, parseInt(v.slice(2, 4), 16) / 255, parseInt(v.slice(4, 6), 16) / 255); };

function roundedRectPath(w, h, r) {
  const k = Math.min(r, w / 2, h / 2);
  return `M ${k} 0 H ${w - k} Q ${w} 0 ${w} ${k} V ${h - k} Q ${w} ${h} ${w - k} ${h} H ${k} Q 0 ${h} 0 ${h - k} V ${k} Q 0 0 ${k} 0 Z`;
}

class PdfSlide {
  constructor() { this.ops = []; this.background = { color: 'FFFFFF' }; }
  addShape(type, o) { this.ops.push({ kind: 'shape', type, o }); }
  addText(content, o) { this.ops.push({ kind: 'text', content, o }); }
  addImage(o) { this.ops.push({ kind: 'image', o }); }
  addChart(type, data, o) { this.ops.push({ kind: 'chart', data, o }); }
}

export class PdfDeck {
  constructor(options = {}) {
    this.fonts = options.fonts || {};
    this.slides = [];
    this.charts = { BAR: 'bar' };
    this.title = '';
    this.author = '';
  }

  addSlide() { const slide = new PdfSlide(); this.slides.push(slide); return slide; }

  async finish() {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    if (!this.fonts.regular || !this.fonts.bold) throw new Error('Для PDF потрібні файли шрифту (звичайний і жирний).');
    const regular = await doc.embedFont(this.fonts.regular, { subset: true });
    const bold = await doc.embedFont(this.fonts.bold, { subset: true });
    const italic = this.fonts.italic ? await doc.embedFont(this.fonts.italic, { subset: true }) : regular;
    const pick = (b, i) => (b ? bold : i ? italic : regular);
    // Запасний шрифт для символів, яких немає в основному (наприклад ▲ ▼ у UAF Sans).
    const fbRegular = this.fonts.fallback ? await doc.embedFont(this.fonts.fallback, { subset: true }) : regular;
    const fbBold = this.fonts.fallbackBold ? await doc.embedFont(this.fonts.fallbackBold, { subset: true }) : bold;
    const sets = new Map();
    const has = (font, ch) => { let set = sets.get(font); if (!set) { set = new Set(font.getCharacterSet()); sets.set(font, set); } return set.has(ch.codePointAt(0)); };
    const fallbackFor = font => (font === bold ? fbBold : fbRegular);
    const split = (text, font) => {
      const out = [];
      for (const ch of text) {
        const f = ch === ' ' || ch === '\u00a0' || has(font, ch) ? font : fallbackFor(font);
        if (out.length && out[out.length - 1].font === f) out[out.length - 1].text += ch; else out.push({ text: ch, font: f });
      }
      return out;
    };
    doc.setTitle(this.title || 'Презентація');
    doc.setAuthor(this.author || 'EasyWAR');
    const images = new Map();
    for (const slide of this.slides) {
      const page = doc.addPage([PAGE_W, PAGE_H]);
      const ctx = { doc, page, pick, images, split };
      page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: color(slide.background.color) });
      for (const op of slide.ops) {
        if (op.kind === 'shape') drawShape(ctx, op.type, op.o);
        else if (op.kind === 'text') drawText(ctx, op.content, op.o);
        else if (op.kind === 'image') await drawImage(ctx, op.o);
        else if (op.kind === 'chart') drawBarChart(ctx, op.data, op.o);
      }
    }
    return doc.save();
  }
}

const box = o => ({ x: o.x * PT, y: PAGE_H - (o.y + o.h) * PT, w: o.w * PT, h: o.h * PT, top: o.y * PT });

function drawShape({ page }, type, o) {
  const b = box(o);
  const fill = o.fill && o.fill.color ? color(o.fill.color) : undefined;
  const border = o.line && o.line.width > 0 ? color(o.line.color) : undefined;
  const radius = type === 'roundRect' ? (o.rectRadius || 0.1) * PT : 0;
  const draw = (dx, dy, opts) => {
    if (radius) page.drawSvgPath(roundedRectPath(b.w, b.h, radius), { x: b.x + dx, y: PAGE_H - b.top - dy, ...opts });
    else page.drawRectangle({ x: b.x + dx, y: b.y - dy, width: b.w, height: b.h, ...opts });
  };
  if (o.shadow) { // м'яка тінь: кілька напівпрозорих копій зі зсувом униз
    for (const [d, a] of [[3, 0.035], [2, 0.05], [1, 0.07]]) draw(0, d, { color: color('000000'), opacity: a });
  }
  draw(0, 0, {
    ...(fill ? { color: fill } : {}),
    ...(border ? { borderColor: border, borderWidth: Math.max(0.3, o.line.width) } : {}),
    ...(border && o.line.dashType ? { borderDashArray: [4, 3] } : {}),
  });
}

async function drawImage({ doc, page, images }, o) {
  const key = o.data;
  let image = images.get(key);
  if (!image) {
    const base64 = String(o.data).replace(/^[^,]*base64,|^image\/png;base64,/, '');
    image = await doc.embedPng(base64);
    images.set(key, image);
  }
  const b = box(o);
  page.drawImage(image, { x: b.x, y: b.y, width: b.w, height: b.h });
}

/** Розбиває вміст на абзаци з фрагментами {text, bold, italic, color, size}. */
function paragraphsOf(content, o) {
  const runs = Array.isArray(content) ? content : [{ text: String(content), options: {} }];
  const paragraphs = [];
  let current = null;
  for (const run of runs) {
    const ro = run.options || {};
    if (!current) current = { segments: [], before: ro.paraSpaceBefore || 0, after: 0, bullet: ro.bullet ? (ro.bullet.indent || 12) : 0 };
    current.segments.push({ text: run.text, bold: ro.bold != null ? ro.bold : o.bold, italic: ro.italic != null ? ro.italic : o.italic, color: ro.color || o.color, size: ro.fontSize || o.fontSize || 12 });
    if (ro.breakLine) { current.after = ro.paraSpaceAfter || 0; paragraphs.push(current); current = null; }
  }
  if (current) paragraphs.push(current);
  return paragraphs;
}

function layout(pick, split, paragraphs, width, scale) {
  const lines = [];
  let height = 0;
  paragraphs.forEach((para, index) => {
    const indent = para.bullet * scale;
    const avail = width - indent;
    height += para.before * scale * (index ? 1 : 0);
    // слова зі стилем; розрив лише по звичайному пробілу (нерозривний пробіл тримає значення разом)
    const words = [];
    for (const seg of para.segments) for (const part of seg.text.split(/( )/)) if (part !== '') words.push({ text: part, seg });
    let line = { parts: [], width: 0, size: 0 };
    const flush = () => { if (line.parts.length) { lines.push({ ...line, indent, first: !lines.length || line.firstOfPara, para }); } line = { parts: [], width: 0, size: 0 }; };
    let first = true;
    for (const w of words) {
      const size = w.seg.size * scale;
      const pieces = split(w.text, pick(w.seg.bold, w.seg.italic)).map(piece => ({ ...piece, size, color: w.seg.color, width: piece.font.widthOfTextAtSize(piece.text, size) }));
      const wWidth = pieces.reduce((sum, piece) => sum + piece.width, 0);
      if (w.text === ' ' && !line.parts.length) continue;
      if (line.width + wWidth > avail && line.parts.length && w.text !== ' ') { if (first) line.firstOfPara = true; first = false; flush(); }
      line.parts.push(...pieces);
      line.width += wWidth; line.size = Math.max(line.size, size);
    }
    if (first && line.parts.length) line.firstOfPara = true;
    flush();
    const count = lines.filter(l => l.para === para).length;
    lines.filter(l => l.para === para).forEach((l, i) => { l.firstLine = i === 0; l.bulletHere = i === 0 && para.bullet > 0; l.lastOfPara = i === count - 1; });
    height += lines.filter(l => l.para === para).reduce((s, l) => s + l.size * 1.2, 0) + para.after * scale;
  });
  return { lines, height };
}

function drawText({ page, pick, split }, content, o) {
  const b = box(o);
  const paragraphs = paragraphsOf(content, o);
  let scale = 1;
  let result = layout(pick, split, paragraphs, b.w, scale);
  if (o.fit === 'shrink') while (result.height > b.h && scale > 0.55) { scale -= 0.05; result = layout(pick, split, paragraphs, b.w, scale); }
  let y = b.top + (o.valign === 'middle' ? Math.max(0, (b.h - result.height) / 2) : o.valign === 'bottom' ? Math.max(0, b.h - result.height) : 0);
  let lastPara = null;
  for (const line of result.lines) {
    if (line.para !== lastPara) { if (lastPara) y += lastPara.after * scale; if (lastPara) y += line.para.before * scale; lastPara = line.para; }
    const lineH = line.size * 1.2;
    const baseline = PAGE_H - (y + lineH * 0.82);
    const lineWidth = line.parts.reduce((s, p) => s + p.width, 0);
    const available = b.w - line.indent;
    let x = b.x + line.indent + (o.align === 'right' ? available - lineWidth : o.align === 'center' ? (available - lineWidth) / 2 : 0);
    if (line.bulletHere) page.drawText('•', { x: b.x + 1, y: baseline, size: line.parts[0].size, font: line.parts[0].font, color: color(line.parts[0].color) });
    for (const part of line.parts) { if (part.text.trim() !== '' || part.text === ' ') page.drawText(part.text, { x, y: baseline, size: part.size, font: part.font, color: color(part.color) }); x += part.width; }
    y += lineH;
  }
}

function niceTicks(max, unit) {
  if (unit) { const t = []; for (let v = 0; v <= max + 1e-9; v += unit) t.push(v); if (t[t.length - 1] < max) t.push(t[t.length - 1] + unit); return t; }
  if (max <= 0) return [0, 1];
  const raw = max / 5;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * pow).find(s => s >= raw);
  const ticks = [];
  for (let v = 0; v <= max + 1e-9; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  if (ticks[ticks.length - 1] < max) ticks.push(Math.round((ticks[ticks.length - 1] + step) * 1e6) / 1e6);
  return ticks;
}

const fmt = v => String(Math.round(v * 100) / 100).replace('.', ',');

function drawBarChart({ page, pick }, data, o) {
  const b = box(o);
  const font = pick(false, false);
  const size = 7.5;
  const muted = color('6B7280');
  const grid = color('D9DDE3');
  const series = data;
  const cats = series[0] ? series[0].labels : [];
  const colors = o.chartColors || [];
  const horizontal = o.barDir === 'bar';
  const stacked = o.barGrouping === 'stacked';
  const totals = cats.map((_, i) => (stacked ? series.reduce((s, x) => s + (x.values[i] || 0), 0) : Math.max(...series.map(x => x.values[i] || 0))));
  const max = Math.max(0, ...totals);
  const ticks = niceTicks(max, o.valAxisMajorUnit);
  const top = ticks[ticks.length - 1] || 1;
  const legendW = o.showLegend ? Math.max(...series.map(s => font.widthOfTextAtSize(s.name, size))) + 22 : 0;
  const rotate = !horizontal && o.catAxisLabelRotate === 270;
  const catLabelW = Math.max(0, ...cats.map(c => font.widthOfTextAtSize(String(c), size)));
  const left = horizontal ? Math.min(90, catLabelW + 8) : Math.max(...ticks.map(t => font.widthOfTextAtSize(fmt(t), size))) + 8;
  const bottom = horizontal ? 4 : rotate ? catLabelW + 6 : 14;
  const topPad = horizontal ? 12 : 6;
  const px = b.x + left, pw = b.w - left - legendW - 6;
  const pyTop = b.top + topPad, ph = b.h - topPad - bottom;
  const yPage = y => PAGE_H - y;
  const text = (t, x, y, opts = {}) => page.drawText(String(t), { x, y: yPage(y), size, font, color: muted, ...opts });

  // сітка й підписи значень
  for (const t of ticks) {
    const f = t / top;
    if (horizontal) {
      const x = px + f * pw;
      page.drawLine({ start: { x, y: yPage(pyTop) }, end: { x, y: yPage(pyTop + ph) }, thickness: 0.4, color: grid });
      text(fmt(t), x - font.widthOfTextAtSize(fmt(t), size) / 2, pyTop - 4);
    } else {
      const y = pyTop + ph - f * ph;
      page.drawLine({ start: { x: px, y: yPage(y) }, end: { x: px + pw, y: yPage(y) }, thickness: 0.4, color: grid });
      text(fmt(t), px - 4 - font.widthOfTextAtSize(fmt(t), size), y + size * 0.3);
    }
  }
  const n = cats.length || 1;
  const catSize = (horizontal ? ph : pw) / n;
  const gap = 0.35;
  const barSize = stacked ? catSize / (1 + gap) : catSize / (series.length + gap);
  cats.forEach((cat, ci) => {
    const start = (horizontal ? pyTop : px) + ci * catSize + (catSize - (stacked ? barSize : barSize * series.length)) / 2;
    let acc = 0;
    series.forEach((s, si) => {
      const v = s.values[ci] || 0;
      const fill = color(colors[si] || '7A1F2B');
      const offset = stacked ? 0 : si * barSize;
      if (horizontal) {
        const x0 = px + (stacked ? acc / top : 0) * pw;
        const len = (v / top) * pw;
        if (v > 0) page.drawRectangle({ x: x0, y: yPage(start + offset + barSize), width: len, height: barSize, color: fill });
        if (o.showValue && v > 0) text(fmt(v), x0 + len + 3, start + offset + barSize / 2 + size * 0.3, { color: color('111827') });
      } else {
        const h0 = (v / top) * ph;
        const y0 = pyTop + ph - (stacked ? acc / top : 0) * ph - h0;
        if (v > 0) page.drawRectangle({ x: start + offset, y: yPage(y0 + h0), width: barSize, height: h0, color: fill });
      }
      acc += v;
    });
    if (horizontal) text(String(cat).slice(0, 18), b.x + left - 6 - Math.min(font.widthOfTextAtSize(String(cat).slice(0, 18), size), left - 8), start + (stacked ? barSize : barSize * series.length) / 2 + size * 0.3);
    else if (rotate) { if (ci % Math.ceil(n / 40) === 0) page.drawText(String(cat), { x: start + barSize * (stacked ? 1 : series.length) / 2 + size * 0.3, y: yPage(pyTop + ph + 3 + font.widthOfTextAtSize(String(cat), size)), size, font, color: muted, rotate: { type: 'degrees', angle: 90 } }); }
    else text(String(cat), start + ((stacked ? barSize : barSize * series.length) - font.widthOfTextAtSize(String(cat), size)) / 2, pyTop + ph + 10);
  });
  if (o.showLegend) series.forEach((s, i) => {
    const ly = b.top + b.h / 2 - series.length * 5.5 + i * 11;
    page.drawRectangle({ x: b.x + b.w - legendW, y: yPage(ly + 6), width: 6, height: 6, color: color(colors[i] || '7A1F2B') });
    text(s.name, b.x + b.w - legendW + 10, ly + 5.5);
  });
}

