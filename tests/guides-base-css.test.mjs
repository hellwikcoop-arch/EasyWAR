// 3D-довідники: base.css не повинен залежати від порядку підключення. Збірка Vite віддає його після стилів
// сторінки, тому звичайні `body{background;color}` у base.css перебивали темний вигляд (білий фон, чорний текст
// на темних картках, `padding` і `font-family` хаба скидалися). Захист: базові селектори — лише в :where().
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { GUIDES } from '../script/guides-credits.mjs';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const rules = (css) => stripComments(css).split('}').map((chunk) => chunk.split('{')).filter((parts) => parts.length === 2).map(([selector, body]) => ({ selector: selector.trim(), body }));

// Елементи, на які впливає порядок: html, body, :root, img (специфічність 0,0,1 чи 0,1,0 збігається зі сторінковими).
const BARE = /(^|,)\s*(html|body|:root|img)(?![\w-])/;

test('base.css: селектори html, body, :root і img обгорнуті в :where() (порядок підключення не важить)', async () => {
  const css = await read('src/guides/base.css');
  const found = rules(css).filter(({ selector }) => BARE.test(selector));
  assert.deepEqual(found.map((r) => r.selector), [], 'у base.css лишилися селектори без :where()');
  for (const name of ['body', 'html', ':root', 'img']) {
    assert.ok(css.includes(`:where(${name})`), `base.css: очікується :where(${name})`);
  }
});

test('кожна сторінка довідників сама задає фон і колір тексту (base.css лише запасний варіант)', async () => {
  const files = ['src/guides/hub.css', 'src/guides/brigades/style.css', ...GUIDES.map(([id]) => `src/guides/${id}/style.css`)];
  for (const file of files) {
    const bodyRules = rules(await read(file)).filter(({ selector }) => /(^|,)\s*body\s*(,|$)/.test(selector));
    const css = bodyRules.map((r) => r.body).join(';');
    assert.match(css, /background\s*:/, `${file}: фон body`);
    assert.match(css, /(^|;)\s*color\s*:/, `${file}: колір тексту body`);
  }
});

test('кожна сторінка довідників підключає base.css до власних стилів (порядок у вихідному HTML)', async () => {
  const pages = ['src/guides/index.html', 'src/guides/brigades/index.html', ...GUIDES.map(([id]) => `src/guides/${id}/index.html`)];
  for (const page of pages) {
    const html = await read(page);
    const links = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
    const base = links.findIndex((href) => href.endsWith('base.css'));
    assert.ok(base >= 0, `${page}: підключено base.css`);
    assert.ok(links.length > base + 1, `${page}: стилі сторінки йдуть після base.css`);
  }
});
