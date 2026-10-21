# EasyWAR Accounts and Sync Implementation Plan

> **For agentic workers:** Use the host's available task-by-task implementation workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Додати перевірені акаунти, лічильники копій, кероване поширення описів модулів і захищений обмін спільними таблицями.

**Architecture:** Відокремити автентифікацію хмарного акаунта від локального профілю та криптографічної ідентичності колективу. Чотири незалежні потоки: облік інсталяцій, керування колективом, E2EE-операції, подання структури модуля; жоден не отримує автоматично права іншого.

**Tech Stack:** Rust/Tauri/SQLite, наявні JS core/UI; Base44 як кандидат backend після sandbox; криптобібліотеки лише за погодженим профілем.

## Global Constraints

Діють [головний ROADMAP](2026-10-21-easywar-codex-roadmap.md), чинні `AGENTS.md`, `COLLECTIVES_PLAN.md` і `BASE44_SANDBOX.md`. Усі нові файли/команди нижче — пропозиції. Придатність Base44, зовнішні ресурси, реальні дані та нові залежності не вважаються дозволеними від факту створення цього плану.

A1–A3 можуть дати корисний результат окремо від колективів. A7 — окремий потік каталогу. Для E8 зберігається його чинна межа дозволу; виняток з неї має називати конкретний етап.

## Контракти, які не можна змішувати

| Сутність | Призначення | Межа |
|---|---|---|
| local profile_id | Дані/налаштування на конкретному клієнті | Не ототожнювати автоматично з хмарним акаунтом |
| account_id | Стабільний ID автентифікованого серверного акаунта | O12 ще відкрито; це рекомендований напрям |
| device_id | Зареєстрована ідентичність пристрою | Не обіцянка унікального фізичного обладнання |
| installation_id | Конкретна інсталяція, повторні звернення мають той самий ID | Перевстановлення — нова інсталяція; клон/restore потребує визначеної політики |
| collective member/key identity | Членство, підпис операцій, доступ до епох ключів | Не джерело ID телеметрії |
| RegistryCounts | Множини акаунтів/пристроїв/інсталяцій + активні інсталяції за 30 днів | Не кількість фізичних людей чи всіх офлайн-копій |
| ReportSubmission | Намір «Доповісти», ID набору операцій, період/обов'язок за O17 | Будь-яка правка таблиці не дорівнює доповіді |

### A1. C0 — перевірка Base44 для конкретних сценаріїв

**Файли:** змінити `docs/BASE44_SANDBOX.md`; створити `docs/evidence/collectives/base44-feasibility.md`, `docs/adr/base44-auth-transport.md`. Код проби тримати окремо від production-адаптера.  
**Інтерфейси:** споживає вимоги G01–G11; віддає pass/fail/not-tested з доказом, quota/limits і рішенням щодо способу автентифікації. Залежність: дозвіл на synthetic sandbox.

- [ ] Записати точний `appId`, регіон/план без секретів, обраний шлях user auth. Перевірити актуальні офіційні docs, вартість, PAT, refresh/logout, provider login, вимоги зовнішнього клієнта.
- [ ] Довести **із Rust desktop**, що API працює як цей користувач. JS SDK-приклад сам по собі цього не доводить. Service-role/PAT власника у встановлену програму не включати.
- [ ] Перевірити двома колективами й стороннім акаунтом: anonymous/чужий ID/підміна поля не дають читання/запису. Admin aggregate endpoint сам перевіряє власника; записів інших акаунтів клієнту не повертає.
- [ ] Для прямих HTTP-функцій довести explicit auth; не припускати, що сам URL функції створює контекст користувача. Для elevated API перевіряти дозволи всередині функції.
- [ ] Перевірити повтор однакового ID+байтів, інші байти з тим самим ID, конкурентний create, втрату відповіді, пагінацію > однієї сторінки, відновлення після restart, розмір, export/delete/backup.
- [ ] Окремо результати для реєстру і для E2EE-mailbox. Нездатність Base44 забезпечити контракт не обходити небезпечним відкриттям прав: повернути ADR із конкретною вимогою до іншого backend.
- [ ] Зафіксувати матрицю G01–G11: криптографічні G06/G11 можуть завершуватися A5/P0, Delta G10 — A8. Не ставити весь sandbox «пройдено», якщо перевірено лише login.
- [ ] Коміт: `docs: record base44 feasibility evidence and auth decision`.

