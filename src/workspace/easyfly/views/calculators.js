// Калькулятори штурмана. Усі числа вводить людина; вітру з мережі немає.
// Результат довідковий і не замінює керівні документи.
import {
  circuit, crosswindMs, descent, groundSpeed, headwindMs, mpr, padApproach, speedByDistance,
  timeByDistance, windFromDrift,
} from '../nav-calc-core.js';
import { button, el, field, select } from '../ui.js';

const KINDS = [
  { id: 'wind', title: 'Вітер' },
  { id: 'gs', title: 'Шляхова швидкість' },
  { id: 'mpr', title: 'МПР' },
  { id: 'circuit', title: 'Коробочка' },
  { id: 'pad', title: 'Майданчик' },
  { id: 'descent', title: 'Зниження' },
];

let kind = 'wind';

const dash = '—';
const num = value => {
  const n = Number(String(value ?? '').trim().replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};
const deg = value => {
  if (!Number.isFinite(value)) return dash;
  const n = Math.round(value) % 360;
  return String(n < 0 ? n + 360 : n);
};
const one = value => (Number.isFinite(value) ? (Math.round(value * 10) / 10).toFixed(1).replace('.', ',') : dash);
const mins = seconds => {
  if (!Number.isFinite(seconds)) return dash;
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  return `${m}:${String(total % 60).padStart(2, '0')}`;
};

function input(label, value, onChange) {
  const node = el('input', { class: 'ef-input', inputmode: 'decimal', value: value ?? '', 'aria-label': label, onInput: () => onChange(node.value) });
  return field(label, node);
}

function lines(rows) {
  return el('dl', { class: 'ef-calc-out' }, rows.map(([name, value]) => [el('dt', { text: name }), el('dd', { text: value })]));
}

const forms = {
  wind(box) {
    const v = { mk: '90', air: '180', track: '95', w: '190' };
    const paint = () => {
      const r = windFromDrift({ mk: num(v.mk), v: num(v.air), track: num(v.track), w: num(v.w) });
      box.replaceChildren(r.ok
        ? lines([['Звідки', `${deg(r.from)}°`], ['Куди', `${deg(r.to)}°`], ['Швидкість', `${one(r.uMs)} м/с`], ['Кут зносу', `${one(r.kz)}°`]])
        : el('p', { class: 'ef-form-error', text: 'Потрібні МК, повітряна швидкість, фактичний шлях і шляхова. Швидкості — км/год.' }));
    };
    return el('div', {},
      input('МК, °', v.mk, x => { v.mk = x; paint(); }),
      input('Повітряна V, км/год', v.air, x => { v.air = x; paint(); }),
      input('Фактичний МШК, °', v.track, x => { v.track = x; paint(); }),
      input('Фактична W, км/год', v.w, x => { v.w = x; paint(); }),
      box);
  },
  gs(box) {
    const v = { track: '90', air: '180', from: '0', ms: '0', km: '', min: '' };
    const paint = () => {
      const wind = groundSpeed({ track: num(v.track), v: num(v.air), windFrom: num(v.from), windMs: num(v.ms) });
      const byDist = speedByDistance(num(v.km), num(v.min));
      const byTime = timeByDistance(num(v.km), wind.ok ? wind.w : NaN);
      const rows = [];
      if (wind.ok) rows.push(['МК', `${deg(wind.mk)}°`], ['Кут зносу', `${one(wind.kz)}°`], ['Шляхова', `${one(wind.w)} км/год`]);
      else rows.push(['За вітром', 'заповніть шлях, V, звідки і м/с']);
      if (Number.isFinite(byDist)) rows.push(['За відстанню і часом', `${one(byDist)} км/год`]);
      if (Number.isFinite(byTime)) rows.push(['Час ділянки', mins(byTime * 60)]);
      box.replaceChildren(lines(rows));
    };
    return el('div', {},
      input('МШК, °', v.track, x => { v.track = x; paint(); }),
      input('Повітряна V, км/год', v.air, x => { v.air = x; paint(); }),
      input('Вітер звідки, °', v.from, x => { v.from = x; paint(); }),
      input('Вітер, м/с', v.ms, x => { v.ms = x; paint(); }),
      input('Відстань, км (необовʼязково)', v.km, x => { v.km = x; paint(); }),
      input('Час, хв (необовʼязково)', v.min, x => { v.min = x; paint(); }),
      box);
  },
  mpr(box) {
    const v = { mk: '270', kur: '45', dm: '' };
    const paint = () => {
      const decl = v.dm.trim() === '' ? null : num(v.dm);
      const r = mpr({ mk: num(v.mk), kur: num(v.kur), declination: decl });
      box.replaceChildren(r.ok
        ? lines([['МПР', `${deg(r.mpr)}°`], ['МПС', `${deg(r.mps)}°`], ['ІПР', r.ipr === null ? 'немає ΔМ' : `${deg(r.ipr)}°`]])
        : el('p', { class: 'ef-form-error', text: 'Потрібні МК і КУР у градусах.' }));
    };
    return el('div', {},
      input('МК, °', v.mk, x => { v.mk = x; paint(); }),
      input('КУР, °', v.kur, x => { v.kur = x; paint(); }),
      input('ΔМ, ° (необовʼязково)', v.dm, x => { v.dm = x; paint(); }),
      el('p', { class: 'ef-glow-quiet', text: 'МПР = МК + КУР. ІПР — якщо вказано магнітне схилення. У файлі частини схилення не зберігається.' }),
      box);
  },
  circuit(box) {
    const v = { mk: '270', side: 'left', air: '180', bank: '15', width: '3', d1: '1', d4: '1', from: '0', ms: '0' };
    const side = select([{ value: 'left', label: 'Ліва' }, { value: 'right', label: 'Права' }], v.side, { onChange: () => { v.side = side.value; paint(); } });
    const paint = () => {
      const r = circuit({
        landingMk: num(v.mk), side: v.side, v: num(v.air), bank: num(v.bank),
        width: num(v.width), d1: num(v.d1), d4: num(v.d4), windFrom: num(v.from), windMs: num(v.ms),
      });
      if (!r.ok) {
        box.replaceChildren(el('p', { class: 'ef-form-error', text: (r.issues || ['Не вийшло порахувати.']).join(' ') }));
        return;
      }
      const leg = (id, title) => [`${title}, МК`, `${deg(r.legs[id].mk)}° · ${mins(r.seconds[id])}`];
      box.replaceChildren(lines([
        ['Радіус розвороту', `${one(r.radiusKm)} км`],
        leg('upwind', 'Зліт'), leg('cross', 'Друга'), leg('down', 'Третя'), leg('base', 'Четверта'),
        ['До 3-го від траверзу', `${one(r.abeamToThirdKm)} км · ${mins(r.abeamToThirdSec)}`],
        ['Усього', mins(r.totalSec)],
      ]));
    };
    return el('div', {},
      input('Посадковий МК, °', v.mk, x => { v.mk = x; paint(); }),
      field('Сторона', side),
      input('V на колі, км/год', v.air, x => { v.air = x; paint(); }),
      input('Крен, °', v.bank, x => { v.bank = x; paint(); }),
      input('Ширина, км', v.width, x => { v.width = x; paint(); }),
      input('До 1-го розвороту, км', v.d1, x => { v.d1 = x; paint(); }),
      input('Вихід 4-го до посадки, км', v.d4, x => { v.d4 = x; paint(); }),
      input('Вітер звідки, °', v.from, x => { v.from = x; paint(); }),
      input('Вітер, м/с', v.ms, x => { v.ms = x; paint(); }),
      box);
  },
  pad(box) {
    const v = { mk: '270', side: 'left', scheme: 'teardrop', from: '0', ms: '0' };
    const side = select([{ value: 'left', label: 'Ліві розвороти' }, { value: 'right', label: 'Праві розвороти' }], v.side, { onChange: () => { v.side = side.value; paint(); } });
    const scheme = select([
      { value: 'teardrop', label: 'Відворотом на РУ' },
      { value: 'racetrack', label: 'Двома розворотами' },
      { value: 'smallbox', label: 'Мала коробочка' },
    ], v.scheme, { onChange: () => { v.scheme = scheme.value; paint(); } });
    const paint = () => {
      const r = padApproach({ landingMk: num(v.mk), side: v.side, scheme: v.scheme, windFrom: num(v.from), windMs: num(v.ms) });
      box.replaceChildren(r.ok
        ? lines([['Вихід на пряму', `${one(r.finalKm)} км`], ['Радіус', `${one(r.radiusKm)} км`]])
        : el('p', { class: 'ef-form-error', text: (r.issues || ['Схема не замикається.']).join(' ') }));
    };
    return el('div', {},
      field('Схема', scheme),
      input('Посадковий МК, °', v.mk, x => { v.mk = x; paint(); }),
      field('Сторона', side),
      input('Вітер звідки, °', v.from, x => { v.from = x; paint(); }),
      input('Вітер, м/с', v.ms, x => { v.ms = x; paint(); }),
      el('p', { class: 'ef-glow-quiet', text: 'Швидкість і крен — зі схеми довідкової сторінки, час прямих — типовий для режиму «за часом».' }),
      box);
  },
  descent(box) {
    const v = { profile: 'h200', mk: '270', from: '0', ms: '0', io: '' };
    const profile = select([{ value: 'h200', label: 'З 200 м' }, { value: 'h50', label: 'Гасіння з 50 м' }], v.profile, { onChange: () => { v.profile = profile.value; paint(); } });
    const paint = () => {
      const head = headwindMs(num(v.mk), num(v.from), num(v.ms));
      const io = v.io.trim() === '' ? null : num(v.io);
      const r = descent({ profile: v.profile, headMs: head, ioKm: io });
      if (!r.ok) {
        box.replaceChildren(el('p', { class: 'ef-form-error', text: (r.issues || ['Не вийшло порахувати.']).join(' ') }));
        return;
      }
      box.replaceChildren(el('div', {},
        lines([
          ['Зустрічна складова', `${one(head)} м/с`],
          ['Бокова', `${one(crosswindMs(num(v.mk), num(v.from), num(v.ms)))} м/с`],
          ['Початок від майданчика', `${Math.round(r.startM)} м`],
          ['Горизонталь до початку', Number.isFinite(r.levelM) ? `${Math.round(r.levelM)} м · ${mins(r.levelSec)}` : 'немає вихідного орієнтира'],
          ...r.segments.map((seg, i) => [`Ділянка ${i + 1}`, `${Math.round(seg.sWind)} м · ${seg.sec} с`]),
        ]),
        ...(r.warnings || []).map(text => el('p', { class: 'ef-glow-quiet', text }))));
    };
    return el('div', {},
      field('Профіль', profile),
      input('Посадковий МК, °', v.mk, x => { v.mk = x; paint(); }),
      input('Вітер звідки, °', v.from, x => { v.from = x; paint(); }),
      input('Вітер, м/с', v.ms, x => { v.ms = x; paint(); }),
      input('Вихідний орієнтир, км', v.io, x => { v.io = x; paint(); }),
      box);
  },
};

export function render(ctx) {
  const root = el('div', { class: 'ef-view ef-calcs' });
  const box = el('div', { class: 'ef-calc-box' });
  const body = el('div', { class: 'ef-glow-card ef-flight-form' });
  const show = () => {
    box.replaceChildren();
    body.replaceChildren(forms[kind](box));
    queueMicrotask(() => body.querySelector('input')?.dispatchEvent(new Event('input')));
  };
  root.append(
    el('header', { class: 'ef-today-head' },
      button('Штурман', { variant: 'ghost', onClick: () => ctx.go('navigator') }),
      el('h1', { text: 'Калькулятори' })),
    el('p', { class: 'ef-glow-quiet', text: 'Довідково. Вітер вводите самі: з мережі він не береться. Результат не є допуском.' }),
    el('div', { class: 'ef-calc-kinds', role: 'tablist' }, KINDS.map(item => el('button', {
      type: 'button', class: `ef-calc-kind${item.id === kind ? ' ef-calc-kind-on' : ''}`, role: 'tab',
      'aria-selected': String(item.id === kind),
      onClick: () => { kind = item.id; ctx.rerender(); },
    }, item.title))),
    body);
  show();
  return root;
}
