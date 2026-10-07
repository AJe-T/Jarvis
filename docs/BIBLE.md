# The JARVIS Bible

Everything about this project in one place: what Jarvis is, everything it can do and how to use it, how it is built, how it keeps you safe, where your data lives, how to develop and release it, how to fix problems, why things are the way they are, and where the ideas came from.

- **You can read this inside the app:** the **Bible** button in the left rail (search box + contents).
- **Exact lists** (every tool and its safety tier, every setting and default, every IPC channel, every database migration) are generated from the code into [REFERENCE.md](REFERENCE.md). This guide links there instead of copying them, so it can't go out of date.
- **Deeper specs** for builders: [PRD](PRD.md) · [TRD + decisions](TRD.md) · [Architecture](Architecture.md) · [API guide](API-Guide.md) · [Database](Database.md) · [Security](Security.md) · [App flow](App-flow.md) · [Design system](Design-system.md) · [Testing](Testing.md) · [Implementation log](Implementation.md) · [Code style](Code-style.md) · [Agent rules](Agents.md).

---

## 1. What JARVIS is

JARVIS is a **voice-first personal assistant for Windows**, built as an Electron desktop app. You talk to it (or type), and it answers in a calm British voice, remembers what matters in an Obsidian vault you own, and acts on your PC through a set of carefully guarded tools: opening apps, managing files, reminders, the browser, even moving the mouse when nothing else works.

**Principles**
1. **Safety is code, not a promise.** Every action passes a deterministic policy engine (SAFE / CONFIRM / BLOCKED), guards for paths, shell scripts, URLs and sensitive text, and an audit log. The AI can't talk its way past them.
2. **You own your data.** Memory is plain Markdown in your vault; history is a local SQLite database; secrets are encrypted with Windows DPAPI.
3. **Your choice of brain and ears.** Claude via API key, your Claude subscription, or a fully local model; cloud speech (Deepgram, Picovoice) or on-device speech (Whisper, openWakeWord).
4. **Conversation, not commands.** Follow-ups without the wake word, "Jarvis" anywhere in a sentence, replies that know the context.

**Who it's for:** one person, "Sir", on his own Windows PC. It is a personal tool: some options (Claude subscription mode, the "Hey Jarvis" model, ideas from isair/jarvis) are licensed for personal, non-commercial use only. See §12.

---

## 2. Quick start

1. **Install:** run `dist\Jarvis-Setup-<version>.exe` (or `npm ci` then `npm run dev` from source; in VS Code terminals first run `Remove-Item Env:ELECTRON_RUN_AS_NODE`).
2. **Onboarding (5 steps):**
   - Welcome.
   - Brain: choose a **connection** (API key, Claude subscription, or local model; §3.1).
   - Memory vault folder (default `Documents\JarvisBrain`) and a few facts about you.
   - Voice: choose engines and a mode (§3.2).
   - Safety summary.
3. **Try it:**
   - "What's the weather?"
   - "Remember that I deploy on Vercel."
   - "Open Notepad."
   - "Remind me in 10 minutes to stretch."
   - "Research which Node version Electron 44 uses."

**Hotkeys** (change them in Settings → Hotkeys / Dictation):

| Hotkey | Does |
|---|---|
| `Ctrl+Alt+Space` | Press to talk (again to stop) |
| `Ctrl+Alt+J` | Show / hide Jarvis |
| `Ctrl+Alt+Shift+X` | **Stop everything** (kill switch) |
| `Ctrl+Alt+D` | Dictation: type what you say into any app (off until enabled) |
| `Ctrl+Alt+R` | Reply copilot for the chat on screen |

---

## 3. Everything Jarvis can do

### 3.1 The brain: three connections
Settings → **Models & budget** (one active at a time):

