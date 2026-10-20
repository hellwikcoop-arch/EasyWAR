import { outfitFor } from './assistant-outfit-core.js';
import './assistant-ui.css';
import { createAssistantSession } from './assistant-session-core.js';
import { reviewAssistantData } from './assistant-rules-core.js';
import { readVisibleAssistantContext, referenceOpen } from './assistant-context.js';
import { answerApplicationState } from './assistant-state-core.js';
import { DIALOGUE_ACTIONS, runDialogueTurn } from './assistant-dialogue-core.js';
import { createLocalModelClient } from './assistant-llm.js';
import { createAssistantMotion } from './assistant-motion.js';
import { createSongPlayer, songButtonText } from './assistant-song.js';
import { languageReply, answerLead, reviewLead, welcomeRemark, reviewRemark, explainLead, WELCOME_TEXT } from './assistant-persona-core.js';
import { explainElement } from './assistant-explain-core.js';
import { createExplainController } from './assistant-explain.js';
import { PROPOSAL_KINDS, PROPOSAL_TEXT_LIMIT, buildProposal, proposalFileNames, validateProposalImage, validateProposalText } from './assistant-proposal-core.js';
import { appUpdateState } from '../app-update-state-core.js';
import { DRAFT_TARGETS, DRAFT_TEXT_LIMIT, cleanDraftText, draftSummary, planDraft } from './assistant-draft-core.js';
import { placeDraft, readDraftField } from './assistant-draft.js';
import { moduleWindow, whenModuleDashboard } from '../air-bridge.js';

// The knowledge index is large: it loads on the first question, not when the launcher starts.
let knowledge = null;
async function loadKnowledge() {
  if (!knowledge) knowledge = (await import('./knowledge/index.json')).default;
  return knowledge;
}

