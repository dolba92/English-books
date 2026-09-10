import React, { useState } from 'react';
import { useReaderSettings } from '@/contexts/ReaderSettingsContext';
import { applyTheme, getTheme, Theme } from '@/lib/theme';
import { clearAllData, clearDictionary } from '@/lib/storage';
import { FONTS } from '@/lib/fonts';
import { getSRSSettings, saveSRSSettings, SRSSettings } from '@/lib/srs';
import { motion } from 'framer-motion';
import { Trash2, CheckCircle2, BrainCircuit, Moon, Paintbrush } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export function SettingsPage() {
  const { settings, updateSettings } = useReaderSettings();
  const [currentTheme, setCurrentTheme] = useState<Theme>(getTheme());
  const [srs, setSrsLocal] = useState<SRSSettings>(getSRSSettings());
  const { toast } = useToast();

  const handleThemeChange = (theme: Theme) => {
    applyTheme(theme);
    setCurrentTheme(theme);
  };

  const updateSRS = (patch: Partial<SRSSettings>) => {
    const next = { ...srs, ...patch };
    setSrsLocal(next);
    saveSRSSettings(next);
  };

  const handleClearDict = async () => {
    if (confirm('Удалить все сохранённые слова?')) {
      await clearDictionary();
      toast({ title: 'Словарь очищен' });
    }
  };

  const handleClearAll = async () => {
    if (confirm('Удалить ВСЕ книги, прогресс и слова? Это действие нельзя отменить.')) {
      await clearAllData();
      toast({ title: 'Все данные удалены', variant: 'destructive' });
      window.location.reload();
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-5 sm:p-8 lg:p-12 max-w-4xl mx-auto min-h-[100dvh]">
      <div className="text-primary text-xs font-bold uppercase tracking-[.2em] mb-3">Под себя</div>
      <h1 data-testid="text-settings-title" className="font-editorial text-5xl font-semibold tracking-[-.04em] text-foreground mb-10">Настройки</h1>

      <div className="space-y-10">
        {/* Тема */}
        <section>
           <h2 className="font-editorial text-2xl font-semibold mb-4">Тема оформления</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { id: 'light',  name: 'Бумага',   bg: 'bg-[#fffaf0]',  border: 'border-[#e5d4c0]',   text: 'text-[#4b2924]' },
              { id: 'pink',   name: 'Розовая', bg: 'bg-[#fbe2ec]',  border: 'border-[#dc9bb5]',   text: 'text-[#682f42]' },
               { id: 'cream',  name: 'Шоколадная', bg: 'bg-[#4b2924]',  border: 'border-[#8f3f5d]',  text: 'text-[#fff8f5]' },
              { id: 'dark',   name: 'Ночная',   bg: 'bg-[#17100f]',  border: 'border-[#7d5262]',  text: 'text-[#fff8f5]' },
            ].map(t => (
              <div data-testid={`button-theme-${t.id}`} role="button" tabIndex={0} onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && handleThemeChange(t.id as Theme)} key={t.id} onClick={() => handleThemeChange(t.id as Theme)}
                className={`relative cursor-pointer rounded-2xl p-4 border-2 transition-all ${t.bg} ${t.border} ${currentTheme === t.id ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : 'hover:scale-[1.02]'}`}>
                <div className="flex justify-between items-center mb-4">
                  <span className={`font-bold flex items-center gap-2 ${t.text}`}>{t.id === 'dark' && <Moon size={15} />}{t.name}</span>
                  {currentTheme === t.id && <CheckCircle2 className={t.text} size={20} />}
                </div>
                <div className="space-y-2 opacity-70">
                  <div className={`h-2 rounded-full w-full ${t.text} bg-current`} />
                  <div className={`h-2 rounded-full w-2/3 ${t.text} bg-current`} />
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Параметры чтения */}
        <section className="bg-card border border-border rounded-3xl p-6 shadow-sm">
           <h2 className="font-editorial text-2xl font-semibold mb-6">Параметры чтения</h2>
          <div className="space-y-6">
            <div>
              <label className="flex justify-between text-sm font-medium mb-3">
                <span>Размер шрифта</span>
                <span className="text-muted-foreground">{settings.fontSize} пт</span>
              </label>
               <input data-testid="input-reader-font-size" type="range" min="12" max="36" step="1" value={settings.fontSize}
                onChange={e => updateSettings({ fontSize: parseInt(e.target.value) })}
                className="w-full accent-primary h-2 bg-muted rounded-lg appearance-none cursor-pointer" />
            </div>
            <div>
              <label className="flex justify-between text-sm font-medium mb-3">
                <span>Межстрочный интервал</span>
                <span className="text-muted-foreground">{settings.lineHeight}×</span>
              </label>
               <input data-testid="input-reader-line-height" type="range" min="1.3" max="2.6" step="0.1" value={settings.lineHeight}
                onChange={e => updateSettings({ lineHeight: parseFloat(e.target.value) })}
                className="w-full accent-primary h-2 bg-muted rounded-lg appearance-none cursor-pointer" />
            </div>
             <div>
               <label className="flex justify-between text-sm font-medium mb-3">
                 <span>Расстояние между абзацами</span>
                 <span className="text-muted-foreground">{settings.paragraphSpacing.toFixed(1)}×</span>
               </label>
               <input data-testid="input-reader-paragraph-spacing" type="range" min="0.3" max="2" step="0.1" value={settings.paragraphSpacing}
                 onChange={e => updateSettings({ paragraphSpacing: parseFloat(e.target.value) })}
                 className="w-full accent-primary h-2 bg-muted rounded-lg appearance-none cursor-pointer" />
             </div>
             <div className="flex items-center justify-between gap-4">
               <label className="text-sm font-medium">Выравнивание текста</label>
               <div className="flex bg-muted p-1 rounded-xl">
                 {[{ value: 'left', label: 'По левому краю' }, { value: 'justify', label: 'По ширине' }].map(option => (
                   <button data-testid={`button-reader-align-${option.value}`} type="button" key={option.value}
                     onClick={() => updateSettings({ textAlign: option.value as 'left' | 'justify' })}
                     className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${settings.textAlign === option.value ? 'bg-card text-foreground shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'}`}>
                     {option.label}
                   </button>
                 ))}
               </div>
             </div>
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Ширина страницы</label>
               <div className="flex flex-wrap bg-muted p-1 rounded-xl">
                {[{ value: 'narrow', label: 'Узкая' }, { value: 'medium', label: 'Средняя' }, { value: 'wide', label: 'Широкая' }].map(w => (
                   <button data-testid={`button-page-width-${w.value}`} key={w.value} onClick={() => updateSettings({ pageWidth: w.value as any })}
                    className={`px-4 py-1.5 rounded-lg text-sm transition-colors ${settings.pageWidth === w.value ? 'bg-card text-foreground shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'}`}>
                    {w.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium block mb-3">Шрифт</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {FONTS.map(f => (
                   <button data-testid={`button-reader-font-${f.value.replace(/\s+/g, '-').toLowerCase()}`} key={f.value} onClick={() => updateSettings({ fontFamily: f.value })}
                    className={`px-3 py-2.5 rounded-xl text-sm border-2 transition-all text-left ${settings.fontFamily === f.value ? 'border-primary bg-primary/5 font-semibold' : 'border-border bg-muted/30 hover:border-primary/40'}`}
                    style={{ fontFamily: f.css }}>
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="border-t border-border pt-6">
              <div className="flex items-start justify-between gap-4 mb-3">
                <div>
                  <label className="text-sm font-medium block">Цвет текста</label>
                  <p className="text-xs text-muted-foreground mt-1">Отдельно для страниц открытой книги.</p>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Paintbrush size={15} className="text-primary" />
                  <span>{settings.textColor.toUpperCase()}</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {[
                  { value: '#4b2924', label: 'Шоколадный' },
                  { value: '#8f3f5d', label: 'Розовый' },
                  { value: '#fff8f5', label: 'Белый' },
                ].map(color => (
                  <button
                    key={color.value}
                    type="button"
                    onClick={() => updateSettings({ textColor: color.value })}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs transition-colors ${settings.textColor === color.value ? 'border-primary bg-primary/10 text-foreground' : 'border-border hover:border-primary/50'}`}
                  >
                    <span className="h-4 w-4 rounded-full border border-foreground/20" style={{ backgroundColor: color.value }} />
                    {color.label}
                  </button>
                ))}
                <label className="flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-xs cursor-pointer hover:border-primary/50">
                  Свой цвет
                  <input
                    data-testid="input-reader-text-color"
                    type="color"
                    value={settings.textColor}
                    onChange={e => updateSettings({ textColor: e.target.value })}
                    className="h-5 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
                    aria-label="Выбрать цвет текста"
                  />
                </label>
              </div>
            </div>
            <div className="border-t border-border pt-6">
              <div className="flex items-start justify-between gap-4 mb-3">
                <div>
                  <label className="text-sm font-medium block">Цвет фона приложения</label>
                  <p className="text-xs text-muted-foreground mt-1">Настраивает фон страниц и открытой книги.</p>
                </div>
                <span className="h-6 w-6 rounded-full border border-foreground/20" style={{ backgroundColor: settings.backgroundColor }} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {[
                  { value: '#f0c8d5', label: 'Розовый туман' },
                  { value: '#e4a7bc', label: 'Розовая бумага' },
                  { value: '#6b3934', label: 'Шоколадный' },
                  { value: '#fff8f5', label: 'Белый' },
                ].map(color => (
                  <button key={color.value} type="button" onClick={() => updateSettings({ backgroundColor: color.value })}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs transition-colors ${settings.backgroundColor === color.value ? 'border-primary bg-primary/10 text-foreground' : 'border-border hover:border-primary/50'}`}>
                    <span className="h-4 w-4 rounded-full border border-foreground/20" style={{ backgroundColor: color.value }} />
                    {color.label}
                  </button>
                ))}
                <label className="flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-xs cursor-pointer hover:border-primary/50">
                  Свой цвет
                  <input data-testid="input-app-background-color" type="color" value={settings.backgroundColor}
                    onChange={e => updateSettings({ backgroundColor: e.target.value })}
                    className="h-5 w-6 cursor-pointer rounded border-0 bg-transparent p-0" aria-label="Выбрать цвет фона" />
                </label>
              </div>
            </div>
          </div>
        </section>

        {/* Интервальное повторение */}
        <section className="bg-card border border-border rounded-3xl p-6 shadow-sm">
           <h2 className="font-editorial text-2xl font-semibold mb-2 flex items-center gap-2">
            <BrainCircuit size={20} className="text-primary" />
            Интервальное повторение
          </h2>
          <p className="text-sm text-muted-foreground mb-6">
            Настройте, как часто слова будут появляться на повторение. Алгоритм SM-2.
          </p>
          <div className="space-y-6">
            {/* Множитель лёгкости */}
            <div>
              <label className="flex justify-between text-sm font-medium mb-1">
                <span>Множитель при правильном ответе</span>
                <span className="text-muted-foreground font-bold text-primary">×{srs.easyMultiplier.toFixed(1)}</span>
              </label>
              <p className="text-xs text-muted-foreground mb-3">
                Во сколько раз растёт интервал после верного ответа. Чем больше — тем реже повторения.
              </p>
               <input data-testid="input-srs-easy-multiplier" type="range" min="1.5" max="3.0" step="0.1" value={srs.easyMultiplier}
                onChange={e => updateSRS({ easyMultiplier: parseFloat(e.target.value) })}
                className="w-full accent-primary h-2 bg-muted rounded-lg appearance-none cursor-pointer" />
              <div className="flex justify-between text-xs text-muted-foreground mt-1">
                <span>×1.5 (чаще)</span>
                <span>×3.0 (реже)</span>
              </div>
            </div>

            {/* Штраф за ошибку */}
            <div>
              <label className="flex justify-between text-sm font-medium mb-1">
                <span>Интервал после ошибки</span>
                <span className="text-muted-foreground font-bold text-destructive">{srs.hardPenaltyDays} {srs.hardPenaltyDays === 1 ? 'день' : srs.hardPenaltyDays <= 4 ? 'дня' : 'дней'}</span>
              </label>
              <p className="text-xs text-muted-foreground mb-3">
                Через сколько дней показать слово снова после ошибки.
              </p>
               <input data-testid="input-srs-penalty" type="range" min="1" max="5" step="1" value={srs.hardPenaltyDays}
                onChange={e => updateSRS({ hardPenaltyDays: parseInt(e.target.value) })}
                className="w-full accent-primary h-2 bg-muted rounded-lg appearance-none cursor-pointer" />
              <div className="flex justify-between text-xs text-muted-foreground mt-1">
                <span>1 день (строже)</span>
                <span>5 дней (мягче)</span>
              </div>
            </div>

            {/* Максимальный интервал */}
            <div>
              <label className="flex justify-between text-sm font-medium mb-1">
                <span>Максимальный интервал</span>
                <span className="text-muted-foreground font-bold">{srs.maxIntervalDays} дней</span>
              </label>
              <p className="text-xs text-muted-foreground mb-3">
                Слова не пропадут дольше этого срока даже при хорошем знании.
              </p>
               <input data-testid="input-srs-max-interval" type="range" min="30" max="365" step="10" value={srs.maxIntervalDays}
                onChange={e => updateSRS({ maxIntervalDays: parseInt(e.target.value) })}
                className="w-full accent-primary h-2 bg-muted rounded-lg appearance-none cursor-pointer" />
              <div className="flex justify-between text-xs text-muted-foreground mt-1">
                <span>30 дней</span>
                <span>365 дней</span>
              </div>
            </div>

            {/* Сброс SRS */}
             <button data-testid="button-reset-srs"
              onClick={() => { const def = { easyMultiplier: 2.5, hardPenaltyDays: 1, maxIntervalDays: 90 }; setSrsLocal(def); saveSRSSettings(def); toast({ title: 'Настройки повторения сброшены' }); }}
              className="text-sm text-muted-foreground hover:text-foreground border border-border rounded-xl px-4 py-2 transition-colors hover:bg-muted"
            >
              Сбросить к стандартным
            </button>
          </div>
        </section>

        {/* Управление данными */}
        <section className="bg-destructive/5 border border-destructive/20 rounded-3xl p-6">
          <h2 className="text-xl font-bold mb-4 text-destructive flex items-center gap-2">
            <Trash2 size={20} /> Управление данными
          </h2>
          <p className="text-sm text-muted-foreground mb-6">Данные хранятся только на этом устройстве. Действия необратимы.</p>
          <div className="flex flex-col gap-3">
             <button data-testid="button-clear-dictionary" onClick={handleClearDict}
              className="bg-card border border-destructive/30 text-destructive hover:bg-destructive hover:text-destructive-foreground px-4 py-3 rounded-xl font-medium transition-colors text-left">
              Очистить словарь
            </button>
             <button data-testid="button-clear-all-data" onClick={handleClearAll}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 px-4 py-3 rounded-xl font-medium transition-colors text-left">
              Удалить все данные
            </button>
          </div>
        </section>
      </div>
    </motion.div>
  );
}
