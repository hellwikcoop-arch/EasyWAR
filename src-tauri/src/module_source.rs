//! Читання аркушів таблиці XLSX, з якої модуль каталогу підтягує дані під час створення.
//!
//! Лише читання: файл не змінюється й нікуди не надсилається. Таблицю дає або файл,
//! прив'язаний до профілю, або файл, який користувач сам обрав у вікні вибору; шлях
//! від інтерфейсу ніколи не приймається. Зіставлення стовпців із полями шаблону та
//! розбір значень (час, висота, паливо) робить інтерфейс, а тут клітинки віддаються
//! так, як вони записані в аркуші: текст, число, так/ні, час доби `ГГ:ХХ`, тривалість
//! `Г:ХХ` або дата.
//!
//! Службові аркуші застосунку (приховані, наприклад «EasyWAR_Артилерія») не
//! пропонуються: вони не є таблицею користувача.

use std::io::Cursor;

use calamine::{Data, ExcelDateTime, Range, Reader, SheetType, SheetVisible, Xlsx};
use serde::Serialize;
use serde_json::{Number, Value};

use crate::xlsx_import::{ensure_zip_within_limits_with, ZipLimits};

/// Рядків даних, які можна підтягнути за раз; збігається з межею запису модуля.
pub const MAX_DATA_ROWS: usize = 10_000;
/// Запас на заголовок і службові рядки над ним.
const HEADER_ALLOWANCE: usize = 50;
/// Стовпців, які читаються з аркуша.
pub const MAX_COLUMNS: usize = 200;
const MAX_SHEETS: usize = 64;
/// Скільки перших рядків аркуша віддається для пошуку рядка заголовків.
const SAMPLE_ROWS: usize = 25;
const MAX_CELL_CHARS: usize = 4096;

#[derive(Debug, thiserror::Error)]
pub enum ModuleSourceError {
    #[error("Файл не відкривається як книга XLSX: {0}")]
    InvalidWorkbook(String),
    #[error("У книзі немає видимих аркушів")]
    NoSheets,
    #[error("У книзі немає аркуша «{0}»")]
    MissingSheet(String),
}

