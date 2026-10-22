# Product Requirements Document (PRD) — JARVIS Desktop

| Field | Value |
|---|---|
| Product | JARVIS — personal AI operating layer for Windows |
| Owner | Sir (sole user, developer, and product owner) |
| Status | v1.0 — Approved for build |
| Last updated | 2026-10-06 |
| Related docs | [TRD](TRD.md) · [Architecture](Architecture.md) · [Implementation](Implementation.md) · [Security](Security.md) |

---

## 1. Problem Statement

Sir's day is spread across a dozen desktop apps, browser tabs, and SaaS tools (VS Code, Chrome, GitHub, Notion, Vercel, email). Every task, from "open my work setup" to "what did I decide about the booking page last week?", needs manual clicking, context-switching, and remembering. Current assistants either chat without acting (ChatGPT, Claude.ai) or act without remembering (scripts, macros). Without solving this, Sir keeps losing time to repetitive navigation and keeps re-explaining context.

## 2. Vision

> A voice-first AI assistant that lives on Sir's Windows PC, **controls the desktop and apps**, **connects to his tools**, **talks back**, and **remembers everything** in a human-readable Obsidian "brain" that Sir owns and can edit.

The experience target is "Iron Man's JARVIS", but with safety rails: calm, competent, slightly witty, and never doing anything destructive without asking.

## 3. Target User

| Persona | Description |
|---|---|
| **Sir (primary and only user)** | Frontend developer (React, Next.js, Git) on Windows. Comfortable running commands, new to AI agents, Electron, and audio. Wants a personal assistant he can extend "with his imagination". |

v1 is single-user and local-only. There are no accounts, no cloud backend, and no multi-tenant concerns.

## 4. Goals (v1)

