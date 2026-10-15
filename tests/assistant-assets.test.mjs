import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

function chunks(data, start = 12) {
  const result = [];
  for (let offset = start; offset < data.length;) {
    assert.ok(offset + 8 <= data.length, 'complete chunk header');
    const size = data.readUInt32LE(offset + 4);
    assert.ok(offset + 8 + size <= data.length, 'complete chunk payload');
    result.push({ type: data.toString('ascii', offset, offset + 4), data: data.subarray(offset + 8, offset + 8 + size) });
    offset += 8 + size + (size % 2);
  }
  return result;
}

// Клипи зібрано з наданих GIF: у кожного жесту своя кількість кадрів по 100 мс.
const FRAME_COUNT = { wave: 21, explain: 19, point: 23 };
for (const id of ['wave', 'explain', 'point']) {
  test(`${id} replaces each complete frame without blending a previous pose`, async () => {
    const data = await readFile(new URL(`../src/assistant/assets/colonel-${id}.webp`, import.meta.url));
    assert.equal(data.toString('ascii', 0, 4), 'RIFF');
    assert.equal(data.toString('ascii', 8, 12), 'WEBP');
    assert.equal(data.readUInt32LE(4), data.length - 8);
    const parts = chunks(data);
    const header = parts.find(item => item.type === 'VP8X').data;
    assert.equal(header[0] & 0x12, 0x12, 'alpha and animation');
    assert.equal(header.readUIntLE(4, 3) + 1, 384);
    assert.equal(header.readUIntLE(7, 3) + 1, 576);
    const frames = parts.filter(item => item.type === 'ANMF');
    assert.equal(frames.length, FRAME_COUNT[id]);
    let duration = 0;
    for (const { data: frame } of frames) {
      assert.equal(frame.readUIntLE(0, 3), 0, 'full canvas starts at x=0');
      assert.equal(frame.readUIntLE(3, 3), 0, 'full canvas starts at y=0');
      assert.equal(frame.readUIntLE(6, 3) + 1, 384);
      assert.equal(frame.readUIntLE(9, 3) + 1, 576);
      duration += frame.readUIntLE(12, 3);
      assert.equal(frame[15], 3, 'dispose to background and do not blend');
      assert.ok(chunks(frame, 16).some(item => item.type === 'VP8L'), 'lossless image pixels');
    }
    assert.equal(duration, FRAME_COUNT[id] * 100);
  });
}

test('static portrait and clips share a canvas ratio', async () => {
  const data = await readFile(new URL('../src/assistant/assets/colonel-kombat-stable.png', import.meta.url));
  assert.equal(data.toString('ascii', 12, 16), 'IHDR');
  assert.equal(data.readUInt32BE(16), 384);
  assert.equal(data.readUInt32BE(20), 576);
});
