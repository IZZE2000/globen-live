/**
 * Slår ihop alla källor till en lista.
 *
 * Använder medvetet Promise.allSettled och aldrig Promise.all: att Slakthusen ligger
 * nere ska inte dölja att det är match på 3Arena. Varje källas utfall rapporteras
 * separat så att gränssnittet kan visa vad som faktiskt hämtades — annars går det
 * inte att skilja "lugn kväll" från "skrapan är trasig".
 */

import { createSources as createArenaSources } from './sources/stockholmlive.js';
import { createSource as createSlakthusenSource } from './sources/slakthusen.js';
import { createSource as createResidentAdvisorSource } from './sources/residentadvisor.js';
import { startOfZonedDay } from './timezone.js';

/**
 * Två evenemang på samma scen som börjar inom det här fönstret antas vara samma sak,
 * sett från olika håll. Slaktkyrkan finns i både slakthusen.se och Resident Advisor,
 * och källorna anger ofta insläpp respektive speltid — därför en halvtimmes glapp
 * är väntat, medan flera timmar betyder skilda evenemang.
 */
const SAME_EVENT_WINDOW_MS = 90 * 60_000;

export function defaultSources() {
  return [...createArenaSources(), createSlakthusenSource(), createResidentAdvisorSource()];
}

/**
 * Väljer vilken av två beskrivningar av samma evenemang som ska behållas.
 * En riktig sluttid väger tyngst — den är den enda uppgiften ingen annan källa har,
 * och den avgör om "pågår nu" bygger på data eller på en gissning.
 */
function bästaAv(a, b) {
  const harSlut = (e) => typeof e.endUtc === 'number' && e.endUtc > e.startUtc;
  if (harSlut(a) !== harSlut(b)) return harSlut(a) ? a : b;

  const fyllnad = (e) => [e.subtitle, e.description, e.imageUrl].filter(Boolean).length;
  return fyllnad(b) > fyllnad(a) ? b : a;
}

/**
 * Slår ihop evenemang som två källor beskriver var för sig.
 *
 * Medvetet försiktig: bara samma scen och nära i tid räknas som samma sak. En
 * dubblett på sidan är irriterande, men ett evenemang som göms för att det liknade
 * ett annat är ett fel — och det syns inte.
 */
export function mergeDuplicates(events) {
  const kvar = [];

  for (const event of [...events].sort((a, b) => a.startUtc - b.startUtc)) {
    const scen = String(event.venue ?? '').toLowerCase().trim();

    const index = kvar.findIndex(
      (befintlig) =>
        String(befintlig.venue ?? '').toLowerCase().trim() === scen &&
        Math.abs(befintlig.startUtc - event.startUtc) <= SAME_EVENT_WINDOW_MS,
    );

    if (index === -1) kvar.push(event);
    else kvar[index] = bästaAv(kvar[index], event);
  }

  return kvar;
}

export async function collectEvents({ now = Date.now(), sources = defaultSources() } = {}) {
  const settled = await Promise.allSettled(sources.map((source) => source.fetch({ now })));

  // Slakthusen låter gamla konserter ligga kvar publicerade, och de tolkas korrekt
  // eftersom de har utskrivet år. De hör ändå inte hemma här. Gränsen går vid
  // dygnets början och inte vid "nu", så att eftermiddagens konsert finns kvar
  // under "Tidigare idag" resten av kvällen.
  const cutoff = startOfZonedDay(now);
  const isCurrent = (event) => event.startUtc >= cutoff;

  const events = [];
  const health = [];

  for (const [index, result] of settled.entries()) {
    const source = sources[index];

    if (result.status === 'fulfilled') {
      const current = result.value.filter(isCurrent);
      events.push(...current);
      health.push({
        id: source.id,
        label: source.label,
        ok: true,
        count: current.length,
        error: null,
      });
    } else {
      health.push({
        id: source.id,
        label: source.label,
        ok: false,
        count: 0,
        error: result.reason?.message ?? String(result.reason),
      });
    }
  }

  // Sammanslagningen sker efter hälsorapporten med flit: antalet per källa ska visa
  // vad källan faktiskt levererade, inte vad som blev kvar efter dubblettrensning.
  return { fetchedAt: now, events: mergeDuplicates(events), sources: health };
}
