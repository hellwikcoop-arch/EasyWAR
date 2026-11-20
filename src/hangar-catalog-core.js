// Зіставлення старих довідників техніки з ангаром і гаражем (hangar/EasyWAR_hangar.html).
// Ідентифікатори статей ref-data.js не змінюються: таблиця вильотів, пошук і «У вашій базі»
// як і раніше знаходять засіб за назвою. Тут лише адреса 3D-сцени, якщо для статті є модель.

export const HANGAR_FILE = 'hangar/EasyWAR_hangar.html';

// mode збігається з хешем сторінки: hangar | garage | enemy | enemy-air.
// id — ключ літака (setAircraft) або машини (GAR.set). cat — фільтр гаража.
export const REF_HANGAR = {
  mig29: { mode: 'hangar', id: 'mig' },
  su27: { mode: 'hangar', id: 'su' },
  f16: { mode: 'hangar', id: 'f16' },
  mirage: { mode: 'hangar', id: 'm2k' },
  su25: { mode: 'hangar', id: 'su25' },
  su24: { mode: 'hangar', id: 'su24' },
  gripen: { mode: 'hangar', id: 'gripen' },
  mi24: { mode: 'hangar', id: 'mi24' },
  mi8: { mode: 'hangar', id: 'mi8' },
  il76: { mode: 'hangar', id: 'il' },
  ka52: { mode: 'enemy-air', id: 'ka52' },
  mi35: { mode: 'enemy-air', id: 'emi35' },
  mi8tv: { mode: 'enemy-air', id: 'emi8', note: 'У вкладці «Ворог» стоїть Мі-8АМТШ, не Мі-8ТВ.' },
  himars: { mode: 'garage', id: 'himars', cat: 'art' },
  m270: { mode: 'garage', id: 'm270', cat: 'art' },
  vilkha: { mode: 'garage', id: 'vilkha', cat: 'art' },
  sapsan: { mode: 'garage', id: 'sapsan', cat: 'art' },
  m1084: { mode: 'garage', id: 'm1084', cat: 'eng' },
  m984: { mode: 'garage', id: 'm984', cat: 'eng' },
  bpz2: { mode: 'garage', id: 'berge', cat: 'eng' },
  'hemtt-pods': { mode: 'garage', id: 'hemttlhs', cat: 'eng', note: 'Пакетовоз із причепом відкриває HEMTT LHS на тому самому шасі.' },
};

export const hangarTarget = (id) => REF_HANGAR[id] || null;

// Картки хаба easyWIKI. base у hangarHref — './' зі сторінки модуля або '../' з guides/index.html.
export const HUB_LINKS = [
  { title: 'Ангар · авіація ПС', count: 'Літаки й вертольоти', note: 'МіГ-29, Су-27, F-16, Mirage 2000, Су-24, Су-25, Gripen, Мі-24, Мі-8, Іл-76.', mode: 'hangar' },
  { title: 'Гараж · танки', count: 'Наземна техніка', note: 'Т-64, Т-72, Т-80, Т-84, PT-91, Leopard 1 і 2, Challenger 2, Abrams.', mode: 'garage', cat: 'tank' },
  { title: 'Гараж · ББМ і БТР', count: 'Наземна техніка', note: 'БМП, БТР, Bradley, Marder, CV90, Stryker, Козак, HMMWV.', mode: 'garage', cat: 'ifv' },
  { title: 'Гараж · артилерія і РСЗВ', count: 'Наземна техніка', note: 'САУ, гаубиці, БМ-21, Ураган, Смерч, HIMARS, M270, «Вільха», «Сапсан».', mode: 'garage', cat: 'art' },
  { title: 'Гараж · ППО', count: 'Наземна техніка', note: 'Patriot, SAMP/T, IRIS-T, NASAMS, С-300, Бук, Gepard, ЗУ-23-2.', mode: 'garage', cat: 'ad' },
  { title: 'Гараж · вантажні й інженерні', count: 'Наземна техніка', note: 'KrAZ, HEMTT, FMTV, БРЕМ, мостоукладачі, УР-77.', mode: 'garage', cat: 'eng' },
  { title: 'Ворог · наземна техніка', count: 'Розпізнавання', note: 'Танки, ББМ, артилерія, ППО й інженерні машини ЗС РФ.', mode: 'enemy' },
  { title: 'Ворог · авіація', count: 'Розпізнавання', note: 'Су-24/25/27/30/34/35, МіГ-31, Ту-22, Ту-95, Ту-160, А-50, Іл-76, Ка-52, Мі-28, Мі-8, Мі-35.', mode: 'enemy-air' },
];

