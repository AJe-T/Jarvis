# Design System — JARVIS Desktop

| Field | Value |
|---|---|
| Status | v2.0 — Glass theme |
| Last updated | 2026-10-07 |
| Theme name | **Glass Workshop at Night** (dark glassmorphism) |
| Stack | Electron · React · TypeScript · Tailwind · Framer Motion |
| Related | [App-flow](App-flow.md) · [Code-style](Code-style.md) §6 · [PRD](PRD.md) F4.6 |

---

## 0. Quick start for an AI builder

This file is the **single source of truth** for the JARVIS look. Paste the prompt below together with this file.

```text
You are building the visual theme for JARVIS Desktop (Electron + React + TypeScript + Tailwind).
Treat Design-system.md as the single source of truth. Implement in this order, and show me
the result after each step before moving on:

1. Fonts: add Sora, Geist and JetBrains Mono variable .woff2 files to
   src/renderer/src/assets/fonts/ with the @font-face rules in §4.
2. Tokens: create src/renderer/src/styles/tokens.css exactly as in §3.6.
3. Glass utilities: create src/renderer/src/styles/glass.css from §3.7.
4. Tailwind: map tokens as in §3.8. No raw hex/rgba values and no backdrop-filter
   inside components; components use tokens and the glass-* classes only.
5. Backdrop: build <AppBackdrop/> (aurora + reactor spill + grain) per §3.1 and §3.7.
6. Shell: responsive layout per §5 (compact / medium / expanded / wide, floating glass islands).
7. Components: restyle per §6, in this order: ConfirmDialog, Composer, chat messages,
   tool call cards, Orb, then the rest.
8. Transparency modes and performance guards per §7.
9. Add scripts/check-glass-contrast.mjs from §3.5 and run it; it must exit 0.
10. Go through every item in §12 and report pass/fail for each.

Rules: never change a colour token, glass opacity or aurora opacity without re-running the
contrast script. Do not add glow, gradients or blur anywhere this file does not specify.
Ask me before deviating from this file.
```

---

## 1. Design Direction: "Glass Workshop at Night"

JARVIS lives in Sir's workshop after dark: a deep blue void, slow aurora light from the city behind the windows, and frosted glass instrument panels floating in front of it. One element, **the reactor orb**, is the light source; its glow reaches through the glass and tints the room with Jarvis's state.

The glass is **disciplined**, not decorative: three structural layers, fixed recipes, guaranteed contrast.

| Principle | Meaning in practice |
|---|---|
| **Colour lives behind the glass, meaning lives on it** | Aurora hues (blue, violet, indigo) exist only in the backdrop (L0). On glass, colour means state: cyan = Jarvis is active, amber = needs Sir's decision, red = destructive / stop, green = done. Violet is never a UI state colour. |
| **One reactor, everything else calm** | The orb is the only element that animates at rest. Its light spills onto the backdrop and changes colour with its state. Panels, text and controls stay still. |
| **Glass is earned by depth** | Only structural layers are glass: panes (L1) and floating layers (L3). Buttons, badges, chips and messages never get their own blur. |
| **Decisions are opaque** | The more important the decision, the less see-through the surface. Confirmation dialogs are the most solid thing on screen. |
| **Show the work** | Every action Jarvis takes is visible (Activity drawer, tool cards). Trust comes from transparency of behaviour, not of pixels. |
| **Readable first** | Every text colour passes 4.5:1 against the *worst-case* backdrop (§3.5). Chat column ≤ 72 characters; sentence-case labels; no all-caps eyebrows. |

What we deliberately avoid: blur on every element; glass stacked on glass; white frosted glass in the dark theme; neon or rainbow gradients inside UI controls; glowing borders on panels; animated aurora; text shadows or text glow; sci-fi display fonts for body text; monospace for non-code labels.

---

## 2. The Glass Stack

Four layers, back to front. Every surface in the app belongs to exactly one.

```text
 viewer
   ▼
   L3  Float / Decision  tint 84–92% · blur 32px · strong border · shadow    (transient)
   L2  Inset             white 4–6% fill · NO blur · hairline border
   L1  Pane              tint 64% · blur 24px · saturate 160% · top highlight
   L0  Backdrop          void + aurora + reactor spill + grain               (static)
```

| Layer | Used for | Recipe (class) |
|---|---|---|
| **L0 Backdrop** | The window background behind everything | `--void-950` + three aurora radial gradients + reactor spill + 3.5% grain. Static. (`<AppBackdrop/>`) |
| **L1 Pane** | Rail, chat column, Activity drawer (docked), status bar, Settings/Memory/Connections panes | `.glass-pane` — `--glass-pane` tint, `blur(24px) saturate(160%)`, 1px `--glass-border`, inset top highlight, `--radius-lg` |
| **L2 Inset** | Composer, Sir bubbles, tool cards, chips, list rows, form fields, setting groups | `.glass-inset` — `--glass-inset` fill, 1px `--glass-border`, **no backdrop-filter**; hover `--glass-hover`; selected `--glass-selected` + 2px reactor bar |
| **L3 Float** | Menus, popovers, toasts, overlay sheets, onboarding card | `.glass-float` — `--glass-float` tint, `blur(32px) saturate(160%)`, 1px `--glass-border-strong`, `--shadow-float`, `--radius-xl` |
| **L3 Decision** | Confirmation dialogs only | `.glass-decision` — `--glass-decision` (92%) tint over `.glass-scrim` |

### Rules of the stack

1. **Blur only on L1, L3 and the scrim.** L2 never blurs; it inherits the frost of the pane under it.
2. **At most two blurred layers over any pixel**, and the second must be transient (an L3 float or scrim).
3. **Never put `backdrop-filter` on anything inside a scroll container or anything that moves** (messages, tool cards, list rows). Scrolling blurred elements is the single biggest GPU cost.
4. **Never transition `backdrop-filter`, `filter` or blur radius.** Animate `opacity` and `transform` only.
5. **No glass on glass to fake depth.** Depth inside a pane comes from L2 tints, not another blur.
6. **Contrast guarantee:** tint opacities are *minimums*; aurora opacities are *maximums*. Aurora blobs may be moved or resized freely; their opacity may not go up and tint opacity may not go down without re-running §3.5.

---

## 3. Colour Tokens

Dark is the primary theme. **v2.1 adds a light "Daylight Workshop" theme** (Settings → General → Theme: Match Windows / Dark / Light, `<html data-theme>`): frosted white glass (`rgba(255,255,255,.6)`) over a pastel aurora, ink `#0F172A / #334155 / #475569`, reactor `#0A5C73`, lamp `#854000`, alarm `#A31B12`, ok `#036043`; values live in `tokens.css` under `:root[data-theme='light']`. Both themes add two compact backdrop light orbs (`--orb-a`, `--orb-b`) so the frosting is visible. `scripts/check-glass-contrast.mjs` checks both themes (≥ 4.5:1 worst case); `tokens.css` is the source of truth where this doc's older numbers differ.

### 3.1 Backdrop & aurora (L0 only)

| Token | Value | Use |
|---|---|---|
| `--void-950` | `#04060E` | Base of the backdrop; Electron `backgroundColor` (prevents a white flash on launch) |
| `--aurora-blue` | `#1673FF` at max **0.20** | Blob A, top-left (12% 8%), radius 55vmax |
| `--aurora-violet` | `#8A4DFF` at max **0.26** | Blob B, top-right (88% 18%), radius 50vmax |
| `--aurora-indigo` | `#4B3FE0` at max **0.34** | Blob C, bottom (70% 100%), radius 60vmax |
| `--spill-color` | reactor colour at max **0.18** | Reactor spill: 30vmax circle behind the orb's position. Follows orb state (§6.1) |
| Grain | SVG fractal noise at 3.5% | Breaks gradient banding on 8-bit displays |

Why this combination: cyan (the reactor) on a deep navy void, with blue and violet light behind it, gives the classic glass look while keeping the warm amber and red reserved for decisions and danger, so they still jump out.

### 3.2 Glass surfaces

| Token | Value | Use |
|---|---|---|
| `--glass-pane` | `rgba(9,13,28,0.64)` | L1 tint (v2.1: lighter so the backdrop reads through) |
| `--glass-float` | `rgba(12,17,36,0.84)` | L3 tint |
| `--glass-decision` | `rgba(12,17,36,0.92)` | Confirmation dialogs |
| `--glass-inset` | `rgba(255,255,255,0.04)` | L2 fill |
| `--glass-hover` | `rgba(255,255,255,0.06)` | L2 hover |
| `--glass-selected` | `rgba(63,216,245,0.10)` | Selected rows (always with a 2px `--reactor-500` bar + `aria-selected`) |
| `--glass-border` | `rgba(255,255,255,0.10)` | Pane and inset hairlines |
| `--glass-border-strong` | `rgba(255,255,255,0.16)` | Floats, focused-within containers, orb lens |
| `--glass-highlight` | `rgba(255,255,255,0.08)` | 1px inset top edge (the "light catching the glass") |
| `--scrim` | `rgba(4,6,14,0.60)` | Behind dialogs and overlay sheets |
| `--solid-pane` | `#0D1328` | Solid-mode replacement for `--glass-pane` (§7) |
| `--solid-float` | `#121933` | Solid-mode replacement for float/decision, and tooltips in all modes |
| `--solid-inset` | `#161D36` | Solid-mode replacement for `--glass-inset` |
| `--solid-hover` | `#1B2340` | Solid-mode replacement for `--glass-hover` |

Borders are decorative hairlines (1.3–1.7:1). Interactive components are identified by their fill, icon, label or placeholder; focus is shown by the reactor outline (≥ 7.5:1).

### 3.3 Semantic state colours

Meaning is unchanged from v1.0; only red was adjusted for glass.

| Token | Hex | Use |
|---|---|---|
| `--reactor-500` | `#3FD8F5` | Primary: orb core, primary buttons, focus ring, links, selected bar |
| `--reactor-300` | `#93ECFF` | Orb highlights, active text on dark |
| `--reactor-glow` | `rgba(63,216,245,0.32)` | Orb glow only |
| `--lamp-400` | `#FFB54A` | Needs decision: confirmations, warnings, "awaiting" state |
| `--alarm-500` | `#FF6B5E` | Destructive actions, errors, kill switch, Computer-Control border. Was `#FF5446`, which fell below 4.5:1 on glass rows |
| `--ok-400` | `#46DFA0` | Success ticks, connected status |

### 3.4 Ink (text)

| Token | Hex | Use |
|---|---|---|
| `--ink-100` | `#E6EEFC` | Primary text |
| `--ink-300` | `#A7B6CE` | Secondary text |
| `--ink-500` | `#8E9DB8` | Tertiary text (timestamps), min 13px. Was `#7F8FAA`, which measured 4.20:1 on a hovered glass row |
| `--ink-on-reactor` | `#04202A` | Text on cyan buttons (9.9:1) |
| `--ink-on-lamp` | `#2A1700` | Text on amber buttons/badges (9.8:1) |
| `--ink-on-alarm` | `#2A0503` | Text on red buttons (6.7:1) |
| `--ink-on-ok` | `#03231A` | Text on green badges (9.8:1) |

Status colours are always paired with an icon or text, never colour alone.

### 3.5 Contrast verification (worst case)

Worst case = all three aurora blobs **and** the reactor spill stacked at maximum opacity on the same pixel, then `saturate(160%)`, then the glass tint. Real screens are always brighter-safe than this.

| Token | Pane | Inset | Hover | Selected | Float | Decision |
|---|---|---|---|---|---|---|
| `--ink-100` | 13.67 | 12.30 | 11.60 | 11.07 | 14.35 | 15.26 |
| `--ink-300` | 7.76 | 6.99 | 6.59 | 6.29 | 8.15 | 8.67 |
| `--ink-500` | 5.82 | 5.24 | 4.94 | 4.71 | 6.11 | 6.50 |
| `--reactor-500` | 9.38 | 8.44 | 7.96 | 7.59 | 9.85 | 10.47 |
| `--lamp-400` | 9.08 | 8.17 | 7.71 | 7.35 | 9.54 | 10.14 |
| `--alarm-500` | 5.71 | 5.13 | 4.84 | 4.62 | 5.99 | 6.37 |
| `--ok-400` | 9.36 | 8.42 | 7.94 | 7.58 | 9.83 | 10.44 |

