//! Канонічне бінарне кодування (ADR, розділ 3): big-endian, фіксовані поля без префікса,
//! змінні — з довжиною `u32` перед даними, порядок полів — як у розділі 2.4 ADR. Без
//! зовнішнього крейта: та сама схема перевіряється в `tests/collective-crypto-vectors.test.mjs`.

use super::Reason;

/// Послідовний запис полів.
#[derive(Default)]
pub struct Writer {
    bytes: Vec<u8>,
}

impl Writer {
    pub fn with_capacity(capacity: usize) -> Self {
        Self {
            bytes: Vec::with_capacity(capacity),
        }
    }

    pub fn u8(&mut self, value: u8) -> &mut Self {
        self.bytes.push(value);
        self
    }

    pub fn u16(&mut self, value: u16) -> &mut Self {
        self.bytes.extend_from_slice(&value.to_be_bytes());
        self
    }

    pub fn u32(&mut self, value: u32) -> &mut Self {
        self.bytes.extend_from_slice(&value.to_be_bytes());
        self
    }

    pub fn u64(&mut self, value: u64) -> &mut Self {
        self.bytes.extend_from_slice(&value.to_be_bytes());
        self
    }

    pub fn i64(&mut self, value: i64) -> &mut Self {
        self.bytes.extend_from_slice(&value.to_be_bytes());
        self
    }

    /// Поле сталої довжини — без префікса.
    pub fn fixed(&mut self, value: &[u8]) -> &mut Self {
        self.bytes.extend_from_slice(value);
        self
    }

    /// Поле змінної довжини — `u32` довжина, потім байти.
    pub fn var(&mut self, value: &[u8]) -> &mut Self {
        let len = u32::try_from(value.len()).expect("поле понад 4 ГіБ");
        self.u32(len);
        self.bytes.extend_from_slice(value);
        self
    }

    /// Необов'язкове поле: 0 — немає, 1 — є і далі значення.
    pub fn option_i64(&mut self, value: Option<i64>) -> &mut Self {
        match value {
            None => self.u8(0),
            Some(v) => self.u8(1).i64(v),
        }
    }

    pub fn finish(self) -> Vec<u8> {
        self.bytes
    }
}

/// Послідовне читання; будь-яка нестача байтів — [`Reason::Malformed`].
pub struct Reader<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    pub fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, pos: 0 }
    }

    fn take(&mut self, len: usize) -> Result<&'a [u8], Reason> {
        let end = self.pos.checked_add(len).ok_or(Reason::Malformed)?;
        let slice = self.bytes.get(self.pos..end).ok_or(Reason::Malformed)?;
        self.pos = end;
        Ok(slice)
    }

    pub fn u8(&mut self) -> Result<u8, Reason> {
        Ok(self.take(1)?[0])
    }

    pub fn u16(&mut self) -> Result<u16, Reason> {
        Ok(u16::from_be_bytes(self.take(2)?.try_into().unwrap()))
    }

    pub fn u32(&mut self) -> Result<u32, Reason> {
        Ok(u32::from_be_bytes(self.take(4)?.try_into().unwrap()))
    }

    pub fn u64(&mut self) -> Result<u64, Reason> {
        Ok(u64::from_be_bytes(self.take(8)?.try_into().unwrap()))
    }

    pub fn i64(&mut self) -> Result<i64, Reason> {
        Ok(i64::from_be_bytes(self.take(8)?.try_into().unwrap()))
    }

    pub fn fixed<const N: usize>(&mut self) -> Result<[u8; N], Reason> {
        Ok(self.take(N)?.try_into().unwrap())
    }

    pub fn var(&mut self) -> Result<&'a [u8], Reason> {
        let len = usize::try_from(self.u32()?).map_err(|_| Reason::Malformed)?;
        self.take(len)
    }

    pub fn option_i64(&mut self) -> Result<Option<i64>, Reason> {
        match self.u8()? {
            0 => Ok(None),
            1 => Ok(Some(self.i64()?)),
            _ => Err(Reason::Malformed),
        }
    }

    /// Решта байтів до кінця (для шифротексту після заголовка).
    pub fn rest(&mut self) -> &'a [u8] {
        let rest = &self.bytes[self.pos..];
        self.pos = self.bytes.len();
        rest
    }

    /// Після повного розбору зайвих байтів бути не повинно.
    pub fn finish(self) -> Result<(), Reason> {
        if self.pos == self.bytes.len() {
            Ok(())
        } else {
            Err(Reason::Malformed)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_all_field_kinds() {
        let mut w = Writer::default();
        w.u8(7)
            .u16(0x0102)
            .u32(0x0a0b0c0d)
            .u64(1 << 40)
            .i64(-5)
            .fixed(&[9, 9, 9])
            .var(b"abc")
            .option_i64(None)
            .option_i64(Some(42));
        let bytes = w.finish();
        let mut r = Reader::new(&bytes);
        assert_eq!(r.u8().unwrap(), 7);
        assert_eq!(r.u16().unwrap(), 0x0102);
        assert_eq!(r.u32().unwrap(), 0x0a0b0c0d);
        assert_eq!(r.u64().unwrap(), 1 << 40);
        assert_eq!(r.i64().unwrap(), -5);
        assert_eq!(r.fixed::<3>().unwrap(), [9, 9, 9]);
        assert_eq!(r.var().unwrap(), b"abc");
        assert_eq!(r.option_i64().unwrap(), None);
        assert_eq!(r.option_i64().unwrap(), Some(42));
        r.finish().unwrap();
    }

    #[test]
    fn truncated_and_trailing_bytes_are_malformed() {
        let bytes = [0u8, 0, 0, 5, 1, 2];
        assert_eq!(Reader::new(&bytes).var().unwrap_err(), Reason::Malformed);
        let bytes = [1u8, 2];
        let mut r = Reader::new(&bytes);
        r.u8().unwrap();
        assert_eq!(r.finish().unwrap_err(), Reason::Malformed);
        let bytes = [2u8];
        assert_eq!(
            Reader::new(&bytes).option_i64().unwrap_err(),
            Reason::Malformed
        );
    }

    #[test]
    fn encoding_is_big_endian_with_u32_length_prefix() {
        let mut w = Writer::default();
        w.u16(1).var(b"xy");
        assert_eq!(w.finish(), vec![0, 1, 0, 0, 0, 2, b'x', b'y']);
    }
}
