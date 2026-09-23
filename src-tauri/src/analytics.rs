use crate::repository::{Repository, RepositoryError};
use chrono::{Duration as ChronoDuration, NaiveDate};
use regex::Regex;
use serde::Serialize;
use serde_json::Value;
use std::{collections::BTreeMap, sync::OnceLock};

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
    pub date_range: DashboardDateRange,
    pub period: DashboardPeriod,
    pub effectiveness: DashboardEffectivenessSummary,
    pub breakdowns: DashboardBreakdowns,
    pub quality: DashboardQualitySummary,
    pub map: DashboardMapSummary,
    pub export_views: DashboardExportViews,
    pub records: Vec<DashboardRecord>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardDateRange {
    pub from: Option<String>,
    pub to: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardPeriod {
    pub from: Option<String>,
    pub to: Option<String>,
    pub preset: String,
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

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardBreakdowns {
    pub aircraft: Vec<DashboardBreakdownGroup>,
    pub munitions: Vec<DashboardBreakdownGroup>,
    pub units: Vec<DashboardBreakdownGroup>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardBreakdownGroup {
    pub value: Option<String>,
    pub record_count: usize,
    pub munition_count: u64,
    pub effectiveness: DashboardEffectivenessSummary,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardQualitySummary {
    pub records_with_issues: usize,
    pub issue_count: usize,
    pub issue_counts: Vec<DashboardQualityIssueCount>,
    pub affected_records: Vec<DashboardQualityRecord>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardQualityIssueCount {
    pub issue: DashboardQualityIssue,
    pub count: usize,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardQualityRecord {
    pub record_number: String,
    pub date: Option<String>,
    pub date_raw: String,
    pub issues: Vec<DashboardQualityIssue>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardMapSummary {
    pub provider: DashboardMapProvider,
    pub geometry_policy: DashboardMapGeometryPolicy,
    pub total_records: usize,
    pub coordinate_text_records: usize,
    pub missing_coordinate_records: usize,
    pub display_ready_records: usize,
    pub items: Vec<DashboardMapItem>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardMapItem {
    pub record_number: String,
    pub status: DashboardMapStatus,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DashboardMapProvider {
    None,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DashboardMapGeometryPolicy {
    NotDerived,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DashboardMapStatus {
    Missing,
    SourceTextUnverified,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardExportViews {
    pub overview: DashboardExportOverview,
    pub breakdowns: Vec<DashboardExportBreakdownRow>,
    pub quality: Vec<DashboardExportQualityRow>,
    pub map_readiness: DashboardExportMapReadiness,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardExportOverview {
    pub scope: DashboardExportScope,
    pub period: DashboardPeriod,
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

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardExportBreakdownRow {
    pub scope: DashboardExportScope,
    pub dimension: DashboardExportDimension,
    pub value: Option<String>,
    pub record_count: usize,
    pub munition_count: u64,
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
pub struct DashboardExportQualityRow {
    pub scope: DashboardExportScope,
    pub issue: DashboardQualityIssue,
    pub count: usize,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardExportMapReadiness {
    pub scope: DashboardExportScope,
    pub provider: DashboardMapProvider,
    pub geometry_policy: DashboardMapGeometryPolicy,
    pub total_records: usize,
    pub coordinate_text_records: usize,
    pub missing_coordinate_records: usize,
    pub display_ready_records: usize,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DashboardExportScope {
    CurrentPeriod,
    AllApproved,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DashboardExportDimension {
    Aircraft,
    Munition,
    Unit,
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

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize)]
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
    from: Option<&str>,
    to: Option<&str>,
) -> Result<DashboardModel, AnalyticsError> {
    let snapshots = repository.approved_revision_snapshots().await?;
    dashboard_model_from_snapshots_for_period(&snapshots, from, to)
}

pub fn dashboard_model_from_snapshots(
    snapshots: &[Value],
) -> Result<DashboardModel, AnalyticsError> {
    dashboard_model_from_snapshots_for_period(snapshots, None, None)
}

pub fn dashboard_model_from_snapshots_for_period(
    snapshots: &[Value],
    from: Option<&str>,
    to: Option<&str>,
) -> Result<DashboardModel, AnalyticsError> {
    let (from, to) = validate_period(from, to)?;
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
    let date_range = date_range(&records);
    let quality = calculate_quality(&records);
    let is_filtered = from.is_some() || to.is_some();
    if is_filtered {
        records.retain(|record| match record.date.as_deref() {
            Some(date) => {
                from.as_deref().map_or(true, |bound| date >= bound)
                    && to.as_deref().map_or(true, |bound| date <= bound)
            }
            None => false,
        });
    }
    let effectiveness = calculate_effectiveness(&records);
    let breakdowns = calculate_breakdowns(&records);
    let map = calculate_map(&records);
    let (period_from, period_to) = if is_filtered {
        (from, to)
    } else {
        (date_range.from.clone(), date_range.to.clone())
    };
    let period = DashboardPeriod {
        from: period_from,
        to: period_to,
        preset: "custom".to_owned(),
    };
    let export_views = calculate_export_views(&period, &effectiveness, &breakdowns, &quality, &map);

    Ok(DashboardModel {
        schema_version: DASHBOARD_SCHEMA_VERSION,
        source: DASHBOARD_SOURCE.to_owned(),
        approved_reports: snapshots.len(),
        source_record_count,
        record_count: records.len(),
        date_range,
        period,
        effectiveness,
        breakdowns,
        quality,
        map,
        export_views,
        records,
    })
}

fn calculate_quality(records: &[DashboardRecord]) -> DashboardQualitySummary {
    let mut issue_counts = BTreeMap::new();
    let mut affected_records = Vec::new();
    let mut issue_count = 0;

    for record in records {
        if record.quality_issues.is_empty() {
            continue;
        }
        issue_count += record.quality_issues.len();
        for issue in &record.quality_issues {
            *issue_counts.entry(*issue).or_insert(0) += 1;
        }
        affected_records.push(DashboardQualityRecord {
            record_number: record.number.clone(),
            date: record.date.clone(),
            date_raw: record.date_raw.clone(),
            issues: record.quality_issues.clone(),
        });
    }

    let mut issue_counts = issue_counts
        .into_iter()
        .map(|(issue, count)| DashboardQualityIssueCount { issue, count })
        .collect::<Vec<_>>();
    issue_counts.sort_by(|left, right| {
        right
            .count
            .cmp(&left.count)
            .then_with(|| left.issue.cmp(&right.issue))
    });

    DashboardQualitySummary {
        records_with_issues: affected_records.len(),
        issue_count,
        issue_counts,
        affected_records,
    }
}

fn calculate_map(records: &[DashboardRecord]) -> DashboardMapSummary {
    let items = records
        .iter()
        .map(|record| DashboardMapItem {
            record_number: record.number.clone(),
            status: if record.coordinates.trim().is_empty() {
                DashboardMapStatus::Missing
            } else {
                DashboardMapStatus::SourceTextUnverified
            },
        })
        .collect::<Vec<_>>();
    let coordinate_text_records = items
        .iter()
        .filter(|item| item.status == DashboardMapStatus::SourceTextUnverified)
        .count();

    DashboardMapSummary {
        provider: DashboardMapProvider::None,
        geometry_policy: DashboardMapGeometryPolicy::NotDerived,
        total_records: records.len(),
        coordinate_text_records,
        missing_coordinate_records: records.len() - coordinate_text_records,
        display_ready_records: 0,
        items,
    }
}

fn calculate_export_views(
    period: &DashboardPeriod,
    effectiveness: &DashboardEffectivenessSummary,
    breakdowns: &DashboardBreakdowns,
    quality: &DashboardQualitySummary,
    map: &DashboardMapSummary,
) -> DashboardExportViews {
    let mut breakdown_rows = Vec::new();
    append_export_breakdown_rows(
        &mut breakdown_rows,
        DashboardExportDimension::Aircraft,
        &breakdowns.aircraft,
    );
    append_export_breakdown_rows(
        &mut breakdown_rows,
        DashboardExportDimension::Munition,
        &breakdowns.munitions,
    );
    append_export_breakdown_rows(
        &mut breakdown_rows,
        DashboardExportDimension::Unit,
        &breakdowns.units,
    );

    DashboardExportViews {
        overview: DashboardExportOverview {
            scope: DashboardExportScope::CurrentPeriod,
            period: period.clone(),
            total_records: effectiveness.total_records,
            aborted_records: effectiveness.aborted_records,
            evaluated_records: effectiveness.evaluated_records,
            hit_records: effectiveness.hit_records,
            partial_records: effectiveness.partial_records,
            miss_records: effectiveness.miss_records,
            unknown_records: effectiveness.unknown_records,
            overall_effect_percent: effectiveness.overall_effect_percent,
            dpi_effect_percent: effectiveness.dpi_effect_percent,
        },
        breakdowns: breakdown_rows,
        quality: quality
            .issue_counts
            .iter()
            .map(|item| DashboardExportQualityRow {
                scope: DashboardExportScope::AllApproved,
                issue: item.issue,
                count: item.count,
            })
            .collect(),
        map_readiness: DashboardExportMapReadiness {
            scope: DashboardExportScope::CurrentPeriod,
            provider: map.provider,
            geometry_policy: map.geometry_policy,
            total_records: map.total_records,
            coordinate_text_records: map.coordinate_text_records,
            missing_coordinate_records: map.missing_coordinate_records,
            display_ready_records: map.display_ready_records,
        },
    }
}

fn append_export_breakdown_rows(
    rows: &mut Vec<DashboardExportBreakdownRow>,
    dimension: DashboardExportDimension,
    groups: &[DashboardBreakdownGroup],
) {
    rows.extend(groups.iter().map(|group| DashboardExportBreakdownRow {
        scope: DashboardExportScope::CurrentPeriod,
        dimension,
        value: group.value.clone(),
        record_count: group.record_count,
        munition_count: group.munition_count,
        aborted_records: group.effectiveness.aborted_records,
        evaluated_records: group.effectiveness.evaluated_records,
        hit_records: group.effectiveness.hit_records,
        partial_records: group.effectiveness.partial_records,
        miss_records: group.effectiveness.miss_records,
        unknown_records: group.effectiveness.unknown_records,
        overall_effect_percent: group.effectiveness.overall_effect_percent,
        dpi_effect_percent: group.effectiveness.dpi_effect_percent,
    }));
}

fn calculate_effectiveness(records: &[DashboardRecord]) -> DashboardEffectivenessSummary {
    calculate_effectiveness_from(records.iter())
}

fn calculate_effectiveness_from<'a>(
    records: impl IntoIterator<Item = &'a DashboardRecord>,
) -> DashboardEffectivenessSummary {
    let mut total_records = 0;
    let mut aborted_records = 0;
    let mut hit_records = 0;
    let mut partial_records = 0;
    let mut miss_records = 0;
    let mut unknown_records = 0;

    for record in records {
        total_records += 1;
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

    let evaluated_records = total_records - aborted_records;
    let overall_score = (hit_records + partial_records) as f64;
    let dpi_score = hit_records as f64 + 0.75 * partial_records as f64;
    DashboardEffectivenessSummary {
        total_records,
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

#[derive(Clone, Copy)]
enum BreakdownDimension {
    Aircraft,
    Munition,
    Unit,
}

fn calculate_breakdowns(records: &[DashboardRecord]) -> DashboardBreakdowns {
    DashboardBreakdowns {
        aircraft: calculate_breakdown(records, BreakdownDimension::Aircraft),
        munitions: calculate_breakdown(records, BreakdownDimension::Munition),
        units: calculate_breakdown(records, BreakdownDimension::Unit),
    }
}

fn calculate_breakdown(
    records: &[DashboardRecord],
    dimension: BreakdownDimension,
) -> Vec<DashboardBreakdownGroup> {
    let mut groups: BTreeMap<Option<&str>, Vec<&DashboardRecord>> = BTreeMap::new();
    for record in records {
        let value = match dimension {
            BreakdownDimension::Aircraft => &record.aircraft,
            BreakdownDimension::Munition => &record.munition,
            BreakdownDimension::Unit => &record.unit,
        };
        let value = (!value.is_empty()).then_some(value.as_str());
        groups.entry(value).or_default().push(record);
    }

    let mut breakdown = groups
        .into_iter()
        .map(|(value, records)| {
            let munition_count = records.iter().fold(0_u64, |total, record| {
                total.saturating_add(record.munition_count)
            });
            let effectiveness = calculate_effectiveness_from(records.iter().copied());
            DashboardBreakdownGroup {
                value: value.map(str::to_owned),
                record_count: records.len(),
                munition_count,
                effectiveness,
            }
        })
        .collect::<Vec<_>>();
    breakdown.sort_by(|left, right| match (&left.value, &right.value) {
        (Some(left_value), Some(right_value)) => right
            .record_count
            .cmp(&left.record_count)
            .then_with(|| left_value.cmp(right_value)),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => std::cmp::Ordering::Equal,
    });
    breakdown
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
    from: Option<&str>,
    to: Option<&str>,
) -> Result<(Option<String>, Option<String>), AnalyticsError> {
    let from = normalize_period_bound(from, "from")?;
    let to = normalize_period_bound(to, "to")?;
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
        assert_eq!(model.date_range.from, None);
        assert_eq!(model.period.from, None);
        assert_eq!(model.period.to, None);
        assert_eq!(model.period.preset, "custom");
        assert_eq!(model.effectiveness.total_records, 0);
        assert_eq!(model.effectiveness.evaluated_records, 0);
        assert_eq!(model.effectiveness.overall_effect_percent, None);
        assert_eq!(model.effectiveness.dpi_effect_percent, None);
        assert!(model.breakdowns.aircraft.is_empty());
        assert!(model.breakdowns.munitions.is_empty());
        assert!(model.breakdowns.units.is_empty());
        assert!(model.quality.issue_counts.is_empty());
        assert!(model.quality.affected_records.is_empty());
        assert_eq!(model.map.provider, DashboardMapProvider::None);
        assert_eq!(
            model.map.geometry_policy,
            DashboardMapGeometryPolicy::NotDerived
        );
        assert_eq!(model.map.total_records, 0);
        assert_eq!(model.map.coordinate_text_records, 0);
        assert_eq!(model.map.missing_coordinate_records, 0);
        assert_eq!(model.map.display_ready_records, 0);
        assert!(model.map.items.is_empty());
        assert_eq!(
            model.export_views.overview.scope,
            DashboardExportScope::CurrentPeriod
        );
        assert_eq!(model.export_views.overview.period, model.period);
        assert_eq!(model.export_views.overview.total_records, 0);
        assert!(model.export_views.breakdowns.is_empty());
        assert!(model.export_views.quality.is_empty());
        assert_eq!(
            model.export_views.map_readiness.scope,
            DashboardExportScope::CurrentPeriod
        );
        assert_eq!(model.export_views.map_readiness.total_records, 0);
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
        assert_eq!(
            model.period.from.as_deref(),
            model.date_range.from.as_deref()
        );
        assert_eq!(model.period.to.as_deref(), model.date_range.to.as_deref());
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
        assert_eq!(serialized["period"]["preset"], "custom");
        assert_eq!(serialized["effectiveness"]["overallEffectPercent"], 100.0);
        assert_eq!(serialized["effectiveness"]["dpiEffectPercent"], 100.0);
        assert_eq!(serialized["map"]["provider"], "none");
        assert_eq!(serialized["map"]["geometryPolicy"], "not_derived");
        assert_eq!(serialized["map"]["displayReadyRecords"], 0);
        assert_eq!(
            serialized["exportViews"]["overview"]["scope"],
            "current_period"
        );
        assert_eq!(
            serialized["exportViews"]["mapReadiness"]["scope"],
            "current_period"
        );
        assert_eq!(serialized["records"][0]["result"], "hit");
        assert!(serialized["records"][0].get("qualityIssues").is_some());
    }

    #[test]
    fn map_abstraction_is_filtered_and_never_derives_display_geometry() {
        let model = dashboard_model_from_snapshots_for_period(
            &[snapshot(json!([
                {
                    "num": "outside-before",
                    "date": "2025-12-31",
                    "dpi": "OUTSIDE-SOURCE-TEXT"
                },
                {
                    "num": "missing",
                    "date": "2026-01-01",
                    "dpi": "   "
                },
                {
                    "num": "sentinel",
                    "date": "2026-01-02",
                    "dpi": "1"
                },
                {
                    "num": "unverified",
                    "date": "2026-01-03",
                    "dpi": "SYNTHETIC MGRS"
                },
                {
                    "num": "outside-after",
                    "date": "2026-02-01",
                    "dpi": "OUTSIDE-SOURCE-TEXT"
                }
            ]))],
            Some("2026-01-01"),
            Some("2026-01-31"),
        )
        .unwrap();

        assert_eq!(model.map.provider, DashboardMapProvider::None);
        assert_eq!(
            model.map.geometry_policy,
            DashboardMapGeometryPolicy::NotDerived
        );
        assert_eq!(model.map.total_records, 3);
        assert_eq!(model.map.coordinate_text_records, 2);
        assert_eq!(model.map.missing_coordinate_records, 1);
        assert_eq!(model.map.display_ready_records, 0);
        assert_eq!(
            model
                .map
                .items
                .iter()
                .map(|item| (item.record_number.as_str(), item.status))
                .collect::<Vec<_>>(),
            [
                ("missing", DashboardMapStatus::Missing),
                ("sentinel", DashboardMapStatus::SourceTextUnverified),
                ("unverified", DashboardMapStatus::SourceTextUnverified),
            ]
        );

        let serialized = serde_json::to_value(&model.map).unwrap();
        assert_eq!(serialized["provider"], "none");
        assert_eq!(serialized["geometryPolicy"], "not_derived");
        assert_eq!(serialized["displayReadyRecords"], 0);
        let items = serialized["items"].as_array().unwrap();
        assert!(items.iter().all(|item| {
            let fields = item.as_object().unwrap();
            fields.len() == 2
                && fields.contains_key("recordNumber")
                && fields.contains_key("status")
        }));
        let map_json = serde_json::to_string(&serialized).unwrap();
        for forbidden in [
            "SYNTHETIC MGRS",
            "coordinates",
            "target",
            "aircraft",
            "munition",
            "unit",
            "result",
        ] {
            assert!(!map_json.contains(forbidden));
        }
    }

    #[test]
    fn export_views_are_flat_deterministic_and_keep_scopes_explicit() {
        let model = dashboard_model_from_snapshots_for_period(
            &[snapshot(json!([
                {
                    "num": "inside-a",
                    "date": "2026-01-01",
                    "targets": "SYN-TARGET-42",
                    "unit": "Навчальний підрозділ",
                    "district": "Тестовий район",
                    "dpi": "SYN-EXPORT-COORDINATE",
                    "types": ["Навчальна ціль"],
                    "aircraft": "ЛА-А",
                    "munition": "БП-1",
                    "count": "2",
                    "result": "УРАЖЕНО",
                    "note": "SYNTHETIC NOTE"
                },
                {
                    "num": "inside-b",
                    "date": "2026-01-02",
                    "targets": "SYN-TARGET-43",
                    "unit": "Навчальний підрозділ",
                    "district": "Тестовий район",
                    "types": ["Навчальна ціль"],
                    "aircraft": "ЛА-Б",
                    "munition": "БП-1",
                    "count": "1",
                    "result": "НЕ УРАЖЕНО"
                },
                {
                    "num": "outside",
                    "date": "2026-02-01",
                    "count": "1",
                    "result": "Невідомо"
                }
            ]))],
            Some("2026-01-01"),
            Some("2026-01-31"),
        )
        .unwrap();

        let exports = &model.export_views;
        assert_eq!(exports.overview.scope, DashboardExportScope::CurrentPeriod);
        assert_eq!(exports.overview.period, model.period);
        assert_eq!(exports.overview.total_records, 2);
        assert_eq!(exports.overview.evaluated_records, 2);
        assert_eq!(exports.overview.hit_records, 1);
        assert_eq!(exports.overview.miss_records, 1);
        assert_eq!(exports.overview.overall_effect_percent, Some(50.0));
        assert_eq!(exports.overview.dpi_effect_percent, Some(50.0));

        assert_eq!(exports.breakdowns.len(), 4);
        assert_eq!(
            exports
                .breakdowns
                .iter()
                .map(|row| (row.dimension, row.value.as_deref()))
                .collect::<Vec<_>>(),
            [
                (DashboardExportDimension::Aircraft, Some("ЛА-А")),
                (DashboardExportDimension::Aircraft, Some("ЛА-Б")),
                (DashboardExportDimension::Munition, Some("БП-1")),
                (DashboardExportDimension::Unit, Some("Навчальний підрозділ")),
            ]
        );
        assert!(exports
            .breakdowns
            .iter()
            .all(|row| row.scope == DashboardExportScope::CurrentPeriod));
        assert_eq!(exports.breakdowns[2].record_count, 2);
        assert_eq!(exports.breakdowns[2].munition_count, 3);
        assert_eq!(exports.breakdowns[2].hit_records, 1);
        assert_eq!(exports.breakdowns[2].miss_records, 1);

        assert!(!exports.quality.is_empty());
        assert!(exports
            .quality
            .iter()
            .all(|row| row.scope == DashboardExportScope::AllApproved));
        assert_eq!(
            exports
                .quality
                .iter()
                .map(|row| (row.issue, row.count))
                .collect::<Vec<_>>(),
            model
                .quality
                .issue_counts
                .iter()
                .map(|row| (row.issue, row.count))
                .collect::<Vec<_>>()
        );

        assert_eq!(
            exports.map_readiness.scope,
            DashboardExportScope::CurrentPeriod
        );
        assert_eq!(exports.map_readiness.total_records, 2);
        assert_eq!(exports.map_readiness.coordinate_text_records, 1);
        assert_eq!(exports.map_readiness.missing_coordinate_records, 1);
        assert_eq!(exports.map_readiness.display_ready_records, 0);

        let serialized = serde_json::to_value(exports).unwrap();
        assert_eq!(serialized["overview"]["scope"], "current_period");
        assert_eq!(serialized["breakdowns"][0]["dimension"], "aircraft");
        assert_eq!(serialized["quality"][0]["scope"], "all_approved");
        assert_eq!(serialized["mapReadiness"]["provider"], "none");
        let export_json = serde_json::to_string(&serialized).unwrap();
        for forbidden in [
            "SYN-EXPORT-COORDINATE",
            "SYN-TARGET-42",
            "SYNTHETIC NOTE",
            "coordinates",
            "targetIds",
            "recordNumber",
            "dateRaw",
            "items",
        ] {
            assert!(!export_json.contains(forbidden));
        }
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
    fn quality_view_is_global_and_reports_every_issue_independently() {
        let model = dashboard_model_from_snapshots_for_period(
            &[snapshot(json!([
                {
                    "num": "Q-1",
                    "date": "невідома",
                    "count": "багато",
                    "result": "незрозуміло"
                },
                {
                    "num": "Q-2",
                    "date": "2026-01-10",
                    "targets": "SYN-2",
                    "unit": "Синтетичний підрозділ",
                    "district": "Тестовий район",
                    "types": ["Навчальна ціль"],
                    "aircraft": "Навчальний ЛА",
                    "munition": "Навчальний БП",
                    "count": "",
                    "result": ""
                },
                {
                    "num": "Q-3",
                    "date": "також невідома",
                    "targets": "SYN-3",
                    "unit": "Синтетичний підрозділ",
                    "district": "Тестовий район",
                    "types": ["Навчальна ціль"],
                    "aircraft": "Навчальний ЛА",
                    "munition": "Навчальний БП",
                    "count": "1",
                    "result": "УРАЖЕНО"
                }
            ]))],
            Some("2026-01-01"),
            Some("2026-01-31"),
        )
        .unwrap();

        assert_eq!(model.source_record_count, 3);
        assert_eq!(model.record_count, 1);
        assert_eq!(model.records[0].number, "Q-2");
        assert_eq!(model.quality.records_with_issues, 3);
        assert_eq!(model.quality.issue_count, 12);
        assert_eq!(model.quality.issue_counts.len(), 11);
        assert_eq!(
            model
                .quality
                .issue_counts
                .iter()
                .map(|item| item.issue)
                .collect::<Vec<_>>(),
            [
                DashboardQualityIssue::InvalidDate,
                DashboardQualityIssue::InvalidMunitionCount,
                DashboardQualityIssue::MissingMunitionCount,
                DashboardQualityIssue::MissingResult,
                DashboardQualityIssue::UnknownResult,
                DashboardQualityIssue::MissingUnit,
                DashboardQualityIssue::MissingDistrict,
                DashboardQualityIssue::MissingTargets,
                DashboardQualityIssue::MissingTargetTypes,
                DashboardQualityIssue::MissingAircraft,
                DashboardQualityIssue::MissingMunition,
            ]
        );
        assert_eq!(model.quality.issue_counts[0].count, 2);
        assert!(model.quality.issue_counts[1..]
            .iter()
            .all(|item| item.count == 1));
        assert_eq!(
            model
                .quality
                .issue_counts
                .iter()
                .map(|item| item.count)
                .sum::<usize>(),
            model.quality.issue_count
        );

        assert_eq!(model.quality.affected_records.len(), 3);
        assert_eq!(model.quality.affected_records[0].record_number, "Q-1");
        assert_eq!(model.quality.affected_records[0].date, None);
        assert_eq!(model.quality.affected_records[0].date_raw, "невідома");
        assert_eq!(
            model.quality.affected_records[1].issues,
            [
                DashboardQualityIssue::MissingMunitionCount,
                DashboardQualityIssue::MissingResult,
            ]
        );
        assert_eq!(model.quality.affected_records[2].record_number, "Q-3");

        let serialized = serde_json::to_value(&model).unwrap();
        assert_eq!(
            serialized["quality"]["issueCounts"][0]["issue"],
            "invalid_date"
        );
        assert_eq!(serialized["quality"]["issueCounts"][0]["count"], 2);
        assert_eq!(
            serialized["quality"]["affectedRecords"][0]["recordNumber"],
            "Q-1"
        );
        assert!(serialized["quality"]["affectedRecords"][0]["date"].is_null());
    }

    #[test]
    fn breakdowns_are_filtered_deterministic_and_keep_unspecified_groups() {
        let model = dashboard_model_from_snapshots_for_period(
            &[snapshot(json!([
                {
                    "date": "2026-01-01",
                    "aircraft": "ЛА-А",
                    "munition": "БП-1",
                    "count": "2",
                    "unit": "Підрозділ А",
                    "result": "УРАЖЕНО"
                },
                {
                    "date": "2026-01-02",
                    "aircraft": "ЛА-А",
                    "munition": "БП-1",
                    "count": "3",
                    "unit": "Підрозділ А",
                    "result": "Частково уражено"
                },
                {
                    "date": "2026-01-03",
                    "aircraft": "ЛА-Б",
                    "munition": "БП-2",
                    "count": "4",
                    "unit": "Підрозділ Б",
                    "result": "НЕ УРАЖЕНО"
                },
                {
                    "date": "2026-01-04",
                    "aircraft": "ЛА-Б",
                    "munition": "БП-2",
                    "count": "5",
                    "unit": "Підрозділ Б",
                    "result": "Відбій"
                },
                {
                    "date": "2026-01-05",
                    "count": "1",
                    "result": "Невідомо"
                },
                {
                    "date": "2026-02-01",
                    "aircraft": "ЛА-А",
                    "munition": "БП-1",
                    "count": "99",
                    "unit": "Підрозділ А",
                    "result": "УРАЖЕНО"
                }
            ]))],
            Some("2026-01-01"),
            Some("2026-01-31"),
        )
        .unwrap();

        assert_eq!(model.record_count, 5);
        assert_eq!(model.breakdowns.aircraft.len(), 3);
        assert_eq!(model.breakdowns.munitions.len(), 3);
        assert_eq!(model.breakdowns.units.len(), 3);

        let aircraft_a = &model.breakdowns.aircraft[0];
        assert_eq!(aircraft_a.value.as_deref(), Some("ЛА-А"));
        assert_eq!(aircraft_a.record_count, 2);
        assert_eq!(aircraft_a.munition_count, 5);
        assert_eq!(aircraft_a.effectiveness.hit_records, 1);
        assert_eq!(aircraft_a.effectiveness.partial_records, 1);
        assert_eq!(aircraft_a.effectiveness.overall_effect_percent, Some(100.0));
        assert_eq!(aircraft_a.effectiveness.dpi_effect_percent, Some(87.5));

        let aircraft_b = &model.breakdowns.aircraft[1];
        assert_eq!(aircraft_b.value.as_deref(), Some("ЛА-Б"));
        assert_eq!(aircraft_b.record_count, 2);
        assert_eq!(aircraft_b.munition_count, 9);
        assert_eq!(aircraft_b.effectiveness.aborted_records, 1);
        assert_eq!(aircraft_b.effectiveness.evaluated_records, 1);
        assert_eq!(aircraft_b.effectiveness.miss_records, 1);
        assert_eq!(aircraft_b.effectiveness.overall_effect_percent, Some(0.0));

        let unspecified_aircraft = &model.breakdowns.aircraft[2];
        assert_eq!(unspecified_aircraft.value, None);
        assert_eq!(unspecified_aircraft.record_count, 1);
        assert_eq!(unspecified_aircraft.munition_count, 1);
        assert_eq!(unspecified_aircraft.effectiveness.unknown_records, 1);

        assert_eq!(model.breakdowns.munitions[0].value.as_deref(), Some("БП-1"));
        assert_eq!(model.breakdowns.munitions[0].munition_count, 5);
        assert_eq!(model.breakdowns.munitions[1].value.as_deref(), Some("БП-2"));
        assert_eq!(model.breakdowns.munitions[1].munition_count, 9);
        assert_eq!(model.breakdowns.munitions[2].value, None);
        assert_eq!(
            model.breakdowns.units[0].value.as_deref(),
            Some("Підрозділ А")
        );
        assert_eq!(
            model.breakdowns.units[1].value.as_deref(),
            Some("Підрозділ Б")
        );
        assert_eq!(model.breakdowns.units[2].value, None);

        for groups in [
            &model.breakdowns.aircraft,
            &model.breakdowns.munitions,
            &model.breakdowns.units,
        ] {
            assert_eq!(
                groups.iter().map(|group| group.record_count).sum::<usize>(),
                model.record_count
            );
        }

        let serialized = serde_json::to_value(&model).unwrap();
        assert_eq!(serialized["breakdowns"]["aircraft"][0]["recordCount"], 2);
        assert_eq!(serialized["breakdowns"]["aircraft"][0]["munitionCount"], 5);
        assert!(serialized["breakdowns"]["aircraft"][2]["value"].is_null());
    }

    #[test]
    fn period_filter_is_inclusive_and_reports_its_full_source_boundary() {
        let model = dashboard_model_from_snapshots_for_period(
            &[snapshot(json!([
                {"num": "before", "date": "2026-01-09"},
                {"num": "from", "date": "2026-01-10"},
                {"num": "to", "date": "2026-01-20"},
                {"num": "after", "date": "2026-01-21"},
                {"num": "undated", "date": "невідома"}
            ]))],
            Some(" 2026-01-10 "),
            Some("2026-01-20"),
        )
        .unwrap();

        assert_eq!(model.source_record_count, 5);
        assert_eq!(model.record_count, 2);
        assert_eq!(model.date_range.from.as_deref(), Some("2026-01-09"));
        assert_eq!(model.date_range.to.as_deref(), Some("2026-01-21"));
        assert_eq!(model.period.from.as_deref(), Some("2026-01-10"));
        assert_eq!(model.period.to.as_deref(), Some("2026-01-20"));
        assert_eq!(model.period.preset, "custom");
        assert_eq!(model.quality.records_with_issues, 5);
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
        assert!(matches!(
            dashboard_model_from_snapshots_for_period(&[], Some("2026-1-10"), None),
            Err(AnalyticsError::InvalidPeriodDate { field: "from" })
        ));

        assert!(matches!(
            dashboard_model_from_snapshots_for_period(&[], None, Some("2026-02-30")),
            Err(AnalyticsError::InvalidPeriodDate { field: "to" })
        ));

        assert!(matches!(
            dashboard_model_from_snapshots_for_period(&[], Some("2026-02-01"), Some("2026-01-31")),
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
        let filtered =
            dashboard_model_from_snapshots_for_period(&snapshots, None, Some("2026-01-10"))
                .unwrap();
        assert_eq!(filtered.record_count, 2);
        assert_eq!(filtered.period.from, None);
        assert_eq!(filtered.period.to.as_deref(), Some("2026-01-10"));

        let unfiltered =
            dashboard_model_from_snapshots_for_period(&snapshots, Some(""), Some("   ")).unwrap();
        assert_eq!(unfiltered.record_count, 4);
        assert_eq!(unfiltered.period.from.as_deref(), Some("2026-01-01"));
        assert_eq!(unfiltered.period.to.as_deref(), Some("2026-01-20"));
    }

    #[test]
    fn period_filter_can_return_no_rows_without_hiding_global_quality() {
        let model = dashboard_model_from_snapshots_for_period(
            &[snapshot(json!([
                {
                    "num": "dated",
                    "date": "2026-01-10",
                    "targets": "SYN-1",
                    "unit": "Синтетичний підрозділ",
                    "district": "Тестовий район",
                    "types": ["Навчальна ціль"],
                    "aircraft": "Навчальний ЛА",
                    "munition": "Навчальний БП",
                    "count": "1",
                    "result": "УРАЖЕНО"
                },
                {
                    "num": "undated",
                    "date": "невідома",
                    "targets": "SYN-2",
                    "unit": "Синтетичний підрозділ",
                    "district": "Тестовий район",
                    "types": ["Навчальна ціль"],
                    "aircraft": "Навчальний ЛА",
                    "munition": "Навчальний БП",
                    "count": "1",
                    "result": "УРАЖЕНО"
                }
            ]))],
            Some("2026-02-01"),
            Some("2026-02-28"),
        )
        .unwrap();

        assert_eq!(model.record_count, 0);
        assert!(model.records.is_empty());
        assert_eq!(model.date_range.from.as_deref(), Some("2026-01-10"));
        assert_eq!(model.date_range.to.as_deref(), Some("2026-01-10"));
        assert_eq!(model.quality.records_with_issues, 1);
        assert_eq!(model.quality.issue_count, 1);
        assert_eq!(model.quality.issue_counts.len(), 1);
        assert_eq!(
            model.quality.issue_counts[0],
            DashboardQualityIssueCount {
                issue: DashboardQualityIssue::InvalidDate,
                count: 1,
            }
        );
        assert_eq!(model.quality.affected_records.len(), 1);
        assert_eq!(model.quality.affected_records[0].record_number, "undated");
        assert_eq!(model.effectiveness.total_records, 0);
        assert!(model.breakdowns.aircraft.is_empty());
        assert!(model.breakdowns.munitions.is_empty());
        assert!(model.breakdowns.units.is_empty());
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

        let model = load_dashboard_model(&repository, None, None).await.unwrap();
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
