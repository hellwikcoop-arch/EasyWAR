// Імпорт з Excel: приймає CSV/TSV-файл (через host.openFile) або вставлені з буфера рядки,
// читає 38 колонок за позицією, показує підсумок і помилки за номерами рядків. Дані додаються
// лише після кнопки «Імпортувати». Справжні таблиці не зберігаються: усе у пам'яті сторінки.
import { IMPORT_COLUMN_COUNT, formatDuration } from '../fly-core.js';
import {
  analyzeImport, applyImport, decodeText, mappingRows, parseDelimited,
} from '../fly-state.js';
import {
  button, card, dash, dateInput, dateText, el, emptyState, field, notice, pageHeader, readDate, select, stat, table, textArea, toast,
} from '../ui.js';

/** Стан екрана живе між перемальовуваннями, поки відкрито застосунок. */
const state = { rows: null, source: '', defaultDate: '', header: 'auto', skipDuplicates: true, onlyValid: false, showMapping: false, showWarnings: false, pasted: '' };

function reset() {
  Object.assign(state, { rows: null, source: '', defaultDate: '', header: 'auto', skipDuplicates: true, onlyValid: false, showMapping: false, showWarnings: false, pasted: '' });
}

async function pickFile(ctx) {
  let opened;
  try {
    opened = await ctx.host.openFile({ extensions: ['csv', 'tsv', 'txt'], title: 'Файл для імпорту польотів', filterName: 'Текстові таблиці (CSV, TSV)' });
  } catch (error) {
    toast(`Не вдалося відкрити файл: ${error?.message || error}`, 'error');
    return;
  }
  if (!opened) return;
  try {
    state.rows = parseDelimited(decodeText(opened.bytes));
    state.source = opened.name;
  } catch (error) {
    toast(`Не вдалося розібрати файл: ${error?.message || error}`, 'error');
  } finally {
    if (opened.handle) { try { await ctx.host.closeFile(opened.handle); } catch { /* файл імпорту не зберігається */ } }
  }
  ctx.rerender();
}

