import { useEffect, useMemo, useState } from 'react';
import { BookMarked, Check, Download, Search, Trash2, Volume2, X } from 'lucide-react';
import { DictionaryWord, getDictionaryWords, removeDictionaryWord } from '@/lib/storage';
import { speak } from '@/lib/speech';
import { useToast } from '@/hooks/use-toast';

export function DictionaryPage() {
  const [words, setWords] = useState<DictionaryWord[]>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const { toast } = useToast();

  const loadWords = () => getDictionaryWords().then(setWords);
  useEffect(() => { loadWords(); }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return words.filter(word => !needle || word.word.toLowerCase().includes(needle) || word.translation.toLowerCase().includes(needle));
  }, [words, query]);

  const visibleIds = filtered.map(word => word.id!).filter(Boolean);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selected.has(id));

  const toggle = (id: number) => {
    setSelected(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const removeIds = async (ids: number[]) => {
    await Promise.all(ids.map(id => removeDictionaryWord(id)));
    setSelected(previous => {
      const next = new Set(previous);
      ids.forEach(id => next.delete(id));
      return next;
    });
    await loadWords();
    toast({ title: `Удалено слов: ${ids.length}`, duration: 1800 });
  };

  const exportWords = (items: DictionaryWord[]) => {
    if (!items.length) return;
    const text = items.map(item => `${item.word} — ${item.translation}`).join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'english-books-words.txt';
    link.click();
    URL.revokeObjectURL(url);
    toast({ title: `Экспортировано слов: ${items.length}`, duration: 1800 });
  };

  const toggleAll = () => {
    setSelected(previous => {
      const next = new Set(previous);
      if (allVisibleSelected) visibleIds.forEach(id => next.delete(id));
      else visibleIds.forEach(id => next.add(id));
      return next;
    });
  };

  return (
    <div className="page-container max-w-4xl">
      <header className="mb-7">
        <p className="eyebrow">English Books • Reading Club</p>
        <h1 className="font-editorial text-4xl font-bold text-foreground">Слова</h1>
        <p className="mt-2 text-muted-foreground">Сохранено во время чтения.</p>
      </header>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <label className="relative flex-1">
          <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Найти слово или перевод" className="w-full pl-10 pr-4 py-3 rounded-xl border border-border bg-card/80 outline-none focus:ring-2 focus:ring-primary/30" />
        </label>
        <button type="button" onClick={() => exportWords(selected.size ? words.filter(item => selected.has(item.id!)) : words)} disabled={!words.length} className="primary-action">
          <Download size={16} /> Экспорт TXT
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-5 text-sm">
        <button type="button" onClick={toggleAll} disabled={!filtered.length} className="secondary-action">
          {allVisibleSelected ? <X size={15} /> : <Check size={15} />} {allVisibleSelected ? 'Снять выделение' : 'Выбрать все'}
        </button>
        {selected.size > 0 && (
          <>
            <span className="text-muted-foreground px-1">Выбрано: {selected.size}</span>
            <button type="button" onClick={() => removeIds([...selected])} className="danger-action"><Trash2 size={15} /> Удалить выбранные</button>
          </>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state"><BookMarked size={30} /><p>{words.length ? 'Ничего не найдено.' : 'Слова появятся здесь во время чтения.'}</p></div>
      ) : (
        <div className="space-y-2">
          {filtered.map(item => {
            const id = item.id!;
            return (
              <article key={id} className={`word-row ${selected.has(id) ? 'word-row-selected' : ''}`}>
                <input type="checkbox" checked={selected.has(id)} onChange={() => toggle(id)} aria-label={`Выбрать ${item.word}`} className="accent-primary h-4 w-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-foreground truncate">{item.word}</p>
                  <p className="text-sm text-muted-foreground truncate">{item.translation}</p>
                </div>
                <button type="button" onClick={() => speak(item.word)} aria-label={`Произнести ${item.word}`} className="icon-action"><Volume2 size={17} /></button>
                <button type="button" onClick={() => removeIds([id])} aria-label={`Удалить ${item.word}`} className="icon-action text-destructive"><Trash2 size={16} /></button>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}