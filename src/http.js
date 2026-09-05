/** Tunn fetch-omslag med timeout och en ärlig User-Agent. */

const DEFAULT_TIMEOUT_MS = 15_000;

const USER_AGENT =
  'GlobenLive/1.0 (personlig översikt över evenemang i Globenområdet; kontakt via lokal körning)';

/**
 * Värdnamnet ur en URL, eller strängen själv om den inte går att tolka.
 *
 * Använder konstruktorn och inte den statiska `URL.parse()` — den senare finns
 * först från Node 22.1, och den här koden ska klara den Node-version en
 * Ubuntu-server råkar ha.
 */
export function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return String(url ?? '');
  }
}

/**
 * Översätter ett fetch-fel till något som går att läsa i källhälsan.
 * Fel vi inte känner igen skickas vidare orörda — att skriva om dem skulle bara
 * dölja information.
 */
export function describeFetchError(error, url, timeoutMs) {
  const host = hostOf(url);

  if (error.name === 'AbortError') {
    return new Error(`${host} svarade inte inom ${timeoutMs / 1000} s`);
  }

  // Nodes nätverksfel lyder ordagrant "fetch failed" och säger inte vilken källa
  // som fallerade — vilket är precis vad gränssnittet behöver visa.
  if (error.message === 'fetch failed') {
    const cause = error.cause?.code ?? error.cause?.message ?? 'okänd orsak';
    return new Error(`${host} gick inte att nå (${cause})`);
  }

  return error;
}

export async function fetchText(url, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
        'Accept-Language': 'sv-SE,sv;q=0.9',
      },
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText} — ${url}`);
    }

    return await response.text();
  } catch (error) {
    throw describeFetchError(error, url, timeoutMs);
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson(url, options) {
  return JSON.parse(await fetchText(url, options));
}
