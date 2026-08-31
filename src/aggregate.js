/**
 * Slår ihop alla källor till en lista.
 *
 * Använder medvetet Promise.allSettled och aldrig Promise.all: att Slakthusen ligger
 * nere ska inte dölja att det är match på 3Arena. Varje källas utfall rapporteras
 * separat så att gränssnittet kan visa vad som faktiskt hämtades — annars går det
 * inte att skilja "lugn kväll" från "skrapan är trasig".
 */

import { createSources as createArenaSources } from './sources/stockholmlive.js';
import { createSource as createSlakthusenSource } from './sources/slakthusen.js';

export function defaultSources() {
  return [...createArenaSources(), createSlakthusenSource()];
}

export async function collectEvents({ now = Date.now(), sources = defaultSources() } = {}) {
  const settled = await Promise.allSettled(sources.map((source) => source.fetch({ now })));

  const events = [];
  const health = [];

  for (const [index, result] of settled.entries()) {
    const source = sources[index];

    if (result.status === 'fulfilled') {
      events.push(...result.value);
      health.push({
        id: source.id,
        label: source.label,
        ok: true,
        count: result.value.length,
        error: null,
      });
    } else {
      health.push({
        id: source.id,
        label: source.label,
        ok: false,
        count: 0,
        error: result.reason?.message ?? String(result.reason),
      });
    }
  }

  return { fetchedAt: now, events, sources: health };
}