**Приймання:** секретів/реальних даних у доказах немає; відомо, який backend-контракт реально забезпечено, які обмеження й які gates не пройдені.

### A2. Серверний акаунт, прив'язка локального профілю й пристрою

**Файли:** створити `src-tauri/src/cloud_account.rs`, `src/cloud-account-core.js`, `src/cloud-account.js`, `tests/cloud-account.test.mjs`; змінити `local_profiles.rs` лише для явного зв'язку, `lib.rs`, `build.rs`, main capability та append-only міграцію, якщо потрібна.  
**Інтерфейси:** `connectAccount(profileId, authProof) → AccountLink`; `registerDevice(accountId, devicePublicIdentity) → DeviceRef`; `cloudSessionStatus() → disconnected/authenticated/expired`; `disconnectAccount(profileId)`. Залежність: A1 G01, O04/O12 і затверджений scope.

- [ ] Тести: один акаунт на двох клієнтах; різні локальні профілі не зливаються мовчки; чужий profile_id не прив'язується; прострочена сесія відхиляє мережевий запис.
- [ ] `node --test tests/cloud-account.test.mjs` і `cargo test --locked --manifest-path src-tauri/Cargo.toml cloud_account::tests`; нові інтерфейси спочатку відсутні.
- [ ] Реалізувати погоджений A1 login. Пароль локального профілю не надсилати автоматично як пароль Base44. Секрет сесії зберігати в погодженому захищеному сховищі Rust; JS одержує лише статус.
- [ ] Logout припиняє мережеві задачі, очищає session-secret і UI, не видаляє локальні дані. Перемикання профілю не приймає стару async-відповідь.
- [ ] Другий пристрій потребує окремої прив'язки ключів; сам вхід в акаунт не надає можливості розшифрувати колектив. Поведінку відновлення визначає O04.
- [ ] Перевірки JS/Rust/ACL за головним планом → коміт `feat: link local profiles to verified cloud accounts`.

### A3. Q13 — ідемпотентний реєстр і панель власника

**Файли:** створити `src-tauri/src/installation_registry.rs`, `src/installation-registry-core.js`, `tests/installation-registry.test.mjs`; змінити `src/local-profiles.js` для панелі, необхідні IPC; Base44 schema/functions зберігати як версійний backend-код у погодженому каталозі `integrations/base44/registry/` (новий).  
**Інтерфейси:** `registerInstallation({ accountRef, deviceRef, installationId, appVersion }) → receipt`; `recordActivity(installationId) → receipt`; `getOwnerCounts() → { accounts, devices, installationsTotal, installationsActive30d, observedAt, coverage }`. Залежність: A2, O11/O13, затверджений виняток Q13 і наданий користувачеві опис передачі.

- [ ] Тести: retry 100 разів = одна інсталяція; один акаунт/два пристрої/три інсталяції = 1/2/3 за відновленої прив'язки пристрою; втрата відповіді не дублює; boundary 30 днів; сторонній користувач не читає загальну статистику.
- [ ] `node --test tests/installation-registry.test.mjs`; `cargo test --locked --manifest-path src-tauri/Cargo.toml installation_registry::tests`; backend-тести того runtime, який прийнято в A1.
- [ ] Запис ідемпотентний на backend, не лише через клієнтський прапорець. account_id брати з auth-контексту, не довіряти довільному account_id із payload.
- [ ] Серверний lastSeen визначає 30-денне вікно; клієнтський годинник не дає довільно збільшувати активність. Відсутня мережа → pending; reconnect → retry із тим самим installation_id.
- [ ] O11 визначає trigger: при будь-якому дозволеному інтернет-з'єднанні чи після connect cloud. UI називає саме охоплені копії. Підроблені клієнти/кілька акаунтів/клони означають зареєстровані сутності, не точну кількість людей чи фізичних установок.
- [ ] Не додавати імена, апаратні MAC/IMEI/серійні номери, дані таблиць, членство й ключі колективу. Provider metadata/IP описати як факт роботи сервісу, не маскувати заявою «без жодних метаданих».
- [ ] Власник читає тільки aggregate, користувач — власний акаунт/пристрої. Чужі сирі RegistryRows у клієнтській панелі не завантажуються.
- [ ] Перевірки шару й синтетичний інтеграційний сценарій → коміт `feat: add idempotent installation registry and owner counts`.

