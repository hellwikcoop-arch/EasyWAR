//! Онлайн-погода для застосунку «Погода» (модуль «Робоче середовище», розділ «Обстановка»).
//!
//! Мережевий запит робить лише Rust і лише на дві фіксовані адреси Open-Meteo по HTTPS:
//! прогноз (`api.open-meteo.com`) і пошук населеного пункту (`geocoding-api.open-meteo.com`).
//! Назовні йдуть тільки координати пункту, округлені до 0,01° (≈1 км), або назва, яку
//! користувач шукає. Жодних ключів, профілю чи таблиць. Застосунок вмикає онлайн-оновлення
//! явно; без цього команди не викликаються.
//!
//! Тут лише чиста частина (адреси, перевірка введення, розбір відповіді) — її покривають тести
//! на вигаданих відповідях. Сам HTTP-запит — у командах `weather_online_*` у `lib.rs`.

use serde::Serialize;
use serde_json::Value;

pub const FORECAST_ENDPOINT: &str = "https://api.open-meteo.com/v1/forecast";
pub const GEOCODE_ENDPOINT: &str = "https://geocoding-api.open-meteo.com/v1/search";
/// Відповідь Open-Meteo на один пункт займає кілька кілобайт; більше — щось не те.
pub const MAX_RESPONSE_BYTES: usize = 256 * 1024;
const MIN_QUERY_CHARS: usize = 2;
const MAX_QUERY_CHARS: usize = 80;
const MAX_PLACES: usize = 10;
const CURRENT_FIELDS: &str = "temperature_2m,dew_point_2m,cloud_cover,cloud_cover_low,visibility,wind_speed_10m,wind_direction_10m,weather_code";

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum WeatherOnlineError {
    #[error("недійсні координати населеного пункту")]
    InvalidCoordinates,
    #[error("назва для пошуку має містити від {MIN_QUERY_CHARS} до {MAX_QUERY_CHARS} символів")]
    InvalidQuery,
    #[error("служба погоди повернула відповідь, яку не вдалося розібрати")]
    BadResponse,
    #[error("служба погоди не повідомила поточних умов для цього пункту")]
    NoCurrent,
}

/// Поточні умови в пункті, як їх повідомила служба. Порожнє поле — служба значення не дала.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeatherObservation {
    /// Місцевий час спостереження у форматі служби (`2026-10-20T13:00`).
    pub time: String,
    pub timezone: Option<String>,
    pub utc_offset_seconds: Option<i64>,
    pub latitude: f64,
    pub longitude: f64,
    pub temperature: Option<f64>,
    pub dew_point: Option<f64>,
    /// Загальна хмарність, %.
    pub cloud_cover: Option<f64>,
    /// Нижня хмарність, %.
    pub cloud_cover_low: Option<f64>,
    /// Видимість, м.
    pub visibility: Option<f64>,
    /// Вітер на 10 м, м/с.
    pub wind_speed: Option<f64>,
    pub wind_direction: Option<f64>,
    /// Код погоди WMO.
    pub weather_code: Option<i64>,
}

/// Знайдений населений пункт.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeatherPlace {
    pub name: String,
    pub region: Option<String>,
    pub district: Option<String>,
    pub country_code: Option<String>,
    pub latitude: f64,
    pub longitude: f64,
}

/// Координати, округлені до 0,01°: стільки й іде назовні.
pub fn rounded_coordinates(
    latitude: f64,
    longitude: f64,
) -> Result<(f64, f64), WeatherOnlineError> {
    if !latitude.is_finite()
        || !longitude.is_finite()
        || !(-90.0..=90.0).contains(&latitude)
        || !(-180.0..=180.0).contains(&longitude)
    {
        return Err(WeatherOnlineError::InvalidCoordinates);
    }
    let round = |value: f64| (value * 100.0).round() / 100.0;
    Ok((round(latitude), round(longitude)))
}

/// Адреса запиту поточних умов.
pub fn forecast_url(latitude: f64, longitude: f64) -> Result<reqwest::Url, WeatherOnlineError> {
    let (lat, lon) = rounded_coordinates(latitude, longitude)?;
    let mut url = reqwest::Url::parse(FORECAST_ENDPOINT).expect("стала адреса прогнозу");
    url.query_pairs_mut()
        .append_pair("latitude", &format!("{lat:.2}"))
        .append_pair("longitude", &format!("{lon:.2}"))
        .append_pair("current", CURRENT_FIELDS)
        .append_pair("wind_speed_unit", "ms")
        .append_pair("timezone", "auto");
    Ok(url)
}

/// Назва для пошуку без зайвих пробілів; порожня, коротка чи задовга — помилка.
pub fn clean_query(name: &str) -> Result<String, WeatherOnlineError> {
    let cleaned = name
        .chars()
        .filter(|ch| !ch.is_control())
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let count = cleaned.chars().count();
    if !(MIN_QUERY_CHARS..=MAX_QUERY_CHARS).contains(&count) {
        return Err(WeatherOnlineError::InvalidQuery);
    }
    Ok(cleaned)
}

