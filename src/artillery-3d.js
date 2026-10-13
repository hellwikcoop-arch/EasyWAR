// Умовні тривимірні моделі артилерійських боєприпасів для довідника модуля «Артилерія»:
// снаряди ствольної артилерії, міномета міна, реактивний снаряд, високоточний снаряд і модульний метальний заряд.
// Складено з тіл обертання за відкритими габаритами (довжина всіх моделей нормована до 4 одиниць, ніс — у +X), корпус
// розфарбовано на канві: фарба, трафарети, потертості. Це схема для перегляду, а не креслення для впізнавання чи розрахунків.
// Інтерфейс як у munition-3d.js: buildShell(kind) повертає { group, wings, explode, labels }, тож RefViewer показує їх так само.
// Окремі типи 155 мм (M107, M795, M549A1, M483A1, M864, M718, M692, M110, M825, M485A2, M712, SMArt, BONUS, M454) і заряди
// (M3A1, M4A2, M119A2, M203A1, BMCS) мають власну довжину, оживало, дно й підривник за габаритами з каталогу bk155.com.ua та
// відкритих джерел; усе, що всередині (суббоєприпаси, міни, світильний баласт), видно у розкладеному вигляді.
import { CylinderGeometry, Group, Mesh, Object3D, SphereGeometry, TorusGeometry } from 'three';
import { Skin, at, castShadows, finSet, lathe, paint, plate, rod, sample, skin } from './munition-3d.js';

const COL = {
  olive: '#4b5329', oliveDk: '#3b4220', yellow: '#d8b21a', copper: '#b8733a', steel: '#8d9299', steelDk: '#5b6066', white: '#d8d5c8',
  paleGreen: '#8fa184', grey: '#757b81', greyDk: '#4a4f54', black: '#202327', red: '#a8382c', cloth: '#d2cbb2', sand: '#b9a77c',
};
const L = 4, H = L / 2;
const R155 = mm => Math.round(310 / mm * 1000) / 1000;      // радіус при довжині моделі 4 для калібру 155 мм й повної довжини mm
const RC = (cal, mm) => Math.round(2 * cal / mm * 1000) / 1000; // те саме для довільного калібру cal (мм)
const smooth = t => { const c = Math.min(Math.max(t, 0), 1); return c * c * (3 - 2 * c); };
const metal = (color, rough = .38, m = .7) => paint(color, rough, m);
const matte = (color, rough = .6, m = .08) => paint(color, rough, m);

