/**
 * Resident Advisor — klubbkvällarna i Slakthusområdet.
 *
 * Fyller luckan som `slakthusen.se` lämnar: klubbverksamheten på Slakthuset,
 * Slaktkyrkan och Fållan publiceras aldrig i WordPress-flödet. Fållan hade dessutom
 * ingen användbar källa alls tidigare — dess egen sajt är byggd i Webflow utan
 * strukturerad data.
 *
 * RA:s HTML-sidor svarar 403 på serverförfrågningar, men deras GraphQL-endpoint
 * svarar utan nyckel eller inloggning. Det är samma API som deras egen frontend
 * använder, alltså odokumenterat och utan löften — därför larmar hämtningen hellre
 * än ger tom data om svaret ändrar form.
 *
 * Tidszonsfällan igen, i ny skepnad: RA anger tider helt utan offset
 * ("2026-09-19T21:00:00.000"). Parsas de naivt tolkas de som serverns lokala tid.
 * Det är svensk väggklocka och tolkas som sådan.
 */

import { fetchText as defaultFetchText } from '../http.js';
import { zonedTimeToUtc } from '../timezone.js';

const ENDPOINT = 'https://ra.co/graphql';

export const SOURCE_ID = 'resident-advisor';

/** Scenerna i kvarteret som finns på RA. Nyckeln är RA:s eget spelplats-id. */
export const RA_VENUES = [
  { id: 44750, name: 'Slakthuset' },
  { id: 147361, name: 'Slaktkyrkan' },
  { id: 178010, name: 'Fållan' },
];

const EVENT_FIELDS = 'id title date startTime endTime contentUrl';

/** En enda fråga med alias, i stället för ett anrop per scen. */
function buildQuery(limit) {
  const parts = RA_VENUES.map(
    (venue) =>
      `v${venue.id}: venue(id:${venue.id}) { name events(type:LATEST, limit:${limit}) { ${EVENT_FIELDS} } }`,
  );

  return `{ ${parts.join(' ')} }`;
}

/** "2026-09-19T21:00:00.000" — väggklocka utan zon — till ett absolut ögonblick. */
function wallClockToUtc(value) {
  const match = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return null;

  const [, year, month, day, hour, minute] = match.map(Number);
  return zonedTimeToUtc(year, month, day, hour, minute);
}

export async function fetchResidentAdvisor({
  now = Date.now(),
  limit = 12,
  fetchText = defaultFetchText,
} = {}) {
  const raw = await fetchText(ENDPOINT, {
    method: 'POST',
    body: JSON.stringify({ query: buildQuery(limit) }),
    headers: { 'Content-Type': 'application/json' },
  });

  const body = JSON.parse(raw);

  if (body.errors?.length) {
    throw new Error(`ra.co avvisade frågan: ${body.errors[0].message}`);
  }

  const events = [];
  let venuesSeen = 0;

  for (const venue of RA_VENUES) {
    const node = body.data?.[`v${venue.id}`];
    if (!node) continue;

    venuesSeen += 1;

    for (const event of node.events ?? []) {
      const startUtc = wallClockToUtc(event.startTime);
      if (startUtc === null) continue;

      // Klubbkvällar slutar efter midnatt, så sluttiden ligger ofta dagen efter.
      const endUtc = wallClockToUtc(event.endTime);

      events.push({
        id: `${SOURCE_ID}:${event.id}`,
        title: event.title ?? 'Okänt evenemang',
        subtitle: null,
        description: null,
        venue: node.name ?? venue.name,
        venueGroup: 'slakthuset',
        startUtc,
        // Enda källan i projektet som faktiskt publicerar sluttider.
        endUtc: endUtc !== null && endUtc > startUtc ? endUtc : null,
        category: 'klubb',
        url: `https://ra.co${event.contentUrl}`,
        imageUrl: null,
        sourceId: SOURCE_ID,
      });
    }
  }

  // Ett schemabyte ska larma, inte se ut som en lugn vecka.
  if (venuesSeen === 0) {
    throw new Error('ra.co svarade utan någon spelplats — schemat kan ha ändrats');
  }

  return events.filter((event) => event.startUtc >= now);
}

export function createSource() {
  return {
    id: SOURCE_ID,
    label: 'Klubbscenerna (RA)',
    fetch: (options) => fetchResidentAdvisor(options),
  };
}
