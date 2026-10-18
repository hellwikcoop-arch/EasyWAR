//! Файл із ключем відновлення пароля: збереження на флешку й читання назад.
//!
//! Ключ відновлення показується один раз, тож його можна покласти в текстовий файл на
//! знімний носій і тримати окремо від комп'ютера. Файл не зашифрований: його користь у
//! тому, що ключ без бази профілів цього комп'ютера нічого не відкриває. Застосунок не
//! визначає, чи обране місце справді знімне: це вирішує користувач у вікні збереження.
//!
//! Текст файлу будує лише цей модуль, з ключа й імені профілю, тож через цей шлях не можна
//! записати довільний вміст. Запис іде через сусідній тимчасовий файл із `sync_all`, а
//! після нього ключ зчитується з файлу й звіряється: «збережено» означає, що ключ прочитано
//! назад, а не лише що запис не повернув помилку.

use std::{
    fs,
    io::{self, Read, Write},
    path::{Path, PathBuf},
};

use crate::local_profiles::{format_recovery_key, normalize_recovery_key};

/// Файл із ключем займає менше кілобайта; більший файл ключем відновлення не є.
pub const MAX_FILE_BYTES: u64 = 8 * 1024;
/// Скільки символів імені профілю потрапляє в назву файлу.
const FILE_NAME_LIMIT: usize = 40;
/// Скільки символів імені профілю й дати потрапляє в текст файлу.
const TEXT_FIELD_LIMIT: usize = 80;
/// Для старого «Блокнота» Windows, який не розуміє одиночний `\n`.
const LINE_BREAK: &str = "\r\n";

#[derive(Debug, thiserror::Error)]
pub enum RecoveryKeyFileError {
    #[error("ключ відновлення має неправильний вигляд")]
    InvalidKey,
    #[error("не вдалося записати файл: {0}")]
    WriteFailed(io::Error),
    #[error("файл записано, але прочитати з нього ключ не вдалося: оберіть інше місце")]
    NotVerified,
    #[error("не вдалося прочитати файл: {0}")]
    ReadFailed(io::Error),
    #[error("файл завеликий для файлу з ключем відновлення")]
    TooLarge,
    #[error("у файлі не знайдено ключа відновлення")]
    NoKey,
    #[error("у файлі кілька різних ключів: залиште один")]
    SeveralKeys,
}

/// Назва файлу за замовчуванням: `EasyWAR_ключ_<ім'я профілю>.txt`. Ім'я в назві потрібне,
/// щоб ключі кількох профілів на одній флешці не затирали один одного.
pub fn default_file_name(display_name: &str) -> String {
    format!("EasyWAR_ключ_{}.txt", safe_name(display_name))
}