// ---------------------------------------------------------------- снаряди ствольної артилерії
// r — радіус корпусу при довжині 4 (співвідношення довжина/калібр), bt — довжина конічного дна, base — радіус дна в частках r,
// og — довжина оживальної головної частини, fz — довжина підривника. rings — кольорові пояси [x0, x1, колір], text — трафарети.
const SHELLS = {
  'shell-155-he': { r: .4, bt: .28, base: .88, og: 1.6, fz: .3, body: COL.olive, rings: [[.55, .67, COL.yellow], [.7, .76, COL.yellow]], ink: COL.yellow, fuze: 'contact', text: ['155 mm', 'HE'], lot: 'LOT 00-000', explode: ['Підривник', 'Корпус із вибухівкою', 'Дно'] },
  'shell-155-cluster': { r: .4, off: .38, bt: .2, base: .9, og: 1.10, fz: .3, body: COL.olive, rings: [[.5, .62, COL.yellow], [.67, .73, COL.red]], ink: COL.yellow, fuze: 'time', bleed: true, text: ['155 mm', 'DPICM'], lot: 'LOT 00-000', explode: ['Підривник', 'Корпус із суббоєприпасами', 'Донний газогенератор'] },
  'shell-155-scatter': { r: .4, bt: .28, base: .88, og: 1.10, fz: .3, body: COL.olive, rings: [[.5, .62, COL.yellow], [.67, .73, COL.sand]], ink: COL.yellow, fuze: 'time', text: ['155 mm', 'MINE'], lot: 'LOT 00-000', explode: ['Підривник', 'Корпус із мінами', 'Дно'] },
  'shell-155-smoke': { r: .4, bt: .28, base: .88, og: 1.15, fz: .3, body: COL.paleGreen, rings: [[.55, .67, COL.white]], ink: '#2a2f26', fuze: 'time', text: ['155 mm', 'SMOKE'], lot: 'LOT 00-000', explode: ['Підривник', 'Корпус із димовим складом', 'Дно'] },
  'shell-155-illum': { r: .4, bt: .28, base: .88, og: 1.15, fz: .3, body: COL.white, rings: [[.55, .67, COL.oliveDk]], ink: COL.oliveDk, fuze: 'time', text: ['155 mm', 'ILLUM'], lot: 'LOT 00-000', explode: ['Підривник', 'Корпус зі світильним складом і парашутом', 'Дно'] },
  'shell-152': { r: .39, bt: .22, base: .9, og: 1.15, fz: .3, body: COL.greyDk, rings: [[.52, .66, COL.red]], ink: COL.white, fuze: 'contact', text: ['152', 'ОФ'], lot: '№ 00-00', explode: ['Підривник', 'Корпус із вибухівкою', 'Дно'] },
  'shell-122': { r: .37, bt: .2, base: .9, og: 1.10, fz: .28, body: COL.greyDk, rings: [[.5, .62, COL.red]], ink: COL.white, fuze: 'contact', text: ['122', 'ОФ'], lot: '№ 00-00', explode: ['Підривник', 'Корпус із вибухівкою', 'Дно'] },
  'shell-105': { r: .43, bt: .32, base: .86, og: 1.05, fz: .28, body: COL.olive, rings: [[.5, .62, COL.yellow]], ink: COL.yellow, fuze: 'contact', text: ['105 mm', 'HE'], lot: 'LOT 00-000', explode: ['Підривник', 'Корпус із вибухівкою', 'Дно'] },
  'shell-203': { r: .4, bt: .25, base: .9, og: 1.20, fz: .32, body: COL.olive, rings: [[.55, .67, COL.yellow], [.7, .76, COL.yellow]], ink: COL.yellow, fuze: 'contact', text: ['203 mm', 'HE'], lot: 'LOT 00-000', explode: ['Підривник', 'Корпус із вибухівкою', 'Дно'] },
  'shell-other': { r: .4, bt: .25, base: .9, og: 1.15, fz: .3, body: COL.greyDk, rings: [[.52, .64, COL.yellow]], ink: COL.white, fuze: 'contact', text: ['HE'], lot: '№ 00-00', explode: ['Підривник', 'Корпус із вибухівкою', 'Дно'] },
  // Окремі типи 155 мм. r = R155(повна довжина, мм): радіус при нормованій довжині 4. tip — радіус носа в частках r.
  // obt — пластиковий обтюратор за провідним поясом; bleed/off — донний газогенератор; rap — ракетний двигун у дні;
  // ej — донна плита, що викидається (снаряди з викиданням корисного навантаження через дно); payload — що всередині.
  'shell-m107': { r: R155(700), bt: .2, base: .94, og: 1.5, tip: .24, fz: .3, body: COL.olive, rings: [[.55, .67, COL.yellow]], ink: COL.yellow, fuze: 'contact', text: ['155 mm', 'HE M107'], lot: 'LOT 00-000', explode: ['Підривник (гніздо за STANAG 2916)', 'Корпус із вибухівкою', 'Дно'] },
  'shell-m795': { r: R155(843), bt: .24, base: .92, og: 2.3, tip: .17, fz: .3, obt: true, body: COL.olive, rings: [[.55, .67, COL.yellow]], ink: COL.yellow, fuze: 'contact', text: ['155 mm', 'HE M795'], lot: 'LOT 00-000', explode: ['Підривник', 'Сталевий корпус HF-1 із вибухівкою', 'Дно'] },
  'shell-m549a1': { r: R155(910), bt: .08, base: .99, og: 1.9, tip: .2, fz: .3, rap: true, body: COL.olive, rings: [[.55, .67, COL.yellow], [.72, .78, COL.yellow]], ink: COL.yellow, fuze: 'contact', text: ['155 mm', 'HE RAP'], lot: 'LOT 00-000', explode: ['Підривник', 'Корпус із вибухівкою й ракетним двигуном', 'Дно із соплами'] },
  'shell-erfb-bb': { r: R155(910), off: .2, bt: .3, base: .86, og: 2.2, tip: .18, fz: .3, bleed: true, obt: true, body: COL.oliveDk, rings: [[.55, .62, COL.sand]], ink: '#d6d9c4', fuze: 'contact', text: ['155 mm', 'HE-BB'], lot: 'LOT 00-000', explode: ['Підривник', 'Корпус із вибухівкою', 'Донний газогенератор'] },
  'shell-dm121': { r: R155(841), bt: .5, base: .78, og: 2.3, tip: .18, fz: .3, obt: true, body: COL.olive, rings: [[.55, .62, COL.yellow]], ink: COL.yellow, fuze: 'contact', text: ['155 mm', 'DM121'], lot: 'LOT 00-000', explode: ['Підривник', 'Корпус із вибухівкою', 'Конічне дно'] },
  'shell-m483a1': { r: R155(893), bt: .22, base: .95, og: 1.15, tip: .2, fz: .5, fuze: 'mt', body: COL.olive, rings: [[.5, .62, COL.yellow], [.67, .73, COL.red]], ink: COL.yellow, text: ['155 mm', 'DPICM M483A1'], lot: 'LOT 00-000', payload: { kind: 'grenades', n: 28 }, explode: ['Часовий підривник', 'Корпус із 88 суббоєприпасами', 'Донна плита'] },
  'shell-m864': { r: R155(920), off: .22, bt: .3, base: .9, og: 1.2, tip: .2, fz: .5, fuze: 'mt', bleed: true, body: COL.olive, rings: [[.5, .62, COL.yellow], [.67, .73, COL.red]], ink: COL.yellow, text: ['155 mm', 'DPICM M864'], lot: 'LOT 00-000', payload: { kind: 'grenades', n: 21 }, explode: ['Часовий підривник', 'Корпус із 72 суббоєприпасами', 'Донний газогенератор'] },
  'shell-m718': { r: R155(905), bt: .26, base: .92, og: 1.1, tip: .2, fz: .5, fuze: 'mt', body: COL.olive, rings: [[.5, .62, COL.yellow], [.67, .73, COL.sand]], ink: COL.yellow, text: ['155 mm', 'RAAM M718'], lot: 'LOT 00-000', payload: { kind: 'mines-at' }, explode: ['Часовий підривник', 'Корпус із 9 протитанковими мінами', 'Донна плита'] },
  'shell-m692': { r: R155(935), bt: .26, base: .92, og: 1.15, tip: .2, fz: .5, fuze: 'mt', body: COL.olive, rings: [[.5, .62, COL.yellow], [.67, .73, COL.sand]], ink: COL.yellow, text: ['155 mm', 'ADAM M692'], lot: 'LOT 00-000', payload: { kind: 'mines-ap' }, explode: ['Часовий підривник', 'Корпус із 36 протипіхотними мінами', 'Донна плита'] },
  'shell-m110': { r: R155(725), bt: .26, base: .9, og: 1.0, tip: .22, fz: .3, body: COL.paleGreen, rings: [[.55, .67, COL.yellow]], ink: '#2a2f26', fuze: 'contact', text: ['155 mm', 'WP M110'], lot: 'LOT 00-000', explode: ['Підривник', 'Корпус із білим фосфором і розривним зарядом', 'Дно'] },
  'shell-m825': { r: R155(899), ej: .24, bt: .28, base: .9, og: 1.2, tip: .2, fz: .5, fuze: 'mt', body: COL.paleGreen, rings: [[.55, .67, COL.white]], ink: '#2a2f26', text: ['155 mm', 'WP M825'], lot: 'LOT 00-000', payload: { kind: 'wp', n: 35 }, explode: ['Часовий підривник', 'Корпус зі 116 елементами білого фосфору', 'Донна плита (викидається)'] },
  'shell-m485': { r: R155(684), ej: .24, bt: .26, base: .9, og: 1.0, tip: .22, fz: .5, fuze: 'mt', body: COL.white, rings: [[.55, .67, COL.oliveDk]], ink: COL.oliveDk, text: ['155 mm', 'ILLUM M485A2'], lot: 'LOT 00-000', payload: { kind: 'illum' }, explode: ['Часовий підривник', 'Корпус зі світильним елементом і парашутом', 'Донна плита (викидається)'] },
  'shell-smart': { r: R155(898), ej: .24, bt: .28, base: .9, og: 1.5, tip: .18, fz: .5, fuze: 'mt', body: COL.olive, rings: [[.55, .67, COL.yellow]], ink: COL.yellow, text: ['155 mm', 'SMArt'], lot: 'LOT 00-000', payload: { kind: 'subs', n: 2 }, explode: ['Часовий підривник', 'Корпус із двома самонавідними суббоєприпасами', 'Донна плита (викидається)'] },
  'shell-bonus': { r: R155(898), ej: .24, bt: .28, base: .9, og: 1.5, tip: .18, fz: .5, fuze: 'mt', body: COL.olive, rings: [[.55, .67, COL.yellow], [.72, .78, COL.red]], ink: COL.yellow, text: ['155 mm', 'BONUS'], lot: 'LOT 00-000', payload: { kind: 'subs', n: 2, finned: true }, explode: ['Часовий підривник', 'Корпус із двома бронебійними боєголовками', 'Донна плита (викидається)'] },
  'shell-m454': { r: R155(850), ej: .24, bt: .28, base: .9, og: 1.5, tip: .18, fz: .5, fuze: 'mt', body: COL.olive, rings: [[.55, .67, COL.yellow]], ink: COL.yellow, text: ['155 mm', 'S-HE'], lot: 'LOT 00-000', payload: { kind: 'warhead' }, explode: ['Дистанційний підривник', 'Корпус із бойовою частиною', 'Донна плита (викидається)'] },
};
// Хвиля 2: типи з bk155.com.ua (155 мм) і відкритих джерел (інші калібри). Довжини з підривником; «оцінка» — де джерела не називають довжину корпусу.
const mk = (from, over) => ({ ...SHELLS[from], ...over });
const HE = { bt: .24, base: .92, tip: .18, fz: .3, fuze: 'contact', body: COL.olive, rings: [[.55, .67, COL.yellow]], ink: COL.yellow, lot: 'LOT 00-000' };
const gold = '#b89a2a';
Object.assign(SHELLS, {
  'shell-l15a1': { ...HE, r: R155(874), og: 1.9, obt: true, text: ['155 mm', 'HE L15A1'], explode: ['Підривник', 'Корпус із 11,3 кг вибухівки', 'Дно'] },
  'shell-kta5938': { ...HE, r: R155(815), bt: .22, og: 1.7, text: ['155 mm', 'HE KTA 5938'], explode: ['Підривник', 'Корпус із 9 кг вибухівки', 'Дно'] },
  'shell-lu211-hb': { ...HE, r: R155(865), off: .1, hb: true, bt: .26, base: .9, og: 1.9, obt: true, text: ['155 mm', 'HE LU 211 HB'], explode: ['Підривник', 'Корпус із 8,8 кг вибухівки', 'Порожниста основа'] },
  'shell-lu211-bb': { ...HE, r: R155(867), off: .2, bleed: true, bt: .3, base: .86, og: 1.9, obt: true, text: ['155 mm', 'HE LU 211 BB'], explode: ['Підривник', 'Корпус із 8,8 кг вибухівки', 'Донний газогенератор'] },
  'shell-er02a1-hb': { ...HE, r: R155(865), off: .1, hb: true, bt: .26, base: .9, og: 1.9, obt: true, body: COL.greyDk, rings: [[.5, .58, gold]], text: ['155 mm', 'HE ER02A1'], explode: ['Підривник', 'Корпус із 10,6 кг вибухівки', 'Порожниста основа'] },
  'shell-er02a1-bb': { ...HE, r: R155(867), off: .2, bleed: true, bt: .3, base: .86, og: 1.9, obt: true, body: COL.greyDk, rings: [[.5, .58, gold]], text: ['155 mm', 'HE-BB ER02A1'], explode: ['Підривник', 'Корпус із 10,6 кг вибухівки', 'Донний газогенератор'] },
  'shell-ofd-mkm': { ...HE, r: R155(862), off: .1, hb: true, bt: .26, base: .9, og: 1.8, text: ['155 mm', 'HE-HB OFd MKM'], explode: ['Підривник', 'Корпус із 10 кг вибухівки', 'Порожниста основа'] },
  'shell-m77b': { ...HE, r: R155(775), off: .1, hb: true, bt: .26, base: .9, og: 1.6, obt: true, text: ['155 mm', 'HE M77B'], explode: ['Підривник', 'Корпус із 9 кг вибухівки', 'Порожниста основа'] },
  'shell-m1a1-bt': { ...HE, r: R155(890), bt: .5, base: .78, og: 2.0, obt: true, text: ['155 mm', 'HE M1A1 BT'], explode: ['Підривник (M557)', 'Корпус із вибухівкою', 'Конічне дно (boat-tail)'] },
  'shell-m116': { ...HE, r: R155(715), ej: .24, bt: .26, base: .9, og: 1.1, tip: .22, fz: .5, fuze: 'mt', body: COL.paleGreen, rings: [[.55, .67, COL.yellow]], ink: '#2a2f26', payload: { kind: 'cans', n: 4 }, text: ['155 mm', 'HC M116'], explode: ['Часовий підривник', 'Корпус із 4 димовими каністрами', 'Донна плита (викидається)'] },
  'shell-dm105': { ...HE, r: R155(875), ej: .24, bt: .28, base: .9, og: 1.5, tip: .2, fz: .5, fuze: 'mt', body: COL.paleGreen, rings: [[.55, .67, COL.white]], ink: '#2a2f26', payload: { kind: 'cans', n: 4 }, text: ['155 mm', 'HC DM105'], explode: ['Часовий підривник', 'Корпус із 4 каністрами HC', 'Донна плита (викидається)'] },
  'shell-lu214-hb': { ...HE, r: R155(865), off: .1, hb: true, bt: .26, base: .9, og: 1.9, obt: true, body: COL.paleGreen, rings: [[.55, .67, COL.white]], ink: '#2a2f26', text: ['155 mm', 'WP LU 214 HB'], explode: ['Підривник', 'Корпус із 8,4 кг білого фосфору', 'Порожниста основа'] },
  'shell-lu214-bb': { ...HE, r: R155(867), off: .2, bleed: true, bt: .3, base: .86, og: 1.9, obt: true, body: COL.paleGreen, rings: [[.55, .67, COL.white]], ink: '#2a2f26', text: ['155 mm', 'WP LU 214 BB'], explode: ['Підривник', 'Корпус із 8,7 кг білого фосфору', 'Донний газогенератор'] },
  'shell-erfb-smoke': { ...HE, r: R155(938), off: .1, hb: true, bt: .26, base: .9, og: 1.9, obt: true, body: COL.paleGreen, rings: [[.55, .67, COL.white]], ink: '#2a2f26', text: ['155 mm', 'WP ERFB'], explode: ['Підривник', 'Корпус із 7,6 кг білого фосфору', 'Дно'] },
  'shell-erfb-smoke-bb': { ...HE, r: R155(958), off: .2, bleed: true, bt: .3, base: .86, og: 1.9, obt: true, body: COL.paleGreen, rings: [[.55, .67, COL.white]], ink: '#2a2f26', text: ['155 mm', 'WP ERFB-BB'], explode: ['Підривник', 'Корпус із 7,6 кг білого фосфору', 'Донний газогенератор'] },
  'shell-dm642': mk('shell-m864', { r: R155(899), og: 1.2, text: ['155 mm', 'DPICM DM642'], payload: { kind: 'grenades', n: 21 }, explode: ['Часовий підривник', 'Корпус із 63 суббоєприпасами DM1383', 'Донний газогенератор'] }),
  'shell-m449': mk('shell-m483a1', { r: R155(698), og: 1.0, text: ['155 mm', 'DPICM M449'], payload: { kind: 'grenades', n: 14 }, explode: ['Часовий підривник', 'Корпус із 60 гранатами M43', 'Донна плита'] }),
  'shell-3of25': { ...HE, r: RC(152, 860), og: 1.7, body: COL.greyDk, rings: [[.52, .66, COL.red]], ink: COL.white, text: ['152', '3ОФ25'], lot: '№ 00-00', explode: ['Підривник', 'Корпус із вибухівкою', 'Дно'] },
  'shell-3of61': { ...HE, r: RC(152, 860), off: .2, bleed: true, bt: .3, base: .86, og: 1.7, body: COL.greyDk, rings: [[.52, .66, COL.red]], ink: COL.white, text: ['152', '3ОФ61'], lot: '№ 00-00', explode: ['Підривник', 'Корпус із вибухівкою', 'Донний газогенератор'] },
  'shell-m106': { ...HE, r: RC(203, 798), bt: .25, base: .92, og: 1.2, tip: .22, text: ['203 mm', 'HE M106'], explode: ['Підривник', 'Корпус із вибухівкою', 'Дно'] },
  'shell-m509': mk('shell-m483a1', { r: RC(203, 1115), og: 1.3, text: ['203 mm', 'DPICM M509A1'], payload: { kind: 'grenades', n: 28 }, explode: ['Часовий підривник', 'Корпус зі 180 суббоєприпасами M42', 'Донна плита'] }),
  'shell-3of43': { ...HE, r: RC(203, 1000), og: 1.5, body: COL.greyDk, rings: [[.52, .66, COL.red]], ink: COL.white, text: ['203', '3ОФ43'], lot: '№ 00-00', explode: ['Підривник', 'Корпус із вибухівкою', 'Дно'] },
  'shell-m1-105': { ...HE, r: RC(105, 495), bt: .3, base: .85, og: 1.1, tip: .22, text: ['105 mm', 'HE M1'], explode: ['Підривник', 'Корпус із вибухівкою', 'Дно'] },
});


