//! Огляди таблиць, з яких модуль підтягує дані під час створення.
//!
//! Кожен огляд (`inspect_linked_module_source`, `pick_module_source`) дістає непрозорий
//! ідентифікатор. За ним Rust пам'ятає шлях до файла, вікно, профіль і сеанс входу, у
//! яких таблицю оглянули, та відбиток (SHA-256) прочитаних байтів. Читання аркуша
//! приймає лише цей ідентифікатор, а не шлях: інше вікно, інший профіль чи новий сеанс
//! входу його не використають, а змінений після огляду файл не буде прочитано мовчки.
//! Шляхи у frontend не повертаються.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use sha2::{Digest, Sha256};

/// Скільки живе огляд без нового звернення до нього.
const SELECTION_TTL: Duration = Duration::from_secs(60 * 60);

/// Звідки таблиця: прив'язана до профілю для гілки дашборда або обрана у вікні вибору.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SelectionOrigin {
    Linked { branch: String },
    Picked,
}

impl SelectionOrigin {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Linked { .. } => "linked",
            Self::Picked => "picked",
        }
    }
}

/// Хто оглянув таблицю: вікно, профіль і номер сеансу входу.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SelectionOwner {
    pub window: String,
    pub profile_id: String,
    pub session_epoch: u64,
}

#[derive(Clone, Debug)]
pub struct SourceSelection {
    pub path: PathBuf,
    pub origin: SelectionOrigin,
    pub owner: SelectionOwner,
    pub digest: [u8; 32],
    touched: Instant,
}

impl SourceSelection {
    pub fn new(
        path: PathBuf,
        origin: SelectionOrigin,
        owner: SelectionOwner,
        digest: [u8; 32],
    ) -> Self {
        Self {
            path,
            origin,
            owner,
            digest,
            touched: Instant::now(),
        }
    }
}

#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum SelectionError {
    #[error("Огляд таблиці застарів або його закрито: оберіть чи перечитайте таблицю ще раз")]
    Unknown,
    #[error("Цю таблицю оглянуто в іншому вікні: оберіть її в цьому вікні ще раз")]
    OtherWindow,
    #[error("Таблицю оглянуто в іншому профілі або до виходу з профілю: оберіть її ще раз")]
    OtherSession,
    #[error("Таблицю змінено після огляду: перечитайте її, щоб імпортувати актуальні дані")]
    Changed,
    #[error("Прив'язку таблиці профілю змінено після огляду: перечитайте таблицю")]
    Rebound,
}

/// Відбиток вмісту файла: за ним видно, що таблицю змінили між оглядом і читанням.
pub fn digest(bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(bytes).into()
}

#[derive(Default)]
struct Inner {
    counter: u64,
    entries: HashMap<String, SourceSelection>,
}

#[derive(Default)]
pub struct SourceSelections(Mutex<Inner>);

