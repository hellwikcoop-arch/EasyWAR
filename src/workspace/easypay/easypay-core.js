// easyPay: чиста логіка особистого калькулятора грошового забезпечення й обліку виплат, які
// військовослужбовцю мають виплатити. Без DOM і Tauri, перевіряється в node --test.
// Правила взято з постанови КМУ №704 (ред. 16.07.2026) і Порядку №260 зі змінами №566, №910,
// №232; конспект і посилання — plans/easypay-dokumenty.md у файлах проєкту. Це не юридична
// консультація: цифри треба звіряти з чинними текстами на zakon.rada.gov.ua.

/** Розрахункова величина для окладів, грн (п.4 постанови №704 у ред. №481). */
export const BASE = 1762;

/** Місяць, з якого діють розміри наказу №232 (розділи XXXIV, XXXVII, XXXVIII). */
export const RULES_232_FROM = '2026-06';

/** Ліміт 100 000 + зональні + штурмові на місяць (XXXVIII п.6). */
export const MONTH_CAP = 460000;

/** Прожитковий мінімум для працездатних на 1 січня 2026 р. */
export const LIVING_MINIMUM_2026 = 3328;

/** Звання і коефіцієнти окладу за званням (додаток 14 №704). Морські звання — у дужках. */
export const RANKS = Object.freeze([
  ['recruit', 'Рекрут', 0.25, 'rank-and-file'],
  ['soldier', 'Солдат (матрос)', 0.30, 'rank-and-file'],
  ['senior-soldier', 'Старший солдат (старший матрос)', 0.34, 'rank-and-file'],
  ['junior-sergeant', 'Молодший сержант (старшина 2 статті)', 0.38, 'sergeant'],
  ['sergeant', 'Сержант (старшина 1 статті)', 0.42, 'sergeant'],
  ['senior-sergeant', 'Старший сержант (головний старшина)', 0.46, 'sergeant'],
  ['chief-sergeant', 'Головний сержант (головний корабельний старшина)', 0.50, 'sergeant'],
  ['staff-sergeant', 'Штаб-сержант (штаб-старшина)', 0.54, 'sergeant'],
  ['master-sergeant', 'Майстер-сержант (майстер-старшина)', 0.58, 'sergeant'],
  ['senior-master-sergeant', 'Старший майстер-сержант (старший майстер-старшина)', 0.59, 'sergeant'],
  ['chief-master-sergeant', 'Головний майстер-сержант (головний майстер-старшина)', 0.60, 'sergeant'],
  ['junior-lieutenant', 'Молодший лейтенант', 0.62, 'officer'],
  ['lieutenant', 'Лейтенант', 0.64, 'officer'],
  ['senior-lieutenant', 'Старший лейтенант', 0.68, 'officer'],
  ['captain', 'Капітан (капітан-лейтенант)', 0.72, 'officer'],
  ['major', 'Майор (капітан 3 рангу)', 0.76, 'officer'],
  ['lieutenant-colonel', 'Підполковник (капітан 2 рангу)', 0.80, 'officer'],
  ['colonel', 'Полковник (капітан 1 рангу)', 0.84, 'officer'],
  ['brigadier-general', 'Бригадний генерал (коммодор)', 0.88, 'officer'],
  ['major-general', 'Генерал-майор (контрадмірал)', 0.92, 'officer'],
  ['lieutenant-general', 'Генерал-лейтенант (віцеадмірал)', 0.96, 'officer'],
  ['general', 'Генерал (адмірал)', 1.00, 'officer'],
].map(([id, title, coefficient, staff]) => Object.freeze({ id, title, coefficient, staff })));

export function rankById(id) {
  return RANKS.find(rank => rank.id === id) || null;
}

/** Коефіцієнт тарифного розряду 1–60 (додаток 1 №704). */
export function gradeCoefficient(grade) {
  const value = Number(grade);
  if (!Number.isInteger(value) || value < 1 || value > 60) throw new Error('Тарифний розряд — ціле число від 1 до 60.');
  if (value <= 12) return round2(1.40 + 0.05 * (value - 1));
  return round2(2.00 + 0.08 * (value - 13));
}

/**
 * Округлення окладу (п.4 №704): одиниці гривень з копійками до 4,99 відкидаються,
 * від 5 — округлюються до 10 грн угору.
 */
