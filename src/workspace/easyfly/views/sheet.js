// Форма польотного листа: лише те, що є на бланку і чого немає в хронометражі.
// Чернетка повторює розділи й колонки паперового бланка. Прізвищ з паперу сюди не підставляється.
import { formatDate, formatDuration } from '../fly-core.js';
import { saveSheet } from '../fly-state.js';
import { renderSheetHtml } from '../sheet-html.js';
import { blankSheetRow, emptyMinima, needsMinima, sheetFromTimings } from '../timing-core.js';
import { button, dateInput, el, field, numberInput, readDate, textInput, toast } from '../ui.js';

const picked = new Set();
let activeId = null;

const MINIMA = [
  ['cloudTakeoff', 'Хмари для зльоту, м'],
  ['cloudLand', 'Хмари для посадки, м'],
  ['visTakeoff', 'Видимість для зльоту, км'],
  ['visLand', 'Видимість для посадки, км'],
  ['windTakeoff', 'Вітер для зльоту, м/с'],
  ['windLand', 'Вітер для посадки, м/с'],
];

function numOrNull(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const number = Number(text);
  return Number.isInteger(number) ? number : null;
}

function roleBox(title, value, { callsign = false } = {}) {
  const rank = textInput(value?.rank || '', { placeholder: 'звання', maxLength: 40 });
  const name = textInput(value?.name || '', { placeholder: 'прізвище та ім’я', maxLength: 80 });
  const call = callsign ? textInput(value?.callsign || '', { placeholder: 'позивний', maxLength: 40 }) : null;
  const root = el('fieldset', { class: 'ef-crew' },
    el('legend', { text: title }),
    field('Звання', rank).root,
    field('ПІБ', name).root,
    call ? field('Позивний', call).root : null);
  return { rank, name, call, read: () => ({ rank: rank.value.trim(), name: name.value.trim(), callsign: call ? call.value.trim() : '' }), root };
}

