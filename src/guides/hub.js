// Хаб easyWIKI: картки ангара й гаража, довідник БпАК (його в ангарі немає) і довідник бригад.
// Сторінка працює без мережі. Старі 3D-довідники техніки звідси більше не відкриваються.
import { HUB_LINKS, hangarHref } from '../hangar-catalog-core.js';
import { BRIGADES } from './brigades/brigades-data.js';

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const plural = (n, one, few, many) => {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};

const cards = document.getElementById('cards');
for (const link of HUB_LINKS) {
  const card = el('a', 'card');
  card.href = hangarHref(link, '../');
  card.append(el('h2', '', link.title), el('p', 'count', link.count), el('p', 'note', link.note));
  cards.append(card);
}

const uav = el('a', 'card');
uav.href = './uav/index.html';
uav.append(el('h2', '', 'БпАК'), el('p', 'count', 'Окремий довідник'), el('p', 'note', 'Bayraktar TB2, tailsitter-дрони й SH-60B. У ангарі цих моделей немає.'));
cards.append(uav);

const brigades = el('a', 'card');
brigades.href = './brigades/index.html';
brigades.append(el('h2', '', 'Довідник бригад'), el('p', 'count', `${BRIGADES.length} ${plural(BRIGADES.length, 'частина', 'частини', 'частин')}`), el('p', 'note', 'Емблеми, назви, тип частини, рід військ і призначення. Пошук за номером чи назвою.'));
cards.append(brigades);

if (window.top === window.self) document.getElementById('back').hidden = false;
