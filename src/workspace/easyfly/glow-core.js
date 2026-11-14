// Модель екрана «Сьогодні» (макет «тепле світіння») з реальних даних файлу .easyfly.
// Без DOM і без вигаданих чисел: немає зміни — картка про це каже, немає пілотів — дуга порожня.
import {
  commanderSummary, flightsOfShift, formatDate, formatDuration, hasSubordinates, resolveSettings,
} from './fly-core.js';

export { hasSubordinates };

/** «1 політ», «23 польоти», «5 польотів». */
export function pluralFlights(n) {
  const abs = Math.abs(Number(n) || 0);
  const last2 = abs % 100;
  const last = abs % 10;
  if (last2 >= 11 && last2 <= 14) return 'польотів';
  if (last === 1) return 'політ';
  if (last >= 2 && last <= 4) return 'польоти';
  return 'польотів';
}

/** «1 пілот», «4 пілоти», «5 пілотів». */
export function pluralPilots(n) {
  const abs = Math.abs(Number(n) || 0);
  const last2 = abs % 100;
  const last = abs % 10;
  if (last2 >= 11 && last2 <= 14) return 'пілотів';
  if (last === 1) return 'пілот';
  if (last >= 2 && last <= 4) return 'пілоти';
  return 'пілотів';
}

/** Короткий підпис причини блокування без префікса «Прострочено». */
export function shortBlockReason(label) {
  return String(label || '').replace(/^Прострочен[аоі]?\s*:?\s*/i, '').trim() || 'є блокування';
}

/**
 * Картка льотної зміни на сьогодні або останньої зміни не пізніше сьогодні.
 * Підпис береться з записів польотів: кількість і відомий наліт. Нічого не домислюється.
 */
export function shiftCard(data, today) {
  const dates = (data?.shifts || []).map(s => s.date).filter(d => d && (!today || d <= today)).sort();
  const date = dates.at(-1) || null;
  if (!date) return null;
  const shift = data.shifts.find(s => s.date === date);
  const flights = flightsOfShift(data.flights, shift);
  const count = flights.reduce((sum, flight) => sum + (Number.isInteger(flight.count) ? flight.count : 0), 0);
  const unknown = flights.some(flight => !Number.isInteger(flight.airtimeMin));
  const airtimeMin = flights.reduce((sum, flight) => sum + (Number.isInteger(flight.airtimeMin) ? flight.airtimeMin : 0), 0);
  const airtime = flights.length && !unknown ? formatDuration(airtimeMin) : null;
  const title = date === today ? 'Льотна зміна сьогодні' : `Льотна зміна ${formatDate(date)}`;
  let subtitle = 'Записів польотів ще немає';
  if (count && airtime) subtitle = `Ваші вправи виконано · ${count} ${pluralFlights(count)} · ${airtime}`;
  else if (count) subtitle = `${count} ${pluralFlights(count)} · наліт внесено не для всіх`;
  return { date, title, subtitle, flights: count, airtime };
}

/**
 * Головний екран: готовність N/M, заборони, стан кожного пілота, лічильники строків, зміна.
 * today — ISO. Дані лише з data (persons, checks, flights, shifts, unit).
 */
export function todayHome(data, today) {
  const persons = Array.isArray(data?.persons) ? data.persons : [];
  const settings = resolveSettings(data?.unit?.settings);
  const summary = commanderSummary(persons, { checks: data?.checks || [], settings }, today);
  const blockedIds = new Set(summary.blocked.map(entry => entry.personId));
  const pilots = persons.length;
  const ready = pilots - blockedIds.size;
  const banned = summary.blocked.map(entry => {
    const worst = [...entry.blockers].sort((a, b) => (b.daysOverdue ?? -1) - (a.daysOverdue ?? -1))[0];
    return {
      personId: entry.personId,
      callsign: entry.callsign,
      reason: shortBlockReason(worst?.label),
      daysOverdue: worst?.daysOverdue ?? null,
    };
  }).sort((a, b) => (b.daysOverdue ?? -1) - (a.daysOverdue ?? -1) || String(a.callsign).localeCompare(String(b.callsign), 'uk'));
  const states = persons.map(person => ({
    personId: person.id,
    callsign: person.callsign,
    blocked: blockedIds.has(person.id),
  })).sort((a, b) => Number(b.blocked) - Number(a.blocked) || String(a.callsign).localeCompare(String(b.callsign), 'uk'));
  return {
    airfield: data?.unit?.airfield || null,
    dateLabel: formatDate(today),
    pilots,
    ready,
    readyPercent: pilots ? Math.round(ready * 100 / pilots) : 0,
    banned,
    states,
    deadlines: summary.counters,
    shift: shiftCard(data, today),
  };
}

/** Особистий екран: один пілот, його заборони й найближчі строки. Без дуги N/M і списку підлеглих. */
export function personalHome(data, today) {
  const person = (data?.persons || [])[0] || null;
  if (!person) return { person: null, ready: false, blockers: [], upcoming: [] };
  const settings = resolveSettings(data?.unit?.settings);
  const summary = commanderSummary([person], { checks: data?.checks || [], settings }, today);
  const blocked = summary.blocked[0];
  const upcoming = [...(summary.items || [])]
    .filter(item => item.dueDate)
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0))
    .slice(0, 8)
    .map(item => ({
    label: item.label,
    dueDate: item.dueDate,
    daysLeft: item.daysLeft,
    status: item.status,
  }));
  return {
    person,
    ready: !blocked,
    blockers: (blocked?.blockers || []).map(item => ({
      label: shortBlockReason(item.label),
      daysOverdue: item.daysOverdue,
    })),
    upcoming,
    nearest: upcoming.find(item => item.daysLeft !== null && item.daysLeft !== undefined) || upcoming[0] || null,
  };
}