| Connection | What it is | Notes |
|---|---|---|
| **Anthropic API key** | Claude via the Messages API, pay per use | Everything works, including computer control and Claude's web search. Daily/monthly **budgets** stop spending. |
| **My Claude subscription** | Your own signed-in **Claude Code** (via the Agent SDK) runs the loop; Jarvis's tools are served to it over in-process MCP | Personal use only. Sign in with Claude Code's own login. No computer control. Usage counts against your plan limits; shown as "API-equivalent" cost, never budgeted. ADR-010. |
| **Local model** | Ollama / LM Studio / any OpenAI-compatible server on this PC or home network | Free and offline; quality depends on the model (Qwen 3, Llama 3.1+ support tools). No web search or computer control. ADR-013. |

Models: default (Sonnet 5.5), deep ("think hard", "plan" → Opus 5.5), fast (Haiku 4.5, for titles, summaries, memory curation and the voice intent judge), computer control. All editable.

### 3.2 Voice
**Modes** (Settings → Voice):

| Mode | How you start | Notes |
|---|---|---|
| Off | type only | |
| Press to talk | mic button or `Ctrl+Alt+Space` | |
| Wake word | "Jarvis" (Picovoice) or "Hey Jarvis" (on-device openWakeWord) | Detection runs on this PC; audio leaves only while listening (and never with Whisper). |
| **Always listening (on-device)** | say "Jarvis" anywhere: "…what do you think, Jarvis?" | Needs on-device Whisper. Everything is transcribed locally into a 2-minute memory-only buffer; a fast model judges whether you meant Jarvis and rewrites the request with context. |

**Engines** (chosen separately):
- **Wake word:** Picovoice ("Jarvis", needs a free key) or openWakeWord ("Hey Jarvis", 4 MB download, non-commercial model licence).
- **Speech-to-text:** Deepgram (cloud, live text as you speak) or Whisper on this PC (base.en, small.en default, or multilingual small; downloads are pinned and SHA-256 verified).
- **Voice out:** Microsoft Edge neural voices (online), with Windows SAPI as the offline fallback.

**Conversation behaviour (ADR-012)**
- Follow-ups need no wake word (or hotkey, in press-to-talk) for a few seconds after each spoken reply (`voice.followUpSeconds`, default 6; the window opens silently).
- Jarvis waits for a real pause before answering (`voice.endSilenceMs`, default 1000 ms; raise it if he cuts you off mid-sentence). Spoken replies actually answer in 1–3 natural sentences and may end with a short follow-up question; only long material (tables, code, links) goes to the screen.
- Voice turns continue the same conversation for 15 minutes.
- A wake word while Jarvis is still thinking does **not** throw the answer away; a new request replaces it only when you actually say something.
- Jarvis ignores its own voice coming back through the mic, and asks again when it hears a one-word mishearing.
- Barge-in: press the hotkey while Jarvis talks. The wake word is **ignored while he is speaking** unless `voice.bargeIn` is on, because without echo cancellation the mic hears his own voice and he used to cut himself off (turn it on with headphones).
- **Instant commands** (idea from Priler/jarvis; `voice.quickCommands`, on by default): a routine's trigger phrase ("start work mode", forgiving a misheard letter) runs that routine at once with no model call, and "what time is it" / "what's the date" are answered on the spot, offline. Everything else goes to Claude.
- Saying "stop" or "cancel" ends the current reply; "stop everything" is the kill switch; "go to sleep" pauses the wake word.

**Dictation:**
- Enable it in Settings → Dictation, then press `Ctrl+Alt+D` in any app.
- Speak; pause about 1.5 s (or press the hotkey again) and the text is pasted at your cursor. Your clipboard is restored afterwards.
- Filler words ("um", "uh") are removed. A custom dictionary fixes words it mishears (`avan tech => AvaanTech`), and a history is kept locally.

### 3.3 Memory (Obsidian vault)

**Vault layout** (`Documents\JarvisBrain` by default):
- `Memory/`: facts about you, people, projects and preferences. `About Sir.md` and `Preferences.md` are read at the start of every turn.
- `Conversations/`: the daily log of every conversation (redacted; `/private` chats are skipped).
- `Routines/`: multi-step routines you can start by saying "start work mode".
- `Tasks/Reminders.md`: a readable copy of your reminders.
- `Briefings/`: saved briefings and automation results.
- `Research/`: research reports.

