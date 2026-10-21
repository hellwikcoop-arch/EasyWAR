# EasyWAR Platform and Release Implementation Plan

> **For agentic workers:** Use the host's available task-by-task implementation workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Зберегти наявні можливості EasyWAR, підтвердити безпеку та поведінку на цільових платформах і випускати перевірені оновлення.

**Architecture:** Настільний Tauri-клієнт залишається основою; наявні застосунки Workspace використовують свій host-контракт. Мобільне внесення будується на погодженому протоколі джерел/операцій, а не через перенесення Tauri IPC у вебсторінку.

**Tech Stack:** Чинний frontend, Rust/Tauri, macOS WKWebView, Windows WebView2, браузерний viewer; mobile shell обирається окремо.

## Global Constraints

Зберегти [головний ROADMAP](2026-10-21-easywar-codex-roadmap.md), чинні `WORKFLOW.md` й `RELEASE_CHECKLIST.md`. Зелений Linux CI не доводить приймання macOS, Windows чи iPhone. План не дозволяє автоматичної публікації, заміни тегів, видалення випусків або зміни зовнішніх інтеграцій.

### P0. База перевірок і фактичні межі доступу

**Файли:** читати `src-tauri/build.rs`, `src-tauri/capabilities/*.json`, `src-tauri/src/lib.rs`, `desktop_shell.rs`, `office_files.rs`, `dashboard_modules.rs`, `tests/office-isolation.test.mjs`; створити `docs/evidence/readiness/baseline.md`. Змінювати код лише окремим сфокусованим виправленням доведеної проблеми.  
**Інтерфейси:** перелік власних команд = handler = COMMANDS = дозволені мітки; збереження модуля вимагає актуальну версію. Залежність: немає.

- [ ] Записати HEAD/toolchain, запустити передбачені workflow JS/Rust/build gates. Провал описати з відтворенням; не переписувати lockfile й не вимикати тест заради зеленого статусу.
- [ ] Перевірити наявну ізоляцію: editor має лише п'ять office-команд; підміна window label, зайва capability чи нова IPC без COMMANDS має ловитися негативним тестом.
- [ ] Вузько: `node --test tests/office-isolation.test.mjs tests/dashboard-module-source.test.mjs tests/dashboard-module-catalog.test.mjs`; Rust `cargo test --locked --manifest-path src-tauri/Cargo.toml dashboard_modules::tests`.
- [ ] На базовому SHA `replace_rows` уже вимагає непорожній `expected_updated_at`, міграція 0016 уже присутня. Стару фразу про необов'язкову версію виправити в L0; нову таку ж міграцію не створювати.
- [ ] Перевірити correction provenance після ручного редагування та stale version: відмова не змінює рядки/аудит. Якщо вже виправлено — зафіксувати доказ, не реалізовувати повторно.
- [ ] Нативний негативний тест: із справжнього editor webview виклик profile/backup/crypto не проходить; із main потрібна дозволена команда працює.
- [ ] Коміт тільки документа доказів або одного доведеного виправлення: `test: record baseline and native command isolation evidence`.

**Приймання:** є відтворюваний baseline, а не обіцянка «все перевірено» за читанням тестового файла.

### P1. Межі для майбутніх мережі й ключів

**Файли:** змінити тільки після scoped task `src-tauri/tauri.conf.json`, `src-tauri/src/desktop_shell.rs`, bounded ділянки `src/air.html`/`src/rocket.html`, `local_profiles.rs`; створити `tests/network-boundary.test.mjs`, `docs/adr/network-and-secret-boundaries.md`. Сховище секретів/adapter визначити в ADR, не вводити випадкову паралельну систему.  
**Інтерфейси:** `networkPolicy(profile, purpose) → allowed/denied`; `secretStore.read/write/delete(purpose, profile)` у Rust; JS споживає статус/результат без секрету. Залежність: P0; перед production E2EE A5/A6.

- [ ] Інвентаризувати фактичні зовнішні адреси: оновлення, модель, погода, карти, Signal loopback і заплановані Q12/Q13/Base44. Для кожної — trigger, дані, право, timeout, cancellation.
- [ ] До зміни CSP записати точні дозволені ресурси всіх legacy/WASM/worker/3D сценаріїв. Зміна `null` на надто вузьку політику без перевірки не вважається виправленням.
- [ ] Тести: непогоджена мережа не виконується; XSS-подібна назва джерела не виконує скрипт; editor не отримує нові права; logout зупиняє запити й стирає session state.
- [ ] Команди: `node --test tests/network-boundary.test.mjs tests/office-isolation.test.mjs tests/desktop-frontend.test.mjs`; Rust gates; build; UI smoke офлайн та дозволених інтеграцій.
- [ ] Перенесення Planet key із localStorage/URL у Rust — окремий PR за P2-2; задати consent/сумісність/очищення старого значення. Очищення залишків профілю в storage — окремий перевірений крок за P2-3.
- [ ] Коміт по межі: `security: enforce reviewed network and secret boundaries`.

