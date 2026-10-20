// Шаблони документів «Офісу»: поля {{поле}} і блоки {{#блок}}…{{/блок}} у DOCX, PPTX і XLSX
// (plans/ofis-realizatsiia.md, розд. 6). Чиста логіка без DOM і Tauri: ZIP-архів читає й пише
// JSZip, який передає виклик (`{ JSZip }`), тож модуль перевіряється в node --test
// (tests/template-core.test.mjs). XML розбирається невеликим сканером тегів у дерево, у якому
// незмінені частини зберігають свій початковий текст; елементи шукаються за іменами з префіксом
// (w:p, w:t, a:p, a:t), у XLSX — за локальними іменами (row, c, si), простори імен не потрібні.
// Значення полів готує field-dictionary-core.js; тут вони лише перетворюються на текст,
// екрануються для XML і підставляються. Шаблон не змінюється: результат — нові байти.

export const TEMPLATE_EXTENSIONS = Object.freeze(['docx', 'pptx', 'xlsx']);

const NAME_CHARS = '[\\p{L}\\p{M}\\p{N}_.]+';

/**
 * Поле `{{поле}}`, початок блоку `{{#блок}}` або кінець `{{/блок}}`; пробіли всередині дужок
 * дозволено (`{{ поле }}`). Група 1 — `#`, `/` або порожньо, група 2 — назва. Регулярний вираз
 * глобальний: використовуйте його через `text.matchAll(FIELD_PATTERN)`.
 */
export const FIELD_PATTERN = new RegExp(`\\{\\{\\s*([#/]?)\\s*(${NAME_CHARS})\\s*\\}\\}`, 'gu');
const TOKEN_AT = new RegExp(FIELD_PATTERN.source, 'uy');

// Довше за це `{{…}}` вважаємо звичайним текстом, а не зіпсованим маркером.
const MAX_MARKER_CHARS = 200;
// Одна XML-частина шаблону (документ, слайд, аркуш) — не більше 64 МБ тексту.
const MAX_PART_CHARS = 64 * 1024 * 1024;
// Довші числа втрачають точність у double, тож у XLSX лишаються текстом.
const MAX_NUMBER_DIGITS = 15;

// ---------------------------------------------------------------------------------------------
// Числа й текст значень

/**
 * Число українською: кома в дробовій частині, до `digits` знаків після коми без кінцевих нулів,
 * групи по три цифри через нерозривний пробіл лише від п'яти цифр (як у діловому письмі:
 * «2024», «12 345»). Не залежить від Intl, тож однакове в усіх рушіях WebView.
 */
export function formatNumber(value, digits = 2) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  const places = Math.max(0, Math.min(10, Math.trunc(Number(digits) || 0)));
  const fixed = Math.abs(value).toFixed(places);
  if (/e/i.test(fixed)) return String(value);
  let [whole, fraction = ''] = fixed.split('.');
  fraction = fraction.replace(/0+$/, '');
  if (whole.length >= 5) whole = whole.replace(/\B(?=(\d{3})+$)/g, ' ');
  const negative = value < 0 && (/[1-9]/.test(whole) || fraction !== '');
  return `${negative ? '-' : ''}${whole}${fraction ? `,${fraction}` : ''}`;
}

const PLAIN_NUMBER = /^-?(?:0|[1-9]\d*)(?:[.,]\d+)?$/;
const GROUPED_NUMBER = /^-?[1-9]\d{0,2}(?:[   ]\d{3})+(?:,\d+)?$/;

/**
 * Текст числа (так, як його пише formatNumber, або «12.5» з таблиці) → число; інакше null.
 * Числа з провідними нулями («007») і довші за 15 цифр лишаються текстом.
 */
export function parseNumberText(text) {
  if (typeof text !== 'string') return null;
  const value = text.trim().replace(/^−/, '-');
  if (!PLAIN_NUMBER.test(value) && !GROUPED_NUMBER.test(value)) return null;
  if (value.replace(/\D/g, '').length > MAX_NUMBER_DIGITS) return null;
  const number = Number(value.replace(/[   ]/g, '').replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}

function numericValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  return parseNumberText(value);
}

// Символи, недопустимі в XML 1.0 (керівні, крім табуляції й переносів, і непарні сурогати).
const INVALID_XML_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

/** Значення поля → текст: число українською, так/ні, без недопустимих для XML символів. */
export function valueText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return formatNumber(value);
  if (typeof value === 'boolean') return value ? 'так' : 'ні';
  return String(value).replace(INVALID_XML_CHARS, '');
}

