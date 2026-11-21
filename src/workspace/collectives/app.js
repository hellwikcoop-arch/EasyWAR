// Єдине захищене локально-мережеве колективне файлове середовище:
// 1) 3 ролі: Керівник (творець колективу), Молодший керівник, Користувач;
// 2) запрошення за 6-значним кодом: один учасник генерує 6-значний код, інший записує й
//    потрапляє в колектив та його файлове середовище;
// 3) колективне файлове середовище: таблиці й файли/документи колективу зі створенням,
//    редагуванням і оновленням (усі зміни відображаються в усіх учасників у реальному часі
//    між вкладками/профілями та синхронізуються у файлах і захищених пакетах);
// 4) журнал редагувань і призначення ролей.
import {
  ROLE_TITLES, addParticipant, changeParticipantRole, createCollective, decodeCollective,
  encodeCollective, removeParticipant, renameCollective,
} from './collectives-core.js';
import {
  ASSIGNABLE_ROLE_OPTIONS, CLASS_OPTIONS, FILE_KIND_OPTIONS, PURPOSE_OPTIONS, ROLES,
  assignMemberRole, canAssignRole, canCreateCollective, canCreateIdentity, checkHours,
  checkPassword, createCollectiveWorkspace, deleteWorkspaceFile, detailLine, expectText,
  formatAuditLine, formatInviteCode, issueInviteCode, keyStoreText, memberInitials,
  memberLine, memberRoleLabel, membersWord, mergeWorkspaceStates, parseInviteCode,
  pickCollective, preparedText, redeemInviteCode, removeWorkspaceMember, reportText,
  roleLabel, rolePermissions, saveWorkspaceFile, syncExportText, syncImportText, tableLine,
} from './secure-core.js';
import {
  authorLine, buildTable, changeOperation, changeTime, diffTable, emptyValues, newRowKey,
  parseColumns, previewSummary, refreshText,
} from './table-data-core.js';
import './collectives.css';

export const contract = 1;

const $ = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
function button(text, cls = 'ec-btn') {
  const e = $('button', cls, text);
  e.type = 'button';
  return e;
}
function input(placeholder) {
  const e = $('input', 'ec-input');
  e.type = 'text';
  e.maxLength = 80;
  e.autocomplete = 'off';
  e.placeholder = placeholder;
  return e;
}
function area(placeholder, readOnly = false) {
  const e = $('textarea', 'ec-input ec-area');
  e.rows = 3;
  e.spellcheck = false;
  e.placeholder = placeholder;
  e.readOnly = readOnly;
  return e;
}
function select(options) {
  const e = $('select', 'ec-input');
  for (const option of options) {
    const item = $('option', '', option.label);
    item.value = option.value;
    e.append(item);
  }
  return e;
}
const roles = ROLE_TITLES;

const WORKSPACE_STORE_KEY = 'collectives.workspaces';
const INVITE_INDEX_KEY = 'collectives.invites';
const ACTIVE_USER_KEY = 'collectives.user';
const SERVER_KEY = 'collectives.workspaceServer';
const SESSION_KEY = 'collectives.workspaceSession';
const BROADCAST_CHANNEL = 'easywar-collective-workspace-v1';

