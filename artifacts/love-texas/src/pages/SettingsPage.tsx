import { useState } from 'react';
import { useReaderSettings } from '@/contexts/ReaderSettingsContext';
import { Theme, applyTheme, getTheme } from '@/lib/theme';
import { clearAllData, clearDictionary } from '@/lib/storage';
import { useToast } from '@/hooks/use-toast';
import { Database, Moon, Palette, RotateCcw, Sun, Trash2 } from 'lucide-react';

const themes: { id: Theme; name: string; description: string; swatch: string }[] = [
  { id: 'light', name: 'Бумага', description: 'Тёплая книжная страница', swatch: 'bg-[#f4ead8]' },
  { id: 'pink', name: 'Пудровая', description: 'Спокойный пыльно-розовый фон', swatch: 'bg-[#ead8dc]' },
  { id: 'cream', name: 'Молочный шоколад', description: 'Мягкие карамельно-кофейные тона', swatch: 'bg-[#b98268]' },
  { id: 'latte', name: 'Латте', description: 'Светлый кофе с молоком', swatch: 'bg-[#dfc7ad]' },
  { id: 'sage', name: 'Шалфей', description: 'Спокойные природные оттенки', swatch: 'bg-[#cbd2bd]' },
  { id: 'lavender', name: 'Лавандовая', description: 'Мягкий прохладный лиловый', swatch: 'bg-[#d8d0e2]' },
  { id: 'dark', name: 'Ночная', description: 'Спокойное чтение в темноте', swatch: 'bg-[#17151a]' },
];

export function SettingsPage() {
  const { updateSettings } = useReaderSettings();
  const { toast } = useToast();
  const [theme, setTheme] = useState<Theme>(getTheme());

  const selectTheme = (next: Theme) => {
    setTheme(next);
    applyTheme(next);
    toast({
      title: `Тема «${themes.find(item => item.id === next)?.name}» включена`,
      duration: 1600,
    });
  };

  const resetReader = () => {
    localStorage.removeItem('lt-reader-settings');
    updateSettings({
      fontSize: 17,
      pageWidth: 'wide',
      fontFamily: 'Source Serif 4',
      lineHeight: 1.65,
      paragraphSpacing: 0.8,
      textAlign: 'justify',
      textColor: '#4b2924',
      backgroundColor: '#f0c8d5',
      autoSave: true,
      fontWeight: 400,
      firstLineIndent: true,
      pageMargin: 'compact',
      showIllustrations: true,
      readerTheme: 'default',
    });
    toast({ title: 'Настройки чтения сброшены', duration: 1800 });
  };

  const handleClearDictionary = async () => {
    if (!window.confirm('Удалить все сохранённые слова?')) return;
    await clearDictionary();
    toast({ title: 'Слова удалены', duration: 1800 });
  };

  const handleClearAll = async () => {
    if (!window.confirm('Удалить книги, прогресс и слова? Это действие нельзя отменить.')) return;
    await clearAllData();
    toast({ title: 'Данные приложения очищены', duration: 2200 });
  };

  return (
    <div className="page-container max-w-4xl">
      <header className="mb-8">
        <p className="eyebrow">English Books • Reading Club</p>
        <h1 className="font-editorial text-4xl font-bold text-foreground">Настройки</h1>
        <p className="mt-2 text-muted-foreground">Интерфейс, тема и управление локальными данными.</p>
      </header>

      <section className="settings-section">
        <div className="settings-section-title">
          <Palette size={18} className="text-primary" />
          <div>
            <h2>Внешний вид</h2>
            <p>Выберите настроение библиотеки и страниц приложения.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {themes.map(item => (
            <button
              type="button"
              key={item.id}
              onClick={() => selectTheme(item.id)}
              className={`theme-card ${theme === item.id ? 'theme-card-active' : ''}`}
            >
              <span className={`theme-swatch ${item.swatch}`} />
              <span className="min-w-0 text-left">
                <span className="block font-semibold">{item.name}</span>
                <span className="block text-xs text-muted-foreground mt-0.5">{item.description}</span>
              </span>
              {item.id === 'dark' ? <Moon size={16} /> : <Sun size={16} />}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-title">
          <RotateCcw size={18} className="text-primary" />
          <div>
            <h2>Чтение</h2>
            <p>Основные параметры открываются прямо в Reader через кнопку Aa.</p>
          </div>
        </div>
        <button type="button" onClick={resetReader} className="secondary-action">
          <RotateCcw size={15} /> Сбросить настройки Reader
        </button>
      </section>

      <section className="settings-section">
        <div className="settings-section-title">
          <Database size={18} className="text-primary" />
          <div>
            <h2>Данные</h2>
            <p>Книги, прогресс и слова хранятся только в этом браузере.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={handleClearDictionary} className="secondary-action">
            <Trash2 size={15} /> Очистить слова
          </button>
          <button type="button" onClick={handleClearAll} className="danger-action">
            <Trash2 size={15} /> Очистить все данные
          </button>
        </div>
      </section>
    </div>
  );
}
