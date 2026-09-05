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
import {
  matchKnownVenue,
  parseSwedishEventDate,
  parseVenueFromText,
  parseVenueFromTitle,
} from '../swedishDate.js';
import { zonedDateKey, zonedParts, zonedTimeToUtc } from '../timezone.js';

const DAG = 24 * 60 * 60_000;

/**
 * Eventsidorna har datum, tid och scen i egna märkta element:
 *
 *   <div class="datum-b"><p>lördag sep 05, 2026</p></div>
 *   <div class="tid-b"><p>14.00 - 00.00</p></div>
 *   Slaktkyrkan,  Styckmästargatan 10
 *
 * Det är betydligt pålitligare än prosan i REST-flödet: årtalet står utskrivet så
 * inget behöver härledas, och det är enda stället Slakthusens sluttider finns.
 * Fälten renderas av sidmallen och följer inte med i REST-svaret, så de kräver
 * ett eget anrop per evenemang — därför hämtas de bara selektivt.
 */
const DATUM_FALT = /class="datum-b"[^>]*>\s*<p>([^<]*)<\/p>/i;
const TID_FALT = /class="tid-b"[^>]*>\s*<p>([^<]*)<\/p>/i;
const PLATS_EFTER_TID = /class="tid-b"[\s\S]{0,160}?<\/div>\s*([^<]{3,80})/i;

function klockslag(text) {
  // En arrangör har skrivit "21.0O" med bokstaven O i stället för nolla. Fältet
  // innehåller bara klockslag, så en rak ersättning är trygg här.
  const rensad = String(text ?? '').replace(/[Oo]/g, '0');

  return [...rensad.matchAll(/(?<!\d)(\d{1,2})[.:](\d{2})(?!\d)/g)]
    .map((m) => ({ hour: Number(m[1]), minute: Number(m[2]) }))
    .filter(({ hour, minute }) => hour <= 23 && minute <= 59);
}

/**
 * @returns {{startUtc:number, endUtc:number|null, venue:string|null}|null}
 *   null när sidan saknar fälten.
 */
export function parseEventPage(html, { now = Date.now() } = {}) {
  const datum = html.match(DATUM_FALT)?.[1];
  const tid = html.match(TID_FALT)?.[1];
  if (!datum || !tid) return null;

  // Datumsträngen har alltid årtal, så ingen härledning sker.
  const dag = parseSwedishEventDate(datum, { now });
  if (!dag) return null;

  const { year, month, day } = zonedParts(dag.startUtc);
  const tider = klockslag(tid);
  if (tider.length === 0) return null;

  const startUtc = zonedTimeToUtc(year, month, day, tider[0].hour, tider[0].minute);

  let endUtc = null;
  if (tider.length > 1) {
    endUtc = zonedTimeToUtc(year, month, day, tider[1].hour, tider[1].minute);
    // "14.00 - 00.00" och "21.00-03.00" slutar efter midnatt, alltså nästa dygn.
    if (endUtc <= startUtc) endUtc += DAG;
  }

  return {
    startUtc,
    endUtc,
    venue: matchKnownVenue((html.match(PLATS_EFTER_TID)?.[1] ?? '').split(',')[0]),
  };
}

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

/**
 * Tak för hur många eventsidor som hämtas per uppdatering.
 *
 * Sidorna har den bästa datan men kostar ett anrop var, och flödet innehåller
 * omkring nittio inlägg. Vi hämtar därför bara de som gör skillnad: dagens
 * evenemang, som visas överst och behöver exakt tid, och de vars datum inte gick
 * att tolka ur prosan — de syns annars inte alls.
 */
const ENRICH_LIMIT = 20;

/**
 * Slår ihop sidans uppgifter med prosans, och använder varje källa till det den
 * är bra på.
 *
 * Sidan äger **datumet** — det har årtal och behöver inte härledas — och
 * **sluttiden**, som bara finns där. Men dess enda tidsfält är inte alltid
 * speltiden: Countryhus vol. 4 har `tid-b` 20:00 medan prosan skiljer på
 * "Insläpp: 20.00" och "Live: ca 21.00". Har prosan hittat en riktig speltid är
 * den alltså mer precis, och behålls — fast flyttad till sidans datum.
 */
