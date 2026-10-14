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
  const section = `## 3D-дові��ники (src/guides)

Шість довідників і хаб лежать у \`src/guides/\`; моделі — у \`src/guides/<довідник>/models/*.glb\`.

### РВіА та артилерія (\`src/guides/rvia/models\`)
- \`sapsan.glb\`
- \`tochka.glb\`
- \`uragan.glb\`
- \`bastion.glb\`
- \`caesar.glb\`
- \`bogdana.glb\`
- \`m10.glb\`
- \`giatsint.glb\`
- \`d30.glb\`
- \`fh70.glb\`
- \`m198.glb\`
- \`vilkha.glb\`

### ППО (\`src/guides/ppo/models\`)
- \`patriot.glb\`
- \`nasams.glb\`
- \`iris.glb\`
- \`sky.glb\`
- \`mamba.glb\`
- \`shilka.glb\`
- \`kub.glb\`
- \`nomads.glb\`

### Сухопутні війська (\`src/guides/ground-forces/models\`)
- \`abrams.glb\`
- \`bradley.glb\`
- \`marder.glb\`
- \`boxer.glb\`
- \`hmmwv.glb\`
- \`hemtt.glb\`
- \`goliath.glb\`
- \`pk_m1a1.glb\`
- \`pk_leopard1a4.glb\`
- \`pk_m60.glb\`
- \`pk_m48a2.glb\`
- \`pk_m48a3.glb\`
- \`pk_m4a3e8.glb\`
- \`pk_centurion8.glb\`
- \`pk_t3485.glb\`
- \`pk_pt76.glb\`
- \`pk_t55.glb\`
- \`pk_t62.glb\`
- \`pk_t72.glb\`
- \`pk_t80.glb\`
- \`pk_t90.glb\`
- \`pk_type99tank.glb\`
- \`pk_ee9.glb\`

### БпАК і вертоліт (\`src/guides/uav/models\`)
- \`tb2.glb\`
- \`d1l.glb\`
- \`sky.glb\`
- \`sh.glb\`

### Ворожа авіація (\`src/guides/aviation/models\`)
- \`ka52.glb\`
- \`ka50.glb\`
- \`ka27.glb\`
- \`mi26.glb\`
- \`mi35.glb\`
- \`mi8tv.glb\`
- \`mi2.glb\`
- \`an26.glb\`
- \`an225.glb\`
- \`tu22.glb\`
- \`tu95.glb\`
- \`fp5.glb\`
- \`fp7.glb\`

### Ворожа наземна техніка (\`src/guides/enemy-ground/models\`)
- \`pan.glb\`
- \`tung.glb\`
- \`buk1.glb\`
- \`buk2.glb\`
- \`s400.glb\`
- \`sa12.glb\`
- \`r96.glb\`
- \`osa.glb\`
- \`isk.glb\`
- \`btr.glb\`
- \`mtl.glb\`
- \`rp.glb\`

### Ландшафт
«${LANDSCAPE.title}» — ${LANDSCAPE.author}, ${LANDSCAPE.license} (<${LANDSCAPE.licenseUrl}>). ${LANDSCAPE.note}

### Шрифти й код
- Шрифти Oswald, PT Sans, JetBrains Mono, IBM Plex Sans і IBM Plex Mono лежать у \`src/guides/fonts/\`.
- \`src/guides/room-env.js\` — копія класу \`RoomEnvironment\` із three.js r160.
`;
  return section;
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
