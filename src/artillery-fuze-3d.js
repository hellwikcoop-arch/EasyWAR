// Умовні тривимірні моделі підривників для довідника модуля «Артилерія»: ударної дії, механічні годинникові, електронні,
// радіопідривники й комплект із GPS. Складено з тіл обертання за габаритами зі сторінок bk155.com.ua (повна й видима довжина,
// діаметр, маса); форма голівки, кільця й носа умовна, колір — де сайт його не називає. Ніс — у +X, інтерфейс як у
// artillery-3d.js: buildFuze(kind) повертає { group, wings, explode, labels }, тож RefViewer показує моделі так само.
// Довжина моделі нормована до 4 одиниць, але діаметр голівки не більший за 1,8: масивні підривники (довжина лише вдвічі
// більша за діаметр) тому коротші. Це схема для перегляду, а не креслення для впізнавання чи розрахунків.
import { BoxGeometry, CylinderGeometry, Group, Mesh, Object3D, SphereGeometry, TorusGeometry } from 'three';
import { Skin, castShadows, finSet, lathe, paint, rod, sample, skin } from './munition-3d.js';

const C = {
  steel: '#8d9299', steelDk: '#5b6066', dark: '#353a40', black: '#202327', olive: '#4b5329', brass: '#b8733a',
  white: '#d8d5c8', tan: '#b99a6d', ink: '#1c1f22',
};
const MAX_LEN = 4, MAX_DIA = 1.8;
const metal = (color, rough = .38, m = .7) => paint(color, rough, m);
const matte = (color, rough = .6, m = .08) => paint(color, rough, m);

