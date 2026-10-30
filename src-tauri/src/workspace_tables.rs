//! Таблиці дашбордів у зашифрованому сховищі профілю (рішення власника 29.10.2026:
//! «таблиці, які ми відкриваємо для дашбордів, теж тут зберігаються» → варіант
//! «Таблиці в сховищі»). Таблиця лежить блобом `<id>.ewf` у підтеці `tables/` теки сховища
//! файлів профілю ([`crate::workspace_files::root_dir`]), запечатана тим самим ключем
//! бібліотеки ([`crate::office_library::LibraryKeys::seal_store_file`]); у метаданих — назва,
//! розмір і рід військ. Прив'язка профілю (`local_profile_tables.path`) замість шляху на
//! диску містить посилання `ewstore:<id>:<назва>` ([`store_ref`]); міграції бази не треба.
//!
//! Дашборд розшифровує таблицю при відкритті (`read_profile_database`) і запечатує при
//! збереженні (`write_profile_database`): байти перевіряються як книга
//! ([`crate::profile_table::validate_workbook`]), а попередній стан лишається поруч блобом
//! `<id>.prev.ewf` за тими ж правилами, що й `.easywar-prev.xlsx` на диску (не частіше ніж
//! раз на 5 хвилин; різке зменшення рядків копію не затирає). Усе це працює лише з
//! розблокованою бібліотекою: тому вхід у профіль паролем розблоковує її
//! (`activate_local_profile`).
//!
//! Файли цієї підтеки не з'являються у списку вкладки «Файли» як звичайні файли і не
//! відкриваються в редакторах «Робочого середовища» (як і таблиці на диску, прив'язані до
//! профілю): їх показує окремий розділ «Таблиці дашбордів» — лише копія на диск і видалення
//! таблиці, не прив'язаної до жодного профілю.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde::Serialize;
use zeroize::Zeroizing;

use crate::local_profiles::Branch;
use crate::office_library::{LibraryKeys, StoreFileMeta};
use crate::phone_export::{save_file, SaveTarget};
use crate::profile_table::{
    count_data_rows, rows_collapsed, validate_workbook, COLLAPSE_GUARD_WINDOW,
    PREVIOUS_COPY_MIN_AGE,
};
use crate::workspace_files::{
    modified_at, new_id, read_blob, validate_id, validate_name, WorkspaceFilesError, BLOB_EXT,
};

/// Підтека таблиць дашбордів у теці сховища профілю.
pub const TABLES_DIR_NAME: &str = "tables";
/// Префікс посилання на таблицю в сховищі у `local_profile_tables.path`.
pub const REF_PREFIX: &str = "ewstore:";
/// Суфікс блоба попередньої копії: `<id>.prev.ewf`.
const PREVIOUS_SUFFIX: &str = "prev";

/// Куди вказує прив'язка таблиці профілю: файл на диску або блоб у сховищі.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TableRef {
    Disk(PathBuf),
    Store { id: String, name: String },
}

impl TableRef {
    /// Назва таблиці для інтерфейсу (назва файлу або назва зі сховища).
    pub fn name(&self) -> String {
        match self {
            TableRef::Disk(path) => path
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| "table.xlsx".to_owned()),
            TableRef::Store { name, .. } => name.clone(),
        }
    }
}

/// Посилання на таблицю в сховищі: `ewstore:<32 hex>:<назва>`.
pub fn store_ref(id: &str, name: &str) -> String {
    format!("{REF_PREFIX}{id}:{name}")
}

/// Чи є рядок прив'язки посиланням на сховище (навіть зіпсованим).
pub fn is_store_ref(path: &str) -> bool {
    path.starts_with(REF_PREFIX)
}

