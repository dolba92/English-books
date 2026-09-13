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
  readingDiagnostics: {
    points: number;
    average: number;
    substantialAverage: number;
    p75: number;
    p90: number;
    long20Ratio: number;
    long30Ratio: number;
    complexRatio: number;
    longWordRatio: number;
    lexicalDiversity: number;
    lexicalBonus: number;
  };

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

function syntaxDifficulty(
  sentences: string[],
  vocabulary: {
    level: CefrLevel;
    unknownRatio: number;
    longWordRatio: number;
    lexicalDiversity: number;
  }
): 1 | 2 | 3 | 4 | 5 {
  const stats = sentences
    .map(sentence => {
      const words = sentence.match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g) || [];
      const clauseSignals =
        sentence.match(
          /\b(?:although|though|because|since|unless|whereas|while|when|which|who|whose|whom|that|if|as)\b|[;:—–]/gi
        ) || [];
      return {
        length: words.length,
        clauseSignals: clauseSignals.length,
        commas: (sentence.match(/,/g) || []).length,
      };
    })
    .filter(item => item.length > 0 && item.length < 120);

  if (!stats.length) return 1;

  const lengths = stats.map(item => item.length).sort((a, b) => a - b);
  const percentile = (p: number) =>
    lengths[Math.min(lengths.length - 1, Math.floor((lengths.length - 1) * p))];

  const substantial = stats.filter(item => item.length >= 7);
  const substantialAverage = substantial.length
    ? substantial.reduce((sum, item) => sum + item.length, 0) / substantial.length
    : lengths.reduce((sum, n) => sum + n, 0) / lengths.length;

  const p75 = percentile(0.75);
  const p90 = percentile(0.90);
  const long20Ratio = stats.filter(item => item.length >= 20).length / stats.length;
  const long30Ratio = stats.filter(item => item.length >= 30).length / stats.length;
  const complexRatio =
    stats.filter(item => item.length >= 18 && (item.clauseSignals >= 2 || item.commas >= 2)).length /
    stats.length;

  // Syntax is scored once from a compact set of non-duplicative signals.
  let syntax: 1 | 2 | 3 | 4 | 5 = 1;
  if (substantialAverage >= 12.5 || p90 >= 20 || long20Ratio >= 0.08) syntax = 2;
  if (substantialAverage >= 15.5 || p90 >= 27 || long20Ratio >= 0.20 || complexRatio >= 0.10) syntax = 3;
  if ((p90 >= 36 && long30Ratio >= 0.10) || substantialAverage >= 20 || complexRatio >= 0.20) syntax = 4;
  if ((p90 >= 48 && long30Ratio >= 0.22) || substantialAverage >= 25 || complexRatio >= 0.32) syntax = 5;

  // Vocabulary is a separate dimension.
  let vocab: 1 | 2 | 3 | 4 | 5 = 1;
  if (vocabulary.level === 'A2') vocab = 2;
  else if (vocabulary.level === 'B1') vocab = 2;
  else if (vocabulary.level === 'B2') vocab = 3;
  else if (vocabulary.level === 'C1') vocab = 4;
  else if (vocabulary.level === 'C2') vocab = 5;

  if (vocabulary.longWordRatio >= 0.040 && vocabulary.lexicalDiversity >= 0.54) {
    vocab = Math.min(5, vocab + 1) as 1 | 2 | 3 | 4 | 5;
  }

  // Compact contemporary prose can still carry a noticeable lexical load
  // even when its CEFR band is low and the sentences are short.
  // This is intentionally narrow so easy action prose is not promoted.
  if (
    (vocabulary.level === 'A2' || vocabulary.level === 'B1') &&
    vocabulary.longWordRatio >= 0.035 &&
    vocabulary.unknownRatio >= 18
  ) {
    vocab = Math.min(5, vocab + 1) as 1 | 2 | 3 | 4 | 5;
  }

  if (vocabulary.unknownRatio >= 28) {
    vocab = Math.min(5, vocab + 1) as 1 | 2 | 3 | 4 | 5;
  }

  // Vocabulary gets a little more influence than raw sentence shape.
  // This keeps long-but-clear action prose lower, while compact vocabulary-
  // dense prose can rise to the middle band.
  const blended = syntax * 0.45 + vocab * 0.55;
  if (blended < 1.65) return 1;
  if (blended < 2.55) return 2;
  if (blended < 3.45) return 3;
  if (blended < 4.35) return 4;
  return 5;
}

