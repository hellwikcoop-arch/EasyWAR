# EasyWAR architecture

## 1. Objective

Turn the proven single-file EasyWAR application into a maintainable local-first desktop product without discarding its verified parsing and analytics behavior.

## 2. Target architecture

```text
                 ┌────────────────────┐
Signal ─────────▶│ Signal adapter      │
Paste ──────────▶│ Intake adapters     │
XLSX ───────────▶│                    │
                 └─────────┬──────────┘
                           ▼
                 ┌────────────────────┐
                 │ Intake / Parser     │
                 │ deterministic rules│
                 └─────────┬──────────┘
                           ▼
                 ┌────────────────────┐
                 │ Review workflow     │
                 │ NEW / PARSED /      │
                 │ NEEDS_REVIEW /      │
                 │ APPROVED / REJECTED │
                 └─────────┬──────────┘
                           ▼
┌──────────────────────────────────────────────────┐
│ Tauri 2 application core                        │
│ Rust commands · services · integration boundary │
└──────────────────────┬───────────────────────────┘
                       ▼
                 ┌──────────────┐
                 │ SQLite       │
                 │ migrations   │
                 │ audit trail  │
                 └──────┬───────┘
                        ▼
            ┌──────────────────────┐
            │ Existing Web UI      │
            │ HTML/CSS/JS initially│
            │ dashboard + intake   │
            └──────────────────────┘
```

## 3. Platform strategy

### Desktop
- Tauri 2 as the cross-platform shell.
- macOS and Windows are first-class targets.
- The current HTML/CSS/JavaScript UI is embedded first; framework migration is optional and must be justified by product need.

### macOS-specific work
Use native macOS/Swift tooling only for functionality that cannot be expressed cleanly through the shared desktop core.

## 4. Persistence

SQLite is the application store.

Initial logical domains:
- `reports`
- `targets`
- `platforms`
- `munitions`
- `units`
- `signal_messages`
- `attachments`
- `manual_reviews`
- `revision_history`
- `audit_log`
- `settings`

Schema details are versioned through migrations.

The first implemented schema and its invariants are documented in
[`DATABASE.md`](DATABASE.md). It deliberately covers provenance and audit
foundations only; domain repositories are added incrementally.

The first read-only SQLite analytics boundary is documented in
[`ANALYTICS.md`](ANALYTICS.md). It exposes a versioned Tauri model derived only
from current `APPROVED` revision snapshots. It does not expose raw sources,
intermediate parses, rejected revisions, audit identity, or automatic approval.

## 5. Data provenance

Every intake item carries provenance.

Required concepts:
- immutable raw source
- source type
- source timestamp
- parser version
- parsed payload
- manual overrides
- approval status
- audit timestamps

Do not merge raw, parsed and approved values into one destructive mutable blob.

## 6. Signal integration

Signal is an intake transport, not the database.

```text
Signal
  ↓
signal-cli daemon (localhost)
  ↓ JSON-RPC / event stream
EasyWAR Signal Adapter
  ↓
allowlist / group rules
  ↓
Signal Inbox
  ↓
Parser
  ↓
Human review
  ↓
Approved record
```

Default posture:
- localhost only;
- deny unless an allowed source/group is configured;
- no automatic approval of operational records;
- credentials and Signal storage never enter Git.

## 7. XLSX compatibility

XLSX remains an import/export and migration boundary because existing workflows depend on it.

The desktop database becomes the durable application model, but compatibility with the existing `Зведена` sheet must be preserved during transition.

## 8. Integration boundary

Optional adapters may include:
- Signal
- Google Drive backup/export
- OpenAI-assisted parsing or summarization
- other approved sources

Adapters are disabled by default when they can transmit source data outside the device.

### Локальний помічник — етап 1

Панель «КОМБАТ» — додатковий локальний адаптер довідки й перевірки
відкритих даних; мовна модель необов'язкова й підключається окремо (див. нижче). Явне увімкнення в діалозі профілів
діє лише протягом поточного входу; після виходу, блокування, зміни профілю
або перезапуску помічник вимкнений. Налаштування й історія не зберігаються;
тимчасова розмова та результати існують лише в пам'яті вікна.
Навігація відкриває на явний клік наявні панелі профілів, резервних копій
та оновлень. Статус оновлення береться з тимчасового типізованого стану
штатного оновлювача; КОМБАТ не запускає перевірку чи встановлення.

Довідка використовує вбудований індекс фіксованого переліку документів.
Відповіді — уривки з посиланням «файл → розділ», без додаткових запитів до
бази записів. Перевірка запускається лише явно й читає вже відкритий
контекст активного розблокованого модуля: розібрану модель УДШВ, байти
ПС/РВ у пам'яті через наявний `parseStrikes` або знімок видимої вкладки
«Наші втрати». Основна таблиця ПВК та Артилерія поки не підтримуються.
Результат описує знімок на момент явної перевірки; SQLite-джерело
дашборда відхиляється без підміни раніше відкритим XLSX.

`src/assistant/assistant-rules-core.js` обгортає наявний `reviewData` і
повертає пояснення та пропозиції до зауважень. Він не викликає
`applyReview`, не змінює джерело чи схвалені записи і не виконує текст
клітинок або команд. Асинхронні результати перевіряються на відповідність
поточному профілю й контексту. Помічник не додає міграцій, SQL-доступу чи
мережі; capabilities, CSP, оновлювач і Signal-політика залишаються окремими
межами. Чернетки тексту — окремий наступний етап.

Необов'язкова локальна модель (`src-tauri/src/local_model.rs`) — дочірній
процес-рушій із пакета, який користувач підключає вручну: фіксований шлях без
оболонки й порту, очищене середовище, SHA-256 маніфесту, рушія й моделі,
рядки JSON у stdin/stdout, один запит за раз, зупинка при скасуванні,
таймауті, бездіяльності, виході з профілю й закритті застосунку. Для цього є
сім окремих Tauri-команд (стан, вибір пакета, вмикання, забування, генерація
з `Channel`, скасування, зупинка); налаштування — один ключ
`app.local_model.v1` у наявній таблиці `settings`, без міграції. Модель бачить
лише підготовлений запит із фактами довідки; кнопки дій і джерела формує код,
а будь-яка помилка чи відхилена відповідь веде до точної відповіді довідки.
Деталі — [ASSISTANT.md](ASSISTANT.md).

## 9. Testing

Use synthetic fixtures only.

Required gates by layer:
- parser regression suite;
- schema/migration tests;
- adapter contract tests;
- desktop build verification;
- UI smoke tests;
- data-provenance invariants;
- no-network tests for local-only workflows.
