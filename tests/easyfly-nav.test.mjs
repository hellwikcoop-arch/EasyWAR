// Штурманський модуль EasyFLY: ІШР (Додаток 4), бортжурнал (Додаток 1), ШПП, вітровий трикутник,
// паливо, Сонце і Місяць офлайн, друковані HTML. Лише синтетичні дані (умовні ПЕТРЕНКО, КОВАЛЬ).
// Еталонні числа PY отримано запуском Python-прототипів ishr_core.py, bj_core.py, sun_core.py, moon_core.py.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  AIRCRAFT_TYPES,
  LANDING_CIRCUIT_KM,
  LANDING_CIRCUIT_MIN,
  calcBortjournal,
  calcIshr,
  calcShpp,
  captainText,
  equipmentWeight,
  formatHm,
  formatMmss,
  fuelBurnKg,
  kgToLiters,
  normalizeLegs,
  planScheme,
  roundHalfEven,
  routeText,
  surchargeRate,
  surchargesFor,
  turnAngle,
  validateFlight,
  windAlongTrack,
  windTriangle,
} from '../src/workspace/easyfly/nav-core.js';
import { renderBortjournalHtml, renderIshrHtml, renderShppHtml, escapeHtml } from '../src/workspace/easyfly/nav-docs.js';
import {
  ONB_DEFAULT_THRESHOLD,
  moonDay,
  onbNight,
  skyForPoints,
} from '../src/workspace/easyfly/moon-core.js';
import {
  dstEndUtc,
  dstStartUtc,
  formatDateUk,
  kyivOffsetAtUtc,
  kyivOffsetForDate,
  lastSundayOfMonth,
  parseDate,
  sunTimes,
  toKyivTime,
} from '../src/workspace/easyfly/sun-core.js';

const PY = {"ishrCols":[[null,null,null,370,62,0,0,62,2030,10697],[48,14,200,689,161,48,14,223,1869,10536],[65,18,220,689,207,113,32,430,1662,10329],[52,17,180,689,195,165,49,625,1467,10134],[70,19,220,689,218,235,68,843,1249,9916],[55,16,200,689,184,290,84,1027,1065,9732],[null,30,null,689,344,290,114,1371,721,9388]],"ishrTotals":{"q":689,"k":1.13,"cargo":1097,"fuelL":2615,"total":10759,"ok":true},"bj":[{"kz":6,"mk":39,"w":219,"tWind":"13:09","tCalc":"14:24","T":"13:09"},{"kz":-4,"mk":124,"w":244,"tWind":"15:59","tCalc":"17:44","T":"29:08"},{"kz":-9,"mk":209,"w":168,"tWind":"18:34","tCalc":"17:20","T":"47:42"},{"kz":3,"mk":287,"w":193,"tWind":"21:46","tCalc":"19:05","T":"1:09:28"},{"kz":8,"mk":2,"w":203,"tWind":"16:15","tCalc":"16:30","T":"1:25:43"}],"mmss":{"0":"0:00","0.5":"0:30","14.4":"14:24","85.7166":"1:25:43","92.7166":"1:32:43"},"wind":[[[45,200,270,28.8],[6,39,219]],[[0,100,0,36],[0,360,64]],[[90,120,350,50],[24,66,118]],[[359,150,10,20],[-1,0,130]],[[200,180,45,28.8],[4,196,206]]],"sky":[{"date":"2026-10-20","lat":50.0,"lon":30.0,"tz":3,"sun":{"nauticalDawn":"06:19","dawn":"06:56","sunrise":"07:29","sunset":"17:59","dusk":"18:32","nauticalDusk":"19:09","dayLength":"10:30"},"moon":{"rise":"15:48","set":"01:31","transit":"20:39","maxAltitude":24.6,"illumination":71,"ageDays":9.4,"phase":"зростаючий","waxing":true}},{"date":"2026-10-21","lat":50.0,"lon":30.0,"tz":3,"sun":{"nauticalDawn":"06:20","dawn":"06:58","sunrise":"07:31","sunset":"17:57","dusk":"18:30","nauticalDusk":"19:07","dayLength":"10:26"},"moon":{"rise":"16:04","set":"02:45","transit":"21:20","maxAltitude":30.0,"illumination":79,"ageDays":10.3,"phase":"зростаючий","waxing":true}},{"date":"2026-03-29","lat":50.0,"lon":30.0,"tz":3,"sun":{"nauticalDawn":"05:32","dawn":"06:11","sunrise":"06:43","sunset":"19:26","dusk":"19:59","nauticalDusk":"20:38","dayLength":"12:43"},"moon":{"rise":"15:18","set":"05:44","transit":"22:40","maxAltitude":52.2,"illumination":89,"ageDays":11.6,"phase":"зростаючий","waxing":true}},{"date":"2026-10-25","lat":50.45,"lon":30.52,"tz":2,"sun":{"nauticalDawn":"05:24","dawn":"06:02","sunrise":"06:36","sunset":"16:46","dusk":"17:20","nauticalDusk":"17:58","dayLength":"10:10"},"moon":{"rise":"15:59","set":"07:02","transit":"23:19","maxAltitude":54.7,"illumination":100,"ageDays":14.5,"phase":"повня","waxing":true}},{"date":"2026-06-21","lat":50.45,"lon":30.52,"tz":3,"sun":{"nauticalDawn":"02:52","dawn":"04:00","sunrise":"04:46","sunset":"21:13","dusk":"21:58","nauticalDusk":"23:06","dayLength":"16:27"},"moon":{"rise":"12:31","set":"00:42","transit":"18:40","maxAltitude":38.7,"illumination":50,"ageDays":7.3,"phase":"перша чверть","waxing":true}},{"date":"2026-12-21","lat":48.5,"lon":35.0,"tz":2,"sun":{"nauticalDawn":"06:11","dawn":"06:52","sunrise":"07:29","sunset":"15:46","dusk":"16:23","nauticalDusk":"17:04","dayLength":"8:18"},"moon":{"rise":"13:00","set":"05:48","transit":"21:19","maxAltitude":66.2,"illumination":93,"ageDays":12.3,"phase":"зростаючий","waxing":true}},{"date":"2026-10-10","lat":50.0,"lon":30.0,"tz":3,"sun":{"nauticalDawn":"06:03","dawn":"06:41","sunrise":"07:13","sunset":"18:19","dusk":"18:51","nauticalDusk":"19:29","dayLength":"11:06"},"moon":{"rise":"08:12","set":"17:49","transit":"12:20","maxAltitude":31.2,"illumination":0,"ageDays":0.2,"phase":"молодик","waxing":true}},{"date":"2026-10-26","lat":50.0,"lon":30.0,"tz":2,"sun":{"nauticalDawn":"05:28","dawn":"06:06","sunrise":"06:39","sunset":"16:47","dusk":"17:21","nauticalDusk":"17:58","dayLength":"10:08"},"moon":{"rise":"16:23","set":"08:31","transit":"00:19","maxAltitude":60.6,"illumination":99,"ageDays":15.6,"phase":"повня","waxing":false}},{"date":"2026-11-09","lat":50.0,"lon":30.0,"tz":2,"sun":{"nauticalDawn":"05:48","dawn":"06:27","sunrise":"07:02","sunset":"16:24","dusk":"16:59","nauticalDusk":"17:37","dayLength":"9:22"},"moon":{"rise":"08:38","set":"15:51","transit":"12:09","maxAltitude":17.7,"illumination":0,"ageDays":0.6,"phase":"молодик","waxing":true}},{"date":"2026-03-20","lat":51.4779,"lon":0.0,"tz":0,"sun":{"nauticalDawn":"04:50","dawn":"05:29","sunrise":"06:02","sunset":"18:13","dusk":"18:46","nauticalDusk":"19:25","dayLength":"12:10"},"moon":{"rise":"06:31","set":"20:34","transit":"13:19","maxAltitude":49.4,"illumination":5,"ageDays":2.1,"phase":"молодий місяць","waxing":true}},{"date":"2026-06-21","lat":70.0,"lon":30.0,"tz":3,"sun":{"nauticalDawn":null,"dawn":null,"sunrise":null,"sunset":null,"dusk":null,"nauticalDusk":null,"dayLength":null},"moon":{"rise":"12:29","set":"00:29","transit":"18:40","maxAltitude":19.1,"illumination":50,"ageDays":7.3,"phase":"перша чверть","waxing":true}},{"date":"2026-12-21","lat":70.0,"lon":30.0,"tz":2,"sun":{"nauticalDawn":"08:05","dawn":"09:54","sunrise":null,"sunset":null,"dusk":"14:01","nauticalDusk":"15:50","dayLength":null},"moon":{"rise":null,"set":null,"transit":"21:40","maxAltitude":44.7,"illumination":93,"ageDays":12.3,"phase":"зростаючий","waxing":true}}]};

