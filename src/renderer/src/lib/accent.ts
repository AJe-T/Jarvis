/**
 * Design-system.md §3.6: Sir picks one accent colour (Settings → General → Appearance) and the whole
 * neon theme follows it. tokens.css holds the default (cyan); for any other colour this derives the
 * accent tokens per theme and nudges the text roles' lightness until they pass the same contrast
 * rules `npm run check:contrast` enforces (text 4.5:1, icons 3:1 on every surface).
 */
export const DEFAULT_ACCENT = '#00e5ff';

export const ACCENT_PRESETS: ReadonlyArray<{ name: string; hex: string }> = [
  { name: 'Cyan', hex: DEFAULT_ACCENT },
  { name: 'Arc blue', hex: '#3d8bff' },
  { name: 'Violet', hex: '#8b5cff' },
  { name: 'Magenta', hex: '#ff2bd6' },
  { name: 'Red', hex: '#ff2a3d' },
  { name: 'Orange', hex: '#ff7a1a' },
  { name: 'Gold', hex: '#ffc400' },
  { name: 'Lime', hex: '#b6ff2e' },
  { name: 'Green', hex: '#2bff88' },
  { name: 'Silver', hex: '#c8d6e5' },
];

export const HEX_RE = /^#[0-9a-f]{6}$/i;

type Rgb = [number, number, number];
type Theme = 'dark' | 'light';

/** Surfaces text can sit on (tokens.css), including the hover tints, per theme. */
const SURFACES: Record<Theme, string[]> = {
  dark: ['#05070b', '#070a10', '#0c1119', '#111824', '#16202c'],
  light: ['#e6ebf1', '#f2f5f8', '#fbfcfd', '#e9eef3', '#dfe6ec'],
};
const DARK_INK = '#001318';

export function hexToRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: Rgb): string {
  return `#${[r, g, b]
    .map((c) =>
      Math.round(Math.max(0, Math.min(255, c)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

const lin = (c: number): number => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const lum = ([r, g, b]: Rgb): number => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

export function contrast(a: string, b: string): number {
  const [x, y] = [lum(hexToRgb(a)), lum(hexToRgb(b))].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === rr
      ? (gg - bb) / d + (gg < bb ? 6 : 0)
      : max === gg
        ? (bb - rr) / d + 2
        : (rr - gg) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const k = (n: number): number => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): number => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

export function hueOf(hex: string): number {
  return rgbToHsl(hexToRgb(hex))[0];
}

/** Mixes `a` into `b` by `t` (0 = all b, 1 = all a). */
export function mix(a: string, b: string, t: number): string {
  const [x, y] = [hexToRgb(a), hexToRgb(b)];
  return rgbToHex([0, 1, 2].map((i) => (x[i] ?? 0) * t + (y[i] ?? 0) * (1 - t)) as Rgb);
}

const rgba = (hex: string, a: number): string => {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

/** Moves the lightness (lighter on dark themes, darker on light) until `min` contrast on every bg. */
export function fitContrast(hex: string, bgs: string[], min: number, theme: Theme): string {
  const [h, s, l0] = rgbToHsl(hexToRgb(hex));
  const step = theme === 'dark' ? 0.01 : -0.01;
  for (let l = l0; l >= 0 && l <= 1; l += step) {
    const c = rgbToHex(hslToRgb(h, s, l));
    if (bgs.every((bg) => contrast(c, bg) >= min)) return c;
  }
  return theme === 'dark' ? '#ffffff' : '#000000';
}

/** The ink that reads best on a fill: dark ink unless the fill is dark itself. */
export function inkOn(fill: string): string {
  return contrast(DARK_INK, fill) >= contrast('#ffffff', fill) ? DARK_INK : '#ffffff';
}

/** CSS custom properties for one accent in one theme (empty for the default: tokens.css wins). */
export function accentVars(hex: string, theme: Theme): Record<string, string> {
  if (!HEX_RE.test(hex) || hex.toLowerCase() === DEFAULT_ACCENT) return {};
  const c = hex.toLowerCase();
  const dark = theme === 'dark';
  const bgs = SURFACES[theme];
  const selected = dark ? mix(c, '#05070b', 0.13) : mix(c, '#e6ebf1', 0.14);
  const surfaces = [...bgs, selected];
  const fill = fitContrast(c, [dark ? '#070a10' : '#f2f5f8'], 1.6, theme);
  const hover = dark ? mix('#ffffff', fill, 0.35) : mix('#000000', fill, 0.1);
  const strong = fitContrast(c, surfaces, 3, theme); // icons, focus edges, the orb on light
  const text = fitContrast(c, surfaces, 4.5, theme); // links and accent text
  const tint = dark ? mix(c, '#0c1119', 0.2) : mix(c, '#ffffff', 0.22);
  // A second neon that sits well with any hue: violet, or magenta when the accent is violet-ish.
  const hueGap = Math.abs(((hueOf(c) - 255 + 540) % 360) - 180);
  const alt = hueGap < 40 ? (dark ? '#ff2bd6' : '#d1009f') : dark ? '#7a5cff' : '#5b3df0';
  return {
    '--accent-600': fill,
    '--accent-700': hover,
    '--accent-500': strong,
    '--accent-300': text,
    '--accent-tint': tint,
    '--accent-tag-ink': fitContrast(c, [tint], 4.5, theme),
    '--accent-edge': rgba(strong, 0.45),
    '--accent-glow': rgba(c, dark ? 0.28 : 0.22),
    '--ink-on-accent': inkOn(fill),
    '--selected': selected,
    '--hover': rgba(dark ? c : strong, 0.07),
    '--press': rgba(dark ? c : strong, 0.12),
    '--grid-line': rgba(dark ? c : strong, dark ? 0.045 : 0.06),
    '--neon-cyan': dark ? c : strong,
    '--orb-1': dark ? c : strong,
    '--orb-2': mix(c, '#000000', 0.12),
    '--orb-3': alt,
    ...(dark ? { '--ink-strong': c, '--on-strong': inkOn(c) } : {}),
  };
}
