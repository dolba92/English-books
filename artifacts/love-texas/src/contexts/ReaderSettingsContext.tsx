import React, { createContext, useContext, useState, useEffect } from 'react';

export interface ReaderSettings {
  fontSize: number; // 12-36
  pageWidth: 'narrow' | 'medium' | 'wide';
  fontFamily: string; // reader font family
  lineHeight: number; // 1.3-2.6
  paragraphSpacing: number; // em
  textAlign: 'left' | 'justify';
  textColor: string; // reading text color
  backgroundColor: string; // app and reader background
  autoSave: boolean;
  fontWeight: 400 | 500 | 600;
  firstLineIndent: boolean;
  pageMargin: 'compact' | 'comfortable' | 'wide';
  showIllustrations: boolean;
  readerTheme: 'default' | 'paper' | 'sepia' | 'night';
}

const defaultSettings: ReaderSettings = {
  fontSize: 17,
  pageWidth: 'medium',
  fontFamily: 'Source Serif 4',
  lineHeight: 1.65,
  paragraphSpacing: 0.8,
  textAlign: 'justify',
  textColor: '#4b2924',
  backgroundColor: '#f0c8d5',
  autoSave: true,
  fontWeight: 400,
  firstLineIndent: true,
  pageMargin: 'comfortable',
  showIllustrations: true,
  readerTheme: 'default',
};

interface SettingsContextType {
  settings: ReaderSettings;
  updateSettings: (patch: Partial<ReaderSettings>) => void;
}

const ReaderSettingsContext = createContext<SettingsContextType | undefined>(undefined);

export function ReaderSettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<ReaderSettings>(() => {
    const saved = localStorage.getItem('lt-reader-settings');
    if (saved) {
      try {
        return { ...defaultSettings, ...JSON.parse(saved) };
      } catch (e) {
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
    throw new Error("useReaderSettings must be used within a ReaderSettingsProvider");
  }
  return context;
}
