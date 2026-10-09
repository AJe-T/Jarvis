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

**New in 2.0 (one line each, details below):**
- **Dictate into the message box** like a phone keyboard: tap the mic, words appear live, press Send (§3.2).
- **Spaces:** Notion-style notebooks (Learning, Finance, …) in the sidebar (§3.13).
- **Brain:** your whole vault as a living neural network you can explore (§3.3).
- **Passwords:** an encrypted password manager the AI can never read (§3.14).
- **Works inside any app** through Windows UI Automation, free and with any brain (§3.4).
- **Phone remote:** chat, dictate or hold a hands-free voice call from your phone's browser (§3.15).
- **WhatsApp:** talk to Jarvis in your own "Message yourself" chat (§3.16); **Telegram voice notes** (§3.9).

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
| Press to talk | the **Talk** (waveform) button by the message box, or `Ctrl+Alt+Space` | Jarvis answers aloud |
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

**Dictate a message (phone-keyboard style; works in every mode, even Voice off):**
- Tap the **mic** in the message box and speak. Your words appear **live in the box** as you talk; pauses don't stop it.
- Tap the mic again (or Esc) to stop, fix anything, then press **Send**. Nothing is sent by itself. It stops on its own after 20 s of silence.
- Engines: Deepgram streams words instantly. On-device Whisper re-reads the phrase about every 0.7 s, so words show with a short lag (base.en is quickest); it is free and offline.
- **No key? One click:** Settings → Voice → **Set up free on-device speech** downloads Whisper base.en + the voice detector (about 80 MB, once) and switches speech to on-device. If Deepgram is chosen but has no key, Jarvis uses on-device Whisper automatically when it is downloaded.
- Why not Chrome's built-in speech? Electron (unlike Google Chrome) has no Google speech key, so `webkitSpeechRecognition` fails with a `network` error. The phone remote (§3.15) *does* use it, because there it runs in your phone's real browser.
- A faster fully-offline streaming engine (sherpa-onnx, ~60–130 MB models) is a possible next step if Whisper's lag bothers you.

**Dictation into other apps:**
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
- **Spaces pages are searchable too:** pages in `Spaces/` are indexed like memory notes, so "what did I write about Rust ownership?" finds your Learning page.

**Brain view (sidebar → Brain):** the whole vault drawn as a neural network.
- Every note is a glowing dot coloured by its folder; `[[wiki links]]` are the bright connections, and each note also hangs off a hub for its folder, so the vault forms one network shaped like two hemispheres. Small signals travel along the links (off with Windows "reduce motion").
- Scroll to zoom, drag the background to move, drag a dot to pull it. Hover a dot to light up its neighbours; click it to read the note in a side panel, with **Open in Obsidian** or **Edit in Spaces**.
- **Find a note** jumps to it; the legend lists each folder with a count (click to hide/show); "Show folders" hides the hub dots; the fit button frames everything.
- It updates when the vault changes. Obsidian's own Graph view (Ctrl+G inside Obsidian) shows the same links; the ↗ button opens the vault there.

