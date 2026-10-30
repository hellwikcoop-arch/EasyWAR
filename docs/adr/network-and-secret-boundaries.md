# ADR: мережеві межі й сховище секретів (P1)

**Статус:** **Рішення власника 29.10.2026 (JE, контроль J5; журнал `easywar-staff/tasks/T-0016/je-decision-R3.md`):
JE-18 — варіант Ф** (зашифрований файл з Argon2id, ключі розділені за профілями; перед
реалізацією перевірити зміну пароля, відновлення, ізоляцію профілів, знищення ключів і поведінку
після аварійного завершення; профіль без пароля не має доступу до колективів); **JE-21 — варіант а**
(CSP вмикається окремим контрольованим PR за інвентарем розділу 5 з перевірками legacy HTML, WASM
«Офісу», workers, 3D, карт, IPC, Windows/macOS; `'unsafe-inline'` не є повним усуненням
XSS-ризику, залишкові ризики документуються; **до приймання CSP і інших мережевих gates LAN
listener не запускається**). У цьому етапі додано лише чисту функцію `network_policy` (`src-tauri/src/network_policy.rs`, без команд
Tauri і без мережевих викликів) і файловий тест меж `tests/network-boundary.test.mjs`. Наявні
мережеві виклики **не** переписані, CSP, `capabilities`, `build.rs`, `generate_handler!`,
`Cargo.lock` не змінені.  
**Етапи:** P1 ([`plans/2026-10-21-easywar-platform-release.md`](../plans/2026-10-21-easywar-platform-release.md)),
далі C3b (підключення до команд), C2 (сховище секретів), C6a (listener — лише після JE-21).  
**Пов'язане:** [`collective-sync-policies.md`](collective-sync-policies.md) (єдина політика
`networkPolicy` → `routeFor` → `syncPolicy`), [`collective-crypto.md`](collective-crypto.md),
`docs/BACKLOG.md` P2-1, P2-2, P2-3, P2-16; `docs/WORKSPACE.md` «Ізоляція» (F-01).

## Контекст

EasyWAR — local-first: кожна зовнішня інтеграція вимкнена, поки користувач її не ввімкне
(`AGENTS.md`). Сьогодні кожен мережевий виклик перевіряє свої умови сам (або не перевіряє), а
CSP головного вікна = `null`. Перед будь-яким прослуховуванням колективу (C6a–C6c, C8) і
сховищем ключів (C2) потрібна одна точка рішення й задокументовані межі.

## 1. Інвентар мережевих викликів (стан `main` f5b857c)

