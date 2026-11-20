//! Безпечний запис робочої таблиці, прив'язаної до профілю.
//!
//! Модулі записують таблицю цілком, тож помилка серіалізації (порожня чи обрізана
//! книга) знищила б єдину робочу копію журналу. Перед заміною файлу:
//! 1. байти відкриваються як книга XLSX, а для відомих родів військ на місці має бути
//!    аркуш із заголовками (`Зведена` для ПС/РВ, `Таблиця 1` для ПВК); перед цим
//!    книга проходить межі розпакування ([`crate::xlsx_import::ZipLimits`]), щоб
//!    «ZIP-бомба» з webview не вичерпала пам'ять у calamine;
//! 2. поточний файл, якщо він сам є коректною книгою, копіюється поруч як
//!    `<назва>.easywar-prev.xlsx` — одна попередня копія, яка оновлюється не частіше
//!    за [`PREVIOUS_COPY_MIN_AGE`], щоб серія збережень поспіль не витіснила
//!    останній добрий стан. Копію також не затирають, якщо поточний файл виглядає
//!    як різке зменшення кількості рядків відносно неї ([`rows_collapsed`]): книга
//!    «лише заголовки» проходить перевірку на коректність, і без цього наступне
//!    збереження перенесло б її в копію й витіснило останній добрий стан;
//! 3. нові байти записуються у тимчасовий файл у тій самій папці й замінюють таблицю
//!    одним перейменуванням, після чого (на unix) синхронізується тека.
//!
//! Якщо копію зробити не вдалося, таблиця не змінюється. Сам запис таблиці
//! різке зменшення рядків не блокує: користувач має право очистити журнал.
//!
//! Таблиця-symlink: копію для неї не роблять (`symlink_metadata` не бачить
//! звичайного файлу), а `persist` замінює саме посилання звичайним файлом, тож ціль
//! посилання не змінюється. Цю поведінку лишено як є.

use std::{
    fs,
    io::{self, Cursor, Write},
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};

use calamine::{Data, Range, Reader, Xlsx};

use crate::{
    local_profiles::Branch,
    xlsx_import::{ensure_zip_within_limits_with, ZipLimits},
};

/// Суфікс файлу попередньої копії: `EasyWAR_РВ.xlsx` → `EasyWAR_РВ.easywar-prev.xlsx`.
pub const PREVIOUS_COPY_SUFFIX: &str = ".easywar-prev.xlsx";
/// Не оновлювати попередню копію частіше, ніж раз на цей час.
pub const PREVIOUS_COPY_MIN_AGE: Duration = Duration::from_secs(5 * 60);
/// Різке зменшення рядків рахується, лише якщо до нього було не менше стількох
/// рядків даних; у менших таблицях значущим вважається тільки повне очищення.
pub const COLLAPSE_MIN_ROWS: usize = 10;
/// Скільки діє захист копії від різкого зменшення рядків: між записом самої копії й
/// останнім записом таблиці. Таблиця, що працювала довше, вважається новим станом: інакше
/// після навмисного скорочення журналу копія застрягла б на старому стані назавжди. Час
/// міряється за самою таблицею, а не за годинником: застосунок, не запущений понад добу
/// після збою, не повинен «дочекатися» кінця захисту й затерти останню добру копію.
pub const COLLAPSE_GUARD_WINDOW: Duration = Duration::from_secs(24 * 60 * 60);

#[derive(Debug, thiserror::Error)]
pub enum ProfileTableError {
    #[error("Некоректний шлях до таблиці")]
    InvalidPath,
    #[error("Файл не відкривається як книга XLSX: {0}")]
    InvalidWorkbook(String),
    #[error("У книзі немає аркушів")]
    NoSheets,
    #[error("У книзі немає аркуша «{required}». Знайдені аркуші: {found}")]
    MissingSheet {
        required: &'static str,
        found: String,
    },
    #[error("На аркуші «{0}» немає рядка заголовків у першому рядку")]
    MissingHeaderRow(&'static str),
    #[error("Не вдалося зберегти попередню копію таблиці, тож таблицю не змінено: {0}")]
    PreviousCopy(io::Error),
    #[error("Не вдалося записати таблицю: {0}")]
    Write(io::Error),
}

/// Аркуш, без якого книга для цього роду військ не вважається таблицею EasyWAR.
/// Для інших гілок (ДШВ, «Наші втрати») назви аркушів не зафіксовані ні в Rust, ні в
/// JS: їх обирає користувач (див. `rankSheets` у `dashboard-module-catalog.js`), тож
/// перевіряється лише, що книга відкривається й має аркуші.
pub fn required_sheet(branch: Branch) -> Option<&'static str> {
    match branch {
        Branch::Air | Branch::Rocket | Branch::Army => Some("Зведена"),
        Branch::Pvk => Some("Таблиця 1"),
        _ => None,
    }
}

