//! Опитування публічної служби DIMAP для шару карти дашборда.
//!
//! Запит робить лише Rust: один HTTPS GET на `https://api.dimap.live/api/polling`,
//! без перенаправлень, із таймаутом 8 с і заголовком `If-None-Match`, якщо попередня
//! відповідь мала ETag. Назовні не йдуть ні таблиці, ні профіль, ні координати карти.
//! Команда `dimap_poll` викликає `network_policy` до цього модуля: без увімкненого
//! запису профілю `dimap.state` запиту немає.
//!
//! Тут розбір, пауза після помилки і сам HTTP. Тести б'ють по вигаданій фікстурі
//! `tests/fixtures/dimap-polling.json` і не ходять у мережу.

use serde::Serialize;
use serde_json::Value;
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub const ENDPOINT: &str = "https://api.dimap.live/api/polling";
pub const POLL_INTERVAL: Duration = Duration::from_secs(10);
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(8);
/// Жива відповідь близько 300 КБ. Більше за 1 МіБ — не те, що ми готові розбирати.
pub const MAX_RESPONSE_BYTES: usize = 1024 * 1024;
const MAX_TARGETS: usize = 200;
const MAX_ALERTS: usize = 200;
const MAX_TEXT: usize = 80;
/// На карті лишається лише хвіст шляху, не весь `path`/`observed`.
const TRAJ_TAIL: usize = 8;
const EARLY_SLACK: Duration = Duration::from_millis(250);
const USER_AGENT: &str = "EasyWAR";

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum DimapError {
    #[error("службу DIMAP не вдалося прочитати")]
    BadResponse,
}

/// Знімок, який бачить інтерфейс. Невідомі поля сирої відповіді сюди не потрапляють.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DimapSnapshot {
    pub updated_at_ms: i64,
    pub targets: Vec<DimapTarget>,
    pub alerts: Vec<DimapAlert>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DimapTarget {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub lat: f64,
    pub lng: f64,
    pub bearing: f64,
    pub speed: Option<f64>,
    pub last_seen_ms: Option<i64>,
    /// Короткий хвіст траєкторії (не більше [`TRAJ_TAIL`] точок). Порожній, якщо `traj` немає.
    pub traj: Vec<DimapPoint>,
}

