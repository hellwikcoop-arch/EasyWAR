import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const read = name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8');

test('стиль «Пункт керування»: правила лише під html[data-skin="heightwell"] у темній темі', async () => {
  const css = (await read('public/heightwell-theme.css')).replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = css.replace(/@font-face\s*\{[^}]*\}/g, '');
  const selectors = rules.split('{').slice(0, -1).map(chunk => chunk.split('}').pop().trim()).filter(Boolean);
  assert.ok(selectors.length > 8);
  for (const sel of selectors) {
    assert.match(sel, /^html\[data-skin="heightwell"\]/, sel);
    assert.ok(sel.includes(':not([data-theme="light"])'), sel);
  }
  assert.doesNotMatch(css, /animation|@keyframes/, 'рух живе в dashboard-motion.css');
});

test('стиль «Пункт керування»: шрифти локальні, файли на місці, ліцензії поруч', async () => {
  const css = await read('public/heightwell-theme.css');
  assert.doesNotMatch(css, /https?:\/\//, 'жодних зовнішніх адрес');
  const urls = [...css.matchAll(/url\("([^"]+)"\)/g)].map(m => m[1]);
  assert.ok(urls.length >= 10);
  for (const u of urls) {
    assert.match(u, /^\.\/fonts\/heightwell\/[\w-]+\.woff2$/, u);
    const { size } = await stat(new URL(`../src/public/${u.slice(2)}`, import.meta.url));
    assert.ok(size > 1000 && size < 40_000, `${u}: ${size} байт`);
  }
  for (const lic of ['space-grotesk', 'onest', 'ibm-plex-mono'].map(n => `public/fonts/heightwell/${n}.txt`)) {
    assert.match(await read(lic), /SIL Open Font License/, lic);
  }
  // Space Grotesk не має кирилиці: її дають гліфи Onest у тій самій гарнітурі.
  assert.match(css, /onest-cyrillic-700-normal\.woff2[^}]*U\+0400-045F/);
});

test('стиль «Пункт керування» не вбудовується в сторінки: його підвантажує ui-kit.js лише після вмикання', async () => {
  for (const page of ['air.html', 'rocket.html', 'artillery.html']) {
    const html = await read(page);
    assert.match(html, /<script src="\.\/ui-kit\.js" defer><\/script>/, page);
    assert.ok(!html.includes('heightwell'), page);
  }
  assert.ok(!(await read('ui-kit.css')).includes('heightwell'), 'файли командування для телефона не важчають');
  const js = await read('public/ui-kit.js');
  assert.ok(js.includes("var SKIN_CSS = './heightwell-theme.css';"));
  assert.doesNotMatch(js, /href="\.\//, 'збірка файлів командування не вважатиме це зовнішнім посиланням');
});

function fakePage({ stored = null, withThemeBtn = true } = {}) {
  const store = new Map(stored ? [['aviahub.skin', stored]] : []);
  const attrs = new Map();
  const els = new Map();
  const mk = id => {
    return {
      id, attrs: new Map(), listeners: {}, textContent: '', title: '', parentNode: null,
      setAttribute(k, v) { this.attrs.set(k, String(v)); },
      getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; },
      addEventListener(t, f) { this.listeners[t] = f; },
    };
  };
  const parent = { children: [], insertBefore(node, ref) { const i = ref ? this.children.indexOf(ref) : -1; this.children.splice(i < 0 ? this.children.length : i, 0, node); node.parentNode = this; if (node.id) els.set(node.id, node); } };
  if (withThemeBtn) { const t = mk('themeBtn'); parent.children.push(t); t.parentNode = parent; els.set('themeBtn', t); }
  const root = {
    classList: { add() {}, remove() {} },
    setAttribute(k, v) { attrs.set(k, String(v)); },
    getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
    removeAttribute(k) { attrs.delete(k); },
  };
  const document = {
    readyState: 'complete', documentElement: root, body: {},
    head: { children: [], appendChild(n) { this.children.push(n); if (n.id) els.set(n.id, n); } },
    getElementById: id => els.get(id) || null,
    querySelectorAll: () => [],
    createElement: () => mk(''),
    addEventListener() {},
  };
  const window = {
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    matchMedia: () => ({ matches: true }), addEventListener() {}, requestAnimationFrame: f => f(),
  };
  return { document, window, attrs, store, els, parent };
}

async function runKit(page) {
  const src = await read('public/ui-kit.js');
  const ctx = { document: page.document, window: page.window, setTimeout, MutationObserver: undefined };
  vm.runInNewContext(src, ctx);
  return ctx.window.EWUiSkin;
}

test('ui-kit.js: перемикач «Пункт керування» ставить атрибут і запам\'ятовує вибір', async () => {
  const page = fakePage();
  const api = await runKit(page);
  assert.equal(page.attrs.get('data-skin'), undefined, 'за замовчуванням вимкнено');
  assert.equal(page.document.head.children.length, 0, 'вимкнений стиль не підвантажується');
  const btn = page.els.get('skinBtn');
  assert.ok(btn, 'кнопка з\'явилась поруч із кнопкою теми');
  assert.equal(page.parent.children.indexOf(btn), page.parent.children.indexOf(page.els.get('themeBtn')) + 1);
  assert.equal(btn.getAttribute('aria-label'), 'Стиль «Пункт керування»: вимк.');
  assert.equal(btn.textContent, '◈', 'лише значок: рядок кнопок не переповнюється');
  btn.listeners.click();
  assert.equal(page.attrs.get('data-skin'), 'heightwell');
  assert.equal(page.store.get('aviahub.skin'), 'heightwell');
  assert.equal(page.document.head.children.length, 1);
  assert.equal(page.document.head.children[0].href, './heightwell-theme.css');
  assert.equal(btn.getAttribute('aria-pressed'), 'true');
  assert.equal(btn.getAttribute('aria-label'), 'Стиль «Пункт керування»: увімк.');
  api.toggle();
  assert.equal(page.attrs.get('data-skin'), undefined);
  assert.equal(page.store.has('aviahub.skin'), false);
  api.toggle();
  assert.equal(page.document.head.children.length, 1, 'стилі підключаються один раз');
});

test('ui-kit.js: якщо стилів немає (файл для телефона), стиль вимикається, а кнопка ховається', async () => {
  const page = fakePage({ stored: 'heightwell' });
  await runKit(page);
  assert.equal(page.attrs.get('data-skin'), 'heightwell');
  page.document.head.children[0].onerror();
  assert.equal(page.attrs.get('data-skin'), undefined);
  assert.equal(page.els.get('skinBtn').hidden, true);
});

test('ui-kit.js: збережений вибір застосовується одразу, навіть без кнопки теми', async () => {
  const page = fakePage({ stored: 'heightwell', withThemeBtn: false });
  await runKit(page);
  assert.equal(page.attrs.get('data-skin'), 'heightwell');
  assert.equal(page.els.get('skinBtn'), undefined);
  const other = fakePage({ stored: 'щось-інше' });
  await runKit(other);
  assert.equal(other.attrs.get('data-skin'), undefined, 'невідоме значення ігнорується');
});
