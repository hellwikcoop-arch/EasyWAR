// E8 / C1a: класи чутливості й дозвіл транспорту. Лише синтетичні дані.
import test from 'node:test';
import assert from 'node:assert/strict';

import { ROLES } from '../src/module-definition-core.js';
import {
  CLASSIFIED_ROLES, SENSITIVITY_CLASSES, TRANSPORTS, explainMixedTable, effectiveColumnClass,
  maxClass, routeFor, suggestColumnClass, tableClass,
} from '../src/sensitivity-core.js';

const OWNER = 'member-synthetic-owner';
const ADMIN = 'member-synthetic-admin';
const opts = { tableOwnerId: OWNER };
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

test('К7: клас діє лише після підтвердження власником таблиці', () => {
  assert.equal(effectiveColumnClass(col('a', 'A'), opts), 'A');
  assert.equal(effectiveColumnClass(col('a', 'A', ADMIN), opts), 'D', 'стовпець від адміністратора');
  assert.equal(effectiveColumnClass({ key: 'a', sensitivity: 'A' }, opts), 'D', 'без підтвердження');
  assert.equal(effectiveColumnClass(col('a', 'A'), {}), 'D', 'власник таблиці невідомий');
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

test('peer_wan заборонений для всіх класів; «Дельта» в v1 закрита', () => {
  for (const cls of SENSITIVITY_CLASSES) {
    assert.equal(routeFor(cls, 'peer_wan', { endToEnd: true }).code, 'peer-wan-forbidden', cls);
    assert.equal(routeFor(cls, 'delta', { endToEnd: true }).code, 'delta-unverified', cls);
  }
});

test('невідомий клас чи транспорт — відмова, а не дозвіл', () => {
  assert.equal(routeFor('E', 'lan').code, 'unknown-class');
  assert.equal(routeFor(undefined, 'lan').allowed, false);
  assert.equal(routeFor('A', 'ftp').code, 'unknown-transport');
  assert.equal(routeFor('A', 'toString').code, 'unknown-transport');
  for (const r of [routeFor('E', 'lan'), routeFor('A', 'ftp'), routeFor('D', 'base44')]) {
    assert.match(r.reason, /[а-яіїєґ]/iu, 'пояснення українською');
  }
});

test('пояснення змішаної таблиці називає стовпці, що блокують хмару', () => {
  const columns = [col('date', 'C'), col('crew', 'D'), { key: 'new', sensitivity: 'C', confirmedBy: ADMIN }];
  const e = explainMixedTable(columns, opts);
  assert.equal(e.tableClass, 'D');
  assert.deepEqual(e.blocking.map(b => b.key), ['crew', 'new']);
  assert.equal(e.blocking[1].why, 'клас не підтверджено власником таблиці');
  assert.notEqual(e.advice, '');
  assert.equal(explainMixedTable([col('date', 'C')], opts).blocking.length, 0);
  assert.equal(explainMixedTable([col('date', 'C')], opts).advice, '');
});
