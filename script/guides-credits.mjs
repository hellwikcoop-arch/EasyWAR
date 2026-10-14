#!/usr/bin/env node
// Розділ «3D-довідники» у src/models/CREDITS.md генерується з src/guides/credits.js, щоб сторінки довідників
// і документ авторства не розходилися. Запуск:
//   node script/guides-credits.mjs          — переписує розділ між маркерами (або дописує в кінець файлу);
//   node script/guides-credits.mjs --check  — лише перевіряє, що розділ актуальний (код виходу 1, якщо ні).
// tests/guides.test.mjs робить ту саму перевірку.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CREDITS, KINDS, LANDSCAPE } from '../src/guides/credits.js';

export const START = '<!-- guides-credits:start -->';
export const END = '<!-- guides-credits:end -->';

// Довідники в порядку показу на хабі.
export const GUIDES = [
  ['rvia', 'РВіА та артилерія'],
  ['ppo', 'ППО'],
  ['ground-forces', 'Сухопутні війська'],
  ['uav', 'БпАК і вертоліт'],
  ['aviation', 'Ворожа авіація'],
  ['enemy-ground', 'Ворожа наземна техніка'],
];

const cell = (text) => String(text ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

function origin(c) {
  switch (c.kind) {
    case 'cc':
      return `${c.author}; ${c.license}${c.source ? `; <${c.source}>` : ''}`;
    case 'author':
      return `${c.author}; ліцензію у файлі не зазначено${c.source ? `; <${c.source}>` : ''}`;
    case 'own':
      return 'власна робота автора проєкту (за його запевненням)';
    case 'game':
      return `ресурс гри ${c.game}; права не з’ясовані`;
    case 'unclear':
      return 'походження не з’ясовано, можливо, ресурс гри; права не з’ясовані';
    case 'generated':
      return 'процедурна модель EasyWAR';
    default:
      throw new Error(`Невідомий вид авторства: ${c.kind}`);
  }
}

export function renderSection(credits = CREDITS) {
  const out = [];
  out.push('## 3D-довідники (src/guides)', '');
  out.push('Шість довідників і хаб лежать у `src/guides/`; моделі — у `src/guides/<довідник>/models/*.glb`. Таблиці нижче генерує `node script/guides-credits.mjs` з `src/guides/credits.js`; ті самі записи показано під сценою кожного довідника.', '');
  out.push('Автора, ліцензію й посилання взято з даних, що супроводжували моделі: метаданих файлів і підписів в опублікованих довідниках. Під час перенесення сторінки Sketchfab не відкривали, тож перед публічним поширенням їх варто звірити.', '');
  out.push('Види походження:', '');
  for (const [kind, label] of Object.entries(KINDS)) out.push(`- \`${kind}\` — ${label}`);
  out.push('');
  out.push('Щоб визнати модель власною, достатньо змінити її `kind` на `own` у `src/guides/credits.js` і перегенерувати цей розділ.', '');
  for (const [guide, title] of GUIDES) {
    const rows = Object.entries(credits).filter(([key]) => key.startsWith(`${guide}/`));
    out.push(`### ${title} (\`src/guides/${guide}/models\`)`, '');
    out.push('| Файл | Модель | Походження | Примітка |', '| --- | --- | --- | --- |');
    for (const [key, c] of rows) {
      const file = `${key.slice(guide.length + 1)}.glb`;
      out.push(`| \`${file}\` | ${cell(c.name)} | ${cell(origin(c))} | ${cell(c.note)} |`);
    }
    out.push('');
  }
  out.push('### Ландшафт', '');
  out.push(`«${LANDSCAPE.title}» — ${LANDSCAPE.author}, ${LANDSCAPE.license} (<${LANDSCAPE.licenseUrl}>). ${LANDSCAPE.note} Файли: \`src/guides/shared/landscape-flight.glb\` (польотні довідники: авіація, БпАК), \`src/guides/shared/landscape-ground.glb\` (наземні довідники).`, '');
  out.push('### Шрифти й код', '');
  out.push('- Шрифти Oswald, PT Sans, JetBrains Mono, IBM Plex Sans і IBM Plex Mono лежать у `src/guides/fonts/` (з пакетів @fontsource), ліцензія SIL OFL 1.1, тексти ліцензій — у `src/guides/fonts/licenses/`.');
  out.push('- `src/guides/room-env.js` — копія класу `RoomEnvironment` із three.js r160 (MIT, © three.js authors): у новішому three цей клас дає інше освітлення, а довідники налаштовано під старе.');
  out.push('');
  return out.join('\n');
}

export function withSection(text, section = renderSection()) {
  const block = `${START}\n${section.trimEnd()}\n${END}`;
  const a = text.indexOf(START);
  const b = text.indexOf(END);
  if (a === -1 && b === -1) return `${text.trimEnd()}\n\n${block}\n`;
  if (a === -1 || b === -1 || b < a) throw new Error('Маркери розділу «3D-довідники» у CREDITS.md пошкоджено');
  return `${text.slice(0, a)}${block}${text.slice(b + END.length)}`;
}

const target = new URL('../src/models/CREDITS.md', import.meta.url);

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const current = readFileSync(target, 'utf8');
  const next = withSection(current);
  if (process.argv.includes('--check')) {
    if (next !== current) {
      console.error('Розділ «3D-довідники» у src/models/CREDITS.md застарів: node script/guides-credits.mjs');
      process.exit(1);
    }
    console.log('Розділ «3D-довідники» у CREDITS.md актуальний.');
  } else {
    writeFileSync(target, next);
    console.log(next === current ? 'CREDITS.md без змін.' : 'CREDITS.md оновлено.');
  }
}
