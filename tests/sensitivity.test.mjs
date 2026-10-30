// E8 / C1a: класи чутливості й дозвіл транспорту. Лише синтетичні дані.
import test from 'node:test';
import assert from 'node:assert/strict';

import { ROLES } from '../src/module-definition-core.js';
import {
  CLASSIFIED_ROLES, confirmedTablePurpose, SENSITIVITY_CLASSES, TRANSPORTS, explainMixedTable, effectiveColumnClass,
  maxClass, routeFor, suggestColumnClass, tableClass,
} from '../src/sensitivity-core.js';

const OWNER = 'member-synthetic-owner';
const ADMIN = 'member-synthetic-admin';
const opts = { tableOwnerId: OWNER, tablePurpose: 'after-fact', purposeConfirmedBy: OWNER };
const planned = { tableOwnerId: OWNER, tablePurpose: 'planned', purposeConfirmedBy: OWNER };
const col = (key, sensitivity, confirmedBy = OWNER) => ({ key, sensitivity, confirmedBy });

test('класи й транспорти зафіксовано', () => {
  assert.deepEqual(SENSITIVITY_CLASSES, ['A', 'B', 'C', 'D']);
  assert.deepEqual(TRANSPORTS, ['lan', 'base44', 'delta', 'peer_wan']);
  assert.ok(Object.isFrozen(SENSITIVITY_CLASSES) && Object.isFrozen(TRANSPORTS));
});

test('кожна роль реєстру ROLES має пропозицію класу (нова роль без класу провалює тест)', () => {
  assert.deepEqual(CLASSIFIED_ROLES, Object.keys(ROLES).sort());
});

test('пропозиція класу: C лише для обліку після факту, інакше D; завжди не підтверджена', () => {
  assert.deepEqual(suggestColumnClass({ role: 'coordinates', tablePurpose: 'after-fact' }).class, 'C');
  assert.equal(suggestColumnClass({ role: 'target-id', tablePurpose: 'after-fact' }).class, 'C');
  assert.equal(suggestColumnClass({ role: 'target-id', tablePurpose: 'planned' }).class, 'D');
  assert.equal(suggestColumnClass({ role: 'coordinates' }).class, 'D');
  assert.equal(suggestColumnClass({ role: 'journal-column', tablePurpose: 'after-fact' }).class, 'D');
  assert.equal(suggestColumnClass({ role: 'невідома-роль', tablePurpose: 'after-fact' }).class, 'D');
  assert.equal(suggestColumnClass({ role: '__proto__', tablePurpose: 'after-fact' }).class, 'D');
  assert.equal(suggestColumnClass().class, 'D');
  for (const role of Object.keys(ROLES)) {
    const s = suggestColumnClass({ role, tablePurpose: 'after-fact' });
    assert.equal(s.confirmed, false, role);
    assert.ok(['C', 'D'].includes(s.class), role);
    assert.ok(typeof s.reason === 'string' && s.reason.length > 0, role);
  }
});

test('додаток А: клас C пропонується рівно для цих ролей, решта ROLES — D', () => {
  const c = Object.keys(ROLES).filter(role => suggestColumnClass({ role, tablePurpose: 'after-fact' }).class === 'C').sort();
  assert.deepEqual(c, ['abort-flag', 'coordinates', 'event-date', 'event-time', 'firing-unit', 'munition-count',
    'munition-type', 'platform-type', 'strike-result', 'target-id', 'unit']);
});

test('null і непридатні параметри не ламають ядро й не дають дозволу', () => {
  assert.equal(suggestColumnClass(null).class, 'D');
  assert.equal(suggestColumnClass('coordinates').class, 'D');
  assert.equal(effectiveColumnClass(col('a', 'A'), null), 'D');
  assert.equal(tableClass([col('a', 'A')], null), 'D');
  assert.equal(tableClass([], null), 'D');
  assert.equal(routeFor('A', 'base44', null).code, 'no-e2e');
  assert.equal(routeFor('A', 'base44', [true]).code, 'no-e2e');
  assert.equal(explainMixedTable(null, null).tableClass, 'D');
});

test('К7: підтвердження власника остаточне, навіть нижче за пропозицію', () => {
  const column = { key: 'k', role: 'journal-column', sensitivity: 'A', confirmedBy: OWNER };
  assert.equal(suggestColumnClass({ role: 'journal-column', tablePurpose: 'after-fact' }).class, 'D');
  assert.equal(tableClass([column], opts), 'A');
});

