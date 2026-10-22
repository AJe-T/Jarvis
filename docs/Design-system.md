# Design System — JARVIS Desktop

| Field | Value |
|---|---|
| Status | v8.0 — two styles: **Soft** (default) and **Neon Grid** (cyberpunk HUD); any accent, 19 orb styles; a **?** help button on every page and main section |
| Last updated | 2026-10-10 |
| Theme | **Neon Grid** dark (signature) and **Daylight HUD** light |
| Stack | Electron · React · TypeScript · Tailwind v4 · CSS transitions · Canvas 2D (orb) |
| Related | [App-flow](App-flow.md) · [Code-style](Code-style.md) §6 · [PRD](PRD.md) F4.6 |

This file is the **single source of truth** for the JARVIS look. The code lives in
`src/renderer/src/styles/` (`tokens.css`, `surfaces.css`, `fonts.css`, `globals.css`),
`components/ui/page.tsx` (page layout), `components/jarvis/orb.tsx` + `orb-painter.ts` (the orb)
and `components/jarvis/orb-dock.tsx` (the orb on every screen).

---

## 1. Direction

Sir asked for a cyberpunk assistant, not a SaaS dashboard: **the orb is the product** and
everything else is instrumentation around it. A near-black void with a faint blueprint grid and
CRT scanlines; hard 2–6px corners; HUD corner brackets on framed panels; neon cyan for the main
action, focus and Jarvis; magenta and hazard-yellow as second and third neon; mono capitals for
labels. Reading text stays in a calm sans so long replies and notes stay readable.

| Principle | In practice |
|---|---|
| **Orb first** | The home screen (Core) is the orb; the conversation is a side log. Every other screen carries a live orb in the corner (§5.6). |
| **Neon has jobs** | Cyan: primary fill, focus, links, Jarvis. Magenta: Sir's side (message edge), the orb's counter-ring. Yellow: needs-you and HUD markers. Red: danger only. |
| **HUD, not chrome** | Corner brackets, `// labels`, mono numbers and readouts. No soft pastel cards, no pill buttons. |
| **Glow means alive** | Bloom only on what is active, focused or floating (active rail row, focused composer, popovers, orb). |
| **Hard geometry** | 3px controls, 4px cards, 6px dialogs; the primary button has clipped corners. |
| **One grid** | Same 48px header and centred column on every view (§5.3). |
| **Readable first** | Every text role passes 4.5:1 on every surface, both themes (§3.5). |

---

## 2. Surfaces

| Class / utility | Dark | Light | Used for |
|---|---|---|---|
| `bg-app` | `#05070B` | `#E6EBF1` | Sidebar, status bar, comms log |
| `.panel` (`bg-main`) | `#070A10` + 40px grid in `--grid-line` | `#F2F5F8` + grid | Canvas: every view |
| `.scanlines` | 1px lines every 3px, `--scanline` | same, darker | Fixed overlay over the whole shell, `pointer-events: none` |
| `.card` / `.hud-frame` (`bg-surface-1`) | `#0C1119` + `#1B2A3A` hairline + cyan corner brackets | `#FBFCFD` + `#CDD7E0` | Settings groups, tool cards, gallery cards, suggestions; radius 4 |
| `.inset` (`bg-surface-2`) | `#111824` | `#E9EEF3` | Code, Sir's message, chips, registry rows |
| `bg-selected` / `.rail-active` | `#0F2230`; rail adds a 2px cyan bar + inner glow | `#D6E6EE` | Selected rows |
| `.popover` | card + `shadow-pop` (cyan ring + bloom), radius 6 | same | Toasts, menus, sheets, pickers |
| `.dialog` | canvas fill + brackets + `shadow-pop`, radius 6 | same | Confirmations |
| `.composer` | surface-1, strong hairline, radius 4; focus = cyan edge + bloom | same | Message box |
| `.tag` | squared chip (radius 2), mono 11px | light tints | Tier and status labels |
| `.mesh` | cyan / magenta / violet bloom, blur 64px, 32% | 18% | Behind the Core orb only |
| `.cover` + `.cover-<id>` | generated art (§6.10) | same | Spaces and page covers |

The corner brackets are background layers (`--frame` colour, 12px), so a utility like
`hover:bg-surface-2` changes only the fill underneath.

---

## 3. Colour

### 3.1 Neutrals

| Role | Dark | Light | Use |
|---|---|---|---|
| `ink-100` | `#E4F7FF` | `#071019` | Primary text |
| `ink-300` | `#9DB4C7` | `#33475A` | Secondary text |
| `ink-500` | `#7D93A8` | `#4A5D70` | Tertiary text, HUD labels, placeholders |
| `icon-rest` | `#7D93A8` | `#4A5D70` | Icons |
| `ink-strong` / `on-strong` | `#00F0FF` / `#001318` | `#071019` / `#E4F7FF` | Text selection |

