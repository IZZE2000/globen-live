/**
 * Plockar ut JSON-LD ur HTML.
 *
 * Arenasajterna lägger schema.org-data i <script type="application/ld+json">, vilket
 * gör att vi slipper tolka själva HTML-strukturen. Det är också betydligt tåligare:
 * en omdesign flyttar runt taggar men brukar lämna den strukturerade datan i fred.
 */

const SCRIPT_PATTERN =
  /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

/** @returns {object[]} alla JSON-LD-block som gick att tolka; trasiga hoppas över. */
export function extractJsonLd(html) {
  const blocks = [];

  for (const match of html.matchAll(SCRIPT_PATTERN)) {
    try {
      blocks.push(JSON.parse(match[1].trim()));
    } catch {
      // Ett trasigt block ska inte sänka de övriga.
    }
  }

  return blocks;
}

/**
 * Plattar ut JSON-LD till en ström av noder, oavsett om de ligger direkt,
 * i en array eller inuti @graph.
 */
export function* walkNodes(value) {
  if (Array.isArray(value)) {
    for (const item of value) yield* walkNodes(item);
    return;
  }

  if (!value || typeof value !== 'object') return;

  yield value;

  if (value['@graph']) yield* walkNodes(value['@graph']);
  if (value.itemListElement) yield* walkNodes(value.itemListElement);
  if (value.item) yield* walkNodes(value.item);
}

const EVENT_TYPES = new Set([
  'Event',
  'SportsEvent',
  'MusicEvent',
  'TheaterEvent',
  'Festival',
  'ScreeningEvent',
  'SocialEvent',
]);

function typesOf(node) {
  const raw = node['@type'];
  return Array.isArray(raw) ? raw : [raw];
}

/** Alla noder i dokumentet som är någon form av Event och har ett startdatum. */
export function findEvents(html) {
  const events = [];

  for (const block of extractJsonLd(html)) {
    for (const node of walkNodes(block)) {
      if (!node.startDate) continue;
      if (!typesOf(node).some((type) => EVENT_TYPES.has(type))) continue;

      events.push(node);
    }
  }

  return events;
}