test('F-6: підтвердження класу не обходить правило планових даних — уся таблиця D', () => {
  const columns = [col('date', 'A'), col('target', 'B'), col('coords', 'C')];
  for (const column of columns) assert.equal(effectiveColumnClass(column, planned), 'D', column.key);
  assert.equal(tableClass(columns, planned), 'D');
  for (const transport of TRANSPORTS.filter(t => t !== 'lan')) {
    assert.equal(routeFor(tableClass(columns, planned), transport, { endToEnd: true }).allowed, false, transport);
  }
  const e = explainMixedTable(columns, planned);
  assert.deepEqual(e.blocking.map(b => b.why), Array(3).fill('таблиця планових або попередніх даних — клас D'));
});

test('F-6: призначення таблиці діє лише після підтвердження її власником', () => {
  const columns = [col('date', 'C')];
  const cases = [
    { tableOwnerId: OWNER },
    { tableOwnerId: OWNER, tablePurpose: 'after-fact' },
    { tableOwnerId: OWNER, tablePurpose: 'after-fact', purposeConfirmedBy: ADMIN },
    { tableOwnerId: OWNER, tablePurpose: 'щось', purposeConfirmedBy: OWNER },
    { tablePurpose: 'after-fact', purposeConfirmedBy: OWNER },
  ];
  for (const options of cases) {
    assert.equal(tableClass(columns, options), 'D', JSON.stringify(options));
  }
  assert.equal(confirmedTablePurpose(opts), 'after-fact');
  assert.equal(confirmedTablePurpose(planned), 'planned');
  assert.equal(confirmedTablePurpose(cases[2]), null);
  assert.equal(confirmedTablePurpose(null), null);
  assert.equal(explainMixedTable(columns, cases[1]).blocking[0].why, 'призначення таблиці не підтверджено власником');
});

test('К7: клас діє лише після підтвердження власником таблиці', () => {
  assert.equal(effectiveColumnClass(col('a', 'A'), opts), 'A');
  assert.equal(effectiveColumnClass(col('a', 'A', ADMIN), opts), 'D', 'стовпець від адміністратора');
  assert.equal(effectiveColumnClass({ key: 'a', sensitivity: 'A' }, opts), 'D', 'без підтвердження');
  assert.equal(effectiveColumnClass(col('a', 'A'), {}), 'D', 'власник таблиці невідомий');
  assert.equal(effectiveColumnClass(col('a', 'A'), { tableOwnerId: OWNER }), 'D', 'призначення не підтверджено');
  assert.equal(effectiveColumnClass(col('a', 'Z'), opts), 'D', 'невідомий клас');
  assert.equal(effectiveColumnClass(null, opts), 'D');
});

test('клас таблиці — найвищий; порожня й змішана — D (К10)', () => {
  assert.equal(tableClass([col('a', 'A'), col('b', 'C')], opts), 'C');
  assert.equal(tableClass([col('a', 'A'), col('b', 'B')], opts), 'B');
  assert.equal(tableClass([col('a', 'C'), col('p', 'D')], opts), 'D');
  assert.equal(tableClass([col('a', 'C'), { key: 'x' }], opts), 'D');
  assert.equal(tableClass([], opts), 'D');
  assert.equal(tableClass(undefined, opts), 'D');
  assert.equal(maxClass('A', 'щось'), 'D');
});

test('M04 / G09: D, змішана й непідтверджена таблиця не йдуть жодним не-LAN транспортом', () => {
  const tables = [
    [col('p', 'D')],
    [col('a', 'C'), col('p', 'D')],
    [col('a', 'C'), { key: 'new', sensitivity: 'C', confirmedBy: ADMIN }],
    [],
  ];
  for (const columns of tables) {
    const cls = tableClass(columns, opts);
    assert.equal(cls, 'D');
    for (const transport of TRANSPORTS.filter(t => t !== 'lan')) {
      assert.equal(routeFor(cls, transport, { endToEnd: true }).allowed, false, transport);
    }
    assert.equal(routeFor(cls, 'lan').allowed, true);
  }
});

