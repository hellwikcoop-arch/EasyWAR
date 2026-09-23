PRAGMA foreign_keys = ON;

CREATE TABLE local_profile_workspace_templates (
    profile_id TEXT PRIMARY KEY NOT NULL,
    template_key TEXT NOT NULL CHECK (
        template_key IN ('overview', 'analysis', 'quality', 'registry', 'entry')
    ),
    updated_at TEXT NOT NULL,
    FOREIGN KEY (profile_id) REFERENCES local_profiles(id) ON DELETE CASCADE
);

CREATE INDEX idx_local_profile_workspace_template
ON local_profile_workspace_templates(template_key, profile_id);
