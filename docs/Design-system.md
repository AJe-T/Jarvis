# Design System — JARVIS Desktop

| Field | Value |
|---|---|
| Status | v1.0 |
| Last updated | 2026-10-06 |
| Related | [App-flow](App-flow.md) · [Code-style](Code-style.md) §6 · [PRD](PRD.md) F4.6 |

---

## 1. Design Direction: "The Workshop at Night"

JARVIS lives in Sir's workshop: dark blue glass, one glowing reactor, warm task lamps. The interface is **quiet and disciplined** so that one element, **the reactor orb**, carries all the personality.

| Principle | Meaning in practice |
|---|---|
| **One reactor, everything else calm** | The orb is the only animated, glowing element at rest. Panels, text, and controls stay flat and still. |
| **Light means state** | Colour is used for meaning: cyan = Jarvis is active, amber = needs Sir's decision, red = destructive / stop, green = done. Never decorative. |
| **Show the work** | Every action Jarvis takes is visible (Activity drawer, tool cards). Trust comes from transparency. |
| **Decisions are unmistakable** | Confirmation dialogs are the most carefully designed screens in the app. |
| **Readable first** | Chat column ≤ 72 characters wide; sentence-case labels; no all-caps eyebrows. |

What we deliberately avoid: generic "SaaS card kit" layouts, gradient washes, hex-grid wallpaper, sci-fi fonts for body text, glowing borders on every panel, and monospace for non-code labels.

## 2. Colour Tokens

Dark is the default and primary theme. A light "Daylight Workshop" theme is P2.

| Token | Hex | Use |
|---|---|---|
| `--night-950` | `#060A12` | App background (blue-tinted, not neutral black) |
| `--night-900` | `#0A1120` | Main surfaces (chat column) |
| `--night-800` | `#101A2D` | Raised surfaces (panels, drawer, inputs) |
| `--night-700` | `#18243B` | Hover surfaces, selected rows |
| `--night-600` | `#22314D` | Borders, dividers |
| `--reactor-500` | `#3FD8F5` | Primary: orb core, primary buttons, focus ring, links |
| `--reactor-300` | `#93ECFF` | Orb highlights, active text on dark |
| `--reactor-glow` | `rgba(63,216,245,0.32)` | Orb glow only |
| `--lamp-400` | `#FFB54A` | Needs decision: confirmations, warnings, "awaiting" state |
| `--alarm-500` | `#FF5446` | Destructive actions, errors, kill switch, Computer-Control border |
| `--ok-400` | `#46DFA0` | Success ticks, connected status |
| `--ink-100` | `#E6EEFC` | Primary text |
| `--ink-300` | `#A7B6CE` | Secondary text |
| `--ink-500` | `#71819C` | Tertiary text (timestamps), min 14px |
| `--ink-on-reactor` | `#04202A` | Text on cyan buttons |
| `--ink-on-alarm` | `#2A0503` | Text on red buttons |

Contrast targets: `--ink-100` and `--ink-300` on `--night-900` ≥ 7:1; `--ink-500` ≥ 4.5:1 (verify with a checker; adjust lightness if needed). Status colours are always paired with an icon or text, never colour alone.

```css
/* src/renderer/src/styles/tokens.css */
:root {
  --night-950:#060A12; --night-900:#0A1120; --night-800:#101A2D; --night-700:#18243B; --night-600:#22314D;
  --reactor-500:#3FD8F5; --reactor-300:#93ECFF; --reactor-glow:rgba(63,216,245,.32);
  --lamp-400:#FFB54A; --alarm-500:#FF5446; --ok-400:#46DFA0;
  --ink-100:#E6EEFC; --ink-300:#A7B6CE; --ink-500:#71819C; --ink-on-reactor:#04202A; --ink-on-alarm:#2A0503;

  --font-display:"Chakra Petch", "Segoe UI", sans-serif;
  --font-body:"IBM Plex Sans", "Segoe UI", sans-serif;
  --font-code:"JetBrains Mono", Consolas, monospace;

  --space-1:4px; --space-2:8px; --space-3:12px; --space-4:16px; --space-5:24px; --space-6:32px; --space-7:48px; --space-8:64px;
  --radius-sm:6px; --radius-md:10px; --radius-pill:999px;
  --dur-fast:120ms; --dur-base:200ms; --dur-slow:320ms;
  --ease-standard:cubic-bezier(.2,.8,.2,1); --ease-exit:cubic-bezier(.4,0,1,1);
}
```

