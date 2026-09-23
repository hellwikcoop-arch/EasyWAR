use crate::xlsx_import::{EasyWarRecord, EASYWAR_SHEET_NAME, FIELD_SPECS};
use serde::Serialize;
use serde_json::Value;
use std::{
    io::{Cursor, Write},
    path::Path,
};
use tempfile::NamedTempFile;
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

const MONTHS_NOMINATIVE: [&str; 12] = [
    "Січень",
    "Лютий",
    "Березень",
    "Квітень",
    "Травень",
    "Червень",
    "Липень",
    "Серпень",
    "Вересень",
    "Жовтень",
    "Листопад",
    "Грудень",
];

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct XlsxExportResult {
    pub exported_rows: usize,
}

#[derive(Debug, thiserror::Error)]
pub enum XlsxExportError {
    #[error("Немає схвалених записів для експорту")]
    NoApprovedRecords,
    #[error("Схвалений запис має несумісне поле «{field}»")]
    InvalidApprovedField { field: String },
    #[error("Шлях експорту має завершуватися на .xlsx")]
    InvalidDestination,
    #[error("Файл уже існує. Оберіть нову назву — EasyWAR не перезаписує наявні файли")]
    DestinationExists,
    #[error("Не вдалося створити сумісний XLSX: {0}")]
    Archive(#[from] zip::result::ZipError),
    #[error("Не вдалося записати XLSX: {0}")]
    Io(#[from] std::io::Error),
}

pub fn records_from_approved_snapshots(
    snapshots: &[Value],
) -> Result<Vec<EasyWarRecord>, XlsxExportError> {
    let mut records = Vec::new();
    for snapshot in snapshots {
        let approved_records = snapshot
            .get("records")
            .and_then(Value::as_array)
            .ok_or_else(|| XlsxExportError::InvalidApprovedField {
                field: "records".to_owned(),
            })?;
        for record in approved_records {
            records.push(record_from_value(record)?);
        }
    }
    if records.is_empty() {
        return Err(XlsxExportError::NoApprovedRecords);
    }
    Ok(records)
}

pub fn build_compatible_xlsx(records: &[EasyWarRecord]) -> Result<Vec<u8>, XlsxExportError> {
    if records.is_empty() {
        return Err(XlsxExportError::NoApprovedRecords);
    }

    let sheet_xml = worksheet_xml(records);
    let cursor = Cursor::new(Vec::new());
    let mut archive = ZipWriter::new(cursor);
    write_zip_entry(&mut archive, "[Content_Types].xml", content_types())?;
    write_zip_entry(&mut archive, "_rels/.rels", root_relationships())?;
    write_zip_entry(&mut archive, "xl/workbook.xml", &workbook_xml())?;
    write_zip_entry(
        &mut archive,
        "xl/_rels/workbook.xml.rels",
        workbook_relationships(),
    )?;
    write_zip_entry(&mut archive, "xl/worksheets/sheet1.xml", &sheet_xml)?;
    Ok(archive.finish()?.into_inner())
}

pub fn write_new_compatible_xlsx(destination: &Path, bytes: &[u8]) -> Result<(), XlsxExportError> {
    if !destination
        .extension()
        .is_some_and(|extension| extension.to_string_lossy().eq_ignore_ascii_case("xlsx"))
    {
        return Err(XlsxExportError::InvalidDestination);
    }
    if destination.exists() {
        return Err(XlsxExportError::DestinationExists);
    }
    let parent = destination.parent().unwrap_or_else(|| Path::new("."));
    let mut temporary = NamedTempFile::new_in(parent)?;
    temporary.write_all(bytes)?;
    temporary.flush()?;
    temporary.as_file().sync_all()?;
    temporary.persist_noclobber(destination).map_err(|error| {
        if error.error.kind() == std::io::ErrorKind::AlreadyExists {
            XlsxExportError::DestinationExists
        } else {
            XlsxExportError::Io(error.error)
        }
    })?;
    Ok(())
}

fn record_from_value(value: &Value) -> Result<EasyWarRecord, XlsxExportError> {
    let field = |name: &str| optional_string(value, name);
    let date = field("date")?;
    let month = match field("month")? {
        value if !value.is_empty() => value,
        _ => month_from_date(&date),
    };
    Ok(EasyWarRecord {
        number: field("num")?,
        date,
        time: field("time")?,
        target_ids: match field("targets")? {
            value if !value.is_empty() => value,
            _ => field("targetIds")?,
        },
        unit: field("unit")?,
        district: field("district")?,
        coordinates: field("dpi")?,
        target_type: string_or_joined_array(value, "type", "types", ", ")?,
        month,
        aircraft: field("aircraft")?,
        munition: field("munition")?,
        munition_count: field("count")?,
        result: field("result")?,
        cause: string_or_array(value, "cause", "; ")?,
        note: field("note")?,
    })
}

fn optional_string(record: &Value, field: &str) -> Result<String, XlsxExportError> {
    match record.get(field) {
        None | Some(Value::Null) => Ok(String::new()),
        Some(Value::String(value)) => Ok(value.clone()),
        _ => Err(XlsxExportError::InvalidApprovedField {
            field: field.to_owned(),
        }),
    }
}

fn string_or_joined_array(
    record: &Value,
    string_field: &str,
    array_field: &str,
    separator: &str,
) -> Result<String, XlsxExportError> {
    let direct = optional_string(record, string_field)?;
    if !direct.is_empty() {
        return Ok(direct);
    }
    string_or_array(record, array_field, separator)
}

fn string_or_array(
    record: &Value,
    field: &str,
    separator: &str,
) -> Result<String, XlsxExportError> {
    match record.get(field) {
        None | Some(Value::Null) => Ok(String::new()),
        Some(Value::String(value)) => Ok(value.clone()),
        Some(Value::Array(values)) if values.iter().all(Value::is_string) => Ok(values
            .iter()
            .filter_map(Value::as_str)
            .collect::<Vec<_>>()
            .join(separator)),
        _ => Err(XlsxExportError::InvalidApprovedField {
            field: field.to_owned(),
        }),
    }
}

fn month_from_date(date: &str) -> String {
    date.get(5..7)
        .and_then(|month| month.parse::<usize>().ok())
        .filter(|month| (1..=12).contains(month))
        .map(|month| MONTHS_NOMINATIVE[month - 1].to_owned())
        .unwrap_or_default()
}

fn worksheet_xml(records: &[EasyWarRecord]) -> String {
    let mut rows = Vec::with_capacity(records.len() + 1);
    rows.push(
        FIELD_SPECS
            .iter()
            .map(|field| field.header().to_owned())
            .collect::<Vec<_>>(),
    );
    for (index, record) in records.iter().enumerate() {
        let mut values = record
            .legacy_values()
            .into_iter()
            .map(str::to_owned)
            .collect::<Vec<_>>();
        if values[0].trim().is_empty() {
            values[0] = (index + 1).to_string();
        }
        rows.push(values);
    }

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
                    format!(
                        "<c r=\"{reference}\" t=\"inlineStr\"><is><t xml:space=\"preserve\">{}</t></is></c>",
                        xml_escape(value)
                    )
                })
                .collect::<String>();
            format!("<row r=\"{}\">{cells}</row>", row_index + 1)
        })
        .collect::<String>();
    let last_row = rows.len();
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
         <worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">\
         <dimension ref=\"A1:O{last_row}\"/><sheetViews><sheetView workbookViewId=\"0\">\
         <pane ySplit=\"1\" topLeftCell=\"A2\" activePane=\"bottomLeft\" state=\"frozen\"/>\
         </sheetView></sheetViews><sheetFormatPr defaultRowHeight=\"15\"/>\
         <sheetData>{body}</sheetData><autoFilter ref=\"A1:O{last_row}\"/></worksheet>"
    )
}

