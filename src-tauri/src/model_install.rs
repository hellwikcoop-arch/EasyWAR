//! Optional installation of the КОМБАТ language model from the network.
//!
//! Nothing here runs by itself: the download starts only from the explicit
//! «Встановити модель» action after the user has seen the size and the source.
//! The model is a single pinned file (address, size and SHA-256 are compiled
//! in), so whatever server or mirror answers, a file that does not match is
//! deleted and never trusted. The download goes to `<name>.part`, can be
//! cancelled and resumed with a `Range` request, and only a verified file is
//! renamed to `model.gguf`. The runner program is not downloaded: when a
//! `runner.exe` (or `runner`) sits next to the model, the package manifest is
//! written and the ordinary full package check of [`crate::local_model`] runs.

use std::{
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

use serde::Serialize;
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::local_model::{
    sha256_file, verify_package, ModelError, PackageFile, PackageManifest, VerifiedPackage,
};

pub const MODEL_FILE: &str = "model.gguf";
const PART_FILE: &str = "model.gguf.part";
const MANIFEST_FILE: &str = "manifest.json";
const RUNNER_NAMES: [&str; 2] = ["runner.exe", "runner"];
const FREE_SPACE_MARGIN: u64 = 256 * 1024 * 1024;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
const CHUNK_TIMEOUT: Duration = Duration::from_secs(30);
const PROGRESS_BYTES: u64 = 512 * 1024;
const PROGRESS_EVERY: Duration = Duration::from_millis(250);
const HASH_BUFFER: usize = 1024 * 1024;
const MAX_REDIRECTS: usize = 5;

/// One pinned model file. Only the address is allowed to differ in tests.
#[derive(Debug, Clone)]
pub struct ModelSource {
    pub id: String,
    pub title: String,
    pub license: String,
    pub url: String,
    pub sha256: String,
    pub size: u64,
    pub context_tokens: u32,
    /// Plain `http` is accepted only by tests that talk to a local server.
    pub allow_insecure: bool,
}

impl ModelSource {
    pub fn host(&self) -> String {
        reqwest::Url::parse(&self.url)
            .ok()
            .and_then(|url| url.host_str().map(str::to_owned))
            .unwrap_or_default()
    }
}

/// Qwen3-4B, quantised Q4_K_M, from the official Qwen repository on Hugging Face.
/// Size and SHA-256 are the values of the Git LFS pointer of that file.
pub fn qwen3_4b_q4km() -> ModelSource {
    ModelSource {
        id: "qwen3-4b-q4km".to_owned(),
        title: "Qwen3-4B (Q4_K_M)".to_owned(),
        license: "Apache-2.0".to_owned(),
        url: "https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf"
            .to_owned(),
        sha256: "7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5".to_owned(),
        size: 2_497_280_256,
        context_tokens: 2048,
        allow_insecure: false,
    }
}

#[derive(Debug, Error)]
pub enum InstallError {
    #[error("Установлення моделі вже виконується")]
    Busy,
    #[error("Установлення скасовано; завантажену частину збережено")]
    Cancelled,
    #[error("Недостатньо місця на диску: потрібно ще {need_mb} МБ, вільно {free_mb} МБ")]
    NoSpace { need_mb: u64, free_mb: u64 },
    #[error("Не вдалося завантажити модель: {0}")]
    Network(String),
    #[error("Сервер відповів кодом {0}")]
    Status(u16),
    #[error("Сервер повернув файл неочікуваного розміру")]
    Size,
    #[error("Контрольна сума файлу не збіглася: файл видалено, повторіть спробу")]
    Checksum,
    #[error("Помилка запису на диск: {0}")]
    Io(String),
}

fn io_error(error: std::io::Error) -> InstallError {
    InstallError::Io(error.kind().to_string())
}

fn network_error(error: reqwest::Error) -> InstallError {
    let text = if error.is_timeout() {
        "час очікування вичерпано"
    } else if error.is_connect() {
        "немає з'єднання"
    } else {
        "з'єднання перервано"
    };
    InstallError::Network(text.to_owned())
}

// --------------------------------------------------------------- control --

#[derive(Debug, Default)]
struct Shared {
    busy: AtomicBool,
    cancel: AtomicBool,
}

/// Allows one installation at a time and carries the cancel flag.
#[derive(Clone, Debug, Default)]
pub struct InstallController {
    shared: Arc<Shared>,
}

/// Held for as long as an installation runs; dropping it frees the controller.
#[derive(Debug)]
pub struct InstallGuard {
    shared: Arc<Shared>,
}

impl InstallController {
    pub fn begin(&self) -> Result<InstallGuard, InstallError> {
        if self
            .shared
            .busy
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return Err(InstallError::Busy);
        }
        self.shared.cancel.store(false, Ordering::SeqCst);
        Ok(InstallGuard {
            shared: self.shared.clone(),
        })
    }

    pub fn is_busy(&self) -> bool {
        self.shared.busy.load(Ordering::SeqCst)
    }

    /// Stops a running installation; does nothing when none runs.
    pub fn cancel(&self) {
        if self.is_busy() {
            self.shared.cancel.store(true, Ordering::SeqCst);
        }
    }
}