Map tokens into Tailwind's theme (`theme.extend.colors.night[900] = 'var(--night-900)'`, etc.). **No raw hex values in components**; lint rule in [Code-style](Code-style.md) §6.

## 3. Typography

| Role | Family | Why |
|---|---|---|
| Display (window title, orb status line, section headings, onboarding) | **Chakra Petch** (600) | Squared, engineered letterforms: a workshop/instrument feel without sci-fi gimmickry |
| Body & UI (chat, settings, dialogs) | **IBM Plex Sans** (400/500/600) | Engineered humanist sans; excellent readability at small sizes |
| Code only (code blocks, PowerShell previews, file paths in dialogs) | **JetBrains Mono** (400) | Clear distinction of code from prose |

All three are SIL Open Font License; **bundle the font files locally** in `resources/fonts/` (the app works offline; no CDN).

Type scale (1.25 ratio, base 15px for dense desktop UI):

| Token | Size / line-height | Use |
|---|---|---|
| `text-xs` | 12 / 16 | Badges, keyboard hints (Plex Sans 500) |
| `text-sm` | 13 / 18 | Meta, timestamps, tool card details |
| `text-base` | 15 / 24 | Chat body, form text |
| `text-lg` | 19 / 28 | Dialog titles, panel headings |
| `text-xl` | 24 / 32 | Empty-state greeting (Chakra Petch) |
| `text-2xl` | 30 / 36 | Onboarding headings (Chakra Petch) |

Rules: sentence case everywhere; no letter-spaced all-caps labels; chat line length ≤ 72ch; numbers in tables use `font-variant-numeric: tabular-nums`.

## 4. Layout

### 4.1 Main window (default 1100 × 760, min 720 × 520)

```text
┌──────┬─────────────────────────────────────────────┬──────────────────┐
│ Rail │  Chat column (max 72ch, centred)            │ Activity drawer  │
│      │                                             │ (collapsible,    │
│ 💬   │   ◉  orb + status line (top, compact)       │  320px)          │
│ 🧠   │                                             │                  │
│ ⚡   │   Sir:  Open VS Code and Chrome             │ ✓ open_app  VS…  │
│ 🔌   │   Jarvis: Both are open, sir.               │ ✓ open_app  Chr… │
│ ⚙️   │     [tool card] [tool card]                 │                  │
│      │                                             │                  │
│      │  ┌───────────────────────────────────────┐  │                  │
│      │  │ Message Jarvis…              🎙  📎  ⏎ │  │                  │
│      │  └───────────────────────────────────────┘  │                  │
├──────┴─────────────────────────────────────────────┴──────────────────┤
│ Status bar: Voice: wake word · Sonnet 5.5 · Today $0.42 / $2 · ● Online│
└───────────────────────────────────────────────────────────────────────┘
```

Rail destinations: Chat, Memory, Activity (full log), Connections (MCP), Settings. Icons always have tooltips and accessible names.

### 4.2 Empty state (new conversation)

The orb is large (160px) and centred with one line beneath it: "Good evening, sir. What shall we work on?" plus three suggestion chips drawn from recent routines (e.g., "Start work mode"). When the first message is sent, the orb animates to its compact 40px position at the top of the chat column. This is the app's **single orchestrated motion moment**.

### 4.3 Mini mode (P1)

Frameless, always-on-top, 112 × 112 window with the orb only; click → expand main window; drag to move; shows a 2-line caption bubble while speaking.

### 4.4 Computer-Control overlay

