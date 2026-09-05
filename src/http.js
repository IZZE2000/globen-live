/** Tunn fetch-omslag med timeout och en ärlig User-Agent. */

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Måste vara ren ASCII. HTTP-headers får inte innehålla å, ä eller ö, och den
 * tidigare svenska texten fick ra.co att avvisa varje anrop — vilket först såg ut
 * som botfiltrering men bara var en trasig header.
 */
const USER_AGENT =
  'GlobenLive/1.0 (+https://github.com/IZZE2000/globen-live) personal event overview for the Globen area, Stockholm';

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

export async function fetchText(
  url,
  { timeoutMs = DEFAULT_TIMEOUT_MS, method = 'GET', body, headers } = {},
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      method,
      body,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
        'Accept-Language': 'sv-SE,sv;q=0.9',
        ...headers,
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

/**
 * En GraphQL-fråga. Svar med `errors` kastas som fel i stället för att tyst ge
 * tom data — annars skulle ett schemabyte se ut som en lugn kväll.
 */
export async function fetchGraphQL(url, query, options = {}) {
  const body = await fetchJson(url, {
    ...options,
    method: 'POST',
    body: JSON.stringify({ query }),
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });

  if (body.errors?.length) {
    throw new Error(`${hostOf(url)} avvisade frågan: ${body.errors[0].message}`);
  }

  return body.data;
}
