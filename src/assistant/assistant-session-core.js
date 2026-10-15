// Session-only opt-in: no persistence, timers, commands or operational data.
export function createAssistantSession() {
  let profileId = null;
  let enabled = false;
  let revision = 0;
  const state = () => ({ profileId, enabled, revision });
  return {
    state,
    setProfile(id) {
      const next = typeof id === 'string' && id ? id : null;
      if (next !== profileId) { profileId = next; enabled = false; revision++; }
      return state();
    },
    setEnabled(value) {
      const next = Boolean(profileId && value === true);
      if (next !== enabled) { enabled = next; revision++; }
      return state();
    },
    invalidate() { revision++; return state(); },
    token() { return { profileId, revision }; },
    accepts(token) { return enabled && Boolean(profileId) && token?.profileId === profileId && token?.revision === revision; },
    reset() { profileId = null; enabled = false; revision++; return state(); },
  };
}
