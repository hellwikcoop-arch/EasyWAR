// Вбудований каталог ПС (шар `builtin`): шість карток «Основних показників» модуля ПС (src/air.html)
// як описи плиток за форматом src/catalog-core.js. Підрахунок робить src/tiles-core.js, малює
// сторінка; вигляд карток лишається тим самим, що був до виносу в каталог.
//
// Записи для цих плиток — прості об’єкти за id стовпців нижче; їх складає src/ps-kpi.js з рядків,
// які розібрав парсер таблиці. Розпізнавання результату ураження («частково», «подавлено» …) лишається
// в парсері: каталог описує вже розібране значення зі списку `list.ps-result`.
//
// Блоки `block.ps-ops` і `block.ps-mun` — мінімальні описи розділів «Журнал» і «Боєприпаси», куди веде
// кнопка «Докладніше» на картці. Повний опис цих розділів — окремий крок.

const FILTER_RESULT = (value) => [{ column: 'col.result', op: 'eq', value }];

export const PS_CATALOG_ID = 'cat.builtin.ps';

export const PS_CATALOG = {
  format: 'easywar.catalog',
  version: 1,
  id: PS_CATALOG_ID,
  title: 'ПС: основні показники',
  layer: 'builtin',
  lists: [
    {
      id: 'list.ps-result',
      title: 'Результат ураження',
      values: [
        { value: 'Уражено' },
        { value: 'Пошкоджено' },
        { value: 'Не уражено' },
        { value: 'Не відомо' },
      ],
    },
  ],
  columns: [
    { id: 'col.date', type: 'date', labels: ['Дата'], group: 'Запис' },
    { id: 'col.munition', type: 'text', labels: ['Тип боєприпасу'], group: 'Застосування', maxLength: 80 },
    { id: 'col.munition-count', type: 'number', integer: true, min: 0, labels: ['К-сть боєприпасів'], group: 'Застосування' },
    { id: 'col.result', type: 'choice', list: 'list.ps-result', labels: ['Результат ураження'], group: 'Результат' },
    {
      id: 'col.abort',
      type: 'flag',
      labels: ['Відбій'],
      group: 'Результат',
      description: 'Позначка виводиться зі слова «відбій» у результаті чи причині; окремого заголовка в таблиці немає.',
    },
  ],
  tiles: [
    {
      id: 'tile.ps-sorties',
      label: 'Вильоти',
      sub: 'Всього бойових вильотів',
      measure: { agg: 'count' },
      visual: 'bars',
      by: 'col.date',
      tone: 'blue',
      delta: 'up',
      icon: 'plane',
      extras: [{
        label: 'Середній темп',
        measure: { agg: 'count' },
        per: { agg: 'days' },
        icon: 'avg',
        unit: { one: 'виліт', few: 'вильоти', many: 'вильотів', fraction: 'вильоту' },
        suffix: '/день',
      }],
      info: {
        text: 'Один запис у таблиці — один виліт (паспорт цілі)',
        facts: [
          { label: 'Із застосуванням БП', measure: { agg: 'count', filter: [{ column: 'col.munition-count', op: 'gt', value: 0 }] } },
          { label: 'З відбоєм', measure: { agg: 'count', filter: [{ column: 'col.abort', op: 'eq', value: true }] } },
          { label: 'Макс. за добу', measure: { agg: 'peak', by: 'col.date', grain: 'day' } },
        ],
      },
      opens: 'block.ps-ops',
    },
    {
      id: 'tile.ps-munitions',
      label: 'Використано БП',
      sub: 'Усі типи боєприпасів',
      measure: { agg: 'sum', column: 'col.munition-count' },
      visual: 'bars',
      by: 'col.date',
      tone: 'amber',
      delta: 'up',
      icon: 'bomb',
      extras: [{
        label: 'Середня витрата',
        measure: { agg: 'sum', column: 'col.munition-count' },
        per: { agg: 'count' },
        icon: 'bomb',
        unit: 'БП на виліт',
      }],
      info: {
        facts: [
          { measure: { agg: 'top', column: 'col.munition', weight: 'col.munition-count', limit: 2 } },
          { label: 'Макс. за добу', measure: { agg: 'peak', column: 'col.munition-count', by: 'col.date', grain: 'day' } },
        ],
      },
      opens: 'block.ps-mun',
    },
    {
      id: 'tile.ps-hit',
      label: 'Уражено',
      sub: 'Підтверджені результати',
      measure: { agg: 'count', filter: FILTER_RESULT('Уражено') },
      visual: 'ring',
      by: 'col.date',
      tone: 'green',
      delta: 'up',
      icon: 'tgtg',
      ringLabel: 'Частка уражених від усіх вильотів',
      caption: 'Ціль знищено / виведено з ладу',
      info: {
        facts: [{ label: 'Макс. за добу', measure: { agg: 'peak', by: 'col.date', grain: 'day', filter: FILTER_RESULT('Уражено') } }],
      },
      opens: 'block.ps-ops',
    },
    {
      id: 'tile.ps-partial',
      label: 'Пошкоджено',
      sub: 'Часткове ураження',
      measure: { agg: 'count', filter: FILTER_RESULT('Пошкоджено') },
      visual: 'ring',
      by: 'col.date',
      tone: 'orange',
      delta: 'warn',
      icon: 'wrench',
      ringLabel: 'Частка пошкоджених від усіх вильотів',
      caption: 'Часткове ураження, потребує дорозвідки',
      info: {
        text: 'У таблиці — «ЧАСТКОВО УРАЖЕНО»',
        facts: [{ label: 'Макс. за добу', measure: { agg: 'peak', by: 'col.date', grain: 'day', filter: FILTER_RESULT('Пошкоджено') } }],
      },
      opens: 'block.ps-ops',
    },
    {
      id: 'tile.ps-miss',
      label: 'Не уражено',
      sub: 'Без підтвердженого ефекту',
      measure: { agg: 'count', filter: FILTER_RESULT('Не уражено') },
      visual: 'ring',
      by: 'col.date',
      tone: 'red',
      delta: 'down',
      icon: 'miss',
      ringLabel: 'Частка неуражених від усіх вильотів',
      caption: 'Погодні умови, РЕБ, відмова АЗУ та ін.',
      info: {
        text: 'Ціль не уражено',
        facts: [{ label: 'Мін. за місяць', measure: { agg: 'low', by: 'col.date', grain: 'month', filter: FILTER_RESULT('Не уражено') } }],
      },
      opens: 'block.ps-ops',
    },
    {
      id: 'tile.ps-unknown',
      label: 'Не відомо',
      sub: 'Очікує перевірки',
      measure: { agg: 'count', filter: FILTER_RESULT('Не відомо') },
      visual: 'ring',
      by: 'col.date',
      tone: 'grey',
      delta: 'neutral',
      icon: 'unk',
      ringLabel: 'Частка невідомих від усіх вильотів',
      caption: 'Результат не підтверджено або не розпізнано',
      info: {
        facts: [{ label: 'Чекає перевірки', measure: { agg: 'count', filter: FILTER_RESULT('Не відомо') } }],
      },
      hideWhenZero: true,
      opens: 'block.ps-ops',
    },
  ],
  blocks: [
    {
      id: 'block.ps-kpis',
      title: 'Основні показники',
      kind: 'tiles',
      tiles: ['tile.ps-sorties', 'tile.ps-munitions', 'tile.ps-hit', 'tile.ps-partial', 'tile.ps-miss', 'tile.ps-unknown'],
    },
    {
      id: 'block.ps-ops',
      title: 'Журнал вильотів',
      kind: 'table',
      columns: ['col.date', 'col.munition', 'col.munition-count', 'col.result', 'col.abort'],
    },
    {
      id: 'block.ps-mun',
      title: 'Боєприпаси',
      kind: 'breakdown',
      by: 'col.munition',
      measure: { agg: 'sum', column: 'col.munition-count' },
      shape: 'bars',
      limit: 10,
    },
  ],
};
