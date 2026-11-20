// Optional browser gate: run the phone Vite server on :4174 first. Synthetic data only.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { addPerson, addFlight } from '../src/workspace/easyfly/fly-state.js';
import { createEmpty, parse, serialize } from '../src/workspace/easyfly/fly-store.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
const page = await context.newPage();
// Exercise the download fallback; native Share sheets need a real phone.
await page.addInitScript(() => Object.defineProperty(navigator, 'canShare', { value: () => false, configurable: true }));
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const phrase = 'синтетична фраза 2026';
const pilot = addPerson(createEmpty(), { callsign: 'Тест-01', role: 'КЕ' });
const logged = addFlight(pilot.data, { personId: pilot.id, date: '2026-10-31', exercise: 'БП', airtime: '1:25', count: 2, source: 'import' });
logged.data.flights[0].provenance = { row: 2, file: 'synthetic.csv' };
logged.data.flights[0].meteo = { cloudBase: 800 };
const source = serialize(logged.data);
const base = process.env.EASYFLY_URL || 'http://localhost:4174';

async function autoLock() {
  await page.evaluate(() => {
    const now = Date.now();
    Date.now = () => now;
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    Date.now = () => now + 301_000;
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

async function openLogbook() {
  await page.locator('.ef-bottom-nav').getByRole('button', { name: 'Профіль', exact: true }).click();
  await page.getByRole('tab', { name: 'Льотна книжка', exact: true }).click();
  await page.locator('#ef-tabpanel[aria-labelledby="ef-tab-logbook"]').waitFor();
}

try {
  await page.goto(base);
  await page.locator('[name=passphrase]').fill(phrase);
  await page.locator('[name=passphrase-repeat]').fill(phrase);
  await page.getByRole('button', { name: 'Створити сховище', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Імпорт із файлу', exact: true }).click();
  await (await chooser).setFiles({ name: 'synthetic.easyfly', mimeType: 'application/json', buffer: Buffer.from(source) });
  await openLogbook();
  await page.getByRole('button', { name: 'Змінити', exact: true }).last().click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Тривалість', { exact: true }).fill('0:45');
  await dialog.getByRole('button', { name: 'Скасувати', exact: true }).click();
  await page.getByRole('button', { name: 'Змінити', exact: true }).last().click();
  dialog = page.getByRole('dialog');
  assert.equal(await dialog.getByLabel('Тривалість', { exact: true }).inputValue(), '1:25');
  await dialog.getByLabel('Дата *', { exact: true }).first().fill('2026-11-01');
  await dialog.getByLabel('Вправа', { exact: true }).fill('СБП');
  await dialog.getByLabel('Тривалість', { exact: true }).fill('0:35');
  await dialog.getByRole('button', { name: 'Зберегти зміни', exact: true }).click();
  await autoLock(); // No wait for the 400ms debounce: save and lock must cooperate.
  await page.locator('[name=passphrase]').waitFor();
  await page.locator('[name=passphrase]').fill(phrase);
  await page.getByRole('button', { name: 'Відкрити', exact: true }).click();
  await openLogbook();
  assert.match(await page.locator('#ef-tabpanel').innerText(), /0:35/);
  assert.match(await page.locator('#ef-tabpanel').innerText(), /СБП/);

  // The browser export remains explicit, readable JSON; its import provenance survives.
  await page.locator('.ef-bar-more').click();
  const download = page.waitForEvent('download');
  await page.locator('.ef-bar-menu').getByRole('menuitem', { name: 'Копія у файл…', exact: true }).click();
  const exported = parse(await readFile(await (await download).path()));
  assert.equal(exported.ok, true);
  assert.equal(exported.data.flights.length, 1);
  const flight = exported.data.flights[0];
  assert.equal(flight.id, logged.id);
  assert.equal(flight.source, 'import');
  assert.equal(flight.date, '2026-11-01');
  assert.equal(flight.airtimeMin, 35);
  assert.deepEqual(flight.provenance, { row: 2, file: 'synthetic.csv' });
  assert.deepEqual(flight.meteo, { cloudBase: 800 });
  assert.equal(serialize(logged.data), source, 'the imported source was not rewritten');

  // A failed redundant write must not prevent locking a clean, already-saved document.
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (stores, mode, ...args) {
      if (mode === 'readwrite') throw new Error('synthetic quota');
      return original.call(this, stores, mode, ...args);
    };
  });
  await autoLock();
  await page.locator('[name=passphrase]').waitFor();
  await page.reload();
  await page.locator('[name=passphrase]').fill(phrase);
  await page.getByRole('button', { name: 'Відкрити', exact: true }).click();
  await openLogbook();
  assert.match(await page.locator('#ef-tabpanel').innerText(), /0:35/);
  // A dirty failed write keeps the document available, and the next lock retries it.
  await page.getByRole('button', { name: 'Змінити', exact: true }).last().click();
  await page.getByRole('dialog').getByLabel('Характер польоту', { exact: true }).fill('Синтетична правка після збою');
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    window.restoreSyntheticStorage = () => { IDBDatabase.prototype.transaction = original; };
    IDBDatabase.prototype.transaction = function (stores, mode, ...args) {
      if (mode === 'readwrite') throw new Error('synthetic quota');
      return original.call(this, stores, mode, ...args);
    };
  });
  await page.getByRole('dialog').getByRole('button', { name: 'Зберегти зміни', exact: true }).click();
  await autoLock();
  await page.getByText(/Не вдалося зберегти дані в профілі:/).waitFor();
  assert.equal(await page.locator('[name=passphrase]').count(), 0);
  assert.equal(await page.locator('#easyfly-phone').evaluate(node => node.inert), false);
  await page.evaluate(() => window.restoreSyntheticStorage());
  await autoLock();
  await page.locator('[name=passphrase]').waitFor();
  await page.locator('[name=passphrase]').fill(phrase);
  await page.getByRole('button', { name: 'Відкрити', exact: true }).click();
  await openLogbook();
  assert.match(await page.locator('#ef-tabpanel').innerText(), /Синтетична правка після збою/);
  const shots = process.env.EASYFLY_SHOTS || '/tmp/easywar-shots';
  await mkdir(shots, { recursive: true });
  await page.screenshot({ path: `${shots}/easyfly-integrated-logbook.png`, fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS: phone import, edit/cancel, immediate autolock, encrypted reopen, export, clean/dirty storage failures, retry, reload');
} finally {
  await browser.close();
}
