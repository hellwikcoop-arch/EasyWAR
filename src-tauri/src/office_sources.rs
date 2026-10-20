//! Дані джерел для документів захищеної бібліотеки «Офісу» (контракт `library_source_data`).
//!
//! Шаблон DOCX/PPTX/XLSX заповнюється в інтерфейсі даними одного з трьох джерел:
//! схвалених ревізій за період (`approved_revisions`), модуля дашборда профілю
//! (`dashboard_module`) або таблиці з бібліотеки (`library_table`). Тут ці дані
//! збираються в один JSON, а відбиток ([`office_library::source_fingerprint`], HMAC
//! ключем бібліотеки над канонічним JSON) дає змогу пізніше сказати, чи змінилося
//! джерело з часу генерації документа ([`Sources::link_statuses`]). Шляхів до таблиць
//! профілю тут немає: таблиця бібліотеки читається з її зашифрованої поточної версії.
//!
//! Параметри джерела нормалізуються ([`SourceRequest`]): зайві ключі відкидаються,
//! порожні межі періоду стають `null`. Саме нормалізовані параметри зберігаються в
//! зв'язку документа.

use std::collections::HashMap;
use std::io::Cursor;

use calamine::{Data, ExcelDateTime, Reader, SheetType, SheetVisible, Xlsx};
use serde::Serialize;
use serde_json::{json, Map, Value};

use crate::analytics::{self, AnalyticsError, DashboardModel};
use crate::dashboard_modules::{DashboardModuleData, DashboardModuleError, DashboardModuleStore};
use crate::local_profiles::{LocalProfileError, LocalProfileStore};
use crate::office_library::{
    self, GeneratedDocument, GeneratedSave, LibraryError, LibraryKeys, LibraryStore,
    LibraryVersion, Origin, SourceKind,
};
use crate::repository::Repository;
use crate::workspace_templates::{
    self, WorkspaceTemplateError, WorkspaceTemplateStore, DEFAULT_WORKSPACE_TEMPLATE_KEY,
};
use crate::xlsx_import::{ensure_zip_within_limits_with, ZipLimits};

/// Рядків даних таблиці бібліотеки (без заголовка), які віддаються шаблону.
pub const MAX_TABLE_ROWS: usize = 10_000;
/// Стовпців таблиці бібліотеки, які віддаються шаблону.
pub const MAX_TABLE_COLUMNS: usize = 64;
const MAX_CELL_CHARS: usize = 4096;
const MAX_PARAM_CHARS: usize = 128;

#[derive(Debug, thiserror::Error)]
pub enum SourceError {
    #[error("невідоме джерело даних «{0}»")]
    UnknownKind(String),
    #[error("некоректні параметри джерела: {0}")]
    InvalidParams(&'static str),
    #[error(transparent)]
    Analytics(#[from] AnalyticsError),
    #[error(transparent)]
    Module(#[from] DashboardModuleError),
    #[error(transparent)]
    Library(#[from] LibraryError),
    #[error(transparent)]
    Profile(#[from] LocalProfileError),
    #[error(transparent)]
    Template(#[from] WorkspaceTemplateError),
    #[error("джерелом може бути лише таблиця бібліотеки (.xlsx або .csv)")]
    NotATable,
    #[error("у таблиці бібліотеки немає поточної версії")]
    NoCurrentVersion,
    #[error("таблицю бібліотеки не вдалося прочитати: {0}")]
    InvalidTable(String),
    #[error("таблиця CSV має бути в кодуванні UTF-8")]
    NotUtf8,
    #[error("розбір таблиці перервано")]
    Interrupted,
    #[error("дані джерела змінилися під час створення документа; повторіть")]
    FingerprintMismatch,
}

/// Перевірений запит до джерела з нормалізованими параметрами.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SourceRequest {
    ApprovedRevisions {
        from: Option<String>,
        to: Option<String>,
    },
    DashboardModule {
        module_id: String,
    },
    LibraryTable {
        item_id: String,
    },
}

impl SourceRequest {
    /// Вид джерела з інтерфейсу (`approved_revisions`, `dashboard_module`, `library_table`).
    pub fn parse_kind(kind: &str) -> Result<SourceKind, SourceError> {
        SourceKind::parse(kind).ok_or_else(|| {
            SourceError::UnknownKind(kind.chars().filter(|c| !c.is_control()).take(40).collect())
        })
    }

    /// Перевіряє параметри для виду джерела й лишає лише відомі ключі.
    pub fn parse(kind: SourceKind, params: &Value) -> Result<Self, SourceError> {
        let empty = Map::new();
        let object = match params {
            Value::Object(object) => object,
            Value::Null if kind == SourceKind::ApprovedRevisions => &empty,
            _ => return Err(SourceError::InvalidParams("параметри мають бути об'єктом")),
        };
        match kind {
            SourceKind::ApprovedRevisions => Ok(Self::ApprovedRevisions {
                from: period_bound(object.get("from"))?,
                to: period_bound(object.get("to"))?,
            }),
            SourceKind::DashboardModule => Ok(Self::DashboardModule {
                module_id: required_id(object.get("moduleId"), "потрібен «moduleId» модуля")?,
            }),
            SourceKind::LibraryTable => Ok(Self::LibraryTable {
                item_id: required_id(object.get("itemId"), "потрібен «itemId» таблиці")?,
            }),
        }
    }

    pub fn kind(&self) -> SourceKind {
        match self {
            Self::ApprovedRevisions { .. } => SourceKind::ApprovedRevisions,
            Self::DashboardModule { .. } => SourceKind::DashboardModule,
            Self::LibraryTable { .. } => SourceKind::LibraryTable,
        }
    }

    /// Нормалізовані параметри (так вони зберігаються в зв'язку документа).
    pub fn params(&self) -> Value {
        match self {
            Self::ApprovedRevisions { from, to } => json!({ "from": from, "to": to }),
            Self::DashboardModule { module_id } => json!({ "moduleId": module_id }),
            Self::LibraryTable { item_id } => json!({ "itemId": item_id }),
        }
    }

    /// Ключ кешу відбитків у межах одного виклику: вид і канонічні параметри.
    pub fn cache_key(&self) -> String {
        let params = office_library::canonical_json(&self.params());
        format!(
            "{}:{}",
            self.kind().as_str(),
            String::from_utf8_lossy(&params)
        )
    }
}

fn period_bound(value: Option<&Value>) -> Result<Option<String>, SourceError> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(text)) => {
            let text = text.trim();
            if text.chars().count() > MAX_PARAM_CHARS {
                return Err(SourceError::InvalidParams(
                    "межа періоду має бути датою РРРР-ММ-ДД",
                ));
            }
            Ok((!text.is_empty()).then(|| text.to_owned()))
        }
        Some(_) => Err(SourceError::InvalidParams(
            "межа періоду має бути датою РРРР-ММ-ДД або null",
        )),
    }
}

fn required_id(value: Option<&Value>, message: &'static str) -> Result<String, SourceError> {
    match value {
        Some(Value::String(text)) => {
            let text = text.trim();
            let valid = !text.is_empty()
                && text.chars().count() <= MAX_PARAM_CHARS
                && !text.chars().any(char::is_control);
            if valid {
                Ok(text.to_owned())
            } else {
                Err(SourceError::InvalidParams(message))
            }
        }
        _ => Err(SourceError::InvalidParams(message)),
    }
}

/// Хто готує документ: підставляється в шаблон, але не входить у відбиток джерела.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceProfile {
    pub display_name: String,
    pub position: String,
    pub role: String,
}

/// Назва, посада й роль (підпис шаблону робочого простору) профілю.
pub async fn source_profile(
    profiles: &LocalProfileStore,
    templates: &WorkspaceTemplateStore,
    profile_id: &str,
) -> Result<SourceProfile, SourceError> {
    let profile = profiles
        .list()
        .await?
        .profiles
        .into_iter()
        .find(|profile| profile.id == profile_id)
        .ok_or(LocalProfileError::ProfileNotFound)?;
    let assigned = templates
        .list()
        .await?
        .assignments
        .into_iter()
        .find(|assignment| assignment.profile_id == profile_id)
        .map(|assignment| assignment.template_key);
    let role = assigned
        .as_deref()
        .and_then(workspace_templates::workspace_template)
        .or_else(|| workspace_templates::workspace_template(DEFAULT_WORKSPACE_TEMPLATE_KEY))
        .map(|template| template.role_label.to_owned())
        .unwrap_or_default();
    Ok(SourceProfile {
        display_name: profile.display_name,
        position: profile.position,
        role,
    })
}

/// Дані схвалених ревізій для шаблону: період, підсумок, розбивки й записи.
pub fn approved_data(model: &DashboardModel) -> Value {
    let overview = &model.export_views.overview;
    let breakdowns: Vec<Value> = model
        .export_views
        .breakdowns
        .iter()
        .map(|row| {
            json!({
                "dimension": row.dimension,
                "value": row.value,
                "recordCount": row.record_count,
                "munitionCount": row.munition_count,
                "overallEffectPercent": row.overall_effect_percent,
                "dpiEffectPercent": row.dpi_effect_percent,
            })
        })
        .collect();
    json!({
        "period": { "from": model.period.from, "to": model.period.to },
        "overview": {
            "totalRecords": overview.total_records,
            "abortedRecords": overview.aborted_records,
            "evaluatedRecords": overview.evaluated_records,
            "hitRecords": overview.hit_records,
            "partialRecords": overview.partial_records,
            "missRecords": overview.miss_records,
            "unknownRecords": overview.unknown_records,
            "overallEffectPercent": overview.overall_effect_percent,
            "dpiEffectPercent": overview.dpi_effect_percent,
        },
        "breakdowns": breakdowns,
        "records": model.records,
    })
}

/// Дані модуля дашборда для шаблону: опис полів і рядки (з `rowId` і `createdAt`).
pub fn module_data(data: &DashboardModuleData) -> Value {
    let module = &data.module;
    let fields: Vec<Value> = module
        .fields
        .iter()
        .map(|field| {
            json!({
                "key": field.key,
                "label": field.label,
                "dataType": field.data_type,
            })
        })
        .collect();
    json!({
        "module": {
            "id": module.id,
            "title": module.title,
            "templateId": module.template_id,
            "branch": module.branch,
            "fields": fields,
        },
        "rows": data.rows,
        "truncated": data.truncated,
    })
}

/// Частина даних джерела, яка входить у відбиток. Для таблиці бібліотеки — лише
/// вміст (аркуш, заголовки, рядки): нова версія з тими самими клітинками (інше
/// форматування, зміна другого аркуша, повернення до старої версії) чи перейменування
/// не роблять пов'язані документи «застарілими». Решта джерел — дані повністю.
pub fn fingerprint_view(request: &SourceRequest, data: &Value) -> Value {
    match request {
        SourceRequest::LibraryTable { .. } => json!({
            "sheet": data.pointer("/table/sheet").cloned().unwrap_or(Value::Null),
            "headers": data.get("headers").cloned().unwrap_or(Value::Null),
            "rows": data.get("rows").cloned().unwrap_or(Value::Null),
        }),
        _ => data.clone(),
    }
}

/// Таблиця, прочитана з поточної версії документа бібліотеки.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ParsedTable {
    /// Аркуш книги XLSX (для CSV — `None`).
    pub sheet: Option<String>,
    pub headers: Vec<String>,
    pub rows: Vec<Vec<String>>,
}

