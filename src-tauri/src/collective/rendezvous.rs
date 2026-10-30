//! Сервер зустрічі для вступу за кодом (E8, обмін між містами; рішення JE від 30.10.2026
//! 09:30Z). Зводить дві копії EasyWAR за номером скриньки — двома першими цифрами коду
//! ([`PairCode::slot`](super::pairing::PairCode::slot)) — і пересилає між ними непрозорі
//! повідомлення: PAKE, теги підтвердження і кадри [`PairChannel`](super::pairing::PairChannel).
//!
//! Що сервер знає: номер скриньки, час, розміри повідомлень. Чого не знає: чотирьох секретних
//! цифр, ключів, членства, вмісту. Членства він не дає: вступ завершує лише підписаний запис
//! у журналі складу після підтвердження обох сторін.
//!
//! Обмеження (план власника, 4.2):
//! - скринька живе [`CODE_TTL_SECONDS`]; одна скринька — один новий учасник: друга спроба
//!   приєднатися до вже зайнятої скриньки відхиляється й рахується як підозріла;
//! - глобальні ліміти відкриття скриньок і спроб приєднання за хвилину ([`RATE_WINDOW_SECONDS`]);
//! - черга на кожну сторону обмежена кількістю й розміром повідомлень.
//!
//! Модуль — чиста логіка без мережі: HTTP-обгортка й окремий процес сервера — наступний
//! зріз. Стан тримається лише в пам'яті й зникає з перезапуском.

use std::collections::{HashMap, VecDeque};

use super::pairing::{CODE_TTL_SECONDS, MAX_FRAME_PLAINTEXT};
use super::{random_array, ID_LEN};

/// Скільки скриньок (дві цифри коду).
pub const SLOTS: u8 = 100;
/// Вікно глобальних лімітів.
pub const RATE_WINDOW_SECONDS: i64 = 60;
/// Скільки нових скриньок за вікно.
pub const MAX_OPENS_PER_WINDOW: usize = 30;
/// Скільки спроб приєднання за вікно (зокрема невдалих).
pub const MAX_JOINS_PER_WINDOW: usize = 30;
/// Найбільше повідомлення: кадр каналу з запасом на заголовок і тег.
pub const MAX_MESSAGE: usize = MAX_FRAME_PLAINTEXT + 256;
/// Скільки повідомлень чекає на одну сторону.
pub const MAX_QUEUED: usize = 16;

/// Ключ доступу сторони до скриньки: випадкові 16 байтів, видаються при відкритті чи
/// приєднанні й ходять лише в захищеному транспорті (TLS).
pub type SlotToken = [u8; ID_LEN];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RendezvousDenied {
    /// Усі 100 скриньок зайняті.
    Full,
    /// Перевищено глобальний ліміт за хвилину.
    RateLimited,
    /// Скриньки немає або строк минув.
    NoSuchSlot,
    /// До скриньки вже приєднався новий учасник.
    AlreadyJoined,
    /// Невідомий ключ доступу.
    BadToken,
    /// Повідомлення завелике.
    TooLarge,
    /// Інша сторона не забирає повідомлення.
    QueueFull,
}