fn write_zip_entry(
    archive: &mut ZipWriter<Cursor<Vec<u8>>>,
    name: &str,
    contents: &str,
) -> Result<(), XlsxExportError> {
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    archive.start_file(name, options)?;
    archive.write_all(contents.as_bytes())?;
    Ok(())
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
        .chars()
        .filter(|character| {
            matches!(*character, '\t' | '\n' | '\r')
                || (*character >= '\u{20}' && *character != '\u{fffe}' && *character != '\u{ffff}')
        })
        .fold(String::new(), |mut escaped, character| {
            match character {
                '&' => escaped.push_str("&amp;"),
                '<' => escaped.push_str("&lt;"),
                '>' => escaped.push_str("&gt;"),
                '"' => escaped.push_str("&quot;"),
                '\'' => escaped.push_str("&apos;"),
                _ => escaped.push(character),
            }
            escaped
        })
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

fn workbook_xml() -> String {
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
         <workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" \
         xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">\
         <sheets><sheet name=\"{}\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>",
        xml_escape(EASYWAR_SHEET_NAME)
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::xlsx_import::import_easywar_xlsx;
    use serde_json::json;
    use std::fs;

    fn approved_snapshot() -> Value {
        json!({
            "schema_version": 1,
            "header_only": false,
            "chat_date": "2026-01-14",
            "records": [{
                "date": "2026-01-14",
                "time": "09:35",
                "targets": "SYN-101",
                "unit": "Синтетичний підрозділ",
                "district": "Тестовий район & полігон",
                "dpi": "SYNTHETIC MGRS",
                "types": ["Навчальна ціль", "Макет"],
                "aircraft": "Навчальний ЛА",
                "munition": "Навчальний БП",
                "count": "2",
                "result": "НЕВІДОМО",
                "cause": ["Синтетична причина"],
                "note": "Перевірено <локально>"
            }]
        })
    }

    #[test]
    fn approved_snapshot_round_trips_all_legacy_fields_through_supported_reader() {
        let records = records_from_approved_snapshots(&[approved_snapshot()])
            .expect("synthetic approved snapshot must map");
        let workbook =
            build_compatible_xlsx(&records).expect("synthetic compatible workbook must build");
        let imported =
            import_easywar_xlsx(&workbook).expect("exported workbook must reopen in importer");

        assert_eq!(imported.sheet_name, EASYWAR_SHEET_NAME);
        assert_eq!(imported.rows.len(), 1);
        assert_eq!(
            imported.rows[0].parsed,
            EasyWarRecord {
                number: "1".to_owned(),
                date: "2026-01-14".to_owned(),
                time: "09:35".to_owned(),
                target_ids: "SYN-101".to_owned(),
                unit: "Синтетичний підрозділ".to_owned(),
                district: "Тестовий район & полігон".to_owned(),
                coordinates: "SYNTHETIC MGRS".to_owned(),
                target_type: "Навчальна ціль, Макет".to_owned(),
                month: "Січень".to_owned(),
                aircraft: "Навчальний ЛА".to_owned(),
                munition: "Навчальний БП".to_owned(),
                munition_count: "2".to_owned(),
                result: "НЕВІДОМО".to_owned(),
                cause: "Синтетична причина".to_owned(),
                note: "Перевірено <локально>".to_owned(),
            }
        );
    }

    #[test]
    fn new_export_never_overwrites_an_existing_file() {
        let directory = tempfile::tempdir().expect("synthetic temp directory");
        let destination = directory.path().join("synthetic.xlsx");
        fs::write(&destination, b"preserve-existing").expect("write synthetic existing file");

        let error = write_new_compatible_xlsx(&destination, b"replacement")
            .expect_err("existing destination must not be overwritten");

        assert!(matches!(error, XlsxExportError::DestinationExists));
        assert_eq!(fs::read(destination).unwrap(), b"preserve-existing");
    }

    #[test]
    fn new_export_is_written_atomically_and_reopens() {
        let records = records_from_approved_snapshots(&[approved_snapshot()])
            .expect("synthetic approved snapshot must map");
        let workbook = build_compatible_xlsx(&records).expect("synthetic workbook must build");
        let directory = tempfile::tempdir().expect("synthetic temp directory");
        let destination = directory.path().join("synthetic.xlsx");

        write_new_compatible_xlsx(&destination, &workbook)
            .expect("new synthetic destination must be written");

        let persisted = fs::read(destination).expect("synthetic export must be readable");
        assert_eq!(persisted, workbook);
        assert_eq!(
            import_easywar_xlsx(&persisted)
                .expect("persisted synthetic export must reopen")
                .rows
                .len(),
            1
        );
    }

    #[test]
    fn invalid_approved_field_fails_closed() {
        let mut snapshot = approved_snapshot();
        snapshot["records"][0]["cause"] = json!(["ok", 7]);
        assert!(matches!(
            records_from_approved_snapshots(&[snapshot]),
            Err(XlsxExportError::InvalidApprovedField { field }) if field == "cause"
        ));
    }
}