// ---------------------------------------------------------------- параметри моделей
// len, vis, dia, thr, thrLen — повна довжина, видима частина (над носом снаряда), діаметр голівки, діаметр і довжина різьби, мм.
// ts — де закінчується циліндричне плече (частка видимої довжини), og — форма оживала [степінь, заокруглення], tipR — радіус
// кінця оживала в частках радіуса. ring — кільце установки, cap — знімний ковпак, nose — деталь на кінці, pin/latch/canards —
// допоміжні деталі, marks — написи на плечі, index — стрілка-покажчик. Усі частки — від низу видимої частини (0) до носа (1).
const D = o => ({ dia: 61, thr: 51, thrLen: 28, ts: .3, tipR: .3, og: [2, .8], body: C.steel, ink: C.ink, ...o });
const NM = {
  pd: { head: 'Плунжер із прорізом', body: 'Корпус з ударником', base: 'Хвостовик із підсилювачем' },
  cap: { head: 'Головка з ударником', cap: 'Знімний ковпак', ring: 'Кран зі стрілкою', body: 'Корпус', base: 'Хвостовик із підсилювачем' },
  hard: { head: 'Ніс із загартованої сталі', body: 'Корпус із уповільнювачем', base: 'Хвостовик із підсилювачем' },
  mt: { head: 'Ніс підривника', ring: 'Кільце часу зі шкалою', body: 'Корпус із годинником', base: 'Хвостовик із підсилювачем' },
  et: { head: 'Ніс підривника', ring: 'Індукційне кільце', body: 'Корпус з електронікою', base: 'Хвостовик із підсилювачем' },
  es: { head: 'Ніс підривника', ring: 'Кільце установки', body: 'Корпус з електронікою', base: 'Хвостовик із підсилювачем' },
  px: { head: 'Обтічник датчика', ring: 'Кільце режимів', body: 'Корпус з електронікою', base: 'Хвостовик із підсилювачем' },
};
const FUZES = {
  // Ударної дії
  'fuze-m557': D({ len: 127, vis: 99, ts: .22, tipR: .38, og: [2, .75], nose: { kind: 'slot', t: .9, r: .24 }, marks: ['M557'], markT: .11, index: .17, names: NM.pd }),
  'fuze-m739': D({ len: 152, vis: 95.5, ts: .16, tipR: .3, og: [2, .95], nose: { kind: 'slot', t: .92, r: .2 }, marks: ['M739A1'], markT: .08, index: .13, names: NM.pd }),
  'fuze-dm211': D({ len: 152, vis: 96, ts: .22, tipR: .34, og: [2, .85], nose: { kind: 'slot', t: .9, r: .22 }, marks: ['DM211', 'OV   MV'], markT: .11, index: .17, names: NM.pd }),
  'fuze-rgm2': D({ len: 97, vis: 51.6, ts: .36, tipR: .13, og: [1, 1], cap: { t0: .36, color: C.steelDk, under: 'post' }, ring: { t0: .08, t1: .32, style: 'knurl', color: '#4a4f54' }, marks: ['KTA 7962'], markT: .2, index: .35, names: NM.cap }),
  'fuze-m51a5': D({ len: 151, vis: 95, ts: .14, tipR: .1, og: [2, 1], nose: { kind: 'point', t: .95, r: .05 }, marks: ['M51A5'], markT: .07, names: NM.pd }),
  'fuze-m78': D({ len: 76.2, vis: 50.8, ts: .42, tipR: .5, og: [2, .55], bands: [[.52, 1, C.white]], marks: ['M78'], markT: .21, index: .36, names: NM.hard }),
  'fuze-dm371': D({ len: 124.3, vis: 76, ts: .48, tipR: .55, og: [2, .5], body: '#4d5258', ink: '#d8d5c8', marks: ['DM371'], markT: .24, names: NM.hard }),
  // Механічні годинникові
  'fuze-m582': D({ len: 127, vis: 76.2, ts: .62, tipR: .2, og: [2, .7], nose: { kind: 'ball', t: .92, r: .1 }, ring: { t0: .2, t1: .6, style: 'scale', color: C.dark }, marks: ['M582'], markT: .1, names: NM.mt }),
  'fuze-m520': D({ len: 127, vis: 76.2, ts: .64, tipR: .22, og: [2, .6], nose: { kind: 'ball', t: .93, r: .09 }, ring: { t0: .24, t1: .62, style: 'scale', color: C.dark }, pin: .1, marks: ['M520A1'], markT: .12, names: NM.mt }),
  'fuze-m501': D({ len: 101.6, vis: 76.2, ts: .64, tipR: .22, og: [2, .6], nose: { kind: 'ball', t: .93, r: .09 }, ring: { t0: .24, t1: .62, style: 'scale', color: C.dark }, marks: ['M501'], markT: .12, names: NM.mt }),
  'fuze-m67a3': D({ len: 150.6, vis: 95, ts: .5, tipR: .22, og: [2, .8], ring: { t0: .18, t1: .48, style: 'scale', color: C.dark }, pin: .09, marks: ['M67A3'], markT: .09, names: NM.mt }),
  'fuze-dm163': D({ len: 124, vis: 99, ts: .62, tipR: .25, og: [2, .7], ring: { t0: .28, t1: .6, style: 'scale', color: C.dark }, marks: ['DM163'], markT: .13, names: NM.mt }),
  // Електронні
  'fuze-m762': D({ len: 134, vis: 99, ts: .5, tipR: .26, og: [2, .9], ring: { t0: .3, t1: .44, style: 'band', color: C.black }, marks: ['M762A1'], markT: .15, names: NM.es }),
  'fuze-m782': D({ len: 127, vis: 50.8, ts: .55, tipR: .28, og: [2, .65], ring: { t0: .2, t1: .46, style: 'knurl', color: '#4a4f54' }, marks: ['M782'], markT: .1, names: NM.es }),
  'fuze-dm52': D({ len: 133.4, vis: 95.1, ts: .55, tipR: .26, og: [2, .85], ring: { t0: .28, t1: .42, style: 'band', color: C.black }, marks: ['DM52A2'], markT: .14, names: NM.et }),
  'fuze-dm74': D({ len: 151.1, vis: 95, ts: .45, tipR: .22, og: [2, 1], ring: { t0: .24, t1: .36, style: 'band', color: C.black }, marks: ['DM74'], markT: .12, names: NM.et }),
  'fuze-m8611': D({ len: 151.45, vis: 95, dia: 61.25, ts: .5, tipR: .3, og: [2, .8], ring: { t0: .26, t1: .4, style: 'band', color: C.black }, marks: ['M8611A1'], markT: .13, names: NM.et }),
  // Радіопідривники
  'fuze-m732': D({ len: 147, vis: 95.5, ts: .38, tipR: .3, og: [2, .9], headColor: C.tan, nose: { kind: 'point', t: .86, r: .14, color: C.black }, ring: { t0: .1, t1: .34, style: 'knurl', color: '#4a4f54' }, latch: true, marks: ['M732A2'], markT: .2, names: NM.px }),
  'fuze-ppd440': D({ len: 151.6, vis: 95, ts: .3, tipR: .36, og: [2, .85], nose: { kind: 'intake', t: .86 }, cap: { t0: .5, color: C.black, under: 'ogive' }, marks: ['PPD 440'], markT: .15, names: { ...NM.px, cap: 'Захисний ковпачок', head: 'Голівка з пропелером' } }),
  'fuze-ralec': D({ len: 151, vis: 95, ts: .3, tipR: .3, og: [2, .9], body: C.olive, ink: '#e4e8d4', nose: { kind: 'point', t: .9, r: .1 }, cap: { t0: .6, color: C.black, under: 'ogive' }, marks: ['FU-RALEC', 'DE F3'], markT: .15, names: { ...NM.px, cap: 'Ковпачок', head: 'Обтічник датчика' } }),
  'fuze-zonar': D({ len: 164, vis: 95, ts: .4, tipR: .3, og: [2, .9], body: '#4a5036', ink: '#e4e8d4', headColor: '#2f3438', nose: { kind: 'point', t: .9, r: .1, color: C.black }, ring: { t0: .14, t1: .38, style: 'notches', labels: ['S', '1F', '2F', '3Ö', '4Ö', '5Z', '6Z', '7Z'], color: C.dark }, marks: ['ZONAR 75B'], markT: .26, names: NM.px }),
  'fuze-frappe': D({ len: 213.4, vis: 95, ts: .35, tipR: .24, og: [2, 1], headColor: '#394048', nose: { kind: 'point', t: .9, r: .08, color: C.black }, marks: ['FRAPPE F1'], markT: .16, names: NM.px }),
  // GPS
  'fuze-m1156': D({ len: 220.2, vis: 95.25, ts: .5, tipR: .22, og: [2, 1], canards: .22, ring: { t0: .1, t1: .2, style: 'band', color: C.dark }, marks: ['M1156'], markT: .35, names: { head: 'Модуль GPS', ring: 'Перехідне кільце', body: 'Корпус з електронікою', base: 'Хвостовик із підсилювачем', canards: 'Кермові площини' } }),
};
export const FUZE_KINDS = Object.keys(FUZES);