impl RendezvousDenied {
    pub fn message(self) -> &'static str {
        match self {
            RendezvousDenied::Full => "усі скриньки зайняті, спробуйте за кілька хвилин",
            RendezvousDenied::RateLimited => "забагато спроб, спробуйте за хвилину",
            RendezvousDenied::NoSuchSlot => "код не знайдено або строк минув",
            RendezvousDenied::AlreadyJoined => "за цим кодом уже приєднуються",
            RendezvousDenied::BadToken => "доступ до скриньки не підтверджено",
            RendezvousDenied::TooLarge => "повідомлення завелике",
            RendezvousDenied::QueueFull => "інша сторона не відповідає",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Side {
    Host,
    Guest,
}

struct Slot {
    opened_at: i64,
    host: SlotToken,
    guest: Option<SlotToken>,
    to_host: VecDeque<Vec<u8>>,
    to_guest: VecDeque<Vec<u8>>,
}

impl Slot {
    fn side(&self, token: &SlotToken) -> Option<Side> {
        if constant_eq(&self.host, token) {
            Some(Side::Host)
        } else if self.guest.is_some_and(|guest| constant_eq(&guest, token)) {
            Some(Side::Guest)
        } else {
            None
        }
    }
}

fn constant_eq(a: &SlotToken, b: &SlotToken) -> bool {
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Стан сервера зустрічі в пам'яті.
#[derive(Default)]
pub struct Rendezvous {
    slots: HashMap<u8, Slot>,
    opens: VecDeque<i64>,
    joins: VecDeque<i64>,
    suspicious: u64,
}

impl Rendezvous {
    pub fn new() -> Self {
        Self::default()
    }

    fn sweep(&mut self, now: i64) {
        self.slots
            .retain(|_, slot| now >= slot.opened_at && now - slot.opened_at < CODE_TTL_SECONDS);
        for window in [&mut self.opens, &mut self.joins] {
            while window
                .front()
                .is_some_and(|at| now - at >= RATE_WINDOW_SECONDS || *at > now)
            {
                window.pop_front();
            }
        }
    }

    fn admit(window: &mut VecDeque<i64>, limit: usize, now: i64) -> Result<(), RendezvousDenied> {
        if window.len() >= limit {
            return Err(RendezvousDenied::RateLimited);
        }
        window.push_back(now);
        Ok(())
    }

    /// Власник коду відкриває скриньку: сервер вибирає вільний номер навмання.
    pub fn open(&mut self, now: i64) -> Result<(u8, SlotToken), RendezvousDenied> {
        self.sweep(now);
        let free: Vec<u8> = (0..SLOTS)
            .filter(|slot| !self.slots.contains_key(slot))
            .collect();
        if free.is_empty() {
            return Err(RendezvousDenied::Full);
        }
        Self::admit(&mut self.opens, MAX_OPENS_PER_WINDOW, now)?;
        let pick = u16::from_le_bytes(random_array::<2>()) as usize % free.len();
        let slot = free[pick];
        let host = random_array::<ID_LEN>();
        self.slots.insert(
            slot,
            Slot {
                opened_at: now,
                host,
                guest: None,
                to_host: VecDeque::new(),
                to_guest: VecDeque::new(),
            },
        );
        Ok((slot, host))
    }

    /// Новий учасник приєднується за номером скриньки. Лише один раз на скриньку.
    pub fn join(&mut self, slot: u8, now: i64) -> Result<SlotToken, RendezvousDenied> {
        self.sweep(now);
        Self::admit(&mut self.joins, MAX_JOINS_PER_WINDOW, now)?;
        let Some(entry) = self.slots.get_mut(&slot) else {
            self.suspicious += 1;
            return Err(RendezvousDenied::NoSuchSlot);
        };
        if entry.guest.is_some() {
            self.suspicious += 1;
            return Err(RendezvousDenied::AlreadyJoined);
        }
        let guest = random_array::<ID_LEN>();
        entry.guest = Some(guest);
        Ok(guest)
    }

    fn slot_for(
        &mut self,
        slot: u8,
        token: &SlotToken,
        now: i64,
    ) -> Result<(&mut Slot, Side), RendezvousDenied> {
        self.sweep(now);
        let entry = self
            .slots
            .get_mut(&slot)
            .ok_or(RendezvousDenied::NoSuchSlot)?;
        let side = entry.side(token).ok_or(RendezvousDenied::BadToken)?;
        Ok((entry, side))
    }

    /// Покласти повідомлення для іншої сторони.
    pub fn post(
        &mut self,
        slot: u8,
        token: &SlotToken,
        message: &[u8],
        now: i64,
    ) -> Result<(), RendezvousDenied> {
        if message.len() > MAX_MESSAGE {
            return Err(RendezvousDenied::TooLarge);
        }
        let (entry, side) = self.slot_for(slot, token, now)?;
        let queue = match side {
            Side::Host => &mut entry.to_guest,
            Side::Guest => &mut entry.to_host,
        };
        if queue.len() >= MAX_QUEUED {
            return Err(RendezvousDenied::QueueFull);
        }
        queue.push_back(message.to_vec());
        Ok(())
    }

    /// Забрати всі повідомлення для себе (по порядку).
    pub fn take(
        &mut self,
        slot: u8,
        token: &SlotToken,
        now: i64,
    ) -> Result<Vec<Vec<u8>>, RendezvousDenied> {
        let (entry, side) = self.slot_for(slot, token, now)?;
        let queue = match side {
            Side::Host => &mut entry.to_host,
            Side::Guest => &mut entry.to_guest,
        };
        Ok(queue.drain(..).collect())
    }

    /// Закрити скриньку (будь-яка сторона): вступ завершено або скасовано.
    pub fn close(&mut self, slot: u8, token: &SlotToken, now: i64) -> Result<(), RendezvousDenied> {
        self.slot_for(slot, token, now)?;
        self.slots.remove(&slot);
        Ok(())
    }

    /// Скільки спроб приєднання було до неіснуючої чи вже зайнятої скриньки.
    pub fn suspicious_attempts(&self) -> u64 {
        self.suspicious
    }

    /// Відкритих скриньок зараз.
    pub fn open_slots(&self) -> usize {
        self.slots.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::collective::pairing::{PairCode, PairStart, Role};

    const T0: i64 = 1_761_800_000;

    #[test]
    fn two_sides_meet_and_finish_pake_through_the_server() {
        let mut server = Rendezvous::new();
        let (slot, host_token) = server.open(T0).unwrap();
        let code = PairCode::generate(slot).unwrap();
        // Код продиктовано; новий учасник набирає його й приєднується за номером скриньки.
        let dictated = PairCode::parse(&code.display()).unwrap();
        let guest_token = server.join(dictated.slot(), T0 + 5).unwrap();

        let (host, to_guest) = PairStart::begin(Role::Host, &code);
        let (guest, to_host) = PairStart::begin(Role::Guest, &dictated);
        server.post(slot, &host_token, &to_guest, T0 + 6).unwrap();
        server.post(slot, &guest_token, &to_host, T0 + 6).unwrap();
        let host = host
            .finish(&server.take(slot, &host_token, T0 + 7).unwrap()[0])
            .unwrap();
        let guest = guest
            .finish(&server.take(slot, &guest_token, T0 + 7).unwrap()[0])
            .unwrap();
        server
            .post(slot, &host_token, &host.confirmation(), T0 + 8)
            .unwrap();
        server
            .post(slot, &guest_token, &guest.confirmation(), T0 + 8)
            .unwrap();
        let mut host = host
            .verify(&server.take(slot, &host_token, T0 + 9).unwrap()[0])
            .unwrap();
        let mut guest = guest
            .verify(&server.take(slot, &guest_token, T0 + 9).unwrap()[0])
            .unwrap();
        let frame = host.seal(b"invitation").unwrap();
        server.post(slot, &host_token, &frame, T0 + 10).unwrap();
        let frames = server.take(slot, &guest_token, T0 + 11).unwrap();
        assert_eq!(guest.open(&frames[0]).unwrap(), b"invitation");
        server.close(slot, &guest_token, T0 + 12).unwrap();
        assert_eq!(server.open_slots(), 0);
        assert_eq!(server.suspicious_attempts(), 0);
    }

    #[test]
    fn one_guest_per_slot_and_strangers_are_counted() {
        let mut server = Rendezvous::new();
        let (slot, _) = server.open(T0).unwrap();
        server.join(slot, T0 + 1).unwrap();
        assert_eq!(
            server.join(slot, T0 + 2).err(),
            Some(RendezvousDenied::AlreadyJoined)
        );
        let other = (slot + 1) % SLOTS;
        assert_eq!(
            server.join(other, T0 + 3).err(),
            Some(RendezvousDenied::NoSuchSlot)
        );
        assert_eq!(server.suspicious_attempts(), 2);
    }

    #[test]
    fn slot_expires_with_the_code() {
        let mut server = Rendezvous::new();
        let (slot, host) = server.open(T0).unwrap();
        assert_eq!(
            server.join(slot, T0 + CODE_TTL_SECONDS).err(),
            Some(RendezvousDenied::NoSuchSlot)
        );
        assert_eq!(
            server.take(slot, &host, T0 + CODE_TTL_SECONDS).err(),
            Some(RendezvousDenied::NoSuchSlot)
        );
        assert_eq!(server.open_slots(), 0);
    }

    #[test]
    fn foreign_token_cannot_read_or_write() {
        let mut server = Rendezvous::new();
        let (slot, host) = server.open(T0).unwrap();
        let guest = server.join(slot, T0).unwrap();
        server.post(slot, &host, b"secret frame", T0).unwrap();
        let stranger = [9u8; ID_LEN];
        assert_eq!(
            server.take(slot, &stranger, T0).err(),
            Some(RendezvousDenied::BadToken)
        );
        assert_eq!(
            server.post(slot, &stranger, b"x", T0).err(),
            Some(RendezvousDenied::BadToken)
        );
        assert_eq!(
            server.close(slot, &stranger, T0).err(),
            Some(RendezvousDenied::BadToken)
        );
        // Свої повідомлення сторона не отримує назад.
        assert!(server.take(slot, &host, T0).unwrap().is_empty());
        assert_eq!(
            server.take(slot, &guest, T0).unwrap(),
            vec![b"secret frame".to_vec()]
        );
    }

    #[test]
    fn global_rate_limits_hold_for_a_minute() {
        let mut server = Rendezvous::new();
        for i in 0..MAX_OPENS_PER_WINDOW {
            server.open(T0 + i as i64 % 10).unwrap();
        }
        assert_eq!(
            server.open(T0 + 10).err(),
            Some(RendezvousDenied::RateLimited)
        );
        assert!(server.open(T0 + RATE_WINDOW_SECONDS + 10).is_ok());

        let mut server = Rendezvous::new();
        for _ in 0..MAX_JOINS_PER_WINDOW {
            let _ = server.join(42, T0);
        }
        assert_eq!(
            server.join(42, T0 + 1).err(),
            Some(RendezvousDenied::RateLimited)
        );
        assert_eq!(
            server.join(42, T0 + RATE_WINDOW_SECONDS).err(),
            Some(RendezvousDenied::NoSuchSlot)
        );
    }

    #[test]
    fn all_slots_busy_and_slots_are_distinct() {
        let mut server = Rendezvous::new();
        let mut seen = std::collections::HashSet::new();
        // Обходимо ліміт за хвилину, відкриваючи скриньки в різні хвилини одного строку коду.
        for i in 0..SLOTS as i64 {
            let now = T0 + (i / MAX_OPENS_PER_WINDOW as i64) * RATE_WINDOW_SECONDS;
            let (slot, _) = server.open(now).unwrap();
            assert!(seen.insert(slot), "скринька видана двічі");
        }
        assert_eq!(
            server.open(T0 + 4 * RATE_WINDOW_SECONDS).err(),
            Some(RendezvousDenied::Full)
        );
    }

    #[test]
    fn message_size_and_queue_are_capped() {
        let mut server = Rendezvous::new();
        let (slot, host) = server.open(T0).unwrap();
        server.join(slot, T0).unwrap();
        assert_eq!(
            server
                .post(slot, &host, &vec![0; MAX_MESSAGE + 1], T0)
                .err(),
            Some(RendezvousDenied::TooLarge)
        );
        for _ in 0..MAX_QUEUED {
            server.post(slot, &host, b"m", T0).unwrap();
        }
        assert_eq!(
            server.post(slot, &host, b"m", T0).err(),
            Some(RendezvousDenied::QueueFull)
        );
    }
}
