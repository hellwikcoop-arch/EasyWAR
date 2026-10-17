//! Старт без паніки: помилки підготовки локальної бази до запуску вікна показуються
//! нативним повідомленням, а пошкоджену базу можна відкласти й стартувати порожнім.
//!
//! Правила:
//! * нічого не видаляється й не переписується: пошкоджена база лише перейменовується
//!   (разом з WAL/SHM/journal) на `<файл>.damaged-<UTC-час>`;
//! * відкладання лише після явної згоди користувача у вікні «Так/Ні»;
//! * база з новішої версії EasyWAR, помилки файлової системи, невдала міграція й
//!   неоднозначні стани перемикання — не пошкодження: файл не чіпається, показується причина;
//! * на Windows `windows_subsystem` не має консолі, тож без цього модуля збій був би мовчазним.

use crate::{database, migration_startup::StartupMigrationError, restore::RestoreInspectionError};
use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    Error as SqlxError,
};
use std::{
    ffi::OsString,
    fs, io,
    path::{Path, PathBuf},
};

const TITLE_FAILED: &str = "EasyWAR не запущено";
const TITLE_DAMAGED: &str = "EasyWAR: локальну базу пошкоджено";
const TITLE_DAMAGED_DONE: &str = "EasyWAR: базу відкладено";
const SIDECAR_SUFFIXES: [&str; 3] = ["-wal", "-shm", "-journal"];

/// Вікна, які можна показати до створення головного вікна Tauri.
pub(crate) trait StartupDialogs {
    fn notify(&self, title: &str, message: &str);
    /// `true` — користувач натиснув «Так».
    fn confirm(&self, title: &str, message: &str) -> bool;
}

pub(crate) struct NativeDialogs;

impl StartupDialogs for NativeDialogs {
    fn notify(&self, title: &str, message: &str) {
        eprintln!("{title}: {message}");
        let _ = show_native(title, message, rfd::MessageButtons::Ok);
    }

    fn confirm(&self, title: &str, message: &str) -> bool {
        eprintln!("{title}: {message}");
        matches!(
            show_native(title, message, rfd::MessageButtons::YesNo),
            Some(rfd::MessageDialogResult::Yes)
        )
    }
}

/// Без графічного середовища (наприклад, Linux без дисплея) вікно може не створитися:
/// тоді текст уже виведено в stderr, а запит вважається відхиленим.
fn show_native(
    title: &str,
    message: &str,
    buttons: rfd::MessageButtons,
) -> Option<rfd::MessageDialogResult> {
    std::panic::catch_unwind(|| {
        rfd::MessageDialog::new()
            .set_level(rfd::MessageLevel::Error)
            .set_title(title)
            .set_description(message)
            .set_buttons(buttons)
            .show()
    })
    .ok()
}

/// Класифікація збою кроку підготовки бази.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Failure {
    /// База створена новішою версією EasyWAR: відкладати її не можна.
    NewerSchema { found: i64, supported: i64 },
    /// Файл не відкривається як база EasyWAR або не пройшов перевірку цілісності.
    Damaged(String),
    /// Усе інше: права доступу, диск, невдала міграція, неоднозначний стан тощо.
    Other(String),
    /// Схема не підтримується: це або новіша версія, або невідома база — вирішує читання версії.
    UnsupportedSchema,
}

impl Failure {
    pub(crate) fn from_inspection(error: &RestoreInspectionError) -> Self {
        match error {
            RestoreInspectionError::IntegrityCheckFailed
            | RestoreInspectionError::ForeignKeyViolation
            | RestoreInspectionError::MissingMigrationHistory
            | RestoreInspectionError::MigrationMismatch
            | RestoreInspectionError::MissingSchemaObjects => Self::Damaged(error.to_string()),
            RestoreInspectionError::UnsupportedSchema => Self::UnsupportedSchema,
            RestoreInspectionError::Database(SqlxError::Database(database_error))
                if is_corruption_code(database_error.code().as_deref()) =>
            {
                Self::Damaged(error.to_string())
            }
            other => Self::Other(other.to_string()),
        }
    }

