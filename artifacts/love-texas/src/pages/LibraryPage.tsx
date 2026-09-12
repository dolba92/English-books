import React, { useEffect, useRef, useState } from 'react';
import { Book, deleteBook, getAllBooks, getProgress, saveBook } from '@/lib/storage';
import { BookCard } from '@/components/BookCard';
import { parseEpub } from '@/lib/epub-parser';
import { parseFb2 } from '@/lib/fb2-parser';
import { paginateBook } from '@/lib/paginator';
import { analyzeBookLevel, BookLevelAnalysis } from '@/lib/book-level';
import { Book as BookIcon, BookOpen, Plus, RefreshCw } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import backgroundUrl from '@/assets/english-books-background.png';

type LibraryItem = {
  book: Book;
  progress: number;
  analysis: BookLevelAnalysis;
};

export function LibraryPage() {
  const [books, setBooks] = useState<LibraryItem[]>([]);
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
          const levelAnalysis = analyzeBookLevel(book.content);

          const updatedBook: Book = {
            ...book,
            totalPages: actualPageCount,
            level: levelAnalysis.level,
          };

          return {
            book: updatedBook,
            progress: prog?.percentComplete || 0,
            analysis: levelAnalysis,
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
          level: analyzeBookLevel(sampleContent).level,
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
      const levelAnalysis = analyzeBookLevel(parsed.chapters);

      await saveBook({
        title: parsed.title,
        author: parsed.author,
        coverUrl: parsed.coverUrl,
        level: levelAnalysis.level,
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

        <div className="inline-flex items-center rounded-full bg-amber-50/85 border border-amber-200 px-3.5 py-2 text-xs text-amber-950 shadow-sm">
          Диагностика CEFR включена
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

                <div className="mt-2 rounded-xl border border-black/10 bg-white/90 p-2.5 text-[10px] leading-[1.35] text-stone-700 shadow-sm">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <strong className="text-[11px] text-stone-900">
                      CEFR: {item.analysis.level}
                    </strong>
                    <strong className="text-[11px] text-fuchsia-800">
                      score {item.analysis.score}
                    </strong>
                  </div>

                  <div>
                    sentences: <b>{item.analysis.averageSentenceLength}</b>
                  </div>
                  <div>
                    word length: <b>{item.analysis.averageWordLength}</b>
                  </div>
                  <div>
                    long words: <b>{(item.analysis.longWordRatio * 100).toFixed(1)}%</b>
                  </div>
                  <div>
                    advanced: <b>{(item.analysis.advancedWordRatio * 100).toFixed(1)}%</b>
                  </div>
                  <div>
                    diversity: <b>{item.analysis.lexicalDiversity}</b>
                  </div>
                  <div>
                    sample: <b>{item.analysis.sampledWords}</b> words
                  </div>
                </div>
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
