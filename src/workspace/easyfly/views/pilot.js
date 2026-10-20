// Профіль пілота: вкладки «Перевірки», «Допуски», «Льотна книжка», «Штурманські документи».
// Червона плашка «Польоти заборонені» — з flightBlockers. Допуск пілот відмічає сам, без затвердження.
import {
  CLASS_LABELS, CLASS_QUALS, ROLES, exerciseName, formatDate, pluralDays,
} from '../fly-core.js';
import {
  PILOT_TABS, admissionRows, blockerBanner, deleteFlight, effectiveSettings, logbookView, lostAdmissions,
  monthLabel, pluralMonths, profileCards, updatePerson,
} from '../fly-state.js';
import {
  button, card, confirmDialog, dash, dateText, el, emptyState, notice, pageHeader, select, stat,
  statusChip, table, textInput, toast,
} from '../ui.js';
import { icon } from '../icons.js';
import {
  confirmDeletePerson, openAdmissionForm, openPilotForm, removeAdmission, setAdmissionLost,
} from './card.js';
import { openEntry } from './entry.js';

/** Перша літера малою, крім абревіатур (ОНБ, БЗ). */
const lowerFirst = label => (/^[А-ЯІЇЄҐ]{2}/.test(label) ? label : label.charAt(0).toLowerCase() + label.slice(1));

const logbookFilter = { month: '', dayNight: '', exercise: '' };
let logbookPerson = null;

const TAB_SUBTITLES = {
  checks: 'Особисті перевірки та допуски',
  admissions: 'Особисті перевірки й допуски',
  logbook: 'Особистий облік польотів · юридичний оригінал — паперова льотна книжка',
  navdocs: 'Штурманські документи пілота',
};

function identity(ctx, person) {
  const role = select(ROLES, person.role, { onChange: () => change({ role: role.value }) });
  const cls = select(CLASS_QUALS.map(c => ({ value: c, label: CLASS_LABELS[c] })), person.classQual || 'none', { onChange: () => change({ classQual: cls.value }) });
  const type = textInput(person.aircraftType || '', { maxLength: 30, placeholder: '—' });
  type.addEventListener('change', () => change({ aircraftType: type.value }));
  function change(patch) {
    const result = ctx.mutate(data => updatePerson(data, person.id, patch));
    if (!result.ok) toast(result.result.errors.join(' '), 'error');
  }
  const labelled = (label, control) => {
    control.setAttribute('aria-label', label);
    return el('label', { class: 'ef-meta-box' }, el('span', { class: 'ef-meta-label', text: label }), control);
  };
  return el('div', { class: 'ef-identity' },
    el('div', { class: 'ef-avatar', 'aria-hidden': 'true', text: person.callsign.charAt(0).toUpperCase() }),
    el('div', { class: 'ef-identity-name' },
      el('h2', { class: 'ef-pilot-name', text: person.callsign }),
      el('span', { class: 'ef-muted', text: `${ctx.data.unit.name || 'Частина'} · ${person.link ? person.link.toLowerCase() : 'ланку не вказано'}` })),
    el('div', { class: 'ef-meta-boxes' }, labelled('Роль', role), labelled('Клас', cls), labelled('Тип ПС', type)));
}