/// Адреса пошуку населеного пункту (лише Україна, назви українською).
pub fn geocode_url(name: &str) -> Result<reqwest::Url, WeatherOnlineError> {
    let query = clean_query(name)?;
    let mut url = reqwest::Url::parse(GEOCODE_ENDPOINT).expect("стала адреса пошуку");
    url.query_pairs_mut()
        .append_pair("name", &query)
        .append_pair("count", &MAX_PLACES.to_string())
        .append_pair("language", "uk")
        .append_pair("countryCode", "UA")
        .append_pair("format", "json");
    Ok(url)
}

fn number(value: Option<&Value>) -> Option<f64> {
    value
        .and_then(Value::as_f64)
        .filter(|number| number.is_finite())
}

fn text(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(|text| text.chars().take(120).collect())
}

/// Розбір відповіді прогнозу (`current=…`).
pub fn parse_forecast(body: &Value) -> Result<WeatherObservation, WeatherOnlineError> {
    let object = body.as_object().ok_or(WeatherOnlineError::BadResponse)?;
    let current = object
        .get("current")
        .and_then(Value::as_object)
        .ok_or(WeatherOnlineError::NoCurrent)?;
    let time = text(current.get("time")).ok_or(WeatherOnlineError::NoCurrent)?;
    let latitude = number(object.get("latitude")).ok_or(WeatherOnlineError::BadResponse)?;
    let longitude = number(object.get("longitude")).ok_or(WeatherOnlineError::BadResponse)?;
    Ok(WeatherObservation {
        time,
        timezone: text(object.get("timezone")),
        utc_offset_seconds: object.get("utc_offset_seconds").and_then(Value::as_i64),
        latitude,
        longitude,
        temperature: number(current.get("temperature_2m")),
        dew_point: number(current.get("dew_point_2m")),
        cloud_cover: number(current.get("cloud_cover")),
        cloud_cover_low: number(current.get("cloud_cover_low")),
        visibility: number(current.get("visibility")),
        wind_speed: number(current.get("wind_speed_10m")),
        wind_direction: number(current.get("wind_direction_10m")),
        weather_code: current.get("weather_code").and_then(Value::as_i64),
    })
}

/// Розбір відповіді пошуку. Немає `results` — нічого не знайдено (порожній список).
pub fn parse_places(body: &Value) -> Result<Vec<WeatherPlace>, WeatherOnlineError> {
    let object = body.as_object().ok_or(WeatherOnlineError::BadResponse)?;
    let Some(results) = object.get("results") else {
        return Ok(Vec::new());
    };
    let results = results.as_array().ok_or(WeatherOnlineError::BadResponse)?;
    Ok(results
        .iter()
        .filter_map(|item| {
            let item = item.as_object()?;
            let latitude = number(item.get("latitude"))?;
            let longitude = number(item.get("longitude"))?;
            rounded_coordinates(latitude, longitude).ok()?;
            Some(WeatherPlace {
                name: text(item.get("name"))?,
                region: text(item.get("admin1")),
                district: text(item.get("admin2")),
                country_code: text(item.get("country_code")),
                latitude,
                longitude,
            })
        })
        .take(MAX_PLACES)
        .collect())
}

const REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);
const USER_AGENT: &str = "EasyWAR";

