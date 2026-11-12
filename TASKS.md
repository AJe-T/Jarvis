# Pending tasks

Everything still to do or still being thought about, in one place. When Sir asks for the pending
tasks ("what's pending", "pending tasks"), Claude reads this file and lists it.

How to keep it:
- Every new idea, plan point or deferred item goes here in the same turn it comes up.
- When an item ships, delete it here (the changes log and `docs/BIBLE.md` keep the history).
- Size: **S** < 1 h · **M** 1–3 h · **L** half a day or more (tests and BIBLE update included).

Last updated: 2026-11-11 (after v2.73.0).

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
| v2.73 teach by showing | Say "watch me", approve, open Notepad and the volume mixer, say "done": Jarvis lists what he saw and offers a routine; approve the steps, then say its trigger phrase. The watcher script was run for 3 seconds on this PC and reported the real window and focused control; the full flow has only run with a fake watcher and a fake model. See how well the steps a real model proposes replay. |
| v2.72 screen memory | Settings → Privacy → "Keep a screen memory" on. Read a web page for two minutes, then Ctrl+K and type a few words from it: a **Screen** result appears; Enter, paste. Open an InPrivate window and Jarvis's Passwords screen for a few minutes: neither may ever be found. Check Task Manager for the processor cost once a minute. The capture loop and Windows OCR were tested with fakes only. |
| v2.71 OpenCode brain | It has never answered on this PC. In a terminal: `opencode run "say OK"`. If it says "Missing Authentication header", run `opencode auth login` again (the stored OpenRouter key is refused), or `npm i -g opencode-ai@latest` for the free models (they need 1.18+). Then Settings → Brain → Your AI subscriptions → OpenCode → Test, and give an NPC the OpenCode brain. |
| v2.70 undo | Ask Jarvis to create a text file on the Desktop, then say "undo that": after the confirmation it is in the Recycle Bin. Ask him to add a task, then Ctrl+K → "Undo: Add task …". Ask him to move a file, edit nothing, undo: it is back. Only tested with a fake Recycle Bin and a fake model. |
| v2.69 edit by voice | Settings → Dictation → Edit by voice → on. In Notepad type a rough sentence, select it, press Ctrl+Alt+E, say "make this formal", pause: the sentence is replaced. Try Word and a browser text box too, and press the hotkey with nothing selected (a notice, nothing pasted). Never run with a real mic, a real app or a real model: check that Ctrl+C reaches the app (keys released in time) and that your clipboard is as before. |
| v2.68 meeting prep | Settings → Automations → Templates → **Meeting prep** → Use this → Save. Add a calendar event 8 minutes from now with a person Jarvis knows from memory: a spoken prep should come within a minute. Judge whether the five points are useful or too long. |
| v2.67 event automations | Settings → Automations → new: "When a file appears" in Downloads, prompt "Tell me what this file is". Save, wait a minute, download a file: within about a minute a run starts and names it. Then one "Before a calendar event" (10 min) with an event 8 minutes from now, and one "When a task is overdue" with a task due a minute ago. Only tested with a fake model and a fake folder so far. |
| v2.66 day timeline | Settings → Privacy → turn on "Keep a day timeline". Work for ten minutes in two apps, then Settings → Activity → My day: both apps listed with about the right minutes. Open an InPrivate window: the browser is counted, the title is not shown. Ask "where did my day go". |
| v2.65 clipboard history | Settings → Privacy → turn on "Keep a clipboard history". Copy three things, press Ctrl+K, type "clipboard": all three listed; Enter on one, then paste. Copy a password from Jarvis's Passwords (and from your own password manager if you use one): it must NOT appear. If nothing is ever listed: `Select-String -Path "$env:APPDATA\Jarvis\logs\jarvis.1.log" -Pattern "clipboard privacy check failed"`. Claude could not reach the real clipboard from its sandbox, so the private-mark check has only been tested with fakes. |
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
| Gemini CLI | Refuses personal accounts. |
| Copilot CLI | Only the VS Code shim is installed. |
| Bedrock, Vertex, Azure providers | No cloud accounts. Ask Sir before building them. |

## 5. Ideas parked (not planned yet)

Proposed 2026-11-10 from a survey of the modules and of other assistants. Sir has not picked any yet.

| Idea | What it gives | Size | Notes |
|---|---|---|---|
| "Send to" on older replies | The 2.64 chips (Add to tasks, Add to calendar, Save to Space) sit under the latest reply only | S | Add a hover menu on every reply if Sir wants it. |
| Tests for the on-device model host | `src/main/inference/client.ts` talks to an Electron utility process; its remote path (31% of the module covered) has no test | M | Needs a fake utility process. The IPC handlers got tests in 2.74 (they were at 2.5%); the other "untested" modules were already 78–91% covered by the integration tests. |
| Split oversized files | `voice-controller.ts` (1,528 lines), `voice-system.ts` (1,104) and `services.ts` (998) are over 800 lines; `ipc-contract.ts` was split in 2.74 | L | No visible change. The voice files share closure state, so a split needs a design, not a cut. |
| Index for search inside files | `search_in_files` (2.64) reads files one by one and stops after 15 s | L | Build an index only if Sir searches big folders often. |
| Palette: open a calendar event on its day | Ctrl+K opens the Calendar, not the event's date | S | |