function checkCard(ctx, person, c) {
  const empty = c.status === null && !c.rows.some(r => r.status) && !c.lines.length;
  const chip = c.blocks ? statusChip('blocks', 'Блокує') : statusChip(c.status);
  chip.classList.add(c.blocks ? 'ef-st-overdue' : `ef-st-${c.status ?? 'none'}`);
  const head = el('div', { class: 'ef-check-head' }, el('h3', { class: 'ef-check-title' }, icon(c.icon, 18), c.title), chip);
  const body = el('div', { class: 'ef-check-body' });
  if (c.lines.length) body.append(...c.lines.map(l => el('p', { class: 'ef-check-line', text: l })));
  else if (!c.rows.length) body.append(el('p', { class: 'ef-muted ef-check-line', text: 'Дата не внесена' }));
  if (c.rows.length) {
    body.append(el('dl', { class: `ef-check-rows${c.key === 'article205' ? ' ef-check-rows-2' : ''}` },
      c.rows.map(r => el('div', { class: `ef-check-row ef-st-${r.status ?? 'none'}` },
        el('dt', { text: r.label }),
        el('dd', {}, r.value, r.detail ? el('small', { class: 'ef-row-detail', text: ` · ${r.detail}` }) : null)))));
  }
  const footer = c.footer
    ? el('p', { class: `ef-check-footer ef-text-${c.footerStatus}`, text: c.footer })
    : el('p', { class: 'ef-check-footer ef-muted', text: 'Термін не визначено' });
  const add = button('Внести', { variant: 'ghost', small: true, iconName: 'vnesty', onClick: () => openEntry(ctx, { mode: 'check', personId: person.id, kind: c.entryKind, lockPilot: true }), ariaLabel: `Внести: ${c.title}` });
  return el('article', { class: `ef-check${empty ? ' ef-check-empty' : ''}${c.blocks ? ' ef-check-blocked' : ''}` }, head, body, el('div', { class: 'ef-check-foot' }, footer, add));
}

function checksTab(ctx, person) {
  const cards = profileCards(person, ctx.data, ctx.today);
  return el('div', { class: 'ef-stack' },
    el('div', { class: 'ef-toolbar' },
      el('p', { class: 'ef-muted', text: `Дані станом на ${formatDate(ctx.today)} · самооблік пілота, без затвердження` }),
      button('Внести перевірку', { variant: 'primary', iconName: 'vnesty', onClick: () => openEntry(ctx, { mode: 'check', personId: person.id, lockPilot: true }) })),
    el('div', { class: 'ef-check-grid' }, cards.map(c => checkCard(ctx, person, c))));
}

function admissionsTab(ctx, person) {
  const rows = admissionRows(person, ctx.data, ctx.today);
  const settings = effectiveSettings(ctx.data);
  const columns = [
    { label: 'Стан', class: 'ef-col-state', render: r => el('span', { class: `ef-state-box ef-st-${r.status ?? 'none'}`, title: r.status === 'lost' ? 'Втрачено' : r.status === 'valid' ? 'Дійсний' : 'Немає даних' },
      icon(r.status === 'lost' ? 'prostrocheno' : r.status === 'valid' ? 'diysno' : 'nemaie-danykh', 16),
      el('span', { class: 'ef-sr', text: r.status === 'lost' ? 'Втрачено' : r.status === 'valid' ? 'Дійсний' : 'Немає даних' })) },
    { label: 'Вид допуску', render: r => el('div', {},
      el('strong', { text: r.kind.label }),
      r.admission ? el('span', { class: 'ef-muted', text: ` · ${r.admission.dayNight === 'night' ? 'ніч' : 'день'}` }) : null,
      r.status === 'lost' && r.hint ? el('small', { class: 'ef-block ef-text-overdue', text: r.hint.text }) : null) },
    { label: 'Вправа', class: 'ef-col-exercise', render: r => el('span', { class: 'ef-muted', text: r.admission?.exercise || r.exercisesText }) },
    { label: 'Дата внесення', render: r => dateText(r.admission?.grantedAt) },
    { label: 'Статус', render: r => (r.status ? statusChip(r.status === 'lost' ? 'lost' : 'valid', r.status === 'lost' ? 'Втрачено' : 'Дійсний') : el('span', { class: 'ef-muted', text: 'Немає даних' })) },
    { label: 'Дія', class: 'ef-col-actions', render: r => {
      const label = `${r.kind.label}${r.admission ? ` (${r.admission.dayNight === 'night' ? 'ніч' : 'день'})` : ''}`;
      if (!r.admission) return button('Внести', { variant: 'link', onClick: () => openAdmissionForm(ctx, person, { kindId: r.kind.id }), ariaLabel: `Внести допуск: ${label}` });
      return el('span', { class: 'ef-row-actions' },
        button(r.status === 'lost' ? 'Поновити' : 'Оновити дату', { variant: 'link', onClick: () => openAdmissionForm(ctx, person, { admission: r.admission }), ariaLabel: `${r.status === 'lost' ? 'Поновити' : 'Оновити дату'}: ${label}` }),
        r.status === 'valid' ? button('Втрачено', { variant: 'link', onClick: () => setAdmissionLost(ctx, r.admission), ariaLabel: `Позначити втраченим: ${label}` }) : null,
        button('', { variant: 'icon', iconName: 'zakryty', title: 'Видалити відмітку', ariaLabel: `Видалити відмітку: ${label}`, onClick: () => removeAdmission(ctx, r.admission, label) }));
    } },
  ];
  const lostCount = rows.filter(r => r.status === 'lost').length;
  return el('div', { class: 'ef-stack' },
    el('div', { class: 'ef-toolbar' },
      el('p', { class: 'ef-muted', text: `Допуски для ролі ${person.role} · пілот самостійно відмічає дату й вправу` }),
      button('Внести допуск', { variant: 'primary', iconName: 'vnesty', onClick: () => openAdmissionForm(ctx, person) })),
    table(columns, rows, { caption: 'Допуски пілота', className: 'ef-admissions', rowClass: r => (r.status === 'lost' ? 'ef-row-lost' : null) }),
    lostCount
      ? notice(null, 'Підказка: допуск відновлюється після виконання зазначеної вправи й внесення нової дати.')
      : notice(null, `Допуск втрачається, якщо перерва перевищує норму (частина норм береться з Таблиці 1 КБПВ). Порогу «скоро» ${settings.soonDays} днів до допусків не застосовано.`));
}