### A4. C1/C3 — локальна модель колективу, операцій і доповіді

**Файли:** створити `src/collective-core.js`, `src/shared-table-core.js`, `src/sensitivity-core.js`, `src/report-submission-core.js`, однойменні `tests/*.test.mjs`; Rust `src-tauri/src/collective/store.rs` та `mod.rs` (нові), append-only міграцію й супровідні IPC/ACL.  
**Інтерфейси:** `proposeMembership(policy, event)`; `previewReport(tableRevision, pendingOperations) → ReportPreview`; `commitReport(preview, expectedRevision) → ReportSubmission`; `applyOperation(state, operation, policy) → applied/conflict/rejected`; `routeFor(tableClass, transport) → allowed/denied`. Залежність: локальний source contract L3/L4, O05/O06/O14/O17 у залежних гілках.

- [ ] Тести взаємної згоди/відкликання; непризначений member читає, але не пише; підроблені автор/collective_id/table_id; неправильна base_version; duplicate op; delete/restore.
- [ ] `node --test tests/collective.test.mjs tests/shared-table.test.mjs tests/sensitivity.test.mjs tests/report-submission.test.mjs`; Rust `collective::store::tests`. Спочатку нового локального контракту немає.
- [ ] Операція містить `op_id, collective_id, table_id, schema_version, row_key, kind, values, base_version, author_member_id, device_id, client_time, key_epoch, signature`. `values` для upsert — повний актуальний рядок, не тільки змінені клітинки.
- [ ] Preview виділяє змінені клітинки й повідомляє «надсилається весь рядок». «Прийняти» атомарно фіксує локальну ревізію, журнал і outbox; «Скасувати» не змінює підтверджений стан.
- [ ] Незбіжна base_version → conflict, не last-write-wins. ID+однакові байти → той самий результат; ID+інші байти → відхилення.
- [ ] Відрізняти збережену локальну правку, сформовану доповідь і доставлену доповідь. Панель «хто подав» потребує ReportSubmission, періоду й обов'язку O17; нуль змін може бути окремою доповіддю лише якщо власник це дозволить.
- [ ] Class D/unknown у Base44 не проходить. Під час O14-рішення визначити весь рядок mixed-table: його не можна випадково передати через A–C частину.
- [ ] Вузькі/повні JS/Rust, міграції → коміт `feat: add local collective operations and explicit report submissions`.

### A5. C2 — ключі, E2EE, підпис і відкликання

**Файли:** створити `src-tauri/src/collective/crypto.rs`, `keys.rs`, `protocol.rs`; `docs/adr/collective-crypto.md`; змінити `Cargo.toml`/`Cargo.lock` лише для схвалених нових залежностей, IPC/ACL та `tests/office-isolation.test.mjs`.  
**Інтерфейси:** `sealOperation(operation, keyEpoch, signer) → SealedEnvelope`; `openVerifiedEnvelope(envelope, membershipState) → verifiedOperation`; `rotateEpoch(revocation) → keyEnvelopes`. Залежність: A4, O04/O09, P0/P1 межі безпеки.

