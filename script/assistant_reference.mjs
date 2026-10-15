import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { renderReferences } from './assistant_reference_core.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

try {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--check') || args.length > 1) throw new Error('Використання: node script/assistant_reference.mjs [--check]');
  const outputs = renderReferences();
  for (const [file, text] of outputs) {
    const path = resolve(projectRoot, file);
    if (args.includes('--check')) {
      let actual;
      try { actual = await readFile(path, 'utf8'); } catch (error) {
        if (error.code === 'ENOENT') throw new Error(`Файл ${file} відсутній; запустіть node script/assistant_reference.mjs`);
        throw error;
      }
      if (actual !== text) throw new Error(`Файл ${file} застарів; запустіть node script/assistant_reference.mjs`);
    } else {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, text, 'utf8');
    }
  }
  process.stdout.write(args.includes('--check') ? 'Довідкові файли актуальні.\n' : 'Довідкові файли згенеровано.\n');
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
