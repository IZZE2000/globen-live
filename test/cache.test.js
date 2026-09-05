import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createCache } from '../src/cache.js';

const MINUT = 60_000;

/** En klocka vi styr själva, så åldrande går att testa utan att vänta. */
function klocka(start = 0) {
  let nu = start;
  return { nu: () => nu, gåFram: (ms) => { nu += ms; } };
}

/** Räknar anrop och kan fås att misslyckas. */
function laddare(värden = ['ett', 'två', 'tre']) {
  let n = 0;
  const fn = async () => {
    if (fn.trasig) throw new Error('källan svarar inte');
    return { data: värden[Math.min(n++, värden.length - 1)] };
  };
  fn.antal = () => n;
  return fn;
}

/** Låter bakgrundsuppdateringen bli klar. */
const settle = () => new Promise((r) => setTimeout(r, 0));

test('färsk data hämtas inte om', async () => {
  const k = klocka();
  const load = laddare();
  const cache = createCache(load, { ttlMs: 10 * MINUT, clock: k.nu });

  await cache.get();
  k.gåFram(5 * MINUT);
  const andra = await cache.get();

  assert.equal(load.antal(), 1);
  assert.equal(andra.data, 'ett');
});

/**
 * Kärnan i fixen. Första besökaren efter att cachen gått ut fick tidigare vänta
 * på hela hämtningen — 17 sekunder från servern. Nu serveras den sparade datan
 * omedelbart medan uppdateringen sker i bakgrunden.
 */
test('utgången data serveras direkt och uppdateras i bakgrunden', async () => {
  const k = klocka();
  const load = laddare();
  const cache = createCache(load, { ttlMs: 10 * MINUT, maxStaleMs: 60 * MINUT, clock: k.nu });

  await cache.get();
  k.gåFram(15 * MINUT);

  const svar = await cache.get();
  assert.equal(svar.data, 'ett', 'den sparade datan levereras utan väntan');
  assert.equal(svar.cacheAgeMs, 15 * MINUT);

  await settle();
  assert.equal(load.antal(), 2, 'uppdateringen har skett i bakgrunden');

  const efter = await cache.get();
  assert.equal(efter.data, 'två', 'nästa besökare får den färska datan');
});

/**
 * Men gammal data är inte alltid bättre än att vänta. Har ingen besökt sidan på
 * länge är risken att programmet hunnit ändras helt — då är det värt sekunderna.
 */
test('mycket gammal data väntar hellre in en riktig hämtning', async () => {
  const k = klocka();
  const load = laddare();
  const cache = createCache(load, { ttlMs: 10 * MINUT, maxStaleMs: 60 * MINUT, clock: k.nu });

  await cache.get();
  k.gåFram(90 * MINUT);

  const svar = await cache.get();
  assert.equal(svar.data, 'två', 'väntade in den färska datan');
  assert.equal(load.antal(), 2);
});

test('tom cache väntar in första hämtningen', async () => {
  const load = laddare();
  const cache = createCache(load, { ttlMs: 10 * MINUT, clock: klocka().nu });

  assert.equal((await cache.get()).data, 'ett');
});

test('warm fyller cachen utan att någon frågat', async () => {
  const k = klocka();
  const load = laddare();
  const cache = createCache(load, { ttlMs: 10 * MINUT, clock: k.nu });

  await cache.warm();
  assert.equal(load.antal(), 1, 'hämtningen skedde vid uppstart');

  const svar = await cache.get();
  assert.equal(load.antal(), 1, 'besökaren behövde inte hämta något');
  assert.equal(svar.cacheAgeMs, 0);
});

test('warm som misslyckas fäller inte servern', async () => {
  const load = laddare();
  load.trasig = true;
  const cache = createCache(load, { ttlMs: 10 * MINUT, clock: klocka().nu });

  await cache.warm();
  assert.equal(load.antal(), 0, 'inget värde sparades');
});

test('misslyckad uppdatering serverar sparad data märkt som gammal', async () => {
  const k = klocka();
  const load = laddare();
  const cache = createCache(load, { ttlMs: 10 * MINUT, maxStaleMs: 60 * MINUT, clock: k.nu });

  await cache.get();
  k.gåFram(90 * MINUT);
  load.trasig = true;

  const svar = await cache.get();
  assert.equal(svar.data, 'ett');
  assert.equal(svar.stale, true);
  assert.match(svar.staleReason, /svarar inte/);
});

test('samtidiga anrop delar på en enda hämtning', async () => {
  const load = laddare();
  const cache = createCache(load, { ttlMs: 10 * MINUT, clock: klocka().nu });

  await Promise.all([cache.get(), cache.get(), cache.get()]);

  assert.equal(load.antal(), 1);
});
