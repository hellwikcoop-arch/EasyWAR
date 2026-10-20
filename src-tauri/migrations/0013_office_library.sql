PRAGMA foreign_keys = ON;

-- Захищена бібліотека «Офісу». Вміст документів, їхні назви й ключ даних бібліотеки
-- (LDK) зберігаються лише зашифрованими XChaCha20-Poly1305: відкритого тексту
-- документів у базі немає. LDK загорнуто ключем, виведеним Argon2id із пароля
-- профілю, і (за вибором користувача) другим ключем — із коду відновлення.
--
-- Таблиці бібліотеки свідомо не мають FOREIGN KEY на local_profiles: каскадного
-- видалення немає. Профіль з активною бібліотекою охороняє тригер
-- local_profiles_library_guard, а очистка профілю — це криптознищення (обгортка
-- переходить у shredded, шифротекст вмісту стає NULL), а не DELETE.
--
-- Тригери безумовні: версії, події й журнал очисток не змінюються й не видаляються
-- жодним SQL; документ і вміст — лише в перелічених нижче межах. На кожній
-- незмінній таблиці BEFORE INSERT відхиляє вставку з уже наявним ключем: інакше
-- INSERT OR REPLACE / REPLACE видалили б старий рядок, не викликавши тригер DELETE
-- (коли recursive_triggers вимкнено).

-- Обгортки ключа: один рядок на профіль. Параметри KDF зберігаються разом з
-- обгорткою, щоб зміна параметрів у новій версії не зламала старі бібліотеки.
-- AAD обгортки містить profile_id, формат і слот, тож її не перенести в інший профіль.
CREATE TABLE library_keyrings (
    profile_id TEXT PRIMARY KEY NOT NULL CHECK (
        length(profile_id) = 32
        AND profile_id GLOB 'profile-[0-9a-f]*'
        AND substr(profile_id, 9) NOT GLOB '*[^0-9a-f]*'
    ),
    format INTEGER NOT NULL CHECK (format = 1),
    kdf TEXT NOT NULL CHECK (kdf = 'argon2id'),
    kdf_m INTEGER NOT NULL CHECK (kdf_m BETWEEN 8 AND 1048576),
    kdf_t INTEGER NOT NULL CHECK (kdf_t BETWEEN 1 AND 16),
    kdf_p INTEGER NOT NULL CHECK (kdf_p BETWEEN 1 AND 8),
    kdf_salt BLOB NOT NULL CHECK (typeof(kdf_salt) = 'blob' AND length(kdf_salt) = 16),
    wrap_alg TEXT NOT NULL CHECK (wrap_alg = 'xchacha20poly1305'),
    wrap_nonce BLOB CHECK (
        wrap_nonce IS NULL OR (typeof(wrap_nonce) = 'blob' AND length(wrap_nonce) = 24)
    ),
    wrapped_ldk BLOB CHECK (
        wrapped_ldk IS NULL OR (typeof(wrapped_ldk) = 'blob' AND length(wrapped_ldk) = 48)
    ),
    recovery_salt BLOB CHECK (
        recovery_salt IS NULL OR (typeof(recovery_salt) = 'blob' AND length(recovery_salt) = 16)
    ),
    recovery_nonce BLOB CHECK (
        recovery_nonce IS NULL OR (typeof(recovery_nonce) = 'blob' AND length(recovery_nonce) = 24)
    ),
    recovery_wrapped_ldk BLOB CHECK (
        recovery_wrapped_ldk IS NULL
        OR (typeof(recovery_wrapped_ldk) = 'blob' AND length(recovery_wrapped_ldk) = 48)
    ),
    state TEXT NOT NULL CHECK (state IN ('active', 'shredded')),
    generation INTEGER NOT NULL CHECK (generation >= 1),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (kdf_m >= 8 * kdf_p),
    -- Слот відновлення — усі три поля разом або жодного.
    CHECK (
        (recovery_salt IS NULL) = (recovery_nonce IS NULL)
        AND (recovery_nonce IS NULL) = (recovery_wrapped_ldk IS NULL)
    ),
    -- Активна обгортка має основний слот; знищена не має жодного.
    CHECK (
        (state = 'active' AND wrap_nonce IS NOT NULL AND wrapped_ldk IS NOT NULL)
        OR (
            state = 'shredded'
            AND wrap_nonce IS NULL AND wrapped_ldk IS NULL
            AND recovery_salt IS NULL AND recovery_nonce IS NULL AND recovery_wrapped_ldk IS NULL
        )
    )
) WITHOUT ROWID;

