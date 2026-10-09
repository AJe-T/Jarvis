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

/** Sets <html data-theme> and the accent's tokens as inline variables (they beat tokens.css). */
export function applyTheme(theme: 'dark' | 'light', accent: string): void {
  const root = document.documentElement;
  root.dataset['theme'] = theme;
  for (const name of applied) root.style.removeProperty(name);
  const vars = accentVars(accent, theme);
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
  applied = Object.keys(vars);
}

/** Settings → General → Theme and Accent colour, live (unsaved drafts preview before Save). */
export function ThemeSync(): null {
  const choice = useDraftSetting('appearance.theme') ?? 'system';
  const accent = useDraftSetting('appearance.accent') ?? DEFAULT_ACCENT;
  const systemLight = useMedia('(prefers-color-scheme: light)');
  const theme = choice === 'system' ? (systemLight ? 'light' : 'dark') : choice;
  useEffect(() => applyTheme(theme, accent), [theme, accent]);
  return null;
}
