// Керування картками «Мого дашборда» (E4): спільний період і смужка на кожній картці. Тут лише показ і
// виклики: логіка — dashboard-layout-view-core.js та module-instance-core.js, обмін із Rust —
// dashboard-layout-client.js. Нічого не змінюється, доки людина не вибере період чи не натисне кнопку.

import { PERIOD_CHOICES, STYLE_CHOICES, choiceOf, periodFromChoice, sizeChoices } from './dashboard-layout-view-core.js';

/** Список і поля дат для періоду. `onChange(period)` викликається, лише коли період повний і коректний. */
function periodControl({ el, label, period, allowShared, onChange }) {
  const choices = PERIOD_CHOICES.filter(item => allowShared || item.id !== 'shared');
  const current = choiceOf(period);
  const select = el('select', { 'aria-label': label, 'data-action': 'period-choice' },
    choices.map(item => el('option', { value: item.id, text: item.label, selected: item.id === current })),
    current === 'last-custom' ? el('option', { value: 'last-custom', text: `Останні ${period.days} днів`, selected: true }) : null);
  const from = el('input', { type: 'date', 'aria-label': `${label}: з`, value: period?.from || '', 'data-action': 'period-from' });
  const to = el('input', { type: 'date', 'aria-label': `${label}: по`, value: period?.to || '', 'data-action': 'period-to' });
  const range = el('span', { class: 'ewmc-period-range', hidden: current !== 'range' }, from, el('span', { text: '–' }), to);
  const apply = () => {
    const next = periodFromChoice(select.value, { from: from.value, to: to.value });
    range.hidden = select.value !== 'range';
    if (next) onChange(next);
  };
  select.addEventListener('change', apply);
  from.addEventListener('change', apply);
  to.addEventListener('change', apply);
  return el('span', { class: 'ewmc-period' }, select, range);
}

/** Смужка над сіткою: період, який беруть картки з вибором «Як у спільній панелі». */
export function sharedPeriodBar({ el, layout, onChange }) {
  return el('div', { class: 'ewmc-layout-bar', role: 'group', 'aria-label': 'Спільна панель періоду' },
    el('b', { text: 'Спільний період' }),
    periodControl({ el, label: 'Спільний період', period: layout.sharedPeriod, allowShared: false, onChange }),
    el('span', { class: 'ewmc-layout-hint', text: 'Діє на картки з вибором «Як у спільній панелі». Період обмежує рядки за підтвердженою датою події.' }));
}

/**
 * Смужка картки: власний період, «Копія» і «Прибрати картку». `model` — результат `cardModel`;
 * кнопки, що неможливі, вимкнені з поясненням у підказці.
 */
export function instanceBar({ el, instance, model, width = 6, canEarlier = false, canLater = false, onPeriod, onDuplicate, onRemove, onSize, onMove, style = 'branch', onStyle }) {
  const duplicate = el('button', {
    type: 'button',
    class: 'btn quiet',
    text: 'Копія',
    'data-action': 'duplicate-card',
    'data-instance-id': instance.id,
    disabled: !model.canDuplicate,
    title: model.canDuplicate ? 'Поставити ще одну картку цього модуля з іншим періодом' : 'Один модуль на одній таблиці — не більш як чотири картки',
    onclick: event => { event.currentTarget.disabled = true; onDuplicate(); },
  });
  const remove = el('button', {
    type: 'button',
    class: 'btn quiet',
    text: 'Прибрати картку',
    'data-action': 'remove-card',
    'data-instance-id': instance.id,
    disabled: !model.removable,
    title: model.removable ? 'Прибрати цю картку; таблиця й дані модуля лишаються' : 'Це остання картка модуля. Щоб прибрати модуль, видаліть його',
    onclick: event => { event.currentTarget.disabled = true; onRemove(); },
  });
  const size = el('select', { 'aria-label': `Розмір картки ${instance.title}`, 'data-action': 'card-size', title: 'Ширина картки на сітці' },
    sizeChoices(width).map(item => el('option', { value: item.w, text: item.label, selected: item.w === width })));
  size.addEventListener('change', () => onSize(Number(size.value)));
  const styleSelect = el('select', { 'aria-label': `Стиль картки ${instance.title}`, 'data-action': 'card-style', title: 'Стиль оформлення картки' },
    STYLE_CHOICES.map(item => el('option', { value: item.id, text: item.label, selected: item.id === style })));
  styleSelect.addEventListener('change', () => onStyle(styleSelect.value));
  const arrow = (action, text, label, enabled, direction) => el('button', {
    type: 'button',
    class: 'btn quiet ewmc-move',
    text,
    'data-action': action,
    'data-instance-id': instance.id,
    'aria-label': label,
    title: label,
    disabled: !enabled,
    onclick: () => onMove(direction),
  });
  // Ручка для перетягування: картка кладеться на місце тієї, на яку її кинули (є й кнопки «раніше/пізніше»).
  const handle = el('span', {
    class: 'ewmc-drag-handle',
    draggable: 'true',
    'data-action': 'drag-card',
    'data-instance-id': instance.id,
    title: 'Перетягніть картку на місце іншої',
    'aria-hidden': 'true',
    text: '⠿',
  });
  handle.addEventListener('dragstart', event => {
    event.dataTransfer?.setData('text/plain', instance.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  });
  return el('div', { class: 'ewmc-instance-bar', 'data-instance-id': instance.id },
    handle,
    periodControl({ el, label: `Період картки ${instance.title}`, period: instance.period, allowShared: true, onChange: onPeriod }),
    size,
    styleSelect,
    arrow('move-earlier', '←', 'Раніше', canEarlier, -1),
    arrow('move-later', '→', 'Пізніше', canLater, 1),
    duplicate, remove,
    model.note ? el('p', { class: 'ewmc-instance-note', role: 'status', text: model.note }) : null);
}
