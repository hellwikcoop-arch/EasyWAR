// One local clip at a time; no animation, asset preload or timer until play().
export function createAssistantMotion({
  image,
  staticURL,
  clips = {},
  mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)'),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  if (!image || typeof image !== 'object') throw new TypeError('An image is required');
  let timer = null;
  let generation = 0;
  let disposed = false;

  function stop() {
    generation++;
    if (timer !== null) { clearTimer(timer); timer = null; }
    image.src = staticURL;
    if (typeof image.removeAttribute === 'function') image.removeAttribute('data-gesture');
  }

  function play(id) {
    if (disposed) return false;
    stop();
    const clip = typeof id === 'string' && Object.prototype.hasOwnProperty.call(clips, id) ? clips[id] : null;
    if (mediaQuery?.matches || !clip || typeof clip.url !== 'string' || !clip.url ||
      !Number.isFinite(clip.durationMs) || clip.durationMs <= 0 || clip.durationMs > 2147483647) return false;
    const current = generation;
    // The fragment stays local and resetting to the still image restarts cached clips.
    image.src = `${clip.url.split('#')[0]}#ew-motion-${current}`;
    if (typeof image.setAttribute === 'function') image.setAttribute('data-gesture', id);
    timer = setTimer(() => {
      if (!disposed && current === generation) stop();
    }, clip.durationMs);
    return true;
  }

  function preferenceChanged(event) {
    if (event?.matches === true || mediaQuery?.matches) stop();
  }

  let listenerKind = null;
  if (typeof mediaQuery?.addEventListener === 'function') {
    mediaQuery.addEventListener('change', preferenceChanged);
    listenerKind = 'event';
  } else if (typeof mediaQuery?.addListener === 'function') {
    mediaQuery.addListener(preferenceChanged);
    listenerKind = 'legacy';
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    stop();
    if (listenerKind === 'event' && typeof mediaQuery.removeEventListener === 'function') {
      mediaQuery.removeEventListener('change', preferenceChanged);
    } else if (listenerKind === 'legacy' && typeof mediaQuery.removeListener === 'function') {
      mediaQuery.removeListener(preferenceChanged);
    }
  }

  return { play, stop, dispose };
}
