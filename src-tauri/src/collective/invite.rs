//! Вступ за запрошенням (E8, пункт 2 списку JE від 29.10.2026): як новий учасник потрапляє
//! в журнал складу й отримує поточний ключ епохи. Чиста логіка без мережі, IPC і сховищ;
//! пересилання запрошення й відповіді — поза модулем (QR, текст, згодом черга).
//!
//! Порядок:
//! 1. чинний учасник видає [`Invitation`] — підписаний одноразовий талон з номером (nonce),
//!    строком і своїм `member_id`;
//! 2. запрошений відповідає [`JoinRequest`]: його підписане зв'язування ключа обміну з цим
//!    колективом (G12, U1), запис першого пристрою і підпис над nonce запрошення (щоб чуже
//!    зв'язування не можна було підставити під інше запрошення);
//! 3. вузол, що тримає журнал, викликає [`admit`]: перевіряє запрошення на поточному журналі
//!    (запрошувач не відкликаний, строк не минув, nonce не використаний), дописує `Join` і
//!    `AddDevice`, і обгортає для нового учасника ключі всіх епох від 0 до поточної
//!    (ADR `collective-crypto.md`, 2.3, К3) — [`Admission`];
//! 4. новий учасник розгортає ключі своїм ключем обміну ([`accept`]).
//!
//! Право запрошувати тут не обмежене роллю: кожен активний учасник може запросити. Ролі
//! (адміністратор, лише читання) — окреме рішення JE; журнал тому зберігає, хто запросив.

use std::collections::HashSet;

use super::codec::{Reader, Writer};
use super::epoch::{unwrap_epoch_key, wrap_epoch_key, CollectiveId, EpochKey, EpochWrap};
use super::identity::{self, DeviceRecord, ExchangeBinding, MemberId, MemberIdentity};
use super::replay::{InMemoryMembership, MembershipView};
use super::{labels, Reason, ID_LEN, SIGNATURE_LEN};

/// Найдовший строк запрошення (7 діб): довший — [`Reason::Malformed`].
pub const MAX_INVITATION_SECONDS: i64 = 7 * 24 * 60 * 60;

/// Одноразовий підписаний талон на вступ. Передається запрошеному поза застосунком.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Invitation {
    pub collective_id: CollectiveId,
    pub inviter: MemberId,
    pub nonce: [u8; ID_LEN],
    pub issued_at: i64,
    pub expires_at: i64,
    pub signature: [u8; SIGNATURE_LEN],
}

impl Invitation {
    pub const LEN: usize = ID_LEN + 32 + ID_LEN + 8 + 8 + SIGNATURE_LEN;

    fn signed_bytes(&self) -> Vec<u8> {
        let mut w = Writer::with_capacity(labels::INVITATION.len() + Self::LEN);
        w.fixed(labels::INVITATION)
            .fixed(&self.collective_id)
            .fixed(&self.inviter)
            .fixed(&self.nonce)
            .i64(self.issued_at)
            .i64(self.expires_at);
        w.finish()
    }

