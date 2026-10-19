//! The optional local language model of the КОМБАТ assistant.
//!
//! The model never runs inside the application: a model package supplied by
//! the user holds a small runner program and a model file, and the runner is
//! started as a child process from a fixed path, without a shell and without a
//! network port. Rust and the runner talk through bounded JSON lines on
//! stdin/stdout. Only one request runs at a time, the runner is killed on
//! cancel, on timeout and after a period of idleness, and every failure leaves
//! the assistant with its exact answers. The package is checked by SHA-256
//! before it is trusted. This module itself never touches the network and stores
//! no question: the optional download of the model file lives in
//! [`crate::model_install`] and starts only after an explicit user action.
//!
//! Runner protocol (one JSON object per line):
//! * runner → app, once the model is loaded: `{"ready":true}`
//! * app → runner: `{"id":N,"system":"…","messages":[{"role":"user","content":"…"}],"max_tokens":160}`
//! * runner → app: `{"id":N,"token":"…"}` repeated, then `{"id":N,"done":true}`
//!   or `{"id":N,"error":"…"}`.

use std::{
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, RecvTimeoutError},
        Arc, Mutex,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::repository::{RepositoryError, SettingUpdate, SettingsStore};

pub const LOCAL_MODEL_SETTINGS_KEY: &str = "app.local_model.v1";
const SETTINGS_SCHEMA_VERSION: u32 = 1;
const MANIFEST_FILE: &str = "manifest.json";
const MAX_MANIFEST_BYTES: u64 = 16 * 1024;
const MAX_RUNNER_BYTES: u64 = 256 * 1024 * 1024;
const MAX_MODEL_BYTES: u64 = 8 * 1024 * 1024 * 1024;
const MAX_LINE_BYTES: usize = 64 * 1024;
const MAX_ANSWER_CHARS: usize = 4000;
const POLL: Duration = Duration::from_millis(40);

#[derive(Debug, Error)]
pub enum ModelError {
    #[error("Локальну модель не налаштовано")]
    NotConfigured,
    #[error("Локальну модель не ввімкнено в налаштуваннях")]
    Disabled,
    #[error("Пакет моделі: {0}")]
    Package(String),
    #[error("Пакет моделі змінився після перевірки; перевірте його знову")]
    Changed,
    #[error("Модель уже відповідає на інше запитання")]
    Busy,
    #[error("Запит до моделі некоректний: {0}")]
    Request(String),
    #[error("Модель не вдалося запустити: {0}")]
    Start(String),
    #[error("Час очікування моделі вичерпано")]
    Timeout,
    #[error("Відповідь зупинено")]
    Cancelled,
    #[error("Модель повернула неприпустиму відповідь: {0}")]
    Protocol(String),
    #[error("Модель не завантажена")]
    NotLoaded,
    #[error(transparent)]
    Store(#[from] RepositoryError),
}

// ---------------------------------------------------------------- package --

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PackageFile {
    pub file: String,
    pub sha256: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PackageManifest {
    pub schema: u32,
    pub name: String,
    pub platform: String,
    pub runner: PackageFile,
    pub model: PackageFile,
    pub context_tokens: u32,
}

/// A package whose files were checked. Paths are absolute and only built from a
/// plain file name inside the directory the user chose.
#[derive(Debug, Clone)]
pub struct VerifiedPackage {
    pub dir: PathBuf,
    pub manifest: PackageManifest,
    pub manifest_sha256: String,
    pub runner_path: PathBuf,
    pub model_path: PathBuf,
    pub model_size: u64,
    pub model_modified: u64,
}

pub fn current_platform() -> String {
    format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH)
}

fn plain_file_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 80
        && !name.starts_with('.')
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

fn is_sha256_hex(value: &str) -> bool {
    value.len() == 64 && value.chars().all(|c| c.is_ascii_hexdigit())
}

pub fn sha256_file(path: &Path) -> std::io::Result<String> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

fn modified_seconds(metadata: &std::fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |elapsed| elapsed.as_secs())
}

fn regular_file(path: &Path, label: &str, limit: u64) -> Result<std::fs::Metadata, ModelError> {
    // symlink_metadata: a link is never followed out of the package directory.
    let metadata = std::fs::symlink_metadata(path)
        .map_err(|_| ModelError::Package(format!("немає файлу {label}")))?;
    if !metadata.is_file() {
        return Err(ModelError::Package(format!(
            "{label} має бути звичайним файлом"
        )));
    }
    if metadata.len() == 0 || metadata.len() > limit {
        return Err(ModelError::Package(format!(
            "{label} має неприпустимий розмір"
        )));
    }
    Ok(metadata)
}

