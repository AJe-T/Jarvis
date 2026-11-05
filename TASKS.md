# Pending tasks

Everything still to do or still being thought about, in one place. When Sir asks for the pending
tasks ("what's pending", "pending tasks"), Claude reads this file and lists it.

How to keep it:
- Every new idea, plan point or deferred item goes here in the same turn it comes up.
- When an item ships, delete it here (the changes log and `docs/BIBLE.md` keep the history).
- Size: **S** < 1 h · **M** 1–3 h · **L** half a day or more (tests and BIBLE update included).

Last updated: 2026-11-06 (after v2.63.0).

## 1. Core module

All planned Core items shipped (v2.62, v2.63). Still open:

| # | Task | Size | Notes |
|---|---|---|---|
| 3d-eval | Run `npm run evals` to check Claude really opens tool turns with a fitting lead-in (the 2.63 prompt) | S | Costs tokens: Sir says when. |
| W-root | Find why Deepgram closes about 1 s after opening | S | 2.63 logs the real reason (`close 1011: …`) and reconnects quietly. After a day of use, read the reason in the log and fix the cause. |

Not planned: chat branching and message reactions (complexity for little gain with one user).

## 2. Modules still to review, one by one

Core is done (v2.63.0). For each module: Sir lists the bugs, Claude finds the causes and proposes a
plan with sizes, Sir picks what to do now and what goes back into this file.

`activity` · `apps` · `bible` · `brain` · `calendar` · `compare` · `computer` · `connections` ·
`copilot` · `forge` · `memory` · `mini` · `npcs` · `onboarding` · `passwords` · `router` ·
`settings` · `spaces` · `tasks` · `voice` (settings side)

## 3. Needs a live test by Sir (built, but never run for real)

| What | How to check |
|---|---|
| W1: tune the wake word to your voice | Settings → Voice → **Your voice (Voice Match)**, shown with engine v2 since 2.63: download the voice model once, then record "Hey Jarvis" 5 times. |
| v2.62–2.63 voice with the real mic and speakers | Say "Hey Jarvis" (beep first, then "Yes, sir?"); just "Jarvis" (should wake, maybe through the second opinion); "can you hear me" (no mute, no filler); a slow question (Jarvis's own lead-in, or a fitting working line); talk past 30 s (not cut off); press Esc mid-sentence (the words stay in the box). |
| v2.62–2.63 chat | Paste a screenshot (Ctrl+V); hover a reply (Copy, Read aloud, its time); use a follow-up chip; pin and rename a chat. |
| Speech-to-text drops and wake second opinion | After a day: `Select-String -Path "$env:APPDATA\Jarvis\logs\jarvis.1.log" -Pattern "Deepgram closed","reconnecting","second opinion"` shows the close reasons, quiet reconnects and second-opinion wakes. |
| No more surprise mutes | `Select-String -Path "$env:APPDATA\Jarvis\logs\jarvis.1.log" -Pattern '"tool":"mute","by":"laya"'` shows nothing new. |
| agent-desktop (notifications, app control) | The install was denied, so it has never run. Check the `notificationsOf` / `matchesOf` envelope shapes. |
| Meeting recorder | Record a real meeting; check the loopback (system sound) track. |
| Deepgram keyterms, colibri model picker | Never run live. |
| OpenAI / Gemini realtime voice | 14 real-key voice tests are skipped; never run with live keys. |

## 4. Blocked or waiting on something

| What | Waiting on |
|---|---|
| Integrations step 6: OpenCode as an answer brain | `opencode auth login` (installed, headless works). It exits 0 on errors, so read its JSON events. |
| Gemini CLI | Refuses personal accounts. |
| Copilot CLI | Only the VS Code shim is installed. |
| Bedrock, Vertex, Azure providers | No cloud accounts. Ask Sir before building them. |

## 5. Ideas parked (not planned yet)

- (empty: new ideas go here until Sir decides on them)
