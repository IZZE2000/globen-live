import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseSwedishEventDate, parseVenueFromTitle } from '../src/swedishDate.js';
import { formatTime, zonedDateKey, zonedTimeToUtc } from '../src/timezone.js';

/**
 * Utdragen nedan är ordagrant hämtade från slakthusen.se/wp-json/wp/v2/posts.
 * HTML-taggarna är borttagna, vilket klistrar ihop orden ("KallsupTorsdag") —
 * precis så som parsern möter texten i verkligheten.
 */
const KALLSUP =
  ' Band: KallsupTorsdag 26 novemberVenue: Hus 7Insläpp 19.00Live från ca 20.00Åldersgräns: 13+ i målsmans sällskap/ 18+, läs mer om åldersgräns: https://slakthusen.se';

const MARTIAL =
  ' I samarbete med Klubb DÖD Artist: Martial CanterelFredag 18 septemberVenue: Hus 7Insläpp 20.00Live från ca 21.00Åldersgräns: 18+, läs mer om åldersgräns: https';

const KEKHT =
  ' Band: Kékht ArákhSupport: Vanskapth + VS-55Torsdag 29 oktoberVenue: SlaktkyrkanInsläpp 19.00Live från ca 20.00Åldersgräns: 13+ i målsmans sällskap/ 18+, läs me';

/** Referenspunkt: 31 augusti 2026, 12:00 svensk tid. */
const NOW = zonedTimeToUtc(2026, 8, 31, 12, 0);

test('läser datum och speltid ur ett hopklistrat utdrag', () => {
  const result = parseSwedishEventDate(KALLSUP, { now: NOW });

  assert.equal(zonedDateKey(result.startUtc), '2026-11-26');
  assert.equal(formatTime(result.startUtc), '20:00', 'speltiden, inte insläppet');
  assert.equal(formatTime(result.doorsUtc), '19:00');
});

test('klarar utdrag där artistnamnet klistrats ihop med veckodagen', () => {
  const result = parseSwedishEventDate(MARTIAL, { now: NOW });

  assert.equal(zonedDateKey(result.startUtc), '2026-09-18');
  assert.equal(formatTime(result.startUtc), '21:00');
});

test('klarar utdrag med supportakt före datumet', () => {
  const result = parseSwedishEventDate(KEKHT, { now: NOW });

  assert.equal(zonedDateKey(result.startUtc), '2026-10-29');
  assert.equal(formatTime(result.startUtc), '20:00');
});

test('faller tillbaka på insläppet när speltid saknas', () => {
  const result = parseSwedishEventDate('Fredag 5 december Venue: Hus 7 Insläpp 22.00', {
    now: NOW,
  });

  assert.equal(formatTime(result.startUtc), '22:00');
  assert.equal(result.timeIsDoors, true, 'ska flaggas som insläpp, inte speltid');
});

test('härleder nästa års datum när månaden redan passerat', () => {
  // Referens: 20 december 2026. "5 januari" måste bli 2027, inte 2026.
  const december = zonedTimeToUtc(2026, 12, 20, 12, 0);
  const result = parseSwedishEventDate('Tisdag 5 januari Insläpp 19.00', { now: december });

  assert.equal(zonedDateKey(result.startUtc), '2027-01-05');
});

test('behåller innevarande år för ett datum som ligger strax framför', () => {
  const result = parseSwedishEventDate('Måndag 1 september Insläpp 19.00', { now: NOW });

  assert.equal(zonedDateKey(result.startUtc), '2026-09-01');
});

test('hanterar sommartidsskiftet — oktober ger vintertid', () => {
  // 29 oktober 2026 ligger efter skiftet, alltså UTC+1.
  const result = parseSwedishEventDate(KEKHT, { now: NOW });

  assert.equal(new Date(result.startUtc).toISOString(), '2026-10-29T19:00:00.000Z');
});

test('hanterar sommartid — september ger UTC+2', () => {
  const result = parseSwedishEventDate(MARTIAL, { now: NOW });

  assert.equal(new Date(result.startUtc).toISOString(), '2026-09-18T19:00:00.000Z');
});

test('returnerar null när texten saknar datum', () => {
  assert.equal(parseSwedishEventDate('Vi har stängt för säsongen.', { now: NOW }), null);
});

test('klarar datum utan veckodag', () => {
  const result = parseSwedishEventDate('12 mars, Insläpp 19.00', { now: NOW });

  assert.equal(zonedDateKey(result.startUtc), '2027-03-12');
});

// Fallen nedan hittades genom att köra tolken mot alla 100 inlägg på slakthusen.se
// och granska vad som föll bort. Alla är riktiga konserter, inte informationssidor.

test('klarar förkortad månad — "Torsdag 5 nov"', () => {
  const result = parseSwedishEventDate(
    'Band: Horse LordsTorsdag 5 novInsläpp: 19.00Live från: 20.00Lokal: Hus 7',
    { now: NOW },
  );

  assert.equal(zonedDateKey(result.startUtc), '2026-11-05');
  assert.equal(formatTime(result.startUtc), '20:00', 'kolon efter "Live från" ska inte stoppa oss');
});

test('klarar engelskt datum med ordningstal och utskrivet år', () => {
  const result = parseSwedishEventDate(
    'DOOMOPOLIS STHLM 2026 Saturday 15th of August 2026 Venues: Slaktkyrkan & Hus7',
    { now: NOW },
  );

  assert.equal(zonedDateKey(result.startUtc), '2026-08-15');
});

test('klarar versalt engelskt datum utan år', () => {
  const result = parseSwedishEventDate('YOU THANT ALBUM RELEASE 22ND OF MAY LINE UP: VA', {
    now: NOW,
  });

  assert.equal(zonedDateKey(result.startUtc), '2027-05-22', 'maj har passerat, alltså nästa år');
});

test('klarar engelsk månad före dag', () => {
  const result = parseSwedishEventDate('On March 21, DIMENSION returns to Stockholm', {
    now: NOW,
  });

  assert.equal(zonedDateKey(result.startUtc), '2027-03-21');
});

test('läser inte ett årtal som om det vore ett datum', () => {
  // "I november 2025 återvände duon" är en tillbakablick, inte ett speldatum.
  // Utan skydd skulle "25" ur "2025" tolkas som den 25 november.
  assert.equal(
    parseSwedishEventDate('I november 2025 återvände dark wave-duon White Birches', { now: NOW }),
    null,
  );
});

test('klarar tid angiven före nyckelordet', () => {
  const result = parseSwedishEventDate('Fredag 10 september 19:00 doors 20:30 showtime', {
    now: NOW,
  });

  assert.equal(formatTime(result.startUtc), '20:30');
  assert.equal(formatTime(result.doorsUtc), '19:00');
});

test('respekterar utskrivet år framför härledning', () => {
  const result = parseSwedishEventDate('Lördag 15 augusti 2027 Insläpp 19.00', { now: NOW });

  assert.equal(zonedDateKey(result.startUtc), '2027-08-15');
});

test('läser ut scenen ur titeln', () => {
  assert.equal(parseVenueFromTitle('Kallsup | Hus 7'), 'Hus 7');
  assert.equal(parseVenueFromTitle('Kékht Arákh | Slaktkyrkan'), 'Slaktkyrkan');
  assert.equal(parseVenueFromTitle('Något utan scen'), null);
});