### 3.2 Neon

| Role | Dark | Light | Use |
|---|---|---|---|
| `accent-600` / `accent-700` | `#00E5FF` / `#6AF4FF` | `#00D2E6` / `#00B8CC` | Primary button rest / hover (ink `#001318`) |
| `accent-500` | `#00E5FF` | `#00808F` | Focus edge, caret, spinners, active bars |
| `accent-300` | `#4FE6FF` | `#006470` | Links and accent text |
| `accent-tint` / `accent-edge` / `accent-glow` | `#00313A` / cyan 45% / cyan 28% | `#C9F4F9` / deep cyan 45% / 22% | Tags, hover edges, bloom |
| `neon-magenta` | `#FF2BD6` | `#D1009F` | Sir's message edge, covers, orb counter-ring |
| `neon-yellow` | `#FCEE0A` | `#D9B800` | Covers, HUD markers |
| `neon-violet`, `neon-green`, `neon-orange`, `void` | `#7A5CFF`, `#39FF9F`, `#FF7A1A`, `#04060B` | darker equivalents | Covers only |

### 3.6 Accent colour (`lib/accent.ts`, `appearance.accent`)

Cyan (`#00E5FF`) lives in tokens.css. Any other accent is applied by `ThemeSync` as inline
custom properties on `<html>` (they beat the theme selectors), derived per theme by
`accentVars(hex, theme)`. **Neutrals follow the accent:** every tokens.css neutral (`bg-app`,
`bg-main`, `surface-1/2`, `line-subtle`, `line`, `line-strong`, `neutral-tint`, `void`, `ink-100/300/500`,
`icon-rest`) keeps its lightness and saturation but takes the accent's hue (saturation scaled down
for greyish accents), so a red accent gives a red-black app. The ink roles are then fitted to
4.5:1 (ink-100 7:1) on every surface, its hover tint, the selected row and the neutral tag. Shadows
(`shadow-sm`, `shadow-pop`) are rebuilt from the accent. Then: fill (`accent-600`, lightness nudged to ≥ 1.6:1 against the canvas so a
near-black or near-white pick still reads as a button), hover, `accent-500` (icons, focus, ≥ 3:1 on
every surface), `accent-300` (text, ≥ 4.5:1), tint and tag ink (≥ 4.5:1), edge/glow, `selected`,
`hover`/`press`, grid line, `neon-cyan`, and the orb (`orb-1`/`orb-2`; `orb-3` is violet, or
magenta when the accent is itself violet). Ink on the fill is dark or white, whichever reads
better. `accent.test.ts` checks every preset plus pure blue, yellow, grey, black and white in both
themes. Presets: Cyan, Arc blue `#3D8BFF`, Violet `#8B5CFF`, Magenta `#FF2BD6`, Red `#FF2A3D`,
Orange `#FF7A1A`, Gold `#FFC400`, Lime `#B6FF2E`, Green `#2BFF88`, Silver `#C8D6E5`. Custom = the
native `<input type="color">` (the Windows colour dialog) plus a hex field. The mini-orb window
reads theme and accent once when it opens.

### 3.7 Style: Soft and Cyberpunk (`appearance.style`, `<html data-style>`)

Settings → General → **Style** picks the whole look; theme (light/dark) and accent are independent
of it. `ThemeSync` sets `data-style` on `<html>` (`index.html` starts as `soft` so there is no
flash). Everything in §2–§3.6 is the **Cyberpunk** style and stays untouched; **Soft** (the
default since 2.6) is layered on top in three places:

- `tokens.css` `:root[data-style='soft']`: corners 6 / 10 / 12 / 16 / 20 px (`radius-xs…xl`), one
  family (`font-display` and `font-code` become Geist; `--font-mono` keeps code monospace), and
  graphite (dark) or paper (light) neutrals plus `--soft-shadow-card`, `--soft-shadow-pop` and
  `--soft-ring`. A custom accent still retints neutrals through `accentVars` (inline wins).
- `surfaces.css` (components layer): no canvas grid or scanlines; `.card`/`.popover`/`.dialog`/
  `.hud-frame` lose the corner brackets and get soft shadows; `.btn-accent` loses the clipped
  corners; the active sidebar row is a rounded fill; `.hud-label` is sentence case; `.tag` is a pill;
  focus is a 3 px accent ring; the mesh bloom is fainter.
- `globals.css` (unlayered, beats utilities): real code (`pre`, `code`, `kbd`, `.break-all`) stays
  monospace; `.btn` drops letter-spacing; no glitch copies or dashed orb-dock ring.