const radiusFn = s => {
  const x0 = -H + (s.off || 0), xb = x0 + s.bt, xn = H - s.fz, xo = xn - s.og, rn = s.r * (s.tip || .2);
  return x => {
    if (x <= xb) return s.r * (s.base + (1 - s.base) * smooth((x - x0) / s.bt));
    if (x <= xo) return s.r;
    // Тангенціальна оживальна: дуга радіуса rho торкається циліндра (без зламу) й сходиться до носа; rn — радіус вершини під підривник.
    const L = xn - xo, rho = (L * L + s.r * s.r) / (2 * s.r), d = Math.min(Math.max(xn - x, 0), L);
    const y = Math.sqrt(Math.max(rho * rho - (L - d) * (L - d), 0)) + s.r - rho;
    return rn + (s.r - rn) * Math.min(Math.max(y / s.r, 0), 1);
  };
};

// Розфарбування корпусу: колір, пояси, трафарети з обох боків, шов унизу й потертості.
function shellSkin(key, s, span, rb, seed) {
  return skin(key, () => {
    const k = new Skin(span, s.r, seed);
    k.rect(span[0] - .1, span[1] + .1, 0, 1, { color: s.body, mat: [.62, .1], height: .5 });
    k.streaks(span[0], span[1], 90, .3);
    k.weather(span[0], span[1], { dark: '20,22,18', light: '170,170,150', count: 180, alpha: .07, mat: [.62, .1] });
    for (const [a, b, c] of s.rings) k.rect(a - .02 + 0, b, 0, 1, { color: c, mat: [.55, .06], height: .52 });
    k.seam(span[0] + .02);
    // Провідний пояс і ведучий потовщений пояс окремими деталями нижче; тут лише трафарети з обох боків.
    for (const [v, flip] of [[.75, false], [.25, true]]) k.text(s.text, -.2, v, .13, s.ink, flip);
    return k.material({ bumpScale: 1 });
  }, matte(s.body));
}

