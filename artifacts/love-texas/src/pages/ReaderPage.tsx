import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useParams, Link } from 'wouter';
import { Book, getBook, getProgress, saveProgress, addWordToDictionary, getPaginationCache, savePaginationCache } from '@/lib/storage';
import { paginateBook, paginateBookContinuousMeasured, ContinuousPageBlock } from '@/lib/paginator';
import { useReaderSettings } from '@/contexts/ReaderSettingsContext';
import { FONTS, getFontCss } from '@/lib/fonts';
import { lookupWord, translateSentence, WordInfo, RuGroup } from '@/lib/wordlookup';
import { getLemma } from '@/lib/lemma';
import {
  ArrowLeft, ChevronLeft, ChevronRight, X, Plus,
  Loader2, List, BookOpen, Languages, Microscope, Volume2, Maximize2, Minimize2, Type
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

function normalizeReadingText(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/([.!?])(?=[A-ZА-ЯЁ«“])/g, '$1 ')
    .replace(/([,;:])(?=[A-Za-zА-Яа-яЁё])/g, '$1 ');
}

interface PageData { title: string; blocks: ContinuousPageBlock[]; }
interface TocEntry { title: string; pageIdx: number; }
interface PaginationLayoutSettings {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  pageWidth: 'narrow' | 'medium' | 'wide';
  pageMargin: 'compact' | 'comfortable' | 'wide';
  paragraphSpacing: number;
  firstLineIndent: boolean;
  textAlign: 'left' | 'justify';
  fontWeight: 400 | 500 | 600;
  showIllustrations: boolean;
}