-- Документ бібліотеки. Назва — шифротекст (nonce ‖ шифротекст із тегом) ключем
-- метаданих з AAD, що містить profile_id та id документа.
CREATE TABLE library_items (
    id TEXT PRIMARY KEY NOT NULL CHECK (
        length(id) = 28 AND id GLOB 'doc-*' AND substr(id, 5) NOT GLOB '*[^0-9a-f]*'
    ),
    profile_id TEXT NOT NULL CHECK (
        length(profile_id) = 32
        AND profile_id GLOB 'profile-[0-9a-f]*'
        AND substr(profile_id, 9) NOT GLOB '*[^0-9a-f]*'
    ),
    kind TEXT NOT NULL CHECK (kind IN ('table', 'document', 'slides', 'template')),
    name_cipher BLOB NOT NULL CHECK (
        typeof(name_cipher) = 'blob' AND length(name_cipher) BETWEEN 41 AND 1024
    ),
    profile_table_copy INTEGER NOT NULL DEFAULT 0 CHECK (profile_table_copy IN (0, 1)),
    current_version_id TEXT,
    hidden_at TEXT,
    created_at TEXT NOT NULL
) WITHOUT ROWID;

CREATE INDEX idx_library_items_profile ON library_items(profile_id, created_at, id);

-- Зашифрований вміст. content_id — HMAC відкритих байтів ключем бібліотеки, тож
-- однаковий вміст одного профілю зберігається один раз, а різні профілі не
-- можуть зіставити вміст між собою. data = 'EWLB' · формат · nonce · шифротекст
-- із тегом; після криптознищення data = NULL.
CREATE TABLE library_blobs (
    profile_id TEXT NOT NULL CHECK (
        length(profile_id) = 32
        AND profile_id GLOB 'profile-[0-9a-f]*'
        AND substr(profile_id, 9) NOT GLOB '*[^0-9a-f]*'
    ),
    content_id TEXT NOT NULL CHECK (
        length(content_id) = 64 AND content_id NOT GLOB '*[^0-9a-f]*'
    ),
    plain_size INTEGER NOT NULL CHECK (plain_size >= 0),
    data BLOB CHECK (
        data IS NULL
        OR (
            typeof(data) = 'blob'
            AND substr(data, 1, 5) = X'45574C4201'
            AND length(data) = plain_size + 45
        )
    ),
    created_at TEXT NOT NULL,
    PRIMARY KEY (profile_id, content_id)
);

-- Незмінна версія документа. Нова версія — лише новий рядок із наступним номером.
CREATE TABLE library_versions (
    id TEXT PRIMARY KEY NOT NULL CHECK (
        length(id) = 28 AND id GLOB 'ver-*' AND substr(id, 5) NOT GLOB '*[^0-9a-f]*'
    ),
    item_id TEXT NOT NULL REFERENCES library_items(id),
    profile_id TEXT NOT NULL CHECK (
        length(profile_id) = 32
        AND profile_id GLOB 'profile-[0-9a-f]*'
        AND substr(profile_id, 9) NOT GLOB '*[^0-9a-f]*'
    ),
    version_no INTEGER NOT NULL CHECK (version_no >= 1),
    content_id TEXT NOT NULL,
    ext TEXT NOT NULL CHECK (ext IN ('xlsx', 'csv', 'docx', 'txt', 'pptx')),
    plain_size INTEGER NOT NULL CHECK (plain_size >= 0),
    origin TEXT NOT NULL CHECK (origin IN ('imported', 'generated', 'edited', 'saved')),
    parent_version_id TEXT REFERENCES library_versions(id),
    source_fingerprint TEXT CHECK (
        source_fingerprint IS NULL
        OR (length(source_fingerprint) = 64 AND source_fingerprint NOT GLOB '*[^0-9a-f]*')
    ),
    created_at TEXT NOT NULL,
    UNIQUE (item_id, version_no),
    FOREIGN KEY (profile_id, content_id) REFERENCES library_blobs(profile_id, content_id),
    -- Відбиток джерела мають лише згенеровані версії й ручні правки згенерованих.
    CHECK (origin IN ('generated', 'edited') OR source_fingerprint IS NULL),
    CHECK (origin <> 'generated' OR source_fingerprint IS NOT NULL)
) WITHOUT ROWID;

