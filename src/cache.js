/**
 * TTL-cache med en viktig egenskap: gammal data är bättre än ingen data.
 *
 * Om en uppdatering misslyckas serveras det senast lyckade resultatet vidare,
 * märkt med hur gammalt det är, i stället för att sidan blir tom vid en tillfällig
 * nätglapp.
 */

export function createCache(loader, { ttlMs = 10 * 60_000, clock = Date.now } = {}) {
  let entry = null;
  let inFlight = null;

  async function refresh() {
    // Flera samtidiga anrop ska dela på en enda hämtning.
    inFlight ??= (async () => {
      try {
        const value = await loader();
        entry = { value, storedAt: clock() };
        return entry;
      } finally {
        inFlight = null;
      }
    })();

    return inFlight;
  }

  return {
    async get() {
      const isFresh = entry && clock() - entry.storedAt < ttlMs;
      if (isFresh) {
        return { ...entry.value, cacheAgeMs: clock() - entry.storedAt, stale: false };
      }

      try {
        const fresh = await refresh();
        return { ...fresh.value, cacheAgeMs: 0, stale: false };
      } catch (error) {
        if (!entry) throw error;

        return {
          ...entry.value,
          cacheAgeMs: clock() - entry.storedAt,
          stale: true,
          staleReason: error.message,
        };
      }
    },

    clear() {
      entry = null;
    },
  };
}
