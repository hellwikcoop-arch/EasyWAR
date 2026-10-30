// Клієнт оновлення знімка (E3б, B5): заміна рядків таблиці-знімка тією самою командою, що й решта правок модуля,
// з позначкою версії (`expectedUpdatedAt`), тож зміну з іншого вікна не буде перезаписано. `invoke` передає викликач.

import { replaceRowsRequest } from './dashboard-module-catalog-core.js';

/** Замінює всі рядки модуля; повертає відповідь команди (`module`, `rows`, `truncated`, `corrections`) або кидає помилку Rust. */
export const replaceSnapshotRows = (invoke, module, rows) => invoke('replace_dashboard_module_rows', replaceRowsRequest(module, rows));
