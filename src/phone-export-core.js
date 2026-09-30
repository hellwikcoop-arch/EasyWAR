// «Файл для телефона»: назви файлів, адреси ресурсів і тексти повідомлень.
// Самі файли збирає script/build_standalone.mjs (`npm run build:app`), а Rust-команда
// export_phone_file віддає їх зі вбудованих ресурсів застосунку.

export const PHONE_FILES = Object.freeze({
  pvk: Object.freeze({ fileName: 'EasyWAR-PVK.html', label: 'ПВК' }),
  dshv: Object.freeze({ fileName: 'EasyWAR-UDSHV.html', label: 'УДШВ' }),
});

// Позначка, яку build_standalone.mjs ставить на початку кожного файлу.
export const STANDALONE_MARKER = ' standalone:';
const MARKER_SCAN_LIMIT = 512;

export function phoneFile(command) {
  const file = PHONE_FILES[command];
  if (!file) throw new Error(`Невідоме командування: ${command}`);
  return file;
}

export function phoneAssetUrl(command) {
  return `./standalone/${phoneFile(command).fileName}`;
}

// Запасний index.html, який віддає сервер замість відсутнього файлу, не є автономним дашбордом.
export function isStandaloneHtml(head) {
  return String(head || '').slice(0, MARKER_SCAN_LIMIT).includes(STANDALONE_MARKER);
}

export function phoneExportSavedMessage(command, path) {
  const { label } = phoneFile(command);
  return {
    kind: 'ok',
    text: `Файл ${label} збережено: ${path}. Надішліть його на телефон або планшет і відкрийте в Chrome; таблицю .xlsx оберіть кнопкою «Відкрити таблицю…».`,
  };
}

export function phoneExportDownloadedMessage(command) {
  const { label, fileName } = phoneFile(command);
  return {
    kind: 'ok',
    text: `Файл ${label} (${fileName}) завантажено. Надішліть його на телефон або планшет і відкрийте в Chrome.`,
  };
}

export function phoneExportErrorMessage(error) {
  const text = typeof error === 'string' ? error : error?.message;
  return { kind: 'error', text: text || 'Не вдалося створити файл для телефона.' };
}
