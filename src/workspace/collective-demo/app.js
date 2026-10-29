// «Колектив (демо)» у «Робочому середовищі» → «Колектив» (контракт docs/WORKSPACE.md, версія 1).
// Два ізольовані клієнти в пам'яті вікна на синтетичних даних: «Доповісти» → «Звірити», дублі,
// конфлікти, право запису. Без мережі, команд Tauri, профілів, бази й сховищ браузера —
// після закриття застосунку стан зникає. Логіка — collective-demo-core.js (на ядрах C1).
import {
  CLIENTS,
  COLUMNS,
  COLUMN_LABELS,
  DEMO_NOTICE,
  DEMO_SIGNATURE_NOTE,
  canWrite,
  confirmReport,
  conflictsOf,
  createDemo,
  dashboardSeries,
  discardPending,
  draftValues,
  editRow,
  openReport,
  redeliver,
  resolve,
  setWriteRight,
  synchronize,
  visibleRows,
} from './collective-demo-core.js';
import './collective-demo.css';

export const contract = 1;

const SVG = 'http://www.w3.org/2000/svg';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(text, onClick, options = {}) {
  const node = el('button', `cd-button${options.primary ? ' cd-button--primary' : ''}`, text);
  node.type = 'button';
  node.disabled = Boolean(options.disabled);
  node.addEventListener('click', onClick);
  return node;
}

const formatCell = value => (value === null || value === undefined ? '—' : String(value));

