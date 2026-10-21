// Класи чутливості стовпців спільної таблиці й дозвіл транспорту — етап E8 / C1a.
//
// Чисте ядро без DOM, мережі, сховищ і годинника. Застосунок цей файл поки не імпортує: його
// підключить інтерфейс колективу (C5), а авторитетну перевірку перед відправкою робить Rust
// (C3b, docs/adr/collective-sync-policies.md). Тут — та сама логіка для пояснень людині й
// спільні сценарії тестів.
//
// Правила (docs/COLLECTIVES_PLAN.md, розділ 4 і додаток А; рішення власника К7, К8, К10;
// наказ JE T-0002, JE-T3):
// - клас стовпця пропонує EasyWAR за смисловою роллю, а підтверджує власник таблиці;
//   запропонований, але не підтверджений клас — це D;
// - клас таблиці — найвищий серед її стовпців; порожня таблиця й змішана таблиця — D;
// - D іде лише по LAN («Дельта» в v1 не перевірена, G10); A–C — LAN або Base44 лише з
//   наскрізним шифруванням; peer_wan (WAN-mesh, етап C8) заборонений для всіх класів.
// Будь-що невідоме (клас, транспорт, роль) веде до D або до відмови, ніколи до дозволу.

import { ROLES } from './module-definition-core.js';

/** Від найменш до найбільш чутливого. */
export const SENSITIVITY_CLASSES = Object.freeze(['A', 'B', 'C', 'D']);

/** Транспорти, які знає політика. Новий транспорт без правила — відмова. */
export const TRANSPORTS = Object.freeze(['lan', 'base44', 'delta', 'peer_wan']);

/** Призначення таблиці (К7: клас C — облікові дані після факту; планові й попередні — D). */
export const TABLE_PURPOSES = Object.freeze(['after-fact', 'planned']);

const RANK = Object.freeze(Object.fromEntries(SENSITIVITY_CLASSES.map((c, i) => [c, i])));

/**
 * Пропозиція класу за смисловою роллю для таблиці обліку після факту (додаток А, клас C).
 * Ролі, яких тут немає, отримують D: це «правило сумніву» додатка А.
 */
const AFTER_FACT_ROLE_CLASS = Object.freeze({
  'event-date': { class: 'C', reason: 'Час (дата й час події) — облікове поле після факту' },
  'event-time': { class: 'C', reason: 'Час (дата й час події) — облікове поле після факту' },
  unit: { class: 'C', reason: 'Підрозділ — облікове поле після факту' },
  'firing-unit': { class: 'C', reason: 'Підрозділ (вогнева бригада) — облікове поле після факту' },
  'platform-type': { class: 'C', reason: 'Тип ЛА чи ПУ — облікове поле після факту' },
  'munition-type': { class: 'C', reason: 'Витрата БП (тип) — облікове поле після факту' },
  'munition-count': { class: 'C', reason: 'Витрата БП (кількість) — облікове поле після факту' },
  'strike-result': { class: 'C', reason: 'Результат ураження — облікове поле після факту' },
  'abort-flag': { class: 'C', reason: 'Причина не ураження (відбій) — облікове поле після факту' },
  'target-id': { class: 'C', reason: 'Номер цілі — облікове поле після факту' },
  coordinates: { class: 'C', reason: 'Координати — облікове поле після факту' },
});

/** Чому роль із реєстру не отримує класу C. Кожна роль ROLES має бути або тут, або вище. */
const ROLE_D_REASON = Object.freeze({
  'target-type': 'Тип цілі не входить у перелік полів після факту (додаток А)',
  'contact-line': 'Контур ЛБЗ не входить у перелік полів після факту (додаток А)',
  'record-issues': 'Вільний текст зауважень може містити будь-що',
  'report-metric': 'Показник книги може бути будь-яким, зокрема особовим складом',
  'journal-column': 'Довільний стовпець — зміст невідомий',
  category: 'Технічна роль — зміст стовпця невідомий',
  measure: 'Технічна роль — зміст стовпця невідомий',
  label: 'Технічна роль — зміст стовпця невідомий',
  series: 'Технічна роль — зміст стовпця невідомий',
  status: 'Технічна роль — зміст стовпця невідомий',
  latitude: 'Технічна роль — призначення координат невідоме',
  longitude: 'Технічна роль — призначення координат невідоме',
  order: 'Технічна роль — зміст стовпця невідомий',
  note: 'Вільний текст примітки може містити будь-що',
});

/** Ролі, які покриває пропозиція класу (для тесту повноти проти реєстру ROLES). */
export const CLASSIFIED_ROLES = Object.freeze([
  ...Object.keys(AFTER_FACT_ROLE_CLASS), ...Object.keys(ROLE_D_REASON),
].sort());

const own = (obj, key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(obj, key);
/** Параметри з недовіреного входу: null, масив чи примітив — як порожній об'єкт. */
const opts = value => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});

export const isSensitivityClass = value => own(RANK, value);

/** Найвищий із двох класів; невідоме значення вважається D. */
export function maxClass(a, b) {
  const ra = isSensitivityClass(a) ? RANK[a] : RANK.D;
  const rb = isSensitivityClass(b) ? RANK[b] : RANK.D;
  return SENSITIVITY_CLASSES[Math.max(ra, rb)];
}