Section labels write their `// ` prefix with `<Slash />` (`components/ui/slash.tsx`), hidden in Soft.
New components need nothing special: use the tokens and recipes and both styles follow. The style
picker's previews use fixed colours on purpose (a `[data-style]` rule matches any ancestor).

### 3.3 Status tags

| Meaning | Tag fill / ink (dark) | Tag fill / ink (light) | Text colour |
|---|---|---|---|
| Needs a decision | `#2E2B05` / `#FFF27A` | `#FBF3B0` / `#5C4500` | `lamp-400` `#FCEE0A` / `#665000` |
| Error, blocked | `#3A0D18` / `#FF8FA3` | `#F9D3DB` / `#99001F` | `alarm-500` `#FF4D6D` / `#B0002A`; fill `#D1103A` / `#B0002A` |
| Done, connected | `#08291A` | `#D2F5E3` | `ok-400` `#39FF9F` / `#0B6334` |
| Neutral | `#121C28` / `#9DB4C7` | `#E1E8EE` / `#33475A` | n/a |

### 3.4 Tailwind

Tokens map to utilities in `globals.css` (`bg-surface-1`, `text-ink-300`, `border-line`,
`text-accent-300`, `border-neon-magenta`, `bg-void`, `shadow-pop`, ...). Breakpoints `md` 760,
`lg` 1200, `xl` 1600, `short` (height < 600). No raw hex or `rgba()` in components; covers and
glows use `var(--…)` and `color-mix()` in `surfaces.css`.

### 3.5 Contrast check

`npm run check:contrast` checks every text role on every surface (+ hover) in both themes
(>= 4.5:1), icons (>= 3:1), button text and every tag pair. Current lowest: dark **4.80:1**,
light **5.18:1**.

---

## 4. Typography

**Geist Mono** is the HUD voice: headings, page titles (uppercase, tracked 0.14em), buttons,
tabs, tags, numbers, `// labels` (`.hud-label`: 11px, uppercase, 0.16em). **Geist** for reading:
chat, notes, descriptions, form text. Both SIL OFL, bundled in `src/renderer/src/assets/fonts/`
(licence in `resources/fonts/geist-OFL.txt`).

| Utility | Size / line | Use |
|---|---|---|
| `.hud-label` | 12 / 16, caps, 0.16em | Section labels, readouts, status |
| `text-3xs` · `text-2xs` | 11 · 12 | Tiny chips and kbd hints (replace the old fixed `text-[9–11px]`) |
| `text-xs` | 13 / 18 | Badges, metadata |
| `text-sm` | 14 / 21 | Secondary text, nav items, buttons |
| `text-ui` | 15 / 22 | Form text |
| `text-base` | 17 / 1.6 | Body, chat, Spaces pages |
| `text-lg` | 18 / 26 | Core captions |
| `text-xl`–`text-3xl` | 21–30 | Greeting, space and page titles (bold) |

Sizes above are at **Text size 100 %** (2.8: one step bigger than before). Every `--text-*` token
is `rem × var(--font-scale)`; Settings → General → Text size sets `--font-scale` (0.9–1.5) on
`<html>`, so text grows while spacing stays. Never use fixed `text-[Npx]`: it ignores the setting.

Tabular figures for numbers. Uppercase only on mono labels and page titles, never on body text.

---

## 5. Layout

### 5.1 Shell

```text
┌──────────┬──────────────────────────────────────────────┬──────────────┐
│ ◉ JARVIS │ header 48px   // CORE · READY                │ // COMMS LOG │
│ // work  │  SYS.CLOCK                         UPLINK    │  sir ▕       │
│  Core    │                                              │ ▏jarvis      │
│  Spaces ▾│               ╭── orb (340px) ──╮            │              │
│   ▸ Fin… │               ╰─────────────────╯            │              │
│  Brain   │                [ READY ]                     │              │
│ // sys   │           captions while he replies          │              │
│  …       │  AUDIO.IN                       SPEND.TODAY  │              │
│ ⚙        │           [ composer, max 672px ]            │              │
├──────────┴──────────────────────────────────────────────┴──────────────┤
│ (v2.15: no title bar or status bar; Windows' ─ □ ✕ over the top right) │
└────────────────────────────────────────────────────────────────────────┘
```

