PRAGMA foreign_keys = ON;

-- Посада, фото, пароль і прив'язана таблиця локального профілю.
CREATE TABLE local_profile_details (
    profile_id TEXT PRIMARY KEY NOT NULL,
    position TEXT NOT NULL DEFAULT '' CHECK (length(position) <= 120),
    avatar_data_url TEXT CHECK (
        avatar_data_url IS NULL
        OR (length(avatar_data_url) <= 400000 AND avatar_data_url GLOB 'data:image/*;base64,*')
    ),
    password_hash TEXT CHECK (password_hash IS NULL OR password_hash GLOB '$argon2id$*'),
    database_path TEXT CHECK (database_path IS NULL OR length(database_path) BETWEEN 1 AND 4096),
    updated_at TEXT NOT NULL,
    FOREIGN KEY (profile_id) REFERENCES local_profiles(id) ON DELETE CASCADE
);
