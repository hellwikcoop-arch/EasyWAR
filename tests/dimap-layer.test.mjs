import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const context = vm.createContext({ Intl, Date });
vm.runInContext(await read('../src/public/dimap-layer-core.js'), context);
const core = context.EWDimapCore;
const fixture = JSON.parse(await read('../tests/fixtures/dimap-polling.json'));

test('розбір фікстури: п’ять типів, шахед окремо від реактивного, бита точка відкинута', () => {
  const view = core.present(fixture);
  assert.equal(view.targets.length, 5);
  assert.equal(JSON.stringify(view.targets.map(item => item.glyph)), JSON.stringify(['delta', 'fpv', 'double', 'plane', 'kab']));
  assert.notEqual(view.targets[0].d, view.targets[2].d);
  assert.equal(view.targets[0].traj.length, 4);
  assert.equal(view.targets[4].traj.length, 3);
  assert.doesNotMatch(JSON.stringify(view), /skip/);
  const titles = view.targets.map(item => item.title);
  assert.match(titles[0], /Шахед/);
  assert.match(titles[0], /180 км\/год/);
  assert.match(titles[0], /13:58/);
  assert.match(titles[2], /Герань-4/);
  assert.equal(view.statusText, '');
  assert.equal(view.attribution, 'Дані: DIMAP (неофіційно)');
  assert.doesNotMatch(JSON.stringify(view), /н\/д/);
});

test('область має центр, район громада і місто лишаються в списку, історія не потрапляє в модель', () => {
  const view = core.present(fixture);
  assert.equal(view.alerts.length, 4);
  assert.equal(view.halos.length, 1);
  assert.equal(view.halos[0].region, 'Харківська');
  assert.equal(view.halos[0].lat, 49.615);
  assert.equal(view.halos[0].lng, 36.5048);
  assert.match(view.alerts[1].label, /Тестовий район/);
  assert.match(view.alerts[2].label, /Тестова громада/);
  assert.match(view.alerts[3].label, /Тестове місто/);
  assert.equal(core.oblastByName('Тестовий район'), null);
  const long = { data: { targets: { targets: [{ type: 'shahed', lat: 49, lng: 36, name: 'Шахед', traj: { path: Array.from({ length: 20 }, (_, i) => [49 + i * 0.01, 36, 0]) } }] }, alerts: { history: Array.from({ length: 30 }, () => ({ endedAt: 1 })), alerts: [] } } };
  const trimmed = core.present(long);
  assert.equal(trimmed.targets[0].traj.length, 8);
  assert.ok(Math.abs(trimmed.targets[0].traj[0].lat - 49.12) < 0.001);
  assert.equal(trimmed.alerts.length, 0);
});

test('порожній знімок каже «Немає даних DIMAP» і не підставляє н/д', () => {
  const view = core.present({});
  assert.equal(view.statusText, 'Немає даних DIMAP');
  assert.equal(view.updatedLabel, '');
  assert.equal(view.targets.length, 0);
  const kyiv = core.formatKyiv(Date.parse('2026-11-21T12:00:00Z'));
  assert.match(kyiv, /21\.11\.2026/);
  assert.match(kyiv, /14:00/);
});

test('стрілки проєктуються і повертаються за курсом', () => {
  const view = core.present(fixture);
  const marks = core.layoutMarkers(view.targets, (lng, lat) => ({ x: lng * 10, y: lat * 10 }));
  assert.equal(marks.length, 5);
  const tracks = core.layoutTracks(view.targets, (lng, lat) => ({ x: lng * 10, y: lat * 10 }));
  assert.equal(tracks.length, 2);
  assert.match(tracks[0].d, /^M/);
  assert.match(tracks[0].d, /L/);
  assert.equal(marks[0].rot, 270);
  assert.ok(Math.abs(marks[0].x - 365) < 0.01);
  assert.ok(Math.abs(marks[0].y - 496.1) < 0.01);
  assert.notEqual(marks[0].d, marks[1].d);
  const halos = core.layoutHalos(view.halos, (lng, lat) => ({ x: lng, y: lat }));
  assert.equal(halos.length, 1);
  assert.ok(halos[0].fill.includes('240'));
});

test('пауза після помилки збігається з кроком Rust: 10, 20, 40 с і стеля 5 хв', () => {
  assert.equal(core.backoffMs(0), 10000);
  assert.equal(core.backoffMs(1), 10000);
  assert.equal(core.backoffMs(2), 20000);
  assert.equal(core.backoffMs(3), 40000);
  assert.equal(core.backoffMs(9), 300000);
  assert.equal(core.savedEnabled(undefined), false);
  assert.equal(core.savedEnabled('{"enabled":false}'), false);
  assert.equal(core.savedEnabled('{"enabled":true}'), true);
  assert.equal(core.rotation(-90), 270);
});

test('обидві карти дашборда підключають шар і не тягнуть службу з webview', async () => {
  for (const name of ['air', 'rocket']) {
    const html = await read(`../src/${name}.html`);
    assert.match(html, /<script src="\.\/dimap-layer-core\.js"><\/script>/);
    assert.match(html, /<script src="\.\/dimap-layer\.js"><\/script>/);
    assert.match(html, /EWDimap\.mount\(/);
    assert.match(html, /EWDimap\.paint\(/);
    assert.doesNotMatch(html, /api\.dimap\.live/);
  }
  const ui = await read('../src/public/dimap-layer.js');
  assert.match(ui, /invoke\('dimap_poll'\)/);
  assert.match(ui, /dimap\.state/);
  assert.doesNotMatch(ui, /\bfetch\s*\(/);
});