/// Точка траєкторії. Висоту й службові поля `traj` не зберігаємо.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DimapPoint {
    pub lat: f64,
    pub lng: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DimapAlert {
    pub id: String,
    pub region: String,
    pub color: String,
    pub kind: String,
    pub type_name: String,
    pub alert_type: String,
    pub district: String,
    pub city: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DimapPoll {
    pub status: String,
    pub retry_after_ms: u64,
    pub updated_at_ms: Option<i64>,
    pub snapshot: Option<DimapSnapshot>,
}

impl DimapPoll {
    fn status_only(
        status: &str,
        retry_after_ms: u64,
        updated_at_ms: Option<i64>,
        snapshot: Option<DimapSnapshot>,
    ) -> Self {
        Self {
            status: status.to_owned(),
            retry_after_ms,
            updated_at_ms,
            snapshot,
        }
    }
}

/// `dimap.state` у даних профілю. Немає запису, битий JSON або не `true` — шар вимкнено.
pub fn saved_enabled(raw: Option<&str>) -> bool {
    raw.and_then(|text| serde_json::from_str::<Value>(text).ok())
        .and_then(|value| value.get("enabled").and_then(Value::as_bool))
        == Some(true)
}

/// Пауза після помилки: 10 с, далі вдвічі, але не довше 5 хв. Нуль помилок — звичайні 10 с.
pub fn backoff_ms(failures: u32) -> u64 {
    if failures == 0 {
        return POLL_INTERVAL.as_millis() as u64;
    }
    let shift = failures.saturating_sub(1).min(5);
    10_000u64.saturating_mul(1_u64 << shift).min(300_000)
}

/// Скільки ще чекати. `None` — запит уже можна робити (із запасом 250 мс, щоб таймер
/// інтерфейсу, який спрацював трохи раніше, не отримав порожню відмову).
pub fn wait_ms(not_before: Instant, now: Instant) -> Option<u64> {
    if not_before <= now + EARLY_SLACK {
        return None;
    }
    let ms = not_before.saturating_duration_since(now).as_millis();
    Some(u64::try_from(ms).unwrap_or(u64::MAX))
}

/// ETag лише з друкованих ASCII без керування, щоб наступний `If-None-Match` не зібрав
/// зайвого заголовка з відповіді.
pub fn clean_etag(raw: &str) -> Option<String> {
    let text = raw.trim();
    if text.is_empty() || text.len() > 200 {
        return None;
    }
    if text
        .chars()
        .any(|ch| !ch.is_ascii() || ch.is_ascii_control())
    {
        return None;
    }
    Some(text.to_owned())
}

pub fn polling_url() -> reqwest::Url {
    reqwest::Url::parse(ENDPOINT).expect("стала адреса DIMAP")
}

/// Розбір тіла. Невідомі поля ігноруються. `data.alerts.history` і `target.history`
/// не читаються: після розбору їх у знімку немає. Биті точки пропускаються.
pub fn parse_polling(body: &str, received_ms: i64) -> Result<DimapSnapshot, DimapError> {
    let root: Value = serde_json::from_str(body).map_err(|_| DimapError::BadResponse)?;
    let data = match root.get("data") {
        Some(value) if value.is_object() => value,
        _ if root.is_object() => &root,
        _ => return Err(DimapError::BadResponse),
    };
    let targets_block = data.get("targets");
    let alerts_block = data.get("alerts");
    let updated = timestamp_ms(alerts_block.and_then(|block| block.get("updatedAt")))
        .or_else(|| timestamp_ms(targets_block.and_then(|block| block.get("timestamp"))))
        .unwrap_or(received_ms);
    let raw_targets = array_at(targets_block, &["targets"])
        .or_else(|| targets_block.and_then(Value::as_array).map(Vec::as_slice))
        .unwrap_or(&[]);
    let raw_alerts = array_at(alerts_block, &["alerts"]).unwrap_or(&[]);
    let mut targets = Vec::new();
    for (index, item) in raw_targets.iter().enumerate() {
        if targets.len() >= MAX_TARGETS {
            break;
        }
        if let Some(target) = target_from(item, index) {
            targets.push(target);
        }
    }
    let mut alerts = Vec::new();
    for (index, item) in raw_alerts.iter().enumerate() {
        if alerts.len() >= MAX_ALERTS {
            break;
        }
        if let Some(alert) = alert_from(item, index) {
            alerts.push(alert);
        }
    }
    Ok(DimapSnapshot {
        updated_at_ms: updated,
        targets,
        alerts,
    })
}

fn array_at<'a>(value: Option<&'a Value>, path: &[&str]) -> Option<&'a [Value]> {
    let mut current = value?;
    for key in path {
        current = current.get(*key)?;
    }
    current.as_array().map(Vec::as_slice)
}

fn target_from(item: &Value, index: usize) -> Option<DimapTarget> {
    let lat = finite_coord(number_at(item, "lat"), -90.0, 90.0)?;
    let lng = finite_coord(number_at(item, "lng"), -180.0, 180.0)?;
    let kind = text_at(item, "type").or_else(|| text_at(item, "kind"));
    let name = text_at(item, "name").or_else(|| kind.clone());
    Some(DimapTarget {
        id: text_at(item, "id").unwrap_or_else(|| format!("t{index}")),
        kind: kind.unwrap_or_default(),
        name: name.unwrap_or_default(),
        lat,
        lng,
        bearing: number_at(item, "bearing")
            .filter(|value| value.is_finite())
            .map(wrap_bearing)
            .unwrap_or(0.0),
        speed: number_at(item, "speed")
            .filter(|value| value.is_finite() && (0.0..=2_000.0).contains(value)),
        last_seen_ms: timestamp_ms(item.get("lastSeen"))
            .or_else(|| timestamp_ms(item.get("lastSeenMs"))),
        traj: traj_tail(item.get("traj")),
    })
}

/// `path`: `[широта, довгота, …]`; якщо його немає — `observed`: `{lat,lng}`.
fn traj_tail(traj: Option<&Value>) -> Vec<DimapPoint> {
    let Some(traj) = traj.filter(|value| value.is_object()) else {
        return Vec::new();
    };
    let mut points = Vec::new();
    if let Some(path) = traj.get("path").and_then(Value::as_array) {
        for item in path {
            if let Some(point) = point_from(item) {
                points.push(point);
            }
        }
    }
    if points.is_empty() {
        if let Some(observed) = traj.get("observed").and_then(Value::as_array) {
            for item in observed {
                if let Some(point) = point_from(item) {
                    points.push(point);
                }
            }
        }
    }
    if points.len() > TRAJ_TAIL {
        points.split_off(points.len() - TRAJ_TAIL)
    } else {
        points
    }
}

