import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Sidan kan ligga under en katalog på en delad domän — i drift på
 * aefordon.se/globen/, bredvid en helt annan webbplats.
 *
 * Rotabsoluta sökvägar fungerar där bara om värdservern vidarebefordrar /public/,
 * /src/ och /api/ på roten till oss. Det gjorde den, och därmed hade appen gjort
 * anspråk på tre sökvägar mitt på någon annans domän. Relativa sökvägar håller
 * allt inom sin egen katalog och fungerar lika bra på localhost.
 */
function läs(fil) {
  return readFileSync(new URL(`../public/${fil}`, import.meta.url), 'utf8');
}

test('index.html pekar inte på rotabsoluta sökvägar', () => {
  const html = läs('index.html');
  const träffar = [...html.matchAll(/(?:href|src)="(\/[^/][^"]*)"/g)].map((m) => m[1]);

  assert.deepEqual(träffar, [], `rotabsolut i index.html: ${träffar.join(', ')}`);
});

test('app.js importerar moduler relativt', () => {
  const js = läs('app.js');
  const träffar = [...js.matchAll(/from\s+'(\/[^']*)'/g)].map((m) => m[1]);

  assert.deepEqual(träffar, [], `rotabsolut import: ${träffar.join(', ')}`);
});

test('app.js hämtar API:t relativt', () => {
  const js = läs('app.js');

  assert.match(js, /fetch\('api\/events'\)/);
  assert.doesNotMatch(js, /fetch\('\/api/, 'ett ledande snedstreck skulle peka på domänroten');
});
