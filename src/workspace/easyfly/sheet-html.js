// Чернетка бланка польотного листа (Додаток 2): ті самі розділи й колонки, що на паперовому бланку.
// Порожні клітинки лишаються порожніми. Прізвищ, штампів і аеродромів з паперу сюди не підставляється.
import { formatDate, formatDuration } from './fly-core.js';
import { personBits, sheetTotals } from './timing-core.js';

const esc = value => String(value ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const cell = value => (value === null || value === undefined || value === '' ? '' : esc(value));
const mins = value => (Number.isInteger(value) ? esc(formatDuration(value) || '') : '');
const num = value => (Number.isInteger(value) && value ? esc(value) : '');

function minimaRow(title, block) {
  const pick = key => cell(block?.[key]);
  return `<tr><th>${title}</th><td>${pick('cloudTakeoff')}</td><td>${pick('cloudLand')}</td><td>${pick('visTakeoff')}</td><td>${pick('visLand')}</td><td>${pick('windTakeoff')}</td><td>${pick('windLand')}</td></tr>`;
}

/** Самодостатній HTML чернетки: лицьовий бік і зворотний, для друку на A4 і для файлу. */
export function renderSheetHtml(sheet) {
  const header = sheet?.header || {};
  const rows = Array.isArray(sheet?.rows) ? sheet.rows : [];
  const totals = sheetTotals(rows);
  const date = formatDate(sheet?.dates?.[0]) || '';
  const minima = header.showMinima ? `
<table>
<caption>Польоти дозволяю</caption>
<tr><th rowspan="2">Час доби</th><th colspan="2">Висота хмарності не нижче, м</th><th colspan="2">Польотна видимість не менше, км</th><th colspan="2">Швидкість вітру біля землі не більше, м/с</th></tr>
<tr><th>для зльоту</th><th>для посадки</th><th>для зльоту</th><th>для посадки</th><th>для зльоту</th><th>для посадки</th></tr>
${minimaRow('Вдень', header.minima?.day)}
${minimaRow('Вночі', header.minima?.night)}
</table>` : '';
  const body = rows.map(row => `<tr>
    <td>${cell(formatDate(row.date) || row.date)}</td>
    <td>${cell(row.airfieldFrom)} / ${cell(row.airfieldTo)}</td>
    <td>${cell(row.weather)}</td>
    <td>${cell(row.aircraftType)} ${cell(row.tailNumber)}</td>
    <td>${row.dayNight === 'night' ? 'Н' : 'Д'}</td>
    <td>${cell(row.exercise)}</td>
    <td>${cell(row.takeoff)}</td>
    <td>${cell(row.landing)}</td>
    <td>${cell(row.count)}</td>
    <td>${mins(row.airtimeMin)}</td>
    <td>${mins(row.cabinMin)}</td>
    <td>${mins(row.smuMin)}</td>
    <td>${mins(row.cloudMin)}</td>
    <td>${cell(row.altitude)}</td>
    <td>${cell(row.landingSystem)}</td>
    <td>${num(row.minimaApproaches)}</td>
    <td>${num(row.minimaLandings)}</td>
    <td>${cell(row.grade)}</td>
    <td>${mins(row.totalMin)}</td>
  </tr>`).join('');
  const foot = (title, pack) => `<tr><th colspan="8">${title}</th><td>${pack.count}</td><td>${mins(pack.airtimeMin)}</td><td>${mins(pack.cabinMin)}</td><td>${mins(pack.smuMin)}</td><td>${mins(pack.cloudMin)}</td><td></td><td></td><td>${num(pack.minimaApproaches)}</td><td>${num(pack.minimaLandings)}</td><td></td><td>${mins(pack.totalMin)}</td></tr>`;
  return `<!doctype html><html lang="uk"><head><meta charset="utf-8"><title>Польотний лист · чернетка</title>
<style>
@page { size: A4 landscape; margin: 8mm; }
body { margin: 0; color: #111; background: #fff; font: 10px/1.25 "Times New Roman", serif; }
h1 { font-size: 16px; text-align: center; margin: 4px 0; letter-spacing: .08em; }
.sub, .draft { text-align: center; font-size: 9px; margin: 0; }
.sheet { page-break-after: always; }
.line { margin: 4px 0; }
.muted { color: #333; }
table { width: 100%; border-collapse: collapse; margin-top: 8px; }
th, td { border: 1px solid #222; padding: 2px; vertical-align: top; font-weight: 400; text-align: center; }
th { font-size: 8px; }
.sign { margin-top: 10px; }
</style></head><body>
<section class="sheet">
<p class="sub">Додаток 2 до Правил виконання польотів державної авіації України (пункт 8 глави 1 розділу I)</p>
<p class="draft">чернетка, не документ</p>
<h1>ПОЛЬОТНИЙ ЛИСТ</h1>
<p class="line">Стартовий час. Дата ${cell(date)}. Початок ${cell(header.engineStart)}. Кінець ${cell(header.engineEnd)}. Підпис особи авіаційно-диспетчерської служби ________</p>
<p class="line">Командир екіпажу: ${cell(personBits(header.crew?.ke, true))}</p>
<p class="line">У складі екіпажу: ${cell([personBits(header.crew?.lsh), personBits(header.crew?.bt), personBits(header.crew?.instructor), header.crew?.extra].filter(Boolean).join('; '))}</p>
<p class="line">на ${cell(header.aircraftType)} № ${cell(header.tailNumber)} &nbsp; «${cell(date)}»</p>
<p class="line">Завдання: ${cell(header.task)}</p>
${minima}
<p class="sign">Командир авіаційної частини ____________________ &nbsp; М.П.</p>
<p class="muted">Відмітка особи авіаційно-диспетчерської служби (при перельотах) ____________________</p>
</section>
<section>
<h1>Зворотний бік польотного листа</h1>
<table>
<tr>
<th>Дата</th>
<th>Найменування аеродромів зльоту / посадки</th>
<th>Фактична погода в період польоту</th>
<th>Тип повітряного судна, бортовий номер</th>
<th>Час доби</th>
<th>№ вправи</th>
<th>Час зльоту</th>
<th>Час посадки</th>
<th>Кількість польотів</th>
<th>Загальний наліт</th>
<th>У закритій кабіні</th>
<th>СМУ, усього</th>
<th>У хмарах</th>
<th>Висота польоту</th>
<th>Зльоти при мінімумі, система заходження</th>
<th>Кількість заходів</th>
<th>Посадок при мінімумі</th>
<th>Оцінка бойового застосування</th>
<th>Загальний час польоту</th>
</tr>
${body || '<tr><td colspan="19"></td></tr>'}
${foot('Всього', totals.all)}
${foot('у тому числі вдень', totals.day)}
${foot('вночі', totals.night)}
</table>
<p class="sign">Донесення про виконання завдання</p>
<p class="line">${cell(sheet?.report)}</p>
<p class="sign">Командир екіпажу (льотчик) ____________________</p>
<p class="sign">Командир авіаційної частини ____________________ &nbsp; М.П.</p>
</section>
</body></html>`;
}