/// Дані таблиці бібліотеки для шаблону.
pub fn table_data(item_id: &str, name: &str, version_id: &str, table: &ParsedTable) -> Value {
    json!({
        "table": {
            "itemId": item_id,
            "name": name,
            "versionId": version_id,
            "sheet": table.sheet,
        },
        "headers": table.headers,
        "rows": table.rows,
    })
}

/// Розбирає таблицю: перший видимий аркуш XLSX або CSV (`;` чи `,`). Перший непорожній
/// рядок — заголовки, далі не більше [`MAX_TABLE_ROWS`] рядків і [`MAX_TABLE_COLUMNS`]
/// стовпців; порожні рядки пропускаються, усі рядки доповнюються до однієї ширини.
pub fn parse_table(ext: &str, bytes: &[u8]) -> Result<ParsedTable, SourceError> {
    match ext {
        "xlsx" => {
            let (sheet, rows) = xlsx_rows(bytes)?;
            Ok(shape_table(Some(sheet), rows))
        }
        "csv" => Ok(shape_table(None, csv_rows(bytes)?)),
        _ => Err(SourceError::NotATable),
    }
}

fn shape_table(sheet: Option<String>, raw: Vec<Vec<String>>) -> ParsedTable {
    let mut kept = raw
        .into_iter()
        .map(|mut row| {
            row.truncate(MAX_TABLE_COLUMNS);
            while row.last().is_some_and(String::is_empty) {
                row.pop();
            }
            row
        })
        .filter(|row| !row.is_empty());
    let headers = kept.next().unwrap_or_default();
    let mut rows: Vec<Vec<String>> = kept.take(MAX_TABLE_ROWS).collect();
    let width = rows
        .iter()
        .map(Vec::len)
        .max()
        .unwrap_or(0)
        .max(headers.len());
    let mut headers = headers;
    headers.resize(width, String::new());
    for row in &mut rows {
        row.resize(width, String::new());
    }
    ParsedTable {
        sheet,
        headers,
        rows,
    }
}

fn clip(text: &str) -> String {
    text.trim().chars().take(MAX_CELL_CHARS).collect()
}

/// Найбільші координати клітинки XLSX (рядок 1 048 576, стовпець XFD), з нуля.
const XLSX_MAX_ROW: u32 = 1_048_575;
const XLSX_MAX_COLUMN: u32 = 16_383;