test('Base44 лише для A–C і лише з наскрізним шифруванням (AC12)', () => {
  for (const cls of ['A', 'B', 'C']) {
    assert.equal(routeFor(cls, 'base44', { endToEnd: true }).allowed, true, cls);
    assert.equal(routeFor(cls, 'base44').allowed, false, cls);
    assert.equal(routeFor(cls, 'base44', { endToEnd: 'true' }).code, 'no-e2e', cls);
  }
  assert.equal(routeFor('D', 'base44', { endToEnd: true }).code, 'class-d-cloud');
});

test('WAN: клас не блокує синхронізацію між учасниками (SEC-005), «Дельта» закрита', () => {
  for (const cls of SENSITIVITY_CLASSES) {
    assert.equal(routeFor(cls, 'delta', { endToEnd: true }).code, 'delta-unverified', cls);
  }
  const allProofs = { endToEnd: true, membershipVerified: true,
    explicitUserChoice: true, relayOpaqueVerified: true, transportSecurityApproved: true };
  for (const cls of SENSITIVITY_CLASSES) {
    assert.equal(routeFor(cls, 'peer_wan', allProofs).allowed, true, cls);
  }
  // Хмара — окреме правило: клас D у Base44 не йде.
  assert.equal(routeFor('D', 'base44', { endToEnd: true }).code, 'class-d-cloud');
});

test('WAN: повний позитивний preflight лише за всіма незалежними підтвердженнями', () => {
  const proof = { endToEnd: true, membershipVerified: true,
    explicitUserChoice: true, relayOpaqueVerified: true, transportSecurityApproved: true };
  const prerequisites = [
    ['endToEnd', 'no-e2e'],
    ['membershipVerified', 'wan-membership-unverified'],
    ['explicitUserChoice', 'wan-needs-user-choice'],
    ['relayOpaqueVerified', 'wan-relay-unverified'],
    ['transportSecurityApproved', 'wan-not-ready'],
  ];
  for (const [field, code] of prerequisites) {
    const absent = { ...proof };
    delete absent[field];
    assert.equal(routeFor('C', 'peer_wan', absent).code, code, field);
    assert.equal(routeFor('C', 'peer_wan', { ...proof, [field]: 'true' }).code, code, field);
  }
  assert.equal(routeFor('C', 'peer_wan').code, 'no-e2e');
  assert.equal(routeFor('C', 'peer_wan', [true]).code, 'no-e2e');
  assert.equal(routeFor('C', 'peer_wan', proof).code, 'allowed');
});

test('невідомий клас чи транспорт — відмова, а не дозвіл', () => {
  assert.equal(routeFor('E', 'lan').code, 'unknown-class');
  assert.equal(routeFor(undefined, 'lan').allowed, false);
  assert.equal(routeFor('A', 'ftp').code, 'unknown-transport');
  assert.equal(routeFor('A', 'toString').code, 'unknown-transport');
  const all = [routeFor('E', 'lan'), routeFor('A', 'ftp'), routeFor('D', 'base44', { endToEnd: true }),
    routeFor('A', 'base44'), routeFor('A', 'delta'), routeFor('A', 'peer_wan'), routeFor('A', 'lan')];
  assert.deepEqual(all.map(r => r.code),
    ['unknown-class', 'unknown-transport', 'class-d-cloud', 'no-e2e', 'delta-unverified', 'no-e2e', 'allowed']);
  for (const r of all) assert.match(r.reason, /^[^a-z]*[А-ЯІЇЄҐ«]/u, `${r.code}: пояснення українською`);
});

test('пояснення змішаної таблиці називає стовпці, що блокують хмару', () => {
  const columns = [col('date', 'C'), col('crew', 'D'), { key: 'new', sensitivity: 'C', confirmedBy: ADMIN }, { key: 'raw' }];
  const e = explainMixedTable(columns, opts);
  assert.equal(e.tableClass, 'D');
  assert.deepEqual(e.blocking.map(b => [b.key, b.why]), [
    ['crew', 'клас D'], ['new', 'клас не підтверджено власником таблиці'], ['raw', 'клас не призначено'],
  ]);
  assert.notEqual(e.advice, '');
  assert.equal(explainMixedTable([col('date', 'C')], opts).blocking.length, 0);
  assert.equal(explainMixedTable([col('date', 'C')], opts).advice, '');
});
