use crate::xlsx_import::{
    import_easywar_xlsx, EasyWarRecord, ZipBudget, ZipLimitExceeded, ZipLimits, ZipPartError,
    EASYWAR_SHEET_NAME, FIELD_SPECS,
};
use chrono::NaiveDate;
use quick_xml::{events::Event, Reader};
use regex::{Captures, Regex};
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::{BTreeMap, HashMap},
    io::{Cursor, Write},
    path::Path,
};
use tempfile::NamedTempFile;
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

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
    #[error("Еталонний XLSX несумісний: {0}")]
    InvalidReference(String),
    #[error("Еталонний XLSX використовує непідтримуване стиснення ZIP: {0:?}")]
    UnsupportedCompression(CompressionMethod),
    #[error("Еталонний XLSX відхилено: {0}")]
    ArchiveTooLarge(ZipLimitExceeded),
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

pub fn build_compatible_xlsx_from_reference(
    reference_bytes: &[u8],
    records: &[EasyWarRecord],
) -> Result<Vec<u8>, XlsxExportError> {
    if records.is_empty() {
        return Err(XlsxExportError::NoApprovedRecords);
    }
    let reference = import_easywar_xlsx(reference_bytes)
        .map_err(|error| XlsxExportError::InvalidReference(error.to_string()))?;
    let mut entries = read_archive_entries(reference_bytes)?;
    let entry_map = archive_entry_map(&entries)?;

    let root_relationships = entry_text(&entries, &entry_map, "_rels/.rels")?;
    let workbook_path = relationships(&root_relationships)?
        .into_iter()
        .find(|relationship| relationship.kind.ends_with("/officeDocument"))
        .map(|relationship| normalize_package_path("", &relationship.target))
        .transpose()?
        .ok_or_else(|| {
            XlsxExportError::InvalidReference(
                "у _rels/.rels немає officeDocument relationship".to_owned(),
            )
        })?;
    let workbook_xml = entry_text(&entries, &entry_map, &workbook_path)?;
    let workbook_directory = package_directory(&workbook_path);
    let workbook_relationships_path = relationship_part_path(&workbook_path);
    let workbook_relationships_xml =
        entry_text(&entries, &entry_map, &workbook_relationships_path)?;
    let workbook_relationships = relationships(&workbook_relationships_xml)?;
    let relationships_by_id: HashMap<String, Relationship> = workbook_relationships
        .iter()
        .cloned()
        .map(|relationship| (relationship.id.clone(), relationship))
        .collect();
    let target_sheet = workbook_sheets(&workbook_xml)?
        .into_iter()
        .find(|sheet| normalize_label(&sheet.name) == normalize_label(EASYWAR_SHEET_NAME))
        .ok_or_else(|| {
            XlsxExportError::InvalidReference("не знайдено аркуш «Зведена»".to_owned())
        })?;
    let sheet_relationship = relationships_by_id
        .get(&target_sheet.relationship_id)
        .ok_or_else(|| {
            XlsxExportError::InvalidReference(format!(
                "немає relationship {} для аркуша «Зведена»",
                target_sheet.relationship_id
            ))
        })?;
    let sheet_path = normalize_package_path(&workbook_directory, &sheet_relationship.target)?;
    let shared_strings_path = workbook_relationships
        .iter()
        .find(|relationship| relationship.kind.ends_with("/sharedStrings"))
        .map(|relationship| normalize_package_path(&workbook_directory, &relationship.target))
        .transpose()?;
    let shared_strings = match shared_strings_path {
        Some(path) => parse_shared_strings(&entry_text(&entries, &entry_map, &path)?)?,
        None => Vec::new(),
    };
    let sheet_xml = entry_text(&entries, &entry_map, &sheet_path)?;
    let layout = parse_sheet_layout(&sheet_xml, &shared_strings)?;
    let (updated_sheet, old_last_data_row, old_max_row, new_last_row) =
        append_records_to_reference_sheet(&sheet_xml, &layout, records)?;
    replace_entry(
        &mut entries,
        &entry_map,
        &sheet_path,
        updated_sheet.into_bytes(),
    )?;

    let sheet_relationships_path = relationship_part_path(&sheet_path);
    if let Some(sheet_relationships_index) = entry_map.get(&sheet_relationships_path) {
        let sheet_relationships_xml =
            String::from_utf8(entries[*sheet_relationships_index].bytes.clone()).map_err(|_| {
                XlsxExportError::InvalidReference(format!(
                    "{sheet_relationships_path} не є UTF-8 XML"
                ))
            })?;
        for relationship in relationships(&sheet_relationships_xml)?
            .into_iter()
            .filter(|relationship| relationship.kind.ends_with("/table"))
        {
            let table_path =
                normalize_package_path(&package_directory(&sheet_path), &relationship.target)?;
            let table_xml = entry_text(&entries, &entry_map, &table_path)?;
            if !table_covers_required_headers(&table_xml, &layout)? {
                continue;
            }
            let updated_table =
                extend_table_ranges(&table_xml, old_last_data_row, old_max_row, new_last_row);
            replace_entry(
                &mut entries,
                &entry_map,
                &table_path,
                updated_table.into_bytes(),
            )?;
        }
    }

    let output = write_archive_entries(entries)?;
    let verified = import_easywar_xlsx(&output)
        .map_err(|error| XlsxExportError::InvalidReference(error.to_string()))?;
    if verified.rows.len() != reference.rows.len() + records.len() {
        return Err(XlsxExportError::InvalidReference(
            "самоперевірка не підтвердила кількість рядків після експорту".to_owned(),
        ));
    }
    let appended = &verified.rows[reference.rows.len()..];
    for (offset, (actual, expected)) in appended.iter().zip(records).enumerate() {
        let mut expected = expected.clone();
        expected.number = (layout.next_number + offset as u64 + 1).to_string();
        if actual.parsed != expected {
            return Err(XlsxExportError::InvalidReference(format!(
                "самоперевірка не підтвердила поля нового рядка {}",
                actual.row_number
            )));
        }
    }
    Ok(output)
}

#[derive(Clone, Debug)]
struct ArchiveEntry {
    name: String,
    bytes: Vec<u8>,
    compression: CompressionMethod,
    unix_mode: Option<u32>,
    is_directory: bool,
}

#[derive(Clone, Debug)]
struct Relationship {
    id: String,
    kind: String,
    target: String,
}

#[derive(Clone, Debug)]
struct WorkbookSheet {
    name: String,
    relationship_id: String,
}