pub fn read_manifest(dir: &Path) -> Result<(PackageManifest, String), ModelError> {
    let path = dir.join(MANIFEST_FILE);
    regular_file(&path, "manifest.json", MAX_MANIFEST_BYTES)?;
    let bytes = std::fs::read(&path)
        .map_err(|_| ModelError::Package("manifest.json не читається".into()))?;
    let manifest: PackageManifest = serde_json::from_slice(&bytes)
        .map_err(|_| ModelError::Package("manifest.json має неправильну форму".into()))?;
    if manifest.schema != 1 {
        return Err(ModelError::Package(
            "непідтримувана версія маніфесту".into(),
        ));
    }
    let name = manifest.name.trim();
    if name.is_empty() || name.chars().count() > 80 || name.chars().any(char::is_control) {
        return Err(ModelError::Package("некоректна назва моделі".into()));
    }
    if manifest.platform != current_platform() {
        return Err(ModelError::Package(format!(
            "пакет призначений для {}, а цей комп'ютер — {}",
            manifest.platform,
            current_platform()
        )));
    }
    for (label, file) in [("рушія", &manifest.runner), ("моделі", &manifest.model)] {
        if !plain_file_name(&file.file) || file.file == MANIFEST_FILE {
            return Err(ModelError::Package(format!(
                "некоректне ім'я файлу {label}"
            )));
        }
        if !is_sha256_hex(&file.sha256) {
            return Err(ModelError::Package(format!(
                "некоректна сума SHA-256 {label}"
            )));
        }
    }
    if manifest.runner.file == manifest.model.file {
        return Err(ModelError::Package(
            "рушій і модель мають бути різними файлами".into(),
        ));
    }
    if !(512..=4096).contains(&manifest.context_tokens) {
        return Err(ModelError::Package(
            "розмір контексту поза межами 512–4096".into(),
        ));
    }
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let manifest_sha256 = hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    Ok((manifest, manifest_sha256))
}

/// Full check: structure, file kinds and sizes, and SHA-256 of the runner and of the model.
pub fn verify_package(dir: &Path) -> Result<VerifiedPackage, ModelError> {
    let dir =
        std::fs::canonicalize(dir).map_err(|_| ModelError::Package("папку не знайдено".into()))?;
    let (manifest, manifest_sha256) = read_manifest(&dir)?;
    let runner_path = dir.join(&manifest.runner.file);
    let model_path = dir.join(&manifest.model.file);
    regular_file(&runner_path, "рушій", MAX_RUNNER_BYTES)?;
    let model_meta = regular_file(&model_path, "модель", MAX_MODEL_BYTES)?;
    let runner_hash =
        sha256_file(&runner_path).map_err(|_| ModelError::Package("рушій не читається".into()))?;
    if !runner_hash.eq_ignore_ascii_case(&manifest.runner.sha256) {
        return Err(ModelError::Package(
            "SHA-256 рушія не збігається з маніфестом".into(),
        ));
    }
    let model_hash =
        sha256_file(&model_path).map_err(|_| ModelError::Package("модель не читається".into()))?;
    if !model_hash.eq_ignore_ascii_case(&manifest.model.sha256) {
        return Err(ModelError::Package(
            "SHA-256 моделі не збігається з маніфестом".into(),
        ));
    }
    Ok(VerifiedPackage {
        dir,
        manifest,
        manifest_sha256,
        runner_path,
        model_path,
        model_size: model_meta.len(),
        model_modified: modified_seconds(&model_meta),
    })
}

