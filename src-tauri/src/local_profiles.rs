use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Algorithm, Argon2, Params,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{Sqlite, SqlitePool, Transaction};

use crate::office_library::{
    self, KdfParams, LibraryError, LibraryStore, PreparedRecovery, PreparedRewrap,
};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex, MutexGuard},
    time::{Duration, Instant},
};

pub const MAX_LOCAL_PROFILES: i64 = 32;
const MAX_PROFILE_NAME_CHARS: usize = 80;
const MAX_POSITION_CHARS: usize = 120;
const MAX_AVATAR_BYTES: usize = 400_000;
const MIN_PASSWORD_CHARS: usize = 6;

/// Модулі, які користувач обирає при реєстрації, у порядку показу на стартовому екрані.
/// `custom` — «Власний модуль» без прив'язки до роду військ (міграція 0021).
pub const MODULES: [&str; 7] = [
    "air",
    "rocket",
    "artillery",
    "army",
    "pvk",
    "dshv",
    "custom",
];
const MAX_PASSWORD_CHARS: usize = 128;

/// Argon2id хеша входу — той самий, що в ключа обгортки бібліотеки (64 МіБ, 3 проходи):
/// інакше з копії бази пароль підбирали б через дешевший хеш входу, а вже знайденим
/// паролем розгортали б ключ бібліотеки. Тести беруть дешеві параметри.
#[cfg(not(test))]
const LOGIN_KDF: KdfParams = KdfParams::PRODUCTION;
#[cfg(test)]
const LOGIN_KDF: KdfParams = KdfParams::FOR_TESTS;

#[derive(Clone, Debug)]
pub struct LocalProfileStore {
    pool: SqlitePool,
    /// Спільний для всіх клонів лічильник невдалих спроб входу: лише в пам'яті цього запуску.
    login_throttle: Arc<LoginThrottle>,
    /// Параметри нових хешів входу; слабший збережений хеш перераховується після входу.
    login_kdf: KdfParams,
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
    /// Армійська авіація: сторінка ПС у власному режимі з власною таблицею (міграція 0022).
    Army,
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
            Branch::Army => "army",
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
            Branch::Army => "армійської авіації",
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
            "army" => Ok(Branch::Army),
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
    pub army: Option<String>,
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
            Branch::Army => &mut self.army,
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
    #[error("забагато невдалих спроб входу, спробуйте знову через {}", format_wait(*.wait_secs))]
    TooManyAttempts { wait_secs: u64 },
    #[error("змінити пароль можна лише після входу в цей профіль")]
    PasswordChangeNeedsSignIn,
    #[error(
        "цей профіль ще без пароля: щоб його встановити, вийдіть із поточного профілю \
         й увійдіть у цей з екрана входу"
    )]
    PasswordSetNeedsSignOut,
    /// Захищена бібліотека профілю (видалення, переобгортання ключа, відновлення).
    #[error(transparent)]
    Library(#[from] LibraryError),
    #[error("у профілю є захищена бібліотека: щоб змінити пароль, введіть чинний пароль")]
    LibraryNeedsCurrentPassword,
}

/// Скільки поспіль неправильних паролів дозволено, перш ніж вхід на деякий час зупиняється.
const FREE_PASSWORD_ATTEMPTS: u32 = 5;
/// Перша пауза після вичерпання вільних спроб; кожна наступна невдача подвоює її.
const FIRST_LOCKOUT: Duration = Duration::from_secs(30);
/// Найдовша пауза між спробами.
const MAX_LOCKOUT: Duration = Duration::from_secs(600);

/// «30 с», «2 хв», «1 хв 30 с».
fn format_wait(secs: u64) -> String {
    if secs < 60 {
        return format!("{secs} с");
    }
    match (secs / 60, secs % 60) {
        (minutes, 0) => format!("{minutes} хв"),
        (minutes, rest) => format!("{minutes} хв {rest} с"),
    }
}

/// Пауза після `failures`-ї поспіль невдачі: 30 с, 60 с, 120 с, ... до [`MAX_LOCKOUT`].
fn lockout_after(failures: u32) -> Option<Duration> {
    let beyond = failures.checked_sub(FREE_PASSWORD_ATTEMPTS)?;
    Some(
        FIRST_LOCKOUT
            .saturating_mul(1u32 << beyond.min(16))
            .min(MAX_LOCKOUT),
    )
}

type Clock = Arc<dyn Fn() -> Instant + Send + Sync>;

#[derive(Default)]
struct AttemptState {
    failures: u32,
    locked_until: Option<Instant>,
}

/// Обмеження спроб входу в Rust: щоб скрипт з вебвью не перебирав паролі швидше за людину.
/// Лічильник окремий для кожного профілю, живе лише в пам'яті процесу (після перезапуску
/// починається заново) і скидається першим правильним паролем. Годинник підміняється в тестах.
pub struct LoginThrottle {
    clock: Clock,
    attempts: Mutex<HashMap<String, AttemptState>>,
}

impl std::fmt::Debug for LoginThrottle {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("LoginThrottle")
            .finish_non_exhaustive()
    }
}

impl Default for LoginThrottle {
    fn default() -> Self {
        Self::with_clock(Arc::new(Instant::now))
    }
}

impl LoginThrottle {
    pub fn with_clock(clock: Clock) -> Self {
        Self {
            clock,
            attempts: Mutex::new(HashMap::new()),
        }
    }