export async function mount(container, host) {
  let draft = null;
  let handle = null;
  let fileName = '';
  let dirty = false;
  let busy = false;

  const root = $('main', 'ec-root');
  const header = $('header', 'ec-header');
  header.append($('p', 'ec-kicker', 'РОБОЧЕ СЕРЕДОВИЩЕ / КОЛЕКТИВИ'),
    $('h1', '', 'Колективи та колективне файлове середовище'),
    $('p', 'ec-lead', 'Обмін даними між користувачами в одному колективі: запрошення за 6-значним кодом, спільне файлове середовище (таблиці й документи), ролі («Керівник», «Молодший керівник», «Користувач») та журнал редагувань.'));
  const warning = $('p', 'ec-warning', 'Захищений колектив шифрує ключі під паролем профілю; локальний файл .ewcoll зберігає план, файли та журнал колективу на диску.');
  const toolbar = $('div', 'ec-toolbar');
  const fresh = button('Новий колектив');
  const open = button('Відкрити файл');
  const save = button('Зберегти');
  const saveAs = button('Зберегти як…');
  toolbar.append(fresh, open, save, saveAs);
  const status = $('p', 'ec-status', 'Створіть колектив, вступіть за 6-значним кодом або відкрийте локальний файл.');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  // Єдине захищене локально-мережеве колективне файлове середовище
  const hub = $('section', 'ec-card ec-hub');
  const secure = $('section', 'ec-card ec-secure');
  const panel = $('div', 'ec-panel');
  root.append(header, hub, secure, warning, toolbar, status, panel);
  container.append(root);

  // --- Стан колективного файлового середовища (ролі, 6-значний код, файли, журнал) ----------
  const randomBytes = n => crypto.getRandomValues(new Uint8Array(n));
  const nowSec = () => Math.trunc(Date.now() / 1000);
  const formatTime = ts => {
    if (!ts) return 'щойно';
    const d = new Date(Number(ts) * 1000);
    if (Number.isNaN(d.getTime())) return String(ts);
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  let workspaces = [];
  let activeCollId = '';
  let activeMemberId = '';
  let activeFileId = '';
  let hubMessage = '';
  let hubError = '';
  let lastGeneratedInvite = null;
  let broadcast = null;
  let serverUrl = '';
  let session = null;
  let holdEditor = false;
  let pollTimer = null;
  let lastPullError = '';

  try {
    if (typeof BroadcastChannel === 'function') {
      broadcast = new BroadcastChannel(BROADCAST_CHANNEL);
      broadcast.addEventListener('message', event => {
        const msg = event?.data;
        if (msg?.type === 'workspace-sync' && msg.workspace) {
          applyRemoteWorkspace(msg.workspace);
        }
      });
    }
  } catch {
    broadcast = null;
  }

  function applyRemoteWorkspace(remote) {
    try {
      const idx = workspaces.findIndex(w => w.collectiveId === remote.collectiveId);
      if (idx >= 0) {
        workspaces[idx] = mergeWorkspaceStates(workspaces[idx], remote);
      } else {
        workspaces.push(remote);
      }
      if (!activeCollId) activeCollId = remote.collectiveId;
      persistWorkspaces(false);
      renderHub();
      syncDraftFromWorkspace();
    } catch { /* ігноруємо пошкоджені повідомлення */ }
  }

  async function loadStoredWorkspaces() {
    if (!host.profile?.available) return;
    try {
      const savedList = await host.profile.readJson(WORKSPACE_STORE_KEY);
      if (Array.isArray(savedList) && savedList.length) {
        workspaces = savedList;
        activeCollId = workspaces[0]?.collectiveId || '';
      }
      const savedUser = await host.profile.readJson(ACTIVE_USER_KEY);
      if (savedUser?.memberId) activeMemberId = savedUser.memberId;
      if (savedUser?.collectiveId && workspaces.some(w => w.collectiveId === savedUser.collectiveId)) {
        activeCollId = savedUser.collectiveId;
      }
      const savedServer = await host.profile.readJson(SERVER_KEY);
      if (typeof savedServer?.url === 'string') serverUrl = savedServer.url.trim();
      const savedSession = await host.profile.readJson(SESSION_KEY);
      if (savedSession?.token && savedSession.url === serverUrl) {
        session = savedSession;
        activeMemberId = savedSession.memberId || activeMemberId;
        activeCollId = savedSession.collectiveId || activeCollId;
      }
    } catch { /* працюємо в пам’яті */ }
    ensureActiveMember();
    renderHub();
    startPoll();
    pullServer();
  }

  async function persistWorkspaces(notifyPeers = true) {
    if (host.profile?.available) {
      try {
        await host.profile.writeJson(WORKSPACE_STORE_KEY, workspaces);
        const inviteIndex = {};
        for (const ws of workspaces) {
          for (const inv of ws.invites ?? []) {
            inviteIndex[inv.code] = ws.collectiveId;
          }
        }
        await host.profile.writeJson(INVITE_INDEX_KEY, inviteIndex);
        if (activeMemberId || activeCollId) {
          await host.profile.writeJson(ACTIVE_USER_KEY, { collectiveId: activeCollId, memberId: activeMemberId });
        }
      } catch { /* ігноруємо помилку сховища */ }
    }
    if (notifyPeers && broadcast && !serverUrl) {
      const current = currentWorkspace();
      if (current) {
        try { broadcast.postMessage({ type: 'workspace-sync', workspace: current }); } catch { /* ignore */ }
      }
    }
  }

  function serverReady() {
    return Boolean(serverUrl && host.workspaceSync);
  }

  function currentWorkspace() {
    if (serverReady()) {
      return session?.collectiveId
        ? workspaces.find(w => w.collectiveId === session.collectiveId) || null
        : null;
    }
    return workspaces.find(w => w.collectiveId === activeCollId) || workspaces[0] || null;
  }

  function ensureActiveMember() {
    const ws = currentWorkspace();
    if (!ws) { activeMemberId = ''; return; }
    if (session?.memberId && ws.members.some(m => m.id === session.memberId)) {
      activeMemberId = session.memberId;
      return;
    }
    if (!ws.members.some(m => m.id === activeMemberId)) activeMemberId = '';
  }

  function applyServerView(view, memberId) {
    if (!view?.collectiveId) return;
    const ws = { ...view, invites: [], nextSeq: (view.revision || 0) + 1 };
    const idx = workspaces.findIndex(item => item.collectiveId === ws.collectiveId);
    if (idx >= 0) workspaces[idx] = ws;
    else workspaces.unshift(ws);
    activeCollId = ws.collectiveId;
    if (memberId && ws.members.some(m => m.id === memberId)) activeMemberId = memberId;
    else ensureActiveMember();
    if (!holdEditor) renderHub();
    syncDraftFromWorkspace();
  }

  async function saveSession(next) {
    session = next;
    if (host.profile?.available) {
      try { await host.profile.writeJson(SESSION_KEY, next); } catch { /* лишається в пам’яті */ }
    }
    startPoll();
  }

  async function serverCall(operation, body, token = session?.token || null) {
    const result = await host.workspaceSync.call(serverUrl, operation, token, {
      ...(body || {}),
      collectiveId: body?.collectiveId || session?.collectiveId || '',
    });
    if (result?.token && result?.collectiveId && result?.memberId) {
      session = {
        url: serverUrl,
        collectiveId: result.collectiveId,
        memberId: result.memberId,
        token: result.token,
      };
    }
    if (result?.view) applyServerView(result.view, result.memberId || session?.memberId);
    if (!result?.ok) {
      const error = new Error(result?.error || 'Сервер відхилив дію.');
      error.conflict = Boolean(result?.conflict);
      throw error;
    }
    return result;
  }

  async function pullServer() {
    if (!serverUrl || !session?.token || !host.workspaceSync) return;
    try {
      await serverCall('sync', {});
      lastPullError = '';
    } catch (error) {
      const message = error.message || 'Немає зв’язку із сервером.';
      if (message !== lastPullError && !holdEditor) {
        lastPullError = message;
        hubSay(message, true);
      }
    }
  }

  function startPoll() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    if (!serverUrl || !session?.token || !host.workspaceSync) return;
    pollTimer = setInterval(() => { pullServer(); }, 2000);
  }

  function updateWorkspace(nextWs, msg = '') {
    const idx = workspaces.findIndex(w => w.collectiveId === nextWs.collectiveId);
    if (idx >= 0) workspaces[idx] = nextWs;
    else workspaces.push(nextWs);
    activeCollId = nextWs.collectiveId;
    ensureActiveMember();
    hubMessage = msg;
    hubError = '';
    persistWorkspaces(true);
    syncDraftFromWorkspace();
    renderHub();
  }

  function syncDraftFromWorkspace() {
    const ws = currentWorkspace();
    if (!ws) return;
    try {
      const participants = ws.members.map((m, i) => ({
        id: i + 1,
        label: m.name,
        role: m.founder || m.role === 'leader' ? 'owner' : (m.role === 'junior_leader' ? 'admin' : 'member'),
      }));
      const activeInv = ws.invites.find(inv => !inv.usedBy);
      draft = {
        format: 'easywar-collective-local-v1',
        name: ws.name,
        nextId: participants.length + 1,
        participants,
        ...(activeInv ? { inviteCode: activeInv.code, inviteRole: activeInv.assignedRole === 'junior_leader' ? 'admin' : 'member' } : {}),
        files: ws.files.map(f => ({
          id: f.id,
          name: f.name,
          kind: f.kind,
          content: f.content,
          version: f.version,
          updatedBy: f.updatedByName,
          updatedAt: formatTime(f.updatedAt),
        })),
        auditLog: ws.auditLog.slice(0, 100).map(e => ({
          id: e.id,
          action: e.actionLabel || e.action,
          actor: e.actorName,
          role: e.actorRole === 'leader' ? 'owner' : (e.actorRole === 'junior_leader' ? 'admin' : 'member'),
          target: e.target || '',
          details: e.details || '',
          at: formatTime(e.timestamp),
        })),
      };
      render();
    } catch { /* залишаємо поточний draft */ }
  }

  function hubSay(msg, isError = false) {
    if (isError) { hubError = msg; hubMessage = ''; }
    else { hubMessage = msg; hubError = ''; }
    renderHub();
  }

  function renderHub() {
    hub.replaceChildren(
      $('p', 'ec-label', 'КОЛЕКТИВНЕ ФАЙЛОВЕ СЕРЕДОВИЩЕ / ОБМІН ДАНИМИ ЗА 6-ЗНАЧНИМ КОДОМ'),
      $('h2', '', 'Колективний робочий простір'),
      $('p', 'ec-caption', 'Той, хто створює колектив, отримує роль «Керівник» і може призначати «Керівника», «Молодшого керівника» та «Користувача». Код запрошення вводить інша людина — і на іншому комп’ютері, якщо вказано сервер.'),
    );
    const mode = $('p', 'ec-status', !serverUrl
      ? 'Локальний режим: обмін лише на цьому комп’ютері. Між різними комп’ютерами даних немає, доки не вказано адресу сервера.'
      : (host.workspaceSync
        ? `Сервер обміну: ${serverUrl}. Зміни надсилаються туди й з’являються в усіх учасників.`
        : `Адресу ${serverUrl} збережено. У цьому вікні з’єднання немає, тож лишається локальний режим.`));
    mode.dataset.tone = serverUrl ? 'ok' : 'local';
    hub.append(mode);
    const serverForm = $('form', 'ec-inline');
    const serverIn = input('https://адреса-вашого-сервера');
    serverIn.value = serverUrl;
    serverIn.maxLength = 200;
    const serverBtn = button(serverUrl ? 'Оновити адресу' : 'Зберегти адресу сервера');
    serverBtn.type = 'submit';
    const clearBtn = button('Лише цей комп’ютер');
    serverForm.append(field('Адреса сервера обміну', serverIn), serverBtn, clearBtn);
    serverForm.addEventListener('submit', event => {
      event.preventDefault();
      const next = serverIn.value.trim();
      if (next && !/^https:\/\/[^/\s]+\/?$/u.test(next) && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\/?$/u.test(next)) {
        hubSay('Адреса має бути https://… без шляху або http://127.0.0.1:8787 для локальної перевірки.', true);
        return;
      }
      serverUrl = next.replace(/\/$/, '');
      session = null;
      if (host.profile?.available) {
        host.profile.writeJson(SERVER_KEY, serverUrl ? { url: serverUrl } : null).catch(() => {});
        host.profile.writeJson(SESSION_KEY, null).catch(() => {});
      }
      startPoll();
      hubSay(serverUrl ? 'Адресу збережено. Створіть колектив або вступіть за кодом.' : 'Сервер вимкнено. Залишився локальний режим.');
    });
    clearBtn.addEventListener('click', () => {
      serverIn.value = '';
      serverUrl = '';
      session = null;
      if (host.profile?.available) {
        host.profile.writeJson(SERVER_KEY, null).catch(() => {});
        host.profile.writeJson(SESSION_KEY, null).catch(() => {});
      }
      startPoll();
      hubSay('Сервер вимкнено. Залишився локальний режим.');
    });
    hub.append(serverForm);
    if (serverUrl && !host.workspaceSync) {
      hub.append($('p', 'ec-warning', 'Обмін із сервером працює в настільному застосунку. У цьому вікні лишається локальний режим.'));
    }

    if (hubMessage) {
      const m = $('p', 'ec-status', hubMessage);
      m.dataset.tone = 'ok';
      hub.append(m);
    }
    if (hubError) {
      const err = $('p', 'ec-status', hubError);
      err.dataset.error = 'true';
      hub.append(err);
    }

    // Верхня панель: Створити колектив АБО Вступити за 6-значним кодом
    const topGrid = $('div', 'ec-hub-top');

    // 1. Форма створення колективу (творець стає Керівником)
    const createBox = $('div', 'ec-hub-box');
    createBox.append($('p', 'ec-label', 'СТВОРИТИ КОЛЕКТИВ (ВИ — КЕРІВНИК)'));
    const createForm = $('form', 'ec-inline');
    const collNameIn = input('Назва колективу (напр. Навчальна група)');
    const founderNameIn = input('Ваше ім’я або позивний');
    const createBtn = button('Створити колектив');
    createBtn.type = 'submit';
    createForm.append(field('Назва колективу', collNameIn), field('Керівник (ви)', founderNameIn), createBtn);
    createForm.addEventListener('submit', event => {
      event.preventDefault();
      if (serverReady()) {
        serverCall('create', { name: collNameIn.value, memberName: founderNameIn.value }, null)
          .then(async result => {
            lastGeneratedInvite = null;
            await saveSession({
              url: serverUrl,
              collectiveId: result.collectiveId,
              memberId: result.memberId,
              token: result.token,
            });
            holdEditor = false;
            hubSay(`Колектив створено на сервері. Ваша роль — «${ROLES.leader}». Жетон сеансу лишається лише на цьому комп’ютері.`);
          })
          .catch(error => hubSay(error.message || 'Не вдалося створити колектив.', true));
        return;
      }
      try {
        const idNum = workspaces.length + 1;
        const ws = createCollectiveWorkspace({
          collectiveId: `coll-${Date.now()}-${idNum}`,
          name: collNameIn.value,
          founderId: `member-${Date.now()}-1`,
          founderName: founderNameIn.value,
          now: nowSec(),
        });
        activeMemberId = ws.members[0].id;
        session = null;
        lastGeneratedInvite = null;
        updateWorkspace(ws, `Колектив «${ws.name}» створено локально. Ваша роль — «${ROLES.leader}». Інші комп’ютери його не бачать.`);
      } catch (error) {
        hubSay(error.message || 'Не вдалося створити колектив.', true);
      }
    });
    createBox.append(createForm);

    // 2. Форма вступу в колектив за 6-значним кодом
    const joinBox = $('div', 'ec-hub-box');
    joinBox.append($('p', 'ec-label', 'ВСТУПИТИ В КОЛЕКТИВ ЗА 6-ЗНАЧНИМ КОДОМ'));
    const joinForm = $('form', 'ec-inline');
    const codeIn = input('6 цифр (напр. 482 731)');
    codeIn.maxLength = 12;
    codeIn.setAttribute('inputmode', 'numeric');
    const guestNameIn = input('Ваше ім’я в колективі');
    const joinBtn = button('Вступити за кодом');
    joinBtn.type = 'submit';
    joinForm.append(field('6-значний код запрошення', codeIn), field('Ваше ім’я', guestNameIn), joinBtn);
    joinForm.addEventListener('submit', event => {
      event.preventDefault();
      if (serverReady()) {
        serverCall('join', { code: codeIn.value, memberName: guestNameIn.value }, null)
          .then(async result => {
            await saveSession({
              url: serverUrl,
              collectiveId: result.collectiveId,
              memberId: result.memberId,
              token: result.token,
            });
            holdEditor = false;
            hubSay(`Ви в колективі. Роль: «${roleLabel(result.view?.yourRole || 'user')}».`);
          })
          .catch(error => hubSay(error.message || 'Не вдалося вступити за кодом.', true));
        return;
      }
      try {
        const digits = parseInviteCode(codeIn.value);
        const targetWs = workspaces.find(w => (w.invites ?? []).some(inv => inv.code === digits)) || currentWorkspace();
        if (!targetWs) {
          throw new Error('Колектив за цим 6-значним кодом не знайдено. Спершу згенеруйте код у колективі.');
        }
        const newMemberId = `member-${Date.now()}-${targetWs.members.length + 1}`;
        const redeemed = redeemInviteCode(targetWs, {
          code: digits,
          memberId: newMemberId,
          memberName: guestNameIn.value,
          now: nowSec(),
        });
        activeCollId = redeemed.workspace.collectiveId;
        activeMemberId = redeemed.member.id;
        updateWorkspace(
          redeemed.workspace,
          `Ви приєдналися до колективу «${redeemed.workspace.name}» за кодом ${formatInviteCode(digits)}! Ваша роль: «${roleLabel(redeemed.member.role)}». Відкрито колективне файлове середовище.`,
        );
      } catch (error) {
        hubSay(error.message || 'Не вдалося вступити за кодом.', true);
      }
    });
    joinBox.append(joinForm);

    topGrid.append(createBox, joinBox);
    hub.append(topGrid);

    const shown = serverReady()
      ? workspaces.filter(item => item.collectiveId === session?.collectiveId)
      : workspaces;
    if (!shown.length) {
      hub.append($('p', 'ec-empty', 'Немає активного колективного середовища. Створіть колектив вище або введіть 6-значний код запрошення.'));
      return;
    }

    if (!serverReady() && shown.length > 1) {
      const collBar = $('div', 'ec-coll-grid');
      for (const item of shown) {
        const card = $('button', 'ec-coll-card');
        card.type = 'button';
        card.setAttribute('aria-pressed', String(item.collectiveId === activeCollId));
        const count = $('span', 'ec-coll-count');
        count.append($('strong', '', String(item.members.length)), $('span', '', membersWord(item.members.length)));
        card.append($('span', 'ec-coll-name', item.name), count,
          $('span', 'ec-caption', `Файлів: ${item.files.length} · Записів журналу: ${item.auditLog.length}`));
        card.addEventListener('click', () => {
          activeCollId = item.collectiveId;
          ensureActiveMember();
          renderHub();
        });
        collBar.append(card);
      }
      hub.append(collBar);
    }

    const ws = currentWorkspace();
    if (!ws) return;
    ensureActiveMember();
    const activeMember = ws.members.find(m => m.id === activeMemberId);
    if (!activeMember) {
      hub.append($('p', 'ec-empty', 'Увійти від чужого імені не можна. Створіть колектив або вступіть за своїм кодом.'));
      return;
    }
    const perms = serverReady()
      ? {
        canInvite: activeMember.role === 'leader' || activeMember.role === 'junior_leader',
        canAssignJuniorLeader: activeMember.role === 'leader',
        canRemoveMembers: activeMember.role === 'leader',
        canDeleteFiles: true,
      }
      : rolePermissions(activeMember.role, { isFounder: activeMember.founder });

    const wsPanel = $('div', 'ec-coll-panel');
    const wsHead = $('div', 'ec-coll-head');
    const wsTitle = $('div', '');
    wsTitle.append(
      $('h3', '', `Колектив «${ws.name}»`),
      $('p', 'ec-caption', `Активний користувач: ${activeMember.name} (${roleLabel(activeMember.role, { isFounder: activeMember.founder })}) · Учасників: ${ws.members.length} · Файлів: ${ws.files.length}`),
    );

    wsHead.append(wsTitle);
    wsPanel.append(wsHead);

    // --- 1. Склад колективу, призначення 3 ролей та запрошення за 6-значним кодом ------------
    const membersBox = $('div', 'ec-hub-section');
    membersBox.append(
      $('h4', 'ec-subhead', `Учасники колективу та ролі (${ws.members.length})`),
      $('p', 'ec-caption', 'Три ролі в колективі: «Керівник» (творець колективу — повні права), «Молодший керівник» (керування файлами та запрошення) і «Користувач» (робота з файлами). Усі зміни ролей фіксуються в журналі.'),
    );

    const peopleList = $('div', 'ec-list');
    for (const member of ws.members) {
      const row = $('div', 'ec-row');
      const info = $('div', 'ec-person');
      const badgeText = roleLabel(member.role, { isFounder: member.founder });
      const titleLine = $('p', 'ec-person-name');
      titleLine.append($('span', '', member.name), $('span', 'ec-badge', badgeText));
      if (member.id === activeMember.id) titleLine.append($('span', 'ec-badge ec-badge-me', 'Активний'));
      info.append(titleLine);
      row.append(avatar(member.name, member.id === activeMember.id), info);

      const serverCanAssign = serverReady() && activeMember.role === 'leader' && member.id !== activeMember.id;
      if ((member.founder || member.role === 'leader') && !serverCanAssign) {
        row.append($('span', 'ec-tag', ROLES.leader));
      } else {
        const canChangeToJunior = canAssignRole({
          actorRole: activeMember.role, actorId: activeMember.id,
          targetRole: member.role, targetId: member.id, targetIsFounder: member.founder,
          newRole: 'junior_leader',
        }).allowed;
        const canChangeToUser = canAssignRole({
          actorRole: activeMember.role, actorId: activeMember.id,
          targetRole: member.role, targetId: member.id, targetIsFounder: member.founder,
          newRole: 'user',
        }).allowed;

        if (serverCanAssign || canChangeToJunior || canChangeToUser) {
          const roleChoices = serverCanAssign
            ? [...ASSIGNABLE_ROLE_OPTIONS, { value: 'leader', label: ROLES.leader }]
            : ASSIGNABLE_ROLE_OPTIONS;
          const roleSel = select(roleChoices);
          roleSel.value = member.role;
          roleSel.setAttribute('aria-label', `Призначити роль для ${member.name}`);
          roleSel.addEventListener('change', () => {
            if (serverReady()) {
              serverCall('role', { targetId: member.id, role: roleSel.value })
                .then(() => hubSay(`Учаснику «${member.name}» призначено роль «${roleLabel(roleSel.value)}». Запис у журналі сервера.`))
                .catch(error => { roleSel.value = member.role; hubSay(error.message || 'Не вдалося змінити роль.', true); });
              return;
            }
            try {
              const updated = assignMemberRole(ws, {
                actorId: activeMember.id,
                targetId: member.id,
                newRole: roleSel.value,
                now: nowSec(),
              });
              updateWorkspace(updated, `Учаснику «${member.name}» призначено роль «${roleLabel(roleSel.value)}». Записано в журнал.`);
            } catch (error) {
              roleSel.value = member.role;
              hubSay(error.message || 'Не вдалося змінити роль.', true);
            }
          });
          row.append(roleSel);
        } else {
          row.append($('span', 'ec-tag', badgeText));
        }

        if (perms.canRemoveMembers && member.id !== activeMember.id) {
          const remBtn = button('Вилучити');
          remBtn.addEventListener('click', () => {
            if (serverReady()) {
              serverCall('remove', { targetId: member.id })
                .then(() => hubSay(`Учасника «${member.name}» вилучено. Запис у журналі сервера.`))
                .catch(error => hubSay(error.message || 'Не вдалося вилучити учасника.', true));
              return;
            }
            try {
              const updated = removeWorkspaceMember(ws, {
                actorId: activeMember.id,
                targetId: member.id,
                now: nowSec(),
              });
              updateWorkspace(updated, `Учасника «${member.name}» вилучено з колективу.`);
            } catch (error) {
              hubSay(error.message || 'Не вдалося вилучити учасника.', true);
            }
          });
          row.append(remBtn);
        }
      }
      peopleList.append(row);
    }
    membersBox.append(peopleList);

    // Генерація 6-значного коду запрошення
    const inviteSection = $('div', 'ec-invite-bar');
    inviteSection.append($('p', 'ec-label', 'ЗАПРОШЕННЯ ДО КОЛЕКТИВУ ЗА 6-ЗНАЧНИМ КОДОМ'));
    if (perms.canInvite) {
      const invForm = $('form', 'ec-inline');
      const roleOpts = serverReady() && activeMember.role === 'leader'
        ? [...ASSIGNABLE_ROLE_OPTIONS, { value: 'leader', label: ROLES.leader }]
        : (perms.canAssignJuniorLeader ? ASSIGNABLE_ROLE_OPTIONS : [ASSIGNABLE_ROLE_OPTIONS[0]]);
      const invRoleSelect = select(roleOpts);
      const genBtn = button('Згенерувати 6-значний код');
      genBtn.type = 'submit';
      invForm.append(field('Початкова роль запрошеного', invRoleSelect), genBtn);
      invForm.addEventListener('submit', event => {
        event.preventDefault();
        if (serverReady()) {
          serverCall('invite', { assignedRole: invRoleSelect.value })
            .then(result => {
              lastGeneratedInvite = result.invite;
              holdEditor = false;
              renderHub();
              hubSay(`Код ${result.invite.displayCode} діє 24 години і приймається один раз. Іншим учасникам він не показується.`);
            })
            .catch(error => hubSay(error.message || 'Не вдалося згенерувати 6-значний код.', true));
          return;
        }
        try {
          const issued = issueInviteCode(ws, {
            actorId: activeMember.id,
            assignedRole: invRoleSelect.value,
            randomBytes,
            now: nowSec(),
          });
          lastGeneratedInvite = issued.invite;
          updateWorkspace(
            issued.workspace,
            `Згенеровано 6-значний код запрошення: ${issued.invite.displayCode} (роль «${roleLabel(issued.invite.assignedRole)}»). Другий користувач може ввести його у полі «Вступити за 6-значним кодом».`,
          );
        } catch (error) {
          hubSay(error.message || 'Не вдалося згенерувати 6-значний код.', true);
        }
      });
      inviteSection.append(invForm);
    } else {
      inviteSection.append($('p', 'ec-caption', 'Генерувати коди запрошення можуть Керівник та Молодший керівник.'));
    }

    const activeInvites = (ws.invites ?? []).filter(inv => !inv.usedBy);
    if (lastGeneratedInvite || activeInvites.length) {
      const shownInv = serverReady()
        ? lastGeneratedInvite
        : (lastGeneratedInvite && activeInvites.some(i => i.code === lastGeneratedInvite.code)
          ? lastGeneratedInvite
          : activeInvites[0]);
      if (shownInv) {
        const codeCard = $('div', 'ec-recovery ec-code-banner');
        codeCard.append(
          $('p', 'ec-label', 'АКТИВНИЙ 6-ЗНАЧНИЙ КОД ЗАПРОШЕННЯ'),
          $('code', 'ec-pair-code', shownInv.displayCode),
          $('p', 'ec-caption', serverReady()
            ? `Роль при вступі: «${roleLabel(shownInv.assignedRole)}». Код діє 24 години, один раз, і не потрапляє в спільний журнал.`
            : `Локальний код для цього комп’ютера. Роль при вступі: «${roleLabel(shownInv.assignedRole)}».`),
        );
        inviteSection.append(codeCard);
      }
    }
    membersBox.append(inviteSection);
    wsPanel.append(membersBox);

    // --- 2. Колективне файлове середовище (спільні файли, документи й таблиці) ---------------
    const filesBox = $('div', 'ec-hub-section');
    filesBox.append(
      $('h4', 'ec-subhead', `Колективне файлове середовище (${ws.files.length})`),
      $('p', 'ec-caption', 'Спільне файлове середовище колективу: створюйте, відкривайте та оновлюйте файли й таблиці. Усі оновлення одразу відображаються в усіх учасників колективу та записуються в журнал редагувань.'),
    );

    if (ws.files.length) {
      const fileGrid = $('div', 'ec-list');
      for (const file of ws.files) {
        const fRow = $('div', 'ec-row');
        const fMeta = $('div', 'ec-person');
        const fTitle = $('p', 'ec-person-name');
        fTitle.append(
          $('span', '', file.name),
          $('span', 'ec-badge', file.kindLabel || 'Файл'),
          $('span', 'ec-badge ec-badge-me', `v${file.version}`),
        );
        fMeta.append(
          fTitle,
          $('p', 'ec-caption', `Оновив: ${file.updatedByName} (${roleLabel(file.updatedByRole || 'user')}) · ${formatTime(file.updatedAt)} · ${file.size} симв.`),
        );
        const openBtn = button(activeFileId === file.id ? 'Відкрито' : 'Відкрити / Редагувати');
        if (activeFileId === file.id) openBtn.dataset.active = 'true';
        openBtn.addEventListener('click', () => {
          activeFileId = activeFileId === file.id ? '' : file.id;
          renderHub();
        });
        fRow.append(fMeta, openBtn);
        if (perms.canDeleteFiles) {
          const delBtn = button('Видалити');
          delBtn.addEventListener('click', () => {
            if (serverReady()) {
              serverCall('file', { fileOp: 'delete', fileId: file.id, baseVersion: file.version })
                .then(() => { if (activeFileId === file.id) activeFileId = ''; hubSay(`Файл «${file.name}» видалено на сервері.`); })
                .catch(error => hubSay(error.message || 'Не вдалося видалити файл.', true));
              return;
            }
            try {
              const nextWs = deleteWorkspaceFile(ws, {
                actorId: activeMember.id,
                fileId: file.id,
                now: nowSec(),
              });
              if (activeFileId === file.id) activeFileId = '';
              updateWorkspace(nextWs, `Файл «${file.name}» видалено з колективного середовища.`);
            } catch (error) {
              hubSay(error.message || 'Не вдалося видалити файл.', true);
            }
          });
          fRow.append(delBtn);
        }
        fileGrid.append(fRow);
      }
      filesBox.append(fileGrid);
    } else {
      filesBox.append($('p', 'ec-empty', 'У колективному файловому середовищі ще немає файлів. Додайте перший файл або таблицю нижче.'));
    }

    // Редактор відкритого файлу та його історія версій
    const openedFile = ws.files.find(f => f.id === activeFileId);
    if (openedFile) {
      const editorCard = $('div', 'ec-file-editor');
      editorCard.append(
        $('p', 'ec-label', `СПІЛЬНИЙ ФАЙЛ КОЛЕКТИВУ · ВЕРСІЯ ${openedFile.version}`),
        $('h4', '', openedFile.name),
        $('p', 'ec-caption', `Останнє оновлення: ${openedFile.updatedByName} (${roleLabel(openedFile.updatedByRole || 'user')}) о ${formatTime(openedFile.updatedAt)}`),
      );
      const nameIn = input('Назва файлу');
      nameIn.value = openedFile.name;
      const contentArea = area('Вміст файлу…');
      contentArea.rows = 6;
      contentArea.value = openedFile.content;
      contentArea.addEventListener('input', () => { holdEditor = true; });
      nameIn.addEventListener('input', () => { holdEditor = true; });
      const summaryIn = input('Короткий опис змін (для журналу редагувань)');
      const saveFileBtn = button('Зберегти та оновити для всіх');
      saveFileBtn.addEventListener('click', () => {
        if (serverReady()) {
          serverCall('file', {
            fileOp: 'save', fileId: openedFile.id, baseVersion: openedFile.version,
            name: nameIn.value, kind: openedFile.kind, content: contentArea.value,
            summary: summaryIn.value || `Оновлено файл «${nameIn.value || openedFile.name}»`,
          }).then(result => {
            holdEditor = false;
            const next = result.view?.files?.find(item => item.id === openedFile.id);
            hubSay(next
              ? `Файл «${next.name}» на сервері, версія ${next.version}.`
              : 'Зміни надіслано на сервер.');
          }).catch(error => {
            holdEditor = false;
            hubSay(error.conflict
              ? 'Конфлікт: файл уже змінено. Показано версію із сервера, ваш текст не перезаписав її.'
              : (error.message || 'Не вдалося оновити файл.'), true);
          });
          return;
        }
        try {
          const saved = saveWorkspaceFile(ws, {
            actorId: activeMember.id,
            fileId: openedFile.id,
            name: nameIn.value,
            kind: openedFile.kind,
            content: contentArea.value,
            summary: summaryIn.value || `Оновлено файл «${openedFile.name}»`,
            now: nowSec(),
          });
          holdEditor = false;
          updateWorkspace(saved.workspace, `Файл «${saved.file.name}» оновлено до версії ${saved.file.version}.`);
        } catch (error) {
          hubSay(error.message || 'Не вдалося оновити файл.', true);
        }
      });
      const closeFileBtn = button('Закрити редактор');
      closeFileBtn.addEventListener('click', () => {
        activeFileId = '';
        renderHub();
      });
      const btnBar = $('div', 'ec-inline');
      btnBar.append(saveFileBtn, closeFileBtn);
      editorCard.append(field('Назва', nameIn), field('Вміст спільного файлу', contentArea), field('Коментар до редагування', summaryIn), btnBar);

      if (openedFile.history?.length) {
        const histList = $('ul', 'ec-preview-list');
        for (const h of openedFile.history) {
          histList.append($('li', '', `v${h.version} · ${h.authorName} (${roleLabel(h.authorRole || 'user')}) · ${formatTime(h.timestamp)} — ${h.summary} (${h.size} симв.)`));
        }
        editorCard.append($('p', 'ec-label', 'ІСТОРІЯ ВЕРСІЙ ЦЬОГО ФАЙЛУ'), histList);
      }
      filesBox.append(editorCard);
    }

    // Форма створення нового спільного файлу / документа / таблиці
    const newFileForm = $('form', 'ec-file-create');
    newFileForm.append($('p', 'ec-label', 'ДОДАТИ НОВИЙ ФАЙЛ АБО ТАБЛИЦЮ В КОЛЕКТИВНЕ СЕРЕДОВИЩЕ'));
    const fNameIn = input('Назва файлу (напр. Зведення.txt або Графік_чергувань.csv)');
    const fKindSel = select(FILE_KIND_OPTIONS);
    const fContentIn = area('Введіть початковий текст документа або рядки таблиці…');
    fContentIn.rows = 4;
    const fSummaryIn = input('Примітка для журналу (необов’язково)');
    const fCreateBtn = button('Створити файл у колективі');
    fCreateBtn.type = 'submit';
    const topFields = $('div', 'ec-inline');
    topFields.append(field('Назва файлу', fNameIn), field('Тип файлу', fKindSel));
    newFileForm.append(topFields, field('Вміст файлу', fContentIn), field('Опис у журнал', fSummaryIn), fCreateBtn);
    newFileForm.addEventListener('submit', event => {
      event.preventDefault();
      if (serverReady()) {
        serverCall('file', {
          fileOp: 'create', name: fNameIn.value, kind: fKindSel.value,
          content: fContentIn.value, summary: fSummaryIn.value,
        }).then(result => {
          activeFileId = result.fileId || '';
          holdEditor = false;
          hubSay('Файл створено на сервері й з’явиться в усіх учасників.');
        }).catch(error => hubSay(error.message || 'Не вдалося створити файл.', true));
        return;
      }
      try {
        const created = saveWorkspaceFile(ws, {
          actorId: activeMember.id,
          name: fNameIn.value,
          kind: fKindSel.value,
          content: fContentIn.value,
          summary: fSummaryIn.value,
          now: nowSec(),
        });
        activeFileId = created.file.id;
        updateWorkspace(created.workspace, `Файл «${created.file.name}» додано в колективне файлове середовище (v${created.file.version}).`);
      } catch (error) {
        hubSay(error.message || 'Не вдалося створити файл.', true);
      }
    });
    filesBox.append(newFileForm);
    wsPanel.append(filesBox);

    // --- 3. Журнал редагувань та призначення ролей -------------------------------------------
    const auditBox = $('div', 'ec-hub-section');
    auditBox.append(
      $('h4', 'ec-subhead', `Журнал редагувань та призначення ролей (${ws.auditLog.length})`),
      $('p', 'ec-caption', 'Усі операції в колективі: створення колективу, генерація 6-значних кодів, вступ учасників, призначення ролей («Керівник», «Молодший керівник», «Користувач») та створення/редагування/видалення файлів.'),
    );
    const auditList = $('ul', 'ec-audit-list');
    for (const entry of ws.auditLog) {
      const item = $('li', 'ec-audit-item');
      item.dataset.action = entry.action;
      item.append(
        $('span', 'ec-audit-time', formatTime(entry.timestamp)),
        $('strong', 'ec-audit-actor', `${entry.actorName} (${entry.actorRoleLabel || roleLabel(entry.actorRole)})`),
        $('span', 'ec-audit-text', `${entry.actionLabel}${entry.target ? ` — «${entry.target}»` : ''}${entry.details ? `: ${entry.details}` : ''}`),
      );
      auditList.append(item);
    }
    auditBox.append(auditList);
    wsPanel.append(auditBox);

    hub.append(wsPanel);
  }

  // Захищені колективи: ключ учасника профілю і колективи, створені цим профілем (Rust,
  // міграція 0019). Пароль профілю йде лише в Rust; тут показуються відбитки й лічильники.
  let secureState = null;
  let secureError = '';
  let recoveryKey = '';
  let secureBusy = false;
  let exchangeFp = '';
  let detail = null;
  let shared = null;
  // Відкрита таблиця колективу: перевірені Rust пакети змін, стан із них (`base`) і робоча
  // копія, яку людина редагує (`edit`). `message` — відповідь «Оновити таблицю» чи «Доповісти».
  let openTable = null;
  // «Було → стане» перед «Підготувати доповідь».
  let tablePreview = null;
  // Підсумок останнього «Прийняти пакет».
  let syncResult = '';
  // Підготовлена доповідь: лише ідентифікатор наміру в Rust і підсумок для показу.
  let prepared = null;
  function passwordInput() {
    const e = $('input', 'ec-input');
    e.type = 'password';
    e.autocomplete = 'current-password';
    e.maxLength = 1024;
    e.placeholder = 'Пароль профілю';
    return e;
  }
  // Помилка показується під тією формою, яка її спричинила (`secureErrorAt`), а не під першою.
  let secureErrorAt = '';
  function memberNameInput() {
    const e = input('Як вас бачитимуть учасники');
    e.maxLength = 40;
    e.autocomplete = 'name';
    return e;
  }
  async function secureAction(fn, at = '') {
    if (secureBusy) return;
    secureBusy = true; secureError = ''; secureErrorAt = ''; renderSecure();
    try {
      await fn();
      secureState = await host.collectives.status();
      exchangeFp = pickCollective(secureState.collectives, exchangeFp);
      detail = exchangeFp ? await host.collectives.detail(exchangeFp).catch(() => null) : null;
    }
    catch (error) { secureError = String(error?.message || error || 'Не вдалося виконати дію.'); secureErrorAt = at; }
    finally { secureBusy = false; renderSecure(); }
  }
  function errorAt(at) {
    if (!secureError || secureErrorAt !== at) return [];
    const err = $('p', 'ec-status', secureError);
    err.dataset.error = 'true';
    err.dataset.at = at;
    return [err];
  }
  // Розділи, які людина розгорнула; переживають перемальовування після кожної дії.
  const openSections = new Set();
  function section(key, title, body, { open = false, count = null } = {}) {
    const box = $('details', 'ec-section');
    box.dataset.section = key;
    const summary = $('summary', 'ec-section-head');
    summary.append($('span', '', title));
    if (count !== null) summary.append($('span', 'ec-count-chip', String(count)));
    box.append(summary, ...body);
    box.open = open || openSections.has(key) || secureErrorAt === key;
    box.addEventListener('toggle', () => {
      if (box.open) openSections.add(key); else openSections.delete(key);
    });
    return box;
  }
  function avatar(name, me) {
    const e = $('span', 'ec-avatar', memberInitials(name));
    if (me) e.dataset.me = 'true';
    e.setAttribute('aria-hidden', 'true');
    return e;
  }
  function selectCollective(fp) {
    if (fp === exchangeFp) return;
    exchangeFp = fp; openTable = null; tablePreview = null; prepared = null; syncResult = '';
    secureAction(async () => {});
  }
  function renderSecure() {
    secure.replaceChildren($('p', 'ec-label', 'ЗАХИЩЕНИЙ КОЛЕКТИВ (КРИПТОГРАФІЧНИЙ КОНТУР ПРОФІЛЮ)'), $('h2', '', 'Мої захищені колективи'));
    if (!host.collectives) {
      secure.append($('p', 'ec-caption', 'Криптографічне сховище ключів профілю активується в настільному вікні EasyWAR; колективне файлове середовище вище працює і локально, і між вкладками.'));
      return;
    }
    if (!secureState) {
      secure.append($('p', 'ec-caption', secureError || 'Читаю стан…'));
      return;
    }
    if (secureState.identity) {
      const id = $('div', 'ec-me');
      const text = $('div', 'ec-me-text');
      const line = $('p', 'ec-fingerprint');
      line.append($('span', 'ec-label', 'Ваш відбиток '), $('code', '', secureState.identity.fingerprint),
        $('span', 'ec-label', ' · пристрій '), $('code', '', secureState.identity.deviceFingerprint));
      text.append(line, $('p', 'ec-caption', keyStoreText(secureState)));
      const badge = $('span', 'ec-avatar', 'Ви');
      badge.dataset.me = 'true';
      badge.setAttribute('aria-hidden', 'true');
      id.append(badge, text);
      secure.append(id);
    } else {
      secure.append($('p', 'ec-caption', keyStoreText(secureState)));
    }
    if (recoveryKey) {
      const box = $('div', 'ec-recovery');
      box.append($('p', 'ec-label', 'КЛЮЧ ВІДНОВЛЕННЯ — ПОКАЗУЄТЬСЯ ОДИН РАЗ'),
        $('code', 'ec-recovery-key', recoveryKey),
        $('p', 'ec-caption', 'Запишіть його окремо від комп’ютера. Без пароля профілю і без цього ключа секрети не відновити.'));
      const hide = button('Я записав(ла), сховати');
      hide.addEventListener('click', () => { recoveryKey = ''; renderSecure(); });
      box.append(hide);
      secure.append(box);
    }
    if (canCreateIdentity(secureState)) {
      const form = $('form', 'ec-inline');
      const pass = passwordInput();
      const submit = button('Створити ключ учасника');
      submit.type = 'submit';
      submit.disabled = secureBusy;
      form.append(field('Пароль профілю', pass), submit);
      form.addEventListener('submit', event => {
        event.preventDefault();
        secureAction(async () => {
          checkPassword(pass.value);
          const created = await host.collectives.createIdentity(pass.value);
          pass.value = '';
          recoveryKey = created.recoveryKey;
        }, 'identity');
      });
      secure.append(form, ...errorAt('identity'));
    }
    secure.append(...errorAt(''));
    if (!secureState.identity) return;

    // Колективи — картки з кількістю учасників; обрана розгортається складом нижче.
    const collectives = secureState.collectives;
    if (collectives.length) {
      const grid = $('div', 'ec-coll-grid');
      grid.setAttribute('role', 'list');
      for (const item of collectives) {
        const card = $('button', 'ec-coll-card');
        card.type = 'button';
        card.setAttribute('role', 'listitem');
        card.setAttribute('aria-pressed', String(item.fingerprint === exchangeFp));
        const count = $('span', 'ec-coll-count');
        count.append($('strong', '', String(item.members)), $('span', '', membersWord(item.members)));
        card.append($('span', 'ec-coll-name', item.name), count, $('code', 'ec-coll-fp', item.fingerprint));
        if (item.rejectedRecords > 0) card.append($('span', 'ec-coll-warn', `відхилених записів: ${item.rejectedRecords}`));
        card.addEventListener('click', () => selectCollective(item.fingerprint));
        grid.append(card);
      }
      const heading = $('h3', 'ec-coll-title');
      heading.append($('span', '', 'Ваші колективи'), $('span', 'ec-count-chip', `${collectives.length} з 20`));
      secure.append(heading, grid);
    } else {
      secure.append($('p', 'ec-empty', 'Колективів ще немає. Створіть свій або вступіть за запрошенням — нижче.'));
    }
    const shown = sharedBox();
    if (shown) secure.append(shown);
    if (exchangeFp && detail) renderDetail();

    const more = $('div', 'ec-sections');
    if (canCreateCollective(secureState)) {
      const form = $('form', 'ec-inline');
      const name = input('Назва колективу');
      const me = memberNameInput();
      const pass = passwordInput();
      const submit = button('Створити захищений колектив');
      submit.type = 'submit';
      submit.disabled = secureBusy;
      form.append(field('Назва', name), field('Ваше ім’я в колективі', me), field('Пароль профілю', pass), submit);
      form.addEventListener('submit', event => {
        event.preventDefault();
        secureAction(async () => {
          checkPassword(pass.value);
          const createdName = name.value;
          const createdMe = me.value;
          const created = await host.collectives.create(pass.value, createdName, createdMe);
          pass.value = ''; name.value = ''; me.value = '';
          if (created?.fingerprint && !workspaces.some(w => w.collectiveId === created.fingerprint)) {
            const ws = createCollectiveWorkspace({
              collectiveId: created.fingerprint,
              name: created.name || createdName,
              founderId: secureState.identity?.fingerprint || 'leader-1',
              founderName: createdMe,
              now: nowSec(),
            });
            updateWorkspace(ws, `Захищений колектив «${ws.name}» створено. Ви — «${ROLES.leader}».`);
          }
        }, 'create');
      });
      more.append(section('create', 'Створити новий колектив', [form, ...errorAt('create')], { open: !collectives.length }));
    }
    const invitation = area('EWINV1.…');
    const me = memberNameInput();
    const keys = area('EWKEYS1.…');
    more.append(section('join-request', 'Вступити в колектив за запрошенням', [
      $('p', 'ec-caption', 'Крок 1. Вставте запрошення й вкажіть своє ім’я: з’явиться відповідь для запрошувача.'),
      withError(passwordForm('Підготувати відповідь', [field('Текст запрошення', invitation), field('Ваше ім’я в колективі', me)], async password => {
        expectText(invitation.value, 'invitation');
        const made = await host.collectives.joinRequest(password, invitation.value, me.value);
        shared = { title: 'ВІДПОВІДЬ НА ЗАПРОШЕННЯ', text: made.text,
          hint: `Колектив ${made.collectiveFingerprint}, запросив ${made.inviterFingerprint}. Звірте відбиток із запрошувачем особисто, при зустрічі, й передайте йому цей текст.` };
      }, 'join-request'), 'join-request'),
      $('p', 'ec-caption', 'Крок 2. Вставте пакет ключів, який повернув запрошувач.'),
      withError(passwordForm('Прийняти й вступити', [field('Пакет ключів', keys)], async password => {
        expectText(keys.value, 'keys');
        const joined = await host.collectives.joinAccept(password, keys.value);
        exchangeFp = joined.collective.fingerprint;
        shared = { title: 'ВИ В КОЛЕКТИВІ', text: joined.members.map(memberLine).join('\n'),
          hint: `«${joined.collective.name}»: відбитки учасників за перевіреним журналом. Звірте їх із запрошувачем.` };
        keys.value = '';
      }, 'join-accept'), 'join-accept'),
    ], { open: secureErrorAt === 'join-accept' }));
    secure.append(more);
    secure.append($('p', 'ec-caption', 'Обмін іде через 6-значний код запрошення, тексти синхронізації та локальну чергу відправки.'));
  }

  // Обмін у колективі: склад, таблиці з класом, запрошення, вступ і «Доповісти».
  function sharedBox() {
    if (!shared) return null;
    const box = $('div', 'ec-recovery');
    const text = area('', true);
    text.value = shared.text;
    text.rows = 4;
    const hide = button('Сховати');
    hide.addEventListener('click', () => { shared = null; renderSecure(); });
    box.append($('p', 'ec-label', shared.title), $('p', 'ec-caption', shared.hint), text, hide);
    return box;
  }
  function passwordForm(submitText, fields, run, at = '') {
    const form = $('form', 'ec-inline');
    const pass = passwordInput();
    const submit = button(submitText);
    submit.type = 'submit';
    submit.disabled = secureBusy;
    form.append(...fields, field('Пароль профілю', pass), submit);
    form.addEventListener('submit', event => {
      event.preventDefault();
      secureAction(async () => {
        checkPassword(pass.value);
        await run(pass.value);
        pass.value = '';
      }, at);
    });
    return form;
  }
  function withError(form, at) {
    const wrap = $('div', 'ec-with-error');
    wrap.append(form, ...errorAt(at));
    return wrap;
  }
  function renderDetail() {
    const panel = $('section', 'ec-coll-panel');
    panel.setAttribute('aria-label', `Склад колективу «${detail.name}»`);
    const head = $('div', 'ec-coll-head');
    const title = $('div', '');
    title.append($('h3', '', detail.name), $('p', 'ec-caption', 'Склад за підписаним журналом складу'));
    const big = $('div', 'ec-coll-big');
    big.append($('strong', '', String(detail.members.length)), $('span', '', membersWord(detail.members.length)));
    head.append(title, big);
    panel.append(head);

    const people = $('ul', 'ec-people');
    for (const member of detail.members) {
      const row = $('li', 'ec-person-card');
      if (member.me) row.dataset.me = 'true';
      const text = $('div', 'ec-person-text');
      const nameLine = $('p', 'ec-person-name');
      nameLine.append($('span', '', member.name || 'Учасник без імені'));
      if (member.me) nameLine.append($('span', 'ec-badge ec-badge-me', 'Ви'));
      nameLine.append($('span', 'ec-badge', member.founder ? ROLES.leader : memberRoleLabel(member)));
      text.append(nameLine, $('code', 'ec-person-fp', member.fingerprint));
      row.append(avatar(member.name, member.me), text);
      people.append(row);
    }
    panel.append(people, $('p', 'ec-caption', 'Ім’я кожен учасник вказує сам; особу підтверджує відбиток — звіряйте його особисто, при зустрічі.'));

    const hours = input('24');
    hours.value = '24';
    const request = area('EWJOIN1.…');
    const actions = $('div', 'ec-sections');
    actions.append(section('invite', 'Запросити учасника', [
      $('p', 'ec-caption', 'Крок 1. Створіть одноразове запрошення й передайте його поза EasyWAR.'),
      withError(passwordForm('Створити запрошення', [field('Строк, годин', hours)], async password => {
        const made = await host.collectives.inviteCreate(password, exchangeFp, checkHours(hours.value));
        shared = { title: 'ЗАПРОШЕННЯ', text: made.text,
          hint: 'Одноразове. Передайте текст запрошеному поза EasyWAR; він поверне відповідь, яку ви вставите в «Запросити учасника» → крок 2.' };
      }, 'invite'), 'invite'),
      $('p', 'ec-caption', 'Крок 2. Вставте відповідь запрошеного, щоб впустити його.'),
      withError(passwordForm('Впустити', [field('Відповідь запрошеного', request)], async password => {
        expectText(request.value, 'request');
        const admitted = await host.collectives.inviteAdmit(password, exchangeFp, request.value);
        shared = { title: 'ПАКЕТ КЛЮЧІВ ДЛЯ НОВОГО УЧАСНИКА', text: admitted.text,
          hint: `Учасник ${admitted.memberName ? `«${admitted.memberName}» ` : ''}${admitted.memberFingerprint} у журналі. Ім’я учасник вказав сам: звірте відбиток. Передайте йому цей текст; відкритих ключів у ньому немає.` };
        request.value = '';
      }, 'admit'), 'admit'),
    ], { open: secureErrorAt === 'admit' }));

    const tables = $('div', 'ec-list');
    for (const table of detail.tables) {
      const row = $('div', 'ec-row');
      const text = $('div', 'ec-person');
      text.append($('span', '', table.title), $('p', 'ec-caption', `${tableLine(table)} · пакетів змін: ${table.changes}`));
      const open = button(table.canWrite ? 'Змінити дані' : 'Переглянути');
      open.disabled = secureBusy;
      if (openTable?.fp === table.fingerprint) open.dataset.active = 'true';
      open.addEventListener('click', () => {
        if (openTable?.fp !== table.fingerprint) { openTable = { fp: table.fingerprint, data: null }; tablePreview = null; prepared = null; }
        openSections.add('data');
        renderSecure();
      });
      row.append(text, $('code', '', table.fingerprint), open);
      tables.append(row);
    }
    const tableForm = $('form', 'ec-inline');
    const tableTitle = input('Назва таблиці');
    const tableColumns = input('Підрозділ, Стан, Примітка');
    tableColumns.maxLength = 1400;
    const cls = select(CLASS_OPTIONS);
    const purpose = select(PURPOSE_OPTIONS);
    const add = button('Додати таблицю');
    add.type = 'submit';
    add.disabled = secureBusy;
    tableForm.append(field('Назва', tableTitle), field('Стовпці (через кому)', tableColumns), field('Клас', cls), field('Призначення', purpose), add);
    tableForm.addEventListener('submit', event => {
      event.preventDefault();
      secureAction(async () => {
        const columns = parseColumns(tableColumns.value);
        await host.collectives.setTable({ collective: exchangeFp, title: tableTitle.value, cls: cls.value, purpose: purpose.value, columns });
      }, 'table');
    });
    actions.append(section('table', 'Таблиці колективу', [
      ...(detail.tables.length ? [tables] : [$('p', 'ec-caption', 'Таблиць ще немає.')]),
      $('p', 'ec-label', 'НОВА ТАБЛИЦЯ (КЛАС ПІДТВЕРДЖУЄТЕ ВИ ЯК ВЛАСНИК)'),
      withError(tableForm, 'table'),
    ], { count: detail.tables.length, open: Boolean(openTable) }));

    const current = openTable && detail.tables.find(table => table.fingerprint === openTable.fp);
    if (current) actions.append(section('data', `Дані: ${current.title}`, tableDataBody(current), { open: true }));
    actions.append(section('sync', 'Пакет оновлення', syncBody()));
    actions.append(section('tech', 'Технічні дані', [$('p', 'ec-caption', detailLine(detail))]));
    panel.append(actions);
    secure.append(panel);
  }

  // «Оновити таблицю»: Rust відкриває збережені пакети змін паролем і перевіряє кожен.
  async function loadTable(password, fp) {
    const data = await host.collectives.tableRead(password, exchangeFp, fp);
    const seen = openTable?.fp === fp && openTable.data ? openTable.data.changes.length : null;
    const built = buildTable(data);
    openTable = {
      fp, data, base: built.rows,
      edit: built.rows.map(row => ({ key: row.key, values: { ...row.values }, by: row.by })),
      message: refreshText(data, seen),
    };
    tablePreview = null;
  }
  // «Оновити таблицю»: якщо вставлено пакет оновлення від учасника, спершу Rust його
  // перевіряє й приймає, потім таблиця збирається заново.
  function refreshForm(fp) {
    const pack = area('Пакет оновлення від учасника (EWSYNC1.…), якщо отримали');
    return passwordForm('Оновити таблицю', [field('Пакет оновлення', pack)], async password => {
      if (openTable?.data && diffTable(openTable.base, openTable.edit, openTable.data.columns).length
        && !window.confirm('Є недоповідені зміни. Оновити таблицю й відкинути їх?')) return;
      let imported = '';
      if (pack.value.trim()) {
        expectText(pack.value, 'sync');
        imported = syncImportText(await host.collectives.syncImport(password, pack.value));
      }
      await loadTable(password, fp);
      if (imported) openTable.message = `${imported} ${openTable.message}`;
    }, 'data');
  }
  // Пакет оновлення для інших учасників і приймання пакета без відкритої таблиці.
  function syncBody() {
    const pack = area('EWSYNC1.…');
    return [
      $('p', 'ec-caption', 'Поки немає передачі локальною мережею, зміни доходять до учасників пакетом оновлення: у ньому склад колективу, таблиці й усі пакети змін. Прочитати його можуть лише учасники. Передайте текст самі, як запрошення.'),
      withError(passwordForm('Створити пакет', [], async password => {
        const made = await host.collectives.syncExport(password, exchangeFp);
        shared = { title: 'ПАКЕТ ОНОВЛЕННЯ', text: made.text, hint: syncExportText(made) };
        syncResult = '';
      }, 'sync-export'), 'sync-export'),
      $('p', 'ec-caption', 'Отримали пакет від учасника? Вставте його тут або в «Оновити таблицю».'),
      withError(passwordForm('Прийняти пакет', [field('Пакет оновлення', pack)], async password => {
        expectText(pack.value, 'sync');
        const got = await host.collectives.syncImport(password, pack.value);
        pack.value = '';
        if (openTable?.data) await loadTable(password, openTable.fp);
        shared = null;
        syncResult = syncImportText(got);
        if (got.tables || got.newChanges) openSections.add('table');
      }, 'sync-import'), 'sync-import'),
      ...(syncResult ? [$('p', 'ec-status', syncResult)] : []),
    ];
  }
  function tableDataBody(table) {
    const body = [];
    const note = $('p', 'ec-caption', 'Пакети змін інших учасників приходять пакетом оновлення: вставте його в поле вище й натисніть «Оновити таблицю». Після кроку передачі локальною мережею це відбуватиметься само.');
    if (!table.columns.length) {
      if (!table.mine) return [$('p', 'ec-caption', 'Власник таблиці ще не задав стовпці.')];
      const columns = input('Підрозділ, Стан, Примітка');
      columns.maxLength = 1400;
      const form = $('form', 'ec-inline');
      const save = button('Зберегти стовпці');
      save.type = 'submit';
      save.disabled = secureBusy;
      form.append(field('Стовпці (через кому)', columns), save);
      form.addEventListener('submit', event => {
        event.preventDefault();
        secureAction(async () => {
          await host.collectives.setTable({ collective: exchangeFp, table: table.fingerprint, title: table.title,
            cls: table.declaredClass, purpose: table.purpose, columns: parseColumns(columns.value) });
        }, 'data');
      });
      return [$('p', 'ec-caption', 'Спершу задайте стовпці таблиці: їх бачитимуть усі учасники.'), withError(form, 'data')];
    }
    if (!openTable.data) {
      body.push($('p', 'ec-caption', 'Щоб побачити дані, натисніть «Оновити таблицю»: пакети змін відкриваються паролем профілю.'),
        withError(refreshForm(table.fingerprint), 'data'), note);
      return body;
    }
    const columns = openTable.data.columns;
    const locked = !table.canWrite || Boolean(tablePreview) || Boolean(prepared);
    const baseKeys = new Set(openTable.base.map(row => row.key));
    const wrap = $('div', 'ec-grid-wrap');
    const grid = $('table', 'ec-grid');
    const head = $('tr', '');
    for (const column of columns) head.append($('th', '', column));
    head.append($('th', '', 'Хто змінив'));
    if (!locked) head.append($('th', '', ''));
    const thead = $('thead', '');
    thead.append(head);
    const tbody = $('tbody', '');
    openTable.edit.forEach((row, index) => {
      const tr = $('tr', '');
      for (const column of columns) {
        const td = $('td', '');
        if (locked) td.textContent = row.values[column] ?? '';
        else {
          const cell = $('input', 'ec-input ec-cell');
          cell.type = 'text';
          cell.maxLength = 1000;
          cell.value = row.values[column] ?? '';
          cell.setAttribute('aria-label', column);
          cell.addEventListener('input', () => { row.values[column] = cell.value; });
          td.append(cell);
        }
        tr.append(td);
      }
      const by = baseKeys.has(row.key) ? `${authorLine(row.by)}, ${changeTime(row.by?.clientTime)}` : 'новий рядок';
      tr.append($('td', 'ec-grid-by', by));
      if (!locked) {
        const del = button('×');
        del.className = 'ec-btn ec-grid-del';
        del.setAttribute('aria-label', 'Видалити рядок');
        del.addEventListener('click', () => { openTable.edit.splice(index, 1); renderSecure(); });
        const td = $('td', '');
        td.append(del);
        tr.append(td);
      }
      tbody.append(tr);
    });
    grid.append(thead, tbody);
    wrap.append(grid);
    body.push(wrap);
    if (!openTable.edit.length) body.push($('p', 'ec-caption', table.canWrite ? 'Рядків ще немає: додайте перший.' : 'Рядків ще немає.'));

    if (tablePreview) body.push(...previewBody(table, columns));
    else if (!locked) {
      const actionsRow = $('div', 'ec-inline');
      const addRow = button('Додати рядок');
      addRow.disabled = secureBusy;
      addRow.addEventListener('click', () => {
        const taken = new Set(openTable.edit.map(row => row.key));
        openTable.edit.push({ key: newRowKey(n => crypto.getRandomValues(new Uint8Array(n)), taken), values: emptyValues(columns), by: null });
        renderSecure();
      });
      const report = button('Доповісти');
      report.disabled = secureBusy;
      report.addEventListener('click', () => {
        tablePreview = diffTable(openTable.base, openTable.edit, columns);
        if (!tablePreview.length) { tablePreview = null; openTable.message = 'Змін немає: змініть клітинки, додайте або видаліть рядок.'; }
        else openTable.message = '';
        renderSecure();
      });
      actionsRow.append(addRow, report);
      body.push(actionsRow);
    }
    if (openTable.message) body.push($('p', 'ec-status', openTable.message));
    if (!tablePreview && !prepared) body.push(withError(refreshForm(table.fingerprint), 'data'));
    body.push(note);
    return body;
  }
  // Перегляд «було → стане», потім Rust-намір (60 с) і підтвердження паролем.
  function previewBody(table, columns) {
    const box = $('div', 'ec-preview');
    box.append($('p', 'ec-label', `ДОПОВІДЬ: ${previewSummary(tablePreview).toUpperCase()}`));
    const list = $('ul', 'ec-preview-list');
    for (const item of tablePreview) {
      const li = $('li', '');
      li.dataset.kind = item.kind;
      if (item.kind === 'deleted') {
        li.append($('strong', '', 'Видалено: '), $('span', '', columns.map(c => item.before[c]).filter(Boolean).join(' · ') || item.key));
      } else if (item.kind === 'new') {
        li.append($('strong', '', 'Новий рядок: '), $('span', '', item.changed.map(c => `${c}: ${item.after[c]}`).join(' · ')));
      } else {
        li.append($('strong', '', 'Змінено: '), $('span', '', item.changed.map(c => `${c}: «${item.before[c] ?? ''}» → «${item.after[c] ?? ''}»`).join(' · ')));
      }
      list.append(li);
    }
    box.append(list, $('p', 'ec-caption', 'У пакет іде весь рядок, навіть якщо змінено лише кілька клітинок. Адресати: усі учасники колективу.'));
    const out = [box];
    if (prepared) {
      const cancel = button('Скасувати');
      cancel.disabled = secureBusy;
      cancel.addEventListener('click', () => { prepared = null; renderSecure(); });
      out.push($('p', 'ec-status', prepared.text), withError(passwordForm('Доповісти', [], async password => {
        const intent = prepared.intent;
        prepared = null;
        const outcome = await host.collectives.reportConfirm(password, intent);
        if (outcome.allowed) {
          await loadTable(password, table.fingerprint);
          openTable.message = reportText(outcome);
        } else openTable.message = reportText(outcome);
      }, 'data'), 'data'), cancel);
      return out;
    }
    const row = $('div', 'ec-inline');
    const back = button('Назад до редагування');
    back.disabled = secureBusy;
    back.addEventListener('click', () => { tablePreview = null; renderSecure(); });
    const go = button('Підготувати доповідь');
    go.disabled = secureBusy;
    go.addEventListener('click', () => secureAction(async () => {
      // Rust перевіряє зміну, маршрут і права й запам'ятовує намір на 60 секунд.
      const operation = changeOperation(tablePreview, columns);
      const outcome = await host.collectives.reportPrepare({ collective: exchangeFp, table: table.fingerprint,
        transport: 'lan', explicitWan: false, operation });
      if (outcome.allowed) prepared = { intent: outcome.intent, text: preparedText(outcome) };
      else openTable.message = reportText(outcome);
    }, 'data'));
    row.append(back, go);
    out.push(withError(row, 'data'));
    return out;
  }
  renderHub();
  loadStoredWorkspaces();
  renderSecure();
  if (host.collectives) secureAction(async () => {});

  function notice(message, error = false) {
    status.textContent = message;
    status.dataset.error = String(error);
  }
  function publish(changed) {
    dirty = changed;
    host.setDirty(changed);
    host.setTitle(fileName || (draft?.name || ''));
    render();
  }
  function apply(next, text) {
    draft = next;
    publish(true);
    notice(text);
  }
  function allowedReplace() {
    return !dirty || window.confirm('Є незбережені зміни. Продовжити без їх збереження?');
  }
  function action(fn) {
    try { fn(); } catch (error) { notice(error.message || 'Не вдалося виконати дію.', true); }
  }
  function field(label, value) {
    const wrap = $('label', 'ec-field');
    wrap.append($('span', 'ec-label', label), value);
    return wrap;
  }
  function render() {
    panel.replaceChildren();
    save.disabled = busy || !draft;
    saveAs.disabled = busy || !draft;
    fresh.disabled = busy;
    open.disabled = busy;
    if (!draft) {
      const form = $('form', 'ec-form');
      const title = input('Наприклад: Навчальна група');
      const owner = input('Наприклад: Користувач А');
      const submit = button('Створити');
      submit.type = 'submit';
      form.append($('h2', '', 'Новий локальний колектив (.ewcoll)'), field('Назва колективу', title),
        field('Позначення Керівника (творця)', owner), submit);
      form.addEventListener('submit', event => {
        event.preventDefault();
        action(() => {
          draft = createCollective(title.value, owner.value);
          fileName = '';
          const ws = createCollectiveWorkspace({
            collectiveId: `local-${Date.now()}`,
            name: draft.name,
            founderId: 'member-1',
            founderName: draft.participants[0].label,
            now: nowSec(),
          });
          updateWorkspace(ws, 'Колектив створено. Ви — «Керівник».');
          publish(true);
          notice('Колектив створено в пам’яті. Натисніть «Зберегти», щоб створити файл.');
        });
      });
      panel.append(form);
      return;
    }

    const title = $('section', 'ec-card');
    title.append($('p', 'ec-label', 'ЛОКАЛЬНИЙ ФАЙЛ КОЛЕКТИВУ (.EWCOLL)'), $('h2', '', draft.name),
      $('p', 'ec-caption', 'Склад, ролі («Керівник», «Молодший керівник», «Користувач»), файли та журнал зберігаються у файл .ewcoll.'));
    const renameForm = $('form', 'ec-inline');
    const renameInput = input('Нова назва');
    renameInput.value = draft.name;
    const renameButton = button('Перейменувати');
    renameButton.type = 'submit';
    renameForm.append(field('Назва', renameInput), renameButton);
    renameForm.addEventListener('submit', event => {
      event.preventDefault();
      action(() => apply(renameCollective(draft, renameInput.value), 'Назву змінено.'));
    });
    title.append(renameForm);

    const list = $('section', 'ec-card');
    list.append($('h2', '', 'Склад і ролі (' + draft.participants.length + '/100)'));
    const rows = $('div', 'ec-list');
    for (const participant of draft.participants) {
      const row = $('div', 'ec-row');
      row.append($('span', 'ec-person', participant.label));
      if (participant.role === 'owner') {
        row.append($('span', 'ec-tag', roles.owner));
      } else {
        const select = $('select', 'ec-input');
        select.setAttribute('aria-label', 'Роль: ' + participant.label);
        for (const role of ['member', 'admin']) {
          const option = $('option', '', roles[role]);
          option.value = role;
          option.selected = participant.role === role;
          select.append(option);
        }
        select.addEventListener('change', () => action(() =>
          apply(changeParticipantRole(draft, participant.id, select.value), `Роль змінено на «${roles[select.value]}».`)));
        const remove = button('Прибрати');
        remove.setAttribute('aria-label', 'Прибрати: ' + participant.label);
        remove.addEventListener('click', () => action(() =>
          apply(removeParticipant(draft, participant.id), 'Учасника прибрано.')));
        row.append(select, remove);
      }
      rows.append(row);
    }
    list.append(rows);
    const addForm = $('form', 'ec-inline');
    const memberName = input('Позначення учасника');
    const role = $('select', 'ec-input');
    for (const kind of ['member', 'admin']) {
      const option = $('option', '', roles[kind]);
      option.value = kind;
      role.append(option);
    }
    const add = button('Додати учасника');
    add.type = 'submit';
    addForm.append(field('Позначення', memberName), field('Роль', role), add);
    addForm.addEventListener('submit', event => {
      event.preventDefault();
      action(() => {
        apply(addParticipant(draft, memberName.value, role.value), `Додано учасника з роллю «${roles[role.value]}».`);
        memberName.value = '';
      });
    });
    list.append(addForm);
    panel.append(title, list);
  }

  fresh.addEventListener('click', () => action(async () => {
    if (!allowedReplace()) return;
    if (handle) await host.closeFile(handle);
    handle = null;
    fileName = '';
    draft = null;
    publish(false);
    notice('Створіть новий колектив.');
  }));
  open.addEventListener('click', async () => {
    if (busy || !allowedReplace()) return;
    busy = true; render();
    try {
      const opened = await host.openFile({ title: 'Відкрити локальний колектив' });
      if (!opened) return;
      let next;
      try { next = decodeCollective(opened.bytes); }
      catch (error) { await host.closeFile(opened.handle).catch(() => {}); throw error; }
      if (handle) await host.closeFile(handle).catch(() => {});
      handle = opened.handle;
      fileName = opened.name;
      draft = next;
      // Імпортуємо відкритий файл .ewcoll у колективне файлове середовище
      let ws = createCollectiveWorkspace({
        collectiveId: `file-${opened.name}`,
        name: next.name,
        founderId: 'member-1',
        founderName: next.participants[0]?.label || 'Керівник',
        now: nowSec(),
      });
      for (const p of next.participants.slice(1)) {
        const issued = issueInviteCode(ws, {
          actorId: 'member-1',
          assignedRole: p.role === 'admin' ? 'junior_leader' : 'user',
          randomBytes,
          now: nowSec(),
        });
        ws = redeemInviteCode(issued.workspace, {
          code: issued.invite.code,
          memberId: `member-${p.id}`,
          memberName: p.label,
          now: nowSec(),
        }).workspace;
      }
      for (const f of next.files ?? []) {
        ws = saveWorkspaceFile(ws, {
          actorId: 'member-1',
          fileId: f.id,
          name: f.name,
          kind: f.kind,
          content: f.content,
          summary: `Завантажено з файлу ${opened.name}`,
          now: nowSec(),
        }).workspace;
      }
      updateWorkspace(ws, `Відкрито файл колективу «${opened.name}» у колективному файловому середовищі.`);
      publish(false);
      notice('Відкрито: ' + opened.name);
    } catch (error) { notice(error.message || 'Не вдалося відкрити файл.', true); }
    finally { busy = false; render(); }
  });
  async function persist(as = false) {
    if (busy || !draft) return;
    busy = true; render();
    try {
      const bytes = encodeCollective(draft);
      const saved = handle && !as
        ? await host.saveFile({ handle, bytes })
        : await host.saveFileAs({ bytes, suggestedName: fileName || 'колектив.ewcoll',
          title: 'Зберегти локальний колектив' });
      if (!saved) return;
      if (handle && handle !== saved.handle) await host.closeFile(handle).catch(() => {});
      handle = saved.handle;
      fileName = saved.name;
      publish(false);
      notice('Збережено локальний файл: ' + saved.name);
    } catch (error) { notice(error.message || 'Не вдалося зберегти файл.', true); }
    finally { busy = false; render(); }
  }
  save.addEventListener('click', () => persist());
  saveAs.addEventListener('click', () => persist(true));
  publish(false);
  return {
    isDirty: () => dirty,
    unmount() {
      try { broadcast?.close(); } catch { /* ignore */ }
      if (handle) host.closeFile(handle).catch(() => {});
      root.remove();
    },
  };
}

