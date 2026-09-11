const KNOWN_LEMMAS: Record<string, string> = {
  talking: 'talk',
  talked: 'talk',
  faces: 'face',
  dressed: 'dress',
  heard: 'hear',
  hummed: 'hum',
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
  are: 'be',
  am: 'be',
  is: 'be',
  was: 'be',
  were: 'be',
  being: 'be',
  been: 'be',
  had: 'have',
  has: 'have',
  did: 'do',
  does: 'do',
  doing: 'do',
  saw: 'see',
  said: 'say',
  thought: 'think',
  brought: 'bring',
  bought: 'buy',
  caught: 'catch',
  taught: 'teach',
  knew: 'know',
  told: 'tell',
  found: 'find',
  gave: 'give',
  got: 'get',
  took: 'take',
  came: 'come',
  ran: 'run',
  felt: 'feel',
  left: 'leave',
  read: 'read',
  wrote: 'write',
  began: 'begin',
  became: 'become',
  broke: 'break',
  built: 'build',
  chose: 'choose',
  drew: 'draw',
  drank: 'drink',
  drove: 'drive',
  ate: 'eat',
  fell: 'fall',
  flew: 'fly',
  forgot: 'forget',
  grew: 'grow',
  held: 'hold',
  kept: 'keep',
  lay: 'lie',
  led: 'lead',
  lost: 'lose',
  met: 'meet',
  paid: 'pay',
  rode: 'ride',
  rang: 'ring',
  rose: 'rise',
  sold: 'sell',
  sent: 'send',
  slept: 'sleep',
  spent: 'spend',
  stole: 'steal',
  swam: 'swim',
  threw: 'throw',
  woke: 'wake',
  wore: 'wear',
  won: 'win',
};

const PROTECTED_WORDS = new Set([
  'this', 'is', 'was', 'has', 'news', 'series', 'species', 'business',
  'thing', 'things', 'string', 'spring', 'morning', 'king', 'sing',
  'always', 'status',
]);

const COMMON_BASES = new Set([
  'answer', 'arrive', 'ask', 'call', 'carry', 'change', 'clean', 'close',
  'cook', 'dance', 'drop', 'enjoy', 'follow', 'help', 'hope', 'jump',
  'learn', 'like', 'live', 'look', 'love', 'move', 'open', 'play',
  'plan', 'rain', 'remember', 'return', 'smile', 'start', 'stop', 'study',
  'talk', 'use', 'wait', 'walk', 'want', 'watch', 'work', 'read',
  'lean', 'seem', 'stare', 'pick', 'leave', 'pull', 'retire', 'shake',
  'hold', 'breathe', 'stand', 'turn', 'murmur', 'slur', 'hang', 'threaten',
  'settle', 'freeze', 'bring', 'take', 'feel', 'find', 'keep', 'dress',
]);

function fromKnownSuffix(word: string): string | undefined {
  if (PROTECTED_WORDS.has(word)) return undefined;

  if (word.endsWith('ing') && word.length > 6) {
    const stem = word.slice(0, -3);
    if (stem.length >= 3 && /(.)\1$/.test(stem)) return stem.slice(0, -1);
    if (COMMON_BASES.has(stem)) return stem;
    if (COMMON_BASES.has(`${stem}e`)) return `${stem}e`;
  }

  if (word.endsWith('ies') && word.length > 5) {
    const candidate = `${word.slice(0, -3)}y`;
    if (COMMON_BASES.has(candidate)) return candidate;
  }

  if (/(ches|shes|xes|zes|sses)$/.test(word) && word.length > 5) {
    const candidate = word.slice(0, -2);
    if (candidate.length >= 3) return candidate;
  }

  if (word.endsWith('ed') && word.length > 5) {
    const stem = word.slice(0, -2);
    if (COMMON_BASES.has(stem)) return stem;
    if (/(.)\1$/.test(stem) && COMMON_BASES.has(stem.slice(0, -1))) {
      return stem.slice(0, -1);
    }
    if (COMMON_BASES.has(`${stem}e`)) return `${stem}e`;
  }

  if (word.endsWith('es') && word.length > 5) {
    const candidate = word.slice(0, -2);
    if (COMMON_BASES.has(candidate)) return candidate;
    const candidateWithE = word.slice(0, -1);
    if (COMMON_BASES.has(candidateWithE)) return candidateWithE;
  }

  if (word.endsWith('s') && word.length > 4 && !word.endsWith('ss')) {
    const singular = word.slice(0, -1);
    if (singular.length >= 3 && COMMON_BASES.has(singular)) return singular;
  }

  return undefined;
}

/**
 * Conservative local metadata only.
 * Known forms and high-confidence suffixes are normalized to a dictionary form.
 */
export function getLemma(word: string): string {
  const normalized = word.toLowerCase().replace(/[^a-z'-]/g, '');
  if (!normalized) return word;
  return KNOWN_LEMMAS[normalized] || fromKnownSuffix(normalized) || normalized;
}