fn normalize_label(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn find_sheet(sheet_names: &[String], required: &str) -> Option<String> {
    sheet_names
        .iter()
        .find(|name| normalize_label(name) == normalize_label(required))
        .cloned()
}

/// Відкриває книгу, попередньо перевіривши межі розпакування.
fn open_workbook(
    bytes: &[u8],
    limits: ZipLimits,
) -> Result<Xlsx<Cursor<&[u8]>>, ProfileTableError> {
    ensure_zip_within_limits_with(bytes, limits)
        .map_err(|error| ProfileTableError::InvalidWorkbook(error.to_string()))?;
    Xlsx::new(Cursor::new(bytes))
        .map_err(|error| ProfileTableError::InvalidWorkbook(error.to_string()))
}

/// Перевіряє байти до запису. Нічого не змінює.
pub fn validate_workbook(branch: Branch, bytes: &[u8]) -> Result<(), ProfileTableError> {
    validate_workbook_with_limits(branch, bytes, ZipLimits::DEFAULT)
}

fn validate_workbook_with_limits(
    branch: Branch,
    bytes: &[u8],
    limits: ZipLimits,
) -> Result<(), ProfileTableError> {
    let mut workbook = open_workbook(bytes, limits)?;
    let sheet_names = workbook.sheet_names();
    if sheet_names.is_empty() {
        return Err(ProfileTableError::NoSheets);
    }
    let Some(required) = required_sheet(branch) else {
        return Ok(());
    };
    let sheet =
        find_sheet(&sheet_names, required).ok_or_else(|| ProfileTableError::MissingSheet {
            required,
            found: sheet_names
                .iter()
                .map(|name| format!("«{name}»"))
                .collect::<Vec<_>>()
                .join(", "),
        })?;
    let range = workbook
        .worksheet_range(&sheet)
        .map_err(|error| ProfileTableError::InvalidWorkbook(error.to_string()))?;
    let has_header = range.start().is_some_and(|(row, _)| row == 0)
        && range
            .rows()
            .next()
            .is_some_and(|cells| cells.iter().any(|cell| !cell.to_string().trim().is_empty()));
    if !has_header {
        return Err(ProfileTableError::MissingHeaderRow(required));
    }
    Ok(())
}

fn cell_has_content(cell: &Data) -> bool {
    match cell {
        Data::Empty => false,
        Data::String(text) => !text.trim().is_empty(),
        _ => true,
    }
}

/// Рядки даних на аркуші: непорожні рядки без першого (рядка заголовків).
fn sheet_data_rows(range: &Range<Data>) -> usize {
    range
        .rows()
        .filter(|cells| cells.iter().any(cell_has_content))
        .count()
        .saturating_sub(1)
}

/// Кількість рядків даних у книзі. Для ПС, РВ і ПВК — на обов'язковому аркуші; для
/// гілок без фіксованої структури — сума по всіх аркушах (на кожному аркуші перший
/// непорожній рядок вважається заголовком). `None`, якщо книгу не вдалося прочитати.
pub fn count_data_rows(branch: Branch, bytes: &[u8]) -> Option<usize> {
    let mut workbook = open_workbook(bytes, ZipLimits::DEFAULT).ok()?;
    let sheet_names = workbook.sheet_names();
    let sheets = match required_sheet(branch) {
        Some(required) => vec![find_sheet(&sheet_names, required)?],
        None => sheet_names,
    };
    let mut rows = 0usize;
    for sheet in sheets {
        let range = workbook.worksheet_range(&sheet).ok()?;
        rows = rows.saturating_add(sheet_data_rows(&range));
    }
    Some(rows)
}

/// Чи виглядає перехід від `before` до `after` рядків даних як різке зменшення:
/// 1. рядки були, а тепер жодного (повне очищення), або
/// 2. було не менше [`COLLAPSE_MIN_ROWS`] рядків, а стало менш ніж половина
///    (рівно половина ще не різке зменшення).
pub fn rows_collapsed(before: usize, after: usize) -> bool {
    if before == 0 {
        return false;
    }
    after == 0 || (before >= COLLAPSE_MIN_ROWS && after.saturating_mul(2) < before)
}

/// Шлях попередньої копії поруч із таблицею.
pub fn previous_copy_path(table: &Path) -> Result<PathBuf, ProfileTableError> {
    let stem = table
        .file_stem()
        .filter(|stem| !stem.is_empty())
        .ok_or(ProfileTableError::InvalidPath)?;
    let mut name = stem.to_os_string();
    name.push(PREVIOUS_COPY_SUFFIX);
    Ok(table.with_file_name(name))
}

#[derive(Debug, Eq, PartialEq)]
pub enum SaveOutcome {
    /// Таблицю записано. `previous_copy_updated` — копію оновлено станом до цього
    /// запису; `previous_copy_protected` — копію свідомо не чіпали, бо поточна
    /// таблиця виглядає як різке зменшення рядків відносно неї ([`rows_collapsed`]).
    /// Команда `write_profile_database` цей результат не віддає в JS.
    Saved {
        previous_copy_updated: bool,
        previous_copy_protected: bool,
    },
}

/// Що сталося з попередньою копією під час запису.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Rotation {
    Updated,
    NotNeeded,
    Protected,
}

