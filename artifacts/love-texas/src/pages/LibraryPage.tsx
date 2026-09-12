import React, { useEffect, useRef, useState } from 'react';
import { Book, deleteBook, getAllBooks, getProgress, saveBook } from '@/lib/storage';
import { BookCard } from '@/components/BookCard';
import { parseEpub } from '@/lib/epub-parser';
import { parseFb2 } from '@/lib/fb2-parser';
import { paginateBook } from '@/lib/paginator';
import { Book as BookIcon, BookOpen, Plus, RefreshCw } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import backgroundUrl from '@/assets/english-books-background.png';

type Level = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

const VERY_COMMON_WORDS = new Set(
  `
  the be to of and a in that have i it for not on with he as you do at this but
  his by from they we say her she or an will my one all would there their what so
  up out if about who get which go me when make can like time no just him know take
  people into year your good some could them see other than then now look only come
  its over think also back after use two how our work first well way even new want
  because these give day most us is are was were been being am has had does did
  went gone going made came saw seen got took taken said thought knew known gave
  given found felt left put keep kept let begin began begun seem help talk turn
  start show hear heard play run move live bring happen write sit stand learn
  change understand watch follow stop speak read walk remember love wait stay fall
  reach pass return hope carry break eat catch choose listen close pick wear drive
  sleep drink try need feel become leave call ask tell find man woman child children
  boy girl person family mother father sister brother friend house home room school
  book word water food night morning week world life hand eye face head name thing
  place door car road town question problem story side kind lot end enough little
  long great old young big small high low right wrong same different important
  possible sure happy sorry afraid angry hard easy early late near far together
  again always never often sometimes very really too more less many much few
  another every each both own such still already almost perhaps maybe here where
  why how before during without under above between around through while until since
  `.trim().split(/\s+/)
);

const ADVANCED_MARKERS = new Set(
  `
  impenetrability notwithstanding nevertheless consequently furthermore moreover
  whereas whereby albeit thereby therein insofar ostensibly presumably subsequently
  unprecedented inevitable sophisticated substantial considerable significant
  controversial conventional phenomenon perspective implication circumstance
  acquisition acknowledge demonstrate establish constitute indicate interpret
  perceive pursue sufficient undertake retain emerge encounter ambiguity
  intricate inherent arbitrary plausible profound subtle coherent
  `.trim().split(/\s+/)
);

function countSyllables(word: string): number {
  let cleaned = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!cleaned) return 1;
  if (cleaned.length <= 3) return 1;

  cleaned = cleaned
    .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '')
    .replace(/^y/, '');

  const groups = cleaned.match(/[aeiouy]+/g);
  return Math.max(1, groups?.length || 1);
}

