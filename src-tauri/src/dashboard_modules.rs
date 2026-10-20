use serde::{Deserialize, Serialize};
use serde_json::{Map, Number, Value};
use sha2::{Digest, Sha256};
use sqlx::{Row, Sqlite, SqlitePool, Transaction};
use std::collections::{BTreeMap, BTreeSet};

const MAX_MODULES_PER_BRANCH: i64 = 64;
const MAX_ROWS_PER_WRITE: usize = 10_000;
const MAX_ROWS_PER_READ: i64 = 10_000;
const MAX_TEXT_LENGTH: usize = 4096;
/// Службове поле рядка: ідентифікатор запису, який клієнт отримав від `get_data`.
/// Це не колонка каталогу, тому в DDL воно не потрапляє.
const ROW_ID_KEY: &str = "rowId";
/// Скільки виправлень можна передати разом зі створенням модуля.
const MAX_CORRECTIONS_PER_WRITE: usize = 20_000;
/// Назва файла, аркуша й заголовок колонки джерела виправлення.
const MAX_SOURCE_TEXT_LENGTH: usize = 255;
const MAX_REASON_LENGTH: usize = 500;
/// Стиль оформлення модуля, коли його не обрано: картка така, як була до вибору стилів.
pub const DEFAULT_MODULE_STYLE: &str = "standard";