function getReadingDiagnostics(
  sentences: string[],
  vocabulary: {
    level: CefrLevel;
    unknownRatio: number;
    longWordRatio: number;
    lexicalDiversity: number;
  }
) {
  const stats = sentences
    .map(sentence => {
      const words = sentence.match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g) || [];
      const clauseSignals =
        sentence.match(
          /\b(?:although|though|because|since|unless|whereas|while|when|which|who|whose|whom|that|if|as)\b|[;:—–]/gi
        ) || [];
      return {
        length: words.length,
        clauseSignals: clauseSignals.length,
        commas: (sentence.match(/,/g) || []).length,
      };
    })
    .filter(item => item.length > 0 && item.length < 120);

  if (!stats.length) {
    return {
      points: 0, average: 0, substantialAverage: 0, p75: 0, p90: 0,
      long20Ratio: 0, long30Ratio: 0, complexRatio: 0,
      longWordRatio: vocabulary.longWordRatio,
      lexicalDiversity: vocabulary.lexicalDiversity,
      lexicalBonus: 0,
    };
  }

  const lengths = stats.map(item => item.length).sort((a, b) => a - b);
  const percentile = (p: number) =>
    lengths[Math.min(lengths.length - 1, Math.floor((lengths.length - 1) * p))];
  const average = lengths.reduce((sum, n) => sum + n, 0) / lengths.length;
  const substantial = stats.filter(item => item.length >= 7);
  const substantialAverage = substantial.length
    ? substantial.reduce((sum, item) => sum + item.length, 0) / substantial.length
    : average;
  const p75 = percentile(0.75);
  const p90 = percentile(0.90);
  const long20Ratio = stats.filter(item => item.length >= 20).length / stats.length;
  const long30Ratio = stats.filter(item => item.length >= 30).length / stats.length;
  const complexRatio =
    stats.filter(item => item.length >= 18 && (item.clauseSignals >= 2 || item.commas >= 2)).length /
    stats.length;

  // For the temporary UI, P now shows the final 1–5 result.
  const points = syntaxDifficulty(sentences, vocabulary);

  return {
    points,
    average,
    substantialAverage,
    p75,
    p90,
    long20Ratio,
    long30Ratio,
    complexRatio,
    longWordRatio: vocabulary.longWordRatio,
    lexicalDiversity: vocabulary.lexicalDiversity,
    lexicalBonus: 0,
  };
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
  longWordRatio: number;
}): CefrLevel {
  const {
    a1,
    a2,
    b1,
    b2,
    unknownRatio,
    longWordRatio,
  } = params;

  const longPct = longWordRatio * 100;

  /*
   * CEFR here is vocabulary-only.
   * Sentence length/syntax is deliberately NOT used here: it belongs to the
   * separate readingDifficulty 1–5 score.
   */

  if (
    a1 >= 62 &&
    a2 >= 80 &&
    b1 >= 91 &&
    unknownRatio <= 12
  ) {
    return 'A1';
  }

  /*
   * A2: accessible vocabulary with relatively little vocabulary outside
   * EFLLex. Calibrated conservatively so The Little Prince can fall into A2
   * without pulling normal B1 fiction (Percy Jackson / Wimpy Kid) down with it.
   */
  if (
    a2 >= 59 &&
    b1 >= 78 &&
    b2 >= 91 &&
    unknownRatio <= 16
  ) {
    return 'A2';
  }

  const looksB1 =
    b1 >= 76 &&
    b2 >= 90 &&
    unknownRatio < 22 &&
    longPct < 5.2;

  if (looksB1) {
    return 'B1';
  }

  const looksB2 =
    b1 >= 70 &&
    b2 >= 86 &&
    unknownRatio < 29 &&
    longPct < 8.5;

  if (looksB2) {
    return 'B2';
  }

  const looksC1 =
    b1 >= 60 &&
    b2 >= 78 &&
    unknownRatio < 38;

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
      readingDiagnostics: {
        points: 0, average: 0, substantialAverage: 0, p75: 0, p90: 0,
        long20Ratio: 0, long30Ratio: 0, complexRatio: 0,
        longWordRatio: 0, lexicalDiversity: 0, lexicalBonus: 0,
      },
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

  const sentenceLengths = sentences
    .map(sentence =>
      (sentence.match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g) || []).length
    )
    .filter(length => length > 0 && length < 120);

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
    longWordRatio,
  });

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
        syntaxDifficulty(sentences, { level, unknownRatio, longWordRatio, lexicalDiversity }) * 3
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
    readingDifficulty: syntaxDifficulty(sentences, { level, unknownRatio, longWordRatio, lexicalDiversity }),
    readingDiagnostics: getReadingDiagnostics(sentences, { level, unknownRatio, longWordRatio, lexicalDiversity }),
    averageSentenceLength: round1(averageSentenceLength),
    averageWordLength: Math.round(averageWordLength * 100) / 100,
    longWordRatio: round3(longWordRatio),
    advancedWordRatio: round3(advancedWordRatio),
    lexicalDiversity: round3(lexicalDiversity),
    sampledWords: words.length,
  };
}
