// Profiles, backup, updates and Signal live on the launcher (index.html), next
// to the choice of branch. Each branch module (Air Force, Rocket Forces and
// Artillery) runs in its own same-origin iframe; these helpers reach into it.

export const BRANCHES = ['air', 'rocket'];

const FRAME_IDS = { air: 'frame-air', rocket: 'frame-rocket' };

/** The window hosting a branch module (the launcher's iframe), or null. */
export function moduleWindow(branch) {
  try {
    return document.getElementById(FRAME_IDS[branch])?.contentWindow ?? null;
  } catch {
    return null;
  }
}

export function moduleDashboard(branch) {
  return moduleWindow(branch)?.__AV ?? null;
}

async function pollModuleDashboard(branch, attempts = 150) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const dashboard = moduleDashboard(branch);
    if (dashboard?.connect) return dashboard;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return null;
}

/**
 * Resolves with a branch module's dashboard once it is ready. With `open` the
 * launcher switches to the module first; otherwise this waits until the user
 * opens it. Resolves null if the module does not become ready.
 */
export function whenModuleDashboard(branch, { open = false } = {}) {
  const launcher = window.EW_LAUNCHER;
  // Show the module even when it is already loaded behind the start screen.
  if (open) launcher?.openBranch(branch);
  const ready = moduleDashboard(branch);
  if (ready?.connect) return Promise.resolve(ready);
  if (!launcher || launcher.isLoaded(branch)) return pollModuleDashboard(branch);
  return new Promise(resolve => {
    const onOpen = event => {
      if (event.detail?.branch !== branch) return;
      window.removeEventListener('ew:branch-open', onOpen);
      pollModuleDashboard(branch).then(resolve);
    };
    window.addEventListener('ew:branch-open', onOpen);
  });
}

const pendingWork = Object.fromEntries(BRANCHES.map(branch => [branch, Promise.resolve()]));

/**
 * Registers work that prepares a branch module (the profile's table, its
 * workspace template), so a later action there can wait for it to finish.
 */
export function trackModuleWork(branch, work) {
  pendingWork[branch] = Promise.allSettled([pendingWork[branch], work]);
  return work;
}

/** Resolves once every tracked preparation of the module has finished. */
export function moduleWorkSettled(branch) {
  return pendingWork[branch];
}

// The Air Force module also takes Signal reports for review.
export const airWindow = () => moduleWindow('air');
export const airDashboard = () => moduleDashboard('air');
export const whenAirDashboard = options => whenModuleDashboard('air', options);
export const trackAirWork = work => trackModuleWork('air', work);
export const airWorkSettled = () => moduleWorkSettled('air');
