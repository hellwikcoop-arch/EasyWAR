import assert from 'node:assert/strict';
import test from 'node:test';
import {
  runXlsxExport,
  runXlsxInspection,
  runXlsxReferenceExport,
  runXlsxStage,
} from '../src/xlsx-inspection.js';

function controls() {
  return [{ disabled: false }, { textContent: '' }];
}

test('desktop XLSX inspection displays only the local compatibility summary', async () => {
  const [button, status] = controls();
  const called = [];
  await runXlsxInspection(button, status, async command => {
    called.push(command);
    return { sheet_name: 'Зведена', row_count: 2, workbook_sha256: 'synthetic-hash' };
  });

  assert.deepEqual(called, ['inspect_local_xlsx']);
  assert.equal(button.disabled, false);
  assert.match(status.textContent, /Рядків даних: 2/);
  assert.match(status.textContent, /базу не змінено/);
  assert.doesNotMatch(status.textContent, /synthetic-hash/);
});

test('cancellation and errors never report an import or leave the button disabled', async () => {
  const [button, status] = controls();
  await runXlsxInspection(button, status, async () => null);
  assert.match(status.textContent, /скасовано/);
  assert.equal(button.disabled, false);

  await runXlsxInspection(button, status, async () => { throw new Error('синтетична помилка'); });
  assert.match(status.textContent, /не пройшла/);
  assert.match(status.textContent, /синтетична помилка/);
  assert.equal(button.disabled, false);
});

test('a pending inspection cannot open a second picker', async () => {
  const [button, status] = controls();
  let callCount = 0;
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const first = runXlsxInspection(button, status, async () => {
    callCount += 1;
    return pending;
  });
  await runXlsxInspection(button, status, async () => { callCount += 1; });
  assert.equal(callCount, 1);
  finish(null);
  await first;
  assert.equal(button.disabled, false);
});

test('explicit XLSX staging reports inserted and idempotent rows without approval', async () => {
  const [button, status] = controls();
  const called = [];
  await runXlsxStage(button, status, async command => {
    called.push(command);
    return { staged_rows: 2, already_present_rows: 1, duplicate_rows: 1 };
  });

  assert.deepEqual(called, ['stage_local_xlsx']);
  assert.equal(button.disabled, false);
  assert.match(status.textContent, /Додано рядків: 2/);
  assert.match(status.textContent, /вже були в базі: 1/);
  assert.match(status.textContent, /точних дублікатів: 1/);
  assert.match(status.textContent, /Дублікати збережено/);
  assert.match(status.textContent, /не схвалені/);
  assert.match(status.textContent, /XLSX не змінено/);
});

test('XLSX staging cancellation and errors do not claim an import', async () => {
  const [button, status] = controls();
  await runXlsxStage(button, status, async () => null);
  assert.match(status.textContent, /скасовано/);
  assert.match(status.textContent, /базу не змінено/);

  await runXlsxStage(button, status, async () => { throw new Error('synthetic stage failure'); });
  assert.match(status.textContent, /не виконано/);
  assert.match(status.textContent, /synthetic stage failure/);
  assert.equal(button.disabled, false);
});

test('approved XLSX export reports a new non-overwriting compatible file', async () => {
  const [button, status] = controls();
  const called = [];
  await runXlsxExport(button, status, async command => {
    called.push(command);
    return { exported_rows: 3 };
  });

  assert.deepEqual(called, ['export_approved_xlsx']);
  assert.equal(button.disabled, false);
  assert.match(status.textContent, /Схвалених записів: 3/);
  assert.match(status.textContent, /новий сумісний XLSX/);
  assert.match(status.textContent, /не перезаписуються/);
});

test('approved XLSX export cancellation and errors make no completion claim', async () => {
  const [button, status] = controls();
  await runXlsxExport(button, status, async () => null);
  assert.match(status.textContent, /скасовано/);
  assert.match(status.textContent, /Файли не змінено/);

  await runXlsxExport(button, status, async () => { throw new Error('synthetic export failure'); });
  assert.match(status.textContent, /не виконано/);
  assert.match(status.textContent, /synthetic export failure/);
});

test('reference XLSX export reports preserved reference and a new file', async () => {
  const [button, status] = controls();
  const called = [];
  await runXlsxReferenceExport(button, status, async command => {
    called.push(command);
    return { exported_rows: 2 };
  });

  assert.deepEqual(called, ['export_approved_xlsx_from_reference']);
  assert.equal(button.disabled, false);
  assert.match(status.textContent, /Схвалених записів: 2/);
  assert.match(status.textContent, /еталонний/);
  assert.match(status.textContent, /не перезаписуються/);
});

test('reference XLSX export cancellation and errors preserve the source claim', async () => {
  const [button, status] = controls();
  await runXlsxReferenceExport(button, status, async () => null);
  assert.match(status.textContent, /скасовано/);
  assert.match(status.textContent, /Еталонний XLSX і локальні дані не змінено/);

  await runXlsxReferenceExport(button, status, async () => {
    throw new Error('synthetic reference failure');
  });
  assert.match(status.textContent, /не виконано/);
  assert.match(status.textContent, /synthetic reference failure/);
});
