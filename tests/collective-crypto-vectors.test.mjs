// Криптопрофіль колективів (C2 / T-0017): незалежна перевірка фікстури
// tests/fixtures/collective-crypto-vectors.json засобами node:crypto — поза Rust-реалізацією.
// Фікстуру читає й `cargo test collective::vectors` (src-tauri/src/collective/vectors.rs);
// тут та сама фікстура перевіряється другою реалізацією: Ed25519/X25519/HKDF з node:crypto,
// XChaCha20-Poly1305 = HChaCha20 (чиста реалізація нижче) + chacha20-poly1305 з node:crypto.
// Лише синтетичні й еталонні (RFC 8032/7748/5869, draft-irtf-cfrg-xchacha-03) значення.
import assert from 'node:assert/strict';
import { createDecipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman, hkdfSync, verify } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const fixture = JSON.parse(await readFile(new URL('./fixtures/collective-crypto-vectors.json', import.meta.url), 'utf8'));
const hex = s => Buffer.from(s, 'hex');
const sha256 = (...parts) => createHash('sha256').update(Buffer.concat(parts)).digest();
const utf8 = s => Buffer.from(s, 'utf8');

const LABELS = {
  memberId: utf8('easywar/collective/v1/member-id'),
  device: utf8('easywar/collective/v1/device'),
  exchangeBinding: utf8('easywar/collective/v1/exchange-binding'),
  epochWrap: utf8('easywar/collective/v1/epoch-wrap'),
  op: utf8('easywar/collective/v1/op'),
};

// DER-обгортки для «сирих» ключів (RFC 8410).
const DER = {
  ed25519Priv: hex('302e020100300506032b657004220420'),
  ed25519Pub: hex('302a300506032b6570032100'),
  x25519Priv: hex('302e020100300506032b656e04220420'),
  x25519Pub: hex('302a300506032b656e032100'),
};
const edPublic = raw => createPublicKey({ key: Buffer.concat([DER.ed25519Pub, raw]), format: 'der', type: 'spki' });
const edPrivate = seed => createPrivateKey({ key: Buffer.concat([DER.ed25519Priv, seed]), format: 'der', type: 'pkcs8' });
const xPublic = raw => createPublicKey({ key: Buffer.concat([DER.x25519Pub, raw]), format: 'der', type: 'spki' });
const xPrivate = raw => createPrivateKey({ key: Buffer.concat([DER.x25519Priv, raw]), format: 'der', type: 'pkcs8' });
const rawPublic = key => key.export({ format: 'der', type: 'spki' }).subarray(12);

// Канонічний кодек модуля (src-tauri/src/collective/codec.rs): big-endian, var = u32-довжина + байти.
const be = {
  u8: n => Buffer.from([n]),
  u16: n => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; },
  u32: n => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; },
  i64: n => { const b = Buffer.alloc(8); b.writeBigInt64BE(BigInt(n)); return b; },
  u64: n => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; },
  var: bytes => Buffer.concat([be.u32(bytes.length), bytes]),
  optionI64: n => (n === null || n === undefined ? Buffer.from([0]) : Buffer.concat([Buffer.from([1]), be.i64(n)])),
};

// HChaCha20 (draft-irtf-cfrg-xchacha-03, розділ 2.2) — для перетворення XChaCha20 у ChaCha20-IETF.
function hchacha20(key, nonce16) {
  const st = new Uint32Array(16);
  st.set([0x61707865, 0x3320646e, 0x79622d32, 0x6b206574]);
  for (let i = 0; i < 8; i++) st[4 + i] = key.readUInt32LE(4 * i);
  for (let i = 0; i < 4; i++) st[12 + i] = nonce16.readUInt32LE(4 * i);
  const rotl = (v, c) => ((v << c) | (v >>> (32 - c))) >>> 0;
  const qr = (a, b, c, d) => {
    st[a] = (st[a] + st[b]) >>> 0; st[d] = rotl(st[d] ^ st[a], 16);
    st[c] = (st[c] + st[d]) >>> 0; st[b] = rotl(st[b] ^ st[c], 12);
    st[a] = (st[a] + st[b]) >>> 0; st[d] = rotl(st[d] ^ st[a], 8);
    st[c] = (st[c] + st[d]) >>> 0; st[b] = rotl(st[b] ^ st[c], 7);
  };
  for (let i = 0; i < 10; i++) {
    qr(0, 4, 8, 12); qr(1, 5, 9, 13); qr(2, 6, 10, 14); qr(3, 7, 11, 15);
    qr(0, 5, 10, 15); qr(1, 6, 11, 12); qr(2, 7, 8, 13); qr(3, 4, 9, 14);
  }
  const out = Buffer.alloc(32);
  [0, 1, 2, 3, 12, 13, 14, 15].forEach((i, k) => out.writeUInt32LE(st[i], 4 * k));
  return out;
}