    fn attempts(&self) -> MutexGuard<'_, HashMap<String, AttemptState>> {
        self.attempts
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Дозволяє спробу або каже, скільки ще чекати. Дозволена спроба зараховується як
    /// невдала одразу, ще до перевірки пароля: так паралельні запити не проскочать повз
    /// ліміт, поки перший ще перевіряється. Правильний пароль скидає лічильник через
    /// [`Self::succeeded`]. Відхилені під час паузи спроби не зараховуються.
    fn begin_attempt(&self, profile_id: &str) -> Result<(), LocalProfileError> {
        let now = (self.clock)();
        let mut attempts = self.attempts();
        let state = attempts.entry(profile_id.to_owned()).or_default();
        if let Some(until) = state.locked_until.filter(|until| *until > now) {
            let wait = until.duration_since(now);
            return Err(LocalProfileError::TooManyAttempts {
                wait_secs: wait.as_secs() + u64::from(wait.subsec_nanos() > 0),
            });
        }
        state.failures = state.failures.saturating_add(1);
        state.locked_until = lockout_after(state.failures).map(|pause| now + pause);
        Ok(())
    }

    fn succeeded(&self, profile_id: &str) {
        self.attempts().remove(profile_id);
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
        Self {
            pool,
            login_throttle: Arc::new(LoginThrottle::default()),
            login_kdf: LOGIN_KDF,
        }
    }

    /// Те саме, але з власним годинником для лічильника спроб входу (тести).
    #[cfg(test)]
    fn with_login_clock(pool: SqlitePool, clock: Clock) -> Self {
        Self {
            pool,
            login_throttle: Arc::new(LoginThrottle::with_clock(clock)),
            login_kdf: LOGIN_KDF,
        }
    }

