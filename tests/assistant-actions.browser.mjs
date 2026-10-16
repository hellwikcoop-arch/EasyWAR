// Optional browser gate for КОМБАТ-дії: відкриття модулів/вкладки внесення та чернетка доповіді з підтвердженням (ПС і РВ).
// Start Vite first (npm run dev -- --port N), then: EASYWAR_URL=http://localhost:N CHROMIUM_PATH=... node tests/assistant-actions.browser.mjs
// Дані лише синтетичні (.claude/skills/run-easywar/fixtures.py); справжні таблиці не використовуються.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' });
const page = await context.newPage();
// Модуль РВ під час завантаження малює 3D-карту програмно (без GPU): головний потік сторінки може бути зайнятий 20-30 с,
// і будь-яка дія тесту в цей час чекає. Це властивість модуля в headless-середовищі, а не помилка чернетки.
page.setDefaultTimeout(120_000);
const errors = [], remote = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (/^https?:/.test(request.url()) && !/^http:\/\/(127\.0\.0\.1|localhost):/u.test(request.url())) remote.push(request.url()); });
await page.addInitScript(() => {
  window.testSession = null;
  window.testCommands = [];
  const profiles = { activeProfileId: 'synthetic-a', profiles: [{ id: 'synthetic-a', displayName: 'Синтетичний профіль', position: '', hasPassword: true, modules: ['air', 'rocket'], tables: {} }] };
  window.__TAURI_INTERNALS__ = { transformCallback: () => 1, invoke: async command => {
    window.testCommands.push(command);
    switch (command) {
      case 'get_local_profiles': return structuredClone(profiles);
      case 'get_workspace_templates': return { defaultTemplateKey: null, templates: [], assignments: [] };
      case 'get_profile_session': return window.testSession;
      case 'lock_local_profile': window.testSession = null; return null;
      case 'activate_local_profile': window.testSession = 'synthetic-a'; return structuredClone(profiles);
      case 'get_app_update_settings': return { enabled: false };
      case 'get_restore_startup_report': return { outcome: 'none', pendingRestoreAvailable: false, previousBackupRetained: false };
      case 'get_local_model_status': return { configured: false, enabled: false, ready: false, name: null, sizeMb: null, loaded: false, busy: false, message: null };
      case 'get_local_model_install_info': throw 'no install info in this gate';
      case 'get_database_status': return { appVersion: '9.8.7' };
      case 'get_signal_settings': return { enabled: false, allowedSources: [] };
      default: return {};
    }
  } };
});