Для E8 (рев'ю J3, C04): ця межа обов'язкова до будь-якого мережевого прослуховування колективу (C6a–C6c, C8) і до сховища ключів C2; інтерфейс `networkPolicy` є першим шаром єдиної політики обміну (ADR [`collective-sync-policies.md`](../adr/collective-sync-policies.md)).

**Приймання:** дозволені сценарії працюють; невідомий запит і доступ до чужого профілю відхиляються. Неприйнятий CSP-ризик лишається явним blocker або письмовим release-risk, не мовчазним «готово».

### P2. Наявні застосунки й візуальне приймання

Це черга незалежних вертикалей P2a–P2e, а не одна велика зміна.

| Вертикаль | Файли/наявні тести | Що довести |
|---|---|---|
| P2a Workspace/Office | `src/workspace/workspace-*.js`, `library*.js`, `office_library.rs`, `office_sources.rs`; `tests/workspace.test.mjs`, `library-core.test.mjs`, `library-ui.test.mjs`, `easydoc.test.mjs`, `easygreen-core.test.mjs`, `easyslide-host.test.mjs` | Відкрити/зберегти/скасувати, версії документа, блокування бібліотеки, isolation, відновлення й незмінний пов'язаний source |
| P2b EasyPay | `src/workspace/easypay/*`; `tests/easypay-core.test.mjs` | Синтетичний ввід/збереження/повторне відкриття, відсутність регресії погоджених формул, український UI |
| P2c EasyFLY | `src/workspace/easyfly/*`; `tests/easyfly-core.test.mjs`, `easyfly-app.test.mjs`, `easyfly-nav.test.mjs`, `easyfly-nav-views.test.mjs` | Файловий цикл, екрани, друк/PDF/CSV на платформі; нормативні припущення з `WORKSPACE.md` не оголошувати підтвердженими |
| P2d Погода/КОМБАТ | `src/workspace/weather/*`, `weather_online.rs`, `src/assistant/*`, `local_model.rs`, `model_install.rs`; відповідні `workspace-weather`/`assistant-*` тести | Офлайн-стан, явне завантаження моделі, скасування, checksum, зупинка sidecar на logout, незмішування фактів і генерації |
| P2e Випробувані старі модулі | `pvk/udshv/own-losses/artillery` UI/core, `signal_*.rs`, презентації | Внесення → перевірка → схвалення → дашборд; XLSX/PPTX/PDF; live Signal лише за окремого тестового доступу |

**Спільний інтерфейс:** чинний `host.openFile/saveFile/saveFileAs`, контракт бібліотеки й наявні core-моделі. Не підміняти їх новим сховищем через візуальний редизайн.

Для кожної вертикалі окремо:

- [ ] Зафіксувати конкретну версію прийнятого референсу/екрана і синтетичний fixture. Матеріали з інших чатів або Library спочатку реально прочитати/отримати; не заявляти pixel-match лише за їх назвою.
- [ ] Відтворити конкретну розбіжність і додати поведінковий тест, якщо змінюється логіка. Для суто CSS — контрольні знімки й перевірка доступності без штучних тестів implementation.
- [ ] Мінімальна правка лише файлів вибраної вертикалі; фінансові/льотні нормативні алгоритми змінювати лише за перевіреним джерелом і окремою вимогою.
- [ ] Запустити точний наявний тест із таблиці, потім обов'язкові повні gates зміненого шару; перевірити дві теми, focus, keyboard, zoom, мінімальний розмір вікна та native file dialogs.
- [ ] Зберегти sanitized screenshots/evidence у `docs/evidence/readiness/`, коміт `fix: align <named workspace app> with accepted behavior`, де назву підставити до початку задачі.

Визначення нових продуктів на кшталт повного аналога ForeFlight, нових артилерійських робочих процесів або нових розрахункових систем у цю загальну перевірку не включати: спочатку потрібен їхній предметний контракт. Наявні реалізації зберігаються і перевіряються.

### P3. Телефон → комп'ютер: окремий мобільний етап

**Файли:** читати `src/viewer.html`, `vite.config.js`, `docs/MOBILE_VIEWER.md`, `src-tauri/src/phone_export.rs`, `tests/pwa-viewer.test.mjs`, `tests/phone-export.test.mjs`; створити `docs/adr/mobile-write-client.md`, після вибору shell — `src/mobile/entry-core.js`, `sync-adapter.js`, `tests/mobile-entry.test.mjs` (пропоновані). Native platform files визначити окремим планом за ADR.  
**Інтерфейси:** використовує `ReportSubmission`, `SealedEnvelope`, `Transport.push/pull` і source revisions A4–A6; ніколи не викликає desktop Tauri IPC із браузера. Залежність: L4, A2/A5/A6, O16.

- [ ] Спочатку ADR: платформи iOS/Android/інші, PWA чи native/Tauri mobile, захищене сховище ключів, background limits, доставка й оновлення. Вимогу «всі платформи» перетворити на явну матрицю приймання.
- [ ] Тести: ввід із телефона → та сама підтверджена версія на ПК; втрачена мережа/сесія/закриття під час передачі; повтор не дублює; lock не відкриває локальні дані.
- [ ] `node --test tests/mobile-entry.test.mjs tests/pwa-viewer.test.mjs tests/phone-export.test.mjs`; спочатку відсутній сценарій mobile write.
- [ ] Offline write увімкнути лише в погодженій O16-моделі. Якщо рішення — read-only без зв'язку, форма це пояснює і не створює приховану чергу; якщо дозволені чернетки, показує pending і не називає їх доставленими.
- [ ] Чинний viewer/snapshot зберегти як перегляд; файл із base64 не називати зашифрованим. Захист snapshot/password — окремий контракт до надсилання чутливих даних.
- [ ] Реальні iPhone/Android та ПК на синтетичних даних, кожен заявлений browser/ОС; full gates і build обраного shell → коміт `feat: add verified mobile reporting client`.

**Приймання:** зафіксований міжпристроєвий сценарій, не просто responsive-сторінка або ручне пересилання нового HTML.

### P4. Відтворюваний випуск і оновлення встановлених копій

**Файли:** змінити за потреби `.github/workflows/desktop-build.yml`, `script/release_version.mjs`, `script/update_manifest.mjs`, `docs/releases/DECISIONS.md`, release notes; читати `src-tauri/src/app_update.rs`, backup/restore/migration_startup, `UPDATES.md`, `RELEASE_CHECKLIST.md`; `tests/release.test.mjs`, `tests/app-update-state.test.mjs`.  
**Інтерфейси:** `source commit/tag → installers + signed update packages + latest.json → verified install + migration`. Залежність: прийнятий scope відповідної M-точки.

- [ ] Узгодити фактичний технічний чи production-режим, commit/tag і відомі обмеження. Суперечності/пропуски `DECISIONS.md` спочатку звірити з реальною історією; не дописувати вигаданих рішень заднім числом.
- [ ] `node script/release_version.mjs`; `node --test tests/release.test.mjs tests/app-update-state.test.mjs`; повні JS/Rust/build/audit gates для релізного SHA.
- [ ] Якщо потрібна нова версія, змінити всі п'ять узгоджених version-файлів; це окрема релізна дія, не побічний ефект документації.
- [ ] Створити перевірену резервну копію; оновити зі старої підтримуваної синтетичної бази; clean/upgrade/restart/crash recovery і in-app restore на macOS/Windows.
- [ ] Зібрати обидві desktop-платформи з sidecar. Перевірити підпис пакета updater окремо від Apple Developer ID/notarization і Windows Authenticode. Наявність minisign не робить збірку production.
- [ ] CI готує чернетку у `hellwikcoop-arch/easywar-releases`. Маніфест містить перевірені пакети/підписи; фактичні завантажені артефакти перевірені хешами.
- [ ] Перевірити upgrade без інтернету/зі збоєм, неправильний підпис, нестачу місця, провал backup: попередня програма/база не пошкоджені, повідомлення правдиве.
- [ ] Власник вирішує публікацію/виняток і rollback. Опубліковані теги не переносити; відкочування бінарника не знижує автоматично SQLite-схему.
- [ ] Коміт документації доказів до release SHA або визначений release record; опублікування — окрема дозволена дія.

## Відкриті рішення цього плану

Production-сертифікати й порядок технічних винятків; точна матриця платформ; спосіб мобільної доставки та O16; policy CSP/network/secrets із P1; версії референсів P2; нормативні припущення EasyFLY та неузгоджені продуктові розширення. Оцінки календарних строків і вартості без вимірювань не встановлені.
