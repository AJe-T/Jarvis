import { Minus, Plus } from 'lucide-react';
import clsx from 'clsx';
import { useDraftSetting, useSettingsStore } from '../../stores/settings-store';

type Theme = 'system' | 'light' | 'dark' | 'black';

/** Swatch colours are the themes' own canvas, card, border and ink (tokens.css). */
const THEMES: Array<{
  id: Theme;
  label: string;
  hint: string;
  bg: string;
  card: string;
  line: string;
  ink: string;
}> = [
  {
    id: 'system',
    label: 'Match Windows',
    hint: 'Light or dark with Windows',
    bg: 'linear-gradient(135deg, #f5f6f8 50%, #121418 50%)',
    card: 'transparent',
    line: '#a0a8b3',
    ink: '#a0a8b3',
  },
  {
    id: 'light',
    label: 'Light',
    hint: 'Paper white',
    bg: '#f5f6f8',
    card: '#ffffff',
    line: '#cdd2d9',
    ink: '#14171c',
  },
  {
    id: 'dark',
    label: 'Dark',
    hint: 'Graphite',
    bg: '#121418',
    card: '#1c1f25',
    line: '#363b44',
    ink: '#f5f6f8',
  },
  {
    id: 'black',
    label: 'Pitch black',
    hint: 'True black for OLED screens',
    bg: '#000000',
    card: '#0c0c0e',
    line: '#3a3a3f',
    ink: '#ffffff',
  },
];

/** Settings → General → Theme: four swatches, previewed live before Save. */
export function ThemePicker(): React.JSX.Element {
  const current = useDraftSetting('appearance.theme') ?? 'system';
  const stage = useSettingsStore((s) => s.stage);
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-ink-100">Theme</legend>
      <div
        role="radiogroup"
        aria-label="Theme"
        className="grid max-w-xl grid-cols-2 gap-3 sm:grid-cols-4"
      >
        {THEMES.map((t) => {
          const on = current === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => void stage('appearance.theme', t.id)}
              className={clsx(
                'flex flex-col gap-2 rounded-md border p-2 text-left transition-colors duration-[120ms]',
                on
                  ? 'border-accent-500 bg-selected'
                  : 'border-line bg-surface-1 hover:border-accent-edge',
              )}
            >
              <span
                aria-hidden
                className="flex h-14 items-end rounded-sm p-1.5"
                style={{ background: t.bg, border: `1px solid ${t.line}` }}
              >
                <span
                  className="flex h-7 w-full flex-col justify-center gap-1 rounded-xs px-1.5"
                  style={{ background: t.card, border: `1px solid ${t.line}` }}
                >
                  <span className="h-1 w-3/4 rounded-pill" style={{ background: t.ink }} />
                  <span
                    className="h-1 w-1/2 rounded-pill opacity-60"
                    style={{ background: t.ink }}
                  />
                </span>
              </span>
              <span className="px-0.5">
                <span
                  className={clsx(
                    'block text-sm font-medium',
                    on ? 'text-accent-300' : 'text-ink-100',
                  )}
                >
                  {t.label}
                </span>
                <span className="block text-xs text-ink-500">{t.hint}</span>
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

const SIZES = [0.9, 1, 1.1, 1.2, 1.35, 1.5] as const;
const pct = (v: number): string => `${Math.round(v * 100)}%`;

/** Settings → General → Text size: A− / A+ steps through six sizes; every view follows at once. */
export function TextSizePicker(): React.JSX.Element {
  const value = useDraftSetting('appearance.fontScale') ?? 1;
  const stage = useSettingsStore((s) => s.stage);
  const at = SIZES.reduce(
    (best, s, i) => (Math.abs(s - value) < Math.abs((SIZES[best] ?? 1) - value) ? i : best),
    0,
  );
  const set = (i: number): void =>
    void stage('appearance.fontScale', SIZES[Math.max(0, Math.min(SIZES.length - 1, i))] ?? 1);
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-ink-100">Text size</legend>
      <div className="flex max-w-xl flex-wrap items-center gap-3">
        <button
          type="button"
          aria-label="Smaller text"
          disabled={at === 0}
          onClick={() => set(at - 1)}
          className="flex size-9 items-center justify-center rounded-sm border border-line bg-surface-1 text-ink-100 hover:border-accent-edge disabled:opacity-40"
        >
          <Minus size={15} aria-hidden />
        </button>
        <div
          role="radiogroup"
          aria-label="Text size"
          className="flex gap-1 rounded-sm border border-line bg-surface-2 p-1"
        >
          {SIZES.map((s, i) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={i === at}
              onClick={() => set(i)}
              className={clsx(
                'rounded-xs px-2.5 py-1 text-xs tabular-nums',
                i === at
                  ? 'bg-accent-600 font-semibold text-ink-on-accent'
                  : 'text-ink-300 hover:bg-hover hover:text-ink-100',
              )}
            >
              {pct(s)}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-label="Larger text"
          disabled={at === SIZES.length - 1}
          onClick={() => set(at + 1)}
          className="flex size-9 items-center justify-center rounded-sm border border-line bg-surface-1 text-ink-100 hover:border-accent-edge disabled:opacity-40"
        >
          <Plus size={15} aria-hidden />
        </button>
      </div>
      <p className="mt-2 text-sm text-ink-300">
        The quick brown fox reads this at {pct(SIZES[at] ?? 1)}. Spacing stays the same; only text
        grows.
      </p>
    </fieldset>
  );
}
