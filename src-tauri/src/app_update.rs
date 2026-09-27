//! Signed in-app updates (tauri-plugin-updater).
//!
//! The update manifest URL is compiled in from `EASYWAR_UPDATE_ENDPOINT` by the
//! release build. Builds without it (local and pull-request builds) never
//! contact the network. The app checks only when the user asks, verifies every
//! package against the public key in `tauri.conf.json`, and snapshots the live
//! database next to it before installing.

use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

use chrono::{DateTime, Utc};
use serde::Serialize;
use tauri::{AppHandle, Url};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::backup::{BackupError, BackupStore};

const UPDATE_ENDPOINT: Option<&str> = option_env!("EASYWAR_UPDATE_ENDPOINT");

/// Update found by the last check, kept until the user confirms installation.
#[derive(Default)]
pub struct PendingUpdate(Mutex<Option<Update>>);

impl PendingUpdate {
    fn replace(&self, update: Option<Update>) {
        *self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = update;
    }

    fn take(&self) -> Option<Update> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take()
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateStatus {
    configured: bool,
    current_version: String,
    available: Option<AvailableUpdate>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableUpdate {
    version: String,
    notes: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum AppUpdateError {
    #[error("немає перевіреного оновлення; спершу натисніть «Перевірити оновлення»")]
    NothingPending,
    #[error("некоректна адреса оновлень у цій збірці: {0}")]
    InvalidEndpoint(String),
    #[error("{}", updater_message(.0))]
    Updater(#[from] tauri_plugin_updater::Error),
    #[error("резервну копію бази не створено, тому оновлення скасовано: {0}")]
    Backup(#[from] BackupError),
    #[error("не вдалося підготувати папку для резервної копії: {0}")]
    Io(#[from] std::io::Error),
}

fn updater_message(error: &tauri_plugin_updater::Error) -> String {
    use tauri_plugin_updater::Error;
    match error {
        Error::Minisign(_)
        | Error::Base64(_)
        | Error::SignatureUtf8(_)
        | Error::SignedVersionMismatch { .. }
        | Error::MissingSignedVersion => {
            "підпис пакета не збігається з ключем EasyWAR, пакет відхилено".to_owned()
        }
        Error::Reqwest(_) | Error::Network(_) | Error::ReleaseNotFound => {
            format!("сервер оновлень недоступний або відповів некоректно ({error})")
        }
        Error::TargetNotFound(_) | Error::TargetsNotFound(_) => {
            "для цієї системи в оновленні немає пакета".to_owned()
        }
        _ => format!("помилка модуля оновлень: {error}"),
    }
}

fn configured_endpoint() -> Result<Option<Url>, AppUpdateError> {
    match UPDATE_ENDPOINT
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        None => Ok(None),
        Some(value) => Url::parse(value)
            .map(Some)
            .map_err(|error| AppUpdateError::InvalidEndpoint(error.to_string())),
    }
}

pub async fn check(
    app: &AppHandle,
    pending: &PendingUpdate,
) -> Result<AppUpdateStatus, AppUpdateError> {
    let current_version = app.package_info().version.to_string();
    let Some(endpoint) = configured_endpoint()? else {
        return Ok(AppUpdateStatus {
            configured: false,
            current_version,
            available: None,
        });
    };
    let update = app
        .updater_builder()
        .endpoints(vec![endpoint])?
        .build()?
        .check()
        .await?;
    let available = update.as_ref().map(|update| AvailableUpdate {
        version: update.version.clone(),
        notes: update.body.clone().filter(|notes| !notes.trim().is_empty()),
    });
    pending.replace(update);
    Ok(AppUpdateStatus {
        configured: true,
        current_version,
        available,
    })
}

pub fn pre_update_backup_path(
    backups_dir: &Path,
    from_version: &str,
    to_version: &str,
    now: DateTime<Utc>,
) -> PathBuf {
    backups_dir.join(format!(
        "EasyWAR-before-update-{from_version}-to-{to_version}-{}.sqlite3",
        now.format("%Y%m%d-%H%M%S")
    ))
}

/// Snapshots the database, then downloads, verifies and installs the pending
/// update. Returns the snapshot path. On Windows the installer takes over and
/// this process exits before returning; on macOS the caller restarts the app.
pub async fn install(
    pending: &PendingUpdate,
    backup: &BackupStore,
    backups_dir: &Path,
) -> Result<PathBuf, AppUpdateError> {
    let update = pending.take().ok_or(AppUpdateError::NothingPending)?;
    let snapshot = pre_update_backup_path(
        backups_dir,
        &update.current_version,
        &update.version,
        Utc::now(),
    );
    let prepared = async {
        fs::create_dir_all(backups_dir)?;
        backup.create_at(&snapshot).await?;
        Ok::<_, AppUpdateError>(())
    }
    .await;
    if let Err(error) = prepared {
        pending.replace(Some(update));
        return Err(error);
    }
    update.download_and_install(|_, _| {}, || {}).await?;
    Ok(snapshot)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn pre_update_backup_names_both_versions_and_time() {
        let now = Utc.with_ymd_and_hms(2026, 9, 27, 8, 5, 9).unwrap();
        assert_eq!(
            pre_update_backup_path(Path::new("/synthetic/backups"), "0.5.0", "0.6.0", now),
            PathBuf::from(
                "/synthetic/backups/EasyWAR-before-update-0.5.0-to-0.6.0-20260927-080509.sqlite3"
            )
        );
    }

    #[test]
    fn signature_and_network_failures_are_explained_in_ukrainian() {
        let signature = AppUpdateError::from(tauri_plugin_updater::Error::SignatureUtf8(
            "synthetic".to_owned(),
        ));
        assert_eq!(
            signature.to_string(),
            "підпис пакета не збігається з ключем EasyWAR, пакет відхилено"
        );
        let network = AppUpdateError::from(tauri_plugin_updater::Error::ReleaseNotFound);
        assert!(network
            .to_string()
            .starts_with("сервер оновлень недоступний"));
    }

    #[tokio::test]
    async fn install_without_a_checked_update_changes_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .connect_with(
                sqlx::sqlite::SqliteConnectOptions::new()
                    .filename(dir.path().join("synthetic.sqlite3"))
                    .create_if_missing(true),
            )
            .await
            .unwrap();
        let backups = dir.path().join("backups");

        let result = install(&PendingUpdate::default(), &BackupStore::new(pool), &backups).await;

        assert!(matches!(result, Err(AppUpdateError::NothingPending)));
        assert!(!backups.exists());
    }
}