#[derive(Clone, Debug, Default)]
struct ParsedCell {
    reference: String,
    kind: String,
    style: Option<String>,
    value: String,
}

#[derive(Clone, Debug, Default)]
struct ParsedRow {
    number: u32,
    cells: Vec<ParsedCell>,
}

#[derive(Clone, Debug)]
struct SheetLayout {
    prefix: String,
    columns_by_key: BTreeMap<&'static str, String>,
    styles_by_key: BTreeMap<&'static str, String>,
    max_row: u32,
    last_data_row: u32,
    next_number: u64,
}

fn read_archive_entries(bytes: &[u8]) -> Result<Vec<ArchiveEntry>, XlsxExportError> {
    read_archive_entries_with_limits(bytes, ZipLimits::DEFAULT)
}

/// Розпаковує всі частини в пам'ять, але не більше за `limits`: один файл з
/// невеликим ZIP-розміром не повинен розгорнутися на гігабайти. Межа міряється за
/// реально розпакованими байтами, а не за розміром із заголовка ZIP.
fn read_archive_entries_with_limits(
    bytes: &[u8],
    limits: ZipLimits,
) -> Result<Vec<ArchiveEntry>, XlsxExportError> {
    let mut archive = ZipArchive::new(Cursor::new(bytes))?;
    let mut entries = Vec::with_capacity(archive.len());
    let mut budget = ZipBudget::new(limits);
    for index in 0..archive.len() {
        let mut file = archive.by_index(index)?;
        if !matches!(
            file.compression(),
            CompressionMethod::Stored | CompressionMethod::Deflated
        ) {
            return Err(XlsxExportError::UnsupportedCompression(file.compression()));
        }
        let mut contents = Vec::new();
        if !file.is_dir() {
            let name = file.name().to_owned();
            budget
                .read_part(&name, &mut file, Some(&mut contents))
                .map_err(|error| match error {
                    ZipPartError::Limit(exceeded) => XlsxExportError::ArchiveTooLarge(exceeded),
                    ZipPartError::Io(error) => XlsxExportError::Io(error),
                })?;
        }
        entries.push(ArchiveEntry {
            name: file.name().to_owned(),
            bytes: contents,
            compression: file.compression(),
            unix_mode: file.unix_mode(),
            is_directory: file.is_dir(),
        });
    }
    Ok(entries)
}

fn write_archive_entries(entries: Vec<ArchiveEntry>) -> Result<Vec<u8>, XlsxExportError> {
    let mut archive = ZipWriter::new(Cursor::new(Vec::new()));
    for entry in entries {
        let mut options = SimpleFileOptions::default().compression_method(entry.compression);
        if let Some(mode) = entry.unix_mode {
            options = options.unix_permissions(mode);
        }
        if entry.is_directory {
            archive.add_directory(&entry.name, options)?;
        } else {
            archive.start_file(&entry.name, options)?;
            archive.write_all(&entry.bytes)?;
        }
    }
    Ok(archive.finish()?.into_inner())
}

fn archive_entry_map(entries: &[ArchiveEntry]) -> Result<HashMap<String, usize>, XlsxExportError> {
    let mut entry_map = HashMap::with_capacity(entries.len());
    for (index, entry) in entries.iter().enumerate() {
        if entry_map.insert(entry.name.clone(), index).is_some() {
            return Err(XlsxExportError::InvalidReference(format!(
                "XLSX містить повторну ZIP-частину {}",
                entry.name
            )));
        }
    }
    Ok(entry_map)
}

fn entry_text(
    entries: &[ArchiveEntry],
    entry_map: &HashMap<String, usize>,
    name: &str,
) -> Result<String, XlsxExportError> {
    let index = entry_map
        .get(name)
        .ok_or_else(|| XlsxExportError::InvalidReference(format!("у XLSX немає частини {name}")))?;
    String::from_utf8(entries[*index].bytes.clone())
        .map_err(|_| XlsxExportError::InvalidReference(format!("частина {name} не є UTF-8 XML")))
}

fn replace_entry(
    entries: &mut [ArchiveEntry],
    entry_map: &HashMap<String, usize>,
    name: &str,
    bytes: Vec<u8>,
) -> Result<(), XlsxExportError> {
    let index = entry_map
        .get(name)
        .ok_or_else(|| XlsxExportError::InvalidReference(format!("у XLSX немає частини {name}")))?;
    entries[*index].bytes = bytes;
    Ok(())
}

fn relationships(xml: &str) -> Result<Vec<Relationship>, XlsxExportError> {
    let mut reader = Reader::from_str(xml);
    reader.trim_text(true);
    let mut buffer = Vec::new();
    let mut relationships = Vec::new();
    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(element) | Event::Empty(element))
                if local_xml_name(element.name().as_ref()) == b"Relationship" =>
            {
                let attributes = xml_attributes(&element)?;
                relationships.push(Relationship {
                    id: required_attribute(&attributes, "Id")?,
                    kind: required_attribute(&attributes, "Type")?,
                    target: required_attribute(&attributes, "Target")?,
                });
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(error) => {
                return Err(XlsxExportError::InvalidReference(format!(
                    "некоректний relationships XML: {error}"
                )))
            }
        }
        buffer.clear();
    }
    Ok(relationships)
}

fn workbook_sheets(xml: &str) -> Result<Vec<WorkbookSheet>, XlsxExportError> {
    let mut reader = Reader::from_str(xml);
    reader.trim_text(true);
    let mut buffer = Vec::new();
    let mut sheets = Vec::new();
    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(element) | Event::Empty(element))
                if local_xml_name(element.name().as_ref()) == b"sheet" =>
            {
                let attributes = xml_attributes(&element)?;
                let relationship_id = attributes
                    .iter()
                    .find(|(key, _)| key.as_str() == "id" || key.ends_with(":id"))
                    .map(|(_, value)| value.clone())
                    .ok_or_else(|| {
                        XlsxExportError::InvalidReference("аркуш не має relationship id".to_owned())
                    })?;
                sheets.push(WorkbookSheet {
                    name: required_attribute(&attributes, "name")?,
                    relationship_id,
                });
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(error) => {
                return Err(XlsxExportError::InvalidReference(format!(
                    "некоректний workbook XML: {error}"
                )))
            }
        }
        buffer.clear();
    }
    Ok(sheets)
}

