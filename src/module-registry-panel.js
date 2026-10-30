// Екран «Усі визначення модулів»: перегляд реєстру E1 з пошуком і фільтрами та кнопка «Додати на “Мій дашборд”» для
// шаблонів «Мого дашборда». Тут лише показ і виклик `onAdd`: логіка — module-registry-view-core.js, створення модуля й
// картки — наявний шлях каталогу (`create_dashboard_module`, розкладка E4 сама ставить картку). Лише `textContent`.

import { countLine, definitionView, facets, filterDefinitions } from './module-registry-view-core.js';

/**
 * `definitions` — перелік реєстру; `available` — Set id шаблонів Rust цієї збірки; `branch` — рід військ дашборда
 * (початковий фільтр); `onAdd(definition)` — повертає Promise, під час якого кнопки вимкнені; `onBack` — «← До каталогу».
 * `columnsBox(definition)` — блок «Додати стовпці в основну таблицю» (E5) для блоків, що читають стовпці таблиці, або `null`.
 */
export function registryPanel({ el, definitions, available, branch, branchLabel, onAdd, onBack, columnsBox = null }) {
  const options = facets(definitions);
  const search = el('input', { type: 'search', class: 'ewmc-search', placeholder: 'Пошук за назвою, роллю даних чи обчисленням…', 'aria-label': 'Пошук у визначеннях модулів' });
  const select = (label, values, all, initial = '') => el('select', { class: 'ewmc-reg-select', 'aria-label': label },
    el('option', { value: '', text: all }),
    values.map(item => el('option', { value: item.value, selected: item.value === initial, text: `${item.label} (${item.count})` })));
  const source = select('Тип визначення', options.sources, 'Усі типи');
  const visual = select('Вигляд', options.visuals, 'Усі вигляди');
  const branchSelect = select('Рід військ', options.branches, 'Усі роди', options.branches.some(item => item.value === branch) ? branch : '');
  const count = el('p', { class: 'ewmc-reg-count', role: 'status', 'aria-live': 'polite' });
  const list = el('div', { class: 'ewmc-reg-list' });
  let busy = false;

  const paint = () => {
    const shown = filterDefinitions(definitions, { query: search.value, source: source.value, visual: visual.value, branch: branchSelect.value });
    count.textContent = countLine(shown.length, definitions.length);
    list.replaceChildren(...(shown.length
      ? shown.map(definition => card(definition))
      : [el('p', { class: 'ewmc-empty', text: 'За цими умовами визначень не знайдено.' })]));
  };

  function card(definition) {
    const view = definitionView(definition, { available, definitions });
    const button = el('button', {
      type: 'button', class: 'btn primary', text: 'Додати на «Мій дашборд»', 'data-action': 'add-definition', 'data-definition-id': view.id,
      disabled: !view.addable || busy, title: view.addable ? `Створити модуль «${view.title}» і картку на дашборді${branchLabel ? ` ${branchLabel}` : ''}` : view.reason,
    });
    button.addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      for (const other of list.querySelectorAll('[data-action=add-definition]')) other.disabled = true;
      try { await onAdd(definition); } finally { busy = false; paint(); }
    });
    return el('article', { class: 'ewmc-reg-card', 'data-source': definition.sourceCatalog },
      el('div', { class: 'ewmc-reg-top' },
        el('h3', { text: view.title }),
        el('span', { class: 'ewmc-category', text: view.sourceLabel })),
      el('p', { class: 'ewmc-reg-meta', text: [view.visualLabel, view.branches.join(', ')].filter(Boolean).join(' · ') }),
      el('p', { class: 'ewmc-reg-calc', text: view.computation }),
      el('p', { class: 'ewmc-reg-req-title', text: 'Потрібні дані' }),
      el('ul', { class: 'ewmc-reg-req' }, view.requirements.map(item => el('li', { class: item.required ? 'required' : 'optional' },
        item.label, item.detail ? el('small', { text: ` (${item.detail})` }) : null, item.count > 1 ? el('small', { text: ` × ${item.count}` }) : null, item.required ? null : el('small', { text: ' · за бажанням' })))),
      view.counterpart ? el('p', { class: 'ewmc-reg-meta', text: `Рахує те саме, що й «${view.counterpart}».` }) : null,
      view.addable ? button : el('p', { class: 'ewmc-reg-reason', text: view.reason }),
      !view.addable && columnsBox ? columnsBox(definition) : null);
  }

  for (const control of [source, visual, branchSelect]) control.addEventListener('change', paint);
  search.addEventListener('input', paint);
  paint();
  return {
    node: el('div', { class: 'ewmc-reg' },
      el('button', { type: 'button', class: 'ewmc-back', text: '← До каталогу', onclick: onBack }),
      el('div', { class: 'ewmc-reg-filters' }, search, source, visual, branchSelect),
      count, list),
    focus: () => search.focus(),
  };
}
