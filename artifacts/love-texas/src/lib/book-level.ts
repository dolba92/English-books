import type { BookChapter } from './storage';

export type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

export interface BookLevelAnalysis {
  level: CefrLevel;
  score: number;
  averageSentenceLength: number;
  averageWordLength: number;
  longWordRatio: number;
  advancedWordRatio: number;
  lexicalDiversity: number;
  sampledWords: number;
}

/**
 * CEFR book estimator v2
 *
 * Goal:
 * - stop treating "long word" as automatically "advanced"
 * - give more weight to uncommon vocabulary and sentence structure
 * - keep A1/A2 for genuinely simple/adapted texts
 * - make C2 rare
 *
 * This is still an approximation, not an official CEFR certification.
 */

const VERY_COMMON = new Set(`
a an the and or but if so because as at by for from in into of on onto to up with without
i me my mine you your yours he him his she her hers it its we us our ours they them their theirs
this that these those who what when where why how which
is am are was were be been being have has had do does did done
can could will would shall should may might must
not no yes all any some many much more most few little other another same
one two three four five six seven eight nine ten first second last next
new old good bad big small long short high low
man woman boy girl child children people person thing time day night year week month
way place house home room door window road street car school work world
go goes went gone going come came get got gotten make made take took taken give gave given
see saw seen know knew known think thought say said tell told ask asked
look looked find found want wanted need needed feel felt seem seemed
like love live lived put keep kept let help try tried use used
very too just also only even still already again here there now then
before after over under out down back around through about
`.trim().split(/\s+/));

const COMMON = new Set(`
above across almost along always among answer appear arrive away become begin behind believe
better between book both bring brought call called carry change close course cut dark dead different
during each early end enough ever every face family far fast father fear fire follow food friend
full great ground hand happen hard hear heard heart hold hope hour however idea inside kind leave left
less life light line mean mind minute morning mother move name near never nothing number often once open
own part perhaps point quite read really remember right run second set side since sit something sometimes
soon sound stand start stop story sure talk than together turn until walk water while white whole word young
air arm bed black blue body brother city cold color country cry dog draw dress drink drive eat eye fall feel
fight fill foot girl green hair half head hear home horse hot hundred husband job laugh learn letter money
night paper parent phone play question rain red river sleep smile song speak stay table town tree watch
wife write wrong yesterday
`.trim().split(/\s+/));

const MID_COMMON = new Set(`
accept act afraid agree allow angry animal answer area arrive attention beautiful blood break brother
build business calm care catch certain chance clear climb clothes company continue corner create decide
deep die direction doctor dream easy edge explain fact family field finally fine floor forget free front
game garden happen heavy history hold important interest kitchen language later lead learn listen matter
moment mouth music office order outside party pay picture plan police possible power problem pull push
ready reason receive return rich round safe seat show simple sister sky slowly special strong student suddenly
teacher team throw touch train travel true understand voice wait wall war watch week wish worry
`.trim().split(/\s+/));

const ADVANCED_HINTS = new Set(`
abrupt abstract absurd accumulate adjacent advocate aftermath ambiguity anticipate arbitrary
bewilder brittle cease coherent compel conceal consequently contemplate contradict conventional
correspond crucial deliberate dense derive diminish discern disrupt elaborate emerge encounter
endure equivalent evade evident exceedingly formidable furthermore glimpse grim hesitate immense
inevitable infer intricate obscure persist peculiar profound reluctant resemble rigid scarcely
subsequent subtle sufficient suppress sustain tangible tense threshold tolerate tremendous
uncanny undertake vivid whereas whilst
impenetrability bottomland supplejack creosote
`.trim().split(/\s+/));

const IRREGULAR_BASE: Record<string, string> = {
  children: 'child',
  men: 'man',
  women: 'woman',
  people: 'person',
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

function normalizeWord(word: string): string {
  return word
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/^[^a-z]+|[^a-z]+$/g, '');
}

function knownWord(word: string): boolean {
  return VERY_COMMON.has(word) || COMMON.has(word) || MID_COMMON.has(word) || ADVANCED_HINTS.has(word);
}

