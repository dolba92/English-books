/**
 * Fast word lookup with richer Russian dictionary variants.
 * Google and Lingva start together. We show whichever useful result arrives first,
 * but give the second source a very short chance to enrich missing POS/variants.
 */

export interface RuGroup {
  pos: string;
  words: string[];
}

export interface WordInfo {
  word: string;
  phonetic?: string;
  translation: string;
  groups: RuGroup[];
}

const POS_RU: Record<string, string> = {
  noun: 'существительное',
  verb: 'глагол',
  adjective: 'прилагательное',
  adverb: 'наречие',
  pronoun: 'местоимение',
  preposition: 'предлог',
  conjunction: 'союз',
  interjection: 'междометие',
  numeral: 'числительное',
  particle: 'частица',
};

function posRu(en: string): string {
  return POS_RU[String(en || '').toLowerCase()] ?? String(en || '');
}

// New prefix deliberately ignores older cached one-translation-only cards.
const CACHE_PREFIX = 'ltx6-word-';

function readCache(key: string): WordInfo | null {
  try {
    const raw = sessionStorage.getItem(CACHE_PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCache(key: string, val: WordInfo) {
  try {
    sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify(val));
  } catch {}
}

function uniqueWords(words: string[]): string[] {
  const seen = new Set<string>();
  return words
    .map(w => String(w || '').trim())
    .filter(Boolean)
    .filter(w => {
      const k = w.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 12);
}

function mergeGroups(a: RuGroup[] = [], b: RuGroup[] = []): RuGroup[] {
  const map = new Map<string, string[]>();

  for (const group of [...a, ...b]) {
    if (!group?.words?.length) continue;
    const pos = group.pos || 'варианты';
    const current = map.get(pos) ?? [];
    map.set(pos, uniqueWords([...current, ...group.words]));
  }

  return [...map.entries()]
    .map(([pos, words]) => ({ pos, words }))
    .filter(group => group.words.length > 0);
}

function mergeInfo(primary: WordInfo, secondary?: WordInfo | null): WordInfo {
  if (!secondary) return primary;
  return {
    word: primary.word,
    translation: primary.translation || secondary.translation,
    phonetic: primary.phonetic || secondary.phonetic,
    groups: mergeGroups(primary.groups, secondary.groups),
  };
}

async function fromGoogleGtx(word: string): Promise<WordInfo | null> {
  try {
    const params = new URLSearchParams();
    params.set('client', 'gtx');
    params.set('sl', 'en');
    params.set('tl', 'ru');
    params.append('dt', 't');
    params.append('dt', 'bd');
    params.append('dt', 'rm');
    params.set('q', word);

    const res = await fetch(
      `https://translate.googleapis.com/translate_a/single?${params.toString()}`,
      { signal: AbortSignal.timeout(3000) },
    );
    if (!res.ok) return null;

    const json = await res.json();
    const segments: any[] = Array.isArray(json?.[0]) ? json[0] : [];
    const translation = segments
      .map((segment: any[]) => typeof segment?.[0] === 'string' ? segment[0] : '')
      .join('')
      .trim();

    if (!translation) return null;

    const groups: RuGroup[] = [];
    const rawGroups: any[] = Array.isArray(json?.[1]) ? json[1] : [];

    for (const entry of rawGroups) {
      if (!Array.isArray(entry)) continue;

      // Most gtx responses: ["verb", ["чувствовать", ...], ...]
      let rawPos: any = entry[0];
      let rawItems: any = entry[1];

      // Some Google response shapes nest the POS label.
      if (Array.isArray(rawPos)) rawPos = rawPos[0];

      const pos = posRu(typeof rawPos === 'string' ? rawPos : 'варианты');
      const words: string[] = [];

      if (Array.isArray(rawItems)) {
        for (const item of rawItems) {
          if (typeof item === 'string') {
            words.push(item);
          } else if (Array.isArray(item)) {
            if (typeof item[0] === 'string') words.push(item[0]);
            if (Array.isArray(item[1])) {
              for (const nested of item[1]) {
                if (typeof nested === 'string') words.push(nested);
              }
            }
          } else if (item && typeof item.word === 'string') {
            words.push(item.word);
          }
        }
      }

      const clean = uniqueWords(words).filter(w => /[а-яё]/i.test(w));
      if (clean.length) groups.push({ pos, words: clean });
    }

    return {
      word,
      translation,
      groups: mergeGroups(groups),
    };
  } catch {
    return null;
  }
}

const LINGVA_MIRRORS = [
  'https://lingva.ml',
  'https://translate.plausibility.cloud',
];

async function fromLingva(word: string): Promise<WordInfo | null> {
  for (const mirror of LINGVA_MIRRORS) {
    try {
      const res = await fetch(
        `${mirror}/api/v1/en/ru/${encodeURIComponent(word)}`,
        { signal: AbortSignal.timeout(1800) },
      );
      if (!res.ok) continue;

      const json = await res.json();
      const translation = String(json?.translation ?? '').trim();
      if (!translation) continue;

      const phonetic =
        typeof json?.info?.pronunciation?.query === 'string'
          ? json.info.pronunciation.query
          : undefined;

      const groups: RuGroup[] = [];
      const rawGroups: any[] = Array.isArray(json?.info?.translations)
        ? json.info.translations
        : [];

      for (const g of rawGroups) {
        const pos = posRu(g?.type ?? 'варианты');
        const list: any[] = Array.isArray(g?.list) ? g.list : [];
        const words = uniqueWords(
          list.map(item =>
            typeof item === 'string'
              ? item
              : typeof item?.word === 'string'
                ? item.word
                : '',
          ),
        ).filter(w => /[а-яё]/i.test(w));

        if (words.length) groups.push({ pos, words });
      }

      return {
        word,
        phonetic,
        translation,
        groups: mergeGroups(groups),
      };
    } catch {
      // try next mirror
    }
  }
  return null;
}

function isGarbage(s: string): boolean {
  if (!s) return true;
  if (/https?:\/\//.test(s)) return true;
  if (/^[a-z]{2,}\.[a-z]{2,}/i.test(s) && !/[а-яё]/i.test(s)) return true;
  if (s.length > 120) return true;
  return false;
}

async function fromMyMemory(word: string): Promise<WordInfo | null> {
  try {
    const res = await fetch(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(word)}&langpair=en|ru`,
      { signal: AbortSignal.timeout(4500) },
    );
    if (!res.ok) return null;

    const json = await res.json();
    if (json?.responseStatus !== 200) return null;

    const raw = String(json?.responseData?.translatedText ?? '').trim();
    if (isGarbage(raw) || raw.toLowerCase().includes('mymemory warning')) return null;

    return { word, translation: raw, groups: [] };
  } catch {
    return null;
  }
}

function waitFor<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise.then(value => value),
    new Promise<null>(resolve => setTimeout(() => resolve(null), ms)),
  ]);
}

async function firstUseful(
  promises: Promise<WordInfo | null>[],
): Promise<{ result: WordInfo | null; index: number }> {
  return new Promise(resolve => {
    let remaining = promises.length;
    let settled = false;

    promises.forEach((promise, index) => {
      promise
        .then(result => {
          if (settled) return;
          if (result?.translation) {
            settled = true;
            resolve({ result, index });
            return;
          }
          remaining -= 1;
          if (remaining === 0) resolve({ result: null, index: -1 });
        })
        .catch(() => {
          if (settled) return;
          remaining -= 1;
          if (remaining === 0) resolve({ result: null, index: -1 });
        });
    });
  });
}

export async function lookupWord(word: string): Promise<WordInfo> {
  const key = word.toLowerCase().trim();
  const empty: WordInfo = { word: key, translation: '', groups: [] };

  if (!key || key.length < 2) return empty;

  const cached = readCache(key);
  if (cached?.translation) return cached;

  // Start the two useful dictionary sources at the same time.
  const googlePromise = fromGoogleGtx(key);
  const lingvaPromise = fromLingva(key);
  const sources = [googlePromise, lingvaPromise];

  const { result: first, index } = await firstUseful(sources);

  if (first) {
    let final = first;

    // If the fastest source returned only one translation, give the other
    // source a SHORT chance to add POS buttons and alternative meanings.
    if (first.groups.length === 0) {
      const other = await waitFor(sources[index === 0 ? 1 : 0], 700);
      if (other) final = mergeInfo(first, other);
    }

    writeCache(key, final);
    return final;
  }

  const fallback = (await fromMyMemory(key)) ?? empty;
  if (fallback.translation) writeCache(key, fallback);
  return fallback;
}

/** Translate a full sentence to Russian */
export async function translateSentence(text: string): Promise<string> {
  const google = (async () => {
    try {
      const params = new URLSearchParams();
      params.set('client', 'gtx');
      params.set('sl', 'en');
      params.set('tl', 'ru');
      params.append('dt', 't');
      params.set('q', text);

      const res = await fetch(
        `https://translate.googleapis.com/translate_a/single?${params.toString()}`,
        { signal: AbortSignal.timeout(3500) },
      );
      if (!res.ok) return '';
      const json = await res.json();
      return (json?.[0] ?? [])
        .map((s: any[]) => s?.[0] ?? '')
        .join('')
        .trim();
    } catch {
      return '';
    }
  })();

  const lingva = (async () => {
    try {
      const res = await fetch(
        `${LINGVA_MIRRORS[0]}/api/v1/en/ru/${encodeURIComponent(text)}`,
        { signal: AbortSignal.timeout(3000) },
      );
      if (!res.ok) return '';
      const json = await res.json();
      return String(json?.translation ?? '').trim();
    } catch {
      return '';
    }
  })();

  const first = await new Promise<string>(resolve => {
    let remaining = 2;
    for (const p of [google, lingva]) {
      p.then(value => {
        if (value) resolve(value);
        else if (--remaining === 0) resolve('');
      }).catch(() => {
        if (--remaining === 0) resolve('');
      });
    }
  });

  if (first) return first;

  const res = await fetch(
    `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|ru`,
    { signal: AbortSignal.timeout(6000) },
  );
  if (!res.ok) throw new Error('translate failed');

  const json = await res.json();
  const raw = String(json?.responseData?.translatedText ?? '').trim();
  if (!raw || json?.responseStatus !== 200 || raw.toLowerCase().includes('mymemory warning')) {
    throw new Error('no result');
  }
  return raw;
}
