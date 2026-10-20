// Налаштування частини: підписанти друкованих форм, аеродром і київський час, критерій ОНБ,
// норми льотної зміни, пороги строків. Усе зберігається локально у файлі .easyfly.
import { effectiveSettings, updateUnit } from '../fly-state.js';
import {
  button, card, el, errorBox, field, notice, numberInput, pageHeader, select, textInput, toast,
} from '../ui.js';

function signerBlock(title, slot, full, surnameFallback) {
  const rank = textInput(full?.rank || '', { maxLength: 40 });
  const name = textInput(full?.name || '', { maxLength: 40 });
  const surname = textInput(full?.surname || surnameFallback || '', { maxLength: 60 });
  const root = el('fieldset', { class: 'ef-signer' },
    el('legend', { text: title }),
    el('div', { class: 'ef-form-grid ef-form-grid-3' },
      field('Звання', rank).root, field('Ім’я', name).root, field('Прізвище', surname).root));
  return { root, read: () => ({ rank: rank.value, name: name.value, surname: surname.value }), slot };
}

export function render(ctx) {
  const { data } = ctx;
  const unit = data.unit;
  const s = effectiveSettings(data);
  const errors = errorBox();
  const root = el('div', { class: 'ef-view' });
  root.append(pageHeader({
    crumbs: [{ label: 'EasyFLY' }, { label: 'Налаштування' }],
    title: 'Налаштування частини',
    subtitle: 'Локальні параметри штурманських документів, повідомлень і обліку',
  }));

  const first = signerBlock('Начальник ІАС', 'first', unit.signersFull?.first, unit.signers?.first);
  const second = signerBlock('Старший штурман', 'second', unit.signersFull?.second, unit.signers?.second);
  const unitName = textInput(unit.name || '', { maxLength: 80, placeholder: 'Наприклад, Ескадрилья «Перша»' });
  const airfield = textInput(unit.airfield || '', { maxLength: 40, placeholder: 'Умовна назва або код' });
  const tz = select([{ value: 'Europe/Kyiv', label: 'Київський (Europe/Kyiv)' }], s.timezone);
  const lat = textInput(s.airfieldLat === null ? '' : String(s.airfieldLat), { placeholder: 'Десяткові градуси, наприклад 50.45', inputMode: 'decimal' });
  const lon = textInput(s.airfieldLon === null ? '' : String(s.airfieldLon), { placeholder: 'Десяткові градуси, наприклад 30.52', inputMode: 'decimal' });
  const onb = numberInput(s.onbCriterionPercent, { min: 0, max: 100 });
  const aero = numberInput(s.aerobaticsLimit, { min: 1, max: 20 });
  const soon = numberInput(s.soonDays, { min: 1, max: 90 });
  const ovpMonths = numberInput(s.ovpMonths, { min: 1, max: 60 });
  const a205Months = numberInput(s.article205Months, { min: 1, max: 60 });
  const ovpBlocks = el('input', { type: 'checkbox', id: 'ef-ovp-blocks', checked: s.ovpBlocks });

  root.append(el('div', { class: 'ef-settings-grid' },
    card('Підписанти друкованих форм', first.root, second.root),
    card('Базування і місцевий час',
      el('div', { class: 'ef-form-grid' },
        field('Назва частини', unitName).root,
        field('Аеродром базування', airfield).root,
        field('Часовий пояс', tz).root, el('span'),
        field('Широта', lat).root, field('Довгота', lon).root),
      el('p', { class: 'ef-hint ef-hint-block', text: 'Координати користувач заповнює сам; вони потрібні лише для розрахунку Сонця й Місяця. Порожні поля означають «невідомо».' })),
    card('Параметри ОНБ',
      field('Поріг освітленості Місяця, %', onb).root,
      el('p', { text: '«Сприятлива ніч» — при освітленості не менш ніж задане значення.' }),
      el('p', { class: 'ef-hint ef-hint-block', text: 'Розрахунок є довідковим і не підтверджує допуск.' })),
    card('Норми льотної зміни',
      field('Пілотаж · максимум польотів', aero).root,
      el('p', { text: 'Попереджати при досягненні встановленого максимуму.' }),
      el('p', { class: 'ef-hint ef-hint-block', text: 'Не є інструментом затвердження польотів.' })),
    card('Пороги строків',
      el('div', { class: 'ef-form-grid' },
        field('«Скоро» — днів до строку', soon, { hint: 'Типово 30.' }).root,
        field('Строк Статті 205, міс.', a205Months).root,
        field('Строк ОВП, міс.', ovpMonths, { hint: 'Припущення частини; уточніть у керівних документах.' }).root,
        el('div', { class: 'ef-field ef-check-field' }, ovpBlocks, el('label', { for: 'ef-ovp-blocks', text: 'Прострочена ОВП забороняє польоти' }))))));

  const save = () => {
    errors.clear();
    const result = ctx.mutate(d => updateUnit(d, {
      name: unitName.value,
      airfield: airfield.value,
      signersFull: { first: first.read(), second: second.read() },
      settings: {
        timezone: tz.value, airfieldLat: lat.value, airfieldLon: lon.value, onbCriterionPercent: onb.value,
        aerobaticsLimit: aero.value, soonDays: soon.value, article205Months: a205Months.value, ovpMonths: ovpMonths.value,
        ovpBlocks: ovpBlocks.checked,
      },
    }));
    if (!result.ok) { errors.show(result.result.errors); window.scrollTo?.(0, 0); return; }
    toast('Налаштування внесено у дані. Щоб записати їх у файл, натисніть «Зберегти» у верхній смузі.');
  };

  root.append(errors, el('div', { class: 'ef-alert ef-alert-blue ef-savebar' },
    el('span', { text: 'Дані зберігаються локально у файлі .easyfly. Імена підписантів використовуються лише на друкованих формах.' }),
    button('Застосувати налаштування', { variant: 'primary', iconName: 'zberehty', onClick: save })));
  root.append(notice(null, 'Налаштування застосовуються до даних відразу після натискання кнопки; запис на диск виконує кнопка «Зберегти» у верхній смузі.'));
  return root;
}
