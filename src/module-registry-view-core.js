// Екран «Усі визначення модулів» (E1 → екран): чиста логіка без DOM, сховищ і мережі. Реєстр визначень —
// module-definition-core.js; тут лише збірка переліку, фільтри, показ одного визначення людською мовою й запит
// на додавання. Додати одним натисканням можна лише шаблон «Мого дашборда» (є Rust-шаблон і таблиця модуля);
// блок старої вкладки чи картку ПС екран лише описує: вони вже стоять на своїх дашбордах.

import { BRANCH_LABELS } from './dashboard-module-catalog-core.js';
import { ROLES, SURFACES, listDefinitions, validateRegistry } from './module-definition-core.js';

export const SOURCE_LABELS = Object.freeze({
  'rust-template': 'Шаблон «Мого дашборда»',
  'catalog-v1': 'Картка ПС',
  legacy: 'Блок вкладки дашборда',
});

export const VISUAL_LABELS = Object.freeze({
  kpi: 'Показник', line: 'Лінія', area: 'Площа', columns: 'Стовпчики', 'horizontal-bar': 'Горизонтальні смуги',
  'grouped-columns': 'Згруповані стовпчики', donut: 'Кільцева діаграма', 'radial-progress': 'Радіальний прогрес',
  'multi-ring': 'Кілька шкал', radar: 'Радар', gauge: 'Шкала', 'progress-bars': 'Смуги виконання', calendar: 'Календар',
  table: 'Таблиця', funnel: 'Воронка', map: 'Карта', weather: 'Метеоумови', cohort: 'Когорти', activity: 'Стрічка активності',
  waveform: 'Двобічна гістограма', combo: 'Стовпчики з лінією', 'stacked-columns': 'Накопичені стовпчики',
  'diverging-bars': 'Приріст і втрати', leaderboard: 'Рейтинг', ridgeline: 'Гребені за годинами', breakdown: 'Розбивка',
  histogram: 'Гістограма', heatmap: 'Теплова карта', list: 'Список', bars: 'Смуги', cards: 'Картки',
});

export const visualLabel = kind => VISUAL_LABELS[kind] || kind;

/** Перелік для екрана: шаблони Rust (з каталогу застосунку), каталог v1 і блоки вкладок. Порожній `problems` — реєстр узгоджений. */
export function buildRegistry({ rustTemplates, catalogs, catalogUsage }) {
  const definitions = listDefinitions({ rustTemplates, catalogs, catalogUsage });
  return { definitions, problems: validateRegistry(definitions) };
}

const fold = value => String(value ?? '').toLowerCase().replaceAll('’', "'").replaceAll('ʼ', "'");

function searchText(definition) {
  const roles = definition.requirements.map(item => ROLES[item.role]?.label || item.role);
  const places = definition.usedIn.map(place => SURFACES[place.surface]?.label || place.surface);
  return fold([definition.title, definition.computation, visualLabel(definition.visual), SOURCE_LABELS[definition.sourceCatalog], ...roles, ...places].join(' '));
}

/** Фільтр: `query` — слова через пробіл (усі мають зустрітись), `source`, `visual`, `branch` — '' означає «усі». */
export function filterDefinitions(definitions, { query = '', source = '', visual = '', branch = '' } = {}) {
  const words = fold(query).split(/\s+/u).filter(Boolean);
  return definitions.filter(definition => {
    if (source && definition.sourceCatalog !== source) return false;
    if (visual && definition.visual !== visual) return false;
    if (branch && !(definition.branchTags || []).includes(branch)) return false;
    if (!words.length) return true;
    const text = searchText(definition);
    return words.every(word => text.includes(word));
  });
}

/** Значення для списків фільтрів: `{ value, label, count }`, лише ті, що є в переліку; сортовано за кількістю. */
export function facets(definitions) {
  const count = pick => {
    const map = new Map();
    for (const definition of definitions) for (const value of pick(definition)) map.set(value, (map.get(value) || 0) + 1);
    return map;
  };
  const list = (map, label) => [...map].map(([value, n]) => ({ value, label: label(value), count: n }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'uk'));
  return {
    sources: list(count(item => [item.sourceCatalog]), value => SOURCE_LABELS[value] || value),
    visuals: list(count(item => [item.visual]), visualLabel),
    branches: list(count(item => item.branchTags || []), value => BRANCH_LABELS[value] || value),
  };
}

// Однакові вимоги (шаблон «Журнал хронометражу» має десятки полів однієї ролі) зводяться до одного рядка з кількістю.
function groupRequirements(requirements) {
  const groups = new Map();
  for (const item of requirements) {
    const label = ROLES[item.role]?.label || item.role;
    const key = `${label}\u0000${item.required === true}\u0000${item.detail || ''}`;
    const group = groups.get(key) || { label, required: item.required === true, detail: item.detail || '', count: 0 };
    group.count += 1;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => Number(b.required) - Number(a.required));
}

const placeText = place => `${SURFACES[place.surface]?.label || place.surface}${place.block ? `: ${place.block}` : ''}`;

/**
 * Показ одного визначення. `available` — Set ідентифікаторів шаблонів Rust, доступних у цій збірці
 * (з `get_dashboard_module_catalog`). `addable` — лише для шаблонів «Мого дашборда»; для решти `reason` каже, де блок стоїть.
 */
export function definitionView(definition, { available = new Set(), definitions = [] } = {}) {
  const places = definition.usedIn.map(placeText);
  const rust = definition.sourceCatalog === 'rust-template';
  const addable = rust && available.has(definition.sourceId);
  const counterpart = definition.counterpart ? definitions.find(item => item.definitionId === definition.counterpart) : null;
  return {
    id: definition.definitionId,
    title: definition.title,
    sourceLabel: SOURCE_LABELS[definition.sourceCatalog] || definition.sourceCatalog,
    visualLabel: visualLabel(definition.visual),
    branches: (definition.branchTags || []).map(branch => BRANCH_LABELS[branch] || branch),
    places,
    requirements: groupRequirements(definition.requirements),
    computation: definition.computation,
    counterpart: counterpart ? counterpart.title : '',
    addable,
    reason: addable ? ''
      : rust ? 'Цього шаблону немає в каталозі цієї збірки.'
        : `Уже є на дашборді: ${places.join('; ') || 'не малюється'}. Окремим модулем «Мого дашборда» його поки додати не можна.`,
  };
}

/** Запит на створення модуля з шаблону «Мого дашборда» (`create_dashboard_module`); `null`, якщо додати не можна. */
export function addRequest(definition, branch, { available = new Set() } = {}) {
  if (definition?.sourceCatalog !== 'rust-template' || !available.has(definition.sourceId)) return null;
  if (!['air', 'rocket', 'army', 'pvk', 'dshv', 'custom'].includes(branch)) return null;
  return { branch, templateId: definition.sourceId, title: definition.title, style: 'standard' };
}

/** Рядок про кількість: «Показано 12 з 117». */
export function countLine(shown, total) {
  return shown === total ? `Визначень: ${total}` : `Показано ${shown} з ${total}`;
}