fn point_from(item: &Value) -> Option<DimapPoint> {
    let (lat, lng) = if let Some(pair) = item.as_array() {
        (
            finite_coord(pair.first().and_then(Value::as_f64), -90.0, 90.0)?,
            finite_coord(pair.get(1).and_then(Value::as_f64), -180.0, 180.0)?,
        )
    } else {
        (
            finite_coord(number_at(item, "lat"), -90.0, 90.0)?,
            finite_coord(number_at(item, "lng"), -180.0, 180.0)?,
        )
    };
    Some(DimapPoint { lat, lng })
}

fn alert_from(item: &Value, index: usize) -> Option<DimapAlert> {
    let region = text_at(item, "region")?;
    if region.is_empty() {
        return None;
    }
    Some(DimapAlert {
        id: text_at(item, "id").unwrap_or_else(|| format!("a{index}")),
        region,
        color: text_at(item, "color").unwrap_or_else(|| "red".to_owned()),
        kind: text_at(item, "kind").unwrap_or_default(),
        type_name: text_at(item, "typeName").unwrap_or_default(),
        alert_type: text_at(item, "alertType").unwrap_or_default(),
        district: text_at(item, "district").unwrap_or_default(),
        city: text_at(item, "city").unwrap_or_default(),
    })
}

fn text_at(item: &Value, key: &str) -> Option<String> {
    let value = item.get(key)?;
    let raw = match value {
        Value::String(text) => text.clone(),
        Value::Number(number) => number.to_string(),
        _ => return None,
    };
    let cleaned: String = raw
        .chars()
        .filter(|ch| !ch.is_control())
        .take(MAX_TEXT)
        .collect();
    let cleaned = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    if cleaned.is_empty() {
        None
    } else {
        Some(cleaned)
    }
}

fn number_at(item: &Value, key: &str) -> Option<f64> {
    match item.get(key)? {
        Value::Number(number) => number.as_f64(),
        Value::String(text) => text.trim().parse().ok(),
        _ => None,
    }
}

fn finite_coord(value: Option<f64>, min: f64, max: f64) -> Option<f64> {
    value.filter(|number| number.is_finite() && (min..=max).contains(number))
}

fn wrap_bearing(value: f64) -> f64 {
    let wrapped = value % 360.0;
    if wrapped < 0.0 {
        wrapped + 360.0
    } else {
        wrapped
    }
}

fn timestamp_ms(value: Option<&Value>) -> Option<i64> {
    let value = value?;
    match value {
        Value::Number(number) => number.as_i64().map(as_millis).or_else(|| {
            number
                .as_f64()
                .filter(|value| value.is_finite())
                .map(|value| as_millis(value.round() as i64))
        }),
        Value::String(text) => parse_time_string(text),
        _ => None,
    }
}

fn as_millis(value: i64) -> i64 {
    if value.abs() < 10_000_000_000 {
        value.saturating_mul(1000)
    } else {
        value
    }
}

fn parse_time_string(text: &str) -> Option<i64> {
    let text = text.trim();
    if text.is_empty() {
        return None;
    }
    if let Ok(number) = text.parse::<i64>() {
        return Some(as_millis(number));
    }
    chrono::DateTime::parse_from_rfc3339(text)
        .ok()
        .map(|time| time.timestamp_millis())
}

#[derive(Debug, Default)]
struct CacheInner {
    etag: Option<String>,
    failures: u32,
    not_before: Option<Instant>,
    updated_at_ms: Option<i64>,
}

#[derive(Debug)]
pub struct HttpReply {
    pub status: u16,
    pub etag: Option<String>,
    pub body: Vec<u8>,
}

fn absorb(inner: &mut CacheInner, now: Instant, received_ms: i64, reply: HttpReply) -> DimapPoll {
    if reply.status == 304 {
        if let Some(etag) = reply.etag.as_deref().and_then(clean_etag) {
            inner.etag = Some(etag);
        }
        inner.failures = 0;
        inner.not_before = Some(now + POLL_INTERVAL);
        return DimapPoll::status_only(
            "not_modified",
            POLL_INTERVAL.as_millis() as u64,
            inner.updated_at_ms,
            None,
        );
    }
    if reply.status == 200 {
        let text = std::str::from_utf8(&reply.body).ok();
        if let Some(snapshot) = text.and_then(|body| parse_polling(body, received_ms).ok()) {
            inner.etag = reply.etag.as_deref().and_then(clean_etag);
            inner.failures = 0;
            inner.updated_at_ms = Some(snapshot.updated_at_ms);
            inner.not_before = Some(now + POLL_INTERVAL);
            return DimapPoll::status_only(
                "ok",
                POLL_INTERVAL.as_millis() as u64,
                Some(snapshot.updated_at_ms),
                Some(snapshot),
            );
        }
    }
    fail(inner, now)
}

