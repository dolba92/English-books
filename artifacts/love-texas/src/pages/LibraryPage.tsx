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

const CEFR_COMMON_WORDS = new Set(
  `
  the be to of and a in that have i it for not on with he as you do at this but
  his by from they we say her she or an will my one all would there their what so
  up out if about who get which go me when make can like time no just him know take
  people into year your good some could them see other than then now look only come
  its over think also back after use two how our work first well way even new want
  because these give day most us is are was were been being am has had having does
  did doing went gone going made making came coming saw seen got getting took taken
  taking said saying thought thinking knew known knowing gave given giving found
  finding felt feeling left leaving put keep kept keeping let begin began begun
  seem help talk turn start show hear heard play run move live believe bring happen
  write sit stand lose pay meet include continue set learn change lead understand
  watch follow stop create speak read allow add spend grow open walk win offer
  remember love consider appear buy wait serve die send expect build stay fall cut
  reach kill remain suggest raise pass sell require report decide pull return explain
  hope develop carry break receive agree support hit produce eat cover catch draw
  choose cause point listen realize place close involve increase improve join pick
  wear drive sleep drink try need feel become leave call ask tell find give
  man woman child children boy girl person family mother father sister brother friend
  house home room school book word water food night morning day week world life hand
  eye face head name thing place door car road town country question problem story
  money job side kind lot end enough little long great old young big small high low
  right wrong same different important possible sure happy sorry afraid angry
  beautiful hard easy early late near far together again always never often sometimes
  very really too more less many much few another every each both own such still
  already almost perhaps maybe here there where why how before after during without
  under above between around through against while until since once
  `.trim().split(/\s+/)
);

const CEFR_ADVANCED_HINTS = new Set(
  `
  notwithstanding nevertheless consequently furthermore moreover whereas whereby
  albeit henceforth thereby therein insofar ostensibly presumably subsequently
  unprecedented inevitable sophisticated substantial considerable significant
  controversial conventional phenomenon perspective implication circumstance
  acquisition acknowledge demonstrate establish constitute indicate interpret
  perceive pursue require sufficient undertake retain emerge encounter
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
  // CEFR cannot be measured perfectly from prose alone. This is a deliberately
  // conservative heuristic: readability + vocabulary difficulty + sentence complexity.
  // Most native novels should land around B1-C1, not automatically C2.
  const MAX_WORDS = 30000;
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

  const sentenceMatches =
    text.match(/[^.!?]+[.!?]+(?:["'’”)]|$)?/g) ||
    text.split(/[.!?]+/).filter((part) => part.trim().length > 0);
  const sentenceCount = Math.max(1, sentenceMatches.length);

  let syllables = 0;
  let longWords = 0;
  let veryLongWords = 0;
  let uncommonWords = 0;
  let advancedHints = 0;

  for (const word of words) {
    syllables += countSyllables(word);
    if (word.length >= 8) longWords += 1;
    if (word.length >= 11) veryLongWords += 1;

    // Ignore proper-name-like noise indirectly by only treating alphabetic,
    // reasonably long vocabulary as evidence of lexical difficulty.
    if (word.length >= 7 && !CEFR_COMMON_WORDS.has(word)) uncommonWords += 1;
    if (CEFR_ADVANCED_HINTS.has(word)) advancedHints += 1;
  }

  const avgSentenceLength = words.length / sentenceCount;
  const avgSyllablesPerWord = syllables / words.length;
  const longWordRatio = longWords / words.length;
  const veryLongWordRatio = veryLongWords / words.length;
  const uncommonRatio = uncommonWords / words.length;
  const advancedRatio = advancedHints / words.length;

  const flesch =
    206.835 -
    1.015 * avgSentenceLength -
    84.6 * avgSyllablesPerWord;

  // Convert several independent signals to one 0..100 difficulty score.
  // Flesch alone is too harsh for fiction and was the main reason books became C2.
  let score = 0;

  if (flesch < 90) score += Math.min(28, (90 - flesch) * 0.42);
  score += Math.min(24, Math.max(0, avgSentenceLength - 8) * 1.15);
  score += Math.min(18, Math.max(0, avgSyllablesPerWord - 1.25) * 45);
  score += Math.min(12, longWordRatio * 55);
  score += Math.min(8, veryLongWordRatio * 80);
  score += Math.min(8, uncommonRatio * 22);
  score += Math.min(6, advancedRatio * 700);

  // CEFR bands are intentionally wide at the top. C2 should be exceptional.
  if (score < 22) return 'A1';
  if (score < 31) return 'A2';
  if (score < 43) return 'B1';
  if (score < 56) return 'B2';
  if (score < 72) return 'C1';
  return 'C2';
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
