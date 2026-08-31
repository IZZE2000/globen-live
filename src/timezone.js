/**
 * Tidszonshjälpare för Europe/Stockholm, byggda på Intl — inga beroenden.
 *
 * Bakgrunden: källorna anger samma ögonblick på olika sätt. Listningssidan skriver
 * "2026-08-31T17:00:00+00:00" och eventsidan "2026-08-31T19:00:00+02:00". Båda är rätt.
 * Regeln i hela kodbasen är därför: lagra alltid absoluta instanter (ms sedan epoch),
 * formatera först vid visning, och aldrig läsa ut siffror ur en ISO-sträng.
 */

export const ZONE = 'Europe/Stockholm';

/**
 * Zonens offset från UTC (i ms) vid ett givet ögonblick.
 * Positiv öster om Greenwich, alltså +7200000 för svensk sommartid.
 */
export function zoneOffsetMs(utcMs, timeZone = ZONE) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts = {};
  for (const { type, value } of dtf.formatToParts(new Date(utcMs))) {
    parts[type] = value;
  }

  // Vissa runtimes formaterar midnatt som 24 i stället för 00.
  const hour = Number(parts.hour) === 24 ? 0 : Number(parts.hour);

  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    hour,
    Number(parts.minute),
    Number(parts.second),
  );

  return asIfUtc - utcMs;
}

/**
 * Tolka en väggklocka i zonen som ett absolut ögonblick.
 *
 * Offseten beror på ögonblicket vi försöker räkna ut, så vi gissar först och
 * korrigerar en gång. Den andra passeringen fångar tidsskiftena i mars och oktober.
 */
export function zonedTimeToUtc(year, month, day, hour = 0, minute = 0, timeZone = ZONE) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const firstOffset = zoneOffsetMs(guess, timeZone);
  const candidate = guess - firstOffset;

  const secondOffset = zoneOffsetMs(candidate, timeZone);
  if (secondOffset === firstOffset) return candidate;

  return guess - secondOffset;
}

/** Väggklockans delar i zonen vid ett givet ögonblick. */
export function zonedParts(utcMs, timeZone = ZONE) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  const parts = {};
  for (const { type, value } of dtf.formatToParts(new Date(utcMs))) {
    parts[type] = value;
  }

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) === 24 ? 0 : Number(parts.hour),
    minute: Number(parts.minute),
  };
}

/** "2026-08-31" för ögonblicket, sett från zonen — inte från serverns lokala tid. */
export function zonedDateKey(utcMs, timeZone = ZONE) {
  const { year, month, day } = zonedParts(utcMs, timeZone);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** "19:00" i zonen. Detta är den enda funktion som får producera ett klockslag. */
export function formatTime(utcMs, timeZone = ZONE) {
  const { hour, minute } = zonedParts(utcMs, timeZone);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** Ögonblicket då dygnet börjar i zonen, för det dygn ögonblicket tillhör. */
export function startOfZonedDay(utcMs, timeZone = ZONE) {
  const { year, month, day } = zonedParts(utcMs, timeZone);
  return zonedTimeToUtc(year, month, day, 0, 0, timeZone);
}
