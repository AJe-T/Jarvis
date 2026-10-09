# The JARVIS Bible

Everything about this project in one place: what Jarvis is, everything it can do and how to use it, how it is built, how it keeps you safe, where your data lives, how to develop and release it, how to fix problems, why things are the way they are, and where the ideas came from.

- **You can read this inside the app:** Settings → **Bible (help)** (search box + contents).
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

**New in 2.4:**
- **Tasks** (§3.17) and **Calendar** (§3.18): full to-do lists and a calendar Jarvis can run for you ("add dentist Friday 4 to 5", "what's on today?").
- **Brain** in six views: Neural, 3D orbs, Clusters, Constellations, Mind map, Treemap (§3.3).
- **Mini orb** you can drag along the screen edges, tuck into the edge or hide, so it never blocks a button (§3.12).

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

**Brain view (sidebar → Brain):** the whole vault drawn six ways; pick one in the switcher at the top (Jarvis remembers your choice). Clicking a note in any of them opens it in the side panel.
- **Neural** (default) — the living network described below.
- **3D orbs** — every note a glossy glass orb in a slowly turning star field, folders as clusters on a big sphere. Drag to spin, scroll to fly in, pause or turn with the buttons at the bottom.
- **Clusters** — each folder a soft coloured island ("Learning · 5") with its notes inside and links drawn between islands, like an Obsidian canvas.
- **Constellations** — each folder an orange star with its notes around it, like Obsidian's local graph.
- **Mind map** — folders as branches growing from "Vault", notes as underlined leaves; click a folder's dot to fold or open it (big vaults start folded); Expand all / Fold all.
- **Treemap** — the vault as nested boxes sized by number of notes (or by size); click a folder to step inside, the breadcrumb steps back out.
- In the **Neural** view every note is a glowing dot coloured by its folder; `[[wiki links]]` are the bright connections, and each note also hangs off a hub for its folder, so the vault forms one network shaped like two hemispheres. Small signals travel along the links (off with Windows "reduce motion").
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
- **News feeds:** RSS/Atom headlines from your feeds (Sidebar → Automations → News feeds); the defaults are Hacker News and BBC World.

### 3.7 Skills (ideas from OpenJarvis / agentskills.io)
A skill is a folder with `SKILL.md` that teaches Jarvis how to do a kind of task.
- **Install:** Sidebar → **Skills**, from a folder or a public GitHub folder link. Only text files are kept.
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

### 3.17 Tasks (to-do lists, like Todoist and TickTick)
Sidebar → **Tasks**.
- **Smart lists:** **Inbox** (tasks without a list), **Today** (overdue first, then today), **Upcoming** (grouped by day), **Starred**, **All tasks**, **Completed** (grouped by the day you finished them, with *Clear completed*). Your own **lists** (+ beside "Lists"; double-click to rename, click the dot to change colour, bin to delete — its tasks move to the Inbox) and every **#tag** in use appear below.
- **Quick add** (press **N**): type naturally and the chips underneath show what Jarvis understood — *"Call mom tomorrow 6pm #family !1 every week"*. It understands today / tonight / tomorrow / weekdays ("next friday", "by mon"), "in 3 days", "in 30 min", dates like "12 oct" or "12/10" (day first), "on the 15th", times ("6pm", "17:30", "noon", "1-2pm"), lengths ("for 45 min"), repeats ("every day", "every weekday", "every 2 weeks", "every mon and thu", "monthly"), priority (**!1**–**!4** or p1–p4) and **#list-or-tag** (a list when one has that name, otherwise a tag).
- **A task** (click it): title, **To do / Doing / Done**, list, priority P1–P4 (the colour of the tick circle), due date and time, **reminder** (a Windows notification and Jarvis says it; a timed task reminds at its time unless you change it), **repeat** (every day/weekday/week/2 weeks/month/year or custom: every N days/weeks/months/years, on chosen weekdays, ending never / on a date / after N times), tags, star, **subtasks** with a progress bar, and Markdown notes. **Focus 25 min** starts the pomodoro beside the orb and marks the task Doing; **Time-block it** puts it on the calendar.
- **Ticking a repeating task** logs it as done and moves it to its next date, with its subtasks unticked for the next round. Ticking any other task ticks its open subtasks. **Clear completed** keeps a done task that still has an open subtask.
- **Layouts** (top right): **List**, **Board** (To do / Doing / Done columns — drag cards between them) and **Priority matrix** (Eisenhower: do now, schedule, quick wins, later; important = P1/P2 or starred, urgent = due by tomorrow). **Sort:** smart order, due date, priority, A–Z, newest, or **My order** (drag rows).
- **Stats strip:** done today, this week, your **streak** (days in a row with something done) and how many are overdue.
- **Jarvis has full control** with the `tasks` tool: "add buy milk to my tasks for tomorrow", "what's on my list today?", "mark the electricity bill done", "move the report to Friday, high priority", "make a Groceries list". Deleting a task asks you first.
- Stored in Jarvis's local database (`todos`, `todo_lists`; migration 010), included in the daily backups.