// ---------------------------------------------------------------- геометрія
function layout(s) {
  const k = Math.min(MAX_LEN / s.len, MAX_DIA / s.dia), len = s.len * k, vis = (s.vis || Math.round(s.len * .63)) * k;
  return { k, L: len, vis, R: s.dia / 2 * k, Rt: s.thr / 2 * k, x0: -len / 2, xf: len / 2 - vis, x1: len / 2 };
}

// Радіус видимої частини: плече радіуса R, далі оживало до кінця tipR·R (степінь 1 дає конус), на кінці — деталь носа.
function headRadius(s, g) {
  const tn = s.nose ? s.nose.t : 1, [q, p] = s.og;
  return x => {
    const t = (x - g.xf) / g.vis;
    if (t <= s.ts) return g.R;
    if (t >= tn) return g.R * s.tipR;
    const u = (t - s.ts) / (tn - s.ts);
    return g.R * (s.tipR + (1 - s.tipR) * Math.pow(Math.max(1 - Math.pow(u, q), 0), p));
  };
}

// Тонкостінний ковпак: зовнішня поверхня rf(x) між a і b, внутрішня на товщину th менша; відкритий з боку a.
function hollow(rf, a, b, th, mat) {
  const pts = [[Math.max(rf(a) - th, 0), a], [rf(a), a], ...sample(rf, a, b - th * .5, .02).slice(1), [0, b], [0, b - th]];
  const inner = sample(x => Math.max(rf(x) - th, 0), a, b - th, .02);
  for (let i = inner.length - 1; i >= 0; i--) pts.push(inner[i]);
  return lathe(pts, mat, { segments: 56 });
}