function fuzeParts(s, xn) {
  const g = new Group(), rn = s.r * (s.tip || .2), fz = s.fz, tip = H;
  const steel = metal(COL.steel, .32, .7), dark = metal(COL.steelDk, .4, .6), brass = metal(COL.copper, .35, .8);
  if (s.fuze === 'time' || s.fuze === 'mt') {
    // Механічний дистанційний підривник: голівка з кільцями установки. 'mt' — довший, із ширшим плечем (як M577).
    const k = s.fuze === 'mt' ? 1.22 : 1, rr = rn * 1.35 * k;
    g.add(lathe([[0, xn], [rr, xn], [rr, xn + fz * .55], [rn * 1.1 * k, xn + fz * .62], [rn * 1.1 * k, xn + fz * .8], [rn * .5, tip], [0, tip]], steel, { segments: 32 }));
    for (const f of (s.fuze === 'mt' ? [.14, .3, .46] : [.2, .42])) g.add(lathe([[rr + .003, xn + fz * f], [rr + .003, xn + fz * (f + .09)]], dark, { segments: 32 }));
    g.add(lathe([[rr, xn], [rr + .003, xn + fz * .02]], brass, { segments: 32 }));
  } else {
    g.add(lathe([[0, xn], [rn * 1.15, xn], [rn * 1.2, xn + fz * .3], [rn * 1.0, xn + fz * .7], [rn * .45, tip], [0, tip]], steel, { segments: 32 }));
    g.add(lathe([[rn * 1.22, xn + fz * .28], [rn * 1.22, xn + fz * .4]], dark, { segments: 32 }));
  }
  return g;
}

// ---------------------------------------------------------------- корисне навантаження (видно в розкладеному вигляді)
// Усе будується всередині корпусу (радіус меншим за внутрішній), тож у зібраному вигляді воно не виступає.
const cyl = (r, len, mat, seg = 14) => { const m = new Mesh(new CylinderGeometry(r, r, len, seg), mat); m.rotation.z = Math.PI / 2; return m; };
function buildPayload(s, x0, xn) {
  const p = s.payload, inner = s.r * .8, g = new Group(), pieces = [];
  const olive = metal(COL.oliveDk, .5, .5), steel = metal(COL.steel, .4, .7), felt = matte('#d9d4c4', .9, 0), black = matte(COL.black, .8, .1);
  const layer = (n, ringR, make, x, offset = 0) => {
    // Шар: один у центрі й решта по колу.
    if (n > 0) { const c = make(); c.position.set(x, 0, 0); g.add(c); }
    const ring = Math.max(n - 1, 0);
    for (let i = 0; i < ring; i++) { const a = offset + i / ring * Math.PI * 2, c = make(); c.position.set(x, Math.sin(a) * ringR, Math.cos(a) * ringR); g.add(c); }
  };
  let xc = x0 + .6, half = .5;
  if (p.kind === 'grenades') {
    // Осколково-кумулятивні гранати: циліндр із носовою кулькою й стрічкою (умовно).
    const per = 7, layers = Math.max(1, Math.round(p.n / per)), step = .21;
    for (let i = 0; i < layers; i++) layer(per, inner * .62, () => { const m = new Group(); m.add(cyl(inner * .24, .17, olive)); const cap = new Mesh(new SphereGeometry(inner * .24, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), steel); cap.rotation.z = -Math.PI / 2; cap.position.x = .085; m.add(cap); return m; }, i * step, i * .4);
    half = layers * step / 2; xc = x0 + .45 + half;
    g.children.forEach(c => { c.position.x += xc - half; });
    pieces.push(...g.children);
  } else if (p.kind === 'mines-at') {
    // 9 протитанкових мін-«шайб» трьома шарами по три.
    const layers = 3, step = .3;
    for (let i = 0; i < layers; i++) for (let j = 0; j < 3; j++) {
      const a = i * .5 + j * Math.PI * 2 / 3, m = cyl(inner * .4, .1, olive, 20); m.position.set(i * step, Math.sin(a) * inner * .42, Math.cos(a) * inner * .42); g.add(m);
      const dome = new Mesh(new SphereGeometry(inner * .26, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), steel); dome.rotation.z = -Math.PI / 2; dome.position.set(i * step + .05, m.position.y, m.position.z); g.add(dome);
    }
    half = layers * step / 2; xc = x0 + .5 + half; g.children.forEach(c => { c.position.x += xc - half; });
  } else if (p.kind === 'mines-ap') {
    // 36 малих протипіхотних мін: чотири шари по дев'ять.
    const layers = 4, step = .17;
    for (let i = 0; i < layers; i++) layer(9, inner * .68, () => cyl(inner * .17, .11, olive, 12), i * step, i * .35);
    half = layers * step / 2; xc = x0 + .5 + half; g.children.forEach(c => { c.position.x += xc - half; });
  } else if (p.kind === 'wp') {
    // Елементи з білим фосфором (повстяні): п'ять шарів по сім.
    const layers = Math.max(1, Math.round((p.n || 35) / 7)), step = .15;
    for (let i = 0; i < layers; i++) layer(7, inner * .62, () => cyl(inner * .24, .12, felt, 12), i * step, i * .3);
    half = layers * step / 2; xc = x0 + .5 + half; g.children.forEach(c => { c.position.x += xc - half; });
  } else if (p.kind === 'cans') {
    // Димові каністри (HC), складені одна на одну вздовж осі.
    const n = p.n || 4, step = .34;
    for (let i = 0; i < n; i++) { const c = cyl(inner * .92, .24, i % 2 ? matte(COL.sand, .7, .1) : metal(COL.steel, .5, .5), 28); c.position.x = i * step; g.add(c); }
    half = n * step / 2; xc = x0 + .5 + half; g.children.forEach(c => { c.position.x += xc - half; });
  } else if (p.kind === 'subs') {
    // Самонавідні суббоєприпаси: циліндр із датчиком на торці (і розкритими стабілізаторами, якщо finned).
    for (let i = 0; i < (p.n || 2); i++) {
      const sub = new Group(); sub.add(cyl(inner * .78, .42, olive, 24));
      const eye = new Mesh(new SphereGeometry(inner * .5, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), black); eye.rotation.z = Math.PI / 2; eye.position.x = -.21; sub.add(eye);
      if (p.finned) sub.add(finSet([[.1, inner * .7], [.22, inner * .7], [.2, inner * 1.25], [.12, inner * 1.25]], .012, steel, { count: 4, offset: Math.PI / 4 }));
      sub.position.x = i * .5; g.add(sub);
    }
    half = ((p.n || 2) * .5) / 2; xc = x0 + .55 + half; g.children.forEach(c => { c.position.x += xc - half; });
  } else if (p.kind === 'illum' || p.kind === 'warhead') {
    // Світловий елемент (або бойова частина) на парашуті: парашут розкривається в розкладеному вигляді.
    const can = new Group(), body = cyl(inner * .78, .8, p.kind === 'illum' ? matte(COL.white, .6, .2) : olive, 28); can.add(body);
    can.add(lathe([[0, -.4], [inner * .78, -.4], [inner * .78, -.38], [0, -.38]], steel, { segments: 24 }));
    g.add(can);
    const chute = new Group(), dome = new Mesh(new SphereGeometry(.5, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2), matte('#e9e6dc', .85, 0));
    dome.material = dome.material.clone(); dome.material.side = 2; dome.rotation.z = Math.PI / 2; dome.position.x = -1.0; chute.add(dome);
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2, y = Math.sin(a) * .5, z = Math.cos(a) * .5; chute.add(rod([-.5, 0, 0], [-1.0, y, z], .006, black)); }
    chute.position.x = -.4; g.add(chute); g.userData.chute = chute;
    half = .4; xc = x0 + .55 + half; can.position.x = 0; g.children.forEach(c => { c.position.x += xc; });
  }
  g.position.x = 0;
  return { group: g, xc, half };
}

