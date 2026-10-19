// Сторінка EasySlide: ставить міст до файлів EasyWAR і запускає редактор (веб-збірка DeckCraft з ./vendor/).
// Модуль «Робоче середовище» → «Офіс» відкриває її в кадрі. WASM лежить у збірці, мережа не потрібна.
import { createEasySlideHost, findInvoke } from './host-core.js';
import initEditor from './vendor/deckcraft-web.js';
import wasmUrl from './vendor/deckcraft-web_bg.wasm?url';

const status = document.getElementById('easyslide_status');
let hideTimer = 0;
const notify = (text) => {
  status.textContent = text;
  status.hidden = false;
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { status.hidden = true; }, 6000);
};

const host = createEasySlideHost(findInvoke(window), notify);
if (host) window.easyslideHost = host;

try {
  await initEditor({ module_or_path: wasmUrl });
} catch (error) {
  document.getElementById('deckcraft_loading').textContent = `EasySlide не запустився: ${error}. Потрібна підтримка WebGPU або WebGL2.`;
}