/// Розбирає прив'язку: `ewstore:<id>:<назва>` → [`TableRef::Store`], інакше шлях на диску.
/// Зіпсоване посилання (не той id чи назва) повертається як `Disk`, і читання такого
/// «шляху» дає зрозумілу помилку файлової системи.
pub fn parse_ref(path: &str) -> TableRef {
    if let Some(rest) = path.strip_prefix(REF_PREFIX) {
        if let Some((id, name)) = rest.split_once(':') {
            if let (Ok(id), Ok(name)) = (validate_id(id), validate_name(name)) {
                return TableRef::Store {
                    id: id.to_owned(),
                    name,
                };
            }
        }
    }
    TableRef::Disk(PathBuf::from(path))
}

/// Ідентифікатори таблиць сховища серед усіх прив'язок профілів.
pub fn bound_ids<'a>(paths: impl IntoIterator<Item = &'a str>) -> Vec<String> {
    paths
        .into_iter()
        .filter_map(|path| match parse_ref(path) {
            TableRef::Store { id, .. } => Some(id),
            TableRef::Disk(_) => None,
        })
        .collect()
}

/// Підтека таблиць: `<тека сховища профілю>/tables`.
pub fn tables_dir(profile_dir: &Path) -> PathBuf {
    profile_dir.join(TABLES_DIR_NAME)
}

/// Шлях блоба таблиці в підтеці (для огляду джерела модулем — як шлях таблиці на диску).
pub fn blob_path(dir: &Path, id: &str) -> PathBuf {
    dir.join(format!("{id}.{BLOB_EXT}"))
}

fn previous_path(dir: &Path, id: &str) -> PathBuf {
    dir.join(format!("{id}.{PREVIOUS_SUFFIX}.{BLOB_EXT}"))
}

/// Таблиця дашборда в сховищі (контракт для розділу «Таблиці дашбордів» вкладки «Файли»).
/// `bound` ставить `lib.rs` за прив'язками профілів; для пошкодженого блоба
/// `damaged = true`, `name` — назва блоба на диску.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredTable {
    pub id: String,
    pub name: String,
    /// Рід військ (`Branch::as_str`) з метаданих блоба.
    pub branch: Option<String>,
    pub size: u64,
    pub modified_at: Option<String>,
    /// Чи є поруч блоб попередньої копії.
    pub has_previous: bool,
    pub damaged: bool,
    pub bound: bool,
}

/// Що сталося з попередньою копією під час запису (як у `profile_table`).
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Rotation {
    Updated,
    NotNeeded,
    Protected,
}

fn table_error(error: impl std::fmt::Display) -> WorkspaceFilesError {
    WorkspaceFilesError::Table(error.to_string())
}

fn stored_table(
    dir: &Path,
    id: &str,
    meta: &StoreFileMeta,
    metadata: &fs::Metadata,
) -> StoredTable {
    StoredTable {
        id: id.to_owned(),
        name: meta.name.clone(),
        branch: meta.branch.clone(),
        size: meta.size,
        modified_at: modified_at(metadata),
        has_previous: previous_path(dir, id).is_file(),
        damaged: false,
        bound: false,
    }
}

fn damaged_table(dir: &Path, id: &str, metadata: &fs::Metadata) -> StoredTable {
    StoredTable {
        id: id.to_owned(),
        name: format!("{id}.{BLOB_EXT}"),
        branch: None,
        size: metadata.len(),
        modified_at: modified_at(metadata),
        has_previous: previous_path(dir, id).is_file(),
        damaged: true,
        bound: false,
    }
}

/// Таблиці підтеки за назвою (без урахування регістру); попередні копії й сторонні
/// файли пропускаються, блоб іншого ключа лишається як пошкоджений.
pub fn list(dir: &Path, keys: &LibraryKeys) -> Result<Vec<StoredTable>, WorkspaceFilesError> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.into()),
    };
    let mut items = Vec::new();
    for entry in entries {
        let entry = entry?;
        let Some(file_name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        let Some(id) = file_name
            .strip_suffix(&format!(".{BLOB_EXT}"))
            .and_then(|id| validate_id(id).ok())
        else {
            continue;
        };
        let metadata = entry.metadata()?;
        if !metadata.is_file() {
            continue;
        }
        let item = match read_blob(&entry.path()).and_then(|data| {
            keys.open_store_meta(id, &data)
                .map_err(WorkspaceFilesError::from)
        }) {
            Ok(meta) => stored_table(dir, id, &meta, &metadata),
            Err(_) => damaged_table(dir, id, &metadata),
        };
        items.push(item);
    }
    items.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then_with(|| a.id.cmp(&b.id))
    });
    Ok(items)
}

