use crate::local_profiles::validate_profile_id;
use serde::Serialize;
use sqlx::SqlitePool;

pub const DEFAULT_WORKSPACE_TEMPLATE_KEY: &str = "overview";

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTemplate {
    pub key: &'static str,
    pub role_label: &'static str,
    pub title: &'static str,
    pub description: &'static str,
    pub landing_view: &'static str,
    pub dashboard_section: Option<&'static str>,
}

const WORKSPACE_TEMPLATES: [WorkspaceTemplate; 5] = [
    WorkspaceTemplate {
        key: "overview",
        role_label: "Керівник",
        title: "Оперативне зведення",
        description: "Починає роботу із загального зведення дашборда.",
        landing_view: "dash",
        dashboard_section: Some("p-kpis"),
    },
    WorkspaceTemplate {
        key: "analysis",
        role_label: "Аналітик",
        title: "Аналіз ефективності",
        description: "Відкриває дашборд у розділі аналізу ефективності.",
        landing_view: "dash",
        dashboard_section: Some("p-dist"),
    },
    WorkspaceTemplate {
        key: "quality",
        role_label: "Контроль якості даних",
        title: "Перевірка даних",
        description: "Відкриває глобальний перелік зауважень до даних.",
        landing_view: "dash",
        dashboard_section: Some("p-quality"),
    },
    WorkspaceTemplate {
        key: "registry",
        role_label: "Робота з реєстром",
        title: "База даних",
        description: "Починає роботу з локального реєстру записів.",
        landing_view: "base",
        dashboard_section: None,
    },
    WorkspaceTemplate {
        key: "entry",
        role_label: "Оператор внесення",
        title: "Внесення доповідей",
        description: "Починає роботу з форми внесення нових доповідей.",
        landing_view: "entry",
        dashboard_section: None,
    },
];

