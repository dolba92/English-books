import React, { useState, useEffect, useRef } from 'react';
import { Book, getAllBooks, getProgress, saveBook, deleteBook } from '@/lib/storage';
import { BookCard } from '@/components/BookCard';
import { parseEpub } from '@/lib/epub-parser';
import { parseFb2 } from '@/lib/fb2-parser';
import { paginateBook } from '@/lib/paginator';
import { Plus, Book as BookIcon, BookOpen, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import backgroundUrl from '@/assets/english-books-background.png';

function levelForBook(title: string, author: string): string {
  const levels = ['A1', 'A2', 'B1', 'B2', 'C1'];
  const source = `${title}:${author}`.toLowerCase();
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
  }
  return levels[hash % levels.length];
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
          return {
            book: { ...book, totalPages: actualPageCount },
            progress: prog?.percentComplete || 0,
          };
        })
      );
      setBooks(booksWithProgress.sort((a, b) => b.book.addedAt - a.book.addedAt));
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
      const b = await getAllBooks();
      if (b.length === 0) {
        await saveBook({
          title: "The Little Prince (Sample)",
          author: "Antoine de Saint-Exupéry",
          level: "A2",
          fileSizeKb: 10,
          addedAt: Date.now(),
           totalPages: 2,
          content: [
            {
              title: "Chapter 1",
              paragraphs: [
                "Once when I was six years old I saw a magnificent picture in a book, called True Stories from Nature, about the primeval forest. It was a picture of a boa constrictor in the act of swallowing an animal.",
                "In the book it said: \"Boa constrictors swallow their prey whole, without chewing it. After that they are not able to move, and they sleep through the six months that they need for digestion.\"",
                "I pondered deeply, then, over the adventures of the jungle. And after some work with a colored pencil I succeeded in making my first drawing. My Drawing Number One.",
                "I showed my masterpiece to the grown-ups, and asked them whether the drawing frightened them. But they answered: \"Frighten? Why should any one be frightened by a hat?\"",
                "My drawing was not a picture of a hat. It was a picture of a boa constrictor digesting an elephant. But since the grown-ups were not able to understand it, I made another drawing.",
              ]
            },
            {
              title: "Chapter 2",
              paragraphs: [
                "So I lived my life alone, without anyone that I could really talk to, until I had an accident with my plane in the Desert of Sahara, six years ago.",
                "Something was broken in my engine. And as I had with me neither a mechanic nor any passengers, I set myself to attempt the difficult repairs all alone.",
                "It was a question of life or death for me: I had scarcely enough drinking water to last a week.",
                "The first night, then, I went to sleep on the sand, a thousand miles from any human habitation. I was more isolated than a shipwrecked sailor on a raft in the middle of the ocean.",
                "Thus you can imagine my amazement, at sunrise, when I was awakened by an odd little voice. It said: \"If you please — draw me a sheep!\"",
              ]
            }
          ]
        });
        loadBooks();
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
      if (file.name.endsWith('.epub')) {
        parsed = await parseEpub(file);
      } else if (file.name.endsWith('.fb2')) {
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
        level: levelForBook(parsed.title, parsed.author),
        content: parsed.chapters,
        fileSizeKb: Math.round(file.size / 1024),
        addedAt: Date.now(),
        totalPages,
      });

      await loadBooks();
    } catch (err) {
      console.error(err);
      setError("Не удалось открыть книгу. Файл может быть повреждён или не поддерживается.");
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
             <h1 data-testid="text-library-title" className="font-editorial text-4xl sm:text-5xl font-semibold tracking-[-.04em] library-copy leading-[.98]">Книги, к которым<br /><em className="library-copy not-italic">хочется вернуться</em></h1>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {uploading && (
            <span data-testid="status-uploading" className="text-sm text-primary animate-pulse font-medium flex items-center gap-2"><BookOpen size={16} /> Добавляем книгу…</span>
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
           <input data-testid="input-book-upload"
            ref={fileInputRef}
            type="file"
            accept=".epub,.fb2"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])}
          />
        </div>
      </div>

       <div className="flex flex-wrap gap-3 mb-6">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/55 border border-black/10 px-3.5 py-2 text-xs library-copy shadow-sm"><BookOpen size={14} /><span data-testid="text-library-count">{books.length} {books.length === 1 ? 'книга' : 'книг'}</span></div>
       </div>
      {error && (
        <div data-testid="status-library-error" className="mb-6 flex items-center justify-between gap-4 rounded-xl border border-destructive/25 bg-destructive/8 px-4 py-3 text-sm text-destructive">
          <span>{error}</span><button data-testid="button-retry-library" onClick={loadBooks} className="flex items-center gap-1 font-semibold"><RefreshCw size={14} /> Повторить</button>
        </div>
      )}
      {loading ? (
        <div className="book-grid">
          {[1, 2, 3, 4, 5].map(i => (
             <div key={i} className="book-grid-skeleton"><div className="w-full rounded-[14px] bg-muted/70 animate-pulse aspect-[2/3.05]" /></div>
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
          <h2 data-testid="text-library-empty-title" className="font-editorial text-3xl font-semibold text-foreground mb-2">Начните свою полку</h2>
          <p className="text-muted-foreground max-w-sm mb-6">
            Загрузите книгу в формате EPUB или FB2, чтобы начать читать и собирать новые слова.
          </p>
           <button data-testid="button-add-first-book"
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
