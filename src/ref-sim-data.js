// Сценарії «Інтерактивної моделі» довідника для статей без окремого переглядача aircraft-viewer.html:
// що вміє кожна модель (фази) і з якими параметрами. Тут лише дані й чисті функції, без three.js:
// їх перевіряють модульні тести, а сцену будує ref-sim.js.

// Фаза: [id, підпис кнопки, що відбувається].
export const SIM_PHASES = {
  plane: [
    ['park', 'Стоянка', 'Літак на стоянці, двигуни вимкнено.'],
    ['taxi', 'Руління', 'Руління смугою на малій швидкості.'],
    ['takeoff', 'Зліт', 'Розбіг, підйом носа, відрив і набір висоти.'],
    ['cruise', 'Політ', 'Горизонтальний політ на висоті.'],
    ['land', 'Посадка', 'Зниження по глісаді, вирівнювання, торкання й пробіг до зупинки.'],
  ],
  heli: [
    ['park', 'Стоянка', 'Гелікоптер на майданчику, гвинти зупинено.'],
    ['start', 'Запуск', 'Запуск двигунів, несний гвинт набирає оберти.'],
    ['hover', 'Висіння', 'Відрив і висіння над майданчиком.'],
    ['cruise', 'Політ', 'Поступальний політ з нахилом на ніс.'],
    ['attack', 'Пуск НАР', 'Захід на ціль і пуск некерованих ракет залпом.'],
    ['land', 'Посадка', 'Гасіння швидкості, зниження й посадка; гвинт зупиняється.'],
  ],
  cruise: [
    ['ready', 'Готовність', 'Ракета перед пуском.'],
    ['launch', 'Пуск', 'Старт і вихід на маршрут.'],
    ['cruise', 'Політ', 'Політ на малій висоті вздовж рельєфу.'],
    ['strike', 'Ураження', 'Гірка над ціллю й пікірування.'],
  ],
  ballistic: [
    ['ready', 'Готовність', 'Ракета перед пуском.'],
    ['launch', 'Пуск', 'Старт під крутим кутом і розгін.'],
    ['cruise', 'Політ', 'Політ балістичною траєкторією.'],
    ['strike', 'Ураження', 'Круте падіння на ціль.'],
  ],
  aam: [
    ['ready', 'Підвіска', 'Ракета на підвісці носія.'],
    ['launch', 'Пуск', 'Сходження з носія й розгін двигуном.'],
    ['cruise', 'Наведення', 'Наведення на повітряну ціль.'],
    ['strike', 'Ураження', 'Підрив біля цілі.'],
  ],
  asm: [
    ['ready', 'Підвіска', 'Ракета на підвісці носія.'],
    ['launch', 'Пуск', 'Сходження з носія й розгін двигуном.'],
    ['cruise', 'Політ', 'Політ до цілі.'],
    ['strike', 'Ураження', 'Пікірування на наземну ціль.'],
  ],
  bomb: [
    ['ready', 'Підвіска', 'Бомба на підвісці носія.'],
    ['drop', 'Скидання', 'Відокремлення від носія.'],
    ['glide', 'Планування', 'Керований політ до цілі.'],
    ['strike', 'Ураження', 'Пікірування на ціль.'],
  ],
  rocket: [
    ['ready', 'У блоці', 'Некерована ракета перед пуском.'],
    ['launch', 'Пуск', 'Пуск і політ некерованої ракети.'],
    ['strike', 'Ураження', 'Влучання в землю.'],
  ],
  launcher: [
    ['park', 'Стоянка', 'Машина на позиції.'],
    ['march', 'Марш', 'Рух ґрунтовою дорогою.'],
    ['fire', 'Пуск', 'Зупинка й пуск залпом.'],
  ],
  vehicle: [
    ['park', 'Стоянка', 'Машина на місці.'],
    ['march', 'Марш', 'Рух ґрунтовою дорогою.'],
    ['rough', 'Бездоріжжя', 'Повільний рух по нерівному ґрунту.'],
  ],
  shell: [
    ['ready', 'Готовність', 'Снаряд перед пострілом.'],
    ['fire', 'Постріл', 'Постріл і політ навісною траєкторією.'],
    ['strike', 'Розрив', 'Падіння й розрив біля цілі.'],
  ],
};

// Техніка, яку веде рушій ref-machine.js (їде по ландшафту, колеса й гусениці, вузли, що працюють): фази ті самі, що в артефактах
// автора моделей. Простіші Sim-фази launcher і vehicle вище лишаються запасним сценарієм, якщо рушій не запустився.
export const MACHINE_PHASES = {
  launcher: [
    ['park', 'Стоянка', 'Машина на позиції, двигун вимкнено.'],
    ['march', 'Марш', 'Рух ґрунтом: колеса чи гусениці крутяться, корпус іде за рельєфом.'],
    ['position', 'Вогнева позиція', 'Пускова піднімається; наводьте її й пускайте ракети, коли вона на місці.'],
    ['stow', 'Згортання', 'Пускова опускається в похідне положення.'],
  ],
  vehicle: [
    ['park', 'Стоянка', 'Машина на місці, двигун вимкнено.'],
    ['march', 'Марш', 'Рух ґрунтом: колеса чи гусениці крутяться, корпус іде за рельєфом.'],
  ],
};

