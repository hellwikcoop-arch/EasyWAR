//! Empty base tables that a profile can start from.
//!
//! The workbooks in `resources/base-tables/` hold structure only: headers,
//! reference lists, drop-downs, Excel tables and their total rows. They are
//! built by `script/make_base_tables.py`, and the tests below keep them free of
//! records. A new table is written to a path the user chooses and never
//! replaces an existing file.

use std::{io::Write, path::Path};

use serde::Deserialize;

use crate::local_profiles::Branch;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum BaseTable {
    /// Повітряні Сили: аркуш «Зведена» з довідниками, як читає модуль ПС.
    Air,
    /// Ракетні війська і артилерія: аркуш «Зведена» з довідниками.
    Rvia,
    /// Повітряні Сили рівня ПВК: журнал ударів «Таблиця 1» і ТАБЛ 2-3 (аркуші «АА», «ПС», «Об'єкти»).
    Pvk,
}

impl BaseTable {
    pub fn bytes(self) -> &'static [u8] {
        match self {
            BaseTable::Air => include_bytes!("../resources/base-tables/air-base.xlsx"),
            BaseTable::Rvia => include_bytes!("../resources/base-tables/rvia-base.xlsx"),
            BaseTable::Pvk => include_bytes!("../resources/base-tables/pvk-base.xlsx"),
        }
    }

    /// The module that opens this table.
    pub fn branch(self) -> Branch {
        match self {
            BaseTable::Rvia => Branch::Rocket,
            BaseTable::Air => Branch::Air,
            BaseTable::Pvk => Branch::Pvk,
        }
    }

    pub fn title(self) -> &'static str {
        match self {
            BaseTable::Air => "ПС",
            BaseTable::Rvia => "РВіА",
            BaseTable::Pvk => "ПС рівня ПВК",
        }
    }

    pub fn file_name(self) -> &'static str {
        match self {
            BaseTable::Air => "EasyWAR_ПС.xlsx",
            BaseTable::Rvia => "EasyWAR_РВіА.xlsx",
            BaseTable::Pvk => "EasyWAR_ПС_ПВК.xlsx",
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum BaseTableError {
    #[error("файл «{0}» уже існує; оберіть нову назву, щоб не затерти наявну таблицю")]
    AlreadyExists(String),
    #[error("не вдалося записати таблицю: {0}")]
    Io(#[from] std::io::Error),
}

/// Writes `table` to `path`. Fails if a file is already there, even when the
/// save dialog asked to replace it: an empty table must never overwrite work.
pub fn write_new(path: &Path, table: BaseTable) -> Result<(), BaseTableError> {
    let already_exists = || {
        BaseTableError::AlreadyExists(
            path.file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_default(),
        )
    };
    if path.exists() {
        return Err(already_exists());
    }
    let directory = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty());
    let mut temporary = tempfile::NamedTempFile::new_in(directory.unwrap_or(Path::new(".")))?;
    temporary.write_all(table.bytes())?;
    temporary.as_file().sync_all()?;
    temporary.persist_noclobber(path).map_err(|error| {
        if error.error.kind() == std::io::ErrorKind::AlreadyExists {
            already_exists()
        } else {
            BaseTableError::Io(error.error)
        }
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use calamine::{Data, Reader, Xlsx};
    use std::io::{Cursor, Read};

    fn workbook(table: BaseTable) -> Xlsx<Cursor<&'static [u8]>> {
        Xlsx::new(Cursor::new(table.bytes())).expect("base table must open")
    }

    fn text(cell: Option<&Data>) -> String {
        cell.map(|value| value.to_string()).unwrap_or_default()
    }

    fn package_text(table: BaseTable) -> (Vec<String>, String) {
        let mut archive = zip::ZipArchive::new(Cursor::new(table.bytes())).unwrap();
        let names = archive.file_names().map(str::to_owned).collect::<Vec<_>>();
        let mut all = String::new();
        for name in &names {
            archive
                .by_name(name)
                .unwrap()
                .read_to_string(&mut all)
                .unwrap();
        }
        (names, all)
    }

    #[test]
    fn packages_carry_no_author_path_printer_or_query_parts() {
        for table in [BaseTable::Air, BaseTable::Rvia, BaseTable::Pvk] {
            let (names, text) = package_text(table);
            assert!(
                !names
                    .iter()
                    .any(|name| name.starts_with("customXml/") || name.contains("printerSettings")),
                "{names:?}"
            );
            assert!(!text.contains("absPath"));
            assert!(text.contains("<dc:creator>EasyWAR</dc:creator>"));
            assert!(text.contains("<cp:lastModifiedBy>EasyWAR</cp:lastModifiedBy>"));
        }
    }

    fn summary_headers(table: BaseTable) -> Vec<String> {
        let summary = workbook(table).worksheet_range("Зведена").unwrap();
        assert_eq!(summary.height(), 1, "{table:?}: only the header row");
        summary
            .rows()
            .next()
            .unwrap()
            .iter()
            .map(|cell| cell.to_string())
            .collect()
    }

    const SHARED_HEADERS: [&str; 12] = [
        "№",
        "Дата",
        "Час ураження",
        "В інтересах",
        "Район / н.п.",
        "Тип цілі",
        "Тип боєприпасу",
        "К-сть боєприпасів",
        "Результат ураження",
        "Причина",
        "Уточнення результату",
        "Місяць",
    ];

    #[test]
    fn rvia_base_has_the_rocket_module_headers_and_no_records() {
        let headers = summary_headers(BaseTable::Rvia);
        for required in SHARED_HEADERS.iter().chain(&["№ цілі", "Тип ПУ"]) {
            assert!(
                headers.iter().any(|header| header == required),
                "{required}"
            );
        }
        let mut book = workbook(BaseTable::Rvia);
        for reference in [
            "Довідник типів",
            "Довідник причин",
            "Довідник ПУ та БП",
            "Результати",
        ] {
            assert!(
                book.worksheet_range(reference).unwrap().height() > 1,
                "{reference}"
            );
        }
        assert_eq!(BaseTable::Rvia.branch(), Branch::Rocket);
    }

    #[test]
    fn air_base_has_the_air_force_module_headers_and_no_records() {
        let headers = summary_headers(BaseTable::Air);
        for required in SHARED_HEADERS.iter().chain(&["№ цілі (TS/KS)", "Тип ЛА"]) {
            assert!(
                headers.iter().any(|header| header == required),
                "{required}"
            );
        }
        assert!(!headers.iter().any(|header| header == "Тип ПУ"));
        let mut book = workbook(BaseTable::Air);
        assert!(!book
            .sheet_names()
            .iter()
            .any(|name| name == "Довідник ПУ та БП"));
        let causes = book.worksheet_range("Довідник причин").unwrap();
        assert!(causes.rows().any(|row| text(row.first()) == "Відмова АЗУ"));
        assert_eq!(BaseTable::Air.branch(), Branch::Air);
    }

    #[test]
    fn pvk_base_has_the_strike_journal_and_three_empty_tables_with_total_rows() {
        let mut book = workbook(BaseTable::Pvk);
        assert_eq!(book.sheet_names(), ["Таблиця 1", "АА", "ПС", "Об'єкти"]);
        let journal = book.worksheet_range("Таблиця 1").unwrap();
        assert_eq!(journal.height(), 1, "Таблиця 1: only the header row");
        let journal_headers = journal
            .rows()
            .next()
            .unwrap()
            .iter()
            .map(|cell| cell.to_string())
            .collect::<Vec<_>>();
        assert_eq!(
            journal_headers,
            [
                "№ з/п",
                "Дата",
                "Час удару",
                "Номер цілі",
                "Характер цілі",
                "Координати цілі",
                "Населений пункт",
                "Фактичні приходи",
                "Сили та засоби",
                "Тип АЗУ",
                "Витрата АЗУ",
                "Результат",
            ]
        );
        for (sheet, first_header, last_header) in [
            ("АА", "Дата", "НЕ уражено"),
            ("ПС", "Дата", "Дорозвідується"),
            ("Об'єкти", "Дата", "Витрата"),
        ] {
            let range = book.worksheet_range(sheet).unwrap();
            // Header, two years of daily rows computed from «Таблиця 1» and the
            // totals: nothing is left of the working rows or of cells beside
            // the table.
            assert_eq!(range.height(), 733, "{sheet}");
            let formulas = book.worksheet_formula(sheet).unwrap();
            let first_day = formulas.get_value((1, 0)).unwrap();
            assert!(
                first_day.contains("MIN('Таблиця 1'!$B:$B)"),
                "{sheet}: {first_day}"
            );
            let first_metric = formulas.get_value((1, 1)).unwrap();
            assert!(
                first_metric.contains("'Таблиця 1'!"),
                "{sheet}: {first_metric}"
            );
            assert_eq!(range.start(), Some((0, 0)), "{sheet}");
            let rows = range.rows().collect::<Vec<_>>();
            let header = rows[0]
                .iter()
                .map(|cell| cell.to_string())
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>();
            assert_eq!(header.len(), range.width(), "{sheet}");
            assert_eq!(header.first().map(String::as_str), Some(first_header));
            assert_eq!(header.last().map(String::as_str), Some(last_header));
            let totals = rows.last().unwrap();
            assert_eq!(text(totals.first()), "Підсумок", "{sheet}");
            // Formulas carry no computed values until Excel opens the file.
            for row in &rows[1..rows.len() - 1] {
                assert!(
                    row.iter().all(|cell| cell.to_string().is_empty()),
                    "{sheet}: data rows must be empty"
                );
            }
        }
        assert_eq!(BaseTable::Pvk.branch(), Branch::Pvk);
    }

    #[test]
    fn a_new_table_never_replaces_an_existing_file() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("synthetic.xlsx");
        write_new(&path, BaseTable::Rvia).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), BaseTable::Rvia.bytes());

        let error = write_new(&path, BaseTable::Pvk).unwrap_err();
        assert!(matches!(error, BaseTableError::AlreadyExists(_)));
        assert!(error.to_string().contains("synthetic.xlsx"));
        assert_eq!(std::fs::read(&path).unwrap(), BaseTable::Rvia.bytes());
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
    }
}
