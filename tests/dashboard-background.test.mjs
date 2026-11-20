import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';

const read = name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8');
const strip = css => css.replace(/\/\*[\s\S]*?\*\//g, '');

const POSTERS = {
  'ps-background.webp': 'air-background.css',
  'rv-background.webp': 'rocket-background.css',
  'udshv-background.webp': 'rocket-background.css',
  'artillery-background.webp': 'artillery.css',
  'army-background.webp': 'air.html',
  'start-background.webp': 'index.html',
};

test('плакати фонів лежать у brand-art, легкі й підключені там, де їх малюють', async () => {
  for (const [file, owner] of Object.entries(POSTERS)) {
    const { size } = await stat(new URL(`../src/brand-art/${file}`, import.meta.url));
    assert.ok(size > 10_000 && size < 120_000, `${file}: ${size} байт`);
    assert.ok((await read(owner)).includes(`./brand-art/${file}`), `${owner} має посилатися на ${file}`);
  }
});

test('фони дашбордів: плакат лише в темній темі, на <html>, зі затемненням і без зовнішніх адрес', async () => {
  for (const name of ['air-background.css', 'rocket-background.css']) {
    const css = strip(await read(name));
    for (const [, selector] of css.matchAll(/(?:^|})\s*([^{}]+)\{/g)) {
      for (const one of selector.split(',')) assert.match(one.trim(), /^html(\[|:)/, `${name}: ${one.trim()}`);
      assert.match(selector, /:not\(\[data-theme="light"\]\)/, `${name}: ${selector.trim()}`);
    }
    for (const [, target] of css.matchAll(/url\(([^)]*)\)/g)) assert.match(target.replace(/['"]/g, ''), /^\.\/brand-art\/[\w-]+-background\.webp$/, target);
    assert.match(css, /linear-gradient\(180deg, rgba\(/, `${name}: затемнення над плакатом`);
    assert.match(css, /background: transparent/, `${name}: тіло сторінки прозоре, щоб було видно плакат`);
  }
});

test('сторінки підключають свої фони після теми дашбордів', async () => {
  for (const [page, css] of [['air.html', 'air-background.css'], ['rocket.html', 'rocket-background.css']]) {
    const html = await read(page);
    assert.match(html, new RegExp(`<link rel="stylesheet" href="\\./${css.replace('.', '\\.')}">`), page);
    assert.ok(html.indexOf(`href="./${css}"`) > html.indexOf('href="./dashboard-theme.css"'), `${page}: ${css} після dashboard-theme.css`);
  }
  assert.ok((await read('artillery.css')).includes("url('./brand-art/artillery-background.webp')"));
});

test('армійська авіація має власний плакат у своєму стилі, вищої специфічності, ніж у ПС', async () => {
  const air = await read('air.html');
  const army = air.match(/<style id="easywar-army-aviation-css">[\s\S]*?<\/style>/)[0];
  assert.match(army, /html\[data-module="army"\]:not\(\[data-theme="light"\]\) \{ background: linear-gradient[^}]*army-background\.webp/);
  assert.doesNotMatch(await read('air-background.css'), /army-background|easywar-army-aviation/, 'файл командування не повинен тягти плакат армавіації');
});

test('стартовий екран: плакат замінив старий фон лише на самому екрані, картки лишають launcher-bg', async () => {
  const html = await read('index.html');
  assert.equal((html.match(/url\('\.\/brand-art\/start-background\.webp'\)/g) ?? []).length, 2);
  assert.match(html, /const IW = 1280, IH = 720, RX = 640, RY = 260;/);
  assert.match(html, /#view-start \.cmd-slot \.cmd-card::before \{[^}]*launcher-bg\.webp/);
});

test('у темній темі РВ немає суцільного фону, що перекрив би плакат', async () => {
  const theme = strip(await read('dashboard-theme.css'));
  assert.doesNotMatch(theme, /rocket-ref24:not\(\[data-command="dshv"\]\)(?:,[^{]*)? \{ background:/);
});
