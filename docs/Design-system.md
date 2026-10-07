# Design System — JARVIS Desktop

| Field | Value |
|---|---|
| Status | v6.0 — Geist (after Vercel) |
| Last updated | 2026-10-08 |
| Theme | **Geist** light (signature) and **Geist Dark** (polarity flip) |
| Stack | Electron · React · TypeScript · Tailwind v4 · CSS transitions |
| Related | [App-flow](App-flow.md) · [Code-style](Code-style.md) §6 · [PRD](PRD.md) F4.6 |

This file is the **single source of truth** for the JARVIS look. The code lives in
`src/renderer/src/styles/` (`tokens.css`, `surfaces.css`, `fonts.css`, `globals.css`),
`components/ui/page.tsx` (page layout) and `components/jarvis/orb.tsx`.

---

## 1. Direction

Modelled on Vercel's design language (from the reference analysis Sir supplied): ink on
near-white, a 1px `#EBEBEB` hairline on everything, **black ink** (`#171717`) for the main action,
one **blue** (`#0070F3`) for focus, links and Jarvis, and the develop / preview / ship **mesh
gradient** as the only decoration, used once, behind the empty-state hero. Geist for text,
Geist Mono for code. Dark is the polarity flip: near-black canvas, white ink as the main action.

| Principle | In practice |
|---|---|
| **Ink is the action** | Primary buttons are solid ink (white ink in dark). No coloured buttons except red for deliberate danger. |
| **Blue has one job** | Focus edges, links, the orb, the stream caret. Never a button fill. |
| **Gradient at hero scale only** | The mesh sits behind the empty-state orb and greeting. Never a swatch, icon or border. |
| **Stacked, quiet elevation** | Cards: hairline + two tiny offsets. Floats: hairline ring + three offsets. Never one heavy drop. |
| **Geometry** | 6px controls, 8px cards, 12px dialogs and composer, pills only for tags and filter tabs. |
| **Negative tracking** | Display sizes are tracked tight (-0.03 to -0.045em), weight 600 max. |
| **One grid** | Same 48px header and centred 768px column on every view (§5.3). |
| **Readable first** | Every text role passes 4.5:1 on every surface, both themes (§3.5). |

---

## 2. Surfaces

| Class / utility | Light | Dark | Used for |
|---|---|---|---|
| `bg-app` | `#FAFAFA` | `#0A0A0A` | Sidebar, status bar |
| `.panel` (`bg-main`) | `#FFFFFF` | `#0A0A0A` | Canvas: main view and the activity column (hairline dividers, no radius) |
| `.card` (`bg-surface-1`) | `#FFFFFF` + `#EBEBEB` hairline | `#111111` + `#2E2E2E` | Settings groups, tool cards, suggestions; radius 8, `shadow-sm` |
| `.inset` (`bg-surface-2`) | `#F5F5F5` | `#1A1A1A` | Code, Sir's message, chips |
| `bg-selected` | `#EBEBEB` | `#232323` | Selected sidebar row or list item |
| `.popover` | surface-1 + hairline + `shadow-pop` | same | Toasts, menus, sheets |
| `.dialog` | canvas + hairline + `shadow-pop`, radius 12 | same | Confirmations |
| `.composer` | canvas, hairline, `shadow-sm`, radius 12; focus = 2px blue edge | same | Message box |
| `.tag` | soft tint + deep ink, pill | dark tints | Tier and status labels |
| `.mesh` | develop / preview / ship radial mesh, blur 56px, 22% | 30% | Empty-state hero backdrop only |

Elevation: `shadow-sm` = `0 1px 1px rgba(0,0,0,.02), 0 2px 2px rgba(0,0,0,.04)` (cards, composer,
secondary buttons) · `shadow-pop` = `0 0 0 1px rgba(0,0,0,.08), 0 1px 1px rgba(0,0,0,.02),
0 8px 16px -4px rgba(0,0,0,.04), 0 24px 32px -8px rgba(0,0,0,.06)` (dialogs, toasts, sheets).

---

## 3. Colour

### 3.1 Neutrals

