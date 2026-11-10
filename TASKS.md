# Pending tasks

Everything still to do or still being thought about, in one place. When Sir asks for the pending
tasks ("what's pending", "pending tasks"), Claude reads this file and lists it.

How to keep it:
- Every new idea, plan point or deferred item goes here in the same turn it comes up.
- When an item ships, delete it here (the changes log and `docs/BIBLE.md` keep the history).
- Size: **S** < 1 h · **M** 1–3 h · **L** half a day or more (tests and BIBLE update included).

Last updated: 2026-11-10 (after v2.64.0).

## 1. Core module

All planned Core items shipped (v2.62, v2.63). Still open:

| # | Task | Size | Notes |
|---|---|---|---|
| 3d-eval | Run `npm run evals` to check Claude really opens tool turns with a fitting lead-in (the 2.63 prompt) | S | Costs tokens: Sir says when. |
| W-root | Find why Deepgram closes about 1 s after opening | S | 2026-11-10 log read: no real Deepgram drop (`close 1011`) in the 2.63 logs (only ~40 min of use). All 4 logged "drops" were Jarvis's own abort (`close 1000: aborted`), now silent (2.63.1). Re-check after a day of 2.63.1 use. |
| W-short | Listening ends ~1–1.3 s after it opens, nothing heard | S | Seen 4 times in the 2026-11-06 log (stt clips 0.9–1.3 s). Since 2.64 every ended listen logs `listening cancelled` with a reason and how long it lasted. Next: after a day of use, read the reasons: `Select-String -Path "$env:APPDATAJarvislogsjarvis.1.log" -Pattern "listening cancelled"`. |

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
| v2.64 search, chips and file search | Press Ctrl+K and type a task, a chat word, "microphone"; open a memory note from it. Under a reply use **Add to tasks** and **Save to Space**. Ask "find the file that mentions <a word>" and check the time it takes on your real Documents folder. |
| W1: tune the wake word to your voice | Settings → Voice → **Your voice (Voice Match)**, shown with engine v2 since 2.63: download the voice model once, then record "Hey Jarvis" 5 times. |
| v2.62–2.63 voice with the real mic and speakers | Say "Hey Jarvis" (beep first, then "Yes, sir?"); just "Jarvis" (should wake, maybe through the second opinion); "can you hear me" (no mute, no filler); a slow question (Jarvis's own lead-in, or a fitting working line); talk past 30 s (not cut off); press Esc mid-sentence (the words stay in the box). |
| v2.62–2.63 chat | Paste a screenshot (Ctrl+V); hover a reply (Copy, Read aloud, its time); use a follow-up chip; pin and rename a chat. |
| Speech-to-text drops and wake second opinion | After a day: `Select-String -Path "$env:APPDATA\Jarvis\logs\jarvis.1.log" -Pattern "Deepgram closed","reconnecting","second opinion"` shows the close reasons, quiet reconnects and second-opinion wakes. |
| No more surprise mutes | 2026-11-10: none since 2.63 (22 before it), but only ~40 min of 2.63 use. Re-check after a full day: `Select-String -Path "$env:APPDATA\Jarvis\logs\jarvis.1.log" -Pattern '"tool":"mute","by":"laya"'`. |
| agent-desktop (notifications, app control) | The install was denied, so it has never run. Check the `notificationsOf` / `matchesOf` envelope shapes. |
| Meeting recorder | Record a real meeting; check the loopback (system sound) track. |
| Deepgram keyterms, colibri model picker | Never run live. |
| OpenAI / Gemini realtime voice | 14 real-key voice tests are skipped; never run with live keys. |

## 4. Blocked or waiting on something

| What | Waiting on |
|---|---|
| Integrations step 6: OpenCode as an answer brain | **Unblocked (2026-11-10):** `opencode auth list` shows an OpenRouter credential. Ready to build (L) when Sir says. It exits 0 on errors, so read its JSON events. |
| Gemini CLI | Refuses personal accounts. |
| Copilot CLI | Only the VS Code shim is installed. |
| Bedrock, Vertex, Azure providers | No cloud accounts. Ask Sir before building them. |

## 5. Ideas parked (not planned yet)

Proposed 2026-11-10 from a survey of the modules and of other assistants. Sir has not picked any yet.

| Idea | What it gives | Size | Notes |
|---|---|---|---|
| Event triggers for automations | Act when something happens: meeting in 10 min, task overdue, new file in a folder | L | `src/shared/schedule.ts` has only time and startup types. Security pass needed. |
| "Send to" on older replies | The 2.64 chips (Add to tasks, Add to calendar, Save to Space) sit under the latest reply only | S | Add a hover menu on every reply if Sir wants it. |
| Action journal + "undo that" | Reverse Jarvis's file, task and calendar changes | L | Touches `tools/executor.ts`. |
| Tests for untested modules | `copilot`, `inference`, `npcs`, `scheduler`, `settings`, `skills`, `spaces`, `ipc` | M per batch | No visible change. |
| Split oversized files | `voice-controller.ts`, `ipc-contract.ts`, `voice-system.ts`, `services.ts` are over 800 lines | L | No visible change. |
| Voice edit of selected text in any app | Select text, hold a hotkey, say "make this formal": the selection is replaced | M | Idea from Wispr Flow's command mode. Reuses dictation paste and the copilot rewrite. |
| Clipboard history | Search and re-paste past copies; "paste what I copied an hour ago" | M | Idea from Raycast. Must skip copies made by Passwords. |
| Day timeline | Log the foreground app and window title; "where did my day go" and data for briefings | M | Titles only, no screen content. Local only. |
| Index for search inside files | `search_in_files` (2.64) reads files one by one and stops after 15 s | L | Build an index only if Sir searches big folders often. |
| Palette: open a calendar event on its day | Ctrl+K opens the Calendar, not the event's date | S | |
| Screen memory | OCR text of what was on screen, searchable: "the error I saw at 3 pm" | L | Idea from Screenpipe. Needs app exclusions, pause, retention, and a Security.md section. |
| Meeting prep | Before a calendar event, surface memory notes about the people and topic | M | Needs the event triggers above. |
| Teach by showing | Record steps Sir does once, replay them as a skill | L | Riskiest; build last, if at all. |
