//! Таблиця профілю як зашифрована копія в даних профілю.
//!
//! Таблицю додають у профіль один раз: файл читається, перевіряється як книга XLSX і
//! кладеться зашифрованим записом `tables.<слот>` у теку даних профілю
//! ([`crate::profile_data`]). Далі застосунок працює лише з копією, а оригінал не
//! потрібен і не змінюється. Щоб оновити таблицю, її додають знову: нова копія замінює
//! стару, а замінена лишається одним записом `tables.<слот>.prev`.
//!
//! У `local_profile_tables.path` для такої таблиці лежить не шлях, а позначка
//! `profile-data:tables.<слот>/<назва файлу>`: інтерфейс показує назву так само, як шлях
//! (останній сегмент), а ядро за префіксом розуміє, що читати треба копію.

use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::{DateTime, Duration as ChronoDuration, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};

use crate::{
    local_profiles::Branch,
    profile_data::{DataKeys, ProfileDataError, ProfileDataStore, Record},
    profile_table::{
        count_data_rows, rows_collapsed, validate_workbook, ProfileTableError,
        COLLAPSE_GUARD_WINDOW, PREVIOUS_COPY_MIN_AGE,
    },
};

/// Початок позначки в `local_profile_tables.path`.
pub const MARKER_PREFIX: &str = "profile-data:";
/// Найбільша книга (як для файлу на диску).
pub const MAX_XLSX_BYTES: usize = 64 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum TableCopyError {
    #[error("{0}")]
    Data(#[from] ProfileDataError),
    #[error("{0}")]
    Table(#[from] ProfileTableError),
    #[error("Копія таблиці в профілі пошкоджена")]
    Damaged,
    #[error("Таблицю ще не додано до профілю")]
    Missing,
    #[error("Некоректний файл XLSX")]
    NotXlsx,
    #[error("Файл XLSX перевищує обмеження 64 МБ")]
    TooLarge,
}

/// Позначка таблиці: чи шлях у базі насправді вказує на копію в профілі.
/// Усі слоти таблиць профілю.
pub const BRANCHES: [Branch; 6] = [
    Branch::Air,
    Branch::Rocket,
    Branch::Pvk,
    Branch::Dshv,
    Branch::PvkLosses,
    Branch::DshvLosses,
];

pub fn is_marker(path: &str) -> bool {
    path.starts_with(MARKER_PREFIX)
}

/// Назва файлу, під якою таблицю додали (з позначки).
pub fn marker_name(path: &str) -> Option<&str> {
    path.strip_prefix(MARKER_PREFIX)
        .and_then(|rest| rest.split_once('/'))
        .map(|(_, name)| name)
}

/// Позначка для бази: без роздільників шляху в назві, щоб інтерфейс показав саме назву.
pub fn marker(branch: Branch, file_name: &str) -> String {
    format!("{MARKER_PREFIX}{}/{}", key(branch), clean_name(file_name))
}

pub fn key(branch: Branch) -> String {
    format!("tables.{}", branch.as_str())
}

fn previous_key(branch: Branch) -> String {
    format!("{}.prev", key(branch))
}

fn clean_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if matches!(c, '/' | '\\') || c.is_control() {
                '_'
            } else {
                c
            }
        })
        .collect();
    let cleaned = cleaned.trim();
    if cleaned.is_empty() {
        "table.xlsx".to_owned()
    } else {
        cleaned.chars().take(120).collect()
    }
}

#[derive(Serialize, Deserialize)]
struct Body {
    name: String,
    added: String,
    xlsx: String,
}

/// Копія таблиці, прочитана з профілю.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredTable {
    pub name: String,
    /// Коли таблицю додали (RFC 3339).
    pub added: String,
    /// Час останнього запису копії (RFC 3339).
    pub modified: String,
    pub bytes: Vec<u8>,
}

fn decode(record: Record) -> Result<StoredTable, TableCopyError> {
    let body: Body = serde_json::from_str(&record.value).map_err(|_| TableCopyError::Damaged)?;
    let bytes = STANDARD
        .decode(body.xlsx.as_bytes())
        .map_err(|_| TableCopyError::Damaged)?;
    Ok(StoredTable {
        name: body.name,
        added: body.added,
        modified: record.modified,
        bytes,
    })
}