fn resolve(dir: &Path, id: &str) -> Result<(String, PathBuf), WorkspaceFilesError> {
    let id = validate_id(id)?;
    let path = blob_path(dir, id);
    match fs::symlink_metadata(&path) {
        Ok(metadata) if metadata.is_file() => Ok((id.to_owned(), path)),
        Ok(_) => Err(WorkspaceFilesError::NotFound),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Err(WorkspaceFilesError::NotFound)
        }
        Err(error) => Err(error.into()),
    }
}

/// Розшифрована таблиця разом з метаданими.
pub fn read(
    dir: &Path,
    keys: &LibraryKeys,
    id: &str,
) -> Result<(StoredTable, Zeroizing<Vec<u8>>), WorkspaceFilesError> {
    let (id, path) = resolve(dir, id)?;
    let metadata = fs::metadata(&path)?;
    let (meta, bytes) = keys.open_store_file(&id, &read_blob(&path)?)?;
    Ok((stored_table(dir, &id, &meta, &metadata), bytes))
}

fn seal_to(
    keys: &LibraryKeys,
    id: &str,
    meta: &StoreFileMeta,
    bytes: &[u8],
    path: PathBuf,
    replace: bool,
) -> Result<(), WorkspaceFilesError> {
    let data = keys.seal_store_file(id, meta, bytes)?;
    let target = SaveTarget {
        path,
        replace_confirmed: replace,
    };
    save_file(&target, &data).map_err(|error| WorkspaceFilesError::Io(error.to_string()))
}

/// Запечатує книгу `bytes` новою таблицею сховища (перевірка книги для `branch`,
/// новий випадковий ідентифікатор). Повертає запис таблиці.
pub fn write_new(
    dir: &Path,
    keys: &LibraryKeys,
    name: &str,
    branch: Branch,
    bytes: &[u8],
) -> Result<StoredTable, WorkspaceFilesError> {
    let name = validate_name(name)?;
    if bytes.is_empty() {
        return Err(WorkspaceFilesError::Empty);
    }
    if bytes.len() > crate::workspace_files::MAX_FILE_BYTES {
        return Err(WorkspaceFilesError::TooLarge);
    }
    validate_workbook(branch, bytes).map_err(table_error)?;
    fs::create_dir_all(dir)?;
    let id = new_id();
    let meta = StoreFileMeta {
        name,
        size: bytes.len() as u64,
        branch: Some(branch.as_str().to_owned()),
    };
    let path = blob_path(dir, &id);
    seal_to(keys, &id, &meta, bytes, path.clone(), false)?;
    let metadata = fs::metadata(&path)?;
    Ok(stored_table(dir, &id, &meta, &metadata))
}

/// Запис дашборда: перевіряє книгу, за потреби ротує попередню копію й атомарно
/// замінює блоб (та сама назва й ідентифікатор).
pub fn save(
    dir: &Path,
    keys: &LibraryKeys,
    id: &str,
    branch: Branch,
    bytes: &[u8],
) -> Result<Rotation, WorkspaceFilesError> {
    save_with_policy(
        dir,
        keys,
        id,
        branch,
        bytes,
        PREVIOUS_COPY_MIN_AGE,
        SystemTime::now(),
    )
}

