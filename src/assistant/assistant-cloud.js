// Explicit online chat. Only the user's typed text and earlier online replies leave the app.
// The caller owns the token in volatile memory and clears it when the profile session ends.
export function chatEndpoint(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash) return null;
    if (url.pathname !== '/' && url.pathname !== '/v1/chat') return null;
    url.pathname = '/v1/chat';
    return url.href;
  } catch { return null; }
}

export function onlineMessages(history, query) {
  const messages = [];
  for (const turn of (history || []).slice(-5)) {
    if (!turn || typeof turn.query !== 'string' || typeof turn.answer !== 'string') continue;
    messages.push({ role: 'user', content: turn.query.replace(/\s+/gu, ' ').trim().slice(0, 512) });
    messages.push({ role: 'assistant', content: turn.answer.replace(/\s+/gu, ' ').trim().slice(0, 512) });
  }
  messages.push({ role: 'user', content: String(query || '').replace(/\s+/gu, ' ').trim().slice(0, 512) });
  return messages;
}

export class OnlineError extends Error {
  constructor(code) { super(code); this.code = code; }
}

const STATUS_CODE = Object.freeze({ 401: 'access-denied', 429: 'busy', 503: 'unavailable' });

export async function streamOnlineAnswer({ endpoint, token, messages, signal, onToken, fetchImpl = fetch }) {
  const url = chatEndpoint(endpoint);
  if (!url || !/^[a-f0-9]{64}$/u.test(token || '')) throw new OnlineError('invalid-configuration');
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST', redirect: 'error', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({ messages }),
    });
  } catch (error) { throw new OnlineError(signal?.aborted || error?.name === 'AbortError' ? 'cancelled' : 'network'); }
  if (!response.ok) {
    let code = STATUS_CODE[response.status] || 'server-error';
    try {
      const body = await response.json();
      if (['disabled', 'budget-exhausted', 'busy', 'unauthorized'].includes(body?.error)) code = body.error;
    } catch { /* status code is enough */ }
    throw new OnlineError(code);
  }
  if (!response.body || !response.headers.get('content-type')?.startsWith('text/event-stream')) throw new OnlineError('invalid-stream');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', answer = '', complete = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/gu, '\n');
      if (buffer.length > 16384) throw new OnlineError('invalid-stream');
      let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        const event = frame.match(/^event:\s*(\S+)/mu)?.[1];
        const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        let parsed;
        try { parsed = JSON.parse(data); } catch { throw new OnlineError('invalid-stream'); }
        if (event === 'token') {
          if (typeof parsed.text !== 'string' || answer.length + parsed.text.length > 2000) throw new OnlineError('invalid-stream');
          answer += parsed.text;
          onToken?.(answer);
        } else if (event === 'done') complete = true;
        else if (event === 'error') throw new OnlineError(typeof parsed.code === 'string' ? parsed.code : 'server-error');
        else throw new OnlineError('invalid-stream');
      }
    }
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') throw new OnlineError('cancelled');
    if (error instanceof OnlineError) throw error;
    throw new OnlineError('network');
  } finally { reader.releaseLock(); }
  if (signal?.aborted) throw new OnlineError('cancelled');
  if (!complete || !answer.trim()) throw new OnlineError('incomplete-stream');
  return answer.trim();
}

export function onlineErrorText(code) {
  return {
    'invalid-configuration': 'Перевірте HTTPS-адресу та персональний токен доступу.',
    'access-denied': 'Доступ відхилено. Перевірте персональний токен.',
    unauthorized: 'Доступ відкликано або токен неправильний.',
    busy: 'Зараз забагато запитів. Спробуйте пізніше.',
    disabled: 'Онлайн-акцію вимкнено на сервері.',
    'budget-exhausted': 'Ліміт акції вичерпано.',
    unavailable: 'Онлайн-режим зараз недоступний.',
    network: 'Немає зв’язку із сервісом. Локальна довідка працює без мережі.',
    cancelled: 'Запит скасовано.',
    'invalid-stream': 'Отримано некоректну потокову відповідь.',
    'incomplete-stream': 'Потокова відповідь обірвалася. Спробуйте ще раз.',
  }[code] || 'Онлайн-відповідь недоступна. Спробуйте пізніше.';
}
