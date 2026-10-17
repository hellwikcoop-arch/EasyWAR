//! Безпечний запис робочої таблиці, прив'язаної до профілю.
//!
//! Модулі записують таблицю цілком, тож помилка серіалізації (порожня чи обрізана
//! книга) знищила б єдину робочу копію журналу. Перед заміною файлу:
//! 1. байти відкриваються як книга XLSX, а для відомих родів військ на місці має бути
//!    аркуш із заголовками (`Зведена` для ПС/РВ, `Таблиця 1` для ПВК);
//! 2. поточний файл, якщо він сам є коректною книгою, копіюється поруч як
//!    `<назва>.easywar-prev.xlsx` — одна попередня копія, яка оновлюється не частіше
//!    за [`PREVIOUS_COPY_MIN_AGE`], щоб серія збережень поспіль не витіснила
//!    останній добрий стан;
//! 3. нові байти записуються у тимчасовий файл у тій самій папці й замінюють таблицю
//!    одним перейменуванням.
//!
//! Якщо копію зробити не вдалося, таблиця не змінюється.

use std::{
    fs,
    io::{self, Cursor, Write},
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};

use calamine::{Reader, Xlsx};

use crate::local_profiles::Branch;

/// Суфікс файлу попередньої копії: `EasyWAR_РВ.xlsx` → `EasyWAR_РВ.easywar-prev.xlsx`.
pub const PREVIOUS_COPY_SUFFIX: &str = ".easywar-prev.xlsx";
/// Не оновлювати попередню копію частіше, ніж раз на цей час.
pub const PREVIOUS_COPY_MIN_AGE: Duration = Duration::from_secs(5 * 60);

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
/// Для інших гілок (ДШВ, «Наші втрати») точна структура не зафіксована, тож
/// перевіряється лише, що книга відкривається й має аркуші.
pub fn required_sheet(branch: Branch) -> Option<&'static str> {
    match branch {
        Branch::Air | Branch::Rocket => Some("Зведена"),
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

/// Перевіряє байти до запису. Нічого не змінює.
pub fn validate_workbook(branch: Branch, bytes: &[u8]) -> Result<(), ProfileTableError> {
    let mut workbook = Xlsx::new(Cursor::new(bytes))
        .map_err(|error| ProfileTableError::InvalidWorkbook(error.to_string()))?;
    let sheet_names = workbook.sheet_names();
    if sheet_names.is_empty() {
        return Err(ProfileTableError::NoSheets);
    }
    let Some(required) = required_sheet(branch) else {
        return Ok(());
    };
    let sheet = sheet_names
        .iter()
        .find(|name| normalize_label(name) == normalize_label(required))
        .cloned()
        .ok_or_else(|| ProfileTableError::MissingSheet {
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
    /// Таблицю записано; чи оновлено попередню копію.
    Saved { previous_copy_updated: bool },
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
    let previous_copy_updated = rotate_previous_copy(table, &previous, branch, min_age, now)?;

    let mut temporary =
        tempfile::NamedTempFile::new_in(directory).map_err(ProfileTableError::Write)?;
    temporary
        .write_all(bytes)
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(ProfileTableError::Write)?;
    temporary
        .persist(table)
        .map_err(|error| ProfileTableError::Write(error.error))?;
    Ok(SaveOutcome::Saved {
        previous_copy_updated,
    })
}

fn rotate_previous_copy(
    table: &Path,
    previous: &Path,
    branch: Branch,
    min_age: Duration,
    now: SystemTime,
) -> Result<bool, ProfileTableError> {
    let current = match fs::symlink_metadata(table) {
        Ok(metadata) if metadata.file_type().is_file() => metadata,
        // Таблиці ще немає (або це не звичайний файл): копіювати нічого.
        Ok(_) | Err(_) => return Ok(false),
    };
    if current.len() == 0 {
        return Ok(false);
    }
    if previous_copy_is_fresh(previous, min_age, now) {
        return Ok(false);
    }
    // Пошкоджений поточний файл не повинен витіснити останню добру копію.
    let current_bytes = fs::read(table).map_err(ProfileTableError::PreviousCopy)?;
    if validate_workbook(branch, &current_bytes).is_err() {
        return Ok(false);
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
    Ok(true)
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

    fn zip_with_sheet(sheet_name: &str, with_header: bool) -> Vec<u8> {
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
            let rows = if with_header {
                r#"<row r="1"><c r="A1" t="inlineStr"><is><t>Дата</t></is></c></row>"#
            } else {
                ""
            };
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

    #[test]
    fn every_shipped_base_table_passes_its_own_branch_validation() {
        for table in [BaseTable::Air, BaseTable::Rvia, BaseTable::Pvk] {
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
                previous_copy_updated: true
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
                previous_copy_updated: false
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
                previous_copy_updated: false
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
                previous_copy_updated: true
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
                previous_copy_updated: false
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
}
