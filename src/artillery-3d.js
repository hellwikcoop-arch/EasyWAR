// Умовні тривимірні моделі артилерійських боєприпасів для довідника модуля «Артилерія»:
// снаряди ствольної артилерії, міномета міна, реактивний снаряд, високоточний снаряд і модульний метальний заряд.
// Складено з тіл обертання за відкритими габаритами (довжина всіх моделей нормована до 4 одиниць, ніс — у +X), корпус
// розфарбовано на канві: фарба, трафарети, потертості. Це схема для перегляду, а не креслення для впізнавання чи розрахунків.
// Інтерфейс як у munition-3d.js: buildShell(kind) повертає { group, wings, explode, labels }, тож RefViewer показує їх так само.
import { CylinderGeometry, Group, Mesh, Object3D, SphereGeometry, TorusGeometry } from 'three';
import { Skin, at, castShadows, finSet, lathe, paint, plate, sample, skin } from './munition-3d.js';

const COL = {
  olive: '#4b5329', oliveDk: '#3b4220', yellow: '#d8b21a', copper: '#b8733a', steel: '#8d9299', steelDk: '#5b6066', white: '#d8d5c8',
  paleGreen: '#8fa184', grey: '#757b81', greyDk: '#4a4f54', black: '#202327', red: '#a8382c', cloth: '#d2cbb2', sand: '#b9a77c',
};
const L = 4, H = L / 2;
const smooth = t => { const c = Math.min(Math.max(t, 0), 1); return c * c * (3 - 2 * c); };
const metal = (color, rough = .38, m = .7) => paint(color, rough, m);
const matte = (color, rough = .6, m = .08) => paint(color, rough, m);

// ---------------------------------------------------------------- снаряди ствольної артилерії
// r — радіус корпусу при довжині 4 (співвідношення довжина/калібр), bt — довжина конічного дна, base — радіус дна в частках r,
// og — довжина оживальної головної частини, fz — довжина підривника. rings — кольорові пояси [x0, x1, колір], text — трафарети.
const SHELLS = {
  'shell-155-he': { r: .4, bt: .28, base: .88, og: 1.30, fz: .3, body: COL.olive, rings: [[.55, .67, COL.yellow], [.7, .76, COL.yellow]], ink: COL.yellow, fuze: 'contact', text: ['155 mm', 'HE'], lot: 'LOT 00-000', explode: ['Підривник', 'Корпус із вибухівкою', 'Дно'] },
  'shell-155-cluster': { r: .4, off: .38, bt: .2, base: .9, og: 1.10, fz: .3, body: COL.olive, rings: [[.5, .62, COL.yellow], [.67, .73, COL.red]], ink: COL.yellow, fuze: 'time', bleed: true, text: ['155 mm', 'DPICM'], lot: 'LOT 00-000', explode: ['Підривник', 'Корпус із суббоєприпасами', 'Донний газогенератор'] },
  'shell-155-scatter': { r: .4, bt: .28, base: .88, og: 1.10, fz: .3, body: COL.olive, rings: [[.5, .62, COL.yellow], [.67, .73, COL.sand]], ink: COL.yellow, fuze: 'time', text: ['155 mm', 'MINE'], lot: 'LOT 00-000', explode: ['Підривник', 'Корпус із мінами', 'Дно'] },
  'shell-155-smoke': { r: .4, bt: .28, base: .88, og: 1.15, fz: .3, body: COL.paleGreen, rings: [[.55, .67, COL.white]], ink: '#2a2f26', fuze: 'time', text: ['155 mm', 'SMOKE'], lot: 'LOT 00-000', explode: ['Підривник', 'Корпус із димовим складом', 'Дно'] },
  'shell-155-illum': { r: .4, bt: .28, base: .88, og: 1.15, fz: .3, body: COL.white, rings: [[.55, .67, COL.oliveDk]], ink: COL.oliveDk, fuze: 'time', text: ['155 mm', 'ILLUM'], lot: 'LOT 00-000', explode: ['Підривник', 'Корпус зі світильним складом і парашутом', 'Дно'] },
  'shell-152': { r: .39, bt: .22, base: .9, og: 1.15, fz: .3, body: COL.greyDk, rings: [[.52, .66, COL.red]], ink: COL.white, fuze: 'contact', text: ['152', 'ОФ'], lot: '№ 00-00', explode: ['Підривник', 'Корпус із вибухівкою', 'Дно'] },
  'shell-122': { r: .37, bt: .2, base: .9, og: 1.10, fz: .28, body: COL.greyDk, rings: [[.5, .62, COL.red]], ink: COL.white, fuze: 'contact', text: ['122', 'ОФ'], lot: '№ 00-00', explode: ['Підривник', 'Корпус із вибухівкою', 'Дно'] },
  'shell-105': { r: .43, bt: .32, base: .86, og: 1.05, fz: .28, body: COL.olive, rings: [[.5, .62, COL.yellow]], ink: COL.yellow, fuze: 'contact', text: ['105 mm', 'HE'], lot: 'LOT 00-000', explode: ['Підривник', 'Корпус із вибухівкою', 'Дно'] },
  'shell-203': { r: .4, bt: .25, base: .9, og: 1.20, fz: .32, body: COL.olive, rings: [[.55, .67, COL.yellow], [.7, .76, COL.yellow]], ink: COL.yellow, fuze: 'contact', text: ['203 mm', 'HE'], lot: 'LOT 00-000', explode: ['Підривник', 'Корпус із вибухівкою', 'Дно'] },
  'shell-other': { r: .4, bt: .25, base: .9, og: 1.15, fz: .3, body: COL.greyDk, rings: [[.52, .64, COL.yellow]], ink: COL.white, fuze: 'contact', text: ['HE'], lot: '№ 00-00', explode: ['Підривник', 'Корпус із вибухівкою', 'Дно'] },
};