fn read_key(
    store: &ProfileDataStore,
    keys: &DataKeys,
    key: &str,
) -> Result<Option<StoredTable>, TableCopyError> {
    store.get(keys, key)?.map(decode).transpose()
}

fn write_key(
    store: &ProfileDataStore,
    keys: &DataKeys,
    key: &str,
    name: &str,
    added: &str,
    bytes: &[u8],
) -> Result<(), TableCopyError> {
    let body = Body {
        name: name.to_owned(),
        added: added.to_owned(),
        xlsx: STANDARD.encode(bytes),
    };
    let value = serde_json::to_string(&body).map_err(|_| TableCopyError::Damaged)?;
    store.set(keys, key, &value)?;
    Ok(())
}

fn check_xlsx(bytes: &[u8]) -> Result<(), TableCopyError> {
    if bytes.len() > MAX_XLSX_BYTES {
        return Err(TableCopyError::TooLarge);
    }
    if !bytes.starts_with(b"PK") {
        return Err(TableCopyError::NotXlsx);
    }
    Ok(())
}

/// Поточна копія таблиці.
pub fn load(
    store: &ProfileDataStore,
    keys: &DataKeys,
    branch: Branch,
) -> Result<StoredTable, TableCopyError> {
    read_key(store, keys, &key(branch))?.ok_or(TableCopyError::Missing)
}

/// Попередня копія (стан до останньої заміни), якщо вона є.
pub fn load_previous(
    store: &ProfileDataStore,
    keys: &DataKeys,
    branch: Branch,
) -> Result<Option<StoredTable>, TableCopyError> {
    read_key(store, keys, &previous_key(branch))
}

fn parse_time(text: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(text)
        .ok()
        .map(|time| time.with_timezone(&Utc))
}

/// Чи можна перенести поточну копію в попередню, не втративши кращий стан.
/// `min_age` — не оновлювати попередню частіше (для автозбереження); `None` для явного додавання.
fn may_rotate(
    branch: Branch,
    current: &StoredTable,
    previous: Option<&StoredTable>,
    min_age: Option<ChronoDuration>,
    now: DateTime<Utc>,
) -> bool {
    // Пошкоджена поточна копія не повинна витіснити останню добру.
    if validate_workbook(branch, &current.bytes).is_err() {
        return false;
    }
    let Some(previous) = previous else {
        return true;
    };
    let previous_written = parse_time(&previous.modified);
    if let (Some(min_age), Some(written)) = (min_age, previous_written) {
        if now.signed_duration_since(written) < min_age {
            return false;
        }
    }
    // Коректна, але майже порожня таблиця теж не повинна витіснити попередню копію:
    // захист діє, поки між записом попередньої й останнім записом поточної менше доби.
    let current_written = parse_time(&current.modified);
    let guard = ChronoDuration::from_std(COLLAPSE_GUARD_WINDOW).unwrap_or(ChronoDuration::days(1));
    let within_window = match (previous_written, current_written) {
        (Some(prev), Some(cur)) => cur.signed_duration_since(prev) < guard,
        _ => true,
    };
    if within_window {
        if let (Some(before), Some(after)) = (
            count_data_rows(branch, &previous.bytes),
            count_data_rows(branch, &current.bytes),
        ) {
            if rows_collapsed(before, after) {
                return false;
            }
        }
    }
    true
}

fn rotate(
    store: &ProfileDataStore,
    keys: &DataKeys,
    branch: Branch,
    current: &StoredTable,
    min_age: Option<ChronoDuration>,
) -> Result<(), TableCopyError> {
    let previous = read_key(store, keys, &previous_key(branch)).unwrap_or(None);
    if may_rotate(branch, current, previous.as_ref(), min_age, Utc::now()) {
        write_key(
            store,
            keys,
            &previous_key(branch),
            &current.name,
            &current.added,
            &current.bytes,
        )
        .map_err(|error| {
            ProfileTableError::PreviousCopy(std::io::Error::other(error.to_string()))
        })?;
    }
    Ok(())
}

