// Графічний стиль ЗСУ для сторінок, імпортованих з EasyWAR_UNIFIED.
// Джерело: «Керівництво з використання графічного стилю у візуальній комунікації ЗСУ» (2023).
//   с. 12–15 — базовий шрифт UAF Sans, практичні накреслення Regular / Medium / Semibold / Bold;
//   с. 16    — Volja є церемонійним шрифтом (грамоти, нагороди, прапори), тому в інтерфейсі не вживається;
//   с. 26    — написання «Сухопутні війська»; с. 65 — назви підрозділів набирають UAF Sans Semibold.
// Лише вузькі заякорені патчі шрифтів і назв: розмітка й логіка модулів не змінюються.

export function replaceOnce(source, search, replacement, label) {
  const first = source.indexOf(search);
  if (first < 0 || source.indexOf(search, first + 1) >= 0) {
    throw new Error(`Не знайдено однозначний якір: ${label}`);
  }
  return source.slice(0, first) + replacement + source.slice(first + search.length);
}

function replaceOnceRe(source, pattern, replacement, label) {
  const matches = source.match(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g'));
  if (!matches || matches.length !== 1) throw new Error(`Не знайдено однозначний якір: ${label}`);
  return source.replace(pattern, replacement);
}

// Наявні офіційні файли UAF Sans (src/fonts). Regular і Bold поки немає: браузер підбирає найближче
// накреслення з цих двох (≤500 → Medium, >500 → Semibold), а синтетичне «дожирнення» вимкнене.
export const UAF_FONT_FACES = [
  '@font-face{font-family:"UAF Sans";src:url("./fonts/UAFSans-Medium.ttf") format("truetype");font-weight:500;font-style:normal;font-display:block}',
  '@font-face{font-family:"UAF Sans";src:url("./fonts/UAFSans-SemiBold.ttf") format("truetype");font-weight:600;font-style:normal;font-display:block}',
  ':root{font-synthesis:none}',
].join('\n');

const NAMES = [
  ['Сухопутні Війська', 'Сухопутні війська'],
  ['Ракетні Війська', 'Ракетні війська'],
  ['війська і Артилерія', 'війська і артилерія'],
];
function officialNames(html) {
  return NAMES.reduce((out, [from, to]) => out.replaceAll(from, to), html);
}

function assertNoVolja(html, label) {
  if (/Volja/.test(html)) throw new Error(`${label}: залишився шрифт Volja.`);
  return html;
}

/** Лаунчер: UAF Sans замість Inter, назви родів військ — UAF Sans Semibold замість Volja. */
export function uafLauncher(html) {
  let out = replaceOnce(html, '--display: Inter, ui-sans-serif,', '--display: "UAF Sans", ui-sans-serif,', 'лаунчер --display');
  out = replaceOnceRe(
    out,
    /<style id="easywar-volja-branch-titles">[\s\S]*?<\/style>/,
    '<style id="easywar-uaf-typography">\n'
      + '/* Графічний стиль ЗСУ (2023): UAF Sans; назви видів і родів військ — Semibold, без трекінгу й ефектів. */\n'
      + UAF_FONT_FACES + '\n'
      + '.branch-card h3{font-family:"UAF Sans",var(--display)!important;font-style:normal!important;font-weight:600!important;'
      + 'font-size:20px!important;line-height:1.12!important;letter-spacing:0!important;text-shadow:none!important}\n'
      + '@media(max-width:640px){.branch-card h3,.branch-card[data-branch="rocket"] h3{font-size:18px!important}}\n'
      + '</style>',
    'easywar-volja-branch-titles',
  );
  return assertNoVolja(officialNames(out), 'Лаунчер');
}

/** Модуль: офіційні файли UAF Sans замість одного Semibold на весь діапазон 100–900, рядок бренду без Volja. */
export function uafModule(html) {
  let out = replaceOnceRe(
    html,
    /@font-face \{ font-family: "UAF Sans"; src: url\(data:font\/ttf;base64,[A-Za-z0-9+/=]+\) format\("truetype"\); font-weight: 100 900; font-style: normal; font-display: block; \}/,
    () => UAF_FONT_FACES,
    'UAF Sans @font-face',
  );
  out = replaceOnceRe(
    out,
    /@font-face\{font-family:"Volja";src:url\("data:font\/ttf;base64,[A-Za-z0-9+/=]+"\) format\("truetype"\);font-style:normal;font-weight:400;font-display:swap\}\n/,
    '',
    'Volja @font-face',
  );
  out = replaceOnce(out, '<style id="easywar-volja-module-brand">', '<style id="easywar-uaf-module-brand">', 'easywar-volja-module-brand');
  out = replaceOnce(
    out,
    '.brand b,.brand small{font-family:"Volja",var(--display)!important;font-style:normal!important;font-weight:400!important;',
    '.brand b,.brand small{font-family:"UAF Sans",var(--display)!important;font-style:normal!important;font-weight:600!important;',
    '.brand шрифт',
  );
  out = replaceOnce(out, '.brand b{font-size:22px!important;line-height:1!important;letter-spacing:.015em!important}',
    '.brand b{font-size:22px!important;line-height:1!important;letter-spacing:0!important}', '.brand b');
  out = replaceOnce(out, 'letter-spacing:.075em!important;margin-top:4px!important;text-transform:uppercase}',
    'letter-spacing:0!important;margin-top:4px!important;text-transform:none}', '.brand small');
  out = replaceOnce(out, '.brand small{font-size:9.5px!important;letter-spacing:.055em!important}',
    '.brand small{font-size:9.5px!important;letter-spacing:0!important}', '.brand small (вузький екран)');
  return assertNoVolja(officialNames(out), 'Модуль');
}
