mod database;
pub mod repository;
pub mod signal_policy;
pub mod xlsx_import;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(database::DATABASE_URL, database::migrations())
                .build(),
        )
        .run(tauri::generate_context!())
        .expect("помилка запуску EasyWAR");
}