const cylX = (r, len, mat, seg = 24) => { const m = new Mesh(new CylinderGeometry(r, r, len, seg), mat); m.rotation.z = Math.PI / 2; return m; };

// Розфарбування видимої частини: метал, потертості, смуги, кільце (шкала, рифлення, ризики режимів), написи й стрілка.
function fuzeSkin(kind, s, g) {
  const span = [g.xf - .02, g.x1 + .02], X = t => g.xf + t * g.vis, arc = d => d / (2 * Math.PI * g.R);
  return skin('fz:' + kind, () => {
    const k = new Skin(span, g.R, kind.length * 29 + 7);
    k.rect(span[0] - .1, span[1] + .1, 0, 1, { color: s.body, mat: [.46, .62], height: .5 });
    k.streaks(span[0], span[1], 90, .5);
    k.weather(span[0], span[1], { dark: '20,22,18', light: '190,190,180', count: 120, alpha: .08, mat: [.5, .6] });
    for (const [a, b, c] of s.bands || []) k.rect(X(a), X(b), 0, 1, { color: c, mat: [.55, .1], height: .52 });
    const r = s.ring;
    if (r) {
      const a = X(r.t0), b = X(r.t1);
      k.rect(a, b, 0, 1, { color: r.color, mat: [.5, .45], height: .5 });
      if (r.style === 'scale') for (let i = 0; i < 100; i++) k.rect(a + .02, i % 5 ? a + (b - a) * .55 : b - .02, i / 100, i / 100 + arc(.012), { color: '#d8d5c8', height: .62 });
      else if (r.style === 'knurl') for (let i = 0; i < 150; i++) k.rect(a + .015, b - .015, i / 150, i / 150 + arc(.01), { color: 'rgba(235,238,240,.22)', height: .9 });
      else if (r.style === 'notches') r.labels.forEach((text, i) => {
        const v = (i + .5) / r.labels.length;
        k.rect(a + .02, b - .02, v - arc(.01), v + arc(.01), { color: '#0d0f11', height: .15 });
        k.text([text], (a + b) / 2, v + .0625, .06, '#e8e8e0');
      });
    }
    if (s.marks) for (const [v, flip] of [[.75, false], [.25, true]]) k.text(s.marks, X(s.markT ?? s.ts / 2), v, .085, s.ink, flip);
    if (s.index) { const x = X(s.index), w = arc(.05); k.poly([[x - .06, .75 - w], [x - .06, .75 + w], [x + .07, .75]], { color: '#111315', height: .6 }); }
    return k.material({ bumpScale: 1 });
  }, matte(s.body, .5, .5));
}

