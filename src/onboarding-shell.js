// Вікно ознайомлення: вітання, підказки поверх живого інтерфейсу, чекліст і демо-картка.
// Демо малюється окремо від таблиці модуля і не передається в __AV, артилерію чи експорт.

import {
  CHECKLIST,
  advanceTour,
  assertExportClean,
  checklistView,
  demoView,
  detectModule,
  loadState,
  markChecklist,
  reopenWelcome,
  resumeMessage,
  retreatTour,
  saveState,
  setDemo,
  shouldAutoStart,
  shouldShowResume,
  shouldShowWelcome,
  skipTour,
  startTour,
  submitWelcome,
  tourOf,
  tourSteps,
  unitLabel,
  withoutDemo,
} from './onboarding-core.js';
import { ONBOARDING_CSS } from './onboarding-style.js';

const RESUME_KEY = 'easywar.onboarding.resume';
const BRANCHES = new Set(['air', 'rocket', 'artillery', 'army', 'pvk', 'dshv', 'custom']);

function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === false || value == null) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

function applyStyle() {
  if (document.getElementById('ew-onb-style')) return;
  const style = document.createElement('style');
  style.id = 'ew-onb-style';
  style.textContent = ONBOARDING_CSS;
  document.head.append(style);
}

function hostWindow() {
  try {
    if (window.parent && window.parent !== window) return window.parent;
  } catch {
    /* чужий батьківський кадр */
  }
  return window;
}

function storageOf() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function sessionOf() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function gateBlocking() {
  if (document.getElementById('ew-splash')) return true;
  const gate = document.querySelector('.ew-gate');
  return Boolean(gate && !gate.hidden);
}

function hasRealTable() {
  try {
    if (window.__AV?.S?.wb) return true;
    if (window.__artillery?.S?.model) return true;
  } catch {
    /* модуль без таблиці */
  }
  return false;
}

function visible(node) {
  if (!node) return false;
  const style = getComputedStyle(node);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  const rect = node.getBoundingClientRect();
  return rect.width >= 2 && rect.height >= 2;
}

function openTarget(moduleId) {
  const host = hostWindow();
  if (moduleId === 'hangar' || moduleId === 'garage' || moduleId === 'enemy' || moduleId === 'enemy-air') {
    const hash = moduleId === 'hangar' ? '#hangar' : `#${moduleId}`;
    if (host.EW_GUIDES?.open) {
      host.EW_GUIDES.open(`hangar/EasyWAR_hangar.html${hash}`);
      return;
    }
  }
  if (moduleId === 'guides' && host.EW_GUIDES?.open) {
    host.EW_GUIDES.open('guides/index.html');
    return;
  }
  if (moduleId === 'workspace') {
    const button = [...(host.document?.querySelectorAll('.appbar-right button') || [])].find(node => node.textContent.trim() === 'Робоче середовище');
    if (button) {
      button.click();
      return;
    }
  }
  if (BRANCHES.has(moduleId) && host.EW_LAUNCHER?.openBranch) {
    host.EW_LAUNCHER.openBranch(moduleId);
    return;
  }
  const href = {
    launcher: './index.html',
    guides: './guides/index.html',
    hangar: './hangar/EasyWAR_hangar.html#hangar',
    garage: './hangar/EasyWAR_hangar.html#garage',
    enemy: './hangar/EasyWAR_hangar.html#enemy',
    'enemy-air': './hangar/EasyWAR_hangar.html#enemy-air',
    uav: './guides/uav/index.html',
    brigades: './guides/brigades/index.html',
    air: './air.html',
    rocket: './rocket.html',
    army: './air.html?module=army',
    artillery: './artillery.html',
    pvk: './air.html?command=pvk',
    dshv: './rocket.html?command=dshv',
    custom: './custom.html',
    workspace: './workspace/index.html',
    viewer: './viewer.html',
  }[moduleId];
  if (href) location.assign(href);
}