    pub(crate) fn from_startup(error: &StartupMigrationError) -> Self {
        match error {
            StartupMigrationError::Inspection(inspection) => Self::from_inspection(inspection),
            StartupMigrationError::UnexpectedSchemaVersion { expected, actual }
                if actual > expected =>
            {
                Self::NewerSchema {
                    found: *actual,
                    supported: *expected,
                }
            }
            other => Self::Other(other.to_string()),
        }
    }
}

/// SQLITE_CORRUPT (11) і SQLITE_NOTADB (26), включно з розширеними кодами.
fn is_corruption_code(code: Option<&str>) -> bool {
    code.and_then(|value| value.parse::<i64>().ok())
        .is_some_and(|value| matches!(value & 0xff, 11 | 26))
}

/// Найбільша застосована міграція у файлі бази (читання без змін).
fn newer_schema_version(live_database: &Path) -> Option<i64> {
    tauri::async_runtime::block_on(async {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(live_database)
                    .read_only(true)
                    .immutable(true),
            )
            .await
            .ok()?;
        let version: Option<i64> = sqlx::query_scalar("SELECT max(version) FROM _sqlx_migrations")
            .fetch_one(&pool)
            .await
            .ok()
            .flatten();
        pool.close().await;
        version
    })
}

fn resolve(live_database: &Path, failure: Failure) -> Failure {
    match failure {
        Failure::UnsupportedSchema => {
            let supported = database::latest_schema_version().unwrap_or(0);
            match newer_schema_version(live_database) {
                Some(found) if found > supported => Failure::NewerSchema { found, supported },
                _ => Failure::Damaged(RestoreInspectionError::UnsupportedSchema.to_string()),
            }
        }
        other => other,
    }
}

/// Користувач відмовився або вікно вже показано: запуск слід завершити.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct StartupAbort;

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum StepOutcome {
    Completed,
    /// Пошкоджену базу відкладено в цей файл, крок виконано на новій порожній базі.
    SetAside(PathBuf),
}

/// Виконує крок підготовки бази; для пошкодженої бази пропонує відкласти її (лише за згодою).
pub(crate) fn run_guarded_step(
    live_database: &Path,
    dialogs: &dyn StartupDialogs,
    mut step: impl FnMut() -> Result<(), Failure>,
) -> Result<StepOutcome, StartupAbort> {
    let failure = match step() {
        Ok(()) => return Ok(StepOutcome::Completed),
        Err(failure) => resolve(live_database, failure),
    };
    match failure {
        Failure::NewerSchema { found, supported } => Err(abort(
            dialogs,
            TITLE_FAILED,
            &format!(
                "Локальну базу створено новішою версією EasyWAR (схема {found}, ця версія підтримує \
                 {supported}). Дані не змінено.\n\nВстановіть актуальну версію EasyWAR і запустіть її знову."
            ),
        )),
        Failure::Other(text) => Err(abort(dialogs, TITLE_FAILED, &other_message(live_database, &text))),
        Failure::UnsupportedSchema => Err(abort(
            dialogs,
            TITLE_FAILED,
            &other_message(live_database, "схема бази не підтримується"),
        )),
        Failure::Damaged(reason) => {
            if !dialogs.confirm(TITLE_DAMAGED, &damaged_question(live_database, &reason)) {
                // Користувач відмовився: нічого не змінено, нового вікна не потрібно.
                return Err(StartupAbort);
            }
            let set_aside = match set_aside_damaged_database(live_database, &utc_stamp()) {
                Ok(path) => path,
                Err(error) => {
                    return Err(abort(
                        dialogs,
                        TITLE_FAILED,
                        &format!(
                            "Не вдалося відкласти пошкоджену базу: {error}. Дані не видалено.\n\n\
                             Не змінюйте файли вручну; зверніться до розробника."
                        ),
                    ))
                }
            };
            if let Err(failure) = step() {
                let text = match failure {
                    Failure::Damaged(text) | Failure::Other(text) => text,
                    Failure::NewerSchema { .. } | Failure::UnsupportedSchema => {
                        "схема нової бази не підтримується".to_string()
                    }
                };
                return Err(abort(
                    dialogs,
                    TITLE_FAILED,
                    &format!(
                        "Пошкоджену базу відкладено як «{}», але нову порожню базу створити не вдалося: {text}.",
                        set_aside.display()
                    ),
                ));
            }
            dialogs.notify(
                TITLE_DAMAGED_DONE,
                &format!(
                    "Пошкоджену базу збережено як «{}». EasyWAR запущено з порожньою базою.\n\n\
                     Щоб повернути дані, відновіть резервну копію: «Резервна копія» на стартовому екрані.",
                    set_aside.display()
                ),
            );
            Ok(StepOutcome::SetAside(set_aside))
        }
    }
}