function exerciseCell(entry) {
  if (!entry.exercise) return '—';
  const name = exerciseName(entry.exercise);
  return name ? `№ ${entry.exercise} · ${name}` : `№ ${entry.exercise}`;
}

function logbookTab(ctx, person) {
  if (logbookPerson !== person.id) { Object.assign(logbookFilter, { month: '', dayNight: '', exercise: '' }); logbookPerson = person.id; }
  const view = logbookView(person, ctx.data, ctx.today, logbookFilter);
  const year = ctx.today.slice(0, 4);
  const monthSel = select([{ value: '', label: 'Усі місяці' }, ...view.months.map(m => ({ value: m, label: monthLabel(m) }))], logbookFilter.month, { onChange: () => { logbookFilter.month = monthSel.value; ctx.rerender(); } });
  const dn = select([{ value: '', label: 'День / ніч' }, { value: 'day', label: 'День' }, { value: 'night', label: 'Ніч' }], logbookFilter.dayNight, { onChange: () => { logbookFilter.dayNight = dn.value; ctx.rerender(); } });
  const ex = textInput(logbookFilter.exercise, { placeholder: 'Вправа', maxLength: 8 });
  ex.addEventListener('change', () => { logbookFilter.exercise = ex.value.trim(); ctx.rerender(); });
  monthSel.setAttribute('aria-label', 'Фільтр за місяцем');
  dn.setAttribute('aria-label', 'Фільтр: день або ніч');
  ex.setAttribute('aria-label', 'Фільтр за вправою');

  const entriesTable = table([
    { label: 'Дата', render: e => dateText(e.date) },
    { label: 'Вправа', render: exerciseCell },
    { label: 'Тип ПС / борт', render: e => [e.aircraftType, e.tailNumber].filter(Boolean).join(' · ') || '—' },
    { label: 'Частина доби', render: e => (e.dayNight === 'night' ? 'Ніч' : e.dayNight === 'day' ? 'День' : '—') },
    { label: 'Метеоумови', render: e => dash(e.meteo) },
    { label: 'Тривалість', render: e => el('strong', { text: Number.isInteger(e.airtimeMin) ? `${Math.floor(e.airtimeMin / 60)}:${String(e.airtimeMin % 60).padStart(2, '0')}` : '—' }) },
    { label: 'К-сть', render: e => String(e.count) },
    { label: 'Характер', render: e => dash(e.note) },
    { label: 'Дія', class: 'ef-col-actions', render: e => button('', { variant: 'icon', iconName: 'zakryty', title: 'Видалити запис', ariaLabel: `Видалити запис польоту ${dateText(e.date)}`, onClick: () => removeFlight(ctx, e) }) },
  ], view.entries, { caption: 'Записи льотної книжки' });

  const longBreak = view.longBreak;
  const breakText = !longBreak
    ? 'Перерви розраховуються після внесення історії польотів.'
    : `Останній політ: ${formatDate(longBreak.lastFlightDate)}.${longBreak.needsKnowledgeCheck ? ' Перерва понад 4 місяці: потрібна перевірка знань.' : ' Перерви понад 4 місяці немає.'}${longBreak.needsIntroPlan ? ' Потрібен план введення в стрій.' : ''}`;

  return el('div', { class: 'ef-stack' },
    el('div', { class: 'ef-stats ef-stats-4' },
      stat(`Наліт за ${view.monthLabel.split(' ')[0].toLowerCase()}`, dash(view.monthAirtime), { tone: view.monthAirtime ? 'blue' : '' }),
      stat(`Наліт за ${year} рік`, dash(view.yearAirtime)),
      stat('Наліт усього', dash(view.totalAirtime)),
      stat('З відомих записів', `${view.summary.entries} ${view.summary.entries === 1 ? 'польотний запис' : 'польотних записів'}`, { tone: view.summary.entries ? 'green' : '' })),
    el('div', { class: 'ef-card ef-filters' },
      el('span', { class: 'ef-eyebrow', text: 'Фільтри льотної книжки' }),
      el('div', { class: 'ef-filter-row' }, monthSel, dn, ex,
        button('Додати політ', { variant: 'primary', iconName: 'vnesty', onClick: () => openEntry(ctx, { mode: 'flight', personId: person.id, lockPilot: true }) }))),
    view.entries.length ? entriesTable : emptyState('Немає даних', 'Записів польотів за вибраними фільтрами немає.'),
    el('p', { class: 'ef-muted ef-pad', text: 'Показано лише внесені записи. Невідомі значення позначено тире. Звіряйте з паперовою льотною книжкою — вона лишається юридичним оригіналом.' }),
    view.monthIncomplete ? notice('Є записи без нальоту.', 'Наліт за місяць показано лише за відомими значеннями.', { tone: 'amber' }) : null,
    el('div', { class: 'ef-split ef-split-even' },
      card('Підсумки за видами', el('div', { class: 'ef-sum-row' },
        el('span', { class: 'ef-muted', text: 'День' }), el('strong', { text: dash(view.dayAirtime) }),
        el('span', { class: 'ef-muted', text: 'Ніч' }), el('strong', { text: dash(view.nightAirtime) }))),
      card('Перерви в польотах', el('p', { text: breakText }))),
    el('p', { class: 'ef-muted ef-pad', text: 'Дані внесено пілотом · без підтвердження й затвердження у застосунку' }));
}