function estimateBookLevel(chapters: Array<{ paragraphs?: string[] }>): Level {
  /*
   * Book-oriented CEFR estimate.
   *
   * CEFR is formally a learner proficiency scale, not a property that can be
   * calculated exactly from a novel. For the library badge we therefore combine:
   *   1) sentence length / syntax,
   *   2) syllabic readability,
   *   3) lexical rarity proxy,
   *   4) long-word density,
   *   5) explicit advanced-vocabulary markers.
   *
   * A1/A2 are intentionally reserved for genuinely simple / graded-reader-like
   * prose. C2 is intentionally rare.
   */
  const MAX_WORDS = 40000;
  const chunks: string[] = [];
  let collectedWords = 0;

  outer: for (const chapter of chapters || []) {
    for (const paragraph of chapter?.paragraphs || []) {
      if (!paragraph) continue;
      chunks.push(paragraph);
      collectedWords += (paragraph.match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g) || []).length;
      if (collectedWords >= MAX_WORDS) break outer;
    }
  }

  const text = chunks.join(' ');
  const rawWords = text.match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g) || [];
  if (rawWords.length < 120) return 'B1';

  const words = rawWords
    .map((word) => word.toLowerCase().replace(/[’']/g, ''))
    .filter(Boolean);

  const sentenceParts = text
    .replace(/[“”"']/g, '')
    .split(/[.!?]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const sentenceCount = Math.max(1, sentenceParts.length);

  let syllables = 0;
  let longWords = 0;
  let veryLongWords = 0;
  let uncommonLongWords = 0;
  let advancedMarkers = 0;

  for (const word of words) {
    syllables += countSyllables(word);

    if (word.length >= 8) longWords += 1;
    if (word.length >= 11) veryLongWords += 1;

    if (
      word.length >= 7 &&
      !VERY_COMMON_WORDS.has(word) &&
      !/^\d+$/.test(word)
    ) {
      uncommonLongWords += 1;
    }

    if (ADVANCED_MARKERS.has(word)) advancedMarkers += 1;
  }

  const avgSentenceLength = words.length / sentenceCount;
  const avgSyllablesPerWord = syllables / words.length;
  const longWordRatio = longWords / words.length;
  const veryLongWordRatio = veryLongWords / words.length;
  const uncommonLongRatio = uncommonLongWords / words.length;
  const advancedMarkerRate = advancedMarkers / words.length;

  const flesch =
    206.835 -
    1.015 * avgSentenceLength -
    84.6 * avgSyllablesPerWord;

  // Weighted difficulty. The lexical terms matter more for novels than raw
  // sentence length, preventing descriptive adult fiction from becoming A1/A2.
  let difficulty = 0;

  difficulty += Math.max(0, Math.min(28, (80 - flesch) * 0.36));
  difficulty += Math.max(0, Math.min(18, (avgSentenceLength - 9) * 1.05));
  difficulty += Math.max(0, Math.min(18, (avgSyllablesPerWord - 1.30) * 50));
  difficulty += Math.min(14, longWordRatio * 75);
  difficulty += Math.min(10, veryLongWordRatio * 110);
  difficulty += Math.min(18, uncommonLongRatio * 70);
  difficulty += Math.min(8, advancedMarkerRate * 1800);

  // Extra guardrails for authentic prose. A book with substantial lexical
  // density cannot be labelled beginner just because it contains short sentences.
  const clearlyNotA1 =
    uncommonLongRatio > 0.075 ||
    longWordRatio > 0.105 ||
    avgSyllablesPerWord > 1.43 ||
    avgSentenceLength > 12;

  const clearlyNotA2 =
    uncommonLongRatio > 0.115 ||
    longWordRatio > 0.155 ||
    avgSyllablesPerWord > 1.52 ||
    avgSentenceLength > 16;

  let level: Level;
  if (difficulty < 20) level = 'A1';
  else if (difficulty < 30) level = 'A2';
  else if (difficulty < 43) level = 'B1';
  else if (difficulty < 57) level = 'B2';
  else if (difficulty < 75) level = 'C1';
  else level = 'C2';

  if (level === 'A1' && clearlyNotA1) level = 'A2';
  if ((level === 'A1' || level === 'A2') && clearlyNotA2) level = 'B1';

  // Full native novels with visibly dense vocabulary should not receive a
  // beginner badge. This still allows genuinely simple graded books to be A1/A2.
  if (
    (level === 'A1' || level === 'A2') &&
    words.length >= 5000 &&
    (uncommonLongRatio > 0.09 || longWordRatio > 0.13)
  ) {
    level = 'B1';
  }

  return level;
}

export function LibraryPage() {
  const [books, setBooks] = useState<{ book: Book; progress: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadBooks = async () => {
    try {
      setError('');

      const allBooks = await getAllBooks();

      const booksWithProgress = await Promise.all(
        allBooks.map(async (book) => {
          const prog = await getProgress(book.id!);
          const actualPageCount = paginateBook(book.content, 6).totalPages;
          const estimatedLevel = estimateBookLevel(book.content);

          const updatedBook = {
            ...book,
            totalPages: actualPageCount,
            level: estimatedLevel,
          };

          // Keep recalculated CEFR for already imported books too.
          if (book.level !== estimatedLevel || book.totalPages !== actualPageCount) {
            await saveBook(updatedBook);
          }

          return {
            book: updatedBook,
            progress: prog?.percentComplete || 0,
          };
        })
      );

      setBooks(
        booksWithProgress.sort((a, b) => b.book.addedAt - a.book.addedAt)
      );
    } catch (err) {
      console.error(err);
      setError('Не удалось загрузить книги. Попробуйте ещё раз.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBooks();

    const checkSample = async () => {
      const existing = await getAllBooks();

      if (existing.length === 0) {
        const sampleContent = [
          {
            title: 'Chapter 1',
            paragraphs: [
              'Once when I was six years old I saw a magnificent picture in a book, called True Stories from Nature, about the primeval forest.',
              'In the book it said that boa constrictors swallow their prey whole without chewing it.',
              'I pondered deeply over the adventures of the jungle and made my first drawing.',
            ],
          },
          {
            title: 'Chapter 2',
            paragraphs: [
              'So I lived my life alone until I had an accident with my plane in the Desert of Sahara.',
              'It was a question of life or death for me.',
              'The first night I went to sleep on the sand a thousand miles from any human habitation.',
            ],
          },
        ];

        await saveBook({
          title: 'The Little Prince (Sample)',
          author: 'Antoine de Saint-Exupéry',
          level: estimateBookLevel(sampleContent),
          fileSizeKb: 10,
          addedAt: Date.now(),
          totalPages: 2,
          content: sampleContent,
        });

        await loadBooks();
      }
    };

    checkSample();
  }, []);

  const handleFileUpload = async (file: File) => {
    if (!file) return;

    setUploading(true);
    setError('');

    try {
      let parsed;

      if (file.name.toLowerCase().endsWith('.epub')) {
        parsed = await parseEpub(file);
      } else if (file.name.toLowerCase().endsWith('.fb2')) {
        parsed = await parseFb2(file);
      } else {
        setError('Поддерживаются только файлы EPUB и FB2.');
        return;
      }

      const { totalPages } = paginateBook(parsed.chapters, 6);

      await saveBook({
        title: parsed.title,
        author: parsed.author,
        coverUrl: parsed.coverUrl,
        level: estimateBookLevel(parsed.chapters),
        content: parsed.chapters,
        fileSizeKb: Math.round(file.size / 1024),
        addedAt: Date.now(),
        totalPages,
      });

      await loadBooks();
    } catch (err) {
      console.error(err);
      setError('Не удалось открыть книгу. Файл может быть повреждён или не поддерживается.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async (id: number) => {
    await deleteBook(id);
    await loadBooks();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="library-page relative min-h-[100dvh] p-5 sm:p-8 lg:p-12 max-w-[1500px] mx-auto"
      style={{ '--library-photo': `url(${backgroundUrl})` } as React.CSSProperties}
    >
      <div className="absolute -top-24 -right-28 w-80 h-80 rounded-full bg-accent/25 blur-3xl pointer-events-none" />

      <div className="relative mb-10 flex flex-col xl:flex-row xl:items-end justify-between gap-7">
        <div className="max-w-2xl">
          <h1
            data-testid="text-library-title"
            className="font-editorial text-4xl sm:text-5xl font-semibold tracking-[-.04em] library-copy leading-[.98]"
          >
            Книги, к которым<br />
            <em className="library-copy not-italic">хочется вернуться</em>
          </h1>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {uploading && (
            <span
              data-testid="status-uploading"
              className="text-sm text-primary animate-pulse font-medium flex items-center gap-2"
            >
              <BookOpen size={16} />
              Добавляем книгу…
            </span>
          )}

          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            data-testid="button-add-book"
            className="flex items-center gap-2 bg-primary text-white px-5 py-3 rounded-xl font-semibold hover:bg-primary/90 transition-colors shadow-[0_8px_18px_hsl(var(--primary)/.22)] disabled:opacity-60"
          >
            <Plus size={18} />
            Добавить книгу
          </button>

          <input
            data-testid="input-book-upload"
            ref={fileInputRef}
            type="file"
            accept=".epub,.fb2"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-3 mb-6">
        <div className="inline-flex items-center gap-2 rounded-full bg-white/55 border border-black/10 px-3.5 py-2 text-xs library-copy shadow-sm">
          <BookOpen size={14} />
          <span data-testid="text-library-count">
            {books.length} {books.length === 1 ? 'книга' : 'книг'}
          </span>
        </div>
      </div>

      {error && (
        <div
          data-testid="status-library-error"
          className="mb-6 flex items-center justify-between gap-4 rounded-xl border border-destructive/25 bg-destructive/8 px-4 py-3 text-sm text-destructive"
        >
          <span>{error}</span>
          <button
            data-testid="button-retry-library"
            onClick={loadBooks}
            className="flex items-center gap-1 font-semibold"
          >
            <RefreshCw size={14} />
            Повторить
          </button>
        </div>
      )}

      {loading ? (
        <div className="book-grid">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="book-grid-skeleton">
              <div className="w-full rounded-[14px] bg-muted/70 animate-pulse aspect-[2/3.05]" />
            </div>
          ))}
        </div>
      ) : books.length > 0 ? (
        <AnimatePresence>
          <div className="book-grid">
            {books.map((item, idx) => (
              <motion.div
                key={item.book.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ delay: idx * 0.04 }}
                className="min-w-0"
              >
                <BookCard
                  book={item.book}
                  progress={item.progress}
                  onDelete={handleDelete}
                />
              </motion.div>
            ))}
          </div>
        </AnimatePresence>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 px-6 text-center rounded-2xl border border-dashed border-primary/30 bg-card/55">
          <div className="w-24 h-24 bg-secondary/60 rounded-[28px] rotate-[-4deg] flex items-center justify-center text-primary mb-5 shadow-sm">
            <BookIcon size={40} />
          </div>

          <h2
            data-testid="text-library-empty-title"
            className="font-editorial text-3xl font-semibold text-foreground mb-2"
          >
            Начните свою полку
          </h2>

          <p className="text-muted-foreground max-w-sm mb-6">
            Загрузите книгу в формате EPUB или FB2, чтобы начать читать и собирать новые слова.
          </p>

          <button
            data-testid="button-add-first-book"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-full font-medium hover:bg-primary/90 transition-colors shadow"
          >
            <Plus size={18} />
            Добавить первую книгу
          </button>
        </div>
      )}
    </motion.div>
  );
}
