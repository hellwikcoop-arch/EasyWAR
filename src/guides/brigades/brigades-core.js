// Чиста логіка довідника бригад (тестується в Node).
import { BRANCHES, PURPOSES, TYPES } from './brigades-data.js';

const UPPER = { одшбр: 'ОДШБр', ошп: 'ОШП', оабр: 'ОАБр', реабр: 'РеАБр', омбр: 'ОМБр', оєбр: 'ОЄБр', обраа: 'ОБрАА', змае: 'ЗмАЕ', брта: 'БрТА', опсп: 'ОПСпП', оцспо: 'ОЦСпО', нцссо: 'НЦ ССО', мцспо: 'МЦСпО', отбр: 'ОТБр', овмбр: 'ОВМБр', осбр: 'ОСБр', огшбр: 'ОГШБр', ошбр: 'ОШБр', омпбр: 'ОМПБр', обрмп: 'ОБрМП', орбр: 'ОРБр', зрбр: 'ЗРБр', ртбр: 'РТБр', бртакт: 'БрТА (такт.)', нав: 'НАБр' };

/** Коротка назва: «79 ОДШБр». */
export const shortName = b => b.name || `${b.number} ${UPPER[b.type] || b.type.toUpperCase()}`;
/** Повна назва типу частини. */
export const typeName = b => TYPES[b.type] || '';
export const purposeOf = b => PURPOSES[b.type] || null;
export const branchName = b => (b.branch ? BRANCHES[b.branch] : null);

const norm = s => String(s ?? '').toLowerCase().replace(/ё/g, 'е').trim();

/** Відбір за рядком пошуку (назва, прізвисько, місце, тип) і родом військ ('' — усі, 'none' — рід не вказано). */
export function filterBrigades(list, { query = '', branch = '' } = {}) {
  const words = norm(query).split(/\s+/).filter(Boolean);
  return list.filter(b => {
    if (branch === 'none' ? b.branch : branch && b.branch !== branch) return false;
    const hay = norm([shortName(b), typeName(b), purposeOf(b), b.nickname, b.place, branchName(b)].filter(Boolean).join(' '));
    return words.every(w => hay.includes(w));
  });
}

/** Лічильники за родом військ для кнопок фільтра. */
export function branchCounts(list) {
  const out = { '': list.length, none: 0 };
  for (const k of Object.keys(BRANCHES)) out[k] = 0;
  for (const b of list) out[b.branch || 'none'] += 1;
  return out;
}
