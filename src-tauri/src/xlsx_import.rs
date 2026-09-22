use calamine::{Data, DataType, Reader, Xlsx};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, io::Cursor};

pub const EASYWAR_SHEET_NAME: &str = "Зведена";

#[derive(Clone, Copy)]
struct FieldSpec {
    key: &'static str,
    header: &'static str,
}

const FIELD_SPECS: [FieldSpec; 15] = [
    FieldSpec {
        key: "number",
        header: "№",
    },
    FieldSpec {
        key: "date",
        header: "Дата",
    },
    FieldSpec {
        key: "time",
        header: "Час ураження",
    },
    FieldSpec {
        key: "target_ids",
        header: "№ цілі (TS/KS)",
    },
    FieldSpec {
        key: "unit",
        header: "В інтересах",
    },
    FieldSpec {
        key: "district",
        header: "Район / н.п.",
    },
    FieldSpec {
        key: "coordinates",
        header: "DPI / Координати MGRS",
    },
    FieldSpec {
        key: "target_type",
        header: "Тип цілі",
    },
    FieldSpec {
        key: "month",
        header: "Місяць",
    },
    FieldSpec {
        key: "aircraft",
        header: "Тип ЛА",
    },
    FieldSpec {
        key: "munition",
        header: "Тип боєприпасу",
    },
    FieldSpec {
        key: "munition_count",
        header: "К-сть боєприпасів",
    },
    FieldSpec {
        key: "result",
        header: "Результат ураження",
    },
    FieldSpec {
        key: "cause",
        header: "Причина",
    },
    FieldSpec {
        key: "note",
        header: "Уточнення результату",
    },
];

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct EasyWarRecord {
    #[serde(rename = "num")]
    pub number: String,
    pub date: String,
    pub time: String,
    #[serde(rename = "targets")]
    pub target_ids: String,
    pub unit: String,
    pub district: String,
    #[serde(rename = "dpi")]
    pub coordinates: String,
    #[serde(rename = "type")]
    pub target_type: String,
    pub month: String,
    pub aircraft: String,
    pub munition: String,
    #[serde(rename = "count")]
    pub munition_count: String,
    pub result: String,
    pub cause: String,
    pub note: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct XlsxSourceCell {
    pub column: u32,
    pub header: String,
    pub value: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct XlsxImportRow {
    pub row_number: u32,
    pub raw_values: BTreeMap<String, String>,
    pub source_cells: Vec<XlsxSourceCell>,
    pub parsed: EasyWarRecord,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct XlsxImportBatch {
    pub workbook_sha256: String,
    pub sheet_name: String,
    pub rows: Vec<XlsxImportRow>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct XlsxInspection {
    pub workbook_sha256: String,
    pub sheet_name: String,
    pub row_count: usize,
}

#[derive(Debug, thiserror::Error)]
pub enum XlsxImportError {
    #[error("Не вдалося відкрити файл .xlsx: {0}")]
    InvalidWorkbook(String),
    #[error("У файлі немає аркуша «Зведена». Знайдені аркуші: {found}")]
    MissingSheet { found: String },
    #[error("На аркуші «Зведена» немає рядка заголовків у першому рядку")]
    MissingHeaderRow,
    #[error("На аркуші «Зведена» не знайдено стовпців: {0}")]
    MissingColumns(String),
    #[error("На аркуші «Зведена» неоднозначні повторні заголовки: {0}")]
    DuplicateColumns(String),
}

pub fn import_easywar_xlsx(bytes: &[u8]) -> Result<XlsxImportBatch, XlsxImportError> {
    let mut workbook = Xlsx::new(Cursor::new(bytes.to_vec()))
        .map_err(|error| XlsxImportError::InvalidWorkbook(error.to_string()))?;
    let sheet_names = workbook.sheet_names();
    let sheet_name = sheet_names
        .iter()
        .find(|name| normalize_label(name) == normalize_label(EASYWAR_SHEET_NAME))
        .cloned()
        .ok_or_else(|| XlsxImportError::MissingSheet {
            found: format_sheet_names(&sheet_names),
        })?;
    let range = workbook
        .worksheet_range(&sheet_name)
        .map_err(|error| XlsxImportError::InvalidWorkbook(error.to_string()))?;
    let start = range.start().ok_or(XlsxImportError::MissingHeaderRow)?;
    if start.0 != 0 {
        return Err(XlsxImportError::MissingHeaderRow);
    }

    let mut rows = range.rows();
    let header_row = rows.next().ok_or(XlsxImportError::MissingHeaderRow)?;
    let column_indexes = resolve_columns(header_row)?;
    let mut imported_rows = Vec::new();

    for (offset, row) in rows.enumerate() {
        if row
            .iter()
            .all(|cell| raw_cell_value(cell).trim().is_empty())
        {
            continue;
        }

        let mut raw_values = BTreeMap::new();
        let mut parsed_values = BTreeMap::new();
        let source_cells = (0..header_row.len().max(row.len()))
            .map(|index| XlsxSourceCell {
                column: start.1 + index as u32 + 1,
                header: header_row
                    .get(index)
                    .map(raw_cell_value)
                    .unwrap_or_default(),
                value: row.get(index).map(raw_cell_value).unwrap_or_default(),
            })
            .collect();
        for (field, column_index) in FIELD_SPECS.iter().zip(column_indexes.iter()) {
            let cell = row.get(*column_index).unwrap_or(&Data::Empty);
            let raw_value = raw_cell_value(cell);
            let parsed_value = if field.key == "date" {
                normalize_date(&raw_value)
            } else {
                raw_value.clone()
            };
            raw_values.insert(field.header.to_owned(), raw_value);
            parsed_values.insert(field.key, parsed_value);
        }

        imported_rows.push(XlsxImportRow {
            row_number: start.0 + offset as u32 + 2,
            raw_values,
            source_cells,
            parsed: record_from_values(&parsed_values),
        });
    }

    Ok(XlsxImportBatch {
        workbook_sha256: sha256_hex(bytes),
        sheet_name,
        rows: imported_rows,
    })
}

pub fn inspect_easywar_xlsx(bytes: &[u8]) -> Result<XlsxInspection, XlsxImportError> {
    let batch = import_easywar_xlsx(bytes)?;
    Ok(XlsxInspection {
        workbook_sha256: batch.workbook_sha256,
        sheet_name: batch.sheet_name,
        row_count: batch.rows.len(),
    })
}

fn resolve_columns(header_row: &[Data]) -> Result<Vec<usize>, XlsxImportError> {
    let normalized_headers: Vec<String> = header_row
        .iter()
        .map(|cell| normalize_label(&raw_cell_value(cell)))
        .collect();
    let mut indexes = Vec::with_capacity(FIELD_SPECS.len());
    let mut missing = Vec::new();
    let mut duplicates = Vec::new();

    for field in FIELD_SPECS {
        let expected_header = normalize_label(field.header);
        let matches: Vec<usize> = normalized_headers
            .iter()
            .enumerate()
            .filter_map(|(index, header)| (header == &expected_header).then_some(index))
            .collect();
        match matches.as_slice() {
            [] => missing.push(field.header),
            [index] => indexes.push(*index),
            _ => duplicates.push(field.header),
        }
    }

    if !duplicates.is_empty() {
        Err(XlsxImportError::DuplicateColumns(duplicates.join(", ")))
    } else if missing.is_empty() {
        Ok(indexes)
    } else {
        Err(XlsxImportError::MissingColumns(missing.join(", ")))
    }
}

fn record_from_values(values: &BTreeMap<&str, String>) -> EasyWarRecord {
    let value = |key: &str| values.get(key).cloned().unwrap_or_default();
    EasyWarRecord {
        number: value("number"),
        date: value("date"),
        time: value("time"),
        target_ids: value("target_ids"),
        unit: value("unit"),
        district: value("district"),
        coordinates: value("coordinates"),
        target_type: value("target_type"),
        month: value("month"),
        aircraft: value("aircraft"),
        munition: value("munition"),
        munition_count: value("munition_count"),
        result: value("result"),
        cause: value("cause"),
        note: value("note"),
    }
}

fn raw_cell_value(cell: &Data) -> String {
    match cell {
        Data::DateTime(value) => value.as_f64().to_string(),
        Data::Empty => String::new(),
        _ => cell.to_string(),
    }
}

fn normalize_date(raw_value: &str) -> String {
    let value = raw_value.trim();
    if is_iso_date(value) {
        return value.to_owned();
    }
    if let Some(prefix) = value.get(..10) {
        if is_iso_date(prefix) && matches!(value.as_bytes().get(10), Some(b'T' | b' ')) {
            return prefix.to_owned();
        }
    }

    let parts: Vec<&str> = value.split(['.', '/']).collect();
    if parts.len() == 3
        && (1..=2).contains(&parts[0].len())
        && (1..=2).contains(&parts[1].len())
        && parts[2].len() == 4
        && parts
            .iter()
            .all(|part| part.chars().all(|ch| ch.is_ascii_digit()))
    {
        return format!("{}-{:0>2}-{:0>2}", parts[2], parts[1], parts[0]);
    }

    // CORE converts only five-digit serials in this window; arbitrary numbers are not dates.
    let mut serial_parts = value.split('.');
    let whole = serial_parts.next().unwrap_or_default();
    let fraction = serial_parts.next();
    let valid_fraction = match fraction {
        None => true,
        Some(part) => !part.is_empty() && part.bytes().all(|ch| ch.is_ascii_digit()),
    };
    let serial_shape = whole.len() == 5
        && whole.bytes().all(|ch| ch.is_ascii_digit())
        && valid_fraction
        && serial_parts.next().is_none();
    if serial_shape {
        if let Ok(serial) = value.parse::<f64>() {
            if serial > 36526.0 && serial < 73051.0 {
                if let Some(date) = Data::Float(serial.floor()).as_date() {
                    return date.to_string();
                }
            }
        }
    }

    value.to_owned()
}

fn is_iso_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 10
        && bytes[0..4].iter().all(u8::is_ascii_digit)
        && bytes[4] == b'-'
        && bytes[5..7].iter().all(u8::is_ascii_digit)
        && bytes[7] == b'-'
        && bytes[8..10].iter().all(u8::is_ascii_digit)
}

fn normalize_label(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn format_sheet_names(sheet_names: &[String]) -> String {
    if sheet_names.is_empty() {
        "немає".to_owned()
    } else {
        sheet_names
            .iter()
            .map(|name| format!("«{name}»"))
            .collect::<Vec<_>>()
            .join(", ")
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

    #[derive(serde::Deserialize)]
    struct SyntheticDateCase {
        raw: String,
        numeric: bool,
        expected: String,
    }

    #[test]
    fn imports_synthetic_zvedena_rows_from_memory() {
        let workbook = synthetic_workbook(EASYWAR_SHEET_NAME, &headers(), true);

        let batch = import_easywar_xlsx(&workbook).expect("synthetic workbook must import");

        assert_eq!(batch.sheet_name, EASYWAR_SHEET_NAME);
        assert_eq!(batch.workbook_sha256.len(), 64);
        assert_eq!(batch.rows.len(), 2);
        assert_eq!(batch.rows[0].row_number, 2);
        assert_eq!(batch.rows[0].raw_values["Дата"], "01.01.2026");
        assert_eq!(batch.rows[0].source_cells[1].header, "Дата");
        assert_eq!(batch.rows[0].source_cells[1].value, "01.01.2026");
        assert_eq!(batch.rows[0].parsed.date, "2026-01-01");
        assert_eq!(batch.rows[0].parsed.target_ids, "SYN-001");
        assert_eq!(batch.rows[1].row_number, 4);
        assert_eq!(batch.rows[1].parsed.date, "2026-01-02");
        assert_eq!(batch.rows[1].parsed.result, "НЕВІДОМО");
    }

    #[test]
    fn serialized_record_uses_all_legacy_core_field_names() {
        let workbook = synthetic_workbook(EASYWAR_SHEET_NAME, &headers(), true);
        let batch = import_easywar_xlsx(&workbook).expect("synthetic workbook must import");

        assert_eq!(
            serde_json::to_value(&batch.rows[0].parsed).expect("record must serialize"),
            serde_json::json!({
                "num": "1",
                "date": "2026-01-01",
                "time": "10:15",
                "targets": "SYN-001",
                "unit": "Синтетичний підрозділ",
                "district": "Тестовий район",
                "dpi": "",
                "type": "Навчальна ціль",
                "month": "Січень",
                "aircraft": "Навчальний ЛА",
                "munition": "Навчальний БП",
                "count": "1",
                "result": "НЕВІДОМО",
                "cause": "",
                "note": "Синтетичний запис"
            })
        );
        assert_eq!(batch.rows[0].raw_values["Дата"], "01.01.2026");
    }

    #[test]
    fn inspection_returns_only_workbook_identity_and_count() {
        let workbook = synthetic_workbook(EASYWAR_SHEET_NAME, &headers(), true);
        let inspection = inspect_easywar_xlsx(&workbook).expect("synthetic workbook must inspect");

        assert_eq!(inspection.sheet_name, EASYWAR_SHEET_NAME);
        assert_eq!(inspection.row_count, 2);
        assert_eq!(inspection.workbook_sha256, sha256_hex(&workbook));
        let json = serde_json::to_value(&inspection).expect("inspection must serialize");
        assert_eq!(json.as_object().expect("object").len(), 3);
        assert!(json.get("rows").is_none());
    }

    #[test]
    fn rejects_workbook_without_zvedena_sheet() {
        let workbook = synthetic_workbook("Інший аркуш", &headers(), false);

        let error = import_easywar_xlsx(&workbook).expect_err("missing sheet must fail");

        assert!(matches!(error, XlsxImportError::MissingSheet { .. }));
        assert!(error.to_string().contains("«Інший аркуш»"));
    }

    #[test]
    fn reports_all_missing_required_headers() {
        let mut incomplete_headers = headers();
        incomplete_headers.retain(|header| {
            *header != "DPI / Координати MGRS" && *header != "Уточнення результату"
        });
        let workbook = synthetic_workbook(EASYWAR_SHEET_NAME, &incomplete_headers, false);

        let error = import_easywar_xlsx(&workbook).expect_err("missing headers must fail");

        assert!(matches!(error, XlsxImportError::MissingColumns(_)));
        assert!(error.to_string().contains("DPI / Координати MGRS"));
        assert!(error.to_string().contains("Уточнення результату"));
    }

    #[test]
    fn preserves_extra_column_values_in_immutable_source_snapshot() {
        let mut column_headers = headers();
        column_headers.push("Додаткове поле");
        let mut source_values = vec![String::new(); column_headers.len()];
        source_values[0] = "1".to_owned();
        source_values[15] = "Синтетичне значення".to_owned();
        let sheet_xml = worksheet_xml(
            &[
                column_headers
                    .iter()
                    .map(|header| header.to_string())
                    .collect(),
                source_values,
            ],
            &[],
        );
        let workbook = build_synthetic_workbook(EASYWAR_SHEET_NAME, &sheet_xml);

        let batch = import_easywar_xlsx(&workbook).expect("synthetic extra column must import");
        assert_eq!(batch.rows[0].raw_values.len(), 15);
        assert_eq!(batch.rows[0].source_cells.len(), 16);
        assert_eq!(batch.rows[0].source_cells[15].column, 16);
        assert_eq!(batch.rows[0].source_cells[15].header, "Додаткове поле");
        assert_eq!(batch.rows[0].source_cells[15].value, "Синтетичне значення");
    }

    #[test]
    fn rejects_duplicate_required_header_after_case_normalization() {
        let mut duplicate_headers = headers();
        duplicate_headers.push("дата");
        let workbook = synthetic_workbook(EASYWAR_SHEET_NAME, &duplicate_headers, false);

        let error = import_easywar_xlsx(&workbook).expect_err("duplicate header must fail closed");

        assert!(matches!(error, XlsxImportError::DuplicateColumns(_)));
        assert!(error.to_string().contains("Дата"));
    }

    #[test]
    fn synthetic_workbook_dates_match_legacy_core_rules() {
        let cases: Vec<SyntheticDateCase> =
            serde_json::from_str(include_str!("../../tests/fixtures/xlsx-date-cases.json"))
                .expect("shared synthetic date cases must parse");
        let mut rows = vec![headers().iter().map(|value| value.to_string()).collect()];
        let mut numeric_date_rows = Vec::new();
        for (index, case) in cases.iter().enumerate() {
            let mut row = vec![String::new(); FIELD_SPECS.len()];
            row[0] = (index + 1).to_string();
            row[1] = case.raw.clone();
            rows.push(row);
            if case.numeric {
                numeric_date_rows.push(index + 1);
            }
        }
        let sheet_xml = worksheet_xml(&rows, &numeric_date_rows);
        let workbook = build_synthetic_workbook(EASYWAR_SHEET_NAME, &sheet_xml);

        let batch = import_easywar_xlsx(&workbook).expect("synthetic dates must import");
        assert_eq!(batch.rows.len(), cases.len());
        for (row, case) in batch.rows.iter().zip(&cases) {
            assert_eq!(row.raw_values.get("Дата"), Some(&case.raw));
            assert_eq!(row.parsed.date, case.expected, "raw date: {}", case.raw);
        }
    }

    fn headers() -> Vec<&'static str> {
        FIELD_SPECS.iter().map(|field| field.header).collect()
    }

    fn synthetic_workbook(sheet_name: &str, headers: &[&str], include_rows: bool) -> Vec<u8> {
        let mut rows = vec![headers.iter().map(|value| value.to_string()).collect()];
        if include_rows {
            rows.push(vec![
                "1".to_owned(),
                "01.01.2026".to_owned(),
                "10:15".to_owned(),
                "SYN-001".to_owned(),
                "Синтетичний підрозділ".to_owned(),
                "Тестовий район".to_owned(),
                String::new(),
                "Навчальна ціль".to_owned(),
                "Січень".to_owned(),
                "Навчальний ЛА".to_owned(),
                "Навчальний БП".to_owned(),
                "1".to_owned(),
                "НЕВІДОМО".to_owned(),
                String::new(),
                "Синтетичний запис".to_owned(),
            ]);
            rows.push(vec![String::new(); headers.len()]);
            rows.push(vec![
                "2".to_owned(),
                "2026-01-02T00:00:00".to_owned(),
                "11:30".to_owned(),
                "SYN-002".to_owned(),
                "Синтетичний підрозділ".to_owned(),
                "Тестовий район".to_owned(),
                String::new(),
                "Навчальна ціль".to_owned(),
                "Січень".to_owned(),
                "Навчальний ЛА".to_owned(),
                "Навчальний БП".to_owned(),
                "1".to_owned(),
                "НЕВІДОМО".to_owned(),
                String::new(),
                "Синтетичний запис".to_owned(),
            ]);
        }

        let sheet_xml = worksheet_xml(&rows, &[]);
        build_synthetic_workbook(sheet_name, &sheet_xml)
    }

    fn build_synthetic_workbook(sheet_name: &str, sheet_xml: &str) -> Vec<u8> {
        let cursor = Cursor::new(Vec::new());
        let mut archive = ZipWriter::new(cursor);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

        write_zip_entry(
            &mut archive,
            "[Content_Types].xml",
            content_types(),
            options,
        );
        write_zip_entry(&mut archive, "_rels/.rels", root_relationships(), options);
        write_zip_entry(
            &mut archive,
            "xl/workbook.xml",
            &workbook_xml(sheet_name),
            options,
        );
        write_zip_entry(
            &mut archive,
            "xl/_rels/workbook.xml.rels",
            workbook_relationships(),
            options,
        );
        write_zip_entry(&mut archive, "xl/worksheets/sheet1.xml", sheet_xml, options);

        archive
            .finish()
            .expect("synthetic archive must finish")
            .into_inner()
    }

    fn write_zip_entry(
        archive: &mut ZipWriter<Cursor<Vec<u8>>>,
        name: &str,
        contents: &str,
        options: SimpleFileOptions,
    ) {
        archive
            .start_file(name, options)
            .expect("synthetic entry must start");
        archive
            .write_all(contents.as_bytes())
            .expect("synthetic entry must write");
    }

    fn worksheet_xml(rows: &[Vec<String>], numeric_date_rows: &[usize]) -> String {
        let body = rows
            .iter()
            .enumerate()
            .map(|(row_index, row)| {
                let cells = row
                    .iter()
                    .enumerate()
                    .map(|(column_index, value)| {
                        let reference =
                            format!("{}{}", column_letters(column_index + 1), row_index + 1);
                        if column_index == 1 && numeric_date_rows.contains(&row_index) {
                            format!("<c r=\"{reference}\" t=\"n\"><v>{value}</v></c>")
                        } else {
                            format!(
                                "<c r=\"{reference}\" t=\"inlineStr\"><is><t>{}</t></is></c>",
                                xml_escape(value)
                            )
                        }
                    })
                    .collect::<String>();
                format!("<row r=\"{}\">{cells}</row>", row_index + 1)
            })
            .collect::<String>();
        format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
             <worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">\
             <sheetData>{body}</sheetData></worksheet>"
        )
    }

    fn column_letters(mut column: usize) -> String {
        let mut letters = String::new();
        while column > 0 {
            let remainder = (column - 1) % 26;
            letters.insert(0, (b'A' + remainder as u8) as char);
            column = (column - 1) / 26;
        }
        letters
    }

    fn xml_escape(value: &str) -> String {
        value
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('"', "&quot;")
            .replace('\'', "&apos;")
    }

    fn content_types() -> &'static str {
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
         <Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">\
         <Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>\
         <Default Extension=\"xml\" ContentType=\"application/xml\"/>\
         <Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>\
         <Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>\
         </Types>"
    }

    fn root_relationships() -> &'static str {
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
         <Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">\
         <Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/>\
         </Relationships>"
    }

    fn workbook_relationships() -> &'static str {
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
         <Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">\
         <Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/>\
         </Relationships>"
    }

    fn workbook_xml(sheet_name: &str) -> String {
        format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
             <workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" \
             xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">\
             <sheets><sheet name=\"{}\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>",
            xml_escape(sheet_name)
        )
    }
}