fn xml_attributes(
    element: &quick_xml::events::BytesStart<'_>,
) -> Result<BTreeMap<String, String>, XlsxExportError> {
    element
        .attributes()
        .with_checks(false)
        .map(|attribute| {
            let attribute = attribute.map_err(|error| {
                XlsxExportError::InvalidReference(format!("некоректний XML-атрибут: {error}"))
            })?;
            let key = std::str::from_utf8(attribute.key.as_ref())
                .map_err(|_| {
                    XlsxExportError::InvalidReference("ім'я XML-атрибута не є UTF-8".to_owned())
                })?
                .to_owned();
            let encoded_value = std::str::from_utf8(attribute.value.as_ref()).map_err(|_| {
                XlsxExportError::InvalidReference("значення XML-атрибута не є UTF-8".to_owned())
            })?;
            let value = quick_xml::escape::unescape(encoded_value)
                .map_err(|error| {
                    XlsxExportError::InvalidReference(format!(
                        "некоректне значення XML-атрибута: {error}"
                    ))
                })?
                .into_owned();
            Ok((key, value))
        })
        .collect()
}

fn required_attribute(
    attributes: &BTreeMap<String, String>,
    name: &str,
) -> Result<String, XlsxExportError> {
    attributes.get(name).cloned().ok_or_else(|| {
        XlsxExportError::InvalidReference(format!("XML-елемент не має атрибута {name}"))
    })
}

fn local_xml_name(name: &[u8]) -> &[u8] {
    name.rsplit(|byte| *byte == b':').next().unwrap_or(name)
}

fn normalize_package_path(base_directory: &str, target: &str) -> Result<String, XlsxExportError> {
    let candidate = if target.starts_with('/') {
        target.trim_start_matches('/').to_owned()
    } else {
        format!("{base_directory}{target}")
    };
    let mut parts = Vec::new();
    for part in candidate.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                if parts.pop().is_none() {
                    return Err(XlsxExportError::InvalidReference(
                        "relationship виходить за межі XLSX-пакета".to_owned(),
                    ));
                }
            }
            _ => parts.push(part),
        }
    }
    if parts.is_empty() {
        return Err(XlsxExportError::InvalidReference(
            "relationship має порожній шлях".to_owned(),
        ));
    }
    Ok(parts.join("/"))
}

fn package_directory(path: &str) -> String {
    path.rsplit_once('/')
        .map(|(directory, _)| format!("{directory}/"))
        .unwrap_or_default()
}

fn relationship_part_path(path: &str) -> String {
    match path.rsplit_once('/') {
        Some((directory, file)) => format!("{directory}/_rels/{file}.rels"),
        None => format!("_rels/{path}.rels"),
    }
}

fn parse_shared_strings(xml: &str) -> Result<Vec<String>, XlsxExportError> {
    let mut reader = Reader::from_str(xml);
    reader.trim_text(false);
    let mut buffer = Vec::new();
    let mut in_item = false;
    let mut in_text = false;
    let mut current = String::new();
    let mut values = Vec::new();
    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(element)) if local_xml_name(element.name().as_ref()) == b"si" => {
                in_item = true;
                current.clear();
            }
            Ok(Event::End(element)) if local_xml_name(element.name().as_ref()) == b"si" => {
                if in_item {
                    values.push(current.clone());
                }
                in_item = false;
            }
            Ok(Event::Start(element)) if local_xml_name(element.name().as_ref()) == b"t" => {
                in_text = in_item;
            }
            Ok(Event::End(element)) if local_xml_name(element.name().as_ref()) == b"t" => {
                in_text = false;
            }
            Ok(Event::Text(text)) if in_text => {
                current.push_str(&text.unescape().map_err(|error| {
                    XlsxExportError::InvalidReference(format!("некоректний shared string: {error}"))
                })?)
            }
            Ok(Event::CData(text)) if in_text => {
                current.push_str(&String::from_utf8_lossy(text.as_ref()))
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(error) => {
                return Err(XlsxExportError::InvalidReference(format!(
                    "некоректний sharedStrings XML: {error}"
                )))
            }
        }
        buffer.clear();
    }
    Ok(values)
}

fn parse_sheet_layout(
    xml: &str,
    shared_strings: &[String],
) -> Result<SheetLayout, XlsxExportError> {
    let prefix = Regex::new(r"<((?:\w+:)?)sheetData\b")
        .expect("static regex")
        .captures(xml)
        .and_then(|captures| captures.get(1))
        .map(|capture| capture.as_str().to_owned())
        .ok_or_else(|| XlsxExportError::InvalidReference("на аркуші немає sheetData".to_owned()))?;
    let rows = parse_rows(xml, shared_strings)?;
    let header = rows.iter().find(|row| row.number == 1).ok_or_else(|| {
        XlsxExportError::InvalidReference("на аркуші немає першого рядка заголовків".to_owned())
    })?;
    let mut columns_by_key = BTreeMap::new();
    for field in FIELD_SPECS {
        let matches = header
            .cells
            .iter()
            .filter(|cell| normalize_label(&cell.value) == normalize_label(field.header()))
            .collect::<Vec<_>>();
        match matches.as_slice() {
            [cell] => {
                columns_by_key.insert(field.key(), cell_column(&cell.reference)?);
            }
            [] => {
                return Err(XlsxExportError::InvalidReference(format!(
                    "не знайдено заголовок «{}»",
                    field.header()
                )))
            }
            _ => {
                return Err(XlsxExportError::InvalidReference(format!(
                    "повторний заголовок «{}»",
                    field.header()
                )))
            }
        }
    }
    let max_row = rows.iter().map(|row| row.number).max().unwrap_or(1).max(1);
    let last_data_row = rows
        .iter()
        .filter(|row| row.number > 1 && row.cells.iter().any(|cell| !cell.value.trim().is_empty()))
        .map(|row| row.number)
        .max()
        .unwrap_or(1);
    let mut styles_by_key = BTreeMap::new();
    for field in FIELD_SPECS {
        let Some(column) = columns_by_key.get(field.key()) else {
            continue;
        };
        if let Some(style) = rows
            .iter()
            .filter(|row| row.number > 1)
            .rev()
            .flat_map(|row| row.cells.iter())
            .find(|cell| {
                cell_column(&cell.reference)
                    .map(|value| value == *column)
                    .unwrap_or(false)
            })
            .and_then(|cell| cell.style.clone())
        {
            styles_by_key.insert(field.key(), style);
        }
    }
    let number_column = columns_by_key
        .get("number")
        .ok_or_else(|| XlsxExportError::InvalidReference("не визначено стовпець №".to_owned()))?;
    let next_number = rows
        .iter()
        .flat_map(|row| row.cells.iter())
        .filter(|cell| {
            cell_column(&cell.reference)
                .map(|value| value == *number_column)
                .unwrap_or(false)
        })
        .filter_map(|cell| cell.value.trim().parse::<u64>().ok())
        .max()
        .unwrap_or(0);
    Ok(SheetLayout {
        prefix,
        columns_by_key,
        styles_by_key,
        max_row,
        last_data_row,
        next_number,
    })
}

