import { test } from 'node:test';
import assert from 'node:assert/strict';

import { describeFetchError, hostOf } from '../src/http.js';

const URL_SLAKTHUSEN = 'https://slakthusen.se/wp-json/wp/v2/posts?per_page=100';

/**
 * Den här raden använde tidigare `URL.parse()` — den statiska metoden, som kom först
 * i Node 22.1. På en server med Node 20 kastade den TypeError, och den ligger i
 * felhanteringen: buggen hade slagit till precis när en källa redan strulat, och
 * gjort ett tydligt felmeddelande till en krasch.
 *
 * Konstruktorn finns i alla versioner. Fallet med ogiltig URL nedan går genom exakt
 * den kodväg där den gamla varianten returnerade null.
 */
test('läser värdnamnet ur en URL', () => {
  assert.equal(hostOf(URL_SLAKTHUSEN), 'slakthusen.se');
  assert.equal(hostOf('https://hovetarena.se/evenemang/'), 'hovetarena.se');
  assert.equal(hostOf('http://localhost:3000/api/events'), 'localhost:3000');
});

test('behåller strängen när den inte är en giltig URL', () => {
  assert.equal(hostOf('inte-en-url'), 'inte-en-url');
  assert.equal(hostOf(''), '');
  assert.equal(hostOf(undefined), '');
});

test('timeout blir ett meddelande som säger vad som hände', () => {
  const abort = Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
  const described = describeFetchError(abort, URL_SLAKTHUSEN, 15_000);

  assert.equal(described.message, 'slakthusen.se svarade inte inom 15 s');
});

/**
 * Nodes nätverksfel lyder ordagrant "fetch failed" och säger ingenting om vilken
 * källa som fallerade — vilket är just vad källhälsan i gränssnittet ska visa.
 */
test('nätverksfel får värdnamn och underliggande orsak', () => {
  const failure = Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } });
  const described = describeFetchError(failure, URL_SLAKTHUSEN, 15_000);

  assert.equal(described.message, 'slakthusen.se gick inte att nå (ENOTFOUND)');
});

test('nätverksfel utan orsak erkänner att orsaken är okänd', () => {
  const failure = new Error('fetch failed');
  const described = describeFetchError(failure, URL_SLAKTHUSEN, 15_000);

  assert.match(described.message, /slakthusen\.se gick inte att nå \(okänd orsak\)/);
});

test('andra fel skickas vidare orörda', () => {
  const original = new Error('404 Not Found — https://slakthusen.se/saknas');
  assert.equal(describeFetchError(original, URL_SLAKTHUSEN, 15_000), original);
});