| Призначення (`Purpose`) | Де код | Адреса | Тригер | Що йде назовні | Умова сьогодні | Таймаут / скасування |
|---|---|---|---|---|---|---|
| `weather_online` | `weather_online.rs`, команди `weather_online_fetch` / `weather_online_search` (`lib.rs`) | `api.open-meteo.com`, `geocoding-api.open-meteo.com` (HTTPS, без редиректів) | кнопка «Оновити зараз» чи перемикач онлайн-оновлення в «Обстановці» (`src/workspace/weather/app.js`) | округлені координати або назва місця для пошуку | перемикач у JS; **Rust-команда умову не перевіряє** (G) | таймаут клієнта reqwest; скасування — ні |
| `model_install` | `model_install.rs` | адреса джерела моделі (типово `huggingface.co`, HTTPS; `allow_insecure` лише явно) | кнопка встановлення моделі + нативний діалог з хостом і розміром | User-Agent, діапазон байтів для дозавантаження | діалог підтвердження на кожне завантаження; HTTPS або явний `allow_insecure` | є (докачування, перевірка розміру); скасування — закриття діалогу прогресу |
| `app_update` | `app_update.rs`, `update_settings.rs` (`tauri-plugin-updater`) | endpoint з `tauri.conf.json` (`latest.json` релізів), пакет оновлення | кнопка «Перевірити оновлення» або щоденна автоперевірка, якщо ввімкнена | версія застосунку й платформа (плагін) | автоперевірка — лише за `AutoUpdateSettings.enabled`; підпис пакета перевіряється `pubkey` | плагін; скасування — ні |
| `signal_daemon` | `signal_daemon.rs`, `signal_session.rs`, політика `signal_policy.rs` | лише loopback (`127.0.0.1`/`::1`/unix socket; інша адреса → помилка політики) | увімкнення приймання Signal, перелік відправників непорожній | JSON-RPC до локального `signal-cli` | `SignalAdapterConfig.intake_enabled` + allowlist; loopback перевіряє `signal_policy` | таймаути клієнта |
| `collective_lan` (майбутнє, C6a) | немає | LAN-адреса, яку вводить користувач | — | зашифровані конверти (ADR crypto) | **відхилено завжди** до C3b, JE-17, JE-21 | — |
| `collective_base44` (майбутнє, C4) | немає | проєкт Base44 власника | — | зашифровані конверти класів A–C | **відхилено завжди** до G01–G05 | — |
| `collective_peer_wan` (ціль, C8) | `pair_relay.rs` (етапи 2а–2б, 30.10.2026): клієнти `PairServer` (сервер зустрічі для вступу за кодом) і `RelayClient` (EasyWAR Relay для зашифрованих пакетів); HTTP-сервер — лише в окремому режимі `easywar --relay-server`, Relay — лише з `--data` і списком колективів оператора | прямий Інтернет-канал або погоджений проміжний EasyWAR | ручний вибір WAN після «Доповісти»; вступ за кодом | лише зашифровані конверти (будь-який клас за явним вибором, рішення JE 30.10.2026 00:21Z і 09:47Z); для вступу — номер скриньки, повідомлення PAKE і зашифровані кадри; relay не читає дані | **відхилено завжди**: клієнт не створюється без `GatePolicy.wan_transport_accepted` (`CURRENT` = false) до незалежного огляду й правки `AGENTS.md` | таймаут клієнта 20 с, тіло сервера ≤ 1 MiB і 20 с; черга Relay ≤ 100 МБ, пакет ≤ 24 год |

Виклики з webview (не через Rust): плитки карт і dimap у legacy `air.html`/`rocket.html`
(розділ 5), решта `fetch` у `src/*.js` — лише власні ресурси застосунку (`asset`/`tauri`
походження: `.glb`, відео заставки, map-assets, довідники, шаблони телефону). Тест
`tests/network-boundary.test.mjs` закріплює цей перелік як регресійний тест (межі тесту — розділ 6):
новий `fetch`/`XMLHttpRequest`/`WebSocket`/`EventSource`/`sendBeacon` поза ним ламає тест.

Заплановані, ще не реалізовані передачі: Q12 (структура модулів) і Q13/К11 (лічильник
інсталяцій) — за винятком власника в `AGENTS.md`; у політику додаються як окремі `Purpose`
після рішення власника про код.

### Онлайн-канал «КОМБАТ» (уточнення T-0021)

Це окремий мережевий шлях поза Rust-`Purpose`: клієнт webview у
`src/assistant/assistant-cloud.js` використовує `fetchImpl = fetch` і `fetchImpl(url, ...)`.
Адреса проходить `chatEndpoint`: лише HTTPS, шлях `/v1/chat`, або явно дозволений
loopback `http://127.0.0.1:8765`. Передаються введені користувачем повідомлення та
доступна історія онлайн-діалогу, а не локальні таблиці. Окремий Node-проксі
`server/kombat/proxy.mjs` викликає `fetchImpl` за фіксованою адресою
`https://api.anthropic.com/v1/messages`, застосовуючи автентифікацію, стан увімкнення
та резервування бюджету. Це не дозвіл на інші мережеві канали чи платні тестові запити.