CREATE INDEX idx_library_versions_content ON library_versions(profile_id, content_id);

-- Аудит дій бібліотеки без відкритого вмісту: лише вид події та ідентифікатори.
CREATE TABLE library_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id TEXT NOT NULL CHECK (
        length(profile_id) = 32
        AND profile_id GLOB 'profile-[0-9a-f]*'
        AND substr(profile_id, 9) NOT GLOB '*[^0-9a-f]*'
    ),
    event TEXT NOT NULL CHECK (event IN (
        'created', 'unlocked', 'imported', 'version_saved', 'generated', 'current_changed',
        'renamed', 'hidden', 'shown', 'exported', 'archive_exported', 'password_rewrapped',
        'recovered', 'recovery_reissued', 'purged'
    )),
    item_id TEXT REFERENCES library_items(id),
    version_id TEXT REFERENCES library_versions(id),
    created_at TEXT NOT NULL
);

CREATE INDEX idx_library_events_profile ON library_events(profile_id, id);

-- Журнал очисток: скільки документів і версій стали нечитабельними «надгробками».
CREATE TABLE library_purges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id TEXT NOT NULL CHECK (
        length(profile_id) = 32
        AND profile_id GLOB 'profile-[0-9a-f]*'
        AND substr(profile_id, 9) NOT GLOB '*[^0-9a-f]*'
    ),
    items INTEGER NOT NULL CHECK (items >= 0),
    versions INTEGER NOT NULL CHECK (versions >= 0),
    created_at TEXT NOT NULL
);

-- Обгортки: не видаляються; новий рядок — лише активний з generation = 1; змінюється
-- лише активний рядок і щоразу з generation + 1 (переобгортка active → active або
-- криптознищення active → shredded); знищений рядок незмінний.
CREATE TRIGGER library_keyrings_no_delete
BEFORE DELETE ON library_keyrings
BEGIN
    SELECT RAISE(ABORT, 'library_keyrings cannot be deleted');
END;

CREATE TRIGGER library_keyrings_insert_guard
BEFORE INSERT ON library_keyrings
BEGIN
    SELECT RAISE(ABORT, 'library_keyrings: keyring already exists')
    WHERE EXISTS (SELECT 1 FROM library_keyrings WHERE profile_id = NEW.profile_id);
    SELECT RAISE(ABORT, 'library_keyrings: a new keyring must be active with generation 1')
    WHERE NEW.state IS NOT 'active' OR NEW.generation IS NOT 1;
END;

CREATE TRIGGER library_keyrings_update_guard
BEFORE UPDATE ON library_keyrings
BEGIN
    SELECT RAISE(ABORT, 'library_keyrings: a shredded keyring is immutable')
    WHERE OLD.state = 'shredded';
    SELECT RAISE(ABORT, 'library_keyrings: identity fields are immutable')
    WHERE NEW.profile_id IS NOT OLD.profile_id
       OR NEW.format IS NOT OLD.format
       OR NEW.kdf IS NOT OLD.kdf
       OR NEW.wrap_alg IS NOT OLD.wrap_alg
       OR NEW.created_at IS NOT OLD.created_at;
    SELECT RAISE(ABORT, 'library_keyrings: every change must advance generation by one')
    WHERE NEW.generation IS NOT OLD.generation + 1;
END;

