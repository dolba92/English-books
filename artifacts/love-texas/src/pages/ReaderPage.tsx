import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useParams, Link } from 'wouter';
import { Book, getBook, getProgress, saveProgress, addWordToDictionary, getPaginationCache, savePaginationCache } from '@/lib/storage';
import { paginateBook, paginateBookContinuousMeasured, ContinuousPageBlock } from '@/lib/paginator';
import { useReaderSettings } from '@/contexts/ReaderSettingsContext';
import { FONTS, getFontCss } from '@/lib/fonts';
import { lookupWord, translateSentence, WordInfo, RuGroup } from '@/lib/wordlookup';
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
const PAGINATION_CACHE_VERSION = 2;


// ── Word Tooltip ─────────────────────────────────────────────────────────────


const CONTEXT_VERB_BASES = new Set([
  'mean','try','stand','stare','murmur','lean','seep','pull','look','say','tell','ask','reply',
  'want','understand','discover','search','reach','knock','move','come','go','run','take','bring',
  'keep','feel','find','hold','leave','turn','smile','freeze','tear','call','watch','work','play',
  'walk','wait','help','open','close','change','follow','remember','return','start','stop','study',
  'talk','use','love','like','live','hope','jump','learn','plan','rain','cook','dance','clean',
]);

function inferPreferredPos(sentence: string, rawWord: string): 'verb' | 'noun' | 'adjective' | 'adverb' | undefined {
  const tokens = sentence
    .replace(/[“”‘’"«»()[\]{}—–….,!?;:]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  const target = rawWord.toLowerCase().replace(/[^a-z'-]/g, '');
  const index = tokens.findIndex(token => token.toLowerCase().replace(/[^a-z'-]/g, '') === target);
  if (index < 0) return undefined;

  const prev = (tokens[index - 1] || '').toLowerCase().replace(/[^a-z'-]/g, '');
  const next = (tokens[index + 1] || '').toLowerCase().replace(/[^a-z'-]/g, '');

  const determiners = new Set([
    'a','an','the','this','that','these','those','my','your','his','her','its','our','their',
    'some','any','each','every','no','another','one','two','three','many','few','several',
  ]);
  const subjectPronouns = new Set(['i','you','he','she','it','we','they']);
  const auxiliaries = new Set([
    'am','is','are','was','were','be','been','being',
    'have','has','had','do','does','did',
    'can','could','will','would','shall','should','may','might','must',
  ]);

  // Strong verb morphology / constructions.
  if (target.endsWith('ing')) {
    if (determiners.has(prev)) return 'noun';

    // Verb-like complements make this unambiguously verbal.
    if (['to','at','in','on','into','from','with','for','towards','toward','over'].includes(next)) {
      return 'verb';
    }

    return 'verb';
  }

  if (target.endsWith('ed')) {
    if (auxiliaries.has(prev)) return 'verb';
    return 'verb';
  }

  // Third-person singular verb: "Thomas murmurs", "Dad leans", "It seeps".
  // Possessive/determiner before an -s word is much more likely a plural noun:
  // "their faces", "the books".
  if (target.endsWith('s') && !target.endsWith('ss')) {
    if (determiners.has(prev)) return 'noun';
    if (subjectPronouns.has(prev)) return 'verb';

    // A capitalized token immediately before usually acts as a subject name.
    const rawPrev = tokens[index - 1] || '';
    if (/^[A-Z][A-Za-z'-]*$/.test(rawPrev)) return 'verb';

    const base = target.slice(0, -1);

    // Known verb base + an explicit subject-like token before it:
    // "what she means", "Thomas murmurs", "Dad leans".
    if (CONTEXT_VERB_BASES.has(base)) {
      const prev2 = (tokens[index - 2] || '').toLowerCase().replace(/[^a-z'-]/g, '');
      if (
        subjectPronouns.has(prev) ||
        subjectPronouns.has(prev2) ||
        /^[A-Z][A-Za-z'-]*$/.test(rawPrev) ||
        ['what','who','that','which'].includes(prev2)
      ) {
        return 'verb';
      }
    }

    // If the word after it strongly looks like an object/complement rather than
    // punctuation, prefer verb for known verb bases.
    if (CONTEXT_VERB_BASES.has(base) && next) return 'verb';
  }

  // Infinitive after "to".
  if (prev === 'to') return 'verb';

  // Copula + -y/-ful/-ous/-ive etc. is commonly adjective.
  if (['is','are','was','were','seems','seemed','looks','looked'].includes(prev)) {
    if (/(y|ful|ous|ive|al|ic|able|ible|less)$/.test(target)) return 'adjective';
  }

  // Adverb morphology.
  if (target.endsWith('ly')) return 'adverb';

  // A word immediately before a noun-like target often acts as adjective,
  // but only use this as a weak fallback.
  if (next && determiners.has(prev) === false && /(ous|ful|ive|al|ic|able|ible|less|y)$/.test(target)) {
    return 'adjective';
  }

  return undefined;
}

interface TooltipState {
  word: string;
  x: number; y: number;
  info: WordInfo | null;
  loading: boolean;
  sentence: string;
  preferredPos?: 'verb' | 'noun' | 'adjective' | 'adverb';
}

function WordTooltip({
  state, onMouseEnter, onMouseLeave, onAdd,
}: {
  state: TooltipState;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onAdd: (payload: {
    sourceForm: string;
    learningWord: string;
    translations: string[];
    transcription?: string;
    partOfSpeech?: string;
    sentence: string;
  }) => void;
}) {
  const { word, x, y, info, loading } = state;
  const translation = info?.translation ?? '';
  const groups: RuGroup[] = info?.groups ?? [];
  const lemma = info?.lemma;
  const learningWord = info?.learningWord || lemma || word;
  const [selectedGroup, setSelectedGroup] = React.useState(0);
  const [choosingTranslations, setChoosingTranslations] = React.useState(false);
  const [selectedTranslations, setSelectedTranslations] = React.useState<string[]>([]);
  const popupRef = React.useRef<HTMLDivElement>(null);
  const [popupStyle, setPopupStyle] = React.useState<React.CSSProperties>({
    left: Math.max(12, Math.min(window.innerWidth - 300, x - 144)),
    top: Math.max(12, y - 320),
  });

  React.useEffect(() => {
    if (!groups.length) {
      setSelectedGroup(0);
      return;
    }

    const preferred = state.preferredPos || info?.preferredPos;
    if (!preferred) {
      setSelectedGroup(0);
      return;
    }

    const index = groups.findIndex(group => {
      const pos = group.pos.toLowerCase();
      if (preferred === 'verb') return pos === 'глагол' || pos === 'verb';
      if (preferred === 'noun') return pos === 'существительное' || pos === 'noun';
      if (preferred === 'adjective') return pos === 'прилагательное' || pos === 'adjective';
      if (preferred === 'adverb') return pos === 'наречие' || pos === 'adverb';
      return false;
    });

    setSelectedGroup(index >= 0 ? index : 0);
  }, [word, groups.length, state.preferredPos, info?.preferredPos]);

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

  const candidateTranslations = React.useMemo(() => {
    const raw = [
      ...(info?.learningTranslations ?? []),
      translation,
      ...activeVariants,
    ];
    const seen = new Set<string>();
    return raw
      .map(value => value.trim())
      .filter(value => value.length > 1 && isCyrillic(value))
      .filter(value => {
        const key = value.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 10);
  }, [info?.learningTranslations, translation, activeVariants.join('|')]);

  React.useEffect(() => {
    setChoosingTranslations(false);
    setSelectedTranslations(candidateTranslations.slice(0, Math.min(3, candidateTranslations.length)));
  }, [word, learningWord, candidateTranslations.join('|')]);

  const toggleTranslation = (value: string) => {
    setSelectedTranslations(current =>
      current.includes(value)
        ? current.filter(item => item !== value)
        : [...current, value],
    );
  };

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
  }, [
    word,
    x,
    y,
    info,
    loading,
    selectedGroup,
    lemma,
    choosingTranslations,
    selectedTranslations.length,
    candidateTranslations.length,
  ]);

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
       <div className="bg-card border border-border shadow-2xl rounded-2xl w-[min(18rem,calc(100vw-2rem))] max-h-[calc(100dvh-5.5rem)] overflow-y-auto overscroll-contain">
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

        {/* Linga-like save flow: choose meanings, save the base form */}
        <div className="px-3 pb-3">
          {!choosingTranslations ? (
            <button
              data-testid="button-add-word"
              aria-label="Добавить слово в словарь"
              disabled={loading || !translation}
              onClick={() => setChoosingTranslations(true)}
              className="w-full flex items-center justify-center gap-1.5 bg-primary/10 text-primary font-medium py-2 rounded-xl hover:bg-primary/20 transition-colors text-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Plus size={14} /> В словарь
            </button>
          ) : (
            <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-2">
              <div>
                <p className="text-xs text-muted-foreground">В обучение пойдёт</p>
                <p className="font-semibold text-sm">{learningWord}</p>
              </div>
              <p className="text-xs font-medium text-foreground">Выберите переводы</p>
              <div className="flex flex-wrap gap-1.5">
                {candidateTranslations.map(value => {
                  const selected = selectedTranslations.includes(value);
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={e => { e.stopPropagation(); toggleTranslation(value); }}
                      className={`rounded-full px-2.5 py-1 text-xs border transition-colors ${
                        selected
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-card text-foreground/80 border-border hover:border-primary/50'
                      }`}
                    >
                      {value}
                    </button>
                  );
                })}
              </div>
              <div className="sticky bottom-0 -mx-3 -mb-3 px-3 pt-2 pb-3 bg-card/95 backdrop-blur-sm border-t border-border/60 flex gap-2">
                <button
                  type="button"
                  onClick={() => setChoosingTranslations(false)}
                  className="flex-1 py-2 rounded-lg bg-muted text-muted-foreground text-sm"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  disabled={selectedTranslations.length === 0}
                  onClick={() => onAdd({
                    sourceForm: word,
                    learningWord,
                    translations: selectedTranslations,
                    transcription: info?.phonetic,
                    partOfSpeech: activeGroup?.pos,
                    sentence: state.sentence,
                  })}
                  className="flex-1 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40"
                >
                  Добавить
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function ReaderSettingsPanel({ onClose }: { onClose: () => void }) {
  const { settings, updateSettings } = useReaderSettings();
  const set = (patch: Parameters<typeof updateSettings>[0]) => updateSettings(patch);
  const themes = [
    { value: 'milk' as const, label: 'Молочная', bg: '#f7f3ec', text: '#3f352f' },
    { value: 'cream' as const, label: 'Кремовая', bg: '#f2e8d8', text: '#493a31' },
    { value: 'powder' as const, label: 'Пудра', bg: '#f1e3e5', text: '#49383a' },
    { value: 'sage' as const, label: 'Шалфей', bg: '#e7ebdf', text: '#374038' },
    { value: 'mist' as const, label: 'Туман', bg: '#e8edf0', text: '#344047' },
    { value: 'lavender' as const, label: 'Лаванда', bg: '#ece8f1', text: '#40394a' },
    { value: 'latte' as const, label: 'Латте', bg: '#e9dccd', text: '#493a31' },
    { value: 'night' as const, label: 'Ночь', bg: '#2b2725', text: '#f1e9df' },
    { value: 'custom' as const, label: 'Своя', bg: settings.customBackgroundColor, text: settings.customTextColor },
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
          <div className="grid grid-cols-3 gap-2">
            {themes.map(item => (
              <button
                type="button"
                key={item.value}
                onClick={() => set({ readerTheme: item.value })}
                className={`reader-choice min-h-[72px] flex flex-col items-center justify-center gap-1.5 ${settings.readerTheme === item.value ? 'reader-choice-active' : ''}`}
                title={item.label}
              >
                <span
                  className="w-full h-8 rounded-lg border border-black/10 flex items-center justify-center font-serif italic text-base shadow-sm"
                  style={{ backgroundColor: item.bg, color: item.text }}
                >
                  Aa
                </span>
                <span className="text-[11px] leading-none">{item.label}</span>
              </button>
            ))}
          </div>

          {settings.readerTheme === 'custom' && (
            <div className="mt-3 rounded-xl border border-border bg-muted/30 p-3 grid grid-cols-2 gap-3">
              <label className="flex items-center justify-between gap-2 text-xs font-medium">
                <span>Фон</span>
                <input
                  type="color"
                  value={settings.customBackgroundColor}
                  onChange={event => set({ customBackgroundColor: event.target.value })}
                  className="h-9 w-12 cursor-pointer rounded border border-border bg-transparent p-0.5"
                  aria-label="Цвет фона Reader"
                />
              </label>
              <label className="flex items-center justify-between gap-2 text-xs font-medium">
                <span>Текст</span>
                <input
                  type="color"
                  value={settings.customTextColor}
                  onChange={event => set({ customTextColor: event.target.value })}
                  className="h-9 w-12 cursor-pointer rounded border border-border bg-transparent p-0.5"
                  aria-label="Цвет текста Reader"
                />
              </label>
            </div>
          )}
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
      const illustrationReserve = paginationLayout.showIllustrations
        ? Math.max(0, Math.min(contentHeight * 0.78, viewportHeight - 170))
        : 0;

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
  const handleWordMouseEnter = (e: React.MouseEvent<HTMLSpanElement>, rawWord: string, sentence: string) => {
    const word = rawWord.replace(/[^a-zA-Z'-]/g, '').toLowerCase().trim();
    if (!word || word.length < 2) return;

    clearTimeout(hoverTimeoutRef.current);
    clearTimeout(hideTimeoutRef.current);

    const rect = e.currentTarget.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top - 8;

    const preferredPos = inferPreferredPos(sentence, rawWord);

    hoverTimeoutRef.current = setTimeout(async () => {
      setTooltip({ word, x, y, info: null, loading: true, sentence, preferredPos });
      const info = await lookupWord(word, preferredPos);
      setTooltip(prev => prev?.word === word ? { ...prev, info, loading: false } : prev);
    }, 400);
  };

  const handleWordMouseLeave = () => {
    clearTimeout(hoverTimeoutRef.current);
    hideTimeoutRef.current = setTimeout(() => setTooltip(null), 300);
  };

  const handleWordClick = async (e: React.MouseEvent<HTMLSpanElement>, rawWord: string, sentence: string) => {
    const word = rawWord.replace(/[^a-zA-Z'-]/g, '').toLowerCase().trim();
    if (!word || word.length < 2) return;
    clearTimeout(hoverTimeoutRef.current);
    clearTimeout(hideTimeoutRef.current);
    const rect = e.currentTarget.getBoundingClientRect();
    const preferredPos = inferPreferredPos(sentence, rawWord);
    setTooltip({
      word,
      x: rect.left + rect.width / 2,
      y: rect.top - 8,
      info: null,
      loading: true,
      sentence,
      preferredPos,
    });
    const info = await lookupWord(word, preferredPos);
    setTooltip(previous => previous?.word === word ? { ...previous, info, loading: false } : previous);
  };

  const handleAddWord = async (payload: {
    sourceForm: string;
    learningWord: string;
    translations: string[];
    transcription?: string;
    partOfSpeech?: string;
    sentence: string;
  }) => {
    const selected = payload.translations.filter(Boolean);
    const translation = selected.join('; ');

    await addWordToDictionary(payload.learningWord, translation, {
      sourceForm: payload.sourceForm,
      lemma: payload.learningWord,
      translations: selected,
      transcription: payload.transcription,
      partOfSpeech: payload.partOfSpeech,
      contextSentence: payload.sentence.trim(),
      bookId: book?.id,
      bookTitle: book?.title,
    });

    toast({
      title: 'Добавлено в словарь',
      description: `"${payload.learningWord}" → ${translation}`,
      duration: 2200,
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
  const readerThemes = {
    milk: { bg: '#f7f3ec', text: '#3f352f', panel: '#fbf8f2', muted: '#74675f', border: 'rgba(74,61,53,.16)', mutedSurface: 'rgba(255,255,255,.50)' },
    cream: { bg: '#f2e8d8', text: '#493a31', panel: '#f8f0e4', muted: '#78665a', border: 'rgba(82,62,49,.16)', mutedSurface: 'rgba(255,255,255,.42)' },
    powder: { bg: '#f1e3e5', text: '#49383a', panel: '#f8eff0', muted: '#7a6266', border: 'rgba(85,58,64,.15)', mutedSurface: 'rgba(255,255,255,.42)' },
    sage: { bg: '#e7ebdf', text: '#374038', panel: '#f0f3ea', muted: '#667066', border: 'rgba(55,70,57,.15)', mutedSurface: 'rgba(255,255,255,.40)' },
    mist: { bg: '#e8edf0', text: '#344047', panel: '#f1f4f6', muted: '#617078', border: 'rgba(50,67,76,.15)', mutedSurface: 'rgba(255,255,255,.42)' },
    lavender: { bg: '#ece8f1', text: '#40394a', panel: '#f4f1f7', muted: '#6f6679', border: 'rgba(66,56,78,.15)', mutedSurface: 'rgba(255,255,255,.42)' },
    latte: { bg: '#e9dccd', text: '#493a31', panel: '#f2e8dc', muted: '#756458', border: 'rgba(80,61,49,.16)', mutedSurface: 'rgba(255,255,255,.38)' },
    night: { bg: '#2b2725', text: '#f1e9df', panel: '#393331', muted: '#c8bcb2', border: 'rgba(245,238,231,.18)', mutedSurface: '#46403d' },
    custom: { bg: settings.customBackgroundColor, text: settings.customTextColor, panel: settings.customBackgroundColor, muted: settings.customTextColor, border: 'rgba(91,56,43,.18)', mutedSurface: 'rgba(255,255,255,.18)' },
  } as const;
  const activeReaderTheme = readerThemes[settings.readerTheme] ?? readerThemes.milk;
  const readerSurface = activeReaderTheme.bg;
  const readerTextColor = activeReaderTheme.text;
  const readerThemeStyle = {
    '--reader-bg': readerSurface,
    '--reader-text': readerTextColor,
    '--reader-panel': activeReaderTheme.panel,
    '--reader-muted': activeReaderTheme.muted,
    '--reader-border': activeReaderTheme.border,
    '--reader-muted-surface': activeReaderTheme.mutedSurface,
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
                              style={{
                                display: 'block',
                                width: 'auto',
                                height: 'auto',
                                maxWidth: isMobile ? '100%' : 'min(92%, 1100px)',
                                maxHeight: isMobile
                                  ? 'calc(100dvh - 150px)'
                                  : 'calc(100dvh - 175px)',
                                objectFit: 'contain',
                                margin: '0 auto 20px',
                              }}
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
                                    onMouseEnter={e => handleWordMouseEnter(e, clean, sentence)}
                                    onMouseLeave={handleWordMouseLeave}
                                    onClick={e => { e.stopPropagation(); handleWordClick(e, clean, sentence); }}>
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