// Панель «Оновити з нового файла» на сторінці модуля (E3в): людина вибирає нову версію таблиці,
// бачить, що саме зміниться, і лише потім застосовує. Тут лише показ і виклики: порівняння —
// table-update-core.js, підписи — table-update-view-core.js, читання файла — наявні команди
// `pick_module_source` / `inspect_linked_module_source` / `read_module_source_sheet`, запис —
// `replace_dashboard_module_rows` з перевіркою позначки версії. Файл таблиці лише читається.

import { importRows, planImport, rankSheets, sheetOptionLabel } from './dashboard-module-source-core.js';
import { replaceRowsRequest, rowForStorage } from './dashboard-module-catalog-core.js';
import { UPDATE_LIMITS, applyDiff, correctedCellsFor, diffRows, previewDiff, suggestKeyColumns } from './table-update-core.js';
import { changeText, hasChanges, keyOptions, readiness, rowLabel, summaryLines } from './table-update-view-core.js';

/**
 * `payload` — дані модуля зі сторінки (рядки й виправлення); `onApplied(result)` викликається після
 * успішного запису, `onConflict(error)` — коли таблицю вже змінили деінде. Повертає `<details>` з
 * методом `release()` (забути огляд файла в Rust).
 */
export function updatePanel({ el, invoke, module, payload, onApplied, onConflict }) {
  const fields = Array.isArray(module.fields) ? module.fields : [];
  const labelOf = new Map(fields.map(field => [field.key, field.label || field.key]));
  const oldRows = Array.isArray(payload.rows) ? payload.rows : [];
  const corrections = Array.isArray(payload.corrections) ? payload.corrections : [];
  const model = {
    workbook: null, selection: '', ranked: [], sheet: '', newRows: null, key: [], suggestions: [],
    removed: 'keep', diff: null, busy: false, origin: '',
  };
  const status = el('p', { class: 'ewmc-update-status', role: 'status' });
  const body = el('div', { class: 'ewmc-update-body' });
  const panel = el('details', { class: 'ewmc-update', 'data-module': module.id },
    el('summary', {}, el('span', { text: 'Оновити з нового файла' })),
    el('p', { class: 'ewmc-update-hint', text: 'Виберіть нову версію таблиці: спершу ви побачите, які рядки додано, змінено чи зникло. Нічого не застосовується, доки ви не натиснете «Застосувати». Файл лише читається, ваші ручні виправлення лишаються.' }),
    status, body);

  const say = (text, error = false) => { status.textContent = text; status.classList.toggle('error', error); };

  function release() {
    const selection = model.selection;
    model.selection = '';
    if (selection) invoke('read_module_source_sheet', { selection, release: true }).catch(() => {});
  }
  panel.release = release;

  function reset() {
    Object.assign(model, { workbook: null, ranked: [], sheet: '', newRows: null, key: [], suggestions: [], removed: 'keep', diff: null });
  }

  async function choose(linked) {
    if (model.busy) return;
    model.busy = true;
    say('Читаю файл…');
    paint();
    try {
      const workbook = linked
        ? await invoke('inspect_linked_module_source', { branch: module.branch })
        : await invoke('pick_module_source');
      if (!workbook) { say(linked ? 'До профілю не підключено таблицю цього роду військ.' : '', linked); return; }
      release();
      reset();
      model.workbook = workbook;
      model.selection = workbook.selection;
      model.ranked = rankSheets(fields, workbook);
      const best = model.ranked[0];
      if (!best || best.matched === 0) {
        say('Назви стовпців файла не збігаються зі стовпцями модуля. Оновити можна лише таблицю з тими самими стовпцями.', true);
        return;
      }
      await openSheet(best.name);
    } catch (error) {
      say(String(error?.message || error), true);
    } finally {
      model.busy = false;
      paint();
    }
  }

  async function openSheet(name) {
    model.sheet = name;
    model.newRows = null;
    model.diff = null;
    const sheet = await invoke('read_module_source_sheet', { selection: model.selection, sheet: name });
    const plan = planImport(fields, sheet);
    const ready = readiness(plan);
    if (!ready.ok) { say(ready.message, true); return; }
    model.newRows = importRows(plan, { carryWeather: false });
    model.suggestions = suggestKeyColumns(fields, oldRows, model.newRows);
    model.key = model.suggestions[0]?.columns ? [...model.suggestions[0].columns] : [];
    say(model.key.length ? '' : 'Не вдалося знайти стовпець, за яким рядок упізнається однозначно. Виберіть його самі.');
    recompute();
  }

  function recompute() {
    model.diff = null;
    if (!model.newRows || !model.key.length) return;
    const result = diffRows({
      fields, oldRows, newRows: model.newRows, keyColumns: model.key,
      correctedCells: correctedCellsFor(oldRows, corrections, model.key),
    });
    if (!result.ok) { say(result.message, true); return; }
    say('');
    model.diff = result;
  }

  async function apply() {
    if (model.busy || !model.diff) return;
    const next = applyDiff(oldRows, model.diff, { removed: model.removed });
    if (!next.ok) { say(next.message, true); return; }
    model.busy = true;
    say('Збереження в локальній SQLite…');
    paint();
    try {
      const result = await invoke('replace_dashboard_module_rows', replaceRowsRequest(module, next.rows.map(row => rowForStorage(fields, row))));
      release();
      onApplied(result);
    } catch (error) {
      model.busy = false;
      if (/змінено в іншому вікні/iu.test(String(error?.message || error))) { onConflict(error); return; }
      say(String(error?.message || error || 'Не вдалося зберегти.'), true);
      paint();
    }
  }

  function keyChooser() {
    return el('fieldset', { class: 'ewmc-update-key' },
      el('legend', { text: `За якими стовпцями впізнається рядок (до ${UPDATE_LIMITS.maxKeyColumns})` }),
      keyOptions(fields).map(option => el('label', {},
        el('input', {
          type: 'checkbox', value: option.key, checked: model.key.includes(option.key),
          disabled: model.busy || (!model.key.includes(option.key) && model.key.length >= UPDATE_LIMITS.maxKeyColumns),
          onchange: event => {
            model.key = event.target.checked ? [...model.key, option.key] : model.key.filter(key => key !== option.key);
            recompute();
            paint();
          },
        }),
        ` ${option.label}`)));
  }

  function listOf(title, items, render) {
    if (!items.length) return null;
    return el('details', { class: 'ewmc-update-list' },
      el('summary', { text: title }),
      el('ul', {}, items.map(item => el('li', {}, render(item)))));
  }

  function diffView() {
    const diff = model.diff;
    if (!diff) return null;
    const shown = previewDiff(diff);
    const lines = summaryLines(diff);
    const kept = diff.keptCorrections;
    return el('div', { class: 'ewmc-update-diff' },
      lines.length
        ? el('ul', { class: 'ewmc-update-summary' }, lines.map(line => el('li', { 'data-kind': line.id, text: line.text })))
        : el('p', { class: 'ewmc-update-none', text: 'У новому файлі змін немає: усі рядки збігаються з таблицею модуля.' }),
      diff.counts.unchanged ? el('p', { class: 'ewmc-update-note', text: `Без змін: ${diff.counts.unchanged}.` }) : null,
      kept ? el('p', { class: 'ewmc-update-note', text: `Ваших ручних виправлень, що лишаються: ${kept}.` }) : null,
      diff.counts.ambiguous
        ? el('p', { class: 'ewmc-update-warn', text: 'Є рядки з однаковим ключем. Їх не зіставлено й не змінено; щоб їх оновити, виберіть інші ключові стовпці.' })
        : null,
      diff.counts.unkeyedOld || diff.counts.unkeyedNew
        ? el('p', { class: 'ewmc-update-warn', text: `Рядків без значення в ключових стовпцях: у таблиці ${diff.counts.unkeyedOld}, у файлі ${diff.counts.unkeyedNew}. Їх не зіставлено; додані з файла без ключа не з'являться.` })
        : null,
      listOf('Нові рядки', shown.added, item => rowLabel(item.row, diff.keyColumns)),
      listOf('Змінені рядки', shown.changed, item => [
        el('b', { text: rowLabel(item.newRow, diff.keyColumns) }),
        el('ul', {}, item.changes.map(change => el('li', { text: changeText(change, labelOf) }))),
      ]),
      listOf('Зниклі рядки (немає в новому файлі)', shown.removed, item => rowLabel(item.row, diff.keyColumns)),
      shown.truncated ? el('p', { class: 'ewmc-update-note', text: `Показано перші ${UPDATE_LIMITS.maxPreview} у кожному списку; застосовуються всі.` }) : null,
      diff.counts.removed
        ? el('fieldset', { class: 'ewmc-update-removed' },
          el('legend', { text: 'Що зробити зі зниклими рядками' }),
          el('label', {}, el('input', { type: 'radio', name: `ewmc-removed-${module.id}`, value: 'keep', checked: model.removed === 'keep', onchange: () => { model.removed = 'keep'; paint(); } }), ' Залишити в таблиці'),
          el('label', {}, el('input', { type: 'radio', name: `ewmc-removed-${module.id}`, value: 'remove', checked: model.removed === 'remove', onchange: () => { model.removed = 'remove'; paint(); } }), ' Видалити з таблиці'))
        : null,
      el('button', {
        type: 'button', class: 'btn primary', 'data-action': 'apply-update', text: 'Застосувати',
        disabled: model.busy || !hasChanges(diff, model.removed), onclick: apply,
      }));
  }

  function paint() {
    const sheets = model.ranked.length > 1
      ? el('label', { class: 'ewmc-update-sheet' }, 'Аркуш: ',
        el('select', {
          disabled: model.busy,
          onchange: async event => {
            model.busy = true; paint();
            try { await openSheet(event.target.value); } catch (error) { say(String(error?.message || error), true); }
            model.busy = false; paint();
          },
        }, model.ranked.map(entry => el('option', { value: entry.name, selected: entry.name === model.sheet, text: sheetOptionLabel(entry) }))))
      : null;
    // replaceChildren не пропускає null: порожні вузли відкидаємо самі.
    body.replaceChildren(...[
      el('div', { class: 'ewmc-update-pick' },
        el('button', { type: 'button', class: 'btn quiet', 'data-action': 'update-linked', text: 'Таблиця профілю', disabled: model.busy, onclick: () => choose(true) }),
        el('button', { type: 'button', class: 'btn quiet', 'data-action': 'update-file', text: 'Інший файл…', disabled: model.busy, onclick: () => choose(false) })),
      model.workbook ? el('p', { class: 'ewmc-update-file', text: `Файл «${model.workbook.fileName}»` }) : null,
      sheets,
      model.newRows ? keyChooser() : null,
      diffView(),
    ].filter(Boolean));
  }

  panel.addEventListener('toggle', () => { if (!panel.open) { release(); reset(); say(''); paint(); } });
  paint();
  return panel;
}