/** Синтетичний політ із Python-прототипів: аер. Зоря, Дубки/Калина/Полігон/Явір, борт № 123. */
function demoFlight(extra = {}) {
  return {
    date: '2026-10-20',
    typeId: 'mi8mtv1',
    board: '123',
    callsign: 'Сокіл-21',
    exercise: '14',
    empty: 7300,
    crew: 270,
    fuelKg: 2092,
    groundMin: 10,
    reserveMin: 30,
    equipment: { trusses: 2, blocksB8V20: 2, s8: 40, armor: true },
    surcharges: ['evu', 'trussesBlock'],
    departure: { name: 'аер. Зоря', lat: 50.0, lon: 30.0 },
    legs: [
      { to: 'ППМ1 Дубки', mshk: 45, h: 300, v: 200, s: 48 },
      { to: 'ППМ2 Калина', mshk: 120, h: 300, v: 220, s: 65 },
      { to: 'ППМ3 Полігон', mshk: 200, h: 200, v: 180, s: 52, lat: 50.1, lon: 30.8 },
      { to: 'ППМ4 Явір', mshk: 290, h: 300, v: 220, s: 70 },
      { to: 'КПМ аер. Зоря', mshk: 10, h: 300, v: 200, s: 55 },
    ],
    wind: { from: 270, speedMs: 8 },
    windActual: { from: 250, speedMs: 10 },
    takeoff: '09:00',
    qfe: 748,
    qnh: 1012,
    t0: 12,
    hMin: 100,
    returnLine: 'ППМ3 Полігон',
    commander: 'капітан Андрій МЕЛЬНИК',
    navigator: 'лейтенант Тарас БОНДАР',
    checker: 'майор Ігор КОВАЛЬ',
    iasChief: { rank: 'підполковник', firstName: 'Олег', surname: 'Петренко' },
    seniorNav: { rank: 'майор', name: 'Ігор КОВАЛЬ' },
    captain: 'ПЕТРЕНКО І.П.',
    ...extra,
  };
}

const minutesOf = text => {
  const [h, m] = text.split(':').map(Number);
  return h * 60 + m;
};
/** Різниця часів «ГГ:ХВ» у хвилинах із поправкою на добу. */
const clockDiff = (a, b) => {
  const d = Math.abs(minutesOf(a) - minutesOf(b));
  return Math.min(d, 1440 - d);
};

// ---------- Паритет з Python-прототипами ----------

test('ІШР: колонки збігаються з ishr_core.py до кілограма й хвилини', () => {
  const r = calcIshr(demoFlight());
  assert.equal(r.cols.length, PY.ishrCols.length);
  r.cols.forEach((c, i) => {
    assert.deepEqual([c.s, c.t, c.v, c.q, c.legKg, c.S, c.T, c.used, c.rem, c.w], PY.ishrCols[i], `колонка ${c.name}`);
  });
  assert.equal(r.q, PY.ishrTotals.q);
  assert.equal(r.k, PY.ishrTotals.k);
  assert.equal(r.cargo, PY.ishrTotals.cargo);
  assert.equal(r.fuelL, PY.ishrTotals.fuelL);
  assert.equal(r.total, PY.ishrTotals.total);
  assert.equal(r.ok, PY.ishrTotals.ok);
  assert.deepEqual(r.cols.map(c => c.name), ['Зліт', 'ППМ1 Дубки', 'ППМ2 Калина', 'ППМ3 Полігон', 'ППМ4 Явір', 'КПМ аер. Зоря', 'НЗ']);
  assert.equal(r.typeLabel, 'Мі-8МТВ-1');
  assert.equal(r.reserveKg, 721);
});

test('Вітровий трикутник збігається з bj_core.wind_leg (кут зносу, МК випр., W)', () => {
  for (const [[mshk, v, from, u], [kz, mk, w]] of PY.wind) {
    const r = windTriangle(mshk, v, from, u);
    assert.deepEqual([r.kz, r.mk, r.w], [kz, mk % 360, w], `МШК ${mshk}, V ${v}, вітер ${from}°/${u} км/год`);
    assert.equal(r.ok, true);
  }
});

test('Бортжурнал: МК випр., W і T по вітру збігаються з bj_core.calc', () => {
  const j = calcBortjournal(demoFlight());
  j.rows.forEach((row, i) => {
    const ref = PY.bj[i];
    assert.deepEqual([row.kz, row.mk, row.w], [ref.kz, ref.mk, ref.w], row.label);
    assert.equal(formatMmss(row.tWindMin), ref.tWind);
    assert.equal(formatMmss(row.tCalcMin), ref.tCalc);
  });
  assert.equal(formatMmss(j.rows.at(-1).T), PY.bj.at(-1).T);
  assert.deepEqual(j.rows.map(r => r.rem), [1869, 1662, 1467, 1249, 1065]);
  assert.equal(j.totals.S, 290);
  assert.equal(formatMmss(j.totals.tCalcMin), '1:25:03');
  assert.equal(formatMmss(j.totals.tWindMin), '1:25:43');
  assert.equal(formatMmss(j.totals.flightMin), '1:32:43');
  assert.equal(j.totals.rem, 721);
  assert.equal(j.totals.ipmClock, '09:03');
  assert.equal(j.totals.landingClock, '10:33');
  assert.deepEqual(j.rows.map(r => r.clockPlan), ['09:16', '09:32', '09:51', '10:12', '10:29']);
});

test('mmss і округлення «до парного» повторюють Python', () => {
  for (const [key, text] of Object.entries(PY.mmss)) assert.equal(formatMmss(Number(key)), text, key);
  assert.equal(roundHalfEven(2.5), 2);
  assert.equal(roundHalfEven(3.5), 4);
  assert.equal(roundHalfEven(77.5), 78);
  assert.equal(roundHalfEven(2537.5), 2538);
  assert.equal(roundHalfEven(-0.5), 0);
  assert.equal(roundHalfEven(-1.5), -2);
  assert.equal(roundHalfEven(1.4999), 1);
});

// ---------- Вітровий трикутник ----------

