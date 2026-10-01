import assert from 'node:assert/strict';
import test from 'node:test';
import { STALE_DAYS, unitFreshness } from '../src/udshv-dashboard-core.js';

// Лише синтетичні дані.
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const SHEETS = { '08': 'СЕРПЕНЬ-26', '09': 'ВЕРЕСЕНЬ-26' };
const UNITS = ['Підрозділ А', 'Підрозділ Б', 'Підрозділ В', 'Підрозділ Г'];

// Підрозділ А — щодня до 30.09; Б — до 25.09; В — до 15.09; Г — ніколи.
function workbook({ stray = false } = {}) {
  const records = [];
  const last = { 'Підрозділ А': 59, 'Підрозділ Б': 54, 'Підрозділ В': 44 };
  for (let n = 0; n < 60; n++) {
    const date = addDays('2026-08-01', n);
    for (const unit of UNITS) records.push({ sheet: SHEETS[date.slice(5, 7)], rowNumber: records.length + 5, date, unit, values: n <= (last[unit] ?? -1) ? { 'personnel|200': 1 } : {} });
  }
  if (stray) records.push({ sheet: 'ВЕРЕСЕНЬ-26', rowNumber: 900, date: '2026-04-15', unit: 'Підрозділ Г', values: { 'personnel|200': 5 } });
  return { kind: 'udshv', readOnly: true, sourceName: 's.xlsx', sheetName: 'x', sheets: [], metrics: [], units: UNITS, records, issues: [] };
}

test('freshness: last day with data, lag from the last active date, days with data in 30, stale first', () => {
  const f = unitFreshness(workbook());
  assert.equal(f.anchor, '2026-09-29'); // 60 діб від 01.08: остання дата з даними
  assert.equal(f.staleDays, STALE_DAYS);
  assert.deepEqual([f.total, f.fresh, f.stale], [4, 2, 2]);
  assert.deepEqual(f.rows.map(r => r.unit), ['Підрозділ Г', 'Підрозділ В', 'Підрозділ Б', 'Підрозділ А']);
  const by = Object.fromEntries(f.rows.map(r => [r.unit, r]));
  assert.deepEqual([by['Підрозділ А'].lastDate, by['Підрозділ А'].lag, by['Підрозділ А'].stale, by['Підрозділ А'].daysWithData30], ['2026-09-29', 0, false, 30]);
  assert.deepEqual([by['Підрозділ Б'].lastDate, by['Підрозділ Б'].lag, by['Підрозділ Б'].stale], ['2026-09-24', 5, false]);
  assert.deepEqual([by['Підрозділ В'].lastDate, by['Підрозділ В'].lag, by['Підрозділ В'].stale, by['Підрозділ В'].daysWithData30], ['2026-09-14', 15, true, 15]);
  assert.deepEqual([by['Підрозділ Г'].lastDate, by['Підрозділ Г'].lag, by['Підрозділ Г'].stale, by['Підрозділ Г'].daysWithData30], ['', null, true, 0]);
});

test('freshness: the threshold is configurable and the selection narrows the list', () => {
  assert.equal(unitFreshness(workbook(), { staleDays: 3 }).stale, 3);
  assert.equal(unitFreshness(workbook(), { staleDays: 20 }).stale, 1);
  const only = unitFreshness(workbook(), { units: ['Підрозділ Б', 'Підрозділ А'] });
  assert.deepEqual(only.rows.map(r => r.unit), ['Підрозділ Б', 'Підрозділ А']);
  assert.equal(only.total, 2);
  assert.equal(unitFreshness(workbook(), { anchor: '2026-09-20' }).rows.find(r => r.unit === 'Підрозділ В').lag, 6);
});

test('freshness: a row dated outside its sheet month does not make a unit fresh', () => {
  const g = unitFreshness(workbook({ stray: true })).rows.find(r => r.unit === 'Підрозділ Г');
  assert.deepEqual([g.lastDate, g.stale], ['', true]);
});

/* Мінімальний DOM, суворий там, де це важливо (append() приймає вузли, не масиви). */
function fakeDocument() {
  class Node {
    constructor(tag, svg) {
      this.tagName = tag; this.children = []; this.attributes = {}; this.listeners = {};
      this.style = { setProperty(name, value) { this[name] = String(value); } };
      this.classList = { add: name => { this.attributes.class = `${this.attributes.class || ''} ${name}`.trim(); }, remove: () => {} };
      if (svg) Object.defineProperty(this, 'className', { get: () => ({ baseVal: this.attributes.class || '' }) });
    }
    get nodeType() { return 1; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    addEventListener(type, listener) { this.listeners[type] = listener; }
    append(...nodes) {
      for (const node of nodes) {
        if (node == null || typeof node !== 'object' || !node.nodeType) throw new TypeError('append() got a non-node');
        this.children.push(node);
      }
    }
    set textContent(value) { this.children = value === '' ? [] : [{ nodeType: 3, text: String(value) }]; }
    get textContent() { return this.children.map(node => (node.nodeType === 3 ? node.text : node.textContent)).join(''); }
    querySelector(selector) { const id = /#([\w-]+)$/.exec(selector)?.[1]; return this.children.find(node => node.attributes?.id === id) || null; }
    all() { return [this, ...this.children.flatMap(node => (node.all ? node.all() : []))]; }
  }
  return { Node, createElement: tag => new Node(tag, false), createElementNS: (ns, tag) => new Node(tag, true), createTextNode: text => ({ nodeType: 3, text }), dispatchEvent() {}, addEventListener() {} };
}

test('the dashboard has an «Актуальність» panel and a hint in the header that opens it', async () => {
  const document = fakeDocument();
  Object.assign(globalThis, { window: globalThis, document, Event: class { constructor(type) { this.type = type; } } });
  const dashboard = await import('../src/udshv-dashboard.js');
  const host = document.createElement('section');
  dashboard.render(host, workbook(), {});
  const root = host.children[0];
  const buttons = () => root.all().filter(node => node.tagName === 'button');
  const hint = buttons().find(node => /Без свіжих даних: 2 з 4 підрозділів/.test(node.textContent));
  assert.ok(hint, 'підказка в шапці показує кількість без свіжих даних');
  hint.listeners.click();
  assert.match(root.textContent, /Актуальність підрозділів/);
  assert.match(root.textContent, /в аналізі 4 · свіжі дані 2 · без свіжих даних 2/);
  assert.match(root.textContent, /Підрозділ Г.*—.*даних немає/);
  assert.match(root.textContent, /14\.09\.2026/);
  assert.match(root.textContent, /15 діб тому/);
  assert.match(root.textContent, /актуально/);
  const rows = root.all().filter(node => node.tagName === 'tr' && /ud-stale/.test(node.attributes.class || ''));
  assert.equal(rows.length, 2, 'підрозділи без свіжих даних позначені');
  // Перехід з панелі на сторінку підрозділу.
  buttons().find(node => node.textContent === 'Підрозділ А').listeners.click();
  assert.match(root.textContent, /Підрозділ А/);
  assert.ok(buttons().some(node => node.textContent === '× усі підрозділи'));
});
