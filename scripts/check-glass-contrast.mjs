// scripts/check-glass-contrast.mjs  ·  run: npm run check:contrast
// Design-system.md §3.5: every text role must reach 4.5:1 on every surface it can sit on, in both
// themes; icons 3:1. Surfaces are solid, so this is a straight pair check. Keep in sync with tokens.css.
const hex = (s) => s.match(/\w\w/g).map((x) => Number.parseInt(x, 16));
const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const over = (top, a, bot) => top.map((t, i) => a * t + (1 - a) * bot[i]);
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const THEMES = {
  dark: {
    surfaces: {
      app: '0B0B0D',
      main: '111113',
      'surface-1': '18181B',
      'surface-2': '1F1F23',
      selected: '26262B',
    },
    hover: ['FFFFFF', 0.05],
    text: {
      'ink-100': 'F4F4F5',
      'ink-300': 'A1A1AA',
      'ink-500': '9A9AA3',
      'accent-300': '60A5FA',
      'alarm-500': 'F87171',
      'lamp-400': 'F59E0B',
      'ok-400': '22C55E',
    },
    icons: { 'icon-rest': '9A9AA3', 'accent-500': '3B82F6' },
    fills: { 'on-accent': ['FFFFFF', '2563EB'], 'on-alarm': ['FFFFFF', 'DC2626'] },
  },
  light: {
    surfaces: {
      app: 'F4F4F5',
      main: 'FFFFFF',
      'surface-1': 'FFFFFF',
      'surface-2': 'F4F4F5',
      selected: 'ECECEF',
    },
    hover: ['000000', 0.04],
    text: {
      'ink-100': '09090B',
      'ink-300': '52525B',
      'ink-500': '62626B',
      'accent-300': '1D4ED8',
      'alarm-500': 'B91C1C',
      'lamp-400': '92400E',
      'ok-400': '166534',
    },
    icons: { 'icon-rest': '62626B', 'accent-500': '2563EB' },
    fills: { 'on-accent': ['FFFFFF', '2563EB'], 'on-alarm': ['FFFFFF', 'DC2626'] },
  },
};

let fails = 0;
const check = (label, fg, bg, min) => {
  const r = ratio(fg, bg);
  if (r < min) {
    fails++;
    console.log(`FAIL  ${label}: ${r.toFixed(2)}:1 (needs ${min})`);
  }
  return r;
};
for (const [name, t] of Object.entries(THEMES)) {
  const surfaces = Object.fromEntries(Object.entries(t.surfaces).map(([k, v]) => [k, hex(v)]));
  for (const [k, v] of Object.entries(t.surfaces).filter(([k]) => k !== 'selected'))
    surfaces[`${k} + hover`] = over(hex(t.hover[0]), t.hover[1], hex(v));
  let low = Infinity;
  for (const [n, c] of Object.entries(t.text))
    for (const [s, bg] of Object.entries(surfaces))
      low = Math.min(low, check(`${name}: --${n} on ${s}`, hex(c), bg, 4.5));
  for (const [n, c] of Object.entries(t.icons))
    for (const [s, bg] of Object.entries(surfaces))
      check(`${name}: --${n} icon on ${s}`, hex(c), bg, 3);
  for (const [n, [fg, bg]] of Object.entries(t.fills))
    check(`${name}: --ink-${n}`, hex(fg), hex(bg), 4.5);
  console.log(`${name}: lowest text contrast ${low.toFixed(2)}:1`);
}
console.log(
  fails
    ? `${fails} failure(s)`
    : 'PASS  all text roles >= 4.5:1 and icons >= 3:1 on every surface, both themes',
);
process.exit(fails ? 1 : 0);
