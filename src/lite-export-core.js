// «Lite-версія»: назва файлу, адреса ресурсу й тексти повідомлень кнопки на головному екрані.
// Сам файл збирає script/build_lite.mjs (`npm run build:app`), а Rust-команда export_lite_file
// віддає його зі вбудованих ресурсів застосунку.
import { isStandaloneHtml } from './phone-export-core.js';

export const LITE_FILE_NAME = 'EasyWAR-Lite.html';
export const LITE_ASSET_URL = `./standalone/${LITE_FILE_NAME}`;

export const LITE_BUTTON_LABEL = 'Lite-версія';
export const LITE_BUTTON_TITLE = 'Завантажити lite-версію: один HTML-файл із тими самими модулями для будь-якого пристрою, без довідників із моделями';

// Позначка lite-файлу, яку build_lite.mjs ставить на початку. Файл дашборда чи запасний index.html — не lite.
const LITE_MARKER = ' standalone: lite';
const MARKER_SCAN_LIMIT = 512;

export function isLiteHtml(head) {
  return isStandaloneHtml(head) && String(head).slice(0, MARKER_SCAN_LIMIT).includes(LITE_MARKER);
}

const OPEN_HINT = 'Відкрийте файл у браузері (Chrome, Edge, Firefox, Safari): інтернет і встановлення не потрібні. Таблицю .xlsx оберіть у модулі кнопкою «Відкрити таблицю…»; дані з цього застосунку у файл не потрапляють.';

export function liteExportSavedMessage(path) {
  return { kind: 'ok', text: `Lite-версію збережено: ${path}. ${OPEN_HINT}` };
}

export function liteExportDownloadedMessage() {
  return { kind: 'ok', text: `Lite-версію (${LITE_FILE_NAME}) завантажено. ${OPEN_HINT}` };
}

export function liteExportErrorMessage(error) {
  const text = typeof error === 'string' ? error : error?.message;
  return { kind: 'error', text: text || 'Не вдалося отримати lite-версію.' };
}

export const LITE_UNAVAILABLE = 'Lite-версія недоступна в цій збірці.';
