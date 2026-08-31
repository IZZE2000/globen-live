/**
 * Gemensam eventmodell och statusberäkning.
 *
 * Ingen av källorna publicerar sluttider — varken Stockholm Live eller Slakthusen.
 * "Pågår nu" bygger därför på en uppskattad längd, och varje event bär med sig
 * `durationIsEstimated: true` så gränssnittet kan vara ärligt om det.
 */

import { zonedDateKey } from './timezone.js';

const MINUTE = 60_000;

export const STATUS = {
  NOW: 'NOW',
  SOON: 'SOON',
  LATER: 'LATER',
  DONE: 'DONE',
};

/** Ett event räknas som "strax" inom den här horisonten. */
export const SOON_WINDOW_MINUTES = 180;

export const DEFAULT_DURATION_MINUTES = 180;

/**
 * Uppskattade längder i minuter. Samlade här, och ingen annanstans.
 * Siffrorna inkluderar paus och avrundas uppåt — hellre "pågår" en stund för länge
 * än att ett event försvinner ur vyn medan publiken fortfarande är kvar.
 */
export const DURATION_BY_CATEGORY = {
  fotboll: 120,
  hockey: 150,
  sport: 150,
  konsert: 180,
  'musik-show': 180,
  klubb: 300,
};

/** Nyckelord i titeln som avslöjar sporttyp när kategorin bara säger "sport". */
const TITLE_HINTS = [
  [/hockey|shl|ishockey/i, 150],
  [/fotboll|allsvenskan|dif\s*[–-]|hammarby/i, 120],
  [/klubb|club|rave|after\s*party/i, 300],
];

export function estimateDurationMinutes({ category, title } = {}) {
  if (title) {
    for (const [pattern, minutes] of TITLE_HINTS) {
      if (pattern.test(title)) return minutes;
    }
  }

  const key = String(category ?? '').toLowerCase();
  return DURATION_BY_CATEGORY[key] ?? DEFAULT_DURATION_MINUTES;
}

/**
 * Lägger på härledda fält: beräknad sluttid, status och tid kvar till start.
 * Klockan skickas in i stället för att läsas från Date.now(), så statuslogiken
 * går att testa deterministiskt.
 */
export function decorate(event, now) {
  const durationMinutes = estimateDurationMinutes(event);
  const estimatedEndUtc = event.startUtc + durationMinutes * MINUTE;
  const msUntilStart = event.startUtc - now;

  let status;
  if (now >= estimatedEndUtc) {
    status = STATUS.DONE;
  } else if (msUntilStart <= 0) {
    status = STATUS.NOW;
  } else if (msUntilStart <= SOON_WINDOW_MINUTES * MINUTE) {
    status = STATUS.SOON;
  } else {
    status = STATUS.LATER;
  }

  return {
    ...event,
    durationMinutes,
    estimatedEndUtc,
    durationIsEstimated: true,
    status,
    minutesUntilStart: Math.round(msUntilStart / MINUTE),
  };
}

const byStart = (a, b) => a.startUtc - b.startUtc;

/**
 * Bygger dagens vy: vad som pågår, vad som återstår och vad som redan varit.
 *
 * "Idag" avgörs av svensk tid, inte av serverns lokala tid eller UTC — annars
 * hamnar ett event klockan 00:30 fel dygn.
 */
export function buildTodayView(events, now) {
  const todayKey = zonedDateKey(now);
  const decorated = events.map((event) => decorate(event, now));

  const today = decorated
    .filter((event) => zonedDateKey(event.startUtc) === todayKey)
    .sort(byStart);

  const live = today.filter((event) => event.status === STATUS.NOW);
  const upcoming = today.filter(
    (event) => event.status === STATUS.SOON || event.status === STATUS.LATER,
  );
  const finished = today.filter((event) => event.status === STATUS.DONE);

  const isEmpty = today.length === 0;

  return {
    dateKey: todayKey,
    live,
    upcoming,
    finished,
    isEmpty,
    // Så att sidan aldrig står tom en lugn tisdag.
    nextDay: isEmpty ? findNextDay(decorated, now) : null,
  };
}

function findNextDay(decorated, now) {
  const future = decorated.filter((event) => event.startUtc > now).sort(byStart);
  if (future.length === 0) return null;

  const dateKey = zonedDateKey(future[0].startUtc);

  return {
    dateKey,
    events: future.filter((event) => zonedDateKey(event.startUtc) === dateKey),
  };
}
