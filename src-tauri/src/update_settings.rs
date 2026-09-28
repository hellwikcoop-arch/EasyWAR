//! The optional automatic update check.
//!
//! Off by default: without it EasyWAR contacts the update server only when the
//! user presses «Перевірити оновлення». When the user turns it on, the app
//! checks at most once a day, at start-up, and still installs nothing without
//! confirmation. Unknown or damaged stored settings count as off.

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

use crate::repository::{RepositoryError, SettingUpdate, SettingsStore};

pub const AUTO_UPDATE_SETTINGS_KEY: &str = "app.update.auto_check.v1";
const AUTO_UPDATE_SCHEMA_VERSION: u32 = 1;

/// The shortest time between two automatic checks.
pub fn auto_check_interval() -> Duration {
    Duration::hours(24)
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoUpdateSettings {
    pub enabled: bool,
    pub last_check_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct StoredAutoUpdateSettings {
    schema_version: u32,
    enabled: bool,
    last_check_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug)]
pub struct AutoUpdateStore {
    settings: SettingsStore,
}

impl AutoUpdateStore {
    pub fn new(settings: SettingsStore) -> Self {
        Self { settings }
    }

    pub async fn load(&self) -> Result<AutoUpdateSettings, RepositoryError> {
        let Some(stored) = self.settings.get(AUTO_UPDATE_SETTINGS_KEY).await? else {
            return Ok(AutoUpdateSettings::default());
        };
        Ok(
            match serde_json::from_value::<StoredAutoUpdateSettings>(stored.value) {
                Ok(stored) if stored.schema_version == AUTO_UPDATE_SCHEMA_VERSION => {
                    AutoUpdateSettings {
                        enabled: stored.enabled,
                        last_check_at: stored.last_check_at,
                    }
                }
                _ => AutoUpdateSettings::default(),
            },
        )
    }

    async fn save(
        &self,
        settings: AutoUpdateSettings,
        now: DateTime<Utc>,
    ) -> Result<(), RepositoryError> {
        let stored = StoredAutoUpdateSettings {
            schema_version: AUTO_UPDATE_SCHEMA_VERSION,
            enabled: settings.enabled,
            last_check_at: settings.last_check_at,
        };
        self.settings
            .upsert(&SettingUpdate {
                key: AUTO_UPDATE_SETTINGS_KEY.to_owned(),
                value: serde_json::to_value(stored).expect("settings serialize to JSON"),
                updated_at: now.to_rfc3339(),
            })
            .await
    }

    pub async fn set_enabled(
        &self,
        enabled: bool,
        now: DateTime<Utc>,
    ) -> Result<AutoUpdateSettings, RepositoryError> {
        let settings = AutoUpdateSettings {
            enabled,
            ..self.load().await?
        };
        self.save(settings, now).await?;
        Ok(settings)
    }

    /// Whether an automatic check should run now. A due check is recorded
    /// before the network is contacted, so a failing server is not retried on
    /// every start.
    pub async fn claim_due_check(&self, now: DateTime<Utc>) -> Result<bool, RepositoryError> {
        let settings = self.load().await?;
        let due = settings.enabled
            && settings.last_check_at.map_or(true, |last| {
                now - last >= auto_check_interval() || last > now
            });
        if due {
            self.save(
                AutoUpdateSettings {
                    last_check_at: Some(now),
                    ..settings
                },
                now,
            )
            .await?;
        }
        Ok(due)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::INITIAL_SCHEMA_SQL;
    use chrono::TimeZone;
    use serde_json::json;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn stores() -> (AutoUpdateStore, SettingsStore) {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("синтетична локальна БД має відкриватися");
        sqlx::raw_sql(INITIAL_SCHEMA_SQL)
            .execute(&pool)
            .await
            .expect("міграція має застосовуватися");
        let settings = SettingsStore::new(pool);
        (AutoUpdateStore::new(settings.clone()), settings)
    }

    fn at(hour: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 9, 28, 0, 0, 0).unwrap() + Duration::hours(hour.into())
    }

    #[tokio::test]
    async fn automatic_checks_are_off_until_the_user_turns_them_on() {
        let (store, settings) = stores().await;
        assert_eq!(store.load().await.unwrap(), AutoUpdateSettings::default());
        assert!(!store.claim_due_check(at(0)).await.unwrap());
        assert!(
            settings
                .get(AUTO_UPDATE_SETTINGS_KEY)
                .await
                .unwrap()
                .is_none(),
            "nothing is written while the check is off"
        );
    }

    #[tokio::test]
    async fn an_enabled_check_runs_at_most_once_a_day() {
        let (store, _) = stores().await;
        let enabled = store.set_enabled(true, at(0)).await.unwrap();
        assert_eq!(
            enabled,
            AutoUpdateSettings {
                enabled: true,
                last_check_at: None
            }
        );
        assert!(
            store.claim_due_check(at(1)).await.unwrap(),
            "first start after enabling"
        );
        assert_eq!(store.load().await.unwrap().last_check_at, Some(at(1)));
        assert!(!store.claim_due_check(at(2)).await.unwrap());
        assert!(!store.claim_due_check(at(24)).await.unwrap());
        assert!(store.claim_due_check(at(25)).await.unwrap(), "a day later");
        assert!(
            store.claim_due_check(at(3)).await.unwrap(),
            "a clock set back does not block checks for good"
        );
    }

    #[tokio::test]
    async fn turning_the_check_off_keeps_it_off_and_keeps_the_last_check() {
        let (store, _) = stores().await;
        store.set_enabled(true, at(0)).await.unwrap();
        assert!(store.claim_due_check(at(1)).await.unwrap());
        let off = store.set_enabled(false, at(2)).await.unwrap();
        assert_eq!(
            off,
            AutoUpdateSettings {
                enabled: false,
                last_check_at: Some(at(1))
            }
        );
        assert!(!store.claim_due_check(at(48)).await.unwrap());
    }

    #[tokio::test]
    async fn damaged_or_unknown_settings_count_as_off() {
        let (store, settings) = stores().await;
        for value in [
            json!({ "schema_version": 2, "enabled": true, "last_check_at": null }),
            json!({ "schema_version": 1, "enabled": "yes", "last_check_at": null }),
            json!({ "schema_version": 1, "enabled": true, "last_check_at": null, "endpoint": "https://x.invalid" }),
            json!("on"),
        ] {
            settings
                .upsert(&SettingUpdate {
                    key: AUTO_UPDATE_SETTINGS_KEY.to_owned(),
                    value,
                    updated_at: at(0).to_rfc3339(),
                })
                .await
                .unwrap();
            assert_eq!(store.load().await.unwrap(), AutoUpdateSettings::default());
            assert!(!store.claim_due_check(at(1)).await.unwrap());
        }
    }
}
