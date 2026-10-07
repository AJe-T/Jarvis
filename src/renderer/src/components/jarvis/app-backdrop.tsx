import { useEffect, useState } from 'react';
import { useSetting } from '../../stores/settings-store';

type GlassMode = 'full' | 'reduced' | 'solid';

/** Chromium's Battery Status API; not in lib.dom.d.ts. */
interface BatteryLike extends EventTarget {
  charging: boolean;
}

function useOnBattery(): boolean {
  const [onBattery, setOnBattery] = useState(false);
  useEffect(() => {
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryLike> };
    if (!nav.getBattery) return;
    let battery: BatteryLike | undefined;
    const update = (): void => setOnBattery(battery ? !battery.charging : false);
    void nav.getBattery().then((b) => {
      battery = b;
      update();
      b.addEventListener('chargingchange', update);
    });
    return () => battery?.removeEventListener('chargingchange', update);
  }, []);
  return onBattery;
}

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

/**
 * Design-system.md §7: resolves Settings → Transparency to <html data-glass>, live.
 * Auto: OS "reduce transparency" → solid; on battery → reduced; otherwise full.
 */
// ponytail: GPU-compositing check (§7 step 2) skipped; add an IPC for app.getGPUFeatureStatus() if blur stutters on some machines.
function useGlassMode(): void {
  const choice = useSetting('appearance.transparency') ?? 'full';
  const reduceTransparency = useMedia('(prefers-reduced-transparency: reduce)');
  const onBattery = useOnBattery();
  const mode: GlassMode =
    choice !== 'auto' ? choice : reduceTransparency ? 'solid' : onBattery ? 'reduced' : 'full';
  useEffect(() => {
    document.documentElement.dataset['glass'] = mode;
  }, [mode]);
}

/** Settings → General → Theme to <html data-theme>, live; "system" follows Windows. */
function useTheme(): void {
  const choice = useSetting('appearance.theme') ?? 'system';
  const systemLight = useMedia('(prefers-color-scheme: light)');
  const theme = choice === 'system' ? (systemLight ? 'light' : 'dark') : choice;
  useEffect(() => {
    document.documentElement.dataset['theme'] = theme;
  }, [theme]);
}

/** L0 (§3.2): atmosphere (slow drift) + reactor spill + grain. */
export function AppBackdrop(): React.JSX.Element {
  useGlassMode();
  useTheme();
  return (
    <div className="app-backdrop" aria-hidden>
      <div className="atmosphere" />
      <div className="reactor-spill" />
    </div>
  );
}