/// Перевіряє, за потреби ротує попередню копію й атомарно замінює таблицю.
pub fn save(table: &Path, branch: Branch, bytes: &[u8]) -> Result<SaveOutcome, ProfileTableError> {
    save_with_policy(
        table,
        branch,
        bytes,
        PREVIOUS_COPY_MIN_AGE,
        SystemTime::now(),
    )
}

fn save_with_policy(
    table: &Path,
    branch: Branch,
    bytes: &[u8],
    min_age: Duration,
    now: SystemTime,
) -> Result<SaveOutcome, ProfileTableError> {
    validate_workbook(branch, bytes)?;
    let directory = table
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or(ProfileTableError::InvalidPath)?;
    let previous = previous_copy_path(table)?;
    let rotation = rotate_previous_copy(table, &previous, branch, min_age, now)?;

    let mut temporary =
        tempfile::NamedTempFile::new_in(directory).map_err(ProfileTableError::Write)?;
    temporary
        .write_all(bytes)
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(ProfileTableError::Write)?;
    temporary
        .persist(table)
        .map_err(|error| ProfileTableError::Write(error.error))?;
    sync_directory(directory);
    Ok(SaveOutcome::Saved {
        previous_copy_updated: rotation == Rotation::Updated,
        previous_copy_protected: rotation == Rotation::Protected,
    })
}

/// Синхронізує теку після перейменування, щоб заміна файлів пережила збій живлення.
/// Таблицю вже замінено, тож помилку тут не повертаємо (як у `startup_recovery`):
/// інакше інтерфейс повідомив би про невдачу запису, який відбувся. На Windows
/// теку відкрити як файл неможливо, там нічого не робимо.
fn sync_directory(directory: &Path) {
    #[cfg(unix)]
    let _ = fs::File::open(directory).and_then(|handle| handle.sync_all());
    #[cfg(not(unix))]
    let _ = directory;
}

fn rotate_previous_copy(
    table: &Path,
    previous: &Path,
    branch: Branch,
    min_age: Duration,
    now: SystemTime,
) -> Result<Rotation, ProfileTableError> {
    let current = match fs::symlink_metadata(table) {
        Ok(metadata) if metadata.file_type().is_file() => metadata,
        // Таблиці ще немає (або це не звичайний файл): копіювати нічого.
        Ok(_) | Err(_) => return Ok(Rotation::NotNeeded),
    };
    if current.len() == 0 {
        return Ok(Rotation::NotNeeded);
    }
    if previous_copy_is_fresh(previous, min_age, now) {
        return Ok(Rotation::NotNeeded);
    }
    // Пошкоджений поточний файл не повинен витіснити останню добру копію.
    let current_bytes = fs::read(table).map_err(ProfileTableError::PreviousCopy)?;
    if validate_workbook(branch, &current_bytes).is_err() {
        return Ok(Rotation::NotNeeded);
    }
    // Коректна, але майже порожня таблиця («лише заголовки») теж не повинна.
    let table_written = current.modified().unwrap_or(now);
    if would_collapse_previous_copy(previous, branch, &current_bytes, table_written) {
        return Ok(Rotation::Protected);
    }
    let directory = previous.parent().ok_or(ProfileTableError::InvalidPath)?;
    let mut temporary =
        tempfile::NamedTempFile::new_in(directory).map_err(ProfileTableError::PreviousCopy)?;
    temporary
        .write_all(&current_bytes)
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(ProfileTableError::PreviousCopy)?;
    temporary
        .persist(previous)
        .map_err(|error| ProfileTableError::PreviousCopy(error.error))?;
    Ok(Rotation::Updated)
}

/// Чи затре копія поточним станом різке зменшення рядків. Лише для наявної, читабельної
/// копії, записаної не раніше ніж [`COLLAPSE_GUARD_WINDOW`] до `table_written` (останнього
/// запису таблиці); в усіх сумнівних випадках (немає копії, не читається, невідомо)
/// відповідь «ні» — діє звичайна ротація.
fn would_collapse_previous_copy(
    previous: &Path,
    branch: Branch,
    current_bytes: &[u8],
    table_written: SystemTime,
) -> bool {
    let Ok(metadata) = fs::symlink_metadata(previous) else {
        return false;
    };
    if !metadata.file_type().is_file() || metadata.len() == 0 {
        return false;
    }
    // Невідомий вік (або годинник пішов назад) — вважаємо копію свіжою й захищаємо.
    let within_window = metadata
        .modified()
        .ok()
        .and_then(|modified| table_written.duration_since(modified).ok())
        .is_none_or(|age| age < COLLAPSE_GUARD_WINDOW);
    if !within_window {
        return false;
    }
    let Ok(previous_bytes) = fs::read(previous) else {
        return false;
    };
    match (
        count_data_rows(branch, &previous_bytes),
        count_data_rows(branch, current_bytes),
    ) {
        (Some(before), Some(after)) => rows_collapsed(before, after),
        _ => false,
    }
}

