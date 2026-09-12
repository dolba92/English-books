import type { BookChapter } from './storage';
import { getEfllexProfile } from './efllex-profile-data';

export type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

export interface BookLevelAnalysis {
  level: CefrLevel;
  score: number;

  // New diagnostics: cumulative vocabulary coverage.
  coverageA1: number;
  coverageA2: number;
  coverageB1: number;
  coverageB2: number;
  coverageC1: number;
  unknownRatio: number;

  // Separate reading/syntax difficulty, Linga-style.
  readingDifficulty: 1 | 2 | 3 | 4 | 5;

  // Existing diagnostics kept so LibraryPage does not break.
  averageSentenceLength: number;
  averageWordLength: number;
  longWordRatio: number;
  advancedWordRatio: number;
  lexicalDiversity: number;
  sampledWords: number;
}

const IRREGULAR: Record<string, string> = {
  children: 'child',
  men: 'man',
  women: 'woman',
  feet: 'foot',
  teeth: 'tooth',
  mice: 'mouse',
  went: 'go',
  gone: 'go',
  came: 'come',
  saw: 'see',
  seen: 'see',
  knew: 'know',
  known: 'know',
  thought: 'think',
  brought: 'bring',
  bought: 'buy',
  caught: 'catch',
  taught: 'teach',
  heard: 'hear',
  felt: 'feel',
  left: 'leave',
  kept: 'keep',
  slept: 'sleep',
  stood: 'stand',
  understood: 'understand',
  wrote: 'write',
  written: 'write',
  spoke: 'speak',
  spoken: 'speak',
  took: 'take',
  taken: 'take',
  gave: 'give',
  given: 'give',
  made: 'make',
  ran: 'run',
};

function cleanWord(word: string): string {
  return word
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/^[^a-z]+|[^a-z]+$/g, '');
}

function hasProfile(word: string): boolean {
  return !!getEfllexProfile(word);
}

function lemma(word: string): string {
  if (IRREGULAR[word]) return IRREGULAR[word];
  if (hasProfile(word)) return word;

  const candidates: string[] = [];

  if (word.endsWith('ies') && word.length > 4) {
    candidates.push(word.slice(0, -3) + 'y');
  }

  if (word.endsWith('ied') && word.length > 4) {
    candidates.push(word.slice(0, -3) + 'y');
  }

  if (word.endsWith('ing') && word.length > 5) {
    const stem = word.slice(0, -3);
    candidates.push(stem, stem + 'e');
    if (/(.)\1$/.test(stem)) candidates.push(stem.slice(0, -1));
  }

  if (word.endsWith('ed') && word.length > 4) {
    const stem = word.slice(0, -2);
    candidates.push(stem, stem + 'e');
    if (/(.)\1$/.test(stem)) candidates.push(stem.slice(0, -1));
  }

  if (word.endsWith('es') && word.length > 4) {
    candidates.push(word.slice(0, -2), word.slice(0, -1));
  }

  if (word.endsWith('s') && word.length > 3) {
    candidates.push(word.slice(0, -1));
  }

  return candidates.find(hasProfile) || word;
}

function sampleBook(chapters: BookChapter[], targetWords = 22000): string {
  const paragraphs = chapters
    .flatMap(chapter => chapter.paragraphs || [])
    .map(text => text.replace(/\s+/g, ' ').trim())
    .filter(text => text.length >= 40);

  if (!paragraphs.length) return '';

  const sampleCount = Math.min(paragraphs.length, 380);
  const step = paragraphs.length / sampleCount;
  const picked: string[] = [];

  for (let i = 0; i < sampleCount; i++) {
    picked.push(
      paragraphs[Math.min(paragraphs.length - 1, Math.floor(i * step))]
    );
  }

  return picked.join(' ').split(/\s+/).slice(0, targetWords).join(' ');
}

