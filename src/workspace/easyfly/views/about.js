// «Про застосунок»: що це за модуль і ліцензія вбудованого шрифту. Мережі немає.
import { el } from '../ui.js';

export function render() {
  return el('div', { class: 'ef-view ef-about' },
    el('header', { class: 'ef-today-head' }, el('h1', { text: 'Про застосунок' })),
    el('section', { class: 'ef-glow-card ef-about-card' },
      el('p', { class: 'ef-about-name', text: 'EasyFLY' }),
      el('p', { text: 'Облік строків, льотної зміни й штурманських документів. Модуль EasyWAR для телефона і робочого столу.' }),
      el('p', {}, el('strong', { text: 'Працює без мережі. ' }), 'На телефоні дані зашифровано парольною фразою; файл .easyfly — копія для перенесення.'),
      el('p', {}, el('strong', { text: 'Довідкові розрахунки. ' }), 'Калькулятори штурмана не замінюють керівних документів і паперової льотної книжки. Затвердження в застосунку немає.')),
    el('section', { class: 'ef-glow-card ef-about-card' },
      el('h2', { text: 'Ліцензії та автори' }),
      el('p', {}, el('strong', { text: 'Шрифт Manrope' })),
      el('p', { class: 'ef-glow-quiet', text: 'Copyright 2018 The Manrope Project Authors. SIL Open Font License 1.1. Шрифт вбудовано в застосунок (латиниця й кирилиця, накреслення 300–600) і не завантажується з мережі. Повний текст ліцензії — у файлі fonts/OFL.txt поруч зі шрифтом.' }),
      el('p', { class: 'ef-glow-quiet', text: 'Погоду з мережі цей модуль не запитує: вітер у калькулятор вводять вручну.' })));
}