//! Тестові вектори (ADR, розділ 4): `tests/fixtures/collective-crypto-vectors.json` читають і
//! `cargo test`, і `node --test`. Еталонні вектори — з RFC 8032, RFC 7748, RFC 5869 і
//! draft-irtf-cfrg-xchacha-03; синтетичні конверти породжує цей модуль детерміновано
//! (`cargo test collective::vectors::print_synthetic -- --ignored --nocapture`) і фіксує у файл.

use chacha20poly1305::aead::{Aead, KeyInit, Payload as AeadPayload};
use chacha20poly1305::{Key, XChaCha20Poly1305, XNonce};
use serde_json::{json, Value};
use x25519_dalek::{PublicKey, StaticSecret};

use super::envelope::{self, Envelope, EnvelopeHeader, Payload};
use super::epoch::{self, EpochKey};
use super::hex;
use super::identity::{self, DeviceIdentity, MemberIdentity};
use super::replay::{
    receive, Decision, InMemoryMembership, Journals, MembershipView, RevokedPolicy, DEFER_HORIZON,
};
use super::{hkdf, Reason, ID_LEN, KEY_LEN, NONCE_LEN};

const FIXTURE: &str = include_str!("../../../tests/fixtures/collective-crypto-vectors.json");

fn fixture() -> Value {
    serde_json::from_str(FIXTURE).expect("фікстура — коректний JSON")
}

fn field<'a>(value: &'a Value, name: &str) -> &'a str {
    value[name]
        .as_str()
        .unwrap_or_else(|| panic!("поле {name}"))
}

#[test]
fn fixture_declares_this_protocol() {
    let f = fixture();
    assert_eq!(f["protocol_version"], json!(super::PROTOCOL_VERSION));
    assert_eq!(f["suite"], json!(super::SUITE));
}

#[test]
fn aead_vectors_from_xchacha_draft() {
    for v in fixture()["aead"].as_array().unwrap() {
        let key: [u8; KEY_LEN] = hex::array(field(v, "key"));
        let nonce: [u8; NONCE_LEN] = hex::array(field(v, "nonce"));
        let out = XChaCha20Poly1305::new(&Key::from(key))
            .encrypt(
                &XNonce::from(nonce),
                AeadPayload {
                    msg: &hex::decode(field(v, "plaintext")),
                    aad: &hex::decode(field(v, "aad")),
                },
            )
            .unwrap();
        assert_eq!(
            hex::encode(&out),
            field(v, "ciphertext"),
            "{}",
            field(v, "name")
        );
    }
}

#[test]
fn signature_vectors_from_rfc8032() {
    for v in fixture()["sign"].as_array().unwrap() {
        let device = DeviceIdentity::from_secret(&hex::array(field(v, "seed")));
        assert_eq!(
            hex::encode(&device.public().0),
            field(v, "public"),
            "{}",
            field(v, "name")
        );
        let message = hex::decode(field(v, "message"));
        let signature = device.sign(&message);
        assert_eq!(
            hex::encode(&signature),
            field(v, "signature"),
            "{}",
            field(v, "name")
        );
        identity::verify(&device.public().0, &message, &signature).unwrap();
    }
}

#[test]
fn x25519_vectors_from_rfc7748() {
    for v in fixture()["x25519"].as_array().unwrap() {
        let secret = StaticSecret::from(hex::array::<KEY_LEN>(field(v, "private")));
        assert_eq!(
            hex::encode(PublicKey::from(&secret).as_bytes()),
            field(v, "public"),
            "{}",
            field(v, "name")
        );
        let peer = PublicKey::from(hex::array::<KEY_LEN>(field(v, "public_peer")));
        assert_eq!(
            hex::encode(secret.diffie_hellman(&peer).as_bytes()),
            field(v, "shared")
        );
    }
}

#[test]
fn hkdf_vectors_from_rfc5869() {
    for v in fixture()["hkdf"].as_array().unwrap() {
        let okm = hkdf(
            &hex::decode(field(v, "ikm")),
            &hex::decode(field(v, "salt")),
            &hex::decode(field(v, "info")),
        );
        // Еталон дає 42 байти; модуль виводить лише 32-байтні ключі — порівнюємо префікс.
        assert!(
            field(v, "okm").starts_with(&hex::encode(&okm[..])),
            "{}",
            field(v, "name")
        );
    }
}

/// Детерміновані синтетичні ключі (жодних реальних даних).
struct Synthetic {
    member: MemberIdentity,
    device: DeviceIdentity,
    epoch_key: EpochKey,
    header: EnvelopeHeader,
    payload: Payload,
}

