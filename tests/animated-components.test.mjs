import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { WORK_LOADER, formatElapsed, hideDelay, loaderText } from '../src/work-loader-core.js';

const read = name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8');

// Вирізає блоки @media (prefers-reduced-motion: no-preference) { … } з урахуванням вкладених дужок.
function outsideNoPreference(css) {
  let result = '';
  let index = 0;
  const marker = '@media (prefers-reduced-motion: no-preference)';
  for (;;) {
    const start = css.indexOf(marker, index);
    if (start === -1) return result + css.slice(index);
    result += css.slice(index, start);
    let depth = 0;
    let cursor = css.indexOf('{', start);
    for (; cursor < css.length; cursor += 1) {
      if (css[cursor] === '{') depth += 1;
      else if (css[cursor] === '}' && --depth === 0) break;
    }
    index = cursor + 1;
  }
}
const withoutKeyframes = css => css.replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');

test('індикатор відкриття: підпис з назвою таблиці й файла, без шляху', () => {
  assert.deepEqual(loaderText({ table: 'Таблиця ПВК', fileName: '/Users/x/Документи/pvk.xlsx' }), {
    title: 'Відкриваємо таблицю',
    detail: 'Таблиця ПВК · pvk.xlsx',
  });
  assert.equal(loaderText({ fileName: 'C:\\tables\\air.xlsx' }).detail, 'air.xlsx');
  assert.equal(loaderText({}).detail, 'Читаємо файл на цьому пристрої');
  assert.equal(loaderText({ table: '  Таблиця \n ПС ' }).detail, 'Таблиця ПС');
});

test('індикатор відкриття: лічильник часу й мінімальний час показу', () => {
  assert.equal(formatElapsed(0), '0,0 с');
  assert.equal(formatElapsed(449), '0,4 с');
  assert.equal(formatElapsed(9999), '9,9 с');
  assert.equal(formatElapsed(12_345), '12 с');
  assert.equal(formatElapsed(-5), '0,0 с');
  assert.equal(formatElapsed(Number.NaN), '0,0 с');
  assert.equal(hideDelay(null, 1000), 0, 'ще не показано — ховати нема чого');
  assert.equal(hideDelay(1000, 1100), WORK_LOADER.minVisibleMs - 100);
  assert.equal(hideDelay(1000, 1000 + WORK_LOADER.minVisibleMs + 1), 0);
  assert.ok(WORK_LOADER.delayMs > 0 && WORK_LOADER.delayMs < WORK_LOADER.minVisibleMs + 1000);
});

test('індикатор відкриття: підключено навколо читання таблиці профілю, завершується у finally', async () => {
  const js = await read('local-profiles.js');
  assert.match(js, /import \{ startWorkLoader \} from '\.\/work-loader\.js';/);
  const body = js.slice(js.indexOf('async function openProfileDatabase'), js.indexOf('function applyPendingDashboardSection'));
  const start = body.indexOf('startWorkLoader(');
  assert.ok(start !== -1 && start < body.indexOf('readProfileDatabase('), 'показ починається до читання файла');
  assert.match(body, /finally \{\s*loaderDone\(\);/);
  const loader = await read('work-loader.js');
  assert.match(loader, /import '\.\/work-loader\.css';/);
  assert.match(loader, /setAttribute\('role', 'status'\)/);
  assert.doesNotMatch(loader, /innerHTML/, 'назва файла потрапляє лише як текст');
  const css = await read('work-loader.css');
  assert.match(css, /pointer-events: none/, 'індикатор не перехоплює кліки');
  assert.doesNotMatch(withoutKeyframes(outsideNoPreference(css)), /animation\s*:/, 'рух лише при prefers-reduced-motion: no-preference');
});

test('головна кнопка: контур обертається лише з дозволеним рухом і вмикається з клавіатури', async () => {
  const css = await read('ui-kit.css');
  assert.match(css, /\.btn\.primary::after \{/);
  assert.match(css, /\.btn\.primary:is\(:hover, :focus-visible\):not\(:disabled\)::after \{ opacity: 1; \}/);
  const spin = css.match(/[^\n]*animation: ew-spin[^\n]*/g) || [];
  assert.equal(spin.length, 1);
  assert.match(spin[0], /html:not\(\[data-motion="off"\]\)/);
  assert.doesNotMatch(withoutKeyframes(outsideNoPreference(css)), /animation: ew-spin/);
});

test('стрілочний прилад ПВК: стиль, адаптація й поява стрілки в межах бюджету руху', async () => {
  const css = await read('pvk-dashboard.css');
  assert.doesNotMatch(css, /pvk-kpi-ring/);
  assert.match(css, /\.pvk-kpi-gauge \.needle \{[^}]*rotate\(calc\(var\(--p, 0\) \* 1\.8deg - 90deg\)\)/);
  assert.match(css, /@container pvk-kpi \(max-width: 219px\) \{ \.pvk-kpi-spark, \.pvk-kpi-gauge \{ display: none; \} \}/);
  const motion = await read('dashboard-motion.css');
  assert.match(motion, /\[data-dash-motion\] \.pvk-kpi-gauge \.needle \{ animation: dm-needle/);
  assert.match(motion, /\[data-dash-motion\] \.pvk-kpi-gauge \.val \{ animation: dm-gauge/);
});
