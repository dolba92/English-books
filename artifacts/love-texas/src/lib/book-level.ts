import type { BookChapter } from './storage';
import { getEfllexProfile } from './efllex-profile-data';

export type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

export interface BookLevelAnalysis {
  level: CefrLevel;
  readingBand: string;
  comfortableLevel: CefrLevel;
  score: number;
  averageSentenceLength: number;
  averageWordLength: number;
  longWordRatio: number;
  advancedWordRatio: number;
  lexicalDiversity: number;
  sampledWords: number;
}

const IRREGULAR: Record<string, string> = {
  children:'child', men:'man', women:'woman', feet:'foot', teeth:'tooth', mice:'mouse',
  went:'go', gone:'go', came:'come', saw:'see', seen:'see', knew:'know', known:'know',
  thought:'think', brought:'bring', bought:'buy', caught:'catch', taught:'teach',
  heard:'hear', felt:'feel', left:'leave', kept:'keep', slept:'sleep', stood:'stand',
  understood:'understand', wrote:'write', written:'write', spoke:'speak', spoken:'speak',
  took:'take', taken:'take', gave:'give', given:'give', made:'make', ran:'run'
};

function clean(w: string) {
  return w.toLowerCase().replace(/[’]/g, "'").replace(/^[^a-z]+|[^a-z]+$/g, '');
}

function hasProfile(w: string) {
  return !!getEfllexProfile(w);
}

function lemma(w: string): string {
  if (IRREGULAR[w]) return IRREGULAR[w];
  if (hasProfile(w)) return w;

  const candidates: string[] = [];
  if (w.endsWith('ies') && w.length > 4) candidates.push(w.slice(0, -3) + 'y');
  if (w.endsWith('ied') && w.length > 4) candidates.push(w.slice(0, -3) + 'y');

  if (w.endsWith('ing') && w.length > 5) {
    const s = w.slice(0, -3);
    candidates.push(s, s + 'e');
    if (/(.)\1$/.test(s)) candidates.push(s.slice(0, -1));
  }

  if (w.endsWith('ed') && w.length > 4) {
    const s = w.slice(0, -2);
    candidates.push(s, s + 'e');
    if (/(.)\1$/.test(s)) candidates.push(s.slice(0, -1));
  }

  if (w.endsWith('es') && w.length > 4) candidates.push(w.slice(0, -2), w.slice(0, -1));
  if (w.endsWith('s') && w.length > 3) candidates.push(w.slice(0, -1));

  return candidates.find(hasProfile) || w;
}

function sampleBook(chapters: BookChapter[], target = 18000) {
  const paragraphs = chapters
    .flatMap(c => c.paragraphs || [])
    .map(p => p.replace(/\s+/g, ' ').trim())
    .filter(p => p.length >= 40);

  if (!paragraphs.length) return '';

  const count = Math.min(paragraphs.length, 320);
  const step = paragraphs.length / count;
  const out: string[] = [];

  for (let i = 0; i < count; i++) {
    out.push(paragraphs[Math.min(paragraphs.length - 1, Math.floor(i * step))]);
  }

  return out.join(' ').split(/\s+/).slice(0, target).join(' ');
}