### 3.4 Your PC
- **Inside any app, free (Windows UI Automation; ideas from microsoft/UFO and Windows-Use, no code copied):** Jarvis reads an app's accessibility tree, the same one screen readers use, so it can see and use buttons, menus, tabs, list items and text boxes by name — no screenshot, no vision model, no API key. Works with every brain, including local models.
  - `list_ui_elements` (see the controls), `click_ui_element` (invoke/toggle/select/expand, or a real click as a last resort), `set_ui_text` (type into a field), `read_window_text` (read a document, chat or dialog), `press_keys` ("ctrl+s", "alt+tab", "f5"), `type_text` (paste into the focused field).
  - Try: "Open Settings and go to Bluetooth & devices", "In Notepad, type my shopping list", "What does that error dialog say?", "Press Ctrl+S in Word".
  - Safety: buttons whose label means send, pay, delete, submit or agree ask first (destructive ones need a click); submitting typed text asks first; password fields are refused; `Win+R` and `Ctrl+Alt+Del` are blocked and `Alt+F4` asks. Admin (elevated) windows can't be driven by a normal app — that's Windows' own protection.
  - Limits: games and custom-drawn apps expose no controls; for those Jarvis falls back to screenshot computer control (API connection).
  - Each call takes about 1–2 s (a PowerShell UI Automation query).
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
- **Voice notes:** hold the mic in Telegram and talk. Jarvis downloads the note, transcribes it (Deepgram if you have a key, otherwise on-device Whisper — the Jarvis window decodes the Opus audio, nothing extra is installed), shows "🎤 what he heard", answers in text **and** sends back a voice message in his own voice (Settings → Phone & chat apps → Telegram voice notes). Notes up to 5 minutes.

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
Sidebar → **Connections** → **Add connection**. Three tabs:
- **Catalogue** — vetted, version-pinned servers grouped by category, with a filter box and "needs key / no key / hosted" tags:
  - **App hubs (one connection, many apps):** **Zapier** (9,000+ apps: Gmail, Sheets, Slack, Calendar… you choose the actions at mcp.zapier.com) and **Apify** (thousands of ready-made scrapers).
  - **Browser & files:** Playwright browser, Chrome DevTools, scoped Filesystem.
  - **Web search:** Brave Search, Tavily, Exa, Firecrawl, Perplexity.
  - **Docs & knowledge:** Context7 (library docs), Microsoft Learn, DeepWiki (no keys needed), Hugging Face.
  - **Developer:** GitHub, Linear, Sentry, MongoDB (started read-only).
  - **Productivity:** Notion, Todoist, HubSpot, Stripe (use a restricted key).
  - **Home & media:** Home Assistant (lights, plugs, sensors via its "Model Context Protocol Server" integration), YouTube transcripts.
- **MCP Registry** — search the official public registry (registry.modelcontextprotocol.io, thousands of servers) inside Jarvis and add one in two clicks. Jarvis only lists servers it can run safely as-is (an npm package, or an HTTPS address with at most a Bearer token); Python/Docker ones are counted and can be added as Custom. Registry servers are added as **community** trust, every tool asks first, they get their own keys (they can never reuse your GitHub, Notion, Zapier… keys), npm ones carry a "runs on this PC" warning, and **View source code** opens the repository so you can check it.
- **Custom** — any stdio command or HTTPS URL.

Keys go in the form before **Connect** (stored encrypted like every secret, passed only to that server). Tools appear as `mcp__server__tool`, go through the same policy, and their output is untrusted.

### 3.13 Spaces (Notion-style notebooks)
Sidebar → **Spaces**. Each space (Learning, Finance, Fitness, Ideas…) is a notebook of pages.
- **Sidebar tree (accordion):** your spaces sit under "Spaces"; the arrow beside **Spaces** folds the whole list away, and the arrow beside each space shows or hides its pages (like Notion's page tree). Click a page to open it. Jarvis remembers what you folded; opening a page unfolds its space. **+ New space** picks a name and an icon. (The tree shows on windows 1200 px and wider; narrower windows show space icons only.)
- **Spaces home:** every space as a gallery card with a cover and its icon, plus **Recently edited** pages across all spaces.
- **A space:** a cover banner, the space's icon and name, then its pages as a **Gallery** (cards with a cover, the page icon and title, like a Notion gallery database) or a **List**; switch with the tabs and Jarvis remembers your choice. **Search** filters, **New page** offers templates (Blank, Learning note, Journal entry titled with today's date, Meeting notes, Expense log table, Project plan), and the last card **+ New page** makes a blank page.
- **Page icon and cover:** click the icon square to pick an emoji; hover the cover and press **Change cover** to pick one of eight built-in covers (Grid, Synthwave, Matrix, Circuit, Aurora, Hazard, Plasma, Chrome). They are saved in the page's frontmatter (`icon:`, `cover:`), so Obsidian keeps them. Covers are generated art, so no image is ever downloaded.
- **Editor:** a breadcrumb back to the space, big title (rename by editing it), a formatting bar (headings, bold, italic, lists, to-dos, quote, code, table, `[[link]]`, divider), **Write / Preview**, and Enter continues lists like Notion. It **saves by itself** about a second after you stop typing (Ctrl+S saves now; leaving the page saves first).
- **Ask Jarvis about this page** (sparkle button) opens a new chat starting "Using my "Learning / Rust" page…". Jarvis can also use Spaces himself with the `spaces` tool: "add this to my Finance space under October", "what did I note in Learning about closures?". He can add and create, never delete or overwrite.
- **Where it lives:** `Spaces/<space>/<page>.md` in your Obsidian vault — plain Markdown you can open in Obsidian, shown in the Brain graph, and searchable by Jarvis's memory. Deleting a page or space moves it to the vault's `.trash`.
- Secrets typed into pages (passwords, card numbers) are masked when saved, like everything in the vault. Keep them in **Passwords** instead.

