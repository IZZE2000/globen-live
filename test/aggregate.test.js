import { test } from 'node:test';
import assert from 'node:assert/strict';

import { collectEvents } from '../src/aggregate.js';
import { zonedTimeToUtc } from '../src/timezone.js';

/** Referens: 31 augusti 2026, 16:00 svensk tid. */
const NOW = zonedTimeToUtc(2026, 8, 31, 16, 0);

function eventsSource(id, starts) {
  return {
    id,
    label: id,
    fetch: async () =>
      starts.map((startUtc, index) => ({
        id: `${id}:${index}`,
        title: `${id} ${index}`,
        venue: id,
        startUtc,
        sourceId: id,
      })),
  };
}

function workingSource(id, count) {
  return {
    id,
    label: id,
    fetch: async () =>
      Array.from({ length: count }, (_, index) => ({
        id: `${id}:${index}`,
        title: `${id} ${index}`,
        venue: id,
        startUtc: Date.now(),
        sourceId: id,
      })),
  };
}

function brokenSource(id, message) {
  return {
    id,
    label: id,
    fetch: async () => {
      throw new Error(message);
    },
  };
}

/**
 * Kärnan i "best effort": att Slakthusen ligger nere får inte dölja att det är
 * match på 3Arena. Därför Promise.allSettled, aldrig Promise.all.
 */
test('en död källa tar inte ner de övriga', async () => {
  const result = await collectEvents({
    sources: [workingSource('3arena', 2), brokenSource('slakthusen', 'ENOTFOUND')],
  });

  assert.equal(result.events.length, 2, 'de fungerande källornas event finns kvar');
});

test('varje källas utfall rapporteras separat', async () => {
  const result = await collectEvents({
    sources: [workingSource('3arena', 2), brokenSource('slakthusen', 'ENOTFOUND')],
  });

  const arena = result.sources.find((source) => source.id === '3arena');
  const slakthusen = result.sources.find((source) => source.id === 'slakthusen');

  assert.deepEqual(
    { ok: arena.ok, count: arena.count },
    { ok: true, count: 2 },
  );
  assert.equal(slakthusen.ok, false);
  assert.match(slakthusen.error, /ENOTFOUND/, 'felet ska nå fram till gränssnittet');
});

/**
 * Slakthusen låter gamla konserter ligga kvar publicerade, med utskrivet år
 * ("Datum: 6 maj, 2026"). De tolkas alltså korrekt — men de hör inte hemma i en
 * sida om vad som är på gång, och de fick antalet i källhälsan att ljuga.
 */
test('evenemang från tidigare dagar sorteras bort', async () => {
  const iVaras = zonedTimeToUtc(2026, 5, 6, 20, 0);
  const iGar = zonedTimeToUtc(2026, 8, 30, 20, 0);
  const iMorgon = zonedTimeToUtc(2026, 9, 1, 20, 0);

  const result = await collectEvents({
    now: NOW,
    sources: [eventsSource('slakthusen', [iVaras, iGar, iMorgon])],
  });

  assert.deepEqual(result.events.map((event) => event.startUtc), [iMorgon]);
  assert.equal(result.sources[0].count, 1, 'antalet ska spegla vad som faktiskt visas');
});

/**
 * Gränsen går vid dygnets början, inte vid "nu" — annars försvinner eftermiddagens
 * konsert ur "Tidigare idag" så fort den är slut.
 */
test('evenemang tidigare idag behålls', async () => {
  const iMorse = zonedTimeToUtc(2026, 8, 31, 11, 0);

  const result = await collectEvents({
    now: NOW,
    sources: [eventsSource('arena', [iMorse])],
  });

  assert.deepEqual(result.events.map((event) => event.startUtc), [iMorse]);
});

/**
 * Utan den här rapporteringen går det inte att skilja "lugn kväll i Globenområdet"
 * från "skraparen är trasig" — båda ser ut som noll event.
 */
test('alla källor nere ger noll event men ett synligt fel', async () => {
  const result = await collectEvents({
    sources: [brokenSource('a', 'timeout'), brokenSource('b', '503')],
  });

  assert.equal(result.events.length, 0);
  assert.equal(result.sources.every((source) => !source.ok), true);
  assert.deepEqual(result.sources.map((source) => source.error), ['timeout', '503']);
});
