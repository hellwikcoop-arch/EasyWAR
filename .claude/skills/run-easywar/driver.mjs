#!/usr/bin/env node
// Командний драйвер фронтенду EasyWAR у headless Chromium (Playwright).
// Читає по одній команді з рядка stdin: можна передати heredoc або працювати в tmux.
// Сервер має вже віддавати зібраний фронтенд (див. SKILL.md: vite preview на :4173).
//
//   node .claude/skills/run-easywar/driver.mjs [--url http://localhost:4173/] [--reduced-motion]
//        [--width 1600] [--height 1000] [--scale 1] [--shots /tmp/easywar-shots]
//
// Команди: open, frame, load, click, fill, press, wait, wait-for, text, eval, passport, drag,
// ss, ss-el, errors, help, quit. Опис — у SKILL.md або командою help.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const require = createRequire(import.meta.url);
function playwright() {
  try { return require('playwright'); } catch { /* немає в проєкті — беремо глобальний */ }
  return require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
}

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const BASE = opt('--url', process.env.EASYWAR_URL || 'http://localhost:4173/');
const SHOTS = opt('--shots', '/tmp/easywar-shots');
const width = +opt('--width', 1600), height = +opt('--height', 1000), scale = +opt('--scale', 1);
mkdirSync(SHOTS, { recursive: true });

const { chromium } = playwright();
const executablePath = process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
// Програмний WebGL (SwiftShader), щоб 3D-моделі в картці вильоту не залежали від GPU.
const browser = await chromium.launch({ executablePath, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, reducedMotion: args.includes('--reduced-motion') ? 'reduce' : 'no-preference' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('response', r => { if (r.status() >= 400) errors.push(`http ${r.status()}: ${r.url()}`); });

let ctx = page; // поточний фрейм: сама сторінка або iframe модуля в лаунчері
let shot = 0;
const out = (...a) => console.log(...a);
const short = v => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s && s.length > 1500 ? s.slice(0, 1500) + '…' : s; };

async function frameFor(name) {
  if (name === 'main') return page;
  const handle = await page.waitForSelector(`#frame-${name}`, { state: 'attached', timeout: 15000 });
  return handle.contentFrame();
}

async function screenshot(name, clip) {
  const file = path.join(SHOTS, `${name || String(++shot).padStart(2, '0')}.png`);
  await page.screenshot({ path: file, clip });
  out('saved', file);
}

const commands = {
  help: () => out(Object.keys(commands).join(' ')),
  // open <index.html|air.html|rocket.html|шлях> — перейти на сторінку, контекст — сама сторінка.
  open: async p => { await page.goto(new URL(p || 'index.html', BASE).href); ctx = page; out('url', page.url()); },
  // frame <air|rocket|main> — у лаунчері модулі живуть в iframe #frame-air / #frame-rocket.
  frame: async name => { ctx = await frameFor(name); out('frame', name, ctx.url()); },
  // load <xlsx> — підключити таблицю в поточному модулі так само, як «Відкрити таблицю…».
  load: async file => {
    await ctx.waitForFunction(() => window.__AV && window.__AV.connect, null, { timeout: 20000 });
    const bytes = [...readFileSync(file)];
    await ctx.evaluate(({ bytes, name }) => window.__AV.connect(new Uint8Array(bytes), name, null, true), { bytes, name: path.basename(file) });
    await ctx.waitForFunction(() => window.__DASH && window.__DASH.rows && window.__DASH.rows.length > 0, null, { timeout: 20000 }).catch(() => {});
    out('rows', await ctx.evaluate(() => window.__DASH?.rows?.length ?? 0));
  },
  click: async sel => { await ctx.click(sel); out('clicked', sel); },
  fill: async rest => { const [sel, ...text] = rest.split(' '); await ctx.fill(sel, text.join(' ')); out('filled', sel); },
  press: async key => { await page.keyboard.press(key); out('pressed', key); },
  wait: async ms => { await page.waitForTimeout(+ms || 500); },
  'wait-for': async sel => { await ctx.waitForSelector(sel, { timeout: 20000 }); out('found', sel); },
  text: async sel => out(short((await ctx.innerText(sel)).trim())),
  // eval <вираз> — виконати JS у поточному фреймі й надрукувати результат.
  eval: async js => out(short(await ctx.evaluate(js))),
  // passport <боєприпас> — відкрити картку вильоту першого рядка з цим боєприпасом і дочекатися 3D.
  passport: async what => {
    const ok = await ctx.evaluate(w => {
      const row = window.__DASH.rows.find(r => String(r.munition || '').toUpperCase().includes(w.toUpperCase()));
      if (row) window.__DASH.openPassport(row);
      return !!row;
    }, what);
    if (!ok) { out('no row with munition', what); return; }
    await ctx.waitForSelector('dialog.pass[open]', { timeout: 10000 });
    await ctx.evaluate(() => document.querySelector('.pass-hud')?.scrollIntoView({ block: 'center' }));
    const is3d = await ctx.waitForFunction(() => document.querySelector('.mw-stage')?.classList.contains('is-3d'), null, { timeout: 20000 }).then(() => true, () => false);
    out('passport', what, '3d:', is3d);
  },
  // drag <dx> — потягнути 3D-модель у картці вбік на dx пікселів (повертає модель).
  drag: async dx => {
    const box = await ctx.locator('.mw-stage').boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + (+dx || 100), y, { steps: 3 }); await page.mouse.up();
    out('dragged', dx);
  },
  // ss [назва] — знімок видимої області; ss-el <селектор> [назва] — лише елемент (через clip, без очікування стабільності).
  ss: async name => screenshot(name),
  'ss-el': async rest => {
    const [sel, name] = rest.split(' ');
    const loc = ctx.locator(sel).first();
    await loc.scrollIntoViewIfNeeded();
    await screenshot(name, await loc.boundingBox());
  },
  errors: () => out(errors.length ? errors.join('\n') : 'no errors'),
  quit: async () => { await browser.close(); out('bye'); process.exit(0); },
};

out('ready', BASE, 'shots ->', SHOTS);
const rl = readline.createInterface({ input: process.stdin, terminal: false });
for await (const raw of rl) {
  const line = raw.trim();
  if (!line || line.startsWith('#')) continue;
  const [cmd, ...rest] = line.split(' ');
  out('>', line);
  const fn = commands[cmd];
  if (!fn) { out('unknown command:', cmd, '(help)'); continue; }
  try { await fn(rest.join(' ')); } catch (e) { out('error:', e.message.split('\n')[0]); }
}
await commands.quit();
