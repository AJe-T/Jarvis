# Pending tasks

Everything still to do or still being thought about, in one place. When Sir asks for the pending
tasks ("what's pending", "pending tasks"), Claude reads this file and lists it.

How to keep it:
- Every new idea, plan point or deferred item goes here in the same turn it comes up.
- When an item ships, delete it here (the changes log and `docs/BIBLE.md` keep the history).
- Size: **S** < 1 h · **M** 1–3 h · **L** half a day or more (tests and BIBLE update included).

Last updated: 2026-11-06 (after v2.62.0).

## 1. Core module: next batch (planned as v2.63)

| # | Task | Size | Notes |
|---|---|---|---|
| 3d | Claude opens tool turns with his own lead-in ("Let me check your calendar…"), replacing the canned working line for that turn | M–L | Prompt change plus skipping the filler once Claude's first sentence is already out. Needs `npm run evals` (costs tokens: ask Sir first). The 1.2 s working line (v2.62) stays as the fallback, since the logs show Claude's first word can take 4–16 s. |
| 4.3 | Rename and pin chats | M | Titles already exist and are made automatically (`orchestrator.ts` oneShot). Needs a `pinned` column (migration), `conversations:rename` / `conversations:pin` IPC, and the list UI. |
| 4.4 | "Speak this" button on any reply | M | IPC to the main-process TTS; must stop on barge-in or the stop button. |
| 4.5 | Follow-up suggestion chips under replies ("Do it", "More detail", "Save to memory") | M–L | Start with fixed chips. Chips Claude writes per reply cost tokens and need prompt and parsing work. |
| 4.8 | Response time per message (first word, total) | M | Migration plus timing captured in the orchestrator; shown small under each reply. Helps catch slow providers (one turn in the log took 26 s). |

Not planned: chat branching and message reactions (complexity for little gain with one user).

## 2. Modules still to review, one by one

Core is done (v2.62.0). For each module: Sir lists the bugs, Claude finds the causes and proposes a
plan with sizes, Sir picks what to do now and what goes back into this file.

`activity` · `apps` · `bible` · `brain` · `calendar` · `compare` · `computer` · `connections` ·
`copilot` · `forge` · `memory` · `mini` · `npcs` · `onboarding` · `passwords` · `router` ·
`settings` · `spaces` · `tasks` · `voice` (settings side)

## 3. Needs a live test by Sir (built, but never run for real)

| What | How to check |
|---|---|
| v2.62.0 voice changes with the real mic and speakers | Say "Hey Jarvis" (beep first, then "Yes, sir?"); "can you hear me" (no mute, no filler); a slow question (a fitting working line); "what is the time right now" (instant answer); paste a screenshot into the chat box. |
| No more surprise mutes | After a day of use: `Select-String -Path "$env:APPDATA\Jarvis\logs\jarvis.1.log" -Pattern '"tool":"mute","by":"laya"'` shows nothing new. If mishearing remains, compare the WAVs in `%APPDATA%\Jarvis\debug-audio\` with what Whisper wrote. |
| agent-desktop (notifications, app control) | The install was denied, so it has never run. Check the `notificationsOf` / `matchesOf` envelope shapes. |
| Meeting recorder | Record a real meeting; check the loopback (system sound) track. |
| Deepgram keyterms, colibri model picker | Never run live. |
| OpenAI / Gemini realtime voice | 14 real-key voice tests are skipped; never run with live keys. |
| Personal wake word | Record "Hey Jarvis" in Settings → Voice → Your voice for the ADR-043 fix to take effect. |

## 4. Blocked or waiting on something

| What | Waiting on |
|---|---|
| Integrations step 6: OpenCode as an answer brain | `opencode auth login` (installed, headless works). It exits 0 on errors, so read its JSON events. |
| Gemini CLI | Refuses personal accounts. |
| Copilot CLI | Only the VS Code shim is installed. |
| Bedrock, Vertex, Azure providers | No cloud accounts. Ask Sir before building them. |

## 5. Ideas parked (not planned yet)

- (empty: new ideas go here until Sir decides on them)