export function roundSalary(amount) {
  const value = round2(amount);
  const tens = Math.floor(value / 10) * 10;
  return value - tens >= 5 ? tens + 10 : tens;
}

/** Відсоток надбавки за вислугу (додаток 16 №704) за повними роками. */
export function seniorityPercent(years) {
  const value = Number(years) || 0;
  if (value < 1) return 0;
  if (value < 5) return 25;
  if (value < 10) return 30;
  if (value < 15) return 35;
  if (value < 20) return 40;
  if (value < 25) return 45;
  return 50;
}

/** Розміри одноразової допомоги при першому контракті (у прожиткових мінімумах). */
export const FIRST_CONTRACT_MULTIPLIER = Object.freeze({ 'rank-and-file': 8, sergeant: 9, officer: 10 });

/**
 * Категорії додаткової винагороди (XXXIV п.2). Хто має право за кількома, отримує одну,
 * більшу (п.5), тому дні вносяться окремо для кожної категорії і не перетинаються.
 */
export const COMBAT_CATEGORIES = Object.freeze([
  Object.freeze({ id: 'd100', amount: 100000, title: 'Безпосередня участь у бойових діях', basis: 'XXXIV п.2 пп.1' }),
  Object.freeze({ id: 'd50', amount: 50000, title: 'Пункти управління в районі бойових дій', basis: 'XXXIV п.2 пп.2' }),
  Object.freeze({ id: 'd30', amount: 30000, title: 'Завдання за бойовими наказами (відновлення, резерв тощо)', basis: 'XXXIV п.2 пп.3' }),
  Object.freeze({ id: 'd10', amount: 10000, title: 'Виконання обов\'язків служби (нова категорія №232)', basis: 'XXXIV п.2 пп.4', from: RULES_232_FROM }),
]);

/** Види виплат у журналі і строк, до якого кожну очікують. */
export const PAYMENT_KINDS = Object.freeze({
  gz: Object.freeze({ title: 'Грошове забезпечення', dueDay: 20, dueBasis: 'до 20 числа наступного місяця (роз\'яснення Міноборони)' }),
  dv: Object.freeze({ title: 'Додаткова винагорода', dueDay: 20, dueBasis: 'наказ — до 5 числа (XXXIV п.10); строк виплати в документах не названо, взято 20 число', assumption: true }),
  zonal: Object.freeze({ title: 'Зональна винагорода', dueDay: 20, dueBasis: 'наказ — до 5 числа (XXXVII п.3); строк виплати не названо, взято 20 число', assumption: true }),
  assault: Object.freeze({ title: 'Штурмові', dueDay: 20, dueBasis: 'клопотання розглядають 3 дні (XXXVIII); строк виплати не названо, взято 20 число', assumption: true }),
  result: Object.freeze({ title: 'За результат (полон, знищення)', dueDay: 20, dueBasis: 'наказ — 3 дні після документів (XXXIX–XL); строк виплати не названо, взято 20 число', assumption: true }),
  other: Object.freeze({ title: 'Інша виплата', dueDay: null, dueBasis: 'строк вказано вручну' }),
});

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DATE_RE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function isMonth(value) {
  return MONTH_RE.test(String(value ?? ''));
}

export function isDate(value) {
  const match = DATE_RE.exec(String(value ?? ''));
  return Boolean(match) && Number(match[3]) <= daysInMonth(`${match[1]}-${match[2]}`);
}

/** Кількість календарних днів місяця 'РРРР-ММ'. */
export function daysInMonth(month) {
  const match = MONTH_RE.exec(String(month ?? ''));
  if (!match) throw new Error('Місяць у форматі РРРР-ММ.');
  return new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)).getUTCDate();
}

export function nextMonth(month) {
  const match = MONTH_RE.exec(String(month ?? ''));
  if (!match) throw new Error('Місяць у форматі РРРР-ММ.');
  const year = Number(match[1]);
  const index = Number(match[2]);
  return index === 12 ? `${year + 1}-01` : `${year}-${String(index + 1).padStart(2, '0')}`;
}

export function previousMonth(month) {
  const match = MONTH_RE.exec(String(month ?? ''));
  if (!match) throw new Error('Місяць у форматі РРРР-ММ.');
  const year = Number(match[1]);
  const index = Number(match[2]);
  return index === 1 ? `${year - 1}-12` : `${year}-${String(index - 1).padStart(2, '0')}`;
}