| # | Goal | Measured by |
|---|---|---|
| G1 | Hands-free control of everyday PC tasks | ≥ 90% success on the 40-command golden eval set ([Testing](Testing.md) §7) |
| G2 | Natural voice conversation | Wake word → listening in < 300 ms; end of speech → first spoken word in < 2.5 s (p50) for non-tool replies |
| G3 | Persistent, inspectable memory | 100% of conversations logged to the Obsidian vault; recall of stored facts ≥ 90% in memory evals |
| G4 | Connect apps without custom code | ≥ 5 MCP connectors working (browser, GitHub, Notion, filesystem, one more of Sir's choice) |
| G5 | Zero unapproved destructive actions | 0 CONFIRM/BLOCKED-tier actions executed without approval across the test suite and 30 days of use |

## 5. Non-Goals (v1)

| Non-goal | Why it's out of scope |
|---|---|
| macOS / Linux support | Windows-only keeps automation code simple; architecture keeps OS code behind interfaces for later |
| Multi-user, accounts, cloud sync | Single-user personal tool; adds auth and backend complexity |
| Fully offline operation | The brain is the Claude API; offline STT/LLM are P2 explorations |
| Playing games or real-time control | Computer-use latency is seconds per action, which is unsuitable for this |
| Autonomous financial actions (payments, trades, transfers) | Hard-blocked for safety ([Security](Security.md) §4) |
| Mobile app / remote control from phone | Requires exposing a network surface; revisit after security review |
| Selling or distributing the app | Personal use; "JARVIS" is a Marvel trademark, so rename before any distribution |

## 6. Feature Areas & Requirements

Priority key: **P0** = must ship in v1 · **P1** = fast follow · **P2** = future (design for it, don't build it).

### F1 — Conversation Core (Chat + Brain)

| ID | Pri | Requirement | Acceptance criteria |
|---|---|---|---|
| F1.1 | P0 | Desktop chat window with streaming replies from Claude | Given a typed message, tokens stream into the UI within 1.5 s (p50) |
| F1.2 | P0 | API keys stored encrypted (Electron `safeStorage`), never in renderer or logs | Key appears in no log, IPC payload, or vault file (automated grep test) |
| F1.3 | P0 | Model router: Sonnet (default), Opus (deep), Haiku (background) | Model per request visible in Activity panel; switchable in Settings |
| F1.4 | P0 | Conversation history persisted in SQLite | Restarting the app shows previous conversations |
| F1.5 | P0 | Cost guard: daily/monthly budget with hard stop | When the budget is exceeded, requests are refused with a clear message |
| F1.6 | P1 | Web search via Claude's server-side web search tool | "What's the weather in Hyderabad" returns a sourced answer |
| F1.7 | P1 | Image/file drop into chat (screenshots, PDFs) | Dropped PNG is analysed by Claude vision |
| F1.8 | P2 | Local LLM fallback (Ollama) when offline | — |

### F2 — Desktop Control ("Hands")

| ID | Pri | Requirement | Acceptance criteria |
|---|---|---|---|
| F2.1 | P0 | Open apps by natural name ("open VS Code", "launch Spotify") incl. Store apps | Fuzzy match over Start Menu + `Get-StartApps`; ≥ 95% on top-30 installed apps |
| F2.2 | P0 | System controls: volume, mute, media keys, brightness, lock, sleep, battery/CPU/RAM info | Each control has a unit test + manual QA check |
| F2.3 | P0 | Window management: list, focus, minimise, maximise, close (close = CONFIRM) | "Switch to Chrome" focuses Chrome |
| F2.4 | P0 | File operations in allowed folders: search, read, create, move, rename, delete-to-Recycle-Bin | Writes/moves/deletes always prompt; delete never permanent |
| F2.5 | P0 | Permission tiers SAFE / CONFIRM / BLOCKED enforced in code (not by the LLM) | Security test suite passes ([Testing](Testing.md) §6) |
| F2.6 | P0 | Guarded PowerShell tool (CONFIRM every time, blocklist enforced) | Blocked patterns rejected before execution |
| F2.7 | P1 | Full desktop control via Claude computer-use toolset (screenshots + mouse/keyboard) | Completes 7/10 scripted GUI tasks; red "Computer Control" overlay + Stop button always visible |
| F2.8 | P1 | Clipboard read/write, notifications, timers, reminders | Reminder fires at due time even if window is hidden |
| F2.9 | P2 | Accessibility-tree UI automation (Windows-MCP or Terminator) for faster, cheaper GUI control | — |

### F3 — App & Browser Connections

| ID | Pri | Requirement | Acceptance criteria |
|---|---|---|---|
| F3.1 | P0 | MCP client manager: add/remove/enable stdio + HTTP servers from Settings | Server status (connected / error / tools count) visible |
| F3.2 | P0 | Browser control via Playwright MCP (`@playwright/mcp`) with a dedicated Jarvis browser profile | "Open github.com and show my notifications" works |
| F3.3 | P0 | Per-server trust level and default tier; MCP tools default to CONFIRM unless whitelisted as read-only | New server's write tools prompt before running |
| F3.4 | P1 | Starter connectors: GitHub, Notion, Filesystem (scoped), Google Calendar/Gmail (vetted server) | Each has a smoke test |
| F3.5 | P2 | OAuth flow for remote MCP servers inside the app | — |
| F3.6 | P2 | Claude browser-use toolset executor as an alternative to Playwright MCP | — |

### F4 — Voice Agent

| ID | Pri | Requirement | Acceptance criteria |
|---|---|---|---|
| F4.1 | P0 | Press-to-talk global hotkey (default `Ctrl+Alt+Space`: press once to start listening; listening ends automatically at end of speech; press again to cancel). Electron `globalShortcut` has no key-up event, so true hold-to-talk would need a native keyboard hook (P2) | Works while app is minimised |
| F4.2 | P0 | Wake word "Jarvis" (Porcupine built-in keyword, on-device) | False accepts < 1 per 8 h of normal room audio |
| F4.3 | P0 | Streaming speech-to-text with automatic end-of-speech detection | Transcript appears live; finalises within 800 ms of silence |
| F4.4 | P0 | Text-to-speech with a British male voice (default Edge TTS `en-GB-RyanNeural`), streamed sentence by sentence | First audio within 1 s of first sentence completing |
| F4.5 | P0 | Barge-in: wake word or hotkey interrupts speech immediately | TTS stops within 200 ms |
| F4.6 | P0 | Animated "arc-reactor" orb reflecting state (idle/listening/thinking/acting/speaking/error) | State changes visible within one frame of event |
| F4.7 | P1 | Spoken-summary mode: Jarvis speaks a 1–2 sentence summary, details shown on screen | Long answers don't get read aloud in full |
| F4.8 | P1 | Offline TTS fallback (Windows SAPI) when the network TTS fails | Auto-fallback without user action |
| F4.9 | P2 | Local Whisper STT; custom wake words; voice ID | — |

### F5 — Memory & Obsidian Brain

| ID | Pri | Requirement | Acceptance criteria |
|---|---|---|---|
| F5.1 | P0 | Obsidian vault ("JarvisBrain") as the human-readable long-term memory | Files appear live in Obsidian; edits by Sir are re-indexed within 5 s |
| F5.2 | P0 | Every conversation logged to `Conversations/YYYY/MM/YYYY-MM-DD.md` (redacted) | Daily note exists for each active day |
| F5.3 | P0 | Claude **memory tool** (`memory_20250818`) mapped to the vault's `Memory/` folder | Claude can view/create/edit memory files; path traversal impossible |
| F5.4 | P0 | Automatic memory curation after each conversation (Haiku): extract durable facts, dedupe, update notes | "My manager's name is X" → stored in `Memory/People/` without being asked |
| F5.5 | P0 | Retrieval: relevant memories injected into context each turn (core profile + FTS5 search) | "What's my manager's name?" answered correctly in a new conversation |
| F5.6 | P0 | Secret redaction before anything is written to vault or logs | Test strings (API keys, card numbers, OTPs) never reach disk |
| F5.7 | P1 | Memory UI: browse, search, edit, delete memories; "forget X" voice command | Deleted memory is gone from vault + index |
| F5.8 | P1 | Routines stored as notes (`Routines/Work Mode.md`) and runnable by voice | "Start work mode" runs the routine's steps |
| F5.9 | P2 | Semantic (vector) search with local embeddings | — |

### F6 — Shell, Settings & Ops

| ID | Pri | Requirement | Acceptance criteria |
|---|---|---|---|
| F6.1 | P0 | First-run onboarding: keys, vault path, mic test, permission explainer | New install reaches a working chat in < 5 minutes |
| F6.2 | P0 | Activity panel: every tool call with tier, decision, duration, result | Matches audit log 1:1 |
| F6.3 | P0 | Global kill switch hotkey (`Ctrl+Alt+Shift+X`) stops all agent activity, TTS, and computer control | Verified in E2E test |
| F6.4 | P1 | System tray, start with Windows, mini orb overlay mode | — |
| F6.5 | P1 | Windows installer (NSIS via electron-builder) | Installs and runs on a clean Windows 11 VM |
| F6.6 | P2 | Auto-update, plugin/skill marketplace | — |

## 7. User Stories (priority order)

1. As Sir, I want to say "Jarvis, open my work setup" so that VS Code, Chrome, and Notion open without me touching the mouse.
2. As Sir, I want Jarvis to ask "Shall I delete these 14 files, sir?" before anything destructive so that a misheard command never costs me data.
3. As Sir, I want to ask "what did we decide about the rate calculator last Tuesday?" so that I don't have to search old chats.
4. As Sir, I want every conversation saved in Obsidian so that I can read, edit, and link Jarvis's memories myself.
5. As Sir, I want to tell Jarvis "remember that I deploy on Vercel" once so that he never asks again.
6. As Sir, I want to say "forget my old address" so that wrong or private memories are removed completely.
7. As Sir, I want Jarvis to open GitHub in the browser and summarise my notifications so that I can triage by voice.
8. As Sir, I want to interrupt Jarvis mid-sentence so that long answers don't trap me.
9. As Sir, I want a daily cost limit so that a runaway loop can't drain my API credit.
10. As Sir, I want a panic hotkey so that I can stop all automation instantly.
11. As Sir, I want to see exactly which tools ran and why so that I can trust and debug Jarvis.
12. As Sir, I want to add a new app connector from Settings so that I can extend Jarvis without editing code.

**Edge-case stories:** mic unplugged (clear error + text fallback); API key invalid or expired (onboarding re-prompt); vault folder deleted (recreate structure + warn); network loss mid-reply (graceful message, retry); two commands spoken quickly (queue, don't overlap).

## 8. Prior Art — GitHub Research & What We Adopt

> **Licensing rule:** We **adopt features and design ideas, not code**. Several top projects are AGPL/GPL (copy-pasting their code would force our whole app under that licence). MIT/Apache code may be reused only with its licence notice preserved and a `THIRD_PARTY_NOTICES.md` entry ([Code-style](Code-style.md) §10). Always re-check each repo's LICENSE file before reuse, because licences change (Open Interpreter moved from MIT to AGPL-3.0).

| Project | What it is | License (verify) | Feature(s) we adopt | How we adopt it |
|---|---|---|---|---|
| **microsoft/UFO** | UI-focused multi-agent framework for Windows; host agent + app agent, UI Automation, step logs | MIT | Two-level agents (orchestrator → desktop operator); per-task action logs for replay/debug | Desktop Operator sub-agent ([Agents](Agents.md) §B4); `tool_calls` table + replay view |
| **CursorTouch/Windows-MCP** | MCP server exposing Windows apps, UI elements, input, PowerShell | MIT | Accessibility-tree desktop control instead of pure screenshots | Optional P2 MCP server (Python/uv). Has usage telemetry, so disable per its README |
| **block/goose** | Open-source desktop agent (Rust + React), MCP "extensions", recipes, sessions | Apache-2.0 | Extension manager UI; per-session persistence; "recipes" = reusable workflows | MCP Settings page; Routines feature ([Database](Database.md) `routines`) |
| **microsoft/playwright-mcp** | Official Playwright MCP server; accessibility-snapshot browsing | Apache-2.0 | Browser control without vision tokens | Used directly as a bundled MCP server (P0) |
| **Open Interpreter** | LLM runs code locally with confirmation prompts | AGPL-3.0 (now) | "Ask before executing code" UX | Confirmation dialog + guarded PowerShell tool (our own code) |
| **khoj-ai/khoj** | "AI second brain" with Obsidian integration | AGPL-3.0 | Notes-as-knowledge-base, search across vault | Vault indexer + FTS5 search (our own code) |
| **mem0ai/mem0** | Memory layer: extract → dedupe → update → retrieve | Apache-2.0 | Add/update/delete memory decision loop; multi-level memory (user/session/agent) | Memory Curator sub-agent with ADD/UPDATE/DELETE/NOOP ops |
| **Picovoice/porcupine** | On-device wake word engine with a built-in "Jarvis" keyword | Apache-2.0 (built-ins) | Wake word | `@picovoice/porcupine-node` + `@picovoice/pvrecorder-node` |
| **abdushsk/jarvis**, **AbyssalCoder/Open-Jarvis**, **sukeesh/Jarvis** | Hobby Jarvis assistants: Claude brain + Picovoice + Whisper + ElevenLabs; 3D arc-reactor UI; British-butler persona; Esc-to-stop | Mixed / unclear | Persona, orb UI, ESC-style kill switch, wake word → STT → LLM → TTS pipeline | Validates our pipeline; our implementation is original |
| **trycua/cua**, **mediar-ai/terminator** | Computer-use infrastructure; "Playwright for Windows" | MIT | Fast, selector-based Windows UI automation | P2 evaluation for F2.9 |

| **isair/jarvis** | Local-first Python voice assistant: transcript-first listening, intent judge, hot window, echo detection, dictation, diary, weather/meals/screenshot tools, Ollama | Custom non-commercial | Conversational voice (ADR-012), dictation, everyday tools, local-model connection (ADR-013), fetch_web_page | Re-implemented in TypeScript from its specs; no code copied (licence forbids commercial use and requires share-alike for derivatives) |
| **open-jarvis/OpenJarvis** | Stanford's local-first agent framework: skills, morning digest, deep research, scheduled/continuous agents, 35 channels, 40 connectors | Apache-2.0 | Skills (ADR-014), scheduled agents + briefing (ADR-015), deep research (ADR-016), Telegram channel + news feeds (ADR-017) | Our own code; only the groups Sir chose (no other channels/connectors, no code execution sandbox, no energy telemetry) |
| **jev-chat/jev-chat-jarvis** | Android WhatsApp reply copilot: analyse → stance → two drafts → checks/score → fill (never send) | MIT (+ NOTICE asking for credit) | Reply copilot for desktop chat apps (ADR-018) | Our own code; credited in THIRD_PARTY_NOTICES and the Bible |

**Why our design is stronger than the hobby repos:** most of them use keyword `if/else` commands, store memory in one JSON file, and have no permission system. Ours uses LLM tool-calling, a deterministic policy engine, MCP for unlimited app connections, and an editable Obsidian brain.

## 8b. Features added after v1.0

All are implemented; details and how-tos in [BIBLE.md](BIBLE.md) §3, decisions in [TRD](TRD.md) ADR-010…026.

| Area | Requirement | Priority |
|---|---|---|
| F7 Connections | Choose API key, Claude subscription (personal use, via Sir's Claude Code) or a local OpenAI-compatible model | P0 |
| F8 On-device voice | Whisper STT, the instant "Hey <name>" keyword spotter (any name, ADR-044) and openWakeWord "Hey Jarvis" as alternatives to Deepgram/Picovoice; pinned, verified downloads | P1 |
| F9 Conversational voice | Follow-up window, conversation continuity, echo rejection, unclear-speech retry, no cancel on false wake, always-listening mode with intent judge | P0 |
| F10 Dictation | Hotkey → speech → cleaned text pasted into any app; dictionary; history | P1 |
| F11 Everyday tools | Weather (Open-Meteo), home town, meal log, look at screen, read web pages | P1 |
| F12 Skills | Install/enable SKILL.md skills from a folder or GitHub; load on demand | P1 |
| F13 Automations | Scheduled briefing/task/check-in prompts; morning briefing preset; news feeds | P1 |
| F14 Deep research | Reading-only agent producing cited reports saved to the vault | P1 |
| F15 Telegram | Paired phone chat, button confirmations (non-destructive only), forwarding of briefings | P2 |
| F16 Reply copilot | Read a chat on screen, analyse, stance, two checked drafts, paste (never send) | P2 |
| F17 Bible | One complete guide in docs and in the app; generated reference kept in sync by a test | P1 |
| F18 Spaces | Notion-style notebooks (Learning, Finance, …) in the sidebar: pages from templates, autosaving Markdown editor, stored in the vault and searchable by Jarvis | P1 |
| F19 Brain graph | The vault drawn as an interactive neural network (links + folders), click a dot to read the note | P2 |
| F20 Phone remote | HTTPS web app on the LAN: type, live dictation and hands-free voice calls from the phone browser; QR pairing | P1 |
| F21 WhatsApp | Commands from Sir's own self-chat (wake word), approvals by yes/no, `send_whatsapp` with PC approval | P2 |
| F22 Passwords | Encrypted password manager (master password, TOTP, generator, auto-lock) unreachable by the AI | P1 |
| F23 Composer dictation | Tap the mic: words stream into the message box live; nothing sent until Send; one-click free on-device speech | P0 |
| F24 UI Automation | List/click/type/read controls in any Windows app without screenshots or API keys | P0 |
| F25 Tasks | To-do lists like Todoist/TickTick: Inbox, Today, Upcoming, Starred, lists, tags; natural-language quick add ("call mom tomorrow 6pm #home !1 every week"); priorities, due date and time, reminders, repeats, subtasks, notes; list / Kanban board / Eisenhower matrix; drag to reorder; stats and streak; focus timer; time-block onto the calendar; Jarvis can add, list, complete, edit and (with approval) delete | P1 |
| F26 Calendar | Day / week / month / schedule / year views; colour-coded calendars; drag to create, move and resize; repeating events (change or delete one, following or all); reminders before events; tasks with due dates on the calendar; natural-language quick add; free-time finder; .ics import and export; Jarvis can read the agenda, add, move and (with approval) delete events | P1 |
| F19b Brain views | Six ways to see the vault: Neural, 3D orbs, Clusters, Constellations, Mind map, Treemap | P2 |
| F27 Mini orb docking | The desktop mini orb is only as big as the orb; drag it along the screen edges, tuck it into the edge as a slim handle (Game Bar style), or hide it; the spot is remembered | P1 |

## 9. Success Metrics

| Type | Metric | Target (30 days after v1) |
|---|---|---|
| Leading | Golden eval pass rate | ≥ 90% |
| Leading | Voice turn latency (EOS → first audio, p50) | < 2.5 s |
| Leading | Tool error rate | < 5% of calls |
| Leading | Daily active use | Used on ≥ 20 of 30 days |
| Lagging | Unapproved destructive actions | 0 |
| Lagging | Memory recall accuracy (eval) | ≥ 90% |
| Lagging | Monthly API spend | Within Sir's configured budget |

## 10. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Prompt injection via web pages/emails triggers harmful actions | Medium | High | Untrusted-content wrapping, tier enforcement in code, Anthropic injection classifiers on computer/browser tools, confirmations ([Security](Security.md)) |
| Misheard voice command causes wrong action | Medium | Medium | Confirmation for CONFIRM tier; transcript shown before acting on risky commands |
| API cost runaway (computer-use screenshot loops) | Medium | Medium | Iteration caps, budget guard, screenshot downscaling |
| Unofficial Edge TTS endpoint breaks | Medium | Low | Provider interface + SAPI fallback + optional ElevenLabs |
| Native module build issues on Windows (better-sqlite3, nut.js) | Medium | Medium | Prebuilt binaries, `@electron/rebuild`, documented in [Implementation](Implementation.md) §0 |
| Antivirus flags input automation | Low | Medium | Code-sign later; document exclusion steps |
| Scope creep ("control everything") | High | High | Phased plan; P2 parking lot; each phase ends with a working release |

## 11. Open Questions

| Question | Owner | Blocking? |
|---|---|---|
| Which Gmail/Calendar MCP server is trustworthy enough? | Sir (security review) | No (P1) |
| Deepgram vs OpenAI for STT default (cost vs latency on Sir's network)? | Sir (benchmark in Phase 4) | No |
| Should conversation logs be full transcripts or summaries in the vault? | Sir | No (default: full, redacted) |
| Final product name if ever shared publicly | Sir | No |

## 12. Timeline (evenings & weekends)

| Phase | Deliverable | Est. |
|---|---|---|
| 0 | Environment + repo scaffold | 2 days |
| 1 | Chat with Claude in a desktop window | 1 week |
| 2 | Hands: tools + permissions + activity log | 1–2 weeks |
| 3 | Brain: Obsidian memory | 1 week |
| 4 | Voice | 1–2 weeks |
| 5 | Connections: MCP + browser | 1–2 weeks |
| 6 | Full desktop control (computer use) | 2 weeks |
| 7 | Polish, tray, installer, routines | 1 week |

Details per phase are in [Implementation.md](Implementation.md).
