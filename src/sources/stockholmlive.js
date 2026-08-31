/**
 * Avicii Arena och 3Arena.
 *
 * Båda drivs av Stockholm Live på WordPress och lägger ut schema.org-data direkt i
 * sidan. Hämtningen sker i två steg:
 *
 *   1. Listningssidan ger alla kommande event, men med generiska föräldranamn
 *      ("Djurgården Fotboll") och tiden angiven i UTC.
 *   2. För dagens event — sällan fler än en handfull — hämtas eventsidan, som har
 *      det riktiga namnet ("DIF – Mjällby AIF (Allsvenskan)"), beskrivning och bild.
 *
 * Tidszonsfällan: listningen skriver "17:00+00:00" och eventsidan "19:00+02:00" för
 * samma match. Vi parsar därför alltid till absoluta instanter och läser aldrig ut
 * siffror direkt ur ISO-strängen.
 */

import { fetchText as defaultFetchText } from '../http.js';
import { decodeEntities } from '../html.js';
import { findEvents } from '../jsonld.js';
import { zonedDateKey } from '../timezone.js';

/**
 * De fyra Stockholm Live-arenorna som ligger i Johanneshov. Södra Teatern
 * (Södermalm) och Strawberry Arena (Solna) hör till samma bolag men inte till
 * kvarteret, och ingår därför inte.
 *
 * Observera att Hovets domän är hovetarena.se — hovet.se pekar ingenstans.
 */
export const ARENAS = [
  {
    id: 'avicii-arena',
    name: 'Avicii Arena',
    listingUrl: 'https://aviciiarena.se/evenemang/',
  },
  {
    id: '3arena',
    name: '3Arena',
    listingUrl: 'https://3arena.se/evenemang/',
  },
  {
    id: 'hovet',
    name: 'Hovet',
    listingUrl: 'https://hovetarena.se/evenemang/',
  },
  {
    id: 'annexet',
    name: 'Annexet',
    listingUrl: 'https://annexet.se/evenemang/',
  },
];

/** Kategorin ligger i URL:ens sökväg: /evenemang/<kategori>/<slug>/ */
function categoryFromUrl(url) {
  const match = String(url ?? '').match(/\/evenemang\/([a-z0-9-]+)\//i);
  return match ? match[1].toLowerCase() : null;
}

function firstImage(node) {
  const image = node.image;
  if (!image) return null;
  if (typeof image === 'string') return image;
  if (Array.isArray(image)) return typeof image[0] === 'string' ? image[0] : image[0]?.url ?? null;
  return image.url ?? null;
}

/**
 * Eventsidan listar alla speltillfällen ("showings") för samma post. Vi väljer det
 * som matchar tiden vi redan känner till, med en minuts tolerans.
 */
function matchShowing(nodes, startUtc) {
  const TOLERANCE_MS = 60_000;

  let best = null;
  let bestDelta = Infinity;

  for (const node of nodes) {
    const delta = Math.abs(Date.parse(node.startDate) - startUtc);
    if (delta < bestDelta) {
      best = node;
      bestDelta = delta;
    }
  }

  return bestDelta <= TOLERANCE_MS ? best : null;
}

/** Hämtar detaljsidan och förädlar eventet. Misslyckas den behåller vi grunddatan. */
async function enrich(event, fetchText) {
  try {
    const html = await fetchText(event.url);
    const showing = matchShowing(findEvents(html), event.startUtc);
    if (!showing) return event;

    const title = showing.name ? decodeEntities(showing.name) : event.title;

    return {
      ...event,
      // Det generiska namnet blir underrubrik när vi har ett mer specifikt.
      title,
      subtitle: title !== event.title ? event.title : null,
      description: showing.description ? decodeEntities(showing.description) : null,
      imageUrl: firstImage(showing) ?? event.imageUrl,
    };
  } catch {
    return event;
  }
}

export async function fetchArena(
  arena,
  { now = Date.now(), enrichDetails = true, fetchText = defaultFetchText } = {},
) {
  const html = await fetchText(arena.listingUrl);
  const nodes = findEvents(html);

  if (nodes.length === 0) {
    throw new Error(`Ingen JSON-LD hittades på ${arena.listingUrl} — sidan kan ha byggts om`);
  }

  const todayKey = zonedDateKey(now);

  const events = nodes
    .map((node) => {
      const startUtc = Date.parse(node.startDate);
      if (Number.isNaN(startUtc)) return null;

      return {
        id: `${arena.id}:${node.url ?? node.name}:${startUtc}`,
        // Källan lämnar HTML-entiteter orörda i JSON-LD:n ("CA7RIEL &amp; Paco").
        title: node.name ? decodeEntities(node.name) : 'Okänt evenemang',
        subtitle: null,
        description: null,
        venue: arena.name,
        venueGroup: 'arena',
        startUtc,
        category: categoryFromUrl(node.url),
        url: node.url ?? arena.listingUrl,
        imageUrl: firstImage(node),
        sourceId: arena.id,
      };
    })
    .filter(Boolean);

  const today = events.filter((event) => zonedDateKey(event.startUtc) === todayKey);

  // Bara dagens event är värda en extra request. Resten behövs för "nästa dag"-vyn
  // och klarar sig med grunddatan.
  const enriched = enrichDetails
    ? await Promise.all(today.map((event) => enrich(event, fetchText)))
    : today;
  const enrichedIds = new Set(enriched.map((event) => event.id));

  return [...enriched, ...events.filter((event) => !enrichedIds.has(event.id))];
}

export function createSources() {
  return ARENAS.map((arena) => ({
    id: arena.id,
    label: arena.name,
    fetch: (options) => fetchArena(arena, options),
  }));
}