// --------------------------------------------------------------- settings --

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct LocalModelSettings {
    pub package_dir: Option<String>,
    pub enabled: bool,
    pub manifest_sha256: Option<String>,
    pub model_size: u64,
    pub model_modified: u64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct StoredSettings {
    schema_version: u32,
    package_dir: Option<String>,
    enabled: bool,
    manifest_sha256: Option<String>,
    model_size: u64,
    model_modified: u64,
}

#[derive(Clone, Debug)]
pub struct LocalModelStore {
    settings: SettingsStore,
}

impl LocalModelStore {
    pub fn new(settings: SettingsStore) -> Self {
        Self { settings }
    }

    /// Unknown or damaged stored settings count as "not configured".
    pub async fn load(&self) -> Result<LocalModelSettings, ModelError> {
        let Some(stored) = self.settings.get(LOCAL_MODEL_SETTINGS_KEY).await? else {
            return Ok(LocalModelSettings::default());
        };
        Ok(
            match serde_json::from_value::<StoredSettings>(stored.value) {
                Ok(value) if value.schema_version == SETTINGS_SCHEMA_VERSION => {
                    LocalModelSettings {
                        package_dir: value.package_dir,
                        enabled: value.enabled,
                        manifest_sha256: value.manifest_sha256,
                        model_size: value.model_size,
                        model_modified: value.model_modified,
                    }
                }
                _ => LocalModelSettings::default(),
            },
        )
    }

    pub async fn save(
        &self,
        settings: &LocalModelSettings,
        now: DateTime<Utc>,
    ) -> Result<(), ModelError> {
        let stored = StoredSettings {
            schema_version: SETTINGS_SCHEMA_VERSION,
            package_dir: settings.package_dir.clone(),
            enabled: settings.enabled,
            manifest_sha256: settings.manifest_sha256.clone(),
            model_size: settings.model_size,
            model_modified: settings.model_modified,
        };
        self.settings
            .upsert(&SettingUpdate {
                key: LOCAL_MODEL_SETTINGS_KEY.to_owned(),
                value: serde_json::to_value(stored).expect("settings serialize to JSON"),
                updated_at: now.to_rfc3339(),
            })
            .await?;
        Ok(())
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalModelStatus {
    pub configured: bool,
    pub enabled: bool,
    /// Configured, enabled and the files still match what was checked.
    pub ready: bool,
    pub name: Option<String>,
    pub size_mb: Option<u64>,
    pub loaded: bool,
    pub busy: bool,
    pub message: Option<String>,
}

/// Cheap status without hashing the model: the manifest, the file kinds and the
/// size and time recorded at the last full check.
pub fn quick_status(settings: &LocalModelSettings) -> LocalModelStatus {
    let mut status = LocalModelStatus {
        configured: settings.package_dir.is_some(),
        enabled: settings.enabled,
        ..LocalModelStatus::default()
    };
    let Some(dir) = settings.package_dir.as_deref() else {
        return status;
    };
    match quick_check(Path::new(dir), settings) {
        Ok(manifest) => {
            status.name = Some(manifest.name.trim().to_owned());
            status.size_mb = Some(settings.model_size / (1024 * 1024));
            status.ready = settings.enabled;
        }
        Err(error) => status.message = Some(error.to_string()),
    }
    status
}

fn quick_check(dir: &Path, settings: &LocalModelSettings) -> Result<PackageManifest, ModelError> {
    let (manifest, manifest_sha256) = read_manifest(dir)?;
    if settings.manifest_sha256.as_deref() != Some(manifest_sha256.as_str()) {
        return Err(ModelError::Changed);
    }
    let model_meta = regular_file(&dir.join(&manifest.model.file), "модель", MAX_MODEL_BYTES)?;
    regular_file(&dir.join(&manifest.runner.file), "рушій", MAX_RUNNER_BYTES)?;
    if model_meta.len() != settings.model_size
        || modified_seconds(&model_meta) != settings.model_modified
    {
        return Err(ModelError::Changed);
    }
    Ok(manifest)
}

/// Before a start: the runner is hashed again (it is small), the model is
/// compared with the size and time recorded at the full check.
pub fn package_for_start(settings: &LocalModelSettings) -> Result<VerifiedPackage, ModelError> {
    if !settings.enabled {
        return Err(ModelError::Disabled);
    }
    let dir = settings
        .package_dir
        .as_deref()
        .ok_or(ModelError::NotConfigured)?;
    let dir =
        std::fs::canonicalize(dir).map_err(|_| ModelError::Package("папку не знайдено".into()))?;
    let manifest = quick_check(&dir, settings)?;
    let (_, manifest_sha256) = read_manifest(&dir)?;
    let runner_path = dir.join(&manifest.runner.file);
    let runner_hash =
        sha256_file(&runner_path).map_err(|_| ModelError::Package("рушій не читається".into()))?;
    if !runner_hash.eq_ignore_ascii_case(&manifest.runner.sha256) {
        return Err(ModelError::Changed);
    }
    let model_path = dir.join(&manifest.model.file);
    Ok(VerifiedPackage {
        dir,
        manifest,
        manifest_sha256,
        runner_path,
        model_path,
        model_size: settings.model_size,
        model_modified: settings.model_modified,
    })
}

// ---------------------------------------------------------------- request --

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct GenerationRequest {
    pub system: String,
    pub messages: Vec<ChatMessage>,
    pub max_tokens: u32,
}

impl GenerationRequest {
    /// The only input the model ever receives: a short, prepared task.
    pub fn validate(&self) -> Result<(), ModelError> {
        let bad = |text: &str| Err(ModelError::Request(text.to_owned()));
        let system = self.system.chars().count();
        if system == 0 || system > 2000 {
            return bad("системна інструкція має бути від 1 до 2000 символів");
        }
        if self.messages.is_empty() || self.messages.len() > 12 {
            return bad("має бути від 1 до 12 повідомлень");
        }
        if self.messages.last().map(|m| m.role.as_str()) != Some("user") {
            return bad("останнє повідомлення має бути від користувача");
        }
        let mut total = system;
        for message in &self.messages {
            if message.role != "user" && message.role != "assistant" {
                return bad("невідома роль повідомлення");
            }
            let length = message.content.chars().count();
            if length == 0 || length > 1500 {
                return bad("повідомлення має бути від 1 до 1500 символів");
            }
            total += length;
        }
        if total > 6500 {
            return bad("запит завеликий");
        }
        if self.max_tokens == 0 || self.max_tokens > 256 {
            return bad("ліміт відповіді має бути від 1 до 256 токенів");
        }
        let text_has_nul =
            self.system.contains('\0') || self.messages.iter().any(|m| m.content.contains('\0'));
        if text_has_nul {
            return bad("текст містить недопустимий символ");
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ModelEvent {
    Started,
    Token { text: String },
    Finished,
}

// ---------------------------------------------------------------- runtime --

#[derive(Clone, Copy, Debug)]
pub struct RuntimeLimits {
    pub load: Duration,
    pub first_token: Duration,
    pub total: Duration,
    pub idle: Duration,
}

impl Default for RuntimeLimits {
    fn default() -> Self {
        Self {
            load: Duration::from_secs(90),
            first_token: Duration::from_secs(45),
            total: Duration::from_secs(120),
            idle: Duration::from_secs(10 * 60),
        }
    }
}

enum ReaderMessage {
    Line(String),
    TooLong,
    Closed,
}

struct Running {
    child: Child,
    stdin: ChildStdin,
    lines: Receiver<ReaderMessage>,
    next_id: u64,
    last_used: Instant,
}

impl Running {
    fn kill(mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }

    fn alive(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }
}

struct Shared {
    active: Mutex<Option<Running>>,
    busy: AtomicBool,
    cancel: AtomicBool,
    limits: RuntimeLimits,
}

#[derive(Clone)]
pub struct LocalModelRuntime {
    shared: Arc<Shared>,
}

impl Default for LocalModelRuntime {
    fn default() -> Self {
        Self::with_limits(RuntimeLimits::default())
    }
}

struct BusyGuard<'a>(&'a AtomicBool);

impl Drop for BusyGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

fn spawn_reader(stdout: std::process::ChildStdout) -> Receiver<ReaderMessage> {
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut buffer = Vec::new();
        loop {
            buffer.clear();
            let read = (&mut reader)
                .take(MAX_LINE_BYTES as u64 + 1)
                .read_until(b'\n', &mut buffer);
            match read {
                Ok(0) | Err(_) => {
                    let _ = sender.send(ReaderMessage::Closed);
                    return;
                }
                Ok(_) => {
                    if buffer.len() > MAX_LINE_BYTES {
                        let _ = sender.send(ReaderMessage::TooLong);
                        return;
                    }
                    let line = String::from_utf8_lossy(&buffer).trim_end().to_owned();
                    if sender.send(ReaderMessage::Line(line)).is_err() {
                        return;
                    }
                }
            }
        }
    });
    receiver
}

#[derive(Deserialize)]
struct RunnerLine {
    id: Option<u64>,
    ready: Option<bool>,
    token: Option<String>,
    done: Option<bool>,
    error: Option<String>,
}

fn parse_line(line: &str) -> Result<RunnerLine, ModelError> {
    serde_json::from_str(line).map_err(|_| ModelError::Protocol("рядок не є JSON".into()))
}

impl LocalModelRuntime {
    pub fn with_limits(limits: RuntimeLimits) -> Self {
        Self {
            shared: Arc::new(Shared {
                active: Mutex::new(None),
                busy: AtomicBool::new(false),
                cancel: AtomicBool::new(false),
                limits,
            }),
        }
    }

    pub fn is_busy(&self) -> bool {
        self.shared.busy.load(Ordering::SeqCst)
    }

    pub fn is_loaded(&self) -> bool {
        self.shared
            .active
            .try_lock()
            .map_or(self.is_busy(), |mut guard| {
                guard.as_mut().is_some_and(Running::alive)
            })
    }

    /// Stops the current answer. Does nothing when no answer is running.
    pub fn cancel(&self) {
        if self.is_busy() {
            self.shared.cancel.store(true, Ordering::SeqCst);
        }
    }

    /// Cancels and unloads the model, freeing its memory.
    pub fn stop(&self) {
        self.cancel();
        let running = self
            .shared
            .active
            .lock()
            .ok()
            .and_then(|mut guard| guard.take());
        if let Some(running) = running {
            running.kill();
        }
    }

    fn spawn(&self, package: &VerifiedPackage) -> Result<Running, ModelError> {
        let mut command = Command::new(&package.runner_path);
        command
            .arg("--model")
            .arg(&package.model_path)
            .arg("--ctx")
            .arg(package.manifest.context_tokens.to_string())
            .arg("--threads")
            .arg(
                std::thread::available_parallelism()
                    .map_or(2, std::num::NonZeroUsize::get)
                    .min(4)
                    .to_string(),
            )
            .current_dir(&package.dir)
            .env_clear()
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            if let Some(root) = std::env::var_os("SystemRoot") {
                command.env("SystemRoot", root);
            }
            // CREATE_NO_WINDOW
            command.creation_flags(0x0800_0000);
        }
        let mut child = command
            .spawn()
            .map_err(|error| ModelError::Start(error.kind().to_string()))?;
        let (Some(stdin), Some(stdout)) = (child.stdin.take(), child.stdout.take()) else {
            let _ = child.kill();
            let _ = child.wait();
            return Err(ModelError::Start("немає каналів обміну".into()));
        };
        let lines = spawn_reader(stdout);
        let running = Running {
            child,
            stdin,
            lines,
            next_id: 1,
            last_used: Instant::now(),
        };
        let deadline = Instant::now() + self.shared.limits.load;
        loop {
            if self.shared.cancel.load(Ordering::SeqCst) {
                running.kill();
                return Err(ModelError::Cancelled);
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                running.kill();
                return Err(ModelError::Timeout);
            }
            match running.lines.recv_timeout(remaining.min(POLL)) {
                Ok(ReaderMessage::Line(line)) => {
                    let ready =
                        parse_line(&line).ok().and_then(|parsed| parsed.ready) == Some(true);
                    if ready {
                        return Ok(running);
                    }
                    running.kill();
                    return Err(ModelError::Start(
                        "рушій не повідомив про готовність".into(),
                    ));
                }
                Ok(ReaderMessage::TooLong) => {
                    running.kill();
                    return Err(ModelError::Protocol("рядок завеликий".into()));
                }
                Ok(ReaderMessage::Closed) | Err(RecvTimeoutError::Disconnected) => {
                    running.kill();
                    return Err(ModelError::Start(
                        "рушій завершився під час завантаження".into(),
                    ));
                }
                Err(RecvTimeoutError::Timeout) => {}
            }
        }
    }

    /// Runs one request to the end. Blocking: call it from a blocking thread.
    /// `package` is needed only when no runner is loaded yet.
    pub fn generate(
        &self,
        package: Option<&VerifiedPackage>,
        request: &GenerationRequest,
        emit: &mut dyn FnMut(ModelEvent),
    ) -> Result<String, ModelError> {
        request.validate()?;
        if self
            .shared
            .busy
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return Err(ModelError::Busy);
        }
        let _guard = BusyGuard(&self.shared.busy);
        self.shared.cancel.store(false, Ordering::SeqCst);
        let mut slot = self
            .shared
            .active
            .lock()
            .map_err(|_| ModelError::Start("внутрішня помилка".into()))?;
        let mut running = match slot.take() {
            Some(mut existing) => {
                if existing.alive() {
                    existing
                } else {
                    existing.kill();
                    self.spawn(package.ok_or(ModelError::NotLoaded)?)?
                }
            }
            None => self.spawn(package.ok_or(ModelError::NotLoaded)?)?,
        };
        let outcome = self.exchange(&mut running, request, emit);
        match outcome {
            Ok(text) => {
                running.last_used = Instant::now();
                *slot = Some(running);
                drop(slot);
                self.watch_idle();
                Ok(text)
            }
            Err(error) => {
                running.kill();
                Err(error)
            }
        }
    }

    fn exchange(
        &self,
        running: &mut Running,
        request: &GenerationRequest,
        emit: &mut dyn FnMut(ModelEvent),
    ) -> Result<String, ModelError> {
        let id = running.next_id;
        running.next_id += 1;
        let line = serde_json::json!({
            "id": id,
            "system": request.system,
            "messages": request.messages,
            "max_tokens": request.max_tokens,
        });
        let mut wire = serde_json::to_vec(&line).expect("request serializes to JSON");
        wire.push(b'\n');
        running
            .stdin
            .write_all(&wire)
            .and_then(|()| running.stdin.flush())
            .map_err(|_| ModelError::Protocol("рушій не приймає запит".into()))?;
        emit(ModelEvent::Started);
        let limits = self.shared.limits;
        let started = Instant::now();
        let mut answer = String::new();
        let mut got_token = false;
        loop {
            if self.shared.cancel.load(Ordering::SeqCst) {
                return Err(ModelError::Cancelled);
            }
            let allowed = if got_token {
                limits.total
            } else {
                limits.first_token.min(limits.total)
            };
            let remaining = allowed.saturating_sub(started.elapsed());
            if remaining.is_zero() || started.elapsed() >= limits.total {
                return Err(ModelError::Timeout);
            }
            match running.lines.recv_timeout(remaining.min(POLL)) {
                Ok(ReaderMessage::Line(raw)) => {
                    let parsed = parse_line(&raw)?;
                    if parsed.id != Some(id) {
                        return Err(ModelError::Protocol("відповідь на інший запит".into()));
                    }
                    if let Some(message) = parsed.error {
                        let short: String = message.chars().take(120).collect();
                        return Err(ModelError::Protocol(short));
                    }
                    if let Some(text) = parsed.token {
                        got_token = true;
                        answer.push_str(&text);
                        if answer.chars().count() > MAX_ANSWER_CHARS {
                            return Err(ModelError::Protocol("відповідь завелика".into()));
                        }
                        emit(ModelEvent::Token { text });
                    } else if parsed.done == Some(true) {
                        emit(ModelEvent::Finished);
                        return Ok(answer.trim().to_owned());
                    } else {
                        return Err(ModelError::Protocol("невідомий рядок".into()));
                    }
                }
                Ok(ReaderMessage::TooLong) => {
                    return Err(ModelError::Protocol("рядок завеликий".into()))
                }
                Ok(ReaderMessage::Closed) | Err(RecvTimeoutError::Disconnected) => {
                    return Err(ModelError::Protocol("рушій завершився".into()))
                }
                Err(RecvTimeoutError::Timeout) => {}
            }
        }
    }

    /// Unloads an idle runner so it does not hold memory on a small computer.
    fn watch_idle(&self) {
        let shared = Arc::clone(&self.shared);
        std::thread::spawn(move || {
            let step =
                (shared.limits.idle / 4).clamp(Duration::from_millis(20), Duration::from_secs(5));
            loop {
                std::thread::sleep(step);
                let Ok(mut guard) = shared.active.try_lock() else {
                    // A request is running; the next finished request starts a new watcher.
                    return;
                };
                match guard.as_ref() {
                    None => return,
                    Some(running) if running.last_used.elapsed() >= shared.limits.idle => {
                        if let Some(running) = guard.take() {
                            running.kill();
                        }
                        return;
                    }
                    Some(_) => {}
                }
            }
        });
    }
}

pub fn modified_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    const RUNNER: &str = r#"#!/bin/sh
printf '{"ready":true}\n'
while IFS= read -r line; do
  id=${line#*\"id\":}; id=${id%%,*}
  case "$line" in
    *'"system":"ok"'*)
      if [ -z "${HOME+x}" ]; then env=clean; else env=leak; fi
      printf '{"id":%s,"token":"Привіт"}\n' "$id"
      printf '{"id":%s,"token":" світе, %s"}\n' "$id" "$env"
      printf '{"id":%s,"done":true}\n' "$id" ;;
    *'"system":"hang"'*) read -r hold ;;
    *'"system":"slow"'*)
      printf '{"id":%s,"token":"перше"}\n' "$id"
      read -r hold ;;
    *'"system":"error"'*) printf '{"id":%s,"error":"model failed"}\n' "$id" ;;
    *'"system":"crash"'*) exit 3 ;;
    *'"system":"flood"'*) printf '%70000s\n' "" ;;
    *'"system":"wrongid"'*) printf '{"id":999,"token":"x"}\n' ;;
    *'"system":"junk"'*) printf 'not json\n' ;;
  esac