function splitSentences(text: string) {
  return text
    .replace(/([.!?])["”’)]/g, '$1 ')
    .split(/[.!?]+(?:\s+|$)/)
    .map(s => s.trim())
    .filter(s => s.length > 8);
}

function syntaxComplexity(s: string) {
  const x = s.toLowerCase();
  const markers =
    /\b(although|though|whereas|while|unless|despite|whilst|whenever|wherever|however|which|whose|whom|whether)\b/g;

  return (
    (x.match(markers) || []).length +
    Math.min(3, (s.match(/[,;:—–]/g) || []).length * 0.28)
  );
}

function profileDifficulty(p: readonly number[]) {
  const sum = p.reduce((a, b) => a + b, 0);
  if (sum <= 0) return 0;

  const smoothed = p.map(v => v + 0.35);
  const denominator = smoothed.reduce((a, b) => a + b, 0);
  const weighted =
    smoothed.reduce((a, v, i) => a + v * (i + 1), 0) / denominator;

  const early = (p[0] + p[1]) / (sum + 1e-9);
  const late = (p[3] + p[4]) / (sum + 1e-9);

  return Math.max(1, Math.min(5, weighted + late * 0.22 - early * 0.12));
}

function readingBand(score: number): {
  band: string;
  start: CefrLevel;
  comfortable: CefrLevel;
} {
  // This is a practical reading-entry estimate, not a claim that
  // every word in the original novel belongs to this CEFR level.
  if (score < 51.8) return { band: 'A2–B1', start: 'A2', comfortable: 'B1' };
  if (score < 53.0) return { band: 'B1–B2', start: 'B1', comfortable: 'B2' };
  if (score < 54.5) return { band: 'B2–C1', start: 'B2', comfortable: 'C1' };
  return { band: 'C1–C2', start: 'C1', comfortable: 'C2' };
}

export function analyzeBookLevel(chapters: BookChapter[]): BookLevelAnalysis {
  const text = sampleBook(chapters);
  const tokens = text.match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g) || [];
  const words = tokens.map(clean).filter(Boolean);

  if (words.length < 120) {
    return {
      level: 'A2',
      readingBand: 'A2–B1',
      comfortableLevel: 'B1',
      score: 20,
      averageSentenceLength: 0,
      averageWordLength: 0,
      longWordRatio: 0,
      advancedWordRatio: 0,
      lexicalDiversity: 0,
      sampledWords: words.length,
    };
  }

  const sentences = splitSentences(text);
  const sentenceLengths = sentences
    .map(s => (s.match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g) || []).length)
    .filter(n => n > 0 && n < 120);

  const avgSentence =
    sentenceLengths.reduce((a, b) => a + b, 0) / Math.max(1, sentenceLengths.length);

  const avgWord = words.reduce((a, w) => a + w.length, 0) / words.length;
  const longRatio = words.filter(w => w.length >= 9).length / words.length;

  const lemmas = words.map(lemma);
  const content = lemmas.filter(w => w.length >= 4);

  let knownDifficulty = 0;
  let known = 0;
  let advancedKnown = 0;

  for (const w of content) {
    const profile = getEfllexProfile(w);
    if (!profile) continue;

    const difficulty = profileDifficulty(profile);
    knownDifficulty += difficulty;
    known += 1;

    if (difficulty >= 3.65) advancedKnown += 1;
  }

  const unknown = Math.max(0, content.length - known);
  const unknownRatio = unknown / Math.max(1, content.length);
  const avgLex = knownDifficulty / Math.max(1, known);
  const advancedRatio = advancedKnown / Math.max(1, known);

  const diversityWindows: number[] = [];
  for (let i = 0; i < lemmas.length; i += 500) {
    const window = lemmas.slice(i, i + 500);
    if (window.length < 150) break;
    diversityWindows.push(new Set(window).size / window.length);
  }

  const diversity =
    diversityWindows.reduce((a, b) => a + b, 0) / Math.max(1, diversityWindows.length);

  const syntax =
    sentences.map(syntaxComplexity).reduce((a, b) => a + b, 0) /
    Math.max(1, sentences.length);

  const lexicalScore = Math.max(0, (avgLex - 1.55) * 18);
  const advancedScore = Math.min(10, advancedRatio * 30);
  const sentenceScore = Math.max(0, Math.min(10, (avgSentence - 8) * 0.72));
  const syntaxScore = Math.min(8, syntax * 3.7);
  const diversityScore = Math.max(0, Math.min(8, (diversity - 0.43) * 32));
  const rarityScore = Math.min(5, unknownRatio * 12);

  let score =
    lexicalScore +
    advancedScore +
    sentenceScore +
    syntaxScore +
    diversityScore +
    rarityScore;

  if (avgSentence < 11.5 && avgLex < 3.15) score -= 2;
  if (avgSentence >= 14 && diversity >= 0.55 && avgLex >= 3.0) score += 3;

  const rounded = Math.round(score * 10) / 10;
  const band = readingBand(rounded);

  return {
    level: band.start,
    readingBand: band.band,
    comfortableLevel: band.comfortable,
    score: rounded,
    averageSentenceLength: Math.round(avgSentence * 10) / 10,
    averageWordLength: Math.round(avgWord * 100) / 100,
    longWordRatio: Math.round(longRatio * 1000) / 1000,
    advancedWordRatio: Math.round(advancedRatio * 1000) / 1000,
    lexicalDiversity: Math.round(diversity * 1000) / 1000,
    sampledWords: words.length,
  };
}
