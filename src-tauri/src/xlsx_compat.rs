//! Temporary parsing copy for the pre-0.38 XLSX string contract.
//!
//! Calamine 0.38 trims each rich-text run unless its own `<t>` has
//! `xml:space="preserve"`, and decodes Excel `_xHHHH_` escapes. The legacy
//! importer concatenates the original string contents instead. Normalize only
//! string nodes in a bounded, in-memory copy; never save this copy as raw source.

use crate::xlsx_import::{ZipBudget, ZipLimitExceeded, ZipLimits, ZipPartError};
use quick_xml::{
    events::{BytesDecl, BytesStart, BytesText, Event},
    Reader, Writer,
};
use std::io::{self, Cursor, Read, Write};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

#[derive(Debug, thiserror::Error)]
pub(crate) enum XlsxCompatibilityError {
    #[error(transparent)]
    Limit(#[from] ZipLimitExceeded),
    #[error(transparent)]
    Zip(#[from] zip::result::ZipError),
    #[error(transparent)]
    Io(#[from] io::Error),
}

/// Call after the caller's existing ZIP checks. Unrelated members are copied
/// compressed, so a thumbnail/media bomb is never expanded by this adapter.
/// The caller must continue hashing and retaining the original `bytes`.
pub(crate) fn prepare_xlsx_for_calamine(
    bytes: &[u8],
    limits: ZipLimits,
) -> Result<Vec<u8>, XlsxCompatibilityError> {
    let mut source = ZipArchive::new(Cursor::new(bytes))?;
    let mut target = ZipWriter::new(Cursor::new(Vec::new()));
    let mut input_budget = ZipBudget::new(limits);
    let mut normalized_used = 0u64;

    for index in 0..source.len() {
        let (name, skip, mode) = {
            let file = source.by_index_raw(index)?;
            let name = file.name()?.into_owned();
            let lower = name.replace('\\', "/").to_ascii_lowercase();
            let skip = file.is_dir()
                || ["xl/media/", "xl/embeddings/", "docprops/thumbnail"]
                    .iter()
                    .any(|prefix| lower.starts_with(prefix));
            (name, skip, file.unix_mode())
        };

        let mut replacement = None;
        if !skip {
            // Inspect content rather than extensions or standard package paths:
            // Calamine also accepts custom paths, upper-case names and .bin XML.
            if let Ok(mut file) = source.by_index(index) {
                let mut prefix = [0u8; 4];
                if let Ok(count) = file.read(&mut prefix) {
                    if could_be_xml(&prefix[..count]) {
                        let mut content = Vec::new();
                        let reader = Cursor::new(&prefix[..count]).chain(&mut file);
                        let read = input_budget.read_part(&name, reader, Some(&mut content));
                        match read {
                            Err(ZipPartError::Limit(error)) => return Err(error.into()),
                            // Leave a damaged unused member untouched. Calamine
                            // still reports its normal error if it needs it.
                            Err(ZipPartError::Io(_)) => {}
                            Ok(_) => {
                                let remaining = limits.total.saturating_sub(normalized_used);
                                let cap = limits.per_entry.min(remaining);
                                replacement = match normalize_string_xml(&content, cap) {
                                    Ok(value) => value,
                                    Err(NormalizeError::Limit) => {
                                        return Err(limit_error(&name, limits, remaining).into());
                                    }
                                    // An invalid unused XML part has always been
                                    // left to Calamine rather than eagerly rejected.
                                    Err(NormalizeError::Xml) => None,
                                };
                                let size =
                                    replacement.as_ref().map_or(content.len(), Vec::len) as u64;
                                if size > cap {
                                    return Err(limit_error(&name, limits, remaining).into());
                                }
                                normalized_used += size;
                            }
                        }
                    }
                }
            }
        }

        if let Some(content) = replacement {
            let mut options =
                SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
            if let Some(mode) = mode {
                options = options.unix_permissions(mode);
            }
            target.start_file(&name, options)?;
            target.write_all(&content)?;
        } else {
            // Reopen so sniffing/decompression cannot consume the raw stream.
            target.raw_copy_file(source.by_index_raw(index)?)?;
        }
    }

    Ok(target.finish()?.into_inner())
}

fn could_be_xml(prefix: &[u8]) -> bool {
    prefix.first().is_some_and(|byte| {
        matches!(
            byte,
            b'<' | b' ' | b'\t' | b'\r' | b'\n' | 0xef | 0xff | 0xfe
        )
    })
}

fn limit_error(name: &str, limits: ZipLimits, remaining: u64) -> ZipLimitExceeded {
    if limits.per_entry <= remaining {
        ZipLimitExceeded::Entry {
            name: name.to_owned(),
            limit: limits.per_entry,
        }
    } else {
        ZipLimitExceeded::Total {
            limit: limits.total,
        }
    }
}

#[derive(Debug)]
enum NormalizeError {
    Xml,
    Limit,
}

/// A sink which checks before allocating. A large text event containing many
/// underscores must not expand past the XML budget in a single write.
struct XmlBuffer {
    bytes: Vec<u8>,
    cap: u64,
}

impl Write for XmlBuffer {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if bytes.len() as u64 > self.cap.saturating_sub(self.bytes.len() as u64) {
            return Err(io::Error::other("XLSX compatibility XML limit exceeded"));
        }
        self.bytes.extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

fn normalize_string_xml(bytes: &[u8], cap: u64) -> Result<Option<Vec<u8>>, NormalizeError> {
    let mut reader = Reader::from_reader(Cursor::new(bytes));
    reader.config_mut().trim_text(false);
    let mut writer = Writer::new(XmlBuffer {
        bytes: Vec::new(),
        cap,
    });
    let mut buffer = Vec::new();
    let mut root_seen = false;
    let mut string_depth = 0usize;
    let mut text_depth = 0usize;
    let mut cached_string_cell = false;
    let mut changed = false;

    loop {
        buffer.clear();
        let event = reader
            .read_event_into(&mut buffer)
            .map_err(|_| NormalizeError::Xml)?;
        let event = match event {
            Event::Start(element) => {
                let local = element.local_name();
                if !root_seen {
                    if !matches!(local.as_ref(), "worksheet" | "sst") {
                        return Ok(None);
                    }
                    root_seen = true;
                }
                if matches!(local.as_ref(), "si" | "is") {
                    string_depth += 1;
                }
                if local.as_ref() == "c" {
                    cached_string_cell = element
                        .try_get_attribute("t")
                        .map_err(|_| NormalizeError::Xml)?
                        .is_some_and(|attribute| attribute.value == "str");
                }
                if local.as_ref() == "v" && cached_string_cell {
                    // Cached string/formula results do not trim whitespace, but
                    // share the new Excel-escape and XML line-ending decoding.
                    text_depth += 1;
                }
                if local.as_ref() == "t" && string_depth > 0 {
                    text_depth += 1;
                    let preserve = element
                        .try_get_attribute("xml:space")
                        .map_err(|_| NormalizeError::Xml)?
                        .is_some_and(|attribute| attribute.value == "preserve");
                    if !preserve {
                        changed = true;
                        let mut normalized = BytesStart::new(element.name().as_ref().to_owned());
                        for attribute in element.attributes() {
                            let attribute = attribute.map_err(|_| NormalizeError::Xml)?;
                            if attribute.key.as_ref() != "xml:space" {
                                normalized.push_attribute(attribute);
                            }
                        }
                        normalized.push_attribute(("xml:space", "preserve"));
                        Event::Start(normalized)
                    } else {
                        Event::Start(element)
                    }
                } else {
                    Event::Start(element)
                }
            }
            Event::End(element) => {
                match element.local_name().as_ref() {
                    "t" | "v" => text_depth = text_depth.saturating_sub(1),
                    "si" | "is" => string_depth = string_depth.saturating_sub(1),
                    "c" => cached_string_cell = false,
                    _ => {}
                }
                Event::End(element)
            }
            Event::Text(text) if text_depth > 0 && (text.contains('_') || text.contains('\r')) => {
                changed = true;
                Event::Text(BytesText::from_escaped(escape_legacy_text(
                    &text, cap, false,
                )?))
            }
            Event::CData(text) if text_depth > 0 && (text.contains('_') || text.contains('\r')) => {
                changed = true;
                Event::Text(BytesText::from_escaped(escape_legacy_text(
                    &text, cap, true,
                )?))
            }
            Event::GeneralRef(reference) if text_depth > 0 => {
                let raw = format!("&{};", &*reference);
                if quick_xml::escape::unescape(&raw).is_ok_and(|value| value == "_") {
                    changed = true;
                    Event::Text(BytesText::new("_x005F_"))
                } else {
                    Event::GeneralRef(reference)
                }
            }
            Event::Decl(declaration) => {
                // The encoding-aware reader returns UTF-8 events. If a part is
                // changed, its declaration must describe the UTF-8 copy too.
                let version = declaration.version().map_err(|_| NormalizeError::Xml)?;
                let standalone = declaration
                    .standalone()
                    .transpose()
                    .map_err(|_| NormalizeError::Xml)?;
                Event::Decl(BytesDecl::new(
                    &version,
                    Some("UTF-8"),
                    standalone.as_deref(),
                ))
            }
            Event::Eof => break,
            event => event,
        };
        writer
            .write_event(event)
            .map_err(|_| NormalizeError::Limit)?;
    }

    Ok(changed.then(|| writer.into_inner().bytes))
}

fn escape_legacy_text(
    value: &str,
    cap: u64,
    escape_markup: bool,
) -> Result<String, NormalizeError> {
    // Calamine decodes these escapes once after concatenating XML events.
    // Escaping every underscore also handles `_xHHHH_` split by entity events.
    // Raw CR/CRLF used to survive `.unescape()`. Encode CR as an XML
    // reference so the newer `.xml10_content()` cannot normalize it to LF.
    let mut escaped = String::new();
    for character in value.chars() {
        let replacement = match character {
            '_' => "_x005F_",
            '\r' => "&#13;",
            '&' if escape_markup => "&amp;",
            '<' if escape_markup => "&lt;",
            '>' if escape_markup => "&gt;",
            _ => "",
        };
        let added = if replacement.is_empty() {
            character.len_utf8()
        } else {
            replacement.len()
        };
        if escaped.len() as u64 + added as u64 > cap {
            return Err(NormalizeError::Limit);
        }
        if replacement.is_empty() {
            escaped.push(character);
        } else {
            escaped.push_str(replacement);
        }
    }
    Ok(escaped)
}

#[cfg(test)]
mod tests {
    use super::*;
    use calamine::{Data, Reader as _, Xlsx};

    fn archive(parts: &[(&str, &[u8])]) -> Vec<u8> {
        let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
        for (name, bytes) in parts {
            zip.start_file(*name, SimpleFileOptions::default()).unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap().into_inner()
    }

    fn member(bytes: &[u8], name: &str) -> Vec<u8> {
        let mut zip = ZipArchive::new(Cursor::new(bytes)).unwrap();
        let mut value = Vec::new();
        zip.by_name(name).unwrap().read_to_end(&mut value).unwrap();
        value
    }

    fn workbook(inline: &str, shared: &str) -> Vec<u8> {
        workbook_cells(
            &format!(
                "<c r=\"A1\" t=\"inlineStr\"><is>{inline}</is></c><c r=\"B1\" t=\"s\"><v>0</v></c>"
            ),
            shared,
        )
    }

    fn workbook_cells(cells: &str, shared: &str) -> Vec<u8> {
        let sheet = format!(
            "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData><row r=\"1\">{cells}</row></sheetData></worksheet>"
        );
        let strings = format!(
            "<sst xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><si>{shared}</si></sst>"
        );
        archive(&[
            ("_rels/.rels", br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="custom/book.xml"/></Relationships>"#),
            ("custom/book.xml", br#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Synthetic" sheetId="1" r:id="rId1"/></sheets></workbook>"#),
            ("custom/_rels/book.xml.rels", br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="DATA.BIN"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="SHAREDSTRINGS.XML"/></Relationships>"#),
            ("custom/DATA.BIN", sheet.as_bytes()),
            ("custom/SHAREDSTRINGS.XML", strings.as_bytes()),
        ])
    }

    #[test]
    fn shared_and_inline_strings_retain_runs_whitespace_entities_and_unicode() {
        for attribute in ["", " xml:space=\"preserve\"", " xml:space=\"default\""] {
            for rich in [false, true] {
                let first = format!("<t{attribute}> \tПеревірено &amp; </t>");
                let second = format!("<t{attribute}> локально &lt;так&gt; &#x1F4F7;\u{a0}\n </t>");
                let text = if rich {
                    format!("<r>{first}</r><r><t{attribute}> </t></r><r>{second}</r>")
                } else {
                    format!("<t{attribute}> \tПеревірено &amp;   локально &lt;так&gt; &#x1F4F7;\u{a0}\n </t>")
                };
                let original = workbook(&text, &text);
                let normalized = prepare_xlsx_for_calamine(&original, ZipLimits::DEFAULT).unwrap();
                let mut xlsx = Xlsx::new(Cursor::new(normalized)).unwrap();
                let range = xlsx.worksheet_range("Synthetic").unwrap();
                let expected = " \tПеревірено &   локально <так> 📷\u{a0}\n ";
                assert_eq!(
                    range.get_value((0, 0)),
                    Some(&Data::String(expected.into()))
                );
                assert_eq!(
                    range.get_value((0, 1)),
                    Some(&Data::String(expected.into()))
                );
                assert!(!String::from_utf8(member(&original, "custom/DATA.BIN"))
                    .unwrap()
                    .contains("_x005F_"));
            }
        }
    }

    #[test]
    fn preserves_literal_excel_escape_sequences_including_entity_underscores() {
        let text = "<t>_x0041_ _x005F_x0041_ &#95;x0042_ _xD83D__xDCF7_ SYN_001</t>";
        let original = workbook(text, text);
        let normalized = prepare_xlsx_for_calamine(&original, ZipLimits::DEFAULT).unwrap();
        let mut xlsx = Xlsx::new(Cursor::new(normalized)).unwrap();
        let range = xlsx.worksheet_range("Synthetic").unwrap();
        let expected = "_x0041_ _x005F_x0041_ _x0042_ _xD83D__xDCF7_ SYN_001";
        assert_eq!(
            range.get_value((0, 0)),
            Some(&Data::String(expected.into()))
        );
        assert_eq!(
            range.get_value((0, 1)),
            Some(&Data::String(expected.into()))
        );
    }

    #[test]
    fn preserves_literal_cr_crlf_and_entity_cr_in_string_text() {
        for text in [
            "<t>line1\rline2\r\nline3\nline4&#13;end</t>",
            "<t><![CDATA[line1\rline2\r\nline3\nline4]]>&#13;end</t>",
        ] {
            let original = workbook(text, text);
            let normalized = prepare_xlsx_for_calamine(&original, ZipLimits::DEFAULT).unwrap();
            let mut xlsx = Xlsx::new(Cursor::new(normalized)).unwrap();
            let range = xlsx.worksheet_range("Synthetic").unwrap();
            let expected = "line1\rline2\r\nline3\nline4\rend";
            assert_eq!(
                range.get_value((0, 0)),
                Some(&Data::String(expected.into()))
            );
            assert_eq!(
                range.get_value((0, 1)),
                Some(&Data::String(expected.into()))
            );
        }
    }

    #[test]
    fn cached_string_values_preserve_escapes_and_cr_without_changing_numeric_values() {
        let source = workbook_cells(
            "<c r=\"A1\" t=\"n\"><v>7</v></c><c r=\"B1\" t=\"str\"><f>TEXT(A1,\"0\")</f><v> _x0041_ &amp; &#95;x0042_\r\nraw\rend &#13; </v></c><c r=\"C1\" t=\"s\"><v>0</v></c>",
            "<t>Shared</t>",
        );
        let normalized = prepare_xlsx_for_calamine(&source, ZipLimits::DEFAULT).unwrap();
        let mut xlsx = Xlsx::new(Cursor::new(normalized)).unwrap();
        let range = xlsx.worksheet_range("Synthetic").unwrap();
        assert_eq!(range.get_value((0, 0)), Some(&Data::Float(7.0)));
        assert_eq!(
            range.get_value((0, 1)),
            Some(&Data::String(" _x0041_ & _x0042_\r\nraw\rend \r ".into()))
        );
        assert_eq!(
            range.get_value((0, 2)),
            Some(&Data::String("Shared".into()))
        );
    }

    #[test]
    fn rich_string_value_round_trips_through_regular_and_reference_exports() {
        use crate::xlsx_export::{build_compatible_xlsx, build_compatible_xlsx_from_reference};
        use crate::xlsx_import::{import_easywar_xlsx, EasyWarRecord};

        let text =
            "<r><t> \tПеревірено &amp; </t></r><r><t> локально &lt;так&gt; _x0041_\r\n </t></r>";
        let source = workbook(text, text);
        let normalized = prepare_xlsx_for_calamine(&source, ZipLimits::DEFAULT).unwrap();
        let mut xlsx = Xlsx::new(Cursor::new(normalized)).unwrap();
        let range = xlsx.worksheet_range("Synthetic").unwrap();
        let Data::String(note) = range.get_value((0, 0)).unwrap() else {
            panic!("synthetic rich text must be a string");
        };
        assert_eq!(note, " \tПеревірено &  локально <так> _x0041_\r\n ");
        let record = EasyWarRecord {
            number: "1".into(),
            date: "2026-01-01".into(),
            time: String::new(),
            target_ids: String::new(),
            unit: String::new(),
            district: String::new(),
            coordinates: String::new(),
            target_type: String::new(),
            month: String::new(),
            aircraft: String::new(),
            munition: String::new(),
            munition_count: String::new(),
            result: String::new(),
            cause: String::new(),
            note: note.clone(),
        };
        let records = [record];
        let exported = build_compatible_xlsx(&records).unwrap();
        let reference_export = build_compatible_xlsx_from_reference(&exported, &records).unwrap();
        for bytes in [&exported, &reference_export] {
            let imported = import_easywar_xlsx(bytes).unwrap();
            assert_eq!(imported.rows[0].parsed, records[0]);
            assert_eq!(imported.rows[0].raw_values["Уточнення результату"], *note);
            assert_eq!(imported.rows[0].source_cells[14].value, *note);
        }
    }

    #[test]
    fn only_string_text_nodes_are_changed_and_other_members_are_kept() {
        let xml = br#"<worksheet><t>outside</t><is><t data-test="kept"> inside </t></is><v>_x0041_</v></worksheet>"#;
        let source = archive(&[
            ("odd/sheet.bin", xml),
            ("custom/image.png", b"\x89PNG\0\0\0\0"),
            ("unused.xml", b"<broken"),
        ]);
        let normalized = prepare_xlsx_for_calamine(&source, ZipLimits::DEFAULT).unwrap();
        let xml = String::from_utf8(member(&normalized, "odd/sheet.bin")).unwrap();
        assert!(xml.contains("<t>outside</t>"));
        assert!(xml.contains("<t data-test=\"kept\" xml:space=\"preserve\"> inside </t>"));
        assert!(xml.contains("<v>_x0041_</v>"));
        assert_eq!(member(&normalized, "unused.xml"), b"<broken");
        assert_eq!(member(&normalized, "custom/image.png"), b"\x89PNG\0\0\0\0");
    }

    #[test]
    fn normalization_and_decompression_both_obey_the_byte_limits() {
        let xml = b"<worksheet><is><t> text </t></is></worksheet>";
        let source = archive(&[("sheet.xml", xml)]);
        let limits = ZipLimits {
            per_entry: xml.len() as u64,
            total: 1000,
        };
        assert!(matches!(
            prepare_xlsx_for_calamine(&source, limits),
            Err(XlsxCompatibilityError::Limit(
                ZipLimitExceeded::Entry { .. }
            ))
        ));
        let total_limit = ZipLimits {
            per_entry: 1000,
            total: xml.len() as u64,
        };
        assert!(matches!(
            prepare_xlsx_for_calamine(&source, total_limit),
            Err(XlsxCompatibilityError::Limit(
                ZipLimitExceeded::Total { .. }
            ))
        ));
        let oversized = archive(&[("sheet.xml", &vec![b' '; 4096])]);
        assert!(matches!(
            prepare_xlsx_for_calamine(&oversized, limits),
            Err(XlsxCompatibilityError::Limit(_))
        ));
    }

    #[test]
    fn media_is_raw_copied_without_decompression() {
        let source = archive(&[("xl/media/large.png", &vec![0; 4096])]);
        let normalized = prepare_xlsx_for_calamine(
            &source,
            ZipLimits {
                per_entry: 1,
                total: 1,
            },
        )
        .unwrap();
        assert_eq!(member(&normalized, "xl/media/large.png"), vec![0; 4096]);
    }
}
