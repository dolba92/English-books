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

const VERY_COMMON = new Set(`
a an the and or but if so because as at by for from in into of on onto to up with
i me my mine you your yours he him his she her hers it its we us our ours they them their theirs
this that these those who what when where why how which
is am are was were be been being have has had do does did
can could will would shall should may might must
not no yes all any some many much more most few little other another same
one two three first last new old good bad big small long short high low
man woman boy girl child children people person thing time day night year
way place house home room door window road car school work world
go goes went gone going come came get got make made take took give gave
see saw seen know knew known think thought say said tell told ask asked
look looked find found want wanted need needed feel felt seem seemed
like love live lived put keep kept let help try tried use used
very too just also only even still already again here there now then
before after over under out down back around through about
`.trim().split(/\s+/));

const COMMON = new Set(`
above across almost along always among answer appear arrive away beautiful become begin behind believe
better between book both bring brought call called carry change close course cut dark dead different
during each early end enough ever every face family far fast father fear fire five follow food four
friend full great ground hand happen hard hear heard heart hold hope hour however idea inside keep
kind leave left less life light line mean mind minute morning mother move name near never next nothing
number often once open own part perhaps point quite read really remember right run second set side
since sit something sometimes soon sound stand start stop story street sure talk than three together
turn until walk water while white whole without word young
`.trim().split(/\s+/));

const ADVANCED_HINTS = new Set(`
abrupt abstract absurd accumulate adjacent advocate aftermath ambiguity anticipate arbitrary
bewilder brittle cease coherent compel conceal consequently contemplate contradict conventional
correspond crucial deliberate dense derive diminish discern disrupt elaborate emerge encounter
endure equivalent evade evident exceedingly formidable furthermore glimpse grim hesitate immense
inevitable infer intricate obscure persist peculiar profound reluctant resemble rigid scarcely
subsequent subtle sufficient suppress sustain tangible tense threshold tolerate tremendous
uncanny undertake vivid whereas whilst
`.trim().split(/\s+/));

function normalizeWord(word: string): string {
  return word
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/^[^a-z]+|[^a-z]+$/g, '');
}

function baseForm(word: string): string {
  if (VERY_COMMON.has(word) || COMMON.has(word) || ADVANCED_HINTS.has(word)) return word;

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
  if (word.endsWith('es') && word.length > 4) candidates.push(word.slice(0, -2), word.slice(0, -1));
  if (word.endsWith('s') && word.length > 3) candidates.push(word.slice(0, -1));

  for (const candidate of candidates) {
    if (VERY_COMMON.has(candidate) || COMMON.has(candidate) || ADVANCED_HINTS.has(candidate)) {
      return candidate;
    }
  }
  return word;
}

function collectSample(chapters: BookChapter[], targetWords = 18000): string {
  // Берём текст не только из начала: предисловия и оглавления не должны определять уровень книги.
  const paragraphs = chapters
    .flatMap(chapter => chapter.paragraphs || [])
    .map(p => p.replace(/\s+/g, ' ').trim())
    .filter(p => p.length >= 40);

  if (!paragraphs.length) return '';

  const chunks: string[] = [];
  const wantedParagraphs = Math.min(paragraphs.length, 240);
  const step = Math.max(1, paragraphs.length / wantedParagraphs);

  for (let i = 0; i < wantedParagraphs; i += 1) {
    const index = Math.min(paragraphs.length - 1, Math.floor(i * step));
    chunks.push(paragraphs[index]);
  }

  const text = chunks.join(' ');
  const words = text.split(/\s+/);
  return words.slice(0, targetWords).join(' ');
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
  const groups = reduced.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups?.length ?? 1);
}

export function analyzeBookLevel(chapters: BookChapter[]): BookLevelAnalysis {
  const sample = collectSample(chapters);
  const rawWords = sample.match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g) || [];
  const words = rawWords
    .map(normalizeWord)
    .filter(w => w.length > 0);

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
    .filter(n => n > 0 && n < 100);

  const averageSentenceLength =
    sentenceLengths.reduce((sum, n) => sum + n, 0) / Math.max(1, sentenceLengths.length);

  const averageWordLength =
    words.reduce((sum, word) => sum + word.length, 0) / words.length;

  const longWordRatio =
    words.filter(word => word.length >= 9).length / words.length;

  const baseWords = words.map(baseForm);
  const contentWords = baseWords.filter(word => word.length >= 4);

  // "Продвинутое" слово здесь — не просто длинное слово. Сначала исключаем
  // базовую частотную лексику, затем учитываем длину/сложность формы.
  const advancedCount = contentWords.filter(word => {
    if (VERY_COMMON.has(word) || COMMON.has(word)) return false;
    if (ADVANCED_HINTS.has(word)) return true;
    const syllables = syllableEstimate(word);
    return word.length >= 9 || (word.length >= 7 && syllables >= 3);
  }).length;
  const advancedWordRatio = advancedCount / Math.max(1, contentWords.length);

  // TTR на фиксированных окнах, чтобы длинная книга автоматически не выглядела "проще".
  const windowSize = 500;
  const diversities: number[] = [];
  for (let i = 0; i + 100 < baseWords.length; i += windowSize) {
    const window = baseWords.slice(i, i + windowSize);
    if (window.length < 100) break;
    diversities.push(new Set(window).size / window.length);
  }
  const lexicalDiversity =
    diversities.reduce((sum, n) => sum + n, 0) / Math.max(1, diversities.length);

  // Несколько независимых признаков. Ни один из них не может сам "назначить" C1/C2.
  const sentenceScore = Math.max(0, Math.min(28, (averageSentenceLength - 8) * 1.45));
  const wordLengthScore = Math.max(0, Math.min(18, (averageWordLength - 3.8) * 13));
  const longWordScore = Math.max(0, Math.min(18, longWordRatio * 150));
  const advancedScore = Math.max(0, Math.min(25, advancedWordRatio * 115));
  const diversityScore = Math.max(0, Math.min(11, (lexicalDiversity - 0.38) * 55));

  const score =
    sentenceScore +
    wordLengthScore +
    longWordScore +
    advancedScore +
    diversityScore;

  // Шкала специально оставляет A1/A2 для действительно простых адаптированных текстов.
  // Обычный современный роман не должен случайно становиться A1.
  let level: CefrLevel;
  if (score < 18) level = 'A1';
  else if (score < 29) level = 'A2';
  else if (score < 42) level = 'B1';
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
