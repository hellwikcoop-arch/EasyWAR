// Екземпляри модулів і їх розміщення — етап E4 дорожньої карти (docs/MODULES_ROADMAP.md, розділ 4
// «ModuleInstance» і «DashboardPlacement», контрольна точка в розділі 5), перший блок.
//
// Чисте ядро без DOM, сховищ, годинника й мережі. Описує розкладку «Мій дашборд» профілю:
//   - `ModuleInstance` — одна картка: визначення з реєстру (E1), джерело зі схеми профілю (E3), власні
//     назва, період і стиль. Один модуль на одному джерелі можна поставити до чотирьох разів
//     (`MAX_COPIES`); різні джерела одного шаблону лічаться окремо;
//   - `DashboardPlacement` — де картка стоїть на сітці й якого вона розміру.
//
// Правила (рішення власника):
//   - екземпляр не має власної копії рядків: він лише посилається на джерело, тож усі картки одного
//     джерела бачать одну підтверджену версію (`instanceState`, `sourceConsistency`);
//   - кожна копія має незалежні період, стиль і позицію; період буває спільним (панель «А»), власним
//     («Свій період», «Б») або вимкненим («Увесь час»);
//   - даних звіту розкладка не містить; зберігання (наступний блок E4) додасть лише серіалізацію тут;
//   - годинника ядро не має: «останні N днів» розгортаються від дати, яку передає виклик.
//
// Усі функції повертають нові заморожені значення й не змінюють вхідні; помилка — `{ ok: false, code }`.

import { availability, resolveRoles } from './profile-schema-core.js';

export const LAYOUT_FORMAT = 'easywar.dashboard-layout';
export const LAYOUT_VERSION = 1;

/** Скільки разів один модуль на одному джерелі можна поставити на дашборд (рішення власника, розділ 2). */
export const MAX_COPIES = 4;

export const LIMITS = Object.freeze({
  maxInstances: 120,
  textLength: 120,
  gridColumns: 12,
  maxRows: 200,
  maxDays: 3660,
});

/** Режими періоду. `shared` — іде за спільною панеллю (А), решта — власні (Б). */
export const PERIOD_MODES = Object.freeze(['shared', 'all', 'last-days', 'range']);

const DATE = /^\d{4}-\d{2}-\d{2}$/u;

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

const fresh = value => structuredClone(value);
const text = (value, max = LIMITS.textLength) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const fail = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });
const done = (layout, extra = {}) => ({ ok: true, layout: deepFreeze(layout), ...extra });
const bump = layout => { layout.revision += 1; return layout; };
const findInstance = (layout, id) => layout.instances.find(instance => instance.id === id);

