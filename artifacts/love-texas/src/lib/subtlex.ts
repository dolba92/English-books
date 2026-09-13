/**
 * SUBTLEX-US frequency loader.
 * Original norms: Brysbaert & New (2009), ~51M subtitle tokens.
 * Loaded lazily; browser cache is used. The app still works if unavailable.
 */
export type SubtlexFrequencyMap = Map<string, number>;

const SUBTLEX_URL =
  'https://cdn.jsdelivr.net/npm/subtlex-word-frequencies@2.0.0/index.json';

let cached: SubtlexFrequencyMap | null = null;
let pending: Promise<SubtlexFrequencyMap | null> | null = null;

export async function loadSubtlex(): Promise<SubtlexFrequencyMap | null> {
  if (cached) return cached;
  if (pending) return pending;

  pending = (async () => {
    try {
      const response = await fetch(SUBTLEX_URL, { cache: 'force-cache' });
      if (!response.ok) return null;

      const rows = (await response.json()) as Array<{ word: string; count: number }>;
      const map = new Map<string, number>();

      for (const row of rows) {
        const word = row.word.toLowerCase();
        const previous = map.get(word) || 0;
        if (row.count > previous) map.set(word, row.count);
      }

      cached = map;
      return map;
    } catch {
      return null;
    }
  })();

  return pending;
}