All values ≥ 4.5:1 (WCAG AA). Solid mode is higher everywhere (e.g., `--ink-500` on `--solid-pane` = 6.72:1).

Keep this check in the repo and run it in CI whenever tokens change:

```js
// scripts/check-glass-contrast.mjs  ·  run: node scripts/check-glass-contrast.mjs
// Worst case: every aurora blob stacked at peak, then saturate(160%), then each glass tint.
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

// Keep these in sync with tokens.css
const AURORA = [['1673FF', .20], ['8A4DFF', .26], ['4B3FE0', .34], ['3FD8F5', .18]];
const SATURATE = 1.6;
let bg = hex('04060E');
for (const [c, a] of AURORA) bg = over(hex(c), a, bg);
bg = saturate(bg, SATURATE);
const pane = over(hex('090D1C'), .74, bg);
const surfaces = {
  pane,
  inset: over([255, 255, 255], .04, pane),
  hover: over([255, 255, 255], .06, pane),
  selected: over(hex('3FD8F5'), .10, pane),
  float: over(hex('0C1124'), .84, bg),
};
const inks = { 'ink-100': 'E6EEFC', 'ink-300': 'A7B6CE', 'ink-500': '8E9DB8', 'reactor-500': '3FD8F5',
               'lamp-400': 'FFB54A', 'alarm-500': 'FF6B5E', 'ok-400': '46DFA0' };

let fails = 0, min = Infinity;
for (const [n, c] of Object.entries(inks)) for (const [s, rgb] of Object.entries(surfaces)) {
  const r = ratio(hex(c), rgb); min = Math.min(min, r);
  if (r < 4.5) { fails++; console.log(`FAIL  --${n} on ${s}: ${r.toFixed(2)}:1`); }
}
console.log(fails ? `${fails} failure(s)` : `PASS  all text tokens >= 4.5:1 on every glass surface (lowest ${min.toFixed(2)}:1)`);
process.exit(fails ? 1 : 0);
```

Expected output: `PASS  all text tokens >= 4.5:1 on every glass surface (lowest 4.62:1)`.

### 3.6 `tokens.css`

```css
/* src/renderer/src/styles/tokens.css */
@property --spill-color {            /* registered so the orb-state colour change can cross-fade */
  syntax: '<color>';
  inherits: true;
  initial-value: rgba(63, 216, 245, 0.18);
}

:root {
  /* L0 backdrop */
  --void-950:#04060E;
  --aurora-blue:22 115 255;  --aurora-a-blue:.20;
  --aurora-violet:138 77 255; --aurora-a-violet:.26;
  --aurora-indigo:75 63 224; --aurora-a-indigo:.34;
  --spill-color:rgba(63,216,245,.18);
  --grain-opacity:.035;

  /* Glass surfaces */
  --glass-pane:rgba(9,13,28,.74);  --glass-float:rgba(12,17,36,.84); --glass-decision:rgba(12,17,36,.92);
  --glass-inset:rgba(255,255,255,.04); --glass-hover:rgba(255,255,255,.06); --glass-selected:rgba(63,216,245,.10);
  --glass-border:rgba(255,255,255,.10); --glass-border-strong:rgba(255,255,255,.16); --glass-highlight:rgba(255,255,255,.08);
  --scrim:rgba(4,6,14,.60);
  --blur-pane:24px; --blur-float:32px; --blur-scrim:6px; --glass-saturate:160%;

  /* Solid fallbacks */
  --solid-pane:#0D1328; --solid-float:#121933; --solid-inset:#161D36; --solid-hover:#1B2340;

  /* Semantic */
  --reactor-500:#3FD8F5; --reactor-300:#93ECFF; --reactor-glow:rgba(63,216,245,.32);
  --lamp-400:#FFB54A; --alarm-500:#FF6B5E; --ok-400:#46DFA0;

  /* Ink */
  --ink-100:#E6EEFC; --ink-300:#A7B6CE; --ink-500:#8E9DB8;
  --ink-on-reactor:#04202A; --ink-on-lamp:#2A1700; --ink-on-alarm:#2A0503; --ink-on-ok:#03231A;

  /* Type */
  --font-display:"Sora", "Segoe UI Variable Display", "Segoe UI", sans-serif;
  --font-body:"Geist", "Segoe UI Variable Text", "Segoe UI", sans-serif;
  --font-code:"JetBrains Mono", "Cascadia Mono", Consolas, monospace;

  /* Space, shape, depth */
  --space-1:4px; --space-2:8px; --space-3:12px; --space-4:16px; --space-5:24px; --space-6:32px; --space-7:48px; --space-8:64px;
  --shell-gap:8px;
  --radius-sm:8px; --radius-md:12px; --radius-lg:16px; --radius-xl:24px; --radius-pill:999px;
  --shadow-pane:0 8px 32px -16px rgba(0,0,0,.50);
  --shadow-float:0 24px 48px -12px rgba(0,0,0,.55), 0 2px 6px rgba(0,0,0,.25);

  /* Motion */
  --dur-fast:120ms; --dur-base:200ms; --dur-slow:320ms;
  --ease-standard:cubic-bezier(.2,.8,.2,1); --ease-exit:cubic-bezier(.4,0,1,1);
}
```

### 3.7 `glass.css` (utilities + backdrop)

