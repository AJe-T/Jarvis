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
      app: 'FAFAFA',
      main: 'FFFFFF',
      'surface-1': 'FFFFFF',
      'surface-2': 'F5F5F5',
      selected: 'EBEBEB',
    },
    hover: ['000000', 0.05],
    text: {
      'ink-100': '171717',
      'ink-300': '4D4D4D',
      'ink-500': '666666',
      'accent-300': '005BC0',
      'alarm-500': 'C50000',
      'lamp-400': '964C00',
      'ok-400': '236C33',
    },
    icons: { 'icon-rest': '666666', 'accent-500': '0070F3' },
    fills: {
      'on-accent': ['FFFFFF', '171717'],
      'on-accent pressed': ['FFFFFF', '383838'],
      'on-alarm': ['FFFFFF', 'C50000'],
      'on-strong': ['FFFFFF', '171717'],
      'tag accent': ['004EA8', 'D3E5FF'],
      'tag lamp': ['8A4300', 'FFEFCF'],
      'tag alarm': ['A80000', 'F7D4D6'],
      'tag neutral': ['4D4D4D', 'F2F2F2'],
    },
  },
  dark: {
    surfaces: {
      app: '0A0A0A',
      main: '0A0A0A',
      'surface-1': '111111',
      'surface-2': '1A1A1A',
      selected: '232323',
    },
    hover: ['FFFFFF', 0.06],
    text: {
      'ink-100': 'EDEDED',
      'ink-300': 'A1A1A1',
      'ink-500': '8F8F8F',
      'accent-300': '52A8FF',
      'alarm-500': 'FF6166',
      'lamp-400': 'F5A623',
      'ok-400': '62C073',
    },
    icons: { 'icon-rest': '8F8F8F', 'accent-500': '52A8FF' },
    fills: {
      'on-accent': ['0A0A0A', 'EDEDED'],
      'on-accent pressed': ['0A0A0A', 'CCCCCC'],
      'on-alarm': ['FFFFFF', 'C50000'],
      'on-strong': ['0A0A0A', 'EDEDED'],
      'tag accent': ['8CC4FF', '0D2847'],
      'tag lamp': ['FFC96B', '33240D'],
      'tag alarm': ['FF9592', '3C1618'],
      'tag neutral': ['A1A1A1', '1F1F1F'],
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