fn fail(inner: &mut CacheInner, now: Instant) -> DimapPoll {
    inner.failures = inner.failures.saturating_add(1);
    let retry = backoff_ms(inner.failures);
    inner.not_before = Some(now + Duration::from_millis(retry));
    DimapPoll::status_only("error", retry, inner.updated_at_ms, None)
}

/// Стан ETag і паузи між викликами команди. Живе в процесі, не у файлі.
#[derive(Debug, Default)]
pub struct DimapCache {
    inner: Mutex<CacheInner>,
}

impl DimapCache {
    fn lock(&self) -> std::sync::MutexGuard<'_, CacheInner> {
        self.inner
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
    }

    pub async fn poll_once(&self) -> DimapPoll {
        let now = Instant::now();
        {
            let inner = self.lock();
            if let Some(at) = inner.not_before {
                if let Some(retry) = wait_ms(at, now) {
                    return DimapPoll::status_only("wait", retry, inner.updated_at_ms, None);
                }
            }
        }
        let etag = self.lock().etag.clone();
        match fetch(etag.as_deref()).await {
            Ok(reply) => {
                let mut inner = self.lock();
                absorb(
                    &mut inner,
                    Instant::now(),
                    chrono::Utc::now().timestamp_millis(),
                    reply,
                )
            }
            Err(_) => {
                let mut inner = self.lock();
                fail(&mut inner, Instant::now())
            }
        }
    }
}