export function render(ctx) {
  const { data } = ctx;
  const root = el('div', { class: 'ef-view' });
  root.append(pageHeader({
    crumbs: [{ label: 'EasyFLY' }, { label: 'Імпорт з Excel' }],
    title: 'Імпорт даних частини',
    subtitle: 'Попередній перегляд і зіставлення полів · лише локальні файли',
  }));

  const paste = textArea(state.pasted, { rows: 4 });
  paste.setAttribute('placeholder', 'Вставте рядки з Excel (Ctrl+V): стовпці розділені табуляцією');
  paste.setAttribute('aria-label', 'Вставлені рядки з Excel');
  const defDate = dateInput(state.defaultDate);
  const header = select([{ value: 'auto', label: 'Визначити автоматично' }, { value: 'yes', label: 'Так' }, { value: 'no', label: 'Ні' }], state.header);

  const parsePasted = () => {
    state.pasted = paste.value;
    state.rows = parseDelimited(paste.value);
    state.source = 'Вставлено з буфера';
    state.defaultDate = readDate(defDate) || '';
    state.header = header.value;
    ctx.rerender();
  };
  const reparse = () => { state.defaultDate = readDate(defDate) || ''; state.header = header.value; ctx.rerender(); };

  root.append(card(null,
    el('span', { class: 'ef-eyebrow', text: 'Файл для імпорту' }),
    el('div', { class: 'ef-import-source' },
      el('span', { class: 'ef-import-name', text: state.source || 'Файл не вибрано' }),
      button('Обрати файл', { variant: 'secondary', iconName: 'vidkryty', onClick: () => pickFile(ctx) }),
      el('span', { class: 'ef-pill ef-pill-green', text: 'Без мережі' })),
    el('p', { class: 'ef-hint ef-hint-block', text: `Формат: CSV або TSV (збережіть аркуш Excel як CSV) чи вставлені рядки. Шаблон має ${IMPORT_COLUMN_COUNT} колонок; їх читають за позицією, а не за назвою.` }),
    el('details', { class: 'ef-details', open: !state.rows },
      el('summary', { text: 'Вставити рядки з буфера' }),
      paste, el('div', { class: 'ef-actions' }, button('Розібрати вставлене', { variant: 'secondary', onClick: parsePasted }))),
    el('div', { class: 'ef-form-grid' },
      field('Дата зміни для рядків без дати', defDate, { hint: 'дд.мм.рррр; необов’язково' }).root,
      field('Перший рядок — заголовок', header).root),
    state.rows ? el('div', { class: 'ef-actions' }, button('Застосувати параметри', { variant: 'ghost', onClick: reparse })) : null));

  if (!state.rows) {
    root.append(emptyState('Немає даних', 'Оберіть файл або вставте рядки, щоб побачити попередній перегляд. Нічого не додається, доки ви не натиснете «Імпортувати».'));
    return root;
  }

  const analysis = analyzeImport(state.rows, data, { defaultDate: state.defaultDate || null, header: state.header === 'auto' ? 'auto' : state.header === 'yes' });
  const s = analysis.summary;
  const hasHeader = analysis.stats.header;

  root.append(el('div', { class: 'ef-stats ef-stats-4' },
    stat('Рядків у файлі', s.rows),
    stat('Польотів до імпорту', analysis.records.length - (state.skipDuplicates ? s.duplicates : 0), { tone: 'green' }),
    stat('Рядки з помилками', s.invalidRows + (s.fileError ? 1 : 0), { tone: s.invalidRows || s.fileError ? 'red' : 'green' }),
    stat('Дублікати', s.duplicates, { tone: s.duplicates ? 'amber' : '' })));

  if (analysis.unknownCallsigns.length) {
    root.append(notice('Позивних немає в особовому складі:', `${analysis.unknownCallsigns.join(', ')}. Польоти буде імпортовано без прив’язки до пілота; додайте пілотів, щоб зв’язати записи.`, { tone: 'amber' }));
  }

  // Перегляд помилок
  if (analysis.errorRows.length) {
    root.append(el('section', { class: 'ef-alert ef-alert-red', 'aria-labelledby': 'ef-imp-err' },
      el('strong', { id: 'ef-imp-err', text: s.fileError ? 'Файл не вдалося прочитати:' : `${analysis.errorRows.length} ${analysis.errorRows.length === 1 ? 'рядок' : 'рядків'} з помилками — їх не буде імпортовано:` }),
      el('ul', { class: 'ef-errors' }, analysis.errorRows.slice(0, 50).map(item => el('li', {},
        el('b', { text: `Рядок ${item.row}: ` }),
        item.errors.map(e => (e.columnTitle ? `${e.columnTitle} (стовпець ${e.column}) — ${e.message}` : e.message)).join(' · ')))),
      analysis.errorRows.length > 50 ? el('p', { class: 'ef-muted', text: `Показано перші 50 з ${analysis.errorRows.length} рядків.` }) : null));
  }

  // Попередній перегляд
  const preview = analysis.records.slice(0, 5);
  root.append(card(`Попередній перегляд · перші ${preview.length} ${preview.length === 1 ? 'рядок' : 'рядків'}`,
    preview.length
      ? table([
        { label: 'Рядок', render: r => String(r.row) },
        { label: 'Дата', render: r => dateText(r.date) },
        { label: 'Позивний', render: r => r.commander },
        { label: 'Вправа', render: r => dash(r.exercises.join(', ')) },
        { label: 'К-сть', render: r => String(r.count) },
        { label: 'Наліт', render: r => dash(formatDuration(r.airtimeMin)) },
        { label: 'День/ніч', render: r => (r.dayNight === 'night' ? 'Ніч' : r.dayNight === 'day' ? 'День' : '—') },
        { label: 'Борт', render: r => dash(r.tailNumber) },
      ], preview, { caption: 'Попередній перегляд імпорту' })
      : el('p', { class: 'ef-muted', text: 'Коректних рядків для перегляду немає.' }),
    el('p', { class: 'ef-muted', text: `Показано ${preview.length} з ${analysis.records.length}.` })));

  // Попередження
  if (analysis.warnings.length) {
    root.append(el('details', { class: 'ef-card ef-details', open: state.showWarnings, onToggle: e => { state.showWarnings = e.target.open; } },
      el('summary', { text: `Попередження (${analysis.warnings.length})` }),
      el('ul', { class: 'ef-errors' }, analysis.warnings.slice(0, 50).map(w => el('li', { text: w.message })))));
  }

  // Зіставлення колонок
  root.append(el('details', { class: 'ef-card ef-details', open: state.showMapping, onToggle: e => { state.showMapping = e.target.open; } },
    el('summary', { text: `Зіставлення колонок (${IMPORT_COLUMN_COUNT})` }),
    el('div', { class: 'ef-mapping' }, table([
      { label: '№', render: r => String(r.number) },
      { label: 'Колонка шаблону', render: r => r.title },
      { label: 'Група', render: r => r.group },
      { label: 'Приклад із першого рядка', render: r => dash(r.sample) },
    ], mappingRows(state.rows, hasHeader), { caption: 'Колонки шаблону імпорту' })),
    el('p', { class: 'ef-hint ef-hint-block', text: 'Колонки зіставляються за позицією. Назви «Вправа» та «Інший екіпаж» повторюються, тому за назвою їх розрізнити не можна.' })));

  // Застосування
  const skipDup = el('input', { type: 'checkbox', id: 'ef-skip-dup', checked: state.skipDuplicates });
  skipDup.addEventListener('change', () => { state.skipDuplicates = skipDup.checked; ctx.rerender(); });
  const onlyValid = el('input', { type: 'checkbox', id: 'ef-only-valid', checked: state.onlyValid });
  onlyValid.addEventListener('change', () => { state.onlyValid = onlyValid.checked; ctx.rerender(); });
  const count = analysis.records.length - (state.skipDuplicates ? s.duplicates : 0);
  const blockedByErrors = (s.invalidRows > 0 && !state.onlyValid) || s.fileError;
  const doImport = () => {
    const result = ctx.mutate(d => applyImport(d, analysis.records, { skipDuplicates: state.skipDuplicates, duplicateRows: analysis.duplicateRows }));
    if (!result.ok) { toast(result.result.errors.join(' '), 'error'); return; }
    const { added, skipped } = result.result;
    reset();
    toast(`Імпортовано польотів: ${added}${skipped ? `, пропущено дублікатів: ${skipped}` : ''}. Щоб записати у файл, натисніть «Зберегти».`);
  };
  root.append(el('section', { class: 'ef-card ef-import-apply' },
    el('div', { class: 'ef-checks' },
      el('label', { class: 'ef-check-label' }, skipDup, ' Не імпортувати дублікати'),
      s.invalidRows ? el('label', { class: 'ef-check-label' }, onlyValid, ' Імпортувати лише коректні рядки (рядки з помилками буде пропущено)') : null),
    el('p', { class: blockedByErrors ? 'ef-text-overdue' : 'ef-muted', text: blockedByErrors
      ? 'Помилки потребують виправлення перед імпортом: виправте файл і оберіть його знову або дозвольте пропустити рядки з помилками.'
      : `Буде додано польотів: ${count}.` }),
    el('div', { class: 'ef-actions' },
      button('Скасувати', { variant: 'secondary', onClick: () => { reset(); ctx.rerender(); } }),
      button(`Імпортувати (${count})`, { variant: 'primary', disabled: blockedByErrors || count < 1, onClick: doImport }))));
  return root;
}