```css
/* src/renderer/src/styles/glass.css */

/* ---------- L0 backdrop: <AppBackdrop/> renders <div class="app-backdrop"><div class="reactor-spill"/></div> */
.app-backdrop {
  position: fixed; inset: 0; z-index: 0; overflow: hidden; pointer-events: none;
  background:
    radial-gradient(55vmax 55vmax at 12% 8%,   rgb(var(--aurora-blue)   / var(--aurora-a-blue)),   transparent 60%),
    radial-gradient(50vmax 50vmax at 88% 18%,  rgb(var(--aurora-violet) / var(--aurora-a-violet)), transparent 60%),
    radial-gradient(60vmax 60vmax at 70% 100%, rgb(var(--aurora-indigo) / var(--aurora-a-indigo)), transparent 60%),
    var(--void-950);
}
.reactor-spill {                                    /* --spill-x / --spill-y set from the orb's on-screen position */
  position: absolute; inset: 0;
  background: radial-gradient(circle 30vmax at var(--spill-x, 50%) var(--spill-y, 12%), var(--spill-color), transparent 65%);
  transition: --spill-color var(--dur-slow) var(--ease-standard);
}
.app-backdrop::after {                              /* grain: kills gradient banding; works offline */
  content: ""; position: absolute; inset: 0; opacity: var(--grain-opacity);
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");
}

/* ---------- L1 pane */
.glass-pane {
  background: var(--glass-pane);
  -webkit-backdrop-filter: blur(var(--blur-pane)) saturate(var(--glass-saturate));
          backdrop-filter: blur(var(--blur-pane)) saturate(var(--glass-saturate));
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  box-shadow: inset 0 1px 0 var(--glass-highlight), var(--shadow-pane);
}

/* ---------- L2 inset (never blurs) */
.glass-inset { background: var(--glass-inset); border: 1px solid var(--glass-border); border-radius: var(--radius-md); }
.glass-inset:where(:hover, [data-hover]) { background: var(--glass-hover); }
.glass-inset[aria-selected="true"] { background: var(--glass-selected); box-shadow: inset 2px 0 0 var(--reactor-500); }
.glass-inset:focus-within { border-color: var(--glass-border-strong); }

/* ---------- L3 float + decision + scrim */
.glass-float, .glass-decision {
  -webkit-backdrop-filter: blur(var(--blur-float)) saturate(var(--glass-saturate));
          backdrop-filter: blur(var(--blur-float)) saturate(var(--glass-saturate));
  border: 1px solid var(--glass-border-strong);
  border-radius: var(--radius-xl);
  box-shadow: inset 0 1px 0 var(--glass-highlight), var(--shadow-float);
}
.glass-float    { background: var(--glass-float); }
.glass-decision { background: var(--glass-decision); }
.glass-scrim {
  background: var(--scrim);
  -webkit-backdrop-filter: blur(var(--blur-scrim)); backdrop-filter: blur(var(--blur-scrim));
}

/* ---------- Focus (works on every layer; outline follows border-radius and never replaces a component's shadow) */
:focus-visible { outline: 2px solid var(--reactor-500); outline-offset: 2px; }

/* ---------- Transparency modes (set on <html data-glass="...">, see §7) */
:root[data-glass="reduced"] {                      /* same look, no blur: tint raised to compensate */
  --glass-pane: rgba(9,13,28,.86); --glass-float: rgba(12,17,36,.92); --glass-decision: rgba(12,17,36,.95);
}
:root[data-glass="solid"] {                        /* no transparency at all */
  --glass-pane: var(--solid-pane); --glass-float: var(--solid-float); --glass-decision: var(--solid-float);
  --glass-inset: var(--solid-inset); --glass-hover: var(--solid-hover); --scrim: rgba(4,6,14,.72);
}
[data-glass="solid"] .app-backdrop { background: var(--void-950); }
[data-glass="solid"] .app-backdrop > *, [data-glass="solid"] .app-backdrop::after { display: none; }
:is([data-glass="reduced"], [data-glass="solid"]) :is(.glass-pane, .glass-float, .glass-decision, .glass-scrim) {
  -webkit-backdrop-filter: none; backdrop-filter: none;
}

@media (prefers-reduced-motion: reduce) {
  .reactor-spill { transition: none; }
}
```

### 3.8 Tailwind mapping

Mobile-first: base styles are the compact layout; `md`, `lg`, `xl` add space.

```js
// tailwind.config.js (excerpt, v3 syntax; on Tailwind v4 declare the same names in an @theme block)
export default {
  theme: {
    screens: { md: '760px', lg: '1200px', xl: '1600px', short: { raw: '(max-height: 599px)' } },
    extend: {
      colors: {
        void:    { 950: 'var(--void-950)' },
        glass:   { pane: 'var(--glass-pane)', float: 'var(--glass-float)', inset: 'var(--glass-inset)',
                   hover: 'var(--glass-hover)', selected: 'var(--glass-selected)',
                   border: 'var(--glass-border)', 'border-strong': 'var(--glass-border-strong)' },
        reactor: { 300: 'var(--reactor-300)', 500: 'var(--reactor-500)' },
        lamp:    { 400: 'var(--lamp-400)' },
        alarm:   { 500: 'var(--alarm-500)' },
        ok:      { 400: 'var(--ok-400)' },
        ink:     { 100: 'var(--ink-100)', 300: 'var(--ink-300)', 500: 'var(--ink-500)',
                   'on-reactor': 'var(--ink-on-reactor)', 'on-lamp': 'var(--ink-on-lamp)',
                   'on-alarm': 'var(--ink-on-alarm)', 'on-ok': 'var(--ink-on-ok)' },
      },
      fontFamily:   { display: 'var(--font-display)', body: 'var(--font-body)', code: 'var(--font-code)' },
      borderRadius: { sm: 'var(--radius-sm)', md: 'var(--radius-md)', lg: 'var(--radius-lg)', xl: 'var(--radius-xl)' },
      boxShadow:    { pane: 'var(--shadow-pane)', float: 'var(--shadow-float)' },
      transitionDuration: { fast: 'var(--dur-fast)', base: 'var(--dur-base)', slow: 'var(--dur-slow)' },
    },
  },
};
```

**Lint rules** (extends [Code-style](Code-style.md) §6): no raw hex or `rgba()` in components; no `backdrop-filter`, `backdrop-blur-*` or `blur-*` utilities in components. Glass comes only from the `glass-*` classes.

---

## 4. Typography

| Role | Family | Weights | Why |
|---|---|---|---|
| Display (orb status line, section headings, empty-state greeting, onboarding) | **Sora** | 500, 600 | Geometric, round-shouldered letterforms that echo the rounded glass panes; futuristic without sci-fi costume. Replaces Chakra Petch, whose chamfered corners fought the soft glass radii. |
| Body & UI (chat, settings, dialogs, dialog titles) | **Geist** | 400, 500, 600 | Tall x-height and open apertures stay crisp on translucent, colour-shifting surfaces at 13–15px; tabular figures for costs and timestamps. |
| Code only (code blocks, PowerShell previews, file paths in dialogs) | **JetBrains Mono** | 400 | Clear distinction of code from prose; unambiguous `0/O`, `1/l/I`. |

All three are SIL Open Font License. **Bundle variable `.woff2` files locally** in `src/renderer/src/assets/fonts/` so Vite fingerprints them and the app works offline (no CDN).