**How it works**
- **Saving:** "Remember…" saves a note with Claude's memory tool.
- **Finding:** relevant notes are found with full-text search and added to the context of each turn.
- **Semantic search** (idea from isair/jarvis; Settings → Memory → Download, 24 MB, on this PC): notes and past messages are also found by meaning, so "my sister's wedding" finds the note about Priya getting married. Keyword and meaning results are merged (reciprocal-rank fusion). New notes and messages are indexed in the background after each turn.
- **Recall by date:** "What did we talk about yesterday?" or "last Monday" lists what was said that day (`search_conversations` with from/to dates; `/private` chats never appear).
- **Learning:** after each turn a small model (the curator) proposes memory updates. Anything that looks like an instruction goes to a review queue (Memory view) instead of being saved.
- **Your edits:** changes you make in Obsidian are picked up within seconds.

### 3.4 Your PC
- **Apps and windows:** open and close apps, list open windows, lock, sleep, shut down or restart (asks first).
- **Media and settings:** media keys, volume, brightness, battery and system info.
- **Files** (only inside the allowed folders):
  - Search, read and write text files.
  - Create folders; copy, move and rename.
  - Delete to the Recycle Bin only, never a permanent delete.
- **Clipboard, notifications, timers and reminders.**
- **PowerShell:** runs only after a confirmation that shows the script. Dangerous commands are blocked by the shell guard.
- **Computer control** (API connection only): "In Excel, bold the first row".
  - A Desktop Operator moves the mouse and types, with a red border and a Stop pill on screen.
  - Every action is checked: it never clicks Jarvis's own windows and never types passwords, one-time codes or card numbers.

### 3.5 Everyday (ideas from isair/jarvis)
- **Weather:** "What's the weather?" uses your home town (Settings → Everyday) and Open-Meteo; no key needed. "Detect" can find your town from your IP address, and only when you press it.
- **Meal log:** "I just had a masala dosa" logs it with estimated calories and macros. "How am I doing today?" shows totals against your target.
- **Look at my screen:** "What's on my screen?" or "read this error" sends one screenshot to Claude after you confirm.
- **Read my screen's text (offline OCR):** `read_screen_text` uses Windows' built-in OCR on this PC; only the words go to the model, never the picture. Works with local models too. Asks first.
- **World time:** "What time is it in Tokyo?" (`get_world_time`, Open-Meteo place lookup, exact time-zone maths).
- **Local models get a short tool list:** with Ollama / LM Studio, each request is shown only the ~12 tools that match it (plus memory and the clock), as isair/jarvis does, so small models stay on track.
- **Slow speech recognition:** if on-device Whisper keeps decoding slower than you speak, Jarvis suggests the smaller base.en model once.
- **More MCP presets:** Chrome (DevTools, throwaway profile) and YouTube transcripts.

### 3.5a Expert AI models (HuggingGPT, idea from microsoft/JARVIS)
- Claude acts as the controller: it plans the job, picks an expert model from the Hugging Face Hub (`find_ai_models`, most-downloaded models served by HF Inference), runs it (`run_ai_model`) and explains the result. Multi-step jobs are chained ("transcribe this recording, then summarise it").
- Tasks: image classification, object detection, image segmentation, speech-to-text, text classification, named entities, zero-shot labels, summarisation, translation, question answering, fill-mask, text-to-image (saved to a file you name).
- Needs a free Hugging Face token (Settings → Everyday → AI models). Text tasks run directly; sending a file or generating an image asks first.

### 3.5b Handy plugins (ideas from sukeesh/Jarvis)
- **Money:** `convert_currency` (ECB rates via Frankfurter) and `get_market_price` (stocks via Yahoo Finance, e.g. `RELIANCE.NS`; crypto via CoinGecko). No keys.
- **Network:** `network_info`: local and public IP, DNS lookup, ping, download speed test.
- **Passwords:** `generate_password` puts a strong random password on the clipboard; Claude never sees it.
- **Tidy a folder:** `organize_folder` sorts loose files into Images, Documents, Audio, Video, Archives, Installers and Code (asks first, never overwrites).
- Jokes, games, maths, unit conversion, BMI and translation need no tool: Claude does them itself.

