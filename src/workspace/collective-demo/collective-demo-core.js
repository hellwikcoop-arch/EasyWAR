// «Колектив (демо)» — S1 Sync MVP: два ізольовані клієнти в пам'яті вікна на синтетичних даних.
//
// Логіку не дублюємо: операції, конфлікти й дублі — shared-table-core.js (C1b), перегляд і
// фіксація «Доповісти» — report-submission-core.js (C1d), політики відправки й застосування —
// sync-policy-core.js (C1d; маршрут за класом чутливості — sensitivity-core.js (C1a) через evaluateOutbound).
// Тут лише стан двох демонстраційних клієнтів і «доставка» між ними. «Доставка» — один спільний
// упорядкований журнал (як квитанції сховища): кожен клієнт застосовує операції саме в цьому порядку,
// і свої теж, тому версії рядків однакові в усіх копіях, а перехресні правки дають конфлікт.
//
// Чесні межі S1 (наказ JE 29.10.2026):
// - доставка — масив у пам'яті вікна, мережі немає; після закриття застосунку все зникає;
// - підпис — демонстраційна позначка, НЕ криптографія: перевірка лише відсіює операції від
//   незареєстрованих пристроїв. У S2 її замінить перевірка Ed25519 у Rust (C2), а доставку —
//   сховище й журнал операцій; користувацький сценарій від цього не зміниться;
// - жодних команд Tauri, профілів, бази й сховищ браузера.
import { applyOperation, applyOperations, emptyTableState, openConflicts, resolveConflict } from '../../shared-table-core.js';
import { commitReport, previewReport } from '../../report-submission-core.js';
import { DEFAULT_TABLE_POLICY, evaluateInbound, evaluateOutbound } from '../../sync-policy-core.js';

export const DEMO_NOTICE = 'Демонстрація — без мережі та збереження';
export const DEMO_SIGNATURE_NOTE = 'Підпис у демонстрації не криптографічний: справжній підпис і шифрування — етап S2';

export const COLUMNS = Object.freeze(['date', 'unit', 'item', 'amount']);
export const COLUMN_LABELS = Object.freeze({ date: 'Дата', unit: 'Підрозділ', item: 'Найменування', amount: 'Кількість' });

const COLLECTIVE_ID = 'demo-collective';
const TABLE_ID = 'demo-table';
const SCHEMA = Object.freeze({ collectiveId: COLLECTIVE_ID, tableId: TABLE_ID, schemaVersion: 1, columns: COLUMNS });
// Синтетична таблиця обліку після факту: клас C, у v1 дозволений транспорт — LAN (routeFor).
const TABLE_CLASS = 'C';
const TRANSPORT = 'lan';

const SEED_ROWS = Object.freeze([
  ['r1', { date: '2026-01-05', unit: 'Підрозділ-1', item: 'Позиція А', amount: 12 }],
  ['r2', { date: '2026-01-06', unit: 'Підрозділ-2', item: 'Позиція Б', amount: 7 }],
  ['r3', { date: '2026-01-07', unit: 'Підрозділ-1', item: 'Позиція В', amount: 20 }],
  ['r4', { date: '2026-01-08', unit: 'Підрозділ-3', item: 'Позиція А', amount: 5 }],
]);

export const CLIENTS = Object.freeze({
  A: Object.freeze({ id: 'A', title: 'Клієнт А', role: 'Власник колективу', memberId: 'member-demo-a', deviceId: 'device-demo-a' }),
  B: Object.freeze({ id: 'B', title: 'Клієнт Б', role: 'Учасник', memberId: 'member-demo-b', deviceId: 'device-demo-b' }),
});

const OWNER = CLIENTS.A.memberId;
const signatureOf = op => `demo:${op.device_id}:${op.op_id}`;

function clientState(seed) {
  return { table: seed, pending: [], resolutions: {}, revision: 0, cursor: 0, lastBatch: null, opCounter: 0, log: [], preview: null };
}

