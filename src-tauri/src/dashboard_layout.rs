//! Розкладка дашборда профілю (етап E4 дорожньої карти модулів): картки модулів, їхні власні
//! період і стиль та місце на сітці.
//!
//! Документ складає й перевіряє JS-ядро (`src/module-instance-core.js`). Rust зберігає його як
//! один JSON на пару (профіль, дашборд) і перевіряє лише конверт: формат, версію, належність
//! профілю, розміри й послідовність ревізій. Профіль береться з активного сеансу, а не від
//! клієнта, тож розкладку іншого профілю не можна ні прочитати, ні перезаписати. Рядків таблиць
//! розкладка не містить.

use crate::local_profiles::validate_profile_id;
use serde::Serialize;
use serde_json::Value;
use sqlx::SqlitePool;

pub const LAYOUT_FORMAT: &str = "easywar.dashboard-layout";
/// Найвища версія формату, яку цей застосунок уміє читати й писати.
pub const SUPPORTED_FORMAT_VERSION: i64 = 1;
const MAX_LAYOUT_BYTES: usize = 1_048_576;
const MAX_INSTANCES: usize = 120;
const MAX_DASHBOARD_ID_LEN: usize = 40;

#[derive(Clone, Debug)]
pub struct DashboardLayoutStore {
    pool: SqlitePool,
}