test('Вітровий трикутник: без вітру, попутний, зустрічний, боковий', () => {
  assert.deepEqual(windTriangle(120, 200, 0, 0), { kz: 0, mk: 120, w: 200, ok: true });
  // вітер зі сходу (090) на курс 270: попутний
  const tail = windTriangle(270, 200, 90, 36);
  assert.equal(tail.w, 236);
  assert.equal(tail.kz, 0);
  // зустрічний: вітер із напрямку польоту
  const head = windTriangle(270, 200, 270, 36);
  assert.equal(head.w, 164);
  // боковий зліва (з півночі на курс 90): знос праворуч, МК менший (береться вліво від шляху)
  const cross = windTriangle(90, 200, 0, 36);
  assert.equal(cross.kz, 10);
  assert.equal(cross.mk, 80);
  assert.equal(cross.w, Math.round(200 * Math.cos((Math.asin(36 / 200)))));
  // вітер сильніший за швидкість ПС: шлях неможливий
  const impossible = windTriangle(90, 50, 0, 100);
  assert.equal(impossible.ok, false);
  assert.ok(Number.isNaN(impossible.w));
  // нульова швидкість ПС
  assert.equal(windTriangle(90, 0, 0, 10).ok, false);
});

test('Складова вітру вздовж шляху U: попутний «+», зустрічний «−»', () => {
  assert.equal(Math.round(windAlongTrack(90, 270, 36)), 36); // вітер із заходу, курс на схід
  assert.equal(Math.round(windAlongTrack(90, 90, 36)), -36);
  assert.equal(Math.abs(Math.round(windAlongTrack(90, 0, 36))), 0);
  assert.equal(Number(windAlongTrack(45, 270, 28.8).toFixed(2)), Number((28.8 * Math.cos(Math.PI / 4)).toFixed(2)));
});

test('Кути повороту: знак, перехід через північ, 180°', () => {
  assert.equal(turnAngle(45, 120), 75);
  assert.equal(turnAngle(290, 10), 80);
  assert.equal(turnAngle(350, 10), 20);
  assert.equal(turnAngle(10, 350), -20);
  assert.equal(turnAngle(0, 180), 180);
  assert.equal(turnAngle(180, 0), 180);
  assert.equal(turnAngle(90, 90), 0);
});

// ---------- Паливо і маса ----------

test('Паливо: Q × t / 60, літри = кг / 0,8, нарахування за типом', () => {
  assert.equal(fuelBurnKg(689, 14), 161);
  assert.equal(fuelBurnKg(370, 10), 62);
  assert.equal(fuelBurnKg(610, 60), 610);
  assert.equal(kgToLiters(62), 78);
  assert.equal(kgToLiters(2092), 2615);
  assert.equal(kgToLiters(2030), 2538);
  assert.equal(formatHm(84), '1:24');
  assert.equal(formatHm(0), '0:00');
  assert.equal(surchargeRate('evu'), 0.06);
  assert.equal(surchargeRate('posNvRv'), 0.02);
  assert.equal(surchargeRate('posDvPzu'), 0.03);
  assert.equal(surchargeRate('trusses'), 0.05);
  assert.equal(surchargeRate('trussesBlock', 'mi8mt'), 0.07);
  assert.equal(surchargeRate('trussesBlock', 'mi8msb'), 0.1);
  assert.equal(surchargeRate('ферми і блок', 'mi8mt'), 0.07);
  assert.throws(() => surchargeRate('нема'), RangeError);
  assert.deepEqual(surchargesFor({ evu: true }, { trusses: 2, blocksB8V20: 2 }), ['evu', 'trussesBlock']);
  assert.deepEqual(surchargesFor({ posNvRv: true, posDvPzu: true }, { trusses: 1 }), ['posNvRv', 'posDvPzu', 'trusses']);
  assert.deepEqual(surchargesFor({}, {}), []);
});

test('Норми Q за наказом № 38 і маса Мі-8: 13 000 / 11 100', () => {
  const byId = Object.fromEntries(AIRCRAFT_TYPES.map(t => [t.id, t]));
  assert.deepEqual([byId.mi8mtv1.qAir, byId.mi8mtv1.qGround], [610, 370]);
  assert.deepEqual([byId.mi8msbv.qAir, byId.mi8msbv.qGround], [610, 390]);
  assert.deepEqual([byId.mi8mtpb.qAir, byId.mi8mtpb.qGround], [770, 360]);
  assert.deepEqual([byId.mi2msb.qAir, byId.mi2msb.qGround], [285, 150]);
  assert.equal(byId.mi8mtv5.label, 'Мі-8МТВ-5-1');
  assert.equal(byId.mi8mtv5.mtow, 13000);
  assert.equal(byId.mi8mtv5.normalMass, 11100);
  assert.notEqual(byId.mi8mtv5.normalMass, 13100);
  assert.equal(byId.mi8mtv1.fuel.main.kg, 2092);
  assert.equal(byId.mi8mtv1.fuel.main.l, 2615);
});

test('Вага вантажу й спорядження; перевірка маси та запасу палива', () => {
  assert.equal(Math.round(equipmentWeight({ trusses: 2, blocksB8V20: 2, s8: 40, armor: true })), 1097);
  assert.equal(equipmentWeight({ beamHolders: 2, s13: 2 }, 10), 70 + 114 + 10);
  assert.equal(equipmentWeight({ blocksB8V20: 1, b8v20Shells: 20 }), 120);
  assert.equal(equipmentWeight({}, 0), 0);
  const heavy = calcIshr(demoFlight({ empty: 9000, crew: 270 }));
  assert.equal(heavy.total, 12459);
  assert.equal(heavy.massOk, true);
  const over = calcIshr(demoFlight({ empty: 9600 }));
  assert.equal(over.massOk, false);
  assert.equal(over.ok, false);
  const dry = calcIshr(demoFlight({ fuelKg: 900 }));
  assert.equal(dry.fuelOk, false);
  assert.equal(dry.ok, false);
  assert.throws(() => calcIshr({ typeId: 'нема', empty: 1, fuelKg: 1, legs: [] }), RangeError);
  assert.equal(calcIshr(demoFlight({ typeId: 'mi2msb', empty: 2500, fuelKg: 480, surcharges: [], equipment: {} })).mtow, null);
  assert.equal(calcIshr(demoFlight({ mtow: 12000, empty: 9000 })).massOk, false);
});

// ---------- Посадка на майданчик ----------

test('Посадка на майданчик: +5 км / +5 хв до посадки і після зльоту', () => {
  assert.equal(LANDING_CIRCUIT_KM, 5);
  assert.equal(LANDING_CIRCUIT_MIN, 5);
  const flight = demoFlight({ legs: demoFlight().legs.map((l, i) => (i === 1 ? { ...l, landing: true } : l)) });
  const legs = normalizeLegs(flight);
  assert.deepEqual(legs.map(l => [l.extraKm, l.extraMin]), [[0, 0], [5, 5], [5, 5], [0, 0], [0, 0]]);
  const base = calcIshr(demoFlight());
  const r = calcIshr(flight);
  assert.equal(r.hasLanding, true);
  assert.equal(base.hasLanding, false);
  assert.equal(r.cols[2].name, 'ППМ2 Калина (посадка)');
  assert.deepEqual([r.cols[2].s, r.cols[2].t], [70, 23]); // 65 км / 18 хв + 5 / 5
  assert.deepEqual([r.cols[3].s, r.cols[3].t], [57, 22]); // 52 км / 17 хв + 5 / 5 після зльоту
  assert.equal(r.cols[5].S, 300);
  assert.equal(r.cols[5].T, base.cols[5].T + 10);
  assert.ok(r.cols[5].used > base.cols[5].used);
  assert.equal(r.cols[2].legKg, fuelBurnKg(r.q, 23));
  const j = calcBortjournal(flight);
  assert.equal(j.totals.S, 300);
  assert.ok(Math.abs(j.rows[1].tCalcMin - (65 / 220 * 60 + 5)) < 1e-9);
  const shpp = calcShpp(flight);
  assert.equal(shpp.hasLanding, true);
  assert.match(shpp.legs[1].note, /посадка/);
  assert.match(shpp.legs[2].note, /після зльоту 5 км \/ 5 хв/);
  assert.equal(shpp.legs[1].s, 70);
  assert.equal(shpp.legs[1].t, 23);
  // посадка в кінці маршруту на аеродромі — звичайна: без кола
  assert.equal(calcShpp(demoFlight()).legs[4].note, 'посадка');
});