fn other_message(live_database: &Path, text: &str) -> String {
    format!(
        "EasyWAR не зміг безпечно підготувати локальну базу: {text}.\n\nДані не змінено. \
         Файли бази: {}\nНе змінюйте їх вручну; зверніться до розробника.",
        live_database.display()
    )
}

fn damaged_question(live_database: &Path, reason: &str) -> String {
    format!(
        "Локальну базу EasyWAR не вдалося відкрити: {reason}.\n\n\
         Можна відкласти її й запустити EasyWAR з порожньою базою. Файл не видаляється: \
         його буде збережено поруч з суфіксом «.damaged-<дата й час>» у папці {}.\n\n\
         Після запуску відновіть дані з резервної копії («Резервна копія»).\n\n\
         Відкласти пошкоджену базу й запустити з порожньою?",
        live_database
            .parent()
            .map_or_else(String::new, |parent| parent.display().to_string())
    )
}

fn abort(dialogs: &dyn StartupDialogs, title: &str, message: &str) -> StartupAbort {
    dialogs.notify(title, message);
    StartupAbort
}

/// Завершує запуск після повідомлення (для кроків, що не пов'язані з пошкодженням бази).
pub(crate) fn exit_with(dialogs: &dyn StartupDialogs, message: &str) -> ! {
    dialogs.notify(TITLE_FAILED, message);
    std::process::exit(1)
}

/// Розгортає результат кроку запуску або завершує застосунок з повідомленням.
pub(crate) fn or_exit<T, E: std::fmt::Display>(
    dialogs: &dyn StartupDialogs,
    result: Result<T, E>,
    context: &str,
) -> T {
    match result {
        Ok(value) => value,
        Err(error) => exit_with(dialogs, &format!("{context}: {error}.\n\nДані не змінено.")),
    }
}

fn utc_stamp() -> String {
    chrono::Utc::now().format("%Y%m%d-%H%M%S").to_string()
}

fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut name: OsString = path.as_os_str().to_owned();
    name.push(suffix);
    PathBuf::from(name)
}

