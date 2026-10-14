// Авторство 3D-моделей довідників (src/guides/*): єдина таблиця для сторінок довідників і для src/models/CREDITS.md.
// tests/guides.test.mjs звіряє її з файлами `models/*.glb` і з CREDITS.md.
//
// kind:
//   cc        — модель стороннього автора з відомою ліцензією (автор, ліцензія, посилання — з метаданих, що супроводжували файл);
//   author    — автор відомий, ліцензію у файлі не зазначено;
//   own       — власна робота автора проєкту (за його запевненням), сторонньої ліцензії немає;
//   game      — надано власником проєкту; у назві чи файлі вказано ресурс гри, права не з’ясовані;
//   unclear   — надано власником проєкту; джерело й ліцензію не зазначено, можливо ресурс гри, права не з’ясовані;
//   generated — процедурна модель EasyWAR.
// Щоб визнати модель власною, змініть її kind на 'own': сторінка довідника й тест підхоплять зміну, а CREDITS.md
// треба оновити (`node script/guides-credits.mjs`).

export const KINDS = {
  "cc": "Сторонній автор, відома ліцензія",
  "author": "Автор відомий, ліцензію у файлі не зазначено",
  "own": "Власна робота автора проєкту (за його запевненням)",
  "game": "Надано власником проєкту; ресурс гри, права не з’ясовані",
  "unclear": "Надано власником проєкту; походження не з’ясовано, права не з’ясовані",
  "generated": "Процедурна модель EasyWAR"
};

export const LANDSCAPE = {
  title: '75 Acres Land w Creek',
  author: 'mrwrightphoto',
  license: 'CC BY 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  note: 'Обрізано й спрощено для довідника.',
};