fn parse_rows(xml: &str, shared_strings: &[String]) -> Result<Vec<ParsedRow>, XlsxExportError> {
    let mut reader = Reader::from_str(xml);
    reader.trim_text(false);
    let mut buffer = Vec::new();
    let mut rows = Vec::new();
    let mut current_row: Option<ParsedRow> = None;
    let mut current_cell: Option<ParsedCell> = None;
    let mut in_value = false;
    let mut in_inline_text = false;
    let mut raw_value = String::new();
    let mut inline_value = String::new();
    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(element)) if local_xml_name(element.name().as_ref()) == b"row" => {
                let attributes = xml_attributes(&element)?;
                let number = required_attribute(&attributes, "r")?
                    .parse::<u32>()
                    .map_err(|_| {
                        XlsxExportError::InvalidReference(
                            "рядок аркуша має некоректний номер".to_owned(),
                        )
                    })?;
                current_row = Some(ParsedRow {
                    number,
                    cells: Vec::new(),
                });
            }
            Ok(Event::Empty(element)) if local_xml_name(element.name().as_ref()) == b"row" => {
                let attributes = xml_attributes(&element)?;
                let number = required_attribute(&attributes, "r")?
                    .parse::<u32>()
                    .map_err(|_| {
                        XlsxExportError::InvalidReference(
                            "рядок аркуша має некоректний номер".to_owned(),
                        )
                    })?;
                rows.push(ParsedRow {
                    number,
                    cells: Vec::new(),
                });
            }
            Ok(Event::End(element)) if local_xml_name(element.name().as_ref()) == b"row" => {
                if let Some(row) = current_row.take() {
                    rows.push(row);
                }
            }
            Ok(Event::Start(element)) if local_xml_name(element.name().as_ref()) == b"c" => {
                let attributes = xml_attributes(&element)?;
                current_cell = Some(ParsedCell {
                    reference: required_attribute(&attributes, "r")?,
                    kind: attributes.get("t").cloned().unwrap_or_default(),
                    style: attributes.get("s").cloned(),
                    value: String::new(),
                });
                raw_value.clear();
                inline_value.clear();
            }
            Ok(Event::Empty(element)) if local_xml_name(element.name().as_ref()) == b"c" => {
                let attributes = xml_attributes(&element)?;
                if let Some(row) = current_row.as_mut() {
                    row.cells.push(ParsedCell {
                        reference: required_attribute(&attributes, "r")?,
                        kind: attributes.get("t").cloned().unwrap_or_default(),
                        style: attributes.get("s").cloned(),
                        value: String::new(),
                    });
                }
            }
            Ok(Event::End(element)) if local_xml_name(element.name().as_ref()) == b"c" => {
                if let Some(mut cell) = current_cell.take() {
                    cell.value = match cell.kind.as_str() {
                        "s" => raw_value
                            .parse::<usize>()
                            .ok()
                            .and_then(|index| shared_strings.get(index))
                            .cloned()
                            .ok_or_else(|| {
                                XlsxExportError::InvalidReference(format!(
                                    "комірка {} посилається на відсутній shared string",
                                    cell.reference
                                ))
                            })?,
                        "inlineStr" => inline_value.clone(),
                        _ => raw_value.clone(),
                    };
                    if let Some(row) = current_row.as_mut() {
                        row.cells.push(cell);
                    }
                }
            }
            Ok(Event::Start(element)) if local_xml_name(element.name().as_ref()) == b"v" => {
                in_value = current_cell.is_some();
            }
            Ok(Event::End(element)) if local_xml_name(element.name().as_ref()) == b"v" => {
                in_value = false;
            }
            Ok(Event::Start(element)) if local_xml_name(element.name().as_ref()) == b"t" => {
                in_inline_text = current_cell.is_some();
            }
            Ok(Event::End(element)) if local_xml_name(element.name().as_ref()) == b"t" => {
                in_inline_text = false;
            }
            Ok(Event::Text(text)) if in_value => {
                raw_value.push_str(&text.unescape().map_err(|error| {
                    XlsxExportError::InvalidReference(format!(
                        "некоректне значення комірки: {error}"
                    ))
                })?)
            }
            Ok(Event::Text(text)) if in_inline_text => {
                inline_value.push_str(&text.unescape().map_err(|error| {
                    XlsxExportError::InvalidReference(format!("некоректний inline string: {error}"))
                })?)
            }
            Ok(Event::CData(text)) if in_inline_text => {
                inline_value.push_str(&String::from_utf8_lossy(text.as_ref()))
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(error) => {
                return Err(XlsxExportError::InvalidReference(format!(
                    "некоректний worksheet XML: {error}"
                )))
            }
        }
        buffer.clear();
    }
    Ok(rows)
}

