use tauri_plugin_sql::Migration;

/// The SQLite file is resolved by the Tauri SQL plugin inside the app-local
/// configuration directory. Runtime database files must never be committed.
pub const DATABASE_URL: &str = "sqlite:easywar.db";

/// Migration registration starts here. The desktop-shell issue intentionally
/// defines no product tables; domain schema work belongs to the database issue.
pub fn migrations() -> Vec<Migration> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::{migrations, DATABASE_URL};

    #[test]
    fn database_scaffold_is_local_and_has_no_invented_schema() {
        assert_eq!(DATABASE_URL, "sqlite:easywar.db");
        assert!(migrations().is_empty());
    }
}