function splitSentences(text: string): string[] {
  return text
    .replace(/([.!?])["”’)]/g, '$1 ')
    .split(/[.!?]+(?:\s+|$)/)
    .map(sentence => sentence.trim())
    .filter(sentence => sentence.length > 8);
}

/**
 * EFLLex gives a frequency profile across A1, A2, B1, B2, C1.
 * We convert that profile to an "entry tier":
 * the first level where the word has reached a meaningful share
 * of its strongest textbook frequency.
 *
 * This avoids forcing every word into the level where its raw
 * frequency happens to peak.
 */
function tierFromProfile(profile: readonly number[]): number {
  const max = Math.max(...profile);
  if (max <= 0) return 5;

  const total = profile.reduce((a, b) => a + b, 0);
  const meaningful = Math.max(0.8, max * 0.22);

  for (let i = 0; i < profile.length; i++) {
    const value = profile[i];
    const cumulative = profile.slice(0, i + 1).reduce((a, b) => a + b, 0);

    if (value >= meaningful || cumulative >= total * 0.38) {
      return i + 1;
    }
  }

  return 5;
}

function syntaxDifficulty(sentences: string[]): 1 | 2 | 3 | 4 | 5 {
  if (!sentences.length) return 1;

  let totalWords = 0;
  let totalComplexity = 0;

  const subordinate =
    /\b(although|though|whereas|while|unless|despite|whilst|whenever|wherever|however|which|whose|whom|whether|because|since|after|before|until|once|if|when)\b/gi;

  for (const sentence of sentences) {
    const words = sentence.match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g) || [];
    totalWords += words.length;

    const clauses = (sentence.match(subordinate) || []).length;
    const punctuation = (sentence.match(/[,;:—–]/g) || []).length;

    totalComplexity += clauses + Math.min(3, punctuation * 0.28);
  }

  const avgWords = totalWords / sentences.length;
  const avgComplexity = totalComplexity / sentences.length;

  const raw =
    (avgWords - 8) * 0.11 +
    avgComplexity * 0.9;

  if (raw < 1.4) return 1;
  if (raw < 2.2) return 2;
  if (raw < 3.1) return 3;
  if (raw < 4.2) return 4;
  return 5;
}

/**
 * We deliberately cap the influence of repeated words.
 * A word appearing 300 times should matter more than a hapax,
 * but not 300 times more. This keeps the metric closer to
 * "vocabulary needed for the book" instead of plain token frequency.
 */
function lemmaWeight(count: number): number {
  return Math.min(4, Math.sqrt(count));
}

function chooseLevel(params: {
  a1: number;
  a2: number;
  b1: number;
  b2: number;
  unknownRatio: number;
  averageSentenceLength: number;
  longWordRatio: number;
}): CefrLevel {
  const {
    a1,
    a2,
    b1,
    b2,
    unknownRatio,
    averageSentenceLength,
    longWordRatio,
  } = params;

  const longPct = longWordRatio * 100;

  // Very easy books: overwhelmingly basic vocabulary + short syntax.
  if (
    a1 >= 62 &&
    a2 >= 80 &&
    b1 >= 91 &&
    unknownRatio <= 12 &&
    averageSentenceLength <= 9.5
  ) {
    return 'A1';
  }

  if (
    a2 >= 70 &&
    b1 >= 85 &&
    b2 >= 95 &&
    unknownRatio <= 17 &&
    averageSentenceLength <= 11.0 &&
    longPct <= 3.5
  ) {
    return 'A2';
  }

  /*
   * B1 is the normal "accessible modern fiction" band.
   *
   * Important calibration from our real books:
   * - Percy Jackson should remain easier than Harry Potter.
   * - fantasy/proper-name noise must not automatically become C1.
   * - sentence length and long-word density are used as tie-breakers.
   */
  const looksB1 =
    b1 >= 76 &&
    b2 >= 90 &&
    unknownRatio < 22 &&
    longPct < 5.2 &&
    averageSentenceLength < 13.5;

  if (looksB1) {
    return 'B1';
  }

  // B2: richer vocabulary, more unknown literary/fantasy vocabulary,
  // or noticeably denser sentence/word structure.
  const looksB2 =
    b1 >= 70 &&
    b2 >= 86 &&
    unknownRatio < 29 &&
    averageSentenceLength < 17.5 &&
    longPct < 8.5;

  if (looksB2) {
    return 'B2';
  }

  // C1 requires several genuinely difficult signals at once.
  const looksC1 =
    b1 >= 60 &&
    b2 >= 78 &&
    unknownRatio < 38 &&
    averageSentenceLength < 23;

  if (looksC1) {
    return 'C1';
  }

  return 'C2';
}

export function analyzeBookLevel(
  chapters: BookChapter[]
): BookLevelAnalysis {
  const text = sampleBook(chapters);

  const rawWords =
    text.match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g) || [];

  const words = rawWords.map(cleanWord).filter(Boolean);

  if (words.length < 120) {
    return {
      level: 'A2',
      score: 0,
      coverageA1: 0,
      coverageA2: 0,
      coverageB1: 0,
      coverageB2: 0,
      coverageC1: 0,
      unknownRatio: 0,
      readingDifficulty: 1,
      averageSentenceLength: 0,
      averageWordLength: 0,
      longWordRatio: 0,
      advancedWordRatio: 0,
      lexicalDiversity: 0,
      sampledWords: words.length,
    };
  }

  const sentences = splitSentences(text);
  const lemmas = words.map(lemma);

  const counts = new Map<string, number>();
  for (const item of lemmas) {
    if (item.length < 2) continue;
    counts.set(item, (counts.get(item) || 0) + 1);
  }

  const tierWeights = [0, 0, 0, 0, 0];
  let knownWeight = 0;
  let unknownWeight = 0;
  let advancedWeight = 0;

  for (const [item, count] of counts) {
    const weight = lemmaWeight(count);
    const profile = getEfllexProfile(item);

    if (!profile) {
      unknownWeight += weight;
      continue;
    }

    const tier = tierFromProfile(profile);
    tierWeights[tier - 1] += weight;
    knownWeight += weight;

    if (tier >= 4) advancedWeight += weight;
  }

  const cumulative = [];
  let running = 0;

  for (let i = 0; i < 5; i++) {
    running += tierWeights[i];
    cumulative.push(
      knownWeight > 0 ? (running / knownWeight) * 100 : 0
    );
  }

  const coverageA1 = cumulative[0];
  const coverageA2 = cumulative[1];
  const coverageB1 = cumulative[2];
  const coverageB2 = cumulative[3];
  const coverageC1 = cumulative[4];

  const totalVocabularyWeight = knownWeight + unknownWeight;
  const unknownRatio =
    totalVocabularyWeight > 0
      ? (unknownWeight / totalVocabularyWeight) * 100
      : 0;

  const averageSentenceLength =
    sentenceLengths.reduce((a, b) => a + b, 0) /
    Math.max(1, sentenceLengths.length);

  const averageWordLength =
    words.reduce((sum, word) => sum + word.length, 0) / words.length;

  const longWordRatio =
    words.filter(word => word.length >= 9).length / words.length;

  const level = chooseLevel({
    a1: coverageA1,
    a2: coverageA2,
    b1: coverageB1,
    b2: coverageB2,
    unknownRatio,
    averageSentenceLength,
    longWordRatio,
  });

  const sentenceLengths = sentences
    .map(sentence =>
      (sentence.match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g) || []).length
    )
    .filter(length => length > 0 && length < 120);

  const windowDiversity: number[] = [];
  for (let i = 0; i < lemmas.length; i += 500) {
    const window = lemmas.slice(i, i + 500);
    if (window.length < 150) break;
    windowDiversity.push(new Set(window).size / window.length);
  }

  const lexicalDiversity =
    windowDiversity.reduce((a, b) => a + b, 0) /
    Math.max(1, windowDiversity.length);

  const advancedWordRatio =
    knownWeight > 0 ? advancedWeight / knownWeight : 0;

  // Kept as a simple 0–100 diagnostic number for old UI compatibility.
  // The CEFR level itself is NOT selected from this score.
  const score =
    Math.round(
      (
        coverageB1 * 0.20 +
        coverageB2 * 0.25 +
        coverageC1 * 0.25 +
        Math.min(15, unknownRatio) +
        syntaxDifficulty(sentences) * 3
      ) * 10
    ) / 10;

  const round1 = (value: number) => Math.round(value * 10) / 10;
  const round3 = (value: number) => Math.round(value * 1000) / 1000;

  return {
    level,
    score,
    coverageA1: round1(coverageA1),
    coverageA2: round1(coverageA2),
    coverageB1: round1(coverageB1),
    coverageB2: round1(coverageB2),
    coverageC1: round1(coverageC1),
    unknownRatio: round1(unknownRatio),
    readingDifficulty: syntaxDifficulty(sentences),
    averageSentenceLength: round1(averageSentenceLength),
    averageWordLength: Math.round(averageWordLength * 100) / 100,
    longWordRatio: round3(longWordRatio),
    advancedWordRatio: round3(advancedWordRatio),
    lexicalDiversity: round3(lexicalDiversity),
    sampledWords: words.length,
  };
}