const XML_ESCAPES = Object.freeze({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' });

/** Екранування тексту для XML: < & > " ' . */
export function escapeXml(text) {
  return String(text).replace(/[&<>"']/g, ch => XML_ESCAPES[ch]);
}

const ENTITY = /&(?:#[xX]([0-9a-fA-F]+)|#(\d+)|(lt|gt|amp|quot|apos));/g;
const NAMED_ENTITIES = Object.freeze({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" });

function decodeXml(raw) {
  if (!raw.includes('&')) return raw;
  return raw.replace(ENTITY, (match, hex, dec, named) => {
    if (named) return NAMED_ENTITIES[named];
    const code = Number.parseInt(hex ?? dec, hex ? 16 : 10);
    return code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

const sortNames = names => [...names].sort((a, b) => a.localeCompare(b, 'uk'));

// ---------------------------------------------------------------------------------------------
// Розбір тексту шаблону

// Токени з позиціями в тексті; `invalid` — схожі на маркер `{{…}}`, але з недопустимою назвою.
function scanTokens(text) {
  const tokens = [];
  const invalid = [];
  let pos = 0;
  let textStart = 0;
  for (;;) {
    const at = text.indexOf('{{', pos);
    if (at === -1) break;
    TOKEN_AT.lastIndex = at;
    const match = TOKEN_AT.exec(text);
    if (match) {
      if (at > textStart) tokens.push({ type: 'text', raw: text.slice(textStart, at), start: textStart, end: at });
      const type = match[1] === '#' ? 'open' : match[1] === '/' ? 'close' : 'field';
      const end = at + match[0].length;
      tokens.push({ type, name: match[2].normalize('NFC'), raw: match[0], start: at, end });
      pos = textStart = end;
      continue;
    }
    // «{{{поле}}}»: справжній маркер починається на символ далі.
    if (text[at + 2] !== '{') {
      const close = text.indexOf('}}', at + 2);
      const next = text.indexOf('{{', at + 2);
      if (close !== -1 && (next === -1 || close < next) && close + 2 - at <= MAX_MARKER_CHARS) {
        invalid.push(text.slice(at, close + 2));
      }
    }
    pos = at + 1;
  }
  if (textStart < text.length) tokens.push({ type: 'text', raw: text.slice(textStart), start: textStart, end: text.length });
  return { tokens, invalid };
}

const invalidMarkerError = raw =>
  `Незрозумілий маркер ${raw}: назва поля може містити лише літери, цифри, «_» і «.»`;

/** Помилки вкладення блоків у послідовності токенів (або маркерів { type, name }). */
export function blockErrors(tokens) {
  const errors = [];
  const stack = [];
  for (const token of tokens) {
    if (token.type === 'open') {
      stack.push(token.name);
    } else if (token.type === 'close') {
      const open = stack[stack.length - 1];
      if (open === undefined) {
        errors.push(`Маркер {{/${token.name}}} без початку блоку {{#${token.name}}}`);
      } else if (open !== token.name) {
        errors.push(`Блок «${open}» закрито маркером {{/${token.name}}}; очікувався {{/${open}}}`);
        const index = stack.lastIndexOf(token.name);
        if (index !== -1) stack.length = index;
      } else {
        stack.pop();
      }
    }
  }
  for (const name of stack.reverse()) errors.push(`Блок «${name}» не закрито: бракує {{/${name}}}`);
  return errors;
}

/**
 * Текст шаблону → { tokens: [{ type: 'text'|'field'|'open'|'close', name?, raw }], errors }.
 * `errors` — українською: незрозумілі маркери, незакриті й переплутані блоки.
 */
export function parseTemplateText(text) {
  const { tokens, invalid } = scanTokens(String(text ?? ''));
  return {
    tokens: tokens.map(({ type, name, raw }) => (type === 'text' ? { type, raw } : { type, name, raw })),
    errors: [...invalid.map(invalidMarkerError), ...blockErrors(tokens)],
  };
}

// Переписує текст кількох послідовних фрагментів (w:t одного абзацу, t однієї клітинки), де
// маркер може бути розірваний між фрагментами. `replace(token, index)` повертає заміну або
// null (лишити як є); заміна йде у фрагмент, де маркер починається, використані символи
// зникають з наступних, кількість фрагментів не змінюється.
function rewritePieces(texts, replace) {
  const pieces = texts.map(text => String(text ?? ''));
  const full = pieces.join('');
  if (!full.includes('{{')) return pieces;
  const { tokens } = scanTokens(full);
  const starts = [];
  let offset = 0;
  for (const piece of pieces) {
    starts.push(offset);
    offset += piece.length;
  }
  const out = pieces.map(() => '');
  const pieceAt = position => {
    for (let i = 0; i < pieces.length; i += 1) {
      if (position >= starts[i] && position < starts[i] + pieces[i].length) return i;
    }
    return pieces.length - 1;
  };
  const copy = (from, to) => {
    for (let i = 0; i < pieces.length && from < to; i += 1) {
      const a = starts[i];
      const b = a + pieces[i].length;
      if (b <= from || a >= to) continue;
      out[i] += full.slice(Math.max(a, from), Math.min(b, to));
    }
  };
  let cursor = 0;
  let index = 0;
  for (const token of tokens) {
    if (token.type === 'text') continue;
    const replacement = replace(token, index);
    index += 1;
    if (replacement === null || replacement === undefined) continue;
    copy(cursor, token.start);
    out[pieceAt(token.start)] += replacement;
    cursor = token.end;
  }
  copy(cursor, full.length);
  return out;
}

/**
 * Підставляє поля в текст послідовних фрагментів одного абзацу: поле, розірване між
 * фрагментами, замінюється у фрагменті, де воно починається, а його решта зникає з наступних;
 * кількість фрагментів зберігається. `resolve(name)` повертає значення або undefined
 * (невідоме поле → порожньо й у `missing`). Маркери блоків лишаються без змін.
 */
export function substituteRuns(texts, resolve) {
  const missing = new Set();
  const out = rewritePieces(texts, token => {
    if (token.type !== 'field') return null;
    const value = resolve(token.name);
    if (value === undefined) {
      missing.add(token.name);
      return '';
    }
    return valueText(value);
  });
  return { texts: out, missing: sortNames(missing) };
}

// ---------------------------------------------------------------------------------------------
// Дерево XML (сканер тегів)

const isElement = node => node.type === 'el';
const localName = name => name.slice(name.indexOf(':') + 1);
const prefixOf = name => (name.includes(':') ? name.slice(0, name.indexOf(':') + 1) : '');
const elements = node => node.children.filter(isElement);

function parseXml(xml, part) {
  const root = { type: 'el', name: '', open: '', close: '', children: [], parent: null };
  const broken = detail => new Error(`Пошкоджений XML у частині шаблону «${part}»: ${detail}.`);
  let current = root;
  let pos = 0;
  const push = node => {
    node.parent = current;
    current.children.push(node);
  };
  const pushText = raw => {
    if (raw) push({ type: 'text', raw });
  };
  while (pos < xml.length) {
    const lt = xml.indexOf('<', pos);
    if (lt === -1) {
      pushText(xml.slice(pos));
      break;
    }
    pushText(xml.slice(pos, lt));
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9);
      if (end === -1) throw broken('незакритий CDATA');
      pushText(escapeXml(xml.slice(lt + 9, end)));
      pos = end + 3;
      continue;
    }
    const special = xml.startsWith('<!--', lt) ? '-->' : xml.startsWith('<?', lt) ? '?>' : xml.startsWith('<!', lt) ? '>' : '';
    if (special) {
      const end = xml.indexOf(special, lt + 2);
      if (end === -1) throw broken('незакрита службова частина');
      push({ type: 'raw', raw: xml.slice(lt, end + special.length) });
      pos = end + special.length;
      continue;
    }
    if (xml[lt + 1] === '/') {
      const end = xml.indexOf('>', lt);
      if (end === -1) throw broken('незакритий тег');
      const name = xml.slice(lt + 2, end).trim();
      if (current === root || current.name !== name) throw broken(`неочікуваний тег </${name}>`);
      current.close = xml.slice(lt, end + 1);
      current = current.parent;
      pos = end + 1;
      continue;
    }
    let end = lt + 1;
    let quote = '';
    for (; end < xml.length; end += 1) {
      const ch = xml[end];
      if (quote) {
        if (ch === quote) quote = '';
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '>') {
        break;
      }
    }
    if (end >= xml.length) throw broken('незакритий тег');
    const open = xml.slice(lt, end + 1);
    const name = /^<([^\s/>]+)/.exec(open)?.[1];
    if (!name) throw broken('тег без назви');
    const selfClosing = open.endsWith('/>');
    const element = { type: 'el', name, open, close: selfClosing ? null : '', children: [], parent: null };
    push(element);
    if (!selfClosing) current = element;
    pos = end + 1;
  }
  if (current !== root) throw broken(`тег <${current.name}> не закрито`);
  return root;
}

function serialize(node, out = []) {
  if (!isElement(node)) {
    out.push(node.raw);
    return out;
  }
  out.push(node.open);
  for (const child of node.children) serialize(child, out);
  if (node.close) out.push(node.close);
  return out;
}

const serializeTree = root => serialize(root).join('');

function cloneNode(node, parent, map = null) {
  if (!isElement(node)) return { type: node.type, raw: node.raw, parent };
  const copy = { type: 'el', name: node.name, open: node.open, close: node.close, children: [], parent };
  if (map) map.set(node, copy);
  copy.children = node.children.map(child => cloneNode(child, copy, map));
  return copy;
}

function makeElement(name, attrs = '', children = []) {
  const element = { type: 'el', name, open: `<${name}${attrs}>`, close: `</${name}>`, children: [], parent: null };
  setChildren(element, children);
  return element;
}

function emptyElement(name, attrs = '') {
  return { type: 'el', name, open: `<${name}${attrs}/>`, close: null, children: [], parent: null };
}

const textNode = text => ({ type: 'text', raw: escapeXml(text), parent: null });

function setChildren(element, children) {
  if (element.close === null && children.length) {
    element.open = element.open.replace(/\s*\/>$/, '>');
    element.close = `</${element.name}>`;
  }
  element.children = children;
  for (const child of children) child.parent = element;
}

function descendants(node, test, out = []) {
  for (const child of node.children) {
    if (!isElement(child)) continue;
    if (test(child)) out.push(child);
    descendants(child, test, out);
  }
  return out;
}

function hasDescendant(node, test) {
  for (const child of node.children) {
    if (isElement(child) && (test(child) || hasDescendant(child, test))) return true;
  }
  return false;
}

function removeWhere(node, test) {
  let removed = false;
  node.children = node.children.filter(child => {
    if (isElement(child) && test(child)) {
      removed = true;
      return false;
    }
    if (isElement(child) && removeWhere(child, test)) removed = true;
    return true;
  });
  return removed;
}

const attrPatterns = new Map();
function attrPattern(name) {
  let pattern = attrPatterns.get(name);
  if (!pattern) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    pattern = new RegExp(`(\\s${escaped}\\s*=\\s*)(?:"([^"]*)"|'([^']*)')`);
    attrPatterns.set(name, pattern);
  }
  return pattern;
}

function getAttr(element, name) {
  const match = attrPattern(name).exec(element.open);
  return match ? decodeXml(match[2] ?? match[3]) : null;
}

function setAttr(element, name, value) {
  const pattern = attrPattern(name);
  const quoted = `"${escapeXml(String(value))}"`;
  if (pattern.test(element.open)) {
    element.open = element.open.replace(pattern, (match, lead) => `${lead}${quoted}`);
  } else {
    element.open = element.open.replace(/\s*(\/?)>$/, (match, slash) => ` ${name}=${quoted}${slash}>`);
  }
}

function removeAttr(element, name) {
  element.open = element.open.replace(attrPattern(name), '');
}

// Атрибут зв'язку r:id (префікс може бути іншим).
function relationId(element) {
  return getAttr(element, 'r:id') ?? /\s[\w.-]+:id\s*=\s*"([^"]*)"/.exec(element.open)?.[1] ?? null;
}

function textOf(element) {
  let out = '';
  for (const child of element.children) if (child.type === 'text') out += decodeXml(child.raw);
  return out;
}

function setText(element, text, preserveSpace) {
  setChildren(element, text ? [textNode(text)] : []);
  if (preserveSpace && /^\s|\s$|\s\s|[\t\n\r]/.test(text) && getAttr(element, 'xml:space') !== 'preserve') {
    setAttr(element, 'xml:space', 'preserve');
  }
}

// ---------------------------------------------------------------------------------------------
// Архів

function templateKind(ext) {
  const kind = String(ext ?? '').trim().toLowerCase().replace(/^\.+/, '');
  if (!TEMPLATE_EXTENSIONS.includes(kind)) {
    throw new Error(`Шаблон має бути у форматі DOCX, PPTX або XLSX (отримано «${String(ext ?? '')}»).`);
  }
  return kind;
}

function templateBytes(bytes) {
  if (bytes instanceof Uint8Array) return bytes;
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  if (ArrayBuffer.isView(bytes)) return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (Array.isArray(bytes)) return Uint8Array.from(bytes);
  return null;
}

async function openZip(bytes, JSZip) {
  if (!JSZip || typeof JSZip.loadAsync !== 'function') {
    throw new Error('Для роботи з шаблоном потрібна бібліотека JSZip.');
  }
  const data = templateBytes(bytes);
  if (!data || data.length === 0) throw new Error('Файл шаблону порожній.');
  const notZip = 'Файл шаблону пошкоджений або це не документ Office: очікувався ZIP-архів DOCX, PPTX чи XLSX.';
  if (data.length < 4 || data[0] !== 0x50 || data[1] !== 0x4b) throw new Error(notZip);
  try {
    return { zip: await JSZip.loadAsync(data), data };
  } catch {
    throw new Error(notZip);
  }
}

async function readPart(zip, path) {
  const file = zip.file(path);
  if (!file) return null;
  const tooLarge = () => new Error(`Частина шаблону «${path}» завелика: понад 64 МБ тексту.`);
  // Розмір із заголовка архіву (внутрішнє поле JSZip 3) — до розпакування; текст — ще раз після.
  const declared = file._data?.uncompressedSize;
  if (typeof declared === 'number' && declared > MAX_PART_CHARS * 2) throw tooLarge();
  let text;
  try {
    text = await file.async('string');
  } catch {
    throw new Error(`Не вдалося прочитати частину «${path}»: файл шаблону пошкоджено.`);
  }
  if (text.length > MAX_PART_CHARS) throw tooLarge();
  return text;
}

function writePart(zip, path, root) {
  const date = zip.file(path)?.date;
  zip.file(path, serializeTree(root), date ? { date } : {});
}

const missingMainPart = (path, format) =>
  new Error(`У файлі немає основної частини «${path}»: це не ${format} або файл пошкоджено.`);

function resolvePath(base, target) {
  const raw = target.startsWith('/') ? target.slice(1) : `${base}${target}`;
  const out = [];
  for (const segment of raw.split('/')) {
    if (segment === '..') out.pop();
    else if (segment && segment !== '.') out.push(segment);
  }
  return out.join('/');
}

const dirOf = path => path.slice(0, path.lastIndexOf('/') + 1);
const relsPathOf = path => `${dirOf(path)}_rels/${path.slice(path.lastIndexOf('/') + 1)}.rels`;

// Зв'язки частини: id → шлях в архіві (зовнішні посилання пропускаються).
async function relationshipTargets(zip, relsPath, baseDir) {
  const targets = new Map();
  const xml = await readPart(zip, relsPath);
  if (!xml) return targets;
  const tree = parseXml(xml, relsPath);
  for (const rel of descendants(tree, el => localName(el.name) === 'Relationship')) {
    const id = getAttr(rel, 'Id');
    const target = getAttr(rel, 'Target');
    if (!id || !target || getAttr(rel, 'TargetMode') === 'External') continue;
    targets.set(id, resolvePath(baseDir, target));
  }
  return targets;
}

const partNumber = path => Number(/(\d+)\.xml$/.exec(path)?.[1] ?? 0);
const byPartNumber = (a, b) => partNumber(a) - partNumber(b) || a.localeCompare(b);

// ---------------------------------------------------------------------------------------------
// Контекст

function scopeOf(fields, blocks) {
  return {
    fields: fields && typeof fields === 'object' ? fields : {},
    blocks: blocks && typeof blocks === 'object' ? blocks : {},
  };
}

// Елемент блоку — { fields, blocks? }; простий об'єкт без `fields` вважається самими полями.
function itemScope(item) {
  if (!item || typeof item !== 'object') return scopeOf(null, null);
  if (Object.hasOwn(item, 'fields') && item.fields && typeof item.fields === 'object') return scopeOf(item.fields, item.blocks);
  return scopeOf(item, null);
}

function lookupField(name, scopes) {
  for (let i = scopes.length - 1; i >= 0; i -= 1) {
    if (Object.hasOwn(scopes[i].fields, name)) return { found: true, value: scopes[i].fields[name] };
  }
  return { found: false, value: undefined };
}

function fieldText(name, scopes, state) {
  const { found, value } = lookupField(name, scopes);
  if (!found) {
    state.missing.add(name);
    return '';
  }
  state.used.add(name);
  return valueText(value);
}

function blockItems(name, scopes, state) {
  for (let i = scopes.length - 1; i >= 0; i -= 1) {
    if (!Object.hasOwn(scopes[i].blocks, name)) continue;
    const items = scopes[i].blocks[name];
    if (Array.isArray(items)) {
      state.used.add(name);
      return items;
    }
    break;
  }
  state.missing.add(name);
  return [];
}

// ---------------------------------------------------------------------------------------------
// DOCX і PPTX: абзаци й рядки таблиць

const WORD = Object.freeze({
  para: 'w:p',
  text: 'w:t',
  row: 'w:tr',
  cell: 'w:tc',
  table: 'w:tbl',
  units: new Set(['w:p', 'w:tbl', 'w:tr', 'w:sdt', 'w:customXml']),
  // Де останнім має бути абзац (порожня клітинка без w:p — пошкоджений документ).
  paraHosts: new Set(['w:body', 'w:tc', 'w:txbxContent', 'w:hdr', 'w:ftr']),
  lastMustBePara: true,
  // З таким вмістом абзац із маркером не прибирається (малюнок, розрив, поле Word тощо).
  blockers: new Set([
    'w:drawing', 'w:pict', 'w:object', 'w:br', 'w:cr', 'w:fldChar', 'w:fldSimple', 'w:sym',
    'w:footnoteReference', 'w:endnoteReference', 'w:commentReference', 'mc:AlternateContent',
    'm:oMath', 'm:oMathPara',
  ]),
  preserveSpace: true,
  removeEmptyTable: true,
  where: 'в абзацах одного рівня: в основному тексті, в одній клітинці або в рядках однієї таблиці',
});

const SLIDE = Object.freeze({
  para: 'a:p',
  text: 'a:t',
  row: 'a:tr',
  cell: 'a:tc',
  table: 'a:tbl',
  units: new Set(['a:p', 'a:tr']),
  paraHosts: new Set(['p:txBody', 'a:txBody']),
  lastMustBePara: false,
  blockers: new Set(['a:fld', 'a:br']),
  preserveSpace: false,
  removeEmptyTable: false,
  where: 'в одному текстовому полі або в рядках однієї таблиці',
});

// Абзаци в порядку документа, зокрема вкладені (текстові поля); оброблені блоки пропускаються.
function paragraphsOf(node, profile, out = []) {
  for (const child of node.children) {
    if (!isElement(child) || child.filled) continue;
    if (child.name === profile.para) out.push(child);
    paragraphsOf(child, profile, out);
  }
  return out;
}

// Текстові елементи самого абзацу (без вкладених абзаців текстових полів).
function ownTexts(para, profile, out = []) {
  for (const child of para.children) {
    if (!isElement(child) || child.name === profile.para) continue;
    if (child.name === profile.text) out.push(child);
    else ownTexts(child, profile, out);
  }
  return out;
}

const paragraphText = (para, profile) => ownTexts(para, profile).map(textOf).join('');

function scanParagraphs(paras, profile) {
  const fields = new Set();
  const blocks = new Set();
  const invalid = [];
  const markers = [];
  for (const para of paras) {
    const text = paragraphText(para, profile);
    if (!text.includes('{{')) continue;
    const scan = scanTokens(text);
    invalid.push(...scan.invalid);
    let index = 0;
    for (const token of scan.tokens) {
      if (token.type === 'text') continue;
      if (token.type === 'field') fields.add(token.name);
      else {
        blocks.add(token.name);
        markers.push({ type: token.type, name: token.name, para, index });
      }
      index += 1;
    }
  }
  return { fields, blocks, invalid, markers };
}

// Пари маркерів верхнього рівня з вкладеними (`children`); маркери вже перевірено blockErrors.
function pairMarkers(markers) {
  const roots = [];
  const stack = [];
  for (const marker of markers) {
    if (marker.type === 'open') {
      const pair = { name: marker.name, open: marker, close: null, children: [] };
      (stack.length ? stack[stack.length - 1].children : roots).push(pair);
      stack.push(pair);
    } else {
      const pair = stack.pop();
      if (pair) pair.close = marker;
    }
  }
  return roots.filter(pair => pair.close);
}

// Що повторює блок: від елемента з маркером початку до елемента з маркером кінця серед дітей
// найближчого спільного предка; маркери в різних клітинках одного рядка → увесь рядок.
function blockRange(openPara, closePara, profile) {
  if (openPara === closePara) return { parent: openPara.parent, first: openPara, last: openPara };
  const path = new Map();
  for (let node = openPara; node.parent; node = node.parent) path.set(node.parent, node);
  let parent = null;
  let last = null;
  for (let node = closePara; node.parent; node = node.parent) {
    if (path.has(node.parent)) {
      parent = node.parent;
      last = node;
      break;
    }
  }
  if (!parent) return null;
  let first = path.get(parent);
  if (first.name === profile.cell && last.name === profile.cell) {
    first = parent;
    last = parent;
    parent = parent.parent;
  }
  if (!parent || !profile.units.has(first.name) || !profile.units.has(last.name)) return null;
  return { parent, first, last };
}

function rangeNodes({ parent, first, last }) {
  return parent.children.slice(parent.children.indexOf(first), parent.children.indexOf(last) + 1);
}

// Перевірка розташування блоків одного рівня (і вкладених) у вихідному дереві.
function checkPairs(pairs, profile, label, errors) {
  const owner = new Map();
  const ranges = [];
  for (const pair of pairs) {
    const range = blockRange(pair.open.para, pair.close.para, profile);
    if (!range) {
      errors.push(`${label}. Блок «${pair.name}» має починатися й закінчуватися ${profile.where}`);
      ranges.push(null);
      continue;
    }
    ranges.push(range);
  }
  const overlap = (a, b) =>
    errors.push(`${label}. Блоки «${a}» і «${b}» перетинаються: розмістіть їхні маркери в окремих абзацах або рядках`);
  const reported = new Set();
  pairs.forEach((pair, i) => {
    if (!ranges[i]) return;
    for (const node of rangeNodes(ranges[i])) {
      const other = owner.get(node);
      if (other !== undefined && !reported.has(`${other}:${i}`)) {
        reported.add(`${other}:${i}`);
        overlap(pairs[other].name, pair.name);
      }
      owner.set(node, i);
    }
  });
  pairs.forEach((pair, i) => {
    if (!ranges[i]) return;
    for (const node of rangeNodes(ranges[i])) {
      for (let up = node.parent; up; up = up.parent) {
        const other = owner.get(up);
        if (other !== undefined && other !== i && !reported.has(`${other}:${i}`)) {
          reported.add(`${other}:${i}`);
          overlap(pairs[other].name, pair.name);
        }
      }
    }
  });
  for (const pair of pairs) checkPairs(pair.children, profile, label, errors);
}

function analyzeTree(root, profile, label) {
  const scan = scanParagraphs(paragraphsOf(root, profile), profile);
  const errors = [];
  const nesting = blockErrors(scan.markers);
  if (nesting.length) errors.push(...nesting.map(error => `${label}. ${error}`));
  else checkPairs(pairMarkers(scan.markers), profile, label, errors);
  return {
    fields: scan.fields,
    blocks: scan.blocks,
    invalid: scan.invalid.map(raw => `${label}. ${invalidMarkerError(raw)}`),
    errors,
    hasTokens: scan.fields.size > 0 || scan.blocks.size > 0,
  };
}

function rewriteParagraph(para, profile, replace) {
  const els = ownTexts(para, profile);
  if (!els.length) return;
  const texts = els.map(textOf);
  if (!texts.join('').includes('{{')) return;
  const out = rewritePieces(texts, replace);
  out.forEach((text, i) => {
    if (text !== texts[i]) setText(els[i], text, profile.preserveSpace);
  });
}

// Чи можна прибрати крайній абзац (рядок) блоку: крім його маркерів, у ньому лише пробіли.
function droppable(unit, skips, profile) {
  if (unit.name !== profile.para && unit.name !== profile.row) return false;
  if (hasDescendant(unit, el => profile.blockers.has(el.name))) return false;
  const paras = unit.name === profile.para ? [unit, ...paragraphsOf(unit, profile)] : paragraphsOf(unit, profile);
  for (const para of paras) {
    const skip = skips.get(para);
    let index = 0;
    for (const token of scanTokens(paragraphText(para, profile)).tokens) {
      if (token.type === 'text') {
        if (token.raw.trim()) return false;
        continue;
      }
      if (!skip || !skip.has(index)) return false;
      index += 1;
    }
  }
  return true;
}

function addSkip(skips, para, index) {
  if (!skips.has(para)) skips.set(para, new Set());
  skips.get(para).add(index);
  return skips;
}

// Після зміни дітей: таблиця без рядків прибирається (DOCX), клітинка чи текстове поле без
// абзацу отримує порожній абзац — інакше Word і PowerPoint вважають файл пошкодженим.
function tidyHost(host, profile, state) {
  if (host.name === profile.table && !elements(host).some(el => el.name === profile.row)) {
    if (profile.removeEmptyTable && host.parent) {
      const outer = host.parent;
      outer.children = outer.children.filter(child => child !== host);
      // Копію елемента блоку перевірить виклик рівнем вище, коли вставить її в документ.
      if (!outer.temp) tidyHost(outer, profile, state);
    } else {
      state.warnings.push(`${state.label}. Таблиця залишилася без рядків: блок не має жодного запису`);
    }
    return;
  }
  if (!profile.paraHosts.has(host.name)) return;
  const blocks = elements(host).filter(el => el.name !== 'w:sectPr');
  const ok = profile.lastMustBePara
    ? blocks.length > 0 && blocks[blocks.length - 1].name === profile.para
    : blocks.some(el => el.name === profile.para);
  if (ok) return;
  const para = emptyElement(profile.para);
  para.parent = host;
  const sectPr = host.children.findIndex(child => isElement(child) && child.name === 'w:sectPr');
  if (sectPr !== -1) host.children.splice(sectPr, 0, para);
  else host.children.push(para);
}

function expandPair(pair, scopes, state, profile) {
  const range = blockRange(pair.open.para, pair.close.para, profile);
  if (!range) {
    // Розташування перевірено до заповнення; сюди потрапляє лише непередбачена структура.
    state.warnings.push(`${state.label}. Блок «${pair.name}» не розгорнуто: незвичне розташування маркерів`);
    return;
  }
  const { parent, first, last } = range;
  const start = parent.children.indexOf(first);
  const end = parent.children.indexOf(last);
  let body = parent.children.slice(start, end + 1);
  if (first === last) {
    const skips = addSkip(addSkip(new Map(), pair.open.para, pair.open.index), pair.close.para, pair.close.index);
    if (droppable(first, skips, profile)) body = [];
  } else {
    if (droppable(last, addSkip(new Map(), pair.close.para, pair.close.index), profile)) body = body.slice(0, -1);
    if (droppable(first, addSkip(new Map(), pair.open.para, pair.open.index), profile)) body = body.slice(1);
  }
  const items = blockItems(pair.name, scopes, state);
  const output = [];
  for (const item of items) {
    const map = new Map();
    const temp = { type: 'el', name: parent.name, open: parent.open, close: parent.close, children: [], parent: null, temp: true };
    temp.children = body.map(node => cloneNode(node, temp, map));
    const targets = new Map();
    if (map.has(pair.open.para)) addSkip(targets, map.get(pair.open.para), pair.open.index);
    if (map.has(pair.close.para)) addSkip(targets, map.get(pair.close.para), pair.close.index);
    for (const [para, indexes] of targets) rewriteParagraph(para, profile, (token, index) => (indexes.has(index) ? '' : null));
    expandTree(temp, [...scopes, itemScope(item)], state, profile);
    for (const node of temp.children) {
      node.parent = parent;
      if (isElement(node)) node.filled = true;
      output.push(node);
    }
  }
  parent.children = [...parent.children.slice(0, start), ...output, ...parent.children.slice(end + 1)];
  if (!parent.temp) tidyHost(parent, profile, state);
}

function expandTree(container, scopes, state, profile) {
  const { markers } = scanParagraphs(paragraphsOf(container, profile), profile);
  const pairs = pairMarkers(markers);
  for (let i = pairs.length - 1; i >= 0; i -= 1) expandPair(pairs[i], scopes, state, profile);
  for (const para of paragraphsOf(container, profile)) {
    rewriteParagraph(para, profile, token => (token.type === 'field' ? fieldText(token.name, scopes, state) : ''));
  }
}

async function documentParts(zip) {
  if (!zip.file('word/document.xml')) throw missingMainPart('word/document.xml', 'DOCX');
  const files = Object.keys(zip.files);
  const headers = files.filter(path => /^word\/header\d*\.xml$/.test(path)).sort(byPartNumber);
  const footers = files.filter(path => /^word\/footer\d*\.xml$/.test(path)).sort(byPartNumber);
  return [
    { path: 'word/document.xml', label: 'Документ' },
    ...headers.map(path => ({ path, label: `Верхній колонтитул ${partNumber(path) || 1}` })),
    ...footers.map(path => ({ path, label: `Нижній колонтитул ${partNumber(path) || 1}` })),
  ];
}

async function slideParts(zip) {
  const presentation = await readPart(zip, 'ppt/presentation.xml');
  if (presentation === null) throw missingMainPart('ppt/presentation.xml', 'PPTX');
  const files = Object.keys(zip.files).filter(path => /^ppt\/slides\/slide\d+\.xml$/.test(path)).sort(byPartNumber);
  const rels = await relationshipTargets(zip, 'ppt/_rels/presentation.xml.rels', 'ppt/');
  const ordered = [];
  for (const slide of descendants(parseXml(presentation, 'ppt/presentation.xml'), el => localName(el.name) === 'sldId')) {
    const path = rels.get(relationId(slide));
    if (path && files.includes(path) && !ordered.includes(path)) ordered.push(path);
  }
  for (const path of files) if (!ordered.includes(path)) ordered.push(path);
  return ordered.map((path, i) => ({ path, label: `Слайд ${i + 1}` }));
}

// Частини DOCX/PPTX з полями: дерево й розбір. Частини без «{» не розбираються.
async function loadTreeParts(zip, kind) {
  const profile = kind === 'docx' ? WORD : SLIDE;
  const parts = kind === 'docx' ? await documentParts(zip) : await slideParts(zip);
  const loaded = [];
  for (const part of parts) {
    const xml = await readPart(zip, part.path);
    if (!xml || !xml.includes('{')) continue;
    const tree = parseXml(xml, part.path);
    loaded.push({ ...part, tree, analysis: analyzeTree(tree, profile, part.label) });
  }
  return { profile, parts: loaded };
}

// ---------------------------------------------------------------------------------------------
// XLSX: спільні й вбудовані рядки, рядки-блоки

const byLocal = local => el => localName(el.name) === local;
const firstLocal = (node, local) => elements(node).find(byLocal(local)) ?? null;

// Фрагменти тексту рядка Excel (<si> або <is>): t і r/t; фонетичні підказки rPh пропускаються.
function richTexts(node) {
  const out = [];
  for (const child of elements(node)) {
    const local = localName(child.name);
    if (local === 't') out.push(child);
    else if (local === 'r') out.push(...elements(child).filter(byLocal('t')));
  }
  return out;
}

function cellTemplate(cell, strings) {
  const type = getAttr(cell, 't');
  if (type === 's') {
    const v = firstLocal(cell, 'v');
    const index = v ? Number(textOf(v).trim()) : Number.NaN;
    const si = Number.isInteger(index) ? strings[index] : null;
    return si ? { shared: true, node: si } : null;
  }
  if (type === 'inlineStr') {
    const is = firstLocal(cell, 'is');
    return is ? { shared: false, node: is } : null;
  }
  return null;
}

const CELL_REF = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/;

function parseRange(ref) {
  const [a, b = a, extra] = String(ref ?? '').split(':');
  if (extra !== undefined) return null;
  const p = CELL_REF.exec(a);
  const q = CELL_REF.exec(b);
  if (!p || !q) return null;
  return { p, q, r1: Number(p[4]), r2: Number(q[4]), single: !String(ref).includes(':') };
}

function formatRange({ p, q, single }, r1, r2) {
  const left = `${p[1]}${p[2]}${p[3]}${r1}`;
  const right = `${q[1]}${q[2]}${q[3]}${r2}`;
  return single && left === right ? left : `${left}:${right}`;
}

// Нові номери рядків після розгортання блоків: events — [{ row, count }] за зростанням.
function rowMapper(events) {
  const locate = row => {
    let shift = 0;
    for (const event of events) {
      if (event.row < row) shift += event.count - 1;
      else return { shift, event: event.row === row ? event : null };
    }
    return { shift, event: null };
  };
  return {
    start: row => row + locate(row).shift,
    end: row => {
      const { shift, event } = locate(row);
      return row + shift + (event ? event.count - 1 : 0);
    },
    event: row => locate(row).event,
  };
}

function shiftRange(ref, mapper) {
  const range = parseRange(ref);
  if (!range) return ref;
  const r1 = mapper.start(range.r1);
  const r2 = mapper.end(range.r2);
  return r2 < r1 ? null : formatRange(range, r1, r2);
}

function shiftSqref(sqref, mapper) {
  const parts = String(sqref).split(/\s+/).filter(Boolean).map(ref => shiftRange(ref, mapper)).filter(Boolean);
  return parts.length ? parts.join(' ') : null;
}

function renumberRow(row, number) {
  if (getAttr(row, 'r') !== null) setAttr(row, 'r', number);
  for (const cell of elements(row).filter(byLocal('c'))) {
    const ref = CELL_REF.exec(getAttr(cell, 'r') ?? '');
    if (ref) setAttr(cell, 'r', `${ref[1]}${ref[2]}${ref[3]}${number}`);
  }
}

function fillRow(row, strings, scopes, state) {
  for (const cell of elements(row).filter(byLocal('c'))) {
    const template = cellTemplate(cell, strings);
    if (!template) continue;
    const texts = richTexts(template.node).map(textOf);
    const text = texts.join('');
    if (!text.includes('{{')) continue;
    const values = scanTokens(text).tokens.filter(token => token.type === 'field' || (token.type === 'text' && token.raw.trim()));
    const prefix = prefixOf(cell.name);
    if (values.length === 1 && values[0].type === 'field') {
      const { found, value } = lookupField(values[0].name, scopes);
      const number = found ? numericValue(value) : null;
      if (number !== null) {
        state.used.add(values[0].name);
        removeAttr(cell, 't');
        setChildren(cell, [makeElement(`${prefix}v`, '', [textNode(String(number))])]);
        continue;
      }
    }
    const out = rewritePieces(texts, token => (token.type === 'field' ? fieldText(token.name, scopes, state) : ''));
    if (!out.join('')) {
      removeAttr(cell, 't');
      setChildren(cell, []);
      continue;
    }
    let is = template.node;
    if (template.shared) {
      is = makeElement(`${prefix}is`);
      setChildren(is, template.node.children.map(child => cloneNode(child, is)));
    }
    richTexts(is).forEach((el, i) => {
      if (out[i] !== textOf(el)) setText(el, out[i], true);
    });
    setAttr(cell, 't', 'inlineStr');
    setChildren(cell, [is]);
  }
}

// Спільні формули й формули масиву в копіях рядка блоку (крім першої) лишаються значеннями:
// кілька «головних» формул з одним si Excel вважає пошкодженням.
function stripSharedFormulas(row) {
  for (const cell of elements(row).filter(byLocal('c'))) {
    cell.children = cell.children.filter(child => {
      if (!isElement(child) || localName(child.name) !== 'f') return true;
      const type = getAttr(child, 't');
      return type !== 'shared' && type !== 'array';
    });
  }
}

function shiftFormulaRefs(row, mapper, copyRow = null) {
  for (const f of descendants(row, byLocal('f'))) {
    const ref = getAttr(f, 'ref');
    const range = ref && parseRange(ref);
    if (!range) continue;
    if (copyRow !== null && range.r1 === range.r2) setAttr(f, 'ref', formatRange(range, copyRow, copyRow));
    else {
      const shifted = shiftRange(ref, mapper);
      if (shifted) setAttr(f, 'ref', shifted);
    }
  }
}

const REF_ELEMENTS = new Set(['dimension', 'hyperlink', 'autoFilter', 'conditionalFormatting', 'dataValidation', 'protectedRange', 'ignoredError']);

function shiftMerges(mergeCells, mapper) {
  const kept = [];
  for (const child of mergeCells.children) {
    if (!isElement(child) || localName(child.name) !== 'mergeCell') {
      kept.push(child);
      continue;
    }
    const ref = getAttr(child, 'ref');
    const range = parseRange(ref);
    if (!range) {
      kept.push(child);
      continue;
    }
    const event = range.r1 === range.r2 ? mapper.event(range.r1) : null;
    if (event) {
      // Об'єднання всередині рядка блоку повторюється в кожній копії рядка.
      const row = mapper.start(range.r1);
      for (let i = 0; i < event.count; i += 1) {
        const copy = cloneNode(child, mergeCells);
        setAttr(copy, 'ref', formatRange(range, row + i, row + i));
        kept.push(copy);
      }
      continue;
    }
    const shifted = shiftRange(ref, mapper);
    if (shifted) {
      setAttr(child, 'ref', shifted);
      kept.push(child);
    }
  }
  mergeCells.children = kept;
  const count = kept.filter(node => isElement(node) && localName(node.name) === 'mergeCell').length;
  if (getAttr(mergeCells, 'count') !== null) setAttr(mergeCells, 'count', count);
  return count;
}

// Обгортки списків, що не можуть бути порожніми (count — кількість елементів).
const REF_CONTAINERS = new Set(['dataValidations', 'hyperlinks', 'ignoredErrors', 'protectedRanges']);

function shiftWorksheetRefs(worksheet, mapper) {
  for (const el of elements(worksheet)) {
    const local = localName(el.name);
    if (local === 'sheetData') continue;
    if (local === 'mergeCells') {
      if (shiftMerges(el, mapper) === 0) worksheet.children = worksheet.children.filter(child => child !== el);
      continue;
    }
    shiftElementRefs(el, mapper);
    if (!REF_CONTAINERS.has(local)) continue;
    const count = elements(el).length;
    if (count === 0) worksheet.children = worksheet.children.filter(child => child !== el);
    else if (getAttr(el, 'count') !== null) setAttr(el, 'count', count);
  }
}

// Діапазони ref/sqref (умовне форматування, перевірка даних, гіперпосилання, фільтр);
// діапазон, що зник разом із порожнім блоком, прибирається.
function shiftElementRefs(el, mapper) {
  for (const node of [el, ...descendants(el, () => true)]) {
    const name = localName(node.name);
    if (!REF_ELEMENTS.has(name)) continue;
    const ref = getAttr(node, 'ref');
    const sqref = getAttr(node, 'sqref');
    const shifted = ref !== null ? shiftRange(ref, mapper) : sqref !== null ? shiftSqref(sqref, mapper) : undefined;
    if (shifted === undefined) continue;
    if (shifted === null) {
      if (name === 'dimension') setAttr(node, 'ref', 'A1');
      else if (node.parent) node.parent.children = node.parent.children.filter(child => child !== node);
    } else {
      setAttr(node, ref !== null ? 'ref' : 'sqref', shifted);
    }
  }
}

// Таблиці Excel (Вставлення → Таблиця) на аркуші: діапазон розширюється разом із блоком.
async function shiftTables(zip, sheet, mapper, state) {
  const tableParts = descendants(sheet.info.worksheet, byLocal('tablePart'));
  if (!tableParts.length) return;
  const rels = await relationshipTargets(zip, relsPathOf(sheet.path), dirOf(sheet.path));
  for (const part of tableParts) {
    const target = rels.get(relationId(part));
    const xml = target ? await readPart(zip, target) : null;
    if (!xml) continue;
    const tree = parseXml(xml, target);
    for (const el of descendants(tree, node => ['table', 'autoFilter', 'sortState', 'sortCondition'].includes(localName(node.name)))) {
      const ref = getAttr(el, 'ref');
      const shifted = ref ? shiftRange(ref, mapper) : null;
      if (shifted) setAttr(el, 'ref', shifted);
    }
    const table = descendants(tree, byLocal('table'))[0];
    const range = table && parseRange(getAttr(table, 'ref'));
    if (range) {
      const header = Number(getAttr(table, 'headerRowCount') ?? 1) || 0;
      const totals = Number(getAttr(table, 'totalsRowCount') ?? 0) || 0;
      if (range.r2 - range.r1 + 1 - header - totals < 1) {
        const name = getAttr(table, 'displayName') ?? getAttr(table, 'name') ?? '';
        state.warnings.push(`Таблиця Excel «${name}» залишилася без рядків даних: ${sheet.label}; Excel може запропонувати її відновити`);
      }
    }
    writePart(zip, target, tree);
  }
}

// Ланцюжок обчислень посилається на старі адреси клітинок — Excel перебудує його сам.
async function dropCalcChain(zip) {
  if (!zip.file('xl/calcChain.xml')) return;
  zip.remove('xl/calcChain.xml');
  const typesXml = await readPart(zip, '[Content_Types].xml');
  if (typesXml) {
    const tree = parseXml(typesXml, '[Content_Types].xml');
    if (removeWhere(tree, el => localName(el.name) === 'Override' && getAttr(el, 'PartName') === '/xl/calcChain.xml')) {
      writePart(zip, '[Content_Types].xml', tree);
    }
  }
  const relsXml = await readPart(zip, 'xl/_rels/workbook.xml.rels');
  if (relsXml) {
    const tree = parseXml(relsXml, 'xl/_rels/workbook.xml.rels');
    const isCalcChain = el => localName(el.name) === 'Relationship' && resolvePath('xl/', getAttr(el, 'Target') ?? '') === 'xl/calcChain.xml';
    if (removeWhere(tree, isCalcChain)) writePart(zip, 'xl/_rels/workbook.xml.rels', tree);
  }
}

// Просить Excel перерахувати формули під час відкриття (кешовані значення застаріли).
function requestRecalc(workbookTree) {
  const workbook = elements(workbookTree).find(byLocal('workbook'));
  if (!workbook) return false;
  const calcPr = firstLocal(workbook, 'calcPr');
  if (calcPr) {
    if (getAttr(calcPr, 'fullCalcOnLoad') === '1') return false;
    setAttr(calcPr, 'fullCalcOnLoad', '1');
    return true;
  }
  const created = emptyElement(`${prefixOf(workbook.name)}calcPr`, ' fullCalcOnLoad="1"');
  created.parent = workbook;
  const before = new Set(['sheets', 'functionGroups', 'externalReferences', 'definedNames']);
  let at = -1;
  workbook.children.forEach((child, i) => {
    if (isElement(child) && before.has(localName(child.name))) at = i;
  });
  workbook.children.splice(at + 1, 0, created);
  return true;
}

function analyzeSheet(tree, strings, label) {
  const sheet = { worksheet: null, sheetData: null, rows: [], fields: new Set(), blocks: new Set(), invalid: [], errors: [], hasTokens: false };
  sheet.worksheet = elements(tree).find(byLocal('worksheet')) ?? null;
  sheet.sheetData = sheet.worksheet ? firstLocal(sheet.worksheet, 'sheetData') : null;
  if (!sheet.sheetData) return sheet;
  const markers = [];
  let number = 0;
  for (const el of elements(sheet.sheetData).filter(byLocal('row'))) {
    const r = Number(getAttr(el, 'r'));
    number = Number.isInteger(r) && r > 0 ? r : number + 1;
    const row = { el, number, pair: null, hasTokens: false, hasFormula: hasDescendant(el, byLocal('f')) };
    sheet.rows.push(row);
    for (const cell of elements(el).filter(byLocal('c'))) {
      const template = cellTemplate(cell, strings);
      if (!template) continue;
      const text = richTexts(template.node).map(textOf).join('');
      if (!text.includes('{{')) continue;
      const scan = scanTokens(text);
      sheet.invalid.push(...scan.invalid.map(raw => `${label}. ${invalidMarkerError(raw)}`));
      for (const token of scan.tokens) {
        if (token.type === 'text') continue;
        row.hasTokens = true;
        if (token.type === 'field') sheet.fields.add(token.name);
        else {
          sheet.blocks.add(token.name);
          markers.push({ type: token.type, name: token.name, row });
        }
      }
    }
  }
  sheet.hasTokens = sheet.rows.some(row => row.hasTokens);
  const nesting = blockErrors(markers);
  if (nesting.length) {
    sheet.errors.push(...nesting.map(error => `${label}. ${error}`));
    return sheet;
  }
  const stack = [];
  for (const marker of markers) {
    if (marker.type === 'open') {
      if (stack.length) {
        sheet.errors.push(`${label}. Вкладені блоки на аркуші не підтримуються: «${marker.name}» усередині «${stack[stack.length - 1].name}»`);
      }
      stack.push(marker);
      continue;
    }
    const open = stack.pop();
    if (stack.length) continue;
    if (open.row !== marker.row) {
      sheet.errors.push(`${label}. Блок «${open.name}» має починатися й закінчуватися в одному рядку аркуша (зараз рядки ${open.row.number}–${marker.row.number})`);
    } else if (open.row.pair) {
      sheet.errors.push(`${label}. У рядку ${open.row.number} може бути лише один блок: «${open.row.pair.name}» і «${open.name}»`);
    } else {
      open.row.pair = { name: open.name };
    }
  }
  return sheet;
}

async function worksheetParts(zip, workbookTree) {
  const rels = await relationshipTargets(zip, 'xl/_rels/workbook.xml.rels', 'xl/');
  const parts = [];
  for (const sheet of descendants(workbookTree, byLocal('sheet'))) {
    const path = rels.get(relationId(sheet));
    if (!path || !zip.file(path) || parts.some(part => part.path === path)) continue;
    const name = getAttr(sheet, 'name') ?? path;
    parts.push({ path, name, label: `Аркуш «${name}»` });
  }
  const rest = Object.keys(zip.files).filter(path => /^xl\/worksheets\/[^/]+\.xml$/.test(path) && !parts.some(part => part.path === path));
  for (const path of rest.sort(byPartNumber)) {
    const name = path.slice(path.lastIndexOf('/') + 1, -4);
    parts.push({ path, name, label: `Аркуш «${name}»` });
  }
  return parts;
}

async function loadWorkbook(zip) {
  const workbookXml = await readPart(zip, 'xl/workbook.xml');
  if (workbookXml === null) throw missingMainPart('xl/workbook.xml', 'XLSX');
  const workbookTree = parseXml(workbookXml, 'xl/workbook.xml');
  const sstXml = await readPart(zip, 'xl/sharedStrings.xml');
  const sstTree = sstXml && sstXml.includes('{') ? parseXml(sstXml, 'xl/sharedStrings.xml') : null;
  const sst = sstTree ? elements(sstTree).find(byLocal('sst')) : null;
  const strings = sst ? elements(sst).filter(byLocal('si')) : [];
  const sheets = [];
  for (const part of await worksheetParts(zip, workbookTree)) {
    const xml = await readPart(zip, part.path);
    if (!xml) continue;
    const hasFormula = /<(?:[\w.-]+:)?f[\s>/]/.test(xml);
    if (!sstTree && !xml.includes('{')) {
      sheets.push({ ...part, hasFormula, info: null });
      continue;
    }
    const tree = parseXml(xml, part.path);
    sheets.push({ ...part, hasFormula, tree, info: analyzeSheet(tree, strings, part.label) });
  }
  return { workbookTree, strings, sheets };
}

// Розгортає рядки-блоки й заповнює клітинки; повертає відображення номерів рядків, якщо
// нижчі рядки зсунулися (інакше null).
function expandSheet(sheet, strings, state, root) {
  const { info } = sheet;
  const events = [];
  const copies = new Map();
  let offset = 0;
  for (const row of info.rows) {
    if (!row.pair) {
      if (offset) renumberRow(row.el, row.number + offset);
      if (row.hasTokens) fillRow(row.el, strings, [root], state);
      continue;
    }
    const items = blockItems(row.pair.name, [root], state);
    copies.set(row.el, items.map((item, i) => {
      const copy = cloneNode(row.el, row.el.parent);
      renumberRow(copy, row.number + offset + i);
      fillRow(copy, strings, [root, itemScope(item)], state);
      if (i > 0) stripSharedFormulas(copy);
      return copy;
    }));
    events.push({ row: row.number, count: items.length, name: row.pair.name, hasFormula: row.hasFormula });
    offset += items.length - 1;
  }
  if (!events.length || events.every(event => event.count === 1)) {
    if (events.length) info.sheetData.children = info.sheetData.children.flatMap(child => copies.get(child) ?? [child]);
    return null;
  }
  const mapper = rowMapper(events);
  for (const row of info.rows) {
    if (row.pair) {
      const start = mapper.start(row.number);
      copies.get(row.el).forEach((copy, i) => shiftFormulaRefs(copy, mapper, start + i));
    } else if (row.hasFormula) {
      shiftFormulaRefs(row.el, mapper);
    }
  }
  info.sheetData.children = info.sheetData.children.flatMap(child => copies.get(child) ?? [child]);
  shiftWorksheetRefs(info.worksheet, mapper);
  for (const event of events) {
    if (event.count === 1) continue;
    if (info.rows.some(row => row.number > event.row && row.hasFormula)) {
      state.warnings.push(`Формули нижче блоку «${event.name}» не перераховано: ${sheet.label}, посилання на зсунуті рядки перевірте вручну`);
    }
    if (event.hasFormula && event.count > 1) {
      state.warnings.push(`Формули в рядку блоку «${event.name}» скопійовано без зміни посилань: ${sheet.label}`);
    }
  }
  return mapper;
}

// ---------------------------------------------------------------------------------------------
// Публічні функції

async function loadTemplate(bytes, ext, JSZip) {
  const kind = templateKind(ext);
  const { zip, data } = await openZip(bytes, JSZip);
  if (kind === 'xlsx') return { kind, zip, data, workbook: await loadWorkbook(zip) };
  return { kind, zip, data, ...(await loadTreeParts(zip, kind)) };
}

function templateAnalyses(template) {
  if (template.kind === 'xlsx') return template.workbook.sheets.map(sheet => sheet.info).filter(Boolean);
  return template.parts.map(part => part.analysis);
}

/**
 * Поля, блоки й помилки шаблону: { fields, blocks, errors } (назви — без повторів, за
 * абеткою). Не ZIP, невідомий формат чи немає основної частини — виняток українською.
 */
export async function listTemplateFields(bytes, ext, { JSZip } = {}) {
  const template = await loadTemplate(bytes, ext, JSZip);
  const fields = new Set();
  const blocks = new Set();
  const errors = [];
  for (const analysis of templateAnalyses(template)) {
    analysis.fields.forEach(name => fields.add(name));
    analysis.blocks.forEach(name => blocks.add(name));
    errors.push(...analysis.invalid, ...analysis.errors);
  }
  return { fields: sortNames(fields), blocks: sortNames(blocks), errors };
}

/**
 * Заповнює шаблон: context = { fields: { назва: текст|число }, blocks: { назва: [{ fields }] } };
 * усередині блоку поля елемента затіняють зовнішні. Повертає { bytes, missing, used, warnings }:
 * `missing` — невідомі поля й блоки (у документі порожньо), `used` — заповнені.
 * DOCX: word/document.xml і колонтитули, блок повторює абзаци або рядки таблиці від елемента
 * з маркером початку до елемента з маркером кінця (маркери в різних клітинках одного рядка —
 * увесь рядок); крайній абзац чи рядок, де крім маркера нічого немає, у результат не потрапляє.
 * PPTX: слайди, абзаци a:p і рядки a:tr. XLSX: спільні й вбудовані рядки; клітинка з одним
 * полем і числовим значенням стає числом; блок — рядок аркуша з {{#…}} і {{/…}}, нижчі рядки
 * зсуваються. Помилки розташування блоків — виняток зі списком помилок.
 */
export async function fillTemplate(bytes, ext, context = {}, { JSZip } = {}) {
  const template = await loadTemplate(bytes, ext, JSZip);
  const analyses = templateAnalyses(template);
  const errors = analyses.flatMap(analysis => analysis.errors);
  if (errors.length) throw new Error(`Шаблон містить помилки: ${errors.join('; ')}.`);
  const state = {
    missing: new Set(),
    used: new Set(),
    warnings: analyses.flatMap(analysis => analysis.invalid.map(text => `${text}; маркер залишено як є`)),
    label: '',
  };
  const root = scopeOf(context?.fields, context?.blocks);
  const { zip } = template;
  let changed = false;
  if (template.kind === 'xlsx') {
    const { workbookTree, strings, sheets } = template.workbook;
    let shifted = false;
    for (const sheet of sheets) {
      if (!sheet.info?.hasTokens) continue;
      state.label = sheet.label;
      const mapper = expandSheet(sheet, strings, state, root);
      if (mapper) {
        shifted = true;
        await shiftTables(zip, sheet, mapper, state);
      }
      writePart(zip, sheet.path, sheet.tree);
      changed = true;
    }
    if (shifted) await dropCalcChain(zip);
    if (changed && sheets.some(sheet => sheet.hasFormula) && requestRecalc(workbookTree)) writePart(zip, 'xl/workbook.xml', workbookTree);
  } else {
    for (const part of template.parts) {
      if (!part.analysis.hasTokens) continue;
      state.label = part.label;
      expandTree(part.tree, [root], state, template.profile);
      writePart(zip, part.path, part.tree);
      changed = true;
    }
  }
  const out = changed
    ? await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } })
    : template.data.slice();
  return {
    bytes: out,
    missing: sortNames(state.missing),
    used: sortNames(state.used),
    warnings: [...new Set(state.warnings)],
  };
}
