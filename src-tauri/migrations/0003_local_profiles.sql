PRAGMA foreign_keys = ON;

CREATE TABLE local_profiles (
    id TEXT PRIMARY KEY NOT NULL CHECK (
        length(id) = 32
        AND id GLOB 'profile-[0-9a-f]*'
        AND substr(id, 9) NOT GLOB '*[^0-9a-f]*'
    ),
    display_name TEXT NOT NULL CHECK (
        length(trim(display_name)) BETWEEN 1 AND 80
    ),
    name_key TEXT NOT NULL UNIQUE CHECK (
        length(trim(name_key)) BETWEEN 1 AND 80
    ),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE local_profile_state (
    singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
    active_profile_id TEXT,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (active_profile_id) REFERENCES local_profiles(id) ON DELETE SET NULL
);

INSERT INTO local_profile_state (singleton, active_profile_id, updated_at)
VALUES (1, NULL, '1970-01-01T00:00:00Z');

CREATE INDEX idx_local_profiles_name
ON local_profiles(name_key, id);
