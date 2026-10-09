# Design System — JARVIS Desktop

| Field | Value |
|---|---|
| Status | v7.0 — Neon Grid (cyberpunk HUD) |
| Last updated | 2026-10-09 |
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
| `.hud-label` | 11 / 16, caps, 0.16em | Section labels, readouts, status |
| `text-xs` | 12 / 16 | Badges, metadata |
| `text-sm` | 13 / 18 | Secondary text, nav items, buttons (mono 13) |
| `text-base` | 16 / 1.55 | Body, chat |
| `text-lg` | 17 / 24 | Core captions |
| `text-xl`–`text-3xl` | 20–30 | Greeting, space and page titles (mono, bold) |

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
│ VOICE · MODEL · TODAY $                                       ● ONLINE  │  28px status bar
└────────────────────────────────────────────────────────────────────────┘
```

- **Sidebar** (`bg-app`, hairline right edge): a live `sm` orb + glitching **JARVIS** wordmark
  (decorative, `aria-hidden` copies), `// workspace` (Core, Spaces tree, Brain, Memory,
  Passwords), `// systems` (Activity, Connections, Reply copilot, Bible), Settings pinned to the
  bottom. Labels (256px) from 1200px, icons only (56px, tooltips) below. Active row =
  `.rail-active`.
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
mode, spend) are decorative (`aria-hidden`; the status bar carries the same facts). Composer at the
bottom, max 672px.

**Comms log:** the conversation, secondary to the orb: a 400–460px column beside the stage
(overlay sheet below 1200px) that opens when a conversation starts and is toggled from the header.
It lists finished messages (Sir: magenta right edge; Jarvis: cyan left edge) and, while a turn
runs, its tool cards and a three-dot "replying" mark. The reply text itself streams only under the
orb, so it is never on screen twice.

### 5.3 Page structure (`components/ui/page.tsx`)

Every view: `PageHeader` (48px, a 2px glowing cyan tick, the title in mono caps, actions on the
right, 1px divider) + `PageBody` (scrolls; one centred column, max 768px). Views with their own
list (Settings, Memory, Bible, Conversations) put a 224–256px list on the left whose top row is
also 48px.

### 5.4 Mini mode and Computer-Control overlay

Mini: the same orb on a small disc in a transparent always-on-top window over other apps; click
opens Jarvis, drag moves it. Overlay: 4px `alarm-fill` border and a solid pill with Stop; never
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
click (`aria-label="Open Jarvis core"`). Only the Core orb announces state to screen readers
(`announce`), so copies never repeat it.

---

## 6. Components

### 6.1 Orb (`components/jarvis/orb.tsx`, `orb-painter.ts`)

A reactor core, drawn on a canvas every frame, back to front:

1. **Halo** — radial glow in the state colour.
2. **HUD** (64px and up) — a tick ring (every tenth tick long) turning slowly backwards; a radar
   **sweep** with a magenta-to-cyan tail (conic gradient); six **segmented arcs** turning forwards;
   a dashed **magenta counter-ring**; four **yellow markers** pointing inward; three bright nodes
   riding the rings.
3. **Bar ring** — 90 level bars (28 below 48px).
4. **Core** — a bright ring with bloom, a thin outer ring, and a sphere: highlight → state colour →
   `--orb-2`, filled with five swirling **plasma filaments** (additive blend, cyan-white and
   magenta), a turning **dotted shell** and a hot centre.

Colours `--orb-1` (main), `--orb-2` (deep), `--orb-hi`, `--orb-3` (magenta), `--orb-4` (yellow).

**What it follows** (`selectOrbLevel`): Jarvis's voice while `SPEAKING`, Sir's mic while
`LISTENING`, otherwise music and other sound playing on the PC (Settings → General, on by default;
Security.md §7). Level drives one `energy` value with a fast attack and slow release; at rest it
**breathes** (a small sine), so the orb is never dead.

| State | Visual |
|---|---|
| `IDLE` | Slow spin, breathing; bars move with music if any is playing |
| `LISTENING` | Spins faster; bars, rings and filaments follow the mic |
| `THINKING` | A bright sweep runs round the bar ring; fastest spin |
| `ACTING` | The bar ring splits into one segment per tool call: cyan done, pulsing running, grey pending, red failed |
| `AWAITING_CONFIRMATION` | Yellow |
| `SPEAKING` | Bars, rings and filaments follow Jarvis's voice |
| `ERROR` | Red; the counter-ring turns red and the orb jitters sideways (glitch) |
| `SLEEP` | Grey, dimmed, still |

Sizes `sm` 32 (bars and core) · `dock` 72 · `md` 88 · `lg` 168 · `xl` 340. `role="img"`,
`aria-label`, debounced live announcement when `announce` (default on). Reduced motion: drawn once
per state change, never moves, no jitter.

### 6.2 Composer

`.composer`, 52px minimum, icon buttons inside: dictate, talk (cyan with a ring while recording),
attach, send (neon fill when there is text). While a turn runs, Send becomes Stop (red icon).

### 6.3 Chat (comms log)

Sir: right-aligned `surface-2` block, radius 4, magenta 2px right edge, max 85%. Jarvis: text
behind a 2px cyan left edge, Markdown, links `accent-300`, code on `surface-2` in Geist Mono.
Streaming text is shown as Core captions with a glowing caret (§5.2).

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

### 6.10 Covers

Eight generated covers in `surfaces.css`, all from neon tokens and `color-mix()`: `grid`,
`synthwave`, `matrix`, `circuit`, `aurora`, `hazard`, `plasma`, `chrome`. A page's `cover:`
frontmatter picks one; otherwise `coverClass(name)` hashes the name, so a page always keeps the
same cover. No network images (CSP `img-src 'self' data: blob:`).

---

## 7. Theme

`<html data-theme="dark|light">` from Settings → General → Theme (Match Windows / Dark / Light),
applied live. Dark is Neon Grid; Light ("Daylight HUD") keeps the same neon fill, brackets, grid
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
| v7.0 Neon Grid | Cyberpunk HUD redesign: void canvas with grid and scanlines, HUD corner brackets, neon cyan primary with clipped corners, magenta / yellow second neons, Geist Mono HUD voice, 2–6px corners. Orb-first **Core** (340px reactor orb, corner readouts, captions; conversation moved to a side comms log), live orb dock on every screen, reactor orb (plasma filaments, segmented arcs, counter-ring, sweep, markers, breathing, error glitch). Spaces as Notion galleries with generated covers and page icons; foldable sidebar tree. Connections catalogue tabs and MCP Registry browser. |
| v6.1 Energy core | Orb redrawn after Sir's reference: teal canvas orb (dotted sphere, bar ring, wavy rings, glow) that follows Jarvis's voice, Sir's mic, or music on the PC; hero orb 168px. |
| v6.0 Geist | Vercel-style: ink on near-white, `#EBEBEB` hairlines, solid-ink primary, one blue, develop / preview / ship mesh behind the empty-state hero, Geist + Geist Mono, stacked small shadows, pill tags. |
| v5.0 Workspace | Notion-style: warm white canvas and grey sidebar, Notion purple primary, pastel tags and suggestion cards. |
| v4.0 Graphite | Replaced the glass themes: neutral graphite surfaces, one blue accent, one page grid; Transparency setting removed. |
| v3.0 Obsidian Intelligence | Four-level glass with violet/cyan accents (retired). |
| v2.0 Glass Workshop | Aurora glass islands (retired). |
| v1.0 Workshop at Night | Flat dark theme. |
