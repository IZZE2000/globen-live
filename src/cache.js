/**
 * TTL-cache byggd så att ingen besökare ska behöva vänta på hämtningen.
 *
 * Att hämta alla källor tar sekunder — mätt till 17 från servern en kall gång. Med
 * en vanlig cache betalar första besökaren efter varje utgång hela den kostnaden.
 * Därför tre saker:
 *
 *   - `warm()` fyller cachen vid uppstart, innan någon hunnit fråga.
 *   - Utgången men användbar data serveras direkt medan uppdateringen sker i
 *     bakgrunden. Evenemangslistor ändras inte minut för minut, så några minuters
 *     ålder är ett bättre svar än flera sekunders väntan.
 *   - Riktigt gammal data väntar däremot in en riktig hämtning, och misslyckas den
 *     serveras det sparade märkt med varför.
 */

const TIO_MINUTER = 10 * 60_000;
const EN_TIMME = 60 * 60_000;

export function createCache(
  loader,
  { ttlMs = TIO_MINUTER, maxStaleMs = EN_TIMME, clock = Date.now } = {},
) {
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

  function snapshot(stored, { stale = false, staleReason } = {}) {
    return {
      ...stored.value,
      cacheAgeMs: clock() - stored.storedAt,
      stale,
      ...(staleReason ? { staleReason } : {}),
    };
  }

  return {
    /** Fyller cachen i förväg. Misslyckas den får nästa besökare försöka igen. */
    async warm() {
      try {
        await refresh();
      } catch {
        // Servern ska starta även om alla källor ligger nere.
      }
    },

    async get() {
      const age = entry ? clock() - entry.storedAt : Infinity;

      if (age < ttlMs) return snapshot(entry);

      if (age < maxStaleMs) {
        // Svara med det vi har och uppdatera under tiden. Ett fel här syns vid
        // nästa anrop, när datan hunnit bli för gammal för att serveras rakt av.
        refresh().catch(() => {});
        return snapshot(entry);
      }

      try {
        return snapshot(await refresh());
      } catch (error) {
        if (!entry) throw error;
        return snapshot(entry, { stale: true, staleReason: error.message });
      }
    },

    clear() {
      entry = null;
    },
  };
}
