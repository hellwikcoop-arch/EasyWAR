import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// The empty base tables shipped with the app must open in the module that
// takes them, with that module's own .xlsx code, and accept a new record.

const baseTable = async name => new Uint8Array(
  await readFile(new URL(`../src-tauri/resources/base-tables/${name}`, import.meta.url)),
);

async function moduleCore(file) {
  const html = await readFile(new URL(`../src/${file}`, import.meta.url), 'utf8');
  const marker = html.indexOf('CORE — робота з .xlsx');
  assert.notEqual(marker, -1, `${file}: CORE script must exist`);
  const start = html.lastIndexOf('<script>', marker);
  const end = html.indexOf('</script>', marker);
  const module = { exports: {} };
  vm.runInNewContext(html.slice(start + '<script>'.length, end), {
    module, TextEncoder, TextDecoder, DecompressionStream, CompressionStream, Blob, Response, Uint8Array, ArrayBuffer,
  }, { filename: `${file}-core.js`, timeout: 5000 });
  return module.exports;
}

function syntheticRow(core, values) {
  return { ...Object.fromEntries(core.FIELD_ORDER.map(field => [field, ''])), ...values };
}

test('the Air Force base table opens in the Air Force module and takes a record', async () => {
  const core = await moduleCore('air.html');
  const bytes = await baseTable('air-base.xlsx');
  const workbook = await core.openWorkbook(bytes);
  assert.equal(workbook.records.length, 0);
  assert.deepEqual(Object.keys(workbook.colByField).sort(), [...core.FIELD_ORDER].sort());
  assert.ok(workbook.typeDict.some(entry => entry.name === 'КСП'));
  assert.ok(workbook.causeDict.length >= 10);

  const appended = await core.appendRows(bytes, [syntheticRow(core, {
    date: '2026-01-01', time: '10:00', targets: 'TS-1001', unit: 'Синтетичний підрозділ',
    type: 'КСП', aircraft: 'Навчальний ЛА', munition: 'Навчальний БП', count: '1', result: 'УРАЖЕНО',
  })]);
  const reopened = await core.openWorkbook(appended.bytes);
  assert.equal(reopened.records.length, 1);
  assert.equal(reopened.records[0].targets, 'TS-1001');
});

test('the РВіА base table opens in the rocket module and takes a record', async () => {
  const core = await moduleCore('rocket.html');
  const bytes = await baseTable('rvia-base.xlsx');
  const workbook = await core.openWorkbook(bytes);
  assert.equal(workbook.records.length, 0);
  assert.deepEqual(Object.keys(workbook.colByField).sort(), [...core.FIELD_ORDER].sort());
  assert.ok(workbook.typeDict.length > 0);

  const appended = await core.appendRows(bytes, [syntheticRow(core, {
    date: '2026-01-01', time: '10:00', targets: 'SYN-1', unit: 'Синтетичний підрозділ',
    type: 'Навчальна ціль', aircraft: 'М142', munition: 'Навчальний БП', count: '1', result: 'НЕВІДОМО',
  })]);
  const reopened = await core.openWorkbook(appended.bytes);
  assert.equal(reopened.records.length, 1);
  assert.equal(reopened.records[0].targets, 'SYN-1');
});

test('each base table is refused by the module it is not meant for', async () => {
  const air = await moduleCore('air.html');
  // The ПВК table has its own sheets; the Air Force dashboard for it is in development.
  await assert.rejects(air.openWorkbook(await baseTable('pvk-base.xlsx')), /аркуша «Зведена»/);
  await assert.rejects(air.openWorkbook(await baseTable('rvia-base.xlsx')), /не знайдено стовпців/);
});