### 3.14 Passwords (encrypted, never shared with the AI)
Sidebar → **Passwords**.
- **First time:** create a master password (8+ characters; a strength bar helps). It is never stored; **if you forget it, the vault can't be opened** (that's what makes it safe).
- **Entries:** name, username, password, website, category (Login, Bank, Card, Email, Social, Work, Wi-Fi, Other), notes, favourite, and an optional **two-factor secret** — Jarvis then shows the live 6-digit code with a countdown, like an authenticator app.
- **Generator:** makes a strong random password (length 8–64, symbols on/off) from the system's secure random source.
- **Copy:** copying a password or code puts it on the clipboard and **wipes it after 20 s** (only if you haven't copied something else since). Passwords stay hidden until you press the eye.
- **Locks itself:** after 5 idle minutes (Settings → Passwords), when Windows locks or sleeps, on the kill switch, or with the lock button. Wrong master passwords slow down after three tries.
- **How it's protected:** a key is derived from the master password with scrypt (N=2^17) and the vault file (`%APPDATA%\Jarvis\passwords.vault`) is encrypted with AES-256-GCM, which also detects tampering. Only the Passwords view's own channels reach it: no tool, AI model, memory note, log, Telegram, WhatsApp or phone remote can read it, and file tools are denied that path. Audit entries say "unlocked/saved" but never which entry.
- Back it up by copying `passwords.vault`; it opens on any PC with the master password.

### 3.15 Phone remote (call Jarvis from your phone — free, no app)
Settings → **Phone & chat apps** → **Phone remote**.
1. Turn it on. Jarvis starts a small **HTTPS** web app on your home network (port 8765) and shows its address.
2. Press **Pair a phone** and scan the QR code with the phone's camera (or open the address and type the 6-digit code; valid 10 minutes, once).
3. The first time, the phone warns the certificate is self-signed (Windows made it for this PC): tap **Advanced → Proceed**.
4. On the phone: type; tap the mic to **dictate with live words** (the phone's own speech recognition: Chrome on Android, Safari on iPhone); or tap the phone icon for a **hands-free call** — you talk, Jarvis answers aloud through the phone, then listens again until you hang up.
- Approvals show as cards on the phone; **destructive ones can only be approved at the PC**. "stop" stops everything.
- Each paired phone gets its own random token (only its hash is kept, encrypted); remove phones in Settings.
- **Away from home (free):** install **Tailscale** on the PC and the phone, run `tailscale serve --bg 8765` on the PC, and open the `https://<pc>.<tailnet>.ts.net` address — a real certificate, no warning.
- Real phone-network calls (dialling a number) aren't free anywhere (Twilio etc. are paid), so they are not built in.

### 3.16 WhatsApp (your own account)
Settings → **Phone & chat apps** → **WhatsApp**.
1. Turn it on and scan the QR code in WhatsApp → Settings → **Linked devices** → Link a device (like WhatsApp Web).
2. In WhatsApp open your own **"Message yourself"** chat and write **"Jarvis, …"** (e.g. "Jarvis, remind me at 6 to call mom"). Messages without the wake word stay normal notes. Change the word in Settings, or clear it to make every self-message a command.
3. Jarvis replies in the same chat. Confirmations: reply **yes** or **no**; destructive actions only at the PC. "Jarvis stop" stops everything.
- Jarvis can send a WhatsApp message for you (`send_whatsapp`, to a number with country code) — **always after you approve the exact text**.
- Messages in any other chat are never read as commands.
- ⚠ Built on the free **Baileys** library (MIT), not WhatsApp's paid business API. WhatsApp may restrict accounts that use unofficial clients; consider a spare number. **Unlink** logs this PC out and deletes the session keys (`%APPDATA%\Jarvis\whatsapp-auth`).

### 3.12 Interface
- **Core (the home screen):** Jarvis's orb is the screen. It sits in the middle of a HUD with corner readouts (clock, uplink and model, microphone mode, today's spend), a status line under it (`[ READY ]`, `[ THINKING… ]`…), and his words appear under the orb as captions while he replies. Before a conversation there's a greeting and three suggestions; the message box sits at the bottom.
  - **Comms log:** the conversation is secondary: a log beside the orb (an overlay sheet below 1200 px) that opens when a conversation starts; the speech-bubble button in the header shows or hides it. Tool cards and citations work as before.
  - Conversation history; `/private` conversations are not logged to the vault.
  - **Rewind** (idea from isair/jarvis): hover one of your messages in the log. **Edit from here** removes it and everything after and puts it back in the box; **Regenerate from here** asks again. Attachments are not re-sent; the vault's daily log keeps the original.
- **The orb follows you:** on every other screen (Spaces, Settings, Connections…) a small live orb floats in the bottom-right corner, moving with Jarvis's state and voice, with his words beside it while he replies. Click it to return to Core. The sidebar's logo is a live orb too, and the **Mini orb** floats on the Windows desktop over other apps.
- **Views:**
  - **Settings → Advanced → Logs:** the newest log lines (secrets removed), warnings-only filter, and Open logs folder.
  - **Activity:** every action, the tamper-evident audit log, and **Usage** (spend by model/purpose/day; subscription cost is shown as API-equivalent). On Core the Activity panel starts closed (header button opens it).
  - **Memory:** browse, search, forget, and the review queue.
  - **Spaces** (§3.13), **Brain** (§3.3), **Passwords** (§3.14), **Connections** (§3.11), **Reply copilot** and **Bible**.
- **Look ("Neon Grid", cyberpunk HUD, [Design-system](Design-system.md)):**
  - Near-black void with a faint blueprint grid and CRT scanlines; hard 4 px corners; panels carry HUD corner brackets; hairline borders with neon glow on what's active or floating.
  - Neon cyan is the main button (clipped corners, dark text), focus and Jarvis; magenta and hazard-yellow are the second and third neon. Status tags are square chips (yellow = needs you, red = blocked, green = done).
  - Headings, labels, buttons and numbers speak in **Geist Mono** (HUD style, `// SECTION` labels); reading text stays in Geist. Bundled, works offline.
  - The sidebar groups **// workspace** and **// systems**; the active row has a glowing neon bar.
  - **The orb is a reactor core:** a plasma sphere with swirling filaments and a dotted shell, a bright ring, a ring of level bars, and a HUD of rotating segmented arcs, a magenta counter-ring, a tick ring, a radar sweep and yellow markers. It breathes at rest, moves with Jarvis's voice when he speaks, your voice when he listens, and music playing on the PC the rest of the time (Settings → General → "The orb moves to music"; only the loudness is read). It spins faster while listening, sweeps while thinking, splits its bars into one segment per tool while acting, turns yellow when it needs you, and glitches red on errors. Reduced motion draws it still.
  - Responsive from 480 px wide (Windows Snap half-screen); below 1200 px the sidebar shows icons only and the log and Activity open as sheets (Esc closes Activity). The window opens at up to 1400 × 880, never larger than the screen.
  - **Settings → General → Theme:** Match Windows (default), Light ("daylight HUD": pale steel with the same neon), Dark (Neon Grid, the home look).
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
- `telegram.*`, `appearance.theme`
- `memory.semanticSearch`
- `remote.enabled` / `remote.port` (phone remote), `whatsapp.*` (WhatsApp channel and its wake word)
- `passwords.autoLockMinutes` / `passwords.clipboardSeconds`

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
| The mic in the message box says speech needs setup | Settings → Voice → **Set up free on-device speech** (one-time ~80 MB download), or add a Deepgram key. |
| Dictated words appear slowly | On-device Whisper re-reads the phrase about every 0.7 s; choose **base.en** (fastest) or Deepgram (instant). |
| "Jarvis can't interact with that app" | Ask him to use the app's controls: "list the buttons in Spotify". Elevated (admin) windows and games expose nothing to UI Automation; screenshot control needs the API connection. |
| Phone remote won't open on the phone | PC and phone on the same Wi-Fi; allow Jarvis through Windows Firewall when asked (Private networks); use the address shown in Settings; accept the self-signed certificate once. |
| Phone mic button does nothing | Live dictation needs Chrome (Android) or Safari (iPhone) and the https address; otherwise use the keyboard's own mic. |
| WhatsApp shows "logged this PC out" | WhatsApp unlinked the device (or you did on the phone). Turn WhatsApp off and on, and scan the new QR code. |
| WhatsApp ignores my message | Write it in your own "Message yourself" chat and start with the wake word ("Jarvis, …"). |
| Forgot the Passwords master password | It can't be recovered (that's the protection). Rename `%APPDATA%\Jarvis\passwords.vault` to start a new, empty vault. |

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
| 022 | Phone-keyboard dictation in the composer; Whisper live partials + continuous sessions instead of a new streaming engine |
| 023 | Spaces as Markdown in the vault (not a database), indexed with memory |
| 024 | Password vault walled off from Services (scrypt + AES-256-GCM, own IPC only) |
| 025 | UI Automation tools before screenshot computer use |
| 026 | Phone remote over self-signed HTTPS on the LAN, phone does speech; WhatsApp via Baileys self-chat |

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
| 1.6 | "Obsidian Intelligence" redesign: four-level glass, violet/cyan roles, Outfit font, eight-layer orb with tool progress, view/modal/toast motion, re-coloured light theme |
| 1.7 | "Graphite" redesign: solid neutral surfaces, one blue accent, consistent page grid, simpler orb; Transparency setting removed |
| 1.8 | "Workspace" redesign modelled on Notion: warm canvas and sidebar, purple primary, link blue, pastel tags and suggestion cards, labelled sidebar |
| 1.9 | "Geist" redesign modelled on Vercel: ink-on-white, solid-ink primary, one blue, brand mesh behind the empty-state hero, Geist + Geist Mono, stacked shadows, pill tags |
| 1.10 | Teal energy-core orb that follows voice, mic and music playing on the PC (loopback meter in its own sandboxed session) |
| 2.1 | "Neon Grid" cyberpunk redesign: orb-first **Core** home screen with HUD readouts and captions, conversation as a side log, a floating live orb on every screen, sci-fi reactor orb; Spaces as Notion-style galleries with covers and page icons and a foldable sidebar tree; Connections catalogue grows to 24 vetted servers (Zapier and Apify hubs, search, docs, dev, productivity) plus an in-app **MCP Registry** browser |
| 2.0 | Phone-keyboard dictation into the message box (live words, one-click free on-device speech); Spaces (Notion-style notebooks); Brain graph of the vault; encrypted Passwords the AI can't read; Windows UI Automation tools; phone remote with hands-free calls; WhatsApp self-chat; Telegram voice notes and voice replies; Home Assistant preset |

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
- **microsoft/UFO** (MIT) and **Windows-Use** (MIT): the idea of driving Windows apps through their UI Automation tree before falling back to screenshots.
- **Obsidian** graph view and **Notion**: the ideas behind the Brain view and Spaces.
- **Libraries added in 2.0:** Baileys (MIT, WhatsApp linked device) and qrcode (MIT).
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