const defaultPortraitURL = new URL('./assets/colonel-kombat-stable.png', import.meta.url).href;
const favoriteSongURL = new URL('./assets/favorite-song.mp3', import.meta.url).href;
const outfitPortraits = {
  default: defaultPortraitURL,
  pilot: new URL('./assets/colonel-outfit-pilot.webp', import.meta.url).href,
  dress: new URL('./assets/colonel-outfit-dress.webp', import.meta.url).href,
  dshv: new URL('./assets/colonel-outfit-dshv.webp', import.meta.url).href,
  rocket: new URL('./assets/colonel-outfit-rocket.webp', import.meta.url).href,
  artillery: new URL('./assets/colonel-outfit-artillery.webp', import.meta.url).href,
  lecturer: new URL('./assets/colonel-outfit-lecturer.webp', import.meta.url).href
};
let portraitURL = defaultPortraitURL;
// Жести нестандартного одягу: кивок («так») і похитування головою («ні»); лектор ще й тицяє указкою.
const clipURL = (outfit, name) => new URL(`./assets/colonel-${outfit}-${name}.webp`, import.meta.url).href;
const outfitClips = Object.fromEntries(['pilot', 'dress', 'dshv', 'rocket', 'artillery', 'lecturer'].map(outfit => [outfit, {
  nod: { url: clipURL(outfit, 'nod'), durationMs: 2000 },
  shake: { url: clipURL(outfit, 'shake'), durationMs: 2000 },
  ...(outfit === 'lecturer' ? { point: { url: clipURL(outfit, 'point'), durationMs: 2000 } } : {})
}]));

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
export function createAssistantUI({ getSession, getApplicationState, readContext = readVisibleAssistantContext, llm = createLocalModelClient() } = {}) {
  const session = createAssistantSession();
  let mode = 'help', history = [], review = null, reviewLabel = '', status = '', navigationStatus = '', busy = false, request = 0, pendingInput = '';
  // Локальна модель необов'язкова: «думає» лише поки триває її відповідь; usedModel — чи запускали її в цьому профілі.
  let thinking = false, usedModel = false;
  // Репліка обирається один раз на показ, щоб не мінятися під час перемальовування.
  let remarkSeed = Math.floor(Math.random() * 2147483647);
  // Режим «Пояснити»: результат останнього кліку в модулі. Нічого не зберігається поза сесією профілю.
  let explainResult = null, explainNote = '', explainBranch = '';
  // Пропозиція розробнику: відомості про елемент за замовчуванням вимкнені. withContext додає лише статичні
  // ідентифікатори з коду (модуль, назва пояснення); withLabel окремо додає підпис з екрана, що може бути з таблиці.
  const freshProposal = () => ({ kind: 'fix', text: '', withContext: false, withLabel: false, image: null, previewUrl: '', note: '' });
  let proposal = freshProposal();
  let proposalVersion = '', proposalVersionLoad = null, refreshProposalPreview = null, proposalStamp = null;
  // Чернетка доповіді: текст користувача, який КОМБАТ може підставити в поле модуля лише після підтвердження.
  const freshDraft = () => ({ branch: document.body.dataset.activeBranch === 'rocket' ? 'rocket' : 'air', text: '', plan: null, note: '' });
  let draft = freshDraft();
  const avatarImage = element('img', { src: portraitURL, alt: '', draggable: 'false' });
  const launcher = element('button', { type: 'button', class: 'ew-assistant-launcher', hidden: true, 'aria-label': 'Відкрити помічника КОМБАТ', 'aria-controls': 'ew-assistant-panel', 'aria-expanded': 'false' },
    element('span', { class: 'ew-assistant-avatar', 'aria-hidden': 'true' }, avatarImage),
    element('span', {}, element('strong', { text: 'КОМБАТ' }), element('small', { text: 'Запитати помічника' })));
  const panel = element('aside', { id: 'ew-assistant-panel', class: 'ew-assistant-panel', hidden: true, 'aria-label': 'КОМБАТ — локальний помічник' });
  const characterImage = element('img', { src: portraitURL, alt: '', draggable: 'false', decoding: 'async' });
  const motion = createAssistantMotion({ image: characterImage, staticURL: portraitURL, clips: gestureClips });
  // Пасхалка: відповідь на питання про улюблену пісню вмикає локальний звук без відео (assistant-song.js).
  const song = createSongPlayer({ url: favoriteSongURL });
  function syncSongButtons() {
    const state = song.state();
    for (const button of panel.querySelectorAll('.ew-assistant-song')) {
      button.dataset.state = state; button.textContent = songButtonText(state);
      button.setAttribute('aria-pressed', String(state === 'playing')); button.disabled = state === 'failed';
    }
    announcer.textContent = state === 'playing' ? 'Пісня грає.' : state === 'failed' ? 'Пісню не вдалося відтворити.' : '';
  }
  song.subscribe(syncSongButtons);
  function songButton() {
    const state = song.state();
    return element('button', {
      type: 'button', class: 'ew-assistant-turn-action ew-assistant-song', 'data-state': state, 'aria-pressed': String(state === 'playing'),
      disabled: state === 'failed', text: songButtonText(state),
      onclick: event => { event.stopPropagation(); if (song.isPlaying()) song.stop(); else void song.play(); },
    });
  }
  // Одяг відповідає відкритому модулю; жести (вітання, вказівка) намальовані лише для базового образу.
  let outfit = 'default';
  function applyOutfit() {
    const branch = document.body.dataset.activeBranch;
    const next = outfitFor(branch, branch ? referenceOpen(branch) : false);
    if (next === outfit) return;
    outfit = next; portraitURL = outfitPortraits[next];
    avatarImage.src = portraitURL;
    motion.configure({ staticURL: portraitURL, clips: next === 'default' ? gestureClips : outfitClips[next] });
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
    element('small', { text: 'Лише для поточного входу в профіль. Довідка та перевірка відкритої таблиці без інтернету. Сам нічого не записує: відкриває екрани й підставляє текст чернетки в поле лише після вашого підтвердження. Розмови не зберігає.' }));
  // Підключення необов'язкової локальної моделі. Показується, лише коли помічник увімкнено; сам по собі нічого не запускає.
  const modelBox = element('div', { class: 'ew-assistant-model', hidden: true });
  let modelBusy = false, modelMessage = '';
  // Встановлення моделі з мережі: лише за явною кнопкою; прогрес оновлюється без перемальовування блоку.
  let install = { info: null, phase: 'idle', progress: null, message: '', confirming: false };
  let installRun = 0, installBar = null, installText = null;
  settings.append(modelBox);
  function formatBytes(bytes) {
    const gb = bytes / 1e9;
    return gb >= 1 ? `${gb.toFixed(1).replace('.', ',')} ГБ` : `${Math.max(1, Math.round(bytes / 1e6))} МБ`;
  }
  function installProgressText(progress) {
    if (!progress) return 'Підготовка до завантаження…';
    const percent = Math.floor(progress.done / progress.total * 100);
    return progress.phase === 'verify' ? `Перевірка файлу: ${percent}%` : `Завантажено ${formatBytes(progress.done)} з ${formatBytes(progress.total)} (${percent}%)`;
  }
  function updateInstallProgress() {
    const progress = install.progress;
    if (installBar) installBar.value = progress ? Math.floor(progress.done / progress.total * 100) : 0;
    if (installText) installText.textContent = installProgressText(progress);
  }
  async function loadInstallInfo() { install.info = await llm.installInfo(); }
  async function startInstall() {
    const run = ++installRun;
    install = { ...install, phase: 'running', progress: null, message: '', confirming: false };
    renderModelBox();
    const result = await llm.install({ onProgress: progress => { if (run === installRun) { install.progress = progress; updateInstallProgress(); } } });
    if (run !== installRun) return;
    install.phase = 'idle'; install.progress = null;
    install.message = result.ok ? (result.outcome === 'ready' ? '' : result.message) : result.message || 'Не вдалося встановити модель.';
    if (!result.ok) install.phase = 'failed';
    await loadInstallInfo();
    if (run === installRun) { renderModelBox(); announcer.textContent = result.ok && result.outcome === 'ready' ? 'Модель встановлено й увімкнено.' : install.message; }
  }
  function cancelInstall() { void llm.cancelInstall(); }
  function installSection(state) {
    const info = install.info;
    if (!info) return null;
    const running = install.phase === 'running';
    const hasFiles = info.installed || info.partialBytes > 0;
    if (state.configured && !hasFiles && !running) return null;
    const section = element('div', { class: 'ew-assistant-install' });
    section.append(element('small', { text: `Готова модель: ${info.title}, ≈${formatBytes(info.sizeBytes)}, джерело ${info.host}, ліцензія ${info.license}. Інтернет потрібен лише для завантаження; файл перевіряється за контрольною сумою. Нічого іншого не надсилається.` }));
    installBar = installText = null;
    if (running) {
      installBar = element('progress', { max: '100', value: '0', 'aria-label': 'Завантаження моделі' });
      installText = element('small', { class: 'ew-assistant-install-progress' });
      updateInstallProgress();
      section.append(installBar, installText, element('div', { class: 'ew-assistant-model-actions' },
        element('button', { type: 'button', text: 'Скасувати', onclick: cancelInstall })));
      return section;
    }
    if (install.message) section.append(element('small', { class: 'ew-assistant-model-status', role: 'status', text: install.message }));
    const actions = element('div', { class: 'ew-assistant-model-actions' });
    if (install.confirming) {
      const left = Math.max(0, info.sizeBytes - info.partialBytes);
      section.append(element('small', { role: 'status', text: `Буде завантажено ≈${formatBytes(left)} з ${info.host}. Продовжити?` }));
      actions.append(
        element('button', { type: 'button', text: 'Завантажити', onclick: () => void startInstall() }),
        element('button', { type: 'button', text: 'Не зараз', onclick: () => { install.confirming = false; renderModelBox(); } }));
    } else if (info.installed) {
      if (!state.configured) actions.append(element('button', { type: 'button', text: 'Підключити встановлену модель', disabled: modelBusy, onclick: () => void startInstall() }));
    } else {
      const label = install.phase === 'failed' ? 'Повторити' : info.partialBytes > 0 ? `Продовжити завантаження (вже ${formatBytes(info.partialBytes)})` : 'Наділити КОМБАТА інтелектом';
      actions.append(element('button', { type: 'button', text: label, disabled: modelBusy, onclick: () => { install.confirming = true; install.message = ''; renderModelBox(); } }));
    }
    if (hasFiles && !install.confirming) actions.append(element('button', { type: 'button', text: 'Видалити файли моделі', disabled: modelBusy, onclick: () => void removeInstalledFiles() }));
    if (actions.childElementCount) section.append(actions);
    return section;
  }
  async function removeInstalledFiles() {
    modelBusy = true; install.message = ''; renderModelBox();
    const result = await llm.removeFiles();
    modelBusy = false;
    if (!result.ok) install.message = result.message || 'Не вдалося видалити файли моделі.';
    await loadInstallInfo();
    renderModelBox();
  }
  function modelStatusText(state) {
    if (!state.configured) return 'Пакет моделі не підключено: КОМБАТ відповідає точно за довідкою.';
    const label = `«${state.name || 'без назви'}»${state.sizeMb ? `, ≈${state.sizeMb} МБ` : ''}`;
    if (!state.enabled) return `Пакет ${label} підключено, модель вимкнена.`;
    if (!state.ready) return state.message || 'Пакет моделі змінено або пошкоджено. Підключіть його знову.';
    return `Модель ${label} увімкнена. Якщо вона не встигне чи помилиться, працюють точні відповіді довідки.`;
  }
  function renderModelBox() {
    modelBox.hidden = !checkbox.checked || checkbox.disabled;
    if (modelBox.hidden) { modelBox.replaceChildren(); return; }
    const state = llm.status();
    const installing = install.phase === 'running';
    const toggle = element('input', { type: 'checkbox', id: 'ew-assistant-model-enable', disabled: !state.configured || modelBusy || installing });
    toggle.checked = state.enabled;
    const run = async action => {
      modelBusy = true; modelMessage = ''; renderModelBox();
      const result = await action();
      modelBusy = false;
      if (result && result.ok === false) modelMessage = result.message || '';
      renderModelBox();
    };
    toggle.addEventListener('change', () => { const wanted = toggle.checked; void run(() => llm.setEnabled(wanted)); });
    modelBox.replaceChildren(
      element('strong', { text: 'Локальна мовна модель (необов’язково)' }),
      element('small', { text: 'Невелика модель на цьому комп’ютері лише переказує відповіді довідки живою мовою. Її можна встановити кнопкою нижче (інтернет потрібен лише для завантаження) або підключити власний пакет. Запитання не зберігаються й нікуди не надсилаються.' }),
      element('label', {}, toggle, element('span', { text: 'Використовувати локальну модель' })),
      element('small', { class: 'ew-assistant-model-status', role: 'status', text: modelMessage || modelStatusText(state) }),
      element('div', { class: 'ew-assistant-model-actions' },
        element('button', { type: 'button', text: 'Обрати пакет моделі…', disabled: modelBusy || installing, onclick: () => void run(() => llm.choose()) }),
        state.configured ? element('button', { type: 'button', text: 'Забути пакет', disabled: modelBusy || installing, onclick: () => void run(() => llm.forget()) }) : null),
      installSection(state));
  }
  async function refreshModel() { await llm.refresh(); await loadInstallInfo(); renderModelBox(); }
  document.body.append(launcher, panel, announcer);
  const explain = createExplainController({
    onExplain(descriptor) {
      if (!descriptor || !session.state().enabled) return;
      explainResult = explainElement(descriptor); explainBranch = descriptor.branch || ''; explainNote = '';
      // Згода на підпис стосувалася попереднього елемента: для нового її треба дати знову.
      proposal.withLabel = false;
      mode = 'explain';
      if (panel.hidden) { panel.hidden = false; launcher.setAttribute('aria-expanded', 'true'); }
      render(); gesture(...(explainResult.status === 'found' ? ['point', 'nod'] : ['shake', 'explain']));
      announcer.textContent = [explainLead(explainResult), explainResult.title, explainResult.what, ...explainResult.basis].filter(Boolean).join('\n');
    },
    onStop(reason) {
      explainNote = reason === 'escape' ? 'Режим пояснення вимкнено клавішею Esc.' : 'Режим пояснення вимкнено: модуль закрито або змінено.';
      if (!panel.hidden && session.state().enabled) render();
      announcer.textContent = explainNote;
    }
  });

  function resetProposal() { if (proposal.previewUrl) URL.revokeObjectURL(proposal.previewUrl); proposal = freshProposal(); refreshProposalPreview = null; }
  function clear() { song.stop(); draft = freshDraft(); explain.stop(); explainResult = null; explainBranch = ''; explainNote = ''; resetProposal(); motion.stop(); request++; history = []; pendingInput = ''; review = null; status = ''; navigationStatus = ''; busy = false; thinking = false; if (usedModel) { usedModel = false; void llm.stop(); } if (install.phase === 'running') void llm.cancelInstall(); installRun++; install = { info: null, phase: 'idle', progress: null, message: '', confirming: false }; installBar = installText = null; checkbox.checked = false; modelBox.hidden = true; modelBox.replaceChildren(); panel.hidden = true; launcher.hidden = true; launcher.setAttribute('aria-expanded', 'false'); panel.replaceChildren(); announcer.textContent = ''; }
  function updateSession(id) {
    const previous = session.state();
    const next = session.setProfile(id);
    if (previous.revision !== next.revision) clear();
    checkbox.disabled = !next.profileId;
    checkbox.checked = next.enabled;
    launcher.hidden = !next.enabled;
    syncUpdateBadge();
    if (next.profileId && next.enabled) void refreshModel(); else renderModelBox();
  }
  function syncUpdateBadge() {
    launcher.querySelector('small').textContent = appUpdateState.getSnapshot().status === 'available' ? 'Є оновлення' : 'Запитати помічника';
  }
  function gesture(id, fallback) { if (!panel.hidden && session.state().enabled && !motion.play(id) && fallback) motion.play(fallback); }
  function close() { song.stop(); explain.stop(); motion.stop(); panel.hidden = true; launcher.setAttribute('aria-expanded', 'false'); if (!launcher.hidden) launcher.focus(); }
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
    history.forEach((turn, at) => {
      body.append(element('div', { class: 'ew-assistant-message ew-assistant-question', text: turn.query }));
      const result = turn.result || {};
      const answer = element('div', { class: 'ew-assistant-message' });
      if (turn.voice) answer.append(element('p', { class: 'ew-assistant-voice', text: turn.voice }));
      answer.append(element('div', { class: 'ew-assistant-answer-text', text: turn.answer }));
      for (const warning of result.warnings || []) if (warning.message !== turn.answer) answer.append(element('p', { class: 'ew-assistant-warning', text: warning.message }));
      for (const source of result.sources || []) answer.append(sourceNode(source));
      if (result.origin === 'application-state' && result.status === 'found') answer.append(element('span', { class: 'ew-assistant-source', text: 'Джерело: поточний локальний стан easyWAR' }));
      if (turn.mode === 'local-model') answer.append(element('span', { class: 'ew-assistant-mode', text: 'Переказала локальна модель за довідкою' }));
      else if (turn.fallbackReasons?.length) answer.append(element('span', { class: 'ew-assistant-mode', text: 'Модель не дала надійної відповіді: це точна відповідь з довідки' }));
      const actions = (turn.actions || []).filter(action => Object.prototype.hasOwnProperty.call(DIALOGUE_ACTIONS, action.id));
      if (actions.length) answer.append(element('div', { class: 'ew-assistant-turn-actions' }, ...actions.map(action => element('button', {
        type: 'button', class: 'ew-assistant-turn-action', 'data-action': action.id, disabled: busy, text: DIALOGUE_ACTIONS[action.id].label,
        onclick: event => { event.stopPropagation(); void navigate(DIALOGUE_ACTIONS[action.id].area); },
      }))));
      if (turn.media === 'favorite-song') answer.append(element('div', { class: 'ew-assistant-turn-actions' }, songButton()));
      if (at === history.length - 1 && turn.suggestions?.length) answer.append(element('div', { class: 'ew-assistant-suggestions', role: 'group', 'aria-label': 'Можливі запитання' }, ...turn.suggestions.map(text => element('button', {
        type: 'button', class: 'ew-assistant-suggestion', disabled: busy, text, onclick: () => ask(text),
      }))));
      body.append(answer);
    });
    if (busy && thinking) body.append(element('div', { class: 'ew-assistant-message ew-assistant-thinking', role: 'status' },
      element('span', { class: 'ew-assistant-thinking-text', text: 'КОМБАТ думає…' }),
      element('button', { type: 'button', class: 'ew-assistant-stop', text: 'Зупинити', 'aria-label': 'Зупинити модель і показати точну відповідь з довідки', onclick: stopThinking })));
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
      element('h3', { class: 'ew-assistant-subhead', text: 'Модулі' }),
      element('div', { class: 'ew-assistant-quick ew-assistant-quick-modules' }, ...[
        ['air', 'ПС', 'Повітряні Сили'], ['rocket', 'РВ', 'Ракетні Війська'],
        ['pvk', 'ПВК', 'Повітряне командування'], ['dshv', 'УДШВ', 'Командування ДШВ'],
      ].map(([id, title, detail]) => element('button', {
        type: 'button', 'data-area': id, onclick: event => { event.stopPropagation(); void navigate(id); },
      }, element('span', { class: 'ew-assistant-action-icon' }, actionIcon('compass')),
      element('span', {}, element('strong', { text: title }), element('small', { text: detail })),
      element('span', { class: 'ew-assistant-action-arrow', 'aria-hidden': 'true' }, actionIcon('arrow'))))),
      navigationStatus ? element('p', { class: 'ew-assistant-warning', role: 'status', text: navigationStatus }) : null,
      draftSection());
  }
  function draftSection() {
    const target = element('select', { 'aria-label': 'Модуль для чернетки', 'data-draft': 'branch', onchange: event => { draft.branch = event.target.value; draft.plan = null; draft.note = ''; render(); } },
      ...Object.values(DRAFT_TARGETS).map(item => element('option', { value: item.id, text: `${item.label} — ${item.title}`, selected: item.id === draft.branch })));
    const area = element('textarea', { rows: '5', maxlength: String(DRAFT_TEXT_LIMIT), 'data-draft': 'text', 'aria-label': 'Текст доповіді для чернетки', placeholder: 'Вставте або надиктуйте текст доповіді…', oninput: event => { draft.text = event.target.value; if (draft.plan) { draft.plan = null; section.querySelectorAll('.ew-assistant-draft-confirm, [data-draft="blocked"]').forEach(node => node.remove()); } } });
    area.value = draft.text;
    const section = element('section', { class: 'ew-assistant-draft', 'aria-label': 'Чернетка доповіді' },
      element('h3', { class: 'ew-assistant-subhead', text: 'Чернетка доповіді' }),
      element('p', { class: 'ew-assistant-note', text: 'КОМБАТ підставить ваш текст без змін у поле «Повідомлення» вкладки «Внесення доповідей» — лише в порожнє поле й лише після вашого підтвердження. Розбір і додавання в таблицю виконує модуль за вашою командою.' }),
      target, area,
      element('div', { class: 'ew-assistant-draft-actions' },
        element('button', { type: 'button', class: 'ew-assistant-primary', 'data-draft': 'preview', disabled: busy, text: 'Показати, що буде внесено', onclick: () => void previewDraft() })));
    if (draft.plan?.ok) {
      section.append(element('div', { class: 'ew-assistant-draft-confirm', role: 'group', 'aria-label': 'Підтвердження чернетки' },
        element('ul', {}, ...draftSummary(draft.plan).map(line => element('li', { text: line }))),
        element('pre', { class: 'ew-assistant-draft-text', text: draft.plan.text }),
        element('div', { class: 'ew-assistant-draft-actions' },
          element('button', { type: 'button', class: 'ew-assistant-primary', 'data-draft': 'confirm', disabled: busy, text: 'Підставити в поле', onclick: () => void confirmDraft() }),
          element('button', { type: 'button', 'data-draft': 'cancel', text: 'Скасувати', onclick: () => { draft.plan = null; draft.note = 'Чернетку не підставлено.'; render(); } }))));
    } else if (draft.plan && !draft.plan.ok) {
      section.append(element('p', { class: 'ew-assistant-warning', role: 'status', 'data-draft': 'blocked', text: draft.plan.message }));
    }
    if (draft.note) section.append(element('p', { class: 'ew-assistant-status', role: 'status', text: draft.note }));
    return section;
  }
  const draftInputs = () => ({ branch: draft.branch, text: draft.text, field: readDraftField(draft.branch), locked: document.documentElement.classList.contains('ew-locked') });
  async function previewDraft() {
    if (busy || !session.state().enabled) return;
    const token = session.token();
    if (!(await allowed(token))) return;
    draft.note = ''; draft.plan = planDraft(draftInputs());
    render();
    announcer.textContent = draft.plan.ok ? 'Чернетка готова. Перегляньте, що буде внесено, і підтвердіть.' : draft.plan.message;
    panel.querySelector(draft.plan.ok ? '[data-draft="confirm"]' : '[data-draft="blocked"]')?.focus();
  }
  async function confirmDraft() {
    if (busy || !draft.plan?.ok || !session.state().enabled) return;
    const token = session.token();
    if (!(await allowed(token))) return;
    // Стан поля міг змінитися, поки відкрито підтвердження: перевіряємо знову безпосередньо перед підстановкою.
    const fresh = planDraft(draftInputs());
    if (!fresh.ok) { draft.plan = fresh; render(); return; }
    close();
    const done = placeDraft(fresh.target.id, fresh.text);
    draft.plan = null;
    draft.note = done ? `Текст підставлено в поле модуля ${fresh.target.label}. Перевірте розбір у модулі й додайте записи самі.` : 'Не вдалося підставити текст: поле змінилося. Спробуйте ще раз.';
    if (done) draft.text = '';
    announcer.textContent = draft.note;
  }
  // Лише ці екрани: службові кнопки шапки й картки модулів на стартовому екрані. Нових цілей текст додати не може.
  const SERVICE_TARGETS = { profiles: '.ew-profile-open', backup: '.ew-backup-open', updates: '.ew-header-update' };
  const MODULE_TARGETS = { air: '.branch-card[data-branch="air"]', rocket: '.branch-card[data-branch="rocket"]', pvk: '#pvk-tile [data-act="open"]', dshv: '#dshv-tile [data-act="open"]' };
  async function navigate(area) {
    const entry = /^entry-(air|rocket)$/u.exec(String(area))?.[1] ?? null;
    const moduleId = entry ?? area;
    const selector = Object.prototype.hasOwnProperty.call(SERVICE_TARGETS, area) ? SERVICE_TARGETS[area]
      : Object.prototype.hasOwnProperty.call(MODULE_TARGETS, moduleId) ? MODULE_TARGETS[moduleId] : null;
    if (!selector || busy || !session.state().enabled) return;
    const token = session.token();
    const profileId = session.state().profileId;
    if (!(await allowed(token))) return;
    const target = document.querySelector(selector);
    if (!target || target.disabled) {
      navigationStatus = 'Цей екран зараз недоступний.';
      render();
      return;
    }
    if (target.closest('.ew-module-off')) {
      navigationStatus = 'Цей модуль вимкнено у вашому профілі.';
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
      if (!entry) return;
      // Вкладка «Внесення доповідей»: лише перемикання вкладки, без змін у полях і таблиці.
      const dashboard = await whenModuleDashboard(entry);
      if (!dashboard || !(await allowed(session.token())) || session.state().profileId !== profileId) return;
      const doc = (() => { try { return moduleWindow(entry)?.document ?? null; } catch { return null; } })();
      if (doc?.querySelector('#view-entry')?.hidden) doc.querySelector('#tab-entry')?.click();
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
  // Версію застосунку читаємо один раз, коли пакет уперше показано або зберігається; вона потрібна і для перегляду, і для файлу.
  function loadProposalVersion() {
    proposalVersionLoad ??= (async () => {
      try { proposalVersion = (await getApplicationState?.('version'))?.appVersion || ''; } catch { /* версія необов'язкова */ }
    })();
    return proposalVersionLoad;
  }
  // Контекст пакета: порожній, поки користувач не позначив пункт. Підпис з екрана береться лише за окремою позначкою.
  function proposalContext() {
    if (!proposal.withContext || !explainResult?.ref) return null;
    return { branch: explainBranch, explainId: explainResult.ref.id, screenLabel: proposal.withLabel ? explainResult.title : '' };
  }
  // Один і той самий виклик будує і перегляд, і файл, тож перегляд показує саме те, що буде збережено чи скопійовано.
  // Час пакета фіксується під час останньої зміни (перегляду) й той самий іде у файл: назва й дата не розходяться з переглядом.
  function proposalPackage(now) {
    const names = proposalFileNames(now, proposal.image);
    return { names, text: buildProposal({ kind: proposal.kind, text: proposal.text, context: proposalContext(), appVersion: proposalVersion, createdAt: now, imageName: names.image }) };
  }
  async function proposalFiles() {
    const verdict = validateProposalText(proposal.text);
    if (!verdict.ok) { proposal.note = verdict.message; render(); return null; }
    await loadProposalVersion();
    return proposalPackage(proposalStamp || new Date());
  }
  function proposalSection() {
    const ref = explainResult?.ref || null;
    const preview = element('textarea', { rows: '9', readonly: true, spellcheck: 'false', 'aria-label': 'Попередній перегляд пакета' });
    const label = element('input', { type: 'checkbox', onchange: event => { proposal.withLabel = event.target.checked; refresh(); } });
    const refresh = () => {
      label.disabled = !(ref && proposal.withContext);
      label.checked = Boolean(ref && proposal.withContext && proposal.withLabel);
      proposalStamp = new Date();
      preview.value = proposalPackage(proposalStamp).text;
    };
    const kinds = element('select', { 'aria-label': 'Тип пропозиції', onchange: event => { proposal.kind = event.target.value; refresh(); } },
      ...PROPOSAL_KINDS.map(item => element('option', { value: item.id, text: item.label, selected: item.id === proposal.kind })));
    const area = element('textarea', { rows: '4', maxlength: String(PROPOSAL_TEXT_LIMIT), 'aria-label': 'Опис пропозиції', placeholder: 'Що змінити чи додати і навіщо…', oninput: event => { proposal.text = event.target.value; refresh(); } });
    area.value = proposal.text;
    const context = element('label', { class: 'ew-assistant-proposal-check' },
      element('input', { type: 'checkbox', checked: Boolean(ref && proposal.withContext), disabled: !ref, onchange: event => {
        proposal.withContext = event.target.checked;
        if (!proposal.withContext) proposal.withLabel = false;
        refresh();
      } }),
      element('span', { text: ref ? `Додати модуль і назву елемента з довідки: «${ref.title}». Значень із таблиці тут немає.` : 'Відомості про елемент можна додати після пояснення.' }));
    const screenLabel = element('label', { class: 'ew-assistant-proposal-check' }, label,
      element('span', { text: 'Додати також підпис елемента з екрана. Він береться з вашої таблиці й може містити, наприклад, назву підрозділу.' }));
    refreshProposalPreview = refresh;
    if (!proposalVersionLoad) void loadProposalVersion().then(() => refreshProposalPreview?.());
    refresh();
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
      element('p', { class: 'ew-assistant-note', text: 'Опишіть, що змінити. Пакет формується на цьому пристрої й нічого не надсилає автоматично: ви самі передаєте його розробнику в Signal. Типово в ньому лише тип, версія, дата й ваш опис; відомості про елемент додаються тільки за вашою позначкою.' }),
      kinds, area, context, screenLabel,
      element('label', { class: 'ew-assistant-proposal-file' }, element('span', { text: 'Скриншот (необов’язково)' }), file),
      proposal.previewUrl ? element('img', { class: 'ew-assistant-proposal-preview', src: proposal.previewUrl, alt: 'Попередній перегляд скриншота' }) : null,
      element('p', { class: 'ew-assistant-note', text: 'Перед додаванням скриншота переконайтеся, що на ньому немає реальних оперативних даних. Те саме стосується опису: не вставляйте в нього рядки таблиць.' }),
      element('p', { class: 'ew-assistant-note', text: 'Попередній перегляд: саме цей текст буде збережено або скопійовано.' }),
      preview,
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
    const form = element('form', { class: 'ew-assistant-compose' }, element('div', { class: 'ew-assistant-input' }, input, element('button', { type: 'submit', text: '→', disabled: busy, 'aria-label': 'Надіслати запитання' })), element('small', { text: `${modelReady() ? 'Довідка та локальна модель' : 'Локальна довідка'} · історія лише до виходу з профілю` }));
    form.addEventListener('submit', event => { event.preventDefault(); const query = input.value; input.value = ''; pendingInput = ''; ask(query); }); bubble.append(form);
    const content = panel.querySelector('.ew-assistant-content'); content.scrollTop = mode === 'help' && history.length ? content.scrollHeight : 0;
  }
  function modelReady() { const state = llm.status(); return state.enabled && state.ready; }
  // Зупинка моделі не скасовує питання: КОМБАТ одразу показує точну відповідь з довідки.
  function stopThinking() { void llm.cancel(); }
  function unavailableTurn(query) {
    const text = 'Довідку не вдалося завантажити. Спробуйте ще раз.';
    return { query, effectiveQuery: query, followUp: false, topic: 'unknown', area: null, factIds: [], answer: text, actions: [], suggestions: [],
      mode: 'exact-fallback', result: { status: 'unknown', text, sources: [], warnings: [] }, voice: null, fallbackReasons: [] };
  }
  async function ask(value) {
    const query = String(value || '').trim().slice(0, 512); if (!query || busy || !session.state().enabled) return;
    const token = session.token(), current = ++request; busy = true; thinking = false; render();
    if (!(await allowed(token)) || current !== request) return;
    let index = null;
    try { index = await loadKnowledge(); } catch { index = null; }
    if (current !== request || !session.accepts(token)) return;
    const isCurrent = () => current === request && session.accepts(token);
    // Модель отримує лише підготовлений короткий запит із фактами довідки; будь-яка її помилка веде до точної відповіді.
    const generate = modelReady() ? async prompt => {
      if (!isCurrent()) throw new Error('Запит застарів.');
      usedModel = true; thinking = true; render();
      try { return await llm.generate(prompt); } finally { if (current === request) thinking = false; }
    } : undefined;
    const turn = index
      ? await runDialogueTurn({ query, history, index, readState: kind => getApplicationState?.(kind), generate, sessionRevision: session.state().revision, voiceFor: answerLead, isCurrent })
      : unavailableTurn(query);
    if (!turn || !(await allowed(token)) || current !== request) return;
    history.push(turn); history = history.slice(-20); busy = false; thinking = false; mode = 'help'; render();
    gesture(...(turn.media || turn.mode === 'local-model' || turn.voice ? ['nod', 'explain'] : ['shake', 'explain']));
    if (turn.media === 'favorite-song') void song.play();
    announcer.textContent = [turn.voice, turn.answer].filter(Boolean).join('\n'); panel.querySelector('.ew-assistant-input input')?.focus();
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
    finally { if (session.accepts(token) && current === request) { busy = false; render(); gesture(...(status || (review?.counts.error + review?.counts.warning) > 0 ? ['shake', 'point'] : ['point'])); announcer.textContent = status || `${review?.counts.total || 0} зауважень у відкритій таблиці.`; panel.querySelector('.ew-assistant-primary')?.focus(); } }
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
    session.setEnabled(true); checkbox.checked = true; launcher.hidden = false; void refreshModel();
  });
  launcher.addEventListener('click', open);
  const unsubscribeUpdate = appUpdateState.subscribe(() => { syncUpdateBadge(); if (!panel.hidden && mode === 'navigate') render(); });
  const observer = new MutationObserver(() => { if (document.documentElement.classList.contains('ew-locked')) updateSession(null); });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('ew:branch-open', () => { applyOutfit(); explain.stop('closed'); motion.stop(); session.invalidate(); request++; busy = false; review = null; status = ''; if (!panel.hidden) render(); });
  const branchObserver = new MutationObserver(() => { applyOutfit(); explain.stop('closed'); motion.stop(); session.invalidate(); request++; busy = false; review = null; status = ''; if (!panel.hidden) render(); });
  branchObserver.observe(document.body, { attributes: true, attributeFilter: ['data-active-branch'] });
  applyOutfit();
  // Вкладка довідника змінюється всередині модуля, тож стан перевіряємо раз на секунду (дешевий запит до DOM).
  const outfitTimer = setInterval(applyOutfit, 1000);
  window.addEventListener('pagehide', () => { clearInterval(outfitTimer); song.dispose(); explain.stop(); session.reset(); clear(); motion.dispose(); unsubscribeUpdate(); });
  panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (explain.isActive()) explain.stop('escape'); else close(); } });
  return { settings, updateSession, disable: () => { session.reset(); clear(); checkbox.disabled = true; } };
}
