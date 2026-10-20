# EasyWAR — інструкції для Claude Code

EasyWAR — локальний (local-first) настільний застосунок на Tauri 2 (Rust + SQLite) з
Vite-фронтендом для внесення, перевірки та аналізу оперативних доповідей
підрозділів. Інтерфейс лише українською. Дані чутливі: у репозиторій, чати, тести
й артефакти ніколи не потрапляють реальні таблиці, бази, Signal-дані, ключі й токени.

Правила репозиторію (обов'язкові, спільні з Codex):

@AGENTS.md

Розділ «Codex task-boundary board» в `AGENTS.md` стосується лише Codex; у Claude Code
його пропускаємо.

## Куди дивитися спочатку

| Питання | Файл |
|---|---|
| Що це за проєкт, модулі, словник термінів | `docs/PROJECT_CONTEXT.md` |
| Як працювати: задачі, гілки, коміти, перевірки, випуск | `docs/WORKFLOW.md` |
| Що робити далі (пріоритети) | `docs/BACKLOG.md` |
| Відомі ризики й знахідки аудиту | `docs/AUDIT_2026-10-13.md`, `docs/AUDIT_2026-10-19.md` (свіжіший, у кінці — стан виправлень) |
| Архітектура, база, фронтенд | `docs/ARCHITECTURE.md`, `docs/DATABASE.md`, `docs/UNIFIED_FRONTEND.md` |
| Сценарії користувача | `docs/USER_GUIDE.md` |
| Запуск і скриншоти застосунку в хмарній сесії | скіл `run-easywar` (`.claude/skills/run-easywar/SKILL.md`) |

## Команди

Підготовка: у хмарній сесії `.claude/hooks/session-start.sh` ставить бібліотеки Tauri,
виконує `npm install --no-save` і прогріває cargo; локально — `npm ci`.

```bash
npm run test:unit                                   # ≈900 JS-тестів + XLSX-контракт (cargo run --example)
cargo test --locked --manifest-path src-tauri/Cargo.toml     # ≈350 Rust-тестів (`--locked`, як у CI)
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo fmt --manifest-path src-tauri/Cargo.toml --check
npm run build                                       # Vite → dist/ (≈390 МБ, з них ≈200 МБ — .glb, ≈140 МБ — map-assets)
node script/release_version.mjs                     # узгодженість версій у 5 файлах
```

CI (`.github/workflows/desktop-build.yml`) на Linux виконує `cargo fmt --check`, `clippy`,
`cargo test`, `test:unit`, `build` та аудит залежностей (`npm audit`, `cargo audit`);
macOS/Windows у ньому лише на тегах. Усе одно запускай перевірки свого шару до пушу
(`docs/WORKFLOW.md`, розділ 5). Запуск застосунку: локально `npm run tauri dev`,
у контейнері — скіл `run-easywar` (браузерний шлях через `vite preview` + Playwright).

## Definition of Done

- `src/*.js`, `src/public/*.js` → тест у `tests/` (`node --test`); чиста логіка живе в
  `*-core.js` і тестується окремо від UI.
- Legacy HTML (`src/air.html`, `src/rocket.html`, `src/index.html`) → правила
  «Legacy HTML editing» з `AGENTS.md`; перевірка синтаксису кожного inline-скрипта;
  `tests/desktop-frontend.test.mjs` перевіряє текстові контракти сторінок.
- `src-tauri/src` → `cargo test`, `clippy -D warnings`, `fmt`.
- `runner/` (C++ рушій локальної моделі) → `script/build_runner.sh` + `script/runner_smoke.sh`
  (докладніше — `docs/WORKFLOW.md`, розділ 5, і `docs/ASSISTANT.md`, «Вбудований рушій»).
- Нова міграція → `src-tauri/migrations/NNNN_*.sql`, реєстрація в `database.rs`,
  тест міграції, оновити `docs/DATABASE.md` і `src-tauri/migrations/README.md`.
- Зміна UI → `docs/USER_GUIDE.md`; зміна структури фронтенду → `docs/UNIFIED_FRONTEND.md`;
  закритий пункт беклогу → відмітити в `docs/BACKLOG.md`.
- Випуск → розділ «Випуск версії» в `docs/WORKFLOW.md`.
- Не називай задачу виконаною без цих перевірок; у звіті вказуй, що саме перевірено,
  а що ні.

## Git

- Гілки `claude/<коротка-тема>`; `main` змінюється лише через PR, який зливає власник.
  PR не створюй, поки не попросять.
- Коміти українською у форматі «Модуль: що зроблено» (приклади — `git log`); у коміті
  лише код, тести, документація.
- Перед завершенням сесії всі зміни закомічені й відправлені
  (`git push -u origin <гілка>`): стоп-хук власника вимагає чистого дерева.
- `package-lock.json`, `Cargo.lock` і версії не чіпай без потреби; версія змінюється
  лише при випуску і в п'яти файлах одразу.

## Пастки

- `air.html` і `rocket.html` містять майже однакові копії коду карт, плиток, KML,
  dimap і сховища: правку роби в обох.
- Хук редактора модуля вставляється всередину замикання дашборда перед
  `window.__DASH` (див. `docs/UNIFIED_FRONTEND.md`).
- `cargo fmt --check` по всьому крейту зелений і є воротами CI: форматуй свої зміни
  (`rustfmt --edition 2021 <файл>`), не залишай розбіжностей.
- Хмарна сесія — Linux: збірки macOS/Windows, Gatekeeper/SmartScreen, реальний
  `signal-cli` тут не перевіряються; пиши це в «не перевірено».
- У `tests/` і фікстурах — лише синтетичні дані (`.claude/skills/run-easywar/fixtures.py`
  генерує тестові таблиці; у репозиторій їх не додавати).

## Звіт про статус

Коротко й конкретно: 1) що змінено (модулі, файли); 2) що перевірено (команди,
результат); 3) що не перевірено і чому; 4) що далі або що потрібно від власника.