impl InstallGuard {
    fn cancelled(&self) -> bool {
        self.shared.cancel.load(Ordering::SeqCst)
    }

    fn flag(&self) -> Arc<Shared> {
        self.shared.clone()
    }
}

impl Drop for InstallGuard {
    fn drop(&mut self) {
        self.shared.busy.store(false, Ordering::SeqCst);
    }
}

// ---------------------------------------------------------------- events --

#[derive(Debug, Clone, Copy, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    Download,
    Verify,
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum InstallEvent {
    Progress { phase: Phase, done: u64, total: u64 },
}

pub type Emit = Arc<dyn Fn(InstallEvent) + Send + Sync>;

struct Throttle {
    last: Instant,
    last_bytes: u64,
}

impl Throttle {
    fn new(start: u64) -> Self {
        Self {
            last: Instant::now(),
            last_bytes: start,
        }
    }

    fn due(&mut self, done: u64) -> bool {
        if done.saturating_sub(self.last_bytes) >= PROGRESS_BYTES
            && self.last.elapsed() >= PROGRESS_EVERY
        {
            self.last = Instant::now();
            self.last_bytes = done;
            return true;
        }
        false
    }
}

// ------------------------------------------------------------------ info --

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallInfo {
    pub id: String,
    pub title: String,
    pub license: String,
    pub host: String,
    pub size_bytes: u64,
    /// Bytes of an earlier unfinished download that a retry will continue.
    pub partial_bytes: u64,
    /// The finished model file is in place (its hash was checked on download).
    pub installed: bool,
    pub runner_present: bool,
    pub busy: bool,
    pub folder: String,
}

fn regular_len(path: &Path) -> Option<u64> {
    let meta = std::fs::symlink_metadata(path).ok()?;
    meta.is_file().then_some(meta.len())
}

fn runner_in(dir: &Path) -> Option<&'static str> {
    RUNNER_NAMES
        .into_iter()
        .find(|name| regular_len(&dir.join(name)).is_some_and(|len| len > 0))
}

/// Cheap description for the interface: no network, no hashing.
pub fn info(source: &ModelSource, dir: &Path, busy: bool) -> InstallInfo {
    let partial = regular_len(&dir.join(PART_FILE)).unwrap_or(0);
    InstallInfo {
        id: source.id.clone(),
        title: source.title.clone(),
        license: source.license.clone(),
        host: source.host(),
        size_bytes: source.size,
        partial_bytes: if partial < source.size { partial } else { 0 },
        installed: regular_len(&dir.join(MODEL_FILE)) == Some(source.size),
        runner_present: runner_in(dir).is_some(),
        busy,
        folder: dir.to_string_lossy().into_owned(),
    }
}