fn save_with_policy(
    dir: &Path,
    keys: &LibraryKeys,
    id: &str,
    branch: Branch,
    bytes: &[u8],
    min_age: Duration,
    now: SystemTime,
) -> Result<Rotation, WorkspaceFilesError> {
    let (id, path) = resolve(dir, id)?;
    if bytes.is_empty() {
        return Err(WorkspaceFilesError::Empty);
    }
    if bytes.len() > crate::workspace_files::MAX_FILE_BYTES {
        return Err(WorkspaceFilesError::TooLarge);
    }
    validate_workbook(branch, bytes).map_err(table_error)?;
    let current_blob = read_blob(&path)?;
    let (current_meta, current_bytes) = keys.open_store_file(&id, &current_blob)?;
    let metadata = fs::metadata(&path)?;
    let rotation = rotate_previous(
        dir,
        keys,
        &id,
        &current_meta,
        &current_bytes,
        metadata.modified().unwrap_or(now),
        branch,
        min_age,
        now,
    )?;
    let meta = StoreFileMeta {
        name: current_meta.name,
        size: bytes.len() as u64,
        branch: Some(branch.as_str().to_owned()),
    };
    seal_to(keys, &id, &meta, bytes, path, true)?;
    Ok(rotation)
}

/// Попередня копія — той самий блоб під назвою `<id>.prev.ewf` (переписується цілком,
/// не частіше ніж раз на `min_age`). Нечитабельна поточна книга копію не витісняє;
/// поточний стан, що виглядає як різке зменшення рядків відносно копії, записаної не
/// раніше ніж за добу до останнього запису таблиці, — теж ([`rows_collapsed`]).
#[allow(clippy::too_many_arguments)]
fn rotate_previous(
    dir: &Path,
    keys: &LibraryKeys,
    id: &str,
    current_meta: &StoreFileMeta,
    current_bytes: &[u8],
    table_written: SystemTime,
    branch: Branch,
    min_age: Duration,
    now: SystemTime,
) -> Result<Rotation, WorkspaceFilesError> {
    if current_bytes.is_empty() || validate_workbook(branch, current_bytes).is_err() {
        return Ok(Rotation::NotNeeded);
    }
    let previous = previous_path(dir, id);
    let previous_meta = match fs::symlink_metadata(&previous) {
        Ok(metadata) if metadata.file_type().is_file() && metadata.len() > 0 => Some(metadata),
        _ => None,
    };
    if let Some(metadata) = &previous_meta {
        let fresh = metadata
            .modified()
            .ok()
            .and_then(|modified| now.duration_since(modified).ok())
            .is_some_and(|age| age < min_age);
        if fresh {
            return Ok(Rotation::NotNeeded);
        }
        let within_window = metadata
            .modified()
            .ok()
            .and_then(|modified| table_written.duration_since(modified).ok())
            .is_none_or(|age| age < COLLAPSE_GUARD_WINDOW);
        if within_window {
            let previous_rows = read_blob(&previous)
                .ok()
                .and_then(|data| keys.open_store_file(id, &data).ok())
                .and_then(|(_, bytes)| count_data_rows(branch, &bytes));
            if let (Some(before), Some(after)) =
                (previous_rows, count_data_rows(branch, current_bytes))
            {
                if rows_collapsed(before, after) {
                    return Ok(Rotation::Protected);
                }
            }
        }
    }
    seal_to(keys, id, current_meta, current_bytes, previous, true)?;
    Ok(Rotation::Updated)
}

