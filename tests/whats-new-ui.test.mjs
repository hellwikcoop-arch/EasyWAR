// «Що нового»: текстові контракти екрана (src/whats-new.js, whats-new.css) і підключення до головного екрана.
// Поведінку в браузері перевіряє скіл run-easywar (скриншоти); тут — інваріанти, які легко зламати правкою.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

/** Вміст першого блоку `@media (…) { … }` із вказаним початком умови (з урахуванням вкладених дужок). */
function mediaBlock(css, condition) {
  const start = css.indexOf(`@media (${condition})`);
  assert.ok(start >= 0, `у CSS немає @media (${condition})`);
  let depth = 0;
  for (let index = css.indexOf('{', start); index < css.length; index += 1) {
    if (css[index] === '{') depth += 1;
    if (css[index] === '}' && --depth === 0) return css.slice(css.indexOf('{', start) + 1, index);
  }
  throw new Error(`@media (${condition}) не закрито`);
}

test('кнопка «Що нового» додається в панель інструментів головного екрана між «Оновленнями» і «3D-довідниками»', async () => {
  const tools = await read('src/launcher-tools.js');
  const order = ['phone-export', 'whats-new', 'guides-launcher'].map((name) => tools.indexOf(`import './${name}.js';`));
  assert.ok(order.every((index) => index > 0), 'усі три підключені');
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'порядок імпортів задає порядок кнопок (prepend)');
  const script = await read('src/whats-new.js');
  assert.match(script, /document\.querySelector\('\.appbar-right'\)/);
  assert.match(script, /toolbar\.prepend\(openButton\)/);
  assert.match(script, /openButton\.textContent = 'Що нового'/);
});

test('дані нотаток потрапляють на сторінку лише через textContent / createTextNode, а innerHTML містить тільки власний шаблон', async () => {
  const script = await read('src/whats-new.js');
  const uses = script.match(/\.innerHTML\b/g) ?? [];
  assert.equal(uses.length, 1, 'innerHTML — лише для статичної розмітки накладки');
  const template = script.match(/root\.innerHTML = `([\s\S]*?)`;/)?.[1];
  assert.ok(template, 'шаблон накладки знайдено');
  const placeholders = [...template.matchAll(/\$\{([^}]+)\}/g)].map((match) => match[1]);
  assert.ok(placeholders.length > 0 && placeholders.every((name) => /^ICONS\.(menu|newer|older|close)$/.test(name)), `у шаблон вставляються лише значки: ${placeholders}`);
  assert.doesNotMatch(script, /insertAdjacentHTML|outerHTML|document\.write|eval\(|new Function/);
  for (const field of ['release.intro', 'entry.lead', 'segment.text', 'release.summary', 'release.version']) {
    assert.match(script, new RegExp(`(textContent = ${field.replace('.', '\\.')}|createTextNode\\(${field.replace('.', '\\.')}\\))`), `${field} вставляється як текст`);
  }
});

