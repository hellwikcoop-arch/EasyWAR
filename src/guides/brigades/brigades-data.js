// Довідник бригад: лише відкриті довідкові відомості (номер, тип частини, рід військ) і емблеми з проєкту.
// Поле, яке напевно невідоме, лишається null і показується як «—»: його заповнює власник, нічого не вигадуємо.
// Оперативних даних тут немає й не має бути.
export const TYPES = Object.freeze({
  одшбр: 'Окрема десантно-штурмова бригада',
  ошп: 'Окремий штурмовий полк',
  оабр: 'Окрема артилерійська бригада',
  реабр: 'Реактивна артилерійська бригада',
  омбр: 'Окрема механізована бригада',
  оєбр: 'Окрема єгерська бригада',
  обраа: 'Окрема бригада армійської авіації',
  змае: 'Змішана авіаційна ескадрилья',
  брта: 'Бригада транспортної авіації',
});

// Призначення за типом частини: загальновідома роль, без відомостей про конкретну частину.
export const PURPOSES = Object.freeze({
  одшбр: 'Десантно-штурмові дії, штурм і утримання рубежів',
  ошп: 'Штурмові дії та прорив оборони',
  оабр: 'Вогневе ураження ствольною артилерією, підтримка загальновійськових частин',
  реабр: 'Вогневе ураження реактивними системами залпового вогню',
  омбр: 'Загальновійськовий бій: оборона й наступ на механізованих засадах',
  оєбр: 'Легка піхота: дії в лісисто-болотистій і міській місцевості, рейди',
  обраа: 'Вогнева підтримка з повітря, десантування, перевезення, розвідка',
  змае: 'Авіаційне забезпечення: бойове застосування, розвідка, перевезення',
  брта: 'Повітряне перевезення військ і вантажів, десантування',
});

export const BRANCHES = Object.freeze({
  ps: 'Повітряні Сили',
  sv: 'Сухопутні війська',
  dshv: 'ДШВ',
  rvia: 'РВіА',
  aa: 'Армійська авіація',
});

// art — файл емблеми без розширення: unit-art/<art>.webp або guides/brigades/art/<art>.webp.
export const BRIGADES = Object.freeze([
  { id: '78-odshbr', number: 78, type: 'одшбр', branch: 'dshv', art: '78-odshbr' },
  { id: '79-odshbr', number: 79, type: 'одшбр', branch: 'dshv', art: '79-odshbr', nickname: 'Таврійська' },
  { id: '80-odshbr', number: 80, type: 'одшбр', branch: 'dshv', art: '80-odshbr', nickname: 'Галицька' },
  { id: '82-odshbr', number: 82, type: 'одшбр', branch: 'dshv', art: '82-odshbr', nickname: 'Буковинська' },
  { id: '95-odshbr', number: 95, type: 'одшбр', branch: 'dshv', art: '95-odshbr', nickname: 'Поліська' },
  { id: '148-oabr', number: 148, type: 'оабр', branch: 'dshv', art: '148-oabr' },
  { id: '107-reabr', number: 107, type: 'реабр', branch: 'rvia', art: '107-reabr' },
  { id: '67-ombr', number: 67, type: 'омбр', branch: 'sv', art: '67-ombr' },
  { id: '71-oebr', number: 71, type: 'оєбр', branch: 'sv', art: '71-oebr' },
  { id: '1-oshp', number: 1, type: 'ошп', branch: 'dshv', art: '1-oshp' },
  { id: '225-oshp', number: 225, type: 'ошп', branch: 'sv', art: '225-oshp' },
  { id: '425-oshp', number: 425, type: 'ошп', branch: 'sv', art: '425-oshp' },
  { id: '475-oshp', number: 475, type: 'ошп', branch: 'sv', art: '475-oshp' },
  { id: '11-obraa', number: 11, type: 'обраа', branch: 'aa', art: '11-obraa', place: 'Херсон' },
  { id: '12-obraa', number: 12, type: 'обраа', branch: 'aa', art: '12-obraa', place: 'Новий Калинів' },
  { id: '16-obraa', number: 16, type: 'обраа', branch: 'aa', art: '16-obraa', place: 'Броди' },
  { id: '18-obraa', number: 18, type: 'обраа', branch: 'aa', art: '18-obraa', place: 'Полтава' },
  { id: '35-zmae', number: 35, type: 'змае', branch: 'ps', art: '35-zmae' },
  { id: '456-brta', number: 456, type: 'брта', branch: 'ps', art: '456-brta' },
]);
