//! Відкриття й збереження документів для вбудованих офісних модулів (прототип EasyDoc).
//! Файл обирає сам користувач у системному вікні; байти читаються з обмеженням розміру й
//! повертаються у вікно модуля без змін. Збереження йде через тимчасовий файл
//! (`phone_export::save_file`), тож наявний файл не затирається без підтвердження вікна.
//! Нічого не надсилається в мережу.

use std::io::Read;
use std::path::Path;

/// Найбільший документ, який відкриваємо (стільки ж приймає сам EasyDoc).
pub const MAX_DOCUMENT_BYTES: u64 = 256 * 1024 * 1024;

/// Формати, які EasyDoc відкриває.
pub const OPEN_EXTENSIONS: &[&str] = &[
    "docx", "docm", "dotx", "dotm", "doc", "dot", "odt", "rtf", "txt", "md", "html", "htm",
];

/// Формати, у які EasyDoc зберігає й експортує, з підписом для вікна збереження.
const SAVE_FORMATS: &[(&str, &str)] = &[
    ("docx", "Документ Word"),
    ("docm", "Документ Word з макросами"),
    ("dotx", "Шаблон Word"),
    ("doc", "Документ Word 97–2003"),
    ("odt", "Документ OpenDocument"),
    ("rtf", "Документ RTF"),
    ("pdf", "Документ PDF"),
    ("txt", "Текст"),
    ("md", "Markdown"),
    ("html", "Вебсторінка HTML"),
    ("htm", "Вебсторінка HTML"),
    ("tex", "Документ LaTeX"),
    ("png", "Зображення сторінки PNG"),
];

/// Документ, обраний користувачем: ім'я файлу (без шляху) і вміст.
#[derive(Debug, serde::Serialize)]
pub struct PickedDocument {
    pub name: String,
    pub bytes: Vec<u8>,
}

/// Розширення й підпис формату для імені, яке запропонував модуль. Невідоме або відсутнє
/// розширення дає .docx.
pub fn save_format(file_name: &str) -> (&'static str, &'static str) {
    let extension = Path::new(file_name)
        .extension()
        .map(|extension| extension.to_string_lossy().to_ascii_lowercase());
    SAVE_FORMATS
        .iter()
        .find(|(known, _)| Some(*known) == extension.as_deref())
        .copied()
        .unwrap_or(SAVE_FORMATS[0])
}

/// Лише ім'я файлу, без теки: модуль не може підказати шлях поза вікном збереження.
pub fn suggested_name(file_name: &str) -> String {
    let name = Path::new(file_name)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    if name.trim().is_empty() {
        "Документ.docx".to_owned()
    } else {
        name
    }
}

fn has_open_extension(path: &Path) -> bool {
    path.extension().is_some_and(|extension| {
        let extension = extension.to_string_lossy();
        OPEN_EXTENSIONS
            .iter()
            .any(|known| extension.eq_ignore_ascii_case(known))
    })
}

/// Читає обраний документ з обмеженням розміру.
pub fn read_document(path: &Path) -> Result<PickedDocument, String> {
    if !has_open_extension(path) {
        return Err("Цей формат документа не підтримується".to_owned());
    }
    let file = std::fs::File::open(path)
        .map_err(|error| format!("Не вдалося відкрити документ: {error}"))?;
    let too_big = || "Документ перевищує обмеження 256 МБ".to_owned();
    if file
        .metadata()
        .map_err(|error| format!("Не вдалося перевірити розмір документа: {error}"))?
        .len()
        > MAX_DOCUMENT_BYTES
    {
        return Err(too_big());
    }
    let mut bytes = Vec::new();
    file.take(MAX_DOCUMENT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Не вдалося прочитати документ: {error}"))?;
    if bytes.len() as u64 > MAX_DOCUMENT_BYTES {
        return Err(too_big());
    }
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Документ.docx".to_owned());
    Ok(PickedDocument { name, bytes })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn save_format_follows_the_suggested_extension() {
        assert_eq!(save_format("Звіт.pdf").0, "pdf");
        assert_eq!(save_format("Звіт.ODT").0, "odt");
        assert_eq!(save_format("Звіт").0, "docx");
        assert_eq!(save_format("Звіт.exe").0, "docx");
    }

    #[test]
    fn suggested_name_drops_any_folder() {
        assert_eq!(suggested_name("../../etc/Звіт.docx"), "Звіт.docx");
        assert_eq!(suggested_name("/tmp/a.docx"), "a.docx");
        assert_eq!(suggested_name(""), "Документ.docx");
        assert_eq!(suggested_name(".."), "Документ.docx");
    }

    #[test]
    fn read_document_checks_extension_and_returns_bytes_unchanged() {
        let dir = tempfile::tempdir().unwrap();
        let doc = dir.path().join("Синтетичний.docx");
        std::fs::write(&doc, b"PK\x03\x04synthetic").unwrap();
        let picked = read_document(&doc).unwrap();
        assert_eq!(picked.name, "Синтетичний.docx");
        assert_eq!(picked.bytes, b"PK\x03\x04synthetic");

        let other = dir.path().join("script.sh");
        std::fs::write(&other, b"echo").unwrap();
        assert!(read_document(&other).is_err());
    }

    #[test]
    fn read_document_refuses_oversized_files() {
        let dir = tempfile::tempdir().unwrap();
        let doc = dir.path().join("big.docx");
        let file = std::fs::File::create(&doc).unwrap();
        file.set_len(MAX_DOCUMENT_BYTES + 1).unwrap();
        assert!(read_document(&doc).unwrap_err().contains("256 МБ"));
    }
}
