# Контрольний список production-релізу EasyWAR

Цей документ є обов’язковим шлюзом випуску, а не підтвердженням готовності
версії 1.0. Реліз дозволений лише тоді, коли всі обов’язкові пункти для обох
платформ позначені як виконані та мають відтворювані докази.

## Правило GO / NO-GO

- **GO:** усі обов’язкові пункти нижче виконані, докази збережені в release
  notes або маніфесті артефактів, а відповідальна особа зафіксувала рішення.
- **NO-GO:** будь-який обов’язковий пункт не виконаний, має лише непрямий доказ
  або позначений «не перевірено».
- Винятки не можна оформлювати усно. Вони потребують окремого письмового
  рішення з ризиком, власником, строком усунення та планом відкочування.
- Ad-hoc підписаний macOS bundle є лише локальною технічною перевіркою. Він не
  замінює `Developer ID Application`, notarization або Gatekeeper acceptance.

## 1. Ідентичність релізу

- [ ] Визначено номер версії та release commit/tag.
- [ ] Версії збігаються в `package.json`, `src-tauri/Cargo.toml` і
  `src-tauri/tauri.conf.json`.
- [ ] `HEAD` збігається з потрібним remote ref; робоче дерево не містить
  неврахованих release-змін.
- [ ] Release notes перелічують зміни, відомі обмеження, несумісності та кроки
  оновлення.
- [ ] У репозиторії й артефактах немає реальних операційних XLSX/CSV/SQLite,
  Signal-даних, токенів, ключів, сертифікатів або приватних вкладень.

## 2. Автоматизовані перевірки

Виконати з чистого checkout за зафіксованими залежностями:

```bash
npm ci
npm run test:unit
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
```

- [ ] Усі команди завершилися з кодом `0`; повні версії Node.js, npm, Rust і
  Tauri CLI записані в release evidence.
- [ ] Немає пропущених або вимкнених тестів, які покривають release scope.
- [ ] Побудований frontend не містить випадкових зовнішніх ресурсів або
  production secrets.

## 3. SQLite, міграції та відновлення

- [x] Чиста база створюється послідовним застосуванням усіх міграцій.
- [x] Підтримувана база попередньої версії оновлюється без втрати raw source,
  parsed values, manual corrections, approved records та audit log.
- [x] Повторний запуск міграцій не пошкоджує базу й не створює дублікати.
- [x] Перед оновленням створюється перевірена резервна копія.
- [ ] In-app restore проходить preflight, контрольований restart і повторну
  перевірку цілісності на синтетичній копії.
- [x] Перерване оновлення або swap відновлюється за перевіреним rollback
  сценарієм.
- [ ] Інструкція відновлення відповідає фактичному UI і перевірена на чистій
  машині. Поточні відомі межі див. у
  [`BACKUP_AND_RECOVERY.md`](BACKUP_AND_RECOVERY.md).

## 4. Безпека та цілісність даних

- [ ] Signal intake залишається deny-by-default; приймаються лише явно дозволені
  account/group/sender.
- [ ] Автоматичне схвалення звітів вимкнене; рішення `APPROVED` / `REJECTED`
  прив’язане до reviewer і відображене в audit log.
- [ ] Raw source незмінний; виправлення та ревізії зберігаються окремо.
- [ ] Локальні HTTP/SSE endpoints доступні лише через loopback і мають обмежені
  таймаути, розмір та lifecycle.
- [ ] Журнали, помилки й crash reports не розкривають чутливі дані.
- [ ] Tauri capabilities містять лише потрібні дозволи; винятки CSP окремо
  задокументовані та прийняті як release risk.

## 5. XLSX-сумісність

- [ ] Імпорт еталонного workbook проходить без зміни оригінального файлу.
- [ ] Експортований workbook відкривається в підтримуваному Excel/LibreOffice та
  зберігає 15 legacy fields, заголовки, типи дат/часу й порядок даних.
- [x] Повний regression comparison із legacy CORE пройдено на синтетичному
  наборі, включно з неоднозначними заголовками, датами та дублями.
