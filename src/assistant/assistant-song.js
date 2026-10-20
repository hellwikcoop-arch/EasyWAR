// Пасхалка КОМБАТа: одна локальна пісня без відео. Контролер не залежить від DOM: `createAudio` підміняється
// в тестах. Файл лежить у збірці застосунку, мережі й сховищ немає; стан живе лише в пам'яті вікна.
export const SONG_VOLUME = 0.7;

export const SONG_LABELS = Object.freeze({
  idle: 'Увімкнути пісню',
  playing: 'Зупинити пісню',
  blocked: 'Увімкнути пісню',
  failed: 'Пісня недоступна',
});

export const songButtonText = state => SONG_LABELS[state] ?? SONG_LABELS.idle;

/**
 * Стани: `idle` — не грає; `playing` — грає; `blocked` — система не дозволила автозапуск (кнопка запустить за
 * кліком користувача); `failed` — файл не відтворюється в цьому вікні (немає декодера чи пошкоджений).
 */
export function createSongPlayer({ url, createAudio = source => new Audio(source), volume = SONG_VOLUME } = {}) {
  let audio = null;
  let state = 'idle';
  const listeners = new Set();

  function set(next) {
    if (state === next) return;
    state = next;
    for (const listener of [...listeners]) listener(state);
  }

  function ensure() {
    if (audio) return audio;
    const element = createAudio(url);
    element.preload = 'auto';
    element.volume = volume;
    // Закінчилась, зупинена нами чи системою (медіа-клавіша): у всіх випадках кнопка знову пропонує «Увімкнути».
    element.addEventListener('ended', () => set('idle'));
    // Подія pause приходить із запізненням: якщо за цей час пісню вже запустили знову, вона не вважається зупиненою.
    element.addEventListener('pause', () => { if (element.paused) set('idle'); });
    element.addEventListener('error', () => { if (audio === element) audio = null; set('failed'); });
    audio = element;
    return element;
  }

  async function play() {
    const element = ensure();
    try { element.currentTime = 0; } catch { /* перемотка до початку необов'язкова */ }
    set('playing');
    try {
      await element.play();
      return state;
    } catch (error) {
      // stop() під час очікування скасовує запуск (AbortError) — це не збій.
      if (state !== 'playing' || audio !== element) return state;
      set(error?.name === 'NotAllowedError' ? 'blocked' : 'failed');
      return state;
    }
  }

  function stop() {
    if (audio) {
      try { audio.pause(); audio.currentTime = 0; } catch { /* вже зупинено */ }
    }
    set('idle');
  }

  return {
    play,
    stop,
    state: () => state,
    isPlaying: () => state === 'playing',
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    dispose() { stop(); audio = null; listeners.clear(); },
  };
}
