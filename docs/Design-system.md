# Design System — JARVIS Desktop

| Field | Value |
|---|---|
| Status | v3.0 — Obsidian Intelligence |
| Last updated | 2026-10-07 |
| Theme name | **Obsidian Intelligence** (dark, default) · **Obsidian Daylight** (light) |
| Stack | Electron · React · TypeScript · Tailwind v4 · CSS animations |
| Related | [App-flow](App-flow.md) · [Code-style](Code-style.md) §6 · [PRD](PRD.md) F4.6 |

This file is the **single source of truth** for the JARVIS look. The code lives in
`src/renderer/src/styles/` (`tokens.css`, `glass.css`, `fonts.css`, `globals.css`) and
`components/jarvis/orb.tsx`. Components use tokens and `glass-*` classes only.

---

## 1. Direction

JARVIS is an intelligent system running on this computer: calm, precise, a little mysterious.
Obsidian depth, electric violet for interaction, ice cyan for JARVIS's own energy, and soft
atmospheric light behind layered glass. It is beautiful through **lighting, depth, glass,
typography, spacing and motion**, not through glow, neon or gradients.

| Principle | In practice |
|---|---|
| **The orb is the light** | It is the only element with a strong glow; its state colour lights the room behind the glass (the spill). Nothing competes with it. |
| **Colour lives in the atmosphere** | Violet, cyan and a trace of rose exist as soft light behind the glass. On the glass, colour means something. |
| **Two accents, two meanings** | **Violet = Sir acts** (primary buttons, focus, selection, links). **Cyan = JARVIS acts** (orb, voice, running work). Amber = needs a decision, red = danger, green = done. Rose is never a UI colour. |
| **Glass establishes hierarchy** | Four levels, fixed recipes. Code, dense data, tooltips and safety overlays are solid. |
| **Decisions are deliberate** | Confirmations use the strongest glass; destructive buttons are flat red, never attractive. |
| **Readable first** | Every text role passes 4.5:1 against the worst-case backdrop (§3.5), in both themes. |

Avoid: glow on every border or icon, gradient text, gradients inside cards, neon text, sci-fi or
decorative fonts, letter-spaced all-caps labels, emoji as icons, a UI-kit look.

Visual priority: **1** orb · **2** conversation · **3** composer · **4** important actions ·
**5** navigation · **6** supporting information.

---

## 2. The glass stack

```text
 viewer
   ▼
   L4  Modal glass      white 10%  · blur 36 · border 18%   confirmations only
   L3  Raised glass     white 7.5% · blur 28 · border 14%   activity console, toasts, sheets, settings groups, tool cards
   L2  Standard glass   white 5.5% · no blur · border 10%   cards, inputs, chips, list panels
   L1  Subtle glass     white 3.5% · blur 24 · border 8%    rail, main surface, status bar
   L0  Atmosphere       obsidian + violet / cyan / rose light + orb spill + grain (slow drift)
```

| Class | Level | Used for |
|---|---|---|
| `.glass-pane` | L1 | Rail, main content surface, status bar |
| `.glass-inset` | L2 | Cards, inputs, chips, memory list panel, automation cards |
| `.glass-raised` | L3 inside a pane (no blur) | Settings groups, tool cards, memory note, usage cards |
| `.glass-float` | L3 floating (blur) | Activity console, toasts, overlay sheets, onboarding card |
| `.glass-decision` | L4 | Confirmation dialogs |
| `.glass-scrim` | — | Behind dialogs and sheets: `rgba(2,6,23,.68)` + blur 12 |
| `.composer` | L2.5 floating | The message composer (§6.2) |

**Recipe.** Blurred levels paint their white sheen over a half-transparent obsidian base
(`--glass-base`, 50%). The base is what keeps text at 4.5:1 over the brightest part of the
atmosphere; the sheen gives each level its hierarchy. Nested levels (L2/L3 inside a pane) are tint
only.

Rules:

1. **Blur only on L1, floating L3, L4, the composer and the scrim.** Anything inside a scroll
   container is tint only (no `backdrop-filter`): scrolling blurred elements is the biggest GPU cost.
2. **Never transition `backdrop-filter` or blur radius.** Animate `opacity` and `transform`.
3. Max blur 36px; most surfaces 24–28px. Below 760px wide every blur steps down (16/20/24px).
4. Not everything is glass: code blocks, tables of data, tooltips, the mini-mode halo and the
   Computer-Control overlay are solid (`--solid-*`).

