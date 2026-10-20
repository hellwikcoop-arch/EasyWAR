// Емблеми підрозділів: чиста логіка пошуку файлу за назвою (без Vite, тестується в Node).
// Самі файли лежать у src/unit-art/<файл>.webp; адреси дає unit-emblems.js.

/** Файли, що є в src/unit-art (без розширення). Тест звіряє цей перелік зі справжньою текою. */
export const EMBLEM_FILE_NAMES = Object.freeze([
  '1-oshp', '107-reabr', '148-oabr', '225-oshp', '425-oshp', '475-oshp', '67-ombr', '71-oebr', '78-odshbr',
  '79-odshbr', '80-odshbr', '82-odshbr', '95-odshbr', 'arez2-148-44', 'sso-generic',
]);
const KNOWN = new Set(EMBLEM_FILE_NAMES);

// Тип частини з назви → суфікс файлу.
const TYPE_SLUG = [[/^одшбр$/, 'odshbr'], [/^ошп$/, 'oshp'], [/^оабр$/, 'oabr'], [/^реабр$/, 'reabr'], [/^омбр$/, 'ombr'], [/^о[єе]бр$/, 'oebr']];

// «АГр, РУК 148 оабр» і «АГр 148 оабр» — та сама емблема. «Арез №2» — зведений загін 148 і 44 оабр. «ГРВ 1/1/107 реабр» — 107 реабр.
const PATTERNS = [
  [/арез\s*№\s*2/i, 'arez2-148-44'], [/148\s*оабр/i, '148-oabr'], [/^грв.*107/i, '107-reabr'],
  [/225\s*ошп/i, '225-oshp'], [/475\s*ошп/i, '475-oshp'], [/^78\s*од/i, '78-odshbr'], [/71\s*о[єе]бр/i, '71-oebr'], [/^67\s*омбр/i, '67-ombr'],
];

/** Ім'я файлу емблеми (без розширення) за назвою підрозділу або null. */
export function emblemFile(name) {
  const text = String(name ?? '').trim();
  if (!text) return null;
  const hit = PATTERNS.find(([re]) => re.test(text));
  if (hit) return hit[1];
  // «79 ОДШБр», «425 ошп», «82 ОШБр», «ГРВ 79 одшбр»: номер і тип частини наприкінці назви.
  const m = /(?:^|[^0-9])(\d{1,3})\s*(одшбр|ошп|оабр|реабр|омбр|оєбр|оебр)\s*$/.exec(text.toLowerCase().replace(/ошбр/g, 'одшбр'));
  const slug = m && (TYPE_SLUG.find(([re]) => re.test(m[2])) || [])[1];
  const file = slug ? `${+m[1]}-${slug}` : null;
  if (file && KNOWN.has(file)) return file;
  // Невідомий підрозділ із позначкою «ССО»: загальний знак ССО.
  return /(^|[^а-яіїєґ])ссо($|[^а-яіїєґ])/i.test(text) ? 'sso-generic' : null;
}
