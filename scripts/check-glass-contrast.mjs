// scripts/check-glass-contrast.mjs  ·  run: npm run check:contrast
// Worst case per theme (Design-system.md §3.5): every atmosphere light and the orb spill stacked at
// peak on one pixel, then saturate(150%), then each glass level. Text roles must stay >= 4.5:1 on
// every surface; text on filled buttons and badges too. Keep the numbers in sync with tokens.css.
const hex = (s) => s.match(/\w\w/g).map((x) => Number.parseInt(x, 16));
const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const over = (top, a, bot) => top.map((t, i) => a * t + (1 - a) * bot[i]);
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const saturate = ([r, g, b], s) => {
  const m = [
    [0.2126 + 0.7874 * s, 0.7152 - 0.7152 * s, 0.0722 - 0.0722 * s],
    [0.2126 - 0.2126 * s, 0.7152 + 0.2848 * s, 0.0722 - 0.0722 * s],
    [0.2126 - 0.2126 * s, 0.7152 - 0.7152 * s, 0.0722 + 0.9278 * s],
  ];
  return m.map(([a, b2, c]) => Math.min(255, Math.max(0, a * r + b2 * g + c * b)));
};

const THEMES = {
  dark: {
    void: '05060B',
    lights: [
      ['8B5CF6', 0.15],
      ['22D3EE', 0.08],
      ['8B5CF6', 0.035],
      ['F0ABFC', 0.035],
      ['22D3EE', 0.12],
    ],
    base: ['05060B', 0.5],
    sheen: '#FFFFFF',
    levels: { 1: 0.035, 2: 0.055, 3: 0.075, 4: 0.1 },
    hover: ['FFFFFF', 0.075],
    selected: ['8B5CF6', 0.1],
    sir: ['8B5CF6', 0.07],
    scrim: ['020617', 0.68],
    inks: {
      'ink-100': 'F8FAFC',
      'ink-300': 'CBD5E1',
      'ink-500': 'A8B1C2',
      'reactor-500': '22D3EE',
      'accent-300': 'C4B5FD',
      'lamp-400': 'FBBF24',
      'alarm-500': 'FCA5A5',
      'ok-400': '34D399',
    },
    fills: {
      'on-accent': ['F8FAFC', '7C3AED'],
      'on-reactor': ['04202A', '22D3EE'],
      'on-lamp': ['2A1700', 'FBBF24'],
      'on-alarm': ['2A0503', 'F87171'],
      'on-ok': ['03231A', '34D399'],
    },
  },
  light: {
    void: 'EEF0F8',
    lights: [
      ['8B5CF6', 0.16],
      ['22D3EE', 0.12],
      ['8B5CF6', 0.05],
      ['F0ABFC', 0.1],
      ['0891B2', 0.12],
    ],
    base: ['FFFFFF', 0.5],
    sheen: '#FFFFFF',
    levels: { 1: 0.2, 2: 0.45, 3: 0.4, 4: 0.6 },
    hover: ['0F172A', 0.05],
    selected: ['7C3AED', 0.1],
    sir: ['7C3AED', 0.08],
    scrim: ['E2E4F5', 0.6],
    inks: {
      'ink-100': '0F172A',
      'ink-300': '334155',
      'ink-500': '475569',
      'reactor-500': '155E75',
      'accent-300': '5B21B6',
      'lamp-400': '92400E',
      'alarm-500': 'B91C1C',
      'ok-400': '065F46',
    },
    fills: {
      'on-accent': ['FFFFFF', '6D28D9'],
      'on-alarm': ['FFFFFF', 'DC2626'],
      'on-ok': ['FFFFFF', '065F46'],
    },
  },
};

let fails = 0;
for (const [name, t] of Object.entries(THEMES)) {
  let bg = hex(t.void);
  for (const [c, a] of t.lights) bg = over(hex(c), a, bg);
  bg = saturate(bg, 1.5);
  const white = hex(t.sheen.slice(1));
  const glass = (level, under) =>
    over(white, t.levels[level], over(hex(t.base[0]), t.base[1], under));
  const tint = ([c, a], under) => over(hex(c), a, under);
  const pane = glass(1, bg);
  const float = glass(3, bg);
  const surfaces = {
    pane,
    inset: over(white, t.levels[2], pane),
    hover: tint(t.hover, pane),
    selected: tint(t.selected, pane),
    'sir bubble': tint(t.sir, pane),
    raised: over(white, t.levels[3], pane),
    float,
    'float inset': over(white, t.levels[2], float),
    'float inset hover': tint(t.hover, float), // hover replaces the inset fill, it does not stack
    modal: glass(4, tint(t.scrim, bg)),
  };
  let min = Infinity;
  for (const [n, c] of Object.entries(t.inks))
    for (const [s, rgb] of Object.entries(surfaces)) {
      const r = ratio(hex(c), rgb);
      min = Math.min(min, r);
      if (r < 4.5) {
        fails++;
        console.log(`FAIL  ${name}: --${n} on ${s}: ${r.toFixed(2)}:1`);
      }
    }
  for (const [n, [fg, bgc]] of Object.entries(t.fills)) {
    const r = ratio(hex(fg), hex(bgc));
    if (r < 4.5) {
      fails++;
      console.log(`FAIL  ${name}: --ink-${n}: ${r.toFixed(2)}:1`);
    }
  }
  console.log(`${name}: lowest text contrast on glass ${min.toFixed(2)}:1`);
}
console.log(
  fails ? `${fails} failure(s)` : 'PASS  all text roles >= 4.5:1 on every glass level, both themes',
);
process.exit(fails ? 1 : 0);
