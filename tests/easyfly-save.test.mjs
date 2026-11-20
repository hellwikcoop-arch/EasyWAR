import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createProfileSaveQueue } from '../src/workspace/easyfly/fly-save.js';
import { addFlight, addPerson, fingerprint, updatePerson } from '../src/workspace/easyfly/fly-state.js';
import { createEmpty, parse, serialize } from '../src/workspace/easyfly/fly-store.js';

test('autosave: a pending snapshot survives unmount clearing the current document', async () => {
  const writes = [];
  const save = createProfileSaveQueue({
    write: async text => { writes.push(text); },
    encode: serialize,
    fingerprint,
  });
  let doc = { stored: true, data: createEmpty(), savedFp: null };
  doc.data.unit.name = 'Синтетична частина';
  const original = doc;
  const pending = save(doc);
  doc = null; // Exactly what EasyFLY unmount does immediately after flush().
  assert.equal(await pending, true);
  assert.equal(doc, null);
  assert.equal(writes.length, 1);
  assert.equal(parse(writes[0]).data.unit.name, 'Синтетична частина');
  assert.equal(original.savedFp, fingerprint(original.data));
});

test('autosave: queued writes preserve snapshots in order when user edits again', async () => {
  const writes = [];
  const save = createProfileSaveQueue({
    write: async value => { writes.push(value); },
    encode: serialize,
    fingerprint,
  });
  const first = createEmpty();
  first.unit.name = 'Перший стан';
  const doc = { stored: true, data: first, savedFp: null };
  const earlier = save(doc);
  const second = structuredClone(first);
  second.unit.name = 'Другий стан';
  doc.data = second;
  const later = save(doc);
  assert.deepEqual(await Promise.all([earlier, later]), [true, true]);
  assert.deepEqual(writes.map(value => parse(value).data.unit.name), ['Перший стан', 'Другий стан']);
  assert.equal(doc.savedFp, fingerprint(second));
});

test('autosave: failed write remains dirty and does not poison the next attempt', async () => {
  let fail = true, recorded = null;
  const results = [];
  const save = createProfileSaveQueue({
    write: async value => {
      if (fail) throw new Error('Сховище недоступне');
      recorded = value;
    },
    encode: serialize,
    fingerprint,
    onResult: event => results.push(event),
  });
  const doc = { stored: true, data: createEmpty(), savedFp: null };
  assert.equal(await save(doc), false);
  assert.equal(doc.savedFp, null);
  assert.equal(results[0].ok, false);
  fail = false;
  assert.equal(await save(doc), true);
  assert.equal(results[1].ok, true);
  assert.equal(doc.savedFp, fingerprint(doc.data));
  assert.equal(parse(recorded).ok, true);
});

test('autosave: demo never writes to profile', async () => {
  let writes = 0;
  const save = createProfileSaveQueue({
    write: async () => { writes += 1; },
    encode: serialize,
    fingerprint,
  });
  assert.equal(await save({ stored: false, data: createEmpty(), savedFp: null }), true);
  assert.equal(writes, 0);
});

test('EasyFLY round-trip: create, rename and record flight, serialize, reopen and retain edits', async () => {
  const initial = createEmpty();
  const added = addPerson(initial, { callsign: 'Тест-01', role: 'КЕ' });
  assert.equal(added.ok, true);
  const renamed = updatePerson(added.data, added.id, { callsign: 'Тест-02', role: 'КЕ' });
  assert.equal(renamed.ok, true);
  const logged = addFlight(renamed.data, { personId: added.id, date: '2026-11-15', exercise: '14', count: 1, airtime: '0:35' });
  assert.equal(logged.ok, true);

  let stored = null;
  const save = createProfileSaveQueue({ write: async value => { stored = value; }, encode: serialize, fingerprint });
  const doc = { stored: true, data: logged.data, savedFp: null };
  assert.equal(await save(doc), true);
  const reopened = parse(stored);
  assert.equal(reopened.ok, true);
  assert.equal(reopened.data.persons[0].callsign, 'Тест-02');
  assert.equal(reopened.data.flights.length, 1);
  assert.equal(reopened.data.flights[0].airtimeMin, 35);
  assert.equal(reopened.data.flights[0].personId, added.id);
});

test('EasyFLY app wires its actual persistence path to the tested queue', async () => {
  const source = await readFile(new URL('../src/workspace/easyfly/app.js', import.meta.url), 'utf8');
  assert.match(source, /import \{ createProfileSaveQueue \} from '\.\/fly-save\.js'/);
  assert.match(source, /return enqueueSave\(doc\);/);
  assert.match(source, /const flush = \(\) => \{ if \(saveTimer\) persist\(\); \};/);
});
