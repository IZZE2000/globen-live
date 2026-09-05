import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { fetchResidentAdvisor } from '../src/sources/residentadvisor.js';
import { formatTime, zonedDateKey, zonedTimeToUtc } from '../src/timezone.js';

const fixture = readFileSync(new URL('./fixtures/ra-venues.json', import.meta.url), 'utf8');

/** 5 september 2026, 12:00 svensk tid. */
const NOW = zonedTimeToUtc(2026, 9, 5, 12, 0);

const stub = async () => fixture;

/**
 * RA anger tider helt utan tidszon — "2026-09-19T21:00:00.000". Parsas de naivt
 * tolkar JavaScript dem som serverns lokala tid, vilket på en UTC-server ger 23:00
 * i stället för 21:00. Tiderna är svensk väggklocka och måste tolkas som sådana.
 */
test('tolkar RA:s tidszonslösa tider som svensk väggklocka', async () => {
  const events = await fetchResidentAdvisor({ now: NOW, fetchText: stub });
  const ibne = events.find((event) => event.title.includes('IBNE'));

  assert.ok(ibne, 'eventet ska finnas i fixturen');
  assert.equal(formatTime(ibne.startUtc), '21:00');
  assert.equal(zonedDateKey(ibne.startUtc), '2026-09-19');
});

/**
 * Det som gör RA värdefull: den är enda källan i projektet som publicerar sluttider.
 * Alla andra tvingar gränssnittet att gissa hur länge något håller på.
 */
test('tar med den riktiga sluttiden', async () => {
  const events = await fetchResidentAdvisor({ now: NOW, fetchText: stub });
  const ibne = events.find((event) => event.title.includes('IBNE'));

  assert.equal(formatTime(ibne.endUtc), '03:00');
  assert.equal(zonedDateKey(ibne.endUtc), '2026-09-20', 'klubbkvällar sträcker sig över midnatt');
});

test('märker upp alla tre scenerna i kvarteret', async () => {
  const events = await fetchResidentAdvisor({ now: NOW, fetchText: stub });
  const venues = new Set(events.map((event) => event.venue));

  assert.deepEqual([...venues].sort(), ['Fållan', 'Slakthuset', 'Slaktkyrkan']);
  assert.equal(events.every((event) => event.venueGroup === 'slakthuset'), true);
});

test('bygger absoluta länkar till eventsidorna', async () => {
  const events = await fetchResidentAdvisor({ now: NOW, fetchText: stub });

  assert.equal(events.every((event) => event.url.startsWith('https://ra.co/events/')), true);
});

test('sorterar bort evenemang som redan varit', async () => {
  const senare = zonedTimeToUtc(2027, 1, 1, 12, 0);
  const events = await fetchResidentAdvisor({ now: senare, fetchText: stub });

  assert.equal(events.length, 0, 'inget i fixturen ligger efter nyår 2027');
});

/**
 * API:et är RA:s eget och odokumenterat. Ändras schemat ska det larma, inte tyst
 * ge noll evenemang — annars går det inte att skilja från en lugn vecka.
 */
test('larmar när svaret inte har den form vi väntar oss', async () => {
  const tomt = async () => JSON.stringify({ data: {} });

  await assert.rejects(() => fetchResidentAdvisor({ now: NOW, fetchText: tomt }), /spelplats/i);
});