### 3.6 Web and research
- **Web search:** Claude's own search (API connection), or Claude Code's search (subscription connection). Results count as untrusted.
- **Read a page:** `fetch_web_page` reads public pages only, at most 2 MB, re-checking every redirect.
- **Deep research** (ideas from OpenJarvis): "Research X" runs a separate reading-only agent. It plans sub-questions, searches, reads sources and returns a **cited report**, saved to `Research/`.
- **News feeds:** RSS/Atom headlines from your feeds (Settings → Automations → News feeds); the defaults are Hacker News and BBC World.

### 3.7 Skills (ideas from OpenJarvis / agentskills.io)
A skill is a folder with `SKILL.md` that teaches Jarvis how to do a kind of task.
- **Install:** Settings → Skills, from a folder or a public GitHub folder link. Only text files are kept.
- **Use:** Jarvis sees each skill's name and description and loads the full instructions with `use_skill` when a task matches.
- **Safety:** skills never run code. Every action still asks you as usual. Review, turn off or remove skills in Settings.

### 3.8 Automations (ideas from OpenJarvis)
Settings → **Automations**, or just say "every Friday at 5 pm summarise my week".
- **Kinds:**
  - **Briefing:** spoken and saved to `Briefings/`. A switched-off **Morning briefing** preset is included (weather, reminders, headlines, memory).
  - **Task:** do something and report.
  - **Check-in:** speaks up only when something is worth saying.
- **When they run:**
  - Only while Jarvis is running.
  - Runs missed by more than 2 hours are skipped.
  - Each run is a normal conversation, so confirmations still ask you.

### 3.9 Telegram (ideas from OpenJarvis)
Talk to Jarvis from your phone.

**Set up:**
1. Create a bot with @BotFather.
2. Paste its token in Settings → Telegram and turn the channel on.
3. Send the 6-digit pairing code to your bot.

**How it behaves:**
- Only that one chat is answered.
- Confirmations arrive as buttons. **Destructive actions can only be approved at the PC.**
- `/stop` stops everything.
- Briefings can be forwarded to your phone.
- Replies pass through Telegram's servers.

### 3.10 Reply copilot (desktop take on jev-chat-jarvis)
Open a chat (WhatsApp, Telegram, Slack…) and press `Ctrl+Alt+R`, or say "help me reply".
1. Jarvis reads the conversation from one screenshot.
2. You pick who it is (work, romance, friends, family, general) and the relationship.
3. Jarvis shows what they want, the tone, pressure, boundaries and friction, and offers 2–4 stances.
4. You pick a stance and add details (a date, an amount).
5. You get **two drafts in your style**, each checked against your goal:
   - Promising something you didn't ask for, committing others, deciding more than you wanted, crossing their boundary or inventing facts **blocks** a draft.
   - Admitting fault or contradicting a detail asks you to look first.
   - Score = 0.7 × goal + 0.3 × delivery. "Top pick" goes only to a draft that is clearly ahead.
6. **Paste into chat** puts it in the message box of the same chat. **You press Send; Jarvis never does.**

### 3.11 Connections (MCP)
Add MCP servers (presets: Playwright browser, GitHub, Notion, filesystem) in the Connections view. Their tools appear as `mcp__server__tool`, go through the same policy, and their output is untrusted.

### 3.12 Interface
- **Chat:**
  - Streaming replies with tool cards and citations.
  - Conversation history; `/private` conversations are not logged to the vault.
  - **Rewind** (idea from isair/jarvis): hover one of your messages. **Edit from here** removes it and everything after and puts it back in the box; **Regenerate from here** asks again. Attachments are not re-sent; the vault's daily log keeps the original.