- **Window chrome** (v2.15): `titleBarStyle: 'hidden'` with `titleBarOverlay` (48px, coloured from `--bg-main` / `--ink-100` through `app:titleBar`). Rows marked `data-titlebar` (every 48px header, the sidebar's logo row) drag the window; their controls are `no-drag`. `TitleBar` (`components/jarvis/titlebar.tsx`) gives the header under the caption buttons `data-tb-guard` (right padding = the buttons' width from `navigator.windowControlsOverlay`, else 140px). Connection issues badge the Connections item.
- **Sidebar** (`bg-app`, hairline right edge): a live `sm` orb + glitching **JARVIS** wordmark
  (decorative, `aria-hidden` copies) and a **Hide sidebar** button, `// workspace` (Core, Spaces
  tree, Brain, Memory, Passwords), `// tools` (Automations, Skills, Connections, Reply copilot),
  Settings pinned to the bottom. Labels (256px) from 1200px, icons only (56px, tooltips) below.
  Active row = `.rail-active`. Activity and Bible are Settings sections (`go('activity')` and
  `go('bible')` redirect there).
- **Hidden sidebar:** Ctrl+B or the button collapses it to a 44px strip with **Show sidebar**
  (`railHidden`, remembered in `localStorage`). While a Core panel is up Jarvis hides it himself
  (`railAuto`) and gives it back when the panel closes, unless Sir toggled it meanwhile.
- **Spaces tree:** a chevron beside **Spaces** folds the whole list; a chevron beside each space
  folds its pages (`aria-expanded`). State persists in `localStorage` (`jarvis.rail.spaces`);
  opening a page unfolds its space. Pages are indented behind a hairline guide.
- **Canvas** fills the rest with the grid; **Activity** is a docked column from 1200px, a sheet
  below (Esc closes), and starts closed.
- Default window up to 1400 × 880 (90% of the work area at most), minimum 480 × 520. Never a
  horizontal page scroll.

### 5.2 Core (`features/chat/chat-view.tsx`)

The stage: `.mesh` bloom behind the `xl` orb (340px; `lg` below 760px tall), the state in a mono
`[ BRACKETED ]` line, then either the reply streaming as **captions** (`captionOf`: spoken tags,
Markdown marks and code removed, last 320 characters, caret) or, before a conversation, the
greeting and three `cmd.0n` suggestion cards. Four corner readouts (clock, uplink + model, audio
mode, spend) form a "Readouts" group (they replaced the status bar). Composer at the
bottom, max 672px.

**Comms log:** the conversation, secondary to the orb: a 400–460px column beside the stage
(overlay sheet below 1200px, starting under the 48px core header so the header's toggles stay
reachable) that opens when a conversation starts and is toggled from the header.
It lists finished messages (Sir: magenta right edge; Jarvis: cyan left edge) and, while a turn
runs, its tool cards and a three-dot "replying" mark. The reply text itself streams only under the
orb, so it is never on screen twice.

### 5.2b Talking on Core

The stage has no message box: the composer sits at the bottom of the comms log. With the log closed
the orb (`TalkOrb`) is a button: **Speak to Jarvis** / **Stop listening** (`voice:mic`), or **Open the
chat** when voice is off; a hint under the status line names the push-to-talk key. Any printable key
pressed outside a field opens the log with that character as the composer draft, focused with the
caret at the end (rewind uses the same path).

### 5.2a Panels beside the orb (`features/stage/`, `shared/stage.ts`)

**Apps** (v2.16, ADR-040, `shared/jarvis-apps.ts` + `features/apps/apps-grid.tsx`): Core's header has one **All apps** button opening a dialog with the same card grid as Sidebar → Apps (Today, Calculator, Browser, Terminal, Camera, Timers, Pomodoro, Scratchpad, Unit converter, World clock, QR code, System monitor, AI usage, Jarvis status). Browser, Terminal and Camera fill the panel (their own pages placed over a `DockedPanel` hole; dark `#0b0f14` until drawn). Each opens as a panel; pressing the open one again closes it. **Outputs:** a finished reply with an `artifact-html/svg/mermaid` block opens it here (kind `artifact`, the same network-less sandbox as in chat), every artifact card has **Show beside the orb**, and `show_file` shows a picture, page or text file.