| Role | Light | Dark | Use |
|---|---|---|---|
| `ink-100` | `#171717` | `#EDEDED` | Primary text |
| `ink-300` | `#4D4D4D` | `#A1A1A1` | Secondary text |
| `ink-500` | `#666666` | `#8F8F8F` | Tertiary text, timestamps, placeholders |
| `icon-rest` | `#666666` | `#8F8F8F` | Icons |
| `ink-strong` / `on-strong` | `#171717` / white | `#EDEDED` / `#0A0A0A` | Brand mark, active pill tab, text selection |

### 3.2 Primary and blue

| Role | Light | Dark | Use |
|---|---|---|---|
| `accent-600` / `accent-700` | `#171717` / `#383838` | `#EDEDED` / `#CCCCCC` | Primary button rest / hover |
| `accent-500` | `#0070F3` | `#52A8FF` | Focus edge, the orb, caret, spinners |
| `accent-300` | `#005BC0` | `#52A8FF` | Links (Vercel blue, darkened to reach 4.5:1 on grey + hover) |
| `accent-tint` | `#D3E5FF` | `#0D2847` | Accent tag background |

### 3.3 Status tags

| Meaning | Tag fill / ink (light) | Tag fill / ink (dark) | Text colour |
|---|---|---|---|
| Needs a decision | amber `#FFEFCF` / `#8A4300` | `#33240D` / `#FFC96B` | `lamp-400` `#964C00` / `#F5A623` |
| Error, blocked | red `#F7D4D6` / `#A80000` | `#3C1618` / `#FF9592` | `alarm-500` `#C50000` / `#FF6166`; fill `#C50000` |
| Done, connected | green `#D9F5E0` | `#0F2E18` | `ok-400` `#236C33` / `#62C073` |
| Neutral | grey `#F2F2F2` / `#4D4D4D` | `#1F1F1F` / `#A1A1A1` | n/a |

Brand mesh stops (`--mesh-1..6`): `#007CF0`, `#00DFD8` (develop), `#7928CA`, `#FF0080`
(preview), `#FF4D4D`, `#F9CB28` (ship). Order fixed, never used alone.

### 3.4 Tailwind

Tokens map to utilities in `globals.css` (`bg-surface-1`, `text-ink-300`, `border-line`,
`text-accent-300`, `text-lamp-tag-ink`, `shadow-pop`, ...). Breakpoints `md` 760, `lg` 1200,
`xl` 1600, `short` (height < 600). No raw hex or `rgba()` in components.

### 3.5 Contrast check

`npm run check:contrast` checks every text role on every surface (+ hover) in both themes
(>= 4.5:1), icons (>= 3:1), button text and every tag pair. Current lowest: light **4.72:1**,
dark **4.57:1**.

---

## 4. Typography

**Geist** for the whole interface; **Geist Mono** for code, file paths, JSON and logs. Both SIL
OFL, bundled in `src/renderer/src/assets/fonts/` (licence in `resources/fonts/geist-OFL.txt`).

| Utility | Size / line / tracking | Use |
|---|---|---|
| `text-xs` | 12 / 16 | Badges, metadata, status bar |
| `text-sm` | 13 / 18 | Secondary text, nav items |
| `text-ui` | 14 / 20, -0.02em | Buttons, page titles in the header |
| `text-base` | 16 / 1.55 | Body, chat, section titles |
| `text-xl` | 20 / 28, -0.03em | Card titles |
| `text-2xl` | 28 / 1.25, -0.04em | Onboarding headings |
| `text-hero` | 36 / 1.2, -0.045em | Empty-state greeting |

Weights: 400 body, 500 labels and buttons, 600 titles (never 700). Sentence case, no
letter-spaced capitals, tabular figures for numbers.

---

## 5. Layout

### 5.1 Shell

```text
┌──────┬───────────────────────────────────────────┬────────────────────┐
│ [J]  │ ┌─ panel ───────────────────────────────┐ │ ┌─ panel ────────┐ │
│ chat │ │ header 48px                           │ │ │ Activity       │ │
│ mem  │ │                                       │ │ │                │ │
│ act  │ │   centred column, max 768px           │ │ │                │ │
│ conn │ │                                       │ │ │                │ │
│ copi │ │   composer (same width as column)     │ │ │                │ │
│ bib  │ └───────────────────────────────────────┘ │ └────────────────┘ │
│ ⚙    │                                           │                    │
├──────┴───────────────────────────────────────────┴────────────────────┤
│ Voice · model · today's cost                               ● Online   │  28px status bar
└───────────────────────────────────────────────────────────────────────┘
```

