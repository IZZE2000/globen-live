/**
 * Slakthusområdet — Slaktkyrkan och Hus 7 via slakthusen.se.
 *
 * Områdets egen portal (slakthusomradet.se) svarar 404 och finns inte längre. Den
 * bästa kvarvarande källan är slakthusen.se, som publicerar konserter som vanliga
 * WordPress-inlägg och exponerar dem på wp-json.
 *
 * Två saker gör källan mindre pålitlig än arenorna, och båda är medvetna avvägningar:
 *
 *   - REST-fältet `date` är publiceringsdatum, inte eventdatum. Det riktiga datumet
 *     finns bara i brödtexten och tolkas av swedishDate.js.
 *   - Året anges aldrig och härleds till närmast kommande förekomst.
 *
 * Inlägg utan tolkbart datum hoppas över och räknas — antalet rapporteras uppåt så
 * att en formatändring hos Slakthusen syns i stället för att tyst tappa event.
 */

import { fetchText as defaultFetchText } from '../http.js';
import { stripHtml } from '../html.js';
import { parseSwedishEventDate, parseVenueFromTitle } from '../swedishDate.js';

const API_URL =
  'https://slakthusen.se/wp-json/wp/v2/posts?per_page=100&_fields=id,slug,link,title,excerpt,content';

/** Inlägg som inte är evenemang alls. */
const NON_EVENT_SLUGS = new Set([
  'aldersgranser',
  'kontakt',
  'nyhetsbrev',
  'student-ungdom',
  'forsamlingen',
]);

export const SOURCE_ID = 'slakthusen';

export async function fetchSlakthusen({ now = Date.now(), fetchText = defaultFetchText } = {}) {
  const posts = JSON.parse(await fetchText(API_URL));

  if (!Array.isArray(posts)) {
    throw new Error('Oväntat svar från slakthusen.se — förväntade en lista med inlägg');
  }

  const events = [];
  let unparsed = 0;

  for (const post of posts) {
    if (NON_EVENT_SLUGS.has(post.slug)) continue;

    const title = stripHtml(post.title?.rendered);
    // Utdraget räcker nästan alltid; brödtexten är reservväg när det är avkortat.
    const text = `${stripHtml(post.excerpt?.rendered)} ${stripHtml(post.content?.rendered)}`;

    const parsed = parseSwedishEventDate(text, { now });
    if (!parsed) {
      unparsed += 1;
      continue;
    }

    const venue = parseVenueFromTitle(title);

    events.push({
      id: `${SOURCE_ID}:${post.id}`,
      // Titeln är "Artist | Scen" — scenen visas separat, så den kapas bort här.
      title: venue ? title.split('|')[0].trim() : title,
      subtitle: null,
      description: null,
      venue: venue ?? 'Slakthusområdet',
      venueGroup: 'slakthuset',
      startUtc: parsed.startUtc,
      doorsUtc: parsed.doorsUtc,
      timeIsDoors: parsed.timeIsDoors,
      timeIsGuess: parsed.timeIsGuess,
      category: 'konsert',
      url: post.link,
      imageUrl: null,
      sourceId: SOURCE_ID,
    });
  }

  // Tolkar vi inte ett enda inlägg har formatet med all sannolikhet ändrats.
  if (events.length === 0 && unparsed > 0) {
    throw new Error(
      `Inget av ${unparsed} inlägg från slakthusen.se hade ett tolkbart datum — formatet kan ha ändrats`,
    );
  }

  return { events, unparsed };
}

export function createSource() {
  return {
    id: SOURCE_ID,
    label: 'Slakthusområdet',
    async fetch(options) {
      const { events } = await fetchSlakthusen(options);
      return events;
    },
  };
}