- **Views:**
  - **Settings → Advanced → Logs:** the newest log lines (secrets removed), warnings-only filter, and Open logs folder.
  - **Activity:** every action, the tamper-evident audit log, and **Usage** (spend by model/purpose/day; subscription cost is shown as API-equivalent).
  - **Memory:** browse, search, forget, and the review queue.
  - **Connections**, **Reply copilot** and **Bible**.
- **Look ("Glass Workshop at Night", [Design-system](Design-system.md)):**
  - Frosted glass islands (rail, chat, activity, status bar) floating over a slow blue/violet aurora; the orb's state colour lights the backdrop.
  - Fonts: Sora (headings), Geist (text), JetBrains Mono (code), bundled so they work offline.
  - Responsive from 480 px wide (Windows Snap half-screen); below 1200 px Activity opens as a sheet (Esc closes it).
  - **Settings → General → Theme:** Match Windows (default), Dark, Light (frosted white glass over a pastel aurora).
  - **Settings → General → Transparency:** Full glass (default), Auto, Reduced (no blur), Solid. Auto uses Solid when Windows "Transparency effects" is off, and Reduced on battery.
- **Mini orb:** a small always-on-top orb (tray or chat header).
- **Tray, start with Windows, start hidden.**
- **Settings → Data & backups:**
  - Daily backups (7 kept), back up now, restore on restart.
  - Message retention.
  - Open folders.

---

## 4. How it is built

- **Processes:**
  - **Main** (Node 24 in Electron 44): everything with power, including the database, tools, policy, voice and LLM calls.
  - **Preload:** a typed, validated IPC bridge.
  - **Renderer** (React 19 + Tailwind 4): UI only, with no Node access, a strict CSP and a sandbox.
- **A turn:**
  1. Text or voice input reaches the **orchestrator**, which persists the message.
  2. The context builder assembles the persona and rules (cached), the date, machine, integrations, allowed folders, routines and **skills**, your profile and relevant memories.
  3. The **agent loop** for the current connection runs:
     - **API and local:** our own loop. Every `tool_use` gets exactly one `tool_result`; a batch halts after a failure; the iteration count is capped.
     - **Subscription:** Claude Code's loop, calling our tools over MCP.
  4. Each tool call goes through the **executor**: Zod parse → **policy** (tier, guards, taint, overrides) → **confirmation** if needed → run with a timeout → redact → audit and activity rows.
  5. Text streams to the UI and the TTS pipeline (only the `<spoken>` part is spoken).
  6. After the turn: the conversation log, the memory curator and the title are written.
- **Voice pipeline:**
  - The microphone is captured in main (PvRecorder) → wake word or always-listening segmenter → speech-to-text session → route (echo, unclear, commands, confirmations) → voice turn.
  - Sentence chunking → Edge TTS / SAPI → Web Audio playback in the renderer → playback events back to main (follow-up window).
- **Module map** (src/main):

| Folder | Contains |
|---|---|
| `agent/` | orchestrator, loops (API, `sdk-loop`), context, model router, research, desktop operator |
| `llm/` | Claude API client, Claude Code client, local client, ledger, budget |
| `tools/` | registry, executor, native tools, everyday tools, computer use |
| `security/` | policy engine, path / shell / URL / content guards, redaction, audit, kill switch |
| `memory/` | vault, indexer, watcher, memory tool, retriever, curator, routines |
| `voice/` | controller, providers, local engines (Whisper / openWakeWord / VAD / model store), conversation helpers, dictation |
| `automation/` | scheduled tasks, feeds |
| `channels/` | Telegram |
| `copilot/` | reply copilot |
| `skills/` | skill store |
| `mcp/` | MCP manager |
| `ipc/` | handlers |
| `windows/` | main, mini, overlay, tray, hotkeys |
| `db/` | connection, migrations, repos |

- More detail: [Architecture](Architecture.md), [API guide](API-Guide.md).

---

## 5. Safety model (summary of [Security](Security.md))

- **Tiers:** SAFE runs; CONFIRM shows a dialog (Cancel is focused; Ctrl+Enter or a click approves; it auto-denies after 120 s); BLOCKED never runs. Your overrides can only make things stricter. The tier of every tool is in [REFERENCE.md](REFERENCE.md).
- **Who can approve:**

