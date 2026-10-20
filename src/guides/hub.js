// Хаб easyWIKI (довідники): картки довідників і підсумок походження моделей. Кількість і назви моделей беруться з credits.js,
// тож хаб не розходиться з довідниками. Сторінка працює без мережі.
import {CREDITS, KINDS} from './credits.js';
import {BRIGADES} from './brigades/brigades-data.js';

const GUIDES = [
  {id: 'rvia', title: 'РВіА та артилерія', note: 'Ракетні комплекси, РСЗВ, САУ й гаубиці: марш, вогнева позиція, підйом пускової, постріл і перезаряджання.'},
  {id: 'ppo', title: 'ППО', note: 'ЗРК і ЗСУ: марш, фази, винос РЛС, пуск ракет, дим і пил.'},
  {id: 'ground-forces', title: 'Сухопутні війська', note: 'Броньована й автомобільна техніка та набір танків: гусениці, колеса, башта, ствол.'},
  {id: 'uav', title: 'БпАК і вертоліт', note: 'Bayraktar TB2, tailsitter-дрони й SH-60B у польоті над ландшафтом.'},
  {id: 'aviation', title: 'Ворожа авіація', note: 'Гелікоптери, літаки й ракети противника: ознаки розпізнавання, ТТХ, уразливі місця, рухомі вузли, політ по колу.'},
  {id: 'enemy-ground', title: 'Ворожа наземна техніка', note: 'ЗРК, станції та бронетехніка противника в русі: марш, фази, розгортання, пуск ракет, вузли й характеристики.'},
];
const SHOWN = 7;

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

const entries = Object.entries(CREDITS);
const cards = document.getElementById('cards');
for (const guide of GUIDES) {
  const models = entries.filter(([key]) => key.startsWith(guide.id + '/')).map(([, value]) => value);
  const card = el('a', 'card');
  card.href = `./${guide.id}/index.html`;
  card.append(el('h2', '', guide.title), el('p', 'count', `${models.length} ${plural(models.length, 'модель', 'моделі', 'моделей')}`), el('p', 'note', guide.note));
  const names = el('ul');
  models.slice(0, SHOWN).forEach((m) => names.append(el('li', '', m.name)));
  if (models.length > SHOWN) names.append(el('li', '', `ще ${models.length - SHOWN}`));
  card.append(names);
  cards.append(card);
}

// Довідник бригад не має 3D-моделей, тому окрема картка поза списком GUIDES.
const brigades = el('a', 'card');
brigades.href = './brigades/index.html';
brigades.append(el('h2', '', 'Довідник бригад'), el('p', 'count', `${BRIGADES.length} ${plural(BRIGADES.length, 'частина', 'частини', 'частин')}`), el('p', 'note', 'Емблеми, назви, тип частини, рід військ і призначення. Пошук за номером чи назвою.'));
cards.append(brigades);

const legend = document.getElementById('legend');
for (const [kind, label] of Object.entries(KINDS)) {
  const n = entries.filter(([, value]) => value.kind === kind).length;
  if (!n) continue;
  const row = el('li');
  row.append(el('b', '', String(n)), el('span', '', label));
  legend.append(row);
}

// Поза накладкою застосунку (окрема вкладка) потрібне посилання назад.
if (window.top === window.self) document.getElementById('back').hidden = false;
