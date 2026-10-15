import { outfitForBranch } from './assistant-outfit-core.js';
import './assistant-ui.css';
import { createAssistantSession } from './assistant-session-core.js';
import { searchKnowledge, isInstructionText } from './assistant-knowledge-core.js';
import { reviewAssistantData } from './assistant-rules-core.js';
import { readVisibleAssistantContext } from './assistant-context.js';
import { stateQuestion, answerApplicationState } from './assistant-state-core.js';
import { createAssistantMotion } from './assistant-motion.js';
import { languageReply, answerLead, reviewLead, welcomeRemark, reviewRemark, explainLead, WELCOME_TEXT } from './assistant-persona-core.js';
import { explainElement } from './assistant-explain-core.js';
import { createExplainController } from './assistant-explain.js';
import { PROPOSAL_KINDS, PROPOSAL_TEXT_LIMIT, buildProposal, proposalFileNames, validateProposalImage, validateProposalText } from './assistant-proposal-core.js';
import { appUpdateState } from '../app-update-state-core.js';

// The knowledge index is large: it loads on the first question, not when the launcher starts.
let knowledge = null;
async function loadKnowledge() {
  if (!knowledge) knowledge = (await import('./knowledge/index.json')).default;
  return knowledge;
}

const defaultPortraitURL = new URL('./assets/colonel-kombat-stable.png', import.meta.url).href;
const outfitPortraits = {
  default: defaultPortraitURL,
  pilot: new URL('./assets/colonel-outfit-pilot.webp', import.meta.url).href,
  dress: new URL('./assets/colonel-outfit-dress.webp', import.meta.url).href,
  dshv: new URL('./assets/colonel-outfit-dshv.webp', import.meta.url).href,
  rocket: new URL('./assets/colonel-outfit-rocket.webp', import.meta.url).href,
  artillery: new URL('./assets/colonel-outfit-artillery.webp', import.meta.url).href
};
let portraitURL = defaultPortraitURL;
const gestureClips = {
  wave: { url: new URL('./assets/colonel-wave.webp', import.meta.url).href, durationMs: 2100 },
  explain: { url: new URL('./assets/colonel-explain.webp', import.meta.url).href, durationMs: 1900 },
  point: { url: new URL('./assets/colonel-point.webp', import.meta.url).href, durationMs: 2300 },
  attention: { url: new URL('./assets/colonel-attention.webp', import.meta.url).href, durationMs: 2300 }
};

function element(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (value === true) node.setAttribute(key, '');
    else if (value != null && value !== false) node.setAttribute(key, value);
  }
  node.append(...children.flat().filter(Boolean));
  return node;
}

function actionIcon(kind) {
  const paths = {
    entry: ['M14 3h5v18H5V3h5', 'M10 2h4v4h-4z', 'M8 11h8M8 15h6'],
    compass: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18', 'm16 8-3 5-5 3 3-5z'],
    update: ['M20 7v5h-5', 'M4 17v-5h5', 'M6 7a7 7 0 0 1 12-1l2 2', 'M18 17a7 7 0 0 1-12 1l-2-2'],
    arrow: ['m7 17 10-10', 'M7 7h10v10']
  };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths[kind]) {
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', d); svg.append(path);
  }
  return svg;
}

