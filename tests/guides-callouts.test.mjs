// Виноски уразливих місць і рядок ТТХ довідника авіації (src/guides/aviation/callouts.js).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { calloutLayout, calloutNumber, ttxItems } from '../src/guides/aviation/callouts.js';

test('номер виноски має провідний нуль', () => {
  assert.equal(calloutNumber(0), '01');
  assert.equal(calloutNumber(5), '06');
  assert.equal(calloutNumber(11), '12');
});

test('рядок ТТХ: швидкість, дальність, стеля, маса — у такому порядку, з запасними назвами', () => {
  const specs = [['Екіпаж', '3'], ['Макс. злітна маса', '12 000 кг'], ['Стеля', '4 500 м'], ['Дальність', '≈450 км'], ['Макс. швидкість', '250 км/год'], ['Двигуни', '2 × ТВ2-117']];
  assert.deepEqual(ttxItems(specs).map((item) => item.label), ['Макс. швидкість', 'Дальність', 'Стеля', 'Макс. злітна маса']);
  const missile = [['Довжина', '7,6 м'], ['Стартова маса', '2 400 кг'], ['Швидкість', '≈700 км/год'], ['Бойова частина', '400 кг']];
  assert.deepEqual(ttxItems(missile).map((item) => item.label), ['Швидкість', 'Стартова маса', 'Довжина', 'Бойова частина']);
});

test('у рядку ТТХ уточнення в дужках відкидається, повне значення лишається для підказки', () => {
  const [item] = ttxItems([['Дальність', '460 км (перегін 1 110)']]);
  assert.deepEqual(item, { label: 'Дальність', value: '460 км', full: '460 км (перегін 1 110)' });
});

test('рядок ТТХ без чисел порожній, а екіпаж не займає місце характеристики', () => {
  assert.deepEqual(ttxItems([['Зазвичай без озброєння', '']]), []);
  assert.deepEqual(ttxItems(undefined), []);
  assert.deepEqual(ttxItems([['Екіпаж', '2'], ['Довжина', '12 м']]).map((item) => item.label), ['Довжина']);
});

test('виноски стоять двома стовпцями біля країв і не налазять одна на одну', () => {
  const width = 900;
  const height = 500;
  const points = [{ x: 300, y: 200 }, { x: 320, y: 205 }, { x: 310, y: 210 }, { x: 600, y: 300 }, { x: 640, y: 480 }];
  const layout = calloutLayout(points, { width, height });
  assert.deepEqual(layout.map((item) => item.side), ['left', 'left', 'left', 'right', 'right']);
  const left = layout.filter((item) => item.side === 'left').map((item) => item.labelY).sort((a, b) => a - b);
  for (let i = 1; i < left.length; i += 1) assert.ok(left[i] - left[i - 1] >= 30, 'між підписами щонайменше gap');
  for (const item of layout) {
    assert.ok(item.labelY >= 34 && item.labelY <= height - 30, 'підпис у межах сцени');
    assert.equal(item.labelX, item.side === 'left' ? 14 + 150 : width - 14 - 150);
    assert.equal(item.maxWidth, 150);
  }
  // Лікоть лежить між точкою й стовпцем.
  points.forEach((point, i) => {
    const { elbowX, labelX } = layout[i];
    assert.ok(elbowX <= Math.max(point.x, labelX) && elbowX >= Math.min(point.x, labelX));
  });
});

test('забагато виносок біля низу: стовпець підтискається вгору, не виходячи за межі', () => {
  const points = Array.from({ length: 6 }, (_, i) => ({ x: 100 + i, y: 470 + i }));
  const layout = calloutLayout(points, { width: 800, height: 500 });
  const ys = layout.map((item) => item.labelY).sort((a, b) => a - b);
  assert.ok(ys.at(-1) <= 500 - 30 - 15);
  for (let i = 1; i < ys.length; i += 1) assert.ok(ys[i] - ys[i - 1] >= 30 - 1e-9);
});

test('точка біля краю відсуває стовпець далі від себе, але не вужче за 72 px', () => {
  const [near, edge] = calloutLayout([{ x: 120, y: 200 }, { x: 860, y: 200 }], { width: 900, height: 500 });
  assert.equal(near.labelX, 120 - 28, 'стовпець закінчується до номера на моделі');
  assert.equal(near.maxWidth, 120 - 28 - 14);
  assert.equal(edge.labelX, 900 - 14 - 72, 'біля самого краю — найвужчий стовпець');
  assert.equal(edge.maxWidth, 72);
});

test('на вузькій сцені стовпців немає, а точки без координат пропускаються', () => {
  assert.deepEqual(calloutLayout([{ x: 10, y: 10 }], { width: 400, height: 300 }), [null]);
  assert.deepEqual(calloutLayout([{ x: Number.NaN, y: 10 }, null], { width: 900, height: 500 }), [null, null]);
});

test('сторінка авіації підключає виноски й рядок ТТХ', async () => {
  const main = await readFile(new URL('../src/guides/aviation/main.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../src/guides/aviation/index.html', import.meta.url), 'utf8');
  assert.match(main, /import \{calloutLayout, calloutNumber, ttxItems\} from '\.\/callouts\.js';/);
  assert.match(html, /<dl class="ttx" id="ttx"/);
});