/** Однаковий стартовий стан обох клієнтів: власник колективу заповнює таблицю, обидва застосовують. */
export function createDemo() {
  const devices = new Set([CLIENTS.A.deviceId, CLIENTS.B.deviceId]);
  let seed = emptyTableState({ collectiveId: COLLECTIVE_ID, tableId: TABLE_ID, schemaVersion: SCHEMA.schemaVersion });
  const seedOps = SEED_ROWS.map(([rowKey, values], index) => {
    const op = {
      op_id: `seed-${index + 1}`, collective_id: COLLECTIVE_ID, table_id: TABLE_ID, schema_version: SCHEMA.schemaVersion,
      row_key: rowKey, kind: 'upsert', values: { ...values }, base_version: 0, author_member_id: OWNER,
      device_id: CLIENTS.A.deviceId, signature: '', client_time: null, key_epoch: 0,
    };
    op.signature = signatureOf(op);
    return op;
  });
  const demo = {
    schema: SCHEMA,
    policy: { ...DEFAULT_TABLE_POLICY },
    writers: [CLIENTS.A.memberId, CLIENTS.B.memberId],
    devices,
    channel: [],
    clients: {},
    clock: 0,
  };
  seed = applyOperations(seed, seedOps, applyOptions(demo)).state;
  demo.channel.push(...seedOps.map(op => ({ op, from: 'A' })));
  for (const id of Object.keys(CLIENTS)) {
    demo.clients[id] = clientState(seed);
    demo.clients[id].cursor = demo.channel.length;
  }
  return demo;
}

function applyOptions(demo) {
  return {
    schema: demo.schema,
    writers: [...demo.writers],
    verify: op => demo.devices.has(op.device_id) && op.signature === signatureOf(op),
  };
}

const tick = demo => `T+${String(++demo.clock).padStart(3, '0')}`;
function log(demo, client, status, text, opId) {
  client.log.unshift({ at: tick(demo), status, text, opId: opId || null });
  if (client.log.length > 40) client.log.length = 40;
}

/** Живі рядки таблиці клієнта: [{ rowKey, version, values, author }]. */
export function visibleRows(demo, clientId) {
  const { table } = demo.clients[clientId];
  return Object.keys(table.rows).sort().filter(key => !table.rows[key].deleted).map(key => ({
    rowKey: key, version: table.rows[key].version, values: table.rows[key].values, author: table.rows[key].lastAuthor,
  }));
}

/** Чернетка зміни рядка: одна операція на рядок, нова правка замінює попередню (контракт черги C1d). */
export function editRow(demo, clientId, rowKey, values) {
  const client = demo.clients[clientId];
  const current = client.table.rows[rowKey];
  if (!current || current.deleted) return { ok: false, reason: 'Рядка немає в таблиці' };
  const next = { ...current.values, ...values };
  if (typeof next.amount === 'string') {
    const number = Number(next.amount.replace(',', '.'));
    if (!Number.isFinite(number)) return { ok: false, reason: 'Кількість має бути числом' };
    next.amount = number;
  }
  const meta = CLIENTS[clientId];
  client.opCounter += 1;
  const op = {
    op_id: `op-${clientId.toLowerCase()}-${client.opCounter}`, collective_id: COLLECTIVE_ID, table_id: TABLE_ID,
    schema_version: SCHEMA.schemaVersion, row_key: rowKey, kind: 'upsert', values: next,
    base_version: current.version, author_member_id: meta.memberId, device_id: meta.deviceId,
    signature: '', client_time: null, key_epoch: 0,
  };
  op.signature = signatureOf(op);
  for (const old of client.pending) if (old.row_key === rowKey) delete client.resolutions[old.op_id];
  client.pending = client.pending.filter(item => item.row_key !== rowKey).concat(op);
  client.preview = null;
  return { ok: true, op };
}

/** Скасувати всі чернетки клієнта. */
export function discardPending(demo, clientId) {
  const client = demo.clients[clientId];
  client.pending = [];
  client.resolutions = {};
  client.preview = null;
}

/** Таблиця в тому вигляді, як її бачить клієнт разом із чернетками (для показу «стане»). */
export function draftValues(demo, clientId, rowKey) {
  const pending = demo.clients[clientId].pending.find(op => op.row_key === rowKey);
  return pending ? pending.values : null;
}

/** «Доповісти»: перевірка політики відправки й перегляд «було → стане». */
export function openReport(demo, clientId) {
  const client = demo.clients[clientId];
  const meta = CLIENTS[clientId];
  const outbound = evaluateOutbound({
    policy: demo.policy.outbound, tableClass: TABLE_CLASS, transport: TRANSPORT, endToEnd: false,
    authorId: meta.memberId, writers: demo.writers, reviewedByHuman: true,
  });
  if (!outbound.allowed) return { ok: false, code: outbound.code, reason: outbound.reason };
  if (client.pending.length === 0) return { ok: false, code: 'nothing-to-report', reason: 'Змін для відправки немає' };
  const currentRows = {};
  for (const [key, row] of Object.entries(client.table.rows)) currentRows[key] = row.deleted ? null : row.values;
  client.preview = previewReport({ pendingOps: client.pending, currentRows, schema: demo.schema, revision: client.revision });
  return { ok: true, preview: client.preview };
}