    /// Запрошувач видає талон. `expires_at` не далі ніж [`MAX_INVITATION_SECONDS`].
    pub fn issue(
        inviter: &MemberIdentity,
        collective_id: CollectiveId,
        issued_at: i64,
        expires_at: i64,
    ) -> Result<Self, Reason> {
        if !matches!(
            expires_at.checked_sub(issued_at),
            Some(1..=MAX_INVITATION_SECONDS)
        ) {
            return Err(Reason::Malformed);
        }
        let mut invitation = Self {
            collective_id,
            inviter: inviter.member_id(),
            nonce: super::random_array(),
            issued_at,
            expires_at,
            signature: [0; SIGNATURE_LEN],
        };
        invitation.signature = inviter.sign(&invitation.signed_bytes());
        Ok(invitation)
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        let mut w = Writer::with_capacity(Self::LEN);
        w.fixed(&self.collective_id)
            .fixed(&self.inviter)
            .fixed(&self.nonce)
            .i64(self.issued_at)
            .i64(self.expires_at)
            .fixed(&self.signature);
        w.finish()
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<Self, Reason> {
        let mut r = Reader::new(bytes);
        let invitation = Self {
            collective_id: r.fixed()?,
            inviter: r.fixed()?,
            nonce: r.fixed()?,
            issued_at: r.i64()?,
            expires_at: r.i64()?,
            signature: r.fixed()?,
        };
        r.finish()?;
        Ok(invitation)
    }

    /// Перевірка на поточному журналі: запрошувач — активний учасник із перевіреним ключем,
    /// підпис дійсний, строк не минув. Одноразовість перевіряє [`InvitationLedger`].
    pub fn verify(&self, membership: &InMemoryMembership, now: i64) -> Result<(), Reason> {
        if &self.collective_id != membership.collective_id() {
            return Err(Reason::ExchangeNotBound);
        }
        if membership.revoked_at(&self.inviter).is_some() {
            return Err(Reason::MemberRevoked);
        }
        let inviter = membership
            .bound_member(&self.inviter)
            .ok_or(Reason::ExchangeNotBound)?;
        identity::verify(
            &inviter.public().sign,
            &self.signed_bytes(),
            &self.signature,
        )
        .map_err(|_| Reason::BadSignature)?;
        if !matches!(
            self.expires_at.checked_sub(self.issued_at),
            Some(1..=MAX_INVITATION_SECONDS)
        ) {
            return Err(Reason::Malformed);
        }
        if now >= self.expires_at {
            return Err(Reason::InvitationExpired);
        }
        Ok(())
    }
}

/// Відповідь запрошеного: зв'язування, перший пристрій і підпис над nonce запрошення.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct JoinRequest {
    pub invitation: Invitation,
    pub binding: ExchangeBinding,
    pub device: DeviceRecord,
    pub signature: [u8; SIGNATURE_LEN],
}

impl JoinRequest {
    fn signed_bytes(
        invitation: &Invitation,
        binding: &ExchangeBinding,
        device: &DeviceRecord,
    ) -> Vec<u8> {
        let mut w = Writer::with_capacity(labels::JOIN_REQUEST.len() + 512);
        w.fixed(labels::JOIN_REQUEST)
            .fixed(&invitation.nonce)
            .fixed(&invitation.collective_id)
            .var(&binding.to_bytes())
            .var(&device.to_bytes());
        w.finish()
    }

    /// Запрошений будує відповідь: зв'язує свій ключ обміну з колективом із запрошення і
    /// підтверджує свій перший пристрій.
    pub fn build(
        invitation: Invitation,
        member: &MemberIdentity,
        device: &identity::DevicePublic,
        now: i64,
    ) -> Self {
        let binding = member.bind_exchange(invitation.collective_id, now);
        let device = member.issue_device(device, now);
        let signature = member.sign(&Self::signed_bytes(&invitation, &binding, &device));
        Self {
            invitation,
            binding,
            device,
            signature,
        }
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        let mut w = Writer::with_capacity(Invitation::LEN + 512);
        w.var(&self.invitation.to_bytes())
            .var(&self.binding.to_bytes())
            .var(&self.device.to_bytes())
            .fixed(&self.signature);
        w.finish()
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<Self, Reason> {
        let mut r = Reader::new(bytes);
        let invitation = Invitation::from_bytes(r.var()?)?;
        let binding = ExchangeBinding::from_bytes(r.var()?)?;
        let device = DeviceRecord::from_bytes(r.var()?)?;
        let signature = r.fixed()?;
        r.finish()?;
        Ok(Self {
            invitation,
            binding,
            device,
            signature,
        })
    }
}

/// Використані nonce запрошень: кожен талон впускає рівно одного учасника. Збереження між
/// запусками — у сховищі колективу (наступний зріз); тут — у пам'яті.
#[derive(Default)]
pub struct InvitationLedger {
    used: HashSet<[u8; ID_LEN]>,
}

impl InvitationLedger {
    pub fn new() -> Self {
        Self::default()
    }

    /// Реєстр з уже використаних талонів (збережених у базі колективу).
    pub fn from_used(used: impl IntoIterator<Item = [u8; ID_LEN]>) -> Self {
        Self {
            used: used.into_iter().collect(),
        }
    }

    pub fn is_used(&self, nonce: &[u8; ID_LEN]) -> bool {
        self.used.contains(nonce)
    }

    pub fn len(&self) -> usize {
        self.used.len()
    }