export function applyPage(event, page) {
  const proseHasShowtime = !event.timeIsGuess && !event.timeIsDoors;
  const { year, month, day } = zonedParts(page.startUtc);

  const startUtc = proseHasShowtime
    ? (() => {
        const { hour, minute } = zonedParts(event.startUtc);
        return zonedTimeToUtc(year, month, day, hour, minute);
      })()
    : page.startUtc;

  return {
    ...event,
    startUtc,
    // Sluttiden kan hamna före starten om prosans speltid är senare än sidans
    // tidsfält antydde. Då är spannet inte meningsfullt och utelämnas.
    endUtc: page.endUtc !== null && page.endUtc > startUtc ? page.endUtc : null,
    venue: page.venue ?? event.venue,
    timeIsDoors: false,
    timeIsGuess: false,
  };
}

export async function fetchSlakthusen({
  now = Date.now(),
  fetchText = defaultFetchText,
  enrichDetails = true,
} = {}) {
  const posts = JSON.parse(await fetchText(API_URL));

  if (!Array.isArray(posts)) {
    throw new Error('Oväntat svar från slakthusen.se — förväntade en lista med inlägg');
  }

  const events = [];
  const utanDatum = [];

  for (const post of posts) {
    if (NON_EVENT_SLUGS.has(post.slug)) continue;

    const title = stripHtml(post.title?.rendered);
    // Utdraget räcker nästan alltid; brödtexten är reservväg när det är avkortat.
    const text = `${stripHtml(post.excerpt?.rendered)} ${stripHtml(post.content?.rendered)}`;

    const parsed = parseSwedishEventDate(text, { now });
    if (!parsed) {
      // Prosan gav inget datum. Sidan kan ändå ha det — spara för hämtning.
      utanDatum.push({ post, title });
      continue;
    }

    // Titeln är förstahandskällan, men långt ifrån alla inlägg har "| Scen".
    // Står scenen i brödtexten är den lika pålitlig — och "Slakthusområdet" är
    // sista utvägen, inte ett svar.
    const titleVenue = parseVenueFromTitle(title);
    const venue = titleVenue ?? parseVenueFromText(text);

    events.push({
      id: `${SOURCE_ID}:${post.id}`,
      // Scenen visas separat, så den kapas bort ur titeln när den står där.
      title: titleVenue ? title.split('|')[0].trim() : title,
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
  if (events.length === 0 && utanDatum.length > 0) {
    throw new Error(
      `Inget av ${utanDatum.length} inlägg från slakthusen.se hade ett tolkbart datum — formatet kan ha ändrats`,
    );
  }

  if (!enrichDetails) return { events, unparsed: utanDatum.length };

  const antalFrånProsan = events.length;
  const todayKey = zonedDateKey(now);
  const idag = events.filter((event) => zonedDateKey(event.startUtc) === todayKey);

  /** Hämtar en sida och returnerar dess uppgifter, eller null om något fallerar. */
  async function hämtaSida(url) {
    try {
      return parseEventPage(await fetchText(url), { now });
    } catch {
      // En sida som inte svarar ska inte fälla hela källan.
      return null;
    }
  }

  const jobb = [
    // Dagens evenemang visas överst och förtjänar exakt tid, sluttid och scen.
    ...idag.map((event) => async () => {
      const page = await hämtaSida(event.url);
      if (page) Object.assign(event, applyPage(event, page));
    }),
    // De utan tolkbart datum syns inte alls idag. Sidan kan rädda dem.
    ...utanDatum.map(({ post, title }) => async () => {
      const page = await hämtaSida(post.link);
      if (!page) return;

      const titleVenue = parseVenueFromTitle(title);
      events.push({
        id: `${SOURCE_ID}:${post.id}`,
        title: titleVenue ? title.split('|')[0].trim() : title,
        subtitle: null,
        description: null,
        venue: page.venue ?? titleVenue ?? 'Slakthusområdet',
        venueGroup: 'slakthuset',
        startUtc: page.startUtc,
        endUtc: page.endUtc,
        doorsUtc: null,
        timeIsDoors: false,
        timeIsGuess: false,
        category: 'konsert',
        url: post.link,
        imageUrl: null,
        sourceId: SOURCE_ID,
      });
    }),
  ].slice(0, ENRICH_LIMIT);

  await Promise.all(jobb.map((kör) => kör()));

  return {
    events,
    unparsed: utanDatum.length,
    enriched: jobb.length,
    // Hur många som bara finns tack vare sidhämtningen.
    räddade: events.length - antalFrånProsan,
  };
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
