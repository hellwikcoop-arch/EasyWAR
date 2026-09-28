use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{Sqlite, SqlitePool, Transaction};

pub const MAX_LOCAL_PROFILES: i64 = 32;
const MAX_PROFILE_NAME_CHARS: usize = 80;
const MAX_POSITION_CHARS: usize = 120;
const MAX_AVATAR_BYTES: usize = 400_000;
const MIN_PASSWORD_CHARS: usize = 4;
const MAX_PASSWORD_CHARS: usize = 128;

#[derive(Clone, Debug)]
pub struct LocalProfileStore {
    pool: SqlitePool,
}

/// Рід військ, для якого профіль тримає окрему таблицю. Кожна відкривається у
/// своєму модулі й записується у свій файл.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Branch {
    Air,
    Rocket,
}

impl Branch {
    pub fn as_str(self) -> &'static str {
        match self {
            Branch::Air => "air",
            Branch::Rocket => "rocket",
        }
    }

    /// Назва в родовому відмінку: «таблиця Повітряних Сил».
    pub fn genitive(self) -> &'static str {
        match self {
            Branch::Air => "Повітряних Сил",
            Branch::Rocket => "Ракетних військ і артилерії",
        }
    }

    pub fn parse(value: &str) -> Result<Self, LocalProfileError> {
        match value {
            "air" => Ok(Branch::Air),
            "rocket" => Ok(Branch::Rocket),
            _ => Err(LocalProfileError::InvalidBranch),
        }
    }
}

/// Шляхи таблиць профілю за родами військ.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
pub struct ProfileTables {
    pub air: Option<String>,
    pub rocket: Option<String>,
}