/// Непорожній рядок аркуша. `number` — номер рядка в таблиці, як його бачить користувач.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceRow {
    pub number: u32,
    pub cells: Vec<Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceSheet {
    pub name: String,
    /// Непорожніх рядків разом із заголовком.
    pub row_count: usize,
    pub column_count: usize,
    /// Перші непорожні рядки: за ними інтерфейс шукає рядок заголовків.
    pub sample: Vec<SourceRow>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceWorkbook {
    pub file_name: String,
    /// `linked` — таблиця, прив'язана до профілю; `picked` — файл, обраний користувачем.
    pub origin: String,
    pub sheets: Vec<SourceSheet>,
    /// Непрозорий ідентифікатор огляду (`module_source_selection`): за ним читається
    /// аркуш. Шлях до файла інтерфейс не отримує.
    pub selection: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceSheetRows {
    pub name: String,
    pub rows: Vec<SourceRow>,
    /// Рядків у аркуші більше, ніж можна підтягнути.
    pub truncated: bool,
}

fn open(bytes: &[u8]) -> Result<Xlsx<Cursor<Vec<u8>>>, ModuleSourceError> {
    open_within(bytes, ZipLimits::DEFAULT)
}

/// Відкриває книгу, попередньо перевіривши межі розпакування: calamine читає частини
/// цілком, тож «ZIP-бомба» невеликого розміру вичерпала б пам'ять.
fn open_within(
    bytes: &[u8],
    limits: ZipLimits,
) -> Result<Xlsx<Cursor<Vec<u8>>>, ModuleSourceError> {
    ensure_zip_within_limits_with(bytes, limits)
        .map_err(|error| ModuleSourceError::InvalidWorkbook(error.to_string()))?;
    Xlsx::new(Cursor::new(bytes.to_vec()))
        .map_err(|error| ModuleSourceError::InvalidWorkbook(error.to_string()))
}

fn visible_sheet_names(workbook: &Xlsx<Cursor<Vec<u8>>>) -> Vec<String> {
    workbook
        .sheets_metadata()
        .iter()
        .filter(|sheet| sheet.typ == SheetType::WorkSheet && sheet.visible == SheetVisible::Visible)
        .map(|sheet| sheet.name.clone())
        .collect()
}

/// Аркуші книги з назвами, розмірами й першими рядками.
pub fn inspect_bytes(
    bytes: &[u8],
    file_name: &str,
    origin: &str,
) -> Result<SourceWorkbook, ModuleSourceError> {
    let mut workbook = open(bytes)?;
    let names = visible_sheet_names(&workbook);
    if names.is_empty() {
        return Err(ModuleSourceError::NoSheets);
    }
    let mut sheets = Vec::new();
    for name in names.into_iter().take(MAX_SHEETS) {
        let range = workbook
            .worksheet_range(&name)
            .map_err(|error| ModuleSourceError::InvalidWorkbook(error.to_string()))?;
        sheets.push(summarize(name, &range));
    }
    Ok(SourceWorkbook {
        file_name: file_name.to_owned(),
        origin: origin.to_owned(),
        sheets,
        selection: String::new(),
    })
}

/// Усі непорожні рядки одного аркуша (не більше `MAX_DATA_ROWS` рядків даних).
pub fn read_sheet_bytes(bytes: &[u8], sheet: &str) -> Result<SourceSheetRows, ModuleSourceError> {
    let mut workbook = open(bytes)?;
    if !visible_sheet_names(&workbook)
        .iter()
        .any(|name| name == sheet)
    {
        return Err(ModuleSourceError::MissingSheet(sheet.to_owned()));
    }
    let range = workbook
        .worksheet_range(sheet)
        .map_err(|error| ModuleSourceError::InvalidWorkbook(error.to_string()))?;
    let first_row = first_row_index(&range);
    let limit = MAX_DATA_ROWS + HEADER_ALLOWANCE;
    let mut rows = Vec::new();
    let mut truncated = false;
    for (offset, cells) in range.rows().enumerate() {
        let values = row_values(cells);
        if values.iter().all(Value::is_null) {
            continue;
        }
        if rows.len() >= limit {
            truncated = true;
            break;
        }
        rows.push(SourceRow {
            number: first_row + offset as u32 + 1,
            cells: values,
        });
    }
    Ok(SourceSheetRows {
        name: sheet.to_owned(),
        rows,
        truncated,
    })
}

fn first_row_index(range: &Range<Data>) -> u32 {
    range.start().map_or(0, |(row, _)| row)
}

fn summarize(name: String, range: &Range<Data>) -> SourceSheet {
    let first_row = first_row_index(range);
    let mut row_count = 0;
    let mut sample = Vec::new();
    for (offset, cells) in range.rows().enumerate() {
        let values = row_values(cells);
        if values.iter().all(Value::is_null) {
            continue;
        }
        row_count += 1;
        if sample.len() < SAMPLE_ROWS {
            sample.push(SourceRow {
                number: first_row + offset as u32 + 1,
                cells: values,
            });
        }
    }
    SourceSheet {
        name,
        row_count,
        column_count: range.width().min(MAX_COLUMNS),
        sample,
    }
}

fn row_values(cells: &[Data]) -> Vec<Value> {
    cells.iter().take(MAX_COLUMNS).map(cell_value).collect()
}

fn cell_value(cell: &Data) -> Value {
    match cell {
        Data::Empty | Data::Error(_) => Value::Null,
        Data::String(text) | Data::DateTimeIso(text) | Data::DurationIso(text) => text_value(text),
        Data::Int(number) => Value::Number((*number).into()),
        Data::Float(number) => float_value(*number),
        Data::Bool(flag) => Value::Bool(*flag),
        Data::DateTime(value) => datetime_value(value),
    }
}

fn text_value(text: &str) -> Value {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Value::Null;
    }
    Value::String(trimmed.chars().take(MAX_CELL_CHARS).collect())
}

fn float_value(number: f64) -> Value {
    if !number.is_finite() {
        return Value::Null;
    }
    if number.fract() == 0.0 && number.abs() < 9.0e15 {
        return Value::Number((number as i64).into());
    }
    Number::from_f64(number).map_or(Value::Null, Value::Number)
}

/// Тривалість — `Г:ХХ`, час доби — `ГГ:ХХ`, дата — `РРРР-ММ-ДД` (з часом, якщо він є).
fn datetime_value(value: &ExcelDateTime) -> Value {
    let days = value.as_f64();
    if !days.is_finite() || days < 0.0 {
        return float_value(days);
    }
    if value.is_duration() {
        let minutes = (days * 24.0 * 60.0).round() as i64;
        return Value::String(format!("{}:{:02}", minutes / 60, minutes % 60));
    }
    if days < 1.0 {
        let minutes = ((days * 24.0 * 60.0).round() as i64).min(24 * 60 - 1);
        return Value::String(format!("{:02}:{:02}", minutes / 60, minutes % 60));
    }
    match value.as_datetime() {
        Some(datetime) if datetime.time() == chrono::NaiveTime::MIN => {
            Value::String(datetime.date().to_string())
        }
        Some(datetime) => Value::String(datetime.format("%Y-%m-%d %H:%M").to_string()),
        None => float_value(days),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

    /// Клітинка синтетичної книги: стиль `0` — загальний, `1` — `[h]:mm`, `2` — `h:mm`, `3` — дата.
    enum Cell {
        Empty,
        Text(&'static str),
        Number(f64),
        Styled(f64, u8),
        Flag(bool),
    }

    struct TestSheet {
        name: &'static str,
        hidden: bool,
        /// Номер першого рядка в аркуші (з 1): над ним лишаються порожні рядки.
        first_row: usize,
        rows: Vec<Vec<Cell>>,
    }

    fn sheet(name: &'static str, rows: Vec<Vec<Cell>>) -> TestSheet {
        TestSheet {
            name,
            hidden: false,
            first_row: 1,
            rows,
        }
    }

    fn workbook(sheets: &[TestSheet]) -> Vec<u8> {
        let mut archive = ZipWriter::new(Cursor::new(Vec::new()));
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        let overrides = (1..=sheets.len())
            .map(|index| {
                format!(
                    "<Override PartName=\"/xl/worksheets/sheet{index}.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>"
                )
            })
            .collect::<String>();
        let relationships = (1..=sheets.len())
            .map(|index| {
                format!(
                    "<Relationship Id=\"rId{index}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet{index}.xml\"/>"
                )
            })
            .chain(std::iter::once(format!(
                "<Relationship Id=\"rId{}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>",
                sheets.len() + 1
            )))
            .collect::<String>();
        let listed = sheets
            .iter()
            .enumerate()
            .map(|(index, item)| {
                format!(
                    "<sheet name=\"{}\" sheetId=\"{}\"{} r:id=\"rId{}\"/>",
                    item.name,
                    index + 1,
                    if item.hidden { " state=\"hidden\"" } else { "" },
                    index + 1
                )
            })
            .collect::<String>();
        let entries: Vec<(String, String)> = vec![
            (
                "[Content_Types].xml".to_owned(),
                format!(
                    "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/><Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/>{overrides}</Types>"
                ),
            ),
            (
                "_rels/.rels".to_owned(),
                "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/></Relationships>".to_owned(),
            ),
            (
                "xl/workbook.xml".to_owned(),
                format!(
                    "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets>{listed}</sheets></workbook>"
                ),
            ),
            (
                "xl/_rels/workbook.xml.rels".to_owned(),
                format!(
                    "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">{relationships}</Relationships>"
                ),
            ),
            ("xl/styles.xml".to_owned(), styles_xml().to_owned()),
        ];
        for (name, contents) in entries {
            archive.start_file(name, options).expect("entry must start");
            archive
                .write_all(contents.as_bytes())
                .expect("entry must write");
        }
        for (index, item) in sheets.iter().enumerate() {
            archive
                .start_file(format!("xl/worksheets/sheet{}.xml", index + 1), options)
                .expect("sheet must start");
            archive
                .write_all(sheet_xml(item).as_bytes())
                .expect("sheet must write");
        }
        archive.finish().expect("archive must finish").into_inner()
    }

    fn styles_xml() -> &'static str {
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><numFmts count=\"2\"><numFmt numFmtId=\"164\" formatCode=\"[h]:mm\"/><numFmt numFmtId=\"165\" formatCode=\"h:mm\"/></numFmts><fonts count=\"1\"><font><sz val=\"11\"/><name val=\"Calibri\"/></font></fonts><fills count=\"2\"><fill><patternFill patternType=\"none\"/></fill><fill><patternFill patternType=\"gray125\"/></fill></fills><borders count=\"1\"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\"/></cellStyleXfs><cellXfs count=\"4\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\"/><xf numFmtId=\"164\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\"/><xf numFmtId=\"165\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\"/><xf numFmtId=\"14\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\"/></cellXfs></styleSheet>"
    }

    fn letters(mut column: usize) -> String {
        let mut text = String::new();
        while column > 0 {
            text.insert(0, (b'A' + ((column - 1) % 26) as u8) as char);
            column = (column - 1) / 26;
        }
        text
    }

    fn escape(value: &str) -> String {
        value
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
    }

    fn sheet_xml(item: &TestSheet) -> String {
        let body = item
            .rows
            .iter()
            .enumerate()
            .map(|(offset, cells)| {
                let row = item.first_row + offset;
                let cells = cells
                    .iter()
                    .enumerate()
                    .map(|(column, cell)| {
                        let reference = format!("{}{}", letters(column + 1), row);
                        match cell {
                            Cell::Empty => String::new(),
                            Cell::Text(text) => format!(
                                "<c r=\"{reference}\" t=\"inlineStr\"><is><t xml:space=\"preserve\">{}</t></is></c>",
                                escape(text)
                            ),
                            Cell::Number(number) => {
                                format!("<c r=\"{reference}\"><v>{number}</v></c>")
                            }
                            Cell::Styled(number, style) => {
                                format!("<c r=\"{reference}\" s=\"{style}\"><v>{number}</v></c>")
                            }
                            Cell::Flag(flag) => format!(
                                "<c r=\"{reference}\" t=\"b\"><v>{}</v></c>",
                                u8::from(*flag)
                            ),
                        }
                    })
                    .collect::<String>();
                format!("<row r=\"{row}\">{cells}</row>")
            })
            .collect::<String>();
        format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData>{body}</sheetData></worksheet>"
        )
    }

    fn texts(values: &[&'static str]) -> Vec<Cell> {
        values.iter().map(|value| Cell::Text(value)).collect()
    }

    #[test]
    fn lists_visible_sheets_with_sizes_and_first_rows() {
        let hidden = TestSheet {
            name: "EasyWAR_Службовий",
            hidden: true,
            first_row: 1,
            rows: vec![texts(&["Службово"])],
        };
        let bytes = workbook(&[
            sheet(
                "Зведена",
                vec![
                    texts(&["Дата", "Район"]),
                    texts(&["2026-01-01", "Тестовий"]),
                ],
            ),
            sheet("Журнал", vec![texts(&["Тип ПС"])]),
            hidden,
        ]);

        let inspected = inspect_bytes(&bytes, "Таблиця.xlsx", "linked").expect("inspect");

        assert_eq!(inspected.file_name, "Таблиця.xlsx");
        assert_eq!(inspected.origin, "linked");
        let names = inspected
            .sheets
            .iter()
            .map(|sheet| sheet.name.as_str())
            .collect::<Vec<_>>();
        assert_eq!(names, ["Зведена", "Журнал"]);
        assert_eq!(inspected.sheets[0].row_count, 2);
        assert_eq!(inspected.sheets[0].column_count, 2);
        assert_eq!(inspected.sheets[0].sample[0].number, 1);
        assert_eq!(
            inspected.sheets[0].sample[0].cells,
            vec![Value::from("Дата"), Value::from("Район")]
        );
    }

    #[test]
    fn row_numbers_follow_the_sheet_when_rows_above_are_empty() {
        let mut journal = sheet(
            "Журнал",
            vec![
                texts(&["Назва журналу"]),
                vec![Cell::Empty],
                texts(&["Тип ПС", "Наліт"]),
                texts(&["Тестовий", "x"]),
            ],
        );
        journal.first_row = 3;
        let bytes = workbook(&[journal]);

        let inspected = inspect_bytes(&bytes, "Таблиця.xlsx", "picked").expect("inspect");
        let numbers = inspected.sheets[0]
            .sample
            .iter()
            .map(|row| row.number)
            .collect::<Vec<_>>();
        // Порожній рядок 4 пропущено; нумерація — як у таблиці.
        assert_eq!(numbers, [3, 5, 6]);
        assert_eq!(inspected.sheets[0].row_count, 3);

        let rows = read_sheet_bytes(&bytes, "Журнал").expect("rows");
        assert_eq!(
            rows.rows.iter().map(|row| row.number).collect::<Vec<_>>(),
            [3, 5, 6]
        );
        assert!(!rows.truncated);
    }

    #[test]
    fn converts_cells_to_plain_json_values() {
        let bytes = workbook(&[sheet(
            "Журнал",
            vec![
                texts(&["Заголовок"]),
                vec![
                    Cell::Text("  Тестовий  "),
                    Cell::Text("   "),
                    Cell::Number(5.0),
                    Cell::Number(0.5),
                    Cell::Flag(true),
                    Cell::Styled(0.022_222_222_222_222_223, 1),
                    Cell::Styled(1.5, 1),
                    Cell::Styled(0.5, 2),
                    Cell::Styled(0.600_694_444_444_444_4, 2),
                    Cell::Styled(46_023.0, 3),
                    Cell::Styled(46_023.5, 3),
                ],
            ],
        )]);

        let rows = read_sheet_bytes(&bytes, "Журнал").expect("rows");
        let cells = &rows.rows[1].cells;

        assert_eq!(
            cells[0],
            Value::from("Тестовий"),
            "пробіли по краях прибрано"
        );
        assert_eq!(cells[1], Value::Null, "клітинка лише з пробілів порожня");
        assert_eq!(
            cells[2],
            serde_json::json!(5),
            "ціле число без дробової частини"
        );
        assert_eq!(cells[3], serde_json::json!(0.5));
        assert_eq!(cells[4], Value::Bool(true));
        assert_eq!(cells[5], Value::from("0:32"), "тривалість [г]:хх");
        assert_eq!(cells[6], Value::from("36:00"), "тривалість понад добу");
        assert_eq!(cells[7], Value::from("12:00"), "час доби");
        assert_eq!(cells[8], Value::from("14:25"));
        assert_eq!(cells[9], Value::from("2026-01-01"), "дата без часу");
        assert_eq!(cells[10], Value::from("2026-01-01 12:00"), "дата з часом");
    }

    #[test]
    fn reading_a_sheet_rejects_unknown_and_hidden_sheets() {
        let hidden = TestSheet {
            name: "EasyWAR_Службовий",
            hidden: true,
            first_row: 1,
            rows: vec![texts(&["Службово"])],
        };
        let bytes = workbook(&[sheet("Журнал", vec![texts(&["Тип ПС"])]), hidden]);

        assert!(matches!(
            read_sheet_bytes(&bytes, "Немає"),
            Err(ModuleSourceError::MissingSheet(name)) if name == "Немає"
        ));
        assert!(matches!(
            read_sheet_bytes(&bytes, "EasyWAR_Службовий"),
            Err(ModuleSourceError::MissingSheet(_))
        ));
    }

    #[test]
    fn large_sheets_are_cut_at_the_row_limit() {
        let mut rows = vec![texts(&["Тип ПС"])];
        for _ in 0..(MAX_DATA_ROWS + HEADER_ALLOWANCE + 5) {
            rows.push(vec![Cell::Number(1.0)]);
        }
        let bytes = workbook(&[sheet("Журнал", rows)]);

        let read = read_sheet_bytes(&bytes, "Журнал").expect("rows");

        assert_eq!(read.rows.len(), MAX_DATA_ROWS + HEADER_ALLOWANCE);
        assert!(read.truncated);
        let inspected = inspect_bytes(&bytes, "Таблиця.xlsx", "linked").expect("inspect");
        assert_eq!(inspected.sheets[0].sample.len(), SAMPLE_ROWS);
        assert_eq!(
            inspected.sheets[0].row_count,
            MAX_DATA_ROWS + HEADER_ALLOWANCE + 6
        );
    }

    #[test]
    fn a_part_inflating_past_the_limit_is_refused_before_it_is_read() {
        let mut archive = ZipWriter::new(Cursor::new(Vec::new()));
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        archive.start_file("xl/sharedStrings.xml", options).unwrap();
        let chunk = vec![0u8; 64 * 1024];
        for _ in 0..48 {
            archive.write_all(&chunk).unwrap();
        }
        let bomb = archive.finish().unwrap().into_inner();
        assert!(bomb.len() < 64 * 1024, "{}", bomb.len());
        let tiny = ZipLimits {
            per_entry: 1024 * 1024,
            total: 2 * 1024 * 1024,
        };

        let error = open_within(&bomb, tiny).err().expect("over the limit");

        assert!(
            matches!(&error, ModuleSourceError::InvalidWorkbook(text) if text.contains("sharedStrings.xml")),
            "{error}"
        );
    }

    #[test]
    fn a_file_that_is_not_a_workbook_is_reported_in_ukrainian() {
        let error = inspect_bytes(b"not a workbook", "x.xlsx", "picked").expect_err("must fail");
        assert!(error
            .to_string()
            .starts_with("Файл не відкривається як книга XLSX"));
    }
}