fn synthetic() -> Synthetic {
    let member = MemberIdentity::from_secrets(&[0x01; KEY_LEN], &[0x02; KEY_LEN]);
    let device = DeviceIdentity::from_secret(&[0x03; KEY_LEN]);
    Synthetic {
        payload: Payload {
            op: b"{\"table\":\"synthetic\",\"row\":1,\"value\":\"a\"}".to_vec(),
            author_member_id: member.member_id(),
            device_pub: device.public().0,
            client_time: 1_761_696_000,
            class: b'B',
            table_id: [0x20; ID_LEN],
            op_id: [0x21; ID_LEN],
            membership_seq: 3,
            expiry: Some(1_762_300_800),
        },
        member,
        device,
        epoch_key: EpochKey::from_bytes([0x04; KEY_LEN]),
        header: EnvelopeHeader {
            v: super::PROTOCOL_VERSION,
            suite: super::SUITE,
            collective_id: [0x10; ID_LEN],
            envelope_id: [0x11; ID_LEN],
            epoch: 0,
            nonce: [0x12; NONCE_LEN],
            recipient_scope: [0; ID_LEN],
        },
    }
}

fn header_json(h: &EnvelopeHeader) -> Value {
    json!({
        "v": h.v, "suite": h.suite,
        "collective_id": hex::encode(&h.collective_id),
        "envelope_id": hex::encode(&h.envelope_id),
        "epoch": h.epoch,
        "nonce": hex::encode(&h.nonce),
        "recipient_scope": hex::encode(&h.recipient_scope),
    })
}

/// Час синтетичного зв'язування ключа обміну (G12, U1).
const BINDING_ISSUED_AT: i64 = 1_761_600_000;

fn synthetic_json() -> Value {
    let s = synthetic();
    let public = s.member.public();
    let binding = s
        .member
        .bind_exchange(s.header.collective_id, BINDING_ISSUED_AT);
    let recipient = binding
        .verify(&s.header.collective_id)
        .expect("синтетичне зв'язування дійсне");
    let record = s.member.issue_device(&s.device.public(), 1_761_600_000);
    let signed = s.payload.clone().sign(&s.device);
    let envelope = envelope::seal(&s.epoch_key, s.header, &signed);
    let mut second = s.header;
    second.envelope_id = [0x31; ID_LEN];
    second.nonce = [0x32; NONCE_LEN];
    let reencrypted = envelope::seal(&s.epoch_key, second, &signed);
    let wrap = epoch::wrap_deterministic(
        &s.epoch_key,
        0,
        &recipient,
        [0x05; KEY_LEN],
        [0x13; NONCE_LEN],
    )
    .expect("синтетичний ключ обміну контрибутивний");
    json!({
        "member": {
            "sign_seed": hex::encode(&[0x01; KEY_LEN]), "exchange_secret": hex::encode(&[0x02; KEY_LEN]),
            "sign_public": hex::encode(&public.sign), "exchange_public": hex::encode(&public.exchange),
            "member_id": hex::encode(&s.member.member_id()),
        },
        "device": {
            "seed": hex::encode(&[0x03; KEY_LEN]), "public": hex::encode(&s.device.public().0),
            "record": hex::encode(&record.to_bytes()), "issued_at": record.issued_at,
        },
        "exchange_binding": {
            "collective_id": hex::encode(&binding.collective_id), "issued_at": binding.issued_at,
            "bytes": hex::encode(&binding.to_bytes()),
        },
        "epoch_wrap": {
            "epoch_key": hex::encode(s.epoch_key.as_bytes()), "eph_secret": hex::encode(&[0x05; KEY_LEN]),
            "bytes": hex::encode(&wrap.to_bytes()),
        },
        "envelope": [{
            "name": "synthetic envelope 1",
            "header": header_json(&s.header),
            "aad": hex::encode(&s.header.aad()),
            "epoch_key": hex::encode(s.epoch_key.as_bytes()),
            "payload_fields": {
                "op": hex::encode(&s.payload.op), "author_member_id": hex::encode(&s.payload.author_member_id),
                "device_pub": hex::encode(&s.payload.device_pub), "client_time": s.payload.client_time,
                "class": s.payload.class, "table_id": hex::encode(&s.payload.table_id),
                "op_id": hex::encode(&s.payload.op_id), "membership_seq": s.payload.membership_seq,
                "expiry": s.payload.expiry,
            },
            "payload": hex::encode(&s.payload.canonical()),
            "signature": hex::encode(&signed.signature),
            "op_digest": hex::encode(&s.payload.op_digest()),
            "ciphertext": hex::encode(&envelope.ciphertext),
            "bytes": hex::encode(&envelope.to_bytes()),
        }],
        "reencrypt": [{
            "name": "same op, new envelope", "base": "synthetic envelope 1",
            "envelope_id": hex::encode(&second.envelope_id), "nonce": hex::encode(&second.nonce),
            "ciphertext": hex::encode(&reencrypted.ciphertext),
            "expect": {"envelope": "accepted", "op_digest": hex::encode(&s.payload.op_digest()), "apply": "idempotent"},
        }],
    })
}

