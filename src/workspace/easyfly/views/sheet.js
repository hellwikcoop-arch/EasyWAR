// Чернетка польотного листа з підтверджених хронометражів або з дати, вписаної вручну.
// Друк і файл HTML — чернетка, не документ. Прізвищ і штампів з паперу сюди не підставляється.
import { formatDate } from '../fly-core.js';
import { saveSheet } from '../fly-state.js';
import { renderSheetHtml } from '../sheet-html.js';
import { blankSheetRow, emptyMinima, sheetFromTimings, sheetTotals } from '../timing-core.js';
import { button, dateInput, el, field, readDate, select, textInput, toast } from '../ui.js';

const picked = new Set();
let activeId = null;

const MINIMA = [
  ['cloudTakeoff', 'Хмари, зліт, м'],
  ['cloudLand', 'Хмари, посадка, м'],
  ['visTakeoff', 'Видимість, зліт'],
  ['visLand', 'Видимість, посадка'],
  ['windTakeoff', 'Вітер, зліт'],
  ['windLand', 'Вітер, посадка'],
];

function numOrNull(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const number = Number(text);
  return Number.isInteger(number) ? number : null;
}

export function render(ctx) {
  const timings = (ctx.data.timings || []).filter(item => item.status === 'confirmed');
  const sheet = (ctx.data.sheets || []).find(item => item.id === activeId) || null;
  const manual = dateInput('');
  const type = textInput(sheet?.header?.aircraftType || '', { placeholder: 'Мі-8', maxLength: 30 });
  const tail = textInput(sheet?.header?.tailNumber || '', { placeholder: 'борт', maxLength: 12 });
  const crew = textInput(sheet?.header?.crew || '', { placeholder: 'позивні', maxLength: 80 });
  const task = textInput(sheet?.header?.task || '', { placeholder: 'вправа', maxLength: 80 });
  const start = textInput(sheet?.header?.startTime || '', { placeholder: 'ГГ:ХХ:СС', maxLength: 8 });
  const report = textInput(sheet?.report || '', { placeholder: 'донесення', maxLength: 200 });
  const minimaInputs = { day: {}, night: {} };
  for (const part of ['day', 'night']) {
    for (const [key] of MINIMA) {
      minimaInputs[part][key] = textInput(sheet?.header?.minima?.[part]?.[key] || '', { maxLength: 12 });
    }
  }

  const readHeader = () => {
    const next = emptyMinima();
    for (const part of ['day', 'night']) {
      for (const [key] of MINIMA) next[part][key] = minimaInputs[part][key].value.trim();
    }
    return {
      aircraftType: type.value.trim(),
      tailNumber: tail.value.trim(),
      crew: crew.value.trim(),
      task: task.value.trim(),
      startTime: start.value.trim(),
      minima: next,
    };
  };

  const compose = () => {
    const selected = timings.filter(item => picked.has(item.id));
    const made = sheetFromTimings(selected, readHeader());
    made.header = { ...made.header, ...readHeader() };
    const manualDate = readDate(manual);
    if (manualDate && !made.dates.includes(manualDate)) {
      made.dates.push(manualDate);
      made.rows.push({ ...blankSheetRow(manualDate), aircraftType: type.value.trim(), tailNumber: tail.value.trim() });
    }
    made.report = report.value.trim();
    const result = ctx.mutate(data => saveSheet(data, { ...made, id: activeId || undefined }));
    if (!result.ok) toast(result.result?.errors?.join(' ') || 'Не вдалося зберегти чернетку.', 'error');
    else activeId = result.result.id;
  };

  const boxes = timings.length
    ? timings.map(item => {
      const input = el('input', { type: 'checkbox', checked: picked.has(item.id) || null });
      input.addEventListener('change', () => { if (input.checked) picked.add(item.id); else picked.delete(item.id); });
      const flights = (item.events || []).filter(event => event.kind === 'takeoff').length;
      return el('label', { class: 'ef-ke-row' },
        input,
        el('span', { class: 'ef-ban-who' },
          el('strong', { text: formatDate(item.date) || item.date }),
          el('span', { text: `${flights} зльотів · ${item.note || ''}` })));
    })
    : [el('p', { class: 'ef-glow-quiet', text: 'Підтверджених хронометражів ще немає. Дату можна вписати вручну.' })];

  const minimaBlock = (part, title) => el('div', {},
    el('p', { class: 'ef-glow-quiet', text: title }),
    ...MINIMA.map(([key, label]) => field(label, minimaInputs[part][key]).root));

  const preview = sheet ? el('iframe', {
    class: 'ef-sheet-frame', title: 'Чернетка польотного листа', srcdoc: renderSheetHtml(sheet),
  }) : null;

  const rows = sheet ? sheet.rows.map((row, index) => {
    const exercise = textInput(row.exercise || '', { maxLength: 8 });
    const fta = textInput(row.fta || '', { maxLength: 20 });
    const fuel = textInput(row.fuelLiters ?? '', { inputMode: 'numeric', maxLength: 8 });
    const cargo = textInput(row.cargoKg ?? '', { inputMode: 'numeric', maxLength: 8 });
    const passengers = textInput(row.passengers ?? '', { inputMode: 'numeric', maxLength: 4 });
    const paratroopers = textInput(row.paratroopers ?? '', { inputMode: 'numeric', maxLength: 4 });
    const from = textInput(row.airfieldFrom || '', { maxLength: 40 });
    const to = textInput(row.airfieldTo || '', { maxLength: 40 });
    const weather = textInput(row.weather || '', { maxLength: 40 });
    const dayNight = select([{ value: 'day', label: 'День' }, { value: 'night', label: 'Ніч' }], row.dayNight || 'day');
    const apply = () => {
      const next = structuredClone(sheet);
      next.rows[index] = {
        ...next.rows[index],
        exercise: exercise.value.trim(),
        fta: fta.value.trim(),
        fuelLiters: numOrNull(fuel.value),
        cargoKg: numOrNull(cargo.value),
        passengers: numOrNull(passengers.value),
        paratroopers: numOrNull(paratroopers.value),
        airfieldFrom: from.value.trim(),
        airfieldTo: to.value.trim(),
        weather: weather.value.trim(),
        dayNight: dayNight.value,
      };
      next.header = readHeader();
      next.report = report.value.trim();
      ctx.mutate(data => saveSheet(data, next));
    };
    for (const input of [exercise, fta, fuel, cargo, passengers, paratroopers, from, to, weather]) {
      input.addEventListener('change', apply);
    }
    dayNight.addEventListener('change', apply);
    return el('details', { class: 'ef-ke-row' },
      el('summary', { text: `${formatDate(row.date) || row.date || 'Рядок'} · ${row.exercise || 'без вправи'}` }),
      field('Зліт з', from).root, field('Посадка на', to).root, field('Погода', weather).root,
      field('Вправа', exercise).root, field('День / ніч', dayNight).root, field('ФТА', fta).root,
      field('Паливо, л', fuel).root, field('Вантаж, кг', cargo).root,
      field('Пасажири', passengers).root, field('Парашутисти', paratroopers).root);
  }) : [];

  return el('div', { class: 'ef-view ef-sheet' },
    el('header', { class: 'ef-today-head' }, el('h1', { text: 'Польотний лист' })),
    el('section', { class: 'ef-glow-card' },
      el('div', { class: 'ef-glow-card-head' }, el('h2', { text: 'Підтверджені хронометражі' })),
      ...boxes,
      field('Або дата вручну', manual).root,
      field('Тип ПС', type).root, field('Борт №', tail).root,
      field('Екіпаж', crew).root, field('Завдання', task).root, field('Стартовий час', start).root,
      minimaBlock('day', 'Мінімум удень'), minimaBlock('night', 'Мінімум уночі'),
      field('Донесення', report).root,
      button('Скласти чернетку', { variant: 'primary', onClick: compose })),
    sheet
      ? el('section', { class: 'ef-glow-card' },
        el('div', { class: 'ef-glow-card-head' }, el('h2', { text: `Чернетка · усього ${sheetTotals(sheet.rows).all.count}` })),
        el('p', { class: 'ef-glow-quiet', text: 'Порожні клітинки заповніть тут. Друк — альбомний A4, це не документ.' }),
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
