// A typed, in-memory view of what the existing updater has already learned.
// Reading this state cannot start an update check or install.
const VERSION = /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/u;
const STATES = new Set(['unchecked', 'checking', 'available', 'current', 'unconfigured', 'error', 'installing']);

export function createAppUpdateState() {
  let snapshot = Object.freeze({ status: 'unchecked' });
  const listeners = new Set();
  return {
    getSnapshot() { return snapshot; },
    publish(value) {
      const status = STATES.has(value?.status) ? value.status : 'unchecked';
      const next = { status };
      if (VERSION.test(value?.currentVersion || '')) next.currentVersion = value.currentVersion;
      if (status === 'available' && VERSION.test(value?.availableVersion || '')) next.availableVersion = value.availableVersion;
      if (status === 'available' && !next.availableVersion) next.status = 'error';
      snapshot = Object.freeze(next);
      for (const listener of listeners) listener(snapshot);
      return snapshot;
    },
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('Listener must be a function');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const appUpdateState = createAppUpdateState();
