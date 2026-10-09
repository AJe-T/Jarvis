import { useState } from 'react';
import clsx from 'clsx';
import { DEFAULT_ORB_STYLE, ORB_STYLES, type OrbStyleId } from '@shared/orb-styles';
import { Orb } from '../../components/jarvis/orb';
import { useDraftSetting, useSettingsStore } from '../../stores/settings-store';

/**
 * Design-system.md §6.1: every orb style as a live preview card. Only the chosen card and the one
 * under the pointer animate (the rest show a still frame), so the page stays light.
 */
export function OrbStylePicker(): React.JSX.Element {
  const current = useDraftSetting('appearance.orbStyle') ?? DEFAULT_ORB_STYLE;
  const stage = useSettingsStore((s) => s.stage);
  const [hover, setHover] = useState<OrbStyleId | null>(null);
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-ink-100">Orb style</legend>
      <div
        role="radiogroup"
        aria-label="Orb style"
        className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-2"
      >
        {ORB_STYLES.map((s) => {
          const on = current === s.id;
          return (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={s.label}
              title={s.hint}
              onClick={() => void stage('appearance.orbStyle', s.id)}
              onMouseEnter={() => setHover(s.id)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(s.id)}
              onBlur={() => setHover(null)}
              className={clsx(
                'flex flex-col items-center gap-1.5 rounded-md border bg-void px-2 pt-3 pb-2 transition-colors duration-[120ms]',
                on
                  ? 'border-accent-500 shadow-[0_0_16px_-6px_var(--accent-glow)]'
                  : 'border-line hover:border-accent-edge',
              )}
            >
              <Orb
                state="IDLE"
                size="md"
                orbStyle={s.id}
                demo
                paused={!on && hover !== s.id}
                announce={false}
              />
              <span className={clsx('font-code text-xs', on ? 'text-accent-300' : 'text-ink-300')}>
                {s.label}
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-ink-500">
        Hover a style to see it move. Every style follows the voice, music and Jarvis&apos;s state.
      </p>
    </fieldset>
  );
}