function buildShellModel(kind) {
  const s = SHELLS[kind];
  const rb = radiusFn(s), x0 = -H + (s.off || 0), xn = H - s.fz;
  const g = new Group();
  const bodyMat = shellSkin('art:' + kind, { ...s, text: s.text.concat(s.lot ? [s.lot] : []) }, [x0 - .1, xn + .02], rb, kind.length * 31);
  const body = new Group(), fuze = new Group(), base = new Group(), loose = new Group();
  body.add(lathe([[0, x0], ...sample(rb, x0, xn, .02), [0, xn]], bodyMat, { segments: 64, span: [x0 - .1, xn + .02] }));
  // Провідний пояс (мідь) і центруючі потовщення; пластиковий обтюратор за поясом, якщо він є.
  const bandR = x => rb(x) + .016;
  loose.add(lathe([[rb(-1.15) - .002, -1.2], [bandR(-1.15), -1.19], ...sample(bandR, -1.17, -.97, .02), [rb(-.97) - .002, -.96]], metal(COL.copper, .34, .85), { segments: 64 }));
  if (s.obt) loose.add(lathe([[rb(-1.31) - .002, -1.31], [rb(-1.3) + .02, -1.3], [rb(-1.24) + .02, -1.24], [rb(-1.22) - .002, -1.22]], matte(COL.black, .5, .15), { segments: 64 }));
  body.add(lathe([[rb(.9) - .002, .78], [rb(.9) + .008, .79], [rb(.9) + .008, .93], [rb(.9) - .002, .94]], metal(COL.steel, .4, .6), { segments: 64 }));
  fuze.add(fuzeParts(s, xn));
  // Дно: пласка пробка, газогенератор, ракетний двигун із соплами або донна плита, що викидається.
  const graphite = metal(COL.steelDk, .45, .6), black = matte(COL.black, .9, 0);
  const hole = (r, x, y, z) => { const m = new Mesh(new CylinderGeometry(r, r, .02, 16), black); m.rotation.z = Math.PI / 2; m.position.set(x, y, z); return m; };
  if (s.bleed) {
    base.add(lathe([[0, x0 - s.off], [s.r * .7, x0 - s.off], [s.r * .76, x0 - s.off + .08], [s.r * .76, x0 + .02], [s.r * s.base, x0 + .03]], graphite, { segments: 48 }));
    for (let i = 0; i < 7; i++) {
      const a = i ? (i - 1) / 6 * Math.PI * 2 : 0, rr = i ? s.r * .42 : 0;
      base.add(hole(s.r * .09, x0 - s.off - .005, Math.sin(a) * rr, Math.cos(a) * rr));
    }
  } else if (s.hb) {
    // Порожниста основа (HB): плита з глибокою чашею, що ловить розрідження за снарядом.
    base.add(lathe([[0, x0 - s.off + .07], [s.r * .5, x0 - s.off + .07], [s.r * .6, x0 - s.off], [s.r * s.base * .97, x0 - s.off], [s.r * s.base, x0 + .03]], graphite, { segments: 48 }));
    base.add(lathe([[0, x0 - s.off + .075], [s.r * .48, x0 - s.off + .075]], black, { segments: 32 }));
  } else if (s.rap) {
    // Ракетний двигун: широке дно з центральною заглушкою й кільцем сопел.
    base.add(lathe([[0, x0 - .07], [s.r * .66, x0 - .07], [s.r * .72, x0 - .03], [s.r * .8, x0 + .0], [s.r * s.base, x0 + .03]], metal(COL.copper, .5, .5), { segments: 48 }));
    base.add(lathe([[0, x0 - .1], [s.r * .22, x0 - .1], [s.r * .24, x0 - .07]], graphite, { segments: 24 }));
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; base.add(hole(s.r * .14, x0 - .072, Math.sin(a) * s.r * .46, Math.cos(a) * s.r * .46)); }
  } else if (s.ej) {
    // Донна плита й кільце-обойма над нею: тримає корисне навантаження, поки не спрацює вибивний заряд.
    base.add(lathe([[0, x0 - .03], [s.r * s.base * .8, x0 - .03], [s.r * s.base * .97, x0 + .01], [s.r * s.base + .004, x0 + .04],
      ...sample(x => rb(x) + .006, x0 + .06, x0 + s.ej, .02), [rb(x0 + s.ej) - .002, x0 + s.ej]], graphite, { segments: 64 }));
  } else {
    base.add(lathe([[0, x0 - .03], [s.r * s.base * .8, x0 - .03], [s.r * s.base * .97, x0 + .01], [s.r * s.base, x0 + .03]], graphite, { segments: 48 }));
  }
  g.add(body, fuze, base, loose);
  const pay = s.payload ? buildPayload(s, x0, xn) : null;
  if (pay) g.add(pay.group);
  const [nFuze, nBody, nBase] = s.explode;
  const tag = (module, text, x, y, side) => { const anchor = new Object3D(); anchor.position.set(x, y, 0); module.add(anchor); return { text, anchor, side }; };
  const labels = [tag(fuze, nFuze, H - s.fz * .5, s.r * (s.tip || .2) * 1.7, 'up'), tag(body, nBody, -.3, -s.r, 'down'), tag(base, nBase, x0 - (s.off || 0) / 2, -s.r * .8, 'down'), tag(loose, 'Провідний пояс', -1.07, s.r * 1.4, 'up')];
  const APART = { fuze: .75, base: -.6 }, LIFT = .55, PAY_AT = -2.2;
  const explode = k => {
    fuze.position.x = APART.fuze * k; base.position.x = APART.base * k;
    loose.position.y = LIFT * k; loose.position.x = -.2 * k;
    let back = -H + APART.base * k;
    if (pay) {
      // Корисне навантаження виходить крізь дно: спершу всередині корпусу, у розкладеному вигляді — позаду нього.
      pay.group.visible = k > .02;
      pay.group.position.x = (PAY_AT - pay.xc) * k;
      const chute = pay.group.userData.chute;
      if (chute) chute.scale.setScalar(.04 + .96 * smooth(k));
      back = Math.min(back, PAY_AT * k + (1 - k) * (-H) - pay.half - (chute ? 1.5 * k : 0));
    }
    g.userData.tips = [H + APART.fuze * k, back];
  };
  g.userData.fit = pay ? (pay.group.userData.chute ? 1.5 : 1.32) : 0;     // у скільки разів далі відсунути камеру в розкладеному вигляді
  explode(0);
  return { group: castShadows(g), wings: [], explode, labels };
}

// ---------------------------------------------------------------- міна
// Крапля з корпусом, хвостова трубка, оперення й кільця додаткових зарядів. r — радіус корпусу при довжині 4.
const MORTARS = {
  'mortar-120': { r: .37, fins: 12, ink: COL.yellow, body: COL.olive, ring: COL.yellow, text: ['120 mm', 'HE'], boom: .13, rings: 5 },
  'mortar-82': { r: .34, fins: 8, ink: COL.yellow, body: COL.olive, ring: COL.yellow, text: ['82 mm', 'HE'], boom: .12, rings: 4 },
  'mortar-60': { r: .32, fins: 6, ink: COL.yellow, body: COL.olive, ring: COL.yellow, text: ['60 mm', 'HE'], boom: .11, rings: 0 },
};

