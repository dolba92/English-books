export interface FontOption {
  label: string;
  value: string;
  css: string;
}

export const FONTS: FontOption[] = [
  { label: 'DM Sans', value: 'DM Sans', css: '"DM Sans", sans-serif' },
  { label: 'Source Serif', value: 'Source Serif 4', css: '"Source Serif 4", serif' },
  { label: 'Georgia', value: 'Georgia', css: 'Georgia, serif' },
  { label: 'Lora', value: 'Lora', css: 'Lora, serif' },
  { label: 'Merriweather', value: 'Merriweather', css: 'Merriweather, serif' },
  { label: 'Libre Baskerville', value: 'Libre Baskerville', css: '"Libre Baskerville", serif' },
  { label: 'Playfair Display', value: 'Playfair Display', css: '"Playfair Display", serif' },
  { label: 'Cormorant Garamond', value: 'Cormorant Garamond', css: '"Cormorant Garamond", serif' },
  { label: 'Roboto Slab', value: 'Roboto Slab', css: '"Roboto Slab", serif' },
  { label: 'Nunito Sans', value: 'Nunito Sans', css: '"Nunito Sans", sans-serif' },
  { label: 'Fraunces', value: 'Fraunces', css: 'Fraunces, serif' },
  { label: 'Fraunces italic', value: 'Fraunces italic', css: 'Fraunces, serif' },
  { label: 'Caveat — рукописный', value: 'Caveat', css: 'Caveat, cursive' },
  { label: 'Space Mono', value: 'Space Mono', css: '"Space Mono", monospace' },
];

export function getFontCss(value: string): string {
  return FONTS.find(f => f.value === value)?.css ?? '"Source Serif 4", serif';
}