```css
/* src/renderer/src/styles/fonts.css */
@font-face { font-family:"Sora";           src:url("../assets/fonts/Sora-Variable.woff2") format("woff2");          font-weight:100 800; font-display:swap; }
@font-face { font-family:"Geist";          src:url("../assets/fonts/Geist-Variable.woff2") format("woff2");         font-weight:100 900; font-display:swap; }
@font-face { font-family:"JetBrains Mono"; src:url("../assets/fonts/JetBrainsMono-Variable.woff2") format("woff2"); font-weight:100 800; font-display:swap; }
```

Type scale (1.25 ratio, base 15px for dense desktop UI):

| Token | Size / line-height | Family | Use |
|---|---|---|---|
| `text-xs` | 12 / 16 | Geist 500 | Badges, keyboard hints |
| `text-sm` | 13 / 18 | Geist 400 | Meta, timestamps, tool card details |
| `text-base` | 15 / 24 | Geist 400 | Chat body, form text |
| `text-lg` | 19 / 28 | Geist 600 (dialogs) · Sora 600 (panel headings) | Dialog titles, panel headings |
| `text-xl` | 24 / 32 | Sora 600 | Empty-state greeting |
| `text-2xl` | 30 / 36 | Sora 600 | Onboarding headings |

Rules:

- Sentence case everywhere; no letter-spaced all-caps labels.
- **No font weight below 400 on glass** — thin strokes shimmer over shifting colour.
- **No text shadows or text glow.** Only the orb glows.
- Sora never below 17px; anything smaller uses Geist.
- Chat line length ≤ 72ch; numbers in tables and the status bar use `font-variant-numeric: tabular-nums`.

---

## 5. Responsive Layout

### 5.1 Window sizing & breakpoints

Default window **1100 × 760**, minimum **480 × 520** (lets the app use Windows Snap half-screen on 1280–1366px laptops). Breakpoints are on the window's inner width.

| Mode | Width | Shell gap | Rail | Chat column | Activity drawer | Status bar |
|---|---|---|---|---|---|---|
| **compact** (base) | 480–759 | 6px | 52px icon rail, 40px targets | Fills; 12px padding | Overlay sheet from right (`glass-float`, max 360px / 88% width) over scrim | Condensed: connectivity + today's cost |
| **medium** (`md`) | 760–1199 | 8px | 64px icon rail | Fills; ≤ 72ch, centred; 16px padding | Overlay sheet 340px (`glass-float`) | Full |
| **expanded** (`lg`) | 1200–1599 | 8px | 64px icon rail | ≤ 72ch, centred; 24px padding | Docked pane 320px (`glass-pane`), collapsible | Full |
| **wide** (`xl`) | ≥ 1600 | 12px | 200px rail with labels | ≤ 72ch, centred | Docked pane 360px | Full |
| **short** (any width) | height < 600 | — | — | Empty-state orb uses `md` (96px); composer max 4 lines | — | 28px tall |

The shell is a set of **floating glass islands** (rail, chat, drawer, status bar) separated by `--shell-gap`, so a thin line of aurora shows between them. This gap is the signature of the theme; don't merge panes into one slab.

### 5.2 Main window — expanded

```text
┌─ L0 aurora backdrop ───────────────────────────────────────────────────────┐
│ ╭────╮ ╭────────────────────────────────────────────╮ ╭──────────────────╮ │
│ │ Ch │ │ (o) Jarvis · Listening                     │ │ Activity         │ │
│ │ Me │ │                                            │ │ ✓ open_app  VS…  │ │
│ │ Ac │ │             ╭───────────────────────────╮  │ │ ✓ open_app  Chr… │ │
│ │ Co │ │             │ Sir: Open VS Code, Chrome │  │ │                  │ │
│ │ Se │ │             ╰───────────────────────────╯  │ │                  │ │
│ │    │ │ Jarvis: Both are open, sir.                │ │                  │ │
│ │    │ │  [tool card] [tool card]                   │ │                  │ │
│ │    │ │ ╭────────────────────────────────────────╮ │ │                  │ │
│ │    │ │ │ Message Jarvis…          mic  att  ⏎   │ │ │                  │ │
│ ╰────╯ ╰─╰────────────────────────────────────────╯─╯ ╰──────────────────╯ │
│ ╭────────────────────────────────────────────────────────────────────────╮ │
│ │ Voice: wake word · Sonnet 5.5 · Today $0.42 / $2 · ● Online            │ │
│ ╰────────────────────────────────────────────────────────────────────────╯ │
└────────────────────────────────────────────────────────────────────────────┘
  L1 panes: rail, chat, drawer, status bar  ·  L2 insets: Sir bubble, tool cards, composer
```

### 5.3 Main window — compact

```text
┌─ L0 aurora ──────────────────────────┐
│ ╭────╮ ╭───────────────────────────╮ │
│ │ Ch │ │ (o) Jarvis · Idle   [Act] │ │ ← opens Activity as overlay sheet
│ │ Me │ │                           │ │
│ │ Ac │ │   ╭─────────────────────╮ │ │
│ │ Co │ │   │ Sir: Open VS Code   │ │ │
│ │ Se │ │   ╰─────────────────────╯ │ │
│ │    │ │ Jarvis: It's open, sir.   │ │
│ │    │ │ ╭───────────────────────╮ │ │
│ │    │ │ │ Message Jarvis…  mic ⏎│ │ │
│ ╰────╯ ╰─╰───────────────────────╯─╯ │
│ ╭──────────────────────────────────╮ │
│ │ ● Online · $0.42                 │ │
│ ╰──────────────────────────────────╯ │
└──────────────────────────────────────┘
```

Rail destinations: Chat, Memory, Activity (full log), Connections (MCP), Settings. Icons always have tooltips and accessible names; labels appear only in `xl`.

### 5.4 Empty state (new conversation)

The orb is large (160px; 96px in `short`) and centred on the chat pane, sitting in its glass lens (§6.1), with one line beneath it in Sora: "Good evening, sir. What shall we work on?" plus three suggestion chips (`glass-inset`, pill) drawn from recent routines. The reactor spill is centred behind the orb.

When the first message is sent, the orb animates to its compact 40px position at the top of the chat column and the spill follows it (`--spill-x/y`). This is the app's **single orchestrated motion moment**.

