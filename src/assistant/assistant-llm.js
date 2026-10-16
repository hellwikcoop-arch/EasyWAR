// Thin client for the optional local language model. It only calls the seven dedicated Tauri commands:
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