`show_panel` (main tool, SAFE, display only) or the header apps set `useStageStore.panel`;
`stage:panel` carries it to the renderer. Core then animates: the orb column shrinks to 40% and
scales to 0.8 (500ms, `--ease-standard`), the right readouts hide, the comms log and the sidebar
step aside, and the panel (`.hud-frame`, `.stage-in`: slide + clip reveal, 420ms) fills the right
60%. Header: a glowing square, `// TITLE`, **Close panel**. Below 760px wide the panel takes the
stage alone. Kinds: `pomodoro` (SVG ring countdown in `accent-500`, break in `ok-400`, Start/Pause,
+5 min, Reset; `pomodoro.ts` holds the tested maths), `usage` (the Usage panel), `status` (stat
tiles with budget meters), `system` (live monitor: CPU sparkline polled from `system:stats` every 2 s, memory, disk, battery via `navigator.getBattery`, uptime), `qr` (drawn as one SVG path from `qrcode`'s matrix, no network; Wi-Fi passwords masked in the caption), `list`, `stats`, `note` (Markdown). A new feature adds a kind to
`StagePanelSchema` and a case to `Body`.

### 5.3 Page structure (`components/ui/page.tsx`)

Every view: `PageHeader` (48px, a 2px glowing cyan tick, the title in mono caps, actions on the
right, 1px divider) + `PageBody` (scrolls; one centred column, max 768px). Views with their own
list (Settings, Memory, Bible, Conversations) put a 224–256px list on the left whose top row is
also 48px.

### 5.4 Mini mode and Computer-Control overlay

Mini: the same orb (72px "dock" size) on a small disc in a transparent always-on-top window that
is exactly 88×88, so nothing around it blocks clicks; the window widens inward only while a caption
shows. Click opens Jarvis; drag (main follows the cursor) and on release it snaps to the nearer side
edge with a 12px margin. Pushed past the edge, the chevron on hover, or right-click → Tuck turns it
into a 14px handle flush with the edge (accent border, rounded on the inner side, glow follows the
voice level, pulses while active). Right-click opens a native menu (it can draw outside the tiny
window). Idle and unhovered for 4s it fades to 60%. Geometry is pure and tested
(`windows/mini-dock.ts`); the spot is the main-only `mini.dock` setting. Overlay: 4px `alarm-fill` border and a solid pill with Stop; never
translucent.

### 5.5 Spaces (`features/spaces/`)

- **Home:** `// spaces · NN online`, then a gallery (`auto-fill, minmax(220px)`) of space cards:
  cover (from the name) with the big icon, name, page count; a dashed **New space** card;
  **Recently edited** list.
- **Space** (`space-gallery.tsx`): 160px cover banner fading into the canvas, the 60px icon and
  the title overlapping it, then a toolbar: **Gallery / List** tabs (persisted,
  `jarvis.spaces.layout`), search, **New page** (template menu), delete. Gallery cards: 112px
  cover with the page icon, title, mono "edited" time; a dashed **+ New page** card last.
- **Page** (`page-editor.tsx`): breadcrumb + formatting bar, 144px cover (**Change cover** on
  hover → 8-cover picker), a 64px icon square overlapping it (emoji picker, Remove icon), mono
  title, the editor.

### 5.6 Orb dock (`components/jarvis/orb-dock.tsx`)

On every view except Core, a 72px live orb sits 20px from the bottom-right of the canvas on a void
disc with a slowly turning dashed ring (`.orb-dock`). It follows state and level like the Core orb,
shows the reply's last words in a popover beside it while Jarvis speaks, and returns to Core on
click (`aria-label="Open Jarvis core"`). Drag it (6px slop, so a click stays a click) and it lands
in the nearest of the four corners; the hover chevron tucks it into a 14px edge tab. Corner and
tuck are per-PC conveniences in `localStorage` (`jarvis.orbDock`). Only the Core orb announces state to screen readers
(`announce`), so copies never repeat it.

### 5.7 Tasks, Calendar and Brain views

- **Tasks** (`features/tasks/`): a 224px list column (smart lists, lists with colour dots, tags),
  then the standard header (search, sort, List / Board / Matrix), a stats strip, the quick-add box
  (accent focus ring, parsed chips below in `accent-tint`) and the content. The tick circle's ring
  is the priority colour (P1 alarm, P2 lamp, P3 accent, P4 line). Due text: overdue alarm, today
  ok-green, next two days lamp. The editor is a 352–416px right panel; fields save as they change.
- **Calendar** (`features/calendar/`): a 240px side column (New event, Next up card, small month
  with busy dots, calendars), the header with the view switch, then Today / ‹ › / the range title /
  quick add. Week and Day: 48px per hour, half-hour hairlines, events as tinted blocks with a 3px
  calendar-colour edge, overlaps side by side, a red now line; drags snap to 15 minutes and show a
  dashed accent ghost. Month: six Monday-first weeks, three chips per day then "+N more".
- **Brain** (`features/brain/`): a pill switcher of six views at the top centre over the dark
  canvas (which stays dark in both themes). Canvas views (Neural, 3D orbs) redraw from refs every
  frame; SVG views (Clusters, Constellations, Mind map) pan and zoom by writing the transform
  straight to a `<g>`; Treemap is absolutely placed boxes. Reduced motion stops the 3D spin, the
  twinkle and the signals.

---

## 6. Components

### 6.1 Orb (`components/jarvis/orb.tsx`, `orb-painter.ts`, `orb-kit.ts`, `orb-styles/`)

**Styles** (`appearance.orbStyle`, list in `shared/orb-styles.ts`, painters in `orb-styles/`):
`particles` (default, below), `reactor` (the v2.1 arc reactor), `fluid`, `cloud`, `liquid`, `sun`,
`plasma` (`fluid.ts`), `equalizer`, `scope`, `ring` (`instruments.ts`), `blackhole`, `galaxy`
(`cosmic.ts`), and v8.1's `aurora`, `waves`, `wormhole`, `tesseract`, `iris`, `swarm`, `crystal`
(`signature.ts`). `atom`, `mandala`, `rain`, `gyroscope`, `globe` and `sonar` were removed in v8.1;
a saved removed id fails the setting's schema and falls back to `particles`. At rest (IDLE, SLEEP)
the animated loop draws every other frame (≤ 30 fps); `orb-painter.test.ts` paints every style in
every state at 32/88/340 px against a counting fake context. Shared HUD pieces (halo,
ticks, segmented arcs, glyph ring, markers, sparks, bucketed dot styles) live in `parts.ts`. The
base painter owns the level smoothing, spin, palette, sleep dimming and error jitter, and calls
`style.draw(env)`; styles that don't show tool progress get a segmented ring at 0.95R while ACTING.
Picker: Settings → General → Orb style, a grid of `md` live previews (`demo` level; only the chosen
and hovered cards animate, the rest are still frames that repaint on accent or theme changes).
`LiveOrb` previews the draft; the mini window reads the saved style once.

**Particle core.** A living particle sphere (after Sir's references: dotted plasma spheres, wavy particle shells, a
spell-circle of sparks), drawn on a canvas every frame, back to front:

1. **Halo** — radial glow from the state colour into the second neon.
2. **HUD** (64px and up) — a tick ring turning backwards, six **segmented arcs**, a turning
   **glyph ring** of small marks in the second neon, and four yellow **markers**.
3. **Shells** — 1–3 wavy rings of particles, each on its own slow axis, rippling more with energy.
4. **Sphere** — 150–1,500 Fibonacci points, rotated in 3D, each pushed in and out by a smooth
   noise field (`wobble`) whose strength follows energy, so the surface moves like liquid; dot size
   and brightness by depth; colour from `--orb-1` on one side to `--orb-3` on the other.
5. **Core** — a hot white-to-accent nucleus and four swirling dotted filaments.
6. **Level ring** — dots that jump outward with the level (one to three per spoke).
7. **Sparks** (64px and up) — thrown off the surface while speaking (by level) or thinking; they
   curl like embers and fade (pool of 90).

Additive blending on dark themes, normal painting on light. Fill styles are cached in colour × alpha
buckets, so a 340px orb paints ~2,000 dots a frame without allocating strings. Colours `--orb-1`
(main, from the accent), `--orb-2`, `--orb-hi`, `--orb-3` (second neon), `--orb-4` (sparks and
markers).

**What it follows** (`selectOrbLevel`): Jarvis's voice while `SPEAKING`, Sir's mic while
`LISTENING`, otherwise music and other sound playing on the PC (Settings → General, on by default;
Security.md §7). Level drives one `energy` value with a fast attack and slow release; at rest it
**breathes** (a small sine), so the orb is never dead.

| State | Visual |
|---|---|
| `IDLE` | Slow spin, breathing; bars move with music if any is playing |
| `LISTENING` | Spins faster; bars, rings and filaments follow the mic |
| `THINKING` | A bright sweep runs round the bar ring; fastest spin |
| `ACTING` | The level ring splits into one segment per tool call: accent done, pulsing running, grey pending, red failed |
| `AWAITING_CONFIRMATION` | Yellow |
| `SPEAKING` | Bars, rings and filaments follow Jarvis's voice |
| `ERROR` | Red; the counter-ring turns red and the orb jitters sideways (glitch) |
| `SLEEP` | Grey, dimmed, still |

Sizes `sm` 32 (bars and core) · `dock` 72 · `md` 88 · `lg` 168 · `xl` 340. `role="img"`,
`aria-label`, debounced live announcement when `announce` (default on). Reduced motion: drawn once
per state change, never moves, no jitter.

**Mood (v8.2):** `OrbFrame.mood` tints the state colour 50 % toward the mood (happy warm gold, amused pink, excited the third neon, curious the second neon, concerned amber, serious grey; calm keeps the accent) and scales liveliness (0.8–1.4). Only IDLE, LISTENING and SPEAKING take a mood; waiting and errors keep their colours. It fades after 30 s (`assistant-store`).

### 6.2 Composer

`.composer`, 52px minimum, icon buttons inside: dictate, talk (cyan with a ring while recording),
attach, send (neon fill when there is text). While a turn runs, Send becomes Stop (red icon).

### 6.3 Chat (comms log)

Sir: right-aligned `surface-2` block, radius 4, magenta 2px right edge, max 85%. Jarvis: text
behind a 2px cyan left edge, Markdown, links `accent-300`, code on `surface-2` in Geist Mono.
Streaming text is shown as Core captions with a glowing caret (§5.2).

**Artifacts (v8.2, `components/jarvis/artifact.tsx`):** a `surface-1` card with the title, a kind tag
(HTML / SVG / MERMAID) and icon buttons (code ↔ preview, full screen, save). The preview is a fixed
24rem frame (resizable) on white, so the log never jumps when it finishes drawing; full screen is an
`app/95` overlay with blur, Esc closes. **Context meter:** a 48px bar plus percentage in the log
header (accent, `lamp-400` from 60 %, `alarm-500` from 85 %); click for a popover with the split and
Compact now. **Chat search:** a search field atop Conversations; hits show the title, a two-line
snippet with the matched words in `<mark>` (accent at 25 %), and the date.

### 6.4 Tool cards

`.card` rows (40px). Tier badges are `.tag`s. Status: grey dot pending · cyan ring spinner
running · yellow dot waiting · green check with ms · red cross failed · grey slash declined.

### 6.5 Confirmation dialog — safety-critical

`.dialog` over `.scrim` (slight blur), 480px. Destructive: red edge, red icon, **flat red** primary
button, initial focus on Cancel, Enter does not approve (click or Ctrl+Enter). Confirm tier: yellow
top line. Buttons repeat the verb. Countdown in the last 20 s; one at a time ("1 of 3"). Behaviour
unchanged from earlier versions.

### 6.6 Controls

| Control | Style |
|---|---|
| Buttons | 36px, radius 3, mono 13px. Primary neon fill with clipped corners (focus ring drawn inside the clip) · Secondary framed (strong hairline, cyan edge on hover) · Danger red · Ghost text |
| Inputs, selects | `surface-1`, 1px hairline, radius 3; focus = cyan edge + bloom |
| Tabs | Mono 12px; active = `bg-selected` + 2px cyan underline |
| Filter chips | Squared, mono; active = `accent-tint` + `accent-edge` |
| Focus | 2px cyan outline, 2px offset, everywhere |

### 6.7 Loading

The orb shows turn state; tool cards and the registry show the ring; checks show skeleton bars.

### 6.8 Toasts

`.popover`, top-centre under the header, max 3; icon colour gives the level; errors stay until
dismissed.

### 6.9 Settings, Memory, Activity, Connections

All follow §5.3. Connections → **Add connection** is a framed card with **Catalogue / MCP
Registry / Custom** tabs. Catalogue: filter box, category chips, two-column preset cards with
`hosted` / `needs key` / `no key` tags. Registry: search (debounced 400ms), rows with an npm or
globe icon, version and kind tags, **Add**, **Load more**, and the count of servers that need
Python/Docker.

### 6.9a Save bar (`features/settings/save-bar.tsx`)

Settings controls **stage** edits (`useSettingsStore.stage`); controls read `useDraftSetting` so
they show the draft, while the rest of the app reads the saved value (`useSetting`), except theme
and accent, which preview the draft live. With drafts present a floating `.popover` bar sits at the
bottom of Settings, Automations and Skills: a breathing yellow dot, "N unsaved changes", Discard,
**Save changes** (Ctrl+S). Saving writes each key; failures stay as drafts with an error toast. If
a saved key is in `RESTART_SETTINGS` (`llm.provider`, `vault.path`, `memory.semanticSearch`) a
confirm offers **Restart now** (`app:relaunch`, audited). Secret fields keep their own Save, and
changes confirmed in a dialog (folders, tool permissions, vault) still save at once.

### 6.10 Covers

Eight generated covers in `surfaces.css`, all from neon tokens and `color-mix()`: `grid`,
`synthwave`, `matrix`, `circuit`, `aurora`, `hazard`, `plasma`, `chrome`. A page's `cover:`
frontmatter picks one; otherwise `coverClass(name)` hashes the name, so a page always keeps the
same cover. No network images (CSP `img-src 'self' data: blob:`).

---

## 7. Theme

`<html data-theme="dark|light">` from Settings → General → Theme (Match Windows / Light / Dark /
**Pitch black**), applied live. Pitch black (2.8) is the dark theme plus `data-oled="true"`: true
`#000` canvas and surfaces `#0C0C0E` / `#17171A`, ink `#FFF` / `#DEDEE3` / `#B6B6BE`, borders
`#2A2A2E` / `#3A3A3F` / `#5E5E66`; a custom accent tints only the accent roles, never the black.
2.8 also lifted every theme's secondary ink and borders (soft dark ink-300 `#D0D5DC`, ink-500
`#ADB4BE`, line `#363B44`), all checked by `npm run check:contrast` (pitch black included). Dark is Neon Grid; Light ("Daylight HUD") keeps the same neon fill, brackets, grid
and mono voice on pale steel, with deeper cyan for text roles.