#[derive(Clone, Debug)]
pub struct DashboardModuleStore {
    pool: SqlitePool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardModuleFieldTemplate {
    pub key: &'static str,
    pub label: &'static str,
    pub data_type: &'static str,
    pub role: &'static str,
    pub aggregation: &'static str,
    pub required: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardModuleTemplate {
    pub id: &'static str,
    pub title: &'static str,
    pub category: &'static str,
    pub description: &'static str,
    pub visual_kind: &'static str,
    pub default_span: u8,
    pub fields: Vec<DashboardModuleFieldTemplate>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardModuleField {
    pub key: String,
    pub label: String,
    pub data_type: String,
    pub role: String,
    pub aggregation: String,
    pub required: bool,
    pub position: i64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardModule {
    pub id: String,
    pub branch: String,
    pub template_id: String,
    pub visual_kind: String,
    pub default_span: u8,
    pub title: String,
    /// Стиль оформлення: `standard`, `branch` (кольори роду військ) або `heightwell`
    /// («Пункт керування»). Колір задає гілка модуля, тут лише назва стилю.
    pub style: String,
    pub storage_table: String,
    pub fields: Vec<DashboardModuleField>,
    pub row_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardModuleData {
    pub module: DashboardModule,
    pub rows: Vec<BTreeMap<String, Value>>,
    pub truncated: bool,
    /// Значення, виправлені на екрані «Перевірка» під час підтягування з таблиці
    /// користувача: сирий текст клітинки й введений текст окремо від запису.
    pub corrections: Vec<DashboardModuleCorrection>,
}

/// Виправлення, яке надходить разом зі створенням модуля: `row_index` — номер запису
/// в `rows` (з нуля). Сам запис уже містить виправлене значення; тут — звідки воно
/// взялося. Шляху до файла немає: лише назва, аркуш, рядок і заголовок колонки.
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NewImportCorrection {
    pub row_index: usize,
    pub field_key: String,
    pub source_file: String,
    pub source_sheet: String,
    pub source_row: i64,
    pub source_column: String,
    pub raw_text: String,
    pub corrected_text: String,
    pub reason: String,
}

/// Збережене виправлення значення запису модуля (таблиця `dashboard_module_corrections`).
#[derive(Clone, Debug, Eq, PartialEq, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DashboardModuleCorrection {
    pub row_id: i64,
    pub field_key: String,
    pub source_file: String,
    pub source_sheet: String,
    pub source_row: i64,
    pub source_column: String,
    pub raw_text: String,
    pub corrected_text: String,
    pub reason: String,
    pub created_at: String,
}

#[derive(Debug, thiserror::Error)]
pub enum DashboardModuleError {
    #[error("не вдалося прочитати або зберегти модуль дашборда")]
    Storage(#[from] sqlx::Error),
    #[error("спершу увійдіть у локальний профіль")]
    ProfileRequired,
    #[error("невідома гілка дашборда")]
    InvalidBranch,
    #[error("невідомий тип модуля")]
    UnknownTemplate,
    #[error("назва модуля має містити від 1 до 80 символів")]
    InvalidTitle,
    #[error("досягнуто межі 64 модулі для цього дашборда")]
    ModuleLimit,
    #[error("модуль дашборда не знайдено")]
    ModuleNotFound,
    #[error("службова схема модуля пошкоджена")]
    InvalidStoredSchema,
    #[error("за один раз можна записати не більше 10000 рядків")]
    TooManyRows,
    #[error("рядок містить невідоме поле: {0}")]
    UnknownField(String),
    #[error("поле «{0}» є обов'язковим")]
    RequiredField(String),
    #[error("значення поля «{0}» не відповідає типу {1}")]
    InvalidValue(String, String),
    #[error("текст у полі «{0}» перевищує 4096 символів")]
    TextTooLong(String),
    #[error("таблицю змінено в іншому вікні; відкрийте її знову")]
    Conflict,
    #[error("некоректний або повторений ідентифікатор запису")]
    InvalidRowId,
    #[error("виправлення значення не відповідає підтягнутим записам")]
    InvalidCorrection,
    #[error("невідомий стиль оформлення модуля")]
    InvalidStyle,
}

fn field(
    key: &'static str,
    label: &'static str,
    data_type: &'static str,
    role: &'static str,
    aggregation: &'static str,
    required: bool,
) -> DashboardModuleFieldTemplate {
    DashboardModuleFieldTemplate {
        key,
        label,
        data_type,
        role,
        aggregation,
        required,
    }
}

fn dimension(key: &'static str, label: &'static str) -> DashboardModuleFieldTemplate {
    field(key, label, "text", "dimension", "none", true)
}

fn metric(key: &'static str, label: &'static str) -> DashboardModuleFieldTemplate {
    field(key, label, "real", "metric", "sum", true)
}

fn template(
    id: &'static str,
    title: &'static str,
    category: &'static str,
    description: &'static str,
    visual_kind: &'static str,
    default_span: u8,
    fields: Vec<DashboardModuleFieldTemplate>,
) -> DashboardModuleTemplate {
    DashboardModuleTemplate {
        id,
        title,
        category,
        description,
        visual_kind,
        default_span,
        fields,
    }
}

/// Вбудований каталог покриває всі сім наданих референсів. Він є єдиним
/// джерелом фізичних назв колонок: довільний текст користувача у DDL не потрапляє.
pub fn catalog() -> Vec<DashboardModuleTemplate> {
    vec![
        template(
            "flight-hours",
            "Журнал хронометражу польотів",
            "Авіація",
            "Журнал польотів: кожен політ — один рядок таблиці (екіпаж, погода, наліт, паливо). На дашборді — наліт у повітрі та загальний наліт за типом ПС.",
            "horizontal-bar",
            2,
            vec![
                field(
                    "list_number",
                    "Номер за списком",
                    "integer",
                    "order",
                    "none",
                    false,
                ),
                dimension("aircraft_type", "Тип ПС"),
                // Бортовий номер: цифри або текст, тому текстове поле.
                field(
                    "aircraft_number",
                    "Номер ПС",
                    "text",
                    "dimension",
                    "none",
                    false,
                ),
                // Позивний командира екіпажу стоїть одразу після номера ПС. Це текст
                // (число чи слово; нулі на початку зберігаються), а не особа екіпажу.
                field(
                    "crew_ke_callsign",
                    "Позивний командира екіпажу",
                    "text",
                    "dimension",
                    "none",
                    false,
                ),
                field(
                    "day_night",
                    "День / ніч",
                    "text",
                    "dimension",
                    "none",
                    false,
                ),
                field(
                    "flight_shift_number",
                    "Номер льотної зміни",
                    "integer",
                    "dimension",
                    "none",
                    false,
                ),
                field(
                    "training_program_fuel",
                    "Програма підготовки (паливо)",
                    "text",
                    "note",
                    "none",
                    false,
                ),
                field(
                    "combat_training_exercise_number",
                    "Номер вправи за курсом бойової підготовки",
                    "text",
                    "note",
                    "none",
                    false,
                ),
                field(
                    "complex_exercise_number_1",
                    "Номер вправи у комплексі №1",
                    "text",
                    "note",
                    "none",
                    false,
                ),
                field(
                    "complex_exercise_number_2",
                    "Номер вправи у комплексі №2",
                    "text",
                    "note",
                    "none",
                    false,
                ),
                field(
                    "flight_count",
                    "Кількість польотів",
                    "integer",
                    "metric",
                    "sum",
                    false,
                ),
                // «Запуск проба» з таблиці власника — тривалість, як наліт: вводять і
                // показують год:хв, у базі десяткові години.
                field(
                    "engine_test_time",
                    "Запуск, проба, год:хв",
                    "real",
                    "metric",
                    "sum",
                    false,
                ),
                field(
                    "takeoff_time",
                    "Час зльоту",
                    "text",
                    "dimension",
                    "none",
                    false,
                ),
                field(
                    "landing_time",
                    "Час посадки",
                    "text",
                    "dimension",
                    "none",
                    false,
                ),
                metric("airborne_hours", "Наліт (повітря), год:хв"),
                metric("total_hours", "Наліт (загальний), год:хв"),
                field(
                    "flight_altitude",
                    "Висота польоту, м",
                    "real",
                    "metric",
                    "average",
                    false,
                ),
                field(
                    "combat_application_grade",
                    "Оцінка бойового застосування",
                    "text",
                    "status",
                    "none",
                    false,
                ),
                field(
                    "flight_grade",
                    "Оцінка за політ",
                    "text",
                    "status",
                    "none",
                    false,
                ),
                field(
                    "cloud_base_upper",
                    "Верхня межа хмар (ВМХ), м",
                    "real",
                    "metric",
                    "average",
                    false,
                ),
                field(
                    "cloud_base_lower",
                    "Нижня межа хмар (НМХ), м",
                    "real",
                    "metric",
                    "average",
                    false,
                ),
                field(
                    "cloud_cover",
                    "Хмарність, 0–10",
                    "integer",
                    "metric",
                    "average",
                    false,
                ),
                field(
                    "visibility",
                    "Видимість, км",
                    "real",
                    "metric",
                    "average",
                    false,
                ),
                field(
                    "instrument_meteorological_conditions",
                    "Політ у СМУ",
                    "boolean",
                    "status",
                    "none",
                    false,
                ),
                field(
                    "time_in_clouds",
                    "Час у хмарах, год:хв",
                    "real",
                    "metric",
                    "sum",
                    false,
                ),
                field(
                    "hood_time",
                    "Час під шторкою, год:хв",
                    "real",
                    "metric",
                    "sum",
                    false,
                ),
                field(
                    "fuel_consumption",
                    "Витрата палива, л",
                    "real",
                    "metric",
                    "sum",
                    false,
                ),
                // Екіпаж: у полях пишуть прізвища. КЕ, ЛШ і БТ — окремі поля, решта
                // (разом до 8 осіб: інструктор у будь-кого з екіпажу, на літаку ще
                // ПКЕ, штурман, бортмеханік, радист) — одне поле з прізвищами через кому.
                field("crew_ke", "Екіпаж: КЕ", "text", "dimension", "none", false),
                field("crew_lsh", "Екіпаж: ЛШ", "text", "dimension", "none", false),
                field("crew_bt", "Екіпаж: БТ", "text", "dimension", "none", false),
                field(
                    "crew_other",
                    "Екіпаж: інші (до 5)",
                    "text",
                    "dimension",
                    "none",
                    false,
                ),
                // Решта колонок таблиці власника: пасажири, вантаж і заходи/посадки
                // за РСП — кількості, тому цілі числа; вантаж — кілограми.
                field("passengers", "Пасажири", "integer", "metric", "sum", false),
                field("cargo_kg", "Вантаж, кг", "real", "metric", "sum", false),
                field(
                    "rsp_approaches",
                    "Заходів РСП",
                    "integer",
                    "metric",
                    "sum",
                    false,
                ),
                field(
                    "rsp_landings",
                    "Посадок РСП",
                    "integer",
                    "metric",
                    "sum",
                    false,
                ),
            ],
        ),
        template(
            "kpi",
            "Ключовий показник",
            "Показники",
            "Одне велике значення, одиниця виміру та зміна за період.",
            "kpi",
            1,
            vec![
                field("label", "Показник", "text", "label", "none", true),
                metric("value", "Значення"),
                field("delta", "Зміна, %", "real", "metric", "average", false),
                field("unit", "Одиниця", "text", "note", "none", false),
            ],
        ),
        template(
            "line",
            "Лінійний графік",
            "Динаміка",
            "Зміна одного або кількох показників у часі.",
            "line",
            2,
            vec![
                field("period", "Період", "date", "dimension", "none", true),
                metric("value", "Значення"),
                field("series", "Ряд", "text", "series", "none", false),
            ],
        ),
        template(
            "area",
            "Графік із площею",
            "Динаміка",
            "Тренд із заповненою областю для акценту на обсязі.",
            "area",
            2,
            vec![
                field("period", "Період", "date", "dimension", "none", true),
                metric("value", "Значення"),
                field("series", "Ряд", "text", "series", "none", false),
            ],
        ),
        template(
            "columns",
            "Вертикальні стовпчики",
            "Порівняння",
            "Порівнює категорії за висотою стовпчиків.",
            "columns",
            2,
            vec![
                dimension("category", "Категорія"),
                metric("value", "Значення"),
                field("series", "Ряд", "text", "series", "none", false),
            ],
        ),
        template(
            "horizontal-bars",
            "Горизонтальні смуги",
            "Порівняння",
            "Рейтинг категорій із довгими підписами.",
            "horizontal-bar",
            2,
            vec![
                dimension("category", "Категорія"),
                metric("value", "Значення"),
                field("series", "Ряд", "text", "series", "none", false),
            ],
        ),
        template(
            "grouped-columns",
            "Згруповані стовпчики",
            "Порівняння",
            "Два порівнювані значення для кожної категорії.",
            "grouped-columns",
            2,
            vec![
                dimension("category", "Категорія"),
                metric("primary_value", "Основне значення"),
                metric("secondary_value", "Порівняльне значення"),
            ],
        ),
        template(
            "donut",
            "Кільцева діаграма",
            "Структура",
            "Частки категорій у загальному підсумку.",
            "donut",
            1,
            vec![
                dimension("category", "Категорія"),
                metric("value", "Значення"),
            ],
        ),
        template(
            "radial-progress",
            "Радіальний прогрес",
            "Показники",
            "Виконання одного показника відносно цілі.",
            "radial-progress",
            1,
            vec![
                field("label", "Показник", "text", "label", "none", true),
                metric("current_value", "Поточне значення"),
                metric("target_value", "Цільове значення"),
            ],
        ),
        template(
            "multi-ring",
            "Кілька радіальних шкал",
            "Показники",
            "Кілька вкладених показників виконання.",
            "multi-ring",
            1,
            vec![
                field("label", "Показник", "text", "label", "none", true),
                metric("current_value", "Поточне значення"),
                metric("target_value", "Цільове значення"),
                field("ring_order", "Порядок", "integer", "order", "none", false),
            ],
        ),
        template(
            "radar",
            "Радарна діаграма",
            "Порівняння",
            "Профіль за кількома осями з підтримкою серій.",
            "radar",
            1,
            vec![
                dimension("axis", "Вісь"),
                metric("value", "Значення"),
                field("series", "Ряд", "text", "series", "none", false),
            ],
        ),
        template(
            "gauge",
            "Шкала-прилад",
            "Показники",
            "Поточний рівень у заданому мінімумі й максимумі.",
            "gauge",
            1,
            vec![
                field("label", "Показник", "text", "label", "none", true),
                metric("value", "Значення"),
                field("minimum", "Мінімум", "real", "metric", "minimum", false),
                field("maximum", "Максимум", "real", "metric", "maximum", true),
            ],
        ),
        template(
            "progress-bars",
            "Смуги виконання",
            "Показники",
            "Кілька показників із прогресом до цілі.",
            "progress-bars",
            1,
            vec![
                field("label", "Показник", "text", "label", "none", true),
                metric("current_value", "Поточне значення"),
                metric("target_value", "Цільове значення"),
            ],
        ),
        template(
            "calendar",
            "Календар активності",
            "Час",
            "Щільність подій або значення за днями.",
            "calendar",
            1,
            vec![
                field("date", "Дата", "date", "dimension", "none", true),
                metric("value", "Значення"),
            ],
        ),
        template(
            "table",
            "Оперативна таблиця",
            "Реєстр",
            "Рядки з показником, станом і приміткою.",
            "table",
            2,
            vec![
                field("label", "Назва", "text", "label", "none", true),
                metric("value", "Значення"),
                // Виконання у відсотках — смуга в рядку таблиці (референс «Активні проєкти»).
                field("progress", "Виконання, %", "real", "metric", "average", false),
                field("status", "Стан", "text", "status", "none", false),
                field("note", "Примітка", "text", "note", "none", false),
            ],
        ),
        template(
            "funnel",
            "Воронка",
            "Процес",
            "Послідовні етапи та залишок на кожному з них.",
            "funnel",
            1,
            vec![
                dimension("stage", "Етап"),
                metric("value", "Значення"),
                field("stage_order", "Порядок", "integer", "order", "none", true),
            ],
        ),
        template(
            "map",
            "Карта подій",
            "Географія",
            "Точки на карті з числовим значенням і станом.",
            "map",
            2,
            vec![
                field("label", "Назва", "text", "label", "none", true),
                field("latitude", "Широта", "real", "latitude", "none", true),
                field("longitude", "Довгота", "real", "longitude", "none", true),
                metric("value", "Значення"),
                field("status", "Стан", "text", "status", "none", false),
            ],
        ),
        // Погодний шаблон у стилі погодних дашбордів: темна карта з ізолініями хмарності,
        // виноски на пунктах, шкала часу з небезпечними явищами й 3D-рельєф із хмарами.
        template(
            "weather",
            "Метеоумови",
            "Географія",
            "Спостереження погоди на пунктах: хмарність, межі хмар, видимість, вітер і явища. На дашборді — карта з ізолініями хмарності й шкалою часу, окремо — 3D-рельєф із хмарами.",
            "weather",
            2,
            vec![
                field(
                    "observed_at",
                    "Час спостереження",
                    "datetime",
                    "dimension",
                    "none",
                    true,
                ),
                field("label", "Пункт", "text", "label", "none", true),
                field("latitude", "Широта", "real", "latitude", "none", true),
                field("longitude", "Довгота", "real", "longitude", "none", true),
                field(
                    "cloud_cover",
                    "Хмарність, 0–10",
                    "integer",
                    "metric",
                    "average",
                    true,
                ),
                field(
                    "cloud_base_lower",
                    "Нижня межа хмар (НМХ), м",
                    "real",
                    "metric",
                    "average",
                    false,
                ),
                field(
                    "cloud_base_upper",
                    "Верхня межа хмар (ВМХ), м",
                    "real",
                    "metric",
                    "average",
                    false,
                ),
                field(
                    "visibility",
                    "Видимість, км",
                    "real",
                    "metric",
                    "average",
                    false,
                ),
                field(
                    "wind_speed",
                    "Вітер, м/с",
                    "real",
                    "metric",
                    "average",
                    false,
                ),
                field("phenomenon", "Явище", "text", "status", "none", false),
            ],
        ),
        template(
            "cohort",
            "Когортна матриця",
            "Структура",
            "Матриця значень за когортою та періодом.",
            "cohort",
            2,
            vec![
                dimension("cohort", "Когорта"),
                field("period", "Період", "text", "dimension", "none", true),
                metric("value", "Значення"),
            ],
        ),
        template(
            "activity",
            "Стрічка активності",
            "Оперативність",
            "Останні події зі станом і числовим показником.",
            "activity",
            1,
            vec![
                field(
                    "occurred_at",
                    "Час події",
                    "datetime",
                    "dimension",
                    "none",
                    true,
                ),
                field("label", "Подія", "text", "label", "none", true),
                field("status", "Стан", "text", "status", "none", false),
                field("value", "Значення", "real", "metric", "sum", false),
            ],
        ),
        template(
            "waveform",
            "Двобічна гістограма",
            "Динаміка",
            "Позитивні й негативні значення відносно спільної осі.",
            "waveform",
            2,
            vec![
                field("occurred_at", "Час", "datetime", "dimension", "none", true),
                metric("positive_value", "Верхнє значення"),
                metric("negative_value", "Нижнє значення"),
                field("series", "Ряд", "text", "series", "none", false),
            ],
        ),
        // Чотири шаблони за референсами власника (2026-10-19): стовпчики з лінією плану,
        // накопичені стовпчики, приріст і втрати від спільного нуля, рейтинг зі зміною.
        template(
            "combo",
            "Стовпчики з лінією",
            "Порівняння",
            "Факт стовпчиками й план (або середнє) лінією на одній шкалі за періодами.",
            "combo",
            2,
            vec![
                field("period", "Період", "date", "dimension", "none", true),
                metric("value", "Значення (стовпчики)"),
                field(
                    "reference_value",
                    "Лінія (план)",
                    "real",
                    "metric",
                    "sum",
                    false,
                ),
            ],
        ),
        template(
            "stacked-columns",
            "Накопичені стовпчики",
            "Структура",
            "Склад кожної категорії за рядами: сегменти один на одному, разом — підсумок.",
            "stacked-columns",
            2,
            vec![
                dimension("category", "Категорія"),
                metric("value", "Значення"),
                field("series", "Ряд", "text", "series", "none", true),
            ],
        ),
        template(
            "diverging-bars",
            "Приріст і втрати",
            "Порівняння",
            "Додатні й від'ємні значення за категоріями від спільного нуля: що додало, що забрало.",
            "diverging-bars",
            2,
            vec![
                dimension("category", "Категорія"),
                metric("value", "Зміна"),
                field("note", "Примітка", "text", "note", "none", false),
            ],
        ),
        template(
            "leaderboard",
            "Рейтинг",
            "Показники",
            "Особи або підрозділи за показником: місце, значення та зміна за період.",
            "leaderboard",
            1,
            vec![
                field("label", "Назва", "text", "label", "none", true),
                field("group", "Підрозділ", "text", "dimension", "none", false),
                metric("value", "Значення"),
                field("delta", "Зміна, %", "real", "metric", "average", false),
            ],
        ),
    ]
}

fn valid_branch(branch: &str) -> bool {
    matches!(branch, "air" | "rocket" | "pvk" | "dshv")
}

fn valid_style(style: &str) -> bool {
    matches!(style, "standard" | "branch" | "heightwell")
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value.bytes().enumerate().all(|(index, byte)| {
            byte == b'_' || byte.is_ascii_lowercase() || (index > 0 && byte.is_ascii_digit())
        })
}

fn valid_storage_table(value: &str) -> bool {
    value.strip_prefix("dashboard_data_").is_some_and(|suffix| {
        suffix.len() == 24 && suffix.bytes().all(|byte| byte.is_ascii_hexdigit())
    })
}

fn quoted_identifier(value: &str) -> Result<String, DashboardModuleError> {
    if !valid_identifier(value) {
        return Err(DashboardModuleError::InvalidStoredSchema);
    }
    Ok(format!("\"{value}\""))
}

fn sql_type(data_type: &str) -> Result<&'static str, DashboardModuleError> {
    match data_type {
        "text" | "date" | "datetime" => Ok("TEXT"),
        "integer" | "boolean" => Ok("INTEGER"),
        "real" => Ok("REAL"),
        _ => Err(DashboardModuleError::InvalidStoredSchema),
    }
}

fn normalized_title(value: Option<&str>, fallback: &str) -> Result<String, DashboardModuleError> {
    let title = value.unwrap_or(fallback).trim();
    if title.is_empty() || title.chars().count() > 80 {
        return Err(DashboardModuleError::InvalidTitle);
    }
    Ok(title.to_owned())
}

fn generated_identity(
    profile_id: &str,
    branch: &str,
    template_id: &str,
    title: &str,
    created_at: &str,
) -> (String, String) {
    let digest = format!(
        "{:x}",
        Sha256::digest(
            format!("easywar-dashboard-module-v1\0{profile_id}\0{branch}\0{template_id}\0{title}\0{created_at}").as_bytes()
        )
    );
    let short = &digest[..24];
    (
        format!("dashboard-{short}"),
        format!("dashboard_data_{short}"),
    )
}

type StoredModuleRow = (
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
);

impl DashboardModuleStore {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn list(
        &self,
        profile_id: &str,
        branch: &str,
    ) -> Result<Vec<DashboardModule>, DashboardModuleError> {
        if !valid_branch(branch) {
            return Err(DashboardModuleError::InvalidBranch);
        }
        let rows = sqlx::query_as::<_, StoredModuleRow>(
            "SELECT id, branch, template_id, visual_kind, title, style, storage_table, created_at, updated_at
             FROM dashboard_modules
             WHERE profile_id = ? AND branch = ?
             ORDER BY created_at, id",
        )
        .bind(profile_id)
        .bind(branch)
        .fetch_all(&self.pool)
        .await?;

        let mut modules = Vec::with_capacity(rows.len());
        for row in rows {
            modules.push(self.materialize(row).await?);
        }
        Ok(modules)
    }

    pub async fn create(
        &self,
        profile_id: &str,
        branch: &str,
        template_id: &str,
        requested_title: Option<&str>,
        created_at: &str,
    ) -> Result<DashboardModule, DashboardModuleError> {
        self.create_with_rows(
            profile_id,
            branch,
            template_id,
            requested_title,
            Vec::new(),
            created_at,
        )
        .await
    }

    /// Створює модуль і, якщо є `rows` (дані, підтягнуті з таблиці користувача), одразу
    /// записує їх у його таблицю тією самою транзакцією: модуль з'являється з усіма
    /// рядками або не з'являється зовсім. Рядки перевіряються так само, як під час
    /// заміни рядків; службове поле `rowId` у нових рядках не приймається.
    pub async fn create_with_rows(
        &self,
        profile_id: &str,
        branch: &str,
        template_id: &str,
        requested_title: Option<&str>,
        rows: Vec<Map<String, Value>>,
        created_at: &str,
    ) -> Result<DashboardModule, DashboardModuleError> {
        self.create_with_import(
            profile_id,
            branch,
            template_id,
            requested_title,
            rows,
            Vec::new(),
            created_at,
        )
        .await
    }

    /// Як `create_with_rows`, але ще й з виправленнями з екрана «Перевірка»: вони
    /// записуються в `dashboard_module_corrections` тією самою транзакцією, кожне —
    /// до свого запису за його новим `row_id`. Виправлення, яке не відповідає
    /// записам (немає такого запису чи поля, значення порожнє, повтор), скасовує
    /// створення так само, як некоректний рядок.
    #[allow(clippy::too_many_arguments)]
    pub async fn create_with_import(
        &self,
        profile_id: &str,
        branch: &str,
        template_id: &str,
        requested_title: Option<&str>,
        rows: Vec<Map<String, Value>>,
        corrections: Vec<NewImportCorrection>,
        created_at: &str,
    ) -> Result<DashboardModule, DashboardModuleError> {
        self.create_styled(
            profile_id,
            branch,
            template_id,
            requested_title,
            None,
            rows,
            corrections,
            created_at,
        )
        .await
    }

    /// Як `create_with_import`, але зі стилем оформлення, обраним у вікні створення.
    /// `None` — звичайний стиль; невідома назва стилю скасовує створення.
    #[allow(clippy::too_many_arguments)]
    pub async fn create_styled(
        &self,
        profile_id: &str,
        branch: &str,
        template_id: &str,
        requested_title: Option<&str>,
        requested_style: Option<&str>,
        rows: Vec<Map<String, Value>>,
        corrections: Vec<NewImportCorrection>,
        created_at: &str,
    ) -> Result<DashboardModule, DashboardModuleError> {
        if !valid_branch(branch) {
            return Err(DashboardModuleError::InvalidBranch);
        }
        let style = requested_style.unwrap_or(DEFAULT_MODULE_STYLE);
        if !valid_style(style) {
            return Err(DashboardModuleError::InvalidStyle);
        }
        let selected = catalog()
            .into_iter()
            .find(|item| item.id == template_id)
            .ok_or(DashboardModuleError::UnknownTemplate)?;
        let title = normalized_title(requested_title, selected.title)?;
        let template_fields = selected
            .fields
            .iter()
            .enumerate()
            .map(|(position, item)| DashboardModuleField {
                key: item.key.to_owned(),
                label: item.label.to_owned(),
                data_type: item.data_type.to_owned(),
                role: item.role.to_owned(),
                aggregation: item.aggregation.to_owned(),
                required: item.required,
                position: position as i64,
            })
            .collect::<Vec<_>>();
        validate_new_rows(&template_fields, &rows)?;
        validate_corrections(&template_fields, &rows, &corrections)?;

        let count: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM dashboard_modules WHERE profile_id = ? AND branch = ?",
        )
        .bind(profile_id)
        .bind(branch)
        .fetch_one(&self.pool)
        .await?;
        if count >= MAX_MODULES_PER_BRANCH {
            return Err(DashboardModuleError::ModuleLimit);
        }

        let (id, storage_table) =
            generated_identity(profile_id, branch, selected.id, &title, created_at);
        let mut transaction = self.pool.begin().await?;
        sqlx::query(
            "INSERT INTO dashboard_modules
             (id, profile_id, branch, template_id, visual_kind, title, style, storage_table, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(profile_id)
        .bind(branch)
        .bind(selected.id)
        .bind(selected.visual_kind)
        .bind(&title)
        .bind(style)
        .bind(&storage_table)
        .bind(created_at)
        .bind(created_at)
        .execute(&mut *transaction)
        .await?;

        for (position, item) in selected.fields.iter().enumerate() {
            if !valid_identifier(item.key) {
                return Err(DashboardModuleError::InvalidStoredSchema);
            }
            sqlx::query(
                "INSERT INTO dashboard_module_fields
                 (module_id, field_key, label, data_type, field_role, aggregation, required, position)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&id)
            .bind(item.key)
            .bind(item.label)
            .bind(item.data_type)
            .bind(item.role)
            .bind(item.aggregation)
            .bind(item.required)
            .bind(position as i64)
            .execute(&mut *transaction)
            .await?;
        }

        create_data_table(&mut transaction, &storage_table, &selected.fields).await?;
        let row_ids = insert_rows(
            &mut transaction,
            &storage_table,
            &template_fields,
            &rows,
            created_at,
        )
        .await?;
        for correction in &corrections {
            sqlx::query(
                "INSERT INTO dashboard_module_corrections
                 (module_id, row_id, field_key, source_file, source_sheet, source_row, source_column,
                  raw_text, corrected_text, reason, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&id)
            .bind(row_ids[correction.row_index])
            .bind(&correction.field_key)
            .bind(&correction.source_file)
            .bind(&correction.source_sheet)
            .bind(correction.source_row)
            .bind(&correction.source_column)
            .bind(&correction.raw_text)
            .bind(correction.corrected_text.trim())
            .bind(&correction.reason)
            .bind(created_at)
            .execute(&mut *transaction)
            .await?;
        }
        transaction.commit().await?;
        self.get_for_profile(profile_id, &id).await
    }

    pub async fn get_data(
        &self,
        profile_id: &str,
        module_id: &str,
    ) -> Result<DashboardModuleData, DashboardModuleError> {
        let module = self.get_for_profile(profile_id, module_id).await?;
        let table = quoted_identifier(&module.storage_table)?;
        let mut columns = vec!["row_id".to_owned(), "created_at".to_owned()];
        columns.extend(module.fields.iter().map(|item| item.key.clone()));
        let select = columns
            .iter()
            .map(|column| quoted_identifier(column))
            .collect::<Result<Vec<_>, _>>()?
            .join(", ");
        let sql = format!(
            "SELECT {select} FROM {table} ORDER BY row_id LIMIT {}",
            MAX_ROWS_PER_READ + 1
        );
        let stored = sqlx::query(&sql).fetch_all(&self.pool).await?;
        let truncated = stored.len() as i64 > MAX_ROWS_PER_READ;
        let mut rows = Vec::with_capacity(stored.len().min(MAX_ROWS_PER_READ as usize));
        for row in stored.into_iter().take(MAX_ROWS_PER_READ as usize) {
            let mut item = BTreeMap::new();
            item.insert(
                "rowId".to_owned(),
                Value::Number(row.try_get::<i64, _>("row_id")?.into()),
            );
            item.insert(
                "createdAt".to_owned(),
                Value::String(row.try_get::<String, _>("created_at")?),
            );
            for field in &module.fields {
                let value = match field.data_type.as_str() {
                    "text" | "date" | "datetime" => row
                        .try_get::<Option<String>, _>(field.key.as_str())?
                        .map(Value::String)
                        .unwrap_or(Value::Null),
                    "integer" => row
                        .try_get::<Option<i64>, _>(field.key.as_str())?
                        .map(|value| Value::Number(value.into()))
                        .unwrap_or(Value::Null),
                    "real" => row
                        .try_get::<Option<f64>, _>(field.key.as_str())?
                        .and_then(Number::from_f64)
                        .map(Value::Number)
                        .unwrap_or(Value::Null),
                    "boolean" => row
                        .try_get::<Option<i64>, _>(field.key.as_str())?
                        .map(|value| Value::Bool(value != 0))
                        .unwrap_or(Value::Null),
                    _ => return Err(DashboardModuleError::InvalidStoredSchema),
                };
                item.insert(field.key.clone(), value);
            }
            rows.push(item);
        }
        let corrections = sqlx::query_as::<_, DashboardModuleCorrection>(
            "SELECT row_id, field_key, source_file, source_sheet, source_row, source_column,
                    raw_text, corrected_text, reason, created_at
             FROM dashboard_module_corrections
             WHERE module_id = ?
             ORDER BY row_id, id",
        )
        .bind(&module.id)
        .fetch_all(&self.pool)
        .await?;
        Ok(DashboardModuleData {
            module,
            rows,
            truncated,
            corrections,
        })
    }

    /// Замінює весь набір рядків модуля однією транзакцією. Рядок із полем
    /// `rowId` зберігає свій ідентифікатор і час створення; рядок без нього
    /// вважається новим, а рядки, яких немає у списку, видаляються (їхні
    /// ідентифікатори не використовуються повторно).
    ///
    /// `expected_updated_at` — позначка змін, яку клієнт отримав разом із
    /// таблицею. Якщо модуль уже змінено (наприклад, в іншому вікні), запис
    /// відхиляється з `Conflict` і нічого не змінює. Без позначки запис
    /// безумовний, як і раніше.
    pub async fn replace_rows(
        &self,
        profile_id: &str,
        module_id: &str,
        rows: Vec<Map<String, Value>>,
        expected_updated_at: Option<&str>,
        updated_at: &str,
    ) -> Result<DashboardModuleData, DashboardModuleError> {
        if rows.len() > MAX_ROWS_PER_WRITE {
            return Err(DashboardModuleError::TooManyRows);
        }
        let module = self.get_for_profile(profile_id, module_id).await?;
        let allowed = module
            .fields
            .iter()
            .map(|field| field.key.as_str())
            .collect::<BTreeSet<_>>();
        let mut requested_ids = BTreeSet::new();
        let mut row_ids = Vec::with_capacity(rows.len());
        for row in &rows {
            if let Some(key) = row
                .keys()
                .find(|key| key.as_str() != ROW_ID_KEY && !allowed.contains(key.as_str()))
            {
                return Err(DashboardModuleError::UnknownField(key.clone()));
            }
            let row_id = match row.get(ROW_ID_KEY).filter(|value| !value.is_null()) {
                None => None,
                Some(value) => {
                    let id = value
                        .as_i64()
                        .filter(|id| *id >= 1)
                        .ok_or(DashboardModuleError::InvalidRowId)?;
                    if !requested_ids.insert(id) {
                        return Err(DashboardModuleError::InvalidRowId);
                    }
                    Some(id)
                }
            };
            row_ids.push(row_id);
            for field in &module.fields {
                validate_value(field, row.get(&field.key))?;
            }
        }

        let table = quoted_identifier(&module.storage_table)?;
        let field_columns = module
            .fields
            .iter()
            .map(|field| quoted_identifier(&field.key))
            .collect::<Result<Vec<_>, _>>()?;
        let columns = std::iter::once("\"created_at\"".to_owned())
            .chain(field_columns)
            .collect::<Vec<_>>();
        let placeholders = vec!["?"; columns.len()].join(", ");
        let insert_new = format!(
            "INSERT INTO {table} ({}) VALUES ({placeholders})",
            columns.join(", ")
        );
        let insert_kept = format!(
            "INSERT INTO {table} (\"row_id\", {}) VALUES (?, {placeholders})",
            columns.join(", ")
        );

        let mut transaction = self.pool.begin().await?;
        // Перша операція транзакції — умовне оновлення позначки змін: воно
        // одночасно звіряє версію клієнта й бере блокування запису.
        let claimed = if let Some(expected) = expected_updated_at {
            sqlx::query(
                "UPDATE dashboard_modules SET updated_at = ?
                 WHERE id = ? AND profile_id = ? AND updated_at = ?",
            )
            .bind(updated_at)
            .bind(module_id)
            .bind(profile_id)
            .bind(expected)
            .execute(&mut *transaction)
            .await?
            .rows_affected()
        } else {
            sqlx::query(
                "UPDATE dashboard_modules SET updated_at = ?
                 WHERE id = ? AND profile_id = ?",
            )
            .bind(updated_at)
            .bind(module_id)
            .bind(profile_id)
            .execute(&mut *transaction)
            .await?
            .rows_affected()
        };
        if claimed != 1 {
            return Err(if expected_updated_at.is_some() {
                DashboardModuleError::Conflict
            } else {
                DashboardModuleError::ModuleNotFound
            });
        }
        let existing = sqlx::query(&format!("SELECT \"row_id\", \"created_at\" FROM {table}"))
            .fetch_all(&mut *transaction)
            .await?
            .into_iter()
            .map(|row| {
                Ok::<_, sqlx::Error>((
                    row.try_get::<i64, _>("row_id")?,
                    row.try_get::<String, _>("created_at")?,
                ))
            })
            .collect::<Result<BTreeMap<i64, String>, _>>()?;
        if requested_ids.iter().any(|id| !existing.contains_key(id)) {
            return Err(DashboardModuleError::Conflict);
        }
        sqlx::query(&format!("DELETE FROM {table}"))
            .execute(&mut *transaction)
            .await?;
        for (row, row_id) in rows.into_iter().zip(row_ids) {
            let mut query = match row_id {
                Some(id) => sqlx::query(&insert_kept)
                    .bind(id)
                    .bind(existing[&id].clone()),
                None => sqlx::query(&insert_new).bind(updated_at),
            };
            for field in &module.fields {
                query = bind_field(query, field, row.get(&field.key))?;
            }
            query.execute(&mut *transaction).await?;
        }
        // Видалений запис забирає свої виправлення: їм більше нема до чого належати.
        sqlx::query(&format!(
            "DELETE FROM dashboard_module_corrections
             WHERE module_id = ? AND row_id NOT IN (SELECT \"row_id\" FROM {table})"
        ))
        .bind(module_id)
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        self.get_data(profile_id, module_id).await
    }

    async fn get_for_profile(
        &self,
        profile_id: &str,
        module_id: &str,
    ) -> Result<DashboardModule, DashboardModuleError> {
        let row = sqlx::query_as::<_, StoredModuleRow>(
            "SELECT id, branch, template_id, visual_kind, title, style, storage_table, created_at, updated_at
             FROM dashboard_modules WHERE profile_id = ? AND id = ?",
        )
        .bind(profile_id)
        .bind(module_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(DashboardModuleError::ModuleNotFound)?;
        self.materialize(row).await
    }

    async fn materialize(
        &self,
        row: StoredModuleRow,
    ) -> Result<DashboardModule, DashboardModuleError> {
        self.synchronize_template_schema(&row).await?;
        let (
            id,
            branch,
            template_id,
            visual_kind,
            title,
            style,
            storage_table,
            created_at,
            updated_at,
        ) = row;
        if !valid_branch(&branch) || !valid_style(&style) || !valid_storage_table(&storage_table) {
            return Err(DashboardModuleError::InvalidStoredSchema);
        }
        let fields = sqlx::query_as::<_, (String, String, String, String, String, i64, i64)>(
            "SELECT field_key, label, data_type, field_role, aggregation, required, position
             FROM dashboard_module_fields WHERE module_id = ? ORDER BY position",
        )
        .bind(&id)
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(|field| DashboardModuleField {
            key: field.0,
            label: field.1,
            data_type: field.2,
            role: field.3,
            aggregation: field.4,
            required: field.5 != 0,
            position: field.6,
        })
        .collect::<Vec<_>>();
        if fields.is_empty() || fields.iter().any(|field| !valid_identifier(&field.key)) {
            return Err(DashboardModuleError::InvalidStoredSchema);
        }
        let table = quoted_identifier(&storage_table)?;
        let row_count = sqlx::query_scalar::<_, i64>(&format!("SELECT count(*) FROM {table}"))
            .fetch_one(&self.pool)
            .await?;
        let default_span = catalog()
            .into_iter()
            .find(|item| item.id == template_id)
            .map(|item| item.default_span)
            .unwrap_or(1);
        Ok(DashboardModule {
            id,
            branch,
            template_id,
            visual_kind,
            default_span,
            title,
            style,
            storage_table,
            fields,
            row_count,
            created_at,
            updated_at,
        })
    }

    /// Каталог може отримувати нові адитивні поля після того, як користувач уже
    /// створив модуль. Фізичну таблицю та опис полів розширюємо на місці,
    /// зберігаючи всі наявні рядки. Довільні назви в DDL не потрапляють.
    async fn synchronize_template_schema(
        &self,
        row: &StoredModuleRow,
    ) -> Result<(), DashboardModuleError> {
        let (module_id, _, template_id, _, _, _, storage_table, _, _) = row;
        let Some(template) = catalog().into_iter().find(|item| item.id == template_id) else {
            return Ok(());
        };
        let table = quoted_identifier(storage_table)?;
        let physical = sqlx::query(&format!("PRAGMA table_info({table})"))
            .fetch_all(&self.pool)
            .await?
            .into_iter()
            .map(|column| {
                Ok((
                    column.try_get::<String, _>("name")?,
                    column.try_get::<String, _>("type")?.to_ascii_uppercase(),
                ))
            })
            .collect::<Result<BTreeMap<_, _>, sqlx::Error>>()?;
        if physical.is_empty() {
            return Err(DashboardModuleError::InvalidStoredSchema);
        }
        for field in &template.fields {
            if let Some(stored_type) = physical.get(field.key) {
                if stored_type != sql_type(field.data_type)? {
                    return Err(DashboardModuleError::InvalidStoredSchema);
                }
            }
        }

        let stored_fields =
            sqlx::query_as::<_, (String, String, String, String, String, i64, i64)>(
                "SELECT field_key, label, data_type, field_role, aggregation, required, position
             FROM dashboard_module_fields WHERE module_id = ? ORDER BY position",
            )
            .bind(module_id)
            .fetch_all(&self.pool)
            .await?;
        let metadata_matches = stored_fields.len() == template.fields.len()
            && stored_fields.iter().zip(&template.fields).enumerate().all(
                |(position, (stored, expected))| {
                    stored.0 == expected.key
                        && stored.1 == expected.label
                        && stored.2 == expected.data_type
                        && stored.3 == expected.role
                        && stored.4 == expected.aggregation
                        && (stored.5 != 0) == expected.required
                        && stored.6 == position as i64
                },
            );
        let columns_match = template
            .fields
            .iter()
            .all(|field| physical.contains_key(field.key));
        if metadata_matches && columns_match {
            return Ok(());
        }

        let mut transaction = self.pool.begin().await?;
        for field in &template.fields {
            if !physical.contains_key(field.key) {
                let column = quoted_identifier(field.key)?;
                sqlx::query(&format!(
                    "ALTER TABLE {table} ADD COLUMN {column} {}",
                    sql_type(field.data_type)?
                ))
                .execute(&mut *transaction)
                .await?;
            }
        }
        sqlx::query("DELETE FROM dashboard_module_fields WHERE module_id = ?")
            .bind(module_id)
            .execute(&mut *transaction)
            .await?;
        for (position, field) in template.fields.iter().enumerate() {
            sqlx::query(
                "INSERT INTO dashboard_module_fields
                 (module_id, field_key, label, data_type, field_role, aggregation, required, position)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(module_id)
            .bind(field.key)
            .bind(field.label)
            .bind(field.data_type)
            .bind(field.role)
            .bind(field.aggregation)
            .bind(field.required)
            .bind(position as i64)
            .execute(&mut *transaction)
            .await?;
        }
        transaction.commit().await?;
        Ok(())
    }
}

/// Видаляє фізичні таблиці даних усіх модулів профілю. Викликається в тій
/// самій транзакції, що й видалення профілю: каскад прибирає лише метадані,
/// а самі таблиці `dashboard_data_<id>` інакше лишилися б у базі без власника.
/// Імена беруться з метаданих, але скидаються лише ті, що пройшли перевірку
/// шаблону; будь-яке інше ім'я в DDL не потрапляє.
pub(crate) async fn drop_profile_data_tables(
    transaction: &mut Transaction<'_, Sqlite>,
    profile_id: &str,
) -> Result<(), sqlx::Error> {
    let tables: Vec<String> =
        sqlx::query_scalar("SELECT storage_table FROM dashboard_modules WHERE profile_id = ?")
            .bind(profile_id)
            .fetch_all(&mut **transaction)
            .await?;
    for table in tables.iter().filter(|table| valid_storage_table(table)) {
        sqlx::query(&format!("DROP TABLE IF EXISTS \"{table}\""))
            .execute(&mut **transaction)
            .await?;
    }
    Ok(())
}

async fn create_data_table(
    transaction: &mut Transaction<'_, Sqlite>,
    storage_table: &str,
    fields: &[DashboardModuleFieldTemplate],
) -> Result<(), DashboardModuleError> {
    if !valid_storage_table(storage_table) {
        return Err(DashboardModuleError::InvalidStoredSchema);
    }
    let mut columns = vec![
        "\"row_id\" INTEGER PRIMARY KEY AUTOINCREMENT".to_owned(),
        "\"created_at\" TEXT NOT NULL".to_owned(),
    ];
    for field in fields {
        columns.push(format!(
            "{} {}{}",
            quoted_identifier(field.key)?,
            sql_type(field.data_type)?,
            if field.required { " NOT NULL" } else { "" }
        ));
    }
    let table = quoted_identifier(storage_table)?;
    sqlx::query(&format!("CREATE TABLE {table} ({})", columns.join(", ")))
        .execute(&mut **transaction)
        .await?;
    Ok(())
}

type SqliteQuery<'q> = sqlx::query::Query<'q, Sqlite, sqlx::sqlite::SqliteArguments<'q>>;

/// Підставляє значення поля в запит за типом колонки; порожнє значення стає `NULL`.
fn bind_field<'q>(
    query: SqliteQuery<'q>,
    field: &DashboardModuleField,
    value: Option<&Value>,
) -> Result<SqliteQuery<'q>, DashboardModuleError> {
    let value = value.filter(|value| !value.is_null());
    Ok(match field.data_type.as_str() {
        "text" | "date" | "datetime" => {
            query.bind(value.and_then(Value::as_str).map(ToOwned::to_owned))
        }
        "integer" => query.bind(value.and_then(Value::as_i64)),
        "real" => query.bind(value.and_then(Value::as_f64)),
        "boolean" => query.bind(value.and_then(Value::as_bool).map(i64::from)),
        _ => return Err(DashboardModuleError::InvalidStoredSchema),
    })
}

/// Перевірка нових рядків до початку транзакції: кількість, невідомі поля, типи й
/// обов'язкові поля. `rowId` у новому рядку не має сенсу, тому це невідоме поле.
fn validate_new_rows(
    fields: &[DashboardModuleField],
    rows: &[Map<String, Value>],
) -> Result<(), DashboardModuleError> {
    if rows.len() > MAX_ROWS_PER_WRITE {
        return Err(DashboardModuleError::TooManyRows);
    }
    let allowed = fields
        .iter()
        .map(|field| field.key.as_str())
        .collect::<BTreeSet<_>>();
    for row in rows {
        if let Some(key) = row.keys().find(|key| !allowed.contains(key.as_str())) {
            return Err(DashboardModuleError::UnknownField(key.clone()));
        }
        for field in fields {
            validate_value(field, row.get(&field.key))?;
        }
    }
    Ok(())
}

/// Дописує рядки в таблицю модуля в порядку надходження (їхні `row_id` зростають)
/// і повертає `row_id` кожного рядка в тому самому порядку.
async fn insert_rows(
    transaction: &mut Transaction<'_, Sqlite>,
    storage_table: &str,
    fields: &[DashboardModuleField],
    rows: &[Map<String, Value>],
    created_at: &str,
) -> Result<Vec<i64>, DashboardModuleError> {
    if rows.is_empty() {
        return Ok(Vec::new());
    }
    let table = quoted_identifier(storage_table)?;
    let columns = std::iter::once(Ok("\"created_at\"".to_owned()))
        .chain(fields.iter().map(|field| quoted_identifier(&field.key)))
        .collect::<Result<Vec<_>, DashboardModuleError>>()?;
    let sql = format!(
        "INSERT INTO {table} ({}) VALUES ({})",
        columns.join(", "),
        vec!["?"; columns.len()].join(", ")
    );
    let mut row_ids = Vec::with_capacity(rows.len());
    for row in rows {
        let mut query = sqlx::query(&sql).bind(created_at);
        for field in fields {
            query = bind_field(query, field, row.get(&field.key))?;
        }
        row_ids.push(query.execute(&mut **transaction).await?.last_insert_rowid());
    }
    Ok(row_ids)
}

/// Виправлення мають відповідати записам, які створюються: є такий запис і таке
/// поле, у записі є значення (саме його й виправлено), одне виправлення на поле
/// запису, тексти в межах. Сирий текст може бути порожнім (клітинка без значення).
fn validate_corrections(
    fields: &[DashboardModuleField],
    rows: &[Map<String, Value>],
    corrections: &[NewImportCorrection],
) -> Result<(), DashboardModuleError> {
    if corrections.len() > MAX_CORRECTIONS_PER_WRITE {
        return Err(DashboardModuleError::InvalidCorrection);
    }
    let known = fields
        .iter()
        .map(|field| field.key.as_str())
        .collect::<BTreeSet<_>>();
    let within = |text: &str, limit: usize| text.chars().count() <= limit;
    let mut seen = BTreeSet::new();
    for correction in corrections {
        let corrected = correction.corrected_text.trim();
        let valid = known.contains(correction.field_key.as_str())
            && rows
                .get(correction.row_index)
                .and_then(|row| row.get(&correction.field_key))
                .is_some_and(|value| !value.is_null())
            && correction.source_row >= 1
            && within(&correction.source_file, MAX_SOURCE_TEXT_LENGTH)
            && within(&correction.source_sheet, MAX_SOURCE_TEXT_LENGTH)
            && within(&correction.source_column, MAX_SOURCE_TEXT_LENGTH)
            && within(&correction.raw_text, MAX_TEXT_LENGTH)
            && !corrected.is_empty()
            && within(corrected, MAX_TEXT_LENGTH)
            && within(&correction.reason, MAX_REASON_LENGTH)
            && seen.insert((correction.row_index, correction.field_key.as_str()));
        if !valid {
            return Err(DashboardModuleError::InvalidCorrection);
        }
    }
    Ok(())
}

fn validate_value(
    field: &DashboardModuleField,
    value: Option<&Value>,
) -> Result<(), DashboardModuleError> {
    let absent = value.is_none_or(Value::is_null);
    if absent {
        return if field.required {
            Err(DashboardModuleError::RequiredField(field.label.clone()))
        } else {
            Ok(())
        };
    }
    let value = value.expect("checked above");
    let valid = match field.data_type.as_str() {
        "text" | "date" | "datetime" => value.as_str().is_some(),
        "integer" => value.as_i64().is_some(),
        "real" => value.as_f64().is_some_and(f64::is_finite),
        "boolean" => value.as_bool().is_some(),
        _ => return Err(DashboardModuleError::InvalidStoredSchema),
    };
    if !valid {
        return Err(DashboardModuleError::InvalidValue(
            field.label.clone(),
            field.data_type.clone(),
        ));
    }
    if let Some(text) = value.as_str() {
        if field.required && text.trim().is_empty() {
            return Err(DashboardModuleError::RequiredField(field.label.clone()));
        }
        if text.chars().count() > MAX_TEXT_LENGTH {
            return Err(DashboardModuleError::TextTooLong(field.label.clone()));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::{
        COMMAND_TABLES_SQL, DASHBOARD_MODULES_SQL, DASHBOARD_MODULE_CORRECTIONS_SQL,
        DASHBOARD_MODULE_STYLE_SQL, INITIAL_SCHEMA_SQL, LOCAL_PROFILES_SQL, OWN_LOSSES_TABLES_SQL,
        PROFILE_BRANCH_TABLES_SQL, PROFILE_DETAILS_SQL, PROFILE_MODULES_SQL,
        WORKSPACE_TEMPLATES_SQL, XLSX_DUPLICATE_LINKS_SQL,
    };
    use serde_json::json;
    use sqlx::sqlite::SqlitePoolOptions;
    use std::collections::BTreeSet;

    const FLIGHT_FIELD_KEYS: [&str; 35] = [
        "list_number",
        "aircraft_type",
        "aircraft_number",
        "crew_ke_callsign",
        "day_night",
        "flight_shift_number",
        "training_program_fuel",
        "combat_training_exercise_number",
        "complex_exercise_number_1",
        "complex_exercise_number_2",
        "flight_count",
        "engine_test_time",
        "takeoff_time",
        "landing_time",
        "airborne_hours",
        "total_hours",
        "flight_altitude",
        "combat_application_grade",
        "flight_grade",
        "cloud_base_upper",
        "cloud_base_lower",
        "cloud_cover",
        "visibility",
        "instrument_meteorological_conditions",
        "time_in_clouds",
        "hood_time",
        "fuel_consumption",
        "crew_ke",
        "crew_lsh",
        "crew_bt",
        "crew_other",
        "passengers",
        "cargo_kg",
        "rsp_approaches",
        "rsp_landings",
    ];

    async fn store() -> DashboardModuleStore {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        for migration in [
            INITIAL_SCHEMA_SQL,
            XLSX_DUPLICATE_LINKS_SQL,
            LOCAL_PROFILES_SQL,
            WORKSPACE_TEMPLATES_SQL,
            PROFILE_DETAILS_SQL,
            PROFILE_BRANCH_TABLES_SQL,
            COMMAND_TABLES_SQL,
            OWN_LOSSES_TABLES_SQL,
            PROFILE_MODULES_SQL,
            DASHBOARD_MODULES_SQL,
            DASHBOARD_MODULE_CORRECTIONS_SQL,
            DASHBOARD_MODULE_STYLE_SQL,
        ] {
            sqlx::raw_sql(migration).execute(&pool).await.unwrap();
        }
        sqlx::query(
            "INSERT INTO local_profiles (id, display_name, name_key, created_at, updated_at)
             VALUES ('profile-111111111111111111111111', 'Синтетичний', 'синтетичний', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();
        DashboardModuleStore::new(pool)
    }

    #[test]
    fn catalog_covers_reference_visualizations_and_flight_hours() {
        let items = catalog();
        assert_eq!(items.len(), 25);
        for kind in [
            "kpi",
            "line",
            "area",
            "columns",
            "horizontal-bar",
            "grouped-columns",
            "donut",
            "radial-progress",
            "multi-ring",
            "radar",
            "gauge",
            "progress-bars",
            "calendar",
            "table",
            "funnel",
            "map",
            "cohort",
            "activity",
            "waveform",
            "combo",
            "stacked-columns",
            "diverging-bars",
            "leaderboard",
            "weather",
        ] {
            assert!(
                items.iter().any(|item| item.visual_kind == kind),
                "missing {kind}"
            );
        }
        // Ідентифікатори й фізичні назви колонок унікальні в межах шаблону; підписи не повторюються.
        let mut ids = BTreeSet::new();
        for item in &items {
            assert!(ids.insert(item.id), "duplicate template id {}", item.id);
            let keys = item
                .fields
                .iter()
                .map(|field| field.key)
                .collect::<BTreeSet<_>>();
            assert_eq!(
                keys.len(),
                item.fields.len(),
                "{}: повторений ключ поля",
                item.id
            );
            let labels = item
                .fields
                .iter()
                .map(|field| field.label)
                .collect::<BTreeSet<_>>();
            assert_eq!(
                labels.len(),
                item.fields.len(),
                "{}: повторений підпис поля",
                item.id
            );
            assert!(
                item.fields.iter().all(|field| valid_identifier(field.key)),
                "{}: ключ не є ідентифікатором",
                item.id
            );
        }
        let flight = items.iter().find(|item| item.id == "flight-hours").unwrap();
        assert_eq!(flight.visual_kind, "horizontal-bar");
        assert_eq!(
            flight
                .fields
                .iter()
                .map(|field| field.key)
                .collect::<Vec<_>>(),
            FLIGHT_FIELD_KEYS
        );
    }

    #[test]
    fn weather_template_shares_the_flight_journal_weather_columns() {
        let items = catalog();
        let weather = items.iter().find(|item| item.id == "weather").unwrap();
        let flight = items.iter().find(|item| item.id == "flight-hours").unwrap();
        assert_eq!(weather.visual_kind, "weather");
        let required = weather
            .fields
            .iter()
            .filter(|field| field.required)
            .map(|field| field.key)
            .collect::<Vec<_>>();
        assert_eq!(
            required,
            [
                "observed_at",
                "label",
                "latitude",
                "longitude",
                "cloud_cover"
            ]
        );
        // Ті самі ключі, типи й підписи, що в журналі польотів: таблицю погоди розбирає той самий імпорт.
        for key in [
            "cloud_cover",
            "cloud_base_lower",
            "cloud_base_upper",
            "visibility",
        ] {
            let mine = weather
                .fields
                .iter()
                .find(|field| field.key == key)
                .unwrap();
            let theirs = flight.fields.iter().find(|field| field.key == key).unwrap();
            assert_eq!(
                (mine.data_type, mine.label),
                (theirs.data_type, theirs.label),
                "{key}"
            );
        }
    }

    #[tokio::test]
    async fn create_builds_a_physical_table_with_template_columns() {
        let store = store().await;
        let module = store
            .create(
                "profile-111111111111111111111111",
                "air",
                "flight-hours",
                None,
                "2026-01-01T00:00:01Z",
            )
            .await
            .unwrap();
        assert_eq!(module.title, "Журнал хронометражу польотів");
        assert_eq!(module.row_count, 0);
        assert!(valid_storage_table(&module.storage_table));

        let columns = sqlx::query(&format!("PRAGMA table_info({})", module.storage_table))
            .fetch_all(&store.pool)
            .await
            .unwrap()
            .into_iter()
            .map(|row| row.try_get::<String, _>("name").unwrap())
            .collect::<Vec<_>>();
        assert_eq!(&columns[..2], ["row_id", "created_at"]);
        assert_eq!(&columns[2..], FLIGHT_FIELD_KEYS);
    }

    #[tokio::test]
    async fn replace_rows_validates_schema_and_returns_local_data() {
        let store = store().await;
        let module = store
            .create(
                "profile-111111111111111111111111",
                "air",
                "flight-hours",
                Some("Наліт ПС"),
                "2026-01-01T00:00:01Z",
            )
            .await
            .unwrap();
        let rows = vec![json!({
            "list_number": 1,
            "aircraft_type": "F-16",
            "day_night": "День",
            "flight_count": 2,
            "takeoff_time": "08:10",
            "landing_time": "09:25",
            "airborne_hours": 18.5,
            "total_hours": 24.0,
            "cloud_base_upper": 1500.0,
            "cloud_base_lower": 800.0,
            "cloud_cover": 5,
            "visibility": 10.0,
            "instrument_meteorological_conditions": true,
            "fuel_consumption": 420.5,
            "crew_ke": "Тестенко",
            "crew_ke_callsign": "00123"
        })
        .as_object()
        .unwrap()
        .clone()];
        let data = store
            .replace_rows(
                "profile-111111111111111111111111",
                &module.id,
                rows,
                None,
                "2026-01-02T00:00:00Z",
            )
            .await
            .unwrap();
        assert_eq!(data.module.row_count, 1);
        assert_eq!(data.rows[0]["aircraft_type"], "F-16");
        assert_eq!(data.rows[0]["airborne_hours"], 18.5);
        assert_eq!(data.rows[0]["cloud_cover"], 5);
        assert_eq!(data.rows[0]["instrument_meteorological_conditions"], true);
        // Позивний — текст: нулі на початку не зникають, як було б у числовій колонці.
        assert_eq!(data.rows[0]["crew_ke"], "Тестенко");
        assert_eq!(data.rows[0]["crew_ke_callsign"], "00123");

        let invalid = vec![json!({
            "aircraft_type": "F-16",
            "airborne_hours": "не число",
            "total_hours": 24
        })
        .as_object()
        .unwrap()
        .clone()];
        assert!(matches!(
            store
                .replace_rows(
                    "profile-111111111111111111111111",
                    &module.id,
                    invalid,
                    None,
                    "2026-01-03T00:00:00Z"
                )
                .await,
            Err(DashboardModuleError::InvalidValue(_, _))
        ));
        assert_eq!(
            store
                .get_data("profile-111111111111111111111111", &module.id)
                .await
                .unwrap()
                .rows
                .len(),
            1
        );
    }

    fn seed(value: serde_json::Value) -> Map<String, Value> {
        value.as_object().unwrap().clone()
    }

    async fn module_count(store: &DashboardModuleStore) -> i64 {
        sqlx::query_scalar("SELECT count(*) FROM dashboard_modules")
            .fetch_one(&store.pool)
            .await
            .unwrap()
    }

    async fn data_table_count(store: &DashboardModuleStore) -> i64 {
        sqlx::query_scalar(
            "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name LIKE 'dashboard_data_%'",
        )
        .fetch_one(&store.pool)
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn create_with_rows_seeds_the_new_table_in_source_order() {
        let store = store().await;
        let rows = vec![
            seed(json!({
                "list_number": 1,
                "aircraft_type": "Тестовий-1",
                "airborne_hours": 0.5,
                "total_hours": 0.75,
                "crew_ke": "Тестенко"
            })),
            seed(json!({
                "list_number": 2,
                "aircraft_type": "Тестовий-2",
                "airborne_hours": 1.0,
                "total_hours": 1.25,
                "instrument_meteorological_conditions": false
            })),
        ];

        let module = store
            .create_with_rows(
                "profile-111111111111111111111111",
                "air",
                "flight-hours",
                None,
                rows,
                "2026-01-01T00:00:01Z",
            )
            .await
            .unwrap();

        assert_eq!(module.row_count, 2);
        assert_eq!(module.created_at, module.updated_at);
        let data = store
            .get_data("profile-111111111111111111111111", &module.id)
            .await
            .unwrap();
        assert_eq!(data.rows.len(), 2);
        assert_eq!(data.rows[0]["aircraft_type"], "Тестовий-1");
        assert_eq!(data.rows[0]["crew_ke"], "Тестенко");
        assert_eq!(data.rows[0]["createdAt"], "2026-01-01T00:00:01Z");
        assert_eq!(data.rows[1]["aircraft_type"], "Тестовий-2");
        assert_eq!(data.rows[1]["instrument_meteorological_conditions"], false);
        // Поля, яких немає в таблиці користувача, лишаються порожніми колонками модуля.
        assert_eq!(data.rows[0]["crew_lsh"], Value::Null);
        assert!(data.rows[0]["rowId"].as_i64() < data.rows[1]["rowId"].as_i64());
    }

    #[tokio::test]
    async fn create_styled_keeps_the_chosen_style_and_defaults_to_standard() {
        let store = store().await;
        let profile = "profile-111111111111111111111111";
        let plain = store
            .create(profile, "air", "flight-hours", None, "2026-01-01T00:00:01Z")
            .await
            .unwrap();
        assert_eq!(plain.style, DEFAULT_MODULE_STYLE);
        for (index, style) in ["branch", "heightwell"].into_iter().enumerate() {
            let created = store
                .create_styled(
                    profile,
                    "rocket",
                    "flight-hours",
                    Some(&format!("Журнал {index}")),
                    Some(style),
                    Vec::new(),
                    Vec::new(),
                    &format!("2026-01-01T00:00:0{}Z", index + 2),
                )
                .await
                .unwrap();
            assert_eq!(created.style, style);
        }
        let listed = store
            .list(profile, "rocket")
            .await
            .unwrap()
            .into_iter()
            .map(|module| module.style)
            .collect::<Vec<_>>();
        assert_eq!(listed, ["branch", "heightwell"]);
    }

    #[tokio::test]
    async fn create_styled_rejects_an_unknown_style_without_creating_anything() {
        let store = store().await;
        for style in ["", "neon", "Heightwell", "standard; DROP TABLE x"] {
            let error = store
                .create_styled(
                    "profile-111111111111111111111111",
                    "air",
                    "flight-hours",
                    None,
                    Some(style),
                    Vec::new(),
                    Vec::new(),
                    "2026-01-01T00:00:01Z",
                )
                .await
                .unwrap_err();
            assert!(
                matches!(error, DashboardModuleError::InvalidStyle),
                "{style}"
            );
        }
        assert_eq!(module_count(&store).await, 0);
    }

    #[tokio::test]
    async fn create_with_rows_without_rows_equals_create() {
        let store = store().await;
        let module = store
            .create_with_rows(
                "profile-111111111111111111111111",
                "air",
                "flight-hours",
                None,
                Vec::new(),
                "2026-01-01T00:00:01Z",
            )
            .await
            .unwrap();
        assert_eq!(module.row_count, 0);
        assert_eq!(module_count(&store).await, 1);
    }

    #[tokio::test]
    async fn a_bad_seed_row_leaves_no_module_and_no_table_behind() {
        let store = store().await;
        let good = seed(json!({
            "aircraft_type": "Тестовий",
            "airborne_hours": 0.5,
            "total_hours": 0.75
        }));
        let cases = vec![
            (
                "тип значення",
                seed(
                    json!({"aircraft_type": "Тестовий", "airborne_hours": "півгодини", "total_hours": 1}),
                ),
            ),
            (
                "обов'язкове поле",
                seed(json!({"aircraft_type": "Тестовий", "airborne_hours": 0.5})),
            ),
            (
                "невідоме поле",
                seed(
                    json!({"aircraft_type": "Тестовий", "airborne_hours": 0.5, "total_hours": 1, "secret": 1}),
                ),
            ),
            (
                "службовий rowId",
                seed(
                    json!({"rowId": 1, "aircraft_type": "Тестовий", "airborne_hours": 0.5, "total_hours": 1}),
                ),
            ),
        ];
        for (name, bad) in cases {
            let result = store
                .create_with_rows(
                    "profile-111111111111111111111111",
                    "air",
                    "flight-hours",
                    None,
                    vec![good.clone(), bad],
                    "2026-01-01T00:00:01Z",
                )
                .await;
            assert!(result.is_err(), "{name}: рядок мав бути відхилений");
            assert_eq!(module_count(&store).await, 0, "{name}: модуль створено");
            assert_eq!(
                data_table_count(&store).await,
                0,
                "{name}: лишилась таблиця"
            );
        }
    }

    #[tokio::test]
    async fn seeding_more_than_the_write_limit_is_rejected_before_anything_is_created() {
        let store = store().await;
        let row = seed(json!({
            "aircraft_type": "Тестовий",
            "airborne_hours": 0.5,
            "total_hours": 0.75
        }));
        let result = store
            .create_with_rows(
                "profile-111111111111111111111111",
                "air",
                "flight-hours",
                None,
                vec![row; MAX_ROWS_PER_WRITE + 1],
                "2026-01-01T00:00:01Z",
            )
            .await;
        assert!(matches!(result, Err(DashboardModuleError::TooManyRows)));
        assert_eq!(module_count(&store).await, 0);
        assert_eq!(data_table_count(&store).await, 0);
    }

    #[tokio::test]
    async fn legacy_flight_module_is_extended_without_losing_rows() {
        let store = store().await;
        let module_id = "dashboard-legacy-flight";
        let table = "dashboard_data_aaaaaaaaaaaaaaaaaaaaaaaa";
        sqlx::query(
            "INSERT INTO dashboard_modules
             (id, profile_id, branch, template_id, visual_kind, title, storage_table, created_at, updated_at)
             VALUES (?, 'profile-111111111111111111111111', 'air', 'flight-hours', 'horizontal-bar',
                     'Старий наліт', ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        )
        .bind(module_id)
        .bind(table)
        .execute(&store.pool)
        .await
        .unwrap();
        for (position, (key, label, data_type, role, aggregation)) in [
            ("aircraft_type", "Тип ПС", "text", "dimension", "none"),
            ("airborne_hours", "Наліт (повітря)", "real", "metric", "sum"),
            ("total_hours", "Наліт (загальний)", "real", "metric", "sum"),
        ]
        .into_iter()
        .enumerate()
        {
            sqlx::query(
                "INSERT INTO dashboard_module_fields
                 (module_id, field_key, label, data_type, field_role, aggregation, required, position)
                 VALUES (?, ?, ?, ?, ?, ?, 1, ?)",
            )
            .bind(module_id)
            .bind(key)
            .bind(label)
            .bind(data_type)
            .bind(role)
            .bind(aggregation)
            .bind(position as i64)
            .execute(&store.pool)
            .await
            .unwrap();
        }
        sqlx::query(&format!(
            "CREATE TABLE {table} (
                row_id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                aircraft_type TEXT NOT NULL,
                airborne_hours REAL NOT NULL,
                total_hours REAL NOT NULL
             )"
        ))
        .execute(&store.pool)
        .await
        .unwrap();
        sqlx::query(&format!(
            "INSERT INTO {table} (created_at, aircraft_type, airborne_hours, total_hours)
             VALUES ('2026-01-01T00:00:00Z', 'МіГ-29', 1.5, 2.0)"
        ))
        .execute(&store.pool)
        .await
        .unwrap();

        let data = store
            .get_data("profile-111111111111111111111111", module_id)
            .await
            .unwrap();

        assert_eq!(data.module.fields.len(), FLIGHT_FIELD_KEYS.len());
        assert_eq!(
            data.module
                .fields
                .iter()
                .map(|field| field.key.as_str())
                .collect::<Vec<_>>(),
            FLIGHT_FIELD_KEYS
        );
        assert_eq!(data.rows.len(), 1);
        assert_eq!(data.rows[0]["aircraft_type"], "МіГ-29");
        assert_eq!(data.rows[0]["airborne_hours"], 1.5);
        assert_eq!(data.rows[0]["cloud_cover"], Value::Null);
        assert_eq!(data.rows[0]["crew_ke"], Value::Null);
        assert_eq!(data.rows[0]["crew_ke_callsign"], Value::Null);
        assert_eq!(data.rows[0]["aircraft_number"], Value::Null);
        assert_eq!(data.rows[0]["rsp_landings"], Value::Null);
        // Старі підписи без одиниць замінюються підписами з одиницями вимірювання,
        // а збережені значення (десяткові години) лишаються без змін.
        let labels = data
            .module
            .fields
            .iter()
            .map(|field| (field.key.as_str(), field.label.as_str()))
            .collect::<BTreeMap<_, _>>();
        for (key, label) in [
            ("airborne_hours", "Наліт (повітря), год:хв"),
            ("total_hours", "Наліт (загальний), год:хв"),
            ("flight_altitude", "Висота польоту, м"),
            ("visibility", "Видимість, км"),
            ("cloud_base_upper", "Верхня межа хмар (ВМХ), м"),
            ("cloud_base_lower", "Нижня межа хмар (НМХ), м"),
            ("cloud_cover", "Хмарність, 0–10"),
            ("time_in_clouds", "Час у хмарах, год:хв"),
            ("hood_time", "Час під шторкою, год:хв"),
            ("fuel_consumption", "Витрата палива, л"),
            ("crew_ke", "Екіпаж: КЕ"),
            ("crew_lsh", "Екіпаж: ЛШ"),
            ("crew_bt", "Екіпаж: БТ"),
            ("crew_other", "Екіпаж: інші (до 5)"),
            ("aircraft_number", "Номер ПС"),
            ("crew_ke_callsign", "Позивний командира екіпажу"),
            ("engine_test_time", "Запуск, проба, год:хв"),
            ("passengers", "Пасажири"),
            ("cargo_kg", "Вантаж, кг"),
            ("rsp_approaches", "Заходів РСП"),
            ("rsp_landings", "Посадок РСП"),
        ] {
            assert_eq!(labels[key], label, "підпис поля {key}");
        }
        let columns = sqlx::query(&format!("PRAGMA table_info({table})"))
            .fetch_all(&store.pool)
            .await
            .unwrap()
            .into_iter()
            .map(|row| row.try_get::<String, _>("name").unwrap())
            .collect::<Vec<_>>();
        assert_eq!(&columns[..2], ["row_id", "created_at"]);
        assert_eq!(
            columns[2..]
                .iter()
                .map(String::as_str)
                .collect::<BTreeSet<_>>(),
            FLIGHT_FIELD_KEYS.into_iter().collect::<BTreeSet<_>>()
        );
    }

    #[tokio::test]
    async fn legacy_table_module_gets_the_progress_column_in_its_place() {
        let store = store().await;
        let module_id = "dashboard-legacy-table";
        let table = "dashboard_data_bbbbbbbbbbbbbbbbbbbbbbbb";
        sqlx::query(
            "INSERT INTO dashboard_modules
             (id, profile_id, branch, template_id, visual_kind, title, storage_table, created_at, updated_at)
             VALUES (?, 'profile-111111111111111111111111', 'air', 'table', 'table',
                     'Стара таблиця', ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        )
        .bind(module_id)
        .bind(table)
        .execute(&store.pool)
        .await
        .unwrap();
        for (position, (key, label, data_type, role, aggregation, required)) in [
            ("label", "Назва", "text", "label", "none", 1),
            ("value", "Значення", "real", "metric", "sum", 1),
            ("status", "Стан", "text", "status", "none", 0),
            ("note", "Примітка", "text", "note", "none", 0),
        ]
        .into_iter()
        .enumerate()
        {
            sqlx::query(
                "INSERT INTO dashboard_module_fields
                 (module_id, field_key, label, data_type, field_role, aggregation, required, position)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(module_id)
            .bind(key)
            .bind(label)
            .bind(data_type)
            .bind(role)
            .bind(aggregation)
            .bind(required)
            .bind(position as i64)
            .execute(&store.pool)
            .await
            .unwrap();
        }
        sqlx::query(&format!(
            "CREATE TABLE {table} (
                row_id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                label TEXT NOT NULL,
                value REAL NOT NULL,
                status TEXT,
                note TEXT
             )"
        ))
        .execute(&store.pool)
        .await
        .unwrap();
        sqlx::query(&format!(
            "INSERT INTO {table} (created_at, label, value, status, note)
             VALUES ('2026-01-01T00:00:00Z', 'Тестовий', 3.0, 'Готово', 'x')"
        ))
        .execute(&store.pool)
        .await
        .unwrap();

        let data = store
            .get_data("profile-111111111111111111111111", module_id)
            .await
            .unwrap();
        assert_eq!(
            data.module
                .fields
                .iter()
                .map(|field| field.key.as_str())
                .collect::<Vec<_>>(),
            ["label", "value", "progress", "status", "note"],
            "нове поле стає на своє місце в шаблоні, а не в кінець"
        );
        assert_eq!(data.rows.len(), 1);
        assert_eq!(data.rows[0]["label"], "Тестовий");
        assert_eq!(data.rows[0]["progress"], Value::Null);
        assert_eq!(data.rows[0]["note"], "x");
    }

    #[tokio::test]
    async fn modules_are_isolated_by_profile_and_branch() {
        let store = store().await;
        let module = store
            .create(
                "profile-111111111111111111111111",
                "air",
                "kpi",
                None,
                "2026-01-01T00:00:01Z",
            )
            .await
            .unwrap();
        assert_eq!(
            store
                .list("profile-111111111111111111111111", "air")
                .await
                .unwrap()
                .len(),
            1
        );
        assert!(store
            .list("profile-111111111111111111111111", "rocket")
            .await
            .unwrap()
            .is_empty());
        assert!(matches!(
            store
                .get_data("profile-222222222222222222222222", &module.id)
                .await,
            Err(DashboardModuleError::ModuleNotFound)
        ));
    }

    const PROFILE: &str = "profile-111111111111111111111111";
    const T2: &str = "2026-01-02T00:00:00Z";
    const T3: &str = "2026-01-03T00:00:00Z";
    const T4: &str = "2026-01-04T00:00:00Z";

    fn row(value: Value) -> Map<String, Value> {
        value.as_object().expect("a JSON object").clone()
    }

    fn flight(aircraft: &str, airborne: f64, total: f64) -> Value {
        json!({ "aircraft_type": aircraft, "airborne_hours": airborne, "total_hours": total })
    }

    fn with_row_id(mut value: Value, row_id: Value) -> Value {
        value["rowId"] = row_id;
        value
    }

    async fn flight_module(store: &DashboardModuleStore) -> DashboardModule {
        store
            .create(PROFILE, "air", "flight-hours", None, "2026-01-01T00:00:01Z")
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn saved_rows_keep_their_identity_and_creation_time() {
        let store = store().await;
        let module = flight_module(&store).await;
        let first = store
            .replace_rows(
                PROFILE,
                &module.id,
                vec![
                    row(flight("F-16", 1.0, 2.0)),
                    row(flight("МіГ-29", 3.0, 4.0)),
                ],
                None,
                T2,
            )
            .await
            .unwrap();
        let a = first.rows[0]["rowId"].as_i64().unwrap();
        let b = first.rows[1]["rowId"].as_i64().unwrap();
        assert!(a < b);
        assert_eq!(first.rows[0]["createdAt"], T2);

        let second = store
            .replace_rows(
                PROFILE,
                &module.id,
                vec![
                    row(with_row_id(flight("F-16", 1.5, 2.0), json!(a))),
                    row(with_row_id(flight("МіГ-29", 3.0, 4.0), json!(b))),
                    row(flight("Су-27", 5.0, 6.0)),
                ],
                None,
                T3,
            )
            .await
            .unwrap();
        assert_eq!(second.rows.len(), 3);
        assert_eq!(second.rows[0]["rowId"], a);
        assert_eq!(second.rows[0]["airborne_hours"], 1.5);
        assert_eq!(second.rows[0]["createdAt"], T2);
        assert_eq!(second.rows[1]["rowId"], b);
        assert_eq!(second.rows[1]["createdAt"], T2);
        assert!(second.rows[2]["rowId"].as_i64().unwrap() > b);
        assert_eq!(second.rows[2]["createdAt"], T3);
        assert_eq!(second.module.updated_at, T3);
    }

    #[tokio::test]
    async fn a_removed_row_never_gets_its_id_back() {
        let store = store().await;
        let module = flight_module(&store).await;
        let first = store
            .replace_rows(
                PROFILE,
                &module.id,
                vec![
                    row(flight("F-16", 1.0, 2.0)),
                    row(flight("МіГ-29", 3.0, 4.0)),
                ],
                None,
                T2,
            )
            .await
            .unwrap();
        let a = first.rows[0]["rowId"].as_i64().unwrap();
        let b = first.rows[1]["rowId"].as_i64().unwrap();

        let keep = with_row_id(flight("F-16", 1.0, 2.0), json!(a));
        let after_delete = store
            .replace_rows(PROFILE, &module.id, vec![row(keep.clone())], None, T3)
            .await
            .unwrap();
        assert_eq!(after_delete.rows.len(), 1);
        assert_eq!(after_delete.module.row_count, 1);

        let with_new = store
            .replace_rows(
                PROFILE,
                &module.id,
                vec![row(keep), row(flight("Су-27", 5.0, 6.0))],
                None,
                T4,
            )
            .await
            .unwrap();
        assert!(
            with_new.rows[1]["rowId"].as_i64().unwrap() > b,
            "the id of a deleted row must not be reused"
        );
    }

    #[tokio::test]
    async fn a_stale_version_is_rejected_and_changes_nothing() {
        let store = store().await;
        let module = flight_module(&store).await;
        let opened = module.updated_at.clone();
        let saved = store
            .replace_rows(
                PROFILE,
                &module.id,
                vec![row(flight("F-16", 1.0, 2.0))],
                Some(&opened),
                T2,
            )
            .await
            .unwrap();
        assert_eq!(saved.module.updated_at, T2);

        // Друге вікно ще тримає позначку, отриману до цього запису.
        let stale = store
            .replace_rows(
                PROFILE,
                &module.id,
                vec![row(flight("МіГ-29", 9.0, 9.0))],
                Some(&opened),
                T3,
            )
            .await;
        assert!(matches!(stale, Err(DashboardModuleError::Conflict)));
        let current = store.get_data(PROFILE, &module.id).await.unwrap();
        assert_eq!(current.rows.len(), 1);
        assert_eq!(current.rows[0]["aircraft_type"], "F-16");
        assert_eq!(current.module.updated_at, T2);

        // Актуальна позначка проходить; запис без позначки лишається безумовним.
        store
            .replace_rows(
                PROFILE,
                &module.id,
                vec![row(flight("Су-27", 5.0, 6.0))],
                Some(T2),
                T3,
            )
            .await
            .unwrap();
        store
            .replace_rows(PROFILE, &module.id, vec![], None, T4)
            .await
            .unwrap();
        assert!(store
            .get_data(PROFILE, &module.id)
            .await
            .unwrap()
            .rows
            .is_empty());
    }

    #[tokio::test]
    async fn unknown_or_malformed_row_ids_are_rejected_without_changes() {
        let store = store().await;
        let module = flight_module(&store).await;
        let saved = store
            .replace_rows(
                PROFILE,
                &module.id,
                vec![row(flight("F-16", 1.0, 2.0))],
                None,
                T2,
            )
            .await
            .unwrap();
        let id = saved.rows[0]["rowId"].as_i64().unwrap();

        // Такого запису в таблиці немає: клієнт тримає застарілий стан.
        assert!(matches!(
            store
                .replace_rows(
                    PROFILE,
                    &module.id,
                    vec![row(with_row_id(flight("F-16", 1.0, 2.0), json!(id + 100)))],
                    None,
                    T3
                )
                .await,
            Err(DashboardModuleError::Conflict)
        ));
        for bad in [json!(0), json!(-1), json!("1"), json!(1.5), json!(true)] {
            assert!(matches!(
                store
                    .replace_rows(
                        PROFILE,
                        &module.id,
                        vec![row(with_row_id(flight("F-16", 1.0, 2.0), bad))],
                        None,
                        T3
                    )
                    .await,
                Err(DashboardModuleError::InvalidRowId)
            ));
        }
        assert!(matches!(
            store
                .replace_rows(
                    PROFILE,
                    &module.id,
                    vec![
                        row(with_row_id(flight("F-16", 1.0, 2.0), json!(id))),
                        row(with_row_id(flight("F-16", 1.0, 2.0), json!(id)))
                    ],
                    None,
                    T3
                )
                .await,
            Err(DashboardModuleError::InvalidRowId)
        ));

        let current = store.get_data(PROFILE, &module.id).await.unwrap();
        assert_eq!(current.rows.len(), 1);
        assert_eq!(current.module.updated_at, T2);
    }

    #[tokio::test]
    async fn deleting_a_profile_drops_only_its_module_tables() {
        use crate::local_profiles::LocalProfileStore;

        let store = store().await;
        const OTHER: &str = "profile-222222222222222222222222";
        sqlx::query(
            "INSERT INTO local_profiles (id, display_name, name_key, created_at, updated_at)
             VALUES (?, 'Інший', 'інший', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        )
        .bind(OTHER)
        .execute(&store.pool)
        .await
        .unwrap();
        let mine = flight_module(&store).await;
        let theirs = store
            .create(OTHER, "air", "flight-hours", None, "2026-01-01T00:00:02Z")
            .await
            .unwrap();
        store
            .replace_rows(
                PROFILE,
                &mine.id,
                vec![row(flight("МіГ-29", 3.0, 4.0))],
                None,
                T2,
            )
            .await
            .unwrap();
        store
            .replace_rows(
                OTHER,
                &theirs.id,
                vec![row(flight("F-16", 1.0, 2.0))],
                None,
                T2,
            )
            .await
            .unwrap();

        LocalProfileStore::new(store.pool.clone())
            .delete(PROFILE, T3)
            .await
            .unwrap();

        let tables: Vec<String> = sqlx::query_scalar(
            "SELECT name FROM sqlite_master
             WHERE type = 'table' AND name LIKE 'dashboard_data_%' ORDER BY name",
        )
        .fetch_all(&store.pool)
        .await
        .unwrap();
        assert_eq!(tables, std::slice::from_ref(&theirs.storage_table));
        let modules: i64 = sqlx::query_scalar("SELECT count(*) FROM dashboard_modules")
            .fetch_one(&store.pool)
            .await
            .unwrap();
        assert_eq!(modules, 1);
        assert!(store.list(PROFILE, "air").await.unwrap().is_empty());
        assert_eq!(
            store.get_data(OTHER, &theirs.id).await.unwrap().rows.len(),
            1
        );
    }

    #[tokio::test]
    async fn profile_deletion_never_drops_a_table_that_was_not_generated() {
        use crate::local_profiles::LocalProfileStore;

        let store = store().await;
        sqlx::query("CREATE TABLE keep_this_table_untouched_1 (value INTEGER)")
            .execute(&store.pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO dashboard_modules
             (id, profile_id, branch, template_id, visual_kind, title, storage_table, created_at, updated_at)
             VALUES ('dashboard-foreign', ?, 'air', 'kpi', 'kpi', 'Чужа', 'keep_this_table_untouched_1',
                     '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        )
        .bind(PROFILE)
        .execute(&store.pool)
        .await
        .unwrap();

        LocalProfileStore::new(store.pool.clone())
            .delete(PROFILE, T3)
            .await
            .unwrap();

        let left: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM sqlite_master WHERE name = 'keep_this_table_untouched_1'",
        )
        .fetch_one(&store.pool)
        .await
        .unwrap();
        assert_eq!(left, 1);
    }

    /// Виправлення з екрана «Перевірка»: синтетичні клітинки «25:00» → «14:25».
    fn correction(
        row_index: usize,
        field_key: &str,
        raw: &str,
        corrected: &str,
    ) -> NewImportCorrection {
        NewImportCorrection {
            row_index,
            field_key: field_key.to_owned(),
            source_file: "Журнал_синтетичний.xlsx".to_owned(),
            source_sheet: "Журнал".to_owned(),
            source_row: 8 + row_index as i64,
            source_column: "Зліт".to_owned(),
            raw_text: raw.to_owned(),
            corrected_text: corrected.to_owned(),
            reason: "очікується час доби, наприклад 14:25".to_owned(),
        }
    }

    fn imported_rows() -> Vec<Map<String, Value>> {
        vec![
            row(
                json!({"aircraft_type": "Тестовий-1", "airborne_hours": 0.5, "total_hours": 0.75, "takeoff_time": "14:25"}),
            ),
            row(
                json!({"aircraft_type": "Тестовий-2", "airborne_hours": 1.0, "total_hours": 1.25, "flight_altitude": 300.0}),
            ),
        ]
    }

    #[tokio::test]
    async fn corrections_are_stored_apart_from_the_records_and_point_to_their_rows() {
        let store = store().await;
        let module = store
            .create_with_import(
                PROFILE,
                "air",
                "flight-hours",
                None,
                imported_rows(),
                vec![
                    correction(0, "takeoff_time", "25:00", "14:25"),
                    correction(1, "flight_altitude", "0,3", "  300 м  "),
                ],
                "2026-01-01T00:00:01Z",
            )
            .await
            .unwrap();
        let data = store.get_data(PROFILE, &module.id).await.unwrap();
        // Запис містить виправлене значення, а сире й введене — лише в таблиці виправлень.
        assert_eq!(data.rows[0]["takeoff_time"], "14:25");
        assert_eq!(data.rows[1]["flight_altitude"], 300.0);
        assert_eq!(data.corrections.len(), 2);
        let first = &data.corrections[0];
        assert_eq!(first.row_id, data.rows[0]["rowId"].as_i64().unwrap());
        assert_eq!(
            (
                first.field_key.as_str(),
                first.raw_text.as_str(),
                first.corrected_text.as_str()
            ),
            ("takeoff_time", "25:00", "14:25")
        );
        assert_eq!(
            (
                first.source_file.as_str(),
                first.source_sheet.as_str(),
                first.source_row,
                first.source_column.as_str()
            ),
            ("Журнал_синтетичний.xlsx", "Журнал", 8, "Зліт")
        );
        assert_eq!(first.created_at, "2026-01-01T00:00:01Z");
        assert_eq!(
            data.corrections[1].row_id,
            data.rows[1]["rowId"].as_i64().unwrap()
        );
        assert_eq!(
            data.corrections[1].corrected_text, "300 м",
            "введений текст зберігається без крайніх пробілів"
        );
        // У таблиці даних модуля немає жодної службової колонки для виправлень.
        let columns = sqlx::query(&format!(
            "SELECT name FROM pragma_table_info('{}')",
            module.storage_table
        ))
        .fetch_all(&store.pool)
        .await
        .unwrap()
        .into_iter()
        .map(|row| row.get::<String, _>("name"))
        .collect::<Vec<_>>();
        assert_eq!(columns.len(), 2 + FLIGHT_FIELD_KEYS.len());
        assert!(columns
            .iter()
            .all(|name| !name.contains("correct") && !name.contains("raw")));

        let other = store
            .create(PROFILE, "air", "kpi", None, "2026-01-01T00:00:02Z")
            .await
            .unwrap();
        assert!(store
            .get_data(PROFILE, &other.id)
            .await
            .unwrap()
            .corrections
            .is_empty());
    }

    #[tokio::test]
    async fn a_correction_that_does_not_match_the_records_cancels_the_whole_creation() {
        let store = store().await;
        let cases = vec![
            (
                "немає запису",
                correction(5, "takeoff_time", "25:00", "14:25"),
            ),
            ("невідоме поле", correction(0, "secret", "25:00", "14:25")),
            (
                "поле запису порожнє",
                correction(0, "landing_time", "25:00", "14:25"),
            ),
            (
                "порожній виправлений текст",
                correction(0, "takeoff_time", "25:00", "   "),
            ),
            (
                "рядок джерела",
                NewImportCorrection {
                    source_row: 0,
                    ..correction(0, "takeoff_time", "25:00", "14:25")
                },
            ),
            (
                "довга назва файла",
                NewImportCorrection {
                    source_file: "ф".repeat(256),
                    ..correction(0, "takeoff_time", "25:00", "14:25")
                },
            ),
        ];
        for (name, bad) in cases {
            let result = store
                .create_with_import(
                    PROFILE,
                    "air",
                    "flight-hours",
                    None,
                    imported_rows(),
                    vec![bad],
                    "2026-01-01T00:00:01Z",
                )
                .await;
            assert!(
                matches!(result, Err(DashboardModuleError::InvalidCorrection)),
                "{name}"
            );
            assert_eq!(module_count(&store).await, 0, "{name}: модуль створено");
            assert_eq!(
                data_table_count(&store).await,
                0,
                "{name}: лишилась таблиця"
            );
        }
        let twice = store
            .create_with_import(
                PROFILE,
                "air",
                "flight-hours",
                None,
                imported_rows(),
                vec![
                    correction(0, "takeoff_time", "25:00", "14:25"),
                    correction(0, "takeoff_time", "25:00", "14:30"),
                ],
                "2026-01-01T00:00:01Z",
            )
            .await;
        assert!(
            matches!(twice, Err(DashboardModuleError::InvalidCorrection)),
            "одне поле запису — одне виправлення"
        );
        let stored: i64 = sqlx::query_scalar("SELECT count(*) FROM dashboard_module_corrections")
            .fetch_one(&store.pool)
            .await
            .unwrap();
        assert_eq!(stored, 0);
    }

    #[tokio::test]
    async fn a_removed_record_takes_its_corrections_and_an_edited_one_keeps_them() {
        let store = store().await;
        let module = store
            .create_with_import(
                PROFILE,
                "air",
                "flight-hours",
                None,
                imported_rows(),
                vec![
                    correction(0, "takeoff_time", "25:00", "14:25"),
                    correction(1, "flight_altitude", "0,3", "300 м"),
                ],
                "2026-01-01T00:00:01Z",
            )
            .await
            .unwrap();
        let data = store.get_data(PROFILE, &module.id).await.unwrap();
        let first = data.rows[0]["rowId"].clone();
        // Перший запис змінено (інший тип ПС), другий видалено.
        let saved = store
            .replace_rows(
                PROFILE,
                &module.id,
                vec![row(with_row_id(
                    json!({"aircraft_type": "Тестовий-3", "airborne_hours": 0.5, "total_hours": 0.75, "takeoff_time": "14:25"}),
                    first.clone(),
                ))],
                Some(&data.module.updated_at),
                "2026-01-01T00:00:03Z",
            )
            .await
            .unwrap();
        assert_eq!(saved.rows.len(), 1);
        assert_eq!(saved.corrections.len(), 1);
        assert_eq!(saved.corrections[0].row_id, first.as_i64().unwrap());
        assert_eq!(saved.corrections[0].raw_text, "25:00");
    }
}