fn ensure_free_space(need: u64, free: u64) -> Result<(), InstallError> {
    let need = need.saturating_add(FREE_SPACE_MARGIN);
    if free >= need {
        return Ok(());
    }
    let mb = |bytes: u64| bytes.div_ceil(1024 * 1024);
    Err(InstallError::NoSpace {
        need_mb: mb(need),
        free_mb: free / (1024 * 1024),
    })
}

// -------------------------------------------------------------- download --

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn build_client(source: &ModelSource) -> Result<reqwest::Client, InstallError> {
    let allow_insecure = source.allow_insecure;
    // reqwest panics without a process-wide TLS provider, even for http.
    crate::install_tls_provider();
    reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .user_agent(concat!("EasyWAR/", env!("CARGO_PKG_VERSION")))
        .redirect(reqwest::redirect::Policy::custom(move |attempt| {
            if attempt.previous().len() >= MAX_REDIRECTS {
                attempt.error("забагато перенаправлень")
            } else if attempt.url().scheme() != "https" && !allow_insecure {
                attempt.stop()
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|_| InstallError::Network("не вдалося створити з'єднання".to_owned()))
}

/// Sends the request, continuing at `have` bytes. A server that cannot satisfy
/// the range (416) makes the download start over once.
async fn open_response(
    client: &reqwest::Client,
    source: &ModelSource,
    mut have: u64,
) -> Result<(reqwest::Response, u64), InstallError> {
    for _ in 0..2 {
        let mut request = client
            .get(&source.url)
            .header(reqwest::header::ACCEPT_ENCODING, "identity");
        if have > 0 {
            request = request.header(reqwest::header::RANGE, format!("bytes={have}-"));
        }
        let response = tokio::time::timeout(CHUNK_TIMEOUT, request.send())
            .await
            .map_err(|_| InstallError::Network("час очікування вичерпано".to_owned()))?
            .map_err(network_error)?;
        let status = response.status().as_u16();
        match status {
            206 => {
                let expected = format!("bytes {have}-");
                let ok = have > 0
                    && response
                        .headers()
                        .get(reqwest::header::CONTENT_RANGE)
                        .and_then(|value| value.to_str().ok())
                        .is_some_and(|value| value.starts_with(&expected));
                if !ok {
                    return Err(InstallError::Size);
                }
                if response
                    .content_length()
                    .is_some_and(|len| len != source.size - have)
                {
                    return Err(InstallError::Size);
                }
                return Ok((response, have));
            }
            200 => {
                // The server ignored the range: the whole file comes again.
                if response
                    .content_length()
                    .is_some_and(|len| len != source.size)
                {
                    return Err(InstallError::Size);
                }
                return Ok((response, 0));
            }
            416 if have > 0 => have = 0,
            other => return Err(InstallError::Status(other)),
        }
    }
    Err(InstallError::Status(416))
}

async fn download_part(
    source: &ModelSource,
    part: &Path,
    guard: &InstallGuard,
    emit: &Emit,
) -> Result<(), InstallError> {
    let have = regular_len(part).unwrap_or(0);
    let client = build_client(source)?;
    let (mut response, start) = open_response(&client, source, have).await?;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(false)
        .open(part)
        .map_err(io_error)?;
    file.set_len(start).map_err(io_error)?;
    file.seek(SeekFrom::Start(start)).map_err(io_error)?;
    let mut done = start;
    let mut throttle = Throttle::new(done);
    emit(InstallEvent::Progress {
        phase: Phase::Download,
        done,
        total: source.size,
    });
    loop {
        if guard.cancelled() {
            file.flush().map_err(io_error)?;
            return Err(InstallError::Cancelled);
        }
        let chunk = tokio::time::timeout(CHUNK_TIMEOUT, response.chunk())
            .await
            .map_err(|_| InstallError::Network("час очікування вичерпано".to_owned()))?
            .map_err(network_error)?;
        let Some(chunk) = chunk else { break };
        if done + chunk.len() as u64 > source.size {
            drop(file);
            let _ = std::fs::remove_file(part);
            return Err(InstallError::Size);
        }
        file.write_all(&chunk).map_err(io_error)?;
        done += chunk.len() as u64;
        if throttle.due(done) {
            emit(InstallEvent::Progress {
                phase: Phase::Download,
                done,
                total: source.size,
            });
        }
    }
    file.flush().map_err(io_error)?;
    if done != source.size {
        return Err(InstallError::Network("з'єднання перервано".to_owned()));
    }
    emit(InstallEvent::Progress {
        phase: Phase::Download,
        done,
        total: source.size,
    });
    Ok(())
}

/// SHA-256 of a file with progress; the cancel flag is honoured between blocks.
fn hash_with_progress(
    path: &Path,
    total: u64,
    shared: &Shared,
    emit: &Emit,
) -> Result<String, InstallError> {
    let mut file = std::fs::File::open(path).map_err(io_error)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; HASH_BUFFER];
    let mut done = 0_u64;
    let mut throttle = Throttle::new(0);
    loop {
        if shared.cancel.load(Ordering::SeqCst) {
            return Err(InstallError::Cancelled);
        }
        let read = file.read(&mut buffer).map_err(io_error)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        done += read as u64;
        if throttle.due(done) {
            emit(InstallEvent::Progress {
                phase: Phase::Verify,
                done,
                total,
            });
        }
    }
    emit(InstallEvent::Progress {
        phase: Phase::Verify,
        done: total,
        total,
    });
    Ok(hex(&hasher.finalize()))
}

async fn verify_file(
    source: &ModelSource,
    path: &Path,
    guard: &InstallGuard,
    emit: &Emit,
) -> Result<bool, InstallError> {
    let shared = guard.flag();
    let emit = emit.clone();
    let path = path.to_owned();
    let total = source.size;
    let hash =
        tokio::task::spawn_blocking(move || hash_with_progress(&path, total, &shared, &emit))
            .await
            .map_err(|_| InstallError::Io("перевірку перервано".to_owned()))??;
    Ok(hash.eq_ignore_ascii_case(&source.sha256))
}

/// Downloads (or continues) and verifies the model file; returns the path of
/// the finished `model.gguf`. Cancelling keeps the part for a later retry; a
/// file whose size or SHA-256 is wrong is deleted.
pub async fn install_model(
    source: &ModelSource,
    dir: &Path,
    guard: &InstallGuard,
    emit: Emit,
) -> Result<PathBuf, InstallError> {
    std::fs::create_dir_all(dir).map_err(io_error)?;
    let final_path = dir.join(MODEL_FILE);
    let part = dir.join(PART_FILE);

    if let Some(len) = regular_len(&final_path) {
        if len == source.size && verify_file(source, &final_path, guard, &emit).await? {
            return Ok(final_path);
        }
        std::fs::remove_file(&final_path).map_err(io_error)?;
    }

    let mut have = regular_len(&part).unwrap_or(0);
    if have > source.size {
        std::fs::remove_file(&part).map_err(io_error)?;
        have = 0;
    }
    if have < source.size {
        if let Ok(free) = fs2::available_space(dir) {
            ensure_free_space(source.size - have, free)?;
        }
        download_part(source, &part, guard, &emit).await?;
    }
    if !verify_file(source, &part, guard, &emit).await? {
        let _ = std::fs::remove_file(&part);
        return Err(InstallError::Checksum);
    }
    std::fs::rename(&part, &final_path).map_err(io_error)?;
    Ok(final_path)
}

// -------------------------------------------------------------- finalize --

#[derive(Debug)]
pub enum Finalized {
    Ready(Box<VerifiedPackage>),
    NeedsRunner,
}

/// With a runner next to the model, writes the manifest and runs the full
/// package check. Without one the model stays downloaded and unused.
pub fn finalize_package(source: &ModelSource, dir: &Path) -> Result<Finalized, ModelError> {
    let Some(runner) = runner_in(dir) else {
        return Ok(Finalized::NeedsRunner);
    };
    let runner_sha256 = sha256_file(&dir.join(runner))
        .map_err(|_| ModelError::Package("рушій не читається".into()))?;
    let manifest = PackageManifest {
        schema: 1,
        name: source.title.clone(),
        platform: crate::local_model::current_platform(),
        runner: PackageFile {
            file: runner.to_owned(),
            sha256: runner_sha256,
        },
        model: PackageFile {
            file: MODEL_FILE.to_owned(),
            sha256: source.sha256.clone(),
        },
        context_tokens: source.context_tokens,
    };
    let bytes = serde_json::to_vec_pretty(&manifest)
        .map_err(|_| ModelError::Package("не вдалося записати manifest.json".into()))?;
    let temporary = dir.join("manifest.json.tmp");
    std::fs::write(&temporary, bytes)
        .and_then(|()| std::fs::rename(&temporary, dir.join(MANIFEST_FILE)))
        .map_err(|_| ModelError::Package("не вдалося записати manifest.json".into()))?;
    verify_package(dir).map(|package| Finalized::Ready(Box::new(package)))
}

/// Deletes the model folder the application itself created. Refuses any other path.
pub fn remove_files(dir: &Path) -> std::io::Result<()> {
    let parent_ok = dir
        .parent()
        .and_then(Path::file_name)
        .is_some_and(|name| name == "local-models");
    if !parent_ok {
        return Err(std::io::Error::other("не папка моделей застосунку"));
    }
    match std::fs::remove_dir_all(dir) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{BufRead, BufReader},
        net::{TcpListener, TcpStream},
        sync::{atomic::AtomicUsize, Mutex},
        thread,
    };

    #[derive(Clone, Copy)]
    enum Mode {
        Normal,
        DropAfter(usize),
        IgnoreRange,
        Status(u16),
        Longer,
        Slow,
    }

    struct Server {
        state: Arc<ServerState>,
        url: String,
    }

    struct ServerState {
        body: Vec<u8>,
        mode: Mutex<Mode>,
        requests: AtomicUsize,
        ranges: Mutex<Vec<Option<String>>>,
    }

    impl Server {
        fn start(body: Vec<u8>) -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
            let url = format!("http://{}/model.gguf", listener.local_addr().unwrap());
            let state = Arc::new(ServerState {
                body,
                mode: Mutex::new(Mode::Normal),
                requests: AtomicUsize::new(0),
                ranges: Mutex::new(Vec::new()),
            });
            let shared = state.clone();
            thread::spawn(move || {
                for stream in listener.incoming().flatten() {
                    let shared = shared.clone();
                    thread::spawn(move || serve(stream, &shared));
                }
            });
            Self { state, url }
        }

        fn mode(&self, mode: Mode) {
            *self.state.mode.lock().unwrap() = mode;
        }

        fn requests(&self) -> usize {
            self.state.requests.load(Ordering::SeqCst)
        }
    }

    fn serve(stream: TcpStream, state: &ServerState) {
        let mut reader = BufReader::new(stream.try_clone().unwrap());
        let mut range = None;
        loop {
            let mut line = String::new();
            if reader.read_line(&mut line).unwrap_or(0) == 0 {
                return;
            }
            if line == "\r\n" {
                break;
            }
            if let Some(value) = line.to_ascii_lowercase().strip_prefix("range: bytes=") {
                range = Some(value.trim().trim_end_matches('-').to_owned());
            }
        }
        state.requests.fetch_add(1, Ordering::SeqCst);
        state.ranges.lock().unwrap().push(range.clone());
        let mode = *state.mode.lock().unwrap();
        let mut out = stream;
        if let Mode::Status(code) = mode {
            let _ = write!(
                out,
                "HTTP/1.1 {code} Error\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            );
            return;
        }
        let total = state.body.len();
        let start = match (mode, &range) {
            (Mode::IgnoreRange, _) | (_, None) => 0,
            (_, Some(value)) => value.parse::<usize>().unwrap_or(0),
        };
        let partial = start > 0;
        let length = match mode {
            Mode::Longer => total - start + 10,
            _ => total - start,
        };
        if partial {
            let _ = write!(
                out,
                "HTTP/1.1 206 Partial Content\r\nContent-Range: bytes {start}-{}/{total}\r\nContent-Length: {length}\r\nConnection: close\r\n\r\n",
                total - 1
            );
        } else {
            let _ = write!(
                out,
                "HTTP/1.1 200 OK\r\nContent-Length: {length}\r\nConnection: close\r\n\r\n"
            );
        }
        let limit = match mode {
            Mode::DropAfter(count) => count.min(total - start),
            _ => total - start,
        };
        for piece in state.body[start..start + limit].chunks(32 * 1024) {
            if out.write_all(piece).is_err() {
                return;
            }
            if matches!(mode, Mode::Slow) {
                thread::sleep(Duration::from_millis(10));
            }
        }
        if matches!(mode, Mode::Longer) {
            let _ = out.write_all(&[0_u8; 10]);
        }
        let _ = out.flush();
    }

    fn body(len: usize) -> Vec<u8> {
        (0..len)
            .map(|i| (i.wrapping_mul(31).wrapping_add(i >> 7) & 0xff) as u8)
            .collect()
    }

    fn sha(bytes: &[u8]) -> String {
        hex(&Sha256::digest(bytes))
    }

    fn source_for(server: &Server, data: &[u8]) -> ModelSource {
        ModelSource {
            id: "test".to_owned(),
            title: "Тестова модель".to_owned(),
            license: "test".to_owned(),
            url: server.url.clone(),
            sha256: sha(data),
            size: data.len() as u64,
            context_tokens: 2048,
            allow_insecure: true,
        }
    }

    fn silent() -> Emit {
        Arc::new(|_| {})
    }

    fn guard() -> (InstallController, InstallGuard) {
        let controller = InstallController::default();
        let guard = controller.begin().unwrap();
        (controller, guard)
    }

    const SIZE: usize = 2 * 1024 * 1024 + 123;

    #[test]
    fn pinned_model_matches_the_official_pointer() {
        let source = qwen3_4b_q4km();
        assert_eq!(source.size, 2_497_280_256);
        assert_eq!(source.sha256.len(), 64);
        assert_eq!(source.host(), "huggingface.co");
        assert!(source.url.starts_with("https://") && !source.allow_insecure);
    }

    #[tokio::test]
    async fn downloads_verifies_and_renames() {
        let data = body(SIZE);
        let server = Server::start(data.clone());
        let source = source_for(&server, &data);
        let dir = tempfile::tempdir().unwrap();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let log = seen.clone();
        let emit: Emit = Arc::new(move |event| log.lock().unwrap().push(event));
        let (_c, guard) = guard();

        let path = install_model(&source, dir.path(), &guard, emit)
            .await
            .unwrap();

        assert_eq!(std::fs::read(&path).unwrap(), data);
        assert!(!dir.path().join(PART_FILE).exists());
        let events = seen.lock().unwrap();
        let InstallEvent::Progress { phase, done, total } = events.last().unwrap().clone();
        assert_eq!(
            (phase, done, total),
            (Phase::Verify, data.len() as u64, data.len() as u64)
        );
        assert!(events.iter().any(|event| matches!(
            event,
            InstallEvent::Progress { phase: Phase::Download, done, .. } if *done == data.len() as u64
        )));
    }

    #[tokio::test]
    async fn resumes_an_interrupted_download_with_a_range_request() {
        let data = body(SIZE);
        let server = Server::start(data.clone());
        let source = source_for(&server, &data);
        let dir = tempfile::tempdir().unwrap();
        let (_c, first) = guard();

        server.mode(Mode::DropAfter(700_000));
        let error = install_model(&source, dir.path(), &first, silent())
            .await
            .unwrap_err();
        assert!(matches!(error, InstallError::Network(_)), "{error}");
        let kept = std::fs::metadata(dir.path().join(PART_FILE)).unwrap().len();
        assert!(kept > 0 && kept < data.len() as u64);
        assert_eq!(info(&source, dir.path(), false).partial_bytes, kept);
        drop(first);

        server.mode(Mode::Normal);
        let (_c2, second) = guard();
        let path = install_model(&source, dir.path(), &second, silent())
            .await
            .unwrap();

        assert_eq!(std::fs::read(path).unwrap(), data);
        let ranges = server.state.ranges.lock().unwrap();
        assert_eq!(
            ranges.last().unwrap().as_deref(),
            Some(kept.to_string().as_str())
        );
    }

    #[tokio::test]
    async fn restarts_when_the_server_ignores_the_range() {
        let data = body(SIZE);
        let server = Server::start(data.clone());
        let source = source_for(&server, &data);
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(PART_FILE), &data[..300_000]).unwrap();
        server.mode(Mode::IgnoreRange);
        let (_c, guard) = guard();

        let path = install_model(&source, dir.path(), &guard, silent())
            .await
            .unwrap();

        assert_eq!(std::fs::read(path).unwrap(), data);
    }

    #[tokio::test]
    async fn wrong_content_is_deleted_and_never_installed() {
        let data = body(SIZE);
        let mut other = data.clone();
        other[1000] ^= 0xff;
        let server = Server::start(other);
        let source = source_for(&server, &data);
        let dir = tempfile::tempdir().unwrap();
        let (_c, guard) = guard();

        let error = install_model(&source, dir.path(), &guard, silent())
            .await
            .unwrap_err();

        assert!(matches!(error, InstallError::Checksum), "{error}");
        assert!(!dir.path().join(PART_FILE).exists());
        assert!(!dir.path().join(MODEL_FILE).exists());
    }

    #[tokio::test]
    async fn a_longer_answer_than_pinned_is_rejected() {
        let data = body(SIZE);
        let server = Server::start(data.clone());
        server.mode(Mode::Longer);
        let source = source_for(&server, &data);
        let dir = tempfile::tempdir().unwrap();
        let (_c, guard) = guard();

        let error = install_model(&source, dir.path(), &guard, silent())
            .await
            .unwrap_err();

        assert!(matches!(error, InstallError::Size), "{error}");
        assert!(!dir.path().join(MODEL_FILE).exists());
    }

    #[tokio::test]
    async fn http_errors_are_reported_without_leaving_files() {
        let data = body(SIZE);
        let server = Server::start(data.clone());
        server.mode(Mode::Status(404));
        let source = source_for(&server, &data);
        let dir = tempfile::tempdir().unwrap();
        let (_c, guard) = guard();

        let error = install_model(&source, dir.path(), &guard, silent())
            .await
            .unwrap_err();

        assert!(matches!(error, InstallError::Status(404)), "{error}");
        assert!(!dir.path().join(MODEL_FILE).exists());
    }

    #[tokio::test]
    async fn cancel_keeps_the_part_and_a_retry_finishes() {
        let data = body(SIZE);
        let server = Server::start(data.clone());
        server.mode(Mode::Slow);
        let source = source_for(&server, &data);
        let dir = tempfile::tempdir().unwrap();
        let controller = InstallController::default();
        let first = controller.begin().unwrap();
        let canceller = controller.clone();
        let emit: Emit = Arc::new(move |event| {
            if let InstallEvent::Progress {
                phase: Phase::Download,
                done,
                ..
            } = event
            {
                if done > 0 {
                    canceller.cancel();
                }
            }
        });

        let error = install_model(&source, dir.path(), &first, emit)
            .await
            .unwrap_err();

        assert!(matches!(error, InstallError::Cancelled), "{error}");
        let kept = std::fs::metadata(dir.path().join(PART_FILE)).unwrap().len();
        assert!(kept > 0 && kept < data.len() as u64);
        drop(first);
        assert!(!controller.is_busy());

        server.mode(Mode::Normal);
        let second = controller.begin().unwrap();
        let path = install_model(&source, dir.path(), &second, silent())
            .await
            .unwrap();
        assert_eq!(std::fs::read(path).unwrap(), data);
    }

    #[tokio::test]
    async fn an_installed_valid_file_needs_no_network() {
        let data = body(300_000);
        let server = Server::start(data.clone());
        let source = source_for(&server, &data);
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(MODEL_FILE), &data).unwrap();
        let (_c, guard) = guard();

        install_model(&source, dir.path(), &guard, silent())
            .await
            .unwrap();

        assert_eq!(server.requests(), 0);
        assert!(info(&source, dir.path(), false).installed);
    }

    #[tokio::test]
    async fn a_damaged_installed_file_is_replaced() {
        let data = body(300_000);
        let server = Server::start(data.clone());
        let source = source_for(&server, &data);
        let dir = tempfile::tempdir().unwrap();
        let mut damaged = data.clone();
        damaged[10] ^= 1;
        std::fs::write(dir.path().join(MODEL_FILE), damaged).unwrap();
        let (_c, guard) = guard();

        let path = install_model(&source, dir.path(), &guard, silent())
            .await
            .unwrap();

        assert_eq!(std::fs::read(path).unwrap(), data);
        assert_eq!(server.requests(), 1);
    }

    #[test]
    fn only_one_installation_runs_at_a_time() {
        let controller = InstallController::default();
        let first = controller.begin().unwrap();
        assert!(matches!(controller.begin(), Err(InstallError::Busy)));
        drop(first);
        assert!(controller.begin().is_ok());
    }

    #[test]
    fn free_space_needs_the_rest_of_the_file_plus_a_margin() {
        let gib = 1024 * 1024 * 1024;
        assert!(ensure_free_space(2 * gib, 3 * gib).is_ok());
        let error = ensure_free_space(2 * gib, 2 * gib).unwrap_err();
        assert!(matches!(error, InstallError::NoSpace { .. }), "{error}");
        assert!(error.to_string().contains("потрібно ще"));
    }

    #[test]
    fn finalize_waits_for_a_runner_and_then_writes_a_checked_package() {
        let data = body(50_000);
        let server = Server::start(data.clone());
        let source = source_for(&server, &data);
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(MODEL_FILE), &data).unwrap();

        assert!(matches!(
            finalize_package(&source, dir.path()).unwrap(),
            Finalized::NeedsRunner
        ));
        assert!(!dir.path().join(MANIFEST_FILE).exists());

        // A synthetic stand-in: finalize never starts the runner.
        std::fs::write(dir.path().join("runner.exe"), b"synthetic runner").unwrap();
        let Finalized::Ready(package) = finalize_package(&source, dir.path()).unwrap() else {
            panic!("package expected");
        };
        assert_eq!(package.manifest.model.sha256, source.sha256);
        assert_eq!(package.manifest.context_tokens, 2048);
        assert_eq!(package.manifest.runner.file, "runner.exe");
        assert!(info(&source, dir.path(), false).runner_present);
    }

    #[test]
    fn removal_touches_only_the_applications_model_folder() {
        let root = tempfile::tempdir().unwrap();
        let outside = root.path().join("documents");
        std::fs::create_dir_all(&outside).unwrap();
        assert!(remove_files(&outside).is_err());
        assert!(outside.exists());

        let own = root.path().join("local-models").join("qwen3-4b-q4km");
        std::fs::create_dir_all(&own).unwrap();
        std::fs::write(own.join(MODEL_FILE), b"x").unwrap();
        remove_files(&own).unwrap();
        assert!(!own.exists());
        remove_files(&own).unwrap();
    }
}