### 5.5 Mini mode (P1)

Frameless, always-on-top, 112 × 112 transparent window with the orb only; click → expand main window; drag to move; 2-line caption bubble while speaking.

⚠ CSS `backdrop-filter` only blurs content *inside* the page, never the desktop behind a transparent window. Mini mode therefore uses a **solid-tint disc** (`--solid-float` at 100%, `--glass-border-strong` ring, `--glass-highlight` top edge) instead of real blur. The caption bubble uses the same recipe.

### 5.6 Computer-Control overlay

Click-through, transparent, full-screen window with a 4px `--alarm-500` border and a top-centre pill: "Jarvis is controlling your PC · Stop (Ctrl+Alt+Shift+X)". The pill is the only clickable region. Excluded from screenshots (`setContentProtection(true)`).

**This overlay is never glass.** The pill is solid `--solid-float` with a 1px `--alarm-500` border, an alarm-red dot and `--ink-100` text. Safety signals must look identical on any wallpaper.

---

## 6. Components

### 6.1 Orb (`components/jarvis/Orb.tsx`) — the signature element

Implementation: SVG + CSS/Framer Motion (no WebGL in v1). Concentric rings around a core; audio level (`voice:level`) drives core scale while listening. The orb is not glass; it is the light source. At `lg` and `md` sizes it sits in a circular **lens**: 1px `--glass-border-strong` ring with a `--glass-highlight` top edge, no fill, no blur.

The orb publishes its state colour to the backdrop by setting `--spill-color` on `<html>`.

| State | Visual | Motion | Backdrop spill (`--spill-color`) |
|---|---|---|---|
| `IDLE` | Core `--reactor-500` at 60% opacity, soft glow | Slow breathing (4 s opacity 0.6↔0.8) | `rgba(63,216,245,.12)` |
| `LISTENING` | Core full brightness, outer ring visible | Core scale follows mic RMS (0.9–1.15), ring pulses | `rgba(63,216,245,.18)` |
| `THINKING` | Inner ring segments | Ring rotates 1.2 s/turn | `rgba(63,216,245,.16)` |
| `ACTING` | Segmented ring with progress ticks | Ticks advance per tool call | `rgba(63,216,245,.16)` |
| `AWAITING_CONFIRMATION` | Core shifts to `--lamp-400` | Gentle 1 s pulse | `rgba(255,181,74,.16)` |
| `SPEAKING` | Core cyan, waveform ring | Ring amplitude follows TTS output level | `rgba(63,216,245,.18)` |
| `ERROR` | Core `--alarm-500`, ring dimmed | Single shake (200 ms) then static | `rgba(255,107,94,.14)` |
| `SLEEP` / voice off | Core `--ink-500` outline only | None | `transparent` |

Spill opacity never exceeds 0.18 (contrast guarantee). The spill colour cross-fades over `--dur-slow`; it does not pulse with the orb.

Props: `state: AssistantState`, `level?: number (0–1)`, `size: 'sm'(40) | 'md'(96) | 'lg'(160)`.
Accessibility: `role="img"`, `aria-label="Jarvis is {state}"`; a visually hidden `aria-live="polite"` region announces state changes (debounced). `prefers-reduced-motion`: no rotation/scale, spill changes instantly; state shown by colour + status text only.

### 6.2 Composer

- Surface: `glass-inset`, `--radius-lg`, min-height 52px; on focus-within: `--glass-border-strong` border plus the reactor focus ring on the textarea.
- Multiline textarea (Enter to send, Shift+Enter newline), mic button (shows hotkey hint), attach button (P1), send button (`--reactor-500` fill, `--ink-on-reactor` icon).
- While a turn is running, Send becomes **Stop** (`--alarm-500` outline + square icon; cancels turn).
- Placeholder (`--ink-500`): "Message Jarvis…"; voice-mode hint below when wake word is on: "Say 'Jarvis' or press Ctrl+Alt+Space".
- Max height: 8 lines (4 in `short`), then scrolls internally.

### 6.3 Chat messages

| Variant | Style |
|---|---|
| Sir | Right-aligned `glass-inset` bubble, `--ink-100`, `--radius-lg` with 6px bottom-right corner, max 80% width (88% in compact) |
| Jarvis | Left-aligned, no bubble, full column width, directly on the pane; Markdown rendered (GFM tables, code blocks with copy button); citations as numbered links in `--reactor-500` |
| Code block | `--solid-inset` background (solid, for legibility), `--radius-md`, `--font-code`, copy button top-right |
| System notice | Centred, `text-sm`, `--ink-500` (e.g., "Conversation saved to Obsidian") |
| Interrupted | Jarvis text + `--ink-500` "(interrupted)" |

Streaming: text appears as it arrives with a 2px cyan caret; no per-token animation. Messages never blur and never animate in beyond a 120ms opacity fade.

### 6.4 Tool call card

Compact `glass-inset` row (`--radius-md`, 40px min height) inside a Jarvis message and in the Activity drawer.

```text
[icon] Open Visual Studio Code            SAFE   ✓ 120 ms   ▸
```

| Status | Indicator |
|---|---|
| pending | `--ink-500` dot |
| awaiting confirmation | `--lamp-400` dot + "Waiting for you"; card gets a 2px left `--lamp-400` bar |
| running | cyan spinner (reduced motion: static "Running") |
| success | `--ok-400` check |
| error | `--alarm-500` cross + one-line error |
| denied / blocked | `--ink-500` slash + "Declined" / "Not permitted" |

Expand (▸) shows input JSON (redacted) and output preview in `--font-code` on `--solid-inset`. Tier badges (pill, `text-xs`): SAFE = `--glass-border-strong` outline, CONFIRM = `--lamp-400` outline, BLOCKED = `--alarm-500` outline.

### 6.5 Confirmation dialog (`ConfirmDialog.tsx`) — safety-critical

```text
┌──────────────────────────────────────────────────────┐
│ ⚠  Move 14 files to the Recycle Bin?                 │  ← title = exact action (Geist 600, text-lg)
│                                                      │
│ Jarvis wants to delete files older than 30 days      │  ← one-sentence purpose
│ from Downloads.                                      │
│                                                      │
│ ▾ Show the 14 files                                  │  ← details (paths in mono, on --solid-inset)
│                                                      │
│ ⓘ Suggested after reading github.com/...             │  ← taint banner (amber), only if tainted
│                                                      │
│           [ Cancel ]   [ Move to Recycle Bin ]       │  ← primary button named by action
└──────────────────────────────────────────────────────┘
```