/// Друкує синтетичну частину фікстури: `cargo test collective::vectors::print_synthetic -- --ignored --nocapture`.
#[test]
#[ignore]
fn print_synthetic() {
    println!(
        "{}",
        serde_json::to_string_pretty(&synthetic_json()).unwrap()
    );
}

#[test]
fn synthetic_vectors_match_fixture() {
    let f = fixture();
    let generated = synthetic_json();
    for key in [
        "member",
        "device",
        "exchange_binding",
        "epoch_wrap",
        "envelope",
        "reencrypt",
    ] {
        assert_eq!(
            f[key], generated[key],
            "розділ {key} фікстури відстав від коду — перегенеруй print_synthetic"
        );
    }
}

#[test]
fn synthetic_envelope_opens_with_fixture_values_only() {
    let f = fixture();
    let v = &f["envelope"][0];
    let key = EpochKey::from_bytes(hex::array(field(v, "epoch_key")));
    let envelope = Envelope::from_bytes(&hex::decode(field(v, "bytes"))).unwrap();
    assert_eq!(hex::encode(&envelope.header.aad()), field(v, "aad"));
    let signed = envelope::open(&key, &envelope).unwrap();
    assert_eq!(
        hex::encode(&signed.payload.canonical()),
        field(v, "payload")
    );
    assert_eq!(
        hex::encode(&signed.payload.op_digest()),
        field(v, "op_digest")
    );
    let member = MemberIdentity::from_secrets(
        &hex::array(field(&f["member"], "sign_seed")),
        &hex::array(field(&f["member"], "exchange_secret")),
    );
    let wrap =
        epoch::EpochWrap::from_bytes(&hex::decode(field(&f["epoch_wrap"], "bytes"))).unwrap();
    assert_eq!(
        epoch::unwrap_epoch_key(&wrap, &member).unwrap().as_bytes(),
        key.as_bytes()
    );
    let record =
        identity::DeviceRecord::from_bytes(&hex::decode(field(&f["device"], "record"))).unwrap();
    record.verify(&member.public()).unwrap();
    let binding =
        identity::ExchangeBinding::from_bytes(&hex::decode(field(&f["exchange_binding"], "bytes")))
            .unwrap();
    let bound = binding.verify(&wrap.collective_id).unwrap();
    assert_eq!(bound.public(), &member.public());
}