const MODES = new Set(['hangar', 'garage', 'enemy', 'enemy-air']);

export function hangarHref(target, base = './') {
  if (!target || !MODES.has(target.mode)) throw new Error('невідомий режим ангара');
  const q = new URLSearchParams();
  if (target.id) q.set('v', target.id);
  if (target.cat) q.set('cat', target.cat);
  const qs = q.toString();
  return `${base}${HANGAR_FILE}${qs ? `?${qs}` : ''}#${target.mode}`;
}

// Статті техніки, для яких у ангарі немає моделі: лишається попередній переглядач.
export const UNMAPPED_EQUIPMENT = [
  { id: 'an225', why: 'Ан-225 прибрано з ангара на прохання власника каталогу.' },
  { id: 'ka50', why: 'У вкладці «Ворог · авіація» немає Ка-50.' },
  { id: 'ka27', why: 'У вкладці «Ворог · авіація» немає Ка-27.' },
  { id: 'mi26', why: 'У вкладці «Ворог · авіація» немає Мі-26.' },
  { id: 'mi2', why: 'У вкладці «Ворог · авіація» немає Мі-2.' },
  { id: 'an26', why: 'У вкладці «Ворог · авіація» немає Ан-26.' },
  { id: 'fp5', why: 'FP-5 «Фламінго» — крилата ракета, не літак ангара.' },
  { id: 'fp7', why: 'FP-7 — балістична ракета, не літак ангара.' },
];

// Сторінки src/guides, які більше не входять у збірку: хаб веде в ангар.
export const RETIRED_GUIDE_IDS = ['rvia', 'ppo', 'ground-forces', 'aviation', 'enemy-ground'];

// Моделі старих 3D-довідників, яким немає пари в ангарі чи гаражі.
export const UNMAPPED_GUIDE = [
  { guide: 'РВіА', name: 'Точка-У, Бастіон-01, М-10, Гіацинт-Б, FH-70, M198', why: 'окремих моделей у гаражі немає; Сапсан, Ураган, CAESAR, Богдана, Д-30 і «Вільха» є.' },
  { guide: 'ППО', name: 'Sky Sabre, ЗСУ-23-4 «Шилка», 2К12 «Куб», Nomads', why: 'у гаражі є Patriot, SAMP/T, IRIS-T, NASAMS, С-300, Бук, Gepard і ЗУ-23-2, але не ці чотири.' },
  { guide: 'Сухопутні війська', name: 'Boxer, Goliath і набір історичних танків pk_*', why: 'Sherman, Patton, Т-34, Т-55, Centurion, Type 99, EE-9 та інші моделі набору в гараж не переносились; сучасні танки й ББМ ЗСУ є окремими експонатами.' },
  { guide: 'Ворожа авіація', name: 'Ка-50, Ка-27, Мі-26, Мі-2, Ан-26, Ан-225, FP-5, FP-7', why: 'немає у вкладці «Ворог · авіація»; статті довідника ПС лишають попередню модель.' },
  { guide: 'Ворожа наземна техніка', name: 'станція «Бук-М3», С-300В, 96Л6Е, станції розвідки', why: 'окремих моделей немає; пускові Бук, С-400, Оса, Іскандер, Панцирь, Тунгуска, БТР-82А і МТ-ЛБ є у вкладці «Ворог».' },
  { guide: 'БпАК', name: 'Bayraktar TB2, Duck, Skyfall, SH-60B', why: 'у ангарі цих моделей немає, тож картка БпАК лишається на попередньому довіднику.' },
];