| Rule | Detail |
|---|---|
| Surface | `glass-decision` (92% tint, the most opaque glass in the app) centred over `glass-scrim`; width 480px (compact: window width − 24px) |
| Destructive accent | 1px border `--alarm-500` at 50% + alarm icon in the title |
| Confirm-tier accent | 2px top hairline `--lamp-400` + warning icon |
| Taint banner | `rgba(255,181,74,.10)` fill, 1px `--lamp-400` at 40% border, `--lamp-400` icon, `--ink-100` text |
| Role | `role="alertdialog"`, focus trapped, title is `aria-labelledby` |
| Button naming | Primary button repeats the action verb ("Move to Recycle Bin", "Run script", "Close Chrome"), never "OK"/"Yes" |
| Destructive | Primary button `--alarm-500` fill + `--ink-on-alarm`; **initial focus on Cancel**; Enter does not approve; approve via click or `Ctrl+Enter` |
| Non-destructive | Primary `--reactor-500` fill + `--ink-on-reactor`; initial focus on primary; Enter approves; voice "yes" approves |
| Cancel button | `glass-inset` with `--ink-100` text |
| PowerShell | Full script in a scrollable `--solid-inset` code block with line numbers; purpose above it |
| Timeout | Auto-deny after 120 s with a visible countdown in the last 20 s |
| Queue | One dialog at a time; queued count shown ("1 of 3") |
| Window | If the main window is hidden, show it and flash the taskbar; also speak the prompt in voice mode |
| Transparency modes | Same layout in all three modes; in solid mode it is fully opaque |

### 6.6 Other components

| Component | Surface | Notes |
|---|---|---|
| Status bar | `glass-pane` island, 32px (28px short) | Voice mode, current model, today's cost vs budget (amber + icon at 80%, red + icon at 100%), connectivity, MCP issues count; tabular figures |
| Activity drawer | Docked `glass-pane` (`lg`+) / overlay `glass-float` sheet (compact, `md`) | Live tool timeline for the current conversation; filter by status (`glass-inset` pills); "Open full log" |
| Buttons | Primary: `--reactor-500` fill · Secondary: `glass-inset` · Destructive: `--alarm-500` fill · Ghost: text only | 36px height (32px min hit area), `--radius-md`; hover lightens fill 8%; no glow on buttons |
| Toasts | `glass-float`, `--radius-lg`, bottom-right, 4 s, max 3 | Errors persist until dismissed and get a 3px left `--alarm-500` bar + icon |
| Menus / popovers | `glass-float`, `--radius-md` | Rows are L2 hover states |
| Tooltips | `--solid-float`, no blur, `--radius-sm`, `text-xs` | Too small and frequent for blur to be worth its cost |
| Settings | `glass-pane`; each group is a `glass-inset` section (`--radius-lg`) | Groups: General, Appearance (transparency mode §7), Voice, Models & budget, Files & permissions, Memory, Connections, Privacy, Hotkeys, Advanced. Secrets field shows "•••• 1a2b" + Replace |
| Memory browser | Two `glass-pane` islands (`lg`+); stacked list → note navigation in compact | Left: tree of `Memory/`; right: rendered note with "Open in Obsidian" and "Forget" (red, confirm) |
| Connections | `glass-pane` with `glass-inset` rows | MCP server list with status dot + text, tool count, trust badge, enable toggle, per-tool tier overrides |
| Toggles | Track `--glass-inset` + `--glass-border-strong`; on: `--reactor-500` track, `--void-950` thumb | Always with a text label |
| Onboarding | Full aurora backdrop; one `glass-float` card, max 560px, centred (compact: full width − 24px) | 5-step stepper (Welcome → Brain key → Vault → Voice → Safety); each step ≤ 1 screen; the Safety step previews the confirmation dialog |

---

## 7. Transparency Modes, Fallbacks & Performance

The `<html>` element carries `data-glass="full" | "reduced" | "solid"`.

| Mode | Look | When it is used |
|---|---|---|
| **full** | Aurora + blur + tints as specified | Default on AC power with GPU compositing |
| **reduced** | Aurora + tints (raised to 86% / 92%), **no blur** | On battery; GPU compositing unavailable |
| **solid** | No aurora, no transparency; solid tokens | OS "Transparency effects" off / `prefers-reduced-transparency: reduce`; or chosen by Sir |

Settings → Appearance → Transparency offers **Auto** (default), Full glass, Reduced, Solid. Auto picks a mode in this order:

1. `prefers-reduced-transparency: reduce` matches (where the OS reports it) → **solid**
2. `app.getGPUFeatureStatus().gpu_compositing` is not `"enabled"` → **reduced**
3. `powerMonitor.isOnBatteryPower()` is true → **reduced** (listen to `on-battery` / `on-ac` to switch live)
4. Otherwise → **full**

Switching mode must apply live, without a reload.

Why "reduced" is a good battery default: the backdrop is already made of soft gradients, so removing blur from panes changes very little visually. Blur matters most on floats sitting over text, which are transient.

**Electron window setup (main process):**

```ts
new BrowserWindow({
  width: 1100, height: 760, minWidth: 480, minHeight: 520,
  backgroundColor: '#04060E',            // = --void-950; no white flash before first paint
  // Optional custom title bar so the aurora runs under it:
  titleBarStyle: 'hidden',
  titleBarOverlay: { color: '#00000000', symbolColor: '#E6EEFC', height: 40 },
  // Verify caption buttons stay legible on your Electron version; if transparency
  // is not honoured, use color: '#0B1124'.
});
```

Native Windows acrylic/mica (`backgroundMaterial`) is a **P2 experiment, not the default**: it blurs the user's wallpaper, which we cannot control, so the contrast guarantee in §3.5 would no longer hold.

**Performance budget:**

