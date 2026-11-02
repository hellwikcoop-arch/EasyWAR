#!/usr/bin/env node
// Збирає EasyFLY для телефона в ОДИН самодостатній .html (dist-standalone/EasyFLY.html), який
// надсилають на iPhone чи Android месенджером, поштою або кабелем і відкривають без сервера,
// інтернету й установлення — як лайт-версії дашбордів (script/build_standalone.mjs).
// Сторінка — src/mobile/easyfly/index.html; скрипти й стилі вбудовуються, маніфест і значки
// PWA з файлу прибираються (у самотньому файлі їм нема звідки взятися).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const pageDir = fileURLToPath(new URL('../src/mobile/easyfly/', import.meta.url));
const defaultOutDir = fileURLToPath(new URL('../dist-standalone/', import.meta.url));

export const FILE_NAME = 'EasyFLY.html';

const scriptSafe = (code) => code.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
const styleSafe = (css) => css.replace(/<\/(style)/gi, '<\\/$1');

/** Перетворює сторінку збірки Vite на один файл: стилі й модулі всередину, посилання PWA геть. */
export function inlinePage(html, files) {
  let out = html;
  out = out.replace(/<link\s+rel="modulepreload"[^>]*>\s*/g, '');
  out = out.replace(/<link\s+rel="(?:manifest|icon|apple-touch-icon)"[^>]*>\s*/g, '');
  out = out.replace(/<link\s+rel="stylesheet"[^>]*href="\.\/(assets\/[^"]+)"[^>]*>/g, (_, name) => {
    if (!(name in files)) throw new Error(`Missing stylesheet ${name}`);
    return `<style>${styleSafe(files[name])}</style>`;
  });
  out = out.replace(/<script\s+type="module"[^>]*src="\.\/(assets\/[^"]+)"[^>]*><\/script>/g, (_, name) => {
    if (!(name in files)) throw new Error(`Missing script ${name}`);
    return `<script type="module">${scriptSafe(files[name])}</script>`;
  });
  return out;
}

export function leftoverReferences(html) {
  const found = new Set();
  for (const match of html.matchAll(/(?:src|href)="(\.\/[^"]+)"/g)) found.add(match[1]);
  for (const match of html.matchAll(/url\((["']?)(\.\/[^)"']+)\1\)/g)) found.add(match[2]);
  return [...found];
}

export async function buildFile(outDir = defaultOutDir) {
  const result = await build({
    root: pageDir,
    configFile: false,
    base: './',
    logLevel: 'warn',
    publicDir: false,
    build: {
      write: false,
      target: 'safari15',
      cssCodeSplit: false,
      modulePreload: false,
      cssMinify: false,
      assetsInlineLimit: () => true,
      rolldownOptions: {
        input: { index: resolve(pageDir, 'index.html') },
        output: { codeSplitting: false },
      },
    },
  });
  const outputs = (Array.isArray(result) ? result[0] : result).output;
  const files = {};
  let html = null;
  for (const item of outputs) {
    if (item.type === 'chunk') files[item.fileName] = item.code;
    else if (item.fileName === 'index.html') html = String(item.source);
    else if (item.fileName.endsWith('.css')) files[item.fileName] = String(item.source);
  }
  if (html === null) throw new Error('No HTML produced for EasyFLY');
  let single = inlinePage(html, files);
  const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  single = single.replace(/^(\s*<!doctype html>)/i, `$1\n<!-- EasyFLY (EasyWAR ${version}) standalone: автономний файл, працює без інтернету -->`);
  const left = leftoverReferences(single);
  if (left.length) throw new Error(`${FILE_NAME} still points at external files: ${left.join(', ')}`);
  mkdirSync(outDir, { recursive: true });
  const target = resolve(outDir, FILE_NAME);
  writeFileSync(target, single);
  return { file: FILE_NAME, target, bytes: Buffer.byteLength(single) };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.chdir(root);
  const args = process.argv.slice(2);
  let outDir = defaultOutDir;
  const at = args.indexOf('--out');
  if (at >= 0) {
    if (!args[at + 1]) throw new Error('--out needs a folder');
    outDir = resolve(root, args[at + 1]);
  }
  const { file, bytes } = await buildFile(outDir);
  console.log(`${file}  ${(bytes / 1e6).toFixed(2)} MB`);
}
