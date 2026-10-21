# P0: база перевірок і межі доступу команд

Дата: 21.10.2026. Коміт: `main` `9343256df86fc09759c7f4c585d6b466a969c2d1` (після PR #145).
Завдання P0 зі зведеного плану [`plans/2026-10-21-easywar-platform-release.md`](../../plans/2026-10-21-easywar-platform-release.md).
Середовище: хмарна сесія Linux, rustc 1.97.0, cargo 1.97.0, Node 22.22.0. Код цим записом не змінено.

## Ворота CI, запущені локально

| Команда | Результат |
|---|---|
| `npm run test:unit` | 1383 тести, 1383 пройдено, 0 провалів (разом із XLSX-контрактом) |
| `npm run build` | успішно |
| `cargo test --locked --manifest-path src-tauri/Cargo.toml` | 458 пройдено, 0 провалів, 1 пропущено (`model_install.rs`: потрібен зібраний рушій і синтетична модель) |
| `cargo clippy --locked … --all-targets --all-features -- -D warnings` | без попереджень |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | без розбіжностей |

Давніша примітка «один старий Rust-тест XLSX падає на main» на цьому коміті не підтверджується:
провалів немає.

## Межі команд (ізоляція «Офісу», F-01)

Перевірено читанням коду й тестами `tests/office-isolation.test.mjs` (8 тестів) разом із
`tests/dashboard-module-source.test.mjs` і `tests/dashboard-module-catalog.test.mjs`: 130 тестів,
0 провалів.

| Твердження | Доказ |
|---|---|
| Усі 104 власні команди внесено в `AppManifest::commands`, список збігається з `generate_handler!` | `src-tauri/build.rs`; тест «усі власні команди зареєстровано в дозволах Tauri» |
| Вікно `office-editor` має лише 5 дозволів: `office_open_file`, `office_save_file`, `office_save_file_as`, `office_close_file`, `office_editor_close`; без `core:*` і плагінів | `capabilities/office-editor.json`; тест «вікно редактора має лише дозволи office_*» |
| Головне вікно має решту 99 власних команд і `core:default`, файлових команд редактора не має | `capabilities/default.json`; тест «головне вікно має всі власні команди, крім файлових команд редактора» |
| Кожна команда `office_*` перевіряє мітку вікна, яку дає Tauri | `office_files.rs`; тест «кожна команда office_* перевіряє мітку вікна» |
| Команди захищеної бібліотеки дозволені лише головному вікну | тест «команди захищеної бібліотеки дозволені лише головному вікну» |
| Жодна capability не застосовується до всіх вікон і не дає доступу віддаленим адресам | тест з тією самою назвою |

Залишок ризику: будь-який скрипт головного webview може викликати всі 99 команд, а CSP — `null`
(`tauri.conf.json`). Це беклог P2-1 і P2-16, не цей запис.

## Збереження модулів і походження виправлень

| Твердження | Доказ |
|---|---|
| `replace_rows` відхиляє запис без версії таблиці (`VersionRequired`) і застарілу версію (`Conflict`), нічого не змінюючи | `dashboard_modules.rs`, рядки 1292–1305; тест `a_stale_version_is_rejected_and_changes_nothing` |
| Видалення модуля без позначки версії нічого не видаляє; застаріле підтвердження не видаляє рядків, записаних після нього | тести `deleting_without_a_version_mark_removes_nothing`, `a_stale_confirmation_cannot_delete_rows_written_after_it` |
| Ручна правка виправленого поля переводить виправлення в історію імпорту (`superseded_at`, міграція 0016) | тести `a_hand_edit_of_the_corrected_field_turns_the_correction_into_history`, `a_numeric_correction_is_compared_as_a_number_not_as_text`, `an_old_correction_without_a_stored_value_is_unconfirmed_until_its_field_changes` |

`cargo test … dashboard_modules::tests`: 32 пройдено. Нової міграції для цього не потрібно
(вона вже є: 0016); повторно не реалізовувати.

## Не перевірено

- **Нативний негативний тест** із справжнього webview редактора (виклик команд профілю, резервної
  копії чи бібліотеки має бути відхилено, а з головного вікна — дозволено) у цій сесії не
  запускався: застосунок тут не відкривався. За записом у беклозі (P2-1, T-Office-06) такий тест
  у WebKitGTK раніше пройдено; macOS (WKWebView) і Windows (WebView2) не перевірено.
- macOS і Windows збірки, підпис, справжній `signal-cli`.
- Тест `model_install` з рушієм (пропущено, потрібен зібраний `runner`).