fn previous_copy_is_fresh(previous: &Path, min_age: Duration, now: SystemTime) -> bool {
    let Ok(metadata) = fs::symlink_metadata(previous) else {
        return false;
    };
    if !metadata.file_type().is_file() || metadata.len() == 0 {
        return false;
    }
    metadata
        .modified()
        .ok()
        .and_then(|modified| now.duration_since(modified).ok())
        .is_some_and(|age| age < min_age)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::base_tables::BaseTable;

    fn base(table: BaseTable) -> Vec<u8> {
        table.bytes().to_vec()
    }

    /// Книга з одним аркушем і готовим XML рядків (`<row>…</row>`).
    fn zip_with_sheet_rows(sheet_name: &str, rows: &str) -> Vec<u8> {
        use zip::write::SimpleFileOptions;
        let mut buffer = Cursor::new(Vec::new());
        {
            let mut archive = zip::ZipWriter::new(&mut buffer);
            let options = SimpleFileOptions::default();
            archive.start_file("[Content_Types].xml", options).unwrap();
            archive
                .write_all(
                    br#"<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>"#,
                )
                .unwrap();
            archive.start_file("_rels/.rels", options).unwrap();
            archive
                .write_all(
                    br#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"#,
                )
                .unwrap();
            archive.start_file("xl/workbook.xml", options).unwrap();
            archive
                .write_all(
                    format!(
                        r#"<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="{sheet_name}" sheetId="1" r:id="rId1"/></sheets></workbook>"#
                    )
                    .as_bytes(),
                )
                .unwrap();
            archive
                .start_file("xl/_rels/workbook.xml.rels", options)
                .unwrap();
            archive
                .write_all(
                    br#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#,
                )
                .unwrap();
            archive
                .start_file("xl/worksheets/sheet1.xml", options)
                .unwrap();
            archive
                .write_all(
                    format!(
                        r#"<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>{rows}</sheetData></worksheet>"#
                    )
                    .as_bytes(),
                )
                .unwrap();
            archive.finish().unwrap();
        }
        buffer.into_inner()
    }

    fn zip_with_sheet(sheet_name: &str, with_header: bool) -> Vec<u8> {
        if with_header {
            zip_with_rows(sheet_name, 0)
        } else {
            zip_with_sheet_rows(sheet_name, "")
        }
    }

    /// Книга з рядком заголовків і `data_rows` синтетичними рядками даних.
    fn zip_with_rows(sheet_name: &str, data_rows: usize) -> Vec<u8> {
        zip_with_marked_rows(sheet_name, data_rows, "")
    }

    /// Те саме, але `marker` у тексті рядків робить книги з однаковою кількістю
    /// рядків різними за байтами.
    fn zip_with_marked_rows(sheet_name: &str, data_rows: usize, marker: &str) -> Vec<u8> {
        let mut rows =
            String::from(r#"<row r="1"><c r="A1" t="inlineStr"><is><t>Дата</t></is></c></row>"#);
        for index in 0..data_rows {
            let row = index + 2;
            rows.push_str(&format!(
                r#"<row r="{row}"><c r="A{row}" t="inlineStr"><is><t>Запис {index}{marker}</t></is></c></row>"#
            ));
        }
        zip_with_sheet_rows(sheet_name, &rows)
    }

    #[test]
    fn every_shipped_base_table_passes_its_own_branch_validation() {
        for table in [
            BaseTable::Air,
            BaseTable::Rvia,
            BaseTable::Pvk,
            BaseTable::Army,
        ] {
            validate_workbook(table.branch(), table.bytes())
                .unwrap_or_else(|error| panic!("{}: {error}", table.title()));
        }
    }

    #[test]
    fn garbage_empty_and_truncated_bytes_are_rejected() {
        let valid = base(BaseTable::Rvia);
        let truncated = &valid[..valid.len() / 2];
        for bytes in [&b"PK"[..], &b"PK\x03\x04 synthetic"[..], &[][..], truncated] {
            assert!(
                matches!(
                    validate_workbook(Branch::Rocket, bytes),
                    Err(ProfileTableError::InvalidWorkbook(_))
                ),
                "{} bytes",
                bytes.len()
            );
        }
    }

    #[test]
    fn a_workbook_without_the_required_sheet_or_header_is_rejected() {
        assert!(matches!(
            validate_workbook(Branch::Rocket, &zip_with_sheet("Інший", true)),
            Err(ProfileTableError::MissingSheet {
                required: "Зведена",
                ..
            })
        ));
        assert!(matches!(
            validate_workbook(Branch::Air, &zip_with_sheet("Зведена", false)),
            Err(ProfileTableError::MissingHeaderRow("Зведена"))
        ));
        assert!(validate_workbook(Branch::Air, &zip_with_sheet("Зведена", true)).is_ok());
        assert!(
            validate_workbook(Branch::Air, &zip_with_sheet(" зведена ", true)).is_ok(),
            "case and spaces are tolerated like in the importer"
        );
        assert!(matches!(
            validate_workbook(Branch::Pvk, &base(BaseTable::Rvia)),
            Err(ProfileTableError::MissingSheet {
                required: "Таблиця 1",
                ..
            })
        ));
    }

    #[test]
    fn branches_without_a_fixed_structure_only_need_a_readable_workbook() {
        let other = zip_with_sheet("Втрати", true);
        for branch in [Branch::Dshv, Branch::PvkLosses, Branch::DshvLosses] {
            assert!(validate_workbook(branch, &other).is_ok(), "{branch:?}");
            assert!(validate_workbook(branch, b"PKnot a workbook").is_err());
        }
    }

    #[test]
    fn previous_copy_sits_next_to_the_table_with_the_documented_name() {
        let path = Path::new("/data/EasyWAR_РВ.xlsx");
        assert_eq!(
            previous_copy_path(path).unwrap(),
            PathBuf::from("/data/EasyWAR_РВ.easywar-prev.xlsx")
        );
        assert!(previous_copy_path(Path::new("/")).is_err());
    }

    #[test]
    fn invalid_bytes_never_touch_the_table_or_create_a_copy() {
        let directory = tempfile::tempdir().unwrap();
        let table = directory.path().join("EasyWAR_РВ.xlsx");
        let original = base(BaseTable::Rvia);
        fs::write(&table, &original).unwrap();

        let result = save(&table, Branch::Rocket, b"PKbroken");

        assert!(matches!(result, Err(ProfileTableError::InvalidWorkbook(_))));
        assert_eq!(fs::read(&table).unwrap(), original);
        assert_eq!(
            fs::read_dir(directory.path()).unwrap().count(),
            1,
            "no temporary or copy files"
        );
    }

    #[test]
    fn first_save_over_an_existing_table_keeps_its_previous_content() {
        let directory = tempfile::tempdir().unwrap();
        let table = directory.path().join("EasyWAR_РВ.xlsx");
        let original = base(BaseTable::Rvia);
        let replacement = zip_with_sheet("Зведена", true);
        fs::write(&table, &original).unwrap();

        let outcome = save(&table, Branch::Rocket, &replacement).unwrap();

        assert_eq!(
            outcome,
            SaveOutcome::Saved {
                previous_copy_updated: true,
                previous_copy_protected: false,
            }
        );
        assert_eq!(fs::read(&table).unwrap(), replacement);
        assert_eq!(
            fs::read(directory.path().join("EasyWAR_РВ.easywar-prev.xlsx")).unwrap(),
            original
        );
        assert_eq!(
            fs::read_dir(directory.path()).unwrap().count(),
            2,
            "no temporary files remain"
        );
    }

    #[test]
    fn saving_to_a_new_path_makes_no_copy() {
        let directory = tempfile::tempdir().unwrap();
        let table = directory.path().join("EasyWAR_ПС.xlsx");

        let outcome = save(&table, Branch::Air, &base(BaseTable::Air)).unwrap();

        assert_eq!(
            outcome,
            SaveOutcome::Saved {
                previous_copy_updated: false,
                previous_copy_protected: false,
            }
        );
        assert_eq!(fs::read(&table).unwrap(), base(BaseTable::Air));
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn a_fresh_copy_is_kept_so_quick_repeated_saves_cannot_displace_the_good_state() {
        let directory = tempfile::tempdir().unwrap();
        let table = directory.path().join("EasyWAR_РВ.xlsx");
        let good = base(BaseTable::Rvia);
        fs::write(&table, &good).unwrap();
        let second = zip_with_sheet("Зведена", true);
        save(&table, Branch::Rocket, &second).unwrap();

        // Другий запис одразу після першого: копія лишається добрим станом до першого запису.
        let third = base(BaseTable::Rvia);
        let outcome = save(&table, Branch::Rocket, &third).unwrap();

        assert_eq!(
            outcome,
            SaveOutcome::Saved {
                previous_copy_updated: false,
                previous_copy_protected: false,
            }
        );
        assert_eq!(fs::read(&table).unwrap(), third);
        assert_eq!(
            fs::read(directory.path().join("EasyWAR_РВ.easywar-prev.xlsx")).unwrap(),
            good
        );
    }

    #[test]
    fn a_stale_copy_is_replaced_by_the_state_before_this_save() {
        let directory = tempfile::tempdir().unwrap();
        let table = directory.path().join("EasyWAR_РВ.xlsx");
        let previous = directory.path().join("EasyWAR_РВ.easywar-prev.xlsx");
        let current = zip_with_sheet("Зведена", true);
        fs::write(&table, &current).unwrap();
        fs::write(&previous, b"old synthetic copy").unwrap();
        let later = SystemTime::now() + PREVIOUS_COPY_MIN_AGE + Duration::from_secs(1);

        let outcome = save_with_policy(
            &table,
            Branch::Rocket,
            &base(BaseTable::Rvia),
            PREVIOUS_COPY_MIN_AGE,
            later,
        )
        .unwrap();

        assert_eq!(
            outcome,
            SaveOutcome::Saved {
                previous_copy_updated: true,
                previous_copy_protected: false,
            }
        );
        assert_eq!(fs::read(&previous).unwrap(), current);
    }

    #[test]
    fn a_damaged_current_table_never_replaces_the_last_good_copy() {
        let directory = tempfile::tempdir().unwrap();
        let table = directory.path().join("EasyWAR_РВ.xlsx");
        let previous = directory.path().join("EasyWAR_РВ.easywar-prev.xlsx");
        fs::write(&table, b"PK synthetic damaged table").unwrap();
        let good = base(BaseTable::Rvia);
        fs::write(&previous, &good).unwrap();
        let later = SystemTime::now() + PREVIOUS_COPY_MIN_AGE + Duration::from_secs(1);

        let outcome =
            save_with_policy(&table, Branch::Rocket, &good, PREVIOUS_COPY_MIN_AGE, later).unwrap();

        assert_eq!(
            outcome,
            SaveOutcome::Saved {
                previous_copy_updated: false,
                previous_copy_protected: false,
            }
        );
        assert_eq!(fs::read(&previous).unwrap(), good);
        assert_eq!(
            fs::read(&table).unwrap(),
            good,
            "the user can still replace a broken table"
        );
    }

    #[test]
    fn a_failed_copy_leaves_the_table_unchanged() {
        let directory = tempfile::tempdir().unwrap();
        let table = directory.path().join("EasyWAR_РВ.xlsx");
        let original = base(BaseTable::Rvia);
        fs::write(&table, &original).unwrap();
        // Каталог на місці копії: замінити його файлом неможливо на жодній ОС.
        fs::create_dir(directory.path().join("EasyWAR_РВ.easywar-prev.xlsx")).unwrap();

        let result = save(&table, Branch::Rocket, &zip_with_sheet("Зведена", true));

        assert!(
            matches!(result, Err(ProfileTableError::PreviousCopy(_))),
            "{result:?}"
        );
        assert_eq!(fs::read(&table).unwrap(), original);
    }

    const HEADER_ROW: &str = r#"<row r="1"><c r="A1" t="inlineStr"><is><t>Дата</t></is></c></row>"#;

    /// Момент, коли копія вже не «свіжа» (минуло більше за [`PREVIOUS_COPY_MIN_AGE`]).
    fn after_min_age() -> SystemTime {
        SystemTime::now() + PREVIOUS_COPY_MIN_AGE + Duration::from_secs(1)
    }

    fn saved(updated: bool, protected: bool) -> SaveOutcome {
        SaveOutcome::Saved {
            previous_copy_updated: updated,
            previous_copy_protected: protected,
        }
    }

    #[test]
    fn data_rows_are_counted_without_the_header_and_blank_rows() {
        assert_eq!(
            count_data_rows(Branch::Rocket, &zip_with_rows("Зведена", 12)),
            Some(12)
        );
        assert_eq!(
            count_data_rows(Branch::Rocket, &zip_with_rows("Зведена", 0)),
            Some(0)
        );
        assert_eq!(
            count_data_rows(Branch::Rocket, &zip_with_sheet("Зведена", false)),
            Some(0)
        );
        // Рядок із самих пробілів і рядок без значень — не дані.
        let rows = format!(
            "{HEADER_ROW}\
             <row r=\"2\"><c r=\"A2\" t=\"inlineStr\"><is><t>Запис</t></is></c></row>\
             <row r=\"3\"><c r=\"A3\" t=\"inlineStr\"><is><t>   </t></is></c></row>\
             <row r=\"4\"><c r=\"A4\"/></row>"
        );
        assert_eq!(
            count_data_rows(Branch::Air, &zip_with_sheet_rows("Зведена", &rows)),
            Some(1)
        );
        // Без обов'язкового аркуша порахувати нічого, як і для не-книги.
        assert_eq!(
            count_data_rows(Branch::Rocket, &zip_with_rows("Інший", 12)),
            None
        );
        assert_eq!(count_data_rows(Branch::Rocket, b"PK not a workbook"), None);
        // Гілка без фіксованої структури рахує по всіх аркушах.
        assert_eq!(
            count_data_rows(Branch::Dshv, &zip_with_rows("Втрати", 5)),
            Some(5)
        );
        assert!(count_data_rows(Branch::Rocket, &base(BaseTable::Rvia)).is_some());
    }

    #[test]
    fn the_collapse_rule_means_emptying_or_losing_more_than_half_of_ten_or_more_rows() {
        for (before, after, expected) in [
            (0, 0, false),
            (0, 50, false),
            (1, 0, true),
            (9, 0, true),
            (9, 1, false),
            (9, 4, false),
            (10, 5, false),
            (10, 4, true),
            (11, 5, true),
            (100, 50, false),
            (100, 49, true),
            (100, 100, false),
            (100, 400, false),
            (usize::MAX, usize::MAX / 2 + 1, false),
            (usize::MAX, usize::MAX / 2, true),
        ] {
            assert_eq!(
                rows_collapsed(before, after),
                expected,
                "{before} -> {after}"
            );
        }
    }

    #[test]
    fn a_collapsed_write_followed_by_a_later_save_does_not_evict_the_last_good_copy() {
        let directory = tempfile::tempdir().unwrap();
        let table = directory.path().join("EasyWAR_РВ.xlsx");
        let previous = directory.path().join("EasyWAR_РВ.easywar-prev.xlsx");
        let good = zip_with_rows("Зведена", 30);
        let headers_only = zip_with_rows("Зведена", 0);
        fs::write(&table, &good).unwrap();

        // Момент T: збій записує книгу «лише заголовки». Вона коректна, тож таблицю
        // замінено (очищення не блокується), а добрий стан іде в копію.
        let outcome = save(&table, Branch::Rocket, &headers_only).unwrap();
        assert_eq!(outcome, saved(true, false));
        assert_eq!(fs::read(&table).unwrap(), headers_only);
        assert_eq!(fs::read(&previous).unwrap(), good);

        // Момент T+6 хв: наступне збереження не повинно перенести «лише заголовки»
        // в копію (це і був сценарій витіснення).
        let recovered = zip_with_marked_rows("Зведена", 31, " нове");
        let outcome = save_with_policy(
            &table,
            Branch::Rocket,
            &recovered,
            PREVIOUS_COPY_MIN_AGE,
            after_min_age(),
        )
        .unwrap();
        assert_eq!(outcome, saved(false, true));
        assert_eq!(
            fs::read(&previous).unwrap(),
            good,
            "the last good copy survives"
        );
        assert_eq!(fs::read(&table).unwrap(), recovered);
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 2);
    }

    #[test]
    fn a_collapsing_save_is_always_written_and_still_keeps_the_state_before_it() {
        let directory = tempfile::tempdir().unwrap();
        let table = directory.path().join("EasyWAR_ПС.xlsx");
        let previous = directory.path().join("EasyWAR_ПС.easywar-prev.xlsx");
        let older = zip_with_marked_rows("Зведена", 28, " раніше");
        let good = zip_with_rows("Зведена", 30);
        let cleared = zip_with_rows("Зведена", 0);
        fs::write(&previous, &older).unwrap();
        fs::write(&table, &good).unwrap();

        let outcome = save_with_policy(
            &table,
            Branch::Air,
            &cleared,
            PREVIOUS_COPY_MIN_AGE,
            after_min_age(),
        )
        .unwrap();

        // Поточний стан (30 рядків) не є різким зменшенням відносно копії (28), тож
        // він іде в копію; сама таблиця очищена, як просив користувач.
        assert_eq!(outcome, saved(true, false));
        assert_eq!(fs::read(&table).unwrap(), cleared);
        assert_eq!(fs::read(&previous).unwrap(), good);
    }

    #[test]
    fn gradual_shrinking_keeps_rotating_the_copy() {
        let directory = tempfile::tempdir().unwrap();
        let table = directory.path().join("EasyWAR_РВ.xlsx");
        let previous = directory.path().join("EasyWAR_РВ.easywar-prev.xlsx");
        let before = zip_with_rows("Зведена", 40);
        let half = zip_with_marked_rows("Зведена", 20, " половина");
        fs::write(&previous, &before).unwrap();
        fs::write(&table, &half).unwrap();

        let outcome = save_with_policy(
            &table,
            Branch::Rocket,
            &zip_with_rows("Зведена", 19),
            PREVIOUS_COPY_MIN_AGE,
            after_min_age(),
        )
        .unwrap();

        assert_eq!(
            outcome,
            saved(true, false),
            "exactly half is not a collapse"
        );
        assert_eq!(fs::read(&previous).unwrap(), half);
    }

    fn set_modified(path: &Path, time: SystemTime) {
        fs::OpenOptions::new()
            .write(true)
            .open(path)
            .unwrap()
            .set_modified(time)
            .unwrap();
    }

    #[test]
    fn the_guard_lapses_after_the_window_so_a_deliberate_reduction_becomes_the_new_copy() {
        let directory = tempfile::tempdir().unwrap();
        let table = directory.path().join("EasyWAR_РВ.xlsx");
        let previous = directory.path().join("EasyWAR_РВ.easywar-prev.xlsx");
        let good = zip_with_rows("Зведена", 30);
        let reduced = zip_with_rows("Зведена", 3);
        let next = zip_with_marked_rows("Зведена", 4, " далі");
        fs::write(&previous, &good).unwrap();
        fs::write(&table, &reduced).unwrap();
        // Копію записано давно, а зменшену таблицю востаннє змінено ще в межах доби після цього.
        let copied = SystemTime::now() - 5 * COLLAPSE_GUARD_WINDOW;
        set_modified(&previous, copied);
        set_modified(
            &table,
            copied + COLLAPSE_GUARD_WINDOW - Duration::from_secs(120),
        );
        let outcome = save_with_policy(
            &table,
            Branch::Rocket,
            &next,
            PREVIOUS_COPY_MIN_AGE,
            SystemTime::now(),
        )
        .unwrap();
        assert_eq!(outcome, saved(false, true));
        assert_eq!(fs::read(&previous).unwrap(), good);

        // Таблиця пропрацювала понад добу після запису копії: це новий стан.
        set_modified(
            &table,
            copied + COLLAPSE_GUARD_WINDOW + Duration::from_secs(120),
        );
        let outcome = save_with_policy(
            &table,
            Branch::Rocket,
            &next,
            PREVIOUS_COPY_MIN_AGE,
            SystemTime::now(),
        )
        .unwrap();
        assert_eq!(outcome, saved(true, false));
        assert_eq!(
            fs::read(&previous).unwrap(),
            next,
            "table was replaced by `next` in the first call"
        );
    }

    #[test]
    fn an_application_left_closed_after_a_collapse_does_not_outwait_the_guard() {
        let directory = tempfile::tempdir().unwrap();
        let table = directory.path().join("EasyWAR_РВ.xlsx");
        let previous = directory.path().join("EasyWAR_РВ.easywar-prev.xlsx");
        let good = zip_with_rows("Зведена", 30);
        let headers_only = zip_with_rows("Зведена", 0);
        let next = zip_with_marked_rows("Зведена", 1, " після вихідних");
        fs::write(&previous, &good).unwrap();
        fs::write(&table, &headers_only).unwrap();
        // Збій записав «лише заголовки» за хвилини після копії, а застосунок не запускали тиждень.
        let copied = SystemTime::now() - 7 * COLLAPSE_GUARD_WINDOW;
        set_modified(&previous, copied);
        set_modified(&table, copied + Duration::from_secs(600));

        let outcome = save_with_policy(
            &table,
            Branch::Rocket,
            &next,
            PREVIOUS_COPY_MIN_AGE,
            SystemTime::now(),
        )
        .unwrap();

        assert_eq!(outcome, saved(false, true));
        assert_eq!(
            fs::read(&previous).unwrap(),
            good,
            "the last good copy stays"
        );
    }

    #[test]
    fn small_tables_are_protected_only_against_being_emptied() {
        for (copy_rows, current_rows, protected) in [(8, 3, false), (8, 0, true), (9, 4, false)] {
            let directory = tempfile::tempdir().unwrap();
            let table = directory.path().join("EasyWAR_ПС.xlsx");
            let previous = directory.path().join("EasyWAR_ПС.easywar-prev.xlsx");
            fs::write(&previous, zip_with_rows("Зведена", copy_rows)).unwrap();
            fs::write(
                &table,
                zip_with_marked_rows("Зведена", current_rows, " зараз"),
            )
            .unwrap();

            let outcome = save_with_policy(
                &table,
                Branch::Air,
                &zip_with_rows("Зведена", 5),
                PREVIOUS_COPY_MIN_AGE,
                after_min_age(),
            )
            .unwrap();

            assert_eq!(
                outcome,
                saved(!protected, protected),
                "{copy_rows} -> {current_rows}"
            );
        }
    }

    #[test]
    fn an_unreadable_copy_cannot_block_rotation() {
        let directory = tempfile::tempdir().unwrap();
        let table = directory.path().join("EasyWAR_РВ.xlsx");
        let previous = directory.path().join("EasyWAR_РВ.easywar-prev.xlsx");
        let headers_only = zip_with_rows("Зведена", 0);
        fs::write(&previous, b"PK synthetic damaged copy").unwrap();
        fs::write(&table, &headers_only).unwrap();

        let outcome = save_with_policy(
            &table,
            Branch::Rocket,
            &zip_with_rows("Зведена", 2),
            PREVIOUS_COPY_MIN_AGE,
            after_min_age(),
        )
        .unwrap();

        assert_eq!(outcome, saved(true, false));
        assert_eq!(fs::read(&previous).unwrap(), headers_only);
    }

    #[test]
    fn branches_without_a_required_sheet_compare_rows_over_all_sheets() {
        let directory = tempfile::tempdir().unwrap();
        let table = directory.path().join("EasyWAR_ДШВ.xlsx");
        let previous = directory.path().join("EasyWAR_ДШВ.easywar-prev.xlsx");
        let good = zip_with_rows("Втрати", 30);
        fs::write(&previous, &good).unwrap();
        fs::write(&table, zip_with_rows("Втрати", 2)).unwrap();

        let outcome = save_with_policy(
            &table,
            Branch::Dshv,
            &zip_with_rows("Втрати", 3),
            PREVIOUS_COPY_MIN_AGE,
            after_min_age(),
        )
        .unwrap();

        assert_eq!(outcome, saved(false, true));
        assert_eq!(fs::read(&previous).unwrap(), good);
    }

    #[test]
    fn a_workbook_that_inflates_past_the_limits_is_rejected_before_calamine_reads_it() {
        // Лист із 4 МБ пробілів між тегами: ZIP стискає його до кількох кілобайт.
        let bomb = zip_with_sheet_rows(
            "Зведена",
            &format!("{HEADER_ROW}{}", " ".repeat(4 * 1024 * 1024)),
        );
        assert!(bomb.len() < 64 * 1024, "{}", bomb.len());
        let tiny = ZipLimits {
            per_entry: 256 * 1024,
            total: 512 * 1024,
        };

        let error = validate_workbook_with_limits(Branch::Rocket, &bomb, tiny)
            .expect_err("a part over the limit must be rejected");

        assert!(
            matches!(&error, ProfileTableError::InvalidWorkbook(message)
                if message.contains("після розпакування") && message.contains("xl/worksheets/sheet1.xml")),
            "{error:?}"
        );
        // Той самий файл у межах за замовчуванням — звичайна книга.
        assert!(validate_workbook(Branch::Rocket, &bomb).is_ok());
    }

    #[test]
    fn syncing_a_missing_directory_is_silently_ignored() {
        let directory = tempfile::tempdir().unwrap();
        sync_directory(directory.path());
        sync_directory(&directory.path().join("missing"));
    }
}