// ---------- Опис маршруту ----------

test('Позначення пунктів: ВПМ, ППМ n, КО, КПМ; назви й маршрут через дефіс', () => {
  const flight = {
    departure: 'Київ',
    legs: [
      { name: 'Рахів', mshk: 270, h: 300, v: 200, s: 100 },
      { name: 'Орієнтир', kind: 'ko', mshk: 270, h: 300, v: 200, s: 50 },
      { name: 'Макаків', mshk: 180, h: 300, v: 200, s: 80 },
      { name: 'Вінниця', mshk: 90, h: 300, v: 200, s: 90 },
    ],
  };
  const legs = normalizeLegs(flight);
  assert.deepEqual(legs.map(l => l.code), ['ППМ 1', 'КО', 'ППМ 2', 'КПМ']);
  assert.deepEqual(legs.map(l => l.label), ['ППМ 1 Рахів', 'КО Орієнтир', 'ППМ 2 Макаків', 'КПМ Вінниця']);
  assert.equal(routeText(flight), 'Київ – ППМ 1 Рахів – КО Орієнтир – ППМ 2 Макаків – КПМ Вінниця');
  assert.equal(calcShpp(flight).routeText, 'Київ-Рахів-Орієнтир-Макаків-Вінниця');
  // старий формат із префіксом у `to`
  const old = normalizeLegs(demoFlight());
  assert.deepEqual(old.map(l => l.name), ['Дубки', 'Калина', 'Полігон', 'Явір', 'аер. Зоря']);
  assert.deepEqual(old.map(l => l.kind), ['ppm', 'ppm', 'ppm', 'ppm', 'kpm']);
});

test('Перевірка опису польоту повертає зрозумілі повідомлення', () => {
  assert.deepEqual(validateFlight(demoFlight()), []);
  const bad = validateFlight({ legs: [{ to: 'ППМ1 А', mshk: 10, v: 0, s: -1 }] });
  assert.ok(bad.some(m => m.includes('тип ПС')));
  assert.ok(bad.some(m => m.includes('вагу порожнього')));
  assert.ok(bad.some(m => m.includes('швидкість')));
  assert.ok(bad.some(m => m.includes('відстань')));
  assert.ok(validateFlight({ typeId: 'mi8mtv1', empty: 7000, fuelKg: 1000, legs: [] }).some(m => m.includes('немає жодної ділянки')));
});

// ---------- ШПП ----------

test('ШПП: кути повороту, поправки на вітер, шапка і підпис капітана', () => {
  const p = calcShpp(demoFlight());
  assert.equal(p.title, 'ШТУРМАНСЬКИЙ ПЛАН ПОЛЬОТУ');
  assert.equal(p.routeText, 'аер. Зоря-Дубки-Калина-Полігон-Явір-аер. Зоря');
  assert.equal(p.captainLine, 'капітана ПЕТРЕНКО І.П.');
  assert.deepEqual(p.legs.map(l => l.turnBefore), [null, 75, 80, 90, 80]);
  assert.deepEqual(p.legs.map(l => l.from.code), ['ВПМ', 'ППМ 1', 'ППМ 2', 'ППМ 3', 'ППМ 4']);
  assert.deepEqual(p.legs.map(l => l.to.code), ['ППМ 1', 'ППМ 2', 'ППМ 3', 'ППМ 4', 'КПМ']);
  // поправка на вітер = МК випр. − МШК = −КЗ (за розрахунковим вітром 270°/8 м/с)
  const j = calcBortjournal(demoFlight());
  assert.deepEqual(p.legs.map(l => l.windCorrR), j.rows.map(row => -row.kz));
  assert.deepEqual(p.legs.map(l => l.windCorrR), [-6, 4, 9, -3, -8]);
  assert.deepEqual([p.totals.S, p.totals.T], [290, 84]);
  assert.equal(captainText({ surname: 'Коваль', initials: 'О.І.' }), 'КОВАЛЬ О.І.');
  assert.equal(calcShpp(demoFlight({ captain: { surname: 'Коваль', initials: 'О.І.' }, captainRankGen: 'майора' })).captainLine, 'майора КОВАЛЬ О.І.');
});

test('ШПП: таблиця Wр / Wи — W = V + U, потрібна W = S / t, V потр. = W − U', () => {
  const flight = demoFlight();
  const p = calcShpp(flight);
  const uR = 8 * 3.6;
  const uI = 10 * 3.6;
  const along = (track, from, u) => u * Math.cos(((from + 180 - track) * Math.PI) / 180);
  p.legs.forEach((leg, i) => {
    const src = flight.legs[i];
    const tPlan = calcIshr(flight).cols[i + 1].t;
    const UR = along(src.mshk, 270, uR);
    const UI = along(src.mshk, 250, uI);
    assert.equal(leg.wR, roundHalfEven(src.v + UR), `Wр ${i + 1}`);
    assert.equal(leg.wI, roundHalfEven(src.v + UI), `Wи ${i + 1}`);
    assert.equal(leg.uR, Math.round(UR * 10) / 10);
    assert.equal(leg.uI, Math.round(UI * 10) / 10);
    const wNeed = src.s / (tPlan / 60);
    assert.equal(leg.wNeed, roundHalfEven(wNeed));
    assert.equal(leg.vNeedR, roundHalfEven(wNeed - UR));
    assert.equal(leg.vNeedI, roundHalfEven(wNeed - UI));
    assert.equal(leg.t, tPlan);
  });
  assert.deepEqual([p.legs[0].wR, p.legs[0].wI, p.legs[0].wNeed, p.legs[0].vNeedI], [220, 233, 206, 173]);
  // без виправленого вітру Wи = Wр
  const same = calcShpp(demoFlight({ windActual: undefined }));
  same.legs.forEach(leg => assert.equal(leg.wI, leg.wR));
  // без вітру взагалі W = V
  const calm = calcShpp(demoFlight({ wind: undefined, windActual: undefined }));
  calm.legs.forEach((leg, i) => {
    assert.equal(leg.wR, flight.legs[i].v);
    assert.equal(leg.uR, 0);
    assert.equal(leg.windCorrR, 0);
  });
  // заданий час (tTarget) змінює потрібну швидкість
  const fast = calcShpp(demoFlight({ legs: demoFlight().legs.map((l, i) => (i === 0 ? { ...l, tTarget: 12 } : l)) }));
  assert.equal(fast.legs[0].t, 12);
  assert.equal(fast.legs[0].wNeed, 240);
  // залишки відстані й часу
  assert.deepEqual(p.legs.map(l => l.sRemaining), [242, 177, 125, 55, 0]);
  assert.deepEqual(p.legs.map(l => l.tRemaining), [70, 52, 35, 16, 0]);
});

