// Profiles, backup, updates and Signal live on the launcher (index.html), next
// to the choice of branch. The Air Force module, which shows the dashboard and
// the report intake, runs in a same-origin iframe; these helpers reach into it.

const AIR_FRAME_ID = 'frame-air';

/** The window hosting the Air Force module: this one, or the launcher's iframe. */
export function airWindow() {
  if (window.__AV) return window;
  try {
    return document.getElementById(AIR_FRAME_ID)?.contentWindow ?? null;
  } catch {
    return null;
  }
}

export function airDashboard() {
  return airWindow()?.__AV ?? null;
}

async function pollAirDashboard(attempts = 150) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const dashboard = airDashboard();
    if (dashboard?.connect) return dashboard;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return null;
}

/**
 * Resolves with the Air Force dashboard once the module is ready. With `open`
 * the launcher switches to the module first; otherwise this waits until the
 * user opens it. Resolves null if the module does not become ready.
 */
export function whenAirDashboard({ open = false } = {}) {
  const launcher = window.EW_LAUNCHER;
  // Show the module even when it is already loaded behind the start screen.
  if (open) launcher?.openBranch('air');
  const ready = airDashboard();
  if (ready?.connect) return Promise.resolve(ready);
  if (!launcher || launcher.isLoaded('air')) return pollAirDashboard();
  return new Promise(resolve => {
    const onOpen = event => {
      if (event.detail?.branch !== 'air') return;
      window.removeEventListener('ew:branch-open', onOpen);
      pollAirDashboard().then(resolve);
    };
    window.addEventListener('ew:branch-open', onOpen);
  });
}

let pendingAirWork = Promise.resolve();

/**
 * Registers work that prepares the Air Force module (the profile's table, its
 * workspace template), so a later action there can wait for it to finish.
 */
export function trackAirWork(work) {
  pendingAirWork = Promise.allSettled([pendingAirWork, work]);
  return work;
}

/** Resolves once every tracked preparation of the module has finished. */
export function airWorkSettled() {
  return pendingAirWork;
}