---

## 3. Colour

### 3.1 Palette

| Group | Tokens |
|---|---|
| Background | `--bg-950 #05060B` · `--bg-900 #080B12` · `--bg-850 #0B0F19` · `--bg-800 #101528` |
| Deep indigo | `--indigo-950 #0A0B18` · `--indigo-900 #10122A` · `--indigo-800 #161A38` · `--indigo-500 #6366F1` (send gradient only) |
| Electric violet | `--violet-600 #7C3AED` · `--violet-500 #8B5CF6` · `--violet-400 #A78BFA` · `--violet-300 #C4B5FD` |
| Ice cyan | `--cyan-500 #06B6D4` · `--cyan-400 #22D3EE` · `--cyan-300 #67E8F9` · `--cyan-200 #A5F3FC` (orb core) |
| Subtle rose | `--rose-400 #F0ABFC` (atmosphere only) |
| Semantic | `--success #34D399` · `--warning #FBBF24` · `--error #F87171` · `--error-text #FCA5A5` · `--info #60A5FA` |
| Text | `--text-primary #F8FAFC` · `--text-secondary #CBD5E1` · `--text-tertiary #A8B1C2` · `--text-muted #697386` |

### 3.2 Atmosphere (L0)

`#05060B` base with four soft lights, an orb spill and 3% grain (`.app-backdrop`, `.atmosphere`):

```css
radial-gradient(circle at 85% 10%, rgba(139,92,246,.15),  transparent 32%),  /* violet */
radial-gradient(circle at 10% 85%, rgba(34,211,238,.08),  transparent 30%),  /* cyan */
radial-gradient(circle at 50% 45%, rgba(139,92,246,.035), transparent 45%),  /* core */
radial-gradient(circle at 70% 80%, rgba(240,171,252,.035), transparent 25%)  /* rose */
```

The light layer is 24% oversized and drifts with `transform` only (48 s, alternate, ±1.5%, scale
1→1.04), so Sir barely notices it. The drift is off in reduced/solid transparency, below 760px wide
and under `prefers-reduced-motion`, because a moving backdrop makes every pane re-blur each frame.

The **orb spill** is a 28vmax light centred on the visible orb; its colour follows the orb state
(`--spill-*`, max alpha 0.12) and cross-fades over 320 ms.

### 3.3 Glass tokens

| Token | Dark | Use |
|---|---|---|
| `--glass-1 … --glass-4` | white 3.5 / 5.5 / 7.5 / 10% | Level sheens (§2) |
| `--glass-base` | `rgba(5,6,11,.5)` | Obsidian base under blurred levels |
| `--glass-hover` / `--glass-press` | white 7.5% / 3.5% | Hover brighter, press darker |
| `--glass-selected` | violet 10% | Selected rows (always with a 2px violet edge) |
| `--glass-border-subtle / border / strong / modal` | white 8 / 10 / 14 / 18% | Hairlines per level |
| `--glass-highlight` | white 6% | 1px inset top edge |
| `--shadow-float` | `0 20px 60px rgba(0,0,0,.25)` | Floating glass; no heavy dark shadows |

### 3.4 Semantic roles (what components use)

| Role | Dark | Light | Meaning |
|---|---|---|---|
| `ink-100 / 300 / 500` | text primary / secondary / tertiary | `#0F172A / #334155 / #475569` | Text hierarchy |
| `ink-muted` | `#697386` | `#64748B` | Placeholders and disabled only |
| `icon-rest` | `#8D99AE` | `#64748B` | Icons at rest (non-text, ≥ 3:1) |
| `reactor-500 / 300` | cyan 400 / 300 | `#155E75 / #0E7490` | JARVIS energy: orb, voice, running work |
| `accent-600 / 500 / 300` | violet 600 / 500 / 300 | `#6D28D9 / #7C3AED / #5B21B6` | Fill / edge+focus / text (links) |
| `lamp-400` | warning | `#92400E` | Needs a decision |
| `alarm-500` / `alarm-fill` | `#FCA5A5` / `#F87171` | `#B91C1C` / `#DC2626` | Error text and icons / destructive fills |
| `ok-400` | success | `#065F46` | Done, connected, enabled |
| `solid-inset / solid-float` | bg 850 / bg 800 | `#EEF0F7 / #FFFFFF` | Code blocks / tooltips, mini mode, overlay |

