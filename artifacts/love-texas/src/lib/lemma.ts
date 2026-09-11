const KNOWN_LEMMAS: Record<string, string> = {
  talking: 'talk',
  talked: 'talk',
  pinpricks: 'pinprick',
  books: 'book',
  children: 'child',
  went: 'go',
  gone: 'go',
  written: 'write',
  keeping: 'keep',
  whispering: 'whisper',
  running: 'run',
  making: 'make',
  made: 'make',
  taken: 'take',
  taking: 'take',
  seen: 'see',
  seeing: 'see',
  spoken: 'speak',
  speaking: 'speak',
};

const PROTECTED_WORDS = new Set([
  'this', 'is', 'was', 'has', 'news', 'series', 'species', 'business',
  'thing', 'things', 'string', 'spring', 'morning', 'king', 'sing',
]);

function fromKnownSuffix(word: string): string | undefined {
  if (PROTECTED_WORDS.has(word)) return undefined;

  if (word.endsWith('ing') && word.length > 6) {
    const stem = word.slice(0, -3);
    if (stem.length >= 3 && /(.)\1$/.test(stem)) return stem.slice(0, -1);
  }

  if (word.endsWith('s') && word.length > 5 && !word.endsWith('ss')) {
    const singular = word.slice(0, -1);
    if (singular.length >= 4) return singular;
  }

  return undefined;
}

/**
 * Conservative local metadata only. Unknown or ambiguous forms stay unchanged.
 * This function never participates in translation requests.
 */
export function getLemma(word: string): string {
  const normalized = word.toLowerCase().replace(/[^a-z'-]/g, '');
  if (!normalized) return word;
  return KNOWN_LEMMAS[normalized] || fromKnownSuffix(normalized) || normalized;
}