### 3.18 Calendar
Sidebar → **Calendar**.
- **Views:** **Day**, **Week** (default), **Month**, **Schedule** (the next 60 days that have something on) and **Year** (twelve small months; busier days glow). Keys: **D W M A Y** switch, **T** today, **← →** (or J K) move, **N** new event.
- **Create:** drag across empty time in Day/Week (or click for an hour), double-click the all-day row, click a day in Month, **New event**, or **quick add** ("Lunch with Sam fri 1-2pm", "Mom's birthday 14 oct", "Gym every mon and thu 7am"; add **#Work** to pick a calendar).
- **Change:** drag an event to another time or day (Month: drag a chip to another day), drag its bottom edge to change the length, or click it for the editor: title, calendar, all-day, start and end, location, **repeat** (same choices as tasks), **reminders** (at start, 5/10/15/30 min, 1–2 h, 1 day before — several at once; 10 min by default) and notes. **Ctrl+Enter** saves.
- **Repeating events:** in the editor choose **This event** or **All events**; dragging one occurrence moves only that one. Delete offers **This one / This & following / All**.
- **Calendars:** Personal and Work to start; add more with +, click the square to change colour, the eye to hide one, double-click to rename, ⤓ to export it, bin to delete. **Show tasks with due dates** puts your tasks on the calendar (click one to open it in Tasks).
- **Next up** card, a red **now line**, a small month to jump around, and **Search**.
- **Import / export .ics:** bring in a calendar exported from Google, Outlook or Apple (events, repeats, deleted dates and alarms; it becomes a new calendar), or save yours as an .ics file. Times with a time zone are read as local time. Repeat rules Jarvis cannot follow exactly (hourly, "second Tuesday of the month") are left out and counted in the message, never guessed.
- **Reminders** arrive as a Windows notification, an in-app toast and Jarvis saying it — also while the window is hidden. Ones missed in the last 15 minutes (PC asleep, app closed) still arrive; none ever repeats.
- **Jarvis has full control** with the `calendar` tool: "what's on my calendar tomorrow?", "add dentist Friday 4 to 5", "move standup to 10:30", "when am I free on Monday for an hour?", "cancel the gym on Thursday". Deleting asks you first. Event text from imported files is treated as outside content (§5).
- Stored in the local database (`calendars`, `events`; migration 010), included in the daily backups.

### 3.12 Interface
- **Core (the home screen):** Jarvis's orb is the screen. It sits in the middle of a HUD with corner readouts (clock, uplink and model, microphone mode, today's spend), a status line under it (`[ READY ]`, `[ THINKING… ]`…), and his words appear under the orb as captions while he replies. Before a conversation there's a greeting and three suggestions.
  - **Talk to the orb:** with the chat closed there is no message box: **click the orb** (or press the push-to-talk key) to speak; click again to stop. If voice is off, clicking the orb opens the chat. **Start typing anywhere** and the chat opens with your letters already in the box.
  - **Comms log:** the conversation, with **the message box at its bottom**: a log beside the orb (an overlay sheet below 1200 px) that opens when a conversation starts; the speech-bubble button in the header shows or hides it. Tool cards and citations work as before.
  - Conversation history; `/private` conversations are not logged to the vault.
  - **Rewind** (idea from isair/jarvis): hover one of your messages in the log. **Edit from here** removes it and everything after and puts it back in the box; **Regenerate from here** asks again. Attachments are not re-sent; the vault's daily log keeps the original.
- **Panels beside the orb:** ask Jarvis to show something ("show my pending tasks", "start a 25-minute pomodoro", "show the dashboard", "how much have I spent on AI this month?") and he moves to the left of the stage while the panel slides in on the right; the sidebar and the conversation log step aside to make room and come back when you close it (✕). Kinds today:
  - **Pomodoro** — a focus timer with a ring (start/pause, +5 min, reset); a toast tells you when focus or the break ends.
  - **AI usage & billing** — spend against your daily and monthly budgets, by model, purpose or day.
  - **System status** — connection, model, voice mode, today's and this month's spend (with budget bars), connections ready, spaces and pages.
  - **List** (tasks, agendas, anything with items and ticks), **Stats** (labelled numbers with optional bars) and **Note** (formatted text) — Jarvis fills these with whatever you asked for.
  - The **panel button** in the Core header opens Pomodoro, Status and Usage by hand. Jarvis uses the `show_panel` / `hide_panel` tools (safe: display only). Jarvis shows tasks and agendas as a List panel; the full views are Tasks (§3.17) and Calendar (§3.18).
