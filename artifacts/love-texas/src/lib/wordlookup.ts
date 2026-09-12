import { getLemma } from '@/lib/lemma';

/**
 * Word lookup — fast primary translation + richer dictionary variants.
 * The visible word may be inflected ("leans"), while dictionary variants are
 * requested for its lemma ("lean").
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
  lemma?: string;
  lemmaTranslation?: string;
  learningWord?: string;
  learningTranslations?: string[];
  preferredPos?: string;
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
  const key = String(en || '').toLowerCase().trim();
  return POS_RU[key] ?? (key || 'варианты');
}

const CACHE_PREFIX = 'ltx15-word-'

function readCache(key: string): WordInfo | null {
  try {
    const raw = sessionStorage.getItem(CACHE_PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCache(key: string, value: WordInfo) {
  try {
    sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value));
  } catch {}
}

function uniqueRussian(words: string[]): string[] {
  const seen = new Set<string>();
  return words
    .map(w => String(w || '').trim())
    .filter(w => w.length > 1 && /[а-яё]/i.test(w))
    .filter(w => {
      const key = w.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 12);
}

function mergeGroups(...sets: RuGroup[][]): RuGroup[] {
  const map = new Map<string, string[]>();

  for (const groups of sets) {
    for (const group of groups || []) {
      if (!group?.words?.length) continue;
      const pos = group.pos || 'варианты';
      map.set(pos, uniqueRussian([...(map.get(pos) ?? []), ...group.words]));
    }
  }

  return [...map.entries()]
    .map(([pos, words]) => ({ pos, words }))
    .filter(group => group.words.length > 0);
}


async function googleSimpleTranslation(query: string): Promise<string> {
  try {
    const params = new URLSearchParams();
    params.set('client', 'gtx');
    params.set('sl', 'en');
    params.set('tl', 'ru');
    params.append('dt', 't');
    params.set('q', query);

    const res = await fetch(
      `https://translate.googleapis.com/translate_a/single?${params.toString()}`,
      { signal: AbortSignal.timeout(2500) },
    );
    if (!res.ok) return '';

    const json = await res.json();
    return (Array.isArray(json?.[0]) ? json[0] : [])
      .map((s: any[]) => typeof s?.[0] === 'string' ? s[0] : '')
      .join('')
      .trim();
  } catch {
    return '';
  }
}

async function googleLookup(query: string): Promise<WordInfo | null> {
  try {
    const params = new URLSearchParams();
    params.set('client', 'gtx');
    params.set('sl', 'en');
    params.set('tl', 'ru');
    params.append('dt', 't');
    params.append('dt', 'bd');
    params.append('dt', 'rm');
    params.set('q', query);

    const res = await fetch(
      `https://translate.googleapis.com/translate_a/single?${params.toString()}`,
      { signal: AbortSignal.timeout(3200) },
    );
    if (!res.ok) return null;

    const json = await res.json();
    const translation = (Array.isArray(json?.[0]) ? json[0] : [])
      .map((s: any[]) => typeof s?.[0] === 'string' ? s[0] : '')
      .join('')
      .trim();

    if (!translation) return null;

    const groups: RuGroup[] = [];
    const rawGroups: any[] = Array.isArray(json?.[1]) ? json[1] : [];

    for (const entry of rawGroups) {
      if (!Array.isArray(entry)) continue;

      const pos = posRu(typeof entry[0] === 'string' ? entry[0] : '');
      const items: any[] = Array.isArray(entry[1]) ? entry[1] : [];
      const words: string[] = [];

      for (const item of items) {
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

      const clean = uniqueRussian(words);
      if (clean.length) groups.push({ pos, words: clean });
    }

    return { word: query, translation, groups };
  } catch {
    return null;
  }
}

const LINGVA_MIRRORS = [
  'https://lingva.ml',
  'https://translate.plausibility.cloud',
];

async function lingvaLookup(query: string): Promise<WordInfo | null> {
  for (const mirror of LINGVA_MIRRORS) {
    try {
      const res = await fetch(
        `${mirror}/api/v1/en/ru/${encodeURIComponent(query)}`,
        { signal: AbortSignal.timeout(2200) },
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

      for (const group of rawGroups) {
        const pos = posRu(group?.type);
        const list: any[] = Array.isArray(group?.list) ? group.list : [];
        const words = uniqueRussian(
          list.map(item =>
            typeof item === 'string'
              ? item
              : typeof item?.word === 'string'
                ? item.word
                : '',
          ),
        );
        if (words.length) groups.push({ pos, words });
      }

      return { word: query, phonetic, translation, groups };
    } catch {
      // try next mirror
    }
  }

  return null;
}

interface MyMemoryResult {
  translation: string;
}

async function myMemoryLookup(query: string): Promise<MyMemoryResult | null> {
  try {
    const res = await fetch(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(query)}&langpair=en|ru`,
      { signal: AbortSignal.timeout(3200) },
    );
    if (!res.ok) return null;

    const json = await res.json();
    if (json?.responseStatus !== 200) return null;

    const main = String(json?.responseData?.translatedText ?? '').trim();
    if (!main || !/[а-яё]/i.test(main)) return null;

    // MyMemory is used only as a last-resort PRIMARY translation.
    // Its `matches` field often contains unrelated machine-memory fragments,
    // so it must never be shown as dictionary alternatives.
    return {
      translation: main,
    };
  } catch {
    return null;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>(resolve => setTimeout(() => resolve(null), ms)),
  ]);
}


const COMMON_CONTEXTUAL_VERBS: Record<string, string> = {};


function findPreferredGroup(groups: RuGroup[], preferredPos?: string): RuGroup | undefined {
  if (!preferredPos) return undefined;
  const wanted = preferredPos.toLowerCase();

  return groups.find(group => {
    const pos = group.pos.toLowerCase();
    if (wanted === 'verb') return pos === 'глагол' || pos === 'verb';
    if (wanted === 'noun') return pos === 'существительное' || pos === 'noun';
    if (wanted === 'adjective') return pos === 'прилагательное' || pos === 'adjective';
    if (wanted === 'adverb') return pos === 'наречие' || pos === 'adverb';
    return pos === wanted;
  });
}


function deriveConfidentLemma(
  surface: string,
  preferredPos?: string,
): string | undefined {
  const word = surface.toLowerCase().replace(/[^a-z'-]/g, '');
  if (!word) return undefined;

  const known = getLemma(word);
  if (known && known !== word) return known;

  const nonInflecting = new Set([
    'something', 'nothing', 'anything', 'everything',
    'morning', 'evening', 'during', 'ceiling',
    'darling', 'sterling', 'spring', 'king', 'thing',
  ]);
  if (nonInflecting.has(word)) return undefined;

  const exact: Record<string, string> = {
    escaping: 'escape',
    hurtling: 'hurtle',
    sitting: 'sit',
    shining: 'shine',
    shines: 'shine',
    hurried: 'hurry',
    hurrying: 'hurry',
    trying: 'try',
    tried: 'try',
    lying: 'lie',
    dying: 'die',
    tying: 'tie',
    begins: 'begin',
    beginning: 'begin',
    murmurs: 'murmur',
    standing: 'stand',
    stands: 'stand',
    staring: 'stare',
    looking: 'look',
    breaking: 'break',
    pulled: 'pull',
    pulling: 'pull',
    replaced: 'replace',
    stained: 'stain',
    doused: 'douse',
    leaves: 'leave',
    says: 'say',
    means: 'mean',
    seeps: 'seep',
    slurs: 'slur',
  };
  if (exact[word]) return exact[word];

  if (preferredPos === 'verb') {
    if (word.endsWith('ied') && word.length > 4) {
      return `${word.slice(0, -3)}y`;
    }

    if (word.endsWith('ed') && word.length > 4) {
      let stem = word.slice(0, -2);

      if (/(ll|ss|ff|zz)$/.test(stem)) return stem;
      if (/(.)\1$/.test(stem)) return stem.slice(0, -1);

      if (/(mov|lov|us|clos|chang|arriv|replac|dous|escap|notic|forc|plac|fac|rac|danc|glanc|invit|creat)$/.test(stem)) {
        return `${stem}e`;
      }

      return stem;
    }

    if (word.endsWith('ing') && word.length > 5) {
      let stem = word.slice(0, -3);

      if (/(.)\1$/.test(stem) && !/(ll|ss|ff|zz)$/.test(stem)) {
        return stem.slice(0, -1);
      }

      if (/(mak|tak|giv|hav|mov|leav|writ|us|clos|chang|arriv|escap|hurtl|handl|sett|trembl|stifl|bundl|dazzl|wrestl|crumbl|stumbl|tackl|tickl|whistl|shuffl|snuffl|muffl|rattl|startl|struggl|smuggl|jostl|nibbl|scribbl|dribbl|babbl|wobbl|chuckl|cackl|fiddl|doodl|paddl|pedl|notic|forc|plac|fac|rac|danc|glanc|advanc|invit|creat|operat|translat|celebrat|separat|generat|indicat|demonstrat|investigat|communicat|concentrat|hesitat|participat|appreciat|associat|negotiat|graduat|evaluat|situat|continu|pursu|argu|valu|issu|rescu)$/.test(stem)) {
        return `${stem}e`;
      }

      return stem;
    }

    if (word.endsWith('ies') && word.length > 4) {
      return `${word.slice(0, -3)}y`;
    }

    if (word.endsWith('es') && /(ches|shes|sses|xes|zes|oes)$/.test(word)) {
      return word.slice(0, -2);
    }

    if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3) {
      return word.slice(0, -1);
    }
  }

  if (preferredPos === 'noun') {
    if (word.endsWith('ies') && word.length > 4) {
      return `${word.slice(0, -3)}y`;
    }

    if (word.endsWith('es') && /(ches|shes|sses|xes|zes)$/.test(word)) {
      return word.slice(0, -2);
    }

    if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3) {
      return word.slice(0, -1);
    }
  }

  return undefined;
}

export async function lookupWord(surfaceWord: string, preferredPos?: string): Promise<WordInfo> {
  const surface = surfaceWord.toLowerCase().trim();
  const normalizedPreferredPos = preferredPos?.toLowerCase().trim() || '';
  const lemma = deriveConfidentLemma(surface, normalizedPreferredPos) || surface;
  const hasConfidentLemma = lemma !== surface;
  const cacheKey = `${surface}|${hasConfidentLemma ? lemma : ''}|${normalizedPreferredPos}`;

  const empty: WordInfo = { word: surface, translation: '', groups: [] };
  if (!surface || surface.length < 2) return empty;

  const cached = readCache(cacheKey);
  if (cached?.translation) return cached;

  // Surface translation is useful for forms like "leans" -> "наклоняется".
  // Lemma lookup is useful for dictionary meanings/parts of speech.
  const surfaceGooglePromise = googleLookup(surface);
  const lemmaGooglePromise =
    lemma === surface ? surfaceGooglePromise : googleLookup(lemma);
  const lingvaPromise = lingvaLookup(lemma);
  const memoryPromise = myMemoryLookup(lemma);

  // Ask Google for a form that naturally produces a Russian dictionary form.
  // "to stand" -> "стоять", "to murmur" -> "бормотать",
  // "to replace" -> "заменить/заменять".
  const baseFormQuery =
    normalizedPreferredPos === 'verb'
      ? `to ${lemma}`
      : (hasConfidentLemma ? lemma : '');

  const baseFormTranslationPromise =
    baseFormQuery
      ? googleSimpleTranslation(baseFormQuery)
      : Promise.resolve('');

  const surfaceGoogle = await withTimeout(surfaceGooglePromise, 1800);
  const lemmaGoogle = await withTimeout(lemmaGooglePromise, 1800);

  let phonetic = surfaceGoogle?.phonetic || lemmaGoogle?.phonetic;
  let groups = mergeGroups(
    surfaceGoogle?.groups ?? [],
    lemmaGoogle?.groups ?? [],
  );

  // Give richer dictionary sources only a short enrichment window.
  const [lingva, memory, baseFormTranslation] = await Promise.all([
    withTimeout(lingvaPromise, groups.length ? 250 : 850),
    withTimeout(memoryPromise, groups.length ? 250 : 850),
    withTimeout(baseFormTranslationPromise, 1200),
  ]);

  phonetic = phonetic || lingva?.phonetic;
  groups = mergeGroups(groups, lingva?.groups ?? []);

  const preferredGroup = findPreferredGroup(groups, normalizedPreferredPos);

  // Main rule: what the learner sees and saves should already be a dictionary
  // form in Russian. For verbs the explicit "to + lemma" query forces an
  // infinitive. If that service fails, dictionary-group variants are already
  // infinitives and are the next-best choice.
  const dictionaryTranslation =
    baseFormTranslation ||
    preferredGroup?.words?.[0] ||
    lemmaGoogle?.translation ||
    lingva?.translation ||
    memory?.translation ||
    surfaceGoogle?.translation ||
    '';

  const learningWord = hasConfidentLemma ? lemma : surface;
  const learningTranslations = uniqueRussian([
    dictionaryTranslation,
    ...(preferredGroup?.words ?? []),
  ]).slice(0, 8);

  const result: WordInfo = {
    word: surface,
    translation: dictionaryTranslation,
    phonetic,
    groups,
    lemma: hasConfidentLemma ? lemma : undefined,
    lemmaTranslation: dictionaryTranslation || undefined,
    learningWord,
    learningTranslations,
    preferredPos: normalizedPreferredPos || undefined,
  };

  if (result.translation) writeCache(cacheKey, result);
  return result;
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
        { signal: AbortSignal.timeout(2800) },
      );
      if (!res.ok) return '';

      const json = await res.json();
      return String(json?.translation ?? '').trim();
    } catch {
      return '';
    }
  })();

  return new Promise<string>((resolve, reject) => {
    let remaining = 2;

    for (const promise of [google, lingva]) {
      promise
        .then(value => {
          if (value) {
            resolve(value);
          } else if (--remaining === 0) {
            reject(new Error('no result'));
          }
        })
        .catch(() => {
          if (--remaining === 0) reject(new Error('no result'));
        });
    }
  });
}
