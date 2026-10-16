// Іконки «Артилерії»: який файл з src/ammo-art показувати для групи калібру й для рядка заряду. Чиста логіка без Vite, тестується в Node.

/** Групи калібру таблиці → файл іконки. Групи без своєї іконки (85, 100, 128, 130, 220 мм) дістають загальну «other». */
export const AMMO_BY_GROUP = Object.freeze({
  '155 мм ОФ': '155-he', '155 мм касетні': '155-cluster', '155 мм дист. мінування': '155-scatter', '155 мм димові й освітлювальні': '155-smoke',
  '152 мм': '152', '122 мм': '122', '122 мм РС': '122-rocket', '105 мм': '105', '203 мм': '203', '227 мм': '227',
  '120 мм': '120-mortar', '82 мм': '82-mortar', '60 мм': '60-mortar', 'Високоточні': 'guided',
  'Заряди': 'charge-bmcs',
});
export const ammoFile = group => AMMO_BY_GROUP[group] || 'other';

// У таблицях пишуть то латинською, то кирилицею («М119А1»): зводимо схожі літери до латиниці.
const LOOKALIKE = { 'А': 'A', 'В': 'B', 'С': 'C', 'Е': 'E', 'Н': 'H', 'К': 'K', 'М': 'M', 'О': 'O', 'Р': 'P', 'Т': 'T', 'Х': 'X' };
const latin = text => String(text ?? '').toUpperCase().replace(/[АВСЕНКМОРТХ]/g, ch => LOOKALIKE[ch]);

/** Файл іконки заряду за підписом рядка («155мм М3А1», «М119А1», «DM 92», «TC-F»…). Невідомий тип дістає іконку модульного заряду. */
export function chargeIconFile(label) {
  const t = latin(label);
  if (/M\s*203/.test(t)) return 'charge-m203a1';
  if (/M\s*119/.test(t)) return 'charge-m119a2';
  if (/M\s*4(?!\d)/.test(t)) return 'charge-m4a2';
  if (/M\s*3(?!\d)/.test(t)) return 'charge-m3a1';
  return 'charge-bmcs';
}