impl SourceSelections {
    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Запам'ятовує огляд і повертає його ідентифікатор. Попередні огляди того самого
    /// вікна забуваються: у вікні одночасно відкрито лише одну форму створення.
    pub fn register(&self, selection: SourceSelection) -> String {
        let mut inner = self.lock();
        inner.counter += 1;
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_nanos());
        let mut hasher = Sha256::new();
        hasher.update(inner.counter.to_le_bytes());
        hasher.update(nanos.to_le_bytes());
        hasher.update((self as *const Self as usize).to_le_bytes());
        hasher.update(selection.digest);
        let id = format!(
            "src-{}",
            hasher.finalize()[..16]
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>()
        );
        let window = selection.owner.window.clone();
        inner.entries.retain(|_, entry| {
            entry.owner.window != window && entry.touched.elapsed() < SELECTION_TTL
        });
        inner.entries.insert(id.clone(), selection);
        id
    }

    /// Огляд для читання: лише для того самого вікна, профілю й сеансу входу. Огляд
    /// іншого профілю чи сеансу забувається.
    pub fn resolve(
        &self,
        id: &str,
        owner: &SelectionOwner,
    ) -> Result<SourceSelection, SelectionError> {
        let mut inner = self.lock();
        let entry = inner.entries.get_mut(id).ok_or(SelectionError::Unknown)?;
        if entry.touched.elapsed() >= SELECTION_TTL {
            inner.entries.remove(id);
            return Err(SelectionError::Unknown);
        }
        if entry.owner.window != owner.window {
            return Err(SelectionError::OtherWindow);
        }
        if entry.owner.profile_id != owner.profile_id
            || entry.owner.session_epoch != owner.session_epoch
        {
            inner.entries.remove(id);
            return Err(SelectionError::OtherSession);
        }
        entry.touched = Instant::now();
        Ok(entry.clone())
    }

    /// Забуває огляд після закриття форми; чужий огляд не чіпає.
    pub fn release(&self, id: &str, window: &str) {
        let mut inner = self.lock();
        if inner
            .entries
            .get(id)
            .is_some_and(|entry| entry.owner.window == window)
        {
            inner.entries.remove(id);
        }
    }

    /// Забуває огляди закритого вікна.
    pub fn forget_window(&self, window: &str) {
        self.lock()
            .entries
            .retain(|_, entry| entry.owner.window != window);
    }

    /// Забуває всі огляди: після входу в профіль, зміни профілю чи виходу з нього.
    pub fn clear(&self) {
        self.lock().entries.clear();
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.lock().entries.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn owner(window: &str, profile: &str, epoch: u64) -> SelectionOwner {
        SelectionOwner {
            window: window.into(),
            profile_id: profile.into(),
            session_epoch: epoch,
        }
    }

    fn picked(path: &str, owner: SelectionOwner, bytes: &[u8]) -> SourceSelection {
        SourceSelection::new(
            PathBuf::from(path),
            SelectionOrigin::Picked,
            owner,
            digest(bytes),
        )
    }

    #[test]
    fn two_windows_each_read_only_their_own_workbook() {
        let selections = SourceSelections::default();
        let a = owner("main", "p1", 1);
        let b = owner("second", "p1", 1);
        let id_a = selections.register(picked("/synthetic/A.xlsx", a.clone(), b"A"));
        let id_b = selections.register(picked("/synthetic/B.xlsx", b.clone(), b"B"));
        assert_ne!(id_a, id_b);
        assert_eq!(
            selections.resolve(&id_a, &a).unwrap().path,
            PathBuf::from("/synthetic/A.xlsx")
        );
        assert_eq!(
            selections.resolve(&id_b, &b).unwrap().path,
            PathBuf::from("/synthetic/B.xlsx")
        );
        // Ідентифікатор чужого вікна не відкриває чужий файл.
        assert_eq!(
            selections.resolve(&id_b, &a).unwrap_err(),
            SelectionError::OtherWindow
        );
        assert_eq!(
            selections.resolve(&id_a, &b).unwrap_err(),
            SelectionError::OtherWindow
        );
    }

    #[test]
    fn an_old_id_stops_working_after_the_profile_or_session_changes() {
        let selections = SourceSelections::default();
        let id = selections.register(picked("/synthetic/A.xlsx", owner("main", "p1", 1), b"A"));
        assert_eq!(
            selections
                .resolve(&id, &owner("main", "p2", 2))
                .unwrap_err(),
            SelectionError::OtherSession
        );
        // Повернення до того самого профілю — новий сеанс: старий огляд уже забуто.
        assert_eq!(
            selections
                .resolve(&id, &owner("main", "p1", 3))
                .unwrap_err(),
            SelectionError::Unknown
        );
        let id = selections.register(picked("/synthetic/A.xlsx", owner("main", "p1", 3), b"A"));
        assert_eq!(
            selections
                .resolve(&id, &owner("main", "p1", 4))
                .unwrap_err(),
            SelectionError::OtherSession
        );
    }

    #[test]
    fn a_new_pick_replaces_the_previous_one_of_the_same_window_only() {
        let selections = SourceSelections::default();
        let main = owner("main", "p1", 1);
        let other = owner("second", "p1", 1);
        let first = selections.register(picked("/synthetic/A.xlsx", main.clone(), b"A"));
        let kept = selections.register(picked("/synthetic/C.xlsx", other.clone(), b"C"));
        let second = selections.register(picked("/synthetic/B.xlsx", main.clone(), b"B"));
        assert_eq!(
            selections.resolve(&first, &main).unwrap_err(),
            SelectionError::Unknown
        );
        assert!(selections.resolve(&second, &main).is_ok());
        assert!(selections.resolve(&kept, &other).is_ok());
    }

    #[test]
    fn closing_the_form_the_window_or_the_session_forgets_selections() {
        let selections = SourceSelections::default();
        let main = owner("main", "p1", 1);
        let other = owner("second", "p1", 1);
        let id = selections.register(picked("/synthetic/A.xlsx", main.clone(), b"A"));
        // Чуже вікно не закриє чужий огляд.
        selections.release(&id, "second");
        assert!(selections.resolve(&id, &main).is_ok());
        selections.release(&id, "main");
        assert_eq!(
            selections.resolve(&id, &main).unwrap_err(),
            SelectionError::Unknown
        );
        let id = selections.register(picked("/synthetic/B.xlsx", other.clone(), b"B"));
        selections.forget_window("second");
        assert_eq!(
            selections.resolve(&id, &other).unwrap_err(),
            SelectionError::Unknown
        );
        selections.register(picked("/synthetic/A.xlsx", main, b"A"));
        selections.register(picked("/synthetic/B.xlsx", other, b"B"));
        assert_eq!(selections.len(), 2);
        selections.clear();
        assert_eq!(selections.len(), 0);
    }

    #[test]
    fn the_digest_tells_a_changed_file_apart() {
        assert_eq!(digest(b"same"), digest(b"same"));
        assert_ne!(digest(b"before"), digest(b"after"));
    }
}