export function mountOnboarding(options = {}) {
  if (window.__EW_ONBOARDING_MOUNTED) return window.EW_ONBOARDING;
  const moduleId = options.module || detectModule(location.pathname, location.search, document.documentElement.dataset.ewModule || '');
  if (!moduleId) return null;
  applyStyle();
  window.__EW_ONBOARDING_MOUNTED = true;

  let state = loadState(storageOf());
  const persist = next => {
    state = saveState(storageOf(), next);
    renderChrome();
    return state;
  };

  const help = h('div', { class: 'ew-onb-help' },
    h('button', { type: 'button', text: 'Ознайомлення', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }),
    h('div', { class: 'ew-onb-menu', role: 'menu', hidden: true }));
  const helpButton = help.querySelector('button');
  const helpMenu = help.querySelector('.ew-onb-menu');
  document.body.append(help);

  let checklist = null;
  let checklistList = null;
  let checklistCount = null;
  if (moduleId === 'launcher') {
    checklist = h('aside', { class: 'ew-check', id: 'ew-checklist' },
      h('div', { class: 'ew-check-panel' },
        h('button', { type: 'button', class: 'ew-check-head', 'aria-expanded': 'true' }, 'З чого почати', h('b')),
        h('ol')));
    checklistCount = checklist.querySelector('b');
    checklistList = checklist.querySelector('ol');
    document.body.append(checklist);
    checklist.querySelector('.ew-check-head').addEventListener('click', () => {
      const open = checklistList.hidden;
      checklistList.hidden = !open;
      checklist.querySelector('.ew-check-head').setAttribute('aria-expanded', String(open));
    });
  }

  let resume = null;
  let demoBoard = null;
  let spot = null;
  let spotTimer = 0;
  let onTourKey = null;
  let welcome = null;
  let role = state.welcome?.role || '';
  let realMarked = false;

  function closeWelcome() {
    welcome?.remove();
    welcome = null;
  }

  function closeTour() {
    clearInterval(spotTimer);
    if (onTourKey) document.removeEventListener('keydown', onTourKey, true);
    onTourKey = null;
    spot?.remove();
    spot = null;
  }

  function showWelcome() {
    closeWelcome();
    closeTour();
    let picked = role || 'operator';
    const input = h('input', { type: 'text', maxlength: '80', placeholder: 'Напр. навчальна ескадрилья', 'aria-label': 'Підрозділ' });
    input.value = state.welcome?.unitName || '';
    const error = h('p', { class: 'ew-onb-error', role: 'alert' });
    const roles = h('div', { class: 'ew-onb-roles', role: 'radiogroup', 'aria-label': 'Роль' },
      ...['operator', 'analyst', 'commander'].map(id => {
        const titles = { operator: 'Оператор', analyst: 'Аналітик', commander: 'Командир' };
        return h('button', {
          type: 'button',
          text: titles[id],
          'aria-pressed': String(id === picked),
          onclick: () => {
            picked = id;
            roles.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.textContent === titles[id])));
          },
        });
      }));
    const finish = choice => {
      const result = submitWelcome(state, { unitName: input.value, role: picked, choice });
      error.textContent = result.ok ? '' : result.error;
      if (!result.ok) return;
      persist(result.state);
      role = state.welcome?.role || '';
      closeWelcome();
      sessionOf()?.setItem(RESUME_KEY, '1');
      if (choice === 'demo') window.setTimeout(() => beginTour(true), 350);
    };
    welcome = h('div', { class: 'ew-onb-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ew-onb-title' },
      h('form', { class: 'ew-onb-card', onsubmit: event => { event.preventDefault(); finish('demo'); } },
        h('p', { class: 'ew-onb-kicker', text: 'easyWAR' }),
        h('h2', { id: 'ew-onb-title', text: 'Швидке знайомство' }),
        h('p', { text: 'Дві відповіді — і можна подивитись модулі на навчальних даних, без своєї таблиці.' }),
        h('label', { class: 'ew-onb-field' }, 'Підрозділ, якщо хочете', input),
        h('span', { class: 'ew-onb-field', text: 'Роль' }),
        roles,
        error,
        h('div', { class: 'ew-onb-actions' },
          h('button', { type: 'submit', class: 'ew-onb-primary', text: 'Показати на демо-даних' }),
          h('button', { type: 'button', class: 'ew-onb-quiet', text: 'Огляну сам', onclick: () => finish('self') }),
          h('button', { type: 'button', class: 'ew-onb-quiet', text: 'Пізніше', onclick: () => finish('later') }))));
    document.body.append(welcome);
    input.focus();
    welcome.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish('later');
      }
    });
  }

  function placeTip(target) {
    const ring = spot.querySelector('.ew-onb-ring');
    const tip = spot.querySelector('.ew-onb-tip');
    const rect = target.getBoundingClientRect();
    ring.style.top = `${Math.max(8, rect.top - 6)}px`;
    ring.style.left = `${Math.max(8, rect.left - 6)}px`;
    ring.style.width = `${rect.width + 12}px`;
    ring.style.height = `${rect.height + 12}px`;
    const width = tip.offsetWidth;
    const height = tip.offsetHeight;
    let top = rect.bottom + 12;
    if (top + height > window.innerHeight - 12) top = Math.max(12, rect.top - height - 12);
    let left = rect.left;
    if (left + width > window.innerWidth - 12) left = window.innerWidth - width - 12;
    tip.style.top = `${Math.max(12, top)}px`;
    tip.style.left = `${Math.max(12, left)}px`;
  }

  function beginTour(force) {
    const status = tourOf(state, moduleId).status;
    if (!force && status !== 'idle' && status !== 'active') return;
    if (force || status === 'idle') persist(startTour(state, moduleId));
    closeTour();
    const steps = tourSteps(moduleId, state.welcome?.role || '');
    if (!steps.length) return;
    spot = h('div', { class: 'ew-onb-spot' }, h('div', { class: 'ew-onb-ring' }), h('div', { class: 'ew-onb-tip', role: 'dialog', 'aria-live': 'polite' }));
    document.body.append(spot);
    const draw = () => {
      const index = tourOf(state, moduleId).step;
      const step = steps[index];
      if (!step) {
        closeTour();
        return;
      }
      const target = document.querySelector(step.selector);
      const tip = spot.querySelector('.ew-onb-tip');
      if (!visible(target)) {
        if (index >= steps.length - 1) {
          persist(skipTour(state, moduleId));
          closeTour();
          return;
        }
        persist(advanceTour(state, moduleId));
        draw();
        return;
      }
      tip.textContent = '';
      const primary = step.primary || (index === steps.length - 1 ? 'Зрозуміло' : 'Далі');
      tip.append(
        h('p', { class: 'ew-onb-step', text: `Крок ${index + 1} з ${steps.length}` }),
        h('h2', { text: step.title }),
        h('p', { text: step.body }),
        h('div', { class: 'ew-onb-actions' },
          h('button', { type: 'button', class: 'ew-onb-quiet', text: 'Пропустити', onclick: () => { persist(skipTour(state, moduleId)); closeTour(); } }),
          index > 0 ? h('button', { type: 'button', class: 'ew-onb-quiet', text: 'Назад', onclick: () => { persist(retreatTour(state, moduleId)); draw(); } }) : null,
          h('button', {
            type: 'button',
            class: 'ew-onb-primary',
            text: primary,
            onclick: () => {
              if (step.action === 'open-hangar') openTarget('hangar');
              if (step.action === 'follow' && target.href) target.click();
              const last = index >= steps.length - 1;
              persist(advanceTour(state, moduleId));
              if (last || tourOf(state, moduleId).status === 'done' || step.action === 'open-hangar') closeTour();
              else draw();
            },
          })),
      );
      placeTip(target);
      tip.querySelector('.ew-onb-primary')?.focus();
    };
    draw();
    spotTimer = window.setInterval(() => {
      const index = tourOf(state, moduleId).step;
      const target = document.querySelector(steps[index]?.selector || 'x');
      if (spot && visible(target)) placeTip(target);
    }, 400);
    onTourKey = event => {
      if (event.key !== 'Escape' || !spot) return;
      event.preventDefault();
      event.stopPropagation();
      persist(skipTour(state, moduleId));
      closeTour();
    };
    document.addEventListener('keydown', onTourKey, true);
  }

  function launcherCovered() {
    if (moduleId !== 'launcher') return false;
    if (document.body.dataset.activeBranch) return true;
    for (const selector of ['.ew-guides-overlay', '.ew-workspace-overlay']) {
      const overlay = document.querySelector(selector);
      if (overlay && !overlay.hidden) return true;
    }
    return false;
  }

  function syncLauncherChrome() {
    if (moduleId !== 'launcher') return;
    const covered = launcherCovered();
    help.hidden = covered;
    if (checklist) checklist.hidden = covered;
    if (resume) resume.hidden = covered;
    if (covered) closeTour();
    else if (!welcome && tourOf(state, moduleId).status === 'active' && !spot) beginTour(false);
  }

  function watchCover() {
    if (moduleId !== 'launcher') return;
    const observe = node => {
      if (!node || node.dataset.ewOnbWatch === '1') return;
      node.dataset.ewOnbWatch = '1';
      new MutationObserver(syncLauncherChrome).observe(node, { attributes: true, attributeFilter: ['hidden'] });
    };
    observe(document.querySelector('.ew-guides-overlay'));
    observe(document.querySelector('.ew-workspace-overlay'));
    new MutationObserver(syncLauncherChrome).observe(document.body, { attributes: true, attributeFilter: ['data-active-branch'] });
  }

  function renderChecklist() {
    if (!checklistList) return;
    const items = checklistView(state);
    const done = items.filter(item => item.done).length;
    checklistCount.textContent = `${done}/${items.length}`;
    checklistList.textContent = '';
    for (const item of items) {
      checklistList.append(h('li', { class: item.done ? 'is-done' : '' },
        h('button', { type: 'button', onclick: () => openTarget(item.module) },
          h('i', { text: item.done ? '✓' : '○', 'aria-hidden': 'true' }),
          item.title)));
    }
  }

  function renderDemo() {
    demoBoard?.remove();
    demoBoard = null;
    const view = state.demo ? demoView(moduleId, unitLabel(state)) : null;
    if (!view || hasRealTable()) {
      if (hasRealTable() && !realMarked) {
        realMarked = true;
        persist(markChecklist(state, 'own'));
      }
      return;
    }
    const check = assertExportClean(view.rows);
    if (check.ok) return;
    demoBoard = h('section', { id: 'ew-demo-board', class: 'ew-demo-board', 'data-demo': 'true', 'aria-label': view.title },
      h('div', { class: 'ew-demo-head' },
        h('span', { class: 'ew-demo-badge', text: 'ДЕМО' }),
        h('strong', { text: view.title }),
        h('button', { type: 'button', class: 'ew-onb-primary', text: 'Прибрати демо-дані', onclick: () => persist(setDemo(state, false)) })),
      h('p', { class: 'ew-demo-note', text: view.note }),
      h('div', { class: 'ew-demo-kpis' }, ...view.kpis.map(([label, value]) => h('div', {}, h('b', { text: value }), h('span', { text: label })))),
      h('ul', {}, ...view.rows.map(row => h('li', { text: row.text }))));
    document.body.append(demoBoard);
  }

  function renderMenu() {
    const demoLabel = state.demo ? 'Прибрати демо-дані' : 'Показати демо-дані';
    helpMenu.textContent = '';
    const item = (text, run) => h('button', { type: 'button', role: 'menuitem', text, onclick: () => { helpMenu.hidden = true; helpButton.setAttribute('aria-expanded', 'false'); run(); } });
    helpMenu.append(
      item('Пройти цей модуль', () => beginTour(true)),
      item('З чого почати', () => {
        if (checklistList) {
          checklistList.hidden = false;
          checklist.querySelector('.ew-check-head').setAttribute('aria-expanded', 'true');
          checklist.scrollIntoView({ block: 'nearest' });
          return;
        }
        const pop = document.getElementById('ew-onb-pop');
        pop?.remove();
        const box = h('aside', { class: 'ew-check', id: 'ew-onb-pop' },
          h('div', { class: 'ew-check-panel' },
            h('button', { type: 'button', class: 'ew-check-head', text: 'Закрити', onclick: () => box.remove() }),
            h('ol', {}, ...checklistView(state).map(entry => h('li', { class: entry.done ? 'is-done' : '' },
              h('button', { type: 'button', onclick: () => { box.remove(); openTarget(entry.module); } },
                h('i', { text: entry.done ? '✓' : '○' }), entry.title))))));
        document.body.append(box);
      }),
      item(demoLabel, () => {
        if (!state.welcome || state.welcome.choice === 'later') showWelcome();
        else persist(setDemo(state, !state.demo));
      }),
      item('Змінити відповіді', () => {
        persist(reopenWelcome(state));
        showWelcome();
      }));
  }

  function renderResume() {
    resume?.remove();
    resume = null;
    if (moduleId !== 'launcher' || welcome) return;
    const message = resumeMessage(state);
    if (!message || sessionOf()?.getItem(RESUME_KEY) === '1') return;
    sessionOf()?.setItem(RESUME_KEY, '1');
    resume = h('div', { class: 'ew-onb-resume', role: 'status' },
      h('div', {}, h('strong', { text: message.title }), h('p', { text: message.text })),
      h('button', {
        type: 'button',
        class: 'ew-onb-primary',
        text: 'Продовжити',
        onclick: () => {
          resume.remove();
          resume = null;
          if (message.action === 'welcome') showWelcome();
          else if (checklistList) checklistList.hidden = false;
        },
      }));
    document.body.append(resume);
  }

  function renderChrome() {
    renderMenu();
    renderChecklist();
    renderDemo();
  }

  helpButton.addEventListener('click', () => {
    helpMenu.hidden = !helpMenu.hidden;
    helpButton.setAttribute('aria-expanded', String(!helpMenu.hidden));
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !helpMenu.hidden) {
      helpMenu.hidden = true;
      helpButton.setAttribute('aria-expanded', 'false');
    }
  });
  window.addEventListener('storage', event => {
    if (event.key && event.key !== 'easywar.onboarding.v1') return;
    state = loadState(storageOf());
    renderChrome();
  });

  const api = {
    get state() { return state; },
    showWelcome,
    startTour: () => beginTour(true),
    withoutDemo,
    assertExportClean,
  };
  window.EW_ONBOARDING = api;
  renderChrome();
  watchCover();

  const surface = () => {
    if (gateBlocking()) return;
    if (shouldShowWelcome(state, moduleId)) showWelcome();
    else if (shouldShowResume(state, moduleId)) renderResume();
    else if (shouldAutoStart(state, moduleId)) window.setTimeout(() => beginTour(false), 400);
  };
  if (!gateBlocking()) surface();
  else {
    const observer = new MutationObserver(() => {
      if (gateBlocking()) return;
      observer.disconnect();
      surface();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class'] });
    window.addEventListener('ew:splash-end', () => {
      if (!gateBlocking()) {
        observer.disconnect();
        surface();
      }
    });
  }
  window.setInterval(() => {
    const want = Boolean(state.demo && demoView(moduleId, unitLabel(state)) && !hasRealTable());
    if (want !== Boolean(demoBoard) || (hasRealTable() && !realMarked)) renderDemo();
  }, 1000);

  return api;
}

export function mountPageOnboarding() {
  return mountOnboarding();
}
