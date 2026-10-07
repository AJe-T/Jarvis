# Design System — JARVIS Desktop

| Field | Value |
|---|---|
| Status | v4.0 — Graphite |
| Last updated | 2026-10-08 |
| Theme | **Graphite** (dark, default) and **Graphite Light** |
| Stack | Electron · React · TypeScript · Tailwind v4 · CSS transitions |
| Related | [App-flow](App-flow.md) · [Code-style](Code-style.md) §6 · [PRD](PRD.md) F4.6 |

This file is the **single source of truth** for the JARVIS look. The code lives in
`src/renderer/src/styles/` (`tokens.css`, `surfaces.css`, `fonts.css`, `globals.css`),
`components/ui/page.tsx` (page layout) and `components/jarvis/orb.tsx`.

---

## 1. Direction

A calm, professional desktop tool in the spirit of Linear, Vercel and the Claude desktop app:
neutral graphite surfaces, one blue accent, crisp 1px borders, generous but consistent spacing,
and one typeface. No glass, no gradients, no glow, no decoration that doesn't carry meaning.

| Principle | In practice |
|---|---|
| **Three colours** | Graphite neutrals for everything, **one blue** for interaction and for Jarvis, **red** only for danger. Amber and green appear only as small status marks (needs a decision / done). |
| **Borders, not effects** | Depth comes from a slightly lighter surface and a 1px line. Shadows only on things that float (dialogs, toasts, menus). |
| **One grid** | Every view uses the same 48px header and the same centred 768px column (§5.3), so edges line up across the app. |
| **Readable first** | Every text role passes 4.5:1 on every surface, in both themes (§3.5). |

---

## 2. Surfaces

| Class / utility | Dark | Light | Used for |
|---|---|---|---|
| `bg-app` | `#0B0B0D` | `#F4F4F5` | Window, sidebar, status bar |
| `.panel` (`bg-main`) | `#111113` | `#FFFFFF` | Main content panel and the activity panel; 1px `line`, radius 12 |
| `.card` (`bg-surface-1`) | `#18181B` | `#FFFFFF` | Settings groups, tool cards, suggestion cards, connections |
| `.inset` (`bg-surface-2`) | `#1F1F23` | `#F4F4F5` | Inputs, code, chips, attachments, Sir's message |
| `bg-selected` | `#26262B` | `#ECECEF` | Selected nav item or row |
| `.popover` | surface-1 + strong line + shadow | same | Toasts, menus, overlay sheets |
| `.dialog` | surface-1 + strong line + shadow, radius 12 | same | Confirmations |
| `.scrim` | black 60% | ink 35% | Behind dialogs and sheets |
| `.composer` | surface-1, strong line, radius 12; focus = blue edge + 3px blue ring | same | Message box |

Lines: `line-subtle` (dividers inside a panel), `line` (cards, inputs), `line-strong` (floating
things, hover edges).

---

## 3. Colour

### 3.1 Neutrals (text)

| Role | Dark | Light | Use |
|---|---|---|---|
| `ink-100` | `#F4F4F5` | `#09090B` | Primary text |
| `ink-300` | `#A1A1AA` | `#52525B` | Secondary text |
| `ink-500` | `#9A9AA3` | `#62626B` | Tertiary text, timestamps, placeholders |
| `icon-rest` | `#9A9AA3` | `#62626B` | Icons at rest |

### 3.2 Accent (the one colour)

| Role | Dark | Light | Use |
|---|---|---|---|
| `accent-600` | `#2563EB` | `#2563EB` | Primary buttons, send, switches on, brand mark (white text 5.2:1) |
| `accent-500` | `#3B82F6` | `#2563EB` | Focus ring, the orb, selected-card edges |
| `accent-300` | `#60A5FA` | `#1D4ED8` | Links and accent text |
| `accent-tint` | blue 12% | blue 8% | Focus ring halo, selection |

### 3.3 Status (small marks only)

| Role | Dark | Light | Meaning |
|---|---|---|---|
| `alarm-500` / `alarm-fill` | `#F87171` / `#DC2626` | `#B91C1C` / `#DC2626` | Errors (text, icons) / destructive buttons |
| `lamp-400` | `#F59E0B` | `#92400E` | Jarvis needs a decision |
| `ok-400` | `#22C55E` | `#166534` | Done, connected, enabled |