function buildMortarModel(kind) {
  const s = MORTARS[kind];
  const g = new Group(), x0 = -H, xFuze = 1.74, xNose = H;
  const prof = x => {
    // Від хвостовика до максимального перетину на x = .2, далі циліндр, оживало до підривника.
    if (x < -.75) return 0;
    if (x < .25) return s.boom + (s.r - s.boom) * Math.sin(smooth((x + .75) / 1.0) * Math.PI / 2);
    if (x < .85) return s.r;
    const t = (x - .85) / (xFuze - .85);
    return s.r * (.26 + .74 * Math.pow(Math.max(1 - t * t, 0), .6));
  };
  const key = 'art:' + kind;
  const span = [-.8, xFuze + .02];
  const bodyMat = skin(key, () => {
    const k = new Skin(span, s.r, kind.length * 17);
    k.rect(span[0] - .1, span[1] + .1, 0, 1, { color: s.body, mat: [.62, .1], height: .5 });
    k.streaks(span[0], span[1], 70, .3);
    k.weather(span[0], span[1], { dark: '20,22,18', light: '170,170,150', count: 120, alpha: .07, mat: [.62, .1] });
    k.rect(.75, .9, 0, 1, { color: s.ring, mat: [.55, .06], height: .52 });
    k.rect(.95, 1.0, 0, 1, { color: s.ring, mat: [.55, .06], height: .52 });
    for (const [v, flip] of [[.75, false], [.25, true]]) k.text(s.text, .3, v, .13, s.ink, flip);
    return k.material({ bumpScale: 1 });
  }, matte(s.body));
  const body = new Group(), nose = new Group(), tail = new Group(), charge = new Group();
  body.add(lathe([[0, -.75], ...sample(prof, -.75, xFuze, .02).filter(p => p[0] > 0), [0, xFuze]], bodyMat, { segments: 64, span }));
  body.add(lathe([[s.boom, -.8], [s.boom, -.74], [s.boom * .7, -.7]], matte(COL.steelDk), { segments: 24 }));
  nose.add(lathe([[0, xFuze], [s.r * .26, xFuze], [s.r * .3, xFuze + .08], [s.r * .24, xFuze + .2], [s.r * .1, xNose - .02], [0, xNose]], metal(COL.steel, .32, .7), { segments: 32 }));
  tail.add(lathe([[0, -.8], [s.boom, -.8], [s.boom, x0 + .12], [s.boom * 1.12, x0 + .1], [s.boom * 1.12, x0 + .02], [s.boom * .5, x0]], metal(COL.steelDk, .4, .6), { segments: 24 }));
  tail.add(finSet([[x0 + .1, s.boom * .9], [-1.15, s.boom * .9], [-1.28, s.r * .98], [x0 + .1, s.r * .98]], .018, metal(COL.steel, .42, .6), { count: s.fins, offset: Math.PI / s.fins }));
  tail.add(lathe([[s.r * .98, x0 + .1], [s.r * 1.0, x0 + .1], [s.r * 1.0, x0 + .14], [s.r * .98, x0 + .14]], metal(COL.steel, .42, .6), { segments: 48 }));
  // Додаткові заряди: кільця з тканини на хвостовій трубці.
  for (let i = 0; i < s.rings; i++) {
    const ring = new Mesh(new TorusGeometry(s.boom * 1.9, s.boom * .55, 10, 32), matte(i % 2 ? COL.cloth : COL.sand, .85, 0));
    ring.rotation.y = Math.PI / 2; ring.position.x = -1.6 + i * .1;
    charge.add(ring);
  }
  g.add(body, nose, tail, charge);
  const tag = (module, text, x, y, side) => { const anchor = new Object3D(); anchor.position.set(x, y, 0); module.add(anchor); return { text, anchor, side }; };
  const labels = [tag(nose, 'Підривник', xFuze + .1, s.r * .3, 'up'), tag(body, 'Корпус із вибухівкою', .3, -s.r, 'down'), tag(tail, 'Хвостова трубка й оперення', -1.55, -s.r * .95, 'down')];
  if (s.rings) labels.push(tag(charge, 'Додаткові заряди', -1.4, s.boom * 2.6, 'up'));
  const explode = k => {
    nose.position.x = .7 * k; tail.position.x = -.6 * k;
    charge.position.set(-.25 * k, .6 * k, 0);
    g.userData.tips = [H + .7 * k, -H - .6 * k];
  };
  explode(0);
  return { group: castShadows(g), wings: [], explode, labels };
}

// ---------------------------------------------------------------- реактивний снаряд 122 мм
function buildRocketModel() {
  const g = new Group(), r = .1, x0 = -H, xn = H - .12, xo = 1.15;
  const rb = x => (x < xo ? r : (.03 * r + (r - .03 * r) * Math.pow(Math.max(1 - ((x - xo) / (xn - xo)) ** 2, 0), .6)));
  const span = [x0, xn + .02];
  const bodyMat = skin('art:rocket-122', () => {
    const k = new Skin(span, r, 9122);
    k.rect(x0 - .1, xn + .1, 0, 1, { color: COL.greyDk, mat: [.6, .15], height: .5 });
    k.streaks(x0, xn, 60, .25);
    k.weather(x0, xn, { dark: '20,22,18', light: '170,170,150', count: 100, alpha: .06, mat: [.6, .15] });
    k.rect(.9, 1.0, 0, 1, { color: COL.red, mat: [.55, .06], height: .52 });
    k.rect(xo - .12, xo - .08, 0, 1, { color: COL.white, mat: [.55, .06], height: .52 });
    k.seam(-1.0); k.seam(xo - .02);
    for (const [v, flip] of [[.75, false], [.25, true]]) { k.text(['9М22У'], -.1, v, .06, COL.white, flip); k.text(['122 mm'], .45, v, .06, COL.white, flip); }
    return k.material({ bumpScale: 1 });
  }, matte(COL.greyDk));
  const nose = new Group(), body = new Group(), tail = new Group();
  body.add(lathe([[0, x0 + .12], ...sample(rb, x0 + .12, xn, .02), [0, xn]], bodyMat, { segments: 48, span }));
  nose.add(lathe([[0, xn], [r * .1, xn], [r * .14, xn + .03], [r * .1, xn + .1], [0, H]], metal(COL.steel, .32, .7), { segments: 24 }));
  tail.add(lathe([[0, x0 + .12], [r * .82, x0 + .12], [r * .86, x0 + .02], [r * .62, x0 + .02], [r * .5, x0], [0, x0]], metal(COL.steelDk, .4, .6), { segments: 32 }));
  // Чотири стабілізатори, що розкриваються після виходу з труби: розкриті.
  tail.add(finSet([[x0 + .1, r * .9], [-1.45, r * .9], [-1.62, r * 2.8], [x0 + .12, r * 2.8]], .012, metal(COL.steel, .42, .6), { count: 4, offset: Math.PI / 4 }));
  // Напрямні штифти.
  for (const x of [-.7, .5]) { const pin = new Mesh(new CylinderGeometry(.012, .012, .05, 8), metal(COL.steel)); pin.position.set(x, r + .018, 0); body.add(pin); }
  g.add(body, nose, tail);
  const tag = (module, text, x, y, side) => { const anchor = new Object3D(); anchor.position.set(x, y, 0); module.add(anchor); return { text, anchor, side }; };
  const labels = [tag(nose, 'Підривник', xn + .05, r * .5, 'up'), tag(body, 'Бойова частина й ракетний двигун', 0, -r, 'down'), tag(tail, 'Сопло й стабілізатори', -1.7, -r * 2.2, 'down')];
  const explode = k => { nose.position.x = .6 * k; tail.position.x = -.6 * k; g.userData.tips = [H + .6 * k, -H - .6 * k]; };
  explode(0);
  return { group: castShadows(g), wings: [], explode, labels };
}

// ---------------------------------------------------------------- високоточний снаряд
function buildGuidedModel() {
  const s = { r: .38, bt: .55, base: .78, og: 1.25, fz: .36, body: COL.olive, rings: [[.95, 1.05, COL.yellow]], ink: COL.yellow, text: ['155 mm', 'PGM'], lot: 'LOT 00-000' };
  const rb = radiusFn(s), x0 = -H, xn = H - s.fz;
  const g = new Group();
  const bodyMat = shellSkin('art:guided', { ...s, text: s.text.concat(s.lot) }, [x0 - .1, xn + .02], rb, 7155);
  const body = new Group(), nose = new Group(), tail = new Group(), canards = new Group();
  body.add(lathe([[0, x0], ...sample(rb, x0, xn, .02), [0, xn]], bodyMat, { segments: 64, span: [x0 - .1, xn + .02] }));
  // Носовий модуль наведення (приймач супутникових сигналів) із перехідним кільцем.
  const rn = s.r * .2;
  nose.add(lathe([[0, xn], [rn * 1.4, xn], [rn * 1.55, xn + .06], [rn * 1.5, xn + .22], [rn * .7, H - .03], [0, H]], metal(COL.white, .4, .35), { segments: 32 }));
  nose.add(lathe([[rn * 1.56, xn + .06], [rn * 1.56, xn + .1]], matte(COL.black), { segments: 32 }));
  // Керувальні консолі (кермові площини) на носі та складані стабілізатори в хвості.
  canards.add(finSet([[xn - .5, s.r * .56], [xn - .05, s.r * .26], [xn - .05, s.r * .78], [xn - .3, s.r * .98]], .02, metal(COL.steel, .4, .6), { count: 4, offset: Math.PI / 4 }));
  tail.add(lathe([[0, x0 - .02], [s.r * s.base * .85, x0 - .02], [s.r * s.base * .98, x0 + .02], [s.r * s.base, x0 + .04]], metal(COL.steelDk, .45, .6), { segments: 48 }));
  tail.add(finSet([[x0 + .02, s.r * .8], [x0 + .62, s.r * .8], [x0 + .5, s.r * 1.62], [x0 + .06, s.r * 1.62]], .02, metal(COL.steel, .4, .6), { count: 6, offset: Math.PI / 6 }));
  g.add(body, nose, canards, tail);
  const tag = (module, text, x, y, side) => { const anchor = new Object3D(); anchor.position.set(x, y, 0); module.add(anchor); return { text, anchor, side }; };
  const labels = [tag(nose, 'Модуль наведення', xn + .1, rn * 1.7, 'up'), tag(canards, 'Кермові площини', xn - .3, s.r * 1.0, 'up'), tag(body, 'Корпус із вибухівкою', -.4, -s.r, 'down'), tag(tail, 'Стабілізатори', x0 + .35, -s.r * 1.6, 'down')];
  const explode = k => { nose.position.x = .8 * k; canards.position.x = .35 * k; canards.position.y = .0; tail.position.x = -.7 * k; g.userData.tips = [H + .8 * k, -H - .7 * k]; };
  explode(0);
  return { group: castShadows(g), wings: [], explode, labels };
}

