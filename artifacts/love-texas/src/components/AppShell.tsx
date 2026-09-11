import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { BookOpen, BookMarked, BarChart2, Settings } from 'lucide-react';
import { getTheme, applyTheme } from '@/lib/theme';
import { useReaderSettings } from '@/contexts/ReaderSettingsContext';
import logoUrl from '@/assets/english-books-logo.png';

export function AppShell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [mounted, setMounted] = useState(false);
  const { settings } = useReaderSettings();
  const customBackgroundColor = settings.backgroundColor === '#f0c8d5' ? undefined : settings.backgroundColor;
  const isReader = location.startsWith('/reader/');

  useEffect(() => {
    const t = getTheme();
    applyTheme(t);
    setMounted(true);
  }, []);

  const navItems = [
    { href: '/', label: 'Библиотека', shortLabel: 'Книги', icon: BookOpen },
    { href: '/dictionary', label: 'Слова', shortLabel: 'Слова', icon: BookMarked },
    { href: '/stats', label: 'Прогресс', shortLabel: 'Рост', icon: BarChart2 },
    { href: '/settings', label: 'Настройки', shortLabel: 'Ещё', icon: Settings },
  ];

  if (!mounted) return null;

  return (
    <div className={`app-shell ${isReader ? 'reader-shell' : ''} paper-grain min-h-[100dvh] flex flex-col md:flex-row bg-background transition-colors duration-300`} style={customBackgroundColor ? { backgroundColor: customBackgroundColor } : undefined}>
      {!isReader && <nav className="md:w-[232px] bg-sidebar border-r border-sidebar-border flex md:flex-col px-3 py-3 md:p-4 md:sticky md:top-0 md:h-[100dvh] z-20 shrink-0 shadow-[4px_0_24px_rgba(57,35,26,.18)]">
        <div className="hidden md:flex items-center justify-center px-1 py-3 mb-7">
          <img src={logoUrl} alt="English Books" className="w-full max-w-[190px] h-auto object-contain drop-shadow-[0_8px_16px_rgba(0,0,0,.18)]" />
        </div>
        <div className="flex w-full md:flex-col gap-1.5 overflow-x-auto md:overflow-visible no-scrollbar pb-0">
          {navItems.map((item) => {
            const isActive = location === item.href || (item.href !== '/' && location.startsWith(item.href));
             return (
              <Link key={item.href} href={item.href} aria-current={isActive ? 'page' : undefined} className={`group flex min-w-[64px] flex-1 md:flex-none items-center justify-center md:justify-start gap-3 px-2 md:px-3 py-2.5 rounded-xl transition-all duration-200 ${isActive ? 'bg-sidebar-primary text-sidebar-primary-foreground shadow-[0_8px_18px_hsl(var(--sidebar-primary)/.2)]' : 'text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-foreground'}`} data-testid={`nav-${item.shortLabel.toLowerCase()}`}>
                <item.icon size={18} className="shrink-0" />
                <span className="hidden md:block text-sm">{item.label}</span>
                <span className="md:hidden text-[10px] font-medium">{item.shortLabel}</span>
              </Link>
            );
          })}
        </div>
      </nav>}
      
      <main className="flex-1 w-full min-h-full max-w-full overflow-x-hidden relative" style={customBackgroundColor ? { backgroundColor: customBackgroundColor } : undefined}>
        {children}
      </main>
    </div>
  );
}