Click-through, transparent, full-screen window with a 4px `--alarm-500` border and a top-centre pill: "Jarvis is controlling your PC · Stop (Ctrl+Alt+Shift+X)". The pill is the only clickable region. Excluded from screenshots (`setContentProtection(true)`).

## 5. Components

### 5.1 Orb (`components/jarvis/Orb.tsx`) — the signature element

Implementation: SVG + CSS/Framer Motion (no WebGL in v1). Concentric rings around a core; audio level (`voice:level`) drives core scale while listening.

| State | Visual | Motion |
|---|---|---|
| `IDLE` | Core `--reactor-500` at 60% opacity, soft glow | Slow breathing (4 s opacity 0.6↔0.8) |
| `LISTENING` | Core full brightness, outer ring visible | Core scale follows mic RMS (0.9–1.15), ring pulses |
| `THINKING` | Inner ring segments | Ring rotates 1.2 s/turn |
| `ACTING` | Segmented ring with progress ticks | Ticks advance per tool call |
| `AWAITING_CONFIRMATION` | Core shifts to `--lamp-400` | Gentle 1 s pulse |
| `SPEAKING` | Core cyan, waveform ring | Ring amplitude follows TTS output level |
| `ERROR` | Core `--alarm-500`, ring dimmed | Single shake (200 ms) then static |
| `SLEEP` / voice off | Core `--ink-500` outline only | None |

Props: `state: AssistantState`, `level?: number (0–1)`, `size: 'sm'(40) | 'md'(96) | 'lg'(160)`.
Accessibility: `role="img"`, `aria-label="Jarvis is {state}"`; a visually hidden `aria-live="polite"` region announces state changes (debounced). `prefers-reduced-motion`: no rotation/scale; state shown by colour + status text only.

### 5.2 Composer
- Multiline textarea (Enter to send, Shift+Enter newline), mic button (shows hotkey hint), attach button (P1), send button.
- While a turn is running, Send becomes **Stop** (cancels turn).
- Placeholder: "Message Jarvis…" ; voice-mode hint below when wake word is on: "Say 'Jarvis' or press Ctrl+Alt+Space".

### 5.3 Chat messages
| Variant | Style |
|---|---|
| Sir | Right-aligned bubble, `--night-800`, `--ink-100`, radius-md, max 80% width |
| Jarvis | Left-aligned, no bubble, full column width; Markdown rendered (GFM tables, code blocks with copy button); citations as numbered links |
| System notice | Centered, `text-sm`, `--ink-500` (e.g., "Conversation saved to Obsidian") |
| Interrupted | Jarvis text + `--ink-500` "(interrupted)" |

Streaming: text appears as it arrives with a 2px cyan caret; no per-token animation.

### 5.4 Tool call card
Compact row inside a Jarvis message and in the Activity drawer.

```text
[icon] Open Visual Studio Code            SAFE   ✓ 120 ms   ▸
```
| Status | Indicator |
|---|---|
| pending | `--ink-500` dot |
| awaiting confirmation | `--lamp-400` dot + "Waiting for you" |
| running | cyan spinner (reduced motion: static "Running") |
| success | `--ok-400` check |
| error | `--alarm-500` cross + one-line error |
| denied / blocked | `--ink-500` slash + "Declined" / "Not permitted" |

Expand (▸) shows input JSON (redacted) and output preview in `--font-code`. Tier badge colours: SAFE = neutral outline, CONFIRM = amber outline, BLOCKED = red outline.

### 5.5 Confirmation dialog (`ConfirmDialog.tsx`) — safety-critical

```text
┌──────────────────────────────────────────────────────┐
│ ⚠  Move 14 files to the Recycle Bin?                 │  ← title = exact action (text-lg)
│                                                      │
│ Jarvis wants to delete files older than 30 days      │  ← one-sentence purpose
│ from Downloads.                                      │
│                                                      │
│ ▾ Show the 14 files                                  │  ← details (paths in mono)
│                                                      │
│ ⓘ Suggested after reading github.com/...             │  ← taint banner (amber), only if tainted
│                                                      │
│           [ Cancel ]   [ Move to Recycle Bin ]       │  ← primary button named by action
└──────────────────────────────────────────────────────┘
```