Status colours always come with an icon or words.

### 3.4 Tailwind

Tokens map to utilities in the `@theme inline` block of `globals.css` (`bg-surface-1`,
`text-ink-300`, `border-line`, `text-accent-300`, `bg-alarm-fill`, `shadow-pop`, …).
Breakpoints: `md` 760, `lg` 1200, `xl` 1600, and the `short` variant (height < 600).
No raw hex or `rgba()` in components.

### 3.5 Contrast check

`npm run check:contrast` (`scripts/check-glass-contrast.mjs`, run in CI) checks every text role on
every surface, plus hover, in both themes (≥ 4.5:1), icons (≥ 3:1) and text on filled buttons.
Current lowest: dark **5.11:1**, light **5.03:1**.

---

## 4. Typography

**Outfit** for the whole interface; **JetBrains Mono** only for code, file paths, JSON and logs.
Both are SIL OFL, bundled in `src/renderer/src/assets/fonts/` (licences in `resources/fonts/`).

| Utility | Size / line | Use |
|---|---|---|
| `text-xs` | 12 / 16 | Badges, metadata, status bar |
| `text-sm` | 13 / 18 | Secondary text, nav items |
| `text-ui` | 14 / 20 | Buttons, page titles in the header |
| `text-base` | 15 / 24 | Body, chat, section titles |
| `text-2xl` | 26 / 34 | Onboarding headings |
| `text-hero` | 28 / 36 | Empty-state greeting |

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

- **Sidebar** (56–64px) on the window colour: brand mark, views, Settings pinned to the bottom.
  Icon buttons 40px; active = `bg-selected` + full-strength icon.
- **Panels** separated by an 8px gap (6px below 760px).
- **Activity**: docked panel from 1200px; below that a sheet over a scrim (Esc closes).
- Default window 1100 × 760, minimum 480 × 520. Never a horizontal page scroll.

### 5.2 Empty state

Orb (112px), the greeting in `text-hero`, then up to three suggestion **cards** in an even
three-column grid the same width as the composer.

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

A calm status mark: a blue core with a white centre, a grey track and one state ring.

| State | Visual |
|---|---|
| `IDLE` | Core breathes slowly; no ring |
| `LISTENING` | Ring brightens with mic level; core scales 0.94→1.08; a soft ripple |
| `THINKING` | A short arc turns around the track (1.4 s) |
| `ACTING` | One segment per tool call: blue done, light blue running, grey pending, red failed |
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

`.card` rows (40px). Tier badges are small tinted labels (SAFE neutral, CONFIRM amber, BLOCKED
red). Status: grey dot pending · blue ring spinner running · amber dot waiting (+ amber left edge) ·
green check with ms · red cross failed · grey slash declined. Details on `surface-2` in mono.

### 6.5 Confirmation dialog — safety-critical

`.dialog` over `.scrim`, 480px. Destructive: red edge, red icon, **flat red** primary button,
initial focus on Cancel, Enter does not approve (click or Ctrl+Enter). Confirm tier: amber top
line. Non-destructive primary is blue. Buttons repeat the verb. Taint banner amber. Countdown in
the last 20 s; one at a time ("1 of 3"). Behaviour unchanged from earlier versions.

### 6.6 Controls

| Control | Style |
|---|---|
| Buttons | 36px, radius 8, `text-ui` 500. Primary blue · Secondary bordered surface · Danger red · Ghost text |
| Inputs, selects | `surface-2`, 1px line; focus = blue border + 3px blue halo |
| Switches | 36 × 20; off `line-strong`, on blue; white thumb |
| Tabs | Segmented control on `surface-2`; the active tab is a raised `surface-1` chip |
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
| v4.0 Graphite | Replaced the glass themes: neutral graphite surfaces, one blue accent, red for danger; solid bordered panels; one page grid (48px header, 768px column) for every view; Outfit only (JetBrains Mono for code); simpler orb; Transparency setting removed. |
| v3.0 Obsidian Intelligence | Four-level glass with violet/cyan accents (retired). |
| v2.0 Glass Workshop | Aurora glass islands (retired). |
| v1.0 Workshop at Night | Flat dark theme. |