| Channel | Non-destructive | Destructive |
|---|---|---|
| Click / keyboard at the PC | ✓ | ✓ |
| Voice ("yes") | ✓ | ✗ |
| Telegram button | ✓ | ✗ (deny only) |
- **Guards:**
  - **Path guard:** only allowed folders; Jarvis's own secrets, database and logs are denied.
  - **Shell guard:** no recursive deletes on roots, registry, services, Defender, download-and-execute, credential access…
  - **URL guard:** http(s) only, no private addresses for fetching.
  - **Content guard:** never types or sends passwords, one-time codes, card numbers, IDs or keys.
- **Untrusted content:** web pages, search results, files, screen text, feeds, MCP output and chats read by the copilot are wrapped and treated as data. A turn that read them is **tainted**, and tainted turns must confirm anything external-facing.
- **Secrets:** encrypted with DPAPI; never sent to the renderer, logs, vault or git; redaction runs before anything is stored.
- **Kill switch:** `Ctrl+Alt+Shift+X`, the tray, "stop everything" or Telegram `/stop` aborts every turn, tool, confirmation and computer action.
- **Packaging:** Electron fuses (no RunAsNode, no NODE_OPTIONS / inspect, ASAR-only with integrity), plus a hardened BrowserWindow.

**What leaves your PC, and when**

| Feature | Goes to | When |
|---|---|---|
| Chat / tools (API) | Anthropic | every turn |
| Chat (subscription) | Anthropic via Claude Code | every turn |
| Chat (local) | your local server | every turn (nothing leaves your network) |
| Deepgram STT | Deepgram | only while listening |
| Whisper, openWakeWord, Picovoice wake | — | never (on-device) |
| Edge TTS | Microsoft | each spoken sentence (SAPI fallback is offline) |
| Weather | Open-Meteo (town name) | when asked |
| Detect town | ipapi.co (your IP) | only when you press Detect |
| Web search / pages / research / feeds | the sites | when asked or scheduled |
| Look at screen / reply copilot | Anthropic (one screenshot) | after you confirm / press the hotkey |
| Telegram | Telegram | when enabled |
| Model downloads | Hugging Face / GitHub (pinned) | when you press Download |

---

## 6. Your data