async fn fetch(etag: Option<&str>) -> Result<HttpReply, DimapError> {
    let url = polling_url();
    if url.scheme() != "https"
        || url.host_str() != Some("api.dimap.live")
        || url.path() != "/api/polling"
    {
        return Err(DimapError::BadResponse);
    }
    crate::install_tls_provider();
    let client = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .user_agent(USER_AGENT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| DimapError::BadResponse)?;
    let mut request = client.get(url);
    if let Some(etag) = etag.and_then(clean_etag) {
        request = request.header("if-none-match", etag);
    }
    let response = request.send().await.map_err(|_| DimapError::BadResponse)?;
    let status = response.status().as_u16();
    let etag = response
        .headers()
        .get("etag")
        .and_then(|value| value.to_str().ok())
        .and_then(clean_etag);
    if status == 304 {
        return Ok(HttpReply {
            status,
            etag,
            body: Vec::new(),
        });
    }
    if status != 200 {
        return Ok(HttpReply {
            status,
            etag: None,
            body: Vec::new(),
        });
    }
    let mut body = Vec::new();
    let mut response = response;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| DimapError::BadResponse)?
    {
        if body.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
            return Err(DimapError::BadResponse);
        }
        body.extend_from_slice(&chunk);
    }
    Ok(HttpReply { status, etag, body })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> &'static str {
        include_str!("../../tests/fixtures/dimap-polling.json")
    }

    #[test]
    fn fixture_keeps_three_targets_and_skips_the_broken_one() {
        let snapshot = parse_polling(fixture(), 1).unwrap();
        assert_eq!(snapshot.targets.len(), 5);
        assert_eq!(
            snapshot
                .targets
                .iter()
                .map(|item| item.kind.as_str())
                .collect::<Vec<_>>(),
            ["shahed", "fpv", "reactive_shahed", "avia", "kab"]
        );
        assert_eq!(snapshot.targets[0].name, "Шахед");
        assert_eq!(snapshot.targets[0].bearing, 270.0);
        assert_eq!(snapshot.targets[0].speed, Some(180.0));
        assert_eq!(snapshot.targets[0].traj.len(), 4);
        assert!((snapshot.targets[0].traj[0].lat - 49.55).abs() < 0.001);
        assert_eq!(snapshot.targets[4].traj.len(), 3);
        assert_eq!(snapshot.targets[2].name, "Герань-4");
        assert_eq!(snapshot.alerts.len(), 4);
        assert_eq!(snapshot.alerts[0].kind, "oblast");
        assert_eq!(snapshot.alerts[0].alert_type, "air");
        assert_eq!(snapshot.alerts[1].kind, "district");
        assert_eq!(snapshot.alerts[1].district, "Тестовий район");
        assert_eq!(snapshot.alerts[1].alert_type, "artillery");
        assert_eq!(snapshot.alerts[2].kind, "community");
        assert_eq!(snapshot.alerts[3].kind, "city");
        assert_eq!(snapshot.alerts[3].city, "Тестове місто");
        assert_eq!(snapshot.alerts[3].alert_type, "urban_fights");
        assert_eq!(snapshot.updated_at_ms, 1_763_722_800_000);
    }

    #[test]
    fn unknown_shape_and_garbage_do_not_panic() {
        assert_eq!(parse_polling("{}", 5).unwrap().targets.len(), 0);
        assert_eq!(parse_polling("[]", 5), Err(DimapError::BadResponse));
        assert_eq!(parse_polling("не json", 5), Err(DimapError::BadResponse));
        let weird = r#"{"data":{"targets":{"targets":[{"lat":91,"lng":30},{"lat":50,"lng":30,"bearing":-90,"speed":-5,"name":"  Цілі  "}]},"alerts":{"alerts":[{},{"region":"Полтавська","color":"yellow"}]}}}"#;
        let snapshot = parse_polling(weird, 9).unwrap();
        assert_eq!(snapshot.targets.len(), 1);
        assert_eq!(snapshot.targets[0].bearing, 270.0);
        assert_eq!(snapshot.targets[0].speed, None);
        assert_eq!(snapshot.targets[0].name, "Цілі");
        assert_eq!(snapshot.alerts.len(), 1);
        assert_eq!(snapshot.updated_at_ms, 9);
    }

    #[test]
    fn lists_are_capped() {
        let mut targets = Vec::new();
        for index in 0..250 {
            targets.push(serde_json::json!({"id": index, "lat": 50, "lng": 30, "type": "uav"}));
        }
        let body = serde_json::json!({"data": {"targets": {"targets": targets}}}).to_string();
        assert_eq!(parse_polling(&body, 1).unwrap().targets.len(), MAX_TARGETS);
        let mut path = Vec::new();
        for index in 0..20 {
            path.push(serde_json::json!([48.0 + index as f64 * 0.01, 36.0, 100]));
        }
        let tracked = serde_json::json!({"data": {"targets": {"targets": [{"lat": 48, "lng": 36, "type": "shahed", "history": [1, 2, 3], "traj": {"path": path}}], "history": {"skip": true}}, "alerts": {"history": [{"endedAt": 1}, {"endedAt": 2}], "alerts": [{"region": "Полтавська"}]}}}).to_string();
        let parsed = parse_polling(&tracked, 3).unwrap();
        assert_eq!(parsed.targets[0].traj.len(), TRAJ_TAIL);
        assert!((parsed.targets[0].traj[0].lat - 48.12).abs() < 0.001);
        assert_eq!(parsed.alerts.len(), 1);
    }

    #[test]
    fn etag_rejects_newlines_and_backoff_grows() {
        assert_eq!(clean_etag("  W/\"abc\"  ").as_deref(), Some("W/\"abc\""));
        assert_eq!(clean_etag("bad\r\nX-Other: 1"), None);
        assert_eq!(clean_etag(""), None);
        assert_eq!(backoff_ms(0), 10_000);
        assert_eq!(backoff_ms(1), 10_000);
        assert_eq!(backoff_ms(2), 20_000);
        assert_eq!(backoff_ms(3), 40_000);
        assert_eq!(backoff_ms(9), 300_000);
        assert!(!saved_enabled(None));
        assert!(!saved_enabled(Some("{\"enabled\":false}")));
        assert!(saved_enabled(Some("{\"enabled\":true,\"extra\":1}")));
    }

    #[test]
    fn not_modified_keeps_the_previous_time_and_errors_wait() {
        let now = Instant::now();
        let mut inner = CacheInner::default();
        let ok = absorb(
            &mut inner,
            now,
            42,
            HttpReply {
                status: 200,
                etag: Some("\"v1\"".into()),
                body: fixture().as_bytes().to_vec(),
            },
        );
        assert_eq!(ok.status, "ok");
        assert!(ok.snapshot.is_some());
        let again = absorb(
            &mut inner,
            now,
            99,
            HttpReply {
                status: 304,
                etag: Some("\"v1\"".into()),
                body: Vec::new(),
            },
        );
        assert_eq!(again.status, "not_modified");
        assert!(again.snapshot.is_none());
        assert_eq!(again.updated_at_ms, ok.updated_at_ms);
        let err = absorb(
            &mut inner,
            now,
            100,
            HttpReply {
                status: 500,
                etag: None,
                body: Vec::new(),
            },
        );
        assert_eq!(err.status, "error");
        assert_eq!(err.retry_after_ms, 10_000);
        assert!(wait_ms(now + Duration::from_secs(10), now).is_some());
        assert!(wait_ms(now, now).is_none());
    }
}