/**
 * «Підтвердити» після перегляду: фіксація рівно показаних операцій і «доставка» в спільний журнал.
 * Свої операції застосовуються в порядку журналу разом із чужими, що прийшли раніше (як після
 * квитанції сховища): якщо інший учасник устиг змінити той самий рядок, обидві копії побачать
 * однаковий конфлікт, а не мовчазний перезапис.
 */
export function confirmReport(demo, clientId) {
  const client = demo.clients[clientId];
  const committed = commitReport(client.preview, { currentRevision: client.revision, confirmedDeletions: [] });
  if (!committed.ok) return committed;
  const before = demo.channel.length;
  for (const op of committed.ops) demo.channel.push({ op, from: clientId });
  for (const op of committed.ops) log(demo, client, 'stored', `Відправлено (рядок ${op.row_key})`, op.op_id);
  const foreign = demo.channel.slice(client.cursor, before);
  const crossed = foreign.length;
  if (crossed) client.lastBatch = foreign;
  const summary = applyEntries(demo, clientId, demo.channel.slice(client.cursor));
  client.cursor = demo.channel.length;
  client.pending = [];
  client.preview = null;
  client.resolutions = {};
  const notes = [];
  if (crossed) notes.push(`Перед вашими змінами вже були нові зміни інших учасників (${crossed}) — їх застосовано першими`);
  if (summary.conflicts) notes.push('Є конфлікт: дві зміни одного рядка перетнулися — рішення нижче');
  return { ok: true, count: committed.ops.length, reason: committed.reason, notes, summary };
}

/** «Звірити»: отримати нові операції журналу й застосувати перевірене в тому самому порядку. */
export function synchronize(demo, clientId) {
  const client = demo.clients[clientId];
  const batch = demo.channel.slice(client.cursor);
  client.cursor = demo.channel.length;
  if (batch.length) client.lastBatch = batch;
  const summary = applyEntries(demo, clientId, batch);
  if (batch.length === 0) log(demo, client, 'idle', 'Нових змін немає');
  return summary;
}

/** Повторна доставка останнього отриманого пакета — перевірка, що дубль не застосовується двічі. */
export function redeliver(demo, clientId) {
  const client = demo.clients[clientId];
  if (!client.lastBatch) return { applied: 0, skipped: 0, conflicts: 0, rejected: 0, received: 0 };
  return applyEntries(demo, clientId, client.lastBatch);
}

function applyEntries(demo, clientId, entries) {
  const client = demo.clients[clientId];
  const summary = { received: entries.length, applied: 0, skipped: 0, conflicts: 0, rejected: 0 };
  for (const { op, from } of entries) {
    const own = from === clientId;
    const conflictId = own ? client.resolutions[op.op_id] : undefined;
    const result = conflictId && client.table.conflicts.some(c => c.conflictId === conflictId && c.resolvedBy === null)
      ? resolveConflict(client.table, conflictId, op, applyOptions(demo))
      : applyOperation(client.table, op, applyOptions(demo));
    const inbound = evaluateInbound({ policy: demo.policy.inbound, applyStatus: result.status, kind: op.kind });
    const who = op.author_member_id === CLIENTS.A.memberId ? 'А' : 'Б';
    const subject = own ? 'вашу зміну' : `зміну від ${who}`;
    if (inbound.action === 'apply') {
      summary.applied += 1;
      log(demo, client, 'applied', `Застосовано ${subject} (рядок ${op.row_key})`, op.op_id);
    } else if (inbound.action === 'skip') {
      summary.skipped += 1;
      log(demo, client, 'duplicate', `Повтор пропущено (рядок ${op.row_key})`, op.op_id);
    } else if (inbound.action === 'conflict') {
      summary.conflicts += 1;
      log(demo, client, 'conflict', `Конфлікт у рядку ${op.row_key}: ${subject} перетнулася з іншою — потрібне рішення`, op.op_id);
    } else {
      summary.rejected += 1;
      // S1 не зберігає відхилене: S2 має класти такі операції в карантин, а не губити їх.
      log(demo, client, 'rejected', `Відхилено ${subject}: ${reasonText(result.reason)}`, op.op_id);
    }
    // Стан змінюється лише тим, що повернуло ядро; конфлікт теж змінює стан (журнал конфліктів),
    // тож ревізія росте й старий перегляд «Доповісти» більше не підтвердити.
    if (result.status === 'applied' || result.status === 'conflict') {
      client.table = result.state;
      client.revision += 1;
    }
  }
  return summary;
}

