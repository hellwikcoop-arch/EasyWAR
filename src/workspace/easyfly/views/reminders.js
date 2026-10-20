// Нагадування 30 / 14 / 7 днів: локально, без сповіщень ОС і мережі. Пороги — у налаштуваннях частини.
import { addDays, buildReminders, formatDate, personItems, pluralDays, upcomingDeadlines } from '../fly-core.js';
import { coreCtx, effectiveSettings, toggleReminderDay } from '../fly-state.js';
import { dateText, el, emptyState, notice, pageHeader, statusChip, table, toast } from '../ui.js';

function toggle(day, on, ctx) {
  const input = el('input', { type: 'checkbox', class: 'ef-toggle-input', checked: on, id: `ef-rem-${day}` });
  input.addEventListener('change', () => {
    const result = ctx.mutate(data => toggleReminderDay(data, day, input.checked));
    if (!result.ok) { input.checked = true; toast(result.result.errors.join(' '), 'error'); }
  });
  return el('label', { class: `ef-toggle${on ? ' ef-toggle-on' : ''}`, for: `ef-rem-${day}` },
    el('span', { class: 'ef-toggle-label', text: `За ${day} днів` }), input, el('span', { class: 'ef-toggle-track', 'aria-hidden': 'true' }, el('span', { class: 'ef-toggle-thumb' })));
}

function leftText(left) {
  if (left === null) return '—';
  return left < 0 ? `−${-left} ${pluralDays(left)}` : `${left} ${pluralDays(left)}`;
}

export function render(ctx) {
  const { data, today } = ctx;
  const settings = effectiveSettings(data);
  const all = [30, 14, 7];
  const active = new Set(settings.reminderDays);
  const root = el('div', { class: 'ef-view' });
  root.append(pageHeader({
    crumbs: [{ label: 'EasyFLY' }, { label: 'Нагадування' }],
    title: 'Нагадування про перевірки',
    subtitle: 'Локальні сповіщення про строки · без синхронізації й мережевих сервісів',
  }));

  root.append(el('section', { class: 'ef-card', 'aria-labelledby': 'ef-rem-params' },
    el('h2', { id: 'ef-rem-params', class: 'ef-eyebrow', text: 'Параметри сповіщень' }),
    el('div', { class: 'ef-toggles' }, all.map(day => toggle(day, active.has(day), ctx)),
      el('span', { class: 'ef-text-valid ef-toggle-state', text: 'Увімкнено' }))));
  root.append(notice('Нагадування працюють лише на цьому пристрої.', 'Сповіщення не надсилаються іншим користувачам і не потребують інтернету.'));

  if (!data.persons.length) {
    root.append(emptyState('Немає даних', 'Додайте пілотів, щоб бачити нагадування про строки.'));
    return root;
  }

  const items = data.persons.flatMap(p => personItems(p, today, coreCtx(data)));
  const reminders = buildReminders(items, today, settings.reminderDays);
  const windowEnd = Math.max(...settings.reminderDays);
  const byKey = new Map(items.map(i => [`${i.personId}|${i.key}`, i]));
  const rows = reminders.map(r => ({ ...r, item: byKey.get(`${r.personId}|${r.key}`) }));

  const columns = [
    { label: 'Дата', render: r => el('strong', { text: dateText(r.dueDate) }) },
    { label: 'Пілот', render: r => el('button', { type: 'button', class: 'ef-link', onClick: () => ctx.go('pilot', { id: r.personId }), text: r.callsign }) },
    { label: 'Перевірка / подія', render: r => r.label },
    { label: 'Стан', render: r => statusChip(r.item?.status ?? null) },
    { label: 'Залишилося', render: r => leftText(r.daysLeft) },
    { label: 'Нагадування', render: r => (r.level === 'overdue' ? 'Потребує уваги' : `За ${r.level} днів`) },
  ];
  const lastDay = formatDate(addDays(today, windowEnd));
  root.append(el('section', { class: 'ef-card', 'aria-labelledby': 'ef-rem-list' },
    el('div', { class: 'ef-card-head' },
      el('h2', { id: 'ef-rem-list', class: 'ef-card-title', text: `Найближчі події · ${formatDate(today).slice(0, 5)}–${lastDay}` }),
      el('span', { class: 'ef-pill', text: `Наступні ${windowEnd} днів` })),
    rows.length ? table(columns, rows, { caption: 'Нагадування про строки', rowClass: r => (r.level === 'overdue' ? 'ef-row-lost' : null) })
      : el('p', { class: 'ef-muted', text: 'У межах вибраних порогів подій немає.' })));

  const later = upcomingDeadlines(items.filter(i => i.daysLeft > windowEnd), today, { horizonDays: 90, includeOverdue: false, limit: 10 });
  if (later.length) {
    root.append(el('section', { class: 'ef-card', 'aria-labelledby': 'ef-rem-later' },
      el('h2', { id: 'ef-rem-later', class: 'ef-card-title', text: 'Далі, до 90 днів' }),
      table([
        { label: 'Дата', render: i => dateText(i.dueDate) },
        { label: 'Пілот', render: i => i.callsign },
        { label: 'Перевірка / подія', render: i => i.label },
        { label: 'Залишилося', render: i => leftText(i.daysLeft) },
        { label: 'Нагадування', render: () => 'Поза вікном' },
      ], later, { caption: 'Строки поза вікном нагадувань' }),
      el('p', { class: 'ef-muted ef-pad', text: 'Події поза вікном наведено для контексту й позначено окремо.' })));
  }
  root.append(el('div', { class: 'ef-alert ef-alert-outline' }, `Правило статусу: «скоро» — до ${settings.soonDays} днів включно; «прострочено» — після кінцевої дати.`));
  return root;
}
