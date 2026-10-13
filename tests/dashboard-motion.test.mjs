import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8');

function fakeNode(text = '') {
  const style = new Map();
  return { textContent: text, isConnected: true, classList: { contains: () => false }, style: { setProperty: (k, v) => style.set(k, v) }, styleMap: style };
}

function fakeRoot(byContains = {}) {
  const attrs = new Map();
  return {
    attrs,
    setAttribute: (k, v) => attrs.set(k, v),
    removeAttribute: k => attrs.delete(k),
    // Повертає заздалегідь підготовлені вузли для селекторів, що містять заданий фрагмент.
    querySelectorAll: selector => {
      for (const [fragment, nodes] of Object.entries(byContains)) if (selector.includes(fragment)) return nodes;
      return [];
    },
  };
}

function withEnv({ reduced = false } = {}, run) {
  const saved = { matchMedia: globalThis.matchMedia, raf: globalThis.requestAnimationFrame };
  const queue = [];
  globalThis.matchMedia = () => ({ matches: reduced });
  globalThis.requestAnimationFrame = cb => { queue.push(cb); return queue.length; };
  try { return run(queue); } finally {
    globalThis.matchMedia = saved.matchMedia;
    globalThis.requestAnimationFrame = saved.raf;
  }
}

test('анімація: перше відкриття — first, зміна розділу — enter, перемальовування того ж розділу — без анімації', async () => {
  const { playMotion } = await import('../src/dashboard-motion.js');
  withEnv({}, () => {
    const root = fakeRoot();
    assert.equal(playMotion(root, 'summary'), true);
    assert.equal(root.attrs.get('data-dash-motion'), 'first');
    // Клік по фільтру перемальовує сторінку, але розділ той самий.
    assert.equal(playMotion(root, 'summary'), false);
    assert.equal(root.attrs.has('data-dash-motion'), false);
    assert.equal(playMotion(root, 'ovt'), true);
    assert.equal(root.attrs.get('data-dash-motion'), 'enter');
    assert.equal(playMotion(root, 'ovt'), false);
    assert.equal(playMotion(null, 'ovt'), false);
  });
});

test('анімація: prefers-reduced-motion вимикає все, навіть при зміні розділу', async () => {
  const { playMotion } = await import('../src/dashboard-motion.js');
  withEnv({ reduced: true }, queue => {
    const root = fakeRoot({ '.ud-kpi': [fakeNode('1 234')] });
    assert.equal(playMotion(root, 'summary'), false);
    assert.equal(playMotion(root, 'units'), false);
    assert.equal(root.attrs.has('data-dash-motion'), false);
    assert.equal(queue.length, 0, 'лічильник не запускається');
  });
});

test('анімація: перемикач «Анімації» застосунку (data-motion=off на html) теж вимикає рух', async () => {
  const { playMotion } = await import('../src/dashboard-motion.js');
  const saved = globalThis.document;
  globalThis.document = { documentElement: { dataset: { motion: 'off' } } };
  try {
    withEnv({}, queue => {
      const root = fakeRoot({ '.ud-kpi': [fakeNode('1 234')] });
      assert.equal(playMotion(root, 'summary'), false);
      assert.equal(root.attrs.has('data-dash-motion'), false);
      assert.equal(queue.length, 0);
    });
  } finally { globalThis.document = saved; }
});

test('анімація: resetMotion повертає вступну анімацію для того самого кореня', async () => {
  const { playMotion, resetMotion } = await import('../src/dashboard-motion.js');
  withEnv({}, () => {
    const root = fakeRoot();
    playMotion(root, 'summary');
    resetMotion(root);
    assert.equal(root.attrs.has('data-dash-motion'), false);
    playMotion(root, 'summary');
    assert.equal(root.attrs.get('data-dash-motion'), 'first');
  });
});

test('лічильник: числа набігають від нуля й завершуються точним початковим текстом', async () => {
  const { playMotion } = await import('../src/dashboard-motion.js');
  const big = fakeNode((12345).toLocaleString('uk-UA'));
  const percent = fakeNode('12,5%');
  const small = fakeNode('1');
  const dash = fakeNode('—');
  const originals = [big.textContent, percent.textContent, small.textContent, dash.textContent];
  const realNow = performance.now;
  withEnv({}, queue => {
    let now = 1000;
    performance.now = () => now;
    try {
      playMotion(fakeRoot({ '.ud-kpi > strong': [big, percent, small, dash] }), 'summary');
      assert.equal(big.textContent, '0');
      assert.equal(percent.textContent, originals[1], 'відсотки не чіпаємо');
      assert.equal(small.textContent, originals[2], 'одиницю не анімуємо');
      assert.equal(dash.textContent, originals[3]);
      now = 1375;
      queue.shift()(now);
      const mid = Number(big.textContent.replace(/\s/g, '').replace(/ /g, ''));
      assert.ok(mid > 0 && mid < 12345, `проміжне значення ${mid}`);
      now = 2000;
      queue.shift()(now);
      assert.equal(big.textContent, originals[0], 'фінальний текст збігається з відрендереним');
    } finally { performance.now = realNow; }
  });
});