/// Негативні вектори розділу 4 — виконуються на синтетичному журналі складу з відкликанням
/// на seq 7: кожен запис `negative` фікстури має дати саме очікуваний результат.
#[test]
fn negative_vectors_behave_as_declared() {
    let f = fixture();
    let s = synthetic();
    let collective = s.header.collective_id;
    let binding = s.member.bind_exchange(collective, BINDING_ISSUED_AT);
    let mut membership = InMemoryMembership::new(collective);
    membership.join(&binding).unwrap(); // 1
    membership.grant_table(&s.member.member_id(), s.payload.table_id); // 2
    membership
        .add_device(&s.member.issue_device(&s.device.public(), 1))
        .unwrap(); // 3
    for _ in 0..3 {
        membership.grant_table(&s.member.member_id(), [0xee; ID_LEN]); // 4, 5, 6
    }
    let (revoked_seq, new_epoch) = membership.revoke(&s.member.member_id()); // 7 → епоха 1
    assert_eq!((revoked_seq, new_epoch), (7, 1));
    for _ in 0..2 {
        membership.grant_table(&[0xaa; KEY_LEN], [0xee; ID_LEN]); // 8, 9 — журнал пішов далі
    }
    assert_eq!(membership.latest_seq(), 9);
    let keys = [
        EpochKey::from_bytes([0x04; KEY_LEN]),
        EpochKey::from_bytes([0x44; KEY_LEN]),
    ];
    let key_for = |e: u32| {
        keys.get(e as usize)
            .map(|k| EpochKey::from_bytes(*k.as_bytes()))
    };
    let make = |seq: u64, client_time: i64, epoch: u32, op: &[u8]| {
        let mut payload = s.payload.clone();
        payload.membership_seq = seq;
        payload.client_time = client_time;
        payload.op = op.to_vec();
        let signed = payload.sign(&s.device);
        let mut header = s.header;
        header.epoch = epoch;
        header.envelope_id = super::random_array();
        header.nonce = super::random_array();
        envelope::seal(key_for(epoch).as_ref().unwrap(), header, &signed).to_bytes()
    };
    let base = make(3, 1_761_696_000, 0, &s.payload.op);
    // Журнал без відкликання: вступ, право на таблицю, пристрій (seq 1–3).
    let fresh = || {
        let mut fresh = InMemoryMembership::new(collective);
        fresh.join(&binding).unwrap();
        fresh.grant_table(&s.member.member_id(), s.payload.table_id);
        fresh
            .add_device(&s.member.issue_device(&s.device.public(), 1))
            .unwrap();
        fresh
    };
    for v in f["negative"].as_array().unwrap() {
        let name = field(v, "name");
        let expect = field(v, "expect");
        let mut journals = Journals::new();
        let policy = if v["policy"] == json!("quarantine") {
            RevokedPolicy::Quarantine
        } else {
            RevokedPolicy::Reject
        };
        let decision = match name {
            "flipped ciphertext byte" => {
                let mut bytes = base.clone();
                *bytes.last_mut().unwrap() ^= 1;
                receive(&mut journals, &membership, policy, key_for, &bytes)
            }
            "same op_id, different payload" => {
                // Для цього сценарію автор не відкликаний: окремий журнал без відкликання.
                let fresh = fresh();
                assert!(matches!(
                    receive(&mut journals, &fresh, policy, key_for, &base),
                    Decision::Apply(_)
                ));
                receive(
                    &mut journals,
                    &fresh,
                    policy,
                    key_for,
                    &make(3, 1_761_696_000, 0, b"{\"value\":\"x\"}"),
                )
            }
            "backdated signed operation" => receive(
                &mut journals,
                &membership,
                policy,
                key_for,
                &make(8, 1_761_000_000, 0, &s.payload.op),
            ),
            "old envelope after revocation" => receive(
                &mut journals,
                &membership,
                policy,
                key_for,
                &make(6, 1_761_000_000, 0, &s.payload.op),
            ),
            "old envelope after revocation, quarantine policy" => receive(
                &mut journals,
                &membership,
                RevokedPolicy::Quarantine,
                key_for,
                &make(6, 1_761_000_000, 0, &s.payload.op),
            ),
            "new epoch from revoked member" => receive(
                &mut journals,
                &membership,
                policy,
                key_for,
                &make(3, 1_761_696_000, 1, &s.payload.op),
            ),
            "membership_seq from the future" => receive(
                &mut journals,
                &fresh(),
                policy,
                key_for,
                &make(12, 1_761_696_000, 0, &s.payload.op),
            ),
            // N1: відкликаний на поточному журналі автор не відкладається.
            "membership_seq from the future, revoked author" => receive(
                &mut journals,
                &membership,
                policy,
                key_for,
                &make(12, 1_761_696_000, 0, &s.payload.op),
            ),
            "membership_seq beyond the deferral horizon" => {
                assert_eq!(v["horizon"], json!(super::replay::DEFER_HORIZON));
                receive(
                    &mut journals,
                    &fresh(),
                    policy,
                    key_for,
                    &make(3 + DEFER_HORIZON + 1, 1_761_696_000, 0, &s.payload.op),
                )
            }
            other => panic!("невідомий негативний вектор {other}"),
        };
        let actual = match &decision {
            Decision::Apply(_) => "applied".to_string(),
            Decision::SkipDuplicateEnvelope => "skipped".to_string(),
            Decision::Idempotent => "idempotent".to_string(),
            Decision::Deferred(_) => "deferred".to_string(),
            Decision::Quarantine(_) => "quarantine".to_string(),
            Decision::Rejected(Reason::IntegrityViolation) => "integrity_violation".to_string(),
            Decision::Rejected(reason) => format!("rejected:{reason:?}"),
        };
        assert!(
            actual.starts_with(expect),
            "{name}: очікувано {expect}, отримано {actual}"
        );
    }
}
