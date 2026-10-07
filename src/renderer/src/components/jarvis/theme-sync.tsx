import { useEffect, useState } from 'react';
import { useSetting } from '../../stores/settings-store';

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

/** Settings → General → Theme to <html data-theme>, live; "system" follows Windows. */
export function ThemeSync(): null {
  const choice = useSetting('appearance.theme') ?? 'system';
  const systemLight = useMedia('(prefers-color-scheme: light)');
  const theme = choice === 'system' ? (systemLight ? 'light' : 'dark') : choice;
  useEffect(() => {
    document.documentElement.dataset['theme'] = theme;
  }, [theme]);
  return null;
}
