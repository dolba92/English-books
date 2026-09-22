export type Theme =
  | 'light'
  | 'pink'
  | 'cream'
  | 'latte'
  | 'sage'
  | 'lavender'
  | 'dark';

const THEMES: Theme[] = [
  'light',
  'pink',
  'cream',
  'latte',
  'sage',
  'lavender',
  'dark',
];

export function applyTheme(theme: Theme) {
  const html = document.documentElement;

  html.classList.remove(
    'theme-light',
    'theme-pink',
    'theme-cream',
    'theme-latte',
    'theme-sage',
    'theme-lavender',
    'theme-dark',
    'dark',
  );

  html.classList.add(`theme-${theme}`);

  if (theme === 'dark') {
    html.classList.add('dark');
  }

  localStorage.setItem('lt-theme', theme);
}

export function getTheme(): Theme {
  const saved = localStorage.getItem('lt-theme');

  return THEMES.includes(saved as Theme) ? (saved as Theme) : 'pink';
}
