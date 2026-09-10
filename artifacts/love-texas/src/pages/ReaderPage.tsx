import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useParams, Link } from 'wouter';
import { Book, getBook, getProgress, saveProgress, addWordToDictionary } from '@/lib/storage';
import { paginateBook } from '@/lib/paginator';
import { useReaderSettings } from '@/contexts/ReaderSettingsContext';
import { getFontCss } from '@/lib/fonts';
import { lookupWord, translateSentence, WordInfo, RuGroup } from '@/lib/wordlookup';
import {
  ArrowLeft, ChevronLeft, ChevronRight, Settings, X, Plus,
  Loader2, List, BookOpen, Languages, Microscope, Volume2
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { speak } from '@/lib/speech';
import { useToast } from '@/hooks/use-toast';

// ── Grammar Analyser ─────────────────────────────────────────────────────────
interface GrammarInfo {
  sentenceType: string;
  tense: string;
  voice: string;
  constructions: string[];
  tip: string;
}

function analyzeGrammar(sentence: string): GrammarInfo {
  const s = sentence.toLowerCase().trim();
  const raw = s.replace(/[.,!?;:"'()[\]{}—…«»]/g, ' ');
  const words = raw.split(/\s+/).filter(Boolean);

  const sentenceType = s.endsWith('?') ? 'Вопросительное' : s.endsWith('!') ? 'Восклицательное' : 'Утвердительное';
  const modalList = ['can', 'could', 'will', 'would', 'shall', 'should', 'may', 'might', 'must', 'need', 'ought'];
  const modals = modalList.filter(m => words.includes(m));
  const beVerbs = ['am', 'is', 'are', 'was', 'were', 'been', 'being', 'be'];
  const hasBeVerb = beVerbs.some(v => words.includes(v));
  const ingForm = /\b\w+ing\b/.test(raw);
  const edForm = /\b\w+ed\b/.test(raw);
  const irregulars = ['written','spoken','taken','given','known','shown','seen','done','gone','come','run','brought','thought','bought','caught','taught','built','made','said','told','found','heard','left','led','lost','met','read','sent','set','cut','put','let','hit'];
  const hasPP = edForm || irregulars.some(v => words.includes(v));
  const isPassive = hasBeVerb && hasPP && !ingForm;
  const voice = isPassive ? 'Страдательный залог (Passive Voice)' : 'Действительный залог (Active Voice)';
  const has = (w: string) => words.includes(w);
  let tense = 'Present Simple';
  if (has('will') || has('shall')) { tense = ingForm ? 'Future Continuous' : 'Future Simple'; }
  else if ((has('is') || has('am') || has('are')) && ingForm && !isPassive) { tense = 'Present Continuous'; }
  else if ((has('was') || has('were')) && ingForm && !isPassive) { tense = 'Past Continuous'; }
  else if (has('had') && hasPP) { tense = 'Past Perfect'; }
  else if ((has('have') || has('has')) && hasPP) { tense = ingForm ? 'Present Perfect Continuous' : 'Present Perfect'; }
  else if ((has('was') || has('were')) && isPassive) { tense = 'Past Simple (Passive)'; }
  else if (has('was') || has('were')) { tense = 'Past Simple (to be)'; }
  else if (edForm || has('did')) { tense = 'Past Simple'; }
  const constructions: string[] = [];
  if (/\bthere (is|are|was|were)\b/.test(s)) constructions.push('there is/are — оборот существования');
  if (/\bit (is|was|seems|appears)\b/.test(s)) constructions.push('it is — безличный оборот');
  if (/\bif\b/.test(s)) constructions.push('Условное предложение (Conditional)');
  if (/\bbecause\b/.test(s)) constructions.push('Придаточное причины (because)');
  if (/\bwhen\b|\bwhile\b/.test(s)) constructions.push('Придаточное времени (when/while)');
  if (/\b(which|who|whom|whose|that)\b/.test(s)) constructions.push('Определительное придаточное (Relative clause)');
  if (/\bnot\b|n't\b/.test(s)) constructions.push('Отрицание (Negation)');
  if (modals.length > 0) constructions.push(`Модальный глагол: ${modals.join(', ')}`);
  const tips: Record<string, string> = {
    'Present Simple': 'Регулярные действия, факты. Образование: S + V(s).',
    'Present Continuous': 'Действие прямо сейчас. Образование: am/is/are + Ving.',
    'Present Perfect': 'Завершено, результат важен сейчас. Образование: have/has + V3.',
    'Past Simple': 'Завершённое действие в прошлом. Образование: V2 (или did + V).',
    'Past Continuous': 'В определённый момент прошлого. Образование: was/were + Ving.',
    'Past Perfect': 'Раньше другого прошедшего. Образование: had + V3.',
    'Future Simple': 'Предсказание или спонтанное решение. Образование: will + V.',
    'Future Continuous': 'Будет происходить в определённый момент. Образование: will be + Ving.',
  };
  return { sentenceType, tense, voice, constructions, tip: tips[tense] || '' };
}

// ── Sentence splitter ────────────────────────────────────────────────────────
function splitSentences(text: string): string[] {
  const results: string[] = [];
  const re = /[^.!?]*(?:[.!?]+["'»]?\s*)/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0].trim()) results.push(m[0]);
    lastIndex = re.lastIndex;
  }
  if (lastIndex < text.length) {
    const tail = text.slice(lastIndex).trim();
    if (tail) results.push(tail);
  }
  return results.length > 0 ? results : [text];
}

interface PageData { title: string; paragraphs: string[]; isChapterStart: boolean; }
interface TocEntry { title: string; pageIdx: number; }

// ── Word Tooltip ─────────────────────────────────────────────────────────────
interface TooltipState {
  word: string;
  x: number; y: number;
  info: WordInfo | null;
  loading: boolean;
}

function WordTooltip({
  state, onMouseEnter, onMouseLeave, onAdd,
}: {
  state: TooltipState;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onAdd: (word: string, translation: string) => void;
}) {
  const { word, x, y, info, loading } = state;
  const translation = info?.translation ?? '';
  const groups: RuGroup[] = info?.groups ?? [];
  const [selectedGroup, setSelectedGroup] = React.useState(0);

  React.useEffect(() => {
    setSelectedGroup(0);
  }, [word]);

  // Keep only real Russian variants and remove the main translation from alternatives.
  const isCyrillic = (s: string) => /[а-яёА-ЯЁ]/.test(s);
  const cleanVariants = (words: string[]) => {
    const seen = new Set<string>();
    return words
      .map(w => w.trim())
      .filter(w => w.length > 1 && isCyrillic(w))
      .filter(w => {
        const low = w.toLowerCase();
        if (low === translation.toLowerCase() || seen.has(low)) return false;
        seen.add(low);
        return true;
      });
  };
  const activeGroup = groups[selectedGroup] ?? groups[0];
  const activeVariants = activeGroup ? cleanVariants(activeGroup.words) : [];

  // Clamp tooltip so it doesn't go off-screen left/right
  const safeX = Math.max(148, Math.min(window.innerWidth - 148, x));

  return (
    <motion.div
      initial={{ opacity: 0, y: 6, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.96 }}
      transition={{ duration: 0.12 }}
      className="fixed z-50 pointer-events-auto"
      style={{ left: safeX, top: y, transform: 'translate(-50%, -100%)' }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="bg-card border border-border shadow-2xl rounded-2xl w-[min(18rem,calc(100vw-2rem))] overflow-hidden">
        {/* Header: word + speak button */}
        <div className="flex items-center gap-2 px-4 pt-4 pb-1">
          <span className="flex-1 font-bold text-xl text-foreground leading-tight">{word}</span>
           <button data-testid="button-speak-word" aria-label={`Произнести ${word}`}
            onClick={e => { e.stopPropagation(); speak(word); }}
            className="p-1.5 bg-muted text-muted-foreground hover:text-primary rounded-full transition-colors shrink-0"
          >
            <Volume2 size={14} />
          </button>
        </div>

        {/* Phonetic */}
        {info?.phonetic && (
          <div className="px-4 pb-1">
            <span className="text-xs text-muted-foreground font-mono">[{info.phonetic}]</span>
          </div>
        )}

        {/* Body */}
        <div className="px-4 pb-3">
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm py-2">
              <Loader2 size={13} className="animate-spin" />Ищем перевод…
            </div>
          ) : translation ? (
            <div className="mt-1 space-y-1">
              {/* Primary translation — bold */}
              <p data-testid="text-word-main-translation" className="text-base font-bold text-foreground">{translation}</p>
              {/* Parts of speech are selectable when the dictionary has several groups */}
              {groups.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-2">
                  {groups.map((group, index) => (
                    <button
                      key={`${group.pos}-${index}`}
                      type="button"
                      data-testid={`button-word-pos-${index}`}
                      onClick={e => { e.stopPropagation(); setSelectedGroup(index); }}
                      className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                        selectedGroup === index
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {group.pos}
                    </button>
                  ))}
                </div>
              )}
              {/* Secondary meanings from the selected part of speech */}
              {activeVariants.length > 0 && (
                <p data-testid="text-word-secondary-translations" className="text-sm italic text-foreground/65 leading-snug pt-1">
                  {activeVariants.join(', ')}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic py-2">Перевод не найден</p>
          )}
        </div>

        {/* Add to dictionary */}
        <div className="px-3 pb-3">
           <button data-testid="button-add-word" aria-label="Добавить слово в словарь"
            disabled={loading || !translation}
            onClick={() => onAdd(word, translation)}
            className="w-full flex items-center justify-center gap-1.5 bg-primary/10 text-primary font-medium py-2 rounded-xl hover:bg-primary/20 transition-colors text-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus size={14} /> В словарь
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ── Component ────────────────────────────────────────────────────────────────
export function ReaderPage() {
  const params = useParams();
  const id = parseInt(params.id || '0', 10);
  const { settings } = useReaderSettings();
  const { toast } = useToast();
  const customBackgroundColor = settings.backgroundColor === '#f0c8d5' ? undefined : settings.backgroundColor;

  const [book, setBook] = useState<Book | null>(null);
  const [pages, setPages] = useState<PageData[]>([]);
  const [currentPageIdx, setCurrentPageIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);

  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const [selectedSentence, setSelectedSentence] = useState<string | null>(null);
  const [sentenceTranslation, setSentenceTranslation] = useState<string | null>(null);
  const [sentenceGrammar, setSentenceGrammar] = useState<GrammarInfo | null>(null);
  const [translating, setTranslating] = useState(false);
  const [panelTab, setPanelTab] = useState<'translate' | 'grammar'>('translate');

  const [showToc, setShowToc] = useState(false);
  const [showHint, setShowHint] = useState(() => !localStorage.getItem('reader-hint-dismissed'));
  const [jumpValue, setJumpValue] = useState('');
  const [editingPage, setEditingPage] = useState(false);

  const saveProgressRef = useRef(saveProgress);
  saveProgressRef.current = saveProgress;

  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const load = async () => {
      const b = await getBook(id);
      if (b) {
        setBook(b);
        const isMobile = window.innerWidth < 640;
        const { paginatedChapters } = paginateBook(
          b.content,
          isMobile ? 4 : 6,
          isMobile ? 1700 : 2300,
        );
        const flat: PageData[] = [];
        paginatedChapters.forEach(ch => {
          ch.pages.forEach((p, pi) => flat.push({ title: ch.title, paragraphs: p, isChapterStart: pi === 0 }));
        });
        setPages(flat);
        const prog = await getProgress(id);
        if (prog && prog.currentPage < flat.length) setCurrentPageIdx(prog.currentPage);
      }
      setLoading(false);
    };
    load();
  }, [id]);

  useEffect(() => {
    if (!book || pages.length === 0) return;
    const timer = setTimeout(() => {
      const pct = (currentPageIdx / (pages.length - 1 || 1)) * 100;
      saveProgressRef.current({ bookId: id, currentChapterIndex: 0, currentPage: currentPageIdx, totalPagesRead: currentPageIdx, lastReadAt: Date.now(), percentComplete: pct });
    }, 1000);
    return () => clearTimeout(timer);
  }, [currentPageIdx, book, pages.length, id]);

  const tocEntries: TocEntry[] = useMemo(() => {
    const entries: TocEntry[] = [];
    pages.forEach((p, idx) => { if (p.isChapterStart) entries.push({ title: p.title, pageIdx: idx }); });
    return entries;
  }, [pages]);

  const activeChapterIdx = useMemo(() => {
    let active = 0;
    for (let i = 0; i < tocEntries.length; i++) {
      if (tocEntries[i].pageIdx <= currentPageIdx) active = i;
    }
    return active;
  }, [tocEntries, currentPageIdx]);

  const closeSentencePanel = () => {
    setSelectedSentence(null); setSentenceTranslation(null); setSentenceGrammar(null);
  };

  const handleNext = useCallback(() => {
    if (currentPageIdx < pages.length - 1) { setCurrentPageIdx(p => p + 1); closeSentencePanel(); }
  }, [currentPageIdx, pages.length]);

  const handlePrev = useCallback(() => {
    if (currentPageIdx > 0) { setCurrentPageIdx(p => p - 1); closeSentencePanel(); }
  }, [currentPageIdx]);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'ArrowRight') handleNext(); if (e.key === 'ArrowLeft') handlePrev(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [handleNext, handlePrev]);

  // ── Word hover ───────────────────────────────────────────────────────────
  const handleWordMouseEnter = (e: React.MouseEvent<HTMLSpanElement>, rawWord: string) => {
    const word = rawWord.replace(/[^a-zA-Z'-]/g, '').toLowerCase().trim();
    if (!word || word.length < 2) return;

    clearTimeout(hoverTimeoutRef.current);
    clearTimeout(hideTimeoutRef.current);

    const rect = e.currentTarget.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top - 8;

    hoverTimeoutRef.current = setTimeout(async () => {
      setTooltip({ word, x, y, info: null, loading: true });
      const info = await lookupWord(word);
      setTooltip(prev => prev?.word === word ? { ...prev, info, loading: false } : prev);
    }, 400);
  };

  const handleWordMouseLeave = () => {
    clearTimeout(hoverTimeoutRef.current);
    hideTimeoutRef.current = setTimeout(() => setTooltip(null), 300);
  };

  const handleAddWord = async (word: string, translation: string, pos?: string) => {
    await addWordToDictionary(word, translation, undefined, pos);
    toast({ title: 'Добавлено в словарь', description: `"${word}" → ${translation}`, duration: 2000 });
    setTooltip(null);
  };

  // ── Sentence click ───────────────────────────────────────────────────────
  const handleSentenceClick = async (sentence: string) => {
    const text = sentence.trim();
    if (!text) return;
    setTooltip(null);
    setSelectedSentence(text);
    setSentenceTranslation(null);
    setSentenceGrammar(analyzeGrammar(text));
    setPanelTab('translate');
    setTranslating(true);
    if (showHint) { setShowHint(false); localStorage.setItem('reader-hint-dismissed', '1'); }
    try {
      const result = await translateSentence(text);
      setSentenceTranslation(result);
    } catch {
      setSentenceTranslation('Не удалось получить перевод. Проверьте интернет-соединение.');
    } finally {
      setTranslating(false);
    }
  };

  // ── Page jump ────────────────────────────────────────────────────────────
  const handleJumpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = parseInt(jumpValue, 10);
    if (!isNaN(n) && n >= 1 && n <= pages.length) { setCurrentPageIdx(n - 1); closeSentencePanel(); }
    setEditingPage(false); setJumpValue('');
  };

  if (loading) return <div data-testid="status-reader-loading" className="min-h-[100dvh] flex flex-col items-center justify-center gap-3 text-muted-foreground"><div className="h-8 w-8 rounded-full border-2 border-primary/25 border-t-primary animate-spin" /><span>Открываем книгу…</span></div>;
  if (!book || pages.length === 0) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4">
      <p className="text-muted-foreground text-lg">В книге нет читаемого текста.</p>
      <Link href="/" className="text-primary underline">← Назад в библиотеку</Link>
    </div>
  );

  const page = pages[currentPageIdx];
  const percent = ((currentPageIdx + 1) / pages.length) * 100;
  const widthClass = settings.pageWidth === 'narrow' ? 'max-w-xl' : settings.pageWidth === 'wide' ? 'max-w-4xl' : 'max-w-2xl';
  const fontCss = getFontCss(settings.fontFamily);
  const isMobile = viewportWidth < 640;
  const readerFontSize = isMobile ? Math.min(settings.fontSize, 16) : settings.fontSize;
  const readerLineHeight = isMobile ? Math.min(settings.lineHeight, 1.5) : settings.lineHeight;

  return (
    <div className="min-h-0 h-[calc(100dvh-64px)] md:min-h-[100dvh] md:h-[100dvh] bg-background text-foreground flex flex-col selection:bg-primary/20 overflow-hidden" style={customBackgroundColor ? { backgroundColor: customBackgroundColor } : undefined}>
      <header className="h-14 flex items-center justify-between px-4 border-b border-border/40 shrink-0 sticky top-0 bg-background/90 backdrop-blur-md z-20">
        <div className="flex items-center gap-2">
          <Link href="/" data-testid="link-reader-library" aria-label="Вернуться в библиотеку" className="text-muted-foreground hover:text-foreground transition-colors p-2 rounded-full hover:bg-muted">
            <ArrowLeft size={20} />
          </Link>
          <button data-testid="button-reader-toc" aria-label="Открыть оглавление" onClick={() => setShowToc(v => !v)}
            className={`p-2 rounded-full transition-colors ${showToc ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}>
            <List size={20} />
          </button>
          <div className="hidden md:block ml-1">
            <h1 className="font-bold text-sm leading-tight">{book.title}</h1>
            <p className="text-xs text-muted-foreground">{book.author}</p>
          </div>
        </div>
        <div className="flex-1 max-w-md mx-8 hidden md:flex items-center gap-3">
           <span data-testid="text-reader-percent" className="text-xs text-muted-foreground whitespace-nowrap">{Math.round(percent)}%</span>
          <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary transition-all duration-300" style={{ width: `${percent}%` }} />
          </div>
        </div>
         <Link href="/settings" data-testid="link-reader-settings" aria-label="Настройки чтения" className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-full">
          <Settings size={20} />
        </Link>
      </header>

      <div className="flex flex-1 overflow-hidden relative">
        {/* TOC */}
        <AnimatePresence>
          {showToc && (
            <motion.aside key="toc" initial={{ x: -300 }} animate={{ x: 0 }} exit={{ x: -300 }}
              transition={{ type: 'spring', stiffness: 320, damping: 32 }}
               className="fixed left-0 top-14 bottom-0 w-[280px] max-w-[calc(100vw-24px)] bg-card border-r border-border flex flex-col z-30 shadow-xl">
              <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
                <span className="font-semibold text-sm flex items-center gap-2"><BookOpen size={15} className="text-primary" />Оглавление</span>
                 <button data-testid="button-close-toc" aria-label="Закрыть оглавление" onClick={() => setShowToc(false)} className="p-1.5 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground"><X size={16} /></button>
              </div>
              <div className="flex-1 overflow-y-auto py-2">
                {tocEntries.length === 0
                  ? <p className="text-sm text-muted-foreground text-center py-8">Нет глав</p>
                  : tocEntries.map((entry, i) => (
                     <button data-testid={`button-toc-chapter-${i}`} key={i} onClick={() => { setCurrentPageIdx(entry.pageIdx); closeSentencePanel(); setShowToc(false); }}
                      className={`w-full text-left px-4 py-2.5 text-sm transition-colors hover:bg-muted/70 flex items-start gap-3 ${i === activeChapterIdx ? 'text-primary font-semibold bg-primary/5' : 'text-foreground/80'}`}>
                      <span className="text-xs text-muted-foreground mt-0.5 shrink-0 w-5 text-right">{i + 1}</span>
                       <span className="leading-snug flex-1">{entry.title || `Глава ${i + 1}`}</span>
                       <span className="font-mono-app text-[10px] text-muted-foreground/70">{entry.pageIdx + 1}</span>
                    </button>
                  ))}
              </div>
              <div className="p-4 border-t border-border shrink-0">
                <p className="text-xs text-muted-foreground mb-2">Перейти на страницу</p>
                <form onSubmit={handleJumpSubmit} className="flex gap-2">
                   <input data-testid="input-toc-page" type="number" min={1} max={pages.length} placeholder={`1 – ${pages.length}`}
                    value={jumpValue} onChange={e => setJumpValue(e.target.value)}
                    className="flex-1 text-sm border border-border rounded-lg px-3 py-2 bg-background focus:outline-none focus:ring-2 focus:ring-primary/40" />
                   <button data-testid="button-toc-jump" type="submit" className="px-4 py-2 bg-primary text-primary-foreground text-sm rounded-lg font-medium hover:bg-primary/90 transition-colors">Перейти</button>
                </form>
                <p className="text-xs text-muted-foreground mt-2 text-center">Сейчас: {currentPageIdx + 1} / {pages.length}</p>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* Reader */}
        <main className={`flex-1 relative flex items-center justify-center overflow-hidden transition-all duration-300 ${selectedSentence ? 'md:mr-[380px]' : ''} ${showToc ? 'md:ml-[280px]' : ''}`}>
           <button data-testid="button-reader-prev" aria-label="Предыдущая страница" onClick={handlePrev} className="absolute left-0 top-0 bottom-0 w-[8%] md:w-14 hover:bg-foreground/[0.02] flex items-center justify-center transition-colors text-transparent hover:text-foreground/20 z-10">
            <ChevronLeft size={36} />
          </button>
           <button data-testid="button-reader-next" aria-label="Следующая страница" onClick={handleNext} className="absolute right-0 top-0 bottom-0 w-[8%] md:w-14 hover:bg-foreground/[0.02] flex items-center justify-center transition-colors text-transparent hover:text-foreground/20 z-10">
            <ChevronRight size={36} />
          </button>

           <div className={`w-full ${widthClass} px-6 sm:px-8 md:px-12 py-5 sm:py-8 h-full overflow-hidden`}>
            <AnimatePresence>
              {showHint && (
                <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                  className="mb-5 flex items-center gap-3 bg-primary/8 border border-primary/20 rounded-2xl px-4 py-3 text-sm text-foreground/80">
                   <span className="text-primary shrink-0"><BookOpen size={16} /></span>
                  <span>Наведите на <span className="text-primary font-semibold">слово</span> — увидите перевод и значения. Нажмите на <span className="text-primary font-semibold">точку</span> — перевод предложения</span>
                   <button data-testid="button-dismiss-reader-hint" aria-label="Скрыть подсказку" onClick={() => { setShowHint(false); localStorage.setItem('reader-hint-dismissed', '1'); }}
                    className="ml-auto shrink-0 p-1 rounded-full hover:bg-primary/15 text-muted-foreground hover:text-foreground">
                    <X size={14} />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence mode="wait">
              <motion.div key={currentPageIdx} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.25 }}
               style={{ fontSize: `${readerFontSize}px`, lineHeight: readerLineHeight, fontFamily: fontCss }}>
                {page.isChapterStart && page.title && (
                  <h2 className="font-serif text-center font-bold mb-6 text-primary/60 text-[1.1em]">{page.title}</h2>
                )}
                <div className="flex flex-col" style={{ gap: `${settings.paragraphSpacing}em` }}>
                  {page.paragraphs.map((para, pi) => {
                    const sentences = splitSentences(para);
                    return (
                      <p key={pi} className={`text-foreground/90 ${settings.textAlign === 'justify' ? 'text-justify' : 'text-left'}`} style={{ color: settings.textColor }}>
                        {sentences.map((sentence, si) => {
                          const punctMatch = sentence.match(/^([\s\S]*?)([.!?…]+["'»]?\s*)$/);
                          const body = punctMatch ? punctMatch[1] : sentence;
                          const punct = punctMatch ? punctMatch[2] : '';
                          const isSelected = selectedSentence === sentence.trim();
                          return (
                            <span key={si} className={`rounded transition-colors ${isSelected ? 'bg-primary/10' : ''}`}>
                              {body.split(/(\s+)/).map((token, wi) => {
                                if (token.trim() === '') return <span key={wi}>{token}</span>;
                                const clean = token.replace(/[^a-zA-Z'-]/g, '');
                                if (!clean || clean.length < 2) return <span key={wi}>{token}</span>;
                                return (
                                  <span key={wi}
                                    className="hover:bg-primary/20 rounded px-[1px] transition-colors cursor-default"
                                    onMouseEnter={e => handleWordMouseEnter(e, clean)}
                                    onMouseLeave={handleWordMouseLeave}
                                    onClick={e => e.stopPropagation()}>
                                    {token}
                                  </span>
                                );
                              })}
                              {punct && (
                                 <button data-testid={`button-translate-sentence-${currentPageIdx}-${pi}-${si}`} onClick={() => handleSentenceClick(sentence)} title="Перевести предложение"
                                  className={`inline font-bold transition-colors rounded px-[1px] cursor-pointer ${isSelected ? 'text-primary' : 'text-primary/50 hover:text-primary'}`}>
                                  {punct}
                                </button>
                              )}
                            </span>
                          );
                        })}
                      </p>
                    );
                  })}
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        </main>

        {/* Sentence / Grammar panel */}
        <AnimatePresence>
          {selectedSentence && (
            <motion.aside key="panel" initial={{ x: 380 }} animate={{ x: 0 }} exit={{ x: 380 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="fixed right-0 top-14 bottom-0 w-[380px] bg-card border-l border-border flex flex-col z-30 shadow-xl">
              <div className="flex items-center justify-between px-4 pt-4 pb-0 shrink-0">
                <div className="flex gap-1 bg-muted p-1 rounded-xl">
                   <button data-testid="button-sentence-translation-tab" onClick={() => setPanelTab('translate')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${panelTab === 'translate' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                    <Languages size={14} /> Перевод
                  </button>
                   <button data-testid="button-sentence-grammar-tab" onClick={() => setPanelTab('grammar')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${panelTab === 'grammar' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                    <Microscope size={14} /> Грамматика
                  </button>
                </div>
               <button data-testid="button-close-sentence-panel" aria-label="Закрыть панель предложения" onClick={closeSentencePanel} className="p-1.5 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground ml-2">
                  <X size={16} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <div className="bg-muted/50 rounded-xl p-3">
                  <p className="text-xs text-muted-foreground font-medium mb-1 uppercase tracking-wide">Оригинал</p>
                  <p className="text-sm text-foreground/90 leading-relaxed font-serif italic">{selectedSentence}</p>
                </div>
                {panelTab === 'translate' && (
                  <div>
                    <p className="text-xs text-muted-foreground font-medium mb-1.5 uppercase tracking-wide">Перевод</p>
                    {translating
                      ? <div className="flex items-center gap-2 text-muted-foreground text-sm p-3"><Loader2 size={16} className="animate-spin" />Переводим…</div>
                      : <p className="text-sm text-foreground leading-relaxed bg-primary/5 rounded-xl p-3 border border-primary/10">{sentenceTranslation}</p>
                    }
                  </div>
                )}
                {panelTab === 'grammar' && sentenceGrammar && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-muted/60 rounded-xl p-3">
                        <p className="text-xs text-muted-foreground mb-1">Тип</p>
                        <p className="text-sm font-semibold">{sentenceGrammar.sentenceType}</p>
                      </div>
                      <div className="bg-muted/60 rounded-xl p-3">
                        <p className="text-xs text-muted-foreground mb-1">Время</p>
                        <p className="text-sm font-semibold text-primary">{sentenceGrammar.tense}</p>
                      </div>
                    </div>
                    <div className="bg-muted/60 rounded-xl p-3">
                      <p className="text-xs text-muted-foreground mb-1">Залог</p>
                      <p className="text-sm font-semibold">{sentenceGrammar.voice}</p>
                    </div>
                    {sentenceGrammar.constructions.length > 0 && (
                      <div className="bg-muted/60 rounded-xl p-3">
                        <p className="text-xs text-muted-foreground mb-2">Конструкции</p>
                        <ul className="space-y-1">
                          {sentenceGrammar.constructions.map((c, i) => (
                            <li key={i} className="text-sm text-foreground/85 flex items-start gap-2">
                              <span className="text-primary mt-0.5 shrink-0">•</span>{c}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {sentenceGrammar.tip && (
                      <div className="bg-primary/5 border border-primary/15 rounded-xl p-3">
                         <p className="text-xs text-primary font-medium mb-1">{sentenceGrammar.tense}</p>
                        <p className="text-xs text-foreground/80 leading-relaxed">{sentenceGrammar.tip}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
      </div>

      <footer className="h-9 shrink-0 flex items-center justify-center gap-3 text-xs text-muted-foreground border-t border-border/30">
        <button data-testid="button-reader-footer-prev" aria-label="Предыдущая страница" onClick={handlePrev} disabled={currentPageIdx === 0} className="p-1 hover:text-foreground disabled:opacity-30 transition-colors"><ChevronLeft size={14} /></button>
        {editingPage ? (
          <form onSubmit={handleJumpSubmit} className="flex items-center gap-1">
           <input data-testid="input-reader-page" autoFocus type="number" min={1} max={pages.length} value={jumpValue}
              onChange={e => setJumpValue(e.target.value)}
              onBlur={() => { setEditingPage(false); setJumpValue(''); }}
              className="w-16 text-center text-xs border border-border rounded px-2 py-0.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary/50" />
            <span>/ {pages.length}</span>
          </form>
        ) : (
           <button data-testid="button-reader-page-number" onClick={() => { setEditingPage(true); setJumpValue(String(currentPageIdx + 1)); }}
            className="hover:text-foreground transition-colors hover:bg-muted px-2 py-0.5 rounded" title="Нажмите для перехода">
             <span data-testid="text-reader-page">Страница {currentPageIdx + 1} из {pages.length}</span>
          </button>
        )}
        <button data-testid="button-reader-footer-next" aria-label="Следующая страница" onClick={handleNext} disabled={currentPageIdx === pages.length - 1} className="p-1 hover:text-foreground disabled:opacity-30 transition-colors"><ChevronRight size={14} /></button>
      </footer>

      {/* Word tooltip */}
      <AnimatePresence>
        {tooltip && (
          <WordTooltip
            state={tooltip}
            onMouseEnter={() => clearTimeout(hideTimeoutRef.current)}
            onMouseLeave={handleWordMouseLeave}
            onAdd={handleAddWord}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
