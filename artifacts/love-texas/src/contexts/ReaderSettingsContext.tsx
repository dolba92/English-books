import React, { createContext, useContext, useState, useEffect } from 'react';

export type ReaderTheme =
  | 'milk'
  | 'cream'
  | 'powder'
  | 'sage'
  | 'mist'
  | 'lavender'
  | 'latte'
  | 'night'
  | 'custom';

export interface ReaderSettings {
  fontSize: number; // 12-36
  pageWidth: 'narrow' | 'medium' | 'wide';
  fontFamily: string; // reader font family
  lineHeight: number; // 1.3-2.6
  paragraphSpacing: number; // em
  textAlign: 'left' | 'justify';
  textColor: string; // legacy reading text color
  backgroundColor: string; // legacy app and reader background
  autoSave: boolean;
  fontWeight: 400 | 500 | 600;
  firstLineIndent: boolean;
  pageMargin: 'compact' | 'comfortable' | 'wide';
  showIllustrations: boolean;
  readerTheme: ReaderTheme;
  customBackgroundColor: string;
  customTextColor: string;
}

const defaultSettings: ReaderSettings = {
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
  readerTheme: 'milk',
  customBackgroundColor: '#f7f3ec',
  customTextColor: '#3f352f',
};

interface SettingsContextType {
  settings: ReaderSettings;
  updateSettings: (patch: Partial<ReaderSettings>) => void;
}

const ReaderSettingsContext = createContext<SettingsContextType | undefined>(undefined);

const validThemes: ReaderTheme[] = [
  'milk', 'cream', 'powder', 'sage', 'mist', 'lavender', 'latte', 'night', 'custom',
];

function migrateReaderTheme(value: unknown): ReaderTheme {
  if (validThemes.includes(value as ReaderTheme)) return value as ReaderTheme;
  if (value === 'night') return 'night';
  if (value === 'paper') return 'cream';
  if (value === 'sepia') return 'latte';
  if (value === 'default') return 'powder';
  return 'milk';
}

export function ReaderSettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<ReaderSettings>(() => {
    const saved = localStorage.getItem('lt-reader-settings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Partial<ReaderSettings>;
        const isPreviousDefault = parsed.fontSize === 17
          && parsed.pageWidth === 'medium'
          && parsed.pageMargin === 'comfortable'
          && parsed.fontFamily === 'Source Serif 4'
          && parsed.lineHeight === 1.65
          && parsed.paragraphSpacing === 0.8
          && parsed.textAlign === 'justify'
          && parsed.readerTheme === ('default' as ReaderTheme);

        return {
          ...defaultSettings,
          ...parsed,
          readerTheme: migrateReaderTheme(parsed.readerTheme),
          ...(isPreviousDefault ? { pageWidth: 'wide', pageMargin: 'compact' } : {}),
        };
      } catch {
        return defaultSettings;
      }
    }
    return defaultSettings;
  });

  useEffect(() => {
    localStorage.setItem('lt-reader-settings', JSON.stringify(settings));
  }, [settings]);

  const updateSettings = (patch: Partial<ReaderSettings>) => {
    setSettings(prev => ({ ...prev, ...patch }));
  };

  return (
    <ReaderSettingsContext.Provider value={{ settings, updateSettings }}>
      {children}
    </ReaderSettingsContext.Provider>
  );
}

export function useReaderSettings() {
  const context = useContext(ReaderSettingsContext);
  if (!context) {
    throw new Error('useReaderSettings must be used within a ReaderSettingsProvider');
  }
  return context;
}
