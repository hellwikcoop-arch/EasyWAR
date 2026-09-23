use crate::repository::{Repository, RepositoryError};
use chrono::{Duration as ChronoDuration, NaiveDate};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::OnceLock;

const DASHBOARD_SCHEMA_VERSION: u32 = 1;
const DASHBOARD_SOURCE: &str = "approved_sqlite_revisions";
const MAX_RECORDS_PER_SNAPSHOT: usize = 64;
const MAX_DASHBOARD_RECORDS: usize = 100_000;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardModel {
    pub schema_version: u32,
    pub source: String,
    pub approved_reports: usize,
    pub source_record_count: usize,
    pub record_count: usize,
    pub available_date_range: DashboardDateRange,
    pub date_range: DashboardDateRange,
    pub period: DashboardPeriodState,
    pub effectiveness: DashboardEffectivenessSummary,
    pub quality: DashboardQualitySummary,
    pub records: Vec<DashboardRecord>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardDateRange {
    pub from: Option<String>,
    pub to: Option<String>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DashboardPeriodFilter {
    pub from: Option<String>,
    pub to: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardPeriodState {
    pub from: Option<String>,
    pub to: Option<String>,
    pub is_filtered: bool,
    pub excluded_records: usize,
    pub excluded_undated_records: usize,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardEffectivenessSummary {
    pub total_records: usize,
    pub aborted_records: usize,
    pub evaluated_records: usize,
    pub hit_records: usize,
    pub partial_records: usize,
    pub miss_records: usize,
    pub unknown_records: usize,
    pub overall_effect_percent: Option<f64>,
    pub dpi_effect_percent: Option<f64>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardQualitySummary {
    pub records_with_issues: usize,
    pub issue_count: usize,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardRecord {
    pub number: String,
    pub date: Option<String>,
    pub date_raw: String,
    pub time: String,
    pub target_ids: Vec<String>,
    pub unit: String,
    pub district: String,
    pub coordinates: String,
    pub target_types: Vec<String>,
    pub aircraft: String,
    pub munition: String,
    pub munition_count: u64,
    pub munition_count_raw: String,
    pub result: DashboardResult,
    pub result_raw: String,
    pub aborted: bool,
    pub cause: String,
    pub note: String,
    pub quality_issues: Vec<DashboardQualityIssue>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DashboardResult {
    Hit,
    Partial,
    Miss,
    Unknown,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DashboardQualityIssue {
    InvalidDate,
    InvalidMunitionCount,
    MissingMunitionCount,
    MissingResult,
    UnknownResult,
    MissingUnit,
    MissingDistrict,
    MissingTargets,
    MissingTargetTypes,
    MissingAircraft,
    MissingMunition,
}

#[derive(Debug, thiserror::Error)]
pub enum AnalyticsError {
    #[error(transparent)]
    Repository(#[from] RepositoryError),
    #[error("Схвалена ревізія {snapshot} має некоректну версію моделі")]
    InvalidSchemaVersion { snapshot: usize },
    #[error("Схвалена ревізія {snapshot} має містити від 1 до 64 записів")]
    InvalidRecords { snapshot: usize },
    #[error("Схвалений запис {record} у ревізії {snapshot} має несумісне поле «{field}»")]
    InvalidApprovedField {
        snapshot: usize,
        record: usize,
        field: String,
    },
    #[error("Модель дашборда перевищує локальну межу у 100000 записів")]
    TooManyRecords,
    #[error("Межа періоду «{field}» має бути календарною датою у форматі РРРР-ММ-ДД")]
    InvalidPeriodDate { field: &'static str },
    #[error("Початок періоду не може бути пізніше за його кінець")]
    InvertedPeriod,
}

pub async fn load_dashboard_model(
    repository: &Repository,
    period: Option<&DashboardPeriodFilter>,
) -> Result<DashboardModel, AnalyticsError> {
    let snapshots = repository.approved_revision_snapshots().await?;
    dashboard_model_from_snapshots_for_period(&snapshots, period)
}

pub fn dashboard_model_from_snapshots(
    snapshots: &[Value],
) -> Result<DashboardModel, AnalyticsError> {
    dashboard_model_from_snapshots_for_period(snapshots, None)
}

pub fn dashboard_model_from_snapshots_for_period(
    snapshots: &[Value],
    period: Option<&DashboardPeriodFilter>,
) -> Result<DashboardModel, AnalyticsError> {
    let (from, to) = validate_period(period)?;
    let mut records = Vec::new();
    for (snapshot_index, snapshot) in snapshots.iter().enumerate() {
        let snapshot_number = snapshot_index + 1;
        if snapshot.get("schema_version").and_then(Value::as_u64)
            != Some(u64::from(DASHBOARD_SCHEMA_VERSION))
        {
            return Err(AnalyticsError::InvalidSchemaVersion {
                snapshot: snapshot_number,
            });
        }
        let approved_records = snapshot
            .get("records")
            .and_then(Value::as_array)
            .filter(|records| (1..=MAX_RECORDS_PER_SNAPSHOT).contains(&records.len()))
            .ok_or(AnalyticsError::InvalidRecords {
                snapshot: snapshot_number,
            })?;
        if records.len().saturating_add(approved_records.len()) > MAX_DASHBOARD_RECORDS {
            return Err(AnalyticsError::TooManyRecords);
        }
        for (record_index, record) in approved_records.iter().enumerate() {
            records.push(normalize_record(record, snapshot_number, record_index + 1)?);
        }
    }

    let source_record_count = records.len();
    let available_date_range = date_range(&records);
    let is_filtered = from.is_some() || to.is_some();
    let mut excluded_undated_records = 0;
    if is_filtered {
        records.retain(|record| match record.date.as_deref() {
            Some(date) => {
                from.as_deref().map_or(true, |bound| date >= bound)
                    && to.as_deref().map_or(true, |bound| date <= bound)
            }
            None => {
                excluded_undated_records += 1;
                false
            }
        });
    }
    let excluded_records = source_record_count - records.len();
    let filtered_date_range = date_range(&records);
    let effectiveness = calculate_effectiveness(&records);
    let records_with_issues = records
        .iter()
        .filter(|record| !record.quality_issues.is_empty())
        .count();
    let issue_count = records
        .iter()
        .map(|record| record.quality_issues.len())
        .sum();

    Ok(DashboardModel {
        schema_version: DASHBOARD_SCHEMA_VERSION,
        source: DASHBOARD_SOURCE.to_owned(),
        approved_reports: snapshots.len(),
        source_record_count,
        record_count: records.len(),
        available_date_range,
        date_range: filtered_date_range,
        period: DashboardPeriodState {
            from,
            to,
            is_filtered,
            excluded_records,
            excluded_undated_records,
        },
        effectiveness,
        quality: DashboardQualitySummary {
            records_with_issues,
            issue_count,
        },
        records,
    })
}

fn calculate_effectiveness(records: &[DashboardRecord]) -> DashboardEffectivenessSummary {
    let mut aborted_records = 0;
    let mut hit_records = 0;
    let mut partial_records = 0;
    let mut miss_records = 0;
    let mut unknown_records = 0;

    for record in records {
        if record.aborted {
            aborted_records += 1;
            continue;
        }
        match record.result {
            DashboardResult::Hit => hit_records += 1,
            DashboardResult::Partial => partial_records += 1,
            DashboardResult::Miss => miss_records += 1,
            DashboardResult::Unknown => unknown_records += 1,
        }
    }

    let evaluated_records = records.len() - aborted_records;
    let overall_score = (hit_records + partial_records) as f64;
    let dpi_score = hit_records as f64 + 0.75 * partial_records as f64;
    DashboardEffectivenessSummary {
        total_records: records.len(),
        aborted_records,
        evaluated_records,
        hit_records,
        partial_records,
        miss_records,
        unknown_records,
        overall_effect_percent: effectiveness_percent(overall_score, evaluated_records),
        dpi_effect_percent: effectiveness_percent(dpi_score, evaluated_records),
    }
}

fn effectiveness_percent(score: f64, evaluated_records: usize) -> Option<f64> {
    if evaluated_records == 0 {
        return None;
    }
    let percent = score / evaluated_records as f64 * 100.0;
    Some((percent * 100.0).round() / 100.0)
}

fn date_range(records: &[DashboardRecord]) -> DashboardDateRange {
    let mut valid_dates = records
        .iter()
        .filter_map(|record| record.date.as_deref())
        .collect::<Vec<_>>();
    valid_dates.sort_unstable();
    DashboardDateRange {
        from: valid_dates.first().map(|date| (*date).to_owned()),
        to: valid_dates.last().map(|date| (*date).to_owned()),
    }
}

fn validate_period(
    period: Option<&DashboardPeriodFilter>,
) -> Result<(Option<String>, Option<String>), AnalyticsError> {
    let from = normalize_period_bound(period.and_then(|period| period.from.as_deref()), "from")?;
    let to = normalize_period_bound(period.and_then(|period| period.to.as_deref()), "to")?;
    if from
        .as_deref()
        .zip(to.as_deref())
        .is_some_and(|(from, to)| from > to)
    {
        return Err(AnalyticsError::InvertedPeriod);
    }
    Ok((from, to))
}

fn normalize_period_bound(
    value: Option<&str>,
    field: &'static str,
) -> Result<Option<String>, AnalyticsError> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let date = NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| AnalyticsError::InvalidPeriodDate { field })?;
    if date.format("%Y-%m-%d").to_string() != value {
        return Err(AnalyticsError::InvalidPeriodDate { field });
    }
    Ok(Some(value.to_owned()))
}

fn normalize_record(
    value: &Value,
    snapshot: usize,
    record: usize,
) -> Result<DashboardRecord, AnalyticsError> {
    if !value.is_object() {
        return Err(invalid_field(snapshot, record, "record"));
    }
    let number = optional_string(value, "num", snapshot, record)?;
    let date_raw = optional_string(value, "date", snapshot, record)?;
    let date = normalize_date(&date_raw);
    let time = optional_string(value, "time", snapshot, record)?;
    let target_ids_raw = match optional_string(value, "targets", snapshot, record)? {
        targets if !targets.is_empty() => targets,
        _ => optional_string(value, "targetIds", snapshot, record)?,
    };
    let target_ids = split_targets(&target_ids_raw);
    let unit = canonical_unit(&optional_string(value, "unit", snapshot, record)?);
    let district = normalize_district(&optional_string(value, "district", snapshot, record)?);
    let coordinates = optional_string(value, "dpi", snapshot, record)?;
    let target_types = string_or_array_values(value, "type", "types", snapshot, record)?;
    let aircraft = optional_string(value, "aircraft", snapshot, record)?
        .trim()
        .to_owned();
    let munition_raw = optional_string(value, "munition", snapshot, record)?;
    let munition = if is_none_marker(&munition_raw) {
        String::new()
    } else {
        munition_raw.trim().to_uppercase()
    };
    let munition_count_raw = optional_string(value, "count", snapshot, record)?;
    let munition_count = count_prefix(&munition_count_raw).unwrap_or(0);
    let result_raw = optional_string(value, "result", snapshot, record)?
        .trim()
        .to_owned();
    let cause = string_or_array(value, "cause", "cause", "; ", snapshot, record)?;
    let note = optional_string(value, "note", snapshot, record)?;
    let aborted = contains_abort(&result_raw) || contains_abort(&cause);
    let result = classify_result(&result_raw);
    let mut quality_issues = Vec::new();

    if date.is_none() {
        quality_issues.push(DashboardQualityIssue::InvalidDate);
    }
    if !valid_count(&munition_count_raw) && !(aborted && is_none_marker(&munition_count_raw)) {
        quality_issues.push(if munition_count_raw.trim().is_empty() {
            DashboardQualityIssue::MissingMunitionCount
        } else {
            DashboardQualityIssue::InvalidMunitionCount
        });
    }
    if result == DashboardResult::Unknown && !aborted {
        quality_issues.push(if result_raw.is_empty() {
            DashboardQualityIssue::MissingResult
        } else {
            DashboardQualityIssue::UnknownResult
        });
    }
    if unit.is_empty() {
        quality_issues.push(DashboardQualityIssue::MissingUnit);
    }
    if district.is_empty() {
        quality_issues.push(DashboardQualityIssue::MissingDistrict);
    }
    if target_ids.is_empty() {
        quality_issues.push(DashboardQualityIssue::MissingTargets);
    }
    if target_types.is_empty() {
        quality_issues.push(DashboardQualityIssue::MissingTargetTypes);
    }
    if aircraft.is_empty() {
        quality_issues.push(DashboardQualityIssue::MissingAircraft);
    }
    if munition.is_empty() && !aborted {
        quality_issues.push(DashboardQualityIssue::MissingMunition);
    }

    Ok(DashboardRecord {
        number,
        date,
        date_raw,
        time: time.trim().to_owned(),
        target_ids,
        unit,
        district,
        coordinates: coordinates.trim().to_owned(),
        target_types,
        aircraft,
        munition,
        munition_count,
        munition_count_raw,
        result,
        result_raw,
        aborted,
        cause,
        note,
        quality_issues,
    })
}

fn optional_string(
    value: &Value,
    field: &str,
    snapshot: usize,
    record: usize,
) -> Result<String, AnalyticsError> {
    match value.get(field) {
        None | Some(Value::Null) => Ok(String::new()),
        Some(Value::String(value)) => Ok(value.clone()),
        _ => Err(invalid_field(snapshot, record, field)),
    }
}

fn string_or_array(
    value: &Value,
    string_field: &str,
    array_field: &str,
    separator: &str,
    snapshot: usize,
    record: usize,
) -> Result<String, AnalyticsError> {
    if string_field != array_field {
        let direct = optional_string(value, string_field, snapshot, record)?;
        if !direct.is_empty() {
            return Ok(direct);
        }
    }
    match value.get(array_field) {
        None | Some(Value::Null) => Ok(String::new()),
        Some(Value::String(value)) => Ok(value.clone()),
        Some(Value::Array(values)) if values.iter().all(Value::is_string) => Ok(values
            .iter()
            .filter_map(Value::as_str)
            .collect::<Vec<_>>()
            .join(separator)),
        _ => Err(invalid_field(snapshot, record, array_field)),
    }
}

fn string_or_array_values(
    value: &Value,
    string_field: &str,
    array_field: &str,
    snapshot: usize,
    record: usize,
) -> Result<Vec<String>, AnalyticsError> {
    let direct = optional_string(value, string_field, snapshot, record)?;
    if !direct.is_empty() {
        return Ok(direct
            .split(',')
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
            .collect());
    }
    match value.get(array_field) {
        None | Some(Value::Null) => Ok(Vec::new()),
        Some(Value::Array(values)) if values.iter().all(Value::is_string) => Ok(values
            .iter()
            .filter_map(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
            .collect()),
        Some(Value::String(value)) => Ok(value
            .split(',')
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
            .collect()),
        _ => Err(invalid_field(snapshot, record, array_field)),
    }
}

fn invalid_field(snapshot: usize, record: usize, field: &str) -> AnalyticsError {
    AnalyticsError::InvalidApprovedField {
        snapshot,
        record,
        field: field.to_owned(),
    }
}

fn normalize_date(value: &str) -> Option<String> {
    let value = value.trim();
    if let Some(candidate) = value.get(..10) {
        if NaiveDate::parse_from_str(candidate, "%Y-%m-%d").is_ok() {
            return Some(candidate.to_owned());
        }
    }
    if let Some(captures) = date_pattern().captures(value) {
        let day = captures.get(1)?.as_str().parse::<u32>().ok()?;
        let month = captures.get(2)?.as_str().parse::<u32>().ok()?;
        let year = captures.get(3)?.as_str().parse::<i32>().ok()?;
        return NaiveDate::from_ymd_opt(year, month, day)
            .map(|date| date.format("%Y-%m-%d").to_string());
    }
    if excel_serial_pattern().is_match(value) {
        let days = value.parse::<f64>().ok()?.floor();
        if !days.is_finite() || days < i64::MIN as f64 || days > i64::MAX as f64 {
            return None;
        }
        let epoch = NaiveDate::from_ymd_opt(1899, 12, 30)?;
        return epoch
            .checked_add_signed(ChronoDuration::days(days as i64))
            .map(|date| date.format("%Y-%m-%d").to_string());
    }
    None
}

fn split_targets(value: &str) -> Vec<String> {
    value
        .split(|character: char| character == ',' || character == ';' || character.is_whitespace())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .collect()
}

fn canonical_unit(value: &str) -> String {
    let normalized = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.to_lowercase() == "79 обрмп" {
        "79 ОДШБр".to_owned()
    } else {
        normalized
    }
}

fn normalize_district(value: &str) -> String {
    district_prefix_pattern()
        .replace(value, "")
        .trim()
        .to_owned()
}

fn is_none_marker(value: &str) -> bool {
    matches!(value.trim(), "" | "—" | "-" | "–")
}

fn count_prefix(value: &str) -> Option<u64> {
    count_prefix_pattern()
        .captures(value.trim())
        .and_then(|captures| captures.get(1))
        .and_then(|value| value.as_str().parse().ok())
}

fn valid_count(value: &str) -> bool {
    valid_count_pattern().is_match(value.trim())
}

fn contains_abort(value: &str) -> bool {
    value.to_lowercase().contains("відбій")
}

fn classify_result(value: &str) -> DashboardResult {
    let value = value.trim().to_lowercase();
    if value.is_empty() {
        DashboardResult::Unknown
    } else if value.starts_with("частков")
        || value.starts_with("пошкоджен")
        || value.starts_with("подавлен")
    {
        DashboardResult::Partial
    } else if miss_result_pattern().is_match(&value) {
        DashboardResult::Miss
    } else if value.starts_with("уражен") || value.starts_with("знищен") {
        DashboardResult::Hit
    } else {
        DashboardResult::Unknown
    }
}

fn date_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r"^(\d{1,2})[./](\d{1,2})[./](\d{4})").unwrap())
}

fn excel_serial_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r"^\d{5}(?:\.\d+)?$").unwrap())
}

fn district_prefix_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r"(?iu)^\s*н\.?\s?п\.?\s*").unwrap())
}