function buildFuzeModel(kind) {
  const s = FUZES[kind], g = layout(s), X = t => g.xf + t * g.vis, rf = headRadius(s, g), nm = s.names;
  const grp = new Group(), base = new Group(), body = new Group(), ring = new Group(), head = new Group(), cap = new Group(), extra = new Group();
  const span = [g.xf - .02, g.x1 + .02];
  const mat = fuzeSkin(kind, s, g), headMat = s.headColor ? matte(s.headColor, .45, .18) : mat;
  const steel = metal(C.steel, .34, .72), dark = metal(C.steelDk, .4, .6), brass = metal(C.brass, .35, .8), black = matte(C.black, .5, .2);

  // Хвостовик: різьба 2 дюйми й (де вставна частина довша) вужчий корпус підсилювача з латунним пояском.
  const ins = g.xf - g.x0, thr = Math.min(ins, s.thrLen * g.k), tail = ins - thr, xs = g.x0 + tail;
  const amp = Math.min(.016, g.Rt * .03), teeth = Math.max(6, Math.round(thr / (2.1 * g.k))), rt = g.Rt, rb = rt * .6;
  const bp = [[0, g.x0], [tail ? rb * .88 : rt * .9, g.x0]];
  if (tail) bp.push([rb, g.x0 + .02], [rb, xs - .02], [rt * .94, xs]); else bp.push([rt * .97, g.x0 + .03]);
  for (let i = 0; i < teeth; i++) { const a = xs + thr * i / teeth, w = thr / teeth; bp.push([rt - amp, a + w * .1], [rt, a + w * .4], [rt, a + w * .7], [rt - amp, a + w * .95]); }
  bp.push([rt, g.xf], [0, g.xf]);
  base.add(lathe(bp, dark, { segments: 48 }));
  if (tail) base.add(lathe([[rb * 1.012, g.x0 + .03], [rb * 1.012, g.x0 + tail * .42]], brass, { segments: 32 }));

  // Корпус від плеча до кінця циліндричної частини; під кільцем установки — проточка.
  const xts = X(s.ts), bpts = [[0, g.xf], [g.R * .95, g.xf], [g.R, g.xf + .014]];
  if (s.ring) { const a = X(s.ring.t0), b = X(s.ring.t1), rg = g.R * .955; bpts.push([g.R, a], [rg, a + .006], [rg, b - .006], [g.R, b]); }
  bpts.push([g.R, xts], [0, xts]);
  body.add(lathe(bpts, mat, { segments: 64, span }));
  if (s.ring) {
    const a = X(s.ring.t0), b = X(s.ring.t1), ro = g.R * 1.022, ri = g.R * .9;
    ring.add(lathe([[ri, a], [ro - .01, a], [ro, a + .01], [ro, b - .01], [ro - .01, b], [ri, b], [ri, a]], mat, { segments: 72, span }));
    if (s.latch) { const latch = new Mesh(new BoxGeometry(.15, .05, .1), dark); latch.position.set((a + b) / 2, ro + .02, 0); ring.add(latch); }
  }
  if (s.pin) {
    // Запобіжна чека: стрижень поперек корпусу й кільце-ручка.
    const x = X(s.pin), z = g.R * 1.12, ringM = new Mesh(new TorusGeometry(.1, .014, 8, 24), steel);
    body.add(rod([x, 0, -z], [x, 0, z], .017, steel)); ringM.position.set(x, 0, z + .1); body.add(ringM);
  }

  // Голівка: оживало до кінця, на кінці — плунжер із прорізом, кулька, вістря чи повітрозабірник із пропелером; або (під знімним ковпаком) лише ударник.
  const tn = s.nose ? s.nose.t : 1, xtn = X(tn), rp = g.R * (s.nose?.r || .2), tipR = g.R * s.tipR;
  if (s.cap && s.cap.under === 'post') {
    head.add(lathe([[0, xts], [g.R * .3, xts], [g.R * .3, xts + .05], [g.R * .16, xts + .07], [g.R * .16, X(.8)], [g.R * .1, X(.84)], [0, X(.84)]], metal(C.steelDk, .35, .75), { segments: 32 }));
  } else {
    // Без деталі на кінці оживало закінчується округлим куполом (чверть еліпса), а не плоским диском.
    const dcap = s.nose ? 0 : Math.min(tipR * .95, (xtn - xts) * .4), xe = xtn - dcap, pts = [[0, xts], ...sample(rf, xts, xe, .02)];
    if (dcap) { const rc = rf(xe); for (let i = 1; i <= 8; i++) { const a = i / 8 * Math.PI / 2; pts.push([i < 8 ? rc * Math.cos(a) : 0, xe + dcap * Math.sin(a)]); } } else pts.push([0, xtn]);
    head.add(lathe(pts, headMat, { segments: 64, span }));
    const n = s.nose;
    if (n && n.kind === 'slot') {
      head.add(lathe([[0, xtn - .01], [rp, xtn - .01], [rp, g.x1 - .03], [rp * .86, g.x1 - .005], [rp * .6, g.x1], [0, g.x1]], dark, { segments: 32 }));
      const slot = new Mesh(new BoxGeometry(.014, .02, rp * 1.8), black); slot.position.set(g.x1 + .002, 0, 0); head.add(slot);
    } else if (n && n.kind === 'ball') {
      const ball = new Mesh(new SphereGeometry(rp, 20, 14), dark); ball.position.x = g.x1 - rp; head.add(ball);
    } else if (n && n.kind === 'point') {
      head.add(lathe([[0, xtn - .01], [tipR * .92, xtn - .01], [tipR * .5, (xtn + g.x1) / 2], [0, g.x1]], n.color ? matte(n.color, .45, .2) : steel, { segments: 32 }));
    } else if (n && n.kind === 'intake') {
      const ri = tipR * .62, disc = cylX(ri, .01, black, 32);
      head.add(lathe([[ri, xtn], [tipR, xtn], [tipR, g.x1 - .012], [tipR * .94, g.x1], [ri * 1.1, g.x1], [ri, g.x1 - .02], [ri, xtn]], dark, { segments: 40 }));
      disc.position.x = xtn + .04; head.add(disc);
      for (let i = 0; i < 2; i++) { const blade = new Mesh(new BoxGeometry(.012, ri * 1.8, .05), steel); blade.position.x = xtn + .08; blade.rotation.x = i * Math.PI / 2 + .4; head.add(blade); }
    }
  }
  if (s.cap) {
    const th = .03, crf = x => rf(x) + .008;
    cap.add(hollow(crf, X(s.cap.t0), g.x1, th, matte(s.cap.color, .45, .25)));
  }
  if (s.canards) {
    const x = X(s.canards), c = [[x, g.R * .97], [x + .42, g.R * .97], [x + .3, g.R * 1.6], [x + .1, g.R * 1.55]];
    extra.add(finSet(c, .022, steel, { count: 4, offset: Math.PI / 4 }));
  }
  grp.add(base, body, ring, head, cap, extra);

  // Підписи: блоки, що роз’їжджаються вздовж осі.
  const tag = (part, text, x, y, side) => { const anchor = new Object3D(); anchor.position.set(x, y, 0); part.add(anchor); return { text, anchor, side }; };
  const xm = (a, b) => (a + b) / 2, headMid = xm(xts, g.x1);
  const labels = [tag(head, nm.head, headMid, Math.max(rf(headMid), g.R * .2) + .03, 'up'), tag(body, nm.body, xm(g.xf, xts), -g.R, 'down'), tag(base, nm.base, xm(g.x0, g.xf), -rt * .9, 'down')];
  if (s.ring) labels.push(tag(ring, nm.ring, xm(X(s.ring.t0), X(s.ring.t1)), g.R * 1.03, 'up'));
  if (s.cap) labels.push(tag(cap, nm.cap, xm(X(s.cap.t0), g.x1), rf(xm(X(s.cap.t0), g.x1)) + .04, 'up'));
  if (s.canards) labels.push(tag(extra, nm.canards, X(s.canards) + .25, g.R * 1.62, 'up'));
  const OFF = { base: -.5, ring: .3, extra: .3, head: s.ring ? .62 : .42, cap: 1.0 };
  const explode = k => {
    base.position.x = OFF.base * k; ring.position.x = OFF.ring * k; extra.position.x = OFF.extra * k; head.position.x = OFF.head * k; cap.position.x = OFF.cap * k;
    grp.userData.tips = [g.x1 + (s.cap ? OFF.cap : OFF.head) * k, g.x0 + OFF.base * k];
  };
  grp.userData.fit = 1.2;      // у скільки разів далі відсунути камеру в розкладеному вигляді
  explode(0);
  return { group: castShadows(grp), wings: [], explode, labels };
}

export const buildFuze = buildFuzeModel;
