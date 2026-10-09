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

/** tokens.css neutrals per theme; an accent re-tints them to its own hue (same lightness). */
const NEUTRALS: Record<Theme, Record<string, string>> = {
  dark: {
    '--bg-app': '#05070b',
    '--bg-main': '#070a10',
    '--surface-1': '#0c1119',
    '--surface-2': '#111824',
    '--line-subtle': '#111a26',
    '--line': '#1b2a3a',
    '--line-strong': '#2b4459',
    '--neutral-tint': '#121c28',
    '--void': '#04060b',
    '--ink-100': '#e4f7ff',
    '--ink-300': '#9db4c7',
    '--ink-500': '#7d93a8',
  },
  light: {
    '--bg-app': '#e6ebf1',
    '--bg-main': '#f2f5f8',
    '--surface-1': '#fbfcfd',
    '--surface-2': '#e9eef3',
    '--line-subtle': '#dde4ea',
    '--line': '#cdd7e0',
    '--line-strong': '#9fb0bf',
    '--neutral-tint': '#e1e8ee',
    '--void': '#0a1220',
    '--ink-100': '#071019',
    '--ink-300': '#33475a',
    '--ink-500': '#4a5d70',
  },
};

/** Same lightness, the accent's hue; greyish accents (silver) give near-grey neutrals. */
function retint(neutral: string, hue: number, sat: number): string {
  const [, s, l] = rgbToHsl(hexToRgb(neutral));
  return rgbToHex(hslToRgb(hue, Math.min(1, s * Math.max(0.15, Math.min(1, sat))), l));
}

/** Every surface text can sit on: the four surfaces, the selected row, the neutral tag, and hover over each. */
export function textSurfaces(vars: Record<string, string>, hoverBase: string): string[] {
  const base = ['--bg-app', '--bg-main', '--surface-1', '--surface-2'].map(
    (k) => vars[k] ?? '#000000',
  );
  return [
    ...base,
    ...base.map((bg) => mix(hoverBase, bg, 0.07)),
    vars['--selected'] ?? '#000000',
    vars['--neutral-tint'] ?? '#000000',
  ];
}

/**
 * CSS custom properties for one accent in one theme (empty for the default: tokens.css wins).
 * Surfaces, lines and ink take the accent's hue; every text role is then fitted to 4.5:1 on every
 * surface and icons to 3:1, the rules `npm run check:contrast` holds the default theme to.
 */
export function accentVars(hex: string, theme: Theme): Record<string, string> {
  if (!HEX_RE.test(hex) || hex.toLowerCase() === DEFAULT_ACCENT) return {};
  const c = hex.toLowerCase();
  const dark = theme === 'dark';
  const [hue, sat] = rgbToHsl(hexToRgb(c));
  const n: Record<string, string> = Object.fromEntries(
    Object.entries(NEUTRALS[theme]).map(([k, v]) => [k, retint(v, hue, sat)]),
  );
  const app = n['--bg-app'] ?? '#000000';
  const main = n['--bg-main'] ?? '#000000';
  n['--selected'] = mix(c, app, dark ? 0.13 : 0.14);
  const fill = fitContrast(c, [main], 1.6, theme);
  const strong0 = fitContrast(c, [app, main], 3, theme);
  const hoverBase = dark ? c : strong0;
  const surfaces = textSurfaces(n, hoverBase);
  const ink100 = fitContrast(n['--ink-100'] ?? '#ffffff', surfaces, 7, theme);
  const ink300 = fitContrast(n['--ink-300'] ?? '#ffffff', surfaces, 4.5, theme);
  const ink500 = fitContrast(n['--ink-500'] ?? '#ffffff', surfaces, 4.5, theme);
  const strong = fitContrast(c, surfaces, 3, theme); // icons, focus edges, the orb on light
  const text = fitContrast(c, surfaces, 4.5, theme); // links and accent text
  const hover = dark ? mix('#ffffff', fill, 0.35) : mix('#000000', fill, 0.1);
  const tint = mix(c, dark ? (n['--surface-1'] ?? '#000000') : '#ffffff', dark ? 0.2 : 0.22);
  // A second neon that sits well with any hue: violet, or magenta when the accent is violet-ish.
  const hueGap = Math.abs(((hue - 255 + 540) % 360) - 180);
  const alt = hueGap < 40 ? (dark ? '#ff2bd6' : '#d1009f') : dark ? '#7a5cff' : '#5b3df0';
  const shade = dark ? '#000000' : (n['--ink-100'] ?? '#000000');
  return {
    ...n,
    '--ink-100': ink100,
    '--ink-300': ink300,
    '--ink-500': ink500,
    '--icon-rest': ink500,
    '--accent-600': fill,
    '--accent-700': hover,
    '--accent-500': strong,
    '--accent-300': text,
    '--accent-tint': tint,
    '--accent-tag-ink': fitContrast(c, [tint], 4.5, theme),
    '--accent-edge': rgba(strong, 0.45),
    '--accent-glow': rgba(c, dark ? 0.28 : 0.22),
    '--ink-on-accent': inkOn(fill),
    '--hover': rgba(hoverBase, 0.07),
    '--press': rgba(hoverBase, 0.12),
    '--grid-line': rgba(hoverBase, dark ? 0.045 : 0.06),
    '--neon-cyan': dark ? c : strong,
    '--orb-1': dark ? c : strong,
    '--orb-2': mix(c, '#000000', 0.12),
    '--orb-3': alt,
    '--shadow-sm': dark
      ? `0 0 0 1px ${rgba(c, 0.03)}, 0 2px 8px rgba(0, 0, 0, 0.5)`
      : `0 1px 2px ${rgba(shade, 0.06)}`,
    '--shadow-pop': dark
      ? `0 0 0 1px ${rgba(c, 0.28)}, 0 0 32px -8px ${rgba(c, 0.35)}, 0 24px 48px -12px rgba(0, 0, 0, 0.85)`
      : `0 0 0 1px ${rgba(strong, 0.25)}, 0 8px 16px -4px ${rgba(shade, 0.08)}, 0 24px 32px -8px ${rgba(shade, 0.12)}`,
    ...(dark
      ? { '--ink-strong': c, '--on-strong': inkOn(c) }
      : { '--ink-strong': ink100, '--on-strong': n['--surface-1'] ?? '#ffffff' }),
  };
}
