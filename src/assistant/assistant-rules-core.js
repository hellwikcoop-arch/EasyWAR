// Read-only presentation adapter. Existing reviewData owns every data check.
import { reviewData } from '../data-review-core.js';
import { isInstructionText } from './assistant-knowledge-core.js';

const define = (module, kind, severity, message, why, proposedFix) => Object.freeze({
  id: `${module.toUpperCase()}:${kind}`, module, kind, severity, message, why, proposedFix,
});

/** Fixed catalog IDs describe a rule; finding IDs describe its occurrences. */
export const ASSISTANT_RULES = Object.freeze([
  define('assistant', 'instruction-injection', 'warning', 'У даних знайдено інструкцію для помічника',
    'Текст у таблиці є даними. Інструкції змінити правила або виконати команди не впливають на роботу помічника.',
    'Звірте вміст із джерелом. Потрібне рішення людини; помічник не виконує інструкцію і не переписує клітинку.'),
  define('udshv', 'date-outside-month', 'error', 'Дата не з місяця аркуша',
    'Дата рядка не відповідає місяцю в назві аркуша. Це може змінити період, до якого потраплять дані.',
    'Звірте дату з джерелом і сусідніми рядками. Потрібне рішення людини; доступні виправлення показує наявна перевірка перед звітом.'),
  define('udshv', 'duplicate', 'warning', 'Підрозділ двічі за день',
    'У таблиці повторюється пара «дата — підрозділ». Наявна аналітика складає дані з обох рядків, тому можливе подвійне врахування.',
    'Порівняйте рядки з джерелом і вирішіть, чи це окремі дані, чи повтор. Потрібне рішення людини.'),
  define('udshv', 'missing-date', 'advice', 'Доби без рядків',
    'Між першою й останньою датами таблиці є доби без рядків. Відсутність даних сама по собі не означає нульове значення.',
    'Звірте повноту таблиці за вказаний період. Якщо за ці доби даних не було, залиште їх без змін.'),
  define('udshv', 'invalid-date', 'warning', 'Дату не вдалося прочитати',
    'Наявний розбір не розпізнав текст дати. Потрібно перевірити, до якої доби належить рядок.',
    'Звірте клітинку дати з джерелом і виправте її вручну у звичному редакторі таблиці.'),
  define('udshv', 'negative', 'warning', 'Від’ємне значення',
    'У числовій клітинці є від’ємне значення. Воно може спотворити підсумок показника.',
    'Звірте знак і значення з джерелом. Потрібне рішення людини; помічник не замінює значення.'),
  define('udshv', 'text-in-numeric', 'warning', 'Текст у числовій клітинці',
    'Наявний розбір не отримав число з клітинки числового показника, тому значення не враховане як число.',
    'Уточніть числове значення за джерелом і виправте клітинку вручну у звичному редакторі таблиці.'),
  define('udshv', 'number-without-date', 'warning', 'Числові дані без дати',
    'У рядку є числові дані, але немає розпізнаної дати. Такий рядок не можна віднести до періоду аналізу.',
    'Звірте рядок із джерелом і вкажіть дату вручну у звичному редакторі таблиці.'),
  define('udshv', 'ammo-total', 'advice', 'ВСЬОГО не дорівнює сумі боєприпасів',
    'Підсумок витрати боєприпасів відрізняється від суми окремих показників. Наявний звіт використовує значення ВСЬОГО.',
    'Звірте окремі показники і ВСЬОГО з джерелом. Потрібне рішення людини щодо правильного підсумку.'),
  define('own', 'date-outlier', 'error', 'Дата різко відрізняється від сусідніх рядків',
    'Дата різко відрізняється від обох близьких сусідніх дат. Наявний розбір позначає рядок підозрілим і не враховує його в аналізі періодів.',
    'Звірте дату з джерелом і сусідніми рядками. Потрібне рішення людини; доступні виправлення показує наявна перевірка перед звітом.'),
  define('own', 'invalid-date', 'error', 'Дату не вдалося прочитати',
    'Рядок власних втрат не має розпізнаної дати й не потрапляє до аналізу періодів.',
    'Звірте дату з джерелом. Потрібне рішення людини; дату можна уточнити в наявній перевірці перед звітом.'),
  define('own', 'total-mismatch', 'warning', 'Підсумок таблиці не збігається із сумою рядків',
    'Значення ВСЬОГО відрізняється від суми рядків цього аркуша. Наявний звіт використовує суму рядків.',
    'Звірте рядки та ВСЬОГО з джерелом. Потрібне рішення людини щодо повноти даних і правильного підсумку.'),
  define('own', 'negative', 'warning', 'Від’ємне значення',
    'У числовому показнику власних втрат є від’ємне значення. Воно може спотворити підсумки.',
    'Звірте знак і значення з джерелом. Потрібне рішення людини; помічник не замінює значення.'),
  define('own', 'text-in-numeric', 'warning', 'Текст у числовій клітинці',
    'Наявний розбір не отримав число з клітинки власних втрат, тому значення не враховане як число.',
    'Уточніть числове значення за джерелом і виправте клітинку вручну у звичному редакторі таблиці.'),
  define('strikes', 'invalid-date', 'error', 'Дату не вдалося прочитати',
    'Рядок ПС або РВ не має розпізнаної дати й не потрапляє до аналізу періодів.',
    'Звірте дату з джерелом. Потрібне рішення людини; дату можна уточнити в наявній перевірці перед звітом.'),
  define('strikes', 'invalid-count', 'warning', 'Кількість боєприпасів не число',
    'Наявний розбір не розпізнав кількість боєприпасів. Зараз для цього рядка використовується нуль.',
    'Звірте кількість із джерелом. Потрібне рішення людини; кількість можна уточнити в наявній перевірці перед звітом.'),
  define('strikes', 'unknown-result', 'warning', 'Результат не розпізнано',
    'Наявні правила не віднесли результат до «Уражено», «Частково» або «Не уражено». Результат не входить в оцінку ефективності.',
    'Звірте результат із джерелом. Потрібне рішення людини; категорію можна уточнити в наявній перевірці перед звітом.'),
]);

