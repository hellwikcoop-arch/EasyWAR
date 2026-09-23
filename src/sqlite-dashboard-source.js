import { invoke } from '@tauri-apps/api/core';
import { mapDashboardRecords } from './sqlite-dashboard-source-core.js';

const FILE_LABEL = 'Джерело: файл';
const SQLITE_LABEL = 'Джерело: SQLite (схвалені)';
const DESKTOP_ONLY_MESSAGE = 'Доступно лише в десктоп-застосунку';

function asLegacyInput(row) {
  return {
    num: row.num,
    date: row.date,
    time: row.time,
    targets: row.targets.join(' '),
    unit: row.unit,
    district: row.district,
    type: row.types.join(', '),
    aircraft: row.aircraft,
    munition: row.munition,
    count: row.count,
    result: row.resRaw,
    dpi: row.dpi,
    cause: row.cause,
    note: row.note,
  };
}

function copyDisplayGeometry(fromRows, toRows) {
  for (let rowIndex = 0; rowIndex < toRows.length; rowIndex += 1) {
    const fromPoints = fromRows[rowIndex]?.pts || [];
    const toPoints = toRows[rowIndex].pts;
    for (let pointIndex = 0; pointIndex < toPoints.length; pointIndex += 1) {
      const source = fromPoints[pointIndex];
      if (!source) continue;
      toPoints[pointIndex].x = source.x;
      toPoints[pointIndex].y = source.y;
    }
  }
}

function initializeSqliteDashboardSource() {
  const button = document.querySelector('#dashboardSourceToggle');
  const fileChip = document.querySelector('#fileChip');
  const AV = window.__AV;
  const dashboard = window.__DASH;
  if (!button || !fileChip || !AV || !dashboard) return;

  if (typeof window.__TAURI_INTERNALS__?.invoke !== 'function') {
    button.textContent = DESKTOP_ONLY_MESSAGE;
    button.title = DESKTOP_ONLY_MESSAGE;
    button.disabled = true;
    return;
  }

  let mode = 'file';
  let savedWorkbook = null;
  let loadedOnce = false;
  let busy = false;

  function showFileSource() {
    if (mode !== 'sqlite') return;
    AV.S.wb = savedWorkbook;
    savedWorkbook = null;
    mode = 'file';
    button.textContent = FILE_LABEL;
    button.setAttribute('aria-pressed', 'false');
    fileChip.hidden = false;
    document.dispatchEvent(new Event('av:data'));
  }

  async function fetchModel() {
    if (!loadedOnce) return invoke('get_dashboard_model');
    return invoke('get_dashboard_model', {
      from: dashboard.D.from || null,
      to: dashboard.D.to || null,
    });
  }

  async function showSqliteSource() {
    if (busy || mode === 'sqlite') return;
    busy = true;
    button.disabled = true;
    button.textContent = 'Завантаження SQLite…';
    AV.showError('');
    try {
      const model = await fetchModel();
      if (!Array.isArray(model?.records)) {
        throw new TypeError('SQLite-модель не містить масиву records');
      }
      const mappedRows = mapDashboardRecords(model.records, dashboard.parsePoints);
      const shadowWorkbook = {
        records: mappedRows.map(asLegacyInput),
      };

      savedWorkbook = AV.S.wb;
      AV.S.wb = shadowWorkbook;
      dashboard.D.preset = 'all';
      mode = 'sqlite';
      button.textContent = SQLITE_LABEL;
      button.setAttribute('aria-pressed', 'true');
      fileChip.hidden = true;
      document.querySelector('#tab-dash')?.click();
      document.dispatchEvent(new Event('av:data'));

      const currentRows = dashboard.rows;
      copyDisplayGeometry(currentRows, mappedRows);
      currentRows.splice(0, currentRows.length, ...mappedRows);
      document.dispatchEvent(new Event('av:data'));
      loadedOnce = true;
    } catch (error) {
      if (mode === 'sqlite') showFileSource();
      AV.showError(`Не вдалося завантажити SQLite-дані: ${String(error)}`);
      button.textContent = FILE_LABEL;
      button.setAttribute('aria-pressed', 'false');
    } finally {
      busy = false;
      button.disabled = false;
    }
  }

  button.textContent = FILE_LABEL;
  button.setAttribute('aria-pressed', 'false');
  button.addEventListener('click', () => {
    if (mode === 'sqlite') showFileSource();
    else showSqliteSource();
  });

  for (const selector of ['#tab-base', '#tab-entry']) {
    document.querySelector(selector)?.addEventListener('click', showFileSource, { capture: true });
  }
  document.querySelector('.tabs')?.addEventListener('keydown', event => {
    if (mode === 'sqlite' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      showFileSource();
    }
  }, { capture: true });
  document.addEventListener('av:opened', () => {
    mode = 'file';
    savedWorkbook = null;
    button.textContent = FILE_LABEL;
    button.setAttribute('aria-pressed', 'false');
    fileChip.hidden = false;
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeSqliteDashboardSource, { once: true });
  } else {
    initializeSqliteDashboardSource();
  }
}