/// Рядки першого видимого аркуша. Клітинки читаються потоком (без суцільної сітки,
/// яку `worksheet_range` виділяв би від першої до останньої клітинки), стовпці
/// рахуються від стовпця A аркуша: `{{A}}` у шаблоні — це справді стовпець A, навіть
/// якщо він порожній. Рядки книги мають іти за порядком (так пише Excel).
fn xlsx_rows(bytes: &[u8]) -> Result<(String, Vec<Vec<String>>), SourceError> {
    ensure_zip_within_limits_with(bytes, ZipLimits::DEFAULT)
        .map_err(|error| SourceError::InvalidTable(error.to_string()))?;
    let mut workbook = Xlsx::new(Cursor::new(bytes))
        .map_err(|error| SourceError::InvalidTable(error.to_string()))?;
    let sheet = workbook
        .sheets_metadata()
        .iter()
        .find(|sheet| sheet.typ == SheetType::WorkSheet && sheet.visible == SheetVisible::Visible)
        .map(|sheet| sheet.name.clone())
        .ok_or_else(|| SourceError::InvalidTable("у книзі немає видимих аркушів".to_owned()))?;
    let mut cells = workbook
        .worksheet_cells_reader(&sheet)
        .map_err(|error| SourceError::InvalidTable(error.to_string()))?;
    // Заголовок і порожні рядки над ним — у межах запасу; далі читати немає сенсу.
    let limit = MAX_TABLE_ROWS + 1;
    let mut rows = Vec::new();
    let mut current: Option<(u32, Vec<String>)> = None;
    let finish = |row: Vec<String>, rows: &mut Vec<Vec<String>>| {
        if row.iter().any(|cell| !cell.is_empty()) {
            rows.push(row);
        }
    };
    while let Some(cell) = cells
        .next_cell()
        .map_err(|error| SourceError::InvalidTable(error.to_string()))?
    {
        let (row, column) = cell.get_position();
        if row > XLSX_MAX_ROW || column > XLSX_MAX_COLUMN {
            return Err(SourceError::InvalidTable(
                "клітинка поза межами аркуша Excel".to_owned(),
            ));
        }
        match &current {
            Some((open, _)) if *open == row => {}
            Some((open, _)) if *open > row => {
                return Err(SourceError::InvalidTable(
                    "рядки аркуша записано не за порядком".to_owned(),
                ));
            }
            _ => {
                if let Some((_, done)) = current.take() {
                    finish(done, &mut rows);
                    if rows.len() >= limit {
                        return Ok((sheet, rows));
                    }
                }
                current = Some((row, Vec::new()));
            }
        }
        let index = column as usize;
        if index >= MAX_TABLE_COLUMNS {
            continue;
        }
        let text = cell_text(&Data::from(cell.get_value().clone()));
        if let Some((_, values)) = current.as_mut() {
            if values.len() <= index {
                values.resize(index + 1, String::new());
            }
            values[index] = text;
        }
    }
    if let Some((_, done)) = current.take() {
        finish(done, &mut rows);
    }
    rows.truncate(limit);
    Ok((sheet, rows))
}

/// Клітинка як текст: число без зайвих нулів, так/ні, дата `РРРР-ММ-ДД`, час `ГГ:ХХ`.
fn cell_text(cell: &Data) -> String {
    match cell {
        Data::Empty | Data::Error(_) => String::new(),
        Data::String(text) | Data::DateTimeIso(text) | Data::DurationIso(text) => clip(text),
        Data::Int(number) => number.to_string(),
        Data::Float(number) => float_text(*number),
        Data::Bool(flag) => if *flag { "так" } else { "ні" }.to_owned(),
        Data::DateTime(value) => datetime_text(value),
    }
}

/// Число так, як його показує Excel: 15 значущих цифр (без хвостів двійкового дробу на
/// кшталт 0.30000000000000004), без зайвих нулів, з десятковою комою, як у модулях.
fn float_text(number: f64) -> String {
    if !number.is_finite() {
        return String::new();
    }
    // Округлення до 15 значущих цифр через експоненційний запис і назад.
    let rounded: f64 = format!("{number:.14e}").parse().unwrap_or(number);
    if rounded == 0.0 {
        return "0".to_owned();
    }
    if rounded.fract() == 0.0 && rounded.abs() < 9.0e15 {
        return (rounded as i64).to_string();
    }
    rounded.to_string().replace('.', ",")
}

fn datetime_text(value: &ExcelDateTime) -> String {
    let days = value.as_f64();
    if !days.is_finite() || days < 0.0 {
        return float_text(days);
    }
    if value.is_duration() {
        let minutes = (days * 24.0 * 60.0).round() as i64;
        return format!("{}:{:02}", minutes / 60, minutes % 60);
    }
    if days < 1.0 {
        let minutes = ((days * 24.0 * 60.0).round() as i64).min(24 * 60 - 1);
        return format!("{:02}:{:02}", minutes / 60, minutes % 60);
    }
    match value.as_datetime() {
        Some(datetime) if datetime.time() == chrono::NaiveTime::MIN => datetime.date().to_string(),
        Some(datetime) => datetime.format("%Y-%m-%d %H:%M").to_string(),
        None => float_text(days),
    }
}

/// Рядки CSV: UTF-8 (BOM пропускається), лапки за RFC 4180, роздільник `;` або `,`
/// (якого більше в першому рядку; за рівності — `;`, як у збереженнях Excel українською).
fn csv_rows(bytes: &[u8]) -> Result<Vec<Vec<String>>, SourceError> {
    let text = std::str::from_utf8(bytes).map_err(|_| SourceError::NotUtf8)?;
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let delimiter = csv_delimiter(text);
    let limit = MAX_TABLE_ROWS + 1;
    let mut rows: Vec<Vec<String>> = Vec::new();
    let mut row: Vec<String> = Vec::new();
    let mut field = String::new();
    let mut quoted = false;
    let mut chars = text.chars().peekable();
    let finish_row = |row: &mut Vec<String>, rows: &mut Vec<Vec<String>>| {
        let done = std::mem::take(row);
        if done.iter().any(|cell| !cell.is_empty()) {
            rows.push(done);
        }
    };
    while let Some(c) = chars.next() {
        if quoted {
            if c == '"' {
                if chars.peek() == Some(&'"') {
                    chars.next();
                    field.push('"');
                } else {
                    quoted = false;
                }
            } else if field.len() < MAX_CELL_CHARS * 4 {
                field.push(c);
            }
            continue;
        }
        match c {
            '"' if field.trim().is_empty() => {
                field.clear();
                quoted = true;
            }
            '\r' | '\n' => {
                if c == '\r' && chars.peek() == Some(&'\n') {
                    chars.next();
                }
                row.push(clip(&std::mem::take(&mut field)));
                finish_row(&mut row, &mut rows);
                if rows.len() >= limit {
                    return Ok(rows);
                }
            }
            c if c == delimiter => row.push(clip(&std::mem::take(&mut field))),
            c => {
                if field.len() < MAX_CELL_CHARS * 4 {
                    field.push(c);
                }
            }
        }
    }
    if !field.is_empty() || !row.is_empty() {
        row.push(clip(&field));
        finish_row(&mut row, &mut rows);
    }
    Ok(rows)
}

fn csv_delimiter(text: &str) -> char {
    let (mut semicolons, mut commas, mut quoted) = (0usize, 0usize, false);
    for c in text.chars() {
        match c {
            '"' => quoted = !quoted,
            ';' if !quoted => semicolons += 1,
            ',' if !quoted => commas += 1,
            '\n' | '\r' if !quoted && (semicolons > 0 || commas > 0) => break,
            _ => {}
        }
    }
    if commas > semicolons {
        ','
    } else {
        ';'
    }
}