async function removeFlight(ctx, entry) {
  const yes = await confirmDialog({
    title: 'Видалити запис польоту?',
    message: `Буде видалено запис від ${formatDate(entry.date)}. Паперова льотна книжка від цього не змінюється.`,
    confirmLabel: 'Видалити', danger: true,
  });
  if (!yes) return;
  const result = ctx.mutate(data => deleteFlight(data, entry.id, { confirmed: true }));
  if (result.ok) toast('Запис польоту видалено.');
}

function navDocsTab(ctx, person) {
  return el('div', { class: 'ef-split ef-split-even' },
    card('Штурманські документи',
      el('p', { text: 'ІШР, бортжурнал і розрахунки маси, пального та маршруту формуються на екрані «Штурман». Вони допомагають підготуватися і не замінюють паперові документи.' }),
      el('div', { class: 'ef-actions' }, button('Відкрити «Штурман»', { variant: 'primary', iconName: 'shturman', onClick: () => ctx.go('navigator', { pilot: person.id }) }))),
    card('Сонце і Місяць',
      el('p', { text: 'Схід і захід Сонця, фаза Місяця та довідковий індикатор освітленості для ОНБ. Індикатор не є допуском.' }),
      el('div', { class: 'ef-actions' }, button('Відкрити «Сонце і Місяць»', { variant: 'secondary', iconName: 'sontse-misiats', onClick: () => ctx.go('sunmoon') }))));
}