// ---------------------------------------------------------------- модульний метальний заряд
// П’ять однакових модулів-мішків і запалювальний модуль із червоною подушкою. Розкладаються вздовж осі, як блоки бомби.
function buildChargeModel() {
  const g = new Group(), r = .37, len = .72, gap = .1, n = 5;
  const total = n * len + (n - 1) * gap, start = -total / 2;
  const clothMat = skin('art:charge', () => {
    const span = [-.4, .4], k = new Skin(span, r, 5555);
    k.rect(-.5, .5, 0, 1, { color: COL.cloth, mat: [.9, 0], height: .5 });
    k.streaks(-.4, .4, 80, .35);
    k.weather(-.4, .4, { dark: '90,80,50', light: '255,255,240', count: 90, alpha: .1, mat: [.9, 0] });
    for (const x of [-.3, .3]) k.seam(x, 0, 1, .012);
    for (const [v, flip] of [[.75, false], [.25, true]]) k.text(['BMCS', 'TC-F'], 0, v, .075, '#4a4636', flip);
    for (let i = 0; i < 6; i++) k.seamAlong(-.38, .38, (i + .5) / 6, .003);   // шви картуза
    return k.material({ bumpScale: 1.4 });
  }, matte(COL.cloth, .9, 0));
  const modules = [];
  for (let i = 0; i < n; i++) {
    const m = new Group(), x = start + i * (len + gap) + len / 2;
    const w = len / 2;
    m.add(lathe([[0, -w], [r * .94, -w], [r, -w + .04], [r, w - .04], [r * .94, w], [0, w]], clothMat, { segments: 48, span: [-.4, .4] }));
    m.position.x = x;
    g.add(m); modules.push(m);
  }
  // Запалювальна подушка на дні першого модуля й сигнальні пояси.
  const pad = new Mesh(new CylinderGeometry(r * .62, r * .62, .05, 32), matte(COL.red, .7, .05));
  pad.rotation.z = Math.PI / 2; pad.position.x = -len / 2 - .02;
  modules[0].add(pad);
  const tag = (module, text, x, y, side) => { const anchor = new Object3D(); anchor.position.set(x, y, 0); module.add(anchor); return { text, anchor, side }; };
  const labels = [tag(modules[0], 'Модуль із запалювачем', 0, r, 'up'), tag(modules[2], 'Додатковий модуль', 0, -r, 'down'), tag(modules[n - 1], 'Верхній модуль', 0, r, 'up')];
  const explode = k => { modules.forEach((m, i) => { m.position.x = start + i * (len + gap) + len / 2 + (i - (n - 1) / 2) * .22 * k; }); g.userData.tips = [total / 2 + 2 * .22 * k, -total / 2 - 2 * .22 * k]; };
  explode(0);
  return { group: castShadows(g), wings: [], explode, labels };
}

// ---------------------------------------------------------------- M712 Copperhead
// Керований лазером снаряд: циліндр 155 мм із довгим оживалом, лазерною головкою самонаведення в носі, носовими кермами й
// розкритими стабілізаторами в хвості. Довжина ≈ 1,37 м, тож він вужчий за звичайні снаряди.
function buildCopperheadModel() {
  const g = new Group(), r = R155(1372), x0 = -H, xn = 1.5, xo = .35, tipR = r * .3;
  const rb = x => {
    if (x < x0 + .12) return r * (.9 + .1 * (x - x0) / .12);
    if (x <= xo) return r;
    const t = Math.min((x - xo) / (xn - xo), 1);
    return tipR + (r - tipR) * Math.pow(Math.max(1 - t * t, 0), .7);
  };
  const span = [x0 - .05, xn + .02];
  const bodyMat = skin('art:copperhead', () => {
    const k = new Skin(span, r, 712);
    k.rect(span[0] - .1, span[1] + .1, 0, 1, { color: COL.olive, mat: [.62, .1], height: .5 });
    k.streaks(span[0], span[1], 80, .3);
    k.weather(span[0], span[1], { dark: '20,22,18', light: '170,170,150', count: 140, alpha: .07, mat: [.62, .1] });
    k.rect(.2, .32, 0, 1, { color: COL.yellow, mat: [.55, .06], height: .52 });
    k.rect(-1.3, -1.2, 0, 1, { color: COL.yellow, mat: [.55, .06], height: .52 });
    k.seam(x0 + .14);
    for (const [v, flip] of [[.75, false], [.25, true]]) k.text(['M712', 'COPPERHEAD', 'LOT 00-000'], -.55, v, .1, COL.yellow, flip);
    return k.material({ bumpScale: 1 });
  }, matte(COL.olive));
  const body = new Group(), nose = new Group(), canards = new Group(), tail = new Group();
  body.add(lathe([[0, x0], ...sample(rb, x0, xn, .02), [0, xn]], bodyMat, { segments: 64, span }));
  // Лазерна головка: напівпрозоре вікно під кутом і кільце.
  nose.add(lathe([[0, xn], [tipR * 1.05, xn], [tipR * 1.1, xn + .05], [tipR * .8, xn + .3], [tipR * .45, H - .06], [0, H - .02]], metal(COL.steel, .3, .6), { segments: 32 }));
  nose.add(lathe([[tipR * .62, H - .08], [tipR * .62, H - .03], [tipR * .2, H]], matte(COL.black, .2, .3), { segments: 24 }));
  canards.add(finSet([[xn - .6, r * .98], [xn - .2, r * .98], [xn - .12, r * 1.9], [xn - .5, r * 1.9]], .018, metal(COL.steel, .4, .6), { count: 4, offset: Math.PI / 4 }));
  // Розкриті стабілізатори (великі, у середній частині) і малі хвостові.
  tail.add(finSet([[-1.25, r * .98], [-.55, r * .98], [-.65, r * 2.5], [-1.15, r * 2.5]], .02, metal(COL.steel, .4, .6), { count: 4, offset: Math.PI / 4 }));
  tail.add(finSet([[x0 + .02, r * .9], [x0 + .4, r * .9], [x0 + .32, r * 1.5], [x0 + .06, r * 1.5]], .018, metal(COL.steel, .4, .6), { count: 4, offset: 0 }));
  g.add(body, nose, canards, tail);
  const tag = (module, text, x, y, side) => { const anchor = new Object3D(); anchor.position.set(x, y, 0); module.add(anchor); return { text, anchor, side }; };
  const labels = [tag(nose, 'Лазерна головка самонаведення', xn + .25, tipR * 1.2, 'up'), tag(canards, 'Носові керма', xn - .35, r * 1.9, 'up'), tag(body, 'Бойова частина й автопілот', .3, -r, 'down'), tag(tail, 'Стабілізатори', -.9, -r * 2.4, 'down')];
  const explode = k => { nose.position.x = .8 * k; canards.position.x = .35 * k; canards.position.y = .0; tail.position.x = -.7 * k; g.userData.tips = [H + .8 * k, -H - .7 * k]; };
  explode(0);
  return { group: castShadows(g), wings: [], explode, labels };
}

