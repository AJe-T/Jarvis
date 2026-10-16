import { useEffect, useState } from 'react';
import { accentVars, DEFAULT_ACCENT } from '../../lib/accent';
import { useDraftSetting } from '../../stores/settings-store';

function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = (): void => setMatches(mq.matches);
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [query]);
  return matches;
}

let applied: string[] = [];

/** The Soft style draws its own neutral shadows (tokens.css), so it skips the accent's neon ones. */
const NEON_SHADOWS = new Set(['--shadow-sm', '--shadow-pop']);

/** Pitch black keeps its own true-black surfaces and ink (tokens.css); the accent only tints accents. */
const NEUTRAL =
  /^--(bg-|surface-|line|ink-[135]00|icon-rest|neutral-tint|void|selected|hover|press|grid-line|shadow-sm)/;

export type ThemeChoice = 'system' | 'dark' | 'light' | 'black';

/** 'black' is the dark theme on true #000 (OLED); 'system' follows Windows. */
export function resolveTheme(choice: unknown, systemLight: boolean): 'dark' | 'light' | 'black' {
  if (choice === 'dark' || choice === 'light' || choice === 'black') return choice;
  return systemLight ? 'light' : 'dark';
}

/** Sets <html data-theme>, data-oled and the accent's tokens as inline variables (they beat tokens.css). */
export function applyTheme(
  theme: 'dark' | 'light' | 'black',
  accent: string,
  style = 'cyberpunk',
): void {
  const root = document.documentElement;
  const oled = theme === 'black';
  const base = oled ? 'dark' : theme;
  root.dataset['theme'] = base;
  if (oled) root.dataset['oled'] = 'true';
  else delete root.dataset['oled'];
  for (const name of applied) root.style.removeProperty(name);
  const vars = Object.fromEntries(
    Object.entries(accentVars(accent, base)).filter(
      ([name]) => (style !== 'soft' || !NEON_SHADOWS.has(name)) && (!oled || !NEUTRAL.test(name)),
    ),
  );
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
  applied = Object.keys(vars);
}

/** Settings → General → Style, Theme, Accent colour and Text size, live (drafts preview before Save). */
export function ThemeSync(): null {
  const style = useDraftSetting('appearance.style') ?? 'soft';
  const choice = useDraftSetting('appearance.theme') ?? 'system';
  const accent = useDraftSetting('appearance.accent') ?? DEFAULT_ACCENT;
  const fontScale = useDraftSetting('appearance.fontScale') ?? 1;
  const systemLight = useMedia('(prefers-color-scheme: light)');
  const theme = resolveTheme(choice, systemLight);
  useEffect(() => {
    document.documentElement.dataset['style'] = style;
    applyTheme(theme, accent, style);
  }, [theme, accent, style]);
  useEffect(() => {
    document.documentElement.style.setProperty('--font-scale', String(fontScale));
  }, [fontScale]);
  return null;
}