fn append_records_to_reference_sheet(
    xml: &str,
    layout: &SheetLayout,
    records: &[EasyWarRecord],
) -> Result<(String, u32, u32, u32), XlsxExportError> {
    let mut ordered_fields = FIELD_SPECS
        .iter()
        .map(|field| -> Result<_, XlsxExportError> {
            let column = layout
                .columns_by_key
                .get(field.key())
                .cloned()
                .ok_or_else(|| {
                    XlsxExportError::InvalidReference(format!(
                        "не визначено стовпець «{}»",
                        field.header()
                    ))
                })?;
            Ok((column_number(&column)?, *field, column))
        })
        .collect::<Result<Vec<_>, _>>()?;
    ordered_fields.sort_by_key(|(number, _, _)| *number);
    let mut rows_xml = String::new();
    let mut row_number = layout.max_row;
    for (offset, record) in records.iter().enumerate() {
        row_number = row_number.checked_add(1).ok_or_else(|| {
            XlsxExportError::InvalidReference("забагато рядків в еталонному XLSX".to_owned())
        })?;
        let mut values = record.legacy_values();
        let assigned_number = (layout.next_number + offset as u64 + 1).to_string();
        values[0] = &assigned_number;
        let mut cells = String::new();
        for (_, field, column) in &ordered_fields {
            let field_index = FIELD_SPECS
                .iter()
                .position(|candidate| candidate.key() == field.key())
                .expect("field must come from FIELD_SPECS");
            let value = values[field_index];
            let reference = format!("{column}{row_number}");
            let style = layout
                .styles_by_key
                .get(field.key())
                .map(|style| format!(" s=\"{}\"", xml_escape(style)))
                .unwrap_or_default();
            if value.is_empty() {
                cells.push_str(&format!("<{}c r=\"{reference}\"{style}/>", layout.prefix));
            } else if field.key() == "date" {
                if let (Some(serial), Some(_)) = (
                    date_to_excel_serial(value),
                    layout.styles_by_key.get("date"),
                ) {
                    cells.push_str(&format!(
                        "<{}c r=\"{reference}\"{style}><{}v>{serial}</{}v></{}c>",
                        layout.prefix, layout.prefix, layout.prefix, layout.prefix
                    ));
                } else {
                    cells.push_str(&inline_string_cell(
                        &layout.prefix,
                        &reference,
                        &style,
                        value,
                    ));
                }
            } else if field.key() == "number" {
                cells.push_str(&format!(
                    "<{}c r=\"{reference}\"{style} t=\"n\"><{}v>{}</{}v></{}c>",
                    layout.prefix,
                    layout.prefix,
                    xml_escape(value),
                    layout.prefix,
                    layout.prefix
                ));
            } else {
                cells.push_str(&inline_string_cell(
                    &layout.prefix,
                    &reference,
                    &style,
                    value,
                ));
            }
        }
        rows_xml.push_str(&format!(
            "<{}row r=\"{row_number}\">{cells}</{}row>",
            layout.prefix, layout.prefix
        ));
    }
    let closing_sheet_data = format!("</{}sheetData>", layout.prefix);
    let insertion = xml.rfind(&closing_sheet_data).ok_or_else(|| {
        XlsxExportError::InvalidReference("не знайдено кінець sheetData".to_owned())
    })?;
    let mut updated = String::with_capacity(xml.len() + rows_xml.len());
    updated.push_str(&xml[..insertion]);
    updated.push_str(&rows_xml);
    updated.push_str(&xml[insertion..]);
    updated = extend_sheet_ranges(&updated, layout.last_data_row, layout.max_row, row_number);
    Ok((updated, layout.last_data_row, layout.max_row, row_number))
}

fn inline_string_cell(prefix: &str, reference: &str, style: &str, value: &str) -> String {
    format!(
        "<{prefix}c r=\"{reference}\"{style} t=\"inlineStr\"><{prefix}is><{prefix}t xml:space=\"preserve\">{}</{prefix}t></{prefix}is></{prefix}c>",
        xml_escape(value)
    )
}

fn date_to_excel_serial(value: &str) -> Option<i64> {
    let date = NaiveDate::parse_from_str(value, "%Y-%m-%d").ok()?;
    let epoch = NaiveDate::from_ymd_opt(1899, 12, 30)?;
    Some(date.signed_duration_since(epoch).num_days())
}

fn extend_sheet_ranges(xml: &str, old_last_data: u32, old_max: u32, new_last: u32) -> String {
    let patterns = [
        r#"(<(?:\w+:)?dimension\b[^>]*?\sref=")([^"]+)(")"#,
        r#"(<(?:\w+:)?(?:conditionalFormatting|dataValidation)\b[^>]*?\ssqref=")([^"]+)(")"#,
        r#"(<(?:\w+:)?autoFilter\b[^>]*?\sref=")([^"]+)(")"#,
    ];
    patterns.iter().fold(xml.to_owned(), |current, pattern| {
        Regex::new(pattern)
            .expect("static regex")
            .replace_all(&current, |captures: &Captures<'_>| {
                format!(
                    "{}{}{}",
                    &captures[1],
                    extend_range_reference(&captures[2], old_last_data, old_max, new_last),
                    &captures[3]
                )
            })
            .into_owned()
    })
}

fn extend_table_ranges(xml: &str, old_last_data: u32, old_max: u32, new_last: u32) -> String {
    let patterns = [
        r#"(<(?:\w+:)?table\b[^>]*?\sref=")([^"]+)(")"#,
        r#"(<(?:\w+:)?autoFilter\b[^>]*?\sref=")([^"]+)(")"#,
    ];
    patterns.iter().fold(xml.to_owned(), |current, pattern| {
        Regex::new(pattern)
            .expect("static regex")
            .replace_all(&current, |captures: &Captures<'_>| {
                format!(
                    "{}{}{}",
                    &captures[1],
                    extend_range_reference(&captures[2], old_last_data, old_max, new_last),
                    &captures[3]
                )
            })
            .into_owned()
    })
}