export const CREDITS = {
  'aviation/ka52': {"name": "Ка-52 «Алігатор»", "kind": "cc", "title": "Russian Ka-52 Alligator", "author": "42manako", "source": "https://sketchfab.com/3d-models/russian-ka-52-alligator-9b31733ceed24be49b2f621487b35ea9", "license": "CC BY 4.0"},
  'aviation/ka50': {"name": "Ка-50 «Чорна акула»", "kind": "own", "title": "Ka-50 «Akula» (USSR)"},
  'aviation/ka27': {"name": "Ка-27", "kind": "own", "title": "Ka-27"},
  'aviation/mi26': {"name": "Мі-26", "kind": "own", "title": "Mi-26 Soviet Helicopter"},
  'aviation/mi35': {"name": "Мі-35М", "kind": "own", "title": "Russian Mil Mi-35M"},
  'aviation/mi8tv': {"name": "Мі-8ТВ", "kind": "cc", "title": "Mi-8TB (War Thunder)", "author": "KojfDiscord", "source": "https://sketchfab.com/3d-models/mi-8tb-war-thunder-war-thunder-9e8deeb240964b2eba81b462041e8967", "license": "CC BY 4.0", "note": "У текстурі східнонімецькі розпізнавальні ромби замінено червоною зіркою (ознака належності до РФ для довідника розпізнавання)."},
  'aviation/mi2': {"name": "Мі-2", "kind": "own", "title": "Mi-2"},
  'aviation/an26': {"name": "Ан-26", "kind": "game", "title": "An-26B (DCS World)", "game": "DCS World"},
  'aviation/an225': {"name": "Ан-225 «Мрія»", "kind": "own", "title": "Antonov An-225"},
  'aviation/tu22': {"name": "Ту-22М3", "kind": "game", "title": "Tu-22M3 (DCS World)", "game": "DCS World"},
  'aviation/tu95': {"name": "Ту-95МС", "kind": "game", "title": "Tu-95M (War Thunder, AF)", "game": "War Thunder"},
  'aviation/fp5': {"name": "FP-5 «Фламінго»", "kind": "cc", "title": "Missile FP-5 Flamingo 3D model", "author": "rombic991", "source": "https://sketchfab.com/3d-models/missile-fp-5-flamingo-3d-model-d638fc564342416baa4480ed1900d407", "license": "CC BY 4.0"},
  'aviation/fp7': {"name": "FP-7", "kind": "cc", "title": "Firepoint FP-7 ballistic missile", "author": "FLIGHTCLUB UA", "source": "https://sketchfab.com/3d-models/firepoint-fp-7-ballistic-missile-a2da452aa5f94611b54b9d56757b61f0", "license": "CC BY 4.0"},
  'uav/tb2': {"name": "Bayraktar TB2", "kind": "cc", "title": "Ukrainian Bayraktar TB2", "author": "42manako", "source": "https://sketchfab.com/3d-models/ukrainian-bayraktar-tb2-9738e42238894e5bbc51646c79eadec7", "license": "CC BY 4.0"},
  'uav/d1l': {"name": "Duck", "kind": "own", "title": "Duck"},
  'uav/sky': {"name": "Skyfall", "kind": "own", "title": "Skyfall"},
  'uav/sh': {"name": "SH-60B Seahawk", "kind": "own", "title": "SH-60B Seahawk Helicopter"},
  'rvia/sapsan': {"name": "Сапсан", "kind": "own"},
  'rvia/tochka': {"name": "Точка-У", "kind": "own"},
  'rvia/uragan': {"name": "Ураган", "kind": "own"},
  'rvia/bastion': {"name": "Бастіон-01", "kind": "own"},
  'rvia/caesar': {"name": "CAESAR", "kind": "own"},
  'rvia/bogdana': {"name": "Богдана", "kind": "own"},
  'rvia/m10': {"name": "М-10", "kind": "own"},
  'rvia/giatsint': {"name": "Гіацинт-Б", "kind": "own"},
  'rvia/d30': {"name": "Д-30", "kind": "own"},
  'rvia/fh70': {"name": "FH-70", "kind": "own"},
  'rvia/m198': {"name": "M198", "kind": "own"},
  'rvia/vilkha': {"name": "Вільха", "kind": "generated", "title": "R-624 Vilkha (generated)"},
  'ppo/patriot': {"name": "Patriot", "kind": "own"},
  'ppo/nasams': {"name": "NASAMS", "kind": "cc", "title": "Nasams 1 Surface-to-Air Missile System", "author": "Muhamad Mirza Arrafi", "source": "https://sketchfab.com/3d-models/nasams-1-surface-to-air-missile-system-5fb34fab137c430988fd5642a3b87db3", "license": "CC BY 4.0"},
  'ppo/iris': {"name": "IRIS-T SLM", "kind": "own"},
  'ppo/sky': {"name": "Sky Sabre", "kind": "own"},
  'ppo/mamba': {"name": "SAMP/T «Mamba»", "kind": "cc", "title": "FR FSAF SAMP/T (Mamba) (TEL) (War Thunder)", "author": "KojfDiscord", "source": "https://sketchfab.com/3d-models/fr-fsaf-sampt-mamba-tel-war-thunder-1b08c28a972f4b938eea6a1c0e8d2be5", "license": "CC BY 4.0"},
  'ppo/shilka': {"name": "ЗСУ-23-4 «Шилка»", "kind": "own"},
  'ppo/kub': {"name": "2Т7 «Куб»", "kind": "own"},
  'ppo/nomads': {"name": "Nomads", "kind": "own"},
  'enemy-ground/pan': {"name": "Панцирь-С1", "kind": "cc", "title": "Панцирь-С1 (Pantsir-S1)", "author": "JuSSSkeMDL", "source": "https://sketchfab.com/jussskemdl", "license": "CC BY-NC-SA 4.0", "note": "Зміни: оптимізація, анімація. Модифікації мають ту саму ліцензію (BY-NC-SA): некомерційне використання, поширення на тих самих умовах."},
  'enemy-ground/tung': {"name": "2К22 «Тунгуска»", "kind": "own"},
  'enemy-ground/buk1': {"name": "9А317М «Бук-М3»", "kind": "cc", "title": "Buk-M3 9K317 SAM", "author": "Jeyhun1985", "source": "https://sketchfab.com/3d-models/buk-m3-9k317-sam-923878eda87a4b28bae10799023086c5", "license": "CC BY 4.0"},
  'enemy-ground/buk2': {"name": "«Бук-М3» (станція)", "kind": "own"},
  'enemy-ground/s400': {"name": "С-400 «Тріумф»", "kind": "unclear"},
  'enemy-ground/sa12': {"name": "С-300В (ПУ і ТЗМ)", "kind": "own"},
  'enemy-ground/r96': {"name": "96Л6Е", "kind": "unclear"},
  'enemy-ground/osa': {"name": "9К33 «Оса-АКМ»", "kind": "own"},
  'enemy-ground/isk': {"name": "9К720 «Іскандер»", "kind": "own"},
  'enemy-ground/btr': {"name": "БТР-82А", "kind": "own"},
  'enemy-ground/mtl': {"name": "МТ-ЛБМ 6МБ", "kind": "own"},
  'enemy-ground/rp': {"name": "Станції розвідки й наведення", "kind": "own"},
  'ground-forces/abrams': {"name": "M1A2 Abrams", "kind": "author", "title": "M1A2 Abrams", "author": "Jeyhun1985", "source": "https://sketchfab.com/Jeyhun1985"},
  'ground-forces/bradley': {"name": "M2A3 Bradley", "kind": "cc", "title": "Ukrainian M2A3 Bradley", "author": "42manako", "source": "https://sketchfab.com/3d-models/ukrainian-m2a3-bradley-accfcb705d794fa3a47d008d98d6607e", "license": "CC BY 4.0"},
  'ground-forces/marder': {"name": "Marder 1A3", "kind": "cc", "title": "Ukrainian Marder 1A3", "author": "42manako", "source": "https://sketchfab.com/3d-models/ukrainian-marder-1a3-d4df840369e7486a852871dd312a06a3", "license": "CC BY 4.0"},
  'ground-forces/boxer': {"name": "Boxer (інженерний)", "kind": "cc", "title": "Boxer AFV (Engineering, HMG)", "author": "42manako", "source": "https://sketchfab.com/3d-models/boxer-afv-engineering-hmg-e159d630f4f64f2287e7d095c0bd8d92", "license": "CC BY-NC 4.0", "note": "Ліцензія некомерційна (NC): використання лише в некомерційних цілях."},
  'ground-forces/hmmwv': {"name": "HMMWV M998A1", "kind": "unclear"},
  'ground-forces/hemtt': {"name": "M978 HEMTT", "kind": "unclear"},
  'ground-forces/goliath': {"name": "Goliath", "kind": "unclear"},
  'ground-forces/pk_m1a1': {"name": "M1A1 Abrams", "kind": "game", "title": "strike_fighters_tanks_pack", "game": "Strike Fighters", "note": "Набір танків «strike_fighters_tanks_pack» (за назвою файлу — ресурси гри Strike Fighters). Модель розділено на корпус, башту й гармату для довідника."},
  'ground-forces/pk_leopard1a4': {"name": "Leopard 1A4", "kind": "game", "title": "strike_fighters_tanks_pack", "game": "Strike Fighters", "note": "Набір танків «strike_fighters_tanks_pack» (за назвою файлу — ресурси гри Strike Fighters). Модель розділено на корпус, башту й гармату для довідника."},
  'ground-forces/pk_m60': {"name": "M60", "kind": "game", "title": "strike_fighters_tanks_pack", "game": "Strike Fighters", "note": "Набір танків «strike_fighters_tanks_pack» (за назвою файлу — ресурси гри Strike Fighters). Модель розділено на корпус, башту й гармату для довідника."},
  'ground-forces/pk_m48a2': {"name": "M48A2 Patton", "kind": "game", "title": "strike_fighters_tanks_pack", "game": "Strike Fighters", "note": "Набір танків «strike_fighters_tanks_pack» (за назвою файлу — ресурси гри Strike Fighters). Модель розділено на корпус, башту й гармату для довідника."},
  'ground-forces/pk_m48a3': {"name": "M48A3 Patton", "kind": "game", "title": "strike_fighters_tanks_pack", "game": "Strike Fighters", "note": "Набір танків «strike_fighters_tanks_pack» (за назвою файлу — ресурси гри Strike Fighters). Модель розділено на корпус, башту й гармату для довідника."},
  'ground-forces/pk_m4a3e8': {"name": "M4A3E8 Sherman", "kind": "game", "title": "strike_fighters_tanks_pack", "game": "Strike Fighters", "note": "Набір танків «strike_fighters_tanks_pack» (за назвою файлу — ресурси гри Strike Fighters). Модель розділено на корпус, башту й гармату для довідника."},
  'ground-forces/pk_centurion8': {"name": "Centurion", "kind": "game", "title": "strike_fighters_tanks_pack", "game": "Strike Fighters", "note": "Набір танків «strike_fighters_tanks_pack» (за назвою файлу — ресурси гри Strike Fighters). Модель розділено на корпус, башту й гармату для довідника."},
  'ground-forces/pk_t3485': {"name": "Т-34-85", "kind": "game", "title": "strike_fighters_tanks_pack", "game": "Strike Fighters", "note": "Набір танків «strike_fighters_tanks_pack» (за назвою файлу — ресурси гри Strike Fighters). Модель розділено на корпус, башту й гармату для довідника."},
  'ground-forces/pk_pt76': {"name": "ПТ-76", "kind": "game", "title": "strike_fighters_tanks_pack", "game": "Strike Fighters", "note": "Набір танків «strike_fighters_tanks_pack» (за назвою файлу — ресурси гри Strike Fighters). Модель розділено на корпус, башту й гармату для довідника."},
  'ground-forces/pk_t55': {"name": "Т-55", "kind": "game", "title": "strike_fighters_tanks_pack", "game": "Strike Fighters", "note": "Набір танків «strike_fighters_tanks_pack» (за назвою файлу — ресурси гри Strike Fighters). Модель розділено на корпус, башту й гармату для довідника."},
  'ground-forces/pk_t62': {"name": "Т-62", "kind": "game", "title": "strike_fighters_tanks_pack", "game": "Strike Fighters", "note": "Набір танків «strike_fighters_tanks_pack» (за назвою файлу — ресурси гри Strike Fighters). Модель розділено на корпус, башту й гармату для довідника."},
  'ground-forces/pk_t72': {"name": "Т-72", "kind": "game", "title": "strike_fighters_tanks_pack", "game": "Strike Fighters", "note": "Набір танків «strike_fighters_tanks_pack» (за назвою файлу — ресурси гри Strike Fighters). Модель розділено на корпус, башту й гармату для довідника."},
  'ground-forces/pk_t80': {"name": "Т-80", "kind": "game", "title": "strike_fighters_tanks_pack", "game": "Strike Fighters", "note": "Набір танків «strike_fighters_tanks_pack» (за назвою файлу — ресурси гри Strike Fighters). Модель розділено на корпус, башту й гармату для довідника."},
  'ground-forces/pk_t90': {"name": "Т-90", "kind": "game", "title": "strike_fighters_tanks_pack", "game": "Strike Fighters", "note": "Набір танків «strike_fighters_tanks_pack» (за назвою файлу — ресурси гри Strike Fighters). Модель розділено на корпус, башту й гармату для довідника."},
  'ground-forces/pk_type99tank': {"name": "Type 99", "kind": "game", "title": "strike_fighters_tanks_pack", "game": "Strike Fighters", "note": "Набір танків «strike_fighters_tanks_pack» (за назвою файлу — ресурси гри Strike Fighters). Модель розділено на корпус, башту й гармату для довідника."},
  'ground-forces/pk_ee9': {"name": "EE-9 Cascavel", "kind": "game", "title": "strike_fighters_tanks_pack", "game": "Strike Fighters", "note": "Набір танків «strike_fighters_tanks_pack» (за назвою файлу — ресурси гри Strike Fighters). Модель розділено на корпус, башту й гармату для довідника."},
};

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Рядок авторства моделі як звичайний текст.
export function creditText(key) {
  const c = CREDITS[key];
  if (!c) throw new Error('Немає запису авторства: ' + key);
  switch (c.kind) {
    case 'cc':
      return `Модель «${c.title}» — ${c.author}, ${c.license}.${c.note ? ' ' + c.note : ''}`;
    case 'author':
      return `Модель «${c.title}» — ${c.author}; ліцензію у файлі не зазначено.`;
    case 'own':
      return 'Модель — власна робота автора проєкту (за його запевненням).';
    case 'game':
      return `Модель надано власником проєкту; за назвою — ресурс гри ${c.game}, права не з’ясовані.${c.note ? ' ' + c.note : ''}`;
    case 'unclear':
      return 'Модель надано власником проєкту; джерело й ліцензію у файлі не зазначено, можливо, це ресурс гри — права не з’ясовані.';
    case 'generated':
      return 'Процедурна модель EasyWAR, згенерована кодом.';
    default:
      throw new Error('Невідомий вид авторства: ' + c.kind);
  }
}

// Те саме як HTML для підпису під сценою: назва моделі стає посиланням на джерело, якщо воно є.
export function creditHtml(key) {
  const c = CREDITS[key];
  const text = creditText(key);
  if (!c.source || (c.kind !== 'cc' && c.kind !== 'author')) return esc(text);
  const label = `«${esc(c.title)}»`;
  return esc(text).replace(label, `<a href="${esc(c.source)}" target="_blank" rel="noopener">${label}</a>`);
}

// Підпис ландшафту (польотний режим і тло наземних довідників).
export function landscapeText() {
  return `Ландшафт «${LANDSCAPE.title}» — ${LANDSCAPE.author} (${LANDSCAPE.license}). ${LANDSCAPE.note}`;
}
export function landscapeHtml() {
  return `Ландшафт «${esc(LANDSCAPE.title)}» — ${esc(LANDSCAPE.author)} (<a href="${LANDSCAPE.licenseUrl}" target="_blank" rel="noopener">${esc(LANDSCAPE.license)}</a>). ${esc(LANDSCAPE.note)}`;
}