test('лічильник: вузол, що вже відʼєднано від сторінки, не оновлюється і не тримає цикл', async () => {
  const { playMotion } = await import('../src/dashboard-motion.js');
  const node = fakeNode((5000).toLocaleString('uk-UA'));
  withEnv({}, queue => {
    playMotion(fakeRoot({ '.ud-kpi > strong': [node] }), 'summary');
    node.isConnected = false;
    const before = node.textContent;
    queue.shift()(performance.now() + 200);
    assert.equal(node.textContent, before);
    assert.equal(queue.length, 0, 'наступний кадр не запрошено');
  });
});

test('затримки: стовпчики графіка отримують хвилю, прозорі зони кліку — ні', async () => {
  const { playMotion } = await import('../src/dashboard-motion.js');
  const rect = fakeNode();
  const hit = fakeNode();
  hit.classList = { contains: name => name === 'ud-hit' };
  const svg = { querySelectorAll: () => [rect, hit] };
  withEnv({}, () => {
    playMotion(fakeRoot({ '.ud-chart svg': [svg] }), 'summary');
  });
  assert.ok(rect.styleMap.get('--dm-d'));
  assert.equal(hit.styleMap.has('--dm-d'), false);
});

test('CSS: вхідні анімації лише під data-dash-motion і prefers-reduced-motion, мікро-взаємодії теж', async () => {
  const css = await read('dashboard-motion.css');
  assert.match(css, /@media \(prefers-reduced-motion: no-preference\)/);
  // Кожне правило з animation: стоїть усередині блока no-preference (жодного поза ним).
  const outside = css.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}\n/g, '');
  assert.doesNotMatch(outside.replace(/@keyframes[^{]+\{[\s\S]*?\}\n/g, ''), /animation\s*:/);
  // Атрибут кореня не збігається з глобальним data-motion на <html>, інакше анімація йшла б при кожному перемальовуванні.
  assert.doesNotMatch(css, /\[data-motion/);
  for (const name of ['dm-rise', 'dm-grow-x', 'dm-grow-y', 'dm-reveal', 'dm-sweep']) assert.match(css, new RegExp(`@keyframes ${name}\\b`));
  // Анімації заповнюють лише «назад»: після завершення вузол повертається до звичайного стану й не блокує hover-transform.
  assert.doesNotMatch(css, /animation[^;]*\b(forwards|both)\b/);
  // Дашборди ПВК, УДШВ і «Наші втрати» мають власні правила.
  for (const marker of ['.ud-kpi', '.pvk-kpi', '.ol-kpi', '.pvk-donut', '.ud-rank-row', '.ol-rank-row']) assert.ok(css.includes(marker), marker);
});

test('CSS підключено на сторінках ПС (ПВК) і РВ (УДШВ), модуль — у обох дашбордах', async () => {
  for (const page of ['air.html', 'rocket.html']) {
    const html = await read(page);
    assert.match(html, /<link rel="stylesheet" href="\.\/dashboard-motion\.css">/, page);
    assert.ok(html.indexOf('dashboard-motion.css') > html.indexOf('own-losses-dashboard.css'), `${page}: після власних стилів дашборда`);
  }
  for (const file of ['pvk-dashboard.js', 'udshv-dashboard.js']) {
    const js = await read(file);
    assert.match(js, /import \{ playMotion[^}]*\} from '\.\/dashboard-motion\.js'/, file);
    assert.match(js, /playMotion\(root, own && root\.querySelector\('\.ol-kpi'\) \? 'own:data' : state\.view\)/, file);
  }
});

test('анімація: корінь без querySelectorAll (спрощений DOM) не ламає рендер і не отримує атрибут', async () => {
  const { playMotion } = await import('../src/dashboard-motion.js');
  withEnv({}, () => {
    const attrs = new Map();
    const root = { setAttribute: (k, v) => attrs.set(k, v), removeAttribute: k => attrs.delete(k) };
    assert.equal(playMotion(root, 'summary'), false);
    assert.equal(attrs.size, 0);
  });
});
