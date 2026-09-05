import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyPage, parseEventPage } from '../src/sources/slakthusen.js';
import { formatTime, zonedDateKey, zonedTimeToUtc } from '../src/timezone.js';

/** 5 september 2026, 12:00 svensk tid. */
const NOW = zonedTimeToUtc(2026, 9, 5, 12, 0);

/**
 * Slakthusens eventsidor har datum, tid och scen i egna märkta element — långt
 * pålitligare än prosan i REST-flödet, och den enda platsen sluttiden finns.
 * Markeringen nedan är ordagrant hämtad från sidorna.
 */
function sida(datum, tid, plats = 'Slaktkyrkan,  Styckmästargatan 10') {
  return `<p>Brödtext om artisten.</p>
    <div class="datum-b"><p>${datum}</p></div><div class="tid-b"><p>${tid}</p></div>
    ${plats} <a href="https://goo.gl/maps/x" target="_blank">hitta hit</a>`;
}

test('läser datum, start och sluttid ur sidans egna fält', () => {
  const r = parseEventPage(sida('lördag sep 05, 2026', '14.00 - 00.00'), { now: NOW });

  assert.equal(zonedDateKey(r.startUtc), '2026-09-05');
  assert.equal(formatTime(r.startUtc), '14:00');
  assert.equal(formatTime(r.endUtc), '00:00');
  assert.equal(r.venue, 'Slaktkyrkan');
});

/**
 * "14.00 - 00.00" slutar vid midnatt, alltså nästa dygn. Utan det här skulle
 * sluttiden hamna före starten och kastas bort.
 */
test('en sluttid vid eller efter midnatt hamnar på nästa dygn', () => {
  const r = parseEventPage(sida('lördag sep 05, 2026', '14.00 - 00.00'), { now: NOW });
  assert.equal(zonedDateKey(r.endUtc), '2026-09-06');

  const klubb = parseEventPage(sida('lördag sep 05, 2026', '21.00-03.00'), { now: NOW });
  assert.equal(zonedDateKey(klubb.endUtc), '2026-09-06');
  assert.equal(formatTime(klubb.endUtc), '03:00');
});

/**
 * MALA:s sida står skriven "21.0O-03.00" — med bokstaven O i stället för nolla.
 * Ett stavfel hos arrangören ska inte tysta ett evenemang.
 */
test('klarar bokstaven O skriven som nolla', () => {
  const r = parseEventPage(sida('fredag sep 04, 2026', '21.0O-03.00'), { now: NOW });

  assert.equal(formatTime(r.startUtc), '21:00');
  assert.equal(formatTime(r.endUtc), '03:00');
});

test('klarar en ensam tid utan spann', () => {
  const r = parseEventPage(sida('torsdag nov 26, 2026', '19:00', 'Hus 7,  Styckmästargatan 10'), {
    now: NOW,
  });

  assert.equal(zonedDateKey(r.startUtc), '2026-11-26');
  assert.equal(formatTime(r.startUtc), '19:00');
  assert.equal(r.endUtc, null, 'ingen sluttid ska inte hittas på');
  assert.equal(r.venue, 'Hus 7');
});

test('respekterar årtalet på sidan i stället för att härleda', () => {
  // Maj har passerat i förhållande till NOW, men sidan säger 2026 — inte 2027.
  const r = parseEventPage(sida('söndag maj 24, 2026', '18:00'), { now: NOW });

  assert.equal(zonedDateKey(r.startUtc), '2026-05-24');
});

/**
 * Sidans tidsfält är inte alltid speltiden. Countryhus vol. 4 har `tid-b` 20:00,
 * medan prosan skiljer på "Insläpp: 20.00" och "Live: ca 21.00" — sidans fält är
 * alltså insläppet. Varje källa används därför till det den är bra på: sidan för
 * datum och sluttid, prosan för speltiden när den faktiskt hittat en.
 */
test('behåller prosans speltid när sidan bara ger insläppet', () => {
  const proseEvent = {
    startUtc: zonedTimeToUtc(2026, 9, 5, 21, 0),
    timeIsDoors: false,
    timeIsGuess: false,
    venue: 'Hus 7',
  };
  const page = {
    startUtc: zonedTimeToUtc(2026, 9, 5, 20, 0),
    endUtc: null,
    venue: 'Hus 7',
  };

  const r = applyPage(proseEvent, page);

  assert.equal(formatTime(r.startUtc), '21:00', 'speltiden, inte insläppet');
  assert.equal(r.timeIsGuess, false);
});

test('sidans tid vinner när prosan bara gissade', () => {
  const proseEvent = {
    startUtc: zonedTimeToUtc(2026, 9, 5, 19, 0),
    timeIsDoors: false,
    timeIsGuess: true,
    venue: 'Slakthusområdet',
  };
  const page = {
    startUtc: zonedTimeToUtc(2026, 9, 5, 14, 0),
    endUtc: zonedTimeToUtc(2026, 9, 6, 0, 0),
    venue: 'Slaktkyrkan',
  };

  const r = applyPage(proseEvent, page);

  assert.equal(formatTime(r.startUtc), '14:00');
  assert.equal(formatTime(r.endUtc), '00:00');
  assert.equal(r.venue, 'Slaktkyrkan');
  assert.equal(r.timeIsGuess, false);
});

test('sidans tid vinner även när prosan bara hittade insläppet', () => {
  const proseEvent = {
    startUtc: zonedTimeToUtc(2026, 9, 5, 22, 0),
    timeIsDoors: true,
    timeIsGuess: false,
    venue: 'Hus 7',
  };
  const page = { startUtc: zonedTimeToUtc(2026, 9, 5, 23, 0), endUtc: null, venue: 'Hus 7' };

  assert.equal(formatTime(applyPage(proseEvent, page).startUtc), '23:00');
});

/** Sidans datum har årtal och är alltid det som gäller, även när tiden kommer från prosan. */
test('sidans datum gäller även när speltiden kommer från prosan', () => {
  const proseEvent = {
    startUtc: zonedTimeToUtc(2027, 3, 1, 21, 0),
    timeIsDoors: false,
    timeIsGuess: false,
    venue: 'Hus 7',
  };
  const page = { startUtc: zonedTimeToUtc(2026, 9, 5, 20, 0), endUtc: null, venue: 'Hus 7' };

  const r = applyPage(proseEvent, page);

  assert.equal(zonedDateKey(r.startUtc), '2026-09-05', 'sidans datum');
  assert.equal(formatTime(r.startUtc), '21:00', 'prosans klockslag');
});

test('returnerar null när sidan saknar fälten', () => {
  assert.equal(parseEventPage('<p>Bara brödtext.</p>', { now: NOW }), null);
});

test('en scen vi inte känner igen påstås inte', () => {
  const r = parseEventPage(sida('lördag sep 05, 2026', '19:00', 'Debaser Strand,  Hornstulls'), {
    now: NOW,
  });

  assert.equal(r.venue, null);
});
