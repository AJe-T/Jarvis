# Design System — JARVIS Desktop

| Field | Value |
|---|---|
| Status | v5.0 — Workspace (after Notion) |
| Last updated | 2026-10-08 |
| Theme | **Workspace** light (signature) and **Workspace Dark** (Notion app dark) |
| Stack | Electron · React · TypeScript · Tailwind v4 · CSS transitions |
| Related | [App-flow](App-flow.md) · [Code-style](Code-style.md) §6 · [PRD](PRD.md) F4.6 |

This file is the **single source of truth** for the JARVIS look. The code lives in
`src/renderer/src/styles/` (`tokens.css`, `surfaces.css`, `fonts.css`, `globals.css`),
`components/ui/page.tsx` (page layout) and `components/jarvis/orb.tsx`.

---

## 1. Direction

Modelled on Notion's design language (from the reference analysis Sir supplied): a warm white
canvas, a warm-grey sidebar, 1px hairlines, **Notion purple** (`#5645D4`) for the main action and
for Jarvis, **link blue** for links only, and soft **pastel tags and cards** for status and
suggestions. 8px rectangular buttons (not pills), 12px cards, shadows only on floating things.
Outfit replaces Notion Sans (Sir's standing choice of typeface).

| Principle | In practice |
|---|---|
| **Sober geometry** | Buttons 8px rectangles, cards 12px, pills only for filter tabs and badges. |
| **Purple and blue have different jobs** | Purple = main action, focus, selection edges, the orb. Blue = inline links. Never mixed. |
| **Colour as pastel tags** | Status uses Notion's tag pairs: peach (needs a decision), rose (blocked/error), mint (done), lavender (accent), grey (neutral). |
| **One grid** | Same 48px header and centred 768px column on every view (§5.3). |
| **Readable first** | Every text role passes 4.5:1 on every surface, both themes (§3.5). |

---

## 2. Surfaces

| Class / utility | Light | Dark | Used for |
|---|---|---|---|
| `bg-app` | `#F7F6F3` | `#202020` | Sidebar, status bar |
| `.panel` (`bg-main`) | `#FFFFFF` | `#191919` | Canvas: main view and the activity column (hairline dividers, no radius) |
| `.card` (`bg-surface-1`) | `#FFFFFF` + `#E5E3DF` hairline | `#202020` + `#2F2F2F` | Settings groups, tool cards, connections; radius 12, no shadow |
| `.inset` (`bg-surface-2`) | `#F6F5F4` | `#252525` | Inputs at rest, code, Sir's message, chips |
| `bg-selected` | `#ECEBE8` | `#2C2C2C` | Selected sidebar row or list item |
| `.popover` | surface-1 + hairline + level-4 shadow | same | Toasts, menus, sheets |
| `.dialog` | canvas + hairline + level-4 shadow, radius 12 | same | Confirmations |
| `.composer` | canvas, strong hairline, small shadow; focus = 2px purple edge | same | Message box |
| `.tag` | pastel fill + deep ink, radius 4 | dark tints | Tier and status labels |

Elevation: flat cards (hairline only) · `shadow-sm` (composer) · `shadow-pop` =
`rgba(15,15,15,.16) 0 16px 48px -8px` (dialogs, toasts, sheets).

---

## 3. Colour

### 3.1 Neutrals

| Role | Light | Dark | Use |
|---|---|---|---|
| `ink-100` | `#1A1A1A` | `#EBEBEA` | Primary text |
| `ink-300` | `#5D5B54` (slate) | `#B5B4B1` | Secondary text |
| `ink-500` | `#6B6963` | `#9B9A97` | Tertiary text, timestamps, placeholders |
| `icon-rest` | `#787671` (steel) | `#9B9A97` | Icons |
| `ink-strong` / `on-strong` | black / white | white / `#191919` | Brand mark, active pill tab |

### 3.2 Primary and links

| Role | Light | Dark | Use |
|---|---|---|---|
| `accent-600` / `accent-700` | `#5645D4` / `#4534B3` | `#5645D4` / `#6A5AE0` | Primary button rest / pressed (white text 6.6:1) |
| `accent-500` | `#5645D4` | `#8577EA` | Focus edge, the orb, selection edges |
| `accent-300` | `#0069C2` | `#5AA6D6` | Links (Notion link blue, darkened to reach 4.5:1 on grey) |
| `accent-tint` | `#E6E0F5` lavender | `#2B2540` | Accent tag background |

### 3.3 Status tags

| Meaning | Tag fill / ink (light) | Tag fill / ink (dark) | Text colour |
|---|---|---|---|
| Needs a decision | peach `#FFE8D4` / `#793400` | `#3B2A1D` / `#FFB46B` | `lamp-400` `#A84500` / `#FFA344` |
| Error, blocked | rose `#FDE0EC` / `#A02E6D` | `#3B2026` / `#FF9A92` | `alarm-500` `#C92A2A` / `#FF7369`; fill `#E03131` |
| Done, connected | mint `#D9F3E1` | `#1F3326` | `ok-400` `#0D7329` / `#4DAB9A` |
| Neutral | grey `#F0EEEC` / slate | `#2F2F2F` | n/a |

Empty-state suggestion cards use the peach, mint and lavender feature tints with charcoal text.

### 3.4 Tailwind

Tokens map to utilities in `globals.css` (`bg-surface-1`, `text-ink-300`, `border-line`,
`text-accent-300`, `bg-tint-peach`, `text-lamp-tag-ink`, `shadow-pop`, ...). Breakpoints `md` 760,
`lg` 1200, `xl` 1600, `short` (height < 600). No raw hex or `rgba()` in components.

### 3.5 Contrast check

`npm run check:contrast` checks every text role on every surface (+ hover) in both themes
(>= 4.5:1), icons (>= 3:1), button text and every tag pair. Current lowest: light **4.52:1**,
dark **4.62:1**.

---

## 4. Typography

**Outfit** for the whole interface; **JetBrains Mono** only for code, file paths, JSON and logs.
Both are SIL OFL, bundled in `src/renderer/src/assets/fonts/` (licences in `resources/fonts/`).

| Utility | Size / line | Use |
|---|---|---|
| `text-xs` | 12 / 16 | Badges, metadata, status bar |
| `text-sm` | 13 / 18 | Secondary text, nav items |
| `text-ui` | 14 / 20 | Buttons, page titles in the header |
| `text-base` | 16 / 1.55 | Body, chat, section titles |
| `text-2xl` | 28 / 1.25 | Onboarding headings |
| `text-hero` | 36 / 1.2, -0.02em | Empty-state greeting |

Weights: 400 body, 500 labels and selected items, 600 titles and buttons. Sentence case, no
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
  36px; active = `bg-selected` + 500 weight, like Notion's sidebar.
- **Canvas** fills the rest with no gaps; the activity column sits beside it behind a hairline.
- **Activity**: docked column from 1200px; below that a sheet over a scrim (Esc closes).
- Default window 1100 × 760, minimum 480 × 520. Never a horizontal page scroll.

### 5.2 Empty state

Orb (112px), the greeting in `text-hero`, then up to three suggestion cards in Notion's pastel
feature tints (peach, mint, lavender) in an even three-column grid as wide as the composer.

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

A calm status mark: a purple core with a white centre, a grey track and one state ring.

| State | Visual |
|---|---|
| `IDLE` | Core breathes slowly; no ring |
| `LISTENING` | Ring brightens with mic level; core scales 0.94→1.08; a soft ripple |
| `THINKING` | A short arc turns around the track (1.4 s) |
| `ACTING` | One segment per tool call: purple done, pale purple running, grey pending, red failed |
| `AWAITING_CONFIRMATION` | Amber core and ring, gentle breathing |
| `SPEAKING` | The ring becomes a gentle wave that follows the voice level |
| `ERROR` | Red, one small shake, then still |
| `SLEEP` | Grey outline only |

Sizes `sm` 32 · `md` 88 · `lg` 112. `role="img"`, `aria-label`, debounced live announcement.
Reduced motion: no rotation, ripple, wave or scaling.

### 6.2 Composer

`.composer`, 52px minimum, icon buttons inside: mic (blue with a ring while recording), attach,
send (solid blue when there is text). While a turn runs, Send becomes Stop (red icon).

### 6.3 Chat

Sir: right-aligned `bg-surface-2` bubble, radius 12 (4 at bottom-right), max 85%. Jarvis: plain
text on the panel, Markdown, links `accent-300`, code on `surface-2` in JetBrains Mono. Streaming
shows a 2px blue caret.

### 6.4 Tool cards

`.card` rows (40px). Tier badges are `.tag`s: SAFE grey, CONFIRM peach, BLOCKED rose. Status:
grey dot pending · purple ring spinner running · orange dot waiting (+ orange left edge) · green
check with ms · red cross failed · grey slash declined. Details on `surface-2` in mono.

### 6.5 Confirmation dialog — safety-critical

`.dialog` over `.scrim`, 480px. Destructive: red edge, red icon, **flat red** primary button,
initial focus on Cancel, Enter does not approve (click or Ctrl+Enter). Confirm tier: orange top
line. Non-destructive primary is purple. Buttons repeat the verb. Taint banner amber. Countdown in
the last 20 s; one at a time ("1 of 3"). Behaviour unchanged from earlier versions.

### 6.6 Controls

| Control | Style |
|---|---|
| Buttons | 36px, radius 8 (rectangles), `text-ui` 500. Primary purple (pressed `accent-700`) · Secondary outlined (`line-strong`) · Danger red · Ghost text |
| Inputs, selects | `surface-2`, 1px hairline; focus = 2px purple edge |
| Switches | 36 × 20; off `line-strong`, on purple; white thumb |
| Tabs | Notion underline tabs (2px ink underline on the active one); filters are pill tabs, the active one solid ink |
| Focus | 2px purple outline, 2px offset, everywhere |

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

- [ ] Keyboard reaches everything; visible purple focus.
- [ ] Hit areas ≥ 36px (rail 40px).
- [ ] `npm run check:contrast` passes.
- [ ] Replies announced politely, not per token; dialog traps and restores focus.
- [ ] Colour never the only signal.
- [ ] Reduced motion verified; text scales with Windows display scaling.

---

## 12. Changelog

| Version | Change |
|---|---|
| v5.0 Workspace | Notion-style: warm white canvas and grey sidebar, Notion purple primary, link blue for links, pastel tags and suggestion cards, labelled sidebar from 1200px, underline and pill tabs, 8px buttons / 12px cards, level-4 shadows on floats only. Dark follows Notion's app dark mode. |
| v4.0 Graphite | Replaced the glass themes: neutral graphite surfaces, one blue accent, red for danger; solid bordered panels; one page grid (48px header, 768px column) for every view; Outfit only (JetBrains Mono for code); simpler orb; Transparency setting removed. |
| v3.0 Obsidian Intelligence | Four-level glass with violet/cyan accents (retired). |
| v2.0 Glass Workshop | Aurora glass islands (retired). |
| v1.0 Workshop at Night | Flat dark theme. |