`tests/network-boundary.test.mjs` виявляє `fetchImpl(...)` у `src/**`, обліковує
онлайн-клієнт і перевіряє єдиний вихідний виклик Node-проксі. Це статична
регресійна перевірка, а не доказ відсутності інших динамічних аліасів чи повний аудит
мережі; поведінкові перевірки — `tests/assistant-cloud.test.mjs` та
`tests/kombat-proxy.test.mjs`.

## 2. `networkPolicy(profile, purpose)` — перший шар єдиної політики

Реалізовано в `src-tauri/src/network_policy.rs`:

```text
network_policy(&NetworkContext, Purpose) -> Verdict::Allowed | Verdict::Denied(reason)
```

- `NetworkContext` — лише прапорці: мітка вікна, профіль відкритий, профіль має пароль,
  онлайн-погода ввімкнена, автооновлення ввімкнене, завантаження моделі підтверджене,
  приймання Signal увімкнене. Секретів і адрес у контексті немає.
- Порядок перевірок сталий: **вікно → профіль → призначення → умови призначення**. Невідоме
  призначення (`Purpose::parse` → `None`) відхиляється. `collective_*` відхиляються завжди до
  C3b (`StageNotAuthorized`), а профіль без пароля — ще раніше (`ProfileWithoutPassword`,
  `COLLECTIVES_PLAN.md` §6 «для профілю без пароля колектив не вмикати»).
- Причини відмови — закритий перелік `Denied` з українським текстом без адрес і даних.
- **Правило «вікно з даними не має мережі»:** мережевий виклик може ініціювати лише головне
  вікно (`main`); вікна редактора «Офісу» (`office-editor*`) — ні. Це вже так за
  `capabilities/office-editor.json` (лише 5 команд `office_*`), політика лише повторює це як
  явну першу перевірку.

**Що робить C3b (не R3):** команди `weather_online_*`, `model_install_*`, `app_update_*`,
`signal_*` викликають `network_policy` перед запитом і повертають `Denied::message()`; поточна
прогалина — `weather_online_fetch` без перевірки перемикача в Rust — закривається там само.
Далі `networkPolicy` → `routeFor` (C1a) → `syncPolicy` (C1d) утворюють одну послідовність для
колективу (ADR sync-policies).

## 3. Сховище секретів — варіанти для JE-18

Інтерфейс (C2): `secretStore.read / write / delete(purpose, profile)` у Rust; JS отримує лише
статус («є ключ / немає / заблоковано»), ніколи секрет. `purpose` — мітка (`collective/member-sign`,
`collective/member-x25519`, `collective/device-sign`, `collective/epoch/<id>/<n>`), прив'язана до
профілю. Жодної паралельної системи поза цим адаптером (P1).

| | Варіант Ф — файл + Argon2id (зразок `office_library.rs`) | Варіант С — системне сховище (Keychain / Credential Manager) |
|---|---|---|
| Де лежить | файл у даних профілю, зашифрований XChaCha20-Poly1305 ключем з Argon2id від пароля профілю (параметри в обгортці, як LDK бібліотеки); окремий `recovery`-слот — як у бібліотеці | записи ОС, прив'язані до користувача ОС; доступ після входу в ОС |
| Нові крейти | **немає** (усе вже є) | `keyring` або прямі виклики Security.framework / Windows Credential Manager (нові залежності, платформні гілки) |
| Прив'язка до профілю EasyWAR | природна: ключ від пароля профілю; **профіль без пароля — колектив недоступний** | слабка: будь-який процес користувача ОС читає запис; треба додатково шифрувати ключем профілю — тоді варіант Ф усе одно потрібен |
| Резервна копія / перенесення | разом із даними профілю (`backup.rs`), на іншому ПК відкривається паролем | не переноситься; після перевстановлення ОС ключі втрачено → відкликання (К4) |
| Зміна пароля | повторна обгортка ключа (`prepare_password_rewrap`, уже є в бібліотеці) | не торкається |
| Зловмисник із правами користувача ОС | бачить файл, але без пароля — ні (Argon2id, 64 МіБ) | читає запис напряму (без пароля) |
| Відомий недолік | C05 бібліотеки: ключ даних не змінюється при зміні пароля — для колективу закривається епохами (відкликання → нова епоха) | платформний код не перевіряється в хмарній сесії (Linux) |
| G06 (Windows + macOS однаково) | так, один код | дві реалізації, дві перевірки |

