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
  light: {
    surfaces: {
      app: 'F7F6F3',
      main: 'FFFFFF',
      'surface-1': 'FFFFFF',
      'surface-2': 'F6F5F4',
      selected: 'ECEBE8',
    },
    hover: ['37352F', 0.06],
    text: {
      'ink-100': '1A1A1A',
      'ink-300': '5D5B54',
      'ink-500': '6B6963',
      'accent-300': '0069C2',
      'alarm-500': 'C92A2A',
      'lamp-400': 'A84500',
      'ok-400': '0D7329',
    },
    icons: { 'icon-rest': '787671', 'accent-500': '5645D4' },
    fills: {
      'on-accent': ['FFFFFF', '5645D4'],
      'on-accent pressed': ['FFFFFF', '4534B3'],
      'on-alarm': ['FFFFFF', 'E03131'],
      'on-strong': ['FFFFFF', '000000'],
      'tag lamp': ['793400', 'FFE8D4'],
      'tag alarm': ['A02E6D', 'FDE0EC'],
      'tag neutral': ['5D5B54', 'F0EEEC'],
      'tint ink peach': ['37352F', 'FFE8D4'],
      'tint ink mint': ['37352F', 'D9F3E1'],
      'tint ink lavender': ['37352F', 'E6E0F5'],
    },
  },
  dark: {
    surfaces: {
      app: '202020',
      main: '191919',
      'surface-1': '202020',
      'surface-2': '252525',
      selected: '2C2C2C',
    },
    hover: ['FFFFFF', 0.055],
    text: {
      'ink-100': 'EBEBEA',
      'ink-300': 'B5B4B1',
      'ink-500': '9B9A97',
      'accent-300': '5AA6D6',
      'alarm-500': 'FF7369',
      'lamp-400': 'FFA344',
      'ok-400': '4DAB9A',
    },
    icons: { 'icon-rest': '9B9A97', 'accent-500': '8577EA' },
    fills: {
      'on-accent': ['FFFFFF', '5645D4'],
      'on-accent pressed': ['FFFFFF', '6A5AE0'],
      'on-alarm': ['FFFFFF', 'E03131'],
      'on-strong': ['191919', 'FFFFFF'],
      'tag lamp': ['FFB46B', '3B2A1D'],
      'tag alarm': ['FF9A92', '3B2026'],
      'tag neutral': ['B5B4B1', '2F2F2F'],
      'tint ink peach': ['EBEBEA', '3B2A1D'],
      'tint ink mint': ['EBEBEA', '1F3326'],
      'tint ink lavender': ['EBEBEA', '2B2540'],
    },
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