export function render(ctx) {
  const timings = (ctx.data.timings || []).filter(item => item.status === 'confirmed');
  const sheet = (ctx.data.sheets || []).find(item => item.id === activeId) || null;
  const crew = sheet?.header?.crew && typeof sheet.header.crew === 'object' ? sheet.header.crew : {};
  const manual = dateInput('');
  const type = textInput(sheet?.header?.aircraftType || '', { placeholder: 'тип ПС', maxLength: 30 });
  const tail = textInput(sheet?.header?.tailNumber || '', { placeholder: 'бортовий номер', maxLength: 12 });
  const ke = roleBox('КЕ', crew.ke, { callsign: true });
  const lsh = roleBox('ЛШ', crew.lsh);
  const bt = roleBox('БТ', crew.bt);
  const instructor = roleBox('ЛІ, якщо є', crew.instructor);
  const extra = textInput(crew.extra || '', { placeholder: 'додатковий член екіпажу', maxLength: 80 });
  const task = textInput(sheet?.header?.task || '', { maxLength: 200 });
  const report = textInput(sheet?.report || '', { maxLength: 400 });
  const minimaInputs = { day: {}, night: {} };
  for (const part of ['day', 'night']) {
    for (const [key] of MINIMA) {
      minimaInputs[part][key] = textInput(sheet?.header?.minima?.[part]?.[key] || '', { maxLength: 12 });
    }
  }
  const exercises = timings.filter(item => picked.has(item.id)).map(item => item.exercise).filter(Boolean);
  const minimaWrap = el('div', { hidden: !needsMinima(`${task.value} ${exercises.join(' ')}`) });
  const refreshMinima = () => {
    const selected = timings.filter(item => picked.has(item.id)).map(item => item.exercise).filter(Boolean);
    minimaWrap.hidden = !needsMinima(`${task.value} ${selected.join(' ')}`);
  };
  task.addEventListener('input', refreshMinima);

  const readCrew = () => ({
    ke: ke.read(), lsh: lsh.read(), bt: bt.read(), instructor: instructor.read(), extra: extra.value.trim(),
  });
  const readMinima = () => {
    const next = emptyMinima();
    for (const part of ['day', 'night']) {
      for (const [key] of MINIMA) next[part][key] = minimaInputs[part][key].value.trim();
    }
    return next;
  };
  const readHeader = () => ({
    aircraftType: type.value.trim(),
    tailNumber: tail.value.trim(),
    crew: readCrew(),
    task: task.value.trim(),
    minima: readMinima(),
    showMinima: !minimaWrap.hidden,
    report: report.value.trim(),
  });

  const compose = () => {
    const selected = timings.filter(item => picked.has(item.id));
    const header = readHeader();
    const made = sheetFromTimings(selected, header);
    made.header = { ...made.header, ...header };
    made.report = header.report;
    const manualDate = readDate(manual);
    if (manualDate && !made.dates.includes(manualDate)) {
      made.dates.push(manualDate);
      made.rows.push({
        ...blankSheetRow(manualDate),
        aircraftType: header.aircraftType,
        tailNumber: header.tailNumber,
      });
    }
    const result = ctx.mutate(data => saveSheet(data, { ...made, id: activeId || undefined }));
    if (!result.ok) toast(result.result?.errors?.join(' ') || 'Не вдалося зберегти чернетку.', 'error');
    else activeId = result.result.id;
  };

  const boxes = timings.length
    ? timings.map(item => {
      const input = el('input', { type: 'checkbox', checked: picked.has(item.id) || null });
      input.addEventListener('change', () => {
        if (input.checked) picked.add(item.id); else picked.delete(item.id);
        refreshMinima();
      });
      return el('label', { class: 'ef-ke-row' },
        input,
        el('span', { class: 'ef-ban-who' },
          el('strong', { text: formatDate(item.date) || item.date }),
          el('span', { text: item.exercise ? `вправа ${item.exercise}` : 'без номера вправи' })));
    })
    : [el('p', { class: 'ef-glow-quiet', text: 'Підтверджених хронометражів ще немає. Дату можна обрати в календарі.' })];

  const minimaBlock = (part, title) => el('div', {},
    el('p', { class: 'ef-glow-quiet', text: title }),
    ...MINIMA.map(([key, label]) => field(label, minimaInputs[part][key]).root));
  minimaWrap.append(
    minimaBlock('day', 'Вдень'),
    minimaBlock('night', 'Вночі'));

  const preview = sheet ? el('iframe', {
    class: 'ef-sheet-frame', title: 'Чернетка польотного листа', srcdoc: renderSheetHtml(sheet),
  }) : null;

  const rows = sheet ? sheet.rows.map((row, index) => {
    const from = textInput(row.airfieldFrom || '', { maxLength: 40 });
    const to = textInput(row.airfieldTo || '', { maxLength: 40 });
    const weather = textInput(row.weather || '', { maxLength: 40 });
    const cabin = textInput(row.cabinMin ?? '', { placeholder: 'хв', inputMode: 'numeric', maxLength: 4 });
    const smu = textInput(row.smuMin ?? '', { placeholder: 'хв', inputMode: 'numeric', maxLength: 4 });
    const cloud = textInput(row.cloudMin ?? '', { placeholder: 'хв', inputMode: 'numeric', maxLength: 4 });
    const altitude = textInput(row.altitude || '', { maxLength: 12 });
    const system = textInput(row.landingSystem || '', { maxLength: 20 });
    const approaches = numberInput(row.minimaApproaches ?? '', { min: 0, max: 99 });
    const landings = numberInput(row.minimaLandings ?? '', { min: 0, max: 99 });
    const grade = textInput(row.grade || '', { maxLength: 12 });
    const apply = () => {
      const next = structuredClone(sheet);
      next.rows[index] = {
        ...next.rows[index],
        airfieldFrom: from.value.trim(),
        airfieldTo: to.value.trim(),
        weather: weather.value.trim(),
        cabinMin: numOrNull(cabin.value),
        smuMin: numOrNull(smu.value),
        cloudMin: numOrNull(cloud.value),
        altitude: altitude.value.trim(),
        landingSystem: system.value.trim(),
        minimaApproaches: numOrNull(approaches.value),
        minimaLandings: numOrNull(landings.value),
        grade: grade.value.trim(),
      };
      next.header = { ...next.header, ...readHeader() };
      next.report = report.value.trim();
      ctx.mutate(data => saveSheet(data, next));
    };
    for (const input of [from, to, weather, cabin, smu, cloud, altitude, system, approaches, landings, grade]) {
      input.addEventListener('change', apply);
    }
    const when = `${row.takeoff || '—'}–${row.landing || '—'}`;
    return el('details', { class: 'ef-ke-row' },
      el('summary', { text: `${formatDate(row.date) || 'Рядок'} · вправа ${row.exercise || '—'} · ${when} · ${formatDuration(row.airtimeMin) || '—'}` }),
      field('Аеродром зльоту', from).root,
      field('Аеродром посадки', to).root,
      field('Фактична погода', weather).root,
      field('У закритій кабіні, хв', cabin).root,
      field('СМУ, усього, хв', smu).root,
      field('У хмарах, хв', cloud).root,
      field('Висота польоту', altitude).root,
      field('Система заходження', system).root,
      field('Кількість заходів', approaches).root,
      field('Посадок при мінімумі', landings).root,
      field('Оцінка бойового застосування', grade).root);
  }) : [];

  return el('div', { class: 'ef-view ef-sheet' },
    el('header', { class: 'ef-today-head' }, el('h1', { text: 'Польотний лист' })),
    el('section', { class: 'ef-glow-card', 'data-ef': 'crew-form' },
      el('div', { class: 'ef-glow-card-head' }, el('h2', { text: 'Дані бланка' })),
      ...boxes,
      field('Або дата вручну', manual).root,
      field('Тип ПС', type).root,
      field('Бортовий номер', tail).root,
      ke.root, lsh.root, bt.root, instructor.root,
      field('Додатковий член екіпажу', extra).root,
      field('Завдання', task).root,
      minimaWrap,
      field('Донесення про виконання завдання', report).root,
      button('Скласти чернетку', { variant: 'primary', onClick: compose })),
    sheet
      ? el('section', { class: 'ef-glow-card' },
        el('div', { class: 'ef-glow-card-head' }, el('h2', { text: 'Чернетка бланка' })),
        ...rows,
        el('div', { class: 'ef-timing-actions' },
          button('Друкувати', { onClick: () => preview?.contentWindow?.print() }),
          button('Зберегти HTML', { onClick: async () => {
            const bytes = new TextEncoder().encode(renderSheetHtml(sheet));
            if (!ctx.host?.saveFileAs) { toast('Збереження файлу тут недоступне.', 'error'); return; }
            await ctx.host.saveFileAs({
              bytes, suggestedName: 'polotnyj-lyst.html', extensions: ['html'],
              title: 'Зберегти польотний лист', filterName: 'HTML',
            });
          } })),
        preview)
      : null);
}