/// Перейменовує базу та її WAL/SHM/journal на `<файл>.damaged-<мітка>` (або `-<n>`, якщо зайнято).
/// Спершу переносяться супровідні файли, потім сама база. Повертає шлях відкладеної бази.
pub(crate) fn set_aside_damaged_database(live_database: &Path, stamp: &str) -> io::Result<PathBuf> {
    if !live_database.is_absolute() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "шлях бази має бути абсолютним",
        ));
    }
    if !fs::symlink_metadata(live_database)?.file_type().is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "база не є звичайним файлом",
        ));
    }
    let mut members: Vec<PathBuf> = SIDECAR_SUFFIXES
        .iter()
        .map(|suffix| with_suffix(live_database, suffix))
        .filter(|path| fs::symlink_metadata(path).is_ok())
        .collect();
    members.push(live_database.to_path_buf());

    let mut slot = 0usize;
    let suffix_for = |slot: usize| {
        if slot == 0 {
            format!(".damaged-{stamp}")
        } else {
            format!(".damaged-{stamp}-{slot}")
        }
    };
    loop {
        let taken = members
            .iter()
            .any(|path| fs::symlink_metadata(with_suffix(path, &suffix_for(slot))).is_ok());
        if !taken {
            break;
        }
        slot += 1;
        if slot > 1024 {
            return Err(io::Error::other(
                "немає вільного імені для відкладеної бази",
            ));
        }
    }
    let suffix = suffix_for(slot);
    for path in &members {
        fs::rename(path, with_suffix(path, &suffix))?;
    }
    #[cfg(unix)]
    if let Some(parent) = live_database.parent() {
        let _ = fs::File::open(parent).and_then(|directory| directory.sync_all());
    }
    Ok(with_suffix(live_database, &suffix))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::migration_startup;
    use std::cell::{Cell, RefCell};

    struct FakeDialogs {
        answer: bool,
        confirmed: Cell<usize>,
        notices: RefCell<Vec<String>>,
    }

    impl FakeDialogs {
        fn new(answer: bool) -> Self {
            Self {
                answer,
                confirmed: Cell::new(0),
                notices: RefCell::new(Vec::new()),
            }
        }
    }

    impl StartupDialogs for FakeDialogs {
        fn notify(&self, _title: &str, message: &str) {
            self.notices.borrow_mut().push(message.to_string());
        }
        fn confirm(&self, _title: &str, _message: &str) -> bool {
            self.confirmed.set(self.confirmed.get() + 1);
            self.answer
        }
    }

    fn runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("synthetic runtime")
    }

    fn prepare_step(runtime: &tokio::runtime::Runtime, live: &Path) -> Result<(), Failure> {
        runtime
            .block_on(migration_startup::prepare_database(live))
            .map_err(|error| Failure::from_startup(&error))
    }

    fn synthetic_garbage() -> Vec<u8> {
        b"synthetic bytes that are not a sqlite database "
            .iter()
            .copied()
            .cycle()
            .take(8192)
            .collect()
    }

    #[test]
    fn corruption_codes_cover_extended_sqlite_results() {
        for code in ["11", "26", "267", "523", "779"] {
            assert!(is_corruption_code(Some(code)), "{code}");
        }
        for code in ["5", "6", "10", "14", "1", "x", ""] {
            assert!(!is_corruption_code(Some(code)), "{code}");
        }
        assert!(!is_corruption_code(None));
    }

    #[test]
    fn only_unusable_databases_are_offered_for_set_aside() {
        let damaged = [
            RestoreInspectionError::IntegrityCheckFailed,
            RestoreInspectionError::ForeignKeyViolation,
            RestoreInspectionError::MissingMigrationHistory,
            RestoreInspectionError::MigrationMismatch,
            RestoreInspectionError::MissingSchemaObjects,
        ];
        for error in &damaged {
            assert!(
                matches!(Failure::from_inspection(error), Failure::Damaged(_)),
                "{error}"
            );
        }
        assert_eq!(
            Failure::from_inspection(&RestoreInspectionError::UnsupportedSchema),
            Failure::UnsupportedSchema
        );
        for error in [
            RestoreInspectionError::InvalidFile,
            RestoreInspectionError::InvalidTarget,
            RestoreInspectionError::SidecarsPresent,
            RestoreInspectionError::AnotherInstanceRunning,
            RestoreInspectionError::Io(io::Error::other("synthetic")),
        ] {
            assert!(
                matches!(Failure::from_inspection(&error), Failure::Other(_)),
                "{error}"
            );
        }
    }

    #[test]
    fn newer_schema_is_never_treated_as_damage() {
        let newer = StartupMigrationError::UnexpectedSchemaVersion {
            expected: 8,
            actual: 9,
        };
        assert_eq!(
            Failure::from_startup(&newer),
            Failure::NewerSchema {
                found: 9,
                supported: 8
            }
        );
        let older = StartupMigrationError::UnexpectedSchemaVersion {
            expected: 8,
            actual: 7,
        };
        assert!(matches!(Failure::from_startup(&older), Failure::Other(_)));
        for error in [
            StartupMigrationError::BackupConflict,
            StartupMigrationError::InterruptedSwapConflict,
            StartupMigrationError::InvalidFileType,
        ] {
            assert!(
                matches!(Failure::from_startup(&error), Failure::Other(_)),
                "{error}"
            );
        }
    }

    #[test]
    fn set_aside_moves_database_and_sidecars_without_changing_bytes() {
        let directory = tempfile::tempdir().expect("synthetic directory");
        let live = directory.path().join("easywar.db");
        fs::write(&live, b"synthetic main").expect("main");
        fs::write(with_suffix(&live, "-wal"), b"synthetic wal").expect("wal");
        fs::write(with_suffix(&live, "-shm"), b"synthetic shm").expect("shm");
        fs::write(directory.path().join("easywar.db.instance-lock"), b"x").expect("lock");

        let moved = set_aside_damaged_database(&live, "20261017-120000").expect("set aside");

        assert_eq!(
            moved,
            directory.path().join("easywar.db.damaged-20261017-120000")
        );
        assert_eq!(fs::read(&moved).expect("moved"), b"synthetic main");
        assert_eq!(
            fs::read(
                directory
                    .path()
                    .join("easywar.db-wal.damaged-20261017-120000")
            )
            .expect("wal"),
            b"synthetic wal"
        );
        assert_eq!(
            fs::read(
                directory
                    .path()
                    .join("easywar.db-shm.damaged-20261017-120000")
            )
            .expect("shm"),
            b"synthetic shm"
        );
        assert!(!live.exists());
        assert!(!with_suffix(&live, "-wal").exists());
        assert!(
            directory.path().join("easywar.db.instance-lock").exists(),
            "other files stay"
        );
    }

    #[test]
    fn set_aside_never_overwrites_an_earlier_damaged_copy() {
        let directory = tempfile::tempdir().expect("synthetic directory");
        let live = directory.path().join("easywar.db");
        let earlier = directory.path().join("easywar.db.damaged-20261017-120000");
        fs::write(&earlier, b"earlier").expect("earlier");
        fs::write(&live, b"second").expect("live");

        let moved = set_aside_damaged_database(&live, "20261017-120000").expect("set aside");

        assert_eq!(
            moved,
            directory
                .path()
                .join("easywar.db.damaged-20261017-120000-1")
        );
        assert_eq!(fs::read(&earlier).expect("earlier"), b"earlier");
        assert_eq!(fs::read(&moved).expect("second"), b"second");
    }

    #[test]
    fn set_aside_refuses_missing_relative_and_non_regular_paths() {
        let directory = tempfile::tempdir().expect("synthetic directory");
        assert!(set_aside_damaged_database(&directory.path().join("missing.db"), "s").is_err());
        assert!(set_aside_damaged_database(Path::new("easywar.db"), "s").is_err());
        assert!(set_aside_damaged_database(directory.path(), "s").is_err());
    }

    #[test]
    fn healthy_start_shows_no_dialog() {
        let runtime = runtime();
        let directory = tempfile::tempdir().expect("synthetic directory");
        let live = directory.path().join("easywar.db");
        let dialogs = FakeDialogs::new(true);

        let outcome = run_guarded_step(&live, &dialogs, || prepare_step(&runtime, &live));

        assert_eq!(outcome, Ok(StepOutcome::Completed));
        assert!(live.exists());
        assert_eq!(dialogs.confirmed.get(), 0);
        assert!(dialogs.notices.borrow().is_empty());
    }

    #[test]
    fn damaged_database_is_set_aside_only_after_consent_and_keeps_bytes() {
        let runtime = runtime();
        let directory = tempfile::tempdir().expect("synthetic directory");
        let live = directory.path().join("easywar.db");
        let garbage = synthetic_garbage();
        fs::write(&live, &garbage).expect("garbage");
        let dialogs = FakeDialogs::new(true);

        let outcome = run_guarded_step(&live, &dialogs, || prepare_step(&runtime, &live))
            .expect("recovered start");

        let StepOutcome::SetAside(moved) = outcome else {
            panic!("expected the damaged database to be set aside");
        };
        assert_eq!(dialogs.confirmed.get(), 1);
        assert_eq!(
            fs::read(&moved).expect("damaged copy"),
            garbage,
            "bytes are untouched"
        );
        assert!(live.exists(), "a fresh database was created");
        assert!(
            runtime
                .block_on(crate::restore::inspect_backup(&live))
                .is_ok(),
            "the fresh database passes the same inspection"
        );
        let notices = dialogs.notices.borrow();
        assert_eq!(notices.len(), 1);
        assert!(notices[0].contains(".damaged-"));
        assert!(notices[0].contains("Резервна копія"));
    }

    #[test]
    fn declining_leaves_the_damaged_database_exactly_as_it_was() {
        let runtime = runtime();
        let directory = tempfile::tempdir().expect("synthetic directory");
        let live = directory.path().join("easywar.db");
        let garbage = synthetic_garbage();
        fs::write(&live, &garbage).expect("garbage");
        let dialogs = FakeDialogs::new(false);

        let outcome = run_guarded_step(&live, &dialogs, || prepare_step(&runtime, &live));

        assert_eq!(outcome, Err(StartupAbort));
        assert_eq!(dialogs.confirmed.get(), 1);
        assert_eq!(fs::read(&live).expect("live"), garbage);
        let entries = fs::read_dir(directory.path()).expect("dir").count();
        assert_eq!(entries, 1, "no copies, no new database");
    }

    #[test]
    fn newer_database_is_reported_and_never_moved() {
        let runtime = runtime();
        let directory = tempfile::tempdir().expect("synthetic directory");
        let live = directory.path().join("easywar.db");
        runtime
            .block_on(migration_startup::prepare_database(&live))
            .expect("current database");
        let newer = database::latest_schema_version().expect("latest") + 1;
        runtime.block_on(async {
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect_with(SqliteConnectOptions::new().filename(&live))
                .await
                .expect("open");
            sqlx::query(
                "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time)
                 VALUES (?, 'synthetic future', 1, x'00', 0)",
            )
            .bind(newer)
            .execute(&pool)
            .await
            .expect("insert");
            pool.close().await;
        });
        let before = fs::read(&live).expect("before");
        let dialogs = FakeDialogs::new(true);

        let outcome = run_guarded_step(&live, &dialogs, || prepare_step(&runtime, &live));

        assert_eq!(outcome, Err(StartupAbort));
        assert_eq!(
            dialogs.confirmed.get(),
            0,
            "no question: nothing may be moved"
        );
        assert_eq!(fs::read(&live).expect("after"), before);
        let notices = dialogs.notices.borrow();
        assert_eq!(notices.len(), 1);
        assert!(notices[0].contains("новішою версією"));
        assert!(notices[0].contains(&newer.to_string()));
    }

    #[test]
    fn other_failures_are_reported_without_touching_files() {
        let directory = tempfile::tempdir().expect("synthetic directory");
        let live = directory.path().join("easywar.db");
        fs::write(&live, b"synthetic").expect("live");
        let dialogs = FakeDialogs::new(true);

        let outcome = run_guarded_step(&live, &dialogs, || {
            Err(Failure::Other("синтетична помилка диска".to_string()))
        });

        assert_eq!(outcome, Err(StartupAbort));
        assert_eq!(dialogs.confirmed.get(), 0);
        assert_eq!(fs::read(&live).expect("live"), b"synthetic");
        assert!(dialogs.notices.borrow()[0].contains("синтетична помилка диска"));
    }

    #[test]
    fn a_failed_second_attempt_keeps_the_damaged_copy_and_says_where_it_is() {
        let directory = tempfile::tempdir().expect("synthetic directory");
        let live = directory.path().join("easywar.db");
        fs::write(&live, b"synthetic damaged").expect("live");
        let dialogs = FakeDialogs::new(true);
        let attempts = Cell::new(0);

        let outcome = run_guarded_step(&live, &dialogs, || {
            attempts.set(attempts.get() + 1);
            if attempts.get() == 1 {
                Err(Failure::Damaged("синтетичне пошкодження".to_string()))
            } else {
                Err(Failure::Other("синтетичний збій диска".to_string()))
            }
        });

        assert_eq!(outcome, Err(StartupAbort));
        assert_eq!(attempts.get(), 2);
        let damaged_copies: Vec<_> = fs::read_dir(directory.path())
            .expect("dir")
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().contains(".damaged-"))
            .collect();
        assert_eq!(damaged_copies.len(), 1);
        assert!(dialogs.notices.borrow()[0].contains(".damaged-"));
    }
}