/**
 * Пропозиція класу стовпця. Це лише пропозиція: вона не стає класом стовпця без підтвердження
 * власником таблиці (effectiveColumnClass). Клас C пропонується лише для таблиці з призначенням
 * «облік після факту»; для планової таблиці чи таблиці без призначення — D.
 * @returns {{ class: string, reason: string, confirmed: false }}
 */
export function suggestColumnClass(input) {
  const { role, tablePurpose } = opts(input);
  if (!own(ROLES, role)) {
    return { class: 'D', reason: 'Смислову роль не визначено — за правилом сумніву клас D', confirmed: false };
  }
  if (tablePurpose === 'planned') {
    return { class: 'D', reason: 'Таблиця планових або попередніх даних — клас D', confirmed: false };
  }
  if (tablePurpose !== 'after-fact') {
    return { class: 'D', reason: 'Призначення таблиці не підтверджено — клас D', confirmed: false };
  }
  if (own(AFTER_FACT_ROLE_CLASS, role)) return { ...AFTER_FACT_ROLE_CLASS[role], confirmed: false };
  return { class: 'D', reason: own(ROLE_D_REASON, role) ? ROLE_D_REASON[role] : 'Роль поза переліком — клас D', confirmed: false };
}

/**
 * Чинний клас стовпця. Клас діє, лише якщо його підтвердив власник цієї таблиці (К7): стовпець,
 * доданий адміністратором, чи стовпець із самою пропозицією лишається D. Підтвердження власника
 * остаточне й може бути нижчим за пропозицію: пропозиція — лише підказка (JE-T3), рішення — його.
 * column: { key, role?, sensitivity?: 'A'|'B'|'C'|'D', confirmedBy?: string }
 */
export function effectiveColumnClass(column, options) {
  const { tableOwnerId } = opts(options);
  if (!column || typeof column !== 'object') return 'D';
  if (!isSensitivityClass(column.sensitivity)) return 'D';
  if (typeof tableOwnerId !== 'string' || tableOwnerId === '') return 'D';
  if (column.confirmedBy !== tableOwnerId) return 'D';
  return column.sensitivity;
}

/** Клас таблиці — найвищий серед стовпців (К10: змішана таблиця — D). Порожня таблиця — D. */
export function tableClass(columns, options) {
  if (!Array.isArray(columns) || columns.length === 0) return 'D';
  return columns.reduce((acc, column) => maxClass(acc, effectiveColumnClass(column, options)), 'A');
}

const deny = (code, reason) => Object.freeze({ allowed: false, code, reason });
const allow = Object.freeze({ allowed: true, code: 'allowed', reason: 'Транспорт дозволений для цього класу' });

/**
 * Чи можна передати таблицю цього класу цим транспортом. Нічого не відкриває: лише відповідь.
 * @returns {{ allowed: boolean, code: string, reason: string }}
 */
export function routeFor(cls, transport, options) {
  const { endToEnd = false } = opts(options);
  if (!isSensitivityClass(cls)) return deny('unknown-class', 'Невідомий клас чутливості — передачу заборонено');
  if (!TRANSPORTS.includes(transport)) return deny('unknown-transport', 'Невідомий транспорт — передачу заборонено');
  switch (transport) {
    case 'lan':
      return allow;
    case 'base44':
      if (cls === 'D') return deny('class-d-cloud', 'Клас D не потрапляє в хмару Base44 (К8, К10)');
      if (endToEnd !== true) return deny('no-e2e', 'У Base44 таблиця йде лише з наскрізним шифруванням');
      return allow;
    case 'delta':
      return deny('delta-unverified', '«Дельту» ще не перевірено (G10); у v1 клас D працює лише по LAN');
    case 'peer_wan':
      return deny('peer-wan-forbidden', 'Передача через інший EasyWAR в інтернеті заборонена для всіх класів (етап C8)');
    default:
      return deny('unknown-transport', 'Невідомий транспорт — передачу заборонено');
  }
}

/**
 * Пояснення для людини, чому таблиця не йде в хмару (К10): перелік стовпців класу D і порада
 * винести особовий склад та планові дані в окрему таблицю. Порожній перелік — таблиця не D.
 */
export function explainMixedTable(columns, options) {
  const list = Array.isArray(columns) ? columns : [];
  const blocking = list
    .filter(column => effectiveColumnClass(column, options) === 'D')
    .map(column => ({
      key: column && typeof column.key === 'string' ? column.key : '',
      why: !column || !isSensitivityClass(column.sensitivity)
        ? 'клас не призначено'
        : column.sensitivity === 'D' ? 'клас D' : 'клас не підтверджено власником таблиці',
    }));
  const hasOthers = blocking.length < list.length;
  return Object.freeze({
    tableClass: tableClass(list, options),
    blocking: Object.freeze(blocking),
    advice: blocking.length && hasOthers
      ? 'Щоб облікові дані йшли в хмару, винесіть особовий склад і планові дані в окрему таблицю або підтвердіть класи стовпців'
      : '',
  });
}