-- Документи: не видаляються; вставка лише за активної обгортки і без поточної версії
-- (версії з'являються після документа); змінюються лише current_version_id (версія
-- цього ж документа, назад у NULL не повертається), hidden_at і name_cipher.
CREATE TRIGGER library_items_no_delete
BEFORE DELETE ON library_items
BEGIN
    SELECT RAISE(ABORT, 'library_items cannot be deleted');
END;

CREATE TRIGGER library_items_insert_guard
BEFORE INSERT ON library_items
BEGIN
    SELECT RAISE(ABORT, 'library_items: item already exists')
    WHERE EXISTS (SELECT 1 FROM library_items WHERE id = NEW.id);
    SELECT RAISE(ABORT, 'library_items: library keyring is not active')
    WHERE NOT EXISTS (
        SELECT 1 FROM library_keyrings WHERE profile_id = NEW.profile_id AND state = 'active'
    );
    SELECT RAISE(ABORT, 'library_items: a new item has no current version')
    WHERE NEW.current_version_id IS NOT NULL;
END;

CREATE TRIGGER library_items_update_guard
BEFORE UPDATE ON library_items
BEGIN
    SELECT RAISE(ABORT, 'library_items: only current_version_id, hidden_at and name_cipher can change')
    WHERE NEW.id IS NOT OLD.id
       OR NEW.profile_id IS NOT OLD.profile_id
       OR NEW.kind IS NOT OLD.kind
       OR NEW.profile_table_copy IS NOT OLD.profile_table_copy
       OR NEW.created_at IS NOT OLD.created_at;
    SELECT RAISE(ABORT, 'library_items: library keyring is not active')
    WHERE NOT EXISTS (
        SELECT 1 FROM library_keyrings WHERE profile_id = OLD.profile_id AND state = 'active'
    );
    SELECT RAISE(ABORT, 'library_items: current version must belong to the same item')
    WHERE NEW.current_version_id IS NOT OLD.current_version_id
      AND (
          NEW.current_version_id IS NULL
          OR NOT EXISTS (
              SELECT 1 FROM library_versions
              WHERE id = NEW.current_version_id AND item_id = OLD.id
          )
      );
END;

-- Вміст: не видаляється; вставка лише за активної обгортки, з даними і без збігу
-- ключа чи rowid; єдина дозволена зміна — data → NULL після криптознищення обгортки.
CREATE TRIGGER library_blobs_no_delete
BEFORE DELETE ON library_blobs
BEGIN
    SELECT RAISE(ABORT, 'library_blobs cannot be deleted');
END;

CREATE TRIGGER library_blobs_insert_guard
BEFORE INSERT ON library_blobs
BEGIN
    SELECT RAISE(ABORT, 'library_blobs: content already exists')
    WHERE EXISTS (
        SELECT 1 FROM library_blobs
        WHERE (profile_id = NEW.profile_id AND content_id = NEW.content_id)
           OR rowid = NEW.rowid
    );
    SELECT RAISE(ABORT, 'library_blobs: library keyring is not active')
    WHERE NOT EXISTS (
        SELECT 1 FROM library_keyrings WHERE profile_id = NEW.profile_id AND state = 'active'
    );
    SELECT RAISE(ABORT, 'library_blobs: new content must have data')
    WHERE NEW.data IS NULL;
END;

CREATE TRIGGER library_blobs_update_guard
BEFORE UPDATE ON library_blobs
BEGIN
    SELECT RAISE(ABORT, 'library_blobs: content can only be erased after the keyring is shredded')
    WHERE NEW.data IS NOT NULL
       OR NEW.rowid IS NOT OLD.rowid
       OR NEW.profile_id IS NOT OLD.profile_id
       OR NEW.content_id IS NOT OLD.content_id
       OR NEW.plain_size IS NOT OLD.plain_size
       OR NEW.created_at IS NOT OLD.created_at
       OR NOT EXISTS (
           SELECT 1 FROM library_keyrings WHERE profile_id = OLD.profile_id AND state = 'shredded'
       );
END;