test('ШПП: стрілки швидкості й висоти відносно попередньої ділянки', () => {
  const p = calcShpp(demoFlight());
  // висота: 0 → 300 ↑, 300 → 300 —, 300 → 200 ↓, 200 → 300 ↑, 300 → 300 (посадка ↓)
  assert.deepEqual(p.legs.map(l => l.heightArrow), ['↑', '', '↓', '↑', '']);
  assert.deepEqual(p.legs.map(l => l.landingArrow), ['', '', '', '', '↓']);
  // швидкість: перша ділянка без стрілки; далі за зміною V, яку треба тримати
  assert.equal(p.legs[0].speedArrow, '');
  p.legs.slice(1).forEach((leg, i) => {
    const prev = p.legs[i];
    const expected = leg.vNeedI > prev.vNeedI ? '↑' : leg.vNeedI < prev.vNeedI ? '↓' : '';
    assert.equal(leg.speedArrow, expected, `ділянка ${i + 2}`);
  });
  assert.equal(p.legs[1].speedArrow, '↑');
});

test('ШПП: схема — масштаб за відстанню, поворот, межі аркуша, без накладань рамок висот', () => {
  const p = calcShpp(demoFlight());
  const sc = planScheme(p);
  assert.equal(sc.points.length, 6);
  assert.equal(sc.segments.length, 5);
  assert.equal(sc.rotation % 5, 0);
  for (const pt of sc.points) {
    assert.ok(pt.x >= 80 && pt.x <= sc.width - 80, `x ${pt.x}`);
    assert.ok(pt.y >= 60 && pt.y <= sc.height - 60, `y ${pt.y}`);
  }
  p.legs.forEach((leg, i) => {
    assert.ok(Math.abs(sc.segments[i].length / sc.scale - leg.s) < 0.2, `довжина ділянки ${i + 1}`);
    // кут лінії на екрані = МК + поворот схеми
    const expected = (((leg.mk + sc.rotation - 90) % 360) + 360) % 360;
    const actual = ((sc.segments[i].angle % 360) + 360) % 360;
    assert.ok(Math.min(Math.abs(expected - actual), 360 - Math.abs(expected - actual)) < 0.6, `напрям ${i + 1}`);
  });
  assert.equal(sc.labels.legLabels.length, 5);
  assert.equal(sc.labels.pointLabels.length, 6);
  assert.equal(sc.turns.length, 4);
  const boxes = sc.labels.heightBoxes;
  for (let i = 0; i < boxes.length; i += 1) {
    for (let k = i + 1; k < boxes.length; k += 1) {
      const a = boxes[i];
      const b = boxes[k];
      const overlap = Math.abs(a.cx - b.cx) < (a.w + b.w) / 2 && Math.abs(a.cy - b.cy) < (a.h + b.h) / 2;
      assert.equal(overlap, false, `рамки висот ${i + 1} і ${k + 1} перекриваються`);
    }
  }
  // детермінованість
  assert.deepEqual(planScheme(p), sc);
});

test('ШПП: маршрут вздовж меридіана повертається горизонтально, прямий схід — без повороту', () => {
  const north = calcShpp({ typeId: 'mi8mtv1', empty: 7000, fuelKg: 2000, departure: 'А', legs: [{ name: 'Б', mshk: 0, h: 300, v: 200, s: 200 }] });
  const scNorth = planScheme(north);
  const turned = scNorth.rotation >= 60 && scNorth.rotation <= 120 || scNorth.rotation >= 240 && scNorth.rotation <= 300;
  assert.ok(turned, `поворот ${scNorth.rotation}`);
  assert.ok(Math.abs(scNorth.segments[0].x2 - scNorth.segments[0].x1) > 750);
  assert.ok(Math.abs(scNorth.segments[0].y2 - scNorth.segments[0].y1) < 260);
  const east = calcShpp({ typeId: 'mi8mtv1', empty: 7000, fuelKg: 2000, departure: 'А', legs: [{ name: 'Б', mshk: 90, h: 300, v: 200, s: 200 }] });
  assert.equal(planScheme(east).rotation, 0);
  // одна нульова ділянка не ламає схему
  const zero = planScheme(calcShpp({ typeId: 'mi8mtv1', empty: 7000, fuelKg: 2000, departure: 'А', legs: [{ name: 'Б', mshk: 90, h: 0, v: 200, s: 0 }] }));
  assert.equal(zero.points.length, 2);
  assert.ok(Number.isFinite(zero.scale));
});

// ---------- Київський час і літній час ----------

test('Літній час ЄС: остання неділя березня 01:00 UTC → остання неділя жовтня 01:00 UTC', () => {
  assert.equal(lastSundayOfMonth(2026, 3), 29);
  assert.equal(lastSundayOfMonth(2026, 10), 25);
  assert.equal(lastSundayOfMonth(2027, 3), 28);
  assert.equal(lastSundayOfMonth(2027, 10), 31);
  assert.equal(lastSundayOfMonth(2024, 3), 31);
  assert.equal(lastSundayOfMonth(2024, 10), 27);
  assert.equal(dstStartUtc(2026), Date.UTC(2026, 2, 29, 1, 0, 0));
  assert.equal(dstEndUtc(2026), Date.UTC(2026, 9, 25, 1, 0, 0));
  assert.equal(kyivOffsetAtUtc(Date.UTC(2026, 2, 29, 0, 59, 59, 999)), 2);
  assert.equal(kyivOffsetAtUtc(Date.UTC(2026, 2, 29, 1, 0, 0)), 3);
  assert.equal(kyivOffsetAtUtc(Date.UTC(2026, 9, 25, 0, 59, 59, 999)), 3);
  assert.equal(kyivOffsetAtUtc(Date.UTC(2026, 9, 25, 1, 0, 0)), 2);
  assert.equal(kyivOffsetAtUtc(Date.UTC(2026, 0, 15, 12)), 2);
  assert.equal(kyivOffsetAtUtc(Date.UTC(2026, 6, 15, 12)), 3);
  assert.equal(kyivOffsetAtUtc(Date.UTC(2027, 2, 28, 1, 0, 0)), 3);
  assert.equal(kyivOffsetAtUtc(Date.UTC(2027, 9, 31, 1, 0, 0)), 2);
});

test('Київський час: зсув за датою збігається з прототипом, перехід у день зміни', () => {
  const cases = { '2026-03-28': 2, '2026-03-29': 3, '2026-10-24': 3, '2026-10-25': 2, '2027-03-28': 3, '2027-10-31': 2, '2026-07-01': 3, '2026-12-31': 2 };
  for (const [date, offset] of Object.entries(cases)) assert.equal(kyivOffsetForDate(date), offset, date);
  assert.equal(toKyivTime(Date.UTC(2026, 9, 25, 0, 30)).text, '25.10.2026 03:30');
  assert.equal(toKyivTime(Date.UTC(2026, 9, 25, 1, 0)).text, '25.10.2026 03:00');
  assert.equal(toKyivTime(Date.UTC(2026, 2, 29, 0, 59)).text, '29.03.2026 02:59');
  assert.equal(toKyivTime(Date.UTC(2026, 2, 29, 1, 0)).text, '29.03.2026 04:00');
  assert.equal(toKyivTime(Date.UTC(2026, 11, 31, 22, 30)).text, '01.01.2027 00:30');
});

