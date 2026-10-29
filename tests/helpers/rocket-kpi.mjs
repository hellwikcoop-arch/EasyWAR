// Запускає справжній код карток основних показників РВ із src/rocket.html на синтетичних рядках.
// Нічого не копіюється: беруться тексти оголошень з файлу й відрізок renderAll між «const K = …»
// та «// карта», а числа рахує справжнє спільне ядро (як window.RVKpiCore, що його ставить src/rv-kpi.js).
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as core from '../../src/module-adapters/rv-kpi-core.js';

const SOURCE = new URL('../../src/rocket.html', import.meta.url);

// Відповідний кінець блока {…} з урахуванням рядкових літералів і коментарів.
function matchBrace(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
    } else if (c === '/' && src[i + 1] === '/') {
      i = src.indexOf('\n', i);
      if (i < 0) break;
    } else if (c === '/' && src[i + 1] === '*') {
      i = src.indexOf('*/', i) + 1;
    } else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  throw new Error('rocket.html: не знайдено кінець блока');
}

function functionSource(src, name) {
  const start = src.indexOf(`\nfunction ${name}(`);
  if (start < 0) throw new Error(`rocket.html: немає function ${name}`);
  return src.slice(start + 1, matchBrace(src, src.indexOf('{', start)) + 1);
}

function constSource(src, name) {
  const match = new RegExp(`^const ${name} = .*;$`, 'm').exec(src);
  if (!match) throw new Error(`rocket.html: немає const ${name}`);
  return match[0];
}

/** Повертає run(rows, state): картки (аргументи kpiCard) і текст «ефективності» за рядками й станом D. */
export async function loadRocketKpi() {
  const src = await readFile(SOURCE, 'utf8');
  const from = src.indexOf('  const K = window.RVKpiCore.computeRvKpis(');
  const to = src.indexOf('  // карта\n', from);
  if (from < 0 || to < 0) throw new Error('rocket.html: не знайдено відрізок карток у renderAll');
  const body = src.slice(from, to);
  const parts = [
    ...['dayNum', 'isoOf', 'N0', 'N1', 'eff', 'inRange', 'sorted', 'MON3'].map(name => constSource(src, name)),
    ...['inc', 'rocketOutcome', 'agg', 'kpiSeries', 'axisLabels', 'mkDelta'].map(name => functionSource(src, name)),
  ];
  const code = `(function (ROWS, D, DMIN, kpiCard) {
    const el = { kpiGrid: { textContent: '', cards: [], append(...c) { this.cards.push(...c); } }, kpiEff: { textContent: '' } };
    ${parts.join('\n')}
    ${body}
    return { cards: el.kpiGrid.cards, eff: el.kpiEff.textContent };
  })`;
  const factory = vm.runInNewContext(code, { Math, Date, Map, Set, Number, String, isFinite, Array, Object, window: { RVKpiCore: Object.freeze({ ...core }) } }, { filename: 'rocket-kpi.js', timeout: 5000 });
  // JSON-копія: об'єкти з vm мають інші прототипи, і assert.deepEqual вважав би їх різними.
  return (rows, state, dmin) => JSON.parse(JSON.stringify(factory(rows, state, dmin, card => card)));
}