function validDate(value) {
  if (typeof value !== 'string' || !DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Нормалізує період або повертає null, якщо він некоректний. */
export function normalizePeriod(period) {
  const mode = period?.mode ?? 'shared';
  if (!PERIOD_MODES.includes(mode)) return null;
  if (mode === 'last-days') {
    const days = period.days;
    return Number.isInteger(days) && days >= 1 && days <= LIMITS.maxDays ? { mode, days } : null;
  }
  if (mode === 'range') {
    if (!validDate(period.from) || !validDate(period.to) || period.from > period.to) return null;
    return { mode, from: period.from, to: period.to };
  }
  return { mode };
}

function normalizeStyle(style) {
  return { accent: text(style?.accent, 40), background: text(style?.background, 40), view: text(style?.view, 40) };
}

/** Порожня розкладка профілю. `dashboardId` — поки лише «my» («Мій дашборд»). */
export function emptyLayout(profileId, dashboardId = 'my') {
  const profile = text(profileId);
  if (!profile) throw new TypeError('emptyLayout: потрібен ідентифікатор профілю');
  return deepFreeze({
    format: LAYOUT_FORMAT,
    version: LAYOUT_VERSION,
    profileId: profile,
    dashboardId: text(dashboardId, 40) || 'my',
    revision: 0,
    sharedPeriod: { mode: 'all' },
    instances: [],
    placements: [],
  });
}

/** Скільки копій цього визначення на цьому джерелі вже стоїть. Без `sourceId` — на всіх джерелах. */
export function copiesOf(layout, definitionId, sourceId) {
  return layout.instances.filter(instance => instance.definitionId === definitionId && (sourceId === undefined || instance.sourceId === sourceId)).length;
}

/** Найменший вільний id вигляду `<definitionId>#n`. */
export function nextInstanceId(layout, definitionId) {
  const used = new Set(layout.instances.map(instance => instance.id));
  for (let n = 1; ; n += 1) {
    const id = `${definitionId}#${n}`;
    if (!used.has(id)) return id;
  }
}

function normalizePlacement(placement) {
  const { x, y, w, h } = placement || {};
  const ints = [x, y, w, h].every(Number.isInteger);
  if (!ints || x < 0 || y < 0 || w < 1 || h < 1) return null;
  if (x + w > LIMITS.gridColumns || y + h > LIMITS.maxRows) return null;
  return { x, y, w, h };
}

/** Перший вільний ряд під усіма картками: нова картка не накриває наявних. */
function firstFreeRow(layout) {
  return layout.placements.reduce((row, placement) => Math.max(row, placement.y + placement.h), 0);
}

/**
 * Додає екземпляр і його розміщення. `spec`: { definitionId, sourceId, id?, title?, period?, style?, size?: { w, h } }.
 * Не більш як `MAX_COPIES` копій одного визначення.
 */
export function addInstance(layout, spec) {
  const definitionId = text(spec?.definitionId, 80);
  const sourceId = text(spec?.sourceId, 80);
  if (!definitionId) return fail('bad_definition', 'У картки немає визначення модуля.');
  if (!sourceId) return fail('bad_source', 'У картки немає джерела даних.');
  if (copiesOf(layout, definitionId, sourceId) >= MAX_COPIES) return fail('too_many_copies', `Один модуль на одній таблиці можна поставити не більш як ${MAX_COPIES} рази.`);
  if (layout.instances.length >= LIMITS.maxInstances) return fail('too_many_instances', 'Забагато карток на дашборді.');
  const id = text(spec.id, 100) || nextInstanceId(layout, definitionId);
  if (findInstance(layout, id)) return fail('duplicate_instance', `Картка «${id}» уже є.`);
  const period = normalizePeriod(spec.period);
  if (!period) return fail('bad_period', 'Період некоректний.');
  // Розмір перевіряємо вже в тому місці, куди картка стане: під усіма наявними, а не на нульовому ряду.
  const size = normalizePlacement({ x: 0, y: firstFreeRow(layout), w: spec.size?.w ?? 4, h: spec.size?.h ?? 3 });
  if (!size) return fail('bad_size', 'Розмір картки некоректний або вона не вміщується на сітці.');
  const next = fresh(layout);
  next.instances.push({ id, definitionId, sourceId, title: text(spec.title), period, style: normalizeStyle(spec.style) });
  next.placements.push({ instanceId: id, x: 0, y: size.y, w: size.w, h: size.h });
  return done(bump(next), { instanceId: id });
}

/** Копія екземпляра з тим самим джерелом, періодом і стилем; нова картка стає під усіма. */
export function duplicateInstance(layout, instanceId) {
  const source = findInstance(layout, instanceId);
  if (!source) return fail('unknown_instance', `Картки «${instanceId}» немає.`);
  const placement = layout.placements.find(item => item.instanceId === instanceId);
  return addInstance(layout, {
    definitionId: source.definitionId,
    sourceId: source.sourceId,
    title: source.title,
    period: source.period,
    style: source.style,
    size: placement ? { w: placement.w, h: placement.h } : undefined,
  });
}

export function removeInstance(layout, instanceId) {
  if (!findInstance(layout, instanceId)) return fail('unknown_instance', `Картки «${instanceId}» немає.`);
  const next = fresh(layout);
  next.instances = next.instances.filter(instance => instance.id !== instanceId);
  next.placements = next.placements.filter(placement => placement.instanceId !== instanceId);
  return done(bump(next));
}

/** Змінює назву, період або стиль однієї картки; решта карток лишається як була. */
export function updateInstance(layout, instanceId, change) {
  if (!findInstance(layout, instanceId)) return fail('unknown_instance', `Картки «${instanceId}» немає.`);
  const next = fresh(layout);
  const target = findInstance(next, instanceId);
  if (change?.title !== undefined) target.title = text(change.title);
  if (change?.period !== undefined) {
    const period = normalizePeriod(change.period);
    if (!period) return fail('bad_period', 'Період некоректний.');
    target.period = period;
  }
  if (change?.style !== undefined) target.style = normalizeStyle({ ...target.style, ...change.style });
  return done(bump(next));
}

/** Нове джерело для картки (наприклад, після зміни таблиці користувачем). */
export function rebindInstance(layout, instanceId, sourceId) {
  const id = text(sourceId, 80);
  if (!findInstance(layout, instanceId)) return fail('unknown_instance', `Картки «${instanceId}» немає.`);
  if (!id) return fail('bad_source', 'У картки немає джерела даних.');
  const next = fresh(layout);
  findInstance(next, instanceId).sourceId = id;
  return done(bump(next));
}

/** Переміщує й змінює розмір картки. Накладання карток не забороняємо: компонування — справа екрана. */
export function placeInstance(layout, instanceId, box) {
  if (!findInstance(layout, instanceId)) return fail('unknown_instance', `Картки «${instanceId}» немає.`);
  const placement = normalizePlacement(box);
  if (!placement) return fail('bad_placement', 'Позиція чи розмір картки некоректні.');
  const next = fresh(layout);
  Object.assign(next.placements.find(item => item.instanceId === instanceId), placement);
  return done(bump(next));
}

/** Ширина картки на сітці з 12 колонок: готові розміри для вибору (повна ширина — 12). */
export const SIZE_CHOICES = Object.freeze([
  Object.freeze({ id: 'small', w: 2, label: 'Мала' }),
  Object.freeze({ id: 'third', w: 4, label: 'Третина' }),
  Object.freeze({ id: 'half', w: 6, label: 'Половина' }),
  Object.freeze({ id: 'two-thirds', w: 8, label: 'Дві третини' }),
  Object.freeze({ id: 'full', w: 12, label: 'Вся ширина' }),
]);

/** Ідентифікатори карток у порядку показу: рядок, потім колонка. */
export function orderedIds(layout) {
  const place = new Map(layout.placements.map(item => [item.instanceId, item]));
  return layout.instances
    .map((instance, index) => ({ id: instance.id, index, at: place.get(instance.id) || { x: 0, y: 0 } }))
    .sort((a, b) => a.at.y - b.at.y || a.at.x - b.at.x || a.index - b.index)
    .map(item => item.id);
}

// Розкладає картки в заданому порядку рядками зліва направо: ширина збережена, висота рядка — найбільша в ньому.
function pack(layout, ids) {
  const place = new Map(layout.placements.map(item => [item.instanceId, item]));
  const out = [];
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  for (const id of ids) {
    const box = place.get(id) || { w: 4, h: 3 };
    if (x + box.w > LIMITS.gridColumns) { y += rowHeight; x = 0; rowHeight = 0; }
    out.push({ instanceId: id, x, y, w: box.w, h: box.h });
    x += box.w;
    rowHeight = Math.max(rowHeight, box.h);
  }
  return out;
}

const packed = (layout, ids) => {
  const placements = pack(layout, ids);
  // Низ кожної картки, а не лише останньої: у рядку вищою може бути не вона.
  return placements.some(item => item.y + item.h > LIMITS.maxRows) ? null : placements;
};

/**
 * Ставить картку на місце іншої (як переставлення елемента масиву: вперед — після неї, назад — перед нею);
 * решту зсуває, а всі картки перекладає рядками. Перетягування й кнопки «раніше/пізніше» ходять сюди.
 */
export function moveInstance(layout, instanceId, targetId) {
  if (!findInstance(layout, instanceId)) return fail('unknown_instance', `Картки «${instanceId}» немає.`);
  if (!findInstance(layout, targetId)) return fail('unknown_instance', `Картки «${targetId}» немає.`);
  const ids = orderedIds(layout);
  const from = ids.indexOf(instanceId);
  const to = ids.indexOf(targetId);
  if (from === to) return done(fresh(layout));
  ids.splice(to, 0, ids.splice(from, 1)[0]);
  const placements = packed(layout, ids);
  if (!placements) return fail('bad_placement', 'Картки не вміщуються на сітці.');
  const next = fresh(layout);
  next.placements = placements;
  return done(bump(next));
}

/** Змінює ширину картки (1–12 колонок) і перекладає картки рядками, зберігаючи порядок. */
export function resizeInstance(layout, instanceId, width) {
  if (!findInstance(layout, instanceId)) return fail('unknown_instance', `Картки «${instanceId}» немає.`);
  if (!Number.isInteger(width) || width < 1 || width > LIMITS.gridColumns) return fail('bad_size', 'Розмір картки некоректний.');
  const next = fresh(layout);
  const target = next.placements.find(item => item.instanceId === instanceId);
  if (!target) return fail('bad_placement', 'У картки немає позиції.');
  if (target.w === width) return done(next);
  target.w = width;
  const placements = packed(next, orderedIds(layout));
  if (!placements) return fail('bad_placement', 'Картки не вміщуються на сітці.');
  next.placements = placements;
  return done(bump(next));
}

/** Спільна панель періоду («А»): діє на всі картки з режимом `shared`. */
export function setSharedPeriod(layout, period) {
  const normalized = normalizePeriod(period);
  if (!normalized || normalized.mode === 'shared') return fail('bad_period', 'Спільний період некоректний.');
  const next = fresh(layout);
  next.sharedPeriod = normalized;
  return done(bump(next));
}

/** Додає `days` днів до дати `YYYY-MM-DD` (від'ємне — віднімає). */
function shiftDate(date, days) {
  const moment = new Date(`${date}T00:00:00Z`);
  moment.setUTCDate(moment.getUTCDate() + days);
  return moment.toISOString().slice(0, 10);
}

/**
 * Діючий період картки як { from, to } (межі включно; `null` — без обмеження). `today` — рядок
 * `YYYY-MM-DD`, який передає виклик: ядро годинника не має.
 */
export function effectivePeriod(layout, instanceId, today) {
  const instance = findInstance(layout, instanceId);
  if (!instance) return fail('unknown_instance', `Картки «${instanceId}» немає.`);
  const period = instance.period.mode === 'shared' ? layout.sharedPeriod : instance.period;
  if (period.mode === 'all') return { ok: true, from: null, to: null, own: instance.period.mode !== 'shared' };
  if (period.mode === 'range') return { ok: true, from: period.from, to: period.to, own: instance.period.mode !== 'shared' };
  if (!validDate(today)) return fail('bad_today', 'Для «останніх N днів» потрібна поточна дата.');
  return { ok: true, from: shiftDate(today, 1 - period.days), to: today, own: instance.period.mode !== 'shared' };
}

/**
 * Стан картки за схемою профілю: джерело, його підтверджена версія, ролі та чи вистачає ролей
 * визначенню. `definitions` — реєстр E1 (`requirements`); без визначення стан `unknown-definition`.
 */
export function instanceState(layout, schema, instanceId, definitions = []) {
  const instance = findInstance(layout, instanceId);
  if (!instance) return fail('unknown_instance', `Картки «${instanceId}» немає.`);
  const source = schema.sources.find(item => item.id === instance.sourceId);
  if (!source) return { ok: true, instanceId, sourceId: instance.sourceId, status: 'source-missing', sourceVersion: null, roles: {}, missing: [] };
  const definition = definitions.find(item => item.definitionId === instance.definitionId);
  const roles = resolveRoles(schema, source.id);
  const base = { ok: true, instanceId, sourceId: source.id, sourceVersion: source.version, schemaRevision: schema.revision, roles };
  if (!definition) return { ...base, status: 'unknown-definition', missing: [] };
  const verdict = availability([definition], schema, source.id).definitions[0];
  return { ...base, status: verdict.status, missing: verdict.adds };
}

/**
 * Усі картки одного джерела мають бачити одну версію й одні ролі. Повертає по кожному джерелу
 * `{ sourceId, version, instances, consistent }`; `consistent: false` означає помилку в застосунку,
 * а не вибір користувача.
 */
export function sourceConsistency(layout, schema, definitions = []) {
  const groups = new Map();
  for (const instance of layout.instances) {
    const state = instanceState(layout, schema, instance.id, definitions);
    if (!groups.has(instance.sourceId)) groups.set(instance.sourceId, []);
    groups.get(instance.sourceId).push(state);
  }
  return [...groups].map(([sourceId, states]) => {
    const marks = new Set(states.map(state => `${state.sourceVersion}|${JSON.stringify(state.roles)}`));
    return { sourceId, version: states[0].sourceVersion, instances: states.map(state => state.instanceId), consistent: marks.size === 1 };
  });
}

export function serializeLayout(layout) {
  return JSON.stringify(layout);
}

/** Читає й перевіряє розкладку (текст чи об'єкт); розкладку новішої версії не читає. */
export function parseLayout(input) {
  let value = input;
  if (typeof input === 'string') {
    try { value = JSON.parse(input.replace(/^﻿/u, '')); } catch { return { ok: false, errors: [{ code: 'bad_json', message: 'Розкладка не є правильним JSON.' }], layout: null }; }
  }
  const errors = [];
  const err = (code, message) => errors.push({ code, message });
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, errors: [{ code: 'bad_shape', message: 'Розкладка має бути об’єктом.' }], layout: null };
  if (value.format !== LAYOUT_FORMAT) err('bad_format', `Очікується format «${LAYOUT_FORMAT}».`);
  if (!Number.isInteger(value.version) || value.version < 1) err('bad_version', 'Версія — додатне ціле число.');
  else if (value.version > LAYOUT_VERSION) err('unsupported_version', 'Розкладку створено новішою версією застосунку.');
  if (!text(value.profileId)) err('bad_profile', 'У розкладки немає ідентифікатора профілю.');
  if (!Number.isInteger(value.revision) || value.revision < 0) err('bad_revision', 'Ревізія — невід’ємне ціле число.');
  if (!Array.isArray(value.instances) || !Array.isArray(value.placements)) {
    err('bad_shape', 'Поля instances і placements мають бути масивами.');
    return { ok: false, errors, layout: null };
  }
  if (value.instances.length > LIMITS.maxInstances) err('too_many_instances', 'Забагато карток.');
  const shared = normalizePeriod(value.sharedPeriod);
  if (!shared || shared.mode === 'shared') err('bad_period', 'Спільний період некоректний.');
  if (errors.length) return { ok: false, errors, layout: null };

  const ids = new Set();
  const copies = new Map();
  for (const instance of value.instances) {
    const id = text(instance?.id, 100);
    if (!id) { err('bad_instance', 'У картки немає ідентифікатора.'); continue; }
    if (ids.has(id)) err('duplicate_instance', `Картку «${id}» повторено.`);
    ids.add(id);
    if (!text(instance.definitionId, 80) || !text(instance.sourceId, 80)) err('bad_instance', `У картки «${id}» немає визначення чи джерела.`);
    if (!normalizePeriod(instance.period)) err('bad_period', `Період картки «${id}» некоректний.`);
    const pair = `${instance.definitionId}\u0000${instance.sourceId}`;
    copies.set(pair, (copies.get(pair) || 0) + 1);
  }
  for (const [pair, count] of copies) if (count > MAX_COPIES) err('too_many_copies', `Модуль «${pair.split('\u0000')[0]}» стоїть ${count} разів на одній таблиці, ліміт ${MAX_COPIES}.`);
  const placed = new Set();
  for (const placement of value.placements) {
    if (!ids.has(placement?.instanceId)) err('unknown_instance', `Розміщення посилається на невідому картку «${placement?.instanceId}».`);
    else if (placed.has(placement.instanceId)) err('duplicate_placement', `Картку «${placement.instanceId}» розміщено двічі.`);
    placed.add(placement?.instanceId);
    if (!normalizePlacement(placement)) err('bad_placement', `Розміщення картки «${placement?.instanceId}» некоректне.`);
  }
  for (const id of ids) if (!placed.has(id)) err('missing_placement', `Картка «${id}» без розміщення.`);
  if (errors.length) return { ok: false, errors, layout: null };
  return { ok: true, errors: [], layout: deepFreeze(fresh(value)) };
}