done
"#;

    fn make_package(dir: &Path, runner: &str) -> PathBuf {
        std::fs::create_dir_all(dir).unwrap();
        let runner_path = dir.join("runner.sh");
        std::fs::write(&runner_path, runner).unwrap();
        std::fs::set_permissions(&runner_path, std::fs::Permissions::from_mode(0o755)).unwrap();
        std::fs::write(dir.join("model.gguf"), b"synthetic model bytes").unwrap();
        let manifest = serde_json::json!({
            "schema": 1,
            "name": "Синтетична модель",
            "platform": current_platform(),
            "runner": { "file": "runner.sh", "sha256": sha256_file(&runner_path).unwrap() },
            "model": { "file": "model.gguf", "sha256": sha256_file(&dir.join("model.gguf")).unwrap() },
            "contextTokens": 2048,
        });
        std::fs::write(
            dir.join(MANIFEST_FILE),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();
        dir.to_path_buf()
    }

    fn request(system: &str) -> GenerationRequest {
        GenerationRequest {
            system: system.to_owned(),
            messages: vec![ChatMessage {
                role: "user".into(),
                content: "Привіт?".into(),
            }],
            max_tokens: 64,
        }
    }

    fn fast() -> RuntimeLimits {
        RuntimeLimits {
            load: Duration::from_secs(5),
            first_token: Duration::from_millis(400),
            total: Duration::from_millis(800),
            idle: Duration::from_millis(300),
        }
    }

    fn setup(runner: &str) -> (tempfile::TempDir, VerifiedPackage) {
        let temp = tempfile::tempdir().unwrap();
        let dir = make_package(&temp.path().join("pack"), runner);
        let package = verify_package(&dir).unwrap();
        (temp, package)
    }

    fn run(
        runtime: &LocalModelRuntime,
        package: &VerifiedPackage,
        system: &str,
    ) -> (Result<String, ModelError>, Vec<ModelEvent>) {
        let mut events = Vec::new();
        let result = runtime.generate(Some(package), &request(system), &mut |event| {
            events.push(event)
        });
        (result, events)
    }

    #[test]
    fn a_valid_package_is_verified_and_a_tampered_one_is_not() {
        let (temp, package) = setup(RUNNER);
        assert_eq!(package.manifest.context_tokens, 2048);
        assert_eq!(package.model_size, 21);
        std::fs::write(
            temp.path().join("pack/model.gguf"),
            b"tampered model bytes!",
        )
        .unwrap();
        assert!(
            matches!(verify_package(&temp.path().join("pack")), Err(ModelError::Package(message)) if message.contains("моделі"))
        );
        std::fs::write(
            temp.path().join("pack/model.gguf"),
            b"synthetic model bytes",
        )
        .unwrap();
        std::fs::write(
            temp.path().join("pack/runner.sh"),
            RUNNER.replace("clean", "evil"),
        )
        .unwrap();
        assert!(
            matches!(verify_package(&temp.path().join("pack")), Err(ModelError::Package(message)) if message.contains("рушія"))
        );
    }

    #[test]
    fn a_malformed_manifest_is_rejected_before_any_file_is_trusted() {
        let temp = tempfile::tempdir().unwrap();
        let dir = make_package(&temp.path().join("pack"), RUNNER);
        let good: serde_json::Value =
            serde_json::from_slice(&std::fs::read(dir.join(MANIFEST_FILE)).unwrap()).unwrap();
        let cases: Vec<(&str, serde_json::Value)> = vec![
            ("unknown field", {
                let mut v = good.clone();
                v["extra"] = "x".into();
                v
            }),
            ("schema", {
                let mut v = good.clone();
                v["schema"] = 2.into();
                v
            }),
            ("platform", {
                let mut v = good.clone();
                v["platform"] = "plan9-m68k".into();
                v
            }),
            ("traversal", {
                let mut v = good.clone();
                v["model"]["file"] = "../model.gguf".into();
                v
            }),
            ("absolute", {
                let mut v = good.clone();
                v["runner"]["file"] = "/bin/sh".into();
                v
            }),
            ("hidden", {
                let mut v = good.clone();
                v["model"]["file"] = ".model".into();
                v
            }),
            ("hash", {
                let mut v = good.clone();
                v["model"]["sha256"] = "abc".into();
                v
            }),
            ("context", {
                let mut v = good.clone();
                v["contextTokens"] = 100000.into();
                v
            }),
            ("same file", {
                let mut v = good.clone();
                v["model"]["file"] = "runner.sh".into();
                v
            }),
            ("name", {
                let mut v = good.clone();
                v["name"] = "".into();
                v
            }),
        ];
        for (label, manifest) in cases {
            std::fs::write(
                dir.join(MANIFEST_FILE),
                serde_json::to_vec(&manifest).unwrap(),
            )
            .unwrap();
            assert!(verify_package(&dir).is_err(), "{label} must be rejected");
        }
    }

    #[test]
    fn a_symlinked_runner_or_model_is_not_followed() {
        let temp = tempfile::tempdir().unwrap();
        let dir = make_package(&temp.path().join("pack"), RUNNER);
        std::fs::rename(dir.join("model.gguf"), temp.path().join("outside.gguf")).unwrap();
        std::os::unix::fs::symlink(temp.path().join("outside.gguf"), dir.join("model.gguf"))
            .unwrap();
        assert!(verify_package(&dir).is_err());
    }

    #[test]
    fn requests_are_short_typed_and_bounded() {
        assert!(request("ok").validate().is_ok());
        let mut empty = request("ok");
        empty.messages.clear();
        assert!(empty.validate().is_err());
        let mut tokens = request("ok");
        tokens.max_tokens = 100_000;
        assert!(tokens.validate().is_err());
        let mut role = request("ok");
        role.messages[0].role = "system".into();
        assert!(role.validate().is_err());
        let mut long = request("ok");
        long.messages[0].content = "я".repeat(1501);
        assert!(long.validate().is_err());
        let mut last = request("ok");
        last.messages.push(ChatMessage {
            role: "assistant".into(),
            content: "так".into(),
        });
        assert!(
            last.validate().is_err(),
            "the last message must come from the user"
        );
        assert!(request(&"я".repeat(2001)).validate().is_err());
        assert!(request("ok\0").validate().is_err());
        let unknown: Result<GenerationRequest, _> =
            serde_json::from_str(r#"{"system":"a","messages":[],"maxTokens":1,"tools":[]}"#);
        assert!(
            unknown.is_err(),
            "no extra fields such as tools can be smuggled in"
        );
    }

    #[test]
    fn an_answer_streams_tokens_and_the_runner_gets_a_clean_environment() {
        let (_temp, package) = setup(RUNNER);
        let runtime = LocalModelRuntime::with_limits(fast());
        let (result, events) = run(&runtime, &package, "ok");
        assert_eq!(result.unwrap(), "Привіт світе, clean");
        assert_eq!(events.first(), Some(&ModelEvent::Started));
        assert_eq!(events.last(), Some(&ModelEvent::Finished));
        assert_eq!(
            events
                .iter()
                .filter(|event| matches!(event, ModelEvent::Token { .. }))
                .count(),
            2
        );
        assert!(runtime.is_loaded());
        let (again, _) = run(&runtime, &package, "ok");
        assert_eq!(
            again.unwrap(),
            "Привіт світе, clean",
            "the loaded runner is reused"
        );
        runtime.stop();
        assert!(!runtime.is_loaded());
    }

    #[test]
    fn a_second_request_while_busy_is_refused_and_cancel_stops_the_first() {
        let (_temp, package) = setup(RUNNER);
        let runtime = LocalModelRuntime::with_limits(RuntimeLimits {
            first_token: Duration::from_secs(20),
            total: Duration::from_secs(30),
            ..fast()
        });
        let first = {
            let runtime = runtime.clone();
            let package = package.clone();
            std::thread::spawn(move || run(&runtime, &package, "slow").0)
        };
        let started = Instant::now();
        while !runtime.is_busy() && started.elapsed() < Duration::from_secs(5) {
            std::thread::sleep(Duration::from_millis(10));
        }
        std::thread::sleep(Duration::from_millis(150));
        assert!(matches!(
            run(&runtime, &package, "ok").0,
            Err(ModelError::Busy)
        ));
        runtime.cancel();
        assert!(matches!(first.join().unwrap(), Err(ModelError::Cancelled)));
        assert!(!runtime.is_busy());
        let (next, _) = run(&runtime, &package, "ok");
        assert_eq!(
            next.unwrap(),
            "Привіт світе, clean",
            "after a cancel the next request starts a fresh runner"
        );
        runtime.stop();
    }

    #[test]
    fn a_silent_runner_times_out_and_is_killed() {
        let (_temp, package) = setup(RUNNER);
        let runtime = LocalModelRuntime::with_limits(fast());
        let (result, _) = run(&runtime, &package, "hang");
        assert!(matches!(result, Err(ModelError::Timeout)));
        assert!(!runtime.is_loaded());
        assert!(!runtime.is_busy());
    }

    #[test]
    fn runner_failures_never_escape_as_answers() {
        let (_temp, package) = setup(RUNNER);
        let runtime = LocalModelRuntime::with_limits(fast());
        for (system, expected) in [
            ("error", "model failed"),
            ("wrongid", "інший запит"),
            ("junk", "не є JSON"),
            ("flood", "завеликий"),
            ("crash", "завершився"),
        ] {
            let (result, _) = run(&runtime, &package, system);
            match result {
                Err(ModelError::Protocol(message)) => {
                    assert!(message.contains(expected), "{system}: {message}")
                }
                other => panic!("{system}: unexpected {other:?}"),
            }
            assert!(
                !runtime.is_loaded(),
                "{system}: a failed runner is not kept"
            );
        }
        let (ok, _) = run(&runtime, &package, "ok");
        assert_eq!(
            ok.unwrap(),
            "Привіт світе, clean",
            "the runtime recovers after every failure"
        );
        runtime.stop();
    }

    #[test]
    fn a_runner_that_never_becomes_ready_is_a_start_failure() {
        let (_temp, package) = setup("#!/bin/sh\nread -r hold\n");
        let runtime = LocalModelRuntime::with_limits(RuntimeLimits {
            load: Duration::from_millis(300),
            ..fast()
        });
        assert!(matches!(
            run(&runtime, &package, "ok").0,
            Err(ModelError::Timeout)
        ));
        let (_temp, package) = setup("#!/bin/sh\nprintf 'hello\\n'\nread -r hold\n");
        assert!(matches!(
            run(&runtime, &package, "ok").0,
            Err(ModelError::Start(_))
        ));
        let (_temp, package) = setup("#!/bin/sh\nexit 1\n");
        assert!(matches!(
            run(&runtime, &package, "ok").0,
            Err(ModelError::Start(_))
        ));
    }

    #[test]
    fn without_a_package_an_unloaded_model_is_not_started() {
        let runtime = LocalModelRuntime::with_limits(fast());
        let result = runtime.generate(None, &request("ok"), &mut |_| {});
        assert!(matches!(result, Err(ModelError::NotLoaded)));
    }

    #[test]
    fn an_idle_runner_is_unloaded() {
        let (_temp, package) = setup(RUNNER);
        let runtime = LocalModelRuntime::with_limits(fast());
        assert!(run(&runtime, &package, "ok").0.is_ok());
        assert!(runtime.is_loaded());
        let started = Instant::now();
        while runtime.is_loaded() && started.elapsed() < Duration::from_secs(5) {
            std::thread::sleep(Duration::from_millis(50));
        }
        assert!(!runtime.is_loaded(), "the idle runner frees its memory");
    }

    #[test]
    fn the_start_check_notices_a_changed_model_or_runner_and_a_disabled_setting() {
        let (temp, package) = setup(RUNNER);
        let mut settings = LocalModelSettings {
            package_dir: Some(package.dir.to_string_lossy().into_owned()),
            enabled: true,
            manifest_sha256: Some(package.manifest_sha256.clone()),
            model_size: package.model_size,
            model_modified: package.model_modified,
        };
        assert!(package_for_start(&settings).is_ok());
        assert!(quick_status(&settings).ready);
        settings.enabled = false;
        assert!(matches!(
            package_for_start(&settings),
            Err(ModelError::Disabled)
        ));
        assert!(!quick_status(&settings).ready);
        settings.enabled = true;
        std::fs::write(
            temp.path().join("pack/runner.sh"),
            RUNNER.replace("clean", "evil"),
        )
        .unwrap();
        assert!(matches!(
            package_for_start(&settings),
            Err(ModelError::Changed)
        ));
        std::fs::write(temp.path().join("pack/runner.sh"), RUNNER).unwrap();
        std::fs::write(
            temp.path().join("pack/model.gguf"),
            b"another size of model",
        )
        .unwrap();
        std::fs::write(
            temp.path().join("pack/model.gguf"),
            b"a different, longer model file",
        )
        .unwrap();
        assert!(matches!(
            package_for_start(&settings),
            Err(ModelError::Changed)
        ));
        assert!(quick_status(&settings).message.is_some());
        assert_eq!(
            quick_status(&LocalModelSettings::default()),
            LocalModelStatus::default()
        );
    }
}
