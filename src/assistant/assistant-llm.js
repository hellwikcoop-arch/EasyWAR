// Thin client for the optional local language model. It only calls the eleven dedicated Tauri commands:
// the model never receives the DOM, files, SQLite or any other command. The invoke function is injectable
// so the behaviour can be tested without Tauri.
import { invoke as tauriInvoke, Channel as TauriChannel } from '@tauri-apps/api/core';

export const LLM_COMMANDS = Object.freeze({
  status: 'get_local_model_status',
  choose: 'choose_local_model_package',
  enable: 'set_local_model_enabled',
  forget: 'forget_local_model_package',
  generate: 'generate_local_answer',
  cancel: 'cancel_local_answer',
  stop: 'stop_local_model',
  installInfo: 'get_local_model_install_info',
  install: 'install_local_model',
  cancelInstall: 'cancel_local_model_install',
  removeFiles: 'remove_local_model_files',
});

const OFF = Object.freeze({ configured: false, enabled: false, ready: false, name: null, sizeMb: null, loaded: false, busy: false, message: null });
const MAX_ANSWER_CHARS = 2000;

function plainStatus(value) {
  if (!value || typeof value !== 'object') return { ...OFF };
  return {
    configured: value.configured === true,
    enabled: value.enabled === true,
    ready: value.ready === true,
    name: typeof value.name === 'string' ? value.name.slice(0, 120) : null,
    sizeMb: Number.isFinite(value.sizeMb) ? value.sizeMb : null,
    loaded: value.loaded === true,
    busy: value.busy === true,
    message: typeof value.message === 'string' ? value.message.slice(0, 300) : null,
  };
}

function plainInstallInfo(value) {
  if (!value || typeof value !== 'object' || !Number.isFinite(value.sizeBytes) || value.sizeBytes <= 0) return null;
  const text = (item, max) => (typeof item === 'string' ? item.slice(0, max) : '');
  return {
    title: text(value.title, 80), license: text(value.license, 40), host: text(value.host, 80), folder: text(value.folder, 400),
    sizeBytes: value.sizeBytes,
    partialBytes: Number.isFinite(value.partialBytes) && value.partialBytes > 0 ? value.partialBytes : 0,
    installed: value.installed === true, runnerPresent: value.runnerPresent === true, busy: value.busy === true,
  };
}

function plainProgress(event) {
  if (!event || event.type !== 'progress' || (event.phase !== 'download' && event.phase !== 'verify')) return null;
  if (!Number.isFinite(event.done) || !Number.isFinite(event.total) || event.total <= 0) return null;
  return { phase: event.phase, done: Math.max(0, Math.min(event.done, event.total)), total: event.total };
}

function errorText(error) {
  const text = typeof error === 'string' ? error : error?.message;
  return String(text || 'Локальна модель недоступна.').slice(0, 300);
}

export function createLocalModelClient({ invokeCommand = tauriInvoke, ChannelClass = TauriChannel } = {}) {
  let status = { ...OFF };
  let active = 0;

  async function call(command, args) {
    try { return { ok: true, value: await invokeCommand(command, args) }; }
    catch (error) { return { ok: false, error: errorText(error) }; }
  }
  function remember(result) {
    if (result.ok) status = plainStatus(result.value);
    return result;
  }

  return {
    status: () => status,
    // Reads the cheap status; any failure means "no model", never an error for the user.
    async refresh() {
      const result = remember(await call(LLM_COMMANDS.status));
      if (!result.ok) status = { ...OFF };
      return status;
    },
    async choose() {
      const result = await call(LLM_COMMANDS.choose);
      if (!result.ok) return { ok: false, message: result.error, status };
      if (result.value === null || result.value === undefined) return { ok: true, cancelled: true, status };
      status = plainStatus(result.value);
      return { ok: true, status };
    },
    async setEnabled(enabled) {
      const result = remember(await call(LLM_COMMANDS.enable, { enabled: enabled === true }));
      return result.ok ? { ok: true, status } : { ok: false, message: result.error, status };
    },
    async forget() {
      const result = remember(await call(LLM_COMMANDS.forget));
      return result.ok ? { ok: true, status } : { ok: false, message: result.error, status };
    },
    // Only describes what would be downloaded; touches neither the network nor the disk beyond a size check.
    async installInfo() {
      const result = await call(LLM_COMMANDS.installInfo);
      return result.ok ? plainInstallInfo(result.value) : null;
    },
    // Explicit installation: download, SHA-256 check and (when a runner is present) package check.
    // Resolves to {ok, outcome:'ready'|'modelOnly'|'cancelled', message, status} or {ok:false, message}.
    async install({ onProgress } = {}) {
      const channel = new ChannelClass();
      channel.onmessage = event => {
        const progress = plainProgress(event);
        if (!progress) return;
        try { onProgress?.(progress); } catch { /* a broken listener must not stop the installation */ }
      };
      const result = await call(LLM_COMMANDS.install, { onEvent: channel });
      if (!result.ok) return { ok: false, message: result.error, status };
      const value = result.value && typeof result.value === 'object' ? result.value : {};
      status = plainStatus(value.status);
      const outcome = ['ready', 'modelOnly', 'cancelled'].includes(value.outcome) ? value.outcome : 'modelOnly';
      return { ok: true, outcome, message: typeof value.message === 'string' ? value.message.slice(0, 600) : '', status };
    },
    async cancelInstall() { await call(LLM_COMMANDS.cancelInstall); },
    async removeFiles() {
      const result = remember(await call(LLM_COMMANDS.removeFiles));
      return result.ok ? { ok: true, status } : { ok: false, message: result.error, status };
    },
    async cancel() { active++; await call(LLM_COMMANDS.cancel); },
    async stop() { active++; await call(LLM_COMMANDS.stop); },
    // generate(request, {onToken}) → full text. Rejects on any engine failure so the caller falls back.
    async generate(request, { onToken } = {}) {
      const mine = ++active;
      let streamed = '';
      const channel = new ChannelClass();
      channel.onmessage = event => {
        if (mine !== active || !event || event.type !== 'token' || typeof event.text !== 'string') return;
        streamed += event.text;
        if (streamed.length > MAX_ANSWER_CHARS) streamed = streamed.slice(0, MAX_ANSWER_CHARS);
        try { onToken?.(streamed); } catch { /* a broken listener must not stop the answer */ }
      };
      let value;
      try { value = await invokeCommand(LLM_COMMANDS.generate, { request, onEvent: channel }); }
      catch (error) { throw new Error(errorText(error)); }
      if (mine !== active) throw new Error('Відповідь скасовано.');
      const text = typeof value === 'string' && value.trim() ? value : streamed;
      return String(text).slice(0, MAX_ANSWER_CHARS);
    },
  };
}