- **Sidebar** (`bg-app`, hairline right edge): brand mark + "Jarvis", views, Settings pinned to
  the bottom. Icons with labels (240px) from 1200px, icons only (56px, tooltips) below. Rows are
  36px; active = `bg-selected` + 500 weight.
- **Canvas** fills the rest with no gaps; the activity column sits beside it behind a hairline.
- **Activity**: docked column from 1200px; below that a sheet over a scrim (Esc closes).
- Default window 1100 × 760, minimum 480 × 520. Never a horizontal page scroll.

### 5.2 Empty state

The brand mesh (`.mesh`) behind the orb (168px) and the greeting in `text-hero`, then up to three
suggestion cards (`.card`, white with hairline and `shadow-sm`, hover `surface-2`) in an even
three-column grid as wide as the composer.

### 5.3 Page structure (`components/ui/page.tsx`)

Every view: `PageHeader` (48px, title on the left in `text-ui` 600, actions on the right, 1px
divider) + `PageBody` (scrolls; one centred column, max 768px, 24px vertical padding, 16/24px
side padding). Views with their own list (Settings, Memory, Bible, Conversations) put a 224–256px
sidebar on the left whose top row is also 48px, so both headers line up.

### 5.4 Mini mode and Computer-Control overlay

Mini: the orb on a small solid disc (surface-1, strong line, shadow) in a transparent window;
click opens Jarvis, drag moves it. Overlay: 4px `alarm-fill` border and a solid pill with Stop;
never translucent.

---

## 6. Components

### 6.1 Orb (`components/jarvis/orb.tsx`)

