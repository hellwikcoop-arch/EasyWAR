// Dev-only: будує демонстраційні колоди з синтетичних даних (обидві теми) у вказану теку
// і, якщо встановлено LibreOffice (soffice), конвертує їх у PDF для перегляду.
// Використання: node script/preview_presentation.mjs [тека] [focus: result|efficiency|all]
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { buildDeck } from '../src/presentation-core.js';
import { renderDeckToBytes } from '../src/presentation-pptx.js';

const outDir = resolve(process.argv[2] || 'preview-out');
const focus = process.argv[3] || 'all';
mkdirSync(outDir, { recursive: true });

const units = ['Підрозділ А', 'Підрозділ Б', 'Підрозділ В'];
const sheetOf = date => ({ '07': 'ЛИПЕНЬ-26', '08': 'СЕРПЕНЬ-26', '09': 'ВЕРЕСЕНЬ-26' }[date.slice(5, 7)]);
const records = [];
for (let n = 0; n < 92; n++) {
  const date = new Date(Date.UTC(2026, 6, 1) + n * 864e5).toISOString().slice(0, 10);
  units.forEach((unit, i) => {
    const wave = 1 + ((n * (i + 3)) % 7) / 4;
    records.push({ sheet: sheetOf(date), rowNumber: records.length + 5, date, unit, values: {
      'personnel|200': Math.round(2 * wave), 'personnel|300': Math.round(wave), 'destroyed|танк': i === 0 ? 1 : 0, 'damaged|БМП': 1,
      'destroyed|Склади БК, ПММ': Math.round(wave), 'ammo|155мм': Math.round(30 * wave), 'ammo|ВСЬОГО': Math.round(30 * wave), 'fire|ВгЗ': 2,
    } });
  });
}
const workbook = { kind: 'udshv', readOnly: true, sourceName: 'synthetic.xlsx', sheetName: 'x', sheets: [], metrics: [], units, records, issues: [] };
const deck = buildDeck(workbook, { owner: 'Демонстраційна група', generatedOn: '30.09.2026', focus, groups: [{ id: 'a', title: 'Група А', units: [units[0]] }] });

const files = [];
for (const theme of ['dark', 'light']) {
  const file = join(outDir, `demo-${focus}-${theme}.pptx`);
  writeFileSync(file, await renderDeckToBytes(deck, { theme }));
  files.push(file);
}
console.log(files.join('\n'));
const converted = spawnSync('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', outDir, ...files], { stdio: 'ignore' });
console.log(converted.status === 0 ? `PDF: ${outDir}` : 'soffice недоступний: PDF не створено');
