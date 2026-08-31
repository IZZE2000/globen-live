import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { fetchArena } from '../src/sources/stockholmlive.js';
import { formatTime, zonedDateKey, zonedTimeToUtc } from '../src/timezone.js';

/**
 * Fixturerna är ordagrann JSON-LD hämtad från 3arena.se. Testet går mot dem i stället
 * för mot nätet, så det fortsätter fånga regressionen även när matchen spelats klart.
 */
const listing = readFileSync(new URL('./fixtures/3arena-listing.html', import.meta.url), 'utf8');
const detail = readFileSync(new URL('./fixtures/3arena-djurgarden.html', import.meta.url), 'utf8');

const ARENA = { id: '3arena', name: '3Arena', listingUrl: 'https://3arena.se/evenemang/' };

/** 31 augusti 2026, 12:00 svensk tid — matchdagen fixturerna fångades. */
const MATCHDAY = zonedTimeToUtc(2026, 8, 31, 12, 0);

function stubFetch(overrides = {}) {
  return async (url) => {
    if (url === ARENA.listingUrl) return listing;
    if (overrides[url]) return overrides[url];
    if (url.includes('djurgarden-fotboll')) return detail;
    throw new Error(`ovantad URL: ${url}`);
  };
}

/**
 * Regressionen som motiverade hela tidszonshanteringen: listningssidan anger matchen
 * som "2026-08-31T17:00:00+00:00" och eventsidan som "2026-08-31T19:00:00+02:00".
 * Läser man siffrorna rakt ur listningens ISO-sträng blir tiden två timmar fel.
 */
test('matchen visas 19:00 svensk tid, inte listningens 17:00', async () => {
  const events = await fetchArena(ARENA, { now: MATCHDAY, fetchText: stubFetch() });
  const match = events.find((event) => zonedDateKey(event.startUtc) === '2026-08-31');

  assert.ok(match, 'matchen ska hittas på matchdagen');
  assert.equal(formatTime(match.startUtc), '19:00');
  assert.notEqual(formatTime(match.startUtc), '17:00');
});

test('eventsidan ger det specifika matchnamnet, listningens namn blir underrubrik', async () => {
  const events = await fetchArena(ARENA, { now: MATCHDAY, fetchText: stubFetch() });
  const match = events.find((event) => zonedDateKey(event.startUtc) === '2026-08-31');

  assert.equal(match.title, 'DIF – Mjällby AIF (Allsvenskan)');
  assert.equal(match.subtitle, 'Djurgården Fotboll');
});

test('läser ut kategori och scen', async () => {
  const events = await fetchArena(ARENA, { now: MATCHDAY, fetchText: stubFetch() });

  assert.equal(events[0].category, 'sport');
  assert.equal(events[0].venue, '3Arena');
  assert.equal(events[0].venueGroup, 'arena');
});

test('en trasig detaljsida behåller grunddatan i stället för att sänka hämtningen', async () => {
  const failing = async (url) => {
    if (url === ARENA.listingUrl) return listing;
    throw new Error('502 Bad Gateway');
  };

  const events = await fetchArena(ARENA, { now: MATCHDAY, fetchText: failing });
  const match = events.find((event) => zonedDateKey(event.startUtc) === '2026-08-31');

  assert.equal(formatTime(match.startUtc), '19:00', 'tiden kommer från listningen');
  assert.equal(match.title, 'Djurgården Fotboll', 'det generiska namnet får duga');
});

/**
 * Annexet publicerar "CA7RIEL &amp; Paco Amoroso" — HTML-entiteter läcker in i
 * JSON-LD:n. Utan avkodning står ampersanden kvar rå på kortet.
 */
test('avkodar HTML-entiteter i namn från källan', async () => {
  const withEntities = `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: [
      {
        '@type': 'ListItem',
        item: {
          '@type': 'Event',
          name: 'CA7RIEL &amp; Paco Amoroso',
          url: 'https://annexet.se/evenemang/musik-show/ca7riel-paco-amoroso/',
          startDate: '2026-08-31T18:30:00+00:00',
        },
      },
    ],
  })}</script>`;

  const events = await fetchArena(ARENA, {
    now: MATCHDAY,
    enrichDetails: false,
    fetchText: async () => withEntities,
  });

  assert.equal(events[0].title, 'CA7RIEL & Paco Amoroso');
});

test('en listningssida utan JSON-LD larmar i stället för att tyst ge noll event', async () => {
  const empty = async () => '<html><body>Ombyggd sajt utan strukturerad data</body></html>';

  await assert.rejects(
    () => fetchArena(ARENA, { now: MATCHDAY, fetchText: empty }),
    /JSON-LD/,
  );
});