// ---------------------------------------------------------------- мішкові й гільзові метальні заряди
// Довжини за каталогом bk155.com.ua (діаметр мішка — умовний, ≈ 140 мм): M3A1 40,6 см, M4A2 53,3 см, M119A2 74 см, M203A1 76,9 см.
// Мішок — базовий заряд (із запальною подушкою) і прирости, зав’язані шнурами; M203A1 — один блок у горючій гільзі.
const BAGS = {
  'charge-m3a1': { mm: 406, n: 5, cloth: '#5e7a47', ink: '#e4e8d4', text: ['M3A1', 'CHG 1-5'], names: ['Базовий заряд із запальною подушкою', 'Прирости (мішечки)', 'Верхній приріст'] },
  'charge-m4a2': { mm: 533, n: 5, cloth: COL.cloth, ink: '#4a4636', text: ['M4A2', 'CHG 3-7'], names: ['Базовий заряд із запальною подушкою', 'Прирости (мішечки)', 'Верхній приріст'] },
  'charge-m119a2': { mm: 740, n: 7, cloth: '#a33a2e', ink: '#f0dfd2', text: ['M119A2', 'CHG'], names: ['Базовий заряд із запальною подушкою', 'Пучки порохових зарядів', 'Верхній пучок'] },
};

function buildBagModel(kind) {
  const c = BAGS[kind], r = 280 / c.mm, n = c.n, gap = .06, len = (L - (n - 1) * gap) / n, w = len / 2;
  const g = new Group(), mods = [];
  const clothMat = skin('art:' + kind, () => {
    const span = [-w, w], k = new Skin(span, r, c.mm);
    k.rect(-w - .1, w + .1, 0, 1, { color: c.cloth, mat: [.92, 0], height: .5 });
    k.streaks(-w, w, 70, .35);
    k.weather(-w, w, { dark: '40,36,24', light: '255,255,240', count: 80, alpha: .1, mat: [.92, 0] });
    for (let i = 0; i < 8; i++) k.seamAlong(-w + .02, w - .02, (i + .5) / 8, .003);   // шви мішка
    for (const [v, flip] of [[.75, false], [.25, true]]) k.text(c.text, 0, v, Math.min(.075, len * .17), c.ink, flip);
    return k.material({ bumpScale: 1.4 });
  }, matte(c.cloth, .9, 0));
  const cord = matte('#2b2a24', .85, 0);
  for (let i = 0; i < n; i++) {
    const m = new Group();
    m.add(lathe([[0, -w], [r * .93, -w], [r, -w + .05], [r, w - .05], [r * .93, w], [0, w]], clothMat, { segments: 48, span: [-w, w] }));
    // Шнур, що стягує мішок, і два кінці.
    const tie = new Mesh(new TorusGeometry(r * 1.005, .012, 8, 40), cord); tie.rotation.y = Math.PI / 2; tie.position.x = w - .02; m.add(tie);
    m.position.x = -H + w + i * (len + gap);
    g.add(m); mods.push(m);
  }
  const pad = new Mesh(new CylinderGeometry(r * .62, r * .62, .05, 32), matte(COL.red, .7, .05));
  pad.rotation.z = Math.PI / 2; pad.position.x = -w - .02; mods[0].add(pad);
  const tag = (module, text, x, y, side) => { const anchor = new Object3D(); anchor.position.set(x, y, 0); module.add(anchor); return { text, anchor, side }; };
  const mid = mods[Math.floor(n / 2)];
  const labels = [tag(mods[0], c.names[0], 0, r, 'up'), tag(mid, c.names[1], 0, -r, 'down'), tag(mods[n - 1], c.names[2], 0, r, 'up')];
  const explode = k => { mods.forEach((m, i) => { m.position.x = -H + w + i * (len + gap) + (i - (n - 1) / 2) * .26 * k; }); g.userData.tips = [H + (n - 1) / 2 * .26 * k, -H - (n - 1) / 2 * .26 * k]; };
  explode(0);
  return { group: castShadows(g), wings: [], explode, labels };
}

// M203A1: заряд зони 8 в одному блоці — горюча гільза з крафт-паперу, запалювач у дні й пучок порохових стрижнів усередині.
function buildCaseChargeModel() {
  const mm = 769, r = 280 / mm, g = new Group(), x0 = -H, x1 = H;
  const span = [x0, x1];
  const caseMat = skin('art:charge-m203a1', () => {
    const k = new Skin(span, r, 203);
    k.rect(x0 - .1, x1 + .1, 0, 1, { color: '#b79a6a', mat: [.9, 0], height: .5 });
    k.streaks(x0, x1, 120, .5);
    k.weather(x0, x1, { dark: '70,52,28', light: '235,215,170', count: 110, alpha: .11, mat: [.9, 0] });
    for (let i = 0; i < 10; i++) k.seamAlong(x0 + .05, x1 - .05, (i + .5) / 10, .003);
    k.rect(-1.5, -1.4, 0, 1, { color: '#6d3b24', mat: [.9, 0], height: .5 });
    for (const [v, flip] of [[.75, false], [.25, true]]) k.text(['M203A1', 'ZONE 8'], .2, v, .13, '#3b2c1a', flip);
    return k.material({ bumpScale: 1.2 });
  }, matte('#b79a6a', .9, 0));
  const bodyG = new Group(), plug = new Group(), cap = new Group();
  bodyG.add(lathe([[0, x0 + .08], [r * .96, x0 + .08], [r, x0 + .12], [r, x1 - .12], [r * .96, x1 - .08], [0, x1 - .08]], caseMat, { segments: 48, span }));
  // Дно з запалювачем (червона подушка в металевій чашці) і кришка зверху.
  plug.add(lathe([[0, x0], [r * .72, x0], [r * .74, x0 + .06], [r * .96, x0 + .08], [r * .96, x0 + .1]], metal(COL.steelDk, .45, .6), { segments: 40 }));
  const pad = new Mesh(new CylinderGeometry(r * .48, r * .48, .04, 32), matte(COL.red, .7, .05)); pad.rotation.z = Math.PI / 2; pad.position.x = x0 - .01; plug.add(pad);
  cap.add(lathe([[0, x1], [r * .9, x1], [r * .96, x1 - .05], [r * .96, x1 - .1]], matte('#8b7450', .85, 0), { segments: 40 }));
  g.add(bodyG, plug, cap);
  const tag = (module, text, x, y, side) => { const anchor = new Object3D(); anchor.position.set(x, y, 0); module.add(anchor); return { text, anchor, side }; };
  const labels = [tag(plug, 'Дно із запалювачем', x0 + .1, r * .7, 'up'), tag(bodyG, 'Горюча гільза з пучком пороху', 0, -r, 'down'), tag(cap, 'Верхня кришка', x1 - .1, r * .7, 'up')];
  const explode = k => { plug.position.x = -.6 * k; cap.position.x = .6 * k; g.userData.tips = [H + .6 * k, -H - .6 * k]; };
  explode(0);
  return { group: castShadows(g), wings: [], explode, labels };
}

const BUILDERS = { 'rocket-122': buildRocketModel, guided: buildGuidedModel, charge: buildChargeModel, copperhead: buildCopperheadModel, 'charge-m203a1': buildCaseChargeModel };
for (const kind of Object.keys(BAGS)) BUILDERS[kind] = () => buildBagModel(kind);
export const SHELL_KINDS = [...Object.keys(SHELLS), ...Object.keys(MORTARS), ...Object.keys(BUILDERS)];
export function buildShell(kind) {
  if (SHELLS[kind]) return buildShellModel(kind);
  if (MORTARS[kind]) return buildMortarModel(kind);
  return (BUILDERS[kind] || buildShellModel.bind(null, 'shell-155-he'))();
}
