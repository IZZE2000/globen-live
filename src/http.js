/** Tunn fetch-omslag med timeout och en ärlig User-Agent. */

const DEFAULT_TIMEOUT_MS = 15_000;

const USER_AGENT =
  'GlobenLive/1.0 (personlig översikt över evenemang i Johanneshov; kontakt via lokal körning)';

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
    // Nodes nätverksfel är ordagrant "fetch failed", vilket inte hjälper någon som
    // läser källhälsan i gränssnittet. Lägg till värdnamn och underliggande orsak.
    const host = URL.parse(url)?.host ?? url;

    if (error.name === 'AbortError') {
      throw new Error(`${host} svarade inte inom ${timeoutMs / 1000} s`);
    }

    if (error.message === 'fetch failed') {
      throw new Error(`${host} gick inte att nå (${error.cause?.code ?? error.cause?.message ?? 'okänd orsak'})`);
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson(url, options) {
  return JSON.parse(await fetchText(url, options));
}