// Created by the existing profile UI; never reads storage or starts background work.
export function createAssistantUI({ getSession, getApplicationState, readContext = readVisibleAssistantContext } = {}) {
  const session = createAssistantSession();
  let mode = 'help', history = [], review = null, reviewLabel = '', status = '', navigationStatus = '', busy = false, request = 0, pendingInput = '';
  // Репліка обирається один раз на показ, щоб не мінятися під час перемальовування.
  let remarkSeed = Math.floor(Math.random() * 2147483647);
  // Режим «Пояснити»: результат останнього кліку в модулі. Нічого не зберігається поза сесією профілю.
  let explainResult = null, explainNote = '', explainBranch = '';
  let proposal = { kind: 'fix', text: '', withContext: true, image: null, previewUrl: '', note: '' };
  const avatarImage = element('img', { src: portraitURL, alt: '', draggable: 'false' });
  const launcher = element('button', { type: 'button', class: 'ew-assistant-launcher', hidden: true, 'aria-label': 'Відкрити помічника КОМБАТ', 'aria-controls': 'ew-assistant-panel', 'aria-expanded': 'false' },
    element('span', { class: 'ew-assistant-avatar', 'aria-hidden': 'true' }, avatarImage),
    element('span', {}, element('strong', { text: 'КОМБАТ' }), element('small', { text: 'Запитати помічника' })));
  const panel = element('aside', { id: 'ew-assistant-panel', class: 'ew-assistant-panel', hidden: true, 'aria-label': 'КОМБАТ — локальний помічник' });
  const characterImage = element('img', { src: portraitURL, alt: '', draggable: 'false', decoding: 'async' });
  const motion = createAssistantMotion({ image: characterImage, staticURL: portraitURL, clips: gestureClips });
  // Одяг відповідає відкритому модулю; жести (вітання, вказівка) намальовані лише для базового образу.
  let outfit = 'default';
  function applyOutfit() {
    const next = outfitForBranch(document.body.dataset.activeBranch);
    if (next === outfit) return;
    outfit = next; portraitURL = outfitPortraits[next];
    avatarImage.src = portraitURL;
    motion.configure({ staticURL: portraitURL, clips: next === 'default' ? gestureClips : {} });
    document.body.dataset.assistantOutfit = next;
  }
  characterImage.addEventListener('error', () => { if (characterImage.hasAttribute('data-gesture')) motion.stop(); });
  const character = element('figure', { class: 'ew-assistant-character', 'aria-hidden': 'true' },
    characterImage,
    element('figcaption', { text: 'КОМБАТ' }));
  const announcer = element('span', { class: 'ew-assistant-sr', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const checkbox = element('input', { type: 'checkbox', id: 'ew-assistant-enable', disabled: true });
  const settings = element('section', { class: 'ew-assistant-setting', 'aria-label': 'Налаштування помічника' },
    element('label', {}, checkbox, element('span', { text: 'Увімкнути локального помічника' })),
    element('small', { text: 'Лише для поточного входу в профіль. Довідка та перевірка відкритої таблиці без інтернету. Записів не створює; розмови не зберігає.' }));
  document.body.append(launcher, panel, announcer);
  const explain = createExplainController({
    onExplain(descriptor) {
      if (!descriptor || !session.state().enabled) return;
      explainResult = explainElement(descriptor); explainBranch = descriptor.branch || ''; explainNote = '';
      mode = 'explain';
      if (panel.hidden) { panel.hidden = false; launcher.setAttribute('aria-expanded', 'true'); }
      render(); gesture(explainResult.status === 'found' ? 'point' : 'explain');
      announcer.textContent = [explainLead(explainResult), explainResult.title, explainResult.what, ...explainResult.basis].filter(Boolean).join('\n');
    },
    onStop(reason) {
      explainNote = reason === 'escape' ? 'Режим пояснення вимкнено клавішею Esc.' : 'Режим пояснення вимкнено: модуль закрито або змінено.';
      if (!panel.hidden && session.state().enabled) render();
      announcer.textContent = explainNote;
    }
  });

  function resetProposal() { if (proposal.previewUrl) URL.revokeObjectURL(proposal.previewUrl); proposal = { kind: 'fix', text: '', withContext: true, image: null, previewUrl: '', note: '' }; }
  function clear() { explain.stop(); explainResult = null; explainBranch = ''; explainNote = ''; resetProposal(); motion.stop(); request++; history = []; pendingInput = ''; review = null; status = ''; navigationStatus = ''; busy = false; checkbox.checked = false; panel.hidden = true; launcher.hidden = true; launcher.setAttribute('aria-expanded', 'false'); panel.replaceChildren(); announcer.textContent = ''; }
  function updateSession(id) {
    const previous = session.state();
    const next = session.setProfile(id);
    if (previous.revision !== next.revision) clear();
    checkbox.disabled = !next.profileId;
    checkbox.checked = next.enabled;
    launcher.hidden = !next.enabled;
    syncUpdateBadge();
  }
  function syncUpdateBadge() {
    launcher.querySelector('small').textContent = appUpdateState.getSnapshot().status === 'available' ? 'Є оновлення' : 'Запитати помічника';
  }
  function gesture(id) { if (!panel.hidden && session.state().enabled) motion.play(id); }
  function close() { explain.stop(); motion.stop(); panel.hidden = true; launcher.setAttribute('aria-expanded', 'false'); if (!launcher.hidden) launcher.focus(); }
  // Натискання на планку «Зв'язок з розробником»: КОМБАТ показує на скроню. Посилання діє як завжди.
  document.addEventListener('click', event => { if (event.target instanceof Element && event.target.closest('.dev-banner')) gesture('attention'); });
  function open() { if (!session.state().enabled) return; panel.hidden = false; launcher.setAttribute('aria-expanded', 'true'); render(); panel.querySelector('.ew-assistant-input input')?.focus(); gesture('wave'); }
  async function allowed(token) {
    if (!session.accepts(token)) return false;
    try {
      const id = await getSession();
      if (!session.accepts(token)) return false;
      if (id !== token.profileId || document.documentElement.classList.contains('ew-locked')) { updateSession(null); return false; }
      return true;
    } catch { if (session.accepts(token)) updateSession(null); return false; }
  }
  function sourceNode(source) {
    const area = element('div', { class: 'ew-assistant-source' });
    const title = `Джерело: ${source.file} → ${source.section}`;
    const button = element('button', { type: 'button', text: title, 'aria-expanded': 'false' });
    button.addEventListener('click', () => {
      const old = area.querySelector('.ew-assistant-source-view');
      if (old) { old.remove(); button.setAttribute('aria-expanded', 'false'); return; }
      const chunk = knowledge?.chunks.find(item => item.id === source.chunkId && item.file === source.file);
      if (chunk) area.append(element('div', { class: 'ew-assistant-source-view', text: chunk.text }));
      button.setAttribute('aria-expanded', 'true');
      gesture('point');
    });
    area.append(button); return area;
  }
  function helpContent() {
    const body = element('div');
    if (!history.length) body.append(
      element('div', { class: 'ew-assistant-kicker', text: 'СВІЙ ПОМІЧНИК. ЗАВЖДИ ПОРУЧ.' }),
      element('h2', { class: 'ew-assistant-welcome', text: WELCOME_TEXT.heading }),
      element('p', { class: 'ew-assistant-note', text: WELCOME_TEXT.body }),
      element('p', { class: 'ew-assistant-remark', text: `«${welcomeRemark(remarkSeed)}»` }),
      element('div', { class: 'ew-assistant-quick' }, ...[
        { icon: 'entry', title: 'Внести дані', detail: 'Як додати доповідь', query: 'Як внести доповідь?' },
        { icon: 'compass', title: 'Розібратися', detail: 'Профілі та робочі модулі', query: 'Як працюють профілі?' },
        { icon: 'update', title: 'Оновлення', detail: 'Як перевірити нову версію', query: 'Як перевірити оновлення?' }
      ].map(action => element('button', { type: 'button', onclick: () => ask(action.query), disabled: busy },
        element('span', { class: 'ew-assistant-action-icon' }, actionIcon(action.icon)),
        element('span', {}, element('strong', { text: action.title }), element('small', { text: action.detail })),
        element('span', { class: 'ew-assistant-action-arrow', 'aria-hidden': 'true' }, actionIcon('arrow'))))),
      element('p', { class: 'ew-assistant-footnote', text: 'Відповіді з локальної довідки, разом із джерелом. Зміни в таблицю вносите ви.' }));
    for (const message of history) {
      body.append(element('div', { class: 'ew-assistant-message ew-assistant-question', text: message.query }));
      const answer = element('div', { class: 'ew-assistant-message' });
      if (message.voice) answer.append(element('p', { class: 'ew-assistant-voice', text: message.voice }));
      answer.append(element('div', { class: 'ew-assistant-answer-text', text: message.answer.text }));
      for (const warning of message.answer.warnings || []) if (warning.message !== message.answer.text) answer.append(element('p', { class: 'ew-assistant-warning', text: warning.message }));
      for (const source of message.answer.sources || []) answer.append(sourceNode(source));
      if (message.answer.origin === 'application-state' && message.answer.status === 'found') answer.append(element('span', { class: 'ew-assistant-source', text: 'Джерело: поточний локальний стан easyWAR' }));
      body.append(answer);
    }
    return body;
  }
  function reviewContent() {
    const body = element('div', {},
      element('div', { class: 'ew-assistant-kicker', text: 'ДАНІ ПІД КОНТРОЛЕМ' }),
      element('h2', { class: 'ew-assistant-welcome', text: 'Перевіримо разом' }),
      element('p', { class: 'ew-assistant-note', text: 'Перевірю лише таблицю, відкриту в поточному модулі. Поясню можливі помилки. Виправлення залишаються вашим рішенням.' }),
      element('button', { type: 'button', class: 'ew-assistant-primary', disabled: busy, text: busy ? 'Перевіряю…' : 'Перевірити відкриту таблицю', onclick: checkData }));
    if (status) body.append(element('p', { class: 'ew-assistant-warning', role: 'status', text: status }));
    if (!review) return body;
    const voice = reviewLead(review);
    if (voice) body.append(element('p', { class: 'ew-assistant-review-voice', text: voice }));
    const remark = reviewRemark(review, remarkSeed);
    if (remark) body.append(element('p', { class: 'ew-assistant-remark', text: `«${remark}»` }));
    body.append(element('div', { class: 'ew-assistant-reviewed' }, element('span', { text: `${reviewLabel} · знімок перевірки` }), element('span', { text: `${review.counts.total} зауважень` })));
    if (review.clean) body.append(element('p', { class: 'ew-assistant-note', text: 'Наявні правила не знайшли проблем. Це не підтвердження правильності всіх даних і не схвалення записів.' }));
    for (const finding of review.items.slice(0, 100)) body.append(element('article', { class: 'ew-assistant-finding' },
      element('span', { class: `ew-assistant-severity ${finding.severity}`, text: { error: 'ПОМИЛКА', warning: 'ПОПЕРЕДЖЕННЯ', advice: 'ПОРАДА' }[finding.severity] }),
      element('h3', { text: finding.message }), element('p', { text: finding.explanation }),
      element('p', { text: `Що зробити: ${finding.suggestion}` }),
      element('div', { class: 'ew-assistant-location', text: `${finding.ruleId} · ${finding.location}` })));
    if (review.items.length > 100) body.append(element('p', { class: 'ew-assistant-note', text: 'Показано перші 100 зауважень. Перевірка охопила всю відкриту таблицю.' }));
    return body;
  }
  function navigationContent() {
    const update = answerApplicationState('updates', appUpdateState.getSnapshot());
    return element('div', {},
      element('div', { class: 'ew-assistant-kicker', text: 'ЗНАЙДЕМО ПОТРІБНЕ' }),
      element('h2', { class: 'ew-assistant-welcome', text: 'Куди ведемо?' }),
      element('p', { class: 'ew-assistant-note', text: 'Відкрию штатний екран. Наступну дію обираєте ви.' }),
      element('div', { class: 'ew-assistant-quick' }, ...[
        ['profiles', 'Профілі', 'Користувачі та налаштування входу', 'compass'],
        ['backup', 'Резервна копія', 'Створення та перевірка копії', 'entry'],
        ['updates', 'Оновлення', 'Стан і ручна перевірка версії', 'update'],
      ].map(([id, title, detail, icon]) => element('button', {
        type: 'button', 'data-area': id, onclick: event => { event.stopPropagation(); void navigate(id); },
      }, element('span', { class: 'ew-assistant-action-icon' }, actionIcon(icon)),
      element('span', {}, element('strong', { text: title }), element('small', { text: detail })),
      element('span', { class: 'ew-assistant-action-arrow', 'aria-hidden': 'true' }, actionIcon('arrow'))))),
      element('p', { class: 'ew-assistant-update-status', text: update.text }),
      navigationStatus ? element('p', { class: 'ew-assistant-warning', role: 'status', text: navigationStatus }) : null);
  }
  async function navigate(area) {
    const selectors = { profiles: '.ew-profile-open', backup: '.ew-backup-open', updates: '.ew-header-update' };
    if (!Object.prototype.hasOwnProperty.call(selectors, area) || busy || !session.state().enabled) return;
    const token = session.token();
    const profileId = session.state().profileId;
    if (!(await allowed(token))) return;
    const target = document.querySelector(selectors[area]);
    if (!target || target.disabled) {
      navigationStatus = 'Цей екран зараз недоступний.';
      render();
      return;
    }
    close();
    if (document.body.dataset.activeBranch) document.querySelector('#branch-home')?.click();
    requestAnimationFrame(async () => {
      if (session.state().profileId !== profileId || !session.state().enabled) return;
      const ok = await allowed(session.token());
      if (!ok) return;
      target.click();
    });
  }
  function explainContent() {
    const on = explain.isActive();
    const body = element('div');
    body.append(
      element('p', { class: 'ew-assistant-note', text: 'Увімкніть режим і клікніть по будь-якому показнику, панелі чи кнопці дашборду ПС, РВ або УДШВ. КОМБАТ скаже, що це, і на чому засновано число. Кліки в цьому режимі нічого не змінюють.' }),
      element('button', {
        type: 'button', class: 'ew-assistant-primary ew-assistant-explain-toggle', 'aria-pressed': String(on), text: on ? 'Вимкнути режим пояснення' : 'Увімкнути режим пояснення',
        onclick: () => {
          if (explain.isActive()) { explain.stop(); explainNote = 'Режим пояснення вимкнено.'; }
          else if (explain.start()) { explainNote = 'Режим увімкнено. Клікніть по елементу дашборду. Esc у модулі — вихід.'; gesture('explain'); }
          else explainNote = 'Відкрийте дашборд ПС, РВ або УДШВ — режим працює у відкритому модулі.';
          render(); announcer.textContent = explainNote; if (!explain.isActive()) panel.querySelector('.ew-assistant-explain-toggle')?.focus();
        }
      }));
    if (explainNote) body.append(element('p', { class: 'ew-assistant-status', role: 'status', text: explainNote }));
    if (explainResult) {
      const card = element('section', { class: 'ew-assistant-explain', 'aria-label': 'Пояснення елемента' },
        element('p', { class: 'ew-assistant-lead', text: explainLead(explainResult) }),
        element('h3', { text: explainResult.title }),
        explainResult.live ? element('p', { class: 'ew-assistant-explain-live', text: explainResult.live }) : null,
        element('p', { text: explainResult.what }));
      if (explainResult.basis.length) card.append(element('h4', { text: 'На чому засновано' }), element('ul', {}, ...explainResult.basis.map(item => element('li', { text: item }))));
      if (explainResult.hint) card.append(element('p', { class: 'ew-assistant-explain-hint', text: `Підказка модуля: ${explainResult.hint}` }));
      if (explainResult.sources.length) card.append(element('p', { class: 'ew-assistant-explain-src', text: `Джерело: ${explainResult.sources.map(item => `${item.file} → ${item.section}`).join('; ')}` }));
      body.append(card);
    }
    body.append(proposalSection());
    return body;
  }
  function download(name, blob) {
    const url = URL.createObjectURL(blob);
    const link = element('a', { href: url, download: name });
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function proposalFiles() {
    const verdict = validateProposalText(proposal.text);
    if (!verdict.ok) { proposal.note = verdict.message; render(); return null; }
    const now = new Date();
    const names = proposalFileNames(now, proposal.image);
    let appVersion = '';
    try { appVersion = (await getApplicationState?.('version'))?.appVersion || ''; } catch { /* версія необов'язкова */ }
    const context = proposal.withContext && explainResult ? { branch: explainBranch, title: explainResult.title } : null;
    const text = buildProposal({ kind: proposal.kind, text: proposal.text, context, appVersion, createdAt: now, imageName: names.image });
    return { names, text };
  }
  function proposalSection() {
    const kinds = element('select', { 'aria-label': 'Тип пропозиції', onchange: event => { proposal.kind = event.target.value; } },
      ...PROPOSAL_KINDS.map(item => element('option', { value: item.id, text: item.label, selected: item.id === proposal.kind })));
    const area = element('textarea', { rows: '4', maxlength: String(PROPOSAL_TEXT_LIMIT), 'aria-label': 'Опис пропозиції', placeholder: 'Що змінити чи додати і навіщо…', oninput: event => { proposal.text = event.target.value; } });
    area.value = proposal.text;
    const context = element('label', { class: 'ew-assistant-proposal-check' },
      element('input', { type: 'checkbox', checked: proposal.withContext && !!explainResult, disabled: !explainResult, onchange: event => { proposal.withContext = event.target.checked; } }),
      element('span', { text: explainResult ? `Додати назву елемента: «${explainResult.title}»` : 'Назву елемента буде додано після пояснення' }));
    const file = element('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', 'aria-label': 'Скриншот', onchange: event => {
      const picked = event.target.files?.[0] || null;
      const verdict = validateProposalImage(picked);
      if (proposal.previewUrl) URL.revokeObjectURL(proposal.previewUrl);
      proposal.image = verdict.ok ? picked : null; proposal.previewUrl = verdict.ok && picked ? URL.createObjectURL(picked) : '';
      proposal.note = verdict.message; render();
    } });
    const actions = element('div', { class: 'ew-assistant-proposal-actions' },
      element('button', { type: 'button', class: 'ew-assistant-primary', text: 'Зберегти пакет', onclick: async () => {
        const pack = await proposalFiles(); if (!pack) return;
        download(pack.names.text, new Blob([pack.text], { type: 'text/markdown;charset=utf-8' }));
        if (proposal.image) download(pack.names.image, proposal.image);
        proposal.note = 'Пакет збережено у «Завантаженнях». Натисніть «Відкрити Signal» і надішліть розробнику файл' + (proposal.image ? 'и' : '') + '.'; render();
      } }),
      element('button', { type: 'button', text: 'Копіювати текст', onclick: async () => {
        const pack = await proposalFiles(); if (!pack) return;
        try { await navigator.clipboard.writeText(pack.text); proposal.note = 'Текст скопійовано. Вставте його в Signal.'; }
        catch { proposal.note = 'Не вдалося скопіювати. Збережіть пакет файлом.'; }
        render();
      } }),
      element('button', { type: 'button', text: 'Відкрити Signal', onclick: () => {
        const banner = document.querySelector('.dev-banner');
        if (banner) banner.click(); else { proposal.note = 'Посилання на розробника зараз недоступне.'; render(); }
      } }));
    return element('section', { class: 'ew-assistant-proposal', 'aria-label': 'Запропонувати правку чи функцію' },
      element('h3', { text: 'Запропонувати правку чи функцію' }),
      element('p', { class: 'ew-assistant-note', text: 'Опишіть, що змінити. Пакет формується на цьому пристрої й нічого не надсилає автоматично: ви самі передаєте його розробнику в Signal.' }),
      kinds, area, context,
      element('label', { class: 'ew-assistant-proposal-file' }, element('span', { text: 'Скриншот (необов’язково)' }), file),
      proposal.previewUrl ? element('img', { class: 'ew-assistant-proposal-preview', src: proposal.previewUrl, alt: 'Попередній перегляд скриншота' }) : null,
      element('p', { class: 'ew-assistant-note', text: 'Перед додаванням скриншота переконайтеся, що на ньому немає реальних оперативних даних.' }),
      actions,
      proposal.note ? element('p', { class: 'ew-assistant-status', role: 'status', text: proposal.note }) : null);
  }
  function render() {
    if (!session.state().enabled) return;
    const oldInput = panel.querySelector('.ew-assistant-input input');
    if (oldInput) pendingInput = oldInput.value;
    const bubble = element('section', { class: 'ew-assistant-bubble' }, element('header', { class: 'ew-assistant-head' },
      element('div', { class: 'ew-assistant-identity' }, element('small', { text: 'ПОМІЧНИК' }), element('strong', { text: 'КОМБАТ' })),
      element('span', { class: 'ew-assistant-offline', text: 'Офлайн' }),
      element('button', { type: 'button', class: 'ew-assistant-close', text: '×', 'aria-label': 'Згорнути помічника', onclick: close })),
      element('nav', { class: 'ew-assistant-tabs', 'aria-label': 'Режим помічника' }, ...[['help', 'Запитати'], ['navigate', 'Навігація'], ['review', 'Перевірити дані'], ['explain', 'Пояснити']].map(([id, label]) => element('button', { type: 'button', class: 'ew-assistant-tab', 'data-mode': id, 'aria-pressed': String(mode === id), text: label, onclick: () => { mode = id; render(); gesture(id === 'review' ? 'point' : 'explain'); panel.querySelector(`[data-mode="${id}"]`)?.focus(); } }))),
      element('div', { class: 'ew-assistant-content' }, mode === 'help' ? helpContent() : mode === 'navigate' ? navigationContent() : mode === 'explain' ? explainContent() : reviewContent()));
    panel.replaceChildren(character, bubble);
    const input = element('input', { 'aria-label': 'Запитання до КОМБАТА', placeholder: 'Запитайте українською…', maxlength: '512', autocomplete: 'off' }); input.value = pendingInput;
    const form = element('form', { class: 'ew-assistant-compose' }, element('div', { class: 'ew-assistant-input' }, input, element('button', { type: 'submit', text: '→', disabled: busy, 'aria-label': 'Надіслати запитання' })), element('small', { text: 'Локальна довідка · історія лише до виходу з профілю' }));
    form.addEventListener('submit', event => { event.preventDefault(); const query = input.value; input.value = ''; pendingInput = ''; ask(query); }); bubble.append(form);
    const content = panel.querySelector('.ew-assistant-content'); content.scrollTop = mode === 'help' && history.length ? content.scrollHeight : 0;
  }
  async function ask(value) {
    const query = String(value || '').trim().slice(0, 512); if (!query || busy || !session.state().enabled) return;
    const token = session.token(), current = ++request; busy = true; render();
    if (!(await allowed(token)) || current !== request) return;
    const language = isInstructionText(query) ? null : languageReply(query);
    const kind = language ? null : stateQuestion(query);
    let answer;
    if (language) answer = language;
    else if (kind) {
      try { answer = answerApplicationState(kind, await getApplicationState?.(kind)); }
      catch { answer = answerApplicationState(kind); }
      if (!(await allowed(token)) || current !== request) return;
    } else {
      try { answer = searchKnowledge(await loadKnowledge(), query, { maxResults: 1 }); }
      catch { answer = { status: 'unknown', text: 'Довідку не вдалося завантажити. Спробуйте ще раз.', sources: [], warnings: [] }; }
      if (!(await allowed(token)) || current !== request) return;
    }
    const voice = answerLead(query, answer);
    history.push({ query, answer, voice }); history = history.slice(-20); busy = false; mode = 'help'; render(); gesture('explain');
    announcer.textContent = [voice, answer.text].filter(Boolean).join('\n'); panel.querySelector('.ew-assistant-input input')?.focus();
  }
  async function checkData() {
    if (busy || !session.state().enabled) return;
    const token = session.token(), current = ++request; busy = true; review = null; status = ''; render();
    try {
      if (!(await allowed(token)) || current !== request) return;
      const context = await readContext();
      if (!(await allowed(token)) || current !== request) return;
      if (context.isCurrent && !context.isCurrent()) status = 'Відкритий контекст змінився. Запустіть перевірку ще раз.';
      else if (context.input) { review = reviewAssistantData(context.input); reviewLabel = context.label; remarkSeed = Math.floor(Math.random() * 2147483647); }
      else status = context.message;
    } catch { if (session.accepts(token) && current === request) status = 'Не вдалося перевірити відкриту таблицю. Спробуйте ще раз.'; }
    finally { if (session.accepts(token) && current === request) { busy = false; render(); gesture('point'); announcer.textContent = status || `${review?.counts.total || 0} зауважень у відкритій таблиці.`; panel.querySelector('.ew-assistant-primary')?.focus(); } }
  }
  checkbox.addEventListener('change', async () => {
    const current = ++request;
    const token = session.token();
    const id = session.state().profileId;
    if (!checkbox.checked) { session.setEnabled(false); clear(); return; }
    try {
      const actual = await getSession();
      if (current !== request || session.token().revision !== token.revision || !checkbox.checked) return;
      if (!id || actual !== id || session.state().profileId !== id || document.documentElement.classList.contains('ew-locked')) { updateSession(null); return; }
    } catch { if (current === request) updateSession(null); return; }
    session.setEnabled(true); checkbox.checked = true; launcher.hidden = false;
  });
  launcher.addEventListener('click', open);
  const unsubscribeUpdate = appUpdateState.subscribe(() => { syncUpdateBadge(); if (!panel.hidden && mode === 'navigate') render(); });
  const observer = new MutationObserver(() => { if (document.documentElement.classList.contains('ew-locked')) updateSession(null); });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('ew:branch-open', () => { applyOutfit(); explain.stop('closed'); motion.stop(); session.invalidate(); request++; busy = false; review = null; status = ''; if (!panel.hidden) render(); });
  const branchObserver = new MutationObserver(() => { applyOutfit(); explain.stop('closed'); motion.stop(); session.invalidate(); request++; busy = false; review = null; status = ''; if (!panel.hidden) render(); });
  branchObserver.observe(document.body, { attributes: true, attributeFilter: ['data-active-branch'] });
  applyOutfit();
  window.addEventListener('pagehide', () => { explain.stop(); session.reset(); clear(); motion.dispose(); unsubscribeUpdate(); });
  panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (explain.isActive()) explain.stop('escape'); else close(); } });
  return { settings, updateSession, disable: () => { session.reset(); clear(); checkbox.disabled = true; } };
}
