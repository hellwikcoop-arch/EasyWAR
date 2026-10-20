PRAGMA foreign_keys = ON;

-- Зв'язок документа бібліотеки з джерелом даних: з якого шаблону (незмінна версія)
-- і з яких даних (вид джерела й параметри) документ згенеровано, яка версія
-- згенерована останньою і з яким відбитком джерела. Відбиток — HMAC ключем
-- бібліотеки, тож без розблокованої бібліотеки його не підробити й не зіставити.
-- Параметри (період, модуль, таблиця бібліотеки) — лише ідентифікатори й дати.
--
-- Змінюються лише last_generated_version_id, source_fingerprint і updated_at.
-- Видалення рядка — це «Відв'язати від джерела»: сам документ і його версії
-- лишаються незмінними.
CREATE TABLE document_links (
    item_id TEXT PRIMARY KEY NOT NULL REFERENCES library_items(id),
    profile_id TEXT NOT NULL CHECK (
        length(profile_id) = 32
        AND profile_id GLOB 'profile-[0-9a-f]*'
        AND substr(profile_id, 9) NOT GLOB '*[^0-9a-f]*'
    ),
    template_version_id TEXT NOT NULL REFERENCES library_versions(id),
    source_kind TEXT NOT NULL CHECK (
        source_kind IN ('approved_revisions', 'dashboard_module', 'library_table')
    ),
    params_json TEXT NOT NULL CHECK (json_valid(params_json) AND length(params_json) <= 4096),
    last_generated_version_id TEXT REFERENCES library_versions(id),
    source_fingerprint TEXT CHECK (
        source_fingerprint IS NULL
        OR (length(source_fingerprint) = 64 AND source_fingerprint NOT GLOB '*[^0-9a-f]*')
    ),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
) WITHOUT ROWID;

CREATE INDEX idx_document_links_profile ON document_links(profile_id, item_id);

-- Зв'язок створюється лише за активної обгортки, для документа й шаблону цього ж
-- профілю; остання згенерована версія — згенерована версія цього ж документа.
CREATE TRIGGER document_links_insert_guard
BEFORE INSERT ON document_links
BEGIN
    SELECT RAISE(ABORT, 'document_links: library keyring is not active')
    WHERE NOT EXISTS (
        SELECT 1 FROM library_keyrings WHERE profile_id = NEW.profile_id AND state = 'active'
    );
    SELECT RAISE(ABORT, 'document_links: item belongs to another profile')
    WHERE NOT EXISTS (
        SELECT 1 FROM library_items WHERE id = NEW.item_id AND profile_id = NEW.profile_id
    );
    SELECT RAISE(ABORT, 'document_links: template belongs to another profile')
    WHERE NOT EXISTS (
        SELECT 1 FROM library_versions
        WHERE id = NEW.template_version_id AND profile_id = NEW.profile_id
    );
    SELECT RAISE(ABORT, 'document_links: last generated version must be a generated version of the item')
    WHERE NEW.last_generated_version_id IS NOT NULL
      AND NOT EXISTS (
          SELECT 1 FROM library_versions
          WHERE id = NEW.last_generated_version_id
            AND item_id = NEW.item_id
            AND origin = 'generated'
      );
END;

CREATE TRIGGER document_links_update_guard
BEFORE UPDATE ON document_links
BEGIN
    SELECT RAISE(ABORT, 'document_links: only the generation state can change')
    WHERE NEW.item_id IS NOT OLD.item_id
       OR NEW.profile_id IS NOT OLD.profile_id
       OR NEW.template_version_id IS NOT OLD.template_version_id
       OR NEW.source_kind IS NOT OLD.source_kind
       OR NEW.params_json IS NOT OLD.params_json
       OR NEW.created_at IS NOT OLD.created_at;
    SELECT RAISE(ABORT, 'document_links: library keyring is not active')
    WHERE NOT EXISTS (
        SELECT 1 FROM library_keyrings WHERE profile_id = OLD.profile_id AND state = 'active'
    );
    SELECT RAISE(ABORT, 'document_links: last generated version must be a generated version of the item')
    WHERE NEW.last_generated_version_id IS NOT NULL
      AND NOT EXISTS (
          SELECT 1 FROM library_versions
          WHERE id = NEW.last_generated_version_id
            AND item_id = OLD.item_id
            AND origin = 'generated'
      );
END;
