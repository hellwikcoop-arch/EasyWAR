/* Колода презентації окремого модуля: «Повітряні Сили» або РВ за власною таблицею ударів модуля
   («Зведена», парсер strikes-core.js). Чисте ядро без DOM, однакові дані дають однаковий результат.
   Титул, 7 діб, 30 діб, весь період (або один слайд за обраний період). Слайди будує
   buildStrikesSlide: ті самі показники, правила результату й ефективності, що й слайди ПС та РВ
   колоди УДШВ. Усі тексти складаються з чисел таблиці; координати, райони й уточнення не читаються. */

import { DECK_SCHEMA_VERSION, DEFAULT_CONFIG } from './presentation-core.js';
import { buildStrikesSlide } from './presentation-strikes.js';
import { firstStrikeDate, lastStrikeDate } from './strikes-core.js';
import { daysIn, periodText, rollingRange } from './presentation-format.js';

/** Профілі модулів: назва, тема оформлення (колір шапки й емблема) і текст титулу за замовчуванням. */
export const GROUP_PROFILES = {
  ps: { key: 'ps', short: 'ПС', name: 'Повітряні Сили', defaultTitle: 'Аналітика Повітряних Сил', weapon: 'Тип ЛА' },
  rvia: { key: 'rvia', short: 'РВ', name: 'Ракетні війська', defaultTitle: 'Аналітика РВ', weapon: 'Тип ПУ' },
};

const PERIOD_LABELS = { week: '7 діб', month: '30 діб', all: 'весь період', custom: 'обраний період' };

/** Слайди-періоди: 7 діб, 30 діб, весь період від першого до останнього запису; або один обраний період. */
export function groupPeriods(profile, strikes, custom = null) {
  const from = firstStrikeDate(strikes);
  const anchor = lastStrikeDate(strikes);
  const make = (id, kind, range, phrase) => ({ id, kind, range, phrase, title: `${profile.short} · ${PERIOD_LABELS[id]}`, heading: `Аналітика ${profile.short} · ${PERIOD_LABELS[id]}` });
  if (custom && custom.from && custom.to) {
    const range = custom.from <= custom.to ? { from: custom.from, to: custom.to } : { from: custom.to, to: custom.from };
    return [make('custom', 'window', range, 'обраний період')];
  }
  return [
    make('week', 'window', rollingRange(anchor, 7), 'останні 7 діб'),
    make('month', 'window', rollingRange(anchor, 30), 'останні 30 діб'),
    make('all', 'all', { from, to: anchor }, 'весь період'),
  ];
}

/**
 * Модель колоди модуля. options: { group: 'ps' | 'rvia', owner, titleText, generatedOn, custom: { from, to }, config }.
 * Без жодного запису з розпізнаною датою колода має лише титул і слайд-повідомлення.
 */
export function buildGroupDeck(strikes, options = {}) {
  const profile = GROUP_PROFILES[options.group] || GROUP_PROFILES.ps;
  const config = { ...DEFAULT_CONFIG, ...(options.config || {}), focus: 'all' };
  const group = { id: profile.key, title: profile.short, strikes };
  const periods = strikes.records.length ? groupPeriods(profile, strikes, options.custom) : [{ id: 'all', kind: 'all', range: { from: '', to: '' }, phrase: 'весь період', title: `${profile.short} · ${PERIOD_LABELS.all}`, heading: `Аналітика ${profile.short} · ${PERIOD_LABELS.all}` }];
  const slides = periods.map(period => buildStrikesSlide(group, { config, period }));
  const from = firstStrikeDate(strikes);
  const to = lastStrikeDate(strikes);
  const dataRange = { from, to, text: from ? periodText({ from, to }) : '', days: daysIn({ from, to }).length, activeDays: new Set(strikes.records.map(r => r.date)).size };
  return {
    schemaVersion: DECK_SCHEMA_VERSION,
    kind: 'group_deck',
    group: profile.key,
    config,
    classification: null,
    focus: '',
    focusLabel: '',
    warnings: [],
    slides: [{
      id: 'title',
      title: 'Аналітика',
      theme: profile.key,
      owner: options.owner || '',
      titleText: options.titleText || profile.defaultTitle,
      marking: '',
      source: strikes.sourceName || '',
      units: [],
      excludedUnits: [],
      dataRange,
      anchor: to,
      generatedOn: options.generatedOn || '',
    }, ...slides],
  };
}