Jarvis's energy core, after Sir's reference image: a teal glow, wavy outer rings, a ring of
bars, a bright inner ring and a slowly turning dotted sphere. Drawn on a canvas every frame
(`orb-painter.ts`); colours `--orb-1` / `--orb-2` / `--orb-hi` (teal is the one exception to
"blue for Jarvis", by Sir's choice). The orb is the only teal thing in the app.

**What it follows** (`selectOrbLevel`): Jarvis's voice while `SPEAKING`, Sir's mic while
`LISTENING`, otherwise music and other sound playing on the PC (Settings → General, on by
default; see Security.md §7 for the meter). Level drives one `energy` value with a fast attack
and a slow release, so the bars jump on a beat or a syllable and settle smoothly; the rings
widen, the glow brightens, the sphere swells and spins faster.

| State | Visual |
|---|---|
| `IDLE` | Slow spin; bars and rings move with music if any is playing |
| `LISTENING` | Bars, rings and glow follow the mic level |
| `THINKING` | A bright sweep runs round the bar ring; the sphere spins faster |
| `ACTING` | The bar ring splits into one segment per tool call: teal done, pulsing running, grey pending, red failed |
| `AWAITING_CONFIRMATION` | Amber |
| `SPEAKING` | Bars, rings and glow follow Jarvis's voice |
| `ERROR` | Red, one small shake |
| `SLEEP` | Grey, dimmed, still |

Sizes `sm` 32 (bars and core only) · `md` 88 · `lg` 168. `role="img"`, `aria-label`,
debounced live announcement. Reduced motion: drawn once per state change, never moves.

### 6.2 Composer

`.composer`, 52px minimum, icon buttons inside: mic (blue with a ring while recording), attach,
send (solid blue when there is text). While a turn runs, Send becomes Stop (red icon).

### 6.3 Chat

Sir: right-aligned `bg-surface-2` bubble, radius 12 (4 at bottom-right), max 85%. Jarvis: plain
text on the panel, Markdown, links `accent-300`, code on `surface-2` in Geist Mono. Streaming
shows a 2px blue caret.

### 6.4 Tool cards

`.card` rows (40px). Tier badges are `.tag`s: SAFE grey, CONFIRM peach, BLOCKED rose. Status:
grey dot pending · blue ring spinner running · orange dot waiting (+ orange left edge) · green
check with ms · red cross failed · grey slash declined. Details on `surface-2` in mono.

### 6.5 Confirmation dialog — safety-critical

`.dialog` over `.scrim`, 480px. Destructive: red edge, red icon, **flat red** primary button,
initial focus on Cancel, Enter does not approve (click or Ctrl+Enter). Confirm tier: orange top
line. Non-destructive primary is solid ink. Buttons repeat the verb. Taint banner amber. Countdown in
the last 20 s; one at a time ("1 of 3"). Behaviour unchanged from earlier versions.

### 6.6 Controls

| Control | Style |
|---|---|
| Buttons | 36px, radius 6, `text-ui` 500. Primary solid ink (hover `accent-700`) · Secondary white with hairline and `shadow-sm` · Danger red · Ghost text |
| Inputs, selects | `surface-1`, 1px hairline, radius 6; focus = 2px blue edge |
| Switches | 36 × 20; off `line-strong`, on solid ink; thumb in `ink-on-accent` |
| Tabs | Underline tabs (2px ink underline on the active one); filters are pill tabs, the active one solid ink |
| Focus | 2px blue outline, 2px offset, everywhere |

### 6.7 Loading

The orb shows turn state; tool cards show the ring; checks show grey skeleton bars.

### 6.8 Toasts

`.popover`, top-centre under the header, max 3; icon colour gives the level; errors stay until
dismissed.

### 6.9 Settings, Memory, Activity, Connections

All follow §5.3. Settings and Memory: left list (selected = `bg-selected` + 500 weight). Settings
groups are `.card` sections. Activity: segmented tabs (Actions / Audit log / Usage). Connections:
one `.card` per server.

---

## 7. Theme

`<html data-theme="dark|light">` from Settings → General → Theme (Match Windows / Dark / Light),
applied live. The old Transparency setting was removed with the glass.

---

## 8. Motion

Short and functional: 120–180 ms colour transitions on hover/press, 160 ms fade when switching
views, 180 ms rise for dialogs and toasts. Only the orb animates on its own. Reduced motion keeps
colour/opacity changes and drops movement.

---

## 9. Iconography

Lucide only, 18px, stroke 1.75, `icon-rest` at rest, `ink-100` on hover/active. Every icon button
has a label and tooltip. No emoji as icons.

---

## 10. Writing in the interface

Sentence case; buttons name the action ("Move to Recycle Bin", not "OK"); errors say what to do
next. The butler voice ("sir") appears only in Jarvis's own messages.

---

## 11. Accessibility checklist

- [ ] Keyboard reaches everything; visible blue focus.
- [ ] Hit areas ≥ 36px (rail 40px).
- [ ] `npm run check:contrast` passes.
- [ ] Replies announced politely, not per token; dialog traps and restores focus.
- [ ] Colour never the only signal.
- [ ] Reduced motion verified; text scales with Windows display scaling.

---

## 12. Changelog

| Version | Change |
|---|---|
| v6.1 Energy core | Orb redrawn after Sir's reference: teal canvas orb (dotted sphere, bar ring, wavy rings, glow) that follows Jarvis's voice, Sir's mic, or music on the PC; hero orb 168px. |
| v6.0 Geist | Vercel-style: ink on near-white, `#EBEBEB` hairlines, solid-ink primary (white ink in dark), one blue for focus, links and the orb, develop / preview / ship mesh behind the empty-state hero only, Geist + Geist Mono, stacked small shadows, 6px controls / 8px cards / pill tags, tight negative tracking on display sizes. Dark is the polarity flip on `#0A0A0A`. Focus outline moved to the base layer so field and composer recipes win. |
| v5.0 Workspace | Notion-style: warm white canvas and grey sidebar, Notion purple primary, link blue for links, pastel tags and suggestion cards, labelled sidebar from 1200px, underline and pill tabs, 8px buttons / 12px cards, level-4 shadows on floats only. Dark follows Notion's app dark mode. |
| v4.0 Graphite | Replaced the glass themes: neutral graphite surfaces, one blue accent, red for danger; solid bordered panels; one page grid (48px header, 768px column) for every view; Outfit only (JetBrains Mono for code); simpler orb; Transparency setting removed. |
| v3.0 Obsidian Intelligence | Four-level glass with violet/cyan accents (retired). |
| v2.0 Glass Workshop | Aurora glass islands (retired). |
| v1.0 Workshop at Night | Flat dark theme. |