// Рядок стану сцени за фазою; {v} — швидкість у км/год. Вузли (пускова) підставляють свій рядок у фазі «position».
export const STATUS_TEXT = {
  park: 'Стоянка · двигун вимкнено',
  march: 'Марш · {v} км/год',
  position: 'Вогнева позиція · підйом пускової',
  stow: 'Згортання · пускова в похідне',
};

// Тип сценарію для статей ref-data.js. Додаткові параметри:
//   air — пуск з повітря (з висоти носія), а не з землі;
//   rotor.coax — частка висоти моделі між двома співвісними гвинтами; fire — гелікоптер має НАР (є фаза «Пуск НАР»);
//   salvo — скільки ракет у залпі пускової, muzzle — [частка довжини, частка висоти] точки пуску, elev — кут пуску (градуси),
//     back — пакет на моделі дивиться назад (пуск через корму), stowed — пакет на моделі в похідному положенні (пуск умовний);
//   tracks — гусенична машина (менше розгойдування);
//   machine — веде рушій ref-machine.js: rig — які вузли рухаються на машині (ref-machine.js, RIGS), spec — запис LAUNCHERS,
//     wheels / tracked — запис WHEELED чи TRACKED ходової, speed — швидкість маршу (м/с).
const BY_ID = {
  an225: { kind: 'plane', size: 'heavy' },
  an26: { kind: 'plane' },
  ka50: { kind: 'heli', rotor: { coax: .17 }, fire: true },
  ka27: { kind: 'heli', rotor: { coax: .16 } },
  mi26: { kind: 'heli' },
  mi35: { kind: 'heli', fire: true },
  mi8tv: { kind: 'heli', fire: true },
  mi2: { kind: 'heli', fire: true },
  fp5: { kind: 'cruise' },
  fp7: { kind: 'ballistic' },
  himars: { kind: 'launcher', machine: true, rig: 'pods', spec: 'himars', wheels: 'himars', speed: 16, salvo: 6, muzzle: [.06, .97], elev: 55, back: true },
  m270: { kind: 'launcher', machine: true, rig: 'pods', spec: 'm270', tracked: 'm270', speed: 12, salvo: 12, muzzle: [.3, .97], elev: 62, back: true, tracks: true },
  vilkha: { kind: 'launcher', salvo: 4, muzzle: [.3, .95], elev: 52, stowed: true },
  sapsan: { kind: 'launcher', salvo: 1, muzzle: [.2, .95], elev: 80, stowed: true },
  m1084: { kind: 'vehicle' },
  m984: { kind: 'vehicle' },
  bpz2: { kind: 'vehicle', tracks: true },
  'hemtt-pods': { kind: 'vehicle' },
  39: { kind: 'bomb' }, 53: { kind: 'bomb' }, 62: { kind: 'bomb' }, 64: { kind: 'bomb' },
  aasm: { kind: 'bomb', motor: true }, blu140: { kind: 'bomb' }, kab500: { kind: 'bomb' },
  c13: { kind: 'rocket' },
  storm: { kind: 'cruise', air: true },
  atacms: { kind: 'ballistic' }, gmlrs: { kind: 'ballistic' },
  aim120: { kind: 'aam' }, aim9: { kind: 'aam' }, r27: { kind: 'aam' }, r77: { kind: 'aam' },
  agm65: { kind: 'asm' }, agm88: { kind: 'asm', loft: true }, kh29: { kind: 'asm' },
};

// Артилерійський довідник (artillery-ref-data.js): усе, що летить, — снаряд; міни круто, ракети з факелом.
const BY_GROUP = {
  shell: { kind: 'shell', angle: 45 },
  guided: { kind: 'shell', angle: 45, glide: true },
  mortar: { kind: 'shell', angle: 70 },
  rocket: { kind: 'shell', angle: 50, motor: true },
};

// Сценарій статті або null (немає моделі, є власний переглядач або модель нічого не вміє, як метальний заряд).
export function simOf(entry, viewerOf = e => e.viewer) {
  if (!entry || !entry.model || viewerOf(entry)) return null;
  const sim = entry.sim || BY_ID[entry.id] || BY_GROUP[entry.group] || null;
  if (!sim || !SIM_PHASES[sim.kind]) return null;
  if (sim.machine && MACHINE_PHASES[sim.kind]) return { ...sim, phases: MACHINE_PHASES[sim.kind] };
  const phases = SIM_PHASES[sim.kind].filter(([id]) => id !== 'attack' || sim.fire);
  // Пакет моделі не піднімається окремо: пуск із похідного положення показуємо умовно й кажемо про це в підписі.
  const note = sim.stowed ? ' Пакет на моделі в похідному положенні, тож пуск показано умовно.' : '';
  return { ...sim, phases: note ? phases.map(p => (p[0] === 'fire' ? [p[0], p[1], p[2] + note] : p)) : phases };
}

// Простий сценарій тієї самої статті без рушія техніки: якщо рушій не запустився, переглядач показує його.
export function legacySim(cfg) {
  return { ...cfg, machine: false, phases: SIM_PHASES[cfg.kind].filter(([id]) => id !== 'attack' || cfg.fire) };
}

// Місцевість під сценарієм: аеродром, ґрунтова дорога чи поле.
export const terrainOf = kind => (kind === 'plane' || kind === 'heli' ? 'airfield' : kind === 'launcher' || kind === 'vehicle' ? 'road' : 'field');