| Rule | Target |
|---|---|
| Blurred surfaces visible at once | ≤ 4 at rest (rail, chat, drawer, status bar); + 1 float or scrim when open |
| Blur on scrolling or moving content | Never |
| Animated `backdrop-filter` / blur radius | Never |
| Idle app, window focused | No continuous repaints except the orb (check DevTools → Rendering → Paint flashing) |
| Window resize | No visible lag at 1440p on integrated graphics in full mode; if there is, reduce `--blur-pane` to 16px before anything else |

---

## 8. Motion

| Token | Value | Use |
|---|---|---|
| `--dur-fast` | 120 ms | Hover/press feedback, message fade-in |
| `--dur-base` | 200 ms | Dialogs, drawers, sheets, toasts enter |
| `--dur-slow` | 320 ms | Orb resize (empty state → compact), spill colour cross-fade |
| Easing | `--ease-standard` enter, `--ease-exit` leave | |

Glass surfaces enter with `opacity 0→1` and `translateY(8px)→0` (sheets: `translateX(16px)→0`); the blur is present from the first frame, never animated. The aurora never moves. Only the orb animates without user action; everything else animates only in response to Sir (open, expand, confirm). Respect `prefers-reduced-motion` globally (opacity-only transitions, no orb rotation/scale, instant spill changes).

---

## 9. Iconography & Sound

- Icons: **lucide-react**, 18px default, 1.75 stroke, `--ink-300` at rest, `--ink-100` on hover/active, state colour only when they carry state; always with text or `aria-label`.
- Sounds (P1, toggle in Settings, bundled locally): soft rising chime on LISTENING, lower chime on cancel, two-tone for confirmation needed. Max 300 ms each, −18 LUFS.

---

## 10. Writing in the Interface

| Do | Don't |
|---|---|
| "Move 14 files to the Recycle Bin?" | "Are you sure?" |
| "Couldn't reach Claude. Check your internet connection or API key in Settings → Brain." | "Oops! Something went wrong." |
| "Connections" | "MCP server configuration" |
| "Saved to Obsidian" (matches "Save to Obsidian" setting name) | Different names for the same action |
| "Transparency: Auto" | "Glassmorphism engine" |
| Sentence case labels | Title Case Or ALL CAPS |

The butler persona ("sir", dry wit) appears **only in Jarvis's own messages and speech**. UI chrome (buttons, settings, errors) uses plain, neutral language.

---

## 11. Accessibility Checklist

- [ ] Full keyboard navigation; visible 2px `--reactor-500` focus outline with 2px offset on every layer.
- [ ] All interactive elements ≥ 32×32px hit area (40px in compact rail).
- [ ] `node scripts/check-glass-contrast.mjs` passes (all text ≥ 4.5:1 against the worst-case backdrop).
- [ ] Final assistant messages announced via `aria-live="polite"` (not per token).
- [ ] Confirmation dialog is `alertdialog`, traps focus, restores focus on close.
- [ ] Colour never the only signal (icons/text accompany status colours; selected rows have a bar + `aria-selected`).
- [ ] Reduced-motion mode verified.
- [ ] Solid transparency mode verified with Windows "Transparency effects" turned off.
- [ ] Text scales with Windows display scaling (use rem units; test at 100%, 125%, 150%).

---

## 12. Acceptance Criteria for the Build

The theme is done when every item passes:

- [ ] `tokens.css`, `glass.css`, `fonts.css` and `<AppBackdrop/>` exist and match §3.6, §3.7, §4.
- [ ] No raw hex/`rgba()`, `backdrop-filter` or Tailwind blur utilities inside components (lint passes).
- [ ] Contrast script exits 0.
- [ ] Window at 480, 760, 1200 and 1600px wide: layout matches §5.1, no horizontal scrollbar, drawer docks/overlays correctly.
- [ ] Window height 560px: `short` rules apply (96px orb, 4-line composer).
- [ ] Shell shows separate glass islands with aurora visible in the gaps.
- [ ] All three transparency modes render correctly and switch live from Settings.
- [ ] Orb state changes cross-fade the backdrop spill; spill tracks the orb from empty state to compact.
- [ ] Nothing inside a scroll container has `backdrop-filter`; no transition targets `backdrop-filter` or `filter`.
- [ ] Orb is the only thing animating at rest (Paint flashing check).
- [ ] Every rule in §6.5 (confirmation dialog) passes.
- [ ] Mini mode and Computer-Control overlay use solid recipes (§5.5, §5.6), not CSS blur.
- [ ] Fonts load with the network offline.
- [ ] §11 checklist passes.

---

## 13. Changelog: v1.0 → v2.0

| Area | v1.0 | v2.0 | Why |
|---|---|---|---|
| Direction | Flat "Workshop at Night" | "Glass Workshop at Night": aurora backdrop + frosted glass islands | Glassmorphism requested |
| Background | Flat `#060A12` | `#04060E` void + blue/violet/indigo aurora + reactor spill + grain | Glass needs colour behind it to read as glass |
| Surfaces | Solid `--night-900/800/700/600` | Four-layer glass stack (L0–L3); solid tokens kept as fallback | Consistent depth with fixed recipes |
| Orb | Glow only | Glow + backdrop spill that changes colour with state | The reactor "lights the room" |
| Display font | Chakra Petch | Sora | Chamfered corners clashed with rounded glass |
| Body font | IBM Plex Sans | Geist | Crisper on translucent, colour-shifting surfaces |
| `--ink-500` | `#7F8FAA` | `#8E9DB8` | Old value measured 4.20:1 on a hovered glass row |
| `--alarm-500` | `#FF5446` | `#FF6B5E` | Old value fell below 4.5:1 on glass rows |
| New ink tokens | — | `--ink-on-lamp`, `--ink-on-ok` | Text on amber/green badges |
| Radii | 6 / 10px | 8 / 12 / 16 / 24px | Glass reads softer with larger radii |
| Minimum window | 720 × 520 | 480 × 520 | Allows Windows Snap half-screen on 1280–1366px laptops |
| Responsive | One layout | compact / medium / expanded / wide + short-height mode | App must work snapped, maximised and on ultrawide |
| Transparency | — | Full / reduced / solid modes, auto from OS setting, battery and GPU status | Performance and accessibility |
| Font location | `resources/fonts/` | `src/renderer/src/assets/fonts/` | Vite bundles renderer assets; `resources/` is for main-process files |
| Contrast check | Manual checker | Worst-case script in repo (§3.5) | Guarantee survives future token edits |