#[derive(Clone, Debug)]
pub struct WorkspaceTemplateStore {
    pool: SqlitePool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileWorkspaceTemplate {
    pub profile_id: String,
    pub template_key: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTemplatesState {
    pub default_template_key: &'static str,
    pub templates: Vec<WorkspaceTemplate>,
    pub assignments: Vec<ProfileWorkspaceTemplate>,
}

#[derive(Debug, thiserror::Error)]
pub enum WorkspaceTemplateError {
    #[error("не вдалося прочитати або зберегти шаблон робочого простору")]
    Storage(#[from] sqlx::Error),
    #[error("некоректний локальний ідентифікатор профілю")]
    InvalidProfileId,
    #[error("локальний профіль не знайдено")]
    ProfileNotFound,
    #[error("невідомий шаблон робочого простору")]
    UnknownTemplate,
}

impl WorkspaceTemplateStore {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn list(&self) -> Result<WorkspaceTemplatesState, WorkspaceTemplateError> {
        let assignments = sqlx::query_as::<_, (String, String, String)>(
            "SELECT profile_id, template_key, updated_at
             FROM local_profile_workspace_templates
             ORDER BY profile_id",
        )
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(
            |(profile_id, template_key, updated_at)| ProfileWorkspaceTemplate {
                profile_id,
                template_key,
                updated_at,
            },
        )
        .collect();

        Ok(WorkspaceTemplatesState {
            default_template_key: DEFAULT_WORKSPACE_TEMPLATE_KEY,
            templates: WORKSPACE_TEMPLATES.to_vec(),
            assignments,
        })
    }

    pub async fn assign(
        &self,
        profile_id: &str,
        template_key: &str,
        now: &str,
    ) -> Result<WorkspaceTemplatesState, WorkspaceTemplateError> {
        validate_profile_id(profile_id).map_err(|_| WorkspaceTemplateError::InvalidProfileId)?;
        if workspace_template(template_key).is_none() {
            return Err(WorkspaceTemplateError::UnknownTemplate);
        }

        let mut transaction = self.pool.begin().await?;
        let profile_count: i64 =
            sqlx::query_scalar("SELECT count(*) FROM local_profiles WHERE id = ?")
                .bind(profile_id)
                .fetch_one(&mut *transaction)
                .await?;
        if profile_count != 1 {
            return Err(WorkspaceTemplateError::ProfileNotFound);
        }

        sqlx::query(
            "INSERT INTO local_profile_workspace_templates
             (profile_id, template_key, updated_at)
             VALUES (?, ?, ?)
             ON CONFLICT(profile_id) DO UPDATE SET
                 template_key = excluded.template_key,
                 updated_at = excluded.updated_at",
        )
        .bind(profile_id)
        .bind(template_key)
        .bind(now)
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        self.list().await
    }
}

pub fn workspace_template(key: &str) -> Option<WorkspaceTemplate> {
    WORKSPACE_TEMPLATES
        .iter()
        .copied()
        .find(|template| template.key == key)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        database::{
            COMMAND_TABLES_SQL, DASHBOARD_MODULES_SQL, INITIAL_SCHEMA_SQL, LOCAL_PROFILES_SQL,
            PROFILE_BRANCH_TABLES_SQL, PROFILE_DETAILS_SQL, PROFILE_MODULES_SQL,
            WORKSPACE_TEMPLATES_SQL, XLSX_DUPLICATE_LINKS_SQL,
        },
        local_profiles::{generate_profile_id, LocalProfileStore},
    };
    use sqlx::sqlite::SqlitePoolOptions;
    use std::collections::BTreeSet;

    const NOW_1: &str = "2026-01-01T00:00:00Z";
    const NOW_2: &str = "2026-01-02T00:00:00Z";

    async fn stores() -> (LocalProfileStore, WorkspaceTemplateStore) {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        for migration in [
            INITIAL_SCHEMA_SQL,
            XLSX_DUPLICATE_LINKS_SQL,
            LOCAL_PROFILES_SQL,
            WORKSPACE_TEMPLATES_SQL,
            PROFILE_DETAILS_SQL,
            PROFILE_BRANCH_TABLES_SQL,
            COMMAND_TABLES_SQL,
            PROFILE_MODULES_SQL,
            DASHBOARD_MODULES_SQL,
        ] {
            sqlx::raw_sql(migration).execute(&pool).await.unwrap();
        }
        (
            LocalProfileStore::new(pool.clone()),
            WorkspaceTemplateStore::new(pool),
        )
    }

    fn profile_id(seed: &str) -> String {
        generate_profile_id(seed, NOW_1)
    }

    #[test]
    fn built_in_templates_are_unique_and_reference_existing_views() {
        let keys = WORKSPACE_TEMPLATES
            .iter()
            .map(|template| template.key)
            .collect::<BTreeSet<_>>();
        assert_eq!(keys.len(), WORKSPACE_TEMPLATES.len());
        assert!(keys.contains(DEFAULT_WORKSPACE_TEMPLATE_KEY));
        for template in WORKSPACE_TEMPLATES {
            assert!(matches!(template.landing_view, "dash" | "base" | "entry"));
            assert_eq!(
                template.dashboard_section.is_some(),
                template.landing_view == "dash"
            );
            assert!(!template.role_label.is_empty());
            assert!(!template.title.is_empty());
            assert!(!template.description.is_empty());
        }
    }

    #[tokio::test]
    async fn assignment_is_local_explicit_and_replaceable() {
        let (profiles, templates) = stores().await;
        let id = profile_id("one");
        profiles.create(&id, "Синтетичний", NOW_1).await.unwrap();
        assert!(templates.list().await.unwrap().assignments.is_empty());

        let state = templates.assign(&id, "analysis", NOW_1).await.unwrap();
        assert_eq!(state.default_template_key, "overview");
        assert_eq!(state.assignments.len(), 1);
        assert_eq!(state.assignments[0].profile_id, id);
        assert_eq!(state.assignments[0].template_key, "analysis");

        let state = templates.assign(&id, "entry", NOW_2).await.unwrap();
        assert_eq!(state.assignments.len(), 1);
        assert_eq!(state.assignments[0].template_key, "entry");
        assert_eq!(state.assignments[0].updated_at, NOW_2);

        let audit_count: i64 = sqlx::query_scalar("SELECT count(*) FROM audit_log")
            .fetch_one(&templates.pool)
            .await
            .unwrap();
        assert_eq!(audit_count, 0);
    }

    #[tokio::test]
    async fn invalid_assignments_fail_without_writes() {
        let (profiles, templates) = stores().await;
        let id = profile_id("one");
        profiles.create(&id, "Синтетичний", NOW_1).await.unwrap();
        assert!(matches!(
            templates.assign("not-a-profile", "overview", NOW_1).await,
            Err(WorkspaceTemplateError::InvalidProfileId)
        ));
        assert!(matches!(
            templates.assign(&id, "unknown", NOW_1).await,
            Err(WorkspaceTemplateError::UnknownTemplate)
        ));
        assert!(matches!(
            templates
                .assign(&profile_id("missing"), "overview", NOW_1)
                .await,
            Err(WorkspaceTemplateError::ProfileNotFound)
        ));
        assert!(templates.list().await.unwrap().assignments.is_empty());
    }

    #[tokio::test]
    async fn deleting_a_profile_removes_only_its_template_assignment() {
        let (profiles, templates) = stores().await;
        let first = profile_id("first");
        let second = profile_id("second");
        profiles.create(&first, "Перший", NOW_1).await.unwrap();
        profiles.create(&second, "Другий", NOW_1).await.unwrap();
        templates.assign(&first, "quality", NOW_1).await.unwrap();
        templates.assign(&second, "registry", NOW_1).await.unwrap();

        profiles.delete(&first, NOW_2).await.unwrap();
        let state = templates.list().await.unwrap();
        assert_eq!(state.assignments.len(), 1);
        assert_eq!(state.assignments[0].profile_id, second);
        assert_eq!(state.assignments[0].template_key, "registry");
    }
}