---

## 8. Motion

Short and functional: 120–180 ms colour transitions on hover/press, 160 ms fade when switching
views, 180 ms rise for dialogs and toasts, cards lift 2px on hover. Ambient motion: the orb, the
dock's dashed ring (14 s turn), the wordmark glitch (two short bursts every ~4 s), the online dot
breathing. Reduced motion keeps colour/opacity changes and drops all movement.

---

## 9. Iconography

Lucide only, 18px, stroke 1.75, `icon-rest` at rest, `ink-100` on hover/active. Every icon button
has a label and tooltip. Emoji appear only as Sir's own space and page icons.

---

## 10. Writing in the interface

Sentence case in reading text; HUD labels in mono caps (`// comms log`, `sys.clock`). Buttons
name the action ("Move to Recycle Bin", not "OK"); errors say what to do next. The butler voice
("sir") appears only in Jarvis's own messages.

---

## 11. Accessibility checklist

- [ ] Keyboard reaches everything; visible cyan focus (inside the clip on primary buttons).
- [ ] Hit areas ≥ 36px (rail 36px, tree chevrons 24px inside a 32px row).
- [ ] `npm run check:contrast` passes.
- [ ] Replies announced politely, not per token; only one orb announces state; decorative
      readouts, captions and glitch copies are `aria-hidden`.
