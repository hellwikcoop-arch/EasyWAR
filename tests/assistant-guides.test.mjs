import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir, stat } from 'node:fs/promises';
import { answerLead } from '../src/assistant/assistant-persona-core.js';
import { runDialogueTurn } from '../src/assistant/assistant-dialogue-core.js';
import { CREDITS } from '../src/guides/credits.js';

// Питання про довідники: КОМБАТ відповідає лише з docs/USER_GUIDE.md і словника PROJECT_CONTEXT.md (через зібраний індекс), без нових можливостей.
const index = JSON.parse(await readFile(new URL('../src/assistant/knowledge/index.json', import.meta.url), 'utf8'));
const guide = await readFile(new URL('../docs/USER_GUIDE.md', import.meta.url), 'utf8');
const hubSource = await readFile(new URL('../src/guides/hub.js', import.meta.url), 'utf8');
const readState = async () => ({});

const ask = query => runDialogueTurn({ query, history: [], index, readState, voiceFor: answerLead });
const sectionOf = turn => turn.result.sources.map(source => `${source.file} → ${source.section}`).join(' | ');

const CASES = [
  {
    query: 'Що таке 3D-довідники?',
    files: ['docs/PROJECT_CONTEXT.md'],
    section: /Словник/u,
    facts: [/Кнопка на стартовому екрані/u, /шістьма інтерактивними/u, /не те саме, що вкладка «Довідник»/u],
  },
  {
    query: 'Які є 3D-довідники?',
    section: /3D-довідники техніки: хаб і шість довідників/u,
    facts: [/РВіА та артилерія/u, /ППО/u, /Сухопутні війська/u, /БпАК і вертоліт/u, /Ворожа авіація/u, /Ворожа наземна техніка/u],
  },
  {
    query: 'Які довідники є в застосунку?',
    section: /Довідники/u,
    facts: [/Вкладка «Довідник»/u, /3D-довідники/u],
  },
  {
    query: 'Як відкрити 3D-довідники?',
    section: /Як відкрити 3D-довідники/u,
    facts: [/стартовому екрані/u, /Esc/u],
  },
  {
    query: 'Де кнопка 3D-довідники?',
    section: /Як відкрити 3D-довідники/u,
    facts: [/стартовому екрані/u],
  },
  {
    query: 'Що таке вкладка Довідник?',
    files: ['docs/PROJECT_CONTEXT.md'],
    section: /Словник/u,
    facts: [/Вкладка «Довідник» у модулях ПС і РВ/u, /«Артилерії»/u],
  },
  {
    query: 'Чим відрізняється вкладка Довідник від 3D-довідників?',
    section: /Довідники$/u,
    facts: [/відрізняється/u, /окремий хаб/u],
  },
  {
    query: 'Де знайти довідник для ворожої техніки?',
    section: /Довідники ворожої техніки/u,
    facts: [/«Ворожа»/u, /«Інша»/u, /Ворожа авіація/u, /Ворожа наземна техніка/u],
  },
  {
    query: 'Чи працюють 3D-довідники без інтернету?',
    section: /Інтернет і обсяг 3D-довідників/u,
    facts: [/без інтернету/u, /нічого не надсилають/u],
  },
  {
    query: 'Скільки місця займають довідники?',
    section: /Інтернет і обсяг 3D-довідників/u,
    facts: [/100 МБ/u],
  },
  {
    query: 'Хто автор 3D-моделей?',
    section: /Хто автор 3D-моделей і яка в них ліцензія/u,
    facts: [/під сценою/u, /CREDITS\.md/u],
  },
];

for (const { query, section, facts, files = ['docs/USER_GUIDE.md'] } of CASES) {
  test(`КОМБАТ про довідники: «${query}»`, async () => {
    const turn = await ask(query);
    assert.equal(turn.result.status, 'found', `${query}: ${turn.answer}`);
    assert.match(sectionOf(turn), section, `${query}: ${sectionOf(turn)}`);
    assert.ok(turn.result.sources.every(source => files.includes(source.file)), sectionOf(turn));
    for (const fact of facts) assert.match(turn.answer, fact, `${query}: у відповіді немає ${fact}`);
    // Довідники не належать до профілів: кнопка «Відкрити профілі» тут зайва.
    assert.ok(!turn.actions.some(action => action.id === 'open-profiles'), `${query}: ${turn.actions.map(action => action.id)}`);
  });
}

test('КОМБАТ не вигадує: питання про довідники без відповіді в довідці лишається без відповіді', async () => {
  const turn = await ask('Скільки коштує підписка на 3D-довідники?');
  assert.notEqual(turn.result.status, 'found');
});

test('довідка називає всі шість довідників хаба так само, як хаб', () => {
  const titles = [...hubSource.matchAll(/\{id: '[^']+', title: '([^']+)'/gu)].map(match => match[1]);
  assert.equal(titles.length, 6);
  const start = guide.indexOf('### 3D-довідники техніки: хаб і шість довідників');
  assert.ok(start > 0);
  const section = guide.slice(start, guide.indexOf('\n### ', start + 10));
  for (const title of titles) assert.ok(section.includes(`| ${title} |`), `у таблиці довідки немає «${title}»`);
});

test('кількість моделей у таблиці довідки збігається з credits.js', () => {
  const ids = [...hubSource.matchAll(/\{id: '([^']+)', title: '([^']+)'/gu)].map(match => [match[1], match[2]]);
  for (const [id, title] of ids) {
    const count = Object.keys(CREDITS).filter(key => key.startsWith(`${id}/`)).length;
    const row = guide.split('\n').find(line => line.startsWith(`| ${title} |`));
    assert.ok(row, `немає рядка «${title}»`);
    assert.equal(Number(row.split('|')[2]), count, `«${title}»: у довідці ${row.split('|')[2].trim()}, у credits.js ${count}`);
  }
});

test('дві моделі з некомерційною ліцензією названо в довідці так, як у credits.js', () => {
  const nonCommercial = Object.entries(CREDITS).filter(([, credit]) => /\bNC\b/u.test(credit.license ?? '')).map(([key]) => key);
  assert.deepEqual(nonCommercial.sort(), ['enemy-ground/pan', 'ground-forces/boxer']);
  assert.match(guide, /Дві моделі мають некомерційну ліцензію \(Boxer, Pantsir\)/u);
});

test('обсяг 3D-довідників у довідці («трохи більше 100 МБ») відповідає каталогу src/guides', async () => {
  async function total(directory) {
    let sum = 0;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
      sum += entry.isDirectory() ? await total(path) : (await stat(path)).size;
    }
    return sum;
  }
  const bytes = await total(new URL('../src/guides/', import.meta.url));
  assert.ok(bytes >= 100_000_000 && bytes <= 115_000_000, `src/guides займає ${(bytes / 1e6).toFixed(1)} МБ: оновіть довідку («Інтернет і обсяг 3D-довідників»)`);
});