// XChaCha20-Poly1305 розшифрування; ciphertext містить тег (останні 16 байтів).
function xchachaOpen(key, nonce24, aad, ciphertextWithTag) {
  const subkey = hchacha20(key, nonce24.subarray(0, 16));
  const nonce12 = Buffer.concat([Buffer.alloc(4), nonce24.subarray(16)]);
  const tag = ciphertextWithTag.subarray(ciphertextWithTag.length - 16);
  const body = ciphertextWithTag.subarray(0, ciphertextWithTag.length - 16);
  const d = createDecipheriv('chacha20-poly1305', subkey, nonce12, { authTagLength: 16 });
  d.setAAD(aad, { plaintextLength: body.length });
  d.setAuthTag(tag);
  return Buffer.concat([d.update(body), d.final()]);
}

const headerBytes = h => Buffer.concat([
  be.u16(h.v), be.u16(h.suite), hex(h.collective_id), hex(h.envelope_id), be.u32(h.epoch), hex(h.nonce), hex(h.recipient_scope),
]);
const canonical = p => Buffer.concat([
  be.var(hex(p.op)), hex(p.author_member_id), hex(p.device_pub), be.i64(p.client_time), be.u8(p.class),
  hex(p.table_id), hex(p.op_id), be.u64(p.membership_seq), be.optionI64(p.expiry),
]);

test('фікстура описує протокол v1 / suite 1 і має всі розділи', () => {
  assert.equal(fixture.protocol_version, 1);
  assert.equal(fixture.suite, 1);
  for (const section of ['aead', 'sign', 'x25519', 'hkdf', 'envelope', 'reencrypt', 'negative']) {
    assert.ok(Array.isArray(fixture[section]) && fixture[section].length > 0, section);
  }
  for (const section of ['member', 'device', 'exchange_binding', 'epoch_wrap']) assert.ok(Object.keys(fixture[section]).length > 0, section);
  assert.deepEqual(fixture.negative.map(n => n.name), [
    'flipped ciphertext byte',
    'same op_id, different payload',
    'backdated signed operation',
    'old envelope after revocation',
    'old envelope after revocation, quarantine policy',
    'new epoch from revoked member',
    'membership_seq from the future',
    'membership_seq from the future, revoked author',
    'membership_seq beyond the deferral horizon',
  ]);
  for (const n of fixture.negative) assert.match(n.expect, /^(rejected:[A-Za-z]+|integrity_violation|quarantine|deferred)$/, n.name);
});

test('XChaCha20-Poly1305: еталон draft-irtf-cfrg-xchacha-03 через HChaCha20 + chacha20-poly1305', () => {
  for (const v of fixture.aead) {
    const plain = xchachaOpen(hex(v.key), hex(v.nonce), hex(v.aad), hex(v.ciphertext));
    assert.equal(plain.toString('hex'), v.plaintext, v.name);
  }
});

test('Ed25519: еталон RFC 8032 перевіряється node:crypto', () => {
  for (const v of fixture.sign) {
    const priv = edPrivate(hex(v.seed));
    assert.equal(rawPublic(createPublicKey(priv)).toString('hex'), v.public, `${v.name}: public`);
    assert.ok(verify(null, hex(v.message), edPublic(hex(v.public)), hex(v.signature)), `${v.name}: signature`);
  }
});

test('X25519: еталон RFC 7748 перевіряється node:crypto', () => {
  for (const v of fixture.x25519) {
    const priv = xPrivate(hex(v.private));
    assert.equal(rawPublic(createPublicKey(priv)).toString('hex'), v.public, `${v.name}: public`);
    const shared = diffieHellman({ privateKey: priv, publicKey: xPublic(hex(v.public_peer)) });
    assert.equal(shared.toString('hex'), v.shared, `${v.name}: shared`);
  }
});