export async function mount(container) {
  let demo = createDemo();
  const messages = { A: null, B: null };
  const root = el('div', 'cd-root');
  container.append(root);

  const say = (clientId, text, tone = 'info') => { messages[clientId] = { text, tone }; };

  function render() {
    root.replaceChildren(header(), el('div', 'cd-grid'));
    const grid = root.lastChild;
    for (const clientId of Object.keys(CLIENTS)) grid.append(clientCard(clientId));
  }

  function header() {
    const box = el('header', 'cd-header');
    const title = el('div', 'cd-title');
    title.append(el('h1', '', 'Колектив (демо)'), el('p', 'cd-subtitle', 'Спільна таблиця двох учасників: «Доповісти» → «Звірити»'));
    const notice = el('p', 'cd-notice', DEMO_NOTICE);
    notice.setAttribute('role', 'note');
    const detail = el('p', 'cd-detail', `Синтетичні дані. Клієнти живуть лише в цьому вікні; закриття застосунку все стирає. ${DEMO_SIGNATURE_NOTE}.`);
    const reset = button('Почати спочатку', () => { demo = createDemo(); messages.A = null; messages.B = null; render(); });
    box.append(title, notice, detail, reset);
    return box;
  }

  function clientCard(clientId) {
    const meta = CLIENTS[clientId];
    const client = demo.clients[clientId];
    const card = el('section', `cd-card cd-card--${clientId.toLowerCase()}`);
    card.setAttribute('aria-label', meta.title);

    const head = el('div', 'cd-card-head');
    const who = el('div');
    who.append(el('h2', '', meta.title), el('p', 'cd-muted', `${meta.role} · ${meta.memberId}`));
    head.append(who);
    if (clientId !== 'A') {
      const label = el('label', 'cd-toggle');
      const box = el('input');
      box.type = 'checkbox';
      box.checked = canWrite(demo, clientId);
      box.addEventListener('change', () => {
        setWriteRight(demo, clientId, box.checked);
        say(clientId, box.checked ? 'Право запису надано' : 'Право запису відкликано власником колективу', box.checked ? 'info' : 'warn');
        render();
      });
      label.append(box, el('span', '', 'Право запису в таблицю'));
      head.append(label);
    } else {
      head.append(el('span', 'cd-badge', 'Право запису'));
    }
    card.append(head);

    if (messages[clientId]) {
      const message = el('p', `cd-message cd-message--${messages[clientId].tone}`, messages[clientId].text);
      message.setAttribute('role', 'status');
      card.append(message);
    }

    card.append(tableView(clientId));

    const actions = el('div', 'cd-actions');
    actions.append(
      button('Доповісти', () => {
        const opened = openReport(demo, clientId);
        if (!opened.ok) say(clientId, opened.reason, 'warn');
        else messages[clientId] = null;
        render();
      }, { primary: true }),
      button('Звірити', () => {
        const summary = synchronize(demo, clientId);
        say(clientId, summaryText(summary), summary.conflicts || summary.rejected ? 'warn' : 'info');
        render();
      }),
      button('Скасувати чернетки', () => { discardPending(demo, clientId); say(clientId, 'Чернетки скасовано'); render(); }, { disabled: client.pending.length === 0 }),
      button('Повторити останню доставку', () => {
        const summary = redeliver(demo, clientId);
        say(clientId, summary.received ? `Повторна доставка: ${summaryText(summary)}` : 'Ще нічого не отримано', 'info');
        render();
      }, { disabled: !client.lastBatch }),
    );
    card.append(actions);

    if (client.preview) card.append(previewView(clientId));
    const conflicts = conflictsOf(demo, clientId);
    if (conflicts.length) card.append(conflictsView(clientId, conflicts));
    card.append(dashboardView(clientId), logView(clientId));
    return card;
  }

  function tableView(clientId) {
    const wrap = el('div', 'cd-table-wrap');
    const table = el('table', 'cd-table');
    const caption = el('caption', '', 'Спільна таблиця «Облік (синтетика)» — змініть клітинку, щоб створити чернетку');
    const head = el('tr');
    for (const column of COLUMNS) head.append(el('th', '', COLUMN_LABELS[column]));
    head.append(el('th', '', 'Версія'));
    table.append(caption, el('thead'), el('tbody'));
    table.tHead.append(head);
    for (const row of visibleRows(demo, clientId)) {
      const draft = draftValues(demo, clientId, row.rowKey);
      const tr = el('tr', draft ? 'cd-row--draft' : '');
      for (const column of COLUMNS) {
        const td = el('td');
        const input = el('input', 'cd-cell');
        input.value = formatCell(draft ? draft[column] : row.values[column]);
        input.setAttribute('aria-label', `${COLUMN_LABELS[column]}, рядок ${row.rowKey}`);
        input.dataset.cell = `${clientId}-${row.rowKey}-${column}`;
        if (draft && draft[column] !== row.values[column]) input.classList.add('cd-cell--changed');
        input.addEventListener('change', () => {
          const edited = editRow(demo, clientId, row.rowKey, { [column]: input.value });
          say(clientId, edited.ok ? 'Чернетка: натисніть «Доповісти», щоб переглянути й відправити' : edited.reason, edited.ok ? 'info' : 'warn');
          render();
        });
        td.append(input);
        tr.append(td);
      }
      tr.append(el('td', 'cd-version', `v${row.version}`));
      table.tBodies[0].append(tr);
    }
    wrap.append(table);
    return wrap;
  }

  function previewView(clientId) {
    const { preview } = demo.clients[clientId];
    const box = el('div', 'cd-preview');
    box.setAttribute('role', 'region');
    box.setAttribute('aria-label', 'Перегляд перед відправкою');
    box.append(el('h3', '', 'Перегляд «Доповісти»: було → стане'));
    for (const item of [...preview.items, ...preview.deletions]) {
      const block = el('div', 'cd-diff');
      block.append(el('p', 'cd-muted', `Рядок ${item.rowKey}`));
      const list = el('dl');
      for (const column of COLUMNS) {
        const changed = item.diff.changed.includes(column);
        const dt = el('dt', changed ? 'cd-changed' : '', COLUMN_LABELS[column]);
        const dd = el('dd', changed ? 'cd-changed' : '');
        dd.append(el('span', 'cd-before', formatCell(item.diff.before && item.diff.before[column])), el('span', 'cd-arrow', ' → '), el('span', 'cd-after', formatCell(item.diff.after && item.diff.after[column])));
        list.append(dt, dd);
      }
      block.append(list);
      box.append(block);
    }
    for (const problem of [...preview.duplicates, ...preview.conflicts, ...preview.invalid]) {
      box.append(el('p', 'cd-message cd-message--warn', `Не відправиться: ${problem.reason || (problem.errors || []).join(', ') || 'дубль'}`));
    }
    box.append(el('p', 'cd-muted', preview.note));
    const actions = el('div', 'cd-actions');
    actions.append(
      button('Підтвердити й відправити', () => {
        const sent = confirmReport(demo, clientId);
        say(clientId, sent.ok ? `Відправлено змін: ${sent.count}. Інший учасник отримає їх після «Звірити»` : sent.reason, sent.ok ? 'info' : 'warn');
        render();
      }, { primary: true }),
      button('Скасувати', () => { demo.clients[clientId].preview = null; render(); }),
    );
    box.append(actions);
    return box;
  }

  function conflictsView(clientId, conflicts) {
    const box = el('div', 'cd-conflicts');
    box.append(el('h3', '', `Конфлікти: ${conflicts.length}`));
    for (const conflict of conflicts) {
      const item = el('div', 'cd-conflict');
      item.append(
        el('p', '', `Рядок ${conflict.rowKey}: інший учасник змінив той самий рядок. Нічого не перезаписано — оберіть варіант.`),
        el('p', 'cd-muted', `Ваше: ${COLUMNS.map(c => formatCell(conflict.mine && conflict.mine[c])).join(' · ')}`),
        el('p', 'cd-muted', `Отримане: ${COLUMNS.map(c => formatCell(conflict.theirs && conflict.theirs[c])).join(' · ')}`),
      );
      const actions = el('div', 'cd-actions');
      for (const [choice, label] of [['keep-mine', 'Залишити своє'], ['take-theirs', 'Прийняти отримане']]) {
        actions.append(button(label, () => {
          const decided = resolve(demo, clientId, conflict.conflictId, choice);
          say(clientId, decided.reason, decided.ok ? 'info' : 'warn');
          render();
        }));
      }
      item.append(actions);
      box.append(item);
    }
    return box;
  }

  function dashboardView(clientId) {
    const series = dashboardSeries(demo, clientId);
    const box = el('figure', 'cd-dashboard');
    box.append(el('figcaption', '', 'Демонстраційний дашборд: кількість за підрозділами'));
    const width = 360;
    const rowHeight = 26;
    const max = Math.max(1, ...series.map(item => item.value));
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${series.length * rowHeight + 4}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', series.map(item => `${item.label}: ${item.value}`).join('; '));
    series.forEach((item, index) => {
      const y = index * rowHeight + 4;
      const label = document.createElementNS(SVG, 'text');
      label.setAttribute('x', '0');
      label.setAttribute('y', String(y + 15));
      label.setAttribute('class', 'cd-bar-label');
      label.textContent = item.label;
      const bar = document.createElementNS(SVG, 'rect');
      bar.setAttribute('x', '110');
      bar.setAttribute('y', String(y + 2));
      bar.setAttribute('height', '18');
      bar.setAttribute('rx', '3');
      bar.setAttribute('width', String(Math.max(2, ((width - 160) * item.value) / max)));
      bar.setAttribute('class', 'cd-bar');
      const value = document.createElementNS(SVG, 'text');
      value.setAttribute('x', String(116 + ((width - 160) * item.value) / max));
      value.setAttribute('y', String(y + 15));
      value.setAttribute('class', 'cd-bar-value');
      value.textContent = String(item.value);
      svg.append(label, bar, value);
    });
    box.append(svg);
    return box;
  }

  function logView(clientId) {
    const box = el('details', 'cd-log');
    box.open = true;
    box.append(el('summary', '', 'Журнал змін (автор, час, операція, стан)'));
    const list = el('ol');
    for (const entry of demo.clients[clientId].log.slice(0, 10)) {
      const item = el('li', `cd-log--${entry.status}`);
      item.append(el('span', 'cd-muted', `${entry.at} `), el('span', '', entry.text));
      if (entry.opId) item.append(el('span', 'cd-muted', ` · ${entry.opId}`));
      list.append(item);
    }
    if (!list.children.length) list.append(el('li', 'cd-muted', 'Записів ще немає'));
    box.append(list);
    return box;
  }

  render();
  return {
    unmount() { root.remove(); },
    isDirty() { return false; },
  };
}

function summaryText(summary) {
  if (!summary.received) return 'Нових змін немає';
  const parts = [`отримано ${summary.received}`, `застосовано ${summary.applied}`];
  if (summary.skipped) parts.push(`повторів пропущено ${summary.skipped}`);
  if (summary.conflicts) parts.push(`конфліктів ${summary.conflicts}`);
  if (summary.rejected) parts.push(`відхилено ${summary.rejected}`);
  return parts.join(', ');
}