/// Один GET на фіксовану адресу Open-Meteo: лише HTTPS, без перенаправлень, з обмеженням
/// часу й розміру відповіді. Помилку повертає українським текстом для інтерфейсу.
pub async fn fetch_json(url: reqwest::Url) -> Result<Value, String> {
    if url.scheme() != "https" {
        return Err("дозволено лише захищене з'єднання".into());
    }
    crate::install_tls_provider();
    let client = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .user_agent(USER_AGENT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "не вдалося підготувати запит до служби погоди".to_string())?;
    let mut response = client.get(url).send().await.map_err(|error| {
        if error.is_timeout() {
            "служба погоди не відповіла вчасно".to_string()
        } else {
            "немає зв'язку зі службою погоди".to_string()
        }
    })?;
    if !response.status().is_success() {
        return Err(format!(
            "служба погоди відповіла помилкою {}",
            response.status().as_u16()
        ));
    }
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "з'єднання зі службою погоди обірвалося".to_string())?
    {
        if body.len() + chunk.len() > MAX_RESPONSE_BYTES {
            return Err(WeatherOnlineError::BadResponse.to_string());
        }
        body.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&body).map_err(|_| WeatherOnlineError::BadResponse.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn coordinates_are_rounded_to_a_kilometre_and_validated() {
        assert_eq!(
            rounded_coordinates(48.123456, 35.987654).unwrap(),
            (48.12, 35.99)
        );
        assert_eq!(
            rounded_coordinates(f64::NAN, 30.0),
            Err(WeatherOnlineError::InvalidCoordinates)
        );
        assert_eq!(
            rounded_coordinates(91.0, 30.0),
            Err(WeatherOnlineError::InvalidCoordinates)
        );
        assert_eq!(
            rounded_coordinates(48.0, -181.0),
            Err(WeatherOnlineError::InvalidCoordinates)
        );
    }

    #[test]
    fn forecast_url_sends_only_rounded_coordinates_to_the_fixed_host() {
        let url = forecast_url(48.123456, 35.987654).unwrap();
        assert_eq!(url.scheme(), "https");
        assert_eq!(url.host_str(), Some("api.open-meteo.com"));
        let pairs: Vec<(String, String)> = url.query_pairs().into_owned().collect();
        assert!(pairs.contains(&("latitude".into(), "48.12".into())));
        assert!(pairs.contains(&("longitude".into(), "35.99".into())));
        assert!(pairs.contains(&("wind_speed_unit".into(), "ms".into())));
        let names: Vec<&str> = pairs.iter().map(|(name, _)| name.as_str()).collect();
        assert_eq!(
            names,
            [
                "latitude",
                "longitude",
                "current",
                "wind_speed_unit",
                "timezone"
            ]
        );
    }

    #[test]
    fn geocode_url_cleans_the_query_and_limits_search_to_ukraine() {
        let url = geocode_url("  Вигадане \n  Село ").unwrap();
        assert_eq!(url.host_str(), Some("geocoding-api.open-meteo.com"));
        let pairs: Vec<(String, String)> = url.query_pairs().into_owned().collect();
        assert!(pairs.contains(&("name".into(), "Вигадане Село".into())));
        assert!(pairs.contains(&("countryCode".into(), "UA".into())));
        assert!(pairs.contains(&("language".into(), "uk".into())));
        assert_eq!(geocode_url(" а "), Err(WeatherOnlineError::InvalidQuery));
        assert_eq!(
            geocode_url(&"я".repeat(81)),
            Err(WeatherOnlineError::InvalidQuery)
        );
    }

    #[test]
    fn forecast_is_parsed_from_a_synthetic_response() {
        let body = json!({
            "latitude": 48.12, "longitude": 35.99, "timezone": "Europe/Kyiv",
            "utc_offset_seconds": 10800,
            "current": {
                "time": "2026-10-20T13:00", "interval": 900,
                "temperature_2m": 9.4, "dew_point_2m": 7.0, "cloud_cover": 88,
                "cloud_cover_low": 75, "visibility": 4200.0, "wind_speed_10m": 6.1,
                "wind_direction_10m": 250, "weather_code": 61
            }
        });
        let observation = parse_forecast(&body).unwrap();
        assert_eq!(observation.time, "2026-10-20T13:00");
        assert_eq!(observation.timezone.as_deref(), Some("Europe/Kyiv"));
        assert_eq!(observation.utc_offset_seconds, Some(10800));
        assert_eq!(observation.cloud_cover, Some(88.0));
        assert_eq!(observation.cloud_cover_low, Some(75.0));
        assert_eq!(observation.visibility, Some(4200.0));
        assert_eq!(observation.dew_point, Some(7.0));
        assert_eq!(observation.weather_code, Some(61));
    }

    #[test]
    fn forecast_without_current_or_with_garbage_is_rejected_and_missing_fields_stay_empty() {
        assert_eq!(
            parse_forecast(&json!({"latitude": 1.0, "longitude": 2.0})),
            Err(WeatherOnlineError::NoCurrent)
        );
        assert_eq!(
            parse_forecast(&json!([1, 2])),
            Err(WeatherOnlineError::BadResponse)
        );
        let sparse = parse_forecast(&json!({
            "latitude": 48.0, "longitude": 35.0,
            "current": {"time": "2026-10-20T13:00", "visibility": "далеко"}
        }))
        .unwrap();
        assert_eq!(sparse.visibility, None);
        assert_eq!(sparse.cloud_cover, None);
        assert_eq!(sparse.timezone, None);
    }

    #[test]
    fn places_are_parsed_and_broken_entries_skipped() {
        let body = json!({"results": [
            {"name": "Вигадане", "admin1": "Тестова область", "admin2": "Пробний район",
             "country_code": "UA", "latitude": 49.5, "longitude": 31.25},
            {"name": "Без координат"},
            {"name": "", "latitude": 49.0, "longitude": 31.0},
            {"name": "Поза межами", "latitude": 120.0, "longitude": 31.0}
        ]});
        let places = parse_places(&body).unwrap();
        assert_eq!(places.len(), 1);
        assert_eq!(places[0].name, "Вигадане");
        assert_eq!(places[0].region.as_deref(), Some("Тестова область"));
        assert_eq!(places[0].district.as_deref(), Some("Пробний район"));
        assert!(parse_places(&json!({"generationtime_ms": 0.5}))
            .unwrap()
            .is_empty());
        assert_eq!(
            parse_places(&json!({"results": "ні"})),
            Err(WeatherOnlineError::BadResponse)
        );
    }
}
