//! EasySlide (прототип): відкриття й збереження файлів редактора презентацій через вікна EasyWAR.
//!
//! Редактор — веб-збірка DeckCraft у `src/public/vendor/easyslide/`; сам він файлової системи не
//! бачить. Ці функції задають, які файли він може відкрити й записати: лише презентації й
//! зображення, розміром до [`MAX_OPEN_BYTES`]. Нічого не надсилається з пристрою.

use std::io::Read;
use std::path::Path;

/// Найбільший файл, який EasySlide відкриває (більший — помилка, а не зависання вікна).
pub const MAX_OPEN_BYTES: u64 = 200 * 1024 * 1024;

/// Що відкривається: (підпис фільтра, розширення). `purpose` приходить від редактора.
pub fn open_filter(purpose: &str) -> (&'static str, &'static [&'static str]) {
    match purpose {
        "picture" => (
            "Зображення",
            &["png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff"],
        ),
        _ => ("Презентація", &["pptx", "ppsx", "potx", "deckcraft"]),
    }
}

/// Формат збереження за іменем, яке пропонує редактор: (підпис фільтра, розширення).
/// Невідоме розширення не зберігається.
pub fn save_format(file_name: &str) -> Option<(&'static str, &'static str)> {
    let extension = Path::new(file_name)
        .extension()?
        .to_str()?
        .to_ascii_lowercase();
    Some(match extension.as_str() {
        "pptx" => ("Презентація PPTX", "pptx"),
        "pdf" => ("Документ PDF", "pdf"),
        "png" => ("Зображення PNG", "png"),
        "jpg" | "jpeg" => ("Зображення JPEG", "jpg"),
        "gif" => ("Анімація GIF", "gif"),
        "txt" => ("Текст структури", "txt"),
        "deckcraft" => ("Файл EasySlide", "deckcraft"),
        _ => return None,
    })
}

/// Читає файл, не більший за `limit` байтів.
pub fn read_limited(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    let file = std::fs::File::open(path).map_err(|error| error.to_string())?;
    let size = file.metadata().map_err(|error| error.to_string())?.len();
    if size > limit {
        return Err(format!(
            "файл завеликий: {} МБ (найбільше {} МБ)",
            size / (1024 * 1024),
            limit / (1024 * 1024)
        ));
    }
    let mut bytes = Vec::with_capacity(size as usize);
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > limit {
        return Err("файл завеликий".to_owned());
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_filter_defaults_to_presentations() {
        assert_eq!(open_filter("presentation").0, "Презентація");
        assert!(open_filter("").1.contains(&"pptx"));
        assert!(open_filter("picture").1.contains(&"png"));
        assert!(!open_filter("audio").1.contains(&"mp3"));
    }

    #[test]
    fn save_format_accepts_only_known_extensions() {
        assert_eq!(save_format("Звіт.pptx"), Some(("Презентація PPTX", "pptx")));
        assert_eq!(save_format("slide.JPEG"), Some(("Зображення JPEG", "jpg")));
        assert_eq!(
            save_format("deck.deckcraft").map(|f| f.1),
            Some("deckcraft")
        );
        assert_eq!(save_format("run.exe"), None);
        assert_eq!(save_format("noextension"), None);
    }

    #[test]
    fn read_limited_rejects_large_files() {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        std::io::Write::write_all(&mut file, &[7u8; 64]).unwrap();
        assert_eq!(read_limited(file.path(), 64).unwrap().len(), 64);
        assert!(read_limited(file.path(), 63)
            .unwrap_err()
            .contains("завеликий"));
    }
}
