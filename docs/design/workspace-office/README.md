# Макет оболонки «Робоче середовище» → «Офіс»

Пакет макета від власника (20.10.2026), перенесений у `src/workspace/` (див. [WORKSPACE.md](../../WORKSPACE.md), розділ «Вигляд»).

- [`SPEC.md`](SPEC.md) — токени, розміри, стани, тексти; [`DIRECTION.md`](DIRECTION.md) — рішення макета.
- `png/` — еталонні знімки (Chromium), `icons/` — SVG застосунків (у коді — `APP_ICONS` у `src/workspace/workspace-core.js`), `render-checks.json` — перевірки знімків.
- Відступ від макета: шрифт UAF Sans замість IBM Plex Sans/Mono (рішення власника 20.10.2026).
- Не додано: `office-reference.html` (160 КБ, зі вбудованими шрифтами) і `fonts/` — ті самі файли IBM Plex уже лежать у `src/guides/fonts/` з ліцензіями.
