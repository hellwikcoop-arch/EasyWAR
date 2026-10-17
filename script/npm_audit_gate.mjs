#!/usr/bin/env node
// Ворота `npm audit` для CI: падає на будь-якій відомій вразливості production-залежностей,
// крім явно прийнятих нижче. `npm audit` сам такого списку виключень не має, а без нього
// невиправна вразливість назавжди б зафарбувала CI в червоне й привчила ігнорувати його.
//
// Прийняті записи мають причину й дату перегляду. Коли виправлення з'являється, запис
// видаляють: скрипт підказує про записи, яких у звіті вже немає.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ACCEPTED_ADVISORIES = [
  {
    id: 'GHSA-5p2g-fcmc-qvqq',
    package: 'image-size',
    reason:
      'Залежність pptxgenjs (останній 4.0.1 вимагає image-size ^1.2.1); виправленої версії немає, ' +
      '`npm audit fix --force` пропонує лише застарілий pptxgenjs 4.0.0. DoS у розборі JXL/HEIF.',
    reviewed: '2026-10-17',
  },
  {
    id: 'GHSA-w3rx-r6r6-pgpr',
    package: 'image-size',
    reason: 'Те саме: image-size тягне pptxgenjs, виправлення немає. DoS у розборі ICNS.',
    reviewed: '2026-10-17',
  },
];

function advisoryId(via) {
  const match = /GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/i.exec(String(via.url ?? ''));
  return match ? match[0] : `npm:${via.source ?? via.title ?? 'unknown'}`;
}

/** Розкладає звіт `npm audit --json` у список унікальних advisory. */
export function collectAdvisories(report) {
  if (!report || typeof report !== 'object' || report.error) {
    throw new Error(`npm audit не повернув звіт: ${JSON.stringify(report?.error ?? report)}`);
  }
  if (!report.vulnerabilities || typeof report.vulnerabilities !== 'object') {
    throw new Error('У звіті npm audit немає поля vulnerabilities');
  }
  const found = new Map();
  for (const [name, entry] of Object.entries(report.vulnerabilities)) {
    for (const via of entry.via ?? []) {
      // Рядок у `via` — лише посилання на інший вразливий пакет, advisory там немає.
      if (typeof via !== 'object' || via === null) continue;
      const id = advisoryId(via);
      if (!found.has(id)) {
        found.set(id, {
          id,
          package: via.name ?? name,
          severity: via.severity ?? entry.severity ?? 'unknown',
          title: via.title ?? '',
        });
      }
    }
  }
  return [...found.values()];
}

/** Порівнює звіт зі списком прийнятих advisory. */
export function evaluateAudit(report, accepted = ACCEPTED_ADVISORIES) {
  const advisories = collectAdvisories(report);
  const acceptedIds = new Set(accepted.map((item) => item.id));
  const present = new Set(advisories.map((item) => item.id));
  return {
    blocking: advisories.filter((item) => !acceptedIds.has(item.id)),
    tolerated: advisories.filter((item) => acceptedIds.has(item.id)),
    stale: accepted.filter((item) => !present.has(item.id)),
  };
}

function main() {
  const run = spawnSync('npm', ['audit', '--omit=dev', '--json'], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  let report;
  try {
    report = JSON.parse(run.stdout);
  } catch {
    console.error(`npm audit не повернув JSON (код ${run.status}):\n${run.stderr || run.stdout}`);
    process.exit(2);
  }
  let result;
  try {
    result = evaluateAudit(report);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  for (const item of result.tolerated) {
    const note = ACCEPTED_ADVISORIES.find((entry) => entry.id === item.id);
    console.log(`Прийнято (переглянуто ${note.reviewed}): ${item.id} (${item.package}, ${item.severity}) — ${note.reason}`);
  }
  for (const item of result.stale) {
    console.log(`Запис ${item.id} більше не зустрічається у звіті: його можна прибрати зі script/npm_audit_gate.mjs.`);
  }
  if (result.blocking.length > 0) {
    for (const item of result.blocking) {
      console.error(`Вразливість: ${item.id} (${item.package}, ${item.severity}) ${item.title}`);
    }
    console.error('Оновіть залежність або, якщо виправлення немає, додайте запис із причиною до ACCEPTED_ADVISORIES.');
    process.exit(1);
  }
  console.log('npm audit: нових вразливостей production-залежностей немає.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