const radiusFn = s => {
  const x0 = -H + (s.off || 0), xb = x0 + s.bt, xn = H - s.fz, xo = xn - s.og, rn = s.r * .2;
  return x => {
    if (x <= xb) return s.r * (s.base + (1 - s.base) * smooth((x - x0) / s.bt));
    if (x <= xo) return s.r;
    const t = Math.min((x - xo) / (xn - xo), 1);
    return rn + (s.r - rn) * Math.pow(Math.max(1 - t * t, 0), .62);
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
  const g = new Group(), rn = s.r * .2, fz = s.fz, tip = H;
  const steel = metal(COL.steel, .32, .7), dark = metal(COL.steelDk, .4, .6), brass = metal(COL.copper, .35, .8);
  if (s.fuze === 'time') {
    // Механічний дистанційний підривник: голівка з кільцями установки.
    g.add(lathe([[0, xn], [rn * 1.35, xn], [rn * 1.35, xn + fz * .55], [rn * 1.1, xn + fz * .62], [rn * 1.1, xn + fz * .8], [rn * .5, tip], [0, tip]], steel, { segments: 32 }));
    for (const f of [.2, .42]) g.add(lathe([[rn * 1.38, xn + fz * f], [rn * 1.38, xn + fz * (f + .1)]], dark, { segments: 32 }));
    g.add(lathe([[rn * 1.35, xn], [rn * 1.38, xn + fz * .02]], brass, { segments: 32 }));
  } else {
    g.add(lathe([[0, xn], [rn * 1.15, xn], [rn * 1.2, xn + fz * .3], [rn * 1.0, xn + fz * .7], [rn * .45, tip], [0, tip]], steel, { segments: 32 }));
    g.add(lathe([[rn * 1.22, xn + fz * .28], [rn * 1.22, xn + fz * .4]], dark, { segments: 32 }));
  }
  return g;
}

function buildShellModel(kind) {
  const s = SHELLS[kind];
  const rb = radiusFn(s), x0 = -H + (s.off || 0), xn = H - s.fz;
  const g = new Group();
  const bodyMat = shellSkin('art:' + kind, { ...s, text: s.text.concat(s.lot ? [s.lot] : []) }, [x0 - .1, xn + .02], rb, kind.length * 31);
  const body = new Group(), fuze = new Group(), base = new Group(), loose = new Group();
  body.add(lathe([[0, x0], ...sample(rb, x0, xn, .02), [0, xn]], bodyMat, { segments: 64, span: [x0 - .1, xn + .02] }));
  // Провідний пояс (мідь) і центруючі потовщення.
  const bandR = x => rb(x) + .016;
  loose.add(lathe([[rb(-1.15) - .002, -1.2], [bandR(-1.15), -1.19], ...sample(bandR, -1.17, -.97, .02), [rb(-.97) - .002, -.96]], metal(COL.copper, .34, .85), { segments: 64 }));
  body.add(lathe([[rb(.9) - .002, .78], [rb(.9) + .008, .79], [rb(.9) + .008, .93], [rb(.9) - .002, .94]], metal(COL.steel, .4, .6), { segments: 64 }));
  fuze.add(fuzeParts(s, xn));
  // Дно: пласка пробка або газогенератор.
  if (s.bleed) {
    base.add(lathe([[0, x0 - s.off], [s.r * .7, x0 - s.off], [s.r * .76, x0 - s.off + .08], [s.r * .76, x0 + .02], [s.r * s.base, x0 + .03]], metal(COL.steelDk, .45, .6), { segments: 48 }));
    for (let i = 0; i < 7; i++) {
      const a = i ? (i - 1) / 6 * Math.PI * 2 : 0, rr = i ? s.r * .42 : 0;
      const hole = new Mesh(new CylinderGeometry(s.r * .09, s.r * .09, .02, 16), matte(COL.black, .9, 0));
      hole.rotation.z = Math.PI / 2; hole.position.set(x0 - s.off - .005, Math.sin(a) * rr, Math.cos(a) * rr);
      base.add(hole);
    }
  } else {
    base.add(lathe([[0, x0 - .03], [s.r * s.base * .8, x0 - .03], [s.r * s.base * .97, x0 + .01], [s.r * s.base, x0 + .03]], metal(COL.steelDk, .45, .6), { segments: 48 }));
  }
  g.add(body, fuze, base, loose);
  const [nFuze, nBody, nBase] = s.explode;
  const tag = (module, text, x, y, side) => { const anchor = new Object3D(); anchor.position.set(x, y, 0); module.add(anchor); return { text, anchor, side }; };
  const labels = [tag(fuze, nFuze, H - s.fz * .5, s.r * .35, 'up'), tag(body, nBody, -.3, -s.r, 'down'), tag(base, nBase, x0 - (s.off || 0) / 2, -s.r * .8, 'down'), tag(loose, 'Провідний пояс', -1.07, s.r * 1.4, 'up')];
  const APART = { fuze: .75, base: -.6 }, LIFT = .55;
  const explode = k => {
    fuze.position.x = APART.fuze * k; base.position.x = APART.base * k;
    loose.position.y = LIFT * k; loose.position.x = -.2 * k;
    g.userData.tips = [H + APART.fuze * k, -H + APART.base * k];
  };
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
  const g = new Group(), r = .44, len = .64, gap = .18, n = 5;
  const total = n * len + (n - 1) * gap, start = -total / 2;
  const clothMat = skin('art:charge', () => {
    const span = [-.4, .4], k = new Skin(span, r, 5555);
    k.rect(-.5, .5, 0, 1, { color: COL.cloth, mat: [.9, 0], height: .5 });
    k.streaks(-.4, .4, 80, .35);
    k.weather(-.4, .4, { dark: '90,80,50', light: '255,255,240', count: 90, alpha: .1, mat: [.9, 0] });
    for (const x of [-.3, .3]) k.seam(x, 0, 1, .012);
    for (const [v, flip] of [[.75, false], [.25, true]]) k.text(['MACS', 'Mod 0'], 0, v, .075, '#4a4636', flip);
    for (let i = 0; i < 6; i++) k.seamAlong(-.38, .38, (i + .5) / 6, .003);
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

const BUILDERS = { 'rocket-122': buildRocketModel, guided: buildGuidedModel, charge: buildChargeModel };
export const SHELL_KINDS = [...Object.keys(SHELLS), ...Object.keys(MORTARS), ...Object.keys(BUILDERS)];
export function buildShell(kind) {
  if (SHELLS[kind]) return buildShellModel(kind);
  if (MORTARS[kind]) return buildMortarModel(kind);
  return (BUILDERS[kind] || buildShellModel.bind(null, 'shell-155-he'))();
}