test('Дати: розбір «РРРР-ММ-ДД» і «ДД.ММ.РРРР», перевірка існування', () => {
  assert.deepEqual(parseDate('2026-10-20'), { year: 2026, month: 10, day: 20 });
  assert.deepEqual(parseDate('20.10.2026'), { year: 2026, month: 10, day: 20 });
  assert.equal(parseDate('2026-02-30'), null);
  assert.equal(parseDate('31.04.2026'), null);
  assert.equal(parseDate(''), null);
  assert.equal(parseDate(null), null);
  assert.equal(formatDateUk('2026-10-20'), '20.10.2026');
  assert.equal(formatDateUk('нема'), '');
});

// ---------- Сонце і Місяць ----------

test('Сонце: збігається з sun_core.py на фіксованих датах (допуск ±2 хв)', () => {
  for (const c of PY.sky) {
    const s = sunTimes(c.date, c.lat, c.lon, c.tz);
    for (const [key, expected] of Object.entries(c.sun)) {
      if (expected === null || expected === undefined) {
        assert.equal(s[key] ?? null, null, `${c.date} ${key}`);
      } else if (key === 'dayLength') {
        assert.ok(Math.abs(minutesOf(s.dayLength) - minutesOf(expected)) <= 1, `${c.date} тривалість дня`);
      } else {
        assert.ok(clockDiff(s[key], expected) <= 2, `${c.date} ${c.lat}/${c.lon} ${key}: ${s[key]} ≠ ${expected}`);
      }
    }
  }
});

test('Сонце: 20.10.2026, Київ-широта 50°/30° — відомі значення прототипу й екрана', () => {
  const s = sunTimes('2026-10-20', 50, 30);
  assert.equal(s.tzHours, 3);
  assert.deepEqual([s.nauticalDawn, s.dawn, s.sunrise, s.sunset, s.dusk, s.nauticalDusk, s.dayLength], ['06:19', '06:56', '07:29', '17:59', '18:32', '19:09', '10:30']);
  // без зсуву — київський з літнім часом: 25.10 уже зимовий
  assert.equal(sunTimes('2026-10-25', 50, 30).tzHours, 2);
  // Гринвіч, рівнодення 20.03.2026: довідкові 06:01 / 18:12 UTC
  const g = sunTimes('2026-03-20', 51.4779, 0, 0);
  assert.ok(clockDiff(g.sunrise, '06:01') <= 2);
  assert.ok(clockDiff(g.sunset, '18:12') <= 2);
  // полярний день і полярна ніч
  const polar = sunTimes('2026-06-21', 70, 30);
  assert.equal(polar.sunrise, null);
  assert.equal(polar.sunset, null);
  assert.equal(polar.dayLength, null);
  assert.equal(sunTimes('2026-12-21', 70, 30).sunrise, null);
  assert.throws(() => sunTimes('2026-13-40', 50, 30), RangeError);
});

test('Місяць: збігається з moon_core.py на фіксованих датах (допуск ±2 хв)', () => {
  for (const c of PY.sky) {
    const m = moonDay(c.date, c.lat, c.lon, c.tz);
    const e = c.moon;
    for (const key of ['rise', 'set', 'transit']) {
      if (e[key] === null) assert.equal(m[key], null, `${c.date} ${key}`);
      else assert.ok(clockDiff(m[key], e[key]) <= 2, `${c.date} ${key}: ${m[key]} ≠ ${e[key]}`);
    }
    assert.ok(Math.abs(m.maxAltitude - e.maxAltitude) < 0.15, `${c.date} макс. висота`);
    assert.equal(m.illumination, e.illumination, `${c.date} освітленість`);
    assert.equal(m.ageDays, e.ageDays);
    assert.equal(m.phase, e.phase);
    assert.equal(m.waxing, e.waxing);
  }
});

test('Місяць: 20.10.2026 — схід 15:48, захід 01:31 наступної доби, 71 %, зростаючий, вік 9,4', () => {
  const m = moonDay('2026-10-20', 50, 30);
  assert.equal(m.rise, '15:48');
  assert.equal(m.set, '01:31');
  assert.equal(m.setNextDay, true);
  assert.equal(m.riseNextDay, false);
  assert.equal(m.illumination, 71);
  assert.equal(m.ageDays, 9.4);
  assert.equal(m.phase, 'зростаючий');
  assert.equal(m.waxing, true);
  assert.ok(clockDiff(m.transit, '20:39') <= 2);
  assert.ok(Math.abs(m.maxAltitude - 24.6) < 0.15);
  // 21.10 захід о 02:45 (прототип)
  assert.ok(clockDiff(moonDay('2026-10-21', 50, 30).set, '02:45') <= 2);
  // молодик і повня за астрономічним календарем
  assert.equal(moonDay('2026-10-10', 50, 30).illumination, 0);
  assert.equal(moonDay('2026-11-09', 50, 30).illumination, 0);
  assert.equal(moonDay('2026-10-26', 50, 30).illumination, 99);
  assert.equal(moonDay('2026-10-26', 50, 30).phase, 'повня');
  assert.equal(moonDay('2026-10-26', 50, 30).waxing, false);
});

test('ОНБ: довідковий індикатор за освітленістю (поріг 50 %) і Місяць над горизонтом у темряві', () => {
  assert.equal(ONB_DEFAULT_THRESHOLD, 50);
  const n = onbNight('2026-10-20', 50, 30);
  assert.equal(n.favourable, true);
  assert.equal(n.illumination, 71);
  assert.equal(n.threshold, 50);
  assert.equal(n.moonInDarkText, '18:32–01:31 (+1)');
  assert.equal(n.moonInDark.length, 1);
  assert.equal(n.moonInDark[0].from, '18:32');
  // налаштовуваний поріг
  assert.equal(onbNight('2026-10-20', 50, 30, { threshold: 80 }).favourable, false);
  assert.equal(onbNight('2026-10-20', 50, 30, { threshold: 71 }).favourable, true);
  // молодик: освітленість 0, нічого не підсвічується
  const newMoon = onbNight('2026-10-10', 50, 30);
  assert.equal(newMoon.favourable, false);
  assert.equal(newMoon.illumination, 0);
  // повня: освітленість 99, Місяць над горизонтом усю темряву
  const full = onbNight('2026-10-26', 50, 30);
  assert.equal(full.favourable, true);
  assert.ok(full.moonInDark.length >= 1);
});

test('Сонце і Місяць для п\'яти точок маршруту', () => {
  const points = [
    { name: 'Зоря', lat: 50.0, lon: 30.0 },
    { name: 'Дубки', lat: 50.2, lon: 30.2 },
    { name: 'Калина', lat: 50.4, lon: 30.5 },
    { name: 'Полігон', lat: 50.1, lon: 30.8 },
    { name: 'Явір', lat: 49.8, lon: 30.3 },
  ];
  const rows = skyForPoints('2026-10-20', points);
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map(r => r.name), ['Зоря', 'Дубки', 'Калина', 'Полігон', 'Явір']);
  for (const row of rows) {
    assert.match(row.sunrise, /^\d\d:\d\d$/);
    assert.match(row.sunset, /^\d\d:\d\d$/);
    assert.equal(row.illumination, 71);
    assert.equal(row.phase, 'зростаючий');
  }
  assert.equal(rows[0].sunrise, '07:29');
  assert.equal(rows[0].sunset, '17:59');
  assert.ok(minutesOf(rows[3].sunrise) < minutesOf(rows[0].sunrise)); // східніше — раніше
  assert.deepEqual(skyForPoints('2026-10-20', []), []);
});

// ---------- Друковані документи ----------

const MUST_BE_CLEAN = [/synthetic/i, /демо/i, /demo/i, /формул/i, /prototype/i];

