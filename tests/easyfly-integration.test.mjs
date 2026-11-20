// Cross-PR regression: editing imported flights, autosave and the encrypted phone host.
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createVault, VAULT_KEY } from '../src/mobile/easyfly/vault-core.js';
import { createPhoneHost } from '../src/mobile/easyfly/phone-host-core.js';
import { createProfileSaveQueue } from '../src/workspace/easyfly/fly-save.js';
import { addPerson, addFlight, updateFlight, fingerprint, shiftReport } from '../src/workspace/easyfly/fly-state.js';
import { createEmpty, parse, serialize } from '../src/workspace/easyfly/fly-store.js';

const phrase = 'синтетична фраза 2026';
const key = 'easyfly.main';

function editedDocument() {
  const pilot = addPerson(createEmpty(), { callsign: 'Тест-01', role: 'КЕ' });
  const added = addFlight(pilot.data, {
    personId: pilot.id, date: '2026-10-31', exercise: 'БП', count: 2, airtime: '1:25', source: 'import',
  });
  assert.equal(added.ok, true);
  const flight = added.data.flights[0];
  flight.provenance = { file: 'synthetic.csv', row: 2 };
  flight.meteo = { cloudBase: 800 };
  const result = updateFlight(added.data, added.id, { date: '2026-11-01', airtime: '0:35', exercise: 'СБП' });
  assert.equal(result.ok, true);
  return { stored: true, savedFp: null, data: result.data };
}

test('integrated edit → queued autosave → encrypted lock/reopen → export retains the same flight', async () => {
  const values = new Map();
  let release;
  let delay = false;
  const storage = {
    getItem: async name => values.get(name) ?? null,
    removeItem: async name => values.delete(name),
    setItem: async (name, value) => {
      if (delay) await new Promise(resolve => { release = resolve; });
      values.set(name, value);
    },
  };
  const vault = createVault({ storage, crypto: webcrypto, iterations: 100_000 });
  await vault.create(phrase);
  const host = createPhoneHost({ vault, pickFile: async () => null });
  const save = createProfileSaveQueue({ write: value => host.profile.write(key, value), encode: serialize, fingerprint });
  let doc = editedDocument();
  const expected = JSON.parse(JSON.stringify(doc.data.flights[0]));
  delay = true;
  const pending = save(doc);
  doc = null; // The captured snapshot survives unmount.
  while (!release) await new Promise(resolve => setImmediate(resolve));
  assert.equal(vault.unlocked, true, 'the encryption key is retained while storage is writing');
  release();
  assert.equal(await pending, true);
  vault.lock();
  assert.ok(!values.get(VAULT_KEY).includes('Тест-01'));
  await vault.unlock(phrase);
  const reopened = parse((await vault.read(key)).value);
  assert.equal(reopened.ok, true);
  assert.equal(reopened.data.flights.length, 1);
  assert.deepEqual(reopened.data.flights[0], expected);
  assert.equal(shiftReport(reopened.data, '2026-10-31', '2026-11-02').summary.takeoffs, 0);
  assert.equal(shiftReport(reopened.data, '2026-11-01', '2026-11-02').summary.takeoffs, 2);
  const exported = parse(serialize(reopened.data));
  assert.deepEqual(exported.data.flights, reopened.data.flights);
});

test('integrated encrypted autosave failure remains dirty and can be retried before lock', async () => {
  let value = null;
  let fail = false;
  const storage = {
    getItem: async () => value,
    removeItem: async () => { value = null; },
    setItem: async (_name, next) => { if (fail) throw new Error('synthetic quota'); value = next; },
  };
  const vault = createVault({ storage, crypto: webcrypto, iterations: 100_000 });
  await vault.create(phrase);
  const doc = editedDocument();
  const save = createProfileSaveQueue({ write: value => vault.write(key, value), encode: serialize, fingerprint });
  fail = true;
  assert.equal(await save(doc), false);
  assert.equal(doc.savedFp, null);
  assert.equal(vault.unlocked, true);
  fail = false;
  assert.equal(await save(doc), true);
  vault.lock();
  await vault.unlock(phrase);
  assert.equal(parse((await vault.read(key)).value).data.flights[0].airtimeMin, 35);
});