/// Видаляє таблицю зі сховища назавжди разом із попередньою копією. Чи прив'язана
/// вона до профілю, перевіряє викликач.
pub fn delete(dir: &Path, id: &str) -> Result<String, WorkspaceFilesError> {
    let (id, path) = resolve(dir, id)?;
    fs::remove_file(&path)?;
    match fs::remove_file(previous_path(dir, &id)) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::base_tables::BaseTable;
    use std::io::Write;

    const PROFILE: &str = "profile-0123456789abcdef0123456789abcdef";

    fn keys() -> LibraryKeys {
        LibraryKeys::for_tests(PROFILE, &[7u8; 32])
    }

    fn write(path: &Path, bytes: &[u8]) {
        let mut file = fs::File::create(path).unwrap();
        file.write_all(bytes).unwrap();
    }

    #[test]
    fn refs_round_trip_and_reject_garbage() {
        let id = new_id();
        let reference = store_ref(&id, "EasyWAR_РВ.xlsx");
        assert!(is_store_ref(&reference));
        assert_eq!(
            parse_ref(&reference),
            TableRef::Store {
                id: id.clone(),
                name: "EasyWAR_РВ.xlsx".to_owned()
            }
        );
        assert_eq!(parse_ref(&reference).name(), "EasyWAR_РВ.xlsx");
        let with_colon = store_ref(&id, "Звіт: жовтень.xlsx");
        assert!(
            matches!(parse_ref(&with_colon), TableRef::Store { name, .. } if name == "Звіт: жовтень.xlsx")
        );
        assert_eq!(
            parse_ref("/tmp/EasyWAR_ПС.xlsx"),
            TableRef::Disk(PathBuf::from("/tmp/EasyWAR_ПС.xlsx"))
        );
        assert_eq!(parse_ref("/tmp/EasyWAR_ПС.xlsx").name(), "EasyWAR_ПС.xlsx");
        for bad in [
            "ewstore:",
            "ewstore:abc:x.xlsx",
            &format!("ewstore:{id}"),
            &format!("ewstore:{id}:"),
            &format!("ewstore:{id}:../x.xlsx"),
        ] {
            assert!(
                matches!(parse_ref(bad), TableRef::Disk(_)),
                "{bad:?} не має читатися як сховище"
            );
            assert!(is_store_ref(bad));
        }
        let other = new_id();
        assert_eq!(
            bound_ids([
                "/a/b.xlsx",
                &reference,
                &store_ref(&other, "x.xlsx"),
                "ewstore:bad"
            ]),
            vec![id, other]
        );
    }

    #[test]
    fn dashboard_table_round_trip_with_previous_copy() {
        let keys = keys();
        let store = tempfile::tempdir().unwrap();
        let dir = tables_dir(&store.path().join("workspace-files").join(PROFILE));
        assert_eq!(list(&dir, &keys).unwrap(), Vec::new());

        let base = BaseTable::Rvia.bytes();
        assert!(write_new(
            &dir,
            &keys,
            "EasyWAR_РВ.xlsx",
            Branch::Rocket,
            b"not a workbook"
        )
        .unwrap_err()
        .to_string()
        .contains("XLSX"));
        let created = write_new(&dir, &keys, "EasyWAR_РВ.xlsx", Branch::Rocket, base).unwrap();
        assert_eq!(created.name, "EasyWAR_РВ.xlsx");
        assert_eq!(created.branch.as_deref(), Some("rocket"));
        assert_eq!(created.size, base.len() as u64);
        assert!(!created.has_previous && !created.damaged && !created.bound);
        let blob = fs::read(blob_path(&dir, &created.id)).unwrap();
        assert!(blob.starts_with(b"EWFS\x01"));
        let marker = b"[Content_Types].xml";
        assert!(base.windows(marker.len()).any(|w| w == marker));
        assert!(
            !blob.windows(marker.len()).any(|w| w == marker),
            "книга не лежить відкритою"
        );

        let (item, bytes) = read(&dir, &keys, &created.id).unwrap();
        assert_eq!(item, created);
        assert_eq!(&bytes[..], base);

        // Перший запис: копії ще немає → копія зі стану до запису.
        let now = SystemTime::now();
        let edited = BaseTable::Rvia.bytes().to_vec();
        let rotation = save_with_policy(
            &dir,
            &keys,
            &created.id,
            Branch::Rocket,
            &edited,
            Duration::from_secs(300),
            now,
        )
        .unwrap();
        assert_eq!(rotation, Rotation::Updated);
        assert!(previous_path(&dir, &created.id).is_file());
        let listed = list(&dir, &keys).unwrap();
        assert_eq!(listed.len(), 1, "попередня копія не є окремою таблицею");
        assert!(listed[0].has_previous);
        assert_eq!(listed[0].id, created.id);

        // Свіжа копія (молодша за min_age) не переписується.
        let now = SystemTime::now();
        let rotation = save_with_policy(
            &dir,
            &keys,
            &created.id,
            Branch::Rocket,
            &edited,
            Duration::from_secs(300),
            now,
        )
        .unwrap();
        assert_eq!(rotation, Rotation::NotNeeded);
        // Через min_age копія оновлюється знову.
        let later = SystemTime::now() + Duration::from_secs(301);
        let rotation = save_with_policy(
            &dir,
            &keys,
            &created.id,
            Branch::Rocket,
            &edited,
            Duration::from_secs(300),
            later,
        )
        .unwrap();
        assert_eq!(rotation, Rotation::Updated);
        let (_, previous) = keys
            .open_store_file(
                &created.id,
                &fs::read(previous_path(&dir, &created.id)).unwrap(),
            )
            .unwrap();
        assert_eq!(&previous[..], &edited[..]);

        assert_eq!(
            save_with_policy(
                &dir,
                &keys,
                &created.id,
                Branch::Rocket,
                b"",
                Duration::ZERO,
                now
            ),
            Err(WorkspaceFilesError::Empty)
        );
        assert!(save_with_policy(
            &dir,
            &keys,
            &created.id,
            Branch::Rocket,
            b"PK\x03\x04garbage",
            Duration::ZERO,
            now
        )
        .is_err());
        let stranger = LibraryKeys::for_tests(PROFILE, &[9u8; 32]);
        assert_eq!(
            save_with_policy(
                &dir,
                &stranger,
                &created.id,
                Branch::Rocket,
                base,
                Duration::ZERO,
                now
            ),
            Err(WorkspaceFilesError::Damaged)
        );
        assert_eq!(
            read(&dir, &keys, &new_id()).unwrap_err(),
            WorkspaceFilesError::NotFound
        );

        // Сторонні файли й чужий блоб у підтеці.
        write(&dir.join("notes.txt"), b"plain");
        let foreign = write_new(
            &dir,
            &stranger,
            "Чужа.xlsx",
            Branch::Air,
            BaseTable::Air.bytes(),
        )
        .unwrap();
        let listed = list(&dir, &keys).unwrap();
        assert_eq!(listed.len(), 2);
        assert!(listed.iter().any(|t| t.damaged && t.id == foreign.id));

        assert_eq!(delete(&dir, &created.id).unwrap(), created.id);
        assert!(!blob_path(&dir, &created.id).exists());
        assert!(!previous_path(&dir, &created.id).exists());
        assert_eq!(
            delete(&dir, &created.id),
            Err(WorkspaceFilesError::NotFound)
        );
        assert_eq!(delete(&dir, &foreign.id).unwrap(), foreign.id);
        assert!(dir.join("notes.txt").exists());
    }

    #[test]
    fn tables_subdir_is_not_listed_as_files() {
        let keys = keys();
        let store = tempfile::tempdir().unwrap();
        let profile_dir = store.path().join("workspace-files").join(PROFILE);
        let dir = tables_dir(&profile_dir);
        write_new(
            &dir,
            &keys,
            "EasyWAR_ПС.xlsx",
            Branch::Air,
            BaseTable::Air.bytes(),
        )
        .unwrap();
        assert_eq!(
            crate::workspace_files::list(&profile_dir, &keys).unwrap(),
            Vec::new(),
            "таблиці дашбордів не є файлами вкладки «Файли»"
        );
        assert_eq!(list(&dir, &keys).unwrap().len(), 1);
    }
}