export function render(ctx) {
  const { data, today } = ctx;
  const params = ctx.route.params;
  const person = data.persons.find(p => p.id === params.id);
  const root = el('div', { class: 'ef-view ef-profile' });
  if (!person) {
    root.append(pageHeader({ title: 'Профіль пілота' }),
      emptyState('Пілота не знайдено', 'Можливо, його видалено. Поверніться до списку.', button('До списку', { variant: 'primary', iconName: 'nazad', onClick: () => ctx.go('pilots') })));
    return root;
  }
  const tab = params.tab || 'checks';
  root.append(pageHeader({
    crumbs: [{ label: 'EasyFLY' }, { label: 'Мої пілоти', onClick: () => ctx.go('pilots') }, { label: person.callsign }],
    title: 'Профіль пілота',
    subtitle: TAB_SUBTITLES[tab],
    actions: [
      button('До списку', { variant: 'secondary', iconName: 'nazad', onClick: () => ctx.go('pilots') }),
      button('Змінити', { variant: 'ghost', onClick: () => openPilotForm(ctx, person.id) }),
      button('Видалити', { variant: 'ghost-danger', onClick: () => confirmDeletePerson(ctx, person) }),
    ],
  }));
  root.append(identity(ctx, person));

  const banner = blockerBanner(person, data, today);
  if (banner) {
    root.append(el('div', { class: 'ef-alert ef-alert-red ef-ban', role: 'status' },
      icon('blokuie', 18),
      el('strong', { text: `Польоти заборонені: ${banner.text}` }),
      banner.days !== null ? el('span', { class: 'ef-ban-days', text: `${banner.days} ${pluralDays(banner.days)}` }) : null));
  }
  if (tab === 'admissions') {
    const lost = lostAdmissions(person, data, today);
    for (const item of lost) {
      const ex = item.hint?.exercise ? ` (вправа ${item.hint.exercise})` : '';
      root.append(el('div', { class: 'ef-alert ef-alert-red', role: 'status' },
        el('strong', { text: `Втрачено допуск: ${lowerFirst(item.label)}${ex}${item.months !== null ? ` · перерва ${item.months} ${pluralMonths(item.months)}` : ''}` }),
        el('div', { class: 'ef-alert-body', text: 'Для поновлення потрібна відповідна вправа. Дані внесені пілотом, без затвердження застосунком.' })));
    }
  }

  const tabs = el('div', { class: 'ef-tabs', role: 'tablist', 'aria-label': 'Розділи профілю' },
    PILOT_TABS.map(t => el('button', {
      type: 'button', role: 'tab', id: `ef-tab-${t.id}`, class: 'ef-tab', 'aria-selected': String(t.id === tab), 'aria-controls': 'ef-tabpanel',
      tabindex: t.id === tab ? '0' : '-1', text: t.label,
      onClick: () => ctx.go('pilot', { id: person.id, tab: t.id }),
    })));
  tabs.addEventListener('keydown', event => {
    const ids = PILOT_TABS.map(t => t.id);
    const i = ids.indexOf(tab);
    let next = null;
    if (event.key === 'ArrowRight') next = ids[(i + 1) % ids.length];
    else if (event.key === 'ArrowLeft') next = ids[(i - 1 + ids.length) % ids.length];
    else if (event.key === 'Home') next = ids[0];
    else if (event.key === 'End') next = ids[ids.length - 1];
    if (next) { event.preventDefault(); ctx.go('pilot', { id: person.id, tab: next }, { focus: `#ef-tab-${next}` }); }
  });
  root.append(tabs);
  const builders = { checks: checksTab, admissions: admissionsTab, logbook: logbookTab, navdocs: navDocsTab };
  root.append(el('div', { id: 'ef-tabpanel', class: 'ef-tabpanel', role: 'tabpanel', 'aria-labelledby': `ef-tab-${tab}`, tabindex: '0' }, builders[tab](ctx, person)));
  return root;
}