| What | Where |
|---|---|
| Database (history, tool calls, usage, reminders, meals, dictations, automations, settings) | `%APPDATA%\jarvis\jarvis.db` (SQLite with FTS5; schema in [Database](Database.md), migrations in [REFERENCE.md](REFERENCE.md)) |
| Backups (daily, 7 kept) | `%APPDATA%\jarvis\backups\` |
| Secrets (encrypted) | `%APPDATA%\jarvis\secrets.bin` |
| Logs (redacted) | `%APPDATA%\jarvis\logs\` |
| Voice models | `%APPDATA%\jarvis\models\` |
| Skills | `%APPDATA%\jarvis\skills\` |
| Claude Code working folder (subscription mode) | `%APPDATA%\jarvis\claude-code\` (empty; no transcripts kept) |
| Memory vault | your Obsidian folder (default `Documents\JarvisBrain`) |

---

## 7. Settings
Every setting, its type and default is listed in [REFERENCE.md → Settings](REFERENCE.md#settings). The ones that most change how Jarvis feels:
- `voice.mode` and `voice.followUpSeconds`
- `voice.wake.sensitivity` (0.5–0.6 is a good start)
- `voice.stt.provider` / `voice.stt.whisperModel` / `voice.stt.language`
- `llm.provider`
- `models.*`
- `budget.*`
- `location.home`
- `dictation.*`
- `telegram.*`
- `appearance.transparency`, `appearance.theme`
- `memory.semanticSearch`

---

## 8. Developing

| Command | Does |
|---|---|
| `npm run dev` | run from source (hot reload) |
| `npm test` | unit + integration tests (Vitest on Electron's Node) |
| `npm run test:e2e` | Playwright end-to-end tests against the built app |
| `npm run typecheck` / `npm run lint` | types / ESLint |
| `npm run docs:reference` | regenerate [REFERENCE.md](REFERENCE.md) from the code |
| `npm run evals` | golden + prompt-injection evals with the real Claude API (costs tokens; asks first) |
| `npm run dist` | build the Windows installer into `dist\` |
| `npm run release-gate` | everything above plus audit and secret scan |

**Tests**
- **Fakes** (FakeClaude, fake OS, fake voice, fake Claude Code over real MCP, fake Telegram/Ollama/web servers) keep tests offline and deterministic.
- **Opt-in real-model test:** `tests/integration/local-voice.real.test.ts` with `JARVIS_VOICE_MODELS` set.
- More in [Testing](Testing.md).

**Rules for contributors**
- Never weaken the hardening, policy, guards, redaction or confirmations.
- No `child_process.exec` and no string-built shell commands.
- Every tool needs a Zod schema, tier, summary, timeout and tests.
- Don't copy code from other repos.
- See [Code style](Code-style.md) and [Agents](Agents.md).

---

## 9. Troubleshooting

| Problem | Try |
|---|---|
| Wake word never reacts | Settings → Voice: check the engine is set up (key or downloaded model); set sensitivity to 0.5–0.6; check the right microphone; look in `%APPDATA%\jarvis\logs\jarvis.1.log` for "microphone read failed". |
| Voice mishears words | Use Whisper **small.en** (or Deepgram); set the language; for Hindi or Telugu use multilingual small with that language. |
| Jarvis answers its own voice | Lower the speaker volume or use headphones; echo rejection handles most cases. |
| Jarvis stops talking by himself / cuts you off | Keep `voice.bargeIn` off with speakers (the wake word then can't interrupt him); raise `voice.endSilenceMs` to 1200–1500 if you pause while speaking. Prefer the Edge voice over Windows SAPI for natural speech. |
| Always listening hears nothing after changing the Whisper model | Fixed in 1.4 (it kept using the disposed model: "Session already disposed" in the log). |
| "Claude Code is not signed in" | Settings → Models & budget → Sign in with Claude, or run `claude auth login`. |
| Local model unreachable | Start Ollama / LM Studio; check the address (`http://localhost:11434/v1`); pick an installed model. |
| Model download failed | Check your connection, then Download again (files are verified; partial files are discarded). |
| Hotkey doesn't work | Another app owns it: change it in Settings → Hotkeys / Dictation. |
| Telegram silent | Settings → Telegram: token saved, channel on, Connect, pairing code sent from a private chat. |
| Reply copilot won't paste | The chat window must still be open with the same title; otherwise use Copy. |
| Database warning banner | Settings → Data & backups → Restore a backup. |
| No aurora or blur, the app looks flat | Settings → General → Transparency must be Full glass (the default). With Auto, Windows "Transparency effects" off means Solid. |
| Window lags while resizing | Set Transparency to Reduced (keeps the look, drops the blur). |

---

## 10. Decisions (full text in [TRD](TRD.md))

| ADR | Decision |
|---|---|
| 001 | Electron over Tauri |
| 002 | TypeScript only, no Python backend |
| 003 | SQLite + Obsidian instead of a vector DB |
| 004 | Claude memory tool mapped to the vault |
| 005 | Playwright MCP for the browser |
| 006 | Native PowerShell tools first, computer use second |
| 007 | Audio pipeline in the main process |
| 008 | Deterministic policy engine |
| 009 | Built-in `node:sqlite` (no native DB module to compile) |
| 010 | Optional Claude subscription connection via Claude Code |
| 011 | On-device voice: Whisper + openWakeWord |
| 012 | Conversational voice: follow-ups, echo rejection, always-listening |
| 013 | Local model connection: Ollama / LM Studio |
| 014 | Skills in the agentskills.io format |
| 015 | Scheduled agents |
| 016 | Deep research + fetch_web_page |
| 017 | Telegram channel |
| 018 | Reply copilot |
| 019 | This Bible + generated reference |
| 020 | Instant voice commands, HuggingGPT expert models, everyday plugins |
| 021 | The rest of isair/jarvis: semantic memory, date recall, offline OCR, world time, rewind, local tool routing, logs |