- [ ] Colour never the only signal (state also in the `[ STATUS ]` line and tags).
- [ ] Reduced motion verified; text scales with Windows display scaling.

---

## 12. Changelog

| Version | Change |
|---|---|
| v8.2 Artifacts and mood | Artifact cards with a sandboxed preview, context meter in the comms log, chat search in Conversations, mood-tinted orb. |
| v8.1 Apps and help | Seven new orb styles (aurora, voice waves, wormhole, tesseract, iris, firefly swarm, crystal; six removed); idle orb at 30 fps; Apps view (tiles, Timers with stopwatch, Scratchpad, System monitor); Jarvis Browser bar and Jarvis Terminal as small framework-free pages (`apps-pages.css`, Cascadia Mono); `HelpButton` (?) in `PageHeader` (`help` prop) and `Section` (auto `section:<title>`) opening a dialog: what, how, say, tips. |
| v8.0 Soft style | Second style beside Neon Grid, now the default (§3.7): rounded cards and buttons, pill tags, graphite / paper neutrals, soft shadows, one sans family; Style picker with previews. New panels: System monitor (live CPU graph, memory, disk, battery, uptime) and QR code. |
| v7.2 Whole-theme accent | Accent re-tints every neutral; 18 orb styles with a live picker; composer moved into the comms log, orb-only Core with click-to-talk and type-to-chat. |
| v7.1 Any accent | Accent picker with derived, contrast-checked tokens; panels beside the orb (§5.2a); hideable sidebar with Automations and Skills, Activity and Bible moved to Settings; Save bar; particle-sphere orb (liquid ripple, shells, sparks, glyph ring). |
| v7.0 Neon Grid | Cyberpunk HUD redesign: void canvas with grid and scanlines, HUD corner brackets, neon cyan primary with clipped corners, magenta / yellow second neons, Geist Mono HUD voice, 2–6px corners. Orb-first **Core** (340px reactor orb, corner readouts, captions; conversation moved to a side comms log), live orb dock on every screen, reactor orb (plasma filaments, segmented arcs, counter-ring, sweep, markers, breathing, error glitch). Spaces as Notion galleries with generated covers and page icons; foldable sidebar tree. Connections catalogue tabs and MCP Registry browser. |
| v6.1 Energy core | Orb redrawn after Sir's reference: teal canvas orb (dotted sphere, bar ring, wavy rings, glow) that follows Jarvis's voice, Sir's mic, or music on the PC; hero orb 168px. |
| v6.0 Geist | Vercel-style: ink on near-white, `#EBEBEB` hairlines, solid-ink primary, one blue, develop / preview / ship mesh behind the empty-state hero, Geist + Geist Mono, stacked small shadows, pill tags. |
| v5.0 Workspace | Notion-style: warm white canvas and grey sidebar, Notion purple primary, pastel tags and suggestion cards. |
| v4.0 Graphite | Replaced the glass themes: neutral graphite surfaces, one blue accent, one page grid; Transparency setting removed. |
| v3.0 Obsidian Intelligence | Four-level glass with violet/cyan accents (retired). |
| v2.0 Glass Workshop | Aurora glass islands (retired). |
| v1.0 Workshop at Night | Flat dark theme. |
