import assert from 'node:assert/strict';
import test from 'node:test';
import { reviewContext } from '../src/assistant/assistant-context-core.js';
import { readVisibleAssistantContext } from '../src/assistant/assistant-context.js';

const sheets = [{ name: 'Зведена', rows: [
  { r: 1, cells: { B: 'Дата', J: 'Тип ЛА', L: 'К-сть боєприпасів', M: 'Результат ураження' } },
  { r: 2, cells: { B: '2026-08-01', J: 'Засіб А', L: '2', M: 'УРАЖЕНО' } },
] }];

test('only an explicit known branch with opened values can produce review input', () => {
  assert.equal(reviewContext().input, null);
  assert.equal(reviewContext({ branch: 'artillery', sheets }).input, null);
  assert.equal(reviewContext({ branch: 'air', sheets }).input, null);
  const before = structuredClone(sheets);
  const context = reviewContext({ branch: 'air', workbook: { kind: 'standard' }, sheets });
  assert.equal(context.label, 'ПС');
  assert.equal(context.input.groups[0].strikes.records.length, 1);
  assert.deepEqual(sheets, before);
  assert.equal(reviewContext({ branch: 'rocket', workbook: { kind: 'standard' }, sheets }).label, 'РВ');
});

test('existing parsed UDSHV and visible own-losses take the appropriate validation path', () => {
  const workbook = { kind: 'udshv', records: [], issues: [] }, ownLosses = { records: [], issues: [] };
  assert.deepEqual(reviewContext({ branch: 'dshv', workbook }).input, { udshv: workbook });
  assert.deepEqual(reviewContext({ branch: 'dshv', workbook, ownLosses, ownLossesVisible: true }).input, { ownLosses });
  assert.equal(reviewContext({ branch: 'pvk', workbook: { kind: 'pvk' } }).input, null);
  assert.equal(reviewContext({ branch: 'dshv', ownLossesVisible: true }).input, null);
});

function harness({ branch = 'air', sqlite = false, own = false, reader = async () => sheets } = {}) {
  const root = { body: { dataset: { activeBranch: branch } } };
  let ownLosses = { records: [], issues: [] }, reading = 0;
  const frame = {
    document: {
      documentElement: { classList: { contains: () => false } },
      querySelector: selector => selector === '#dashboardSourceToggle' ? { getAttribute: () => String(sqlite) }
        : selector === '.ol-root' && own ? { getClientRects: () => [1] } : null,
    },
    __AV: { S: { wb: { kind: 'standard' }, bytes: new Uint8Array([1, 2]) } },
    AVCORE: { readAllSheets: async bytes => { reading++; assert.ok(bytes instanceof Uint8Array); return reader(); } },
    EWOwnLosses: { snapshot: () => ownLosses },
  };
  root.getElementById = () => ({ contentWindow: frame });
  return { root, frame, reads: () => reading, changeOwn: () => { ownLosses = { records: [], issues: [] }; } };
}

async function use(h, action) {
  const old = globalThis.document; globalThis.document = h.root;
  try { return await action(); } finally { if (old === undefined) delete globalThis.document; else globalThis.document = old; }
}

test('visible SQLite analytics never falls back to stale XLSX bytes', async () => {
  const h = harness({ sqlite: true });
  await use(h, async () => {
    const context = await readVisibleAssistantContext();
    assert.equal(context.input, null); assert.match(context.message, /SQLite/); assert.equal(h.reads(), 0);
  });
});

test('own-losses reads only the already-open visible snapshot, even with a hidden SQLite toggle', async () => {
  const h = harness({ branch: 'dshv', own: true, sqlite: true });
  await use(h, async () => {
    const context = await readVisibleAssistantContext();
    assert.ok(context.input.ownLosses); assert.equal(h.reads(), 0); assert.equal(context.isCurrent(), true);
    h.changeOwn(); assert.equal(context.isCurrent(), false);
  });
});

test('navigation or table replacement invalidates a captured asynchronous context', async () => {
  const h = harness();
  await use(h, async () => {
    const context = await readVisibleAssistantContext();
    assert.ok(context.input.groups); assert.equal(context.isCurrent(), true);
    delete h.root.body.dataset.activeBranch; assert.equal(context.isCurrent(), false);
    h.root.body.dataset.activeBranch = 'air'; h.frame.__AV.S.bytes = new Uint8Array([3]);
    assert.equal(context.isCurrent(), false);
  });
});

test('returning home during parsing discards the result and never opens a module', async () => {
  const h = harness({ reader: async () => { delete h.root.body.dataset.activeBranch; return sheets; } });
  await use(h, async () => {
    const context = await readVisibleAssistantContext();
    assert.equal(context.input, null); assert.match(context.message, /контекст змінився/); assert.equal(h.reads(), 1);
  });
});