- [ ] Спочатку інвентаризувати криптографію бібліотеки Office й наявні крейти. Її локальний ключ не є ключем колективу; розділити призначення/контексти й політику зберігання.
- [ ] Зафіксувати версію протоколу, канонічне кодування підпису, AEAD associated data, nonce policy, key epoch, ліміти/помилки й test vectors. Не створювати власний криптоалгоритм.
- [ ] Тести: інший пристрій розшифровує/перевіряє; зміна ciphertext/header/підпису/таблиці → rejection; replay; невідома епоха; вступ із повним/неповним набором історичних ключів; повторний вступ; чужий ключ; пошкоджена обгортка; відсутній recovery.
- [ ] `cargo test --locked --manifest-path src-tauri/Cargo.toml collective::crypto::tests` і `collective::keys::tests`; до реалізації seal/open не існують.
- [ ] Відкликання створює нову епоху для решти. Уже збережений на чужому пристрої plaintext відкликати неможливо. Серверний ingest також відхиляє нові операції відкликаного користувача; backdated client_time не повертає йому права.
- [ ] За D21/PR #131 новий учасник отримує доступ до всієї історії й обгортки ключів усіх епох. Той, хто додає, мусить мати всі потрібні ключі; якщо їх бракує, вступ не оголошувати завершеним. Повторно доданий читає також період відсутності; D-історію не переносити в Base44.
- [ ] Rust-перевірки, `node --test tests/office-isolation.test.mjs`, audit, однакові vectors на macOS/Windows → коміт `feat: add reviewed collective encryption and key epochs`.

**Приймання:** G06/G11 підтверджені; backend не знає ключів вмісту; recovery відповідає затвердженому O04.

### A6. C4/C5 — хмарний обмін і дашборд колективу

**Файли:** створити `src-tauri/src/collective/transport.rs`, `base44.rs`, `sync.rs`, `src/collective-ui.js`, `src/collective-sync-core.js`, `tests/collective-sync.test.mjs`; backend-код `integrations/base44/collectives/` (новий).  
**Інтерфейси:** `Transport.push(envelope) → storedReceipt`; `Transport.pull(cursor, pageLimit) → { envelopes, nextCursor, hasMore }`; `syncOnce(collectiveId) → SyncResult`; `applyVerifiedBatch(envelopes, expectedSourceRevision) → applied/conflicts`. Залежність: A1 G01–G05/G07, A4/A5, O02/O07/O15, дозволений старт E8.

- [ ] Синтетичні тести: A «Доповісти» → B «Звірити» → source revision і всі залежні картки оновилися; retry/дві одночасні правки/duplicate/збій між apply і cursor/restart/кілька сторінок та повне перше завантаження історії/надгробків за всі епохи.
- [ ] `node --test tests/collective-sync.test.mjs`; `cargo test --locked --manifest-path src-tauri/Cargo.toml collective::sync::tests`. Спочатку транспорту немає; очікується відсутній sync контракт.
- [ ] Server receipt означає «збережено на сервері». Local applied означає «перевірено й застосовано на цьому пристрої». Не повідомляти, що всі клієнти вже оновилися, якщо вони офлайн.
- [ ] Backend не може сам зливати відкриті значення рядка всередині ciphertext. Зафіксувати порядок журналу, спосіб compare-version/конфліктів і межу видимих метаданих у ADR; якщо потрібен opaque row token, погодити його leakage. Глобальне «applied» без цього не обіцяти.
- [ ] Курсор зсувається атомарно з фіксацією отриманих операцій/конфліктів; пошкоджений пакет не губиться як «прочитаний». Підхід quarantine/зупинки та показ користувачеві описати до реалізації.
- [ ] Outbox не видаляє єдину копію після HTTP 200. Після receipt можна очищати лише визначений cache за retention, зберігаючи підтверджений стан/аудит/можливість retry.
- [ ] Автоотримання при відкритті й раз на погоджений N + кнопка. Один sync на колектив одночасно; backoff після мережевої помилки; logout/lock зупиняють задачу; ручна кнопка не створює дубль.
- [ ] Виміряти synthetic 100 учасників, квоти/витрати й пропуски сторінок; не обіцяти «миттєво» без вимірювання.
- [ ] Перевірки шару, два реальні клієнти на синтетичних даних, контроль class D і RLS/endpoint authorization → коміт `feat: sync encrypted collective reports with explicit receipts`.