| Rule | Detail |
|---|---|
| Role | `role="alertdialog"`, focus trapped, title is `aria-labelledby` |
| Button naming | Primary button repeats the action verb ("Move to Recycle Bin", "Run script", "Close Chrome"), never "OK"/"Yes" |
| Destructive | Primary button `--alarm-500`; **initial focus on Cancel**; Enter does not approve; approve via click or `Ctrl+Enter` |
| Non-destructive | Primary `--reactor-500`; initial focus on primary; Enter approves; voice "yes" approves |
| PowerShell | Full script shown in a scrollable code block with line numbers; purpose above it |
| Timeout | Auto-deny after 120 s with a visible countdown in the last 20 s |
| Queue | One dialog at a time; queued count shown ("1 of 3") |
| Window | If the main window is hidden, show it and flash the taskbar; also speak the prompt in voice mode |

### 5.6 Other components
| Component | Notes |
|---|---|
| Status bar | Voice mode, current model, today's cost vs budget (amber at 80%, red at 100%), connectivity, MCP issues count |
| Activity drawer | Live tool timeline for the current conversation; filter by status; "Open full log" |
| Toasts | Bottom-right, 4 s, max 3; errors persist until dismissed |
| Settings | Grouped forms (General, Voice, Models & budget, Files & permissions, Memory, Connections, Privacy, Hotkeys, Advanced); secrets field shows "•••• 1a2b" + Replace |
| Memory browser | Left: tree of `Memory/`; right: rendered note with "Open in Obsidian" and "Forget" (red, confirm) |
| Connections | MCP server list with status dot, tool count, trust badge, enable toggle, per-tool tier overrides |
| Onboarding | 5-step stepper (Welcome → Brain key → Vault → Voice → Safety); each step ≤ 1 screen |

## 6. Motion

| Token | Value | Use |
|---|---|---|
| `--dur-fast` | 120 ms | Hover/press feedback |
| `--dur-base` | 200 ms | Dialogs, drawers, toasts enter |
| `--dur-slow` | 320 ms | Orb resize (empty state → compact) |
| Easing | `--ease-standard` enter, `--ease-exit` leave | |

Only the orb animates without user action. Everything else animates only in response to Sir (open, expand, confirm). Respect `prefers-reduced-motion` globally (disable non-essential transitions).

## 7. Iconography & Sound

- Icons: **lucide-react**, 18px default, 1.75 stroke; always with text or `aria-label`.
- Sounds (P1, toggle in Settings, bundled locally): soft rising chime on LISTENING, lower chime on cancel, two-tone for confirmation needed. Max 300 ms each, −18 LUFS.

## 8. Writing in the Interface

| Do | Don't |
|---|---|
| "Move 14 files to the Recycle Bin?" | "Are you sure?" |
| "Couldn't reach Claude. Check your internet connection or API key in Settings → Brain." | "Oops! Something went wrong." |
| "Connections" | "MCP server configuration" |
| "Saved to Obsidian" (matches "Save to Obsidian" setting name) | Different names for the same action |
| Sentence case labels | Title Case Or ALL CAPS |

The butler persona ("sir", dry wit) appears **only in Jarvis's own messages and speech**. UI chrome (buttons, settings, errors) uses plain, neutral language.

## 9. Accessibility Checklist

- [ ] Full keyboard navigation; visible 2px `--reactor-500` focus ring with 2px offset.
- [ ] All interactive elements ≥ 32×32px hit area.
- [ ] Final assistant messages announced via `aria-live="polite"` (not per token).
- [ ] Confirmation dialog is `alertdialog`, traps focus, restores focus on close.
- [ ] Colour never the only signal (icons/text accompany status colours).
- [ ] Reduced-motion mode verified.
- [ ] Text scales with Windows display scaling (use rem units; test at 100%, 125%, 150%).
