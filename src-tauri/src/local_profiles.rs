use argon2::{
    password_hash::{
        rand_core::{OsRng, RngCore},
        PasswordHash, PasswordHasher, PasswordVerifier, SaltString,
    },
    Argon2,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{Sqlite, SqlitePool, Transaction};

pub const MAX_LOCAL_PROFILES: i64 = 32;
const MAX_PROFILE_NAME_CHARS: usize = 80;
const MAX_POSITION_CHARS: usize = 120;
const MAX_AVATAR_BYTES: usize = 400_000;
const MIN_PASSWORD_CHARS: usize = 6;

/// Модулі, які користувач обирає при реєстрації, у порядку показу на стартовому екрані.
pub const MODULES: [&str; 5] = ["air", "rocket", "artillery", "pvk", "dshv"];
const MAX_PASSWORD_CHARS: usize = 128;

/// Алфавіт ключа відновлення: цифри й латинські літери без I, L, O та U, які легко
/// сплутати з 1, 0 і V. Символів рівно 32, тож кожен несе 5 біт.
const RECOVERY_ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/// 25 символів = 125 біт: підібрати такий ключ неможливо, а переписати з паперу можна.
const RECOVERY_KEY_SYMBOLS: usize = 25;
const RECOVERY_KEY_GROUP: usize = 5;
/// Кириличні літери, схожі на латинські, які користувач міг набрати в українській
/// розкладці: `(кирилична, латинська)`. Записано кодами символів, щоб не сплутати їх у коді.
const RECOVERY_LOOKALIKES: [(char, char); 12] = [
    ('\u{0410}', 'A'),
    ('\u{0412}', 'B'),
    ('\u{0421}', 'C'),
    ('\u{0415}', 'E'),
    ('\u{041D}', 'H'),
    ('\u{041A}', 'K'),
    ('\u{041C}', 'M'),
    ('\u{041E}', '0'),
    ('\u{0420}', 'P'),
    ('\u{0422}', 'T'),
    ('\u{0425}', 'X'),
    ('\u{0406}', '1'),
];

#[derive(Clone, Debug)]
pub struct LocalProfileStore {
    pool: SqlitePool,
}

/// Рід військ (або командний рівень), для якого профіль тримає окрему таблицю.
/// Кожна відкривається у своєму модулі й записується у свій файл. `Pvk` і `Dshv` —
/// таблиці командувань (Повітряне командування, Командування ДШВ): вони мають
/// власні прив'язки й відкриваються в окремих вікнах над модулями ПС і РВ.
/// `PvkLosses` і `DshvLosses` — таблиця «НАШІ ВТРАТИ» (журнал власних втрат) окремо
/// для кожної плитки командування: вона відкривається на вкладці «Наші втрати»
/// дашборда лише для читання.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Branch {
    Air,
    Rocket,
    Pvk,
    Dshv,
    #[serde(rename = "pvk_losses")]
    PvkLosses,
    #[serde(rename = "dshv_losses")]
    DshvLosses,
}

impl Branch {
    pub fn as_str(self) -> &'static str {
        match self {
            Branch::Air => "air",
            Branch::Rocket => "rocket",
            Branch::Pvk => "pvk",
            Branch::Dshv => "dshv",
            Branch::PvkLosses => "pvk_losses",
            Branch::DshvLosses => "dshv_losses",
        }
    }

    /// Назва в родовому відмінку: «таблиця Повітряних Сил».
    pub fn genitive(self) -> &'static str {
        match self {
            Branch::Air => "Повітряних Сил",
            Branch::Rocket => "Ракетних військ",
            Branch::Pvk => "Повітряного командування (ПВК)",
            Branch::Dshv => "Командування ДШВ (УДШВ)",
            Branch::PvkLosses => "«Наші втрати» Повітряного командування (ПВК)",
            Branch::DshvLosses => "«Наші втрати» Командування ДШВ (УДШВ)",
        }
    }

    pub fn parse(value: &str) -> Result<Self, LocalProfileError> {
        match value {
            "air" => Ok(Branch::Air),
            "rocket" => Ok(Branch::Rocket),
            "pvk" => Ok(Branch::Pvk),
            "dshv" => Ok(Branch::Dshv),
            "pvk_losses" => Ok(Branch::PvkLosses),
            "dshv_losses" => Ok(Branch::DshvLosses),
            _ => Err(LocalProfileError::InvalidBranch),
        }
    }
}

/// Шляхи таблиць профілю за родами військ.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
pub struct ProfileTables {
    pub air: Option<String>,
    pub rocket: Option<String>,
    pub pvk: Option<String>,
    pub dshv: Option<String>,
    pub pvk_losses: Option<String>,
    pub dshv_losses: Option<String>,
}

impl ProfileTables {
    fn slot(&mut self, branch: Branch) -> &mut Option<String> {
        match branch {
            Branch::Air => &mut self.air,
            Branch::Rocket => &mut self.rocket,
            Branch::Pvk => &mut self.pvk,
            Branch::Dshv => &mut self.dshv,
            Branch::PvkLosses => &mut self.pvk_losses,
            Branch::DshvLosses => &mut self.dshv_losses,
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
    /// Чи створено ключ відновлення пароля. Сам ключ і його хеш назовні не віддаються.
    pub has_recovery_key: bool,
    /// Модулі, обрані при реєстрації (ключі з `MODULES`), у порядку показу.
    pub modules: Vec<String>,
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
    #[error("пароль має містити від 6 до 128 символів")]
    InvalidPassword,
    #[error("неправильний пароль профілю")]
    WrongPassword,
    #[error("не вдалося обробити пароль профілю")]
    PasswordHash,
    #[error("невідомий рід військ для таблиці профілю")]
    InvalidBranch,
    #[error("шлях до таблиці має містити від 1 до 4096 символів")]
    InvalidTablePath,
    #[error("оберіть щонайменше один із наявних модулів")]
    InvalidModules,
    #[error("пароль профілю обов'язковий")]
    PasswordRequired,
    #[error("неправильний ключ відновлення")]
    WrongRecoveryKey,
    #[error("для цього профілю ключ відновлення не створювали")]
    RecoveryKeyNotSet,
}

/// Стан профілів разом із новим ключем відновлення. Ключ показується користувачеві один
/// раз і ніде не зберігається (у базі лише його хеш), тому в `Debug` його приховано.
#[derive(Clone, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryKeyIssued {
    pub state: LocalProfilesState,
    pub recovery_key: String,
}

impl std::fmt::Debug for RecoveryKeyIssued {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("RecoveryKeyIssued")
            .field("state", &self.state)
            .field("recovery_key", &"<приховано>")
            .finish()
    }
}