**Рекомендація J3 (не рішення): варіант Ф** у C2 з тим самим шаблоном, що й бібліотека «Офісу»
(Argon2id-обгортка, HKDF-підключі з мітками `easywar/collective/v1/*`, `zeroize`), і правилом
«профіль без пароля → `collective_*` відхилено» (уже в `network_policy`). Системне сховище —
можливе доповнення пізніше для кешу розблокованого ключа на сеанс, не як джерело істини.

## 4. Умови для listener (C6a) — що має бути до старту

1. JE-21 вирішено: CSP головного вікна не `null` **або** письмове прийняття ризику P2-1.
2. `network_policy` підключено до команд (C3b), `collective_lan` переведено з
   `StageNotAuthorized` на умови: профіль з паролем, колектив відкритий, користувач увімкнув
   обмін у LAN, адреса введена вручну (без mDNS до JE-17).
3. Listener — лише в головному процесі Rust, окремий `tokio` task з лімітами (розмір конверта,
   кількість з'єднань, таймаут), слухає лише на адресі, яку обрав користувач; вимкнений за
   замовчуванням; без доступу до команд Tauri (G11).
4. Жодних портів у webview; webview отримує лише стан і результат.

## 5. Додаток: перелік ресурсів для CSP (вхід для JE-21; CSP у R3 не змінюється)

Що завантажує webview сьогодні (інвентар для майбутньої політики замість `null`; «надто вузька
політика без перевірки не вважається виправленням», план P1):

| Директива | Потрібно для | Джерело |
|---|---|---|
| `default-src 'self'` | усі власні сторінки (`tauri://localhost`, `http://tauri.localhost`, `asset://`, `http://asset.localhost`; у dev — `http://localhost:5173`) | `desktop_shell.rs::is_app_url` |
| `script-src 'self' 'unsafe-inline'` (або хеші/nonce Tauri) | 22 + 19 + 4 inline-скрипти в `air.html`, `rocket.html`, `index.html` (legacy, «Legacy HTML editing»); модулі Vite | legacy HTML |
| `script-src 'wasm-unsafe-eval'` | WASM «Офісу»: `workspace/easygreen/app/*`, `easydoc/wordcraft-web_bg.wasm`, `easyslide/deckcraft-web_bg.wasm` | `src/workspace/*/app.js` |
| `worker-src 'self' blob:` | web worker карти з `Blob` (`src/map-app.js`), worker-и редакторів | `map-app.js`, `src/public/workspace/*` |
| `img-src 'self' data: blob: https://tile.openstreetmap.org https://server.arcgisonline.com https://clarity.maptiles.arcgis.com https://tiles.planet.com` | плитки карт через `img.src` (`air.html`/`rocket.html`), вбудовані зображення (`data:`), експорт у `blob:` | legacy HTML, `tilesStatus` |
| `frame-src https://dimap.live` | вбудований dimap («Підключення до dimap.live», `dm-gate`) | `air.html`/`rocket.html` |
| `media-src 'self'` | відео заставки `splash/easywar-intro.mp4` | `startup-splash.js` |
| `connect-src 'self' ipc: http://ipc.localhost` | `fetch` власних ресурсів (`.glb`, `map-assets`, довідники, шаблони), IPC Tauri | `guide-kit.js`, `map-app.js`, `phone-export.js`, `presentation-art.js`, `dashboard-module-weather-3d.js` |
| `style-src 'self' 'unsafe-inline'` | inline-стилі legacy і Vite | legacy HTML |
| `object-src 'none'`, `base-uri 'self'` | — | беклог P2-1 |
| **Не потрібно в CSP** | Open-Meteo, оновлення, модель, Signal — усе через Rust (`reqwest`/плагін), не через webview | розділ 1 |
| Зовнішні посилання | `signal.me` (`index.html`), джерела довідників — відкриваються в системному браузері (`is_external_link`), у CSP не входять | `desktop_shell.rs` |

Ризики, які JE-21 має врахувати: ключ Planet зараз у `localStorage` (`aviahub.planetKey`,
беклог P2-2) і потрапляє в URL плиток; `'unsafe-inline'` для скриптів лишає P2-1 лише частково
закритим, поки legacy HTML не перейде на хеші; `frame-src` dimap — єдиний сторонній iframe.
Варіанти для рішення: (а) увімкнути CSP з таблиці вище одним PR з перевіркою всіх
legacy/WASM/3D сценаріїв (скіл `run-easywar`); (б) письмово прийняти ризик P2-1 до E8 і
заборонити listener; (в) CSP лише для нових сторінок (`src/workspace/*`, `src/guides/*`) через
окремі вікна, legacy — пізніше.

## 6. Межі самого тесту меж (зауваження J5 P1-01)

`tests/network-boundary.test.mjs` — **регресійний тест меж на рівні файлів**, не доказ
відсутності мережевих шляхів: він ловить новий `fetch`/`reqwest`/хост у відомих місцях (мутант
у `src/sensitivity-core.js` перевірено), але не бачить динамічно зібраних адрес, коду у
`src/public/**` (вендорні бандли «Офісу», three.js) і поведінки webview. Rust сканується
рекурсивно по `src-tauri/src/**`, але лише текстово. Поведінкові перевірки (непогоджена мережа
не виконується, XSS-подібна назва джерела не виконує скрипт, редактор не отримує прав, logout
стирає сеанс) — у C3b через скіл `run-easywar` і на Windows/macOS. **P2-1 не вважається
закритим** ні цим тестом, ні CSP з `'unsafe-inline'` (проміжний варіант, доки legacy HTML не
перейде на хеші): закриття — лише після рішення JE-21, окремого scoped CSP PR і поведінкових
XSS/CSP перевірок на Windows і macOS.

## Наслідки

- До C3b поведінка застосунку не змінюється: модуль не викликається.
- Будь-який новий `Purpose`, новий модуль з `reqwest`/`std::net`, новий зовнішній хост у legacy
  HTML чи новий `fetch` у `src/*.js` вимагає рядка в цьому ADR і правки
  `tests/network-boundary.test.mjs` — інакше CI червоний.
- `tauri-plugin-http` і `tauri-plugin-shell` не додаються: webview не отримує прямого HTTP.

## Відкрите для власника

Вирішено 29.10.2026: JE-18 (Ф, розділ 3), JE-21 (а, розділ 5). **Відкрите:** JE-17 (mDNS — поза
R3); накази на C2 і CSP — окремо, не запускаються автоматично.

## Перевірки

`cargo test --locked --manifest-path src-tauri/Cargo.toml network_policy` (9 тестів: закритий
контекст, чуже вікно, кожне призначення, невідоме ім'я, `collective_*` завжди відхилені, тексти
відмов без адрес); `node --test tests/network-boundary.test.mjs` (мережеві виклики в `src/*.js`
лише з переліку, зовнішні хости legacy лише з переліку, `reqwest`/`std::net` лише в модулях з
переліку, `network_policy` без IPC-команди, редактор без мережі, без HTTP/shell-плагінів,
CSP = `null` зафіксовано як відомий ризик P2-1 — друкується, не падає; перелік `Purpose` у Rust
збігається з розділом 1).
