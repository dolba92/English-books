import { Book } from '@/lib/storage';
import { Link, useLocation } from 'wouter';
import { Play, Trash2, FileText, ArrowUpRight, BookOpen } from 'lucide-react';
import { motion } from 'framer-motion';

interface BookCardProps {
  book: Book;
  progress?: number;
  onDelete?: (id: number) => void;
}

export function BookCard({ book, progress = 0, onDelete }: BookCardProps) {
  const [, navigate] = useLocation();
  const levelColors: Record<string, string> = {
    A1: 'bg-[#f3e4cf] text-[#5b3827] border-[#c99d76]',
    A2: 'bg-[#f2d1dc] text-[#6b3045] border-[#cf8da4]',
    B1: 'bg-[#ead8ef] text-[#5b3d70] border-[#b995c9]',
    B2: 'bg-[#f4d9c9] text-[#6e3420] border-[#d69b7e]',
    C1: 'bg-[#d9e5df] text-[#294c3c] border-[#8fb2a1]',
    C2: 'bg-[#d5e0ef] text-[#29466b] border-[#8ca9cf]',
  };

  const badgeColor = levelColors[book.level] || levelColors['B1'];
  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (book.id !== undefined && onDelete) {
      if (window.confirm(`Удалить «${book.title}» с полки?`)) onDelete(book.id);
    }
  };

  return (
    <motion.div
      whileHover={{ y: -4 }}
      transition={{ duration: 0.2 }}
      className="group flex w-full min-w-0 flex-col rounded-[16px] overflow-hidden bg-white/28 backdrop-blur-[18px] backdrop-saturate-[135%] shadow-[0_8px_24px_rgba(57,35,26,.10),inset_0_1px_0_rgba(255,255,255,.55)] hover:shadow-[0_14px_32px_rgba(57,35,26,.16),inset_0_1px_0_rgba(255,255,255,.65)] border border-white/55 transition-shadow cursor-pointer text-black"
      data-testid={`card-book-${book.id}`}
      role="link"
      tabIndex={0}
      onClick={() => navigate(`/reader/${book.id}`)}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); navigate(`/reader/${book.id}`); } }}
    >
      {/* Cover */}
      <div className="relative w-full aspect-[2/3] overflow-hidden bg-muted/40">
        <div className="absolute inset-0 book-spine">
          {book.coverUrl ? (
            <img
              src={book.coverUrl}
              alt={book.title}
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center bg-[radial-gradient(circle_at_28%_18%,hsl(var(--accent)/.5),transparent_30%),linear-gradient(145deg,hsl(var(--secondary)),hsl(var(--primary)/.2))] p-5 text-center">
              <BookOpen size={34} className="text-black/75 mb-4" />
              <span className="font-editorial text-lg font-semibold text-black/85 leading-tight line-clamp-3">{book.title}</span>
              <span className="text-[11px] font-medium text-black/65 mt-3 line-clamp-2">{book.author}</span>
            </div>
          )}

          {/* Level badge */}
          <div className="absolute top-2 right-2">
            <span data-testid={`badge-level-${book.id}`} className={`px-2 py-0.5 text-[11px] font-bold rounded-full border shadow-sm ${badgeColor}`}>
              {book.level || 'B1'}
            </span>
          </div>

          {/* Hover overlay */}
          <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity flex items-center justify-center gap-2" onClick={event => event.stopPropagation()}>
            <Link
              href={`/reader/${book.id}`}
              data-testid={`btn-read-${book.id}`}
              className="w-10 h-10 rounded-full bg-white/70 backdrop-blur-xl text-black flex items-center justify-center shadow hover:scale-110 transition-transform border border-white/60"
            >
              <Play size={18} className="ml-0.5" fill="currentColor" />
            </Link>
            <button
              onClick={handleDelete}
              data-testid={`btn-delete-${book.id}`}
              className="w-10 h-10 rounded-full bg-white/70 backdrop-blur-xl text-destructive flex items-center justify-center shadow hover:scale-110 transition-transform border border-white/60"
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Info */}
      <div className="p-2.5 flex flex-col gap-1 bg-white/10 text-black">
        <h3 data-testid={`text-book-title-${book.id}`} className="font-editorial font-semibold text-[15px] text-black line-clamp-1" title={book.title}>
          {book.title}
        </h3>
        <p data-testid={`text-book-author-${book.id}`} className="text-xs text-black/70 line-clamp-1">{book.author}</p>

        <div className="mt-2">
          <div className="flex justify-between text-[11px] text-black/65 mb-1.5">
            <span className="flex items-center gap-1"><FileText size={12} />{book.totalPages} страниц</span>
            <span data-testid={`text-book-progress-${book.id}`}>{Math.round(progress)}%</span>
          </div>
          <div className="w-full bg-white/35 rounded-full h-1.5 overflow-hidden" aria-label={`Прогресс ${Math.round(progress)} процентов`}>
            <div
              className="bg-primary h-full rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
        <Link onClick={event => event.stopPropagation()} href={`/reader/${book.id}`} data-testid={`link-open-book-${book.id}`} className="mt-2 text-xs font-semibold text-black flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
          {progress > 0 ? 'Продолжить чтение' : 'Открыть книгу'} <ArrowUpRight size={13} />
        </Link>
      </div>
    </motion.div>
  );
}