/// Дані реєстрації: профіль створюється разом з обов'язковим паролем і модулями.
pub struct NewProfile<'a> {
    pub id: &'a str,
    pub display_name: &'a str,
    pub password: &'a str,
    pub position: &'a str,
    pub avatar_data_url: Option<&'a str>,
    pub modules: &'a [String],
}

/// Перелік модулів у каноничному порядку без дублікатів; порожній або невідомий — помилка.
pub fn normalize_modules(modules: &[String]) -> Result<Vec<&'static str>, LocalProfileError> {
    if modules
        .iter()
        .any(|module| !MODULES.contains(&module.as_str()))
    {
        return Err(LocalProfileError::InvalidModules);
    }
    let chosen: Vec<&'static str> = MODULES
        .into_iter()
        .filter(|known| modules.iter().any(|module| module == known))
        .collect();
    if chosen.is_empty() {
        return Err(LocalProfileError::InvalidModules);
    }
    Ok(chosen)
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
        for module in MODULES {
            sqlx::query("INSERT INTO local_profile_modules (profile_id, module) VALUES (?, ?)")
                .bind(id)
                .bind(module)
                .execute(&mut *transaction)
                .await?;
        }
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

    /// Реєстрація: профіль, пароль, ключ відновлення, посада, фото й модулі зберігаються
    /// одним кроком, а новий профіль стає активним. Пароль обов'язковий. Ключ
    /// відновлення повертається тут єдиний раз.
    pub async fn register(
        &self,
        new: NewProfile<'_>,
        now: &str,
    ) -> Result<RecoveryKeyIssued, LocalProfileError> {
        validate_profile_id(new.id)?;
        let (display_name, name_key) = normalize_display_name(new.display_name)?;
        let hash = hash_password(new.password)?;
        let (recovery_key, recovery_hash) = new_recovery_key()?;
        let position = new
            .position
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        if position.chars().count() > MAX_POSITION_CHARS {
            return Err(LocalProfileError::InvalidPosition);
        }
        if let Some(avatar) = new.avatar_data_url {
            validate_avatar(avatar)?;
        }
        let modules = normalize_modules(new.modules)?;
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
        .bind(new.id)
        .bind(&display_name)
        .bind(&name_key)
        .bind(now)
        .bind(now)
        .execute(&mut *transaction)
        .await?;
        sqlx::query(
            "INSERT INTO local_profile_details
             (profile_id, position, avatar_data_url, password_hash, updated_at)
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(new.id)
        .bind(&position)
        .bind(new.avatar_data_url)
        .bind(&hash)
        .bind(now)
        .execute(&mut *transaction)
        .await?;
        store_recovery_hash(&mut transaction, new.id, &recovery_hash, now).await?;
        for module in modules {
            sqlx::query("INSERT INTO local_profile_modules (profile_id, module) VALUES (?, ?)")
                .bind(new.id)
                .bind(module)
                .execute(&mut *transaction)
                .await?;
        }
        sqlx::query(
            "UPDATE local_profile_state SET active_profile_id = ?, updated_at = ?
             WHERE singleton = 1",
        )
        .bind(new.id)
        .bind(now)
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(RecoveryKeyIssued {
            state: self.list().await?,
            recovery_key,
        })
    }

    /// Змінює набір модулів профілю; потрібен щонайменше один.
    pub async fn set_modules(
        &self,
        id: &str,
        modules: &[String],
        now: &str,
    ) -> Result<LocalProfilesState, LocalProfileError> {
        validate_profile_id(id)?;
        let modules = normalize_modules(modules)?;
        let mut transaction = self.pool.begin().await?;
        ensure_profile_exists(&mut transaction, id).await?;
        sqlx::query("DELETE FROM local_profile_modules WHERE profile_id = ?")
            .bind(id)
            .execute(&mut *transaction)
            .await?;
        for module in modules {
            sqlx::query("INSERT INTO local_profile_modules (profile_id, module) VALUES (?, ?)")
                .bind(id)
                .bind(module)
                .execute(&mut *transaction)
                .await?;
        }
        sqlx::query("UPDATE local_profiles SET updated_at = ? WHERE id = ?")
            .bind(now)
            .bind(id)
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
            Some(stored) => verify_secret(&stored, password),
        }
    }

    pub async fn has_password(&self, id: &str) -> Result<bool, LocalProfileError> {
        Ok(self.password_hash(id).await?.is_some())
    }

    /// Створює новий ключ відновлення (замінює попередній). Потрібен чинний пароль:
    /// відкрита сесія сама по собі не дає права видати ключ, яким потім можна скинути пароль.
    pub async fn issue_recovery_key(
        &self,
        id: &str,
        current_password: &str,
        now: &str,
    ) -> Result<RecoveryKeyIssued, LocalProfileError> {
        validate_profile_id(id)?;
        if !self.has_password(id).await? {
            return Err(LocalProfileError::PasswordRequired);
        }
        if !self.verify_password(id, current_password).await? {
            return Err(LocalProfileError::WrongPassword);
        }
        let (recovery_key, recovery_hash) = new_recovery_key()?;
        let mut transaction = self.pool.begin().await?;
        ensure_profile_exists(&mut transaction, id).await?;
        store_recovery_hash(&mut transaction, id, &recovery_hash, now).await?;
        transaction.commit().await?;
        Ok(RecoveryKeyIssued {
            state: self.list().await?,
            recovery_key,
        })
    }

    /// Скидає забутий пароль за ключем відновлення: ставить новий пароль, робить профіль
    /// активним і одразу видає новий ключ. Використаний ключ більше не діє.
    pub async fn recover_password(
        &self,
        id: &str,
        recovery_key: &str,
        new_password: &str,
        now: &str,
    ) -> Result<RecoveryKeyIssued, LocalProfileError> {
        validate_profile_id(id)?;
        let stored = self.recovery_hash(id).await?;
        let Some(stored) = stored else {
            return Err(LocalProfileError::RecoveryKeyNotSet);
        };
        let Some(secret) = normalize_recovery_key(recovery_key) else {
            return Err(LocalProfileError::WrongRecoveryKey);
        };
        if !verify_secret(&stored, &secret)? {
            return Err(LocalProfileError::WrongRecoveryKey);
        }
        let password_hash = hash_password(new_password)?;
        let (next_key, next_hash) = new_recovery_key()?;
        let mut transaction = self.pool.begin().await?;
        ensure_profile_exists(&mut transaction, id).await?;
        ensure_details_row(&mut transaction, id, now).await?;
        sqlx::query(
            "UPDATE local_profile_details SET password_hash = ?, updated_at = ? WHERE profile_id = ?",
        )
        .bind(&password_hash)
        .bind(now)
        .bind(id)
        .execute(&mut *transaction)
        .await?;
        store_recovery_hash(&mut transaction, id, &next_hash, now).await?;
        sqlx::query(
            "UPDATE local_profile_state SET active_profile_id = ?, updated_at = ?
             WHERE singleton = 1",
        )
        .bind(id)
        .bind(now)
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(RecoveryKeyIssued {
            state: self.list().await?,
            recovery_key: next_key,
        })
    }

    async fn recovery_hash(&self, id: &str) -> Result<Option<String>, LocalProfileError> {
        let exists: i64 = sqlx::query_scalar("SELECT count(*) FROM local_profiles WHERE id = ?")
            .bind(id)
            .fetch_one(&self.pool)
            .await?;
        if exists != 1 {
            return Err(LocalProfileError::ProfileNotFound);
        }
        Ok(
            sqlx::query_scalar("SELECT key_hash FROM local_profile_recovery WHERE profile_id = ?")
                .bind(id)
                .fetch_optional(&self.pool)
                .await?,
        )
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
    hash_secret(password)
}

