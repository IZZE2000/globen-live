import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  STATUS,
  buildTodayView,
  decorate,
  estimateDurationMinutes,
} from '../src/normalize.js';
import { zonedTimeToUtc } from '../src/timezone.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Referens: 31 augusti 2026, 20:00 svensk tid. */
const NOW = zonedTimeToUtc(2026, 8, 31, 20, 0);

function event(overrides = {}) {
  return {
    id: 'x',
    title: 'Test',
    venue: '3Arena',
    venueGroup: 'arena',
    startUtc: NOW,
    category: 'konsert',
    sourceId: 'test',
    ...overrides,
  };
}

test('uppskattar längd efter kategori', () => {
  assert.equal(estimateDurationMinutes({ category: 'fotboll' }), 120);
  assert.equal(estimateDurationMinutes({ category: 'hockey' }), 150);
  assert.equal(estimateDurationMinutes({ category: 'klubb' }), 300);
  assert.equal(estimateDurationMinutes({ category: 'konsert' }), 180);
});

test('känner igen sporttyp ur titeln när kategorin är trubbig', () => {
  assert.equal(estimateDurationMinutes({ category: 'sport', title: 'DIF – GAIS (Allsvenskan)' }), 120);
  assert.equal(estimateDurationMinutes({ category: 'sport', title: 'AIK Hockey' }), 150);
});

test('faller tillbaka på tre timmar för okänd kategori', () => {
  assert.equal(estimateDurationMinutes({ category: 'nagot-annat' }), 180);
  assert.equal(estimateDurationMinutes({}), 180);
});

test('markerar ett pågående event som NOW', () => {
  const started = decorate(event({ startUtc: NOW - 30 * MINUTE }), NOW);

  assert.equal(started.status, STATUS.NOW);
  assert.equal(started.durationIsEstimated, true, 'ingen källa ger sluttider');
});

test('markerar ett event som börjar inom tre timmar som SOON', () => {
  const soon = decorate(event({ startUtc: NOW + 40 * MINUTE }), NOW);

  assert.equal(soon.status, STATUS.SOON);
  assert.equal(soon.minutesUntilStart, 40);
});

test('ett event längre bort än tre timmar är LATER, inte SOON', () => {
  assert.equal(decorate(event({ startUtc: NOW + 5 * HOUR }), NOW).status, STATUS.LATER);
});

test('markerar ett avslutat event som DONE', () => {
  // 3 h konsert som började för 4 h sedan.
  const past = decorate(event({ startUtc: NOW - 4 * HOUR }), NOW);

  assert.equal(past.status, STATUS.DONE);
});

test('gränsfall: exakt vid starten pågår eventet', () => {
  assert.equal(decorate(event({ startUtc: NOW }), NOW).status, STATUS.NOW);
});

test('gränsfall: exakt vid beräknad sluttid är eventet slut', () => {
  assert.equal(decorate(event({ startUtc: NOW - 3 * HOUR }), NOW).status, STATUS.DONE);
});

/**
 * Resident Advisor publicerar riktiga sluttider. För de eventen ska "pågår nu" bygga
 * på data i stället för en gissning — och gränssnittet ska kunna säga vilket som är
 * vilket, i stället för att hedga likadant för allt.
 */
test('använder källans sluttid när den finns', () => {
  const slutar = NOW + 6 * HOUR;
  const klubbkvall = decorate(event({ category: 'klubb', endUtc: slutar }), NOW);

  assert.equal(klubbkvall.endUtc, slutar);
  assert.equal(klubbkvall.durationIsEstimated, false);
});

test('gissar bara när sluttid saknas', () => {
  const konsert = decorate(event({ category: 'konsert' }), NOW);

  assert.equal(konsert.endUtc, NOW + 3 * HOUR);
  assert.equal(konsert.durationIsEstimated, true);
});

test('en sluttid före starten är skräp och ignoreras', () => {
  const trasig = decorate(event({ category: 'konsert', endUtc: NOW - HOUR }), NOW);

  assert.equal(trasig.endUtc, NOW + 3 * HOUR, 'faller tillbaka på uppskattningen');
  assert.equal(trasig.durationIsEstimated, true);
});

test('status följer den riktiga sluttiden, inte kategorigissningen', () => {
  // En klubbkväll 21–03 pågår fortfarande klockan 02, långt efter att
  // femtimmarsgissningen hade räknat den som slut.
  const start = NOW - 5.5 * HOUR;
  const kvall = decorate(event({ category: 'konsert', startUtc: start, endUtc: NOW + HOUR }), NOW);

  assert.equal(kvall.status, STATUS.NOW);
});

test('buildTodayView delar upp dagen och räknar det som pågår', () => {
  const view = buildTodayView(
    [
      event({ id: 'pagar', startUtc: NOW - 30 * MINUTE }),
      event({ id: 'strax', startUtc: NOW + 40 * MINUTE }),
      event({ id: 'senare', startUtc: NOW + 2 * HOUR }),
      event({ id: 'klart', startUtc: NOW - 6 * HOUR }),
    ],
    NOW,
  );

  assert.equal(view.dateKey, '2026-08-31');
  assert.deepEqual(view.live.map((e) => e.id), ['pagar']);
  assert.deepEqual(view.upcoming.map((e) => e.id), ['strax', 'senare'], 'i tidsordning');
  assert.deepEqual(view.finished.map((e) => e.id), ['klart']);
  assert.equal(view.isEmpty, false);
});

test('händelser i morgon räknas inte till idag', () => {
  // 00:30 svensk tid nästa dygn — samma UTC-dygn, men ett annat svenskt.
  const afterMidnight = zonedTimeToUtc(2026, 9, 1, 0, 30);
  const view = buildTodayView([event({ id: 'imorgon', startUtc: afterMidnight })], NOW);

  assert.equal(view.live.length + view.upcoming.length + view.finished.length, 0);
  assert.equal(view.isEmpty, true);
});

test('tom dag pekar ut nästa dag med något på gång', () => {
  const iTreDagar = zonedTimeToUtc(2026, 9, 3, 19, 0);
  const view = buildTodayView([event({ id: 'senare-i-veckan', startUtc: iTreDagar })], NOW);

  assert.equal(view.isEmpty, true);
  assert.equal(view.nextDay.dateKey, '2026-09-03');
  assert.deepEqual(view.nextDay.events.map((e) => e.id), ['senare-i-veckan']);
});

test('utan framtida event finns ingen nästa dag att peka på', () => {
  const view = buildTodayView([event({ id: 'gammalt', startUtc: NOW - 30 * 24 * HOUR })], NOW);

  assert.equal(view.isEmpty, true);
  assert.equal(view.nextDay, null);
});
