import { test } from 'node:test';
import assert from 'node:assert/strict';

import { collectEvents } from '../src/aggregate.js';

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
 * Utan den här rapporteringen går det inte att skilja "lugn kväll i Johanneshov"
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