-- Версії: незмінні; вставка лише за активної обгортки, для документа того самого
-- профілю, з наступним номером, батьківською версією цього ж документа й розміром,
-- що збігається з розміром вмісту.
CREATE TRIGGER library_versions_no_update
BEFORE UPDATE ON library_versions
BEGIN
    SELECT RAISE(ABORT, 'library_versions are immutable');
END;

CREATE TRIGGER library_versions_no_delete
BEFORE DELETE ON library_versions
BEGIN
    SELECT RAISE(ABORT, 'library_versions are immutable');
END;

CREATE TRIGGER library_versions_insert_guard
BEFORE INSERT ON library_versions
BEGIN
    SELECT RAISE(ABORT, 'library_versions: version already exists')
    WHERE EXISTS (
        SELECT 1 FROM library_versions
        WHERE id = NEW.id OR (item_id = NEW.item_id AND version_no = NEW.version_no)
    );
    SELECT RAISE(ABORT, 'library_versions: library keyring is not active')
    WHERE NOT EXISTS (
        SELECT 1 FROM library_keyrings WHERE profile_id = NEW.profile_id AND state = 'active'
    );
    SELECT RAISE(ABORT, 'library_versions: item belongs to another profile')
    WHERE NOT EXISTS (
        SELECT 1 FROM library_items WHERE id = NEW.item_id AND profile_id = NEW.profile_id
    );
    SELECT RAISE(ABORT, 'library_versions: version number must follow the latest one')
    WHERE NEW.version_no IS NOT (
        SELECT coalesce(max(version_no), 0) + 1 FROM library_versions WHERE item_id = NEW.item_id
    );
    SELECT RAISE(ABORT, 'library_versions: parent version must belong to the same item')
    WHERE NEW.parent_version_id IS NOT NULL
      AND NOT EXISTS (
          SELECT 1 FROM library_versions
          WHERE id = NEW.parent_version_id AND item_id = NEW.item_id
      );
    SELECT RAISE(ABORT, 'library_versions: size does not match the stored content')
    WHERE NEW.plain_size IS NOT (
        SELECT plain_size FROM library_blobs
        WHERE profile_id = NEW.profile_id AND content_id = NEW.content_id
    );
END;

-- Події й журнал очисток — лише дописуються.
CREATE TRIGGER library_events_no_update
BEFORE UPDATE ON library_events
BEGIN
    SELECT RAISE(ABORT, 'library_events are append-only');
END;

CREATE TRIGGER library_events_no_delete
BEFORE DELETE ON library_events
BEGIN
    SELECT RAISE(ABORT, 'library_events are append-only');
END;

CREATE TRIGGER library_events_insert_guard
BEFORE INSERT ON library_events
BEGIN
    SELECT RAISE(ABORT, 'library_events: event already exists')
    WHERE EXISTS (SELECT 1 FROM library_events WHERE id = NEW.id);
END;

CREATE TRIGGER library_purges_no_update
BEFORE UPDATE ON library_purges
BEGIN
    SELECT RAISE(ABORT, 'library_purges are append-only');
END;

CREATE TRIGGER library_purges_no_delete
BEFORE DELETE ON library_purges
BEGIN
    SELECT RAISE(ABORT, 'library_purges are append-only');
END;

CREATE TRIGGER library_purges_insert_guard
BEFORE INSERT ON library_purges
BEGIN
    SELECT RAISE(ABORT, 'library_purges: purge already exists')
    WHERE EXISTS (SELECT 1 FROM library_purges WHERE id = NEW.id);
    SELECT RAISE(ABORT, 'library_purges: keyring must be shredded first')
    WHERE NOT EXISTS (
        SELECT 1 FROM library_keyrings WHERE profile_id = NEW.profile_id AND state = 'shredded'
    );
END;

-- Профіль з активною бібліотекою звичайним видаленням не прибрати: спершу
-- криптознищення в тій самій транзакції, що й видалення профілю.
CREATE TRIGGER local_profiles_library_guard
BEFORE DELETE ON local_profiles
BEGIN
    SELECT RAISE(ABORT, 'local_profiles: profile has an active library')
    WHERE EXISTS (
        SELECT 1 FROM library_keyrings WHERE profile_id = OLD.id AND state = 'active'
    );
END;