/// Ім'я профілю, придатне для назви файлу в Windows, macOS і Linux.
fn safe_name(display_name: &str) -> String {
    let replaced: String = display_name
        .chars()
        .map(|symbol| {
            if symbol.is_control()
                || matches!(symbol, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
            {
                '_'
            } else {
                symbol
            }
        })
        .collect();
    let edge = |symbol: char| symbol.is_whitespace() || symbol == '.' || symbol == '_';
    let limited: String = replaced
        .trim_matches(edge)
        .chars()
        .take(FILE_NAME_LIMIT)
        .collect();
    // Windows не приймає назву, що закінчується крапкою чи пробілом.
    let name = limited.trim_end_matches(edge);
    if name.is_empty() {
        "профіль".to_string()
    } else {
        name.to_string()
    }
}

/// Один рядок без керувальних символів: ім'я профілю не повинно розірвати текст файлу.
fn one_line(value: &str) -> String {
    let flattened: String = value
        .chars()
        .map(|symbol| if symbol.is_control() { ' ' } else { symbol })
        .collect();
    flattened.trim().chars().take(TEXT_FIELD_LIMIT).collect()
}

/// Повний текст файлу. Сам ключ стоїть в окремому рядку, за яким його знаходить
/// [`extract_key`]; ні ім'я профілю, ні решта тексту на ключ не схожі.
pub fn file_text(
    display_name: &str,
    key: &str,
    created: &str,
) -> Result<String, RecoveryKeyFileError> {
    let canonical = normalize_recovery_key(key).ok_or(RecoveryKeyFileError::InvalidKey)?;
    let lines = [
        "EasyWAR — ключ відновлення пароля".to_string(),
        format!("Профіль: {}", one_line(display_name)),
        format!("Створено: {}", one_line(created)),
        String::new(),
        "Ключ відновлення:".to_string(),
        format_recovery_key(&canonical),
        String::new(),
        "Як відновити пароль".to_string(),
        "1. На екрані входу виберіть профіль і натисніть «Забули пароль?».".to_string(),
        "2. Натисніть «Взяти ключ із файлу» (або введіть ключ вручну) і задайте новий пароль."
            .to_string(),
        String::new(),
        "Важливо".to_string(),
        "- Ключ дає право скинути пароль цього профілю. Зберігайте флешку окремо від комп’ютера."
            .to_string(),
        "- Ключ одноразовий: після відновлення застосунок покаже новий ключ, а цей перестане діяти. Старий файл тоді слід замінити новим."
            .to_string(),
        "- Файл не зашифрований. Не пересилайте його й не кладіть у хмарне сховище.".to_string(),
    ];
    Ok(lines.join(LINE_BREAK) + LINE_BREAK)
}

fn distinct(keys: impl Iterator<Item = String>) -> Vec<String> {
    let mut found: Vec<String> = Vec::new();
    for key in keys {
        if !found.contains(&key) {
            found.push(key);
        }
    }
    found
}

/// Добуває ключ із тексту файлу й повертає його в групах по п'ять символів.
///
/// Спершу шукає рядок, що цілком є ключем (так записує цей модуль); якщо такого немає —
/// слово в рядку, що є ключем (файл, дописаний вручну, напр. `Ключ: XXXXX-…`). Той самий ключ,
/// повторений кілька разів, не завада; різні ключі — помилка, бо вгадувати не можна.
pub fn extract_key(text: &str) -> Result<String, RecoveryKeyFileError> {
    let text = text.trim_start_matches('\u{feff}');
    let mut found = distinct(text.lines().filter_map(normalize_recovery_key));
    if found.is_empty() {
        found = distinct(text.split_whitespace().filter_map(normalize_recovery_key));
    }
    match found.as_slice() {
        [] => Err(RecoveryKeyFileError::NoKey),
        [only] => Ok(format_recovery_key(only)),
        _ => Err(RecoveryKeyFileError::SeveralKeys),
    }
}

/// Читає файл і добуває з нього ключ. Більше за [`MAX_FILE_BYTES`] не читає.
pub fn read_key(path: &Path) -> Result<String, RecoveryKeyFileError> {
    let file = fs::File::open(path).map_err(RecoveryKeyFileError::ReadFailed)?;
    let mut bytes = Vec::new();
    file.take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(RecoveryKeyFileError::ReadFailed)?;
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err(RecoveryKeyFileError::TooLarge);
    }
    extract_key(&String::from_utf8_lossy(&bytes))
}

/// Додає `.txt`, якщо користувач у вікні збереження не вказав розширення.
pub fn with_txt_extension(mut path: PathBuf) -> PathBuf {
    let has_txt = path
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("txt"));
    if !has_txt {
        path.as_mut_os_string().push(".txt");
    }
    path
}