const fixtureDir = await mkdtemp(join(tmpdir(), 'easywar-actions-'));
try {
  execFileSync('python3', ['.claude/skills/run-easywar/fixtures.py', fixtureDir], { stdio: 'ignore' });
  const airBytes = [...await readFile(join(fixtureDir, 'air.xlsx'))];
  const rocketBytes = [...await readFile(join(fixtureDir, 'rocket.xlsx'))];
  await page.goto(process.env.EASYWAR_URL || 'http://127.0.0.1:1420/');
  await page.locator('.ew-gate input[type="password"]').fill('synthetic-password');
  await page.locator('.ew-gate button[type="submit"]').click();
  await page.waitForFunction(() => !document.documentElement.classList.contains('ew-locked'));
  const launcher = page.locator('.ew-assistant-launcher'), panel = page.locator('.ew-assistant-panel');
  await page.waitForFunction(() => !document.querySelector('.ew-assistant-launcher').hidden);
  const input = panel.locator('.ew-assistant-input input');
  const ask = async text => { await input.fill(text); await input.press('Enter'); };
  const lastTurn = () => panel.locator('.ew-assistant-message:not(.ew-assistant-question)').last();
  const activeBranch = () => page.evaluate(() => document.body.dataset.activeBranch ?? '');

  // 1. Запит у чаті дає лише кнопку; сам екран не відкривається, поки її не натиснуто.
  await launcher.click();
  await ask('Де внести доповідь?');
  await panel.locator('.ew-assistant-turn-action[data-action="open-entry-air"]').waitFor();
  assert.deepEqual(await lastTurn().locator('.ew-assistant-turn-action').evaluateAll(nodes => nodes.map(node => node.dataset.action)), ['open-entry-air', 'open-entry-rocket']);
  assert.equal(await activeBranch(), '', 'a question alone opens nothing');

  // 2. Модуль, вимкнений у профілі (у профілі лише ПС і РВ), не відкривається; пояснення показано.
  await panel.locator('[data-mode="navigate"]').click();
  await panel.locator('[data-area="pvk"]').click();
  assert.match(await panel.locator('.ew-assistant-warning[role="status"]').first().textContent(), /вимкнено у вашому профілі/u);
  assert.equal(await activeBranch(), '', 'a module switched off in the profile is not opened');

  // 3-9. Однакові перевірки для кожного модуля з полем внесення доповіді: ПС і РВ.
  // Модуль РВ малює важку 3D-карту: у headless-режимі сторінка інколи на десятки секунд перестає відповідати перевірці
  // «елемент придатний до кліку». Кнопку натискаємо в самій сторінці: це той самий обробник, без очікування.
  const clickLauncher = () => page.evaluate(() => document.querySelector('.ew-assistant-launcher').click());
  const openPanel = async () => {
    if (await page.evaluate(() => document.querySelector('.ew-assistant-panel').hidden)) await clickLauncher();
    await panel.locator('[data-mode="navigate"]').click();
  };
  const goHome = async () => {
    if (await activeBranch()) await page.evaluate(() => document.querySelector('#branch-home').click());
    await page.waitForFunction(() => !document.body.dataset.activeBranch);
  };
  const modules = [
    { branch: 'air', label: 'ПС', file: 'air.xlsx', url: /\/air\.html/u, bytes: airBytes },
    { branch: 'rocket', label: 'РВ', file: 'rocket.xlsx', url: /\/rocket\.html/u, bytes: rocketBytes },
  ];
  for (const { branch, label, url, bytes } of modules) {
    const text = `Синтетична доповідь для перевірки ${label}\nрядок 2`;
    await goHome();
    await openPanel();

    // 3. Модуль відкривається кнопкою; таблиці немає, тож поле внесення недоступне.
    await panel.locator(`[data-area="${branch}"]`).click();
    await page.waitForFunction(name => document.body.dataset.activeBranch === name, branch);
    const frame = await (async () => {
      for (let attempt = 0; attempt < 150; attempt++) {
        const found = page.frames().find(item => url.test(item.url()));
        if (found && await found.evaluate(() => Boolean(window.__AV?.connect)).catch(() => false)) return found;
        await page.waitForTimeout(100);
      }
      throw new Error(`Модуль ${label} не завантажився`);
    })();
    await openPanel();
    await panel.locator('[data-draft="branch"]').selectOption(branch);
    await panel.locator('[data-draft="text"]').fill(text);
    await panel.locator('[data-draft="preview"]').click();
    assert.match(await panel.locator('[data-draft="blocked"]').textContent(), /спершу відкрийте таблицю/u, label);
    assert.equal(await frame.evaluate(() => document.querySelector('#paste').value), '', `${label}: a blocked draft writes nothing`);

    // 4. Відкрито синтетичну таблицю: чернетка показує, що буде внесено, і чекає підтвердження.
    await frame.evaluate(([data, name]) => window.__AV.connect(new Uint8Array(data), name, null, true), [bytes, `synthetic-${branch}.xlsx`]);
    await frame.waitForFunction(() => window.__DASH?.rows?.length > 0 && !document.querySelector('#paste').disabled);
    const rowsBefore = await frame.evaluate(() => window.__AV.S.wb.records.length);
    await goHome();
    await openPanel();
    await panel.locator('[data-draft="branch"]').selectOption(branch);
    await panel.locator('[data-draft="text"]').fill(text);
    await panel.locator('[data-draft="preview"]').click();
    const confirm = panel.locator('.ew-assistant-draft-confirm');
    await confirm.waitFor();
    assert.match(await confirm.innerText(), new RegExp(`${label}.*«Внесення доповідей».*«Повідомлення»`, 'su'), label);
    assert.match(await confirm.innerText(), /У таблицю нічого не додається/u);
    assert.equal(await confirm.locator('.ew-assistant-draft-text').textContent(), text, `${label}: the confirmation shows the exact text`);
    assert.equal(await frame.evaluate(() => document.querySelector('#paste').value), '', `${label}: nothing is written before confirmation`);
    // Кнопки чернетки читабельні: контраст тексту до фактичного тла не менше 4.5:1 (на світлій панелі не білий текст).
    const contrasts = await panel.locator('.ew-assistant-draft button').evaluateAll(buttons => buttons.map(button => {
      const parse = value => (value.match(/[\d.]+/gu) ?? []).map(Number);
      const channel = v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
      const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
      let node = button, background = null;
      while (node && !background) {
        const [r, g, b, a = 1] = parse(getComputedStyle(node).backgroundColor);
        if (a > 0.5) background = [r, g, b];
        node = node.parentElement;
      }
      background ??= [255, 255, 255];
      const [high, low] = [luminance(parse(getComputedStyle(button).color)), luminance(background)].sort((x, y) => y - x);
      return { text: button.textContent, ratio: (high + 0.05) / (low + 0.05) };
    }));
    for (const { text: caption, ratio } of contrasts) assert.ok(ratio >= 4.5, `${label}: button «${caption}» is unreadable, contrast ${ratio.toFixed(2)}`);
    await page.screenshot({ path: `/tmp/easywar-shots/assistant-draft-confirm-${branch}.png`, fullPage: true });

    // 5. Скасування нічого не міняє; редагування тексту знімає застаріле підтвердження.
    await confirm.locator('[data-draft="cancel"]').click();
    assert.equal(await frame.evaluate(() => document.querySelector('#paste').value), '');
    await panel.locator('[data-draft="preview"]').click();
    await confirm.waitFor();
    await panel.locator('[data-draft="text"]').type('!');
    assert.equal(await panel.locator('.ew-assistant-draft-confirm').count(), 0, `${label}: editing the text drops the stale confirmation`);
    await panel.locator('[data-draft="text"]').fill(text);

    // 6. «Додавати автоматично» блокує чернетку: запис додався б без підтвердження в модулі.
    await frame.evaluate(() => { document.querySelector('#autoToggle').checked = true; });
    await panel.locator('[data-draft="preview"]').click();
    assert.match(await panel.locator('[data-draft="blocked"]').textContent(), /Додавати автоматично/u, label);
    await frame.evaluate(() => { document.querySelector('#autoToggle').checked = false; });

    // 7. Непорожнє поле не замінюється й не доповнюється.
    await frame.evaluate(() => { document.querySelector('#paste').value = 'Уже вписано'; });
    await panel.locator('[data-draft="preview"]').click();
    assert.match(await panel.locator('[data-draft="blocked"]').textContent(), /нічого не замінює й не дописує/u, label);
    assert.equal(await frame.evaluate(() => document.querySelector('#paste').value), 'Уже вписано');
    await frame.evaluate(() => { document.querySelector('#paste').value = ''; });

    // 8. Підтвердження: текст у полі модуля, вкладка «Внесення доповідей» відкрита, таблиця не змінена.
    await panel.locator('[data-draft="preview"]').click();
    await confirm.waitFor();
    // Поле змінилося, поки було відкрите підтвердження: підстановка перевіряє стан знову і нічого не затирає.
    await frame.evaluate(() => { document.querySelector('#paste').value = 'Встигли вписати'; });
    await confirm.locator('[data-draft="confirm"]').click();
    assert.match(await panel.locator('[data-draft="blocked"]').textContent(), /нічого не замінює й не дописує/u, label);
    assert.equal(await frame.evaluate(() => document.querySelector('#paste').value), 'Встигли вписати');
    await frame.evaluate(() => { document.querySelector('#paste').value = ''; });
    await panel.locator('[data-draft="preview"]').click();
    await confirm.waitFor();
    await confirm.locator('[data-draft="confirm"]').click();
    await page.waitForFunction(() => document.querySelector('.ew-assistant-panel').hidden);
    assert.equal(await activeBranch(), branch);
    assert.equal(await frame.evaluate(() => document.querySelector('#paste').value), text, `${label}: the text is placed unchanged`);
    assert.equal(await frame.evaluate(() => document.querySelector('#view-entry').hidden), false, `${label}: the entry tab is shown`);
    await frame.waitForTimeout(900);
    assert.equal(await frame.evaluate(() => window.__AV.S.wb.records.length), rowsBefore, `${label}: the module table is unchanged: adding stays with the user`);
    await page.screenshot({ path: `/tmp/easywar-shots/assistant-draft-placed-${branch}.png`, fullPage: true });

    // 9. Кнопка «Внесення доповідей» з чату відкриває вкладку, не торкаючись поля.
    await frame.evaluate(() => { document.querySelector('#tab-dash').click(); });
    await clickLauncher();
    await ask(`Відкрий внесення доповідей ${label}`);
    await panel.locator(`.ew-assistant-turn-action[data-action="open-entry-${branch}"]`).last().click();
    await frame.waitForFunction(() => !document.querySelector('#view-entry').hidden);
    assert.equal(await frame.evaluate(() => document.querySelector('#paste').value), text, `${label}: opening the tab leaves the field as it was`);
  }

  const commands = await page.evaluate(() => window.testCommands);
  assert.equal(commands.some(command => /assistant.*(?:save|write)|sql|append|approve|stage|export/u.test(command)), false, 'no write command was issued: ' + commands.join(','));
  assert.deepEqual(remote, []);
  assert.deepEqual(errors, []);
  console.log('Browser gate passed: КОМБАТ opens modules and the entry tab, and prepares a draft only after confirmation (ПС and РВ).');
} catch (error) {
  await page.screenshot({ path: '/tmp/easywar-shots/assistant-actions-failure.png', fullPage: true }).catch(() => {});
  throw error;
} finally {
  await rm(fixtureDir, { recursive: true, force: true });
  await browser.close();
}