fn hash_secret(secret: &str) -> Result<String, LocalProfileError> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(secret.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|_| LocalProfileError::PasswordHash)
}

fn verify_secret(stored: &str, secret: &str) -> Result<bool, LocalProfileError> {
    let parsed = PasswordHash::new(stored).map_err(|_| LocalProfileError::PasswordHash)?;
    Ok(Argon2::default()
        .verify_password(secret.as_bytes(), &parsed)
        .is_ok())
}

/// Новий випадковий ключ відновлення: `XXXXX-XXXXX-XXXXX-XXXXX-XXXXX` (25 символів, 125 біт).
pub fn generate_recovery_key() -> String {
    let mut bytes = [0_u8; RECOVERY_KEY_SYMBOLS];
    OsRng.fill_bytes(&mut bytes);
    let symbols: Vec<char> = bytes
        .iter()
        // 256 ділиться на 32 без залишку, тож зсув не дає перекосу.
        .map(|byte| char::from(RECOVERY_ALPHABET[usize::from(byte & 31)]))
        .collect();
    symbols
        .chunks(RECOVERY_KEY_GROUP)
        .map(|group| group.iter().collect::<String>())
        .collect::<Vec<_>>()
        .join("-")
}

/// Приводить введений ключ до канонічного вигляду (25 символів алфавіту) або `None`.
/// Пробіли й тире ігноруються, регістр не важить; I і L читаються як 1, O — як 0, а
/// кириличні літери, схожі на латинські, — як латинські.
pub fn normalize_recovery_key(input: &str) -> Option<String> {
    let mut symbols = String::with_capacity(RECOVERY_KEY_SYMBOLS);
    for raw in input.chars() {
        if raw.is_whitespace() || matches!(raw, '-' | '_' | '\u{2010}'..='\u{2015}' | '\u{2212}') {
            continue;
        }
        for upper in raw.to_uppercase() {
            let mapped = RECOVERY_LOOKALIKES
                .iter()
                .find(|(from, _)| *from == upper)
                .map_or(
                    match upper {
                        'I' | 'L' => '1',
                        'O' => '0',
                        other => other,
                    },
                    |(_, to)| *to,
                );
            if !mapped.is_ascii() || !RECOVERY_ALPHABET.contains(&(mapped as u8)) {
                return None;
            }
            symbols.push(mapped);
            if symbols.len() > RECOVERY_KEY_SYMBOLS {
                return None;
            }
        }
    }
    (symbols.len() == RECOVERY_KEY_SYMBOLS).then_some(symbols)
}

/// Ключ для показу користувачеві й хеш його канонічного вигляду для бази.
fn new_recovery_key() -> Result<(String, String), LocalProfileError> {
    let key = generate_recovery_key();
    let secret = normalize_recovery_key(&key).ok_or(LocalProfileError::PasswordHash)?;
    Ok((key, hash_secret(&secret)?))
}