test('ІШР: заголовки, рядки, підписи; без приміток про формули і позначок «synthetic»', () => {
  const html = renderIshrHtml(demoFlight());
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<html lang="uk">/);
  for (const text of [
    'Додаток 4',
    'до Правил штурманського забезпечення польотів державної авіації України',
    '(пункт 8 глави 9 розділу ІV)',
    'Інженерно-штурманський розрахунок польоту',
    'Розрахунок польотної ваги (кг)',
    'Вага порожнього ПС',
    'Вага екіпажу',
    'Вага палива, кг',
    'Вага палива, л',
    'Вага вантажу',
    'РАЗОМ',
    'Маршрут польоту',
    'Контрольні рубежі',
    'S по етапах (км)',
    'Т по етапах (хв.)',
    'Швидкість за приладами Vпр (км/год)',
    'Q, кг/год',
    'Витрата палива по ділянках (кг)',
    'Витрата палива по ділянках (л)',
    'S, км (загальна)',
    'Т (год/хв.) (загальний)',
    'Витрати палива (кг)',
    'Витрати палива (л)',
    'Залишок палива (кг)',
    'Залишок палива (л)',
    'Польотна вага вертольоту, кг',
    'Зліт',
    'ППМ1 Дубки',
    'КПМ аер. Зоря',
    'НЗ',
    'Заступник командира авіаційної частини з ІАС – начальник ІАС',
    'Старший штурман (штурман) авіаційної частини',
    'підполковник',
    'Олег ПЕТРЕНКО',
    'Ігор КОВАЛЬ',
    '20.10.2026',
    'Мі-8МТВ-1',
    'борт № 123',
    '10759',
    '2615',
    '1097',
    '1:24',
    '@page{size:A4 landscape',
    'Times New Roman',
  ]) {
    assert.ok(html.includes(text), `ІШР не містить «${text}»`);
  }
  for (const re of MUST_BE_CLEAN) assert.doesNotMatch(html, re);
  // шапка заповнена: підписів-назв немає
  assert.doesNotMatch(html, /\(дата\)/);
  assert.doesNotMatch(html, /\(тип ПС\)/);
  // 13 рядків таблиці + заголовок рубежів
  assert.equal((html.match(/<th>[^<]*<\/th>/g) || []).length >= 13, true);
});

test('ІШР: підписи «(дата)» і «(тип ПС)» лише біля порожніх полів; підписанти необов\'язкові', () => {
  const html = renderIshrHtml(demoFlight({ date: '', typeId: undefined, typeLabel: '', qAir: 610, qGround: 370, board: '', iasChief: undefined, seniorNav: undefined }));
  assert.match(html, /\(дата\)/);
  assert.match(html, /\(тип ПС\)/);
  assert.match(html, /борт № ______/);
  assert.match(html, /Заступник командира авіаційної частини з ІАС/);
  assert.doesNotMatch(html, /підполковник/);
  assert.equal((html.match(/class="ln"/g) || []).length, 2);
});

test('ІШР: посадка на майданчик показана в рубежах і в маршруті', () => {
  const flight = demoFlight({ legs: demoFlight().legs.map((l, i) => (i === 1 ? { ...l, landing: true } : l)) });
  const html = renderIshrHtml(flight);
  assert.ok(html.includes('ППМ2 Калина (посадка)'));
  assert.ok(html.includes('Посадка на майданчик: ППМ2 Калина'));
  assert.ok(html.includes('>70<'));
  assert.ok(html.includes('>23<'));
});

test('Бортжурнал: заголовки блоків, колонки, рядки, підсумки', () => {
  const html = renderBortjournalHtml(demoFlight());
  for (const text of [
    'Додаток 1',
    '(пункт 25 глави 2 розділу ІІІ)',
    'БОРТОВИЙ ЖУРНАЛ ШТУРМАНА',
    'Готовність до польоту перевірив',
    'майор Ігор КОВАЛЬ',
    'Маршрут польоту:',
    'Командир повітряного судна: капітан Андрій МЕЛЬНИК',
    'Штурман: лейтенант Тарас БОНДАР',
    'Позивний: Сокіл-21',
    'Повітряне судно Мі-8МТВ-1 № 123',
    'Впр № 14',
    'Розрахунок польоту',
    'З урахуванням вітру',
    'Записи в польоті',
    '>маршрут<',
    '>МК<',
    '>Н (м)<',
    '>V (км/год)<',
    '>S (км)<',
    '>T (хв/с)<',
    '>залишок палива<',
    '>МК випр.<',
    '>W (км/год)<',
    '>місце<',
    '>МШК<',
    '>КЗ<',
    '>розр.<',
    '>факт.<',
    'РQFE = &nbsp; РQNH = &nbsp; δ° = &nbsp; u =',
    'РQFE = 748 мм рт. ст.',
    'РQNH = 1012 гПа',
    'δ° = 270°',
    'u = 8 м/с',
    't₀ = +12 °C',
    'ВПМ аер. Зоря',
    'ППМ3 Полігон',
    'Усього за маршрутом',
    '1:25:03',
    '1:25:43',
    '1:32:43',
    'Посадка',
    '09:16',
    '10:33',
    'Нмін. = 100 м',
    'Рубіж повернення: ППМ3 Полігон',
    'Запас палива = 721 кг',
    'Тзаг. = 1:32:43',
    'Тпольоту = 1:32:43',
    'Пункти',
    'Схід',
    'Захід',
    'Підпис штурмана',
    '@page{size:A4 landscape',
    'Times New Roman',
  ]) {
    assert.ok(html.includes(text), `Бортжурнал не містить «${text}»`);
  }
  for (const re of MUST_BE_CLEAN) assert.doesNotMatch(html, re);
  // 12 пронумерованих рядків «місце»
  for (let n = 1; n <= 12; n += 1) assert.ok(html.includes(`<td class="l">${n}</td>`), `немає рядка ${n}`);
  assert.ok(!html.includes('<td class="l">13</td>'));
  // кожен рядок має 19 комірок (18 колонок + РQFE…)
  const rows = html.split('<tr>').slice(1).filter(row => row.includes('</td>') && !row.includes('<th'));
  assert.ok(rows.length >= 15);
  for (const row of rows.slice(0, 14)) assert.equal((row.match(/<td/g) || []).length, 19);
  // МК випр., W і T з урахуванням вітру
  assert.ok(html.includes('<td>39</td><td>219</td><td>13:09</td>'));
  assert.ok(html.includes('<td>124</td><td>244</td><td>15:59</td>'));
  assert.ok(html.includes('<td>2</td><td>203</td><td>16:15</td>'));
});

test('Бортжурнал: порожні поля шапки — підкреслення; пункти схід/захід з координат', () => {
  const html = renderBortjournalHtml(demoFlight({ commander: '', navigator: '', callsign: '', exercise: '', checker: '', takeoff: '', qfe: undefined, qnh: undefined, t0: undefined }));
  assert.match(html, /Командир повітряного судна: ____________/);
  assert.match(html, /Впр № ____/);
  assert.match(renderBortjournalHtml(demoFlight({ date: '' })), /«____» ____________ 20___ р\./);
  // схід/захід за координатами аеродрому й пункту з координатами (07:29/17:59 і 07:26/17:55)
  assert.ok(html.includes('<td class="l">аер. Зоря</td><td>07:29</td><td>17:59</td>'));
  assert.ok(html.includes('<td class="l">Полігон</td><td>07:26</td><td>17:55</td>'));
  // явно задані пункти мають перевагу
  const given = renderBortjournalHtml(demoFlight({ sun: [{ name: 'Майданчик', rise: '07:30', set: '18:00' }, ['Інший', '07:31', '18:01']] }));
  assert.ok(given.includes('<td class="l">Майданчик</td><td>07:30</td><td>18:00</td>'));
  assert.ok(given.includes('<td class="l">Інший</td><td>07:31</td><td>18:01</td>'));
});