/// Додає таблицю до профілю: нова копія замінює стару, замінена стає попередньою.
/// Другий раз додана таблиця — це оновлення. Оригінальний файл не змінюється.
pub fn add(
    store: &ProfileDataStore,
    keys: &DataKeys,
    branch: Branch,
    file_name: &str,
    bytes: &[u8],
) -> Result<String, TableCopyError> {
    check_xlsx(bytes)?;
    let name = clean_name(file_name);
    if let Some(current) = read_key(store, keys, &key(branch)).unwrap_or(None) {
        rotate(store, keys, branch, &current, None)?;
    }
    let added = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    write_key(store, keys, &key(branch), &name, &added, bytes)?;
    Ok(marker(branch, &name))
}

/// Зберігає зміни таблиці, внесені модулем (назва й час додавання лишаються).
/// Книга перевіряється, попередня копія оновлюється не частіше за `PREVIOUS_COPY_MIN_AGE`.
pub fn save(
    store: &ProfileDataStore,
    keys: &DataKeys,
    branch: Branch,
    bytes: &[u8],
) -> Result<(), TableCopyError> {
    check_xlsx(bytes)?;
    validate_workbook(branch, bytes)?;
    let current = load(store, keys, branch)?;
    let min_age = ChronoDuration::from_std(PREVIOUS_COPY_MIN_AGE).ok();
    rotate(store, keys, branch, &current, min_age)?;
    write_key(
        store,
        keys,
        &key(branch),
        &current.name,
        &current.added,
        bytes,
    )
}