/// Стан зв'язку документа з джерелом (контракт `library_link_statuses`).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LinkState {
    /// Поточна версія згенерована з тих самих даних, що є зараз.
    Current,
    /// Поточна версія згенерована, але дані джерела відтоді змінилися.
    SourceChanged,
    /// Поточна версія — ручна правка згенерованої з тих самих даних.
    Edited,
    /// Поточна версія — ручна правка, а дані джерела відтоді змінилися.
    EditedStale,
    /// Поточна версія не з джерела (імпортована чи збережена вручну, або вручну обрана
    /// з історії згенерована версія, не остання) або її немає.
    Detached,
    /// Дані джерела не вдалося зібрати (модуль видалено, таблиця пошкоджена тощо).
    SourceError,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkStatus {
    pub item_id: String,
    pub status: LinkState,
    pub detail: Option<String>,
}

/// Чи треба взагалі рахувати джерело для поточної версії з таким походженням.
fn needs_source(origin: Option<Origin>) -> bool {
    matches!(origin, Some(Origin::Generated | Origin::Edited))
}

/// Стан зв'язку за походженням і відбитком поточної версії та відбитком джерела зараз.
pub fn link_state(
    origin: Option<Origin>,
    version_fingerprint: Option<&str>,
    source: Result<&str, &str>,
) -> (LinkState, Option<String>) {
    if !needs_source(origin) {
        return (LinkState::Detached, None);
    }
    let fingerprint = match source {
        Ok(fingerprint) => fingerprint,
        Err(detail) => return (LinkState::SourceError, Some(detail.to_owned())),
    };
    let unchanged = version_fingerprint == Some(fingerprint);
    let state = match (origin, unchanged) {
        (Some(Origin::Generated), true) => LinkState::Current,
        (Some(Origin::Generated), false) => LinkState::SourceChanged,
        (_, true) => LinkState::Edited,
        (_, false) => LinkState::EditedStale,
    };
    (state, None)
}

/// Новий згенерований документ або нова версія пов'язаного (контракт `library_save_generated`).
#[derive(Clone, Copy, Debug)]
pub struct GeneratedInput<'a> {
    pub item_id: Option<&'a str>,
    pub name: Option<&'a str>,
    pub template_version_id: &'a str,
    pub ext: &'a str,
    pub bytes: &'a [u8],
    pub make_current: bool,
    /// Поточна версія наявного документа, яку бачив інтерфейс
    /// ([`GeneratedDocument::expected_current`]).
    pub expected_current: Option<Option<&'a str>>,
}

/// Сховища, з яких збираються дані джерел для розблокованої бібліотеки профілю.
#[derive(Clone, Copy)]
pub struct Sources<'a> {
    pub repository: &'a Repository,
    pub modules: &'a DashboardModuleStore,
    pub library: &'a LibraryStore,
    pub keys: &'a LibraryKeys,
}