fn count_prefix_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r"^(\d+)").unwrap())
}

fn valid_count_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r"^\d+(?:\.0+)?$").unwrap())
}

fn miss_result_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r"^не\s*(?:уражен|влуч|підтверджен)").unwrap())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        database::INITIAL_SCHEMA_SQL,
        repository::{
            ActorType, AuditContext, CaptureReportInput, ReviewAndReviseInput, ReviewDecision,
            SourceType, StoreParseInput,
        },
    };
    use serde_json::json;
    use sqlx::sqlite::SqlitePoolOptions;

    const NOW: &str = "2026-01-01T00:00:00Z";

    fn snapshot(records: Value) -> Value {
        json!({"schema_version": 1, "records": records})
    }

    #[test]
    fn empty_approved_store_has_a_stable_empty_model() {
        let model = dashboard_model_from_snapshots(&[]).unwrap();
        assert_eq!(model.schema_version, 1);
        assert_eq!(model.source, "approved_sqlite_revisions");
        assert_eq!(model.approved_reports, 0);
        assert_eq!(model.source_record_count, 0);
        assert_eq!(model.record_count, 0);
        assert_eq!(model.available_date_range.from, None);
        assert_eq!(model.date_range.from, None);
        assert!(!model.period.is_filtered);
        assert_eq!(model.period.excluded_records, 0);
        assert_eq!(model.effectiveness.total_records, 0);
        assert_eq!(model.effectiveness.evaluated_records, 0);
        assert_eq!(model.effectiveness.overall_effect_percent, None);
        assert_eq!(model.effectiveness.dpi_effect_percent, None);
        assert!(model.records.is_empty());
    }

    #[test]
    fn normalizes_legacy_fields_and_serializes_the_dashboard_contract() {
        let model = dashboard_model_from_snapshots(&[snapshot(json!([
            {
                "num": "7",
                "date": "14.01.2026",
                "time": "09:35",
                "targets": "SYN-1; SYN-2",
                "unit": "79 обрмп",
                "district": "н.п. Тестове",
                "dpi": "SYNTHETIC MGRS",
                "types": ["Навчальна ціль", "Макет, тип 2"],
                "aircraft": "Навчальний ЛА",
                "munition": "навчальний бп",
                "count": "2.0",
                "result": "УРАЖЕНО",
                "cause": [],
                "note": "Синтетичний запис"
            },
            {
                "date": "46023",
                "result": "Відбій",
                "cause": "Синтетичний відбій",
                "count": "—",
                "munition": "—"
            }
        ]))])
        .unwrap();

        assert_eq!(model.record_count, 2);
        assert_eq!(model.date_range.from.as_deref(), Some("2026-01-01"));
        assert_eq!(model.date_range.to.as_deref(), Some("2026-01-14"));
        let first = &model.records[0];
        assert_eq!(first.target_ids, ["SYN-1", "SYN-2"]);
        assert_eq!(first.unit, "79 ОДШБр");
        assert_eq!(first.district, "Тестове");
        assert_eq!(first.target_types, ["Навчальна ціль", "Макет, тип 2"]);
        assert_eq!(first.munition, "НАВЧАЛЬНИЙ БП");
        assert_eq!(first.munition_count, 2);
        assert_eq!(first.result, DashboardResult::Hit);
        assert!(first.quality_issues.is_empty());

        let aborted = &model.records[1];
        assert!(aborted.aborted);
        assert_eq!(aborted.result, DashboardResult::Unknown);
        assert!(!aborted
            .quality_issues
            .contains(&DashboardQualityIssue::MissingMunition));
        assert!(!aborted
            .quality_issues
            .contains(&DashboardQualityIssue::MissingResult));
        assert!(aborted
            .quality_issues
            .contains(&DashboardQualityIssue::MissingUnit));
        let serialized = serde_json::to_value(&model).unwrap();
        assert_eq!(serialized["schemaVersion"], 1);
        assert_eq!(serialized["source"], "approved_sqlite_revisions");
        assert_eq!(serialized["sourceRecordCount"], 2);
        assert_eq!(serialized["period"]["isFiltered"], false);
        assert_eq!(serialized["effectiveness"]["overallEffectPercent"], 100.0);
        assert_eq!(serialized["effectiveness"]["dpiEffectPercent"], 100.0);
        assert_eq!(serialized["records"][0]["result"], "hit");
        assert!(serialized["records"][0].get("qualityIssues").is_some());
    }

    #[test]
    fn effectiveness_matches_legacy_modes_and_excludes_aborted_records() {
        let model = dashboard_model_from_snapshots(&[snapshot(json!([
            {"result": "УРАЖЕНО"},
            {"result": "Частково уражено"},
            {"result": "НЕ УРАЖЕНО"},
            {"result": "Невідомо"},
            {"result": "УРАЖЕНО", "cause": "Відбій — синтетична суперечність"}
        ]))])
        .unwrap();

        assert_eq!(model.effectiveness.total_records, 5);
        assert_eq!(model.effectiveness.aborted_records, 1);
        assert_eq!(model.effectiveness.evaluated_records, 4);
        assert_eq!(model.effectiveness.hit_records, 1);
        assert_eq!(model.effectiveness.partial_records, 1);
        assert_eq!(model.effectiveness.miss_records, 1);
        assert_eq!(model.effectiveness.unknown_records, 1);
        assert_eq!(model.effectiveness.overall_effect_percent, Some(50.0));
        assert_eq!(model.effectiveness.dpi_effect_percent, Some(43.75));
    }

    #[test]
    fn effectiveness_distinguishes_real_zero_from_no_denominator_and_rounds() {
        let zero = dashboard_model_from_snapshots(&[snapshot(json!([
            {"result": "НЕ УРАЖЕНО"},
            {"result": "Невідомо"}
        ]))])
        .unwrap();
        assert_eq!(zero.effectiveness.overall_effect_percent, Some(0.0));
        assert_eq!(zero.effectiveness.dpi_effect_percent, Some(0.0));

        let unavailable = dashboard_model_from_snapshots(&[snapshot(json!([
            {"result": "Відбій"},
            {"result": "УРАЖЕНО", "cause": "Відбій"}
        ]))])
        .unwrap();
        assert_eq!(unavailable.effectiveness.aborted_records, 2);
        assert_eq!(unavailable.effectiveness.evaluated_records, 0);
        assert_eq!(unavailable.effectiveness.hit_records, 0);
        assert_eq!(unavailable.effectiveness.overall_effect_percent, None);
        assert_eq!(unavailable.effectiveness.dpi_effect_percent, None);
        let serialized = serde_json::to_value(unavailable).unwrap();
        assert!(serialized["effectiveness"]["overallEffectPercent"].is_null());

        let rounded = dashboard_model_from_snapshots(&[snapshot(json!([
            {"result": "УРАЖЕНО"},
            {"result": "НЕ УРАЖЕНО"},
            {"result": "Невідомо"}
        ]))])
        .unwrap();
        assert_eq!(rounded.effectiveness.overall_effect_percent, Some(33.33));
        assert_eq!(rounded.effectiveness.dpi_effect_percent, Some(33.33));
    }

    #[test]
    fn period_filter_is_inclusive_and_reports_its_full_source_boundary() {
        let period = DashboardPeriodFilter {
            from: Some(" 2026-01-10 ".to_owned()),
            to: Some("2026-01-20".to_owned()),
        };
        let model = dashboard_model_from_snapshots_for_period(
            &[snapshot(json!([
                {"num": "before", "date": "2026-01-09"},
                {"num": "from", "date": "2026-01-10"},
                {"num": "to", "date": "2026-01-20"},
                {"num": "after", "date": "2026-01-21"},
                {"num": "undated", "date": "невідома"}
            ]))],
            Some(&period),
        )
        .unwrap();

        assert_eq!(model.source_record_count, 5);
        assert_eq!(model.record_count, 2);
        assert_eq!(
            model.available_date_range.from.as_deref(),
            Some("2026-01-09")
        );
        assert_eq!(model.available_date_range.to.as_deref(), Some("2026-01-21"));
        assert_eq!(model.date_range.from.as_deref(), Some("2026-01-10"));
        assert_eq!(model.date_range.to.as_deref(), Some("2026-01-20"));
        assert_eq!(model.period.from.as_deref(), Some("2026-01-10"));
        assert_eq!(model.period.to.as_deref(), Some("2026-01-20"));
        assert!(model.period.is_filtered);
        assert_eq!(model.period.excluded_records, 3);
        assert_eq!(model.period.excluded_undated_records, 1);
        assert_eq!(model.effectiveness.evaluated_records, 2);
        assert_eq!(model.effectiveness.unknown_records, 2);
        assert_eq!(model.effectiveness.overall_effect_percent, Some(0.0));
        assert_eq!(
            model
                .records
                .iter()
                .map(|record| record.number.as_str())
                .collect::<Vec<_>>(),
            ["from", "to"]
        );
    }

    #[test]
    fn period_filter_rejects_noncanonical_and_inverted_dates() {
        let noncanonical = DashboardPeriodFilter {
            from: Some("2026-1-10".to_owned()),
            to: None,
        };
        assert!(matches!(
            dashboard_model_from_snapshots_for_period(&[], Some(&noncanonical)),
            Err(AnalyticsError::InvalidPeriodDate { field: "from" })
        ));

        let impossible = DashboardPeriodFilter {
            from: None,
            to: Some("2026-02-30".to_owned()),
        };
        assert!(matches!(
            dashboard_model_from_snapshots_for_period(&[], Some(&impossible)),
            Err(AnalyticsError::InvalidPeriodDate { field: "to" })
        ));

        let inverted = DashboardPeriodFilter {
            from: Some("2026-02-01".to_owned()),
            to: Some("2026-01-31".to_owned()),
        };
        assert!(matches!(
            dashboard_model_from_snapshots_for_period(&[], Some(&inverted)),
            Err(AnalyticsError::InvertedPeriod)
        ));
    }

    #[test]
    fn period_filter_supports_independent_and_blank_boundaries() {
        let snapshots = [snapshot(json!([
            {"num": "early", "date": "2026-01-01"},
            {"num": "boundary", "date": "2026-01-10"},
            {"num": "late", "date": "2026-01-20"},
            {"num": "undated", "date": "невідома"}
        ]))];
        let to_only = DashboardPeriodFilter {
            from: None,
            to: Some("2026-01-10".to_owned()),
        };
        let filtered =
            dashboard_model_from_snapshots_for_period(&snapshots, Some(&to_only)).unwrap();
        assert_eq!(filtered.record_count, 2);
        assert_eq!(filtered.period.from, None);
        assert_eq!(filtered.period.to.as_deref(), Some("2026-01-10"));
        assert_eq!(filtered.period.excluded_undated_records, 1);

        let blank = DashboardPeriodFilter {
            from: Some("".to_owned()),
            to: Some("   ".to_owned()),
        };
        let unfiltered =
            dashboard_model_from_snapshots_for_period(&snapshots, Some(&blank)).unwrap();
        assert!(!unfiltered.period.is_filtered);
        assert_eq!(unfiltered.record_count, 4);
        assert_eq!(unfiltered.period.excluded_records, 0);
    }

    #[test]
    fn period_filter_denies_unknown_input_fields() {
        let error = serde_json::from_value::<DashboardPeriodFilter>(json!({
            "from": "2026-01-01",
            "unexpected": "synthetic-secret"
        }))
        .unwrap_err();
        assert!(error.to_string().contains("unknown field"));
        assert!(!error.to_string().contains("synthetic-secret"));
    }

    #[test]
    fn result_categories_match_the_legacy_dashboard_contract() {
        assert_eq!(classify_result("УРАЖЕНО"), DashboardResult::Hit);
        assert_eq!(classify_result("Знищено"), DashboardResult::Hit);
        assert_eq!(
            classify_result("Частково уражено"),
            DashboardResult::Partial
        );
        assert_eq!(classify_result("Пошкоджено"), DashboardResult::Partial);
        assert_eq!(classify_result("НЕ УРАЖЕНО"), DashboardResult::Miss);
        assert_eq!(classify_result("Невідомо"), DashboardResult::Unknown);
    }

    #[test]
    fn malformed_approved_fields_fail_closed_without_echoing_values() {
        let error = dashboard_model_from_snapshots(&[snapshot(json!([{
            "date": {"private": "synthetic-secret"}
        }]))])
        .unwrap_err();
        assert!(matches!(
            error,
            AnalyticsError::InvalidApprovedField {
                snapshot: 1,
                record: 1,
                ref field,
            } if field == "date"
        ));
        assert!(!error.to_string().contains("synthetic-secret"));
    }

    async fn synthetic_repository() -> Repository {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::raw_sql(INITIAL_SCHEMA_SQL)
            .execute(&pool)
            .await
            .unwrap();
        Repository::new(pool)
    }

    fn audit(id: &str) -> AuditContext {
        AuditContext {
            id: id.to_owned(),
            actor_type: ActorType::System,
            actor_label: Some("synthetic-test".to_owned()),
            occurred_at: NOW.to_owned(),
        }
    }

    async fn reviewed_report(
        repository: &Repository,
        suffix: &str,
        decision: ReviewDecision,
        snapshot: Value,
    ) {
        let report_id = format!("analytics-report-{suffix}");
        let parse_id = format!("analytics-parse-{suffix}");
        repository
            .capture_report(&CaptureReportInput {
                raw_source_id: format!("analytics-source-{suffix}"),
                report_id: report_id.clone(),
                source_type: SourceType::Other,
                source_timestamp: None,
                captured_at: NOW.to_owned(),
                content_type: "application/json".to_owned(),
                raw_text: Some(format!("SECRET-RAW-{suffix}")),
                raw_payload_json: None,
                raw_sha256: match suffix {
                    "approved" => "a".repeat(64),
                    "rejected" => "b".repeat(64),
                    _ => "c".repeat(64),
                },
                metadata_json: json!({"synthetic": true}),
                source_item_key: format!("analytics-item-{suffix}"),
                created_at: NOW.to_owned(),
                audit: audit(&format!("analytics-capture-{suffix}")),
            })
            .await
            .unwrap();
        repository
            .store_parse(&StoreParseInput {
                id: parse_id.clone(),
                report_id: report_id.clone(),
                version: 1,
                parser_name: "synthetic-analytics".to_owned(),
                parser_version: "1".to_owned(),
                parsed_payload_json: json!({"private": format!("SECRET-PARSED-{suffix}")}),
                parsed_at: NOW.to_owned(),
                audit: audit(&format!("analytics-parse-audit-{suffix}")),
            })
            .await
            .unwrap();
        repository
            .review_and_revise(&ReviewAndReviseInput {
                decision_id: format!("analytics-decision-{suffix}"),
                revision_id: format!("analytics-revision-{suffix}"),
                report_id: report_id.clone(),
                decision_number: 1,
                revision_number: 1,
                parsed_version_id: parse_id,
                decision,
                decided_by: "synthetic-reviewer".to_owned(),
                rationale: None,
                decided_at: NOW.to_owned(),
                snapshot_json: snapshot,
                change_summary: None,
                audit: audit(&format!("analytics-review-audit-{suffix}")),
            })
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn sqlite_model_reads_only_latest_approved_revision_snapshots() {
        let repository = synthetic_repository().await;
        reviewed_report(
            &repository,
            "approved",
            ReviewDecision::Approved,
            snapshot(json!([{
                "date": "2026-01-14",
                "unit": "Синтетичний підрозділ",
                "district": "Тестовий район",
                "targets": "SYN-APPROVED",
                "types": ["Навчальна ціль"],
                "aircraft": "Навчальний ЛА",
                "munition": "Навчальний БП",
                "count": "1",
                "result": "УРАЖЕНО"
            }])),
        )
        .await;
        reviewed_report(
            &repository,
            "rejected",
            ReviewDecision::Rejected,
            snapshot(json!([{
                "date": "2026-01-15",
                "note": "SECRET-REJECTED-REVISION"
            }])),
        )
        .await;

        let model = load_dashboard_model(&repository, None).await.unwrap();
        assert_eq!(model.approved_reports, 1);
        assert_eq!(model.record_count, 1);
        assert_eq!(model.records[0].target_ids, ["SYN-APPROVED"]);
        let serialized = serde_json::to_string(&model).unwrap();
        assert!(!serialized.contains("SECRET-RAW"));
        assert!(!serialized.contains("SECRET-PARSED"));
        assert!(!serialized.contains("SECRET-REJECTED"));
        assert!(!serialized.contains("analytics-report"));
    }
}