    pub fn is_empty(&self) -> bool {
        self.used.is_empty()
    }
}

/// Результат вступу: номери записів журналу й обгортки ключів усіх епох для нового
/// учасника (`wraps[i]` — епоха `i`). Обгортки пересилають йому; відкритих ключів у них немає.
#[derive(Debug)]
pub struct Admission {
    pub member: MemberId,
    pub join_seq: u64,
    pub device_seq: u64,
    pub wraps: Vec<EpochWrap>,
}

impl Admission {
    /// Поточна епоха на момент вступу.
    pub fn epoch(&self) -> u32 {
        (self.wraps.len() - 1) as u32
    }
}

/// Вузол із журналом впускає запрошеного. Усі перевірки — на поточному журналі; будь-яка
/// відмова лишає журнал і реєстр без змін. Запис `Join` дописується лише після перевірки
/// запису пристрою, щоб у журналі не з'явився учасник без жодного пристрою. `epoch_keys[i]` —
/// ключ епохи `i`; їх має бути рівно `current_epoch + 1`, інакше [`Reason::UnknownEpoch`].
pub fn admit(
    membership: &mut InMemoryMembership,
    ledger: &mut InvitationLedger,
    epoch_keys: &[EpochKey],
    request: &JoinRequest,
    now: i64,
) -> Result<Admission, Reason> {
    let invitation = &request.invitation;
    invitation.verify(membership, now)?;
    if ledger.is_used(&invitation.nonce) {
        return Err(Reason::InvitationUsed);
    }
    let bound = request.binding.verify(membership.collective_id())?;
    identity::verify(
        &bound.public().sign,
        &JoinRequest::signed_bytes(invitation, &request.binding, &request.device),
        &request.signature,
    )
    .map_err(|_| Reason::BadSignature)?;
    if request.device.member_id != bound.member_id() {
        return Err(Reason::DeviceNotValid);
    }
    request.device.verify(bound.public())?;
    if membership.bound_member(&bound.member_id()).is_some()
        || membership.revoked_at(&bound.member_id()).is_some()
    {
        return Err(Reason::BindingNotNewer);
    }
    // Обгортки — до запису в журнал: слабкий ключ обміну відхиляється без сліду в журналі.
    if epoch_keys.len() != membership.current_epoch() as usize + 1 {
        return Err(Reason::UnknownEpoch);
    }
    let wraps = epoch_keys
        .iter()
        .enumerate()
        .map(|(epoch, key)| wrap_epoch_key(key, epoch as u32, &bound))
        .collect::<Result<Vec<_>, _>>()?;
    let join_seq = membership.join(&request.binding)?;
    let device_seq = membership.add_device(&request.device)?;
    ledger.used.insert(invitation.nonce);
    Ok(Admission {
        member: bound.member_id(),
        join_seq,
        device_seq,
        wraps,
    })
}

/// Новий учасник розгортає ключі епох зі своїх обгорток; обгортка не тієї епохи на своєму
/// місці — [`Reason::UnknownEpoch`].
pub fn accept(member: &MemberIdentity, wraps: &[EpochWrap]) -> Result<Vec<EpochKey>, Reason> {
    wraps
        .iter()
        .enumerate()
        .map(|(epoch, wrap)| {
            if wrap.epoch != epoch as u32 {
                return Err(Reason::UnknownEpoch);
            }
            unwrap_epoch_key(wrap, member)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::collective::identity::DeviceIdentity;

    const T0: i64 = 1_761_800_000;

    struct World {
        collective: CollectiveId,
        membership: InMemoryMembership,
        ledger: InvitationLedger,
        keys: Vec<EpochKey>,
        alice: MemberIdentity,
    }

    impl World {
        fn new() -> Self {
            let alice = MemberIdentity::generate();
            let collective = [3; ID_LEN];
            let mut membership = InMemoryMembership::new(collective);
            membership
                .join(&alice.bind_exchange(collective, T0))
                .unwrap();
            Self {
                collective,
                membership,
                ledger: InvitationLedger::new(),
                keys: vec![EpochKey::generate()],
                alice,
            }
        }

        fn invite(&self) -> Invitation {
            Invitation::issue(&self.alice, self.collective, T0, T0 + 3600).unwrap()
        }

        fn admit(&mut self, request: &JoinRequest, now: i64) -> Result<Admission, Reason> {
            admit(
                &mut self.membership,
                &mut self.ledger,
                &self.keys,
                request,
                now,
            )
        }
    }

    #[test]
    fn invited_member_joins_with_a_device_and_opens_the_epoch_key() {
        let mut w = World::new();
        let bob = MemberIdentity::generate();
        let bob_device = DeviceIdentity::generate();
        let invitation = Invitation::from_bytes(&w.invite().to_bytes()).unwrap();
        let request = JoinRequest::from_bytes(
            &JoinRequest::build(invitation, &bob, &bob_device.public(), T0 + 10).to_bytes(),
        )
        .unwrap();
        let admission = w.admit(&request, T0 + 20).unwrap();
        assert_eq!(admission.member, bob.member_id());
        assert_eq!((admission.join_seq, admission.device_seq), (2, 3));
        assert_eq!(admission.epoch(), 0);
        assert_eq!(w.membership.active_members(), 2);
        assert!(w
            .membership
            .device_valid_at(3, &bob.member_id(), &bob_device.public().0));
        assert_eq!(
            accept(&bob, &admission.wraps).unwrap()[0].as_bytes(),
            w.keys[0].as_bytes()
        );
        let eve = MemberIdentity::generate();
        assert_eq!(
            accept(&eve, &admission.wraps).err(),
            Some(Reason::WrongRecipient)
        );
    }

    #[test]
    fn invitation_is_single_use_and_the_second_request_leaves_the_log_unchanged() {
        let mut w = World::new();
        let invitation = w.invite();
        let bob = MemberIdentity::generate();
        let carol = MemberIdentity::generate();
        let first = JoinRequest::build(invitation, &bob, &DeviceIdentity::generate().public(), T0);
        let second =
            JoinRequest::build(invitation, &carol, &DeviceIdentity::generate().public(), T0);
        w.admit(&first, T0 + 1).unwrap();
        assert_eq!(w.admit(&second, T0 + 2).err(), Some(Reason::InvitationUsed));
        assert_eq!(w.membership.latest_seq(), 3);
        assert_eq!(w.ledger.len(), 1);
        // Повторний вступ того самого учасника тим самим талоном — теж відмова.
        assert_eq!(w.admit(&first, T0 + 3).err(), Some(Reason::InvitationUsed));
    }

    #[test]
    fn expired_malformed_and_foreign_invitations_are_rejected() {
        let mut w = World::new();
        let bob = MemberIdentity::generate();
        let device = DeviceIdentity::generate().public();
        let invitation = w.invite();
        let request = JoinRequest::build(invitation, &bob, &device, T0);
        assert_eq!(
            w.admit(&request, invitation.expires_at).err(),
            Some(Reason::InvitationExpired)
        );
        assert_eq!(
            Invitation::issue(&w.alice, w.collective, T0, T0).err(),
            Some(Reason::Malformed)
        );
        assert_eq!(
            Invitation::issue(&w.alice, w.collective, T0, T0 + MAX_INVITATION_SECONDS + 1).err(),
            Some(Reason::Malformed)
        );
        // Запрошення в інший колектив.
        let foreign = Invitation::issue(&w.alice, [9; ID_LEN], T0, T0 + 10).unwrap();
        let request = JoinRequest::build(foreign, &bob, &device, T0);
        assert_eq!(
            w.admit(&request, T0 + 1).err(),
            Some(Reason::ExchangeNotBound)
        );
        // Запрошувач не учасник цього колективу.
        let stranger = MemberIdentity::generate();
        let fake = Invitation::issue(&stranger, w.collective, T0, T0 + 10).unwrap();
        let request = JoinRequest::build(fake, &bob, &device, T0);
        assert_eq!(
            w.admit(&request, T0 + 1).err(),
            Some(Reason::ExchangeNotBound)
        );
        // Підроблений підпис запрошувача.
        let mut tampered = w.invite();
        tampered.expires_at += 1;
        let request = JoinRequest::build(tampered, &bob, &device, T0);
        assert_eq!(w.admit(&request, T0 + 1).err(), Some(Reason::BadSignature));
        assert_eq!(w.membership.latest_seq(), 1);
    }

    #[test]
    fn revoked_inviter_cannot_admit_and_revoked_member_cannot_rejoin() {
        let mut w = World::new();
        let bob = MemberIdentity::generate();
        let device = DeviceIdentity::generate().public();
        let bob_request = JoinRequest::build(w.invite(), &bob, &device, T0);
        w.admit(&bob_request, T0 + 1).unwrap();
        let bob_invites = Invitation::issue(&bob, w.collective, T0 + 2, T0 + 100).unwrap();
        w.membership.revoke(&bob.member_id());
        let carol = MemberIdentity::generate();
        let request = JoinRequest::build(bob_invites, &carol, &device, T0 + 3);
        assert_eq!(w.admit(&request, T0 + 4).err(), Some(Reason::MemberRevoked));
        // Відкликаний Боб не вступає знову навіть за новим талоном Аліси.
        let again = JoinRequest::build(w.invite(), &bob, &device, T0 + 5);
        assert_eq!(w.admit(&again, T0 + 6).err(), Some(Reason::BindingNotNewer));
    }

    #[test]
    fn request_is_bound_to_its_invitation_and_to_the_member() {
        let mut w = World::new();
        let bob = MemberIdentity::generate();
        let device = DeviceIdentity::generate().public();
        let first = w.invite();
        let second = w.invite();
        let request = JoinRequest::build(first, &bob, &device, T0);
        // Чуже зв'язування під іншим талоном.
        let moved = JoinRequest {
            invitation: second,
            ..request
        };
        assert_eq!(w.admit(&moved, T0 + 1).err(), Some(Reason::BadSignature));
        // Пристрій, підтверджений іншим учасником.
        let mallory = MemberIdentity::generate();
        let swapped = JoinRequest {
            device: mallory.issue_device(&device, T0),
            ..request
        };
        assert_eq!(w.admit(&swapped, T0 + 1).err(), Some(Reason::BadSignature));
        assert_eq!(w.membership.latest_seq(), 1);
        assert!(w.ledger.is_empty());
        // Непошкоджений запит після невдалих спроб проходить.
        assert!(w.admit(&request, T0 + 1).is_ok());
    }

    #[test]
    fn admission_after_a_rotation_wraps_the_current_epoch() {
        let mut w = World::new();
        let bob = MemberIdentity::generate();
        let device = DeviceIdentity::generate().public();
        w.admit(&JoinRequest::build(w.invite(), &bob, &device, T0), T0 + 1)
            .unwrap();
        let (_, epoch) = w.membership.revoke(&bob.member_id());
        assert_eq!(epoch, 1);
        w.keys.push(EpochKey::generate());
        let carol = MemberIdentity::generate();
        let admission = w
            .admit(
                &JoinRequest::build(w.invite(), &carol, &device, T0 + 2),
                T0 + 3,
            )
            .unwrap();
        assert_eq!(admission.epoch(), 1);
        let keys = accept(&carol, &admission.wraps).unwrap();
        assert_eq!(keys.len(), 2, "новий учасник отримує й минулу епоху (К3)");
        for (got, want) in keys.iter().zip(&w.keys) {
            assert_eq!(got.as_bytes(), want.as_bytes());
        }
        // Обгортки не на своїх місцях не приймаються.
        let mut shuffled = admission.wraps;
        shuffled.swap(0, 1);
        assert_eq!(accept(&carol, &shuffled).err(), Some(Reason::UnknownEpoch));
    }

    #[test]
    fn admission_needs_a_key_for_every_epoch() {
        let mut w = World::new();
        let bob = MemberIdentity::generate();
        let device = DeviceIdentity::generate().public();
        w.admit(&JoinRequest::build(w.invite(), &bob, &device, T0), T0 + 1)
            .unwrap();
        w.membership.revoke(&bob.member_id());
        let carol = MemberIdentity::generate();
        let request = JoinRequest::build(w.invite(), &carol, &device, T0 + 2);
        // Ключа епохи 1 у вузла немає: вступ не проходить і журнал не змінюється.
        let before = w.membership.latest_seq();
        assert_eq!(w.admit(&request, T0 + 3).err(), Some(Reason::UnknownEpoch));
        assert_eq!(w.membership.latest_seq(), before);
        assert!(!w.ledger.is_used(&request.invitation.nonce));
    }
}