fn table_covers_required_headers(xml: &str, layout: &SheetLayout) -> Result<bool, XlsxExportError> {
    let table_range = Regex::new(r#"<(?:\w+:)?table\b[^>]*?\sref=\"([A-Z]+)(\d+):([A-Z]+)(\d+)\""#)
        .expect("static regex");
    let Some(captures) = table_range.captures(xml) else {
        return Ok(false);
    };
    let Some(start_row) = captures[2].parse::<u32>().ok() else {
        return Ok(false);
    };
    if start_row != 1 {
        return Ok(false);
    }
    let start_column = column_number(&captures[1])?;
    let end_column = column_number(&captures[3])?;
    let required_columns = layout
        .columns_by_key
        .values()
        .map(|column| column_number(column))
        .collect::<Result<Vec<_>, _>>()?;
    let (Some(required_min), Some(required_max)) = (
        required_columns.iter().copied().min(),
        required_columns.iter().copied().max(),
    ) else {
        return Ok(false);
    };
    Ok(start_column <= required_min && end_column >= required_max)
}

fn extend_range_reference(
    reference: &str,
    old_last_data: u32,
    old_max: u32,
    new_last: u32,
) -> String {
    let range = Regex::new(r"^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$").expect("static regex");
    reference
        .split_whitespace()
        .map(|token| {
            let Some(captures) = range.captures(token) else {
                return token.to_owned();
            };
            let end_row = captures
                .get(4)
                .and_then(|value| value.as_str().parse::<u32>().ok());
            if end_row.is_some_and(|row| row == old_last_data || row == old_max) {
                format!(
                    "{}{}:{}{}",
                    &captures[1],
                    &captures[2],
                    captures.get(3).map(|value| value.as_str()).unwrap_or(""),
                    new_last
                )
            } else {
                token.to_owned()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn cell_column(reference: &str) -> Result<String, XlsxExportError> {
    let column = reference
        .chars()
        .take_while(|character| character.is_ascii_alphabetic())
        .collect::<String>()
        .to_uppercase();
    if column.is_empty() {
        Err(XlsxExportError::InvalidReference(format!(
            "комірка має некоректну адресу {reference}"
        )))
    } else {
        Ok(column)
    }
}

/// Номер стовпця за літерами: `A` = 1, `Z` = 26, `AA` = 27. Літери беруться з XML
/// книги, тож довжина не обмежена: переповнення й символи поза `A`–`Z` дають
/// помилку замість паніки чи хибного номера.
fn column_number(column: &str) -> Result<usize, XlsxExportError> {
    let number = if column.is_empty() {
        None
    } else {
        column.bytes().try_fold(0usize, |number, byte| {
            if !byte.is_ascii_uppercase() {
                return None;
            }
            number
                .checked_mul(26)?
                .checked_add(usize::from(byte - b'A') + 1)
        })
    };
    number.ok_or_else(|| {
        let shown: String = column.chars().take(16).collect();
        let ellipsis = if column.chars().count() > 16 {
            "…"
        } else {
            ""
        };
        XlsxExportError::InvalidReference(format!(
            "некоректна або завелика назва стовпця «{shown}{ellipsis}»"
        ))
    })
}

fn normalize_label(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
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
    fn reference_export_preserves_unrelated_parts_and_extends_the_existing_table() {
        let reference = synthetic_reference_workbook();
        let original_reference = reference.clone();
        let records = records_from_approved_snapshots(&[approved_snapshot()])
            .expect("synthetic approved snapshot must map");

        let output = build_compatible_xlsx_from_reference(&reference, &records)
            .expect("synthetic reference export must build");

        assert_eq!(reference, original_reference);
        let imported = import_easywar_xlsx(&output).expect("reference export must reopen");
        assert_eq!(imported.rows.len(), 2);
        assert_eq!(imported.rows[0].parsed.number, "7");
        assert_eq!(imported.rows[1].parsed.number, "8");
        assert_eq!(imported.rows[1].parsed.date, "2026-01-14");
        assert_eq!(imported.rows[1].parsed.note, "Перевірено <локально>");

        let reference_entries = read_archive_entries(&reference).unwrap();
        let output_entries = read_archive_entries(&output).unwrap();
        let reference_map = archive_entry_map(&reference_entries).unwrap();
        let output_map = archive_entry_map(&output_entries).unwrap();
        for part in [
            "xl/workbook.xml",
            "xl/worksheets/sheet2.xml",
            "xl/sharedStrings.xml",
            "xl/styles.xml",
        ] {
            assert_eq!(
                reference_entries[*reference_map.get(part).unwrap()].bytes,
                output_entries[*output_map.get(part).unwrap()].bytes,
                "unrelated part changed: {part}"
            );
        }
        let table = entry_text(&output_entries, &output_map, "xl/tables/table1.xml").unwrap();
        assert!(table.contains("ref=\"A1:O3\""));
        assert!(!table.contains("ref=\"A1:O2\""));
        let sheet = entry_text(&output_entries, &output_map, "xl/worksheets/sheet1.xml").unwrap();
        assert!(sheet.contains("<row r=\"3\">"));
        assert!(sheet.contains("<c r=\"B3\" s=\"1\"><v>46036</v></c>"));
    }

    #[test]
    fn reference_ranges_extend_past_a_styled_blank_tail_row() {
        let sheet = r#"<worksheet><dimension ref="A1:O3"/><sheetData/><autoFilter ref="A1:O2"/></worksheet>"#;
        let table = r#"<table ref="A1:O3"><autoFilter ref="A1:O3"/></table>"#;

        let updated_sheet = extend_sheet_ranges(sheet, 2, 3, 4);
        let updated_table = extend_table_ranges(table, 2, 3, 4);

        assert!(updated_sheet.contains("dimension ref=\"A1:O4\""));
        assert!(updated_sheet.contains("autoFilter ref=\"A1:O4\""));
        assert!(updated_table.contains("table ref=\"A1:O4\""));
        assert!(updated_table.contains("autoFilter ref=\"A1:O4\""));
    }

    #[test]
    fn only_a_table_covering_all_required_headers_is_selected() {
        let layout = SheetLayout {
            prefix: String::new(),
            columns_by_key: FIELD_SPECS
                .iter()
                .enumerate()
                .map(|(index, field)| (field.key(), column_letters(index + 1)))
                .collect(),
            styles_by_key: BTreeMap::new(),
            max_row: 2,
            last_data_row: 2,
            next_number: 1,
        };

        assert!(table_covers_required_headers(r#"<table ref="A1:O2"/>"#, &layout).unwrap());
        assert!(!table_covers_required_headers(r#"<table ref="Q1:S2"/>"#, &layout).unwrap());
        assert!(!table_covers_required_headers(r#"<table ref="A2:O8"/>"#, &layout).unwrap());

        // Назва стовпця з XML таблиці, що не вміщається в usize, — помилка, а не переповнення.
        let absurd = format!(r#"<table ref="A1:{}2"/>"#, "Z".repeat(64));
        assert!(matches!(
            table_covers_required_headers(&absurd, &layout),
            Err(XlsxExportError::InvalidReference(_))
        ));
    }

    #[test]
    fn column_numbers_follow_the_spreadsheet_scheme() {
        for (letters, number) in [("A", 1), ("Z", 26), ("AA", 27), ("AZ", 52), ("XFD", 16384)] {
            assert_eq!(column_number(letters).unwrap(), number, "{letters}");
            assert_eq!(column_letters(number), letters);
        }
    }

    #[test]
    fn absurdly_long_or_foreign_column_letters_are_an_error_not_an_overflow() {
        // 14 літер «Z» уже не вміщаються в u64, тож на 64-бітній ОС це й межа переповнення.
        for length in [14, 15, 64, 100_000] {
            let letters = "Z".repeat(length);
            let result = column_number(&letters);
            assert!(
                matches!(&result, Err(XlsxExportError::InvalidReference(message))
                    if message.contains("назва стовпця")),
                "{length}: {result:?}"
            );
        }
        // Повідомлення не повторює весь вхід.
        let Err(XlsxExportError::InvalidReference(message)) = column_number(&"Z".repeat(100_000))
        else {
            panic!("overflow must be an error");
        };
        assert!(message.chars().count() < 200, "{}", message.chars().count());

        for invalid in ["", "a", "A1", "Б", "A-Z", " A"] {
            assert!(
                matches!(
                    column_number(invalid),
                    Err(XlsxExportError::InvalidReference(_))
                ),
                "{invalid:?}"
            );
        }
        // Найдовша назва, що ще вміщається: 13 літер «Z» не переповнюють 64-бітне число.
        if usize::BITS == 64 {
            assert!(column_number(&"Z".repeat(13)).is_ok());
        }
    }

    #[test]
    fn a_sheet_with_an_absurd_column_fails_closed_instead_of_overflowing() {
        // Синтетичний лист, у якому адреса комірки заголовка «№» має 40 літер. Парсер
        // calamine на таких адресах сам переповнюється (у debug-збірці панікує), тому
        // перевіряється шар EasyWAR після нього: розбір розкладки й додавання рядків.
        let reference = synthetic_reference_workbook();
        let entries = read_archive_entries(&reference).unwrap();
        let entry_map = archive_entry_map(&entries).unwrap();
        let shared_strings = parse_shared_strings(
            &entry_text(&entries, &entry_map, "xl/sharedStrings.xml").unwrap(),
        )
        .unwrap();
        let xml = entry_text(&entries, &entry_map, "xl/worksheets/sheet1.xml").unwrap();
        let absurd = xml.replace(r#"r="A1""#, &format!(r#"r="{}1""#, "Z".repeat(40)));
        assert_ne!(xml, absurd, "the synthetic sheet must contain A1");
        let layout = parse_sheet_layout(&absurd, &shared_strings).unwrap();
        let records = records_from_approved_snapshots(&[approved_snapshot()]).unwrap();

        let result = append_records_to_reference_sheet(&absurd, &layout, &records);

        assert!(
            matches!(&result, Err(XlsxExportError::InvalidReference(message))
                if message.contains("назва стовпця")),
            "{result:?}"
        );
    }

    /// Архів з однієї або кількох частин, заповнених нулями (стискаються майже до нуля).
    fn zip_of_zero_parts(parts: &[(&str, usize)]) -> Vec<u8> {
        let mut archive = ZipWriter::new(Cursor::new(Vec::new()));
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        let chunk = vec![0u8; 64 * 1024];
        for (name, size) in parts {
            archive.start_file(*name, options).unwrap();
            let mut left = *size;
            while left > 0 {
                let part = left.min(chunk.len());
                archive.write_all(&chunk[..part]).unwrap();
                left -= part;
            }
        }
        archive.finish().unwrap().into_inner()
    }

    const TEST_LIMITS: ZipLimits = ZipLimits {
        per_entry: 256 * 1024,
        total: 512 * 1024,
    };

    #[test]
    fn a_small_zip_that_inflates_past_the_part_limit_is_rejected() {
        // ≈ 4 МБ нулів стискаються до кількох кілобайт, але межа частини — 256 КБ.
        let bomb = zip_of_zero_parts(&[("xl/worksheets/sheet1.xml", 4 * 1024 * 1024)]);
        assert!(
            bomb.len() < 64 * 1024,
            "the bomb must stay tiny: {}",
            bomb.len()
        );

        let error = read_archive_entries_with_limits(&bomb, TEST_LIMITS)
            .expect_err("a part over the limit must be rejected");

        assert!(
            matches!(&error, XlsxExportError::ArchiveTooLarge(ZipLimitExceeded::Entry { name, limit })
                if name == "xl/worksheets/sheet1.xml" && *limit == TEST_LIMITS.per_entry),
            "{error:?}"
        );
        let message = error.to_string();
        assert!(message.starts_with("Еталонний XLSX відхилено"), "{message}");
        assert!(message.contains("xl/worksheets/sheet1.xml"), "{message}");
        assert!(message.contains("256 КБ"), "{message}");
    }

    #[test]
    fn many_parts_that_fit_alone_but_not_together_hit_the_total_limit() {
        let parts = [
            ("a.xml", 200 * 1024),
            ("b.xml", 200 * 1024),
            ("c.xml", 200 * 1024),
        ];
        let bomb = zip_of_zero_parts(&parts);

        let error = read_archive_entries_with_limits(&bomb, TEST_LIMITS)
            .expect_err("the sum over the limit must be rejected");

        assert!(
            matches!(
                &error,
                XlsxExportError::ArchiveTooLarge(ZipLimitExceeded::Total { limit })
                    if *limit == TEST_LIMITS.total
            ),
            "{error:?}"
        );
    }

    #[test]
    fn parts_at_exactly_the_limit_are_still_read() {
        let archive = zip_of_zero_parts(&[
            ("a.xml", TEST_LIMITS.per_entry as usize),
            (
                "b.xml",
                (TEST_LIMITS.total - TEST_LIMITS.per_entry) as usize,
            ),
        ]);

        let entries = read_archive_entries_with_limits(&archive, TEST_LIMITS)
            .expect("parts exactly at the limits must be accepted");

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].bytes.len() as u64, TEST_LIMITS.per_entry);
        assert_eq!(
            entries[1].bytes.len() as u64,
            TEST_LIMITS.total - TEST_LIMITS.per_entry
        );
    }

    #[test]
    fn a_forged_zip_header_does_not_hide_the_real_size() {
        // Підробляємо в локальному заголовку й каталозі «розпакований розмір» = 100 байт.
        let mut bomb = zip_of_zero_parts(&[("xl/worksheets/sheet1.xml", 4 * 1024 * 1024)]);
        let declared = (4u32 * 1024 * 1024).to_le_bytes();
        let forged = 100u32.to_le_bytes();
        let mut patched = 0;
        for index in 0..bomb.len().saturating_sub(4) {
            if bomb[index..index + 4] == declared {
                bomb[index..index + 4].copy_from_slice(&forged);
                patched += 1;
            }
        }
        assert!(
            patched >= 2,
            "local header and central directory: {patched}"
        );

        let result = read_archive_entries_with_limits(&bomb, TEST_LIMITS);

        // Бібліотека zip 2.4.2 читає всі 4 МБ попри підроблений розмір (перевірено вручну),
        // тож зупинити читання може лише власна межа за реально розпакованими байтами.
        assert!(
            matches!(
                &result,
                Err(XlsxExportError::ArchiveTooLarge(
                    ZipLimitExceeded::Entry { .. }
                ))
            ),
            "forged size must not be trusted: {result:?}"
        );
    }

    #[test]
    fn ordinary_references_stay_within_the_default_limits() {
        let reference = synthetic_reference_workbook();

        let entries = read_archive_entries(&reference).expect("synthetic reference must be read");

        assert!(entries.iter().any(|entry| entry.name == "xl/workbook.xml"));
    }

    #[test]
    fn duplicate_zip_part_names_fail_closed() {
        let duplicate = ArchiveEntry {
            name: "xl/workbook.xml".to_owned(),
            bytes: Vec::new(),
            compression: CompressionMethod::Deflated,
            unix_mode: None,
            is_directory: false,
        };

        let error = archive_entry_map(&[duplicate.clone(), duplicate])
            .expect_err("duplicate XLSX parts must be rejected");

        assert!(
            matches!(error, XlsxExportError::InvalidReference(message) if message.contains("повторну ZIP-частину"))
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

    fn synthetic_reference_workbook() -> Vec<u8> {
        let headers = FIELD_SPECS
            .iter()
            .map(|field| field.header())
            .collect::<Vec<_>>();
        let shared_strings = format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
             <sst xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" count=\"15\" uniqueCount=\"15\">{}</sst>",
            headers
                .iter()
                .map(|header| format!("<si><t>{}</t></si>", xml_escape(header)))
                .collect::<String>()
        );
        let header_cells = headers
            .iter()
            .enumerate()
            .map(|(index, _)| {
                let reference = format!("{}1", column_letters(index + 1));
                format!("<c r=\"{reference}\" s=\"0\" t=\"s\"><v>{index}</v></c>")
            })
            .collect::<String>();
        let existing = EasyWarRecord {
            number: "7".to_owned(),
            date: "2026-01-01".to_owned(),
            time: "08:00".to_owned(),
            target_ids: "SYN-EXISTING".to_owned(),
            unit: "Синтетичний підрозділ".to_owned(),
            district: "Тестовий район".to_owned(),
            coordinates: "SYNTHETIC MGRS".to_owned(),
            target_type: "Навчальна ціль".to_owned(),
            month: "Січень".to_owned(),
            aircraft: "Навчальний ЛА".to_owned(),
            munition: "Навчальний БП".to_owned(),
            munition_count: "1".to_owned(),
            result: "НЕВІДОМО".to_owned(),
            cause: String::new(),
            note: "Reference sentinel".to_owned(),
        };
        let existing_cells = existing
            .legacy_values()
            .iter()
            .enumerate()
            .map(|(index, value)| {
                let reference = format!("{}2", column_letters(index + 1));
                if index == 0 {
                    format!("<c r=\"{reference}\" s=\"0\" t=\"n\"><v>{value}</v></c>")
                } else if index == 1 {
                    format!("<c r=\"{reference}\" s=\"1\"><v>46023</v></c>")
                } else if value.is_empty() {
                    format!("<c r=\"{reference}\" s=\"0\"/>")
                } else {
                    format!(
                        "<c r=\"{reference}\" s=\"0\" t=\"inlineStr\"><is><t xml:space=\"preserve\">{}</t></is></c>",
                        xml_escape(value)
                    )
                }
            })
            .collect::<String>();
        let sheet1 = format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
             <worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" \
             xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">\
             <dimension ref=\"A1:O2\"/><sheetData><row r=\"1\">{header_cells}</row>\
             <row r=\"2\">{existing_cells}</row></sheetData><autoFilter ref=\"A1:O2\"/>\
             <tableParts count=\"1\"><tablePart r:id=\"rId1\"/></tableParts></worksheet>"
        );
        let sheet2 = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
            <worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">\
            <sheetData><row r=\"1\"><c r=\"A1\" t=\"inlineStr\"><is><t>UNRELATED-SENTINEL</t></is></c></row></sheetData></worksheet>";
        let table_columns = headers
            .iter()
            .enumerate()
            .map(|(index, header)| {
                format!(
                    "<tableColumn id=\"{}\" name=\"{}\"/>",
                    index + 1,
                    xml_escape(header)
                )
            })
            .collect::<String>();
        let table = format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
             <table xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" \
             id=\"1\" name=\"SyntheticTable\" displayName=\"SyntheticTable\" ref=\"A1:O2\">\
             <autoFilter ref=\"A1:O2\"/><tableColumns count=\"15\">{table_columns}</tableColumns>\
             <tableStyleInfo name=\"TableStyleMedium2\" showFirstColumn=\"0\" showLastColumn=\"0\" \
             showRowStripes=\"1\" showColumnStripes=\"0\"/></table>"
        );
        let styles = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
            <styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">\
            <numFmts count=\"1\"><numFmt numFmtId=\"164\" formatCode=\"dd.mm.yyyy\"/></numFmts>\
            <fonts count=\"1\"><font/></fonts><fills count=\"1\"><fill><patternFill patternType=\"none\"/></fill></fills>\
            <borders count=\"1\"><border/></borders><cellStyleXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\"/></cellStyleXfs>\
            <cellXfs count=\"2\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\"/>\
            <xf numFmtId=\"164\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\"/></cellXfs></styleSheet>";
        let content_types = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
            <Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">\
            <Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>\
            <Default Extension=\"xml\" ContentType=\"application/xml\"/>\
            <Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>\
            <Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>\
            <Override PartName=\"/xl/worksheets/sheet2.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>\
            <Override PartName=\"/xl/sharedStrings.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml\"/>\
            <Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/>\
            <Override PartName=\"/xl/tables/table1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml\"/></Types>";
        let workbook = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
            <workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" \
            xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">\
            <sheets><sheet name=\"Зведена\" sheetId=\"1\" r:id=\"rId1\"/>\
            <sheet name=\"Довідник\" sheetId=\"2\" r:id=\"rId2\"/></sheets></workbook>";
        let workbook_relationships = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
            <Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">\
            <Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/>\
            <Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet2.xml\"/>\
            <Relationship Id=\"rId3\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings\" Target=\"sharedStrings.xml\"/>\
            <Relationship Id=\"rId4\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/></Relationships>";
        let sheet_relationships = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
            <Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">\
            <Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/table\" Target=\"../tables/table1.xml\"/></Relationships>";

        let mut archive = ZipWriter::new(Cursor::new(Vec::new()));
        for (name, contents) in [
            ("[Content_Types].xml", content_types),
            ("_rels/.rels", root_relationships()),
            ("xl/workbook.xml", workbook),
            ("xl/_rels/workbook.xml.rels", workbook_relationships),
            ("xl/worksheets/sheet1.xml", sheet1.as_str()),
            ("xl/worksheets/sheet2.xml", sheet2),
            ("xl/worksheets/_rels/sheet1.xml.rels", sheet_relationships),
            ("xl/sharedStrings.xml", shared_strings.as_str()),
            ("xl/styles.xml", styles),
            ("xl/tables/table1.xml", table.as_str()),
        ] {
            write_zip_entry(&mut archive, name, contents).unwrap();
        }
        archive.finish().unwrap().into_inner()
    }
}