test('Бортжурнал: вітер сильніший за швидкість — комірки вітру порожні, повідомлення в issues', () => {
  const flight = demoFlight({ wind: { from: 270, speedMs: 80 } });
  const j = calcBortjournal(flight);
  assert.ok(j.issues.length > 0);
  assert.equal(j.totals.tWindMin, null);
  const html = renderBortjournalHtml(flight);
  assert.ok(html.includes('БОРТОВИЙ ЖУРНАЛ ШТУРМАНА'));
  assert.doesNotMatch(html, /NaN/);
});

test('ШПП: шапка, схема SVG, таблиця Wр / Wи, позначення пунктів', () => {
  const html = renderShppHtml(demoFlight());
  for (const text of [
    'ШТУРМАНСЬКИЙ ПЛАН ПОЛЬОТУ',
    'по маршруту: аер. Зоря-Дубки-Калина-Полігон-Явір-аер. Зоря',
    'капітана ПЕТРЕНКО І.П.',
    '<svg',
    '</svg>',
    'viewBox="0 0 1000',
    'Схема маршруту',
    'ВПМ',
    '<tspan font-weight="700">ППМ 1</tspan>',
    '<tspan font-weight="700">КПМ</tspan>',
    '>Пн<',
    ' км<',
    'МК 45°',
    'МК 120°',
    '48 км · 14 хв',
    '∠ 75° вправо',
    '∠ 80° вправо',
    'Wр (розрахунковий вітер)',
    'Wи (виправлений вітер)',
    '>U<',
    '>Wр<',
    '>Wи<',
    'W потр. = S / t',
    'V потр. = W − U',
    'Поправка на вітер',
    'Кут повороту',
    'ВПМ аер. Зоря → ППМ 1 Дубки',
    'ППМ 4 Явір → КПМ аер. Зоря',
    '<b>220</b>',
    '<b>233</b>',
    'Разом',
    '@page{size:A4 landscape',
    'Times New Roman',
  ]) {
    assert.ok(html.includes(text), `ШПП не містить «${text}»`);
  }
  for (const re of MUST_BE_CLEAN) assert.doesNotMatch(html, re);
  // стрілки висоти й швидкості
  assert.ok(html.includes('300 ↑'));
  assert.ok(html.includes('200 ↓'));
  // схема: кола на пунктах (усі ППМ), по одному елементу на ділянку
  assert.equal((html.match(/<marker /g) || []).length, 1);
  assert.equal((html.match(/marker-end="url\(#arr\)"/g) || []).length, 5 + 1); // п'ять ділянок і стрілка півночі
  assert.ok((html.match(/<circle /g) || []).length >= 6);
  assert.doesNotMatch(html, /NaN|undefined|Infinity/);
});

test('ШПП: посадка на майданчик у схемі й таблиці; КО — трикутник; без капітана — підкреслення', () => {
  const flight = demoFlight({
    captain: undefined,
    legs: [
      { name: 'Дубки', mshk: 45, h: 300, v: 200, s: 48 },
      { name: 'Орієнтир', kind: 'ko', mshk: 120, h: 300, v: 200, s: 40 },
      { name: 'Майданчик', mshk: 200, h: 200, v: 180, s: 52, landing: true },
      { name: 'Зоря', mshk: 290, h: 300, v: 220, s: 70 },
    ],
  });
  const html = renderShppHtml(flight);
  assert.ok(html.includes('(посадка)'));
  assert.ok(html.includes('посадка (коло 5 км / 5 хв)'));
  assert.ok(html.includes('після зльоту 5 км / 5 хв'));
  assert.ok(html.includes('stroke-dasharray'));
  assert.ok(html.includes('<polygon'));
  assert.ok(html.includes('<rect x="'));
  assert.ok(/капітана ____________/.test(html));
  assert.ok(html.includes('по маршруту: аер. Зоря-Дубки-Орієнтир-Майданчик-Зоря'));
  assert.doesNotMatch(html, /NaN|undefined|Infinity/);
});

test('ШПП: довгий маршрут (10 ділянок) лишається в межах схеми', () => {
  const legs = Array.from({ length: 10 }, (_, i) => ({ name: `Пункт ${i + 1}`, mshk: (i * 47) % 360, h: 300, v: 200, s: 30 + i * 4 }));
  const html = renderShppHtml({ typeId: 'mi8mtv1', empty: 7000, fuelKg: 2092, departure: 'Старт', legs });
  assert.ok(html.includes('viewBox="0 0 1000 270"') || html.includes('viewBox="0 0 1000 24'));
  const sc = planScheme(calcShpp({ typeId: 'mi8mtv1', empty: 7000, fuelKg: 2092, departure: 'Старт', legs }), { width: 1000, height: 270 });
  for (const pt of sc.points) {
    assert.ok(pt.x >= 80 && pt.x <= 920);
    assert.ok(pt.y >= 60 && pt.y <= 210);
  }
});

test('Екранування: усі підставлені значення в усіх трьох документах', () => {
  const evil = '<img src=x onerror=alert(1)>"&\'';
  const flight = demoFlight({
    board: evil,
    callsign: evil,
    exercise: evil,
    commander: evil,
    navigator: evil,
    checker: evil,
    captain: evil,
    returnLine: evil,
    typeLabel: evil,
    departure: { name: evil, lat: 50, lon: 30 },
    iasChief: { rank: evil, name: evil },
    seniorNav: { rank: evil, firstName: evil, surname: evil },
    legs: demoFlight().legs.map((l, i) => (i === 2 ? { ...l, to: `ППМ3 ${evil}` } : l)),
  });
  for (const html of [renderIshrHtml(flight), renderBortjournalHtml(flight), renderShppHtml(flight)]) {
    assert.ok(!html.includes('<img'), 'сирий <img потрапив у документ');
    assert.ok(!html.includes('onerror=alert(1)>'), 'сирий атрибут потрапив у документ');
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
    assert.ok(html.includes('&quot;'));
    assert.ok(html.includes('&#39;'));
  }
  assert.equal(escapeHtml('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(0), '0');
});

test('Документи: детерміновані, одна сторінка A4 альбомна, без зовнішніх ресурсів', () => {
  for (const render of [renderIshrHtml, renderBortjournalHtml, renderShppHtml]) {
    const a = render(demoFlight());
    assert.equal(a, render(demoFlight()));
    assert.match(a, /@page\{size:A4 landscape;margin:/);
    assert.doesNotMatch(a, /<script/i);
    assert.doesNotMatch(a, /src="https?:|href="https?:|url\(https?:/);
    assert.equal((a.match(/<style>/g) || []).length, 1);
  }
});

test('Джерела модуля чисті: без Date.now, Math.random і мережі', async () => {
  for (const name of ['nav-core.js', 'sun-core.js', 'moon-core.js', 'nav-docs.js']) {
    const raw = await readFile(new URL(`../src/workspace/easyfly/${name}`, import.meta.url), 'utf8');
    const source = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(source, /Date\.now|Math\.random|new Date\(\)|fetch\(|XMLHttpRequest|localStorage|document\./, name);
  }
});
