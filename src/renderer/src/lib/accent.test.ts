import { describe, expect, it } from 'vitest';
import { ACCENT_PRESETS, accentVars, contrast, DEFAULT_ACCENT, inkOn } from './accent';

const DARK = ['#05070b', '#070a10', '#0c1119', '#111824', '#16202c'];
const LIGHT = ['#e6ebf1', '#f2f5f8', '#fbfcfd', '#e9eef3', '#dfe6ec'];
// Presets plus awkward picks: pure blue (dark on dark), yellow (light on light), grey, black, white.
const PICKS = [
  ...ACCENT_PRESETS.map((p) => p.hex),
  '#0000ff',
  '#ffff00',
  '#808080',
  '#000000',
  '#ffffff',
];

describe('accent colours', () => {
  it('leaves the default to tokens.css', () => {
    expect(accentVars(DEFAULT_ACCENT, 'dark')).toEqual({});
    expect(accentVars('not a colour', 'light')).toEqual({});
  });

  for (const theme of ['dark', 'light'] as const)
    it(`keeps every text and icon role readable in ${theme} for any accent`, () => {
      const bgs = theme === 'dark' ? DARK : LIGHT;
      for (const hex of PICKS) {
        if (hex === DEFAULT_ACCENT) continue;
        const v = accentVars(hex, theme);
        const surfaces = [...bgs, v['--selected'] ?? ''];
        for (const bg of surfaces) {
          expect(
            contrast(v['--accent-300'] ?? '', bg),
            `${hex} text on ${bg}`,
          ).toBeGreaterThanOrEqual(4.5);
          expect(
            contrast(v['--accent-500'] ?? '', bg),
            `${hex} icon on ${bg}`,
          ).toBeGreaterThanOrEqual(3);
        }
        expect(
          contrast(v['--ink-on-accent'] ?? '', v['--accent-600'] ?? ''),
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrast(v['--accent-tag-ink'] ?? '', v['--accent-tint'] ?? ''),
        ).toBeGreaterThanOrEqual(4.5);
      }
    });

  it('puts white ink on dark fills and dark ink on bright ones', () => {
    expect(inkOn('#ffc400')).toBe('#001318');
    expect(inkOn('#3a0080')).toBe('#ffffff');
  });
});