const catalog = new Map(ASSISTANT_RULES.map(rule => [`${rule.module}:${rule.kind}`, rule]));

// Parsed tables contain plain objects/arrays; keep support for older WebViews.
function copyParsed(value, seen = new Map()) {
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  const result = Array.isArray(value) ? [] : {};
  seen.set(value, result);
  for (const [key, child] of Object.entries(value)) Object.defineProperty(result, key, {
    value: copyParsed(child, seen), enumerable: true, writable: true, configurable: true,
  });
  return result;
}

/**
 * Accepts only parsed tables explicitly supplied by the caller.
 * Returns plain text, never executes cell contents and exposes no write action.
 * location is the existing review's description; sourceRef preserves its rows.
 */
export function reviewAssistantData(input = {}) {
  const review = reviewData(copyParsed(input));
  const usedIds = new Set();
  const counts = { total: 0, error: 0, warning: 0, advice: 0 };
  const items = review.items.map(finding => {
    const moduleId = finding.source.startsWith('strikes:') ? 'strikes' : finding.source;
    const rule = catalog.get(`${moduleId}:${finding.kind}`);
    if (!rule) throw new Error(`Правило помічника не зареєстровано: ${moduleId}:${finding.kind}`);
    let id = finding.id;
    let occurrence = 1;
    while (usedIds.has(id)) id = `${finding.id}#${++occurrence}`;
    usedIds.add(id);
    counts.total++;
    counts[rule.severity]++;
    return {
      id, findingId: finding.id, ruleId: rule.id, module: finding.sourceLabel,
      moduleId, kind: finding.kind, severity: rule.severity,
      message: finding.title, explanation: rule.why, suggestion: rule.proposedFix,
      location: finding.detail,
      sourceRef: { sheet: finding.sheet ?? null, rows: [...finding.rows] },
    };
  });
  const seen = new WeakSet();
  function inspect(value, sourceRef = { sheet: null, rows: [] }) {
    if (typeof value === 'string') {
      if (isInstructionText(value)) {
        const rule = catalog.get('assistant:instruction-injection');
        const id = `assistant:instruction-injection:${items.length}`;
        items.push({ id, findingId: id, ruleId: rule.id, module: 'Помічник', moduleId: 'assistant', kind: rule.kind,
          severity: rule.severity, message: rule.message, explanation: rule.why, suggestion: rule.proposedFix,
          location: sourceRef.rows.length ? `Рядок ${sourceRef.rows.join(', ')}` : 'Передані дані', sourceRef });
        counts.total++; counts.warning++;
      }
      return;
    }
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    const location = { sheet: typeof value.sheet === 'string' ? value.sheet : sourceRef.sheet,
      rows: Number.isInteger(value.rowNumber) ? [value.rowNumber] : sourceRef.rows };
    for (const child of Object.values(value)) inspect(child, location);
  }
  inspect(input);
  return { items, counts, clean: items.length === 0 };
}