impl Sources<'_> {
    /// Дані джерела в тій формі, яку бачить шаблон.
    pub async fn data(&self, request: &SourceRequest) -> Result<Value, SourceError> {
        match request {
            SourceRequest::ApprovedRevisions { from, to } => {
                let model = analytics::load_dashboard_model(
                    self.repository,
                    from.as_deref(),
                    to.as_deref(),
                )
                .await?;
                Ok(approved_data(&model))
            }
            SourceRequest::DashboardModule { module_id } => {
                let data = self
                    .modules
                    .get_data(self.keys.profile_id(), module_id)
                    .await?;
                Ok(module_data(&data))
            }
            SourceRequest::LibraryTable { item_id } => self.table(item_id).await,
        }
    }

    async fn table(&self, item_id: &str) -> Result<Value, SourceError> {
        let item = self.library.item(self.keys, item_id).await?;
        if item.kind != "table" {
            return Err(SourceError::NotATable);
        }
        let version_id = item
            .current_version_id
            .as_deref()
            .ok_or(SourceError::NoCurrentVersion)?;
        let (version, bytes) = self.library.read_version(self.keys, version_id).await?;
        let ext = version.ext.clone();
        let table = tokio::task::spawn_blocking(move || parse_table(&ext, &bytes))
            .await
            .map_err(|_| SourceError::Interrupted)??;
        Ok(table_data(&item.id, &item.name, &version.id, &table))
    }

    /// Відбиток і дані джерела ([`fingerprint_view`]).
    pub async fn fingerprinted(
        &self,
        request: &SourceRequest,
    ) -> Result<(String, Value), SourceError> {
        let data = self.data(request).await?;
        let fingerprint =
            office_library::source_fingerprint(self.keys, &fingerprint_view(request, &data));
        Ok((fingerprint, data))
    }

    /// Зберігає згенерований документ, якщо дані джерела досі ті, з яких його створено:
    /// відбиток перераховується тут, а не береться на віру з інтерфейсу.
    pub async fn save_generated(
        &self,
        request: &SourceRequest,
        fingerprint: &str,
        input: GeneratedInput<'_>,
        now: &str,
    ) -> Result<GeneratedSave, SourceError> {
        let (current, _) = self.fingerprinted(request).await?;
        if current != fingerprint {
            return Err(SourceError::FingerprintMismatch);
        }
        let params = request.params();
        Ok(self
            .library
            .save_generated(
                self.keys,
                GeneratedDocument {
                    item_id: input.item_id,
                    name: input.name,
                    template_version_id: input.template_version_id,
                    source_kind: request.kind(),
                    params: &params,
                    fingerprint: &current,
                    ext: input.ext,
                    bytes: input.bytes,
                    make_current: input.make_current,
                    expected_current: input.expected_current,
                },
                now,
            )
            .await?)
    }

    /// Стани всіх зв'язків профілю. Кожне джерело (вид + параметри) рахується один раз
    /// за виклик; джерело не рахується для документів, чия поточна версія не з нього.
    pub async fn link_statuses(&self) -> Result<Vec<LinkStatus>, SourceError> {
        let links = self.library.links(self.keys).await?;
        let mut fingerprints: HashMap<String, Result<String, String>> = HashMap::new();
        let mut statuses = Vec::with_capacity(links.len());
        for link in links {
            let item = self.library.item(self.keys, &link.item_id).await?;
            let current: Option<LibraryVersion> = match &item.current_version_id {
                Some(version_id) => Some(self.library.version(self.keys, version_id).await?),
                None => None,
            };
            let origin = current.as_ref().map(|version| version.origin);
            let version_fingerprint = current
                .as_ref()
                .and_then(|version| version.source_fingerprint.as_deref());
            // Поточною вручну обрано іншу згенеровану версію, ніж остання: це свідомий
            // вибір з історії, «Оновити всі» його не чіпає.
            let picked_from_history = origin == Some(Origin::Generated)
                && link.last_generated_version_id.as_deref() != item.current_version_id.as_deref();
            if picked_from_history {
                statuses.push(LinkStatus {
                    item_id: link.item_id,
                    status: LinkState::Detached,
                    detail: None,
                });
                continue;
            }
            let source = if needs_source(origin) {
                match SourceRequest::parse(link.source_kind, &link.params) {
                    Ok(request) => {
                        let key = request.cache_key();
                        if !fingerprints.contains_key(&key) {
                            let computed = self
                                .fingerprinted(&request)
                                .await
                                .map(|(fingerprint, _)| fingerprint)
                                .map_err(|error| error.to_string());
                            fingerprints.insert(key.clone(), computed);
                        }
                        fingerprints[&key].clone()
                    }
                    Err(error) => Err(error.to_string()),
                }
            } else {
                Ok(String::new())
            };
            let (status, detail) = link_state(
                origin,
                version_fingerprint,
                source.as_deref().map_err(String::as_str),
            );
            statuses.push(LinkStatus {
                item_id: link.item_id,
                status,
                detail,
            });
        }
        Ok(statuses)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::office_library::{KdfParams, NewDocument, NewVersion};
    use sqlx::sqlite::SqlitePoolOptions;
    use std::io::Write;

    const NOW: &str = "2026-10-20T08:00:00Z";
    const LATER: &str = "2026-10-20T09:00:00Z";
    const PASSWORD: &str = "синтетичний-пароль";

    fn zip_parts(parts: &[(&str, &[u8])]) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        for (name, bytes) in parts {
            writer.start_file(*name, options).unwrap();
            writer.write_all(bytes).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    /// Синтетична книга з аркушами `(назва, прихований, рядки sheetData)`.
    fn xlsx(sheets: &[(&str, bool, &str)]) -> Vec<u8> {
        let entries: String = sheets
            .iter()
            .enumerate()
            .map(|(index, (name, hidden, _))| {
                let state = if *hidden { r#" state="hidden""# } else { "" };
                format!(
                    r#"<sheet name="{name}" sheetId="{id}"{state} r:id="rId{id}"/>"#,
                    id = index + 1
                )
            })
            .collect();
        let relations: String = (1..=sheets.len())
            .map(|id| {
                format!(
                    r#"<Relationship Id="rId{id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{id}.xml"/>"#
                )
            })
            .collect();
        let workbook = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>{entries}</sheets></workbook>"#
        );
        let workbook_rels = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{relations}</Relationships>"#
        );
        let sheet_parts: Vec<(String, String)> = sheets
            .iter()
            .enumerate()
            .map(|(index, (_, _, rows))| {
                (
                    format!("xl/worksheets/sheet{}.xml", index + 1),
                    format!(
                        r#"<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>{rows}</sheetData></worksheet>"#
                    ),
                )
            })
            .collect();
        let mut parts: Vec<(&str, &[u8])> = vec![
            (
                "[Content_Types].xml",
                br#"<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>"#,
            ),
            (
                "_rels/.rels",
                br#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"#,
            ),
            ("xl/workbook.xml", workbook.as_bytes()),
            ("xl/_rels/workbook.xml.rels", workbook_rels.as_bytes()),
        ];
        for (name, xml) in &sheet_parts {
            parts.push((name.as_str(), xml.as_bytes()));
        }
        zip_parts(&parts)
    }

    fn text_cell(reference: &str, text: &str) -> String {
        format!(r#"<c r="{reference}" t="inlineStr"><is><t>{text}</t></is></c>"#)
    }

    fn strings(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }

    #[test]
    fn params_are_normalized_per_source_kind() {
        let approved = SourceRequest::parse(
            SourceKind::ApprovedRevisions,
            &json!({"from": " 2026-10-01 ", "to": "", "extra": 1}),
        )
        .unwrap();
        assert_eq!(
            approved,
            SourceRequest::ApprovedRevisions {
                from: Some("2026-10-01".to_owned()),
                to: None
            }
        );
        assert_eq!(approved.params(), json!({"from": "2026-10-01", "to": null}));
        assert_eq!(
            SourceRequest::parse(SourceKind::ApprovedRevisions, &Value::Null)
                .unwrap()
                .params(),
            json!({"from": null, "to": null})
        );
        assert!(matches!(
            SourceRequest::parse(SourceKind::ApprovedRevisions, &json!({"from": 5})),
            Err(SourceError::InvalidParams(_))
        ));
        let module =
            SourceRequest::parse(SourceKind::DashboardModule, &json!({"moduleId": "m-1"})).unwrap();
        assert_eq!(module.params(), json!({"moduleId": "m-1"}));
        assert_eq!(module.kind(), SourceKind::DashboardModule);
        for bad in [
            json!({}),
            json!({"moduleId": ""}),
            json!({"moduleId": 3}),
            json!([]),
        ] {
            assert!(SourceRequest::parse(SourceKind::DashboardModule, &bad).is_err());
        }
        let table =
            SourceRequest::parse(SourceKind::LibraryTable, &json!({"itemId": "doc-1"})).unwrap();
        assert_eq!(table.params(), json!({"itemId": "doc-1"}));
        assert!(SourceRequest::parse(SourceKind::LibraryTable, &Value::Null).is_err());

        assert_eq!(
            SourceRequest::parse_kind("library_table").unwrap(),
            SourceKind::LibraryTable
        );
        assert_eq!(
            SourceRequest::parse_kind("files").unwrap_err().to_string(),
            "невідоме джерело даних «files»"
        );
        // Ключ кешу однаковий для однакових нормалізованих параметрів.
        let reordered = SourceRequest::parse(
            SourceKind::ApprovedRevisions,
            &json!({"to": null, "from": "2026-10-01"}),
        )
        .unwrap();
        assert_eq!(approved.cache_key(), reordered.cache_key());
        assert_ne!(approved.cache_key(), module.cache_key());
    }

    #[test]
    fn approved_revisions_are_shaped_for_templates() {
        let snapshot = json!({
            "schema_version": 1,
            "records": [{
                "num": "1", "date": "14.10.2026", "time": "09:35", "targets": "SYN-1",
                "unit": "Синтетичний підрозділ", "district": "н.п. Тестове",
                "dpi": "SYNTHETIC MGRS", "types": ["Навчальна ціль"],
                "aircraft": "Навчальний ЛА", "munition": "навчальний бп", "count": "2",
                "result": "УРАЖЕНО", "cause": [], "note": "Синтетичний запис"
            }]
        });
        let model = analytics::dashboard_model_from_snapshots_for_period(
            &[snapshot],
            Some("2026-10-01"),
            Some("2026-10-31"),
        )
        .unwrap();
        let data = approved_data(&model);
        assert_eq!(
            data["period"],
            json!({"from": "2026-10-01", "to": "2026-10-31"})
        );
        assert_eq!(data["overview"]["totalRecords"], 1);
        assert!(data["overview"].get("scope").is_none());
        assert!(data["overview"].get("period").is_none());
        assert_eq!(
            data["overview"].as_object().unwrap().len(),
            9,
            "{}",
            data["overview"]
        );
        let breakdowns = data["breakdowns"].as_array().unwrap();
        assert!(!breakdowns.is_empty());
        for row in breakdowns {
            let mut keys: Vec<&str> = row
                .as_object()
                .unwrap()
                .keys()
                .map(String::as_str)
                .collect();
            keys.sort_unstable();
            assert_eq!(
                keys,
                [
                    "dimension",
                    "dpiEffectPercent",
                    "munitionCount",
                    "overallEffectPercent",
                    "recordCount",
                    "value"
                ]
            );
        }
        assert!(breakdowns
            .iter()
            .any(|row| row["dimension"] == "aircraft"
                && row["value"] == data["records"][0]["aircraft"]));
        assert_eq!(data["records"][0]["number"], "1");
        assert_eq!(data["records"][0]["munitionCount"], 2);
    }

    #[test]
    fn csv_tables_detect_the_delimiter_and_quotes() {
        let table = parse_table(
            "csv",
            "\u{feff}Тип;Наліт;Примітка\r\nF-16;1,5;\"з \"\"лапками\"\"; і ;\"\r\n\r\n;;\nСу-27;2\n"
                .as_bytes(),
        )
        .unwrap();
        assert_eq!(table.sheet, None);
        assert_eq!(table.headers, strings(&["Тип", "Наліт", "Примітка"]));
        assert_eq!(
            table.rows,
            vec![
                strings(&["F-16", "1,5", "з \"лапками\"; і ;"]),
                strings(&["Су-27", "2", ""]),
            ]
        );
        let commas = parse_table("csv", b"a,b\n\"x, y\",2").unwrap();
        assert_eq!(commas.headers, strings(&["a", "b"]));
        assert_eq!(commas.rows, vec![strings(&["x, y", "2"])]);
        let multiline = parse_table("csv", "a;b\n\"рядок 1\nрядок 2\";3\n".as_bytes()).unwrap();
        assert_eq!(multiline.rows, vec![strings(&["рядок 1\nрядок 2", "3"])]);
        assert!(matches!(
            parse_table("csv", &[0xff, 0xfe, b'a']),
            Err(SourceError::NotUtf8)
        ));
        assert_eq!(parse_table("csv", b"").unwrap(), ParsedTable::default());
        assert!(matches!(
            parse_table("docx", b"x"),
            Err(SourceError::NotATable)
        ));
    }

    #[test]
    fn tables_are_limited_in_rows_and_columns() {
        let header: Vec<String> = (0..70).map(|index| format!("h{index}")).collect();
        let mut csv = header.join(";");
        csv.push('\n');
        for index in 0..(MAX_TABLE_ROWS + 5) {
            csv.push_str(&format!("{index};x\n"));
        }
        let table = parse_table("csv", csv.as_bytes()).unwrap();
        assert_eq!(table.headers.len(), MAX_TABLE_COLUMNS);
        assert_eq!(table.headers[63], "h63");
        assert_eq!(table.rows.len(), MAX_TABLE_ROWS);
        assert!(table.rows.iter().all(|row| row.len() == MAX_TABLE_COLUMNS));
        assert_eq!(
            table.rows[MAX_TABLE_ROWS - 1][0],
            (MAX_TABLE_ROWS - 1).to_string()
        );
    }

    #[test]
    fn xlsx_tables_read_the_first_visible_sheet() {
        let hidden = format!("<row r=\"1\">{}</row>", text_cell("A1", "Службовий"));
        let visible = format!(
            "<row r=\"2\">{}{}</row><row r=\"3\">{}<c r=\"B3\"><v>1.5</v></c><c r=\"C3\" t=\"b\"><v>1</v></c></row><row r=\"4\"><c r=\"B4\"><v>3</v></c></row>",
            text_cell("A2", "Тип"),
            text_cell("B2", "Наліт"),
            text_cell("A3", " F-16 "),
        );
        let bytes = xlsx(&[
            ("EasyWAR_Службовий", true, &hidden),
            ("Польоти", false, &visible),
        ]);
        let table = parse_table("xlsx", &bytes).unwrap();
        assert_eq!(table.sheet.as_deref(), Some("Польоти"));
        assert_eq!(table.headers, strings(&["Тип", "Наліт", ""]));
        assert_eq!(
            table.rows,
            vec![strings(&["F-16", "1,5", "так"]), strings(&["", "3", ""])]
        );
        assert!(matches!(
            parse_table("xlsx", b"not a workbook"),
            Err(SourceError::InvalidTable(_))
        ));
    }

    #[test]
    fn link_states_follow_origin_and_fingerprint() {
        let same = Ok("a");
        let changed = Ok("b");
        assert_eq!(
            link_state(Some(Origin::Generated), Some("a"), same),
            (LinkState::Current, None)
        );
        assert_eq!(
            link_state(Some(Origin::Generated), Some("a"), changed),
            (LinkState::SourceChanged, None)
        );
        assert_eq!(
            link_state(Some(Origin::Edited), Some("a"), same),
            (LinkState::Edited, None)
        );
        assert_eq!(
            link_state(Some(Origin::Edited), Some("a"), changed),
            (LinkState::EditedStale, None)
        );
        assert_eq!(
            link_state(Some(Origin::Edited), None, same),
            (LinkState::EditedStale, None)
        );
        for origin in [None, Some(Origin::Imported), Some(Origin::Saved)] {
            assert_eq!(
                link_state(origin, Some("a"), Err("джерело недоступне")),
                (LinkState::Detached, None)
            );
        }
        assert_eq!(
            link_state(Some(Origin::Generated), Some("a"), Err("модуль видалено")),
            (LinkState::SourceError, Some("модуль видалено".to_owned()))
        );
        assert_eq!(
            serde_json::to_value(LinkState::EditedStale).unwrap(),
            "edited_stale"
        );
    }

    struct Fixture {
        repository: Repository,
        modules: DashboardModuleStore,
        library: LibraryStore,
        keys: LibraryKeys,
        profiles: LocalProfileStore,
        templates: WorkspaceTemplateStore,
        profile: String,
    }

    impl Fixture {
        fn sources(&self) -> Sources<'_> {
            Sources {
                repository: &self.repository,
                modules: &self.modules,
                library: &self.library,
                keys: &self.keys,
            }
        }
    }

    async fn fixture() -> Fixture {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        crate::database::embedded_migrator()
            .run(&pool)
            .await
            .unwrap();
        let profiles = LocalProfileStore::new(pool.clone());
        let profile = crate::local_profiles::generate_profile_id("Джерела", NOW);
        profiles.create(&profile, "Джерела", NOW).await.unwrap();
        profiles
            .set_password(&profile, None, Some(PASSWORD), None, NOW)
            .await
            .unwrap();
        profiles
            .update_details(&profile, "Синтетична посада", None, NOW)
            .await
            .unwrap();
        let library = LibraryStore::with_kdf(pool.clone(), KdfParams::FOR_TESTS);
        let keys = library
            .create(&profile, PASSWORD, false, NOW)
            .await
            .unwrap()
            .keys;
        Fixture {
            repository: Repository::new(pool.clone()),
            modules: DashboardModuleStore::new(pool.clone()),
            library,
            keys,
            profiles,
            templates: WorkspaceTemplateStore::new(pool),
            profile,
        }
    }

    fn document<'a>(name: &'a str, ext: &'a str, bytes: &'a [u8]) -> NewDocument<'a> {
        NewDocument {
            name,
            ext,
            as_template: false,
            profile_table_copy: false,
            bytes,
        }
    }

    #[tokio::test]
    async fn sources_give_data_profile_and_link_statuses() {
        let fixture = fixture().await;
        let sources = fixture.sources();

        let profile = source_profile(&fixture.profiles, &fixture.templates, &fixture.profile)
            .await
            .unwrap();
        assert_eq!(
            profile,
            SourceProfile {
                display_name: "Джерела".to_owned(),
                position: "Синтетична посада".to_owned(),
                role: "Керівник".to_owned(),
            }
        );

        // Схвалених ревізій у синтетичній базі немає: порожній підсумок.
        let approved = sources
            .data(&SourceRequest::ApprovedRevisions {
                from: None,
                to: None,
            })
            .await
            .unwrap();
        assert_eq!(approved["overview"]["totalRecords"], 0);
        assert_eq!(approved["records"], json!([]));

        // Модуль дашборда профілю.
        let module = fixture
            .modules
            .create(&fixture.profile, "air", "flight-hours", None, NOW)
            .await
            .unwrap();
        let rows = vec![
            json!({"aircraft_type": "Борт-1", "airborne_hours": 1.5, "total_hours": 2.0})
                .as_object()
                .unwrap()
                .clone(),
        ];
        fixture
            .modules
            .replace_rows(&fixture.profile, &module.id, rows, None, NOW)
            .await
            .unwrap();
        let module_request = SourceRequest::DashboardModule {
            module_id: module.id.clone(),
        };
        let data = sources.data(&module_request).await.unwrap();
        assert_eq!(data["module"]["id"], module.id);
        assert_eq!(data["module"]["templateId"], "flight-hours");
        assert_eq!(data["module"]["branch"], "air");
        assert!(data["module"]["fields"][0].get("dataType").is_some());
        assert!(data["module"]["fields"][0].get("role").is_none());
        assert_eq!(data["rows"][0]["aircraft_type"], "Борт-1");
        assert!(data["rows"][0].get("rowId").is_some());
        assert_eq!(data["truncated"], false);

        // Таблиця бібліотеки.
        let (table_item, table_v1) = fixture
            .library
            .import(
                &fixture.keys,
                document("Наліт", "csv", "Тип;Наліт\nБорт-1;1,5\n".as_bytes()),
                NOW,
            )
            .await
            .unwrap();
        let table_request = SourceRequest::LibraryTable {
            item_id: table_item.id.clone(),
        };
        let (fingerprint, data) = sources.fingerprinted(&table_request).await.unwrap();
        assert_eq!(
            data,
            json!({
                "table": {"itemId": table_item.id, "name": "Наліт", "versionId": table_v1.id, "sheet": null},
                "headers": ["Тип", "Наліт"],
                "rows": [["Борт-1", "1,5"]],
            })
        );
        assert_eq!(fingerprint.len(), 64);

        let (_, template) = fixture
            .library
            .import(
                &fixture.keys,
                NewDocument {
                    as_template: true,
                    ..document("Шаблон", "docx", b"PK\x03\x04 synthetic template")
                },
                NOW,
            )
            .await
            .unwrap();
        assert!(matches!(
            sources
                .data(&SourceRequest::LibraryTable {
                    item_id: template.item_id.clone()
                })
                .await,
            Err(SourceError::NotATable)
        ));

        // Застарілий відбиток не дає зберегти документ.
        let input = GeneratedInput {
            item_id: None,
            expected_current: None,
            name: Some("Довідка"),
            template_version_id: &template.id,
            ext: "docx",
            bytes: b"PK\x03\x04 synthetic generated 1",
            make_current: true,
        };
        assert!(matches!(
            sources
                .save_generated(&table_request, &"0".repeat(64), input, NOW)
                .await,
            Err(SourceError::FingerprintMismatch)
        ));
        let generated = sources
            .save_generated(&table_request, &fingerprint, input, NOW)
            .await
            .unwrap();
        let generated_id = generated.item.id.clone();
        assert_eq!(
            generated.item.link.as_ref().unwrap().params,
            json!({"itemId": table_item.id})
        );

        // Документ з модулем, якого вже немає: джерело недоступне.
        let missing_params = json!({"moduleId": "module-missing"});
        let broken = fixture
            .library
            .save_generated(
                &fixture.keys,
                GeneratedDocument {
                    item_id: None,
                    expected_current: None,
                    name: Some("Без модуля"),
                    template_version_id: &template.id,
                    source_kind: SourceKind::DashboardModule,
                    params: &missing_params,
                    fingerprint: &"1".repeat(64),
                    ext: "docx",
                    bytes: b"PK\x03\x04 synthetic generated 2",
                    make_current: true,
                },
                NOW,
            )
            .await
            .unwrap();

        let status_of = |statuses: &[LinkStatus], id: &str| {
            statuses
                .iter()
                .find(|status| status.item_id == id)
                .map(|status| (status.status, status.detail.clone()))
                .unwrap()
        };
        let statuses = sources.link_statuses().await.unwrap();
        assert_eq!(statuses.len(), 2);
        assert_eq!(
            status_of(&statuses, &generated_id),
            (LinkState::Current, None)
        );
        let (state, detail) = status_of(&statuses, &broken.item.id);
        assert_eq!(state, LinkState::SourceError);
        assert_eq!(detail.as_deref(), Some("модуль дашборда не знайдено"));

        // Ручна правка згенерованої версії з тим самим відбитком.
        let edited = fixture
            .library
            .save_version(
                &fixture.keys,
                &generated_id,
                NewVersion {
                    ext: "docx",
                    bytes: b"PK\x03\x04 synthetic edited",
                    origin: Origin::Edited,
                    parent_version_id: Some(&generated.version.id),
                    source_fingerprint: Some(&fingerprint),
                    make_current: true,
                },
                LATER,
            )
            .await
            .unwrap()
            .unwrap();
        let statuses = sources.link_statuses().await.unwrap();
        assert_eq!(
            status_of(&statuses, &generated_id),
            (LinkState::Edited, None)
        );

        // Таблиця-джерело змінилася.
        fixture
            .library
            .save_version(
                &fixture.keys,
                &table_item.id,
                NewVersion {
                    ext: "csv",
                    bytes: "Тип;Наліт\nБорт-1;2,5\n".as_bytes(),
                    origin: Origin::Saved,
                    parent_version_id: Some(&table_v1.id),
                    source_fingerprint: None,
                    make_current: true,
                },
                LATER,
            )
            .await
            .unwrap()
            .unwrap();
        let statuses = sources.link_statuses().await.unwrap();
        assert_eq!(
            status_of(&statuses, &generated_id),
            (LinkState::EditedStale, None)
        );
        fixture
            .library
            .set_current(&fixture.keys, &generated_id, &generated.version.id, LATER)
            .await
            .unwrap();
        let statuses = sources.link_statuses().await.unwrap();
        assert_eq!(
            status_of(&statuses, &generated_id),
            (LinkState::SourceChanged, None)
        );

        // Поточна версія, збережена вручну, — не з джерела.
        fixture
            .library
            .save_version(
                &fixture.keys,
                &generated_id,
                NewVersion {
                    ext: "docx",
                    bytes: b"PK\x03\x04 synthetic saved",
                    origin: Origin::Saved,
                    parent_version_id: Some(&edited.id),
                    source_fingerprint: None,
                    make_current: true,
                },
                LATER,
            )
            .await
            .unwrap()
            .unwrap();
        let statuses = sources.link_statuses().await.unwrap();
        assert_eq!(
            status_of(&statuses, &generated_id),
            (LinkState::Detached, None)
        );
    }

    #[test]
    fn xlsx_columns_count_from_sheet_column_a() {
        let rows = format!(
            "<row r=\"2\">{}{}</row><row r=\"3\">{}<c r=\"C3\"><v>0.30000000000000004</v></c></row>",
            text_cell("B2", "Тип"),
            text_cell("C2", "Частка"),
            text_cell("B3", "Борт-1"),
        );
        let table = parse_table("xlsx", &xlsx(&[("Аркуш", false, &rows)])).unwrap();
        assert_eq!(table.headers, strings(&["", "Тип", "Частка"]));
        assert_eq!(table.rows, vec![strings(&["", "Борт-1", "0,3"])]);

        // Розріджена книга (A1 і XFD1048576) читається потоком, без суцільної сітки.
        let sparse = format!(
            "<row r=\"1\">{}</row><row r=\"1048576\">{}</row>",
            text_cell("A1", "Назва"),
            text_cell("XFD1048576", "кінець"),
        );
        let table = parse_table("xlsx", &xlsx(&[("Аркуш", false, &sparse)])).unwrap();
        assert_eq!(table.headers, strings(&["Назва"]));
        assert!(table.rows.is_empty());

        // Рядки не за порядком і клітинка поза аркушем — помилка таблиці, не збій.
        let unordered = format!(
            "<row r=\"5\">{}</row><row r=\"2\">{}</row>",
            text_cell("A5", "пʼять"),
            text_cell("A2", "два"),
        );
        assert!(matches!(
            parse_table("xlsx", &xlsx(&[("Аркуш", false, &unordered)])),
            Err(SourceError::InvalidTable(_))
        ));
        let outside = format!("<row r=\"1\">{}</row>", text_cell("XFE1", "поза"));
        assert!(matches!(
            parse_table("xlsx", &xlsx(&[("Аркуш", false, &outside)])),
            Err(SourceError::InvalidTable(_))
        ));
    }

    #[test]
    fn xlsx_numbers_read_as_excel_shows_them() {
        assert_eq!(float_text(0.1 + 0.2), "0,3");
        assert_eq!(float_text(2.5), "2,5");
        assert_eq!(float_text(-1.25), "-1,25");
        assert_eq!(float_text(1234.0), "1234");
        assert_eq!(float_text(-0.0), "0");
        assert_eq!(float_text(2.0 / 3.0), "0,666666666666667");
        assert_eq!(float_text(1e-7), "0,0000001");
        assert_eq!(float_text(f64::NAN), "");
        assert_eq!(float_text(f64::INFINITY), "");
    }

    #[tokio::test]
    async fn table_fingerprint_ignores_metadata_and_a_history_pick_is_detached() {
        let fixture = fixture().await;
        let sources = fixture.sources();
        let (table, table_v1) = fixture
            .library
            .import(
                &fixture.keys,
                document("Наліт", "csv", "Тип;Наліт\nБорт-1;1,5\n".as_bytes()),
                NOW,
            )
            .await
            .unwrap();
        let request = SourceRequest::LibraryTable {
            item_id: table.id.clone(),
        };
        let save_table = |bytes: &'static str, parent: String| {
            let library = &fixture.library;
            let keys = &fixture.keys;
            let item_id = table.id.clone();
            async move {
                library
                    .save_version(
                        keys,
                        &item_id,
                        NewVersion {
                            ext: "csv",
                            bytes: bytes.as_bytes(),
                            origin: Origin::Saved,
                            parent_version_id: Some(&parent),
                            source_fingerprint: None,
                            make_current: true,
                        },
                        LATER,
                    )
                    .await
                    .unwrap()
                    .unwrap()
            }
        };
        let (before, _) = sources.fingerprinted(&request).await.unwrap();
        // Перейменування й нова версія з тими самими клітинками відбитка не змінюють.
        fixture
            .library
            .rename(&fixture.keys, &table.id, "Наліт за жовтень", LATER)
            .await
            .unwrap();
        let same_cells = save_table(
            "\"Тип\";\"Наліт\"\n\"Борт-1\";\"1,5\"\n",
            table_v1.id.clone(),
        )
        .await;
        let (after, data) = sources.fingerprinted(&request).await.unwrap();
        assert_eq!(after, before);
        assert_eq!(data["table"]["name"], "Наліт за жовтень");
        assert_eq!(data["table"]["versionId"], same_cells.id);

        let (_, template) = fixture
            .library
            .import(
                &fixture.keys,
                NewDocument {
                    as_template: true,
                    ..document("Шаблон", "docx", b"PK\x03\x04 synthetic template")
                },
                NOW,
            )
            .await
            .unwrap();
        let input = GeneratedInput {
            item_id: None,
            expected_current: None,
            name: Some("Довідка"),
            template_version_id: &template.id,
            ext: "docx",
            bytes: b"PK\x03\x04 synthetic generated 1",
            make_current: true,
        };
        let first = sources
            .save_generated(&request, &after, input, LATER)
            .await
            .unwrap();
        let item_id = first.item.id.clone();
        let status = |statuses: Vec<LinkStatus>| {
            statuses
                .into_iter()
                .find(|status| status.item_id == item_id)
                .map(|status| status.status)
                .unwrap()
        };

        // Інші клітинки — інший відбиток; нова генерація знову «актуальна».
        save_table("Тип;Наліт\nБорт-1;3,5\n", same_cells.id.clone()).await;
        let (changed, _) = sources.fingerprinted(&request).await.unwrap();
        assert_ne!(changed, before);
        assert_eq!(
            status(sources.link_statuses().await.unwrap()),
            LinkState::SourceChanged
        );
        let second_input = GeneratedInput {
            item_id: Some(&item_id),
            expected_current: Some(Some(&first.version.id)),
            bytes: b"PK\x03\x04 synthetic generated 2",
            ..input
        };
        let second = sources
            .save_generated(&request, &changed, second_input, LATER)
            .await
            .unwrap();
        assert!(second.created);
        assert_eq!(
            status(sources.link_statuses().await.unwrap()),
            LinkState::Current
        );

        // Ручний вибір попередньої згенерованої версії — «не з джерела».
        fixture
            .library
            .set_current(&fixture.keys, &item_id, &first.version.id, LATER)
            .await
            .unwrap();
        assert_eq!(
            status(sources.link_statuses().await.unwrap()),
            LinkState::Detached
        );
        // «Оновити» повертає поточною останню згенеровану (нової версії немає).
        let back = sources
            .save_generated(
                &request,
                &changed,
                GeneratedInput {
                    expected_current: Some(Some(&first.version.id)),
                    ..second_input
                },
                LATER,
            )
            .await
            .unwrap();
        assert!(!back.created);
        assert_eq!(back.version.id, second.version.id);
        assert_eq!(
            status(sources.link_statuses().await.unwrap()),
            LinkState::Current
        );
    }
}
