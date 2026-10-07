// scripts/check-glass-contrast.mjs  ·  run: node scripts/check-glass-contrast.mjs
// Worst case per theme: every aurora blob stacked at peak, then saturate(160%), then each glass tint.
// Text tokens must stay >= 4.5:1 on every glass surface.
const hex = (s) => s.match(/\w\w/g).map((x) => parseInt(x, 16));
const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const over = (top, a, bot) => top.map((t, i) => a * t + (1 - a) * bot[i]);
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const saturate = ([r, g, b], s) => {
  const m = [[.2126 + .7874 * s, .7152 - .7152 * s, .0722 - .0722 * s],
             [.2126 - .2126 * s, .7152 + .2848 * s, .0722 - .0722 * s],
             [.2126 - .2126 * s, .7152 - .7152 * s, .0722 + .9278 * s]];
  return m.map(([a, b2, c]) => Math.min(255, Math.max(0, a * r + b2 * g + c * b)));
};

// Keep these in sync with tokens.css (:root = dark, [data-theme='light'] = light).
const THEMES = {
  dark: {
    void: '04060E',
    aurora: [['1673FF', .28], ['8A4DFF', .32], ['4B3FE0', .38], ['3FD8F5', .18], ['3FD8F5', .3], ['8A4DFF', .4]],
    pane: ['090D1C', .64], float: ['0C1124', .72], wash: [255, 255, 255],
    insetA: .05, hoverA: .07, selected: ['3FD8F5', .1],
    inks: { 'ink-100': 'E6EEFC', 'ink-300': 'A7B6CE', 'ink-500': 'A3B1CA', 'reactor-500': '3FD8F5',
            'lamp-400': 'FFB54A', 'alarm-500': 'FF8F86', 'ok-400': '46DFA0' },
  },
  light: {
    void: 'E9EEF8',
    aurora: [['78AAFF', .45], ['B496FF', .42], ['8CC8FF', .40], ['0891B2', .10], ['5EC8E5', .35], ['C08CFF', .35]],
    pane: ['FFFFFF', .6], float: ['FFFFFF', .74], wash: [15, 23, 42],
    insetA: .04, hoverA: .07, selected: ['0891B2', .12],
    inks: { 'ink-100': '0F172A', 'ink-300': '334155', 'ink-500': '475569', 'reactor-500': '0A5C73',
            'lamp-400': '854000', 'alarm-500': 'A31B12', 'ok-400': '036043' },
  },
};

let fails = 0;
for (const [name, t] of Object.entries(THEMES)) {
  let bg = hex(t.void);
  for (const [c, a] of t.aurora) bg = over(hex(c), a, bg);
  bg = saturate(bg, 1.6);
  const pane = over(hex(t.pane[0]), t.pane[1], bg);
  const surfaces = {
    pane,
    inset: over(t.wash, t.insetA, pane),
    hover: over(t.wash, t.hoverA, pane),
    selected: over(hex(t.selected[0]), t.selected[1], pane),
    float: over(hex(t.float[0]), t.float[1], bg),
  };
  let min = Infinity;
  for (const [n, c] of Object.entries(t.inks)) for (const [s, rgb] of Object.entries(surfaces)) {
    const r = ratio(hex(c), rgb); min = Math.min(min, r);
    if (r < 4.5) { fails++; console.log(`FAIL  ${name}: --${n} on ${s}: ${r.toFixed(2)}:1`); }
  }
  console.log(`${name}: lowest ${min.toFixed(2)}:1`);
}
console.log(fails ? `${fails} failure(s)` : 'PASS  all text tokens >= 4.5:1 on every glass surface, both themes');
process.exit(fails ? 1 : 0);