test('HKDF-SHA256: еталон RFC 5869', () => {
  for (const v of fixture.hkdf) {
    const okm = Buffer.from(hkdfSync('sha256', hex(v.ikm), hex(v.salt), hex(v.info), hex(v.okm).length));
    assert.equal(okm.toString('hex'), v.okm, v.name);
  }
});

test('учасник: ключі з seed, member_id = SHA-256(мітка ‖ ключ підпису)', () => {
  const m = fixture.member;
  assert.equal(rawPublic(createPublicKey(edPrivate(hex(m.sign_seed)))).toString('hex'), m.sign_public);
  assert.equal(rawPublic(createPublicKey(xPrivate(hex(m.exchange_secret)))).toString('hex'), m.exchange_public);
  assert.equal(sha256(LABELS.memberId, hex(m.sign_public)).toString('hex'), m.member_id);
  assert.notEqual(m.sign_public, m.exchange_public, 'окремі пари Ed25519 і X25519');
});

test('запис пристрою підписаний учасником над міткою ‖ pub ‖ member_id ‖ issued_at', () => {
  const d = fixture.device;
  const m = fixture.member;
  assert.equal(rawPublic(createPublicKey(edPrivate(hex(d.seed)))).toString('hex'), d.public);
  const record = hex(d.record);
  assert.equal(record.length, 32 + 32 + 8 + 64);
  assert.equal(record.subarray(0, 32).toString('hex'), d.public);
  assert.equal(record.subarray(32, 64).toString('hex'), m.member_id);
  assert.equal(record.readBigInt64BE(64), BigInt(d.issued_at));
  const signed = Buffer.concat([LABELS.device, record.subarray(0, 72)]);
  assert.ok(verify(null, signed, edPublic(hex(m.sign_public)), record.subarray(72)), 'підпис учасника');
  assert.ok(!verify(null, signed, edPublic(hex(d.public)), record.subarray(72)), 'не підпис самого пристрою');
});

test('зв\'язування ключа обміну: member_id ‖ exchange_pub ‖ collective_id ‖ issued_at під підписом учасника (G12, U1)', () => {
  const b = fixture.exchange_binding;
  const m = fixture.member;
  const bytes = hex(b.bytes);
  assert.equal(bytes.length, 32 + 32 + 16 + 8 + 64);
  const signPub = bytes.subarray(0, 32);
  const exchangePub = bytes.subarray(32, 64);
  const collectiveId = bytes.subarray(64, 80);
  assert.equal(signPub.toString('hex'), m.sign_public);
  assert.equal(exchangePub.toString('hex'), m.exchange_public);
  assert.equal(collectiveId.toString('hex'), b.collective_id);
  assert.equal(bytes.readBigInt64BE(80), BigInt(b.issued_at));
  const memberId = sha256(LABELS.memberId, signPub);
  assert.equal(memberId.toString('hex'), m.member_id);
  const signed = Buffer.concat([LABELS.exchangeBinding, memberId, exchangePub, collectiveId, bytes.subarray(80, 88)]);
  const signature = bytes.subarray(88);
  assert.ok(verify(null, signed, edPublic(signPub), signature), 'підпис учасника');
  const otherCollective = Buffer.concat([LABELS.exchangeBinding, memberId, exchangePub, Buffer.alloc(16, 0x11), bytes.subarray(80, 88)]);
  assert.ok(!verify(null, otherCollective, edPublic(signPub), signature), 'інший колектив');
  const asDevice = Buffer.concat([LABELS.device, memberId, exchangePub, collectiveId, bytes.subarray(80, 88)]);
  assert.ok(!verify(null, asDevice, edPublic(signPub), signature), 'мітка запису пристрою не підходить');
});

