//! Схема профілю (етап E3 дорожньої карти модулів): рішення користувача про стовпці його таблиць.
//!
//! Документ складає й перевіряє JS-ядро (`src/profile-schema-core.js`). Rust зберігає його як
//! один JSON на профіль і перевіряє лише конверт: формат, версію, належність профілю, розміри
//! й послідовність ревізій. Профіль береться з активного сеансу, а не від клієнта, тож схему
//! іншого профілю не можна ні прочитати, ні перезаписати.

use crate::local_profiles::validate_profile_id;
use serde::Serialize;
use serde_json::Value;
use sqlx::SqlitePool;

pub const SCHEMA_FORMAT: &str = "easywar.profile-schema";
/// Найвища версія формату, яку цей застосунок уміє читати й писати.
pub const SUPPORTED_FORMAT_VERSION: i64 = 1;
const MAX_SCHEMA_BYTES: usize = 1_048_576;
const MAX_SOURCES: usize = 64;
const MAX_COLUMNS_PER_SOURCE: usize = 200;
const MAX_BINDINGS: usize = 2000;

#[derive(Clone, Debug)]
pub struct ProfileSchemaStore {
    pool: SqlitePool,
}

/// Збережена схема профілю. Без збереженої схеми `schema` порожня, а `revision` — 0.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSchemaRecord {
    pub schema: Option<Value>,
    pub revision: i64,
    pub updated_at: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum ProfileSchemaError {
    #[error("не вдалося прочитати або зберегти схему профілю")]
    Storage(#[from] sqlx::Error),
    #[error("спершу увійдіть у локальний профіль")]
    ProfileRequired,
    #[error("некоректний локальний ідентифікатор профілю")]
    InvalidProfileId,
    #[error("локальний профіль не знайдено")]
    ProfileNotFound,
    #[error("схема профілю має некоректний вигляд: {0}")]
    Invalid(&'static str),
    #[error("схема належить іншому профілю")]
    ForeignProfile,
    #[error("схему створено новішою версією EasyWAR; цей запис її не змінює")]
    NewerFormat,
    #[error("схему профілю змінено в іншому місці; перечитайте її й повторіть")]
    Stale,
    #[error("схема профілю завелика")]
    TooLarge,
}

impl ProfileSchemaStore {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn get(&self, profile_id: &str) -> Result<ProfileSchemaRecord, ProfileSchemaError> {
        validate_profile_id(profile_id).map_err(|_| ProfileSchemaError::InvalidProfileId)?;
        let row: Option<(String, i64, String)> = sqlx::query_as(
            "SELECT schema_json, revision, updated_at FROM profile_schemas WHERE profile_id = ?",
        )
        .bind(profile_id)
        .fetch_optional(&self.pool)
        .await?;
        match row {
            None => Ok(ProfileSchemaRecord {
                schema: None,
                revision: 0,
                updated_at: None,
            }),
            Some((json, revision, updated_at)) => {
                Ok(ProfileSchemaRecord {
                    schema: Some(serde_json::from_str(&json).map_err(|_| {
                        ProfileSchemaError::Invalid("збережений документ пошкоджено")
                    })?),
                    revision,
                    updated_at: Some(updated_at),
                })
            }
        }
    }

    /// Записує схему профілю. `expected_revision` — ревізія, яку клієнт прочитав (0, якщо схеми
    /// ще не було); якщо збережена вже інша, запис відхиляється і нічого не змінює.
    pub async fn save(
        &self,
        profile_id: &str,
        schema: &Value,
        expected_revision: i64,
        now: &str,
    ) -> Result<ProfileSchemaRecord, ProfileSchemaError> {
        validate_profile_id(profile_id).map_err(|_| ProfileSchemaError::InvalidProfileId)?;
        let revision = validate_envelope(schema, profile_id)?;
        if expected_revision < 0 || revision <= expected_revision {
            return Err(ProfileSchemaError::Stale);
        }
        let format_version = schema["version"].as_i64().unwrap_or(1);
        let json = serde_json::to_string(schema)
            .map_err(|_| ProfileSchemaError::Invalid("документ не вдалося записати"))?;
        if json.len() > MAX_SCHEMA_BYTES {
            return Err(ProfileSchemaError::TooLarge);
        }
        let exists: Option<i64> = sqlx::query_scalar("SELECT 1 FROM local_profiles WHERE id = ?")
            .bind(profile_id)
            .fetch_optional(&self.pool)
            .await?;
        if exists.is_none() {
            return Err(ProfileSchemaError::ProfileNotFound);
        }
        let changed = if expected_revision == 0 {
            sqlx::query(
                "INSERT INTO profile_schemas (profile_id, format_version, revision, schema_json, updated_at)
                 VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT(profile_id) DO NOTHING",
            )
            .bind(profile_id)
            .bind(format_version)
            .bind(revision)
            .bind(&json)
            .bind(now)
            .execute(&self.pool)
            .await?
            .rows_affected()
        } else {
            sqlx::query(
                "UPDATE profile_schemas
                 SET format_version = ?, revision = ?, schema_json = ?, updated_at = ?
                 WHERE profile_id = ? AND revision = ? AND format_version <= ?",
            )
            .bind(format_version)
            .bind(revision)
            .bind(&json)
            .bind(now)
            .bind(profile_id)
            .bind(expected_revision)
            .bind(SUPPORTED_FORMAT_VERSION)
            .execute(&self.pool)
            .await?
            .rows_affected()
        };
        if changed == 0 {
            let stored: Option<i64> = sqlx::query_scalar(
                "SELECT format_version FROM profile_schemas WHERE profile_id = ?",
            )
            .bind(profile_id)
            .fetch_optional(&self.pool)
            .await?;
            return Err(match stored {
                Some(version) if version > SUPPORTED_FORMAT_VERSION => {
                    ProfileSchemaError::NewerFormat
                }
                _ => ProfileSchemaError::Stale,
            });
        }
        self.get(profile_id).await
    }

    /// Стирає схему профілю (рішення користувача про стовпці). Таблиці модулів і їхні дані
    /// не чіпає. Без збереженої схеми нічого не робить; зі застарілою ревізією відхиляє.
    pub async fn reset(
        &self,
        profile_id: &str,
        expected_revision: i64,
    ) -> Result<(), ProfileSchemaError> {
        validate_profile_id(profile_id).map_err(|_| ProfileSchemaError::InvalidProfileId)?;
        let stored: Option<(i64, i64)> = sqlx::query_as(
            "SELECT revision, format_version FROM profile_schemas WHERE profile_id = ?",
        )
        .bind(profile_id)
        .fetch_optional(&self.pool)
        .await?;
        let Some((revision, format_version)) = stored else {
            return Ok(());
        };
        if format_version > SUPPORTED_FORMAT_VERSION {
            return Err(ProfileSchemaError::NewerFormat);
        }
        if revision != expected_revision {
            return Err(ProfileSchemaError::Stale);
        }
        let removed =
            sqlx::query("DELETE FROM profile_schemas WHERE profile_id = ? AND revision = ?")
                .bind(profile_id)
                .bind(expected_revision)
                .execute(&self.pool)
                .await?
                .rows_affected();
        if removed == 0 {
            return Err(ProfileSchemaError::Stale);
        }
        Ok(())
    }
}

/// Перевіряє конверт документа й повертає його ревізію.
fn validate_envelope(schema: &Value, profile_id: &str) -> Result<i64, ProfileSchemaError> {
    let object = schema
        .as_object()
        .ok_or(ProfileSchemaError::Invalid("очікується об'єкт"))?;
    if object.get("format").and_then(Value::as_str) != Some(SCHEMA_FORMAT) {
        return Err(ProfileSchemaError::Invalid("невідомий формат"));
    }
    let version = object
        .get("version")
        .and_then(Value::as_i64)
        .filter(|version| *version >= 1)
        .ok_or(ProfileSchemaError::Invalid("некоректна версія формату"))?;
    if version > SUPPORTED_FORMAT_VERSION {
        return Err(ProfileSchemaError::NewerFormat);
    }
    if object.get("profileId").and_then(Value::as_str) != Some(profile_id) {
        return Err(ProfileSchemaError::ForeignProfile);
    }
    let revision = object
        .get("revision")
        .and_then(Value::as_i64)
        .filter(|revision| *revision >= 1)
        .ok_or(ProfileSchemaError::Invalid("некоректна ревізія"))?;
    let sources = object
        .get("sources")
        .and_then(Value::as_array)
        .ok_or(ProfileSchemaError::Invalid("очікується перелік джерел"))?;
    let bindings = object
        .get("bindings")
        .and_then(Value::as_array)
        .ok_or(ProfileSchemaError::Invalid("очікується перелік зіставлень"))?;
    if sources.len() > MAX_SOURCES || bindings.len() > MAX_BINDINGS {
        return Err(ProfileSchemaError::TooLarge);
    }
    for source in sources {
        let columns = source
            .get("columns")
            .and_then(Value::as_array)
            .ok_or(ProfileSchemaError::Invalid("у джерела немає стовпців"))?;
        if columns.len() > MAX_COLUMNS_PER_SOURCE {
            return Err(ProfileSchemaError::TooLarge);
        }
    }
    Ok(revision)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::{LOCAL_PROFILES_SQL, PROFILE_SCHEMAS_SQL};
    use serde_json::json;
    use sqlx::sqlite::SqlitePoolOptions;

    const PROFILE: &str = "profile-111111111111111111111111";
    const OTHER: &str = "profile-222222222222222222222222";
    const T1: &str = "2026-10-29T10:00:00Z";
    const T2: &str = "2026-10-29T11:00:00Z";

    async fn store() -> ProfileSchemaStore {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        for sql in [LOCAL_PROFILES_SQL, PROFILE_SCHEMAS_SQL] {
            sqlx::raw_sql(sql).execute(&pool).await.unwrap();
        }
        for (id, name) in [(PROFILE, "Перший"), (OTHER, "Другий")] {
            sqlx::query(
                "INSERT INTO local_profiles (id, display_name, name_key, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?)",
            )
            .bind(id)
            .bind(name)
            .bind(name.to_lowercase())
            .bind(T1)
            .bind(T1)
            .execute(&pool)
            .await
            .unwrap();
        }
        ProfileSchemaStore::new(pool)
    }

    fn schema(profile: &str, revision: i64) -> Value {
        json!({
            "format": SCHEMA_FORMAT,
            "version": 1,
            "profileId": profile,
            "revision": revision,
            "sources": [{
                "id": "src-1", "type": "module-table", "ref": "module-1", "title": "Журнал",
                "version": 1, "rowIdentity": null,
                "columns": [{ "key": "c_date", "header": "Дата", "type": "date" }]
            }],
            "bindings": [{
                "sourceId": "src-1", "columnKey": "c_date", "role": "event-date", "unit": "",
                "status": "confirmed", "decidedAtRevision": revision, "at": T1
            }]
        })
    }

    #[tokio::test]
    async fn a_profile_without_a_schema_reads_as_empty() {
        let store = store().await;
        let record = store.get(PROFILE).await.unwrap();
        assert_eq!(
            record,
            ProfileSchemaRecord {
                schema: None,
                revision: 0,
                updated_at: None
            }
        );
    }

    #[tokio::test]
    async fn a_saved_schema_is_read_back_unchanged_with_its_revision() {
        let store = store().await;
        let saved = store
            .save(PROFILE, &schema(PROFILE, 1), 0, T1)
            .await
            .unwrap();
        assert_eq!(saved.revision, 1);
        assert_eq!(saved.updated_at.as_deref(), Some(T1));
        assert_eq!(saved.schema, Some(schema(PROFILE, 1)));
        let updated = store
            .save(PROFILE, &schema(PROFILE, 2), 1, T2)
            .await
            .unwrap();
        assert_eq!(updated.revision, 2);
        assert_eq!(store.get(PROFILE).await.unwrap(), updated);
    }

    #[tokio::test]
    async fn a_stale_revision_changes_nothing() {
        let store = store().await;
        store
            .save(PROFILE, &schema(PROFILE, 1), 0, T1)
            .await
            .unwrap();
        store
            .save(PROFILE, &schema(PROFILE, 2), 1, T2)
            .await
            .unwrap();
        // друге вікно ще бачить ревізію 1
        let stale = store.save(PROFILE, &schema(PROFILE, 2), 1, T2).await;
        assert!(matches!(stale, Err(ProfileSchemaError::Stale)));
        // і ревізію 0, коли схема вже є
        let first = store.save(PROFILE, &schema(PROFILE, 1), 0, T2).await;
        assert!(matches!(first, Err(ProfileSchemaError::Stale)));
        assert_eq!(store.get(PROFILE).await.unwrap().revision, 2);
    }

    #[test]
    fn the_stale_message_keeps_the_mark_the_client_looks_for() {
        // src/profile-schema-client.js розпізнає застарілий запис за цим фрагментом.
        assert!(ProfileSchemaError::Stale
            .to_string()
            .contains("змінено в іншому місці"));
    }

    #[tokio::test]
    async fn the_new_revision_must_move_forward() {
        let store = store().await;
        store
            .save(PROFILE, &schema(PROFILE, 1), 0, T1)
            .await
            .unwrap();
        let same = store.save(PROFILE, &schema(PROFILE, 1), 1, T2).await;
        assert!(matches!(same, Err(ProfileSchemaError::Stale)));
    }

    #[tokio::test]
    async fn profiles_cannot_read_or_overwrite_each_other() {
        let store = store().await;
        store
            .save(PROFILE, &schema(PROFILE, 1), 0, T1)
            .await
            .unwrap();
        assert_eq!(store.get(OTHER).await.unwrap().schema, None);
        // документ чужого профілю під своїм ідентифікатором не записується
        let foreign = store.save(OTHER, &schema(PROFILE, 1), 0, T1).await;
        assert!(matches!(foreign, Err(ProfileSchemaError::ForeignProfile)));
        assert_eq!(store.get(OTHER).await.unwrap().revision, 0);
        // чужа схема лишається цілою
        assert_eq!(
            store.get(PROFILE).await.unwrap().schema,
            Some(schema(PROFILE, 1))
        );
    }

    #[tokio::test]
    async fn an_envelope_with_wrong_shape_is_refused() {
        let store = store().await;
        let mut other_format = schema(PROFILE, 1);
        other_format["format"] = json!("other");
        let mut no_sources = schema(PROFILE, 1);
        no_sources["sources"] = json!({});
        let mut zero_revision = schema(PROFILE, 1);
        zero_revision["revision"] = json!(0);
        for bad in [
            json!([]),
            json!("text"),
            other_format,
            no_sources,
            zero_revision,
        ] {
            let result = store.save(PROFILE, &bad, 0, T1).await;
            assert!(
                matches!(result, Err(ProfileSchemaError::Invalid(_))),
                "{bad}"
            );
        }
        assert_eq!(store.get(PROFILE).await.unwrap().schema, None);
    }

    #[tokio::test]
    async fn a_newer_format_is_neither_written_nor_overwritten() {
        let store = store().await;
        let mut newer = schema(PROFILE, 1);
        newer["version"] = json!(2);
        assert!(matches!(
            store.save(PROFILE, &newer, 0, T1).await,
            Err(ProfileSchemaError::NewerFormat)
        ));
        // документ новішого застосунку, що вже лежить у базі, старий застосунок не затирає
        sqlx::query(
            "INSERT INTO profile_schemas (profile_id, format_version, revision, schema_json, updated_at)
             VALUES (?, 2, 1, ?, ?)",
        )
        .bind(PROFILE)
        .bind(newer.to_string())
        .bind(T1)
        .execute(&store.pool)
        .await
        .unwrap();
        assert!(matches!(
            store.save(PROFILE, &schema(PROFILE, 2), 1, T2).await,
            Err(ProfileSchemaError::NewerFormat)
        ));
        assert!(matches!(
            store.reset(PROFILE, 1).await,
            Err(ProfileSchemaError::NewerFormat)
        ));
        assert_eq!(store.get(PROFILE).await.unwrap().schema, Some(newer));
    }

    #[tokio::test]
    async fn limits_are_enforced() {
        let store = store().await;
        let mut many = schema(PROFILE, 1);
        many["bindings"] = json!(vec![many["bindings"][0].clone(); MAX_BINDINGS + 1]);
        assert!(matches!(
            store.save(PROFILE, &many, 0, T1).await,
            Err(ProfileSchemaError::TooLarge)
        ));
        let mut huge = schema(PROFILE, 1);
        huge["sources"][0]["title"] = json!("я".repeat(MAX_SCHEMA_BYTES));
        assert!(matches!(
            store.save(PROFILE, &huge, 0, T1).await,
            Err(ProfileSchemaError::TooLarge)
        ));
    }

    #[tokio::test]
    async fn an_unknown_profile_gets_no_schema() {
        let store = store().await;
        let ghost = "profile-333333333333333333333333";
        assert!(matches!(
            store.save(ghost, &schema(ghost, 1), 0, T1).await,
            Err(ProfileSchemaError::ProfileNotFound)
        ));
        assert!(matches!(
            store.get("not-a-profile").await,
            Err(ProfileSchemaError::InvalidProfileId)
        ));
    }

    #[tokio::test]
    async fn reset_removes_only_the_own_schema_and_checks_the_revision() {
        let store = store().await;
        store
            .save(PROFILE, &schema(PROFILE, 1), 0, T1)
            .await
            .unwrap();
        store.save(OTHER, &schema(OTHER, 1), 0, T1).await.unwrap();
        assert!(matches!(
            store.reset(PROFILE, 5).await,
            Err(ProfileSchemaError::Stale)
        ));
        store.reset(PROFILE, 1).await.unwrap();
        assert_eq!(store.get(PROFILE).await.unwrap().schema, None);
        assert!(store.get(OTHER).await.unwrap().schema.is_some());
        // повторне стирання нічого не змінює
        store.reset(PROFILE, 1).await.unwrap();
    }

    #[tokio::test]
    async fn deleting_a_profile_removes_its_schema() {
        let store = store().await;
        store
            .save(PROFILE, &schema(PROFILE, 1), 0, T1)
            .await
            .unwrap();
        store.save(OTHER, &schema(OTHER, 1), 0, T1).await.unwrap();
        sqlx::query("DELETE FROM local_profiles WHERE id = ?")
            .bind(PROFILE)
            .execute(&store.pool)
            .await
            .unwrap();
        let rows: i64 = sqlx::query_scalar("SELECT count(*) FROM profile_schemas")
            .fetch_one(&store.pool)
            .await
            .unwrap();
        assert_eq!(rows, 1);
        assert!(store.get(OTHER).await.unwrap().schema.is_some());
    }

    #[tokio::test]
    async fn the_schema_does_not_touch_module_tables() {
        // Схема лежить у власній таблиці: синхронізація шаблонів `dashboard_module_fields` її не стирає.
        let store = store().await;
        store
            .save(PROFILE, &schema(PROFILE, 1), 0, T1)
            .await
            .unwrap();
        let tables: Vec<String> = sqlx::query_scalar(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'dashboard_%'",
        )
        .fetch_all(&store.pool)
        .await
        .unwrap();
        assert!(tables.is_empty());
    }
}