/// Записує `text` у `path` (наявний файл замінюється: нове значення ключа має витіснити старе)
/// і перевіряє, що з файлу читається саме `key`. Файл, який не пройшов перевірку, видаляється,
/// щоб поганий файл не вдавав справжній.
pub fn write_file(path: &Path, text: &str, key: &str) -> Result<(), RecoveryKeyFileError> {
    let expected = normalize_recovery_key(key).ok_or(RecoveryKeyFileError::InvalidKey)?;
    let directory = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let mut temporary =
        tempfile::NamedTempFile::new_in(directory).map_err(RecoveryKeyFileError::WriteFailed)?;
    temporary
        .write_all(text.as_bytes())
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(RecoveryKeyFileError::WriteFailed)?;
    temporary
        .persist(path)
        .map_err(|error| RecoveryKeyFileError::WriteFailed(error.error))?;

    let verified = read_key(path)
        .ok()
        .and_then(|found| normalize_recovery_key(&found))
        .is_some_and(|found| found == expected);
    if verified {
        Ok(())
    } else {
        let _ = fs::remove_file(path);
        Err(RecoveryKeyFileError::NotVerified)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::local_profiles::generate_recovery_key;

    // Синтетичний ключ: лише для тестів, жодного профілю не відкриває.
    const KEY: &str = "ABCDE-FGHJK-MNPQR-STVWX-YZ012";
    const OTHER_KEY: &str = "23456-789AB-CDEFG-HJKMN-PQRST";

    fn text_for(name: &str, key: &str) -> String {
        file_text(name, key, "2026-10-18 09:52").unwrap()
    }

    #[test]
    fn written_text_reads_back_to_the_same_key() {
        let key = generate_recovery_key();
        let text = text_for("Тестовий Оператор", &key);
        assert_eq!(extract_key(&text).unwrap(), key);
    }

    #[test]
    fn text_names_the_profile_holds_one_key_line_and_uses_windows_line_breaks() {
        let text = text_for("Тестовий Оператор", KEY);
        assert!(text.starts_with("EasyWAR — ключ відновлення пароля\r\n"));
        assert!(text.contains("Профіль: Тестовий Оператор\r\n"));
        assert!(text.contains("Створено: 2026-10-18 09:52\r\n"));
        assert_eq!(text.matches(KEY).count(), 1);
        assert!(text.contains(&format!("Ключ відновлення:\r\n{KEY}\r\n")));
        assert!(!text.contains("\n\n") && !text.replace("\r\n", "").contains('\n'));
        assert!(text.ends_with("\r\n"));
    }

    #[test]
    fn text_is_built_from_a_canonical_key_whatever_the_input_looks_like() {
        let text = text_for("Профіль", "abcde fghjk mnpqr stvwx yz012");
        assert!(text.contains(&format!("\r\n{KEY}\r\n")));
    }

    #[test]
    fn invalid_keys_never_reach_a_file() {
        for bad in [
            "",
            "ABCDE-FGHJK",
            "ABCDE-FGHJK-MNPQR-STVWX-YZ01U",
            "U".repeat(25).as_str(),
        ] {
            assert!(
                matches!(
                    file_text("Профіль", bad, "сьогодні"),
                    Err(RecoveryKeyFileError::InvalidKey)
                ),
                "{bad}"
            );
        }
    }

    #[test]
    fn a_profile_name_that_looks_like_a_key_does_not_confuse_reading() {
        // Ім'я з 25 символів алфавіту й ім'я з переведенням рядка та «чужим» ключем.
        for name in [
            "ABCDEFGHJKMNPQRSTVWXYZ012",
            "Хтось\r\n23456-789AB-CDEFG-HJKMN-PQRST",
        ] {
            let text = text_for(name, KEY);
            assert_eq!(extract_key(&text).unwrap(), KEY, "{name:?}");
        }
    }

    #[test]
    fn long_names_and_breaks_are_flattened_into_one_line() {
        let text = text_for(&format!("Перший\nДругий\t{}", "я".repeat(200)), KEY);
        let profile_line = text.lines().nth(1).unwrap();
        assert!(profile_line.starts_with("Профіль: Перший Другий "));
        assert!(profile_line.chars().count() <= "Профіль: ".chars().count() + TEXT_FIELD_LIMIT);
    }

    #[test]
    fn extraction_is_tolerant_to_how_the_file_was_edited() {
        let cases = [
            // тільки ключ, малими літерами, з пробілами замість дефісів
            "abcde fghjk mnpqr stvwx yz012\n",
            // BOM, який додає «Блокнот»
            "\u{feff}ABCDE-FGHJK-MNPQR-STVWX-YZ012",
            // ключ у підписаному рядку
            "Ключ: ABCDE-FGHJK-MNPQR-STVWX-YZ012\nрешта тексту",
            // той самий ключ двічі
            "ABCDE-FGHJK-MNPQR-STVWX-YZ012\nABCDE-FGHJK-MNPQR-STVWX-YZ012\n",
            // O і I замість 0 і 1, кириличні А та Е замість латинських
            "\u{410}BCD\u{415}-FGHJK-MNPQR-STVWX-YZOI2\r\n",
        ];
        for text in cases {
            assert_eq!(extract_key(text).unwrap(), KEY, "{text:?}");
        }
    }

    #[test]
    fn extraction_refuses_to_guess() {
        assert!(matches!(
            extract_key("Просто текст без ключа\r\n"),
            Err(RecoveryKeyFileError::NoKey)
        ));
        assert!(matches!(extract_key(""), Err(RecoveryKeyFileError::NoKey)));
        assert!(matches!(
            extract_key("ABCDE-FGHJK-MNPQR-STVWX-YZ01"),
            Err(RecoveryKeyFileError::NoKey)
        ));
        assert!(matches!(
            extract_key(&format!("{KEY}\n{OTHER_KEY}\n")),
            Err(RecoveryKeyFileError::SeveralKeys)
        ));
        assert!(matches!(
            extract_key(&format!("Старий: {KEY}\nНовий: {OTHER_KEY}\n")),
            Err(RecoveryKeyFileError::SeveralKeys)
        ));
    }

    #[test]
    fn file_names_are_safe_on_every_system_and_keep_the_profile_apart() {
        assert_eq!(
            default_file_name("Тестовий Оператор"),
            "EasyWAR_ключ_Тестовий Оператор.txt"
        );
        assert_eq!(
            default_file_name("а/б\\в:г*д?е"),
            "EasyWAR_ключ_а_б_в_г_д_е.txt"
        );
        assert_eq!(default_file_name("  ..Ім'я.. "), "EasyWAR_ключ_Ім'я.txt");
        assert_eq!(default_file_name(""), "EasyWAR_ключ_профіль.txt");
        assert_eq!(default_file_name("...___"), "EasyWAR_ключ_профіль.txt");
        assert_eq!(default_file_name("a\nb"), "EasyWAR_ключ_a_b.txt");
        let long = default_file_name(&"ж".repeat(100));
        assert_eq!(
            long.chars().count(),
            "EasyWAR_ключ_.txt".chars().count() + FILE_NAME_LIMIT
        );
        assert_ne!(default_file_name("Перший"), default_file_name("Другий"));
    }

    #[test]
    fn txt_extension_is_added_only_when_missing() {
        assert_eq!(
            with_txt_extension(PathBuf::from("E:/ключ")),
            PathBuf::from("E:/ключ.txt")
        );
        assert_eq!(
            with_txt_extension(PathBuf::from("E:/ключ.TXT")),
            PathBuf::from("E:/ключ.TXT")
        );
        assert_eq!(
            with_txt_extension(PathBuf::from("E:/ключ.v2")),
            PathBuf::from("E:/ключ.v2.txt")
        );
    }

    #[test]
    fn writing_saves_a_verified_file_and_leaves_no_temporary_files() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory
            .path()
            .join(default_file_name("Тестовий Оператор"));
        let text = text_for("Тестовий Оператор", KEY);
        write_file(&path, &text, KEY).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), text);
        assert_eq!(read_key(&path).unwrap(), KEY);
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn writing_replaces_an_older_key_file() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("ключ.txt");
        write_file(&path, &text_for("Профіль", KEY), KEY).unwrap();
        write_file(&path, &text_for("Профіль", OTHER_KEY), OTHER_KEY).unwrap();
        assert_eq!(read_key(&path).unwrap(), OTHER_KEY);
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn a_file_that_does_not_read_back_as_the_key_is_removed() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("ключ.txt");
        // У файл записано один ключ, а звіряють з іншим: перевірка читанням має це спіймати.
        let result = write_file(&path, &text_for("Профіль", KEY), OTHER_KEY);
        assert!(matches!(result, Err(RecoveryKeyFileError::NotVerified)));
        assert!(!path.exists());
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 0);
    }

    #[test]
    fn writing_into_a_missing_folder_reports_the_failure() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("немає").join("ключ.txt");
        let result = write_file(&path, &text_for("Профіль", KEY), KEY);
        assert!(matches!(result, Err(RecoveryKeyFileError::WriteFailed(_))));
    }

    #[test]
    fn reading_refuses_big_and_missing_files() {
        let directory = tempfile::tempdir().unwrap();
        let big = directory.path().join("великий.txt");
        fs::write(
            &big,
            format!("{KEY}\n{}", "я".repeat(MAX_FILE_BYTES as usize)),
        )
        .unwrap();
        assert!(matches!(
            read_key(&big),
            Err(RecoveryKeyFileError::TooLarge)
        ));
        let missing = directory.path().join("немає.txt");
        assert!(matches!(
            read_key(&missing),
            Err(RecoveryKeyFileError::ReadFailed(_))
        ));
        let binary = directory.path().join("двійковий.txt");
        fs::write(&binary, [0xff_u8, 0xfe, 0x00, 0x41, 0x80]).unwrap();
        assert!(matches!(
            read_key(&binary),
            Err(RecoveryKeyFileError::NoKey)
        ));
    }

    #[test]
    fn messages_are_ukrainian_and_never_contain_a_key() {
        let errors = [
            RecoveryKeyFileError::InvalidKey,
            RecoveryKeyFileError::NotVerified,
            RecoveryKeyFileError::TooLarge,
            RecoveryKeyFileError::NoKey,
            RecoveryKeyFileError::SeveralKeys,
        ];
        for error in errors {
            let message = error.to_string();
            assert!(
                message.chars().any(|symbol| ('а'..='я').contains(&symbol)),
                "{message}"
            );
            assert!(normalize_recovery_key(&message).is_none(), "{message}");
        }
    }
}
