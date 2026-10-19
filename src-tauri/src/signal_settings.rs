use crate::{
    repository::{RepositoryError, SettingUpdate, SettingsStore},
    signal_policy::{SignalAdapterConfig, SignalPolicyError, ValidatedSignalAdapterConfig},
};
use serde::{Deserialize, Serialize};

pub const SIGNAL_SETTINGS_KEY: &str = "signal.adapter.v1";
const SIGNAL_SETTINGS_SCHEMA_VERSION: u32 = 1;

#[derive(Clone, Debug)]
pub struct SignalSettingsStore {
    settings: SettingsStore,
}

#[derive(Debug, thiserror::Error)]
pub enum SignalSettingsError {
    #[error("не вдалося прочитати або зберегти локальні налаштування Signal")]
    Storage(#[from] RepositoryError),
    #[error("збережені налаштування Signal мають невідомий формат")]
    InvalidStoredConfig,
    #[error("збережені налаштування Signal мають непідтримувану версію")]
    UnsupportedVersion,
    #[error("автоматичне приймання Signal не можна ввімкнути з вікна програми; використайте явний обмежений сеанс")]
    DesktopIntakeUnavailable,
    #[error("налаштування Signal не пройшли перевірку: {0}")]
    Policy(#[from] SignalPolicyError),
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct StoredSignalSettings {
    schema_version: u32,
    config: SignalAdapterConfig,
}

impl SignalSettingsStore {
    pub fn new(settings: SettingsStore) -> Self {
        Self { settings }
    }

    pub async fn load(&self) -> Result<ValidatedSignalAdapterConfig, SignalSettingsError> {
        let Some(stored) = self.settings.get(SIGNAL_SETTINGS_KEY).await? else {
            return Ok(SignalAdapterConfig::default().validate()?);
        };

        let stored: StoredSignalSettings = serde_json::from_value(stored.value)
            .map_err(|_| SignalSettingsError::InvalidStoredConfig)?;
        if stored.schema_version != SIGNAL_SETTINGS_SCHEMA_VERSION {
            return Err(SignalSettingsError::UnsupportedVersion);
        }

        Ok(stored.config.validate()?)
    }

    pub async fn save(
        &self,
        config: SignalAdapterConfig,
        updated_at: &str,
    ) -> Result<(), SignalSettingsError> {
        let validated = config.validate()?;
        let stored = StoredSignalSettings {
            schema_version: SIGNAL_SETTINGS_SCHEMA_VERSION,
            config: validated.as_config().clone(),
        };
        let value =
            serde_json::to_value(stored).map_err(|_| SignalSettingsError::InvalidStoredConfig)?;
        self.settings
            .upsert(&SettingUpdate {
                key: SIGNAL_SETTINGS_KEY.to_owned(),
                value,
                updated_at: updated_at.to_owned(),
            })
            .await?;

        Ok(())
    }

    pub async fn save_from_desktop(
        &self,
        config: SignalAdapterConfig,
        updated_at: &str,
    ) -> Result<(), SignalSettingsError> {
        if config.intake_enabled {
            return Err(SignalSettingsError::DesktopIntakeUnavailable);
        }
        self.save(config, updated_at).await
    }

    pub async fn load_for_explicit_session(
        &self,
    ) -> Result<ValidatedSignalAdapterConfig, SignalSettingsError> {
        let loaded = self.load().await?;
        let mut config = loaded.as_config().clone();
        config.intake_enabled = true;
        Ok(config.validate()?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{database::INITIAL_SCHEMA_SQL, signal_policy::SignalAllowlist};
    use serde_json::json;
    use sqlx::sqlite::SqlitePoolOptions;

    const NOW: &str = "2026-01-01T00:00:00Z";

    async fn stores() -> (SignalSettingsStore, SettingsStore) {
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
        (SignalSettingsStore::new(settings.clone()), settings)
    }

    #[tokio::test]
    async fn missing_setting_loads_disabled_local_defaults() {
        let (store, _) = stores().await;
        let loaded = store.load().await.expect("налаштування за замовчуванням");

        assert!(!loaded.as_config().intake_enabled);
        assert!(!loaded.permits_source("sender-demo", None));
    }

    #[tokio::test]
    async fn synthetic_allowlist_round_trips_locally() {
        let (store, settings) = stores().await;
        let config = SignalAdapterConfig {
            intake_enabled: true,
            allowlist: SignalAllowlist::new(["sender-demo".to_owned()], ["group-demo".to_owned()])
                .unwrap(),
            ..SignalAdapterConfig::default()
        };
        store.save(config, NOW).await.expect("збереження");

        let loaded = store.load().await.expect("зчитування");
        assert!(loaded.permits_source("sender-demo", Some("group-demo")));
        assert!(!loaded.permits_source("sender-other", Some("group-demo")));
        assert_eq!(
            settings
                .get(SIGNAL_SETTINGS_KEY)
                .await
                .unwrap()
                .unwrap()
                .key,
            SIGNAL_SETTINGS_KEY
        );
    }

    #[tokio::test]
    async fn invalid_config_is_not_written_and_tampered_storage_fails_closed() {
        let (store, settings) = stores().await;
        let result = store
            .save(
                SignalAdapterConfig {
                    intake_enabled: true,
                    ..SignalAdapterConfig::default()
                },
                NOW,
            )
            .await;
        assert!(matches!(result, Err(SignalSettingsError::Policy(_))));
        assert!(settings.get(SIGNAL_SETTINGS_KEY).await.unwrap().is_none());

        settings
            .upsert(&SettingUpdate {
                key: SIGNAL_SETTINGS_KEY.to_owned(),
                value: json!({
                    "schema_version": 1,
                    "config": {
                        "endpoint": {"transport": "http", "address": "192.0.2.10:8080"},
                        "receive_mode": "manual",
                        "intake_enabled": true,
                        "allowlist": {"allowed_senders": ["sender-demo"], "allowed_groups": []},
                        "auto_approve": false
                    }
                }),
                updated_at: NOW.to_owned(),
            })
            .await
            .unwrap();
        assert!(matches!(
            store.load().await,
            Err(SignalSettingsError::Policy(_))
        ));
    }

    #[tokio::test]
    async fn unsupported_version_is_not_used() {
        let (store, settings) = stores().await;
        settings
            .upsert(&SettingUpdate {
                key: SIGNAL_SETTINGS_KEY.to_owned(),
                value: json!({"schema_version": 2, "config": SignalAdapterConfig::default()}),
                updated_at: NOW.to_owned(),
            })
            .await
            .unwrap();

        assert!(matches!(
            store.load().await,
            Err(SignalSettingsError::UnsupportedVersion)
        ));
    }

    #[tokio::test]
    async fn desktop_cannot_enable_intake_even_with_a_valid_allowlist() {
        let (store, settings) = stores().await;
        let config = SignalAdapterConfig {
            intake_enabled: true,
            allowlist: SignalAllowlist::new(["sender-demo".to_owned()], []).unwrap(),
            ..SignalAdapterConfig::default()
        };
        assert!(config.clone().validate().is_ok());

        let result = store.save_from_desktop(config, NOW).await;
        assert!(matches!(
            result,
            Err(SignalSettingsError::DesktopIntakeUnavailable)
        ));
        assert!(settings.get(SIGNAL_SETTINGS_KEY).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn desktop_saves_allowlist_only_while_intake_stays_disabled() {
        let (store, _) = stores().await;
        let config = SignalAdapterConfig {
            allowlist: SignalAllowlist::new(["sender-demo".to_owned()], []).unwrap(),
            ..SignalAdapterConfig::default()
        };

        store.save_from_desktop(config, NOW).await.unwrap();
        let loaded = store.load().await.unwrap();
        assert!(!loaded.as_config().intake_enabled);
        assert!(!loaded.permits_source("sender-demo", None));
    }

    #[tokio::test]
    async fn explicit_session_enables_only_a_saved_valid_allowlist_in_memory() {
        let (store, settings) = stores().await;
        assert!(matches!(
            store.load_for_explicit_session().await,
            Err(SignalSettingsError::Policy(
                SignalPolicyError::AllowlistRequired
            ))
        ));

        store
            .save_from_desktop(
                SignalAdapterConfig {
                    allowlist: SignalAllowlist::new(["sender-demo".to_owned()], []).unwrap(),
                    ..SignalAdapterConfig::default()
                },
                NOW,
            )
            .await
            .unwrap();

        let session = store.load_for_explicit_session().await.unwrap();
        assert!(session.permits_source("sender-demo", None));
        let persisted = store.load().await.unwrap();
        assert!(!persisted.as_config().intake_enabled);
        assert!(!persisted.permits_source("sender-demo", None));
        assert!(settings.get(SIGNAL_SETTINGS_KEY).await.unwrap().is_some());
    }

    #[tokio::test]
    async fn group_member_mode_round_trips_and_opens_a_session_without_senders() {
        let (store, settings) = stores().await;
        store
            .save_from_desktop(
                SignalAdapterConfig {
                    allowlist: SignalAllowlist::new([], ["group-demo".to_owned()])
                        .unwrap()
                        .with_group_members(true),
                    ..SignalAdapterConfig::default()
                },
                NOW,
            )
            .await
            .unwrap();

        let stored = settings.get(SIGNAL_SETTINGS_KEY).await.unwrap().unwrap();
        assert_eq!(
            stored.value["config"]["allowlist"]["allow_group_members"],
            json!(true)
        );
        let session = store.load_for_explicit_session().await.unwrap();
        assert!(session.permits_source("member-demo", Some("group-demo")));
        assert!(!session.permits_source("member-demo", None));
        assert!(!store
            .load()
            .await
            .unwrap()
            .permits_group_members("group-demo"));
    }
}
