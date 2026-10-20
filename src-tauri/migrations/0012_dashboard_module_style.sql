-- Стиль оформлення модуля дашборда, обраний під час створення. Колір картки береться
-- з роду військ (гілки) модуля, тож тут зберігається лише назва стилю з короткого
-- вбудованого переліку: «standard» — як раніше, «branch» — кольори роду військ,
-- «heightwell» — нічний стиль «Пункт керування». Наявні модулі лишаються «standard».
ALTER TABLE dashboard_modules
    ADD COLUMN style TEXT NOT NULL DEFAULT 'standard'
    CHECK (style IN ('standard', 'branch', 'heightwell'));