/** Строк виплати за місяць: `day` число наступного місяця. */
export function dueDate(month, day = 20) {
  const next = nextMonth(month);
  return `${next}-${String(Math.min(day, daysInMonth(next))).padStart(2, '0')}`;
}

/** Різниця в днях між двома датами 'РРРР-ММ-ДД' (b − a). */
export function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

export function addDays(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

const MONTH_NAMES = ['січень', 'лютий', 'березень', 'квітень', 'травень', 'червень', 'липень', 'серпень', 'вересень', 'жовтень', 'листопад', 'грудень'];
const MONTH_GENITIVE = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];

/** «червень 2026». */
export function monthTitle(month) {
  const match = MONTH_RE.exec(String(month ?? ''));
  return match ? `${MONTH_NAMES[Number(match[2]) - 1]} ${match[1]}` : String(month ?? '');
}

/** «20 липня 2026». */
export function dateTitle(date) {
  const match = DATE_RE.exec(String(date ?? ''));
  return match ? `${Number(match[3])} ${MONTH_GENITIVE[Number(match[2]) - 1]} ${match[1]}` : String(date ?? '');
}

/** «12 345,67 грн» з нерозривними пробілами; `cents` — завжди з копійками («100 000,00 грн»). */
export function formatMoney(amount, { cents: always = false } = {}) {
  const value = round2(amount);
  const [whole, cents] = Math.abs(value).toFixed(2).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${value < 0 ? '−' : ''}${grouped}${cents === '00' && !always ? '' : `,${cents}`} грн`;
}

/** «20.08.2026». */
export function shortDate(date) {
  const match = DATE_RE.exec(String(date ?? ''));
  return match ? `${match[3]}.${match[2]}.${match[1]}` : String(date ?? '');
}

/** Відмінок іменника після числа: plural(61, ['день', 'дні', 'днів']) → «день». */
export function plural(value, [one, few, many]) {
  const number = Math.abs(Math.trunc(Number(value) || 0));
  const last = number % 10;
  const tens = number % 100;
  if (last === 1 && tens !== 11) return one;
  if (last >= 2 && last <= 4 && (tens < 12 || tens > 14)) return few;
  return many;
}

function count(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function amountOf(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? round2(number) : 0;
}

function percentOf(value, fallback, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return Math.min(number, max);
}

/**
 * Розрахунок за місяць. `input`:
 * - `month` 'РРРР-ММ'; `grade` тарифний розряд; `rank` id звання; `years` повних років вислуги;
 * - `specialPct` надбавка за особливості служби, % (типово 65, не більше 100); `mountain` — гірські райони;
 * - `premium` премія за місяць, грн (базового розміру в документах немає — вносить користувач);
 * - `combatDays` { d100, d50, d30, d10 } — дні за категоріями додаткової винагороди;
 * - `zonalDays` { d170, d70 } — дні у зонах до взводного / ротного опорного пункту;
 * - `assaultDays` { capture, restore } — доби штурму (40 000) і відновлення позицій (20 000);
 * - `kills` { count, participants } — підтверджені знищення групи; `prisonerShare` — частка за полон, грн;
 * - `extras` [{ title, amount, kind }] — інші виплати, які користувач вносить сам.
 * Повертає рядки з сумами, формулами й підставами, суми за видами виплат, попередження й помилки.
 * Помилки (`errors`: { field, text }) — дні понад місяць; поки вони є, розрахунок не записують у журнал.
 */
export function calculateMonth(input = {}) {
  const month = String(input.month ?? '');
  if (!isMonth(month)) throw new Error('Оберіть місяць розрахунку.');
  const rank = rankById(input.rank);
  if (!rank) throw new Error('Оберіть військове звання.');
  const days = daysInMonth(month);
  const new232 = month >= RULES_232_FROM;
  const warnings = [];
  const errors = [];
  const lines = [];
  const line = (kind, id, title, amount, basis, note = '', formula = '') => {
    const value = round2(amount);
    if (value > 0) lines.push({ kind, id, title, amount: value, formula, basis, note });
    return value;
  };
  const sum = value => formatMoney(value).replace('\u00a0грн', '');

  const gradeK = gradeCoefficient(input.grade);
  const salary = roundSalary(BASE * gradeK);
  const rankSalary = roundSalary(BASE * rank.coefficient);
  const decimal = value => value.toFixed(2).replace('.', ',');
  line('gz', 'po', 'Посадовий оклад', salary, `№704 п.4, дод. 1: ${BASE} × ${gradeK.toFixed(2)}, розряд ${Number(input.grade)}`, '',
    `Розряд ${Number(input.grade)} · ${sum(BASE)} × ${decimal(gradeK)}`);
  line('gz', 'oz', 'Оклад за військовим званням', rankSalary, `№704 п.4, дод. 14: ${BASE} × ${rank.coefficient.toFixed(2)}`, '',
    `${rank.title.split(' (')[0]} · ${sum(BASE)} × ${decimal(rank.coefficient)}`);
  const seniority = seniorityPercent(input.years);
  const seniorityAmount = line('gz', 'nvr', 'Надбавка за вислугу років', (salary + rankSalary) * seniority / 100, '№704 дод. 16: % від окладів', '',
    `${seniority} % від окладів`);
  const specialPct = percentOf(input.specialPct, 65, 100);
  line('gz', 'special', 'Надбавка за особливості служби', (salary + rankSalary + seniorityAmount) * specialPct / 100,
    '№704 п.5: до 100% від окладів і вислуги; 65% — розмір у ЗСУ за роз\'ясненням', '', `${specialPct} % від окладів і вислуги`);
  if (input.mountain) line('gz', 'mountain', 'Підвищення окладу в гірських районах', salary * 0.25, 'постанова №648', '', '25 % посадового окладу');
  const premium = amountOf(input.premium);
  if (premium) line('gz', 'premium', 'Премія', premium, 'внесено вручну: базового розміру в документах немає', '', 'внесено вручну');

  const combat = input.combatDays || {};
  let combatTotalDays = 0;
  let part100 = 0;
  for (const category of COMBAT_CATEGORIES) {
    const value = count(combat[category.id]);
    if (!value) continue;
    if (category.from && month < category.from) {
      warnings.push(`Категорія ${formatMoney(category.amount)} діє з ${monthTitle(category.from)}; за ${monthTitle(month)} її не враховано.`);
      continue;
    }
    combatTotalDays += value;
    const amount = line('dv', category.id, category.title, category.amount * value / days,
      `${category.basis}: ${formatMoney(category.amount)} × ${value} / ${days}`, 'дільник — календарні дні місяця (припущення)',
      `${sum(category.amount)} × ${value} / ${days}`);
    if (category.id === 'd100') part100 = amount;
  }
  if (combatTotalDays > days) {
    errors.push({ field: 'combat', text: `Днів додаткової винагороди (${combatTotalDays}) більше, ніж днів у місяці (${days}): за один день платять лише одну, більшу категорію (XXXIV п.5).` });
  }

  const zonal = input.zonalDays || {};
  const d170 = count(zonal.d170);
  const d70 = count(zonal.d70);
  let zonalAmount = 0;
  if (new232) {
    zonalAmount += line('zonal', 'z170', 'Зональна до взводного опорного пункту', 170000 * d170 / days,
      `XXXVII п.1 (ред. №232): 170 000 × ${d170} / ${days}`, 'дільник — календарні дні місяця (припущення)', `170 000 × ${d170} / ${days}`);
    zonalAmount += line('zonal', 'z70', 'Зональна до ротного опорного пункту', 70000 * d70 / days,
      `XXXVII п.1 (ред. №232): 70 000 × ${d70} / ${days}`, 'дільник — календарні дні місяця (припущення)', `70 000 × ${d70} / ${days}`);
    if (d170 + d70 > days) errors.push({ field: 'zonal', text: `Днів у зонах (${d170 + d70}) більше, ніж днів у місяці (${days}).` });
  } else if (d170 + d70) {
    zonalAmount += line('zonal', 'z70old', 'Зональна (до червня 2026)', 70000 * (d170 + d70) / 30,
      `XXXVII (до ред. №232): 70 000 за кожні 30 днів, ${d170 + d70} / 30`, 'дні рахуються сумарно; переходи між місяцями — вручну',
      `70 000 × ${d170 + d70} / 30`);
  }

  const assault = input.assaultDays || {};
  const capture = count(assault.capture);
  const restore = count(assault.restore);
  let assaultAmount = 0;
  if (new232) {
    assaultAmount += line('assault', 'capture', 'Штурм із захопленням позицій', 40000 * capture, `XXXVIII: 40 000 × ${capture}`, '', `40 000 × ${capture} ${dayWord(capture)}`);
    assaultAmount += line('assault', 'restore', 'Відновлення позицій', 20000 * restore, `XXXVIII: 20 000 × ${restore}`, '', `20 000 × ${restore} ${dayWord(restore)}`);
    if (capture + restore > days) errors.push({ field: 'assault', text: `Діб штурму (${capture + restore}) більше, ніж днів у місяці (${days}).` });
  } else if (capture + restore) {
    warnings.push(`Штурмові (XXXVIII) введено наказом №232 з ${monthTitle(RULES_232_FROM)}; за ${monthTitle(month)} їх не враховано.`);
  }

  const capped = part100 + zonalAmount + assaultAmount;
  if (new232 && capped > MONTH_CAP) {
    const excess = round2(capped - MONTH_CAP);
    lines.push({ kind: assaultAmount ? 'assault' : 'zonal', id: 'cap', title: 'Понад ліміт 460 000 (не виплачується)', amount: -excess, formula: `${sum(capped)} − 460 000`,
      basis: 'XXXVIII п.6: 100 000 + зональні + штурмові не більше 460 000 на місяць', note: 'з якої виплати зменшують, у документах не сказано' });
    warnings.push(`Сума 100 000 + зональних + штурмових (${formatMoney(capped)}) перевищує ліміт ${formatMoney(MONTH_CAP)}.`);
  }

  const kills = input.kills || {};
  const killCount = count(kills.count);
  const participants = count(kills.participants);
  if (killCount) {
    if (!participants) warnings.push('Для винагороди за знищення вкажіть кількість учасників групи.');
    else line('result', 'kills', 'Знищення', 15000 * killCount / participants, 'XL: 15 000 за кожного, рівномірно між учасниками', '', `15 000 × ${killCount} / ${participants} учасн.`);
  }
  const prisoners = amountOf(input.prisonerShare);
  if (prisoners) line('result', 'prisoners', 'Частка за взяття в полон', prisoners, 'XXXIX: 100 000 за полоненого на групу, розподіляє командир; внесено вручну', '', 'внесено вручну');

  for (const extra of Array.isArray(input.extras) ? input.extras : []) {
    const amount = amountOf(extra?.amount);
    const title = String(extra?.title ?? '').trim().slice(0, 120);
    if (amount && title) line(PAYMENT_KINDS[extra.kind] ? extra.kind : 'other', 'extra', title, amount, 'внесено вручну', '', 'внесено вручну');
  }

  const byKind = {};
  for (const item of lines) byKind[item.kind] = round2((byKind[item.kind] || 0) + item.amount);
  const total = round2(lines.reduce((sum, item) => sum + item.amount, 0));
  return { month, days, rules: new232 ? '232' : 'before-232', lines, byKind, total, warnings, errors };
}

function dayWord(value) {
  return plural(value, ['доба', 'доби', 'діб']);
}

/** Одноразова допомога при першому контракті: ПМ × 8 / 9 / 10 залежно від складу. */
export function firstContractPayment(rankId, livingMinimum = LIVING_MINIMUM_2026) {
  const rank = rankById(rankId);
  if (!rank) throw new Error('Оберіть військове звання.');
  const multiplier = FIRST_CONTRACT_MULTIPLIER[rank.staff];
  return { multiplier, amount: round2(multiplier * livingMinimum) };
}

// ---------- Журнал виплат (файл .easypay) ----------

export const LEDGER_FORMAT = 'easypay';
export const LEDGER_VERSION = 1;
export const LEDGER_EXTENSION = 'easypay';
const MAX_ITEMS = 5000;
const MAX_PAYMENTS = 50;

export function emptyLedger() {
  return { format: LEDGER_FORMAT, version: LEDGER_VERSION, profile: {}, items: [] };
}

function itemId(month, kind) {
  return `${month}:${kind}`;
}

/**
 * Записує розрахунок місяця в журнал: на кожен вид виплати — очікувана сума і строк.
 * Уже внесені надходження зберігаються, змінюється лише очікувана сума.
 */
export function addCalculation(ledger, calc, input = {}) {
  const next = cloneLedger(ledger);
  next.profile = profileFrom(input, next.profile);
  for (const [kind, amount] of Object.entries(calc.byKind)) {
    const id = itemId(calc.month, kind);
    const meta = PAYMENT_KINDS[kind] || PAYMENT_KINDS.other;
    const existing = next.items.find(item => item.id === id);
    const lines = calc.lines.filter(entry => entry.kind === kind).map(entry => ({ title: entry.title, amount: entry.amount, formula: entry.formula || '' }));
    if (existing) {
      existing.expected = amount;
      existing.lines = lines;
    } else {
      next.items.push({
        id,
        month: calc.month,
        kind,
        title: `${meta.title} за ${monthTitle(calc.month)}`,
        expected: amount,
        due: dueDate(calc.month, meta.dueDay || 20),
        dueBasis: meta.dueBasis,
        lines,
        payments: [],
        note: '',
      });
    }
  }
  next.items = next.items.filter(item => item.expected > 0 || item.payments.length || item.kind === 'other');
  sortItems(next.items);
  return next;
}

/** Інша виплата з власним строком (оздоровлення, перший контракт, борг за старий період). */
export function addCustomItem(ledger, { title, expected, due, month = '' } = {}) {
  const name = String(title ?? '').trim().slice(0, 120);
  const amount = amountOf(expected);
  if (!name) throw new Error('Вкажіть назву виплати.');
  if (!amount) throw new Error('Вкажіть суму, яку мають виплатити.');
  if (!isDate(due)) throw new Error('Вкажіть строк виплати.');
  const next = cloneLedger(ledger);
  const used = new Set(next.items.map(item => item.id));
  let index = next.items.length + 1;
  while (used.has(`custom:${index}`)) index += 1;
  next.items.push({
    id: `custom:${index}`,
    month: isMonth(month) ? month : due.slice(0, 7),
    kind: 'other',
    title: name,
    expected: amount,
    due,
    dueBasis: PAYMENT_KINDS.other.dueBasis,
    lines: [],
    payments: [],
    note: '',
  });
  sortItems(next.items);
  return next;
}

/** Надходження за пунктом журналу. */
export function addPayment(ledger, id, { date, amount, note = '' } = {}) {
  const value = amountOf(amount);
  if (!isDate(date)) throw new Error('Вкажіть дату надходження.');
  if (!value) throw new Error('Вкажіть суму надходження.');
  const next = cloneLedger(ledger);
  const item = next.items.find(entry => entry.id === id);
  if (!item) throw new Error('Пункт журналу не знайдено.');
  if (item.payments.length >= MAX_PAYMENTS) throw new Error('Забагато надходжень за одним пунктом.');
  item.payments.push({ date, amount: value, note: String(note ?? '').trim().slice(0, 200) });
  item.payments.sort((a, b) => a.date.localeCompare(b.date));
  return next;
}

export function removePayment(ledger, id, index) {
  const next = cloneLedger(ledger);
  const item = next.items.find(entry => entry.id === id);
  if (item) item.payments.splice(index, 1);
  return next;
}

export function removeItem(ledger, id) {
  const next = cloneLedger(ledger);
  next.items = next.items.filter(item => item.id !== id);
  return next;
}

export function setItemNote(ledger, id, note) {
  const next = cloneLedger(ledger);
  const item = next.items.find(entry => entry.id === id);
  if (item) item.note = String(note ?? '').trim().slice(0, 500);
  return next;
}

/**
 * Стан пункту на дату `today`: отримано, скільки ще винні, статус.
 * Статуси: paid (отримано повністю), overpaid, overdue (строк минув, виплачено не все),
 * pending (строк ще не настав).
 */
export function itemStatus(item, today) {
  const received = round2(item.payments.reduce((sum, payment) => sum + payment.amount, 0));
  const owed = round2(item.expected - received);
  const partial = received > 0 && owed > 0;
  let status;
  if (owed <= 0) status = owed < -0.009 ? 'overpaid' : 'paid';
  else status = today > item.due ? 'overdue' : 'pending';
  const overdueDays = status === 'overdue' ? daysBetween(item.due, today) : 0;
  return { received, owed: Math.max(owed, 0), status, partial, overdueDays, label: statusLabel(status, partial) };
}

export function statusLabel(status, partial = false) {
  if (status === 'paid') return 'Отримано';
  if (status === 'overpaid') return 'Отримано більше';
  if (status === 'overdue') return partial ? 'Недоплата, строк минув' : 'Прострочено';
  return partial ? 'Частково отримано' : 'Очікується';
}

/** Підсумок журналу: очікується, отримано, винні всього і з них прострочено. */
export function ledgerSummary(ledger, today) {
  const summary = { expected: 0, received: 0, owed: 0, overdue: 0, overdueItems: 0, pendingItems: 0, paidItems: 0 };
  for (const item of ledger.items) {
    const state = itemStatus(item, today);
    summary.expected += item.expected;
    summary.received += state.received;
    summary.owed += state.owed;
    if (state.status === 'overdue') {
      summary.overdue += state.owed;
      summary.overdueItems += 1;
    } else if (state.status === 'pending') summary.pendingItems += 1;
    else summary.paidItems += 1;
  }
  for (const key of ['expected', 'received', 'owed', 'overdue']) summary[key] = round2(summary[key]);
  return summary;
}

/** Фільтр списку «Мої виплати»: all — усі, debts — ще винні, received — отримані повністю. */
export function filterItems(items, filter, today) {
  if (filter === 'debts') return items.filter(item => itemStatus(item, today).owed > 0);
  if (filter === 'received') return items.filter(item => ['paid', 'overpaid'].includes(itemStatus(item, today).status));
  return items;
}

/** Пункти, згруповані за місяцем нарахування (новіші першими), з найпізнішим строком групи. */
export function groupByMonth(items) {
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.month)) groups.set(item.month, { month: item.month, due: item.due, items: [] });
    const group = groups.get(item.month);
    group.items.push(item);
    if (item.due > group.due) group.due = item.due;
  }
  return [...groups.values()].sort((a, b) => b.month.localeCompare(a.month));
}

/**
 * Дані графіка «Рік у графіку»: 12 місяців року з нарахованим і отриманим за пунктами цього
 * місяця нарахування. `hasData` = false — за місяць немає жодного пункту (це не нуль).
 */
export function yearSeries(ledger, year) {
  const months = Array.from({ length: 12 }, (_, index) => ({ month: `${year}-${String(index + 1).padStart(2, '0')}`, expected: 0, received: 0, hasData: false }));
  for (const item of ledger.items) {
    if (!item.month.startsWith(`${year}-`)) continue;
    const entry = months[Number(item.month.slice(5)) - 1];
    entry.hasData = true;
    entry.expected += item.expected;
    entry.received += item.payments.reduce((total, payment) => total + payment.amount, 0);
  }
  for (const entry of months) {
    entry.expected = round2(entry.expected);
    entry.received = round2(entry.received);
  }
  return months;
}

/** Роки, за які в журналі є пункти (новіші першими). */
export function ledgerYears(ledger) {
  return [...new Set(ledger.items.map(item => item.month.slice(0, 4)))].sort().reverse();
}

/**
 * Нагадування на дату `today`: прострочені виплати (найдавніші першими), строки в найближчі
 * `soonDays` днів і місяць, за який ще не внесено розрахунок.
 */
export function reminders(ledger, today, { soonDays = 5 } = {}) {
  const list = [];
  for (const item of ledger.items) {
    const state = itemStatus(item, today);
    if (state.status === 'overdue') {
      const advice = state.overdueDays > 30 ? ' Варто звернутися до фінансової служби з рапортом.' : '';
      list.push({
        level: 'overdue',
        id: item.id,
        date: item.due,
        days: state.overdueDays,
        text: `${item.title}: ${state.partial ? 'недоплата' : 'не надійшло'} ${formatMoney(state.owed)}, строк минув ${dateTitle(item.due)} (${state.overdueDays} дн. тому).${advice}`,
      });
    } else if (state.status === 'pending') {
      const left = daysBetween(today, item.due);
      if (left <= soonDays) {
        list.push({
          level: 'soon',
          id: item.id,
          date: item.due,
          days: left,
          text: `${item.title}: ${formatMoney(state.owed)} очікується до ${dateTitle(item.due)} (${left === 0 ? 'сьогодні' : `через ${left} дн.`}).`,
        });
      }
    }
  }
  const last = previousMonth(String(today).slice(0, 7));
  const months = new Set(ledger.items.filter(item => item.kind !== 'other').map(item => item.month));
  if (months.size && !months.has(last)) {
    list.push({ level: 'missing', id: '', date: `${last}-01`, days: 0, text: `Немає розрахунку за ${monthTitle(last)}: внесіть дані на вкладці «Розрахунок», щоб не пропустити виплату.` });
  }
  const order = { overdue: 0, soon: 1, missing: 2 };
  list.sort((a, b) => order[a.level] - order[b.level] || a.date.localeCompare(b.date));
  return list;
}

/** Байти файлу .easypay (JSON у UTF-8). */
export function serializeLedger(ledger) {
  const data = { format: LEDGER_FORMAT, version: LEDGER_VERSION, savedAt: ledger.savedAt || '', profile: ledger.profile || {}, items: ledger.items };
  return new TextEncoder().encode(`${JSON.stringify(data, null, 2)}\n`);
}

/** Розбір файлу .easypay з перевіркою; помилки — українською. */
export function parseLedger(bytes) {
  let data;
  try {
    data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new Error('Це не файл журналу easyPay (не вдалося прочитати JSON).');
  }
  if (!data || data.format !== LEDGER_FORMAT) throw new Error('Це не файл журналу easyPay.');
  if (!Number.isInteger(data.version) || data.version > LEDGER_VERSION) throw new Error('Файл створено новішою версією easyPay.');
  if (!Array.isArray(data.items) || data.items.length > MAX_ITEMS) throw new Error('Пошкоджений журнал: немає списку виплат.');
  const items = data.items.map((raw, index) => {
    const where = `Пошкоджений журнал, запис ${index + 1}`;
    if (!raw || typeof raw.id !== 'string' || !raw.id) throw new Error(`${where}: немає ідентифікатора.`);
    if (!isMonth(raw.month)) throw new Error(`${where}: неправильний місяць.`);
    if (!isDate(raw.due)) throw new Error(`${where}: неправильний строк.`);
    const expected = Number(raw.expected);
    if (!Number.isFinite(expected) || expected < 0) throw new Error(`${where}: неправильна сума.`);
    const payments = Array.isArray(raw.payments) ? raw.payments.slice(0, MAX_PAYMENTS) : [];
    return {
      id: raw.id.slice(0, 40),
      month: raw.month,
      kind: PAYMENT_KINDS[raw.kind] ? raw.kind : 'other',
      title: String(raw.title ?? '').slice(0, 120) || 'Виплата',
      expected: round2(expected),
      due: raw.due,
      dueBasis: String(raw.dueBasis ?? '').slice(0, 300),
      lines: (Array.isArray(raw.lines) ? raw.lines : []).slice(0, 40).map(entry => ({
        title: String(entry?.title ?? '').slice(0, 120),
        amount: round2(Number(entry?.amount) || 0),
        formula: String(entry?.formula ?? '').slice(0, 120),
      })),
      payments: payments.map(payment => {
        if (!isDate(payment?.date) || !(Number(payment?.amount) > 0)) throw new Error(`${where}: неправильне надходження.`);
        return { date: payment.date, amount: round2(Number(payment.amount)), note: String(payment.note ?? '').slice(0, 200) };
      }),
      note: String(raw.note ?? '').slice(0, 500),
    };
  });
  if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('Пошкоджений журнал: записи повторюються.');
  sortItems(items);
  return { format: LEDGER_FORMAT, version: LEDGER_VERSION, savedAt: String(data.savedAt ?? ''), profile: profileFrom(data.profile || {}, {}), items };
}

/** Профіль для повторного розрахунку: лише параметри окладу, без імен і номерів. */
function profileFrom(input, previous) {
  const profile = { ...previous };
  if (rankById(input.rank)) profile.rank = input.rank;
  const grade = Number(input.grade);
  if (Number.isInteger(grade) && grade >= 1 && grade <= 60) profile.grade = grade;
  const years = Number(input.years);
  if (Number.isFinite(years) && years >= 0 && years <= 60) profile.years = Math.floor(years);
  const special = Number(input.specialPct);
  if (Number.isFinite(special) && special >= 0 && special <= 100) profile.specialPct = special;
  if (input.mountain !== undefined) profile.mountain = Boolean(input.mountain);
  if (typeof input.postCode === 'string') profile.postCode = input.postCode.slice(0, 10);
  return profile;
}

function cloneLedger(ledger) {
  const source = ledger || emptyLedger();
  return {
    ...emptyLedger(),
    savedAt: source.savedAt || '',
    profile: { ...(source.profile || {}) },
    items: (source.items || []).map(item => ({ ...item, lines: [...(item.lines || [])], payments: item.payments.map(payment => ({ ...payment })) })),
  };
}

const KIND_ORDER = Object.keys(PAYMENT_KINDS);

function sortItems(items) {
  items.sort((a, b) => b.month.localeCompare(a.month) || a.due.localeCompare(b.due)
    || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.id.localeCompare(b.id));
}
