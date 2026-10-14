# 3D-моделі EasyWAR: покажчик для швидкого старту

Усе, що стосується 3D, лежить у кількох файлах `src/`. Не шукайте по всьому проєкту: починайте звідси.

## Файли моделей (`src/models/*.glb`, формат glTF Binary)

| Файл | Що це | Носом у напрямку (`nose`) | Розмір | Джерело |
|---|---|---|---|---|
| `mig-29.glb` | МіГ-29 «Ukrainian Falcons» | +z | 7,6 МБ | Sketchfab, 42manako, CC BY 4.0 |
| `su-27.glb` | Су-27П1М | +z | 9,2 МБ | Sketchfab, 42manako, CC BY 4.0 |
| `mirage-2000-5f.glb` | Mirage 2000-5F | −z | 9,5 МБ | Sketchfab, 42manako, CC BY 4.0 |
| `su-24.glb` | Су-24 зі Storm Shadow | +z | 2,2 МБ | Sketchfab, CC BY 4.0 |
| `su-25.glb` | Су-25М | +z | 9,4 МБ | Sketchfab, CC BY 4.0 |
| `f-16.glb` | F-16 | +x | 0,75 МБ | Sketchfab, CC BY 4.0 |
| `gripen.glb` | JAS 39 Gripen (стаття зі статусом «Очікується») | +z | 0,7 МБ | Sketchfab, CC BY 4.0 |
| `storm-shadow.glb` | Storm Shadow / SCALP-EG, спрощена процедурна модель | +x, довжина 4 | 13 КБ | згенерована |
| `gmlrs-m31.glb` | ракета GMLRS M31, спрощена процедурна модель | +x, довжина 4 | 39 КБ | згенерована |

Автори, посилання й ліцензії — `src/models/CREDITS.md`. Ліцензія CC BY 4.0 вимагає вказувати автора, тому стаття довідника показує посилання на автора й джерело. Моделі стиснуто для застосунку (meshopt, зменшені текстури). Генератор двох спрощених моделей, `viewer/scripts/build-munitions.py`, лежить в іншому репозиторії (CLOUDE), у цьому його немає.

## Процедурні боєприпаси (малюються кодом, без .glb)

`src/munition-3d.js` (≈1250 рядків, three.js). Словник `MODELS`, ключі експортує `KINDS`: `62` (GBU-62), `64` (GBU-64), `39` (GBU-39), `53` (GBU-53), `agm88`, `aasm` (AASM-250), `blu140`, `c13` (С-13), `bomb` (загальна). Експорт: `buildModel(kind)`, `mount(el, kind, {motion})`, `explodeCycle`, `spreadLabels`.

## Процедурні боєприпаси «Артилерії» (малюються кодом, без .glb)

Довідник модуля «Артилерія» має власні процедурні моделі: `RefViewer` будує їх через `buildShell(kind)`, якщо `SHELL_KINDS.includes(model.kind)`. Усі повертають `{ group, wings, explode, labels }` (ніс у +X, `explode(k)` розсуває блоки вздовж осі, `labels` — підписи частин), довжина нормована до 4.

- `src/artillery-3d.js` (≈ 530 рядків): снаряди ствольної артилерії, міни, реактивний снаряд 122 мм, високоточні снаряди й метальні заряди. Тіла обертання (`lathe`) з розмальовкою на канві (`Skin`) за габаритами з bk155.com.ua і відкритих довідників.
- `src/artillery-fuze-3d.js` (≈ 200 рядків): 23 підривники (`FUZE_KINDS`, ключі `fuze-…`). Кожен описано рядком таблиці `FUZES` (повна й видима довжина, діаметр, форма оживала, кільце, ковпак, деталь на носі, написи), а будує всіх один `buildFuzeModel`. Довжина нормована до 4, діаметр голівки не більший за 1,8: масивні підривники виходять коротшими. Діаметр і видима довжина — зі сторінок сайту, де їх немає — оцінка (це сказано у фактах варіанта). Модуль підключено в `artillery-3d.js` (`BUILDERS`, а отже й `SHELL_KINDS`).
- `src/artillery-ref-data.js`: групи (`GROUPS`), статті (`ENTRIES`), варіанти (`variantsOf`), для кожного `model: { kind }` і `credit`. Підривники — група `fuze` і п'ять статей (`fzpd`, `fzmt`, `fzet`, `fzpx`, `fzgps`) із `noTable: true`: таблиця витрати не має груп підривників, тому `refExtra` в `artillery-app.js` повертає `null` і блок «У вашій таблиці» прихований.
- `tests/artillery-ref.test.mjs`: довжина, межі діаметра, підписи, розкладання й збирання, відповідність моделей і статей, перелік варіантів.

Як додати підривник: рядок у `FUZES`, варіант `F(...)` у статті (унікальний `kind`), запис в очікуваних варіантах і кількість (23) у тесті «fuze models»; `node --test tests/artillery-ref.test.mjs`.

## Хто що завантажує

- **Картка вильоту (модуль ПС, `src/air.html`):** `mwKind(munition)` → `window.Munition3D.mount(...)` → `src/munition-3d-loader.js` (ліниво `import('./munition-3d.js')`).
- **Довідник по озброєнню:** `src/ref-wiki.js` → ліниво `src/ref-viewer.js` (`RefViewer`; `GLTFLoader` + `MeshoptDecoder`; `MODEL_FILES` з шляхами `new URL('./models/….glb', import.meta.url)`, **шлях має бути дослівним**, інакше Vite не покладе файл у збірку).
- **Дані статей і прив'язка модель ↔ стаття:** `src/ref-data.js` (`model: { file, nose }` для .glb або `{ kind }` для процедурних; `credit`).
- **Спільна сцена** (рендерер, світло, підлога, тінь): `src/stage-3d.js`.

## Тести й обмеження

- `tests/munition-3d.test.mjs`: процедурні моделі.
- `tests/artillery-ref.test.mjs`: процедурні моделі «Артилерії» (снаряди, заряди, підривники) і їхні статті.
- `tests/ref-wiki.test.mjs`: кожен `.glb` має починатися з `glTF`, бути менше 12 МБ (згенеровані менше 1 МБ), вимагати лише розширень `EXT_meshopt_compression`/`KHR_mesh_quantization`, мати `asset.extras.license` з CC-BY-4.0; у `CREDITS.md` має бути посилання або ім'я файлу кожної моделі.

## Як додати нову .glb-модель

1. Покласти файл у `src/models/`, стиснути (meshopt), лишити в межах обмежень вище.
2. Додати `new URL('./models/<ім'я>.glb', import.meta.url).href` у `MODEL_FILES` (`src/ref-viewer.js`).
3. Додати статтю або запис з `model: { file, nose }` і `credit` у `src/ref-data.js`.
4. Додати автора/джерело/ліцензію в `src/models/CREDITS.md`.
5. `node --test tests/ref-wiki.test.mjs tests/munition-3d.test.mjs`.
