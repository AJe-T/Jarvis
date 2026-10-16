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
      app: 'E6EBF1',
      main: 'F2F5F8',
      'surface-1': 'FFFFFF',
      'surface-2': 'E9EEF3',
      selected: 'D6E6EE',
    },
    hover: ['00788C', 0.07],
    text: {
      'ink-100': '071019',
      'ink-300': '2A3D4F',
      'ink-500': '3F5266',
      'accent-300': '006470',
      'alarm-500': 'B0002A',
      'lamp-400': '665000',
      'ok-400': '0B6334',
    },
    icons: { 'icon-rest': '3F5266', 'accent-500': '00808F' },
    fills: {
      'on-accent': ['001318', '00D2E6'],
      'on-accent pressed': ['001318', '00B8CC'],
      'on-alarm': ['FFFFFF', 'B0002A'],
      'on-strong': ['E4F7FF', '071019'],
      'tag accent': ['005561', 'C9F4F9'],
      'tag lamp': ['5C4500', 'FBF3B0'],
      'tag alarm': ['99001F', 'F9D3DB'],
      'tag neutral': ['2A3D4F', 'E1E8EE'],
    },
  },
  dark: {
    surfaces: {
      app: '05070B',
      main: '070A10',
      'surface-1': '0F1520',
      'surface-2': '151D2B',
      selected: '12293A',
    },
    hover: ['00F0FF', 0.07],
    text: {
      'ink-100': 'F0FBFF',
      'ink-300': 'BCCFDE',
      'ink-500': '9CB1C4',
      'accent-300': '4FE6FF',
      'alarm-500': 'FF4D6D',
      'lamp-400': 'FCEE0A',
      'ok-400': '39FF9F',
    },
    icons: { 'icon-rest': '9CB1C4', 'accent-500': '00E5FF' },
    fills: {
      'on-accent': ['001318', '00E5FF'],
      'on-accent pressed': ['001318', '6AF4FF'],
      'on-alarm': ['FFFFFF', 'D1103A'],
      'on-strong': ['001318', '00F0FF'],
      'tag accent': ['7FF1FF', '00313A'],
      'tag lamp': ['FFF27A', '2E2B05'],
      'tag alarm': ['FF8FA3', '3A0D18'],
      'tag neutral': ['BCCFDE', '162231'],
    },
  },
};

// Soft style (Design-system.md §3.7): its own neutrals and ink, the same accent and status colours.
THEMES['soft light'] = {
  ...THEMES.light,
  surfaces: {
    app: 'ECEEF2',
    main: 'F5F6F8',
    'surface-1': 'FFFFFF',
    'surface-2': 'EFF1F4',
    selected: 'E0E9F0',
  },
  text: { ...THEMES.light.text, 'ink-100': '14171C', 'ink-300': '2F3640', 'ink-500': '4A525E' },
  icons: { ...THEMES.light.icons, 'icon-rest': '4A525E' },
  fills: { ...THEMES.light.fills, 'tag neutral': ['2F3640', 'E6E9ED'] },
};
THEMES['soft dark'] = {
  ...THEMES.dark,
  surfaces: {
    app: '0D0F12',
    main: '121418',
    'surface-1': '1C1F25',
    'surface-2': '252930',
    selected: '1F2E38',
  },
  text: {
    ...THEMES.dark.text,
    'ink-100': 'F5F6F8',
    'ink-300': 'D0D5DC',
    'ink-500': 'ADB4BE',
    'alarm-500': 'FF6F87',
  },
  icons: { ...THEMES.dark.icons, 'icon-rest': 'ADB4BE' },
  fills: { ...THEMES.dark.fills, 'tag neutral': ['D0D5DC', '262A31'] },
};

// Pitch black (OLED): same ink and borders on true black, both styles (tokens.css data-oled).
for (const base of ['dark', 'soft dark'])
  THEMES[`${base} (pitch black)`] = {
    ...THEMES[base],
    surfaces: { app: '000000', main: '000000', 'surface-1': '0C0C0E', 'surface-2': '17171A', selected: '0F2A33' },
    hover: ['FFFFFF', 0.07],
    text: { ...THEMES[base].text, 'ink-100': 'FFFFFF', 'ink-300': 'DEDEE3', 'ink-500': 'B6B6BE' },
    icons: { ...THEMES[base].icons, 'icon-rest': 'B6B6BE' },
    fills: { ...THEMES[base].fills, 'tag neutral': ['DEDEE3', '1C1C20'] },
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
