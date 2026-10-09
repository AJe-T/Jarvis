import { useEffect, useState } from 'react';
import { Check, Pipette } from 'lucide-react';
import clsx from 'clsx';
import { ACCENT_PRESETS, DEFAULT_ACCENT, HEX_RE } from '../../lib/accent';
import { useDraftSetting, useSettingsStore } from '../../stores/settings-store';

/**
 * Design-system.md §3.6: ten ready neons, or Custom: the Windows colour dialog (every colour, with
 * its own mixer) or a hex value. Picking previews live; the Save bar keeps it.
 */
export function AccentPicker(): React.JSX.Element {
  const accent = (useDraftSetting('appearance.accent') ?? DEFAULT_ACCENT).toLowerCase();
  const stage = useSettingsStore((s) => s.stage);
  const preset = ACCENT_PRESETS.some((p) => p.hex === accent);
  const [custom, setCustom] = useState(!preset);
  const [hex, setHex] = useState(accent);
  useEffect(() => setHex(accent), [accent]);
  const pick = (v: string): void => void stage('appearance.accent', v.toLowerCase());

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-2 text-sm font-medium text-ink-100">Accent colour</legend>
      <div
        role="radiogroup"
        aria-label="Accent colour"
        className="flex flex-wrap items-center gap-2"
      >
        {ACCENT_PRESETS.map((p) => (
          <button
            key={p.hex}
            type="button"
            role="radio"
            aria-checked={accent === p.hex}
            aria-label={p.name}
            title={p.name}
            onClick={() => {
              setCustom(false);
              pick(p.hex);
            }}
            className={clsx(
              'flex size-9 items-center justify-center rounded-sm border transition-transform duration-[120ms] hover:scale-110',
              accent === p.hex ? 'border-ink-100' : 'border-line',
            )}
            // Swatches show the colour itself, so this is the one place a raw value is styled inline.
            style={{ background: p.hex, boxShadow: `0 0 14px -4px ${p.hex}` }}
          >
            {accent === p.hex && (
              <Check size={16} strokeWidth={3} className="text-void" aria-hidden />
            )}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={!preset || custom}
          onClick={() => setCustom(!custom)}
          className={clsx(
            'flex h-9 items-center gap-1.5 rounded-sm border px-3 font-code text-xs',
            !preset || custom
              ? 'border-accent-edge bg-accent-tint text-accent-tag-ink'
              : 'border-line text-ink-300 hover:text-ink-100',
          )}
        >
          <Pipette size={14} aria-hidden /> Custom
        </button>
      </div>
      {(custom || !preset) && (
        <div className="flex flex-wrap items-center gap-4 rounded-md border border-line bg-surface-2 p-3">
          <label className="flex items-center gap-2 text-sm text-ink-300">
            <input
              type="color"
              aria-label="Pick any colour"
              value={HEX_RE.test(hex) ? hex : DEFAULT_ACCENT}
              onChange={(e) => pick(e.target.value)}
              className="size-10 cursor-pointer rounded-sm border border-line-strong bg-transparent p-0.5"
            />
            All colours
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-300">
            Hex
            <input
              aria-label="Hex colour"
              value={hex}
              maxLength={7}
              spellCheck={false}
              onChange={(e) => {
                const raw = e.target.value.trim();
                const v = raw.startsWith('#') ? raw : `#${raw}`;
                setHex(v);
                if (HEX_RE.test(v)) pick(v);
              }}
              className={clsx(
                'h-9 w-28 rounded-sm border bg-surface-1 px-2 font-code text-sm text-ink-100 uppercase',
                HEX_RE.test(hex) ? 'border-line' : 'border-alarm-500',
              )}
            />
          </label>
          {!HEX_RE.test(hex) && (
            <p role="alert" className="text-xs text-alarm-500">
              Use six hex digits, like #FF2A3D.
            </p>
          )}
        </div>
      )}
      <p className="text-xs text-ink-500">
        Buttons, glow, links and the orb follow it. Text colours are adjusted so they stay readable.
      </p>
    </fieldset>
  );
}