impl ProfileTables {
    fn slot(&mut self, branch: Branch) -> &mut Option<String> {
        match branch {
            Branch::Air => &mut self.air,
            Branch::Rocket => &mut self.rocket,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalProfile {
    pub id: String,
    pub display_name: String,
    pub position: String,
    pub avatar_data_url: Option<String>,
    pub has_password: bool,
    pub tables: ProfileTables,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalProfilesState {
    pub active_profile_id: Option<String>,
    pub profiles: Vec<LocalProfile>,
}

#[derive(Debug, thiserror::Error)]
pub enum LocalProfileError {
    #[error("не вдалося прочитати або зберегти локальні профілі")]
    Storage(#[from] sqlx::Error),
    #[error("назва профілю має містити від 1 до 80 символів")]
    InvalidDisplayName,
    #[error("локальний профіль із такою назвою вже існує")]
    DuplicateDisplayName,
    #[error("досягнуто локального ліміту у 32 профілі")]
    ProfileLimitReached,
    #[error("локальний профіль не знайдено")]
    ProfileNotFound,
    #[error("некоректний локальний ідентифікатор профілю")]
    InvalidProfileId,
    #[error("посада має містити не більше 120 символів")]
    InvalidPosition,
    #[error("фото профілю має бути зображенням до 400 КБ")]
    InvalidAvatar,
    #[error("пароль має містити від 4 до 128 символів")]
    InvalidPassword,
    #[error("неправильний пароль профілю")]
    WrongPassword,
    #[error("не вдалося обробити пароль профілю")]
    PasswordHash,
    #[error("невідомий рід військ для таблиці профілю")]
    InvalidBranch,
    #[error("шлях до таблиці має містити від 1 до 4096 символів")]
    InvalidTablePath,
}

impl LocalProfileStore {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn list(&self) -> Result<LocalProfilesState, LocalProfileError> {
        load_state(&self.pool).await
    }

    pub async fn create(
        &self,
        id: &str,
        display_name: &str,
        now: &str,
    ) -> Result<LocalProfilesState, LocalProfileError> {
        validate_profile_id(id)?;
        let (display_name, name_key) = normalize_display_name(display_name)?;
        let mut transaction = self.pool.begin().await?;
        ensure_unique_name(&mut transaction, &name_key, None).await?;
        let count: i64 = sqlx::query_scalar("SELECT count(*) FROM local_profiles")
            .fetch_one(&mut *transaction)
            .await?;
        if count >= MAX_LOCAL_PROFILES {
            return Err(LocalProfileError::ProfileLimitReached);
        }

        sqlx::query(
            "INSERT INTO local_profiles
             (id, display_name, name_key, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(id)
        .bind(&display_name)
        .bind(&name_key)
        .bind(now)
        .bind(now)
        .execute(&mut *transaction)
        .await?;
        sqlx::query(
            "UPDATE local_profile_state
             SET active_profile_id = ?, updated_at = ?
             WHERE singleton = 1 AND active_profile_id IS NULL",
        )
        .bind(id)
        .bind(now)
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        self.list().await
    }

    pub async fn rename(
        &self,
        id: &str,
        display_name: &str,
        now: &str,
    ) -> Result<LocalProfilesState, LocalProfileError> {
        validate_profile_id(id)?;
        let (display_name, name_key) = normalize_display_name(display_name)?;
        let mut transaction = self.pool.begin().await?;
        ensure_profile_exists(&mut transaction, id).await?;
        ensure_unique_name(&mut transaction, &name_key, Some(id)).await?;
        sqlx::query(
            "UPDATE local_profiles
             SET display_name = ?, name_key = ?, updated_at = ?
             WHERE id = ?",
        )
        .bind(&display_name)
        .bind(&name_key)
        .bind(now)
        .bind(id)
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        self.list().await
    }

    pub async fn activate(
        &self,
        id: &str,
        now: &str,
    ) -> Result<LocalProfilesState, LocalProfileError> {
        validate_profile_id(id)?;
        let mut transaction = self.pool.begin().await?;
        ensure_profile_exists(&mut transaction, id).await?;
        sqlx::query(
            "UPDATE local_profile_state
             SET active_profile_id = ?, updated_at = ?
             WHERE singleton = 1",
        )
        .bind(id)
        .bind(now)
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        self.list().await
    }

    pub async fn delete(
        &self,
        id: &str,
        now: &str,
    ) -> Result<LocalProfilesState, LocalProfileError> {
        validate_profile_id(id)?;
        let mut transaction = self.pool.begin().await?;
        ensure_profile_exists(&mut transaction, id).await?;
        let active_profile_id: Option<String> = sqlx::query_scalar(
            "SELECT active_profile_id FROM local_profile_state WHERE singleton = 1",
        )
        .fetch_one(&mut *transaction)
        .await?;
        sqlx::query("DELETE FROM local_profiles WHERE id = ?")
            .bind(id)
            .execute(&mut *transaction)
            .await?;
        if active_profile_id.as_deref() == Some(id) {
            let replacement: Option<String> =
                sqlx::query_scalar("SELECT id FROM local_profiles ORDER BY name_key, id LIMIT 1")
                    .fetch_optional(&mut *transaction)
                    .await?;
            sqlx::query(
                "UPDATE local_profile_state
                 SET active_profile_id = ?, updated_at = ?
                 WHERE singleton = 1",
            )
            .bind(replacement)
            .bind(now)
            .execute(&mut *transaction)
            .await?;
        }
        transaction.commit().await?;
        self.list().await
    }

    pub async fn update_details(
        &self,
        id: &str,
        position: &str,
        avatar_data_url: Option<&str>,
        now: &str,
    ) -> Result<LocalProfilesState, LocalProfileError> {
        validate_profile_id(id)?;
        let position = position.split_whitespace().collect::<Vec<_>>().join(" ");
        if position.chars().count() > MAX_POSITION_CHARS {
            return Err(LocalProfileError::InvalidPosition);
        }
        if let Some(avatar) = avatar_data_url {
            validate_avatar(avatar)?;
        }
        let mut transaction = self.pool.begin().await?;
        ensure_profile_exists(&mut transaction, id).await?;
        ensure_details_row(&mut transaction, id, now).await?;
        sqlx::query(
            "UPDATE local_profile_details
             SET position = ?, avatar_data_url = ?, updated_at = ?
             WHERE profile_id = ?",
        )
        .bind(&position)
        .bind(avatar_data_url)
        .bind(now)
        .bind(id)
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        self.list().await
    }

    /// Встановлює, змінює (`new_password = Some`) або знімає (`None`) пароль.
    /// Якщо пароль уже є, потрібен чинний пароль.
    pub async fn set_password(
        &self,
        id: &str,
        current_password: Option<&str>,
        new_password: Option<&str>,
        now: &str,
    ) -> Result<LocalProfilesState, LocalProfileError> {
        validate_profile_id(id)?;
        if !self
            .verify_password(id, current_password.unwrap_or(""))
            .await?
        {
            return Err(LocalProfileError::WrongPassword);
        }
        let hash = match new_password {
            Some(password) => Some(hash_password(password)?),
            None => None,
        };
        let mut transaction = self.pool.begin().await?;
        ensure_profile_exists(&mut transaction, id).await?;
        ensure_details_row(&mut transaction, id, now).await?;
        sqlx::query(
            "UPDATE local_profile_details SET password_hash = ?, updated_at = ? WHERE profile_id = ?",
        )
        .bind(hash)
        .bind(now)
        .bind(id)
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        self.list().await
    }

    /// `true`, якщо профіль без пароля або пароль правильний.
    pub async fn verify_password(
        &self,
        id: &str,
        password: &str,
    ) -> Result<bool, LocalProfileError> {
        validate_profile_id(id)?;
        match self.password_hash(id).await? {
            None => Ok(true),
            Some(stored) => {
                let parsed =
                    PasswordHash::new(&stored).map_err(|_| LocalProfileError::PasswordHash)?;
                Ok(Argon2::default()
                    .verify_password(password.as_bytes(), &parsed)
                    .is_ok())
            }
        }
    }

    pub async fn has_password(&self, id: &str) -> Result<bool, LocalProfileError> {
        Ok(self.password_hash(id).await?.is_some())
    }

    async fn password_hash(&self, id: &str) -> Result<Option<String>, LocalProfileError> {
        let exists: i64 = sqlx::query_scalar("SELECT count(*) FROM local_profiles WHERE id = ?")
            .bind(id)
            .fetch_one(&self.pool)
            .await?;
        if exists != 1 {
            return Err(LocalProfileError::ProfileNotFound);
        }
        let hash: Option<Option<String>> = sqlx::query_scalar(
            "SELECT password_hash FROM local_profile_details WHERE profile_id = ?",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(hash.flatten())
    }

    /// Прив'язує (`Some`) або відв'язує (`None`) таблицю роду військ.
    pub async fn set_table_path(
        &self,
        id: &str,
        branch: Branch,
        path: Option<&str>,
        now: &str,
    ) -> Result<LocalProfilesState, LocalProfileError> {
        validate_profile_id(id)?;
        if path.is_some_and(|path| path.is_empty() || path.chars().count() > 4096) {
            return Err(LocalProfileError::InvalidTablePath);
        }
        let mut transaction = self.pool.begin().await?;
        ensure_profile_exists(&mut transaction, id).await?;
        match path {
            Some(path) => {
                sqlx::query(
                    "INSERT INTO local_profile_tables (profile_id, branch, path, updated_at)
                     VALUES (?, ?, ?, ?)
                     ON CONFLICT (profile_id, branch)
                     DO UPDATE SET path = excluded.path, updated_at = excluded.updated_at",
                )
                .bind(id)
                .bind(branch.as_str())
                .bind(path)
                .bind(now)
                .execute(&mut *transaction)
                .await?;
            }
            None => {
                sqlx::query("DELETE FROM local_profile_tables WHERE profile_id = ? AND branch = ?")
                    .bind(id)
                    .bind(branch.as_str())
                    .execute(&mut *transaction)
                    .await?;
            }
        }
        transaction.commit().await?;
        self.list().await
    }

    pub async fn table_path(
        &self,
        id: &str,
        branch: Branch,
    ) -> Result<Option<String>, LocalProfileError> {
        validate_profile_id(id)?;
        Ok(sqlx::query_scalar(
            "SELECT path FROM local_profile_tables WHERE profile_id = ? AND branch = ?",
        )
        .bind(id)
        .bind(branch.as_str())
        .fetch_optional(&self.pool)
        .await?)
    }
}

fn hash_password(password: &str) -> Result<String, LocalProfileError> {
    let count = password.chars().count();
    if !(MIN_PASSWORD_CHARS..=MAX_PASSWORD_CHARS).contains(&count) {
        return Err(LocalProfileError::InvalidPassword);
    }
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|_| LocalProfileError::PasswordHash)
}

fn validate_avatar(avatar: &str) -> Result<(), LocalProfileError> {
    let allowed = [
        "data:image/jpeg;base64,",
        "data:image/png;base64,",
        "data:image/webp;base64,",
    ];
    if avatar.len() > MAX_AVATAR_BYTES || !allowed.iter().any(|prefix| avatar.starts_with(prefix)) {
        return Err(LocalProfileError::InvalidAvatar);
    }
    Ok(())
}

async fn ensure_details_row(
    transaction: &mut Transaction<'_, Sqlite>,
    id: &str,
    now: &str,
) -> Result<(), LocalProfileError> {
    sqlx::query(
        "INSERT OR IGNORE INTO local_profile_details (profile_id, updated_at) VALUES (?, ?)",
    )
    .bind(id)
    .bind(now)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

pub fn generate_profile_id(display_name: &str, created_at: &str) -> String {
    let digest = format!(
        "{:x}",
        Sha256::digest(
            format!("easywar-local-profile-v1\0{created_at}\0{display_name}").as_bytes()
        )
    );
    format!("profile-{}", &digest[..24])
}

type ProfileRow = (
    String,
    String,
    Option<String>,
    Option<String>,
    Option<bool>,
    String,
    String,
);

async fn load_state(pool: &SqlitePool) -> Result<LocalProfilesState, LocalProfileError> {
    let active_profile_id: Option<String> =
        sqlx::query_scalar("SELECT active_profile_id FROM local_profile_state WHERE singleton = 1")
            .fetch_one(pool)
            .await?;
    let rows: Vec<ProfileRow> = sqlx::query_as(
        "SELECT p.id, p.display_name, d.position, d.avatar_data_url,
                d.password_hash IS NOT NULL, p.created_at, p.updated_at
         FROM local_profiles p
         LEFT JOIN local_profile_details d ON d.profile_id = p.id
         ORDER BY p.name_key, p.id",
    )
    .fetch_all(pool)
    .await?;
    let table_rows: Vec<(String, String, String)> =
        sqlx::query_as("SELECT profile_id, branch, path FROM local_profile_tables")
            .fetch_all(pool)
            .await?;
    let mut tables = std::collections::HashMap::<String, ProfileTables>::new();
    for (profile_id, branch, path) in table_rows {
        // The schema only admits known branches.
        if let Ok(branch) = Branch::parse(&branch) {
            *tables.entry(profile_id).or_default().slot(branch) = Some(path);
        }
    }
    let profiles = rows
        .into_iter()
        .map(
            |(
                id,
                display_name,
                position,
                avatar_data_url,
                has_password,
                created_at,
                updated_at,
            )| LocalProfile {
                tables: tables.remove(&id).unwrap_or_default(),
                id,
                display_name,
                position: position.unwrap_or_default(),
                avatar_data_url,
                has_password: has_password.unwrap_or(false),
                created_at,
                updated_at,
            },
        )
        .collect();
    Ok(LocalProfilesState {
        active_profile_id,
        profiles,
    })
}

async fn ensure_profile_exists(
    transaction: &mut Transaction<'_, Sqlite>,
    id: &str,
) -> Result<(), LocalProfileError> {
    let exists: i64 = sqlx::query_scalar("SELECT count(*) FROM local_profiles WHERE id = ?")
        .bind(id)
        .fetch_one(&mut **transaction)
        .await?;
    if exists != 1 {
        return Err(LocalProfileError::ProfileNotFound);
    }
    Ok(())
}

async fn ensure_unique_name(
    transaction: &mut Transaction<'_, Sqlite>,
    name_key: &str,
    except_id: Option<&str>,
) -> Result<(), LocalProfileError> {
    let duplicate: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM local_profiles
         WHERE name_key = ? AND (? IS NULL OR id <> ?)",
    )
    .bind(name_key)
    .bind(except_id)
    .bind(except_id)
    .fetch_one(&mut **transaction)
    .await?;
    if duplicate != 0 {
        return Err(LocalProfileError::DuplicateDisplayName);
    }
    Ok(())
}

fn normalize_display_name(value: &str) -> Result<(String, String), LocalProfileError> {
    let display_name = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if display_name.is_empty() || display_name.chars().count() > MAX_PROFILE_NAME_CHARS {
        return Err(LocalProfileError::InvalidDisplayName);
    }
    let name_key = display_name.to_lowercase();
    Ok((display_name, name_key))
}

pub(crate) fn validate_profile_id(id: &str) -> Result<(), LocalProfileError> {
    let suffix = id
        .strip_prefix("profile-")
        .filter(|suffix| suffix.len() == 24)
        .filter(|suffix| {
            suffix
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        });
    if suffix.is_none() {
        return Err(LocalProfileError::InvalidProfileId);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::{
        INITIAL_SCHEMA_SQL, LOCAL_PROFILES_SQL, PROFILE_BRANCH_TABLES_SQL, PROFILE_DETAILS_SQL,
        XLSX_DUPLICATE_LINKS_SQL,
    };
    use sqlx::sqlite::SqlitePoolOptions;

    const NOW_1: &str = "2026-01-01T00:00:00Z";
    const NOW_2: &str = "2026-01-02T00:00:00Z";

    async fn store() -> LocalProfileStore {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::raw_sql(INITIAL_SCHEMA_SQL)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::raw_sql(XLSX_DUPLICATE_LINKS_SQL)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::raw_sql(LOCAL_PROFILES_SQL)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::raw_sql(PROFILE_DETAILS_SQL)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::raw_sql(PROFILE_BRANCH_TABLES_SQL)
            .execute(&pool)
            .await
            .unwrap();
        LocalProfileStore::new(pool)
    }

    fn id(seed: &str) -> String {
        generate_profile_id(seed, NOW_1)
    }

    #[tokio::test]
    async fn first_profile_becomes_active_and_names_are_normalized() {
        let store = store().await;
        assert_eq!(
            store.list().await.unwrap(),
            LocalProfilesState {
                active_profile_id: None,
                profiles: Vec::new(),
            }
        );

        let profile_id = id("first");
        let state = store
            .create(&profile_id, "  Навчальний   профіль  ", NOW_1)
            .await
            .unwrap();
        assert_eq!(
            state.active_profile_id.as_deref(),
            Some(profile_id.as_str())
        );
        assert_eq!(state.profiles.len(), 1);
        assert_eq!(state.profiles[0].display_name, "Навчальний профіль");
        assert_eq!(state.profiles[0].created_at, NOW_1);
        assert_eq!(state.profiles[0].updated_at, NOW_1);

        let audit_count: i64 = sqlx::query_scalar("SELECT count(*) FROM audit_log")
            .fetch_one(&store.pool)
            .await
            .unwrap();
        assert_eq!(audit_count, 0);
    }

    #[tokio::test]
    async fn profiles_rename_activate_and_delete_without_changing_identity() {
        let store = store().await;
        let alpha = id("alpha");
        let bravo = id("bravo");
        store.create(&bravo, "Браво", NOW_1).await.unwrap();
        let state = store.create(&alpha, "Альфа", NOW_1).await.unwrap();
        assert_eq!(
            state
                .profiles
                .iter()
                .map(|profile| profile.display_name.as_str())
                .collect::<Vec<_>>(),
            ["Альфа", "Браво"]
        );
        assert_eq!(state.active_profile_id.as_deref(), Some(bravo.as_str()));

        let state = store.rename(&bravo, "Відредагований", NOW_2).await.unwrap();
        let renamed = state
            .profiles
            .iter()
            .find(|profile| profile.id == bravo)
            .unwrap();
        assert_eq!(renamed.display_name, "Відредагований");
        assert_eq!(renamed.created_at, NOW_1);
        assert_eq!(renamed.updated_at, NOW_2);

        let state = store.activate(&alpha, NOW_2).await.unwrap();
        assert_eq!(state.active_profile_id.as_deref(), Some(alpha.as_str()));
        let state = store.delete(&alpha, NOW_2).await.unwrap();
        assert_eq!(state.active_profile_id.as_deref(), Some(bravo.as_str()));
        assert_eq!(state.profiles.len(), 1);
        let state = store.delete(&bravo, NOW_2).await.unwrap();
        assert_eq!(state.active_profile_id, None);
        assert!(state.profiles.is_empty());
    }

    #[tokio::test]
    async fn duplicate_invalid_and_missing_profiles_fail_closed() {
        let store = store().await;
        let profile_id = id("one");
        store.create(&profile_id, "Профіль", NOW_1).await.unwrap();
        assert!(matches!(
            store.create(&id("two"), "  ПРОФІЛЬ ", NOW_1).await,
            Err(LocalProfileError::DuplicateDisplayName)
        ));
        assert!(matches!(
            store.rename(&profile_id, "   ", NOW_2).await,
            Err(LocalProfileError::InvalidDisplayName)
        ));
        assert!(matches!(
            store.activate(&id("missing"), NOW_2).await,
            Err(LocalProfileError::ProfileNotFound)
        ));
        assert!(matches!(
            store.delete("not-a-profile", NOW_2).await,
            Err(LocalProfileError::InvalidProfileId)
        ));
    }

    #[tokio::test]
    async fn profile_limit_is_enforced_without_partial_insert() {
        let store = store().await;
        for index in 0..MAX_LOCAL_PROFILES {
            store
                .create(
                    &id(&format!("profile-{index}")),
                    &format!("Профіль {index:02}"),
                    NOW_1,
                )
                .await
                .unwrap();
        }
        assert!(matches!(
            store.create(&id("overflow"), "Зайвий профіль", NOW_2).await,
            Err(LocalProfileError::ProfileLimitReached)
        ));
        assert_eq!(store.list().await.unwrap().profiles.len(), 32);
    }

    #[test]
    fn generated_profile_ids_are_stable_and_bounded() {
        let generated = generate_profile_id("Синтетичний", NOW_1);
        assert_eq!(generated.len(), 32);
        assert!(generated.starts_with("profile-"));
        assert_eq!(generated, generate_profile_id("Синтетичний", NOW_1));
        assert_ne!(generated, generate_profile_id("Інший", NOW_1));
        validate_profile_id(&generated).unwrap();
    }

    #[tokio::test]
    async fn password_protects_profile_and_can_be_changed_or_removed() {
        let store = store().await;
        let profile = id("Пароль");
        store.create(&profile, "Пароль", NOW_1).await.unwrap();
        assert!(store.verify_password(&profile, "").await.unwrap());

        assert!(matches!(
            store.set_password(&profile, None, Some("123"), NOW_2).await,
            Err(LocalProfileError::InvalidPassword)
        ));
        let state = store
            .set_password(&profile, None, Some("секрет"), NOW_2)
            .await
            .unwrap();
        assert!(state.profiles[0].has_password);
        assert!(store.verify_password(&profile, "секрет").await.unwrap());
        assert!(!store.verify_password(&profile, "інший").await.unwrap());
        let stored: String = sqlx::query_scalar("SELECT password_hash FROM local_profile_details")
            .fetch_one(&store.pool)
            .await
            .unwrap();
        assert!(stored.starts_with("$argon2id$") && !stored.contains("секрет"));

        assert!(matches!(
            store
                .set_password(&profile, Some("інший"), None, NOW_2)
                .await,
            Err(LocalProfileError::WrongPassword)
        ));
        let state = store
            .set_password(&profile, Some("секрет"), None, NOW_2)
            .await
            .unwrap();
        assert!(!state.profiles[0].has_password);
    }

    #[tokio::test]
    async fn details_and_database_binding_are_stored_and_validated() {
        let store = store().await;
        let profile = id("Деталі");
        store.create(&profile, "Деталі", NOW_1).await.unwrap();
        let avatar = "data:image/jpeg;base64,AAAA";
        let state = store
            .update_details(&profile, "  Начальник   штабу ", Some(avatar), NOW_2)
            .await
            .unwrap();
        assert_eq!(state.profiles[0].position, "Начальник штабу");
        assert_eq!(state.profiles[0].avatar_data_url.as_deref(), Some(avatar));
        assert!(matches!(
            store
                .update_details(&profile, "", Some("javascript:alert(1)"), NOW_2)
                .await,
            Err(LocalProfileError::InvalidAvatar)
        ));
        assert!(matches!(
            store
                .update_details(&profile, &"я".repeat(121), None, NOW_2)
                .await,
            Err(LocalProfileError::InvalidPosition)
        ));

        store
            .update_details(&profile, "", None, NOW_2)
            .await
            .unwrap();
        let orphaned: i64 = sqlx::query_scalar("SELECT count(*) FROM local_profile_details")
            .fetch_one(&store.pool)
            .await
            .unwrap();
        assert_eq!(orphaned, 1);
        store.delete(&profile, NOW_2).await.unwrap();
        let orphaned: i64 = sqlx::query_scalar("SELECT count(*) FROM local_profile_details")
            .fetch_one(&store.pool)
            .await
            .unwrap();
        assert_eq!(orphaned, 0);
    }

    #[tokio::test]
    async fn air_and_rocket_tables_are_bound_separately() {
        let store = store().await;
        let profile = id("Роди військ");
        store.create(&profile, "Роди військ", NOW_1).await.unwrap();
        assert_eq!(
            store.list().await.unwrap().profiles[0].tables,
            ProfileTables::default()
        );

        store
            .set_table_path(&profile, Branch::Air, Some("/synthetic/air.xlsx"), NOW_2)
            .await
            .unwrap();
        let state = store
            .set_table_path(
                &profile,
                Branch::Rocket,
                Some("/synthetic/rocket.xlsx"),
                NOW_2,
            )
            .await
            .unwrap();
        assert_eq!(
            state.profiles[0].tables,
            ProfileTables {
                air: Some("/synthetic/air.xlsx".to_owned()),
                rocket: Some("/synthetic/rocket.xlsx".to_owned()),
            }
        );
        assert_eq!(
            serde_json::to_value(&state.profiles[0]).unwrap()["tables"],
            serde_json::json!({ "air": "/synthetic/air.xlsx", "rocket": "/synthetic/rocket.xlsx" })
        );

        store
            .set_table_path(
                &profile,
                Branch::Rocket,
                Some("/synthetic/rocket-2.xlsx"),
                NOW_2,
            )
            .await
            .unwrap();
        let state = store
            .set_table_path(&profile, Branch::Air, None, NOW_2)
            .await
            .unwrap();
        assert_eq!(state.profiles[0].tables.air, None);
        assert_eq!(
            store
                .table_path(&profile, Branch::Rocket)
                .await
                .unwrap()
                .as_deref(),
            Some("/synthetic/rocket-2.xlsx")
        );
        assert!(matches!(
            store
                .set_table_path(&profile, Branch::Air, Some(""), NOW_2)
                .await,
            Err(LocalProfileError::InvalidTablePath)
        ));
        assert!(matches!(
            store
                .set_table_path(
                    &id("missing"),
                    Branch::Air,
                    Some("/synthetic/x.xlsx"),
                    NOW_2
                )
                .await,
            Err(LocalProfileError::ProfileNotFound)
        ));
        assert_eq!(Branch::parse("rocket").unwrap(), Branch::Rocket);
        assert!(matches!(
            Branch::parse("army"),
            Err(LocalProfileError::InvalidBranch)
        ));

        store.delete(&profile, NOW_2).await.unwrap();
        let orphaned: i64 = sqlx::query_scalar("SELECT count(*) FROM local_profile_tables")
            .fetch_one(&store.pool)
            .await
            .unwrap();
        assert_eq!(orphaned, 0);
    }

    #[tokio::test]
    async fn a_table_bound_before_branches_becomes_the_air_force_table() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        for sql in [
            INITIAL_SCHEMA_SQL,
            XLSX_DUPLICATE_LINKS_SQL,
            LOCAL_PROFILES_SQL,
            PROFILE_DETAILS_SQL,
        ] {
            sqlx::raw_sql(sql).execute(&pool).await.unwrap();
        }
        let bound = id("bound");
        let empty = id("empty");
        for (profile, name) in [(&bound, "Прив'язаний"), (&empty, "Без таблиці")]
        {
            sqlx::query(
                "INSERT INTO local_profiles (id, display_name, name_key, created_at, updated_at)
                 VALUES (?, ?, lower(?), ?, ?)",
            )
            .bind(profile)
            .bind(name)
            .bind(name)
            .bind(NOW_1)
            .bind(NOW_1)
            .execute(&pool)
            .await
            .unwrap();
        }
        sqlx::query(
            "INSERT INTO local_profile_details (profile_id, position, database_path, updated_at)
             VALUES (?, 'Аналітик', '/synthetic/AVIA_BASE.xlsx', ?), (?, '', NULL, ?)",
        )
        .bind(&bound)
        .bind(NOW_1)
        .bind(&empty)
        .bind(NOW_1)
        .execute(&pool)
        .await
        .unwrap();

        sqlx::raw_sql(PROFILE_BRANCH_TABLES_SQL)
            .execute(&pool)
            .await
            .unwrap();

        let store = LocalProfileStore::new(pool);
        let state = store.list().await.unwrap();
        let tables = |profile: &str| {
            state
                .profiles
                .iter()
                .find(|candidate| candidate.id == profile)
                .unwrap()
                .clone()
        };
        assert_eq!(
            tables(&bound).tables,
            ProfileTables {
                air: Some("/synthetic/AVIA_BASE.xlsx".to_owned()),
                rocket: None,
            }
        );
        assert_eq!(tables(&bound).position, "Аналітик");
        assert_eq!(tables(&empty).tables, ProfileTables::default());
    }
}