const paginationMemoryCache = new Map<string, PageData[]>();
const PAGINATION_CACHE_VERSION = 1;


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
  onAdd: (word: string, translation: string, lemma: string, lemmaTranslation?: string) => void;
}) {
  const { word, x, y, info, loading } = state;
  const translation = info?.translation ?? '';
  const groups: RuGroup[] = info?.groups ?? [];
  const lemma = getLemma(word);
  const [selectedGroup, setSelectedGroup] = React.useState(0);
  const popupRef = React.useRef<HTMLDivElement>(null);
  const [popupStyle, setPopupStyle] = React.useState<React.CSSProperties>({
    left: Math.max(12, Math.min(window.innerWidth - 300, x - 144)),
    top: Math.max(12, y - 320),
  });

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

  React.useLayoutEffect(() => {
    const popup = popupRef.current;
    if (!popup) return;

    const margin = 16;
    const footerReserve = 56;
    const gap = 10;
    const rect = popup.getBoundingClientRect();
    const safeRight = window.innerWidth - margin;
    const safeBottom = window.innerHeight - footerReserve - margin;

    // Position with real left/top coordinates. Do not use translateX for centering:
    // Framer Motion also owns `transform`, which can overwrite that translation and
    // push the popup outside the viewport.
    let left = x - rect.width / 2;
    left = Math.min(Math.max(left, margin), Math.max(margin, safeRight - rect.width));

    const roomBelow = safeBottom - y;
    const roomAbove = y - margin;
    let top: number;

    if (roomBelow >= rect.height + gap) {
      top = y + gap;
    } else if (roomAbove >= rect.height + gap) {
      top = y - rect.height - gap;
    } else {
      // Very tall cards: keep the whole card inside the safe viewport and let the
      // card body scroll internally instead of letting the popup escape the screen.
      top = Math.min(
        Math.max(margin, y - rect.height / 2),
        Math.max(margin, safeBottom - rect.height),
      );
    }

    setPopupStyle({ left, top });
  }, [word, x, y, info, loading, selectedGroup, lemma]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
       ref={popupRef}
       className="fixed z-50 pointer-events-auto"
       style={popupStyle}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
       <div className="bg-card border border-border shadow-2xl rounded-2xl w-[min(18rem,calc(100vw-2rem))] max-h-[calc(100dvh-7rem)] overflow-y-auto">
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
              {lemma !== word && (
                <p data-testid="text-word-lemma" className="text-xs text-muted-foreground pt-1">Начальная форма: <span className="font-semibold text-foreground/80">{lemma}</span></p>
              )}
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
             onClick={() => onAdd(word, translation, lemma, info?.lemmaTranslation)}
            className="w-full flex items-center justify-center gap-1.5 bg-primary/10 text-primary font-medium py-2 rounded-xl hover:bg-primary/20 transition-colors text-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus size={14} /> В словарь
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function ReaderSettingsPanel({ onClose }: { onClose: () => void }) {
  const { settings, updateSettings } = useReaderSettings();
  const set = (patch: Parameters<typeof updateSettings>[0]) => updateSettings(patch);
  const themes = [
    { value: 'default' as const, label: 'Текущая' },
    { value: 'paper' as const, label: 'Бумага' },
    { value: 'sepia' as const, label: 'Сепия' },
    { value: 'night' as const, label: 'Ночь' },
  ];

  return (
    <motion.aside
      key="reader-settings"
      initial={{ x: 380, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 380, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className="reader-settings fixed right-0 top-14 bottom-0 w-[min(390px,100vw)] bg-card border-l border-border flex flex-col z-40 shadow-2xl"
    >
      <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
        <div className="flex items-center gap-2"><Type size={17} className="text-primary" /><h2 className="font-semibold">Настройки чтения</h2></div>
        <button type="button" onClick={onClose} aria-label="Закрыть настройки чтения" className="p-1.5 rounded-full hover:bg-muted text-muted-foreground"><X size={17} /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        <label className="reader-setting-control">
          <span>Шрифт</span>
          <select value={settings.fontFamily} onChange={event => set({ fontFamily: event.target.value })} className="reader-select">
            {FONTS.map(font => <option key={font.value} value={font.value}>{font.label}</option>)}
          </select>
        </label>
        <label className="reader-setting-control">
          <span className="flex items-center justify-between">Размер <b>{settings.fontSize}px</b></span>
          <input type="range" min={13} max={28} step={1} value={settings.fontSize} onChange={event => set({ fontSize: Number(event.target.value) })} />
        </label>
        <div className="reader-setting-control">
          <span>Насыщенность</span>
          <div className="grid grid-cols-3 gap-2">
            {[400, 500, 600].map(weight => <button type="button" key={weight} onClick={() => set({ fontWeight: weight as 400 | 500 | 600 })} className={`reader-choice ${settings.fontWeight === weight ? 'reader-choice-active' : ''}`} style={{ fontWeight: weight }}>{weight === 400 ? 'Обычная' : weight === 500 ? 'Средняя' : 'Плотная'}</button>)}
          </div>
        </div>
        <label className="reader-setting-control">
          <span className="flex items-center justify-between">Интервал строк <b>{settings.lineHeight.toFixed(1)}</b></span>
          <input type="range" min={1.3} max={2.2} step={0.1} value={settings.lineHeight} onChange={event => set({ lineHeight: Number(event.target.value) })} />
        </label>
        <div className="reader-setting-control">
          <span>Выравнивание</span>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => set({ textAlign: 'left' })} className={`reader-choice ${settings.textAlign === 'left' ? 'reader-choice-active' : ''}`}>По левому краю</button>
            <button type="button" onClick={() => set({ textAlign: 'justify' })} className={`reader-choice ${settings.textAlign === 'justify' ? 'reader-choice-active' : ''}`}>По ширине</button>
          </div>
        </div>
        <div className="reader-setting-control">
          <span>Ширина текста</span>
          <div className="grid grid-cols-3 gap-2">
            {(['narrow', 'medium', 'wide'] as const).map(width => <button type="button" key={width} onClick={() => set({ pageWidth: width })} className={`reader-choice ${settings.pageWidth === width ? 'reader-choice-active' : ''}`}>{width === 'narrow' ? 'Узкая' : width === 'medium' ? 'Средняя' : 'Широкая'}</button>)}
          </div>
        </div>
        <div className="reader-setting-control">
          <span>Поля страницы</span>
          <div className="grid grid-cols-3 gap-2">
            {(['compact', 'comfortable', 'wide'] as const).map(margin => <button type="button" key={margin} onClick={() => set({ pageMargin: margin })} className={`reader-choice ${settings.pageMargin === margin ? 'reader-choice-active' : ''}`}>{margin === 'compact' ? 'Малые' : margin === 'comfortable' ? 'Средние' : 'Большие'}</button>)}
          </div>
        </div>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span><b className="block">Абзацный отступ</b><small className="text-muted-foreground">Классическая книжная верстка</small></span>
          <input type="checkbox" checked={settings.firstLineIndent} onChange={event => set({ firstLineIndent: event.target.checked })} className="accent-primary h-4 w-4" />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span><b className="block">Иллюстрации</b><small className="text-muted-foreground">Показывать изображения книги</small></span>
          <input type="checkbox" checked={settings.showIllustrations} onChange={event => set({ showIllustrations: event.target.checked })} className="accent-primary h-4 w-4" />
        </label>
        <div className="reader-setting-control">
          <span>Тема Reader</span>
          <div className="grid grid-cols-2 gap-2">
            {themes.map(item => <button type="button" key={item.value} onClick={() => set({ readerTheme: item.value })} className={`reader-choice ${settings.readerTheme === item.value ? 'reader-choice-active' : ''}`}>{item.label}</button>)}
          </div>
        </div>
      </div>
    </motion.aside>
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
  const [viewportHeight, setViewportHeight] = useState(() => window.innerHeight);

  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const [selectedSentence, setSelectedSentence] = useState<string | null>(null);
  const [sentenceTranslation, setSentenceTranslation] = useState<string | null>(null);
  const [sentenceGrammar, setSentenceGrammar] = useState<GrammarInfo | null>(null);
  const [translating, setTranslating] = useState(false);
  const [panelTab, setPanelTab] = useState<'translate' | 'grammar'>('translate');

  const [showToc, setShowToc] = useState(false);
  const [showReaderSettings, setShowReaderSettings] = useState(false);
  const [paginationLayout, setPaginationLayout] = useState<PaginationLayoutSettings>(() => ({
    fontFamily: settings.fontFamily,
    fontSize: settings.fontSize,
    lineHeight: settings.lineHeight,
    pageWidth: settings.pageWidth,
    pageMargin: settings.pageMargin,
    paragraphSpacing: settings.paragraphSpacing,
    firstLineIndent: settings.firstLineIndent,
    textAlign: settings.textAlign,
    fontWeight: settings.fontWeight,
    showIllustrations: settings.showIllustrations,
  }));
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [immersiveFallback, setImmersiveFallback] = useState(false);
  const [showHint, setShowHint] = useState(() => !localStorage.getItem('reader-hint-dismissed'));
  const [jumpValue, setJumpValue] = useState('');
  const [editingPage, setEditingPage] = useState(false);
  const readerRootRef = useRef<HTMLDivElement>(null);
  const touchStartXRef = useRef<number | null>(null);
  const readingAnchorRef = useRef<string | null>(null);
  const restoredProgressRef = useRef<Awaited<ReturnType<typeof getProgress>>>(undefined);
  const initialMeasuredPaginationRef = useRef(false);
  const allowProgressSaveRef = useRef(false);

  const saveProgressRef = useRef(saveProgress);
  saveProgressRef.current = saveProgress;

  useEffect(() => {
    const handleResize = () => {
      setViewportWidth(window.innerWidth);
      setViewportHeight(window.innerHeight);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  const toggleFullscreen = async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen?.();
      return;
    }
    if (readerRootRef.current?.requestFullscreen) {
      await readerRootRef.current.requestFullscreen();
    } else {
      setImmersiveFallback(value => !value);
    }
  };

  useEffect(() => {
    const load = async () => {
      // A new book load must not save page 1 before the measured paginator has
      // restored the previously saved reading position.
      initialMeasuredPaginationRef.current = false;
      allowProgressSaveRef.current = false;
      restoredProgressRef.current = undefined;
      readingAnchorRef.current = null;

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
          ch.pages.forEach((paragraphs, pageIndex) => flat.push({
            title: ch.title,
            blocks: [
              ...(pageIndex === 0 ? [{ kind: 'heading' as const, title: ch.title, images: ch.images }] : []),
              ...paragraphs.map(text => ({ kind: 'paragraph' as const, text })),
            ],
          }));
        });

        const prog = await getProgress(id);
        restoredProgressRef.current = prog;

        // Temporary pages are only used while the accurate DOM-measured paginator
        // is being built. Restore a reasonable provisional position so page 1 never
        // flashes and becomes the new saved progress.
        let provisionalIndex = 0;
        if (prog && flat.length > 0) {
          provisionalIndex = prog.percentComplete > 0
            ? Math.round((Math.min(100, Math.max(0, prog.percentComplete)) / 100) * (flat.length - 1))
            : Math.min(Math.max(0, prog.currentPage), flat.length - 1);
        }

        setPages(flat);
        setCurrentPageIdx(provisionalIndex);
        readingAnchorRef.current = flat[provisionalIndex]?.blocks.find(block => block.kind === 'paragraph')?.text || null;
      } else {
        setLoading(false);
      }
      // Keep the reader in its loading state while the temporary pages exist.
      // The accurate DOM-measured pagination below will restore the saved
      // position first, then reveal the reader. This prevents the visible
      // "open saved page -> jump a few seconds later" effect.
    };
    load();
  }, [id]);

  useEffect(() => {
    if (pages.length > 0) readingAnchorRef.current = pages[currentPageIdx]?.blocks.find(block => block.kind === 'paragraph')?.text || null;
  }, [pages, currentPageIdx]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPaginationLayout({
        fontFamily: settings.fontFamily,
        fontSize: settings.fontSize,
        lineHeight: settings.lineHeight,
        pageWidth: settings.pageWidth,
        pageMargin: settings.pageMargin,
        paragraphSpacing: settings.paragraphSpacing,
        firstLineIndent: settings.firstLineIndent,
        textAlign: settings.textAlign,
        fontWeight: settings.fontWeight,
        showIllustrations: settings.showIllustrations,
      });
    }, 220);
    return () => window.clearTimeout(timer);
  }, [
    settings.fontFamily,
    settings.fontSize,
    settings.lineHeight,
    settings.pageWidth,
    settings.pageMargin,
    settings.paragraphSpacing,
    settings.firstLineIndent,
    settings.textAlign,
    settings.fontWeight,
    settings.showIllustrations,
  ]);

  useEffect(() => {
    if (!book || pages.length === 0) return;

    let cancelled = false;

    const repaginate = async () => {
      const isMobileLayout = viewportWidth < 640;
      const panelWidth = viewportWidth >= 768
        ? (selectedSentence ? 380 : 0) + (showToc ? 280 : 0)
        : 0;
      const mainWidth = Math.max(280, viewportWidth - panelWidth);
      const maxReaderWidth = paginationLayout.pageWidth === 'narrow' ? 760 : paginationLayout.pageWidth === 'wide' ? 1250 : 980;
      const horizontalPadding = isMobileLayout
        ? (paginationLayout.pageMargin === 'compact' ? 24 : paginationLayout.pageMargin === 'wide' ? 48 : 36)
        : (paginationLayout.pageMargin === 'compact' ? 48 : paginationLayout.pageMargin === 'wide' ? 128 : 80);
      const contentWidth = Math.max(260, Math.min(mainWidth, maxReaderWidth) - horizontalPadding);
      const verticalPadding = isMobileLayout ? 24 : 32;
      const hintReserve = showHint ? (isMobileLayout ? 112 : 84) : 0;
      const contentHeight = Math.max(180, viewportHeight - 56 - 44 - verticalPadding - hintReserve - 24);
      const fontCssForMeasure = getFontCss(paginationLayout.fontFamily);
      const illustrationReserve = paginationLayout.showIllustrations ? Math.min(viewportHeight * 0.38, 300) : 0;

      const cacheKey = JSON.stringify({
        v: PAGINATION_CACHE_VERSION,
        bookId: book.id ?? id,
        contentWidth: Math.round(contentWidth),
        contentHeight: Math.round(contentHeight),
        fontFamily: paginationLayout.fontFamily,
        fontSize: paginationLayout.fontSize,
        lineHeight: paginationLayout.lineHeight,
        fontWeight: paginationLayout.fontWeight,
        paragraphSpacing: paginationLayout.paragraphSpacing,
        firstLineIndent: paginationLayout.firstLineIndent,
        textAlign: paginationLayout.textAlign,
        showIllustrations: paginationLayout.showIllustrations,
        illustrationReserve: Math.round(illustrationReserve),
      });

      let nextPages = paginationMemoryCache.get(cacheKey);

      if (!nextPages) {
        try {
          const cached = await getPaginationCache(cacheKey);
          if (cancelled) return;
          if (cached?.pages?.length) {
            nextPages = cached.pages as PageData[];
            paginationMemoryCache.set(cacheKey, nextPages);
          }
        } catch (error) {
          console.warn('Pagination cache read failed:', error);
        }
      }

      if (!nextPages) {
        const measured = paginateBookContinuousMeasured(book.content, {
          contentWidth,
          contentHeight,
          fontSize: paginationLayout.fontSize,
          lineHeight: paginationLayout.lineHeight,
          fontFamily: fontCssForMeasure,
          fontWeight: paginationLayout.fontWeight,
          paragraphSpacingEm: paginationLayout.paragraphSpacing,
          firstLineIndent: paginationLayout.firstLineIndent,
          textAlign: paginationLayout.textAlign,
          showIllustrations: paginationLayout.showIllustrations,
          illustrationReservePx: illustrationReserve,
        });
        nextPages = measured.pages as PageData[];

        if (nextPages.length) {
          paginationMemoryCache.set(cacheKey, nextPages);
          void savePaginationCache({
            key: cacheKey,
            bookId: Number(book.id ?? id),
            pages: nextPages,
            createdAt: Date.now(),
          }).catch(error => console.warn('Pagination cache write failed:', error));
        }
      }

      if (cancelled || !nextPages.length) return;

      const anchor = readingAnchorRef.current;
      let nextIndex: number;

      if (!initialMeasuredPaginationRef.current) {
        const saved = restoredProgressRef.current;
        if (saved) {
          nextIndex = saved.percentComplete > 0
            ? Math.round((Math.min(100, Math.max(0, saved.percentComplete)) / 100) * (nextPages.length - 1))
            : Math.min(Math.max(0, saved.currentPage), nextPages.length - 1);
        } else {
          nextIndex = 0;
        }
        initialMeasuredPaginationRef.current = true;
      } else {
        const anchoredIndex = anchor
          ? nextPages.findIndex(candidate => candidate.blocks.some(block =>
            block.kind === 'paragraph' && (block.text === anchor || block.text.startsWith(anchor) || anchor.startsWith(block.text))
          ))
          : -1;
        nextIndex = anchoredIndex >= 0 ? anchoredIndex : Math.min(currentPageIdx, nextPages.length - 1);
      }

      setPages(nextPages);
      setCurrentPageIdx(Math.min(Math.max(0, nextIndex), nextPages.length - 1));
      allowProgressSaveRef.current = true;
      setLoading(false);
    };

    void repaginate();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    book,
    viewportWidth,
    viewportHeight,
    selectedSentence,
    showToc,
    paginationLayout,
    showHint,
    isFullscreen,
    immersiveFallback,
  ]);

  useEffect(() => {
    if (!book || pages.length === 0 || !allowProgressSaveRef.current) return;
    const timer = setTimeout(() => {
      const pct = (currentPageIdx / (pages.length - 1 || 1)) * 100;
       saveProgressRef.current({ bookId: id, currentChapterIndex: 0, currentPage: currentPageIdx, totalPagesRead: currentPageIdx + 1, lastReadAt: Date.now(), percentComplete: pct });
    }, 1000);
    return () => clearTimeout(timer);
  }, [currentPageIdx, book, pages.length, id]);

  const tocEntries: TocEntry[] = useMemo(() => {
    const entries: TocEntry[] = [];
    pages.forEach((p, idx) => {
      p.blocks.forEach(block => {
        if (block.kind === 'heading' && !entries.some(entry => entry.title === block.title && entry.pageIdx === idx)) {
          entries.push({ title: block.title, pageIdx: idx });
        }
      });
    });
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

  const handleWordClick = async (e: React.MouseEvent<HTMLSpanElement>, rawWord: string) => {
    const word = rawWord.replace(/[^a-zA-Z'-]/g, '').toLowerCase().trim();
    if (!word || word.length < 2) return;
    clearTimeout(hoverTimeoutRef.current);
    clearTimeout(hideTimeoutRef.current);
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltip({ word, x: rect.left + rect.width / 2, y: rect.top - 8, info: null, loading: true });
    const info = await lookupWord(word);
    setTooltip(previous => previous?.word === word ? { ...previous, info, loading: false } : previous);
  };

  const handleAddWord = async (
    word: string,
    translation: string,
    lemma?: string,
    lemmaTranslation?: string,
  ) => {
    const dictionaryWord = lemma && lemma !== word ? lemma : word;

    // Save the dictionary/headword translation, not the contextual inflected
    // form. Example: "pulling — тянет" is displayed in the reader, but the
    // dictionary stores "pull — тянуть".
    const dictionaryTranslation =
      dictionaryWord !== word && lemmaTranslation?.trim()
        ? lemmaTranslation.trim()
        : translation;

    await addWordToDictionary(dictionaryWord, dictionaryTranslation);
    toast({
      title: 'Добавлено в словарь',
      description: `"${dictionaryWord}" → ${dictionaryTranslation}`,
      duration: 2000,
    });
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
  const widthClass = settings.pageWidth === 'narrow'
    ? 'max-w-[760px]'
    : settings.pageWidth === 'wide'
      ? 'max-w-[1250px]'
      : 'max-w-[980px]';
  const fontCss = getFontCss(settings.fontFamily);
  const isMobile = viewportWidth < 640;
  const readerFontSize = settings.fontSize;
  const readerLineHeight = settings.lineHeight;
  const readerSurface = settings.readerTheme === 'paper'
    ? '#f4ead8'
    : settings.readerTheme === 'sepia'
      ? '#ead9bd'
      : settings.readerTheme === 'night'
        ? '#2b2725'
        : (customBackgroundColor || '#f0c8d5');
  const readerTextColor = settings.readerTheme === 'night'
    ? '#f1e9df'
    : settings.readerTheme === 'paper'
      ? '#493a2e'
      : settings.readerTheme === 'sepia'
        ? '#493126'
        : settings.textColor;
  const readerThemeStyle = {
    '--reader-bg': readerSurface,
    '--reader-text': readerTextColor,
    '--reader-panel': settings.readerTheme === 'night' ? '#393331' : '#fffaf7',
    '--reader-muted': settings.readerTheme === 'night' ? '#c8bcb2' : '#765c54',
    '--reader-border': settings.readerTheme === 'night' ? 'rgba(245,238,231,.18)' : 'rgba(91,56,43,.16)',
    '--reader-muted-surface': settings.readerTheme === 'night' ? '#46403d' : 'rgba(255,255,255,.48)',
  } as React.CSSProperties;
  const marginClass = settings.pageMargin === 'compact'
    ? 'px-3 sm:px-5 md:px-6'
    : settings.pageMargin === 'wide'
      ? 'px-6 sm:px-10 md:px-16'
      : 'px-4 sm:px-7 md:px-10';

  return (
    <div ref={readerRootRef} data-reader-theme={settings.readerTheme} className={`reader-root ${immersiveFallback ? 'reader-immersive' : ''} min-h-0 h-[100dvh] bg-background text-foreground flex flex-col selection:bg-primary/20 overflow-hidden`} style={readerThemeStyle}>
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
             <p className="text-xs text-muted-foreground">{page.title || book.author}</p>
          </div>
        </div>
        <div className="flex-1 max-w-md mx-8 hidden md:flex items-center gap-3">
           <span data-testid="text-reader-percent" className="text-xs text-muted-foreground whitespace-nowrap">{Math.round(percent)}%</span>
          <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary transition-all duration-300" style={{ width: `${percent}%` }} />
          </div>
        </div>
         <div className="flex items-center gap-1">
           <button type="button" data-testid="button-reader-settings" aria-label="Настройки чтения" onClick={() => setShowReaderSettings(value => !value)} className={`p-2 rounded-full ${showReaderSettings ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}>
             <span className="text-[13px] font-bold leading-none">Aa</span>
           </button>
           <button type="button" data-testid="button-reader-fullscreen" aria-label={isFullscreen || immersiveFallback ? 'Выйти из полноэкранного режима' : 'Полноэкранный режим'} onClick={toggleFullscreen} className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-full">
             {isFullscreen || immersiveFallback ? <Minimize2 size={19} /> : <Maximize2 size={19} />}
           </button>
         </div>
      </header>

       <div className="flex flex-1 overflow-hidden relative" onTouchStart={event => { touchStartXRef.current = event.touches[0]?.clientX ?? null; }} onTouchEnd={event => {
         if (touchStartXRef.current === null) return;
         const delta = (event.changedTouches[0]?.clientX ?? 0) - touchStartXRef.current;
         touchStartXRef.current = null;
         if (Math.abs(delta) > 55) (delta < 0 ? handleNext : handlePrev)();
       }}>
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
         <main className={`min-h-0 flex-1 relative flex items-center justify-center overflow-hidden transition-all duration-300 ${selectedSentence ? 'md:mr-[380px]' : ''} ${showToc ? 'md:ml-[280px]' : ''}`}>
            <button data-testid="button-reader-prev" aria-label="Предыдущая страница" onClick={handlePrev} className="absolute left-0 top-0 bottom-0 w-[8%] md:w-14 hover:bg-foreground/[0.02] flex items-center justify-center transition-colors text-transparent z-10">
             <ChevronLeft size={18} aria-hidden="true" />
          </button>
            <button data-testid="button-reader-next" aria-label="Следующая страница" onClick={handleNext} className="absolute right-0 top-0 bottom-0 w-[8%] md:w-14 hover:bg-foreground/[0.02] flex items-center justify-center transition-colors text-transparent z-10">
             <ChevronRight size={18} aria-hidden="true" />
          </button>

           <div className={`w-full ${widthClass} ${marginClass} py-3 sm:py-4 h-full overflow-hidden`}>
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
               style={{ fontSize: `${readerFontSize}px`, lineHeight: readerLineHeight, fontFamily: fontCss, fontWeight: settings.fontWeight }}>
                <div>
                  {page.blocks.map((block, bi) => {
                    if (block.kind === 'heading') {
                      return (
                        <React.Fragment key={`heading-${bi}-${block.title}`}>
                          {settings.showIllustrations && block.images?.map((image, imageIndex) => (
                            <img
                              key={`${currentPageIdx}-${bi}-illustration-${imageIndex}`}
                              src={image}
                              alt=""
                              className="reader-illustration"
                              loading="lazy"
                            />
                          ))}
                          {block.title && (
                            <h2
                              className="font-serif text-center font-bold text-primary/60 text-[1.1em]"
                              style={{ marginTop: bi === 0 ? 0 : 24, marginBottom: 24 }}
                            >
                              {block.title}
                            </h2>
                          )}
                        </React.Fragment>
                      );
                    }

                    const para = block.text;
                    const sentences = splitSentences(normalizeReadingText(para));
                    const previousBlock = page.blocks[bi - 1];
                    const paragraphMarginTop = bi > 0 && previousBlock?.kind === 'paragraph'
                      ? `${settings.paragraphSpacing}em`
                      : undefined;
                    return (
                      <p
                        key={`paragraph-${bi}`}
                        className={`text-foreground/90 ${settings.textAlign === 'justify' ? 'text-justify' : 'text-left'}`}
                        style={{
                          color: readerTextColor,
                          textIndent: settings.firstLineIndent ? '1.5em' : undefined,
                          marginTop: paragraphMarginTop,
                        }}
                      >
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
                                    className="hover:bg-primary/20 rounded transition-colors cursor-default"
                                    onMouseEnter={e => handleWordMouseEnter(e, clean)}
                                    onMouseLeave={handleWordMouseLeave}
                                    onClick={e => { e.stopPropagation(); handleWordClick(e, clean); }}>
                                    {token}
                                  </span>
                                );
                              })}
                              {punct && (
                                <button data-testid={`button-translate-sentence-${currentPageIdx}-${bi}-${si}`} onClick={() => handleSentenceClick(sentence)} title="Перевести предложение"
                                  className={`inline font-bold transition-colors rounded cursor-pointer ${isSelected ? 'text-primary' : 'text-primary/50 hover:text-primary'}`}>
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

        <AnimatePresence>
          {showReaderSettings && <ReaderSettingsPanel onClose={() => setShowReaderSettings(false)} />}
        </AnimatePresence>

        {/* Sentence / Grammar panel */}
        <AnimatePresence>
          {selectedSentence && (
            <motion.aside key="panel" initial={{ x: 380 }} animate={{ x: 0 }} exit={{ x: 380 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
               className="sentence-panel fixed right-0 top-14 bottom-0 w-[380px] max-w-full bg-card border-l border-border flex flex-col z-30 shadow-xl">
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