function baseForm(word: string): string {
  if (IRREGULAR_BASE[word]) return IRREGULAR_BASE[word];
  if (knownWord(word)) return word;

  const candidates: string[] = [];

  if (word.endsWith('ies') && word.length > 4) candidates.push(word.slice(0, -3) + 'y');
  if (word.endsWith('ied') && word.length > 4) candidates.push(word.slice(0, -3) + 'y');

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

  if (word.endsWith('er') && word.length > 5) candidates.push(word.slice(0, -2));
  if (word.endsWith('est') && word.length > 6) candidates.push(word.slice(0, -3));
  if (word.endsWith('es') && word.length > 4) candidates.push(word.slice(0, -2), word.slice(0, -1));
  if (word.endsWith('s') && word.length > 3) candidates.push(word.slice(0, -1));

  for (const candidate of candidates) {
    if (knownWord(candidate)) return candidate;
  }

  return word;
}

function collectSample(chapters: BookChapter[], targetWords = 18000): string {
  const paragraphs = chapters
    .flatMap(chapter => chapter.paragraphs || [])
    .map(p => p.replace(/\s+/g, ' ').trim())
    .filter(p => p.length >= 40);

  if (!paragraphs.length) return '';

  // Sample across the whole book so a simple prologue or contents page does not dominate.
  const chunks: string[] = [];
  const wantedParagraphs = Math.min(paragraphs.length, 280);
  const step = paragraphs.length / wantedParagraphs;

  for (let i = 0; i < wantedParagraphs; i += 1) {
    const index = Math.min(paragraphs.length - 1, Math.floor(i * step));
    chunks.push(paragraphs[index]);
  }

  return chunks.join(' ').split(/\s+/).slice(0, targetWords).join(' ');
}

