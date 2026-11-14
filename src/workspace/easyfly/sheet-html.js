// Друкована чернетка польотного листа (Додаток 2). Порожні поля лишаються порожніми.
// Жодних прізвищ, штампів і аеродромів з паперу сюди не підставляється.
import { formatDate, formatDuration } from './fly-core.js';
import { sheetTotals } from './timing-core.js';

const esc = value => String(value ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const dash = value => (value === null || value === undefined || value === '' ? '' : esc(value));
const mins = value => (Number.isInteger(value) ? esc(formatDuration(value) || '') : '');

function minimaCell(block, key) {
  return dash(block?.[key]);
}

/** Самодостатній HTML чернетки: лицьовий бік і зворотний, для друку на A4 і для файлу. */
export function renderSheetHtml(sheet) {
  const header = sheet?.header || {};
  const rows = Array.isArray(sheet?.rows) ? sheet.rows : [];
  const totals = sheetTotals(rows);
  const minima = header.minima || {};
  const line = (label, value) => `<div class="line"><span>${label}</span><b>${dash(value)}</b></div>`;
  const miniRow = (title, block) => `<tr><th>${title}</th><td>${minimaCell(block, 'cloudTakeoff')}</td><td>${minimaCell(block, 'cloudLand')}</td><td>${minimaCell(block, 'visTakeoff')}</td><td>${minimaCell(block, 'visLand')}</td><td>${minimaCell(block, 'windTakeoff')}</td><td>${minimaCell(block, 'windLand')}</td></tr>`;
  const body = rows.map(row => `<tr>
    <td>${dash(formatDate(row.date) || row.date)}</td>
    <td>${dash(row.airfieldFrom)} / ${dash(row.airfieldTo)}</td>
    <td>${dash(row.weather)}</td>
    <td>${dash(row.aircraftType)} ${dash(row.tailNumber)}</td>
    <td>${row.dayNight === 'night' ? 'Н' : 'Д'}</td>
    <td>${dash(row.exercise)}</td>
    <td>${dash(row.takeoff)}</td>
    <td>${dash(row.landing)}</td>
    <td>${dash(row.count)}</td>
    <td>${mins(row.airtimeMin)}</td>
    <td>${mins(row.cabinMin)}</td>
    <td>${mins(row.smuMin)}</td>
    <td>${mins(row.cloudMin)}</td>
    <td>${dash(row.altitude)}</td>
    <td>${dash(row.minimaApproaches)}</td>
    <td>${dash(row.minimaLandings)}</td>
    <td>${dash(row.landingSystem)}</td>
    <td>${dash(row.grade)}</td>
    <td>${mins(row.airtimeMin)}</td>
    <td>${dash(row.fta)}</td>
    <td>${dash(row.fuelLiters)}</td>
    <td>${dash(row.cargoKg)}</td>
    <td>${dash(row.passengers)}</td>
    <td>${dash(row.paratroopers)}</td>
  </tr>`).join('');
  const foot = (title, pack) => `<tr><th>${title}</th><td colspan="7"></td><td>${pack.count}</td><td>${mins(pack.airtimeMin)}</td><td>${mins(pack.cabinMin)}</td><td>${mins(pack.smuMin)}</td><td>${mins(pack.cloudMin)}</td><td></td><td>${pack.minimaApproaches}</td><td>${pack.minimaLandings}</td><td colspan="7"></td></tr>`;
  return `<!doctype html><html lang="uk"><head><meta charset="utf-8"><title>Польотний лист · чернетка</title>
<style>
@page { size: A4 landscape; margin: 8mm; }
body { margin: 0; color: #111; background: #fff; font: 11px/1.3 "Times New Roman", serif; }
h1 { font-size: 16px; text-align: center; margin: 0 0 4px; letter-spacing: .04em; }
.sub { text-align: center; font-size: 10px; margin: 0 0 8px; }
.sheet { page-break-after: always; }
.line { display: flex; gap: 8px; margin: 3px 0; }
.line span { min-width: 11em; }
.line b { flex: 1; border-bottom: 1px solid #222; font-weight: 500; min-height: 1.1em; }
table { width: 100%; border-collapse: collapse; margin-top: 8px; }
th, td { border: 1px solid #222; padding: 2px 3px; vertical-align: top; font-weight: 400; }
th { font-size: 9px; }
.sign { margin-top: 12px; }
</style></head><body>
<section class="sheet">
<p class="sub">Додаток 2 до Правил виконання польотів державної авіації України · чернетка, не документ</p>
<h1>ПОЛЬОТНИЙ ЛИСТ</h1>
${line('Дата', formatDate(sheet?.dates?.[0]) || '')}
${line('Тип ПС і борт №', `${header.aircraftType || ''} ${header.tailNumber || ''}`.trim())}
${line('Екіпаж', header.crew)}
${line('Завдання / вправи', header.task)}
${line('Стартовий час', header.startTime)}
<table><caption>Польоти дозволяю: метеомінімум</caption>
<tr><th rowspan="2">Час доби</th><th colspan="2">Висота хмарності не нижче, м</th><th colspan="2">Польотна видимість не менше, км</th><th colspan="2">Швидкість вітру, м/с</th></tr>
<tr><th>для зльоту</th><th>для посадки</th><th>для зльоту</th><th>для посадки</th><th>для зльоту</th><th>для посадки</th></tr>
${miniRow('Вдень', minima.day)}${miniRow('Вночі', minima.night)}
</table>
<p class="sign">Командир екіпажу ____________________ · Командир авіаційної частини ____________________</p>
</section>
<section class="sheet">
<h1>Зворотний бік польотного листа</h1>
<table>
<tr>
<th>Дата</th><th>Аеродром зльоту / посадки</th><th>Фактична погода</th><th>Тип ПС, борт</th><th>Д/Н</th>
<th>№ вправи</th><th>Час зльоту</th><th>Час посадки</th><th>Кількість польотів</th><th>Загальний наліт</th>
<th>У закритій кабіні</th><th>СМУ усього</th><th>У хмарах</th><th>Висота</th>
<th>Заходи при мінімумі</th><th>Посадки при мінімумі</th><th>Система посадки</th><th>Оцінка</th>
<th>Загальний час польоту</th><th>ФТА</th><th>Паливо, л</th><th>Вантаж, кг</th><th>Пасажири</th><th>Парашутисти</th>
</tr>
${body || '<tr><td colspan="24">Немає рядків</td></tr>'}
${foot('Всього', totals.all)}
${foot('у тому числі вдень', totals.day)}
${foot('вночі', totals.night)}
</table>
<p class="sign">Донесення про виконання завдання</p>
<p class="line"><b>${dash(sheet?.report)}</b></p>
<p class="sign">Командир екіпажу ____________________</p>
</section>
</body></html>`;
}