- **The orb follows you:** on every other screen (Spaces, Settings, Connections…) a small live orb floats in a corner, moving with Jarvis's state and voice, with his words beside it while he replies. Click it to return to Core. If it covers something, **drag it to another corner**, or hover it and press the small arrow to **tuck it into the edge** as a slim glowing tab (click the tab to bring it back). Jarvis remembers where you put it. The sidebar's logo is a live orb too, and the **Mini orb** floats on the Windows desktop over other apps.
- **Views:**
  - **Sidebar:** **// workspace** — Core, Spaces (with its page tree), **Tasks**, **Calendar**, Brain, Memory, Passwords; **// tools** — **Automations**, **Skills**, Connections, Reply copilot; Settings at the bottom. **Hide it** with the arrow next to the JARVIS logo or **Ctrl+B**; a slim strip with one button brings it back. Jarvis also hides it himself while he shows a panel.
  - **Settings → Advanced → Logs:** the newest log lines (secrets removed), warnings-only filter, and Open logs folder.
  - **Settings → Activity & usage:** every action, the tamper-evident audit log, and **Usage** (spend by model/purpose/day; subscription cost is shown as API-equivalent). Core's header still opens the live Activity drawer for the current turn.
  - **Settings → Bible (help):** this guide, searchable, plus the generated reference.
  - **Memory:** browse, search, forget, and the review queue.
  - **Spaces** (§3.13), **Brain** (§3.3), **Passwords** (§3.14), **Connections** (§3.11), **Reply copilot** and **Bible**.
- **Look ("Neon Grid", cyberpunk HUD, [Design-system](Design-system.md)):**
  - Near-black void with a faint blueprint grid and CRT scanlines; hard 4 px corners; panels carry HUD corner brackets; hairline borders with neon glow on what's active or floating.
  - Neon cyan is the main button (clipped corners, dark text), focus and Jarvis; magenta and hazard-yellow are the second and third neon. Status tags are square chips (yellow = needs you, red = blocked, green = done).
  - Headings, labels, buttons and numbers speak in **Geist Mono** (HUD style, `// SECTION` labels); reading text stays in Geist. Bundled, works offline.
  - The sidebar groups **// workspace** and **// systems**; the active row has a glowing neon bar.
  - **Settings → General → Orb style:** 18 styles, each a live preview card (hover to see it move): **Particle core** (default), **Arc reactor**, **Fluid glass** (Siri-like), **Voice cloud** (ChatGPT-voice-like), **Liquid metal**, **Solar flare**, **Plasma ball**, **Radial equalizer**, **Sonar pulse**, **Oscilloscope**, **Holo globe**, **Gyroscope**, **Atom**, **Light ring** (smart-speaker style), **Sorcery circle** (Doctor Strange), **Black hole**, **Galaxy**, **Digital rain**. Every style uses your accent colour, follows voice and music, and shows Jarvis's state (yellow when he needs you, red on errors, a segmented ring while he works through tools). The sidebar logo, the corner orb and the mini orb use the same style.
  - **Particle core (default):** about 1,500 glowing dots that ripple like liquid with the sound, shading from your accent colour to violet, with a hot core of swirling filaments, wavy particle shells orbiting it, a ring of level dots, sparks thrown off when Jarvis speaks or thinks, and a HUD of turning arcs, a glyph ring (spell-circle style), ticks and markers. It breathes at rest, moves with Jarvis's voice when he speaks, your voice when he listens, and music playing on the PC the rest of the time (Settings → General → "The orb moves to music"; only the loudness is read). It spins faster while listening, sweeps while thinking, splits its dot ring into one segment per tool while acting, turns yellow when it needs you, and glitches red on errors. Reduced motion draws it still.
  - Responsive from 480 px wide (Windows Snap half-screen); below 1200 px the sidebar shows icons only and the log and Activity open as sheets (Esc closes Activity). The window opens at up to 1400 × 880, never larger than the screen.
  - **Settings → General → Theme:** Match Windows (default), Light ("daylight HUD": pale steel with the same neon), Dark (Neon Grid, the home look).
  - **Settings → General → Accent colour:** ten ready neons (Cyan, Arc blue, Violet, Magenta, Red, Orange, Gold, Lime, Green, Silver) or **Custom**: **All colours** opens the Windows colour dialog (the full palette and its custom mixer), or type a **Hex** value like `#FF2A3D`. **The whole theme follows it**: backgrounds, panels, input and card borders, lines, grey text, shadows and the grid take the accent's hue (same darkness, so a red accent gives a deep red-black app), and buttons, glow, links and the orb use the colour itself. Text shades are adjusted automatically so they stay readable in both themes. It previews as you pick and is kept when you press **Save changes**.