- [ ] Exact-duplicate provenance посилається на канонічний попередній звіт, але
  не видаляє жодне джерело.
- [ ] Reference workbook workflow перевірено окремо від operational data.

## 6. Функціональне acceptance-тестування

- [ ] Український UI перевірено на підтримуваних macOS і Windows.
- [ ] Створення/відкриття локальної бази, intake, parser review, manual
  corrections, approve/reject, пошук і audit log пройдені end-to-end.
- [ ] Dashboard, period filters, effectiveness, aircraft/munitions/unit
  breakdowns, data-quality view, map abstraction та export views перевірені на
  синтетичній базі.
- [ ] Якщо Signal входить до release scope: реальний встановлений `signal-cli`,
  linked-account QR, discovery, receive session, reconnect і manual Stop
  перевірені з тестовим обліковим записом та телефоном.
- [ ] Offline запуск і основні локальні сценарії працюють без мережі.
- [ ] Accessibility: клавіатурна навігація, видимий focus, системний zoom та
  читабельність обох тем пройдені.

## 7. macOS production artifact

Локальний ad-hoc gate можна повторити командою `npm run build:macos:adhoc`, але
його результат не можна використовувати як production release.

- [ ] Release build підписаний дійсною і навмисно обраною ідентичністю
  `Developer ID Application`; сертифікат і credentials не збережені в Git.
- [ ] Hardened Runtime та потрібні entitlements перевірені й мінімізовані.
- [ ] `codesign --verify --deep --strict` проходить для `.app`.
- [ ] Артефакт відправлено до Apple notary service; статус `Accepted` збережено
  як доказ.
- [ ] Notarization ticket прикріплено (`stapler`) до розповсюджуваного
  артефакту.
- [ ] `spctl --assess` і запуск після завантаження на чистому підтримуваному Mac
  проходять без обходу Gatekeeper.
- [ ] DMG проходить `hdiutil verify`; ім’я, версія, архітектура та SHA-256
  внесені до маніфесту.

Детальна межа підпису: [`MACOS_PACKAGING.md`](MACOS_PACKAGING.md).

## 8. Windows production artifact

- [ ] Installer зібрано на підтримуваному Windows toolchain для заявленої
  архітектури.
- [ ] Executable та installer підписані production code-signing certificate;
  timestamp і ланцюжок довіри перевірені.
- [ ] Clean-VM install, перший запуск, SQLite migrations та створення ярликів
  пройдені без developer tools.
- [ ] Оновлення з попередньої підтримуваної версії зберігає дані та має
  перевірений rollback/backup шлях.
- [ ] Uninstall не видаляє користувацьку базу без явного попередження та вибору.
- [ ] Defender/SmartScreen acceptance перевірено без ручного обходу; hash
  installer внесений до маніфесту.

## 9. Маніфест, публікація та відкочування

- [ ] Для кожного артефакту записані платформа, архітектура, точне ім’я, розмір,
  SHA-256, commit SHA, дата складання та статус підпису/notarization.
- [ ] Release notes містять посилання на backup/recovery, міграції, відомі
  обмеження й канали повідомлення про дефект.
- [ ] Артефакти повторно завантажені з release storage і їхні SHA-256 збігаються
  з маніфестом.
- [ ] Визначені owner рішення GO/NO-GO, owner rollback і попередня стабільна
  версія для повернення.
- [ ] Післяпублікаційний smoke test виконано на фактично опублікованих macOS та
  Windows артефактах, а не на локальних копіях.

## Підсумкове рішення

- [ ] **GO:** усі обов’язкові пункти вище мають прямі докази.
- [ ] Release version / tag: `____________________`
- [ ] Commit SHA: `_____________________________`
- [ ] macOS SHA-256: `__________________________`
- [ ] Windows SHA-256: `________________________`
- [ ] Рішення та відповідальна особа: `_____________________________`
- [ ] Дата й час рішення: `______________________`

Якщо перший пункт цього розділу не позначений, production-реліз має статус
**NO-GO**.