### A7. Q12 — передавання структури й включення в загальний каталог

**Файли:** створити `src/module-submission-core.js`, `src-tauri/src/module_submissions.rs`, `tests/module-submission.test.mjs`, backend `integrations/base44/module-submissions/`; змінити `AGENTS.md` тільки після затвердження точного винятку та `USER_GUIDE.md`/UI повідомлення.  
**Інтерфейси:** `sanitizeModuleStructure(instance, approvedContract) → StructureSubmission`; `submitStructure(payload, revisionId) → receipt`; `reviewSubmission(id, decision) → reviewedDefinitionVersion`. Залежність: L1/L3, A1, O10.

- [ ] Затвердити allowlist: ролі/типи/зв'язки/версії, допустимі параметри вигляду. Вільні тексти, URL, CSS, формули/вирази можуть містити дані: правило для них потрібне окремо, не трактувати їх автоматично як нешкідливу «структуру».
- [ ] Тести: значення рядків, назви користувацьких колонок/таблиць, шляхи, токени в стилях/URL і невідомі поля не виходять; відмова санітизації не блокує локальну роботу.
- [ ] `node --test tests/module-submission.test.mjs`; Rust `module_submissions::tests`. До реалізації відсутній strict serializer.
- [ ] Автозапис після прийнятої зміни визначення, не кожного рендеру; повтор тієї самої версії ідемпотентний; зміна структури створює нову ревізію.
- [ ] Рекомендація: перед масовим розповсюдженням власник перевіряє submission, сумісність і залежності; отриманий опис не виконується як JS/SQL. «Автоматично надіслати власнику» не означає «автоматично встановити всім».
- [ ] Зафіксувати ліцензію/право поширення описів і маршрут для несумісних версій каталогу перед запуском. Наявні користувацькі модулі не перезаписуються новим шаблоном.
- [ ] Тести та дозволені backend-перевірки → коміт `feat: submit sanitized module structures for reviewed publication`.

### A8. C6/C7 — LAN і підтверджена «Дельта»

**Файли:** пропоновані `src-tauri/src/collective/lan.rs`, `relay_state.rs`, `docs/adr/lan-relay-handover.md`; Delta-адаптер визначати окремим планом лише після G10.  
**Інтерфейси:** той самий `Transport.push/pull` A6; `relayStatus() → authority/lease/cursor`. Залежність: A6, O08, окреме рішення про LAN-host policy.

- [ ] Тести LAN: той самий пакет через два посередники не дублюється; підроблений посередник не читає/не підміняє; недоступний колишній host не означає автоматичну втрату журналу.
- [ ] `cargo test --locked --manifest-path src-tauri/Cargo.toml collective::lan::tests`; спочатку адаптер відсутній. E2EE і підпис залишаються обов'язковими для посередника.
- [ ] Автоматична зміна комп'ютера-сервера — окрема задача узгодження повноважень/журналу. Перевірити split-brain, розрив мережі, повернення старого host й атомарну передачу; не просто обирати «перший онлайн».
- [ ] Рекомендація для першого LAN-пілота: явне призначення host із контрольованим handover; автоматичні вибори лише після погодженої моделі та випробувань.
- [ ] Для «Дельти» отримати конкретну систему й офіційні умови, auth/API та допустимість payload. Без цього не писати вигаданий endpoint, не підміняти її іншим сервісом.
- [ ] LAN-перевірки на двох машинах → коміт `feat: add verified lan collective transport`; Delta має власний план і приймання після G10.

## Відкриті рішення цього плану

O02–O17 головного ROADMAP у відповідних рядках. Дозвіл власника про післяфактумні дані — продуктове рішення маршрутизації, а не технічне доведення відсутності чутливості. Фактичний організаційний дозвіл та дозволені видимі метадані залишаються окремими воротами до реальних даних.