// Відоме обмеження S1 (C3, N1): клієнт, що розв'язав конфлікт, закриває його через resolveConflict, а
// інша копія отримує те саме рішення як звичайну операцію — рядки сходяться, але її конфлікт лишається
// відкритим. Посилання на розв'язаний конфлікт у самій операції потребує зміни формату операції
// (OPERATION_FIELDS, C1b) — це рішення для S2, не для демонстрації.
/** Нерозв'язані конфлікти клієнта з «моїм» і «їхнім» варіантами рядка. */
export function conflictsOf(demo, clientId) {
  const client = demo.clients[clientId];
  return openConflicts(client.table).map(conflict => {
    const row = client.table.rows[conflict.rowKey];
    const author = conflict.op.author_member_id === CLIENTS[clientId].memberId ? 'ваша' : (conflict.op.author_member_id === CLIENTS.A.memberId ? 'від А' : 'від Б');
    return { conflictId: conflict.conflictId, rowKey: conflict.rowKey, mine: row ? row.values : null, theirs: conflict.op.values, author, reason: conflict.reason };
  });
}

/**
 * Розв'язання конфлікту рішенням людини: «keep-mine» — залишити поточне значення, «take-theirs» —
 * застосувати зміну, що не пройшла. Розв'язання — нова чернетка від поточної версії рядка; вона піде іншим
 * через «Доповісти», як будь-яка правка (К6).
 */
export function resolve(demo, clientId, conflictId, choice) {
  const client = demo.clients[clientId];
  const conflict = conflictsOf(demo, clientId).find(item => item.conflictId === conflictId);
  if (!conflict) return { ok: false, reason: 'Конфлікт уже розв\'язано' };
  if (!canWrite(demo, clientId)) return { ok: false, reason: 'Розв\'язати конфлікт може лише учасник із правом запису' };
  const values = choice === 'take-theirs' ? conflict.theirs : conflict.mine;
  const draft = editRow(demo, clientId, conflict.rowKey, values);
  if (!draft.ok) return draft;
  client.resolutions[draft.op.op_id] = conflictId;
  log(demo, client, 'resolved', `Рішення щодо рядка ${conflict.rowKey}: ${choice === 'take-theirs' ? 'застосувати зміну' : 'залишити поточне'} — у чернетці`, draft.op.op_id);
  return { ok: true, reason: 'Рішення стоїть у чернетці: натисніть «Доповісти», щоб застосувати його й передати іншим' };
}

/** Право запису учасника Б (демонстрація відмови й відкликання). */
export function setWriteRight(demo, clientId, allowed) {
  const memberId = CLIENTS[clientId].memberId;
  if (memberId === OWNER) return { ok: false, reason: 'Власник колективу завжди має право запису в демонстрації' };
  demo.writers = allowed ? [...new Set([...demo.writers, memberId])] : demo.writers.filter(id => id !== memberId);
  return { ok: true };
}

export function canWrite(demo, clientId) {
  return demo.writers.includes(CLIENTS[clientId].memberId);
}

/** Дані демонстраційного дашборда: сума «Кількості» за підрозділами в таблиці клієнта. */
export function dashboardSeries(demo, clientId) {
  const totals = new Map();
  for (const row of visibleRows(demo, clientId)) {
    const amount = Number(row.values.amount) || 0;
    totals.set(row.values.unit, (totals.get(row.values.unit) || 0) + amount);
  }
  return [...totals.entries()].sort((a, b) => a[0].localeCompare(b[0], 'uk')).map(([label, value]) => ({ label, value }));
}

const REASONS = Object.freeze({
  'no-write-right': 'немає права запису в цю таблицю',
  'bad-signature': 'підпис не перевірено',
  'stale-base-version': 'рядок уже змінено іншим учасником',
  'same-op-id-different-bytes': 'та сама операція з іншим вмістом',
  'wrong-table': 'операція для іншої таблиці',
  'invalid-operation': 'хибна операція',
});

export function reasonText(code) {
  return REASONS[code] || code;
}