    /// Те саме, але з іншими параметрами нових хешів входу (тести перерахунку).
    #[cfg(test)]
    fn with_login_kdf(pool: SqlitePool, login_kdf: KdfParams) -> Self {
        Self {
            pool,
            login_throttle: Arc::new(LoginThrottle::default()),
            login_kdf,
        }
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

    /// Реєстрація: профіль, пароль, посада, фото й модулі зберігаються одним
    /// кроком, а новий профіль стає активним. Пароль обов'язковий.
    pub async fn register(
        &self,
        new: NewProfile<'_>,
        now: &str,
    ) -> Result<LocalProfilesState, LocalProfileError> {
        validate_profile_id(new.id)?;
        let (display_name, name_key) = normalize_display_name(new.display_name)?;
        let hash = hash_password_blocking(new.password, self.login_kdf).await?;
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
        self.list().await
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

    /// Видаляє профіль. Профіль із захищеною бібліотекою так не видалити (тригер
    /// `local_profiles_library_guard`): помилка [`LibraryError::ProfileDeleteBlocked`]
    /// пропонує окрему дію [`Self::delete_with_library`].
    pub async fn delete(
        &self,
        id: &str,
        now: &str,
    ) -> Result<LocalProfilesState, LocalProfileError> {
        self.delete_profile(id, now, false).await
    }

    /// Видаляє профіль разом із захищеною бібліотекою: криптознищення бібліотеки
    /// ([`LibraryStore::purge_in_transaction`]) і видалення профілю — в одній транзакції,
    /// тож або зникає все, або нічого. Профіль без бібліотеки видаляється як [`Self::delete`].
    pub async fn delete_with_library(
        &self,
        id: &str,
        now: &str,
    ) -> Result<LocalProfilesState, LocalProfileError> {
        self.delete_profile(id, now, true).await
    }

    async fn delete_profile(
        &self,
        id: &str,
        now: &str,
        purge_library: bool,
    ) -> Result<LocalProfilesState, LocalProfileError> {
        validate_profile_id(id)?;
        let mut transaction = self.pool.begin().await?;
        ensure_profile_exists(&mut transaction, id).await?;
        let active_profile_id: Option<String> = sqlx::query_scalar(
            "SELECT active_profile_id FROM local_profile_state WHERE singleton = 1",
        )
        .fetch_one(&mut *transaction)
        .await?;
        if purge_library {
            match LibraryStore::purge_in_transaction(&mut transaction, id, now).await {
                // Бібліотеки немає (або її вже знищено): видаляється лише профіль.
                Ok(_) | Err(LibraryError::NotCreated) => {}
                Err(error) => return Err(error.into()),
            }
        }
        // Каскад прибере метадані модулів дашборда, але не їхні фізичні таблиці.
        crate::dashboard_modules::drop_profile_data_tables(&mut transaction, id).await?;
        // Помилку тригера бібліотеки розпізнаємо до того, як вона стане «Storage».
        sqlx::query("DELETE FROM local_profiles WHERE id = ?")
            .bind(id)
            .execute(&mut *transaction)
            .await
            .map_err(
                |error| match office_library::profile_delete_blocked(&error) {
                    Some(blocked) => LocalProfileError::Library(blocked),
                    None => LocalProfileError::Storage(error),
                },
            )?;
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
    /// Якщо пароль уже є, потрібен чинний пароль (перевірка обмежена так само, як вхід).
    /// Хто має право це викликати для якого профілю, вирішує
    /// [`authorize_password_change`]: сховище сесії не знає.
    ///
    /// `rewrap` — ключ захищеної бібліотеки, заздалегідь загорнутий новим паролем
    /// ([`LibraryStore::prepare_password_rewrap`]): він записується в тій самій транзакції,
    /// що й новий хеш входу, тож пароль і бібліотека не розходяться. Зняти пароль
    /// профілю з бібліотекою не можна.
    pub async fn set_password(
        &self,
        id: &str,
        current_password: Option<&str>,
        new_password: Option<&str>,
        rewrap: Option<&PreparedRewrap>,
        now: &str,
    ) -> Result<LocalProfilesState, LocalProfileError> {
        validate_profile_id(id)?;
        if let Some(rewrap) = rewrap {
            if rewrap.profile_id() != id {
                return Err(LocalProfileError::InvalidProfileId);
            }
            if new_password.is_none() {
                return Err(LocalProfileError::PasswordRequired);
            }
        }
        // Без перерахунку старого хеша: нижче його однаково замінить новий.
        if !self
            .check_password(id, current_password.unwrap_or(""), false)
            .await?
        {
            return Err(LocalProfileError::WrongPassword);
        }
        let hash = match new_password {
            Some(password) => Some(hash_password_blocking(password, self.login_kdf).await?),
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
        if let Some(rewrap) = rewrap {
            rewrap.apply(&mut transaction, now).await?;
        }
        transaction.commit().await?;
        self.list().await
    }

    /// «Забули пароль»: новий пароль профілю за кодом відновлення бібліотеки. Новий хеш
    /// входу й обидва слоти бібліотеки ([`LibraryStore::prepare_recovery`]) записуються
    /// однією транзакцією; лічильник невдалих входів профілю скидається. `new_password` —
    /// той самий пароль, яким готували `recovery`. Після запису нічого вже не може
    /// не вдатися: старий код тоді недійсний, а новий іще має дійти до користувача.
    pub async fn recover_password(
        &self,
        id: &str,
        new_password: &str,
        recovery: &PreparedRecovery,
        now: &str,
    ) -> Result<(), LocalProfileError> {
        validate_profile_id(id)?;
        if recovery.profile_id() != id {
            return Err(LocalProfileError::InvalidProfileId);
        }
        let hash = hash_password_blocking(new_password, self.login_kdf).await?;
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
        recovery.apply(&mut transaction, now).await?;
        transaction.commit().await?;
        self.login_throttle.succeeded(id);
        Ok(())
    }

    /// `true`, якщо профіль без пароля або пароль правильний. Для профілю з паролем
    /// кожна перевірка проходить через [`LoginThrottle`]: після п'яти неправильних
    /// паролів поспіль повертається `TooManyAttempts` із часом очікування. Це єдиний
    /// шлях перевірки пароля, тож вхід і підтвердження чинного пароля при його зміні
    /// діляють один лічильник.
    ///
    /// Правильний пароль до хеша, слабшого за поточні параметри (профіль, створений
    /// раніше), одразу перераховується з поточними параметрами.
    pub async fn verify_password(
        &self,
        id: &str,
        password: &str,
    ) -> Result<bool, LocalProfileError> {
        self.check_password(id, password, true).await
    }

    async fn check_password(
        &self,
        id: &str,
        password: &str,
        upgrade: bool,
    ) -> Result<bool, LocalProfileError> {
        validate_profile_id(id)?;
        let Some(stored) = self.password_hash(id).await? else {
            return Ok(true);
        };
        PasswordHash::new(&stored).map_err(|_| LocalProfileError::PasswordHash)?;
        self.login_throttle.begin_attempt(id)?;
        let target = self.login_kdf;
        let (correct, weaker) = {
            let stored = stored.clone();
            let password = zeroize::Zeroizing::new(password.as_bytes().to_vec());
            tokio::task::spawn_blocking(move || {
                let Ok(parsed) = PasswordHash::new(&stored) else {
                    return (false, false);
                };
                let correct = Argon2::default()
                    .verify_password(&password, &parsed)
                    .is_ok();
                (correct, correct && hash_is_weaker(&parsed, target))
            })
            .await
            .map_err(|_| LocalProfileError::PasswordHash)?
        };
        if correct {
            self.login_throttle.succeeded(id);
            if upgrade && weaker {
                self.upgrade_password_hash(id, password, &stored).await;
            }
        }
        Ok(correct)
    }

    /// Перераховує хеш входу з поточними параметрами, якщо його тим часом ніхто не
    /// змінив (умова `password_hash = старий` — у тому самому записі). Невдача не
    /// заважає входу: старий хеш лишається й буде перерахований наступного разу.
    async fn upgrade_password_hash(&self, id: &str, password: &str, stored: &str) {
        let upgraded = async {
            let hash = hash_password_blocking(password, self.login_kdf).await?;
            sqlx::query(
                "UPDATE local_profile_details SET password_hash = ?
                 WHERE profile_id = ? AND password_hash = ?",
            )
            .bind(hash)
            .bind(id)
            .bind(stored)
            .execute(&self.pool)
            .await?;
            Ok::<_, LocalProfileError>(())
        }
        .await;
        if let Err(error) = upgraded {
            eprintln!("EasyWAR: хеш пароля профілю не перераховано: {error}");
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

    /// Шляхи всіх таблиць, прив'язаних до будь-якого профілю (EasyGreen їх не перезаписує).
    /// Таблиці, прив'язані до цього профілю (усі роди військ).
    pub async fn profile_table_paths(&self, id: &str) -> Result<Vec<String>, LocalProfileError> {
        validate_profile_id(id)?;
        Ok(sqlx::query_scalar(
            "SELECT path FROM local_profile_tables WHERE profile_id = ? ORDER BY path",
        )
        .bind(id)
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn all_table_paths(&self) -> Result<Vec<String>, LocalProfileError> {
        Ok(
            sqlx::query_scalar("SELECT path FROM local_profile_tables ORDER BY path")
                .fetch_all(&self.pool)
                .await?,
        )
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

/// Довжина пароля профілю (6–128 символів). Перевіряється до повільного KDF бібліотеки.
pub(crate) fn validate_password(password: &str) -> Result<(), LocalProfileError> {
    let count = password.chars().count();
    if !(MIN_PASSWORD_CHARS..=MAX_PASSWORD_CHARS).contains(&count) {
        return Err(LocalProfileError::InvalidPassword);
    }
    Ok(())
}

fn hash_password(password: &[u8], kdf: KdfParams) -> Result<String, LocalProfileError> {
    let salt = SaltString::generate(&mut OsRng);
    kdf.argon2()
        .map_err(|_| LocalProfileError::PasswordHash)?
        .hash_password(password, &salt)
        .map(|hash| hash.to_string())
        .map_err(|_| LocalProfileError::PasswordHash)
}

/// Хеш входу в пулі блокувальних задач: Argon2id з робочими параметрами триває до
/// секунди й не має займати потік асинхронного виконавця.
async fn hash_password_blocking(
    password: &str,
    kdf: KdfParams,
) -> Result<String, LocalProfileError> {
    validate_password(password)?;
    let password = zeroize::Zeroizing::new(password.as_bytes().to_vec());
    tokio::task::spawn_blocking(move || hash_password(&password, kdf))
        .await
        .map_err(|_| LocalProfileError::PasswordHash)?
}

/// Чи збережений хеш слабший за `target`: інший алгоритм, менше пам'яті чи проходів.
fn hash_is_weaker(hash: &PasswordHash<'_>, target: KdfParams) -> bool {
    if !matches!(Algorithm::try_from(hash.algorithm), Ok(Algorithm::Argon2id)) {
        return true;
    }
    match Params::try_from(hash) {
        Ok(params) => params.m_cost() < target.m_kib || params.t_cost() < target.t,
        Err(_) => true,
    }
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

/// Чи можна зараз встановити або змінити пароль профілю, виходячи з поточної сесії
/// (`session_profile` — профіль, у який увійшли в цьому запуску).
///
/// - Профіль із паролем: лише з відкритої сесії цього ж профілю (і з чинним паролем,
///   який перевіряє [`LocalProfileStore::set_password`]).
/// - Профіль без пароля (залишився з версій до обов'язкового пароля): лише з власної
///   сесії або поки ніхто не ввійшов. Другий випадок — екран входу, який просить такий
///   профіль встановити пароль перед першим входом; чужий профіль без пароля з
///   відкритої сесії іншого користувача змінити не можна.
pub fn authorize_password_change(
    has_password: bool,
    session_profile: Option<&str>,
    profile_id: &str,
) -> Result<(), LocalProfileError> {
    let own_session = session_profile == Some(profile_id);
    match (has_password, session_profile) {
        (true, _) if own_session => Ok(()),
        (true, _) => Err(LocalProfileError::PasswordChangeNeedsSignIn),
        (false, None) => Ok(()),
        (false, Some(_)) if own_session => Ok(()),
        (false, Some(_)) => Err(LocalProfileError::PasswordSetNeedsSignOut),
    }
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
        ARMY_AVIATION_SQL, COMMAND_TABLES_SQL, CUSTOM_MODULE_SQL, DASHBOARD_MODULES_SQL,
        DASHBOARD_MODULE_CORRECTIONS_SQL, DASHBOARD_MODULE_CORRECTION_STATUS_SQL,
        DASHBOARD_MODULE_STYLE_SQL, INITIAL_SCHEMA_SQL, LOCAL_PROFILES_SQL, OWN_LOSSES_TABLES_SQL,
        PROFILE_BRANCH_TABLES_SQL, PROFILE_DETAILS_SQL, PROFILE_MODULES_SQL,
        XLSX_DUPLICATE_LINKS_SQL,
    };
    use sqlx::sqlite::SqlitePoolOptions;

    const NOW_1: &str = "2026-01-01T00:00:00Z";
    const NOW_2: &str = "2026-01-02T00:00:00Z";

    async fn store() -> LocalProfileStore {
        LocalProfileStore::new(migrated_pool().await)
    }

    async fn migrated_pool() -> SqlitePool {
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
        for migration in [
            DASHBOARD_MODULES_SQL,
            DASHBOARD_MODULE_CORRECTIONS_SQL,
            DASHBOARD_MODULE_STYLE_SQL,
            DASHBOARD_MODULE_CORRECTION_STATUS_SQL,
            CUSTOM_MODULE_SQL,
            ARMY_AVIATION_SQL,
        ] {
            sqlx::raw_sql(migration).execute(&pool).await.unwrap();
        }
        pool
    }

    /// Рукотворний годинник: час іде лише тоді, коли тест його посуває.
    #[derive(Clone)]
    struct FakeClock {
        base: Instant,
        offset: Arc<Mutex<Duration>>,
    }

    impl FakeClock {
        fn new() -> Self {
            Self {
                base: Instant::now(),
                offset: Arc::new(Mutex::new(Duration::ZERO)),
            }
        }

        fn advance(&self, by: Duration) {
            *self.offset.lock().unwrap() += by;
        }

        fn as_clock(&self) -> Clock {
            let clock = self.clone();
            Arc::new(move || clock.base + *clock.offset.lock().unwrap())
        }
    }

    async fn store_with_fake_clock() -> (LocalProfileStore, FakeClock) {
        let clock = FakeClock::new();
        let store = LocalProfileStore::with_login_clock(migrated_pool().await, clock.as_clock());
        (store, clock)
    }

    fn secs(value: u64) -> Duration {
        Duration::from_secs(value)
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
            store
                .set_password(&profile, None, Some("123"), None, NOW_2)
                .await,
            Err(LocalProfileError::InvalidPassword)
        ));
        let state = store
            .set_password(&profile, None, Some("секрет"), None, NOW_2)
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
                .set_password(&profile, Some("інший"), None, None, NOW_2)
                .await,
            Err(LocalProfileError::WrongPassword)
        ));
        let state = store
            .set_password(&profile, Some("секрет"), None, None, NOW_2)
            .await
            .unwrap();
        assert!(!state.profiles[0].has_password);
    }

    #[tokio::test]
    async fn sign_in_rehashes_a_weaker_login_hash_in_place() {
        let pool = migrated_pool().await;
        let weak = LocalProfileStore::new(pool.clone());
        let profile = id("Перерахунок");
        weak.create(&profile, "Перерахунок", NOW_1).await.unwrap();
        weak.set_password(&profile, None, Some("секрет"), None, NOW_2)
            .await
            .unwrap();
        let stored = || async {
            sqlx::query_scalar::<_, String>(
                "SELECT password_hash FROM local_profile_details WHERE profile_id = ?",
            )
            .bind(&profile)
            .fetch_one(&pool)
            .await
            .unwrap()
        };
        let old = stored().await;
        assert!(old.contains("$m=8,t=1,p=1$"), "{old}");

        let strong = LocalProfileStore::with_login_kdf(
            pool.clone(),
            KdfParams {
                m_kib: 16,
                t: 2,
                p: 1,
            },
        );
        assert!(!strong.verify_password(&profile, "інший").await.unwrap());
        assert_eq!(stored().await, old, "хибний пароль нічого не перераховує");
        assert!(strong.verify_password(&profile, "секрет").await.unwrap());
        let upgraded = stored().await;
        assert!(
            upgraded.starts_with("$argon2id$v=19$m=16,t=2,p=1$"),
            "{upgraded}"
        );
        assert!(strong.verify_password(&profile, "секрет").await.unwrap());
        assert_eq!(stored().await, upgraded, "достатньо сильний хеш лишається");
        // Слабші параметри ніколи не послаблюють наявний хеш.
        assert!(weak.verify_password(&profile, "секрет").await.unwrap());
        assert_eq!(stored().await, upgraded);
        // Нові хеші одразу з параметрами сховища.
        strong
            .set_password(&profile, Some("секрет"), Some("новий секрет"), None, NOW_2)
            .await
            .unwrap();
        assert!(stored().await.starts_with("$argon2id$v=19$m=16,t=2,p=1$"));
        assert_eq!(LOGIN_KDF, KdfParams::FOR_TESTS);
    }

    fn wait_of(result: Result<(), LocalProfileError>) -> u64 {
        match result {
            Err(LocalProfileError::TooManyAttempts { wait_secs }) => wait_secs,
            other => panic!("очікувалась пауза, а вийшло {other:?}"),
        }
    }

    #[test]
    fn lockout_schedule_starts_after_five_failures_doubles_and_is_capped() {
        for failures in 0..5 {
            assert_eq!(lockout_after(failures), None, "{failures}");
        }
        let schedule = (5..=11)
            .map(|failures| lockout_after(failures).unwrap().as_secs())
            .collect::<Vec<_>>();
        assert_eq!(schedule, [30, 60, 120, 240, 480, 600, 600]);
        assert_eq!(lockout_after(u32::MAX), Some(MAX_LOCKOUT));
    }

    #[test]
    fn wait_is_written_in_seconds_and_minutes() {
        assert_eq!(format_wait(1), "1 с");
        assert_eq!(format_wait(30), "30 с");
        assert_eq!(format_wait(60), "1 хв");
        assert_eq!(format_wait(90), "1 хв 30 с");
        assert_eq!(format_wait(600), "10 хв");
    }

    #[test]
    fn throttle_pauses_after_five_attempts_escalates_and_ignores_rejected_ones() {
        let clock = FakeClock::new();
        let throttle = LoginThrottle::with_clock(clock.as_clock());
        let profile = id("Перебір");
        let other = id("Сусід");

        // П'ять спроб вільні; п'ята, якщо хибна, вмикає першу паузу.
        for _ in 0..5 {
            throttle.begin_attempt(&profile).unwrap();
        }
        assert_eq!(wait_of(throttle.begin_attempt(&profile)), 30);
        // Відхилені спроби не зараховуються і паузу не подовжують; лишок округлюється вгору.
        clock.advance(Duration::from_millis(29_500));
        assert_eq!(wait_of(throttle.begin_attempt(&profile)), 1);
        // Інший профіль лічильник не зачіпає.
        throttle.begin_attempt(&other).unwrap();

        // Рівно через 30 с спроба знову можлива, і кожна наступна невдача подвоює паузу.
        clock.advance(Duration::from_millis(500));
        throttle.begin_attempt(&profile).unwrap();
        for expected in [60, 120, 240, 480, 600, 600] {
            assert_eq!(wait_of(throttle.begin_attempt(&profile)), expected);
            clock.advance(secs(expected));
            throttle.begin_attempt(&profile).unwrap();
        }
    }

    #[test]
    fn first_good_password_clears_the_throttle() {
        let clock = FakeClock::new();
        let throttle = LoginThrottle::with_clock(clock.as_clock());
        let profile = id("Скидання");
        for _ in 0..5 {
            throttle.begin_attempt(&profile).unwrap();
        }
        assert_eq!(wait_of(throttle.begin_attempt(&profile)), 30);
        clock.advance(secs(30));
        throttle.begin_attempt(&profile).unwrap();
        throttle.succeeded(&profile);
        // Лічильник почався заново: знову п'ять вільних спроб, а перша пауза — 30 с.
        for _ in 0..5 {
            throttle.begin_attempt(&profile).unwrap();
        }
        assert_eq!(wait_of(throttle.begin_attempt(&profile)), 30);
    }

    #[tokio::test]
    async fn login_pauses_after_five_wrong_passwords_and_a_good_one_resets_it() {
        let (store, clock) = store_with_fake_clock().await;
        let profile = id("Вхід");
        store.create(&profile, "Вхід", NOW_1).await.unwrap();
        store
            .set_password(&profile, None, Some("секрет"), None, NOW_2)
            .await
            .unwrap();

        for _ in 0..5 {
            assert!(!store.verify_password(&profile, "хибний").await.unwrap());
        }
        // Під час паузи не пускає навіть правильний пароль.
        let error = store.verify_password(&profile, "секрет").await.unwrap_err();
        assert!(matches!(
            error,
            LocalProfileError::TooManyAttempts { wait_secs: 30 }
        ));
        let text = error.to_string();
        assert!(text.contains("30 с"), "{text}");
        // Інтерфейс замінює повідомлення про неправильний пароль коротким підписом, тож
        // текст про паузу не повинен під нього підпадати: час очікування має дійти до людини.
        assert!(
            !text.to_lowercase().contains("неправильний пароль"),
            "{text}"
        );

        clock.advance(secs(29));
        assert_eq!(
            store
                .verify_password(&profile, "секрет")
                .await
                .unwrap_err()
                .to_string(),
            "забагато невдалих спроб входу, спробуйте знову через 1 с"
        );
        clock.advance(secs(1));
        assert!(store.verify_password(&profile, "секрет").await.unwrap());
        // Правильний пароль скинув лічильник: наступна хибна спроба проходить без паузи.
        assert!(!store.verify_password(&profile, "хибний").await.unwrap());
    }

    #[tokio::test]
    async fn guessing_the_current_password_through_set_password_shares_the_pause() {
        let (store, clock) = store_with_fake_clock().await;
        let profile = id("Зміна");
        store.create(&profile, "Зміна", NOW_1).await.unwrap();
        store
            .set_password(&profile, None, Some("секрет"), None, NOW_2)
            .await
            .unwrap();

        for _ in 0..5 {
            assert!(matches!(
                store
                    .set_password(&profile, Some("хибний"), Some("новий-пароль"), None, NOW_2)
                    .await,
                Err(LocalProfileError::WrongPassword)
            ));
        }
        assert!(matches!(
            store
                .set_password(&profile, Some("секрет"), Some("новий-пароль"), None, NOW_2)
                .await,
            Err(LocalProfileError::TooManyAttempts { .. })
        ));
        assert!(matches!(
            store.verify_password(&profile, "секрет").await,
            Err(LocalProfileError::TooManyAttempts { .. })
        ));
        // Пароль не змінився.
        clock.advance(secs(30));
        assert!(store.verify_password(&profile, "секрет").await.unwrap());
    }

    #[tokio::test]
    async fn profile_without_a_password_is_never_paused() {
        let (store, _clock) = store_with_fake_clock().await;
        let profile = id("Старий");
        store.create(&profile, "Старий", NOW_1).await.unwrap();
        // Профілі без пароля (з версій до обов'язкового пароля) і далі приймають будь-що:
        // це відома межа, яку закриває примусове встановлення пароля при вході.
        for attempt in 0..8 {
            assert!(store
                .verify_password(&profile, &format!("будь-що-{attempt}"))
                .await
                .unwrap());
        }
    }

    #[test]
    fn password_change_is_tied_to_the_session() {
        let own = id("Свій");
        let other = id("Чужий");
        // Профіль із паролем: лише з власної відкритої сесії.
        assert!(authorize_password_change(true, Some(&own), &own).is_ok());
        assert!(matches!(
            authorize_password_change(true, None, &own),
            Err(LocalProfileError::PasswordChangeNeedsSignIn)
        ));
        assert!(matches!(
            authorize_password_change(true, Some(&other), &own),
            Err(LocalProfileError::PasswordChangeNeedsSignIn)
        ));
        // Профіль без пароля: власна сесія або екран входу (ніхто не ввійшов).
        assert!(authorize_password_change(false, Some(&own), &own).is_ok());
        assert!(authorize_password_change(false, None, &own).is_ok());
        let error = authorize_password_change(false, Some(&other), &own).unwrap_err();
        assert!(matches!(error, LocalProfileError::PasswordSetNeedsSignOut));
        assert!(error.to_string().contains("вийдіть"), "{error}");
    }

    #[tokio::test]
    async fn legacy_profile_gets_its_first_password_before_sign_in_but_only_once() {
        // Екран входу просить профіль без пароля встановити його перед першим входом.
        let store = store().await;
        let profile = id("Спадок");
        store.create(&profile, "Спадок", NOW_1).await.unwrap();
        assert!(!store.has_password(&profile).await.unwrap());
        authorize_password_change(false, None, &profile).unwrap();
        let state = store
            .set_password(&profile, None, Some("перший-пароль"), None, NOW_2)
            .await
            .unwrap();
        assert!(state.profiles[0].has_password);
        assert!(store
            .verify_password(&profile, "перший-пароль")
            .await
            .unwrap());
        // Вдруге без входу той самий виклик уже відхиляється.
        assert!(store.has_password(&profile).await.unwrap());
        assert!(matches!(
            authorize_password_change(true, None, &profile),
            Err(LocalProfileError::PasswordChangeNeedsSignIn)
        ));
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
                "army": null,
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
        assert_eq!(Branch::parse("army").unwrap(), Branch::Army);
        assert_eq!(Branch::Army.as_str(), "army");
        assert_eq!(Branch::parse("pvk").unwrap(), Branch::Pvk);
        assert_eq!(Branch::parse("dshv").unwrap(), Branch::Dshv);
        assert_eq!(Branch::parse("pvk_losses").unwrap(), Branch::PvkLosses);
        assert_eq!(Branch::parse("dshv_losses").unwrap(), Branch::DshvLosses);
        assert_eq!(Branch::PvkLosses.as_str(), "pvk_losses");
        assert_eq!(Branch::DshvLosses.as_str(), "dshv_losses");
        assert!(matches!(
            Branch::parse("navy"),
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
    async fn all_table_paths_lists_every_profile_binding() {
        let store = store().await;
        assert!(store.all_table_paths().await.unwrap().is_empty());
        let first = id("Перший");
        let second = id("Другий");
        store.create(&first, "Перший", NOW_1).await.unwrap();
        store.create(&second, "Другий", NOW_1).await.unwrap();
        store
            .set_table_path(&first, Branch::Air, Some("/synthetic/b.xlsx"), NOW_2)
            .await
            .unwrap();
        store
            .set_table_path(&second, Branch::Pvk, Some("/synthetic/a.xlsx"), NOW_2)
            .await
            .unwrap();
        assert_eq!(
            store.all_table_paths().await.unwrap(),
            ["/synthetic/a.xlsx", "/synthetic/b.xlsx"]
        );
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
        let state = store
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
        let unknown = modules(&["air", "navy"]);
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
            .unwrap();
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
                .set_modules(&profile, &modules(&["navy"]), NOW_2)
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
        let state = LocalProfileStore::new(pool.clone()).list().await.unwrap();
        // До 0021 профіль має п'ять модулів; `custom` додає міграція 0021.
        assert_eq!(
            state.profiles[0].modules,
            ["air", "rocket", "artillery", "pvk", "dshv"]
        );
        // Невідомий модуль схема відхиляє.
        assert!(sqlx::query(
            "INSERT INTO local_profile_modules (profile_id, module) VALUES (?, 'army')"
        )
        .bind(&profile)
        .execute(&pool)
        .await
        .is_err());
    }

    // --- Захищена бібліотека профілю (повна схема з міграціями 0013–0015) ----------

    const OLD_PASSWORD: &str = "синтетичний-пароль-1";
    const NEW_PASSWORD: &str = "синтетичний-пароль-2";

    /// Профіль з паролем і створеною бібліотекою на повній схемі міграцій.
    async fn profile_with_library(
        with_recovery: bool,
    ) -> (
        LocalProfileStore,
        LibraryStore,
        String,
        office_library::CreatedLibrary,
    ) {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        crate::database::embedded_migrator()
            .run(&pool)
            .await
            .unwrap();
        let store = LocalProfileStore::new(pool.clone());
        let profile = id("Бібліотека");
        store.create(&profile, "Бібліотека", NOW_1).await.unwrap();
        store
            .set_password(&profile, None, Some(OLD_PASSWORD), None, NOW_1)
            .await
            .unwrap();
        let library = LibraryStore::with_kdf(pool, office_library::KdfParams::FOR_TESTS);
        let created = library
            .create(&profile, OLD_PASSWORD, with_recovery, NOW_1)
            .await
            .unwrap();
        (store, library, profile, created)
    }

    #[tokio::test]
    async fn a_profile_with_a_library_is_deleted_only_together_with_it() {
        let (store, library, profile, _) = profile_with_library(false).await;
        let error = store.delete(&profile, NOW_2).await.unwrap_err();
        assert!(matches!(
            error,
            LocalProfileError::Library(LibraryError::ProfileDeleteBlocked)
        ));
        assert_eq!(
            error.to_string(),
            "у профілю є захищена бібліотека; видаліть профіль разом з бібліотекою окремою дією"
        );
        assert_eq!(store.list().await.unwrap().profiles.len(), 1);
        assert!(library.has_active_keyring(&profile).await.unwrap());

        let state = store.delete_with_library(&profile, NOW_2).await.unwrap();
        assert!(state.profiles.is_empty());
        assert_eq!(state.active_profile_id, None);
        let keyring: String =
            sqlx::query_scalar("SELECT state FROM library_keyrings WHERE profile_id = ?")
                .bind(&profile)
                .fetch_one(&store.pool)
                .await
                .unwrap();
        assert_eq!(keyring, "shredded");
        let purges: i64 =
            sqlx::query_scalar("SELECT count(*) FROM library_purges WHERE profile_id = ?")
                .bind(&profile)
                .fetch_one(&store.pool)
                .await
                .unwrap();
        assert_eq!(purges, 1);
    }

    #[tokio::test]
    async fn delete_with_library_also_removes_a_profile_without_one() {
        let (store, _, profile, _) = profile_with_library(false).await;
        let plain = id("Без бібліотеки");
        store.create(&plain, "Без бібліотеки", NOW_1).await.unwrap();
        let state = store.delete_with_library(&plain, NOW_2).await.unwrap();
        assert_eq!(state.profiles.len(), 1);
        assert_eq!(state.profiles[0].id, profile);
        assert!(matches!(
            store.delete_with_library(&plain, NOW_2).await,
            Err(LocalProfileError::ProfileNotFound)
        ));
    }

    #[tokio::test]
    async fn a_password_change_rewraps_the_library_in_the_same_transaction() {
        let (store, library, profile, _) = profile_with_library(false).await;
        let rewrap = library
            .prepare_password_rewrap(&profile, OLD_PASSWORD, NEW_PASSWORD)
            .await
            .unwrap()
            .expect("у профілю є бібліотека");
        let stale = library
            .prepare_password_rewrap(&profile, OLD_PASSWORD, "синтетичний-пароль-3")
            .await
            .unwrap()
            .unwrap();
        store
            .set_password(
                &profile,
                Some(OLD_PASSWORD),
                Some(NEW_PASSWORD),
                Some(&rewrap),
                NOW_2,
            )
            .await
            .unwrap();
        assert!(store.verify_password(&profile, NEW_PASSWORD).await.unwrap());
        assert!(library.unlock(&profile, NEW_PASSWORD, NOW_2).await.is_ok());
        assert!(matches!(
            library.unlock(&profile, OLD_PASSWORD, NOW_2).await,
            Err(LibraryError::WrongPassword)
        ));

        // Застаріла обгортка (ключ уже переобгорнуто) скасовує й зміну хеша входу.
        let error = store
            .set_password(
                &profile,
                Some(NEW_PASSWORD),
                Some("синтетичний-пароль-3"),
                Some(&stale),
                NOW_2,
            )
            .await
            .unwrap_err();
        assert!(matches!(
            error,
            LocalProfileError::Library(LibraryError::KeyringChanged)
        ));
        assert!(store.verify_password(&profile, NEW_PASSWORD).await.unwrap());
        assert!(library.unlock(&profile, NEW_PASSWORD, NOW_2).await.is_ok());

        // Обгортка чужого профілю чи зняття пароля з бібліотекою не приймаються.
        let other = id("Інший");
        store.create(&other, "Інший", NOW_1).await.unwrap();
        let next = library
            .prepare_password_rewrap(&profile, NEW_PASSWORD, OLD_PASSWORD)
            .await
            .unwrap()
            .unwrap();
        assert!(matches!(
            store
                .set_password(&other, None, Some(OLD_PASSWORD), Some(&next), NOW_2)
                .await,
            Err(LocalProfileError::InvalidProfileId)
        ));
        assert!(matches!(
            store
                .set_password(&profile, Some(NEW_PASSWORD), None, Some(&next), NOW_2)
                .await,
            Err(LocalProfileError::PasswordRequired)
        ));
        assert!(store.verify_password(&profile, NEW_PASSWORD).await.unwrap());
    }

    #[tokio::test]
    async fn recovery_sets_a_new_password_and_rotates_the_code() {
        let (store, library, profile, created) = profile_with_library(true).await;
        let old_code = created.recovery_code.expect("код відновлення");
        let prepared = library
            .prepare_recovery(&profile, old_code.as_str(), NEW_PASSWORD)
            .await
            .unwrap();
        assert!(matches!(
            store
                .recover_password(&profile, "123", &prepared, NOW_2)
                .await,
            Err(LocalProfileError::InvalidPassword)
        ));
        assert!(store.verify_password(&profile, OLD_PASSWORD).await.unwrap());
        store
            .recover_password(&profile, NEW_PASSWORD, &prepared, NOW_2)
            .await
            .unwrap();
        assert!(store.verify_password(&profile, NEW_PASSWORD).await.unwrap());
        assert!(!store.verify_password(&profile, OLD_PASSWORD).await.unwrap());
        let (keys, new_code) = prepared.into_parts();
        assert_eq!(keys.profile_id(), profile);
        assert_ne!(new_code.as_str(), old_code.as_str());
        assert!(library.unlock(&profile, NEW_PASSWORD, NOW_2).await.is_ok());
        assert!(library
            .prepare_recovery(&profile, old_code.as_str(), OLD_PASSWORD)
            .await
            .is_err());
        assert!(library
            .prepare_recovery(&profile, new_code.as_str(), OLD_PASSWORD)
            .await
            .is_ok());
    }

    #[test]
    fn password_length_is_checked_before_the_library_kdf() {
        assert!(matches!(
            validate_password("12345"),
            Err(LocalProfileError::InvalidPassword)
        ));
        assert!(validate_password("123456").is_ok());
        assert!(validate_password(&"x".repeat(129)).is_err());
    }
}
