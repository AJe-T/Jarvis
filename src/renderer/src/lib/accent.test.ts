import { describe, expect, it } from 'vitest';
import { ACCENT_PRESETS, accentVars, contrast, DEFAULT_ACCENT, hueOf, inkOn, mix } from './accent';

// Presets plus awkward picks: pure blue (dark on dark), yellow (light on light), grey, black, white.
const PICKS = [
  ...ACCENT_PRESETS.map((p) => p.hex).filter((h) => h !== DEFAULT_ACCENT),
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
      for (const hex of PICKS) {
        const v = (k: string): string => accentVars(hex, theme)[k] ?? '';
        const hover = theme === 'dark' ? hex : v('--accent-500');
        const base = ['--bg-app', '--bg-main', '--surface-1', '--surface-2'].map(v);
        const surfaces = [
          ...base,
          ...base.map((bg) => mix(hover, bg, 0.07)),
          v('--selected'),
          v('--neutral-tint'),
        ];
        for (const bg of surfaces) {
          for (const role of ['--ink-100', '--ink-300', '--ink-500', '--accent-300'])
            expect(contrast(v(role), bg), `${hex} ${role} on ${bg}`).toBeGreaterThanOrEqual(4.5);
          expect(contrast(v('--accent-500'), bg), `${hex} icon on ${bg}`).toBeGreaterThanOrEqual(3);
        }
        expect(contrast(v('--ink-on-accent'), v('--accent-600'))).toBeGreaterThanOrEqual(4.5);
        expect(contrast(v('--accent-tag-ink'), v('--accent-tint'))).toBeGreaterThanOrEqual(4.5);
      }
    });

  it('tints the background and lines with the accent hue', () => {
    const v = accentVars('#ff2a3d', 'dark');
    // Near-black colours round to 8 bits, so the hue lands within a few degrees.
    const off = (k: string): number =>
      Math.abs(((hueOf(v[k] ?? '') - hueOf('#ff2a3d') + 540) % 360) - 180);
    expect(off('--bg-app')).toBeLessThan(12);
    expect(off('--line')).toBeLessThan(6);
    expect(v['--shadow-pop']).toContain('255, 42, 61');
  });

  it('puts white ink on dark fills and dark ink on bright ones', () => {
    expect(inkOn('#ffc400')).toBe('#001318');
    expect(inkOn('#3a0080')).toBe('#ffffff');
  });
});
