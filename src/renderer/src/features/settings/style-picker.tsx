import clsx from 'clsx';
import { useDraftSetting, useSettingsStore } from '../../stores/settings-store';

type Style = 'soft' | 'cyberpunk';

/*
 * The previews are drawn with fixed colours on purpose: the app's own [data-style] rules match any
 * ancestor, so a preview can't borrow the real recipes without inheriting the current style.
 */
function SoftPreview(): React.JSX.Element {
  return (
    <div className="flex h-24 w-full gap-2 rounded-[14px] bg-[#eceef2] p-2.5" aria-hidden>
      <div className="flex w-1/4 flex-col gap-1.5 rounded-[10px] bg-white/70 p-1.5">
        <span className="h-2 rounded-full bg-[#00a9bd]/70" />
        <span className="h-2 rounded-full bg-[#c9ced6]" />
        <span className="h-2 rounded-full bg-[#c9ced6]" />
      </div>
      <div className="flex flex-1 flex-col gap-2">
        <div className="flex-1 rounded-[12px] bg-white shadow-[0_4px_12px_-4px_rgba(16,24,40,0.15)]" />
        <div className="flex gap-1.5">
          <span className="h-4 w-12 rounded-[8px] bg-[#00c2d6]" />
          <span className="h-4 w-10 rounded-[8px] border border-[#c9ced6] bg-white" />
        </div>
      </div>
    </div>
  );
}

function CyberpunkPreview(): React.JSX.Element {
  return (
    <div
      className="relative flex h-24 w-full gap-2 rounded-[3px] p-2.5"
      style={{
        backgroundColor: '#070a10',
        backgroundImage:
          'linear-gradient(rgba(0,229,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(0,229,255,0.08) 1px, transparent 1px)',
        backgroundSize: '12px 12px',
      }}
      aria-hidden
    >
      <div className="flex w-1/4 flex-col gap-1.5 border border-[#1b2a3a] bg-[#0c1119] p-1.5">
        <span className="h-1.5 w-3/4 bg-[#00f0ff] shadow-[0_0_6px_#00f0ff]" />
        <span className="h-1.5 bg-[#2b4459]" />
        <span className="h-1.5 bg-[#2b4459]" />
      </div>
      <div className="flex flex-1 flex-col gap-2">
        <div className="relative flex-1 border border-[#1b2a3a] bg-[#0c1119]">
          <span className="absolute top-0 left-0 h-px w-3 bg-[#00e5ff]" />
          <span className="absolute top-0 left-0 h-3 w-px bg-[#00e5ff]" />
          <span className="absolute right-0 bottom-0 h-px w-3 bg-[#ff2bd6]" />
          <span className="absolute right-0 bottom-0 h-3 w-px bg-[#ff2bd6]" />
        </div>
        <div className="flex gap-1.5">
          <span
            className="h-4 w-12 bg-[#00e5ff]"
            style={{
              clipPath:
                'polygon(4px 0,100% 0,100% calc(100% - 4px),calc(100% - 4px) 100%,0 100%,0 4px)',
            }}
          />
          <span className="h-4 w-10 border border-[#2b4459]" />
        </div>
      </div>
    </div>
  );
}

const STYLES: Array<{ id: Style; label: string; hint: string; Preview: () => React.JSX.Element }> =
  [
    {
      id: 'soft',
      label: 'Soft',
      hint: 'Rounded cards and buttons, calm colours, gentle shadows',
      Preview: SoftPreview,
    },
    {
      id: 'cyberpunk',
      label: 'Cyberpunk',
      hint: 'Neon Grid HUD: hard corners, scanlines, neon glow',
      Preview: CyberpunkPreview,
    },
  ];

/** Settings → General → Style (Design-system.md §3.7). Previews live before Save, like the theme. */
export function StylePicker(): React.JSX.Element {
  const current = useDraftSetting('appearance.style') ?? 'soft';
  const stage = useSettingsStore((s) => s.stage);
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-ink-100">Style</legend>
      <div role="radiogroup" aria-label="Style" className="grid max-w-xl grid-cols-2 gap-3">
        {STYLES.map(({ id, label, hint, Preview }) => {
          const on = current === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => void stage('appearance.style', id)}
              className={clsx(
                'flex flex-col gap-2 rounded-md border p-2 text-left transition-colors duration-[120ms]',
                on
                  ? 'border-accent-500 bg-selected'
                  : 'border-line bg-surface-1 hover:border-accent-edge',
              )}
            >
              <Preview />
              <span className="px-1">
                <span
                  className={clsx(
                    'block text-sm font-medium',
                    on ? 'text-accent-300' : 'text-ink-100',
                  )}
                >
                  {label}
                </span>
                <span className="block text-xs text-ink-500">{hint}</span>
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