test('мережі немає: нотатки з пакета збірки, JSON підвантажується ліниво', async () => {
  const script = await read('src/whats-new.js');
  assert.doesNotMatch(script, /\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|https?:\/\//);
  assert.match(script, /import\('\.\/whats-new\/releases\.json'\)/);
  assert.doesNotMatch(script, /^import .*releases\.json/m, 'JSON не тягнеться в стартовий пакет');
});

test('версія застосунку береться з команди Tauri лише за наявності Tauri; сховище необов\'язкове й обгорнуте try/catch', async () => {
  const script = await read('src/whats-new.js');
  assert.match(script, /typeof window\.__TAURI_INTERNALS__\?\.invoke !== 'function'/);
  assert.match(script, /getDatabaseStatus\(\)/);
  assert.match(script, /const SEEN_KEY = 'ew\.whatsnew\.seen\.v1';/);
  for (const call of ['localStorage.getItem', 'localStorage.setItem']) {
    const at = script.indexOf(call);
    assert.ok(at > 0, call);
    assert.match(script.slice(Math.max(0, at - 60), at), /try \{/, `${call} у try`);
  }
});

test('накладка — модальний діалог: роль, aria-modal, inert для головного екрана, відновлення фокуса, Esc, Tab-пастка', async () => {
  const script = await read('src/whats-new.js');
  assert.match(script, /setAttribute\('role', 'dialog'\)/);
  assert.match(script, /setAttribute\('aria-modal', 'true'\)/);
  assert.match(script, /setAttribute\('aria-labelledby', 'ew-wn-title'\)/);
  assert.match(script, /launcher\.inert = true/);
  assert.match(script, /launcher\.inert = launcherWasInert/, 'попередній стан inert повертається, а не скидається');
  assert.match(script, /openButton\.focus\(\)/, 'фокус повертається на кнопку');
  assert.match(script, /event\.key === 'Escape'[\s\S]*?menuIsOpen\(\)\) closeMenu\(true\);\s*else close\(\)/, 'Esc спершу закриває зміст, потім накладку');
  assert.match(script, /event\.key === 'Tab'/);
  assert.match(script, /!root\.contains\(active\) \|\| active === scroll/, 'Tab із тексту статті веде до кнопок, а не з діалогу');
  assert.match(script, /if \(!root\.hidden \|\| opening\) return;\s*opening = true;/, 'подвійний клик не відкриває накладку вдруге (інакше inert головного екрана не знявся б)');
  assert.match(script, /ArrowLeft[\s\S]*?showIndex\(index - 1\)[\s\S]*?ArrowRight[\s\S]*?showIndex\(index \+ 1\)/, '← новіша, → старіша');
  for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End']) assert.match(script, new RegExp(key), `${key} у змісті`);
  assert.match(script, /aria-live', 'polite'|aria-live="polite"/);
});

test('кнопки ‹ › не вимикаються атрибутом disabled, щоб фокус не пропадав на межі списку', async () => {
  const script = await read('src/whats-new.js');
  assert.match(script, /setAttribute\('aria-disabled', String\(!canStep\(/);
  assert.doesNotMatch(script, /\.disabled\s*=/);
  assert.match(script, /aria-label="Новіша версія"/);
  assert.match(script, /aria-label="Старіша версія"/);
  assert.match(script, /aria-label="Закрити «Що нового»"/);
  assert.match(script, /aria-label="Зміст: усі версії"/);
});

test('рух: усі анімації CSS лише під prefers-reduced-motion: no-preference, а програмна — після перевірки motionAllowed', async () => {
  const css = await read('src/whats-new.css');
  const allowed = mediaBlock(css, 'prefers-reduced-motion: no-preference');
  const outside = css.replace(allowed, '');
  assert.doesNotMatch(outside.replace(/@keyframes[^{]+\{[\s\S]*?\}\s*\}|@keyframes[^\n]*\n/g, ''), /\banimation\s*:/, 'animation: поза блоком no-preference немає');
  assert.doesNotMatch(outside, /\btransition\s*:/, 'transition: поза блоком no-preference немає');
  assert.match(allowed, /animation:/);
  // Рухаються лише transform і opacity: жодних анімацій розмірів чи позиції.
  const frames = [...css.matchAll(/@keyframes ew-wn-[\w-]+ \{ from \{([^}]*)\} \}/g)].map((m) => m[1]);
  assert.ok(frames.length >= 4);
  for (const body of frames) assert.doesNotMatch(body, /\b(width|height|top|left|right|bottom|margin|padding|filter)\b/, body);
  const script = await read('src/whats-new.js');
  assert.match(script, /matchMedia\?\.\('\(prefers-reduced-motion: reduce\)'\)\.matches/);
  assert.match(script, /direction && motionAllowed\(\) && typeof page\.animate === 'function'/);
});

test('скло має запасний вигляд без backdrop-filter, а цілі натискання не менші за 44 пікселі', async () => {
  const css = await read('src/whats-new.css');
  assert.match(css, /@supports not \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\)/);
  assert.match(css, /-webkit-backdrop-filter: blur\(/);
  const hit = Number(/--wn-hit: (\d+)px;/.exec(css)?.[1]);
  assert.ok(hit >= 44, `сторона кнопок панелі ${hit}px`);
  assert.match(css, /\.ew-wn-round \{[^}]*width: var\(--wn-hit\);[^}]*height: var\(--wn-hit\);/);
  assert.match(css, /\.ew-wn-pill \{[^}]*height: var\(--wn-hit\);/);
  assert.match(css, /\.ew-wn-step \{[^}]*width: 52px;[^}]*height: 100%;/, 'кнопки ‹ › на всю висоту панелі');
  const coarse = Number(/--wn-hit: (\d+)px;/.exec(mediaBlock(css, 'pointer: coarse'))?.[1]);
  assert.ok(coarse > hit, 'на дотик кнопки ще більші');
  assert.match(css, /env\(safe-area-inset-top/);
  assert.match(css, /env\(safe-area-inset-bottom/);
  assert.match(css, /z-index: 1500;/, 'над довідниками (1000), під входом у профіль (2000)');
});

test('текст читабельний: обмежена ширина рядка, перенесення довгих слів, видимий фокус', async () => {
  const css = await read('src/whats-new.css');
  assert.match(css, /\.ew-wn-page \{[^}]*max-width: 4\dr?em;/);
  assert.match(css, /overflow-wrap: anywhere;/);
  assert.match(css, /\.ew-wn :is\(button\):focus-visible \{ outline: 2px solid/);
  assert.match(css, /\.ew-wn\[hidden\] \{ display: none; \}/);
});