test('обгортка епохи: v ‖ suite у заголовку, X25519 → HKDF(salt = collective_id ‖ epoch, info = мітка ‖ eph_pub ‖ member_pub) → XChaCha (G12, U3)', () => {
  const w = fixture.epoch_wrap;
  const m = fixture.member;
  const bytes = hex(w.bytes);
  const headerLen = 2 + 2 + 16 + 4 + 32 + 32 + 24;
  const header = bytes.subarray(0, headerLen);
  assert.equal(header.readUInt16BE(0), fixture.protocol_version, 'v');
  assert.equal(header.readUInt16BE(2), fixture.suite, 'suite');
  const collectiveId = header.subarray(4, 20);
  assert.equal(collectiveId.toString('hex'), fixture.exchange_binding.collective_id);
  const epoch = header.readUInt32BE(20);
  assert.equal(header.subarray(24, 56).toString('hex'), m.member_id, 'одержувач');
  const ephPub = header.subarray(56, 88);
  assert.equal(rawPublic(createPublicKey(xPrivate(hex(w.eph_secret)))).toString('hex'), ephPub.toString('hex'));
  const nonce = header.subarray(88, 112);
  const shared = diffieHellman({ privateKey: xPrivate(hex(m.exchange_secret)), publicKey: xPublic(ephPub) });
  const salt = Buffer.concat([collectiveId, be.u32(epoch)]);
  const info = Buffer.concat([LABELS.epochWrap, ephPub, hex(m.exchange_public)]);
  const kek = Buffer.from(hkdfSync('sha256', shared, salt, info, 32));
  const key = xchachaOpen(kek, nonce, header, bytes.subarray(headerLen));
  assert.equal(key.toString('hex'), w.epoch_key);
  assert.throws(() => xchachaOpen(kek, nonce, Buffer.concat([header.subarray(0, headerLen - 1), Buffer.from([header[headerLen - 1] ^ 1])]), bytes.subarray(headerLen)));
  // Старий KEK без прив'язки до відкритих ключів (до U3) обгортку не відкриває.
  const legacy = Buffer.from(hkdfSync('sha256', shared, salt, LABELS.epochWrap, 32));
  assert.throws(() => xchachaOpen(legacy, nonce, header, bytes.subarray(headerLen)));
});

test('конверт: AAD = 80 відкритих байтів, payload канонічний, підпис пристрою, op_digest незалежний від nonce', () => {
  for (const e of fixture.envelope) {
    const aad = headerBytes(e.header);
    assert.equal(aad.length, 80, 'HEADER_LEN');
    assert.equal(aad.toString('hex'), e.aad, `${e.name}: AAD`);
    const bytes = hex(e.bytes);
    assert.equal(bytes.subarray(0, 80).toString('hex'), e.aad);
    assert.equal(bytes.subarray(80).toString('hex'), e.ciphertext);
    assert.equal(e.header.v, 1);
    assert.equal(e.header.suite, 1);

    const payload = canonical(e.payload_fields);
    assert.equal(payload.toString('hex'), e.payload, `${e.name}: канонічний payload`);
    assert.equal(sha256(payload).toString('hex'), e.op_digest, `${e.name}: op_digest`);
    assert.equal(e.payload_fields.author_member_id, fixture.member.member_id);
    assert.equal(e.payload_fields.device_pub, fixture.device.public);
    assert.ok(verify(null, Buffer.concat([LABELS.op, payload]), edPublic(hex(e.payload_fields.device_pub)), hex(e.signature)), 'підпис пристрою');
    assert.notEqual(e.payload_fields.expiry, undefined, 'JE-16 (а): expiry всередині payload');
    assert.equal(e.aad.includes(hex(be.i64(e.payload_fields.expiry)).toString('hex')), false, 'expiry не у відкритих полях');

    const plain = xchachaOpen(hex(e.epoch_key), hex(e.header.nonce), aad, hex(e.ciphertext));
    assert.equal(plain.toString('hex'), e.payload + e.signature, `${e.name}: відкритий текст = payload ‖ підпис`);
    const flipped = Buffer.from(aad); flipped[79] ^= 1;
    assert.throws(() => xchachaOpen(hex(e.epoch_key), hex(e.header.nonce), flipped, hex(e.ciphertext)), 'зміна recipient_scope ламає тег');
  }
});

test('перешифрування: інший envelope_id/nonce, той самий payload і op_digest', () => {
  for (const r of fixture.reencrypt) {
    const base = fixture.envelope.find(e => e.name === r.base);
    assert.ok(base, r.base);
    const header = { ...base.header, envelope_id: r.envelope_id, nonce: r.nonce };
    const plain = xchachaOpen(hex(base.epoch_key), hex(r.nonce), headerBytes(header), hex(r.ciphertext));
    assert.equal(plain.toString('hex'), base.payload + base.signature, r.name);
    assert.notEqual(r.ciphertext, base.ciphertext);
    assert.equal(sha256(plain.subarray(0, plain.length - 64)).toString('hex'), r.expect.op_digest);
    assert.equal(r.expect.op_digest, base.op_digest);
    assert.deepEqual([r.expect.envelope, r.expect.apply], ['accepted', 'idempotent']);
  }
});