/// Збережена розкладка. Без збереженої `layout` порожня, а `revision` — 0.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardLayoutRecord {
    pub layout: Option<Value>,
    pub revision: i64,
    pub updated_at: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum DashboardLayoutError {
    #[error("не вдалося прочитати або зберегти розкладку дашборда")]
    Storage(#[from] sqlx::Error),
    #[error("спершу увійдіть у локальний профіль")]
    ProfileRequired,
    #[error("некоректний локальний ідентифікатор профілю")]
    InvalidProfileId,
    #[error("некоректний ідентифікатор дашборда")]
    InvalidDashboardId,
    #[error("локальний профіль не знайдено")]
    ProfileNotFound,
    #[error("розкладка має некоректний вигляд: {0}")]
    Invalid(&'static str),
    #[error("розкладка належить іншому профілю")]
    ForeignProfile,
    #[error("розкладку створено новішою версією EasyWAR; цей запис її не змінює")]
    NewerFormat,
    #[error("розкладку дашборда змінено в іншому місці; перечитайте її й повторіть")]
    Stale,
    #[error("розкладка завелика")]
    TooLarge,
}

fn validate_dashboard_id(dashboard_id: &str) -> Result<(), DashboardLayoutError> {
    let valid = !dashboard_id.is_empty()
        && dashboard_id.len() <= MAX_DASHBOARD_ID_LEN
        && dashboard_id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_');
    if valid {
        Ok(())
    } else {
        Err(DashboardLayoutError::InvalidDashboardId)
    }
}

impl DashboardLayoutStore {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn get(
        &self,
        profile_id: &str,
        dashboard_id: &str,
    ) -> Result<DashboardLayoutRecord, DashboardLayoutError> {
        validate_profile_id(profile_id).map_err(|_| DashboardLayoutError::InvalidProfileId)?;
        validate_dashboard_id(dashboard_id)?;
        let row: Option<(String, i64, String)> = sqlx::query_as(
            "SELECT layout_json, revision, updated_at FROM dashboard_layouts
             WHERE profile_id = ? AND dashboard_id = ?",
        )
        .bind(profile_id)
        .bind(dashboard_id)
        .fetch_optional(&self.pool)
        .await?;
        match row {
            None => Ok(DashboardLayoutRecord {
                layout: None,
                revision: 0,
                updated_at: None,
            }),
            Some((json, revision, updated_at)) => Ok(DashboardLayoutRecord {
                layout: Some(serde_json::from_str(&json).map_err(|_| {
                    DashboardLayoutError::Invalid("збережений документ пошкоджено")
                })?),
                revision,
                updated_at: Some(updated_at),
            }),
        }
    }

    /// Записує розкладку профілю; дашборд береться з самого документа. `expected_revision` —
    /// ревізія, яку клієнт прочитав (0, якщо розкладки ще не було); якщо збережена вже інша,
    /// запис відхиляється і нічого не змінює.
    pub async fn save(
        &self,
        profile_id: &str,
        layout: &Value,
        expected_revision: i64,
        now: &str,
    ) -> Result<DashboardLayoutRecord, DashboardLayoutError> {
        validate_profile_id(profile_id).map_err(|_| DashboardLayoutError::InvalidProfileId)?;
        let (dashboard_id, revision) = validate_envelope(layout, profile_id)?;
        if expected_revision < 0 || revision <= expected_revision {
            return Err(DashboardLayoutError::Stale);
        }
        let format_version = layout["version"].as_i64().unwrap_or(1);
        let json = serde_json::to_string(layout)
            .map_err(|_| DashboardLayoutError::Invalid("документ не вдалося записати"))?;
        if json.len() > MAX_LAYOUT_BYTES {
            return Err(DashboardLayoutError::TooLarge);
        }
        let exists: Option<i64> = sqlx::query_scalar("SELECT 1 FROM local_profiles WHERE id = ?")
            .bind(profile_id)
            .fetch_optional(&self.pool)
            .await?;
        if exists.is_none() {
            return Err(DashboardLayoutError::ProfileNotFound);
        }
        let changed = if expected_revision == 0 {
            sqlx::query(
                "INSERT INTO dashboard_layouts
                    (profile_id, dashboard_id, format_version, revision, layout_json, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON CONFLICT(profile_id, dashboard_id) DO NOTHING",
            )
            .bind(profile_id)
            .bind(&dashboard_id)
            .bind(format_version)
            .bind(revision)
            .bind(&json)
            .bind(now)
            .execute(&self.pool)
            .await?
            .rows_affected()
        } else {
            sqlx::query(
                "UPDATE dashboard_layouts
                 SET format_version = ?, revision = ?, layout_json = ?, updated_at = ?
                 WHERE profile_id = ? AND dashboard_id = ? AND revision = ? AND format_version <= ?",
            )
            .bind(format_version)
            .bind(revision)
            .bind(&json)
            .bind(now)
            .bind(profile_id)
            .bind(&dashboard_id)
            .bind(expected_revision)
            .bind(SUPPORTED_FORMAT_VERSION)
            .execute(&self.pool)
            .await?
            .rows_affected()
        };
        if changed == 0 {
            let stored: Option<i64> = sqlx::query_scalar(
                "SELECT format_version FROM dashboard_layouts
                 WHERE profile_id = ? AND dashboard_id = ?",
            )
            .bind(profile_id)
            .bind(&dashboard_id)
            .fetch_optional(&self.pool)
            .await?;
            return Err(match stored {
                Some(version) if version > SUPPORTED_FORMAT_VERSION => {
                    DashboardLayoutError::NewerFormat
                }
                _ => DashboardLayoutError::Stale,
            });
        }
        self.get(profile_id, &dashboard_id).await
    }

    /// Стирає розкладку дашборда (картки й їхні налаштування). Таблиці модулів, їхні дані і
    /// схему профілю не чіпає. Без збереженої розкладки нічого не робить; зі застарілою
    /// ревізією відхиляє.
    pub async fn reset(
        &self,
        profile_id: &str,
        dashboard_id: &str,
        expected_revision: i64,
    ) -> Result<(), DashboardLayoutError> {
        validate_profile_id(profile_id).map_err(|_| DashboardLayoutError::InvalidProfileId)?;
        validate_dashboard_id(dashboard_id)?;
        let stored: Option<(i64, i64)> = sqlx::query_as(
            "SELECT revision, format_version FROM dashboard_layouts
             WHERE profile_id = ? AND dashboard_id = ?",
        )
        .bind(profile_id)
        .bind(dashboard_id)
        .fetch_optional(&self.pool)
        .await?;
        let Some((revision, format_version)) = stored else {
            return Ok(());
        };
        if format_version > SUPPORTED_FORMAT_VERSION {
            return Err(DashboardLayoutError::NewerFormat);
        }
        if revision != expected_revision {
            return Err(DashboardLayoutError::Stale);
        }
        let removed = sqlx::query(
            "DELETE FROM dashboard_layouts
             WHERE profile_id = ? AND dashboard_id = ? AND revision = ?",
        )
        .bind(profile_id)
        .bind(dashboard_id)
        .bind(expected_revision)
        .execute(&self.pool)
        .await?
        .rows_affected();
        if removed == 0 {
            return Err(DashboardLayoutError::Stale);
        }
        Ok(())
    }
}

/// Перевіряє конверт документа й повертає ідентифікатор дашборда та ревізію.
fn validate_envelope(
    layout: &Value,
    profile_id: &str,
) -> Result<(String, i64), DashboardLayoutError> {
    let object = layout
        .as_object()
        .ok_or(DashboardLayoutError::Invalid("очікується об'єкт"))?;
    if object.get("format").and_then(Value::as_str) != Some(LAYOUT_FORMAT) {
        return Err(DashboardLayoutError::Invalid("невідомий формат"));
    }
    let version = object
        .get("version")
        .and_then(Value::as_i64)
        .filter(|version| *version >= 1)
        .ok_or(DashboardLayoutError::Invalid("некоректна версія формату"))?;
    if version > SUPPORTED_FORMAT_VERSION {
        return Err(DashboardLayoutError::NewerFormat);
    }
    if object.get("profileId").and_then(Value::as_str) != Some(profile_id) {
        return Err(DashboardLayoutError::ForeignProfile);
    }
    let dashboard_id =
        object
            .get("dashboardId")
            .and_then(Value::as_str)
            .ok_or(DashboardLayoutError::Invalid(
                "немає ідентифікатора дашборда",
            ))?;
    validate_dashboard_id(dashboard_id)?;
    let revision = object
        .get("revision")
        .and_then(Value::as_i64)
        .filter(|revision| *revision >= 1)
        .ok_or(DashboardLayoutError::Invalid("некоректна ревізія"))?;
    let instances = object
        .get("instances")
        .and_then(Value::as_array)
        .ok_or(DashboardLayoutError::Invalid("очікується перелік карток"))?;
    let placements =
        object
            .get("placements")
            .and_then(Value::as_array)
            .ok_or(DashboardLayoutError::Invalid(
                "очікується перелік розміщень",
            ))?;
    if instances.len() > MAX_INSTANCES || placements.len() > MAX_INSTANCES {
        return Err(DashboardLayoutError::TooLarge);
    }
    Ok((dashboard_id.to_string(), revision))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::{DASHBOARD_LAYOUTS_SQL, LOCAL_PROFILES_SQL};
    use serde_json::json;
    use sqlx::sqlite::SqlitePoolOptions;

    const PROFILE: &str = "profile-111111111111111111111111";
    const OTHER: &str = "profile-222222222222222222222222";
    const MY: &str = "my";
    const T1: &str = "2026-10-29T10:00:00Z";
    const T2: &str = "2026-10-29T11:00:00Z";

    async fn store() -> DashboardLayoutStore {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        for sql in [LOCAL_PROFILES_SQL, DASHBOARD_LAYOUTS_SQL] {
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
        DashboardLayoutStore::new(pool)
    }

    fn layout(profile: &str, revision: i64) -> Value {
        json!({
            "format": LAYOUT_FORMAT,
            "version": 1,
            "profileId": profile,
            "dashboardId": MY,
            "revision": revision,
            "sharedPeriod": { "mode": "all" },
            "instances": [{
                "id": "by-day#1", "definitionId": "by-day", "sourceId": "module:module-1",
                "title": "Пуски", "period": { "mode": "shared" },
                "style": { "accent": "", "background": "", "view": "" }
            }],
            "placements": [{ "instanceId": "by-day#1", "x": 0, "y": 0, "w": 4, "h": 3 }]
        })
    }

    #[tokio::test]
    async fn a_profile_without_a_layout_reads_as_empty() {
        let store = store().await;
        assert_eq!(
            store.get(PROFILE, MY).await.unwrap(),
            DashboardLayoutRecord {
                layout: None,
                revision: 0,
                updated_at: None
            }
        );
    }

    #[tokio::test]
    async fn a_saved_layout_is_read_back_unchanged_with_its_revision() {
        let store = store().await;
        let saved = store
            .save(PROFILE, &layout(PROFILE, 1), 0, T1)
            .await
            .unwrap();
        assert_eq!(saved.revision, 1);
        assert_eq!(saved.updated_at.as_deref(), Some(T1));
        assert_eq!(saved.layout, Some(layout(PROFILE, 1)));
        let updated = store
            .save(PROFILE, &layout(PROFILE, 2), 1, T2)
            .await
            .unwrap();
        assert_eq!(updated.revision, 2);
        assert_eq!(store.get(PROFILE, MY).await.unwrap(), updated);
    }

    #[tokio::test]
    async fn a_stale_revision_changes_nothing() {
        let store = store().await;
        store
            .save(PROFILE, &layout(PROFILE, 1), 0, T1)
            .await
            .unwrap();
        store
            .save(PROFILE, &layout(PROFILE, 2), 1, T2)
            .await
            .unwrap();
        // друге вікно ще бачить ревізію 1
        let stale = store.save(PROFILE, &layout(PROFILE, 2), 1, T2).await;
        assert!(matches!(stale, Err(DashboardLayoutError::Stale)));
        // і ревізію 0, коли розкладка вже є
        let first = store.save(PROFILE, &layout(PROFILE, 1), 0, T2).await;
        assert!(matches!(first, Err(DashboardLayoutError::Stale)));
        assert_eq!(store.get(PROFILE, MY).await.unwrap().revision, 2);
    }

    #[test]
    fn the_stale_message_keeps_the_mark_the_client_looks_for() {
        // Клієнт розпізнає застарілий запис за цим фрагментом (як у схемі профілю).
        assert!(DashboardLayoutError::Stale
            .to_string()
            .contains("змінено в іншому місці"));
    }

    #[tokio::test]
    async fn the_new_revision_must_move_forward() {
        let store = store().await;
        store
            .save(PROFILE, &layout(PROFILE, 1), 0, T1)
            .await
            .unwrap();
        let same = store.save(PROFILE, &layout(PROFILE, 1), 1, T2).await;
        assert!(matches!(same, Err(DashboardLayoutError::Stale)));
    }

    #[tokio::test]
    async fn profiles_cannot_read_or_overwrite_each_other() {
        let store = store().await;
        store
            .save(PROFILE, &layout(PROFILE, 1), 0, T1)
            .await
            .unwrap();
        assert_eq!(store.get(OTHER, MY).await.unwrap().layout, None);
        let foreign = store.save(OTHER, &layout(PROFILE, 1), 0, T1).await;
        assert!(matches!(foreign, Err(DashboardLayoutError::ForeignProfile)));
        assert_eq!(store.get(OTHER, MY).await.unwrap().revision, 0);
        assert_eq!(
            store.get(PROFILE, MY).await.unwrap().layout,
            Some(layout(PROFILE, 1))
        );
    }

    #[tokio::test]
    async fn dashboards_of_one_profile_are_stored_separately() {
        let store = store().await;
        let mut second = layout(PROFILE, 1);
        second["dashboardId"] = json!("brigade-2");
        second["instances"] = json!([]);
        second["placements"] = json!([]);
        store
            .save(PROFILE, &layout(PROFILE, 1), 0, T1)
            .await
            .unwrap();
        store.save(PROFILE, &second, 0, T1).await.unwrap();
        assert_eq!(
            store.get(PROFILE, "brigade-2").await.unwrap().layout,
            Some(second)
        );
        assert_eq!(
            store.get(PROFILE, MY).await.unwrap().layout,
            Some(layout(PROFILE, 1))
        );
    }

    #[tokio::test]
    async fn an_envelope_with_wrong_shape_is_refused() {
        let store = store().await;
        let mut other_format = layout(PROFILE, 1);
        other_format["format"] = json!("other");
        let mut no_instances = layout(PROFILE, 1);
        no_instances["instances"] = json!({});
        let mut zero_revision = layout(PROFILE, 1);
        zero_revision["revision"] = json!(0);
        let mut no_dashboard = layout(PROFILE, 1);
        no_dashboard["dashboardId"] = json!(null);
        for bad in [
            json!([]),
            json!("text"),
            other_format,
            no_instances,
            zero_revision,
            no_dashboard,
        ] {
            let result = store.save(PROFILE, &bad, 0, T1).await;
            assert!(
                matches!(result, Err(DashboardLayoutError::Invalid(_))),
                "{bad}"
            );
        }
        let mut weird_id = layout(PROFILE, 1);
        weird_id["dashboardId"] = json!("../My Dash");
        assert!(matches!(
            store.save(PROFILE, &weird_id, 0, T1).await,
            Err(DashboardLayoutError::InvalidDashboardId)
        ));
        assert_eq!(store.get(PROFILE, MY).await.unwrap().layout, None);
    }

    #[tokio::test]
    async fn a_newer_format_is_neither_written_nor_overwritten() {
        let store = store().await;
        let mut newer = layout(PROFILE, 1);
        newer["version"] = json!(2);
        assert!(matches!(
            store.save(PROFILE, &newer, 0, T1).await,
            Err(DashboardLayoutError::NewerFormat)
        ));
        sqlx::query(
            "INSERT INTO dashboard_layouts
                (profile_id, dashboard_id, format_version, revision, layout_json, updated_at)
             VALUES (?, ?, 2, 1, ?, ?)",
        )
        .bind(PROFILE)
        .bind(MY)
        .bind(newer.to_string())
        .bind(T1)
        .execute(&store.pool)
        .await
        .unwrap();
        assert!(matches!(
            store.save(PROFILE, &layout(PROFILE, 2), 1, T2).await,
            Err(DashboardLayoutError::NewerFormat)
        ));
        assert!(matches!(
            store.reset(PROFILE, MY, 1).await,
            Err(DashboardLayoutError::NewerFormat)
        ));
        assert_eq!(store.get(PROFILE, MY).await.unwrap().layout, Some(newer));
    }

    #[tokio::test]
    async fn limits_are_enforced() {
        let store = store().await;
        let mut many = layout(PROFILE, 1);
        many["instances"] = json!(vec![many["instances"][0].clone(); MAX_INSTANCES + 1]);
        assert!(matches!(
            store.save(PROFILE, &many, 0, T1).await,
            Err(DashboardLayoutError::TooLarge)
        ));
        let mut huge = layout(PROFILE, 1);
        huge["instances"][0]["title"] = json!("я".repeat(MAX_LAYOUT_BYTES));
        assert!(matches!(
            store.save(PROFILE, &huge, 0, T1).await,
            Err(DashboardLayoutError::TooLarge)
        ));
    }

    #[tokio::test]
    async fn an_unknown_profile_gets_no_layout() {
        let store = store().await;
        let ghost = "profile-333333333333333333333333";
        assert!(matches!(
            store.save(ghost, &layout(ghost, 1), 0, T1).await,
            Err(DashboardLayoutError::ProfileNotFound)
        ));
        assert!(matches!(
            store.get("not-a-profile", MY).await,
            Err(DashboardLayoutError::InvalidProfileId)
        ));
        assert!(matches!(
            store.get(PROFILE, "").await,
            Err(DashboardLayoutError::InvalidDashboardId)
        ));
    }

    #[tokio::test]
    async fn reset_removes_only_the_own_layout_and_checks_the_revision() {
        let store = store().await;
        store
            .save(PROFILE, &layout(PROFILE, 1), 0, T1)
            .await
            .unwrap();
        store.save(OTHER, &layout(OTHER, 1), 0, T1).await.unwrap();
        assert!(matches!(
            store.reset(PROFILE, MY, 5).await,
            Err(DashboardLayoutError::Stale)
        ));
        store.reset(PROFILE, MY, 1).await.unwrap();
        assert_eq!(store.get(PROFILE, MY).await.unwrap().layout, None);
        assert!(store.get(OTHER, MY).await.unwrap().layout.is_some());
        // повторне стирання нічого не змінює
        store.reset(PROFILE, MY, 1).await.unwrap();
    }

    #[tokio::test]
    async fn deleting_a_profile_removes_its_layouts() {
        let store = store().await;
        store
            .save(PROFILE, &layout(PROFILE, 1), 0, T1)
            .await
            .unwrap();
        store.save(OTHER, &layout(OTHER, 1), 0, T1).await.unwrap();
        sqlx::query("DELETE FROM local_profiles WHERE id = ?")
            .bind(PROFILE)
            .execute(&store.pool)
            .await
            .unwrap();
        let rows: i64 = sqlx::query_scalar("SELECT count(*) FROM dashboard_layouts")
            .fetch_one(&store.pool)
            .await
            .unwrap();
        assert_eq!(rows, 1);
        assert!(store.get(OTHER, MY).await.unwrap().layout.is_some());
    }
}
