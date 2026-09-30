/* Спільне форматування й дати для презентації (чисті функції, без DOM). */

export const dayNumber = iso => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5 : NaN;
};
export const isoFromDay = n => new Date(n * 864e5).toISOString().slice(0, 10);
export const shortDate = iso => { const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${m[2]}.${m[1]}` : ''; };
export const longDate = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${m[3]}.${m[2]}.${m[1]}` : ''; };
export const periodText = range => `${longDate(range.from)} – ${longDate(range.to)}`;

/** Останні N діб із включенням якірної дати. */
export function rollingRange(anchor, days) {
  const end = dayNumber(anchor);
  if (!Number.isFinite(end) || !(days >= 1)) return { from: '', to: '' };
  return { from: isoFromDay(end - days + 1), to: isoFromDay(end) };
}

export const NBSP = ' ';
export function formatNumber(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return String(rounded).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}
export function formatPercent(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${formatNumber(Math.abs(value))}${NBSP}%`;
}
export function daysWord(n) {
  const abs = Math.abs(n) % 100, last = abs % 10;
  if (abs > 10 && abs < 20) return 'діб';
  return last === 1 ? 'доба' : last >= 2 && last <= 4 ? 'доби' : 'діб';
}
/** «за 1 добу», «за 3 доби», «за 7 діб» (знахідний відмінок). */
export function daysAcc(n) {
  const abs = Math.abs(n) % 100, last = abs % 10;
  if (abs > 10 && abs < 20) return 'діб';
  return last === 1 ? 'добу' : last >= 2 && last <= 4 ? 'доби' : 'діб';
}
export const signed = value => (value > 0 ? '+' : value < 0 ? '−' : '') + formatNumber(Math.abs(value));

function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const low = Math.floor(pos), high = Math.ceil(pos);
  return sorted[low] + (sorted[high] - sorted[low]) * (pos - low);
}

/** Пік: день, що перевищує верхню межу IQR власної історії періоду. */
export function peakOf(points, config) {
  const values = points.map(p => p.value);
  if (values.length < config.anomalyMinDays) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25), q3 = quantile(sorted, 0.75);
  const fence = q3 + config.anomalyIqrFactor * (q3 - q1);
  let best = null;
  for (const p of points) if (p.value > fence && p.value >= config.minBase && (!best || p.value > best.value)) best = p;
  return best ? { date: best.from, value: best.value, fence } : null;
}

export function tileFor(kpi, prevComplete, config, name = kpi.label) {
  const hasPrev = kpi.previous != null;
  const base = kpi.base != null ? kpi.base : kpi.total;
  const previousBase = kpi.previousBase != null ? kpi.previousBase : kpi.previous;
  const reliable = hasPrev && prevComplete && previousBase >= config.minBase && (kpi.base == null || base >= config.minBase);
  return {
    key: kpi.key,
    name,
    total: kpi.total,
    previous: kpi.previous,
    delta: kpi.delta,
    deltaPercent: reliable ? kpi.deltaPercent : null,
    reliable,
    better: kpi.better || null,
    totalText: formatNumber(kpi.total),
    deltaText: hasPrev && kpi.delta != null ? (reliable ? formatPercent(kpi.deltaPercent) : `${signed(kpi.delta)} (мала база)`) : '',
  };
}