- **Mini orb:** a small always-on-top orb on the Windows desktop (tray → Mini orb, or the chat header). The window is only as big as the orb, so everything around it stays clickable.
  - **Click** it to open Jarvis. **Drag** it anywhere: when you let go it snaps to the nearer side edge of that screen (any monitor).
  - **Tuck it away** (like the Xbox Game Bar ball): push it past the screen edge, hover it and press the small arrow, or right-click → *Tuck into the edge*. It becomes a slim glowing handle on the edge that pulses while Jarvis listens or speaks; click the handle to bring the orb back, or drag it up and down the edge.
  - **Right-click** for: Open Jarvis, Tuck / Bring out, Move to the other edge, **Hide the orb** (the tray icon brings it back).
  - It fades a little when idle and comes back when you hover it or Jarvis speaks; his words show beside it while he replies. Its spot is remembered (`mini.dock` setting).
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
| Database (history, tool calls, usage, reminders, tasks, calendar, meals, dictations, automations, settings) | `%APPDATA%\jarvis\jarvis.db` (SQLite with FTS5; schema in [Database](Database.md), migrations in [REFERENCE.md](REFERENCE.md)) |
| Backups (daily, 7 kept) | `%APPDATA%\jarvis\backups\` |
| Secrets (encrypted) | `%APPDATA%\jarvis\secrets.bin` |
| Logs (redacted) | `%APPDATA%\jarvis\logs\` |
| Voice models | `%APPDATA%\jarvis\models\` |
| Skills | `%APPDATA%\jarvis\skills\` |
| Claude Code working folder (subscription mode) | `%APPDATA%\jarvis\claude-code\` (empty; no transcripts kept) |
| Memory vault | your Obsidian folder (default `Documents\JarvisBrain`) |

---

## 7. Settings
**Changes wait for Save.** Editing anything in Settings (and in Automations or Skills) shows a bar at the bottom: "N unsaved changes · **Discard** · **Save changes**" (Ctrl+S saves too). Colours and the theme preview straight away and go back if you discard. Saving a change to the connection (`llm.provider`), the vault folder or meaning-based memory search asks **"Restart Jarvis now?"** — those apply live, but a restart gives them a clean start; choose Later to keep working. Keys (secret fields) still save with their own Save button, and changes you confirm in a dialog (allowed folders, tool permissions, vault folder) save as soon as you confirm.

Every setting, its type and default is listed in [REFERENCE.md → Settings](REFERENCE.md#settings). The ones that most change how Jarvis feels:
- `voice.mode` and `voice.followUpSeconds`
- `voice.wake.sensitivity` (0.5–0.6 is a good start)
- `voice.stt.provider` / `voice.stt.whisperModel` / `voice.stt.language`
- `llm.provider`
- `models.*`
- `budget.*`
- `location.home`
- `dictation.*`
- `telegram.*`, `appearance.theme`, `appearance.accent`, `appearance.orbStyle`
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
| 2.4 | **Tasks** (smart lists, lists, tags, natural-language quick add, priorities, reminders, repeats, subtasks, list / board / priority-matrix layouts, stats and streak, focus timer) and **Calendar** (day/week/month/schedule/year, colour calendars, drag to create/move/resize, repeating events, reminders, tasks on the calendar, free-time finder, .ics import/export), both fully controllable by Jarvis (`tasks`, `calendar` tools); the **Brain** gains 3D orbs, Clusters, Constellations, Mind map and Treemap views; the **mini orb** shrinks to its own size, docks to any screen edge, tucks away as a handle or hides, and the in-app corner orb can be moved or tucked |
| 2.3 | The accent tints the whole theme (backgrounds, borders, lines, grey text, shadows); 18 orb styles with live previews; Core is orb-only: click the orb to talk or start typing to open the chat, and the message box lives in the conversation log |
| 2.2 | Accent colour picker (ten neons, Windows colour dialog, hex) with automatic contrast; Settings changes wait for a Save bar (restart offered for big ones); Automations and Skills moved to the sidebar, Activity and Bible into Settings; sidebar hides (Ctrl+B, and by itself while Jarvis shows a panel); **panels beside the orb** (`show_panel`: pomodoro, usage & billing, system status, lists, stats, notes); particle-sphere orb with liquid ripples, orbiting shells, sparks and a glyph ring |
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
