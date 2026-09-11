import { useEffect, useState } from 'react';
import { BarChart3, BookOpen, Clock3, LibraryBig, Sparkles } from 'lucide-react';
import { Book, BookProgress, getAllBooks, getAllProgress, getDictionaryWords } from '@/lib/storage';

export function StatsPage() {
  const [books, setBooks] = useState<Book[]>([]);
  const [progress, setProgress] = useState<BookProgress[]>([]);
  const [wordCount, setWordCount] = useState(0);

  useEffect(() => {
    Promise.all([getAllBooks(), getAllProgress(), getDictionaryWords()]).then(([loadedBooks, loadedProgress, words]) => {
      setBooks(loadedBooks);
      setProgress(loadedProgress);
      setWordCount(words.length);
    });
  }, []);

  const progressByBook = new Map(progress.map(item => [item.bookId, item]));
  const pagesRead = progress.reduce((sum, item) => sum + (item.totalPagesRead || item.currentPage || 0), 0);
  const completed = progress.filter(item => item.percentComplete >= 99).length;
  const active = progress.filter(item => item.percentComplete > 0 && item.percentComplete < 99).length;
  const readingDays = new Set(progress.filter(item => item.lastReadAt).map(item => new Date(item.lastReadAt).toDateString())).size;

  return (
    <div className="page-container max-w-5xl">
      <header className="mb-8">
        <h1 className="font-editorial text-4xl font-bold text-foreground">Прогресс</h1>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        <div className="metric-card"><BookOpen size={18} /><strong>{books.length}</strong><span>книг в библиотеке</span></div>
        <div className="metric-card"><LibraryBig size={18} /><strong>{active}</strong><span>книг в процессе</span></div>
        <div className="metric-card"><BarChart3 size={18} /><strong>{pagesRead}</strong><span>прочитано страниц</span></div>
        <div className="metric-card"><Sparkles size={18} /><strong>{wordCount}</strong><span>сохранённых слов</span></div>
      </div>

      <section className="settings-section">
        <div className="settings-section-title">
          <Clock3 size={18} className="text-primary" />
          <div>
            <h2>Чтение</h2>
            <p>{readingDays ? `${readingDays} ${readingDays === 1 ? 'день' : 'дней'} с активным чтением` : 'Начните читать, чтобы здесь появился прогресс.'}</p>
          </div>
        </div>
        {books.length === 0 ? (
          <div className="empty-state">В библиотеке пока нет книг.</div>
        ) : (
          <div className="space-y-3">
            {books.map(book => {
              const item = progressByBook.get(book.id!);
              const percent = Math.round(item?.percentComplete || 0);
              return (
                <div key={book.id} className="progress-row">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-semibold truncate">{book.title}</span>
                      <span className="text-xs text-muted-foreground shrink-0">{percent}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden mt-2">
                      <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${percent}%` }} />
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">{item ? `${item.currentPage + 1} / ${book.totalPages}` : 'Не начата'}</span>
                </div>
              );
            })}
          </div>
        )}
        {completed > 0 && <p className="text-sm text-muted-foreground mt-5">Завершено книг: {completed}</p>}
      </section>
    </div>
  );
}