const LINK_PREFIX = 'sgnl://linkdevice?';
const MAX_LINK_URI_BYTES = 2048;

export function createSignalLinkSession(deviceLinkUri) {
  if (typeof deviceLinkUri !== 'string'
    || !deviceLinkUri.startsWith(LINK_PREFIX)
    || deviceLinkUri.trim() !== deviceLinkUri
    || /[\u0000-\u001f\u007f]/.test(deviceLinkUri)
    || new TextEncoder().encode(deviceLinkUri).length > MAX_LINK_URI_BYTES) {
    throw new Error('signal-cli повернув некоректне короткочасне посилання прив’язки');
  }
  return { phase: 'waiting', deviceLinkUri };
}

export function clearSignalLinkSession() {
  return { phase: 'idle', deviceLinkUri: null };
}

export function completeSignalLinkSession(account) {
  if (!account || typeof account.id !== 'string' || !account.id.trim()) {
    throw new Error('signal-cli не повернув ідентичність пов’язаного акаунта');
  }
  return { phase: 'complete', deviceLinkUri: null, accountId: account.id };
}