function sentenceParts(text: string): string[] {
  return text
    .replace(/([.!?])["”’)]/g, '$1 ')
    .split(/[.!?]+(?:\s+|$)/)
    .map(s => s.trim())
    .filter(s => s.length > 8);
}

function syllableEstimate(word: string): number {
  const cleaned = word.toLowerCase().replace(/[^a-z]/g, '');
  if (cleaned.length <= 3) return 1;

  const reduced = cleaned
    .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/i, '')
    .replace(/^y/i, '');

  return Math.max(1, reduced.match(/[aeiouy]{1,2}/g)?.length ?? 1);
}

function clauseComplexity(sentence: string): number {
  const lower = sentence.toLowerCase();

  let score = 0;

  const markers = [
    /\balthough\b/g,
    /\bthough\b/g,
    /\bwhereas\b/g,
    /\bwhile\b/g,
    /\bunless\b/g,
    /\bdespite\b/g,
    /\bwhilst\b/g,
    /\bwhenever\b/g,
    /\bwherever\b/g,
    /\bhowever\b/g,
    /\bwhich\b/g,
    /\bwhose\b/g,
    /\bwhom\b/g,
    /\bthat\b/g,
  ];

  for (const rx of markers) {
    score += (lower.match(rx) || []).length;
  }

  score += Math.min(3, (sentence.match(/[,;:—–-]/g) || []).length * 0.35);

  return score;
}

function vocabularyDifficulty(word: string): number {
  if (!word || word.length <= 2) return 0;
  if (VERY_COMMON.has(word)) return 0;
  if (COMMON.has(word)) return 0.15;
  if (MID_COMMON.has(word)) return 0.35;
  if (ADVANCED_HINTS.has(word)) return 1.0;

  // Unknown-to-our-common-lists words get weight mainly from rarity proxies,
  // not sheer length alone.
  const syllables = syllableEstimate(word);

  if (word.length >= 12) return 1.0;
  if (word.length >= 10) return 0.88;
  if (word.length >= 8 && syllables >= 3) return 0.72;
  if (word.length >= 7) return 0.52;
  if (word.length >= 6) return 0.38;
  return 0.22;
}

export function analyzeBookLevel(chapters: BookChapter[]): BookLevelAnalysis {
  const sample = collectSample(chapters);
  const rawWords = sample.match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g) || [];
  const words = rawWords
    .map(normalizeWord)
    .filter(Boolean);

  if (words.length < 120) {
    return {
      level: 'A2',
      score: 20,
      averageSentenceLength: 0,
      averageWordLength: 0,
      longWordRatio: 0,
      advancedWordRatio: 0,
      lexicalDiversity: 0,
      sampledWords: words.length,
    };
  }

  const sentences = sentenceParts(sample);

  const sentenceLengths = sentences
    .map(sentence => (sentence.match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g) || []).length)
    .filter(n => n > 0 && n < 120);

  const averageSentenceLength =
    sentenceLengths.reduce((sum, n) => sum + n, 0) / Math.max(1, sentenceLengths.length);

  const averageWordLength =
    words.reduce((sum, word) => sum + word.length, 0) / words.length;

  const longWordRatio =
    words.filter(word => word.length >= 9).length / words.length;

  const baseWords = words.map(baseForm);
  const contentWords = baseWords.filter(word => word.length >= 4);

  const vocabWeights = contentWords.map(vocabularyDifficulty);
  const averageVocabDifficulty =
    vocabWeights.reduce((sum, n) => sum + n, 0) / Math.max(1, vocabWeights.length);

  // "Advanced ratio" now means genuinely uncommon/lexically difficult according
  // to the estimator, not merely "long words".
  const advancedCount = contentWords.filter(word => vocabularyDifficulty(word) >= 0.72).length;
  const advancedWordRatio = advancedCount / Math.max(1, contentWords.length);

  // Lexical diversity on fixed windows avoids penalising longer books.
  const windowSize = 500;
  const diversities: number[] = [];

  for (let i = 0; i < baseWords.length; i += windowSize) {
    const window = baseWords.slice(i, i + windowSize);
    if (window.length < 150) break;
    diversities.push(new Set(window).size / window.length);
  }

  const lexicalDiversity =
    diversities.reduce((sum, n) => sum + n, 0) / Math.max(1, diversities.length);

  // Sentence complexity: punctuation + subordinate/relative-clause signals.
  const clauseScores = sentences.map(clauseComplexity);
  const averageClauseComplexity =
    clauseScores.reduce((sum, n) => sum + n, 0) / Math.max(1, clauseScores.length);

  // --- Scoring ---
  // Vocabulary is now the strongest component.
  const vocabScore = Math.max(0, Math.min(34, averageVocabDifficulty * 55));
  const advancedScore = Math.max(0, Math.min(18, advancedWordRatio * 105));

  // Syntax matters, but sentence length alone cannot make a book "advanced".
  const sentenceScore = Math.max(0, Math.min(16, (averageSentenceLength - 8) * 1.15));
  const clauseScore = Math.max(0, Math.min(14, averageClauseComplexity * 7.5));

  // Diversity distinguishes repetitive/simple prose from richer narrative prose.
  const diversityScore = Math.max(0, Math.min(12, (lexicalDiversity - 0.40) * 55));

  // Long words remain only a small supporting signal.
  const longWordScore = Math.max(0, Math.min(6, longWordRatio * 55));

  const rawScore =
    vocabScore +
    advancedScore +
    sentenceScore +
    clauseScore +
    diversityScore +
    longWordScore;

  // Guardrails:
  // authentic prose with rich vocabulary should not collapse into A1/A2
  // simply because sentences are short.
  let score = rawScore;

  if (advancedWordRatio >= 0.10 && lexicalDiversity >= 0.53) {
    score = Math.max(score, 45);
  }

  if (
    advancedWordRatio >= 0.13 &&
    lexicalDiversity >= 0.56 &&
    averageVocabDifficulty >= 0.44
  ) {
    score = Math.max(score, 57);
  }

  if (
    averageSentenceLength >= 14 &&
    lexicalDiversity >= 0.54 &&
    averageVocabDifficulty >= 0.42
  ) {
    score += 3;
  }

  let level: CefrLevel;

  if (score < 20) level = 'A1';
  else if (score < 31) level = 'A2';
  else if (score < 43) level = 'B1';
  else if (score < 56) level = 'B2';
  else if (score < 70) level = 'C1';
  else level = 'C2';

  return {
    level,
    score: Math.round(score * 10) / 10,
    averageSentenceLength: Math.round(averageSentenceLength * 10) / 10,
    averageWordLength: Math.round(averageWordLength * 100) / 100,
    longWordRatio: Math.round(longWordRatio * 1000) / 1000,
    advancedWordRatio: Math.round(advancedWordRatio * 1000) / 1000,
    lexicalDiversity: Math.round(lexicalDiversity * 1000) / 1000,
    sampledWords: words.length,
  };
}