/// Прибирає копію й попередню копію таблиці (відв'язування). → `true`, якщо копія була.
pub fn remove(
    store: &ProfileDataStore,
    keys: &DataKeys,
    branch: Branch,
) -> Result<bool, TableCopyError> {
    let had = store.remove(keys, &key(branch))?;
    store.remove(keys, &previous_key(branch))?;
    Ok(had)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{base_tables::BaseTable, office_library::KdfParams};

    const PROFILE: &str = "profile-0123456789abcdef01234567";

    async fn setup() -> (tempfile::TempDir, ProfileDataStore, DataKeys) {
        let dir = tempfile::tempdir().unwrap();
        let store = ProfileDataStore::with_kdf(
            dir.path().join("profile-data"),
            KdfParams {
                m_kib: 8,
                t: 1,
                p: 1,
            },
        );
        let keys = store.unlock(PROFILE, "синтетичний-пароль").await.unwrap();
        (dir, store, keys)
    }

    fn base() -> Vec<u8> {
        BaseTable::Air.bytes().to_vec()
    }

    #[test]
    fn marker_shows_the_file_name_as_the_last_segment() {
        let text = marker(Branch::Air, "Журнал/ПС\\2026.xlsx");
        assert!(is_marker(&text));
        assert_eq!(marker_name(&text), Some("Журнал_ПС_2026.xlsx"));
        assert_eq!(text.rsplit(['/', '\\']).next(), Some("Журнал_ПС_2026.xlsx"));
        assert!(!is_marker("/home/u/table.xlsx"));
        assert_eq!(marker_name("/home/u/table.xlsx"), None);
    }

    #[tokio::test]
    async fn added_table_is_stored_encrypted_and_read_back() {
        let (dir, store, keys) = setup().await;
        let bytes = base();
        let marker = add(&store, &keys, Branch::Air, "Журнал.xlsx", &bytes).unwrap();
        assert_eq!(marker_name(&marker), Some("Журнал.xlsx"));
        let loaded = load(&store, &keys, Branch::Air).unwrap();
        assert_eq!(loaded.bytes, bytes);
        assert_eq!(loaded.name, "Журнал.xlsx");
        // На диску немає відкритої книги: жоден файл теки профілю не містить ознаки ZIP+вмісту.
        let mut found = false;
        for entry in walk(dir.path()) {
            let data = std::fs::read(entry).unwrap();
            assert!(!data
                .windows(bytes.len().min(64))
                .any(|w| w == &bytes[..bytes.len().min(64)]));
            found = true;
        }
        assert!(found);
    }

    fn walk(path: &std::path::Path) -> Vec<std::path::PathBuf> {
        let mut files = Vec::new();
        for entry in std::fs::read_dir(path).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                files.extend(walk(&path));
            } else {
                files.push(path);
            }
        }
        files
    }

    #[tokio::test]
    async fn adding_again_replaces_the_copy_and_keeps_one_previous() {
        let (_dir, store, keys) = setup().await;
        let first = base();
        add(&store, &keys, Branch::Air, "a.xlsx", &first).unwrap();
        assert!(load_previous(&store, &keys, Branch::Air).unwrap().is_none());
        let second = BaseTable::Rvia.bytes().to_vec();
        add(&store, &keys, Branch::Air, "b.xlsx", &second).unwrap();
        let loaded = load(&store, &keys, Branch::Air).unwrap();
        assert_eq!(loaded.name, "b.xlsx");
        assert_eq!(loaded.bytes, second);
        let previous = load_previous(&store, &keys, Branch::Air).unwrap().unwrap();
        assert_eq!(previous.name, "a.xlsx");
        assert_eq!(previous.bytes, first);
    }

    #[tokio::test]
    async fn save_keeps_name_and_validates_the_workbook() {
        let (_dir, store, keys) = setup().await;
        add(&store, &keys, Branch::Air, "a.xlsx", &base()).unwrap();
        assert!(matches!(
            save(&store, &keys, Branch::Air, b"PK-not-a-workbook"),
            Err(TableCopyError::Table(_))
        ));
        assert!(matches!(
            save(&store, &keys, Branch::Air, b"plain text"),
            Err(TableCopyError::NotXlsx)
        ));
        // Перевірки не змінили копію.
        assert_eq!(load(&store, &keys, Branch::Air).unwrap().bytes, base());
        let updated = BaseTable::Air.bytes().to_vec();
        save(&store, &keys, Branch::Air, &updated).unwrap();
        assert_eq!(load(&store, &keys, Branch::Air).unwrap().name, "a.xlsx");
    }

    #[tokio::test]
    async fn save_without_a_copy_reports_missing() {
        let (_dir, store, keys) = setup().await;
        assert!(matches!(
            save(&store, &keys, Branch::Rocket, BaseTable::Rvia.bytes()),
            Err(TableCopyError::Missing)
        ));
        assert!(matches!(
            load(&store, &keys, Branch::Rocket),
            Err(TableCopyError::Missing)
        ));
    }

    #[tokio::test]
    async fn remove_clears_the_copy_and_the_previous_one() {
        let (_dir, store, keys) = setup().await;
        add(&store, &keys, Branch::Air, "a.xlsx", &base()).unwrap();
        add(&store, &keys, Branch::Air, "b.xlsx", &base()).unwrap();
        assert!(remove(&store, &keys, Branch::Air).unwrap());
        assert!(matches!(
            load(&store, &keys, Branch::Air),
            Err(TableCopyError::Missing)
        ));
        assert!(load_previous(&store, &keys, Branch::Air).unwrap().is_none());
        assert!(!remove(&store, &keys, Branch::Air).unwrap());
    }

    #[tokio::test]
    async fn other_branches_do_not_share_copies() {
        let (_dir, store, keys) = setup().await;
        add(&store, &keys, Branch::Air, "a.xlsx", &base()).unwrap();
        assert!(matches!(
            load(&store, &keys, Branch::Rocket),
            Err(TableCopyError::Missing)
        ));
    }

    #[tokio::test]
    async fn rejects_files_that_are_not_workbooks_or_too_large() {
        let (_dir, store, keys) = setup().await;
        assert!(matches!(
            add(&store, &keys, Branch::Air, "a.xlsx", b"hello"),
            Err(TableCopyError::NotXlsx)
        ));
        assert!(load(&store, &keys, Branch::Air).is_err());
    }

    #[tokio::test]
    async fn rotation_is_skipped_for_a_damaged_current_copy() {
        let (_dir, store, keys) = setup().await;
        let good = base();
        add(&store, &keys, Branch::Air, "good.xlsx", &good).unwrap();
        // «Поточною» стає книга, що проходить лише перевірку ZIP-сигнатури.
        add(
            &store,
            &keys,
            Branch::Air,
            "odd.xlsx",
            b"PK-broken-but-added",
        )
        .unwrap();
        add(&store, &keys, Branch::Air, "next.xlsx", &good).unwrap();
        let previous = load_previous(&store, &keys, Branch::Air).unwrap().unwrap();
        // Пошкоджена поточна копія не витіснила останню добру попередню.
        assert_eq!(previous.name, "good.xlsx");
    }
}