---

## 11. History

| Version | What arrived |
|---|---|
| 0.0 – 0.6 | Foundation, chat, native tools and safety, memory, voice, MCP connections, computer control |
| 1.0 | Polish and packaging: mini orb, backups, usage dashboard, installer with fuses |
| 1.1 | Claude subscription connection |
| 1.2 | On-device voice (Whisper, openWakeWord); 1.2.1 fixed the wake word never hearing anything |
| 1.3 | Features from isair/jarvis, OpenJarvis and jev-chat-jarvis (conversational voice, dictation, everyday tools, local model, skills, automations, research, Telegram, reply copilot) and this Bible |
| 1.4 | Voice fixes (always-listening model bug, no self-interruption, longer end-of-speech pause, PTT follow-ups, conversational replies); ideas from microsoft/JARVIS (HuggingGPT), sukeesh/Jarvis (plugins) and Priler/jarvis (instant commands); glass theme v2 (aurora backdrop, glass islands, Sora/Geist fonts, transparency modes, responsive down to 480 px), light and dark themes |
| 1.5 | The rest of isair/jarvis: semantic (meaning-based) memory search, recall by date, offline screen OCR, world time, chat rewind, tool routing for local models, in-app logs, slow speech-recognition guidance, Chrome and YouTube MCP presets |

---

## 12. Credits and licences

JARVIS does not copy code from these projects; their **ideas** were studied and re-implemented. Full third-party list: [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

- **isair/jarvis** (© Baris Sencan, non-commercial licence): transcript-first conversational listening, follow-up window, echo rejection, intent judge, dictation, weather / meals / screen tools, local-model support, fetch_web_page; in 1.5 hybrid semantic memory search, date-scoped recall, screenshot OCR, world time, chat rewind, keyword tool routing, the Logs view, slow-recognition guidance and two MCP catalogue entries.
- **all-MiniLM-L6-v2** (sentence-transformers, Apache-2.0; Xenova's ONNX conversion) for semantic search.
- **OpenJarvis** (Stanford Hazy Research, Apache-2.0): skills, scheduled agents and morning digest, deep research, channels (Telegram), news feeds.
- **Jev chat assistant / jev-chat-jarvis** (MIT; its NOTICE asks for credit): "Based on ideas from Jev Chat Assistant (https://github.com/jev-chat/jev-chat-jarvis)" for the reply copilot's analyse → stance → draft → check → fill flow and scoring.
- **microsoft/JARVIS** (MIT): HuggingGPT's plan → select model → execute → respond loop over Hugging Face models.
- **sukeesh/Jarvis** (MIT): everyday plugins (currency, stocks and crypto, network checks, password generator, file organiser).
- **Priler/jarvis** (CC BY-NC-SA 4.0): phrase-to-action instant commands without a language model, matched forgivingly.
- **Models:** the openWakeWord "hey jarvis" model is **CC BY-NC-SA 4.0 (non-commercial)**; the Whisper weights (OpenAI) are MIT, using onnx-community's ONNX conversions; Silero VAD is MIT.

---

## 13. Glossary

| Term | Meaning |
|---|---|
| **Turn** | One request from you and Jarvis's complete answer, including tool calls. |
| **Tier** | A tool's safety level: SAFE, CONFIRM or BLOCKED. |
| **Taint** | A turn that read untrusted content; external actions then need confirmation. |
| **Connection** | Where the thinking happens: API key, subscription or local model. |
| **Follow-up window** | The seconds after a spoken reply when you can talk without the wake word. |
| **Intent judge** | The small model call that decides whether ambient speech was meant for Jarvis. |
| **Skill** | A SKILL.md folder of instructions Jarvis loads when a task needs it. |
| **Automation** | A prompt Jarvis runs on a schedule. |
| **Vault** | Your Obsidian folder: Jarvis's long-term memory. |
| **MCP** | Model Context Protocol: how external tool servers plug in. |