`#F87171` as text is only 3.7:1 on glass, so error **text** uses `--error-text`; the palette red
stays for fills, icons and the Computer-Control border. Violet 500 is too dark to read as text;
links and violet text use `accent-300`. Status colours always come with an icon or words.

### 3.5 Contrast guarantee

`npm run check:contrast` (`scripts/check-glass-contrast.mjs`, in CI) stacks every atmosphere light
and the orb spill at peak on one pixel, applies `saturate(150%)`, then each glass level, for both
themes. Every text role must reach **4.5:1** on: pane, inset, hover, selected, Sir bubble, raised,
float, float + inset, float + hover, modal. Text on filled buttons and badges is checked too.

Current result: dark lowest **4.71:1**, light lowest **4.60:1**.

Known exception, kept on purpose: `--text-muted` (#697386) is the requested placeholder colour and
measures about 2:1 on glass. It is used only for placeholders and disabled text, never for content.

Never raise an atmosphere alpha, lower `--glass-base`, or change a text token without re-running
the script.

### 3.6 Tailwind

Tokens map to utilities in the `@theme inline` block of `globals.css` (`bg-glass-inset`,
`text-ink-300`, `text-accent-300`, `bg-alarm-fill`, `shadow-float`, …). Breakpoints: `md` 760,
`lg` 1200, `xl` 1600, plus the `short` variant (height < 600). No raw hex or `rgba()` in
components, no `backdrop-filter` or blur utilities in components.

---

## 4. Typography

| Role | Family | Weights |
|---|---|---|
| Everything in the interface | **Outfit** | 400 body · 500 secondary · 600 headings and buttons · 700 hero only |
| Code, JSON, terminal output, file paths, technical values, logs, YAML front matter | **JetBrains Mono** | 400 |

Both are SIL OFL, bundled as variable `.woff2` in `src/renderer/src/assets/fonts/` (licences in
`resources/fonts/`), so the app works offline.

| Utility | Size / line | Use |
|---|---|---|
| `text-xs` | 12 / 16 | Metadata, badges, keyboard hints |
| `text-sm` | 13 / 18 | Secondary information |
| `text-ui` | 14 / 20 | Compact UI: buttons, nav items, chips |
| `text-base` | 15 / 24 | Default body, chat |
| `text-lg` | 19 / 28 | Section titles, dialog titles |
| `text-xl` | 24 / 32 | Page titles (Memory, Activity, Settings) |
| `text-2xl` | 32 / 40 | Onboarding headings |
| `text-hero` | 32–52 / 1.1, −0.03em | Empty-state greeting only |

Sentence case everywhere; tabular figures for costs, times and counts; no text shadow or glow;
no weight below 400 on glass.

---

## 5. Layout

### 5.1 Shell and breakpoints

Floating glass islands separated by `--shell-gap` (6 / 8 / 12px): **control rail** (L1, 56–64px,
40px targets), **main surface** (L1, the largest), **activity console** (raised float), **status
bar** (L1, 32px; 28px when short). Default window 1100 × 760, minimum 480 × 520.

| Mode | Width | Activity console | Notes |
|---|---|---|---|
| compact | < 760 | Overlay sheet (≤ 88% width) over the scrim; Esc closes | Less padding, lighter blur, no drift |
| medium | 760–1199 | Overlay sheet 340px | Starts closed |
| expanded | 1200–1599 | Docked, 320px | |
| wide | ≥ 1600 | Docked, 360px | Wider gaps |

Chat column ≤ 72ch, centred. Never a horizontal page scroll.

### 5.2 Empty state

Large orb (160px) above the greeting in `text-hero` ("Good evening, sir. What shall we work on?"),
then up to three glass suggestion chips. The orb's spill is the ambient light behind it.

### 5.3 Mini mode

Frameless, always-on-top, transparent window: the orb (96px) in a **small glass halo**
(`--solid-float` at 75%, strong hairline, top highlight, soft shadow; a transparent window cannot
blur the desktop, so the halo is tinted, not blurred). Click opens the main window; drag moves it.
Listening shows the cyan ripple; speaking shows the waveform. Caption bubble beside it.

### 5.4 Computer-Control overlay

Click-through full-screen window with a 4px `--alarm-fill` border and a solid pill ("Jarvis is
controlling your PC · Stop (Ctrl+Alt+Shift+X)"). **Never glass:** safety signals must look the
same on any wallpaper. Excluded from screenshots.

---

## 6. Components

### 6.1 Orb (`components/jarvis/orb.tsx`) — the signature

SVG, eight layers: **1** ambient glow · **2** outer transparent ring · **3** slow orbital ring with
one satellite (24 s per turn) · **4** violet energy arc · **5** cyan energy ring · **6** core
(radial gradient, cyan-200 → cyan-400) · **7** inner highlight · **8** motes (6–12 tiny cyan/violet
particles, md/lg only). Only selected rings rotate; the whole orb never spins.

| State | Visual | Motion |
|---|---|---|
| `IDLE` | Cyan core, soft glow, violet arc at rest | Core and glow breathe (scale 1→1.025, opacity .65→.85, 4.5 s); orbital ring turns slowly |
| `LISTENING` | Brighter | Core scale follows mic RMS (0.95→1.12); a cyan ripple whose strength follows the voice |
| `THINKING` | Core dimmed to 78% | Violet arc thickens and turns (1.6 s); all motes drift |
| `ACTING` | Segmented ring, one arc per tool call: cyan done, violet running, dim pending, red failed | Segments light as tools run |
| `AWAITING_CONFIRMATION` | Amber core and glow | Gentle breathing (2.4 s); never flashes |
| `SPEAKING` | Cyan | A soft waveform ring follows the TTS level |
| `ERROR` | Red core | One short pulse + small shake, then static |
| `SLEEP` | Thin cyan outline only | None, no glow |

Props: `state`, `level` (0–1), `size` (`sm` 40 · `md` 96 · `lg` 160), `spill`, `steps`.
`role="img"`, `aria-label="Jarvis is {state}"`, debounced `aria-live` announcement. Under reduced
motion: no rotation, ripple, motes, waveform motion or scaling; state is shown by colour and text.

### 6.2 Rail and composer

- **Rail icons**: lucide 18px / 1.75 stroke, `icon-rest` at rest; hover `glass-hover` + scale 1.04
  (180 ms); **active** = cyan tint 9%, cyan edge 15%, cyan-300 icon with a faint glow (the only
  icon glow). Tooltips on every icon.
- **Composer** (`.composer`): white 6.5% over the obsidian base, blur 24, 14% hairline, radius 20,
  top highlight, float shadow. Focus-within: violet edge 45% + 3px violet ring 10%. Placeholder
  `--text-muted`, text `--text-primary`. Max 8 lines (4 when short).
- **Send**: circular, violet-500 → indigo-500 gradient, faint cyan top highlight, small violet
  shadow; hover lifts 1px, press 0.96. Glass while disabled.
- **Mic**: cyan; listening = cyan tint + a breathing ring (`.mic-live`). **Attach**: neutral glass.
  While a turn runs, Send becomes **Stop** (red edge, square icon).

### 6.3 Chat and chips

| Element | Style |
|---|---|
| Sir | Right-aligned bubble: violet 7% fill, violet 13% hairline, radius 18 (6 at bottom-right), max 80% (88% compact) |
| Jarvis | No bubble, full column width, Markdown; links `accent-300` |
| Code | `--solid-inset`, JetBrains Mono, copy button |
| Streaming | 2px cyan caret; no per-character animation, no typewriter |
| Chips | `glass-inset` pill, 10×18px padding; hover violet 10% fill + violet 25% edge + 2px lift; press 0.97; 200 ms |

### 6.4 Tool cards

`glass-raised` rows (radius 12, ≥ 40px). Status: pending = small muted dot · running = cyan ring
spinner · waiting = amber breathing dot (+ 2px amber left edge) · success = green check + ms ·
error = red cross with one pulse · declined/blocked = muted slash. Tier badges are pills (SAFE
neutral, CONFIRM amber, BLOCKED red). Expanding rotates the chevron and fades the details up 6px
(200 ms); details are JetBrains Mono on `--solid-inset`.

### 6.5 Confirmation dialog (`confirm-dialog.tsx`) — safety-critical

Behaviour is unchanged; only the presentation follows v3.

| Rule | Detail |
|---|---|
| Surface | `glass-decision` (L4) over `glass-scrim`; width 480px (compact: window − 24px); opens with opacity + 6px rise + scale .98→1 (200 ms), no bounce |
| Destructive | Red hairline at 50% + red icon; primary button **flat red** (`alarm-fill`), dark text; **initial focus on Cancel**; Enter does not approve; approve by click or Ctrl+Enter |
| Confirm tier | 2px amber top edge + amber icon |
| Non-destructive | Primary violet (`.btn-accent`); initial focus on primary; Enter approves; voice "yes" approves |
| Taint banner | Amber 10% fill, amber 40% hairline, amber icon, primary text |
| Role | `alertdialog`, focus trapped and restored |
| Buttons | Primary repeats the verb ("Move to Recycle Bin"), never "OK" / "Yes" |
| Details | Paths and PowerShell in JetBrains Mono on `--solid-inset`, line numbers for scripts |
| Timeout / queue / window | Auto-deny after 120 s with a countdown in the last 20 s; one at a time ("1 of 3"); shows and flashes the window if hidden |

### 6.6 Controls

| Control | Style |
|---|---|
| Buttons | 36px, radius 12, `text-ui` 500. **Primary** violet-600 with a top highlight and small violet shadow (white text 5.4:1) · **Secondary** glass · **Danger** flat red · **Ghost** text. Press scales to 0.98 |
| Inputs, selects, text areas | `glass-inset`; focus = violet edge + 3px violet ring (replaces the outline) |
| Switches | Off: white 7.5% track + 14% hairline · On: violet-600 · Thumb `#F8FAFC`; 180 ms |
| Focus | Everything else: 2px violet outline, 2px offset, on every layer |
| Hover / press / disabled | Hover one step brighter, press one step darker, disabled 50% opacity; at most 2–3 properties change |

### 6.7 Loading

No generic spinners: the orb carries turn-level state, tool cards use the cyan ring, waiting checks
use glass skeletons (`.skeleton`, slow 1.8 s shimmer), busy labels may use `.pulse-dots`.

### 6.8 Toasts

`glass-float`, radius 18, bottom-right, max 3, 4 s (errors stay until dismissed). Tinted by level:
info cyan 8%, warning amber 10%, error red 10% (warning and error keep a 3px left edge + icon).
Enter with opacity + 6px rise.

### 6.9 Memory

Three levels: app rail (L1) · note list (`glass-inset` panel) · note (`glass-raised` panel). Selected
note: violet tint + 2px violet left edge; hover `glass-hover` (160 ms). Search: glass input, muted
cyan icon, violet focus. YAML front matter sits in a quiet glass block in JetBrains Mono; the body
is Outfit with generous padding.

### 6.10 Activity console

Docked `glass-float` from `lg`, a sheet below; filter pills (selected = violet tint + violet edge);
compact tool rows (§6.4); "Open full log" in `accent-300`.

### 6.11 Settings, automations, status bar, onboarding

- **Settings**: left navigation (selected = violet tint + 2px violet edge), each group a large
  `glass-raised` section with related fields together (not one card per field); content fades in
  when the section changes.
- **Automations**: `glass-inset` cards with a status dot + text (green = enabled, muted = off);
  "New automation" is the violet primary; Edit / Delete are neutral.
- **Status bar**: L1, `text-xs` tertiary text; voice in cyan; budget neutral, amber at 80%, red at
  100%; green online dot.
- **Onboarding**: atmosphere + one `glass-float` card (max 560px); each step rises in.

---

## 7. Theme and transparency

`<html data-theme="dark|light">` (Settings → General → Theme: Match Windows / Dark / Light) and
`<html data-glass="full|reduced|solid">` (Settings → General → Transparency: Auto / Full glass /
Reduced / Solid; default Full glass). Both apply live.

| Mode | Look |
|---|---|
| full | Atmosphere with drift, blur, levels as in §2 |
| reduced | No blur, no drift; obsidian base raised to 80% |
| solid | No atmosphere, no transparency (opaque base) |

Auto: OS "reduce transparency" → solid; on battery → reduced; otherwise full. Without
`backdrop-filter` support the base rises to 82%.

Performance budget: ≤ 4 blurred surfaces at rest + 1 transient; no blur on scrolling content; no
animated `backdrop-filter`; animations use `transform` and `opacity` only; the drift is the one
always-on background motion and is switched off wherever it would cost (§3.2).

---

## 8. Motion

| Token | Value | Use |
|---|---|---|
| `--dur-fast` | 160 ms | Hover, press, row highlight |
| `--dur-base` | 200 ms | View change, dialogs, toasts, expand |
| `--dur-slow` | 320 ms | Spill cross-fade |
| `--ease-standard` | `cubic-bezier(.2,.8,.2,1)` | Everything |

- Switching views: opacity 0→1 + translateY 6px→0 (220 ms). No sideways slides.
- Modals: opacity + 6px + scale .98→1 (200 ms). No bounce.
- Always-on motion: the orb, and the slow atmosphere drift (§3.2). Nothing else moves unless Sir
  acts or JARVIS's state changes.
- Reduced motion: no rotation, particles, drift, waveform or scaling; colour and opacity changes
  stay.

No animation library: CSS keyframes and transitions cover every case above.

---

## 9. Iconography

Lucide only, 18px, stroke 1.75, `icon-rest` at rest, primary text on hover, state colour only when
the icon carries state; every icon button has an accessible label and tooltip. No emoji as icons.

---

## 10. Writing in the interface

| Do | Don't |
|---|---|
| "Move 14 files to the Recycle Bin?" | "Are you sure?" |
| "Couldn't reach Claude. Check your internet connection or API key in Settings → Brain." | "Oops! Something went wrong." |
| "Connections" | "MCP server configuration" |
| "Transparency: Full glass" | "Glassmorphism engine" |
| Sentence case | Title Case or ALL CAPS |

The butler persona ("sir") appears only in Jarvis's own messages and speech.

---

## 11. Accessibility checklist

- [ ] Keyboard reaches everything; 2px violet focus (inputs: violet edge + ring) on every layer.
- [ ] Hit areas ≥ 36×36 (32 minimum); rail targets 40.
- [ ] `npm run check:contrast` passes (both themes).
- [ ] Final replies announced via `aria-live="polite"`, not per token.
- [ ] Confirmation dialog is `alertdialog`, traps and restores focus.
- [ ] Colour is never the only signal (icons or text with every status; selected rows have an edge).
- [ ] Reduced motion verified; solid transparency verified with Windows transparency off.
- [ ] Text scales with Windows display scaling (rem units; 100 / 125 / 150%).

---

## 12. Acceptance criteria

- [ ] No raw colours, `backdrop-filter` or blur utilities in components.
- [ ] Contrast script exits 0.
- [ ] 480, 760, 1100, 1280, 1440, 1600px wide: no horizontal scroll; console docks from 1200.
- [ ] 560px tall: `short` rules apply.
- [ ] Both themes and all three transparency modes render and switch live.
- [ ] Orb shows all eight states as in §6.1; spill follows it.
- [ ] Nothing inside a scroll container blurs.
- [ ] Confirmation rules in §6.5 pass (e2e).
- [ ] Mini mode and overlay use solid recipes.
- [ ] Fonts load offline.

---

## 13. Changelog

### v2.0 → v3.0 (Obsidian Intelligence)

| Area | v2.0 | v3.0 | Why |
|---|---|---|---|
| Direction | Glass Workshop at Night (blue aurora, cyan everywhere) | Obsidian Intelligence: obsidian, violet interaction, cyan JARVIS energy | v2 felt too blue, flat and generic |
| Atmosphere | Static blue/violet/indigo aurora + two light orbs | Violet, cyan, core and rose lights; slow 48 s drift | Deeper and alive without being a wallpaper |
| Glass | Dark tints (64–86%) | Four white-sheen levels over a 50% obsidian base | Clearer hierarchy; base keeps the contrast guarantee |
| Accent | Cyan for buttons, focus, links, selection | Violet for interaction; cyan only for JARVIS (orb, voice, running) | Two accents, two meanings |
| Fonts | Sora + Geist | Outfit (UI) + JetBrains Mono (code) | One modern family with personality |
| Orb | Core + rings | Eight-layer reactor, segmented tool progress, waveform, motes | The orb is the signature |
| Error colour | `#FF8F86` | `#F87171` fills, `#FCA5A5` text | Requested palette; text stays ≥ 4.5:1 |
| Motion | Orb only | View, modal, toast, expand transitions; status micro-animations | Motion explains state |
| Light theme | Daylight Workshop | Obsidian Daylight (same roles, frosted white) | Kept, re-coloured to match |

### v1.0 → v2.0

Flat theme → aurora backdrop and glass islands; Chakra Petch / IBM Plex Sans → Sora / Geist;
transparency modes; responsive down to 480px; worst-case contrast script in CI.