async fn store_recovery_hash(
    transaction: &mut Transaction<'_, Sqlite>,
    id: &str,
    hash: &str,
    now: &str,
) -> Result<(), LocalProfileError> {
    sqlx::query(
        "INSERT INTO local_profile_recovery (profile_id, key_hash, created_at)
         VALUES (?, ?, ?)
         ON CONFLICT (profile_id)
         DO UPDATE SET key_hash = excluded.key_hash, created_at = excluded.created_at",
    )
    .bind(id)
    .bind(hash)
    .bind(now)
    .execute(&mut **transaction)
    .await?;
    Ok(())
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
    bool,
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
                d.password_hash IS NOT NULL, r.profile_id IS NOT NULL,
                p.created_at, p.updated_at
         FROM local_profiles p
         LEFT JOIN local_profile_details d ON d.profile_id = p.id
         LEFT JOIN local_profile_recovery r ON r.profile_id = p.id
         ORDER BY p.name_key, p.id",
    )
    .fetch_all(pool)
    .await?;
    let table_rows: Vec<(String, String, String)> =
        sqlx::query_as("SELECT profile_id, branch, path FROM local_profile_tables")
            .fetch_all(pool)
            .await?;
    let module_rows: Vec<(String, String)> =
        sqlx::query_as("SELECT profile_id, module FROM local_profile_modules")
            .fetch_all(pool)
            .await?;
    let mut chosen = std::collections::HashMap::<String, Vec<String>>::new();
    for (profile_id, module) in module_rows {
        chosen.entry(profile_id).or_default().push(module);
    }
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
                has_recovery_key,
                created_at,
                updated_at,
            )| LocalProfile {
                modules: MODULES
                    .into_iter()
                    .filter(|known| {
                        chosen
                            .get(&id)
                            .is_some_and(|list| list.iter().any(|module| module == known))
                    })
                    .map(str::to_owned)
                    .collect(),
                tables: tables.remove(&id).unwrap_or_default(),
                id,
                display_name,
                position: position.unwrap_or_default(),
                avatar_data_url,
                has_password: has_password.unwrap_or(false),
                has_recovery_key,
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
        COMMAND_TABLES_SQL, INITIAL_SCHEMA_SQL, LOCAL_PROFILES_SQL, OWN_LOSSES_TABLES_SQL,
        PROFILE_BRANCH_TABLES_SQL, PROFILE_DETAILS_SQL, PROFILE_MODULES_SQL, PROFILE_RECOVERY_SQL,
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
        sqlx::raw_sql(COMMAND_TABLES_SQL)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::raw_sql(OWN_LOSSES_TABLES_SQL)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::raw_sql(PROFILE_MODULES_SQL)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::raw_sql(PROFILE_RECOVERY_SQL)
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
                ..ProfileTables::default()
            }
        );
        assert_eq!(
            serde_json::to_value(&state.profiles[0]).unwrap()["tables"],
            serde_json::json!({
                "air": "/synthetic/air.xlsx",
                "rocket": "/synthetic/rocket.xlsx",
                "pvk": null,
                "dshv": null,
                "pvk_losses": null,
                "dshv_losses": null
            })
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
        assert_eq!(Branch::parse("pvk").unwrap(), Branch::Pvk);
        assert_eq!(Branch::parse("dshv").unwrap(), Branch::Dshv);
        assert_eq!(Branch::parse("pvk_losses").unwrap(), Branch::PvkLosses);
        assert_eq!(Branch::parse("dshv_losses").unwrap(), Branch::DshvLosses);
        assert_eq!(Branch::PvkLosses.as_str(), "pvk_losses");
        assert_eq!(Branch::DshvLosses.as_str(), "dshv_losses");
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
    async fn command_tables_are_bound_apart_from_the_branch_tables() {
        let store = store().await;
        let profile = id("Командування");
        store.create(&profile, "Командування", NOW_1).await.unwrap();
        store
            .set_table_path(&profile, Branch::Air, Some("/synthetic/air.xlsx"), NOW_2)
            .await
            .unwrap();
        store
            .set_table_path(&profile, Branch::Pvk, Some("/synthetic/pvk.xlsx"), NOW_2)
            .await
            .unwrap();
        let state = store
            .set_table_path(&profile, Branch::Dshv, Some("/synthetic/dshv.xlsx"), NOW_2)
            .await
            .unwrap();
        assert_eq!(
            state.profiles[0].tables,
            ProfileTables {
                air: Some("/synthetic/air.xlsx".to_owned()),
                rocket: None,
                pvk: Some("/synthetic/pvk.xlsx".to_owned()),
                dshv: Some("/synthetic/dshv.xlsx".to_owned()),
                ..ProfileTables::default()
            }
        );
        // Відв'язання командної таблиці не чіпає таблицю модуля.
        let state = store
            .set_table_path(&profile, Branch::Pvk, None, NOW_2)
            .await
            .unwrap();
        assert_eq!(state.profiles[0].tables.pvk, None);
        assert_eq!(
            state.profiles[0].tables.air.as_deref(),
            Some("/synthetic/air.xlsx")
        );
        assert_eq!(
            store
                .table_path(&profile, Branch::Dshv)
                .await
                .unwrap()
                .as_deref(),
            Some("/synthetic/dshv.xlsx")
        );
    }

    #[tokio::test]
    async fn own_losses_tables_are_bound_per_command_apart_from_the_main_tables() {
        let store = store().await;
        let profile = id("Втрати");
        store.create(&profile, "Втрати", NOW_1).await.unwrap();
        store
            .set_table_path(&profile, Branch::Dshv, Some("/synthetic/dshv.xlsx"), NOW_2)
            .await
            .unwrap();
        store
            .set_table_path(
                &profile,
                Branch::PvkLosses,
                Some("/synthetic/pvk-own.xlsx"),
                NOW_2,
            )
            .await
            .unwrap();
        let state = store
            .set_table_path(
                &profile,
                Branch::DshvLosses,
                Some("/synthetic/dshv-own.xlsx"),
                NOW_2,
            )
            .await
            .unwrap();
        assert_eq!(
            state.profiles[0].tables,
            ProfileTables {
                dshv: Some("/synthetic/dshv.xlsx".to_owned()),
                pvk_losses: Some("/synthetic/pvk-own.xlsx".to_owned()),
                dshv_losses: Some("/synthetic/dshv-own.xlsx".to_owned()),
                ..ProfileTables::default()
            }
        );
        // Відв'язання «Наших втрат» не чіпає основну таблицю плитки.
        let state = store
            .set_table_path(&profile, Branch::DshvLosses, None, NOW_2)
            .await
            .unwrap();
        assert_eq!(state.profiles[0].tables.dshv_losses, None);
        assert_eq!(
            state.profiles[0].tables.dshv.as_deref(),
            Some("/synthetic/dshv.xlsx")
        );
        assert_eq!(
            store
                .table_path(&profile, Branch::PvkLosses)
                .await
                .unwrap()
                .as_deref(),
            Some("/synthetic/pvk-own.xlsx")
        );
        // У JSON для лончера ключі збігаються з ідентифікаторами слотів.
        let json = serde_json::to_value(&state.profiles[0].tables).unwrap();
        assert_eq!(json["pvk_losses"], "/synthetic/pvk-own.xlsx");
        assert!(json["dshv_losses"].is_null());
    }

    #[tokio::test]
    async fn the_own_losses_migration_keeps_existing_bindings() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        for migration in [
            INITIAL_SCHEMA_SQL,
            XLSX_DUPLICATE_LINKS_SQL,
            LOCAL_PROFILES_SQL,
            PROFILE_DETAILS_SQL,
            PROFILE_BRANCH_TABLES_SQL,
            COMMAND_TABLES_SQL,
        ] {
            sqlx::raw_sql(migration).execute(&pool).await.unwrap();
        }
        let profile = id("Перенесення втрат");
        insert_legacy_profile(&pool, &profile, "Перенесення втрат").await;
        sqlx::query(
            "INSERT INTO local_profile_tables (profile_id, branch, path, updated_at)
             VALUES (?, 'air', '/synthetic/air.xlsx', ?), (?, 'dshv', '/synthetic/dshv.xlsx', ?)",
        )
        .bind(&profile)
        .bind(NOW_1)
        .bind(&profile)
        .bind(NOW_1)
        .execute(&pool)
        .await
        .unwrap();
        // Стара схема ще не знає прив'язок «Наших втрат».
        assert!(sqlx::query(
            "INSERT INTO local_profile_tables (profile_id, branch, path, updated_at)
             VALUES (?, 'dshv_losses', '/synthetic/own.xlsx', ?)",
        )
        .bind(&profile)
        .bind(NOW_1)
        .execute(&pool)
        .await
        .is_err());

        sqlx::raw_sql(OWN_LOSSES_TABLES_SQL)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::raw_sql(PROFILE_MODULES_SQL)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::raw_sql(PROFILE_RECOVERY_SQL)
            .execute(&pool)
            .await
            .unwrap();
        let state = LocalProfileStore::new(pool.clone()).list().await.unwrap();
        assert_eq!(
            state.profiles[0].tables,
            ProfileTables {
                air: Some("/synthetic/air.xlsx".to_owned()),
                dshv: Some("/synthetic/dshv.xlsx".to_owned()),
                ..ProfileTables::default()
            }
        );
        // Невідомий слот і далі відхиляється схемою.
        assert!(sqlx::query(
            "INSERT INTO local_profile_tables (profile_id, branch, path, updated_at)
             VALUES (?, 'army', '/synthetic/army.xlsx', ?)",
        )
        .bind(&profile)
        .bind(NOW_1)
        .execute(&pool)
        .await
        .is_err());
    }

    #[tokio::test]
    async fn the_command_migration_keeps_existing_bindings() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        for migration in [
            INITIAL_SCHEMA_SQL,
            XLSX_DUPLICATE_LINKS_SQL,
            LOCAL_PROFILES_SQL,
            PROFILE_DETAILS_SQL,
            PROFILE_BRANCH_TABLES_SQL,
        ] {
            sqlx::raw_sql(migration).execute(&pool).await.unwrap();
        }
        let profile = id("Перенесення");
        insert_legacy_profile(&pool, &profile, "Перенесення").await;
        sqlx::query(
            "INSERT INTO local_profile_tables (profile_id, branch, path, updated_at)
             VALUES (?, 'air', '/synthetic/air.xlsx', ?), (?, 'rocket', '/synthetic/rocket.xlsx', ?)",
        )
        .bind(&profile)
        .bind(NOW_1)
        .bind(&profile)
        .bind(NOW_1)
        .execute(&pool)
        .await
        .unwrap();
        // Стара схема ще не знає командних прив'язок.
        assert!(sqlx::query(
            "INSERT INTO local_profile_tables (profile_id, branch, path, updated_at)
             VALUES (?, 'pvk', '/synthetic/pvk.xlsx', ?)",
        )
        .bind(&profile)
        .bind(NOW_1)
        .execute(&pool)
        .await
        .is_err());

        sqlx::raw_sql(COMMAND_TABLES_SQL)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::raw_sql(OWN_LOSSES_TABLES_SQL)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::raw_sql(PROFILE_MODULES_SQL)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::raw_sql(PROFILE_RECOVERY_SQL)
            .execute(&pool)
            .await
            .unwrap();
        let state = LocalProfileStore::new(pool).list().await.unwrap();
        assert_eq!(
            state.profiles[0].tables,
            ProfileTables {
                air: Some("/synthetic/air.xlsx".to_owned()),
                rocket: Some("/synthetic/rocket.xlsx".to_owned()),
                ..ProfileTables::default()
            }
        );
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

        sqlx::raw_sql(PROFILE_MODULES_SQL)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::raw_sql(PROFILE_RECOVERY_SQL)
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
                ..ProfileTables::default()
            }
        );
        assert_eq!(tables(&bound).position, "Аналітик");
        assert_eq!(tables(&empty).tables, ProfileTables::default());
    }

    /// Профіль у старій схемі (до міграції модулів): `create` ще не вміє писати модулі.
    async fn insert_legacy_profile(pool: &SqlitePool, profile: &str, name: &str) {
        sqlx::query(
            "INSERT INTO local_profiles (id, display_name, name_key, created_at, updated_at)
             VALUES (?, ?, lower(?), ?, ?)",
        )
        .bind(profile)
        .bind(name)
        .bind(name)
        .bind(NOW_1)
        .bind(NOW_1)
        .execute(pool)
        .await
        .unwrap();
    }

    fn modules(keys: &[&str]) -> Vec<String> {
        keys.iter().map(|key| (*key).to_owned()).collect()
    }

    fn registration<'a>(
        profile: &'a str,
        name: &'a str,
        password: &'a str,
        chosen: &'a [String],
    ) -> NewProfile<'a> {
        NewProfile {
            id: profile,
            display_name: name,
            password,
            position: "  Оператор   ПС ",
            avatar_data_url: None,
            modules: chosen,
        }
    }

    #[tokio::test]
    async fn registration_creates_profile_password_details_and_modules_at_once() {
        let store = store().await;
        let profile = id("Реєстрація");
        let chosen = modules(&["pvk", "air", "air"]);
        let registered = store
            .register(
                registration(
                    &profile,
                    "  Новий   користувач ",
                    "синтетичний-пароль",
                    &chosen,
                ),
                NOW_1,
            )
            .await
            .unwrap();
        let recovery_key = registered.recovery_key.clone();
        let state = registered.state;
        assert_eq!(state.active_profile_id.as_deref(), Some(profile.as_str()));
        let created = &state.profiles[0];
        assert_eq!(created.display_name, "Новий користувач");
        assert_eq!(created.position, "Оператор ПС");
        assert!(created.has_password);
        // Дублікати зникають, порядок — як на стартовому екрані.
        assert_eq!(created.modules, ["air", "pvk"]);
        assert!(store
            .verify_password(&profile, "синтетичний-пароль")
            .await
            .unwrap());
        assert!(!store.verify_password(&profile, "").await.unwrap());
        let stored: String = sqlx::query_scalar("SELECT password_hash FROM local_profile_details")
            .fetch_one(&store.pool)
            .await
            .unwrap();
        assert!(stored.starts_with("$argon2id$"));
        assert!(!stored.contains("синтетичний-пароль"));
        // Ключ відновлення видано разом із профілем; у базі лише його хеш.
        assert!(created.has_recovery_key);
        assert!(normalize_recovery_key(&recovery_key).is_some());
        let key_hash: String = sqlx::query_scalar("SELECT key_hash FROM local_profile_recovery")
            .fetch_one(&store.pool)
            .await
            .unwrap();
        assert!(key_hash.starts_with("$argon2id$"));
        assert!(!key_hash.contains(&recovery_key.replace('-', "")));
    }

    #[tokio::test]
    async fn registration_rejects_bad_input_without_leaving_a_partial_profile() {
        let store = store().await;
        let ok_modules = modules(&["air"]);
        assert!(matches!(
            store
                .register(registration(&id("a"), "Профіль", "", &ok_modules), NOW_1)
                .await,
            Err(LocalProfileError::InvalidPassword)
        ));
        assert!(matches!(
            store
                .register(
                    registration(&id("b"), "Профіль", "12345", &ok_modules),
                    NOW_1
                )
                .await,
            Err(LocalProfileError::InvalidPassword)
        ));
        assert!(matches!(
            store
                .register(
                    registration(&id("c"), "   ", "добрий-пароль", &ok_modules),
                    NOW_1
                )
                .await,
            Err(LocalProfileError::InvalidDisplayName)
        ));
        assert!(matches!(
            store
                .register(
                    registration(&id("d"), "Профіль", "добрий-пароль", &[]),
                    NOW_1
                )
                .await,
            Err(LocalProfileError::InvalidModules)
        ));
        let unknown = modules(&["air", "army"]);
        assert!(matches!(
            store
                .register(
                    registration(&id("e"), "Профіль", "добрий-пароль", &unknown),
                    NOW_1
                )
                .await,
            Err(LocalProfileError::InvalidModules)
        ));
        let avatar_profile = id("f");
        let mut with_bad_avatar =
            registration(&avatar_profile, "Профіль", "добрий-пароль", &ok_modules);
        with_bad_avatar.avatar_data_url = Some("data:text/html;base64,AAAA");
        assert!(matches!(
            store.register(with_bad_avatar, NOW_1).await,
            Err(LocalProfileError::InvalidAvatar)
        ));
        assert!(store.list().await.unwrap().profiles.is_empty());
        for table in [
            "local_profiles",
            "local_profile_details",
            "local_profile_modules",
        ] {
            let rows: i64 = sqlx::query_scalar(&format!("SELECT count(*) FROM {table}"))
                .fetch_one(&store.pool)
                .await
                .unwrap();
            assert_eq!(rows, 0, "{table} stays empty after a rejected registration");
        }
    }

    #[tokio::test]
    async fn registration_keeps_names_unique_and_switches_the_active_profile() {
        let store = store().await;
        let chosen = modules(&["rocket"]);
        let first = id("перший");
        let second = id("другий");
        store
            .register(
                registration(&first, "Перший", "перший-пароль", &chosen),
                NOW_1,
            )
            .await
            .unwrap();
        assert!(matches!(
            store
                .register(
                    registration(&id("дубль"), " ПЕРШИЙ ", "дубль-пароль", &chosen),
                    NOW_1
                )
                .await,
            Err(LocalProfileError::DuplicateDisplayName)
        ));
        let state = store
            .register(
                registration(
                    &second,
                    "Другий",
                    "другий-пароль",
                    &modules(&["artillery", "dshv"]),
                ),
                NOW_2,
            )
            .await
            .unwrap()
            .state;
        assert_eq!(state.active_profile_id.as_deref(), Some(second.as_str()));
        assert_eq!(state.profiles.len(), 2);
        // Паролі й модулі окремі для кожного користувача.
        assert!(store
            .verify_password(&first, "перший-пароль")
            .await
            .unwrap());
        assert!(!store
            .verify_password(&first, "другий-пароль")
            .await
            .unwrap());
        let by_name = |name: &str| {
            state
                .profiles
                .iter()
                .find(|p| p.display_name == name)
                .unwrap()
                .clone()
        };
        assert_eq!(by_name("Перший").modules, ["rocket"]);
        assert_eq!(by_name("Другий").modules, ["artillery", "dshv"]);
    }

    #[tokio::test]
    async fn modules_can_be_changed_but_never_emptied_and_follow_profile_deletion() {
        let store = store().await;
        let profile = id("модулі");
        store
            .register(
                registration(&profile, "Модулі", "модулі-пароль", &modules(&["air"])),
                NOW_1,
            )
            .await
            .unwrap();
        let state = store
            .set_modules(&profile, &modules(&["dshv", "rocket"]), NOW_2)
            .await
            .unwrap();
        assert_eq!(state.profiles[0].modules, ["rocket", "dshv"]);
        assert_eq!(state.profiles[0].updated_at, NOW_2);
        assert!(matches!(
            store.set_modules(&profile, &[], NOW_2).await,
            Err(LocalProfileError::InvalidModules)
        ));
        assert!(matches!(
            store
                .set_modules(&profile, &modules(&["army"]), NOW_2)
                .await,
            Err(LocalProfileError::InvalidModules)
        ));
        assert!(matches!(
            store
                .set_modules(&id("немає"), &modules(&["air"]), NOW_2)
                .await,
            Err(LocalProfileError::ProfileNotFound)
        ));
        assert_eq!(
            store.list().await.unwrap().profiles[0].modules,
            ["rocket", "dshv"]
        );
        store.delete(&profile, NOW_2).await.unwrap();
        let left: i64 = sqlx::query_scalar("SELECT count(*) FROM local_profile_modules")
            .fetch_one(&store.pool)
            .await
            .unwrap();
        assert_eq!(left, 0);
    }

    #[tokio::test]
    async fn profiles_created_without_registration_see_every_module() {
        let store = store().await;
        let state = store
            .create(&id("старий"), "Старий профіль", NOW_1)
            .await
            .unwrap();
        assert_eq!(state.profiles[0].modules, MODULES);
    }

    #[tokio::test]
    async fn the_modules_migration_gives_existing_profiles_every_module() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        for migration in [
            INITIAL_SCHEMA_SQL,
            XLSX_DUPLICATE_LINKS_SQL,
            LOCAL_PROFILES_SQL,
            PROFILE_DETAILS_SQL,
            PROFILE_BRANCH_TABLES_SQL,
            COMMAND_TABLES_SQL,
            OWN_LOSSES_TABLES_SQL,
        ] {
            sqlx::raw_sql(migration).execute(&pool).await.unwrap();
        }
        let profile = id("до модулів");
        sqlx::query("INSERT INTO local_profiles (id, display_name, name_key, created_at, updated_at) VALUES (?, 'До модулів', 'до модулів', ?, ?)")
            .bind(&profile)
            .bind(NOW_1)
            .bind(NOW_1)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::raw_sql(PROFILE_MODULES_SQL)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::raw_sql(PROFILE_RECOVERY_SQL)
            .execute(&pool)
            .await
            .unwrap();
        let state = LocalProfileStore::new(pool.clone()).list().await.unwrap();
        assert_eq!(state.profiles[0].modules, MODULES);
        // Невідомий модуль схема відхиляє.
        assert!(sqlx::query(
            "INSERT INTO local_profile_modules (profile_id, module) VALUES (?, 'army')"
        )
        .bind(&profile)
        .execute(&pool)
        .await
        .is_err());
    }

    // ---------- ключ відновлення пароля ----------

    async fn registered(store: &LocalProfileStore, seed: &str, password: &str) -> (String, String) {
        let profile = id(seed);
        let issued = store
            .register(
                registration(&profile, seed, password, &modules(&["air"])),
                NOW_1,
            )
            .await
            .unwrap();
        (profile, issued.recovery_key)
    }

    #[test]
    fn recovery_key_has_the_documented_shape() {
        let first = generate_recovery_key();
        let second = generate_recovery_key();
        assert_ne!(first, second);
        for key in [&first, &second] {
            let groups: Vec<&str> = key.split('-').collect();
            assert_eq!(groups.len(), 5, "{key}");
            for group in groups {
                assert_eq!(group.len(), 5, "{key}");
                assert!(
                    group.bytes().all(|byte| RECOVERY_ALPHABET.contains(&byte)),
                    "{key}"
                );
            }
            // Канонічний вигляд ключа — ті самі 25 символів без тире.
            assert_eq!(normalize_recovery_key(key), Some(key.replace('-', "")));
        }
    }

    #[test]
    fn recovery_key_input_tolerates_typing_noise_but_not_other_symbols() {
        let canonical = "ABCDEFGHJKMNPQRSTVWXYZ012";
        let pretty = "ABCDE-FGHJK-MNPQR-STVWX-YZ012";
        assert_eq!(normalize_recovery_key(pretty).as_deref(), Some(canonical));
        // Регістр, пробіли, тире й «довге» тире не важливі.
        assert_eq!(
            normalize_recovery_key("  abcde fghjk\u{2013}mnpqr_stvwx-yz012 ").as_deref(),
            Some(canonical)
        );
        // I, L читаються як 1, а O — як 0.
        assert_eq!(
            normalize_recovery_key("ABCDE-FGHJK-MNPQR-STVWX-YZOIL").as_deref(),
            Some("ABCDEFGHJKMNPQRSTVWXYZ011")
        );
        // Кириличні двійники A B C E H K M O P T X І, набрані в українській розкладці.
        let cyrillic = "\u{0410}\u{0412}\u{0421}D\u{0415}-FG\u{041D}JK-\u{041C}NPQR-S\u{0422}VW\u{0425}-YZ\u{041E}1\u{0406}";
        assert_eq!(
            normalize_recovery_key(cyrillic).as_deref(),
            Some("ABCDEFGHJKMNPQRSTVWXYZ011")
        );
        // Неправильна довжина, літера U та сторонні символи — відмова.
        assert_eq!(normalize_recovery_key(""), None);
        assert_eq!(normalize_recovery_key("ABCDE-FGHJK-MNPQR-STVWX-YZ01"), None);
        assert_eq!(
            normalize_recovery_key("ABCDE-FGHJK-MNPQR-STVWX-YZ0123"),
            None
        );
        assert_eq!(
            normalize_recovery_key("ABCDE-FGHJK-MNPQR-STVWX-YZ01U"),
            None
        );
        assert_eq!(
            normalize_recovery_key("ABCDE-FGHJK-MNPQR-STVWX-YZ01!"),
            None
        );
        assert_eq!(
            normalize_recovery_key("ABCDE-FGHJK-MNPQR-STVWX-YZ01Ж"),
            None
        );
    }

    #[test]
    fn issued_recovery_key_is_hidden_from_debug_output() {
        let issued = RecoveryKeyIssued {
            state: LocalProfilesState {
                active_profile_id: None,
                profiles: Vec::new(),
            },
            recovery_key: "ABCDE-FGHJK-MNPQR-STVWX-YZ012".to_owned(),
        };
        let printed = format!("{issued:?}");
        assert!(!printed.contains("ABCDE"));
        assert!(printed.contains("приховано"));
    }

    #[tokio::test]
    async fn a_forgotten_password_is_reset_by_the_key_and_the_key_is_rotated() {
        let store = store().await;
        let (profile, key) = registered(&store, "Забудько", "старий-пароль").await;
        let before = store.list().await.unwrap();
        assert!(before.profiles[0].has_recovery_key);

        // Неправильний ключ нічого не змінює.
        let wrong = generate_recovery_key();
        assert!(matches!(
            store
                .recover_password(&profile, &wrong, "новий-пароль", NOW_2)
                .await,
            Err(LocalProfileError::WrongRecoveryKey)
        ));
        assert!(matches!(
            store
                .recover_password(&profile, "не ключ", "новий-пароль", NOW_2)
                .await,
            Err(LocalProfileError::WrongRecoveryKey)
        ));
        assert!(store
            .verify_password(&profile, "старий-пароль")
            .await
            .unwrap());

        // Правильний ключ, введений як завгодно: пароль замінено, профіль активний.
        let typed = key.replace('-', " ").to_lowercase();
        let recovered = store
            .recover_password(&profile, &typed, "новий-пароль", NOW_2)
            .await
            .unwrap();
        assert_eq!(
            recovered.state.active_profile_id.as_deref(),
            Some(profile.as_str())
        );
        assert!(store
            .verify_password(&profile, "новий-пароль")
            .await
            .unwrap());
        assert!(!store
            .verify_password(&profile, "старий-пароль")
            .await
            .unwrap());

        // Використаний ключ більше не діє; виданий натомість діє.
        assert_ne!(recovered.recovery_key, key);
        assert!(matches!(
            store
                .recover_password(&profile, &key, "ще-один-пароль", NOW_2)
                .await,
            Err(LocalProfileError::WrongRecoveryKey)
        ));
        assert!(store
            .recover_password(&profile, &recovered.recovery_key, "ще-один-пароль", NOW_2)
            .await
            .is_ok());
        assert!(store
            .verify_password(&profile, "ще-один-пароль")
            .await
            .unwrap());
    }

    #[tokio::test]
    async fn a_weak_new_password_does_not_spend_the_recovery_key() {
        let store = store().await;
        let (profile, key) = registered(&store, "Слабкий", "старий-пароль").await;
        assert!(matches!(
            store.recover_password(&profile, &key, "12345", NOW_2).await,
            Err(LocalProfileError::InvalidPassword)
        ));
        assert!(store
            .verify_password(&profile, "старий-пароль")
            .await
            .unwrap());
        assert!(store
            .recover_password(&profile, &key, "достатньо-довгий", NOW_2)
            .await
            .is_ok());
    }

    #[tokio::test]
    async fn recovery_is_refused_for_profiles_without_a_key_and_unknown_profiles() {
        let store = store().await;
        // Профіль із паролем, створений до появи ключів: рядка ключа в нього немає.
        let legacy = id("Давній");
        store.create(&legacy, "Давній", NOW_1).await.unwrap();
        store
            .set_password(&legacy, None, Some("давній-пароль"), NOW_1)
            .await
            .unwrap();
        let state = store.list().await.unwrap();
        assert!(state.profiles[0].has_password);
        assert!(!state.profiles[0].has_recovery_key);
        assert!(matches!(
            store
                .recover_password(&legacy, &generate_recovery_key(), "новий-пароль", NOW_2)
                .await,
            Err(LocalProfileError::RecoveryKeyNotSet)
        ));
        assert!(store
            .verify_password(&legacy, "давній-пароль")
            .await
            .unwrap());

        assert!(matches!(
            store
                .recover_password(
                    &id("Невідомий"),
                    &generate_recovery_key(),
                    "новий-пароль",
                    NOW_2
                )
                .await,
            Err(LocalProfileError::ProfileNotFound)
        ));
        assert!(matches!(
            store
                .recover_password("profile-xyz", "ABCDE", "новий-пароль", NOW_2)
                .await,
            Err(LocalProfileError::InvalidProfileId)
        ));
    }

    #[tokio::test]
    async fn a_new_key_needs_the_current_password_and_replaces_the_old_one() {
        let store = store().await;
        let (profile, first_key) = registered(&store, "Ключник", "чинний-пароль").await;
        assert!(matches!(
            store.issue_recovery_key(&profile, "", NOW_2).await,
            Err(LocalProfileError::WrongPassword)
        ));
        assert!(matches!(
            store
                .issue_recovery_key(&profile, "чужий-пароль", NOW_2)
                .await,
            Err(LocalProfileError::WrongPassword)
        ));
        // Невдала спроба не замінила ключ.
        assert!(store
            .recover_password(&profile, &first_key, "чинний-пароль", NOW_2)
            .await
            .map(|issued| issued.recovery_key)
            .is_ok());

        let (profile, first_key) = registered(&store, "Ключник-2", "чинний-пароль").await;
        let second = store
            .issue_recovery_key(&profile, "чинний-пароль", NOW_2)
            .await
            .unwrap();
        assert_ne!(second.recovery_key, first_key);
        assert!(second
            .state
            .profiles
            .iter()
            .any(|candidate| candidate.id == profile && candidate.has_recovery_key));
        assert!(matches!(
            store
                .recover_password(&profile, &first_key, "новий-пароль", NOW_2)
                .await,
            Err(LocalProfileError::WrongRecoveryKey)
        ));
        assert!(store
            .recover_password(&profile, &second.recovery_key, "новий-пароль", NOW_2)
            .await
            .is_ok());
    }

    #[tokio::test]
    async fn a_profile_without_a_password_cannot_get_a_recovery_key() {
        let store = store().await;
        let bare = id("Без пароля");
        store.create(&bare, "Без пароля", NOW_1).await.unwrap();
        assert!(matches!(
            store.issue_recovery_key(&bare, "", NOW_2).await,
            Err(LocalProfileError::PasswordRequired)
        ));
        let left: i64 = sqlx::query_scalar("SELECT count(*) FROM local_profile_recovery")
            .fetch_one(&store.pool)
            .await
            .unwrap();
        assert_eq!(left, 0);
    }

    #[tokio::test]
    async fn deleting_a_profile_removes_its_recovery_key() {
        let store = store().await;
        let (profile, _) = registered(&store, "Тимчасовий", "тимчасовий-пароль").await;
        let before: i64 = sqlx::query_scalar("SELECT count(*) FROM local_profile_recovery")
            .fetch_one(&store.pool)
            .await
            .unwrap();
        assert_eq!(before, 1);
        store.delete(&profile, NOW_2).await.unwrap();
        let after: i64 = sqlx::query_scalar("SELECT count(*) FROM local_profile_recovery")
            .fetch_one(&store.pool)
            .await
            .unwrap();
        assert_eq!(after, 0);
    }
}
