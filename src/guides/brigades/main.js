// Довідник бригад: картки з емблемами, пошук і фільтр за родом військ.
import { BRANCHES, BRIGADES } from './brigades-data.js';
import { branchCounts, branchName, filterBrigades, purposeOf, shortName, typeName } from './brigades-core.js';

let URLS = {};
try {
  URLS = {
    ...import.meta.glob('../../unit-art/*.webp', { eager: true, query: '?url', import: 'default' }),
    ...import.meta.glob('./art/*.webp', { eager: true, query: '?url', import: 'default' }),
  };
} catch { URLS = {}; }
const artUrl = name => URLS[`../../unit-art/${name}.webp`] || URLS[`./art/${name}.webp`] || null;

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const state = { query: '', branch: '' };
const counts = branchCounts(BRIGADES);
const FILTERS = [['', 'Усі'], ...Object.entries(BRANCHES), ...(counts.none ? [['none', 'Рід не вказано']] : [])];

function renderChips() {
  const box = document.getElementById('branches');
  box.replaceChildren(...FILTERS.map(([key, label]) => {
    const b = el('button', 'chip', `${label} · ${counts[key] ?? 0}`);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(state.branch === key));
    b.addEventListener('click', () => { state.branch = key; renderChips(); renderGrid(); });
    return b;
  }));
}

function card(b) {
  const node = el('article', 'card');
  const src = artUrl(b.art);
  if (src) { const img = el('img', 'crest'); img.src = src; img.alt = ''; node.append(img); } else node.append(el('span', 'crest crest-ph'));
  const body = el('div', 'body');
  body.append(el('h2', '', shortName(b)));
  if (b.nickname) body.append(el('p', 'nick', `«${b.nickname}»`));
  const dl = el('dl');
  for (const [k, v, always] of [['Тип', typeName(b)], ['Рід військ', branchName(b), true], ['Призначення', purposeOf(b)], ['Дислокація', b.place]]) {
    if (!v && !always) continue;
    dl.append(el('dt', '', k), el('dd', v ? '' : 'none', v || '—'));
  }
  body.append(dl);
  node.append(body);
  return node;
}

function renderGrid() {
  const list = filterBrigades(BRIGADES, state);
  document.getElementById('count').textContent = `Показано ${list.length} з ${BRIGADES.length}`;
  const grid = document.getElementById('grid');
  grid.replaceChildren(...(list.length ? list.map(card) : [el('p', 'empty', 'Нічого не знайдено.')]));
}

document.getElementById('q').addEventListener('input', e => { state.query = e.target.value; renderGrid(); });
renderChips();
renderGrid();
