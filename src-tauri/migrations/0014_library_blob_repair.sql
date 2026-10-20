PRAGMA foreign_keys = ON;

-- Ремонт пошкодженого вмісту бібліотеки. content_id — HMAC відкритих байтів, тож
-- той самий вміст профілю завжди потрапляє в той самий рядок library_blobs. Якщо
-- шифротекст рядка пошкоджено (збій диска, частково відновлена копія), повторний
-- імпорт чи збереження тих самих байтів раніше відмовляв назавжди: тригер з 0012
-- дозволяв лише data → NULL після криптознищення.
--
-- Тепер, поки обгортка профілю активна, дані рядка можна замінити іншим шифротекстом
-- того самого розміру (CHECK таблиці лишається: заголовок EWLB і довжина). Що це
-- шифротекст саме тих байтів, перевіряє застосунок: він замінює рядок лише тоді,
-- коли наявний не розшифровується, а новий щойно зашифровано й розшифровано назад
-- (ключ і HMAC вмісту прив'язують шифротекст до content_id). Ідентичність рядка
-- (rowid, профіль, content_id, розмір, час створення) і правило криптознищення
-- не змінюються; після криптознищення дані не повертаються.

DROP TRIGGER library_blobs_update_guard;

CREATE TRIGGER library_blobs_update_guard
BEFORE UPDATE ON library_blobs
BEGIN
    SELECT RAISE(ABORT, 'library_blobs: content can only be erased after the keyring is shredded')
    WHERE NEW.rowid IS NOT OLD.rowid
       OR NEW.profile_id IS NOT OLD.profile_id
       OR NEW.content_id IS NOT OLD.content_id
       OR NEW.plain_size IS NOT OLD.plain_size
       OR NEW.created_at IS NOT OLD.created_at
       OR (OLD.data IS NULL AND NEW.data IS NOT NULL)
       OR (
           NEW.data IS NULL
           AND NOT EXISTS (
               SELECT 1 FROM library_keyrings
               WHERE profile_id = OLD.profile_id AND state = 'shredded'
           )
       );
    SELECT RAISE(ABORT, 'library_blobs: content can only be repaired while the keyring is active')
    WHERE NEW.data IS NOT NULL
      AND NOT EXISTS (
          SELECT 1 FROM library_keyrings WHERE profile_id = OLD.profile_id AND state = 'active'
      );
END;
