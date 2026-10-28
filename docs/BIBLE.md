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
3. **Your choice of brain and ears.** Claude via API key, your Claude subscription, or a fully local model; cloud speech (Deepgram, Picovoice) or on-device speech (Whisper, an instant "Hey <name>" wake word, openWakeWord).
4. **Conversation, not commands.** Follow-ups without the wake word, "Jarvis" anywhere in a sentence, replies that know the context.

**Who it's for:** one person, "Sir", on his own Windows PC. It is a personal tool: some options (Claude subscription mode, the "Hey Jarvis" model, ideas from isair/jarvis) are licensed for personal, non-commercial use only. See §12.

---

## 2. Quick start

1. **Install:** run `dist\Jarvis-Setup-<version>.exe`, or download it from GitHub without building: **Actions** → latest green **ci** run → **Artifacts** → **Jarvis-Setup** (a zip with the `.exe`; built on every push, kept 30 days) (or `npm ci` then `npm run dev` from source; in VS Code terminals first run `Remove-Item Env:ELECTRON_RUN_AS_NODE`).
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

### 3.1 The brain: four connections
Settings → **Models & AI** (one active at a time):

| Connection | What it is | Notes |
|---|---|---|
| **Anthropic API key** | Claude via the Messages API, pay per use | Everything works, including computer control and Claude's web search. Daily/monthly **budgets** stop spending. |
| **My Claude subscription** | Your own signed-in **Claude Code** (via the Agent SDK) runs the loop; Jarvis's tools are served to it over in-process MCP | Personal use only. Sign in with Claude Code's own login. No computer control. Usage counts against your plan limits; shown as "API-equivalent" cost, never budgeted. ADR-010. |
| **Local model** | Ollama / LM Studio / any OpenAI-compatible server on this PC or home network | Free and offline with Ollama / LM Studio; quality depends on the model (Qwen 3, Llama 3.1+ support tools). No web search or computer control. ADR-013. A server that wants a key (FreeLLMAPI) gets one from **Server key**; FreeLLMAPI forwards to free cloud providers, so it is free but **not** offline or private (§3.5g). |
| **Another AI** (2.20; gateways 2.23) | AI companies: OpenAI (ChatGPT models), Google Gemini, DeepSeek, xAI Grok, Mistral, Groq. Gateways (one key, many companies' models): OpenRouter, Together, Hugging Face Inference Providers, Vercel AI Gateway, Requesty, DeepInfra, Fireworks, Ollama cloud. Each with your API key for that provider | The Provider list is grouped AI companies / Gateways, with a **docs** link and any provider note under the key (Hugging Face: the token needs "Make calls to Inference Providers"). DeepInfra and Fireworks publish no model list: type the model id from their website; **Test** then sends one 1-token request. Ollama cloud's list comes from ollama.com/api/tags. Same OpenAI-compatible translation as the local model, but every tool is offered. Paid per use on that account and counted in the budgets (unknown models are priced like the dearest Claude model, so the budget errs safe; add real prices to `pricing`). The provider addresses are fixed in `shared/llm-providers.ts`, never typed in. Pick the model from the provider's own list (**Refresh models**) or type its id. No computer control or Claude web search. A ChatGPT/Gemini app subscription is not API access. |

**Your ChatGPT and Gemini plans (2.21, Settings → Brain → Your AI subscriptions):** a ChatGPT (Free/Go/Plus/Pro) or Google AI Pro subscription isn't API access, so Jarvis uses each company's own app, signed in with your account, the way Paperclip and OpenClaw do: **ChatGPT through OpenAI's Codex CLI** (`npm i -g @openai/codex`, then **Sign in**) and **Gemini through Google's Antigravity CLI** (the old Gemini CLI login no longer works for personal accounts). They become brains `chatgpt` and `antigravity` for NPCs and sub-agents. They **only think and write**: Codex runs read-only with your own Codex settings ignored, Antigravity can't approve tools, and neither gets a task that read outside content. Each answer counts against that plan's limits (Codex spends about 15k tokens of your plan per call on its own instructions). **Test** sends "Reply with exactly: OK".

**Several AIs at once (2.20):** Jarvis stays the master. Every provider with a saved key and a model (plus the local model) is also a *brain* he can hand work to: `delegate_task` takes a `brain` per task (`jarvis`, `local`, any provider id from the table in [REFERENCE](REFERENCE.md), `chatgpt`, `antigravity`), so "ask ChatGPT and Gemini and compare" runs both side by side. Sub-agents on another brain run Jarvis's own loop, so every tool call still goes through policy, confirmations and Activity. Jarvis's prompt lists the brains that are set up; one that isn't is refused with the list. Their calls are billed as API spend whichever connection is Jarvis's own.

**Connections and models (2.25, integrations step 3; Settings → Brain → Connections and models):** every provider key you saved is a *connection*, and you can add up to five per provider (a work and a personal OpenAI account, a second OpenRouter key). Each connection has its own encrypted key (`openai`, then `openai_2`, `openai_3`…) and its own model registry: **Refresh models** fetches the provider's list (shown as *live*), models that drop off the list stay as *cached* until you remove them, and ids you type are *typed*. Star favourites (listed first), untick models to hide them, **Use** picks the one the connection answers with, **Test** checks it. Extra keys are brains of their own (`conn_openai_2`) for sub-agents and NPCs, billed on their own account, and one can be Jarvis's main brain (**Which key** under Another AI). The provider's main key is the same key as before (its model is still `llm.cloud.models`), so nothing set up earlier changes. Removing an extra connection deletes its key.

**Compare AIs (2.26, integrations step 4; sidebar → Compare AIs):** one request to 2–4 of the AIs you set up (Jarvis's own connection, the local model, other providers, extra keys, the ChatGPT / Gemini apps). **Compare**: all answer at once, side by side. **Review**: the first answers, the second lists what is wrong or missing and writes a better version. **Chain**: each stage gets your request, the previous stage's output and its own job ("check the facts", "make it shorter"); a failed stage stops the ones after it. Answers only: no tools, so nothing on the PC changes and no outside content is read; another AI's output is passed on marked as data, not instructions. Each answer streams in with its model, time, tokens and estimated cost; **Stop** cancels what is still running (the kill switch too). The page says which AIs will see the prompt before you send it. History keeps the last 50 runs (prompt and answers, on this PC) with delete and clear; runs still going when Jarvis closed show as cancelled. Usage is recorded per run (Usage counts it as "task"). From 2.27 the page shows the most the run may cost (every AI writing its longest answer; plan apps and this PC cost nothing per use) and asks before sending when that is over **Ask before a Compare AIs run that may cost over** (Settings → Brain → Budget, $0.05 by default).

**Usage per connection (2.27, Activity → Usage):** group spend by **Connection** (Anthropic API key, Claude plan, this PC, each provider key), by **Cloud / plan / this PC**, model, purpose or day. Prices come from Settings → `pricing` first, then the provider's own list for OpenRouter and Vercel AI Gateway (stored on **Refresh models**, shown next to each model as input / output per million tokens), else the dearest Claude model; calls at a guessed price are marked. All costs are estimates, not bills. Calls before 2.27 show as "Earlier".

**Coding agents on this PC (2.23, Settings → Brain):** lists Claude Code, Codex, Antigravity, Gemini CLI, GitHub Copilot CLI, Cursor CLI, OpenCode, Aider, Goose and Kimi Code with installed / not found, the version (npm installs only), how Jarvis uses it, the install command and a docs link. Found by file name only: nothing is run and no sign-in data is read. Gemini CLI onward are "found only" until their script mode is tested here. Status of every integration: [Integrations.md](Integrations.md).

Models: default (Sonnet 5.5), deep ("think hard", "plan" → Opus 5.5), fast (Haiku 4.5, for titles, summaries, memory curation and the voice intent judge), computer control. All editable.

### 3.2 Voice
**Window** (v2.15): no Windows title bar and no status bar, so the app runs edge to edge. Drag the window by any header row (or the sidebar's logo); double-click a header to maximise. Windows' minimise / maximise / close buttons sit in the top-right corner, coloured with the theme. Voice mode, model and today's spend are the corner readouts on Core; connection problems show as a dot on Connections.

**Conversation log** (v2.14): drag its left edge to make it wider or narrower (or focus the edge and use ←/→, Home/End; double-click resets). The width is remembered on this PC, and the orb always keeps at least 360 px. Long paths and words in replies wrap instead of pushing the log sideways; code blocks and tables scroll in place.

**Modes** (Settings → Voice):

| Mode | How you start | Notes |
|---|---|---|
| Off | type only | |
| Press to talk | the **Talk** (waveform) button by the message box, or `Ctrl+Alt+Space` | Jarvis answers aloud |
| Wake word | say the assistant's name: "Jarvis", "Hey Jarvis", or "Jarvis, open Notepad" in one breath | Detection runs on this PC; audio leaves only while listening (and never with Whisper). |
| **Always listening (on-device)** | say the name anywhere: "…what do you think, Jarvis?" | Everything is transcribed locally into a 2-minute memory-only buffer; a fast model judges whether you meant Jarvis and rewrites the request with context. The name alone ("Jarvis?") just starts listening. |

**The assistant's name** (2.8, Settings → General → Assistant name): call it anything (April, Friday, Nova…). The wake word, always-listening, the chat box, the sidebar and Jarvis's own replies all follow it ("I'm April"). Whisper's near spellings count ("Aprill", "Jervis"): one letter off, two for names of 8+ letters; very short names (3 letters) must match exactly. With a custom name the Laya filter steps aside (it was trained on "Jarvis").

**Engines** (chosen separately):
- **Wake word** (Settings → Voice → Wake word):
  - **Instant "Hey <name>" (best, the default from 2.28, ADR-044):** a tiny on-device keyword spotter (k2-fsa Zipformer, 3.3M parameters, run by sherpa-onnx) listens only for "Hey <name>", and for the bare name when it has 5+ letters ("Jarvis", not "Max"). Any name, no training: the name is spelled into the model's sound pieces on the fly. It wakes about 0.3 s after you finish "Hey Jarvis" and often before you finish a longer sentence, using 1–2 % of one CPU core, so "Hey Jarvis, open Notepad" works in one breath. Measured on 20 different synthetic voices: 94 % of "Hey Jarvis" caught, no false wakes in 9 minutes of tricky talk ("Travis", "Harvey", "harvest"). Recording **Your voice** (below) also tunes it: each of the five phrases is run through the spotter, and if your accent needs a more eager level, that level is saved (`voice.wake.spotterLevel`; it can only make it more eager, never stricter). Needs an 18 MB download once (also part of **Set up free on-device speech**, which switches the slower "by speech recognition" engine to this one). Names must be written in English letters.
  - **Your own recorded "Hey <name>" (2.24, ADR-043):** the five phrases you record in **Your voice** (Voice Match, below) become the wake word. Any name, any accent, on this PC, instant (no transcription). Each phrase is kept as a pattern of the openWakeWord speech features (one every 80 ms, never the audio); while listening, the latest features are lined up against each pattern with dynamic time warping, so a quicker or slower "Hey Jarvis" still matches, and the match level comes from how much your own five phrases differ (the sensitivity moves it). With the default name the "Hey Jarvis" model listens too, so either wakes him. Needs the small "Hey Jarvis" model download (4 MB). Recording your voice switches to it automatically (unless Picovoice or the instant wake word is chosen); renaming the assistant drops the pattern (record again).
  - **Your name by speech recognition** (the default from 2.8 to 2.27): on-device Whisper transcribes each phrase and listens for the name. Works with any name, hears "Jarvis" and "Hey Jarvis", and takes the request in the same breath. Needs the free on-device speech models (one click, ~100 MB). It must wait for you to pause (`voice.endSilenceMs`, 1 s) and then for Whisper to finish (small.en: about 0.7 s on a 4-core CPU for a short phrase, more while other apps are busy), and it drops phrases when Whisper falls behind, which is why it felt slow and sometimes deaf. Prefer the instant wake word.
  - **Keyword model "Hey Jarvis" only** (openWakeWord, 4 MB, non-commercial licence): lightest on the CPU; it was trained on synthetic, mostly American voices, so it can miss accents. Raise the sensitivity (0.6–0.7) if it does, or record your own.
  - **Picovoice "Jarvis" only** (needs a free key).
  - The openWakeWord and Picovoice keyword engines only know "Jarvis", so a custom name uses the name engine unless you chose the instant wake word or recorded your own "Hey <name>".
  - **Every wake is logged (2.28):** the instant wake word writes `wake word heard` with the phrase and level. **Near misses are logged (2.24):** a "Hey Jarvis" that came close but didn't wake him writes `wake word near miss` with its score (keyword model) or distance (your own) to the log (Settings → Activity → Logs), so you can see whether to raise the sensitivity.
- **Voice Match** (v2.14, ADR-039; Settings → Voice → Your voice), like "Hey Google" setup: download the voice recognition model once (WavLM, 102 MB, on this PC), then say "Hey <name>" five times. Each phrase becomes a voice fingerprint straight away and the recording is dropped; the average fingerprint is saved encrypted with the other secrets, and a match strictness is set from how alike the five phrases were. From 2.24 the same five phrases also become your personal wake word (above) when the "Hey Jarvis" model is downloaded. With **Only answer to my voice** on, the wake word by name and Always listening ignore other voices (a guest, the TV); press to talk always works. If on-device speech is downloaded, enrolment also notes how it spells the name in your voice ("some are" for Summer) when it hears the same spelling at least twice, and that spelling wakes Jarvis too (cleared when the name changes). Keyword engines (openWakeWord, Picovoice) don't pass their audio, so Voice Match doesn't apply to them. Not a lock: a recording of your voice or a cold can fool or miss it. **Set up again** / **Forget my voice** in the same place.
- **Speech-to-text** (v2.13, ADR-038; every choice is a card with where it runs, cost, speed, quality and languages, from `shared/speech-engines.ts`):
  - **On this PC** (free, offline; one download per model, pinned and SHA-256 verified), fastest to most accurate: **Moonshine tiny / base** (built for short commands, English), **Whisper tiny.en / tiny / base.en / base / small.en (default) / small**, **Distil-Whisper small.en** (near small.en, quicker), **NVIDIA Parakeet 0.6B** (top English accuracy, one pass, ~610 MB), **Distil-Whisper large-v3.5** and **Whisper large-v3 turbo** (most accurate; slow on a laptop CPU). Multilingual ones take the language setting (Hindi, Telugu…).
  - **Deepgram Nova-3** (cloud, live text as you speak).
  - **Groq Whisper** (free tier), **OpenAI transcribe**, **ElevenLabs Scribe v2** (same key as the voice), **AssemblyAI** (slowest): the on-device voice detector (Silero, 2 MB) hears when you stop, then only that phrase is sent. No live words while dictating with these (each re-read would be another paid request).
  - **Your own speech server**: any program with OpenAI's transcription API (Speaches/Faster-Whisper, Parakeet or Canary servers, LocalAI), on this PC or the home network (plain http only there; https anywhere).
  - **Windows speech recognition**: built in, offline, no download, least accurate.
  - A cloud engine without its key falls back to on-device speech when it is downloaded. Always listening and the wake word by name always use the on-device model.
- **Voice out** (ADR-028): **Microsoft Edge** neural voices (online, free, the default); **Kokoro** (Kokoro-82M, the best-rated open voice model of its size, runs on this PC: one-time 330 MB download in Settings → Voice, seven voices led by four British men, needs the free [eSpeak NG](https://github.com/espeak-ng/espeak-ng/releases) program installed; on this laptop's CPU it speaks about twice as fast as real time, so the first words of a long sentence take a second or two); **ElevenLabs** (cloud, the most natural; needs an API key; v4 Turbo by default, Daniel or George or any voice id from your library; the words Jarvis says are sent to ElevenLabs); **Windows SAPI** (offline, robotic). v2.13 (ADR-038) adds **Piper** (on this PC, the lightest neural voice: 10 voices of 60–120 MB each, British, American, Hindi and Telugu; needs eSpeak NG; each voice's licence is shown, some are personal-use only), **OpenAI voices** (13 voices, plus a plain-words style note for GPT-4o mini TTS), **Deepgram Aura-2** (same key as Deepgram; British and Australian voices), **Groq Orpheus** (expressive, free tier, American English, 200 characters per request so long sentences are split) and **your own voice server** (OpenAI's speech API: Chatterbox voice cloning, Orpheus-FastAPI, XTTS v2 / F5-TTS through AllTalk or openedai-speech, Kokoro-FastAPI; these need an NVIDIA GPU for real time). If the chosen engine fails, Jarvis says it with Edge, then Windows, and a toast says why once.

**Conversation behaviour (ADR-012)**
- **Instant replies** (2.20, `voice.greet`, on by default; Settings → Voice): woken by name or wake word, Jarvis answers at once with a stock line ("Yes, sir?", "I'm listening, sir.", never the same twice running). A request that goes to the model gets "On it, sir." / "Right away, sir." first; the real answer plays right after it instead of cutting it off. No model call. Quick commands and routines keep their own reply. Turn it off to say the request in the same breath as the name.
  - **2.24:** all the lines are rendered when voice starts (and again after a voice change), so even the first "Yes, sir?" plays at once instead of waiting 3–9 s for an on-device voice like Kokoro. With **echo cancellation** the mic opens *with* the greeting, so words said straight after the name are kept; if the greeting leaks through, that phrase is dropped and Jarvis keeps listening. Without echo cancellation he still listens once the line has played. Saying the wake word again while he greets or listens no longer starts the greeting over (before 2.24 repeating "Hey Jarvis" kept the mic from ever opening).
- **Startup hello** (2.24, `voice.startupGreeting`, on by default; Settings → Voice): when Jarvis starts he says good morning/afternoon/evening, the time, today's events still ahead (the first one by name and time), tasks due and overdue, or that the day is clear, then asks "What shall we do?" and opens the mic for the follow-up window (`voice.followUpSeconds`). No model call; skipped in quiet mode or with voice off.
- **Voice Match rejections are explained** (2.20): when the name is heard but the voice doesn't match the profile, a toast says so with the score and the strictness (at most every 2 minutes) instead of silently ignoring you.
- Follow-ups need no wake word (or hotkey, in press-to-talk) for a few seconds after each spoken reply (`voice.followUpSeconds`, default 6; the window opens silently).
- Jarvis waits for a real pause before answering (`voice.endSilenceMs`, default 1000 ms; raise it if he cuts you off mid-sentence). Spoken replies actually answer in 1–3 natural sentences and may end with a short follow-up question; only long material (tables, code, links) goes to the screen.
- Voice turns continue the same conversation for 15 minutes.
- A wake word while Jarvis is still thinking does **not** throw the answer away; a new request replaces it only when you actually say something.
- Jarvis ignores its own voice coming back through the mic, and asks again when it hears a one-word mishearing.
- Barge-in: press the hotkey while Jarvis talks, or (2.12) just say his name: with **echo cancellation** (Settings → Voice, on by default) the microphone no longer hears his own voice, so the wake word interrupts him even through speakers (§3.5e). With echo cancellation off, the wake word is ignored while he speaks unless `voice.bargeIn` is on (use headphones then).
- **Laya listening filter** (ADR-027; Settings → Voice; off by default): in always-listening mode a 1.3 GB on-device model ([Laya](https://github.com/NandhaKishorM/laya)) first decides whether the newest phrase is for Jarvis. **Watch only** runs it next to Claude and logs how often they agree (numbers only, never words: Settings → Activity → Logs, "Laya shadow"). **On** skips the Claude call when Laya gives the phrase less than a 30 % chance of being for Jarvis; a phrase that *starts* with "Jarvis" / "Hey Jarvis" always goes to Claude. It never holds anything up: while it loads (about 15 s after start, including a SHA-256 check of every file), or if it takes over 1.5 s or fails, Claude decides as before. The model is not downloadable in-app yet; install it with `npm run laya:install <folder>` (see §8).
  - **What Laya can and can't do (2.9):** it answers small multiple-choice questions about text in one quick pass; it does not write text, so it can't hold a conversation or plan a task and can't replace Claude. It saves Claude calls in two places: this listening filter, and **Fast commands** (§3.4), where it understands loosely worded PC commands. With a custom assistant name the listening filter steps aside (its labels say "Jarvis"); fast commands still use it.
- **On-device models never slow the app (2.9, ADR-029):** Whisper, Kokoro and Laya run in a separate background process ("Jarvis models", below-normal priority) instead of the main process. onnxruntime-node runs a model synchronously, so before 2.9 every transcription, every spoken sentence and every Laya decision froze the whole app for 0.9–2.8 s (measured on this laptop; whisper-small.en longer); now the main process stalls at most ~50 ms. Each model uses at most half the CPU threads (up to 4). If that process ever stops, the next request starts it again. On a laptop CPU **base.en** is still the Whisper model to pick: small.en is more accurate but slower than you speak.
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
- **Learning:** after each turn a small model (the curator) proposes memory updates. Anything that looks like an instruction goes to a review queue (Memory view) instead of being saved. Facts are labelled by source (plain = you said it, "(inferred)" = a guess, "(read)" = from something Jarvis read; "(read)" facts always wait for review), and facts that stopped being true move to a `## History` section with the month they ended (2.17, §3.5f).
- **Your edits:** changes you make in Obsidian are picked up within seconds.
- **Smarter recall (2.19, §3.5g):** an optional on-device re-ranker orders found notes by how well they answer you, a weekly reflection writes patterns to `Facts/Observations.md`, and `recall_earlier` brings back the exact words a long chat folded into its summary.
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
- **Fast commands (2.9, ADR-030; Settings → Models & AI → Fast commands):** short, plain PC commands typed or spoken run their one tool straight away with **no Claude call** (instant, no tokens), through the same safety policy and audit as any tool: "open Spotify", "launch notepad", "volume 30" / "set the volume to 30%", "mute" / "unmute", "pause" / "play", "next song", "previous track", "stop the music", "lock my PC". With **Rules + Laya** (the default; needs Laya installed) loosely worded ones also work ("ugh, skip this song", "shh"), but only when Laya is at least 85 % sure and well ahead of every other choice, and only for requests of 9 words or fewer. Anything longer or unclear ("open my downloads folder", "open notepad and type hello") goes to Claude as before. A custom assistant name in front ("Summer, open Spotify") is understood. Only numbers are logged (`fast path` in the log), never what was said.
- **Apps and windows:** open and close apps, list open windows, lock, sleep, shut down or restart (asks first).
- **Media and settings:** media keys, volume, brightness, battery and system info.
- **Files** (only inside the allowed folders):
  - Search, read and write text files.
  - Read PDF, Word, Excel and PowerPoint files (`read_document`, 2.19).
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

### 3.5c Ideas from smaller Jarvis projects (2.6)
In October 2026 the Jarvis repositories on GitHub just below the six most-starred were surveyed (Gladiator07/JARVIS, BolisettySujith/J.A.R.V.I.S, kishanrajput23, Julian-Ivanov, sosoj92, Avinashb722, JashanMaan28/Zorin, eadmin2/jarvis_ai, IRISX-AI and others). Most of their features Jarvis already had; these were missing and are now built in (ideas only, no code copied):
- **Wikipedia:** "Who is Ada Lovelace?" → `wikipedia` gives a short summary with the article link (any language, e.g. Hindi with `lang: hi`). Cheaper and faster than a web search for encyclopedic facts.
- **Dictionary:** "What does serendipity mean?" → `define_word`: pronunciation, meanings, examples, synonyms (Free Dictionary API, no key).
- **How far is it?** "How far is Delhi from here?" → `distance_between`: straight-line km and miles plus a rough flight time (Open-Meteo place lookup).
- **Snap windows:** "Put Chrome and VS Code side by side", "snap Spotify to the right", "tile my four windows" → `arrange_windows`: columns, rows, 2×2 grid, one big window with the rest stacked, or one half of the screen. Main screen only.
- **Save a screenshot:** "Take a screenshot and call it invoice" → `save_screenshot` saves a full-resolution PNG to **Pictures\Jarvis** after you confirm (never overwrites). The picture stays on the PC; Jarvis doesn't look at it.
- **Personality:** Settings → General → **Personality** (Butler, Concise, Friendly, Sarcastic, Coach), or say "be more concise" / "back to normal" (`set_personality`). Only the tone changes; the safety rules never do.
- **Quiet mode (do not disturb):** "Be quiet for an hour" (`quiet_mode`, up to 4 hours by voice) or Settings → General → **Quiet mode** (30 min / 1 hour / 3 hours). Until it ends, reminders, briefings and automations arrive silently as in-app toasts: no Windows pop-ups and nothing spoken. Replies when you talk to Jarvis are unchanged.
- **QR codes:** "Show a QR code for my Wi-Fi" → a **QR code** panel beside the orb, drawn on this PC (nothing is sent anywhere); a Wi-Fi password is shown as dots under the code.
- **Live system monitor:** "Show my system stats" → a **System monitor** panel: CPU with a live graph, memory, system-drive space, battery and uptime, updated every two seconds.

### 3.5d Ideas from four more Jarvis projects (2.7)
In October 2026 four more repositories were compared with Jarvis (ideas only, no code copied):
- **ethanplusai/jarvis** (a voice for Claude Code on macOS) gave the most:
  - **Claude Code sessions:** Jarvis watches every Claude Code session on this PC (read-only, through the Agent SDK's own session API) and **says out loud when one is stuck waiting for you**, e.g. "Sir, Claude Code in Jarvis is waiting on you; it wants to use Bash." Ask "which of my Claude sessions need me?" (`claude_sessions`). A tool call left unanswered for 20 seconds counts as waiting (usually a permission prompt; a very long command can look the same). Each session is announced **at most once every 15 minutes** (2.22: a long build used to flip it between "working" and "waiting" and announce it a dozen times). Spoken notices (Claude Code, reminders) **wait for a lull**: while you and Jarvis are talking, listening, thinking or speaking, and for 10 seconds after, they are held and said afterwards, so they never cut a reply off; the pop-up still shows at once. Settings → Everyday → **Claude Code sessions**: speak up when one is waiting (default), also when one finishes, or never. Quiet mode silences it.
  - **Start a session by voice:** agree what to build, then "start Claude Code on it" → `start_claude_session` opens Claude Code in its own window in that project folder with the brief, after you confirm. Claude Code's own permission prompts stay in charge, and the watcher tells you when it needs you. Only folders Jarvis may use; any `ANTHROPIC_*` key is removed so it stays on your plan.
  - **Own worktree (2.11, idea from Paperclip and Munder Difflin):** "start another session on Jarvis, on its own branch" → the session runs with Claude Code's `--worktree`, in `<repo>/.claude/worktrees/jarvis-<date-time>` on its own branch, so two sessions in one repo never overwrite each other's files. Only for the top folder of a git repository. Merge or delete the branch afterwards as usual.
  - **Build it like another app (2.9, ADR-031):** "build a command palette like Raycast's" → Jarvis starts the session with **REA** ([morluto/rea](https://github.com/morluto/rea), MIT, "Reverse Engineer Anything") attached for that session only (`--mcp-config`, `rea-agents@6.4.0` through npx, fetched the first time). The brief tells Claude Code to study how that app does it first, without its source (Electron/JavaScript bundles, .NET, native programs, websites), show the evidence, then build its own version without copying code, assets or text. The confirmation names the app to be studied. REA needs **Node.js 22.19+ (or 24.11+)** on the PC; Jarvis checks and says so if yours is older (this PC had 22.15).
  - **Plan usage:** Activity → Usage shows the Claude plan's 5-hour and weekly windows (percent used, reset time) as Claude Code reports them after each subscription reply; ask "how much of my Claude plan is left?" (`claude_plan_usage`).
- **kishanrajput23/Jarvis-Desktop-Voice-Assistant:** **play music from your own library**: "play some Coldplay" → `play_music` builds a playlist of the matching songs in your Music folder (artist, album, folder or song name; shuffled) and opens it in your default player. `media_control` pauses or skips. Its other features (time, date, Wikipedia, screenshots, shutdown, YouTube, two languages) Jarvis already had.
- **ascending-llc/jarvis-registry** is an enterprise MCP gateway (OAuth, per-tool ACLs, audit, A2A agents). Jarvis already covers the desktop part: MCP connections with per-tool policy overrides, a hash-chained audit log and the MCP Registry browser. Nothing new was needed.
- **zouhir/jarvis** is a webpack build dashboard, not an assistant; nothing applies.

### 3.5e Ideas from four more projects (2.12)
Ideas only, no code copied (rule: study, then write our own): LibreChat (MIT), Open-LLM-VTuber (MIT), camofox-browser (MIT) and HyperFrames (Apache-2.0).
- **Artifacts in chat** (LibreChat, ADR-033): when something is clearer seen than read (a diagram, a chart, a small calculator or game), Jarvis replies with a live preview card. HTML pages, SVG drawings and Mermaid diagrams render in a sandbox that can't reach the internet, Jarvis or your files. Buttons: code ↔ preview, full screen (Esc closes), save as .html / .svg. Try "draw the release flow as a diagram" or "make me a tip calculator".
- **Context meter and `/compact`** (LibreChat): the comms log header shows how full the conversation's context is (accent, amber above 60 %, red above 85 %). Click it for the split (conversation, tool traffic, instructions/memory/tools) and **Compact now**, or type `/compact`: everything so far is folded into a short summary, so long chats get cheaper and faster.
- **Search all chats** (LibreChat): Conversations → *Search all chats* finds past chats as you type (word starts count; all words first, then any), matched words highlighted. `/private` chats are included here because it is your own history; Jarvis's own recall still skips them.
- **Import ChatGPT / Claude history** (LibreChat): Settings → Memory → *Import chats from ChatGPT or Claude*, pick the export .zip (or its `conversations.json`). Each chat becomes a note in `Memory/Imports/ChatGPT/` or `Memory/Imports/Claude/`, searchable like any memory; importing again skips chats already there. Only the ChatGPT branch you last saw is kept; system and tool messages are left out. Nothing is uploaded.
- **Sub-agents** (LibreChat, ADR-037): for a bigger job Jarvis hands up to four independent pieces to sub-agents that work side by side (`delegate_task`), each in a fresh context with only the tools Jarvis names. Every tool call they make still goes through the policy, confirmations and the Activity panel.
- **Jarvis drives his own browser** (camofox-browser, ADR-035): a snapshot of the page in Jarvis Browser lists its links, buttons and fields as `[e1]`, `[e2]`… (visible things only). Jarvis clicks (a real mouse click), types (real keystrokes), picks drop-down options, presses keys and scrolls by those refs, so he can work on sites you are signed into there. Clicks that commit something (Buy, Pay, Send, Post, Delete, Submit…) and pressing Enter ask first; typing asks first once he has read the page; password, card and code fields are refused. camofox's anti-bot fingerprint spoofing was deliberately left out.
- **YouTube transcripts** (camofox-browser): "summarise this video" with a link reads its captions (`youtube_transcript`, no API key; auto-generated captions count), with timestamps, in your language when the video has it. The research agent can use it too.
- **Mood on the orb** (Open-LLM-VTuber): each reply opens with a hidden mood (calm, happy, amused, excited, curious, concerned, serious) that is never shown or spoken; the orb takes its tint and liveliness for 30 s. Warnings and errors keep their colours. Settings → General → *The orb shows Jarvis's mood*.
- **Interrupt without headphones** (Open-LLM-VTuber, ADR-034): the microphone opens in a hidden capture window with Chromium's echo cancellation (Settings → Voice → *Echo cancellation*, on by default), so Jarvis no longer hears himself and saying his name cuts him off mid-reply even through speakers. If that microphone can't start, Jarvis falls back to the old one by itself.
- **Look through the camera** (Open-LLM-VTuber): "what is this I'm holding?" → `look_through_camera` takes one photo after you approve; the camera turns off straight after and nothing is saved.
- **Make a video** (HyperFrames, ADR-036): "make a 10-second intro for my channel" → Jarvis writes the animation as an HTML page and HyperFrames renders it on this PC to MP4, GIF or WebM in `Videos\Jarvis\` (asks first). Needs Node.js 22+ and FFmpeg (`winget install --id Gyan.FFmpeg -e`); the first render downloads HyperFrames (about 60 MB) through npx, with its telemetry switched off. The 21 HyperFrames skills are installed (Settings → Skills); only `hyperframes-core` is on.

### 3.5f Ideas from ruflo (2.17, ADR-041)
[ruvnet/ruflo](https://github.com/ruvnet/ruflo) (MIT, formerly Claude Flow) is an agent-swarm layer for Claude Code. Its source was read in October 2026; these ideas fit a one-person desktop assistant and were rebuilt in our own code (no code copied). Its swarms, federation and "self-learning" neural parts were left out (see ADR-041).
- **Budget warnings:** at 50 %, 75 % and 90 % of the daily or monthly API budget a toast (and a Windows notification unless Quiet mode is on) says how much is used, before spending stops at 100 %. Each step is said once per day (or month). API key only; the subscription and local models have no budget.
- **Where a memory came from:** the memory curator now labels each fact. Your own words are saved plain; a guess is saved as "… (inferred)"; something Jarvis only read (a web page, file, email) is "… (read)". Facts that only came from something Jarvis read never go straight into memory: they wait in the Memory review queue, so a web page can't write itself into what Jarvis believes about you. Guesses about `About Sir.md` and `Preferences.md` (read on every turn) wait for review too. When you confirm a guess, its "(inferred)" goes away.
- **Facts keep their history:** when something changes ("I moved to Avaan"), the old fact moves to a `## History` section at the bottom of the note with the month it stopped ("- Sir works at Infosys (until 2026-10)") instead of being deleted. "Where did I work before?" still works. "Forget X" still deletes.
- **Prompt-injection warning:** every untrusted result (web page, file, email, screen text, MCP answer) is scanned for text aimed at an AI ("ignore previous instructions", "Jarvis, open…", fake "SYSTEM:" lines, "send your passwords to…", hidden characters). If it finds one, Claude gets a safety notice next to the content, and **every action for the rest of that request asks you first**, even ones that normally just run. The dialog says why ("Suggested after reading file:…mail.txt, which tells the AI to ignore its instructions"). The audit log records which rules matched, never the page text. It catches obvious attacks only; the wrapping, taint and confirmations stay the main defence. A guide that talks about chatbots ("the assistant should open with a greeting") can trigger it; then you just get a few extra confirmations.
- **Private data stays in:** if a tool returns a key, password, card number, OTP or ID number, anything after that in the same request that reaches outside the PC (open a link, send a message) asks first.
- **Automation watchdog:** when an automation runs while you're away and the safety layer holds something back (a blocked action, a confirmation nobody answered, a prompt-injection attempt), you get a warning afterwards: "While running "Bills", the safety policy blocked: Run a script." (audit: `task.watchdog`).
- **Approaches that worked:** after a request where two or more tools all worked ("open Spotify and set the volume to 30"), Jarvis remembers which tools it used, in order (tool names only, never what was typed or read). Once the same kind of request has worked twice, the next similar request gets a one-line hint ("open_app → set_volume worked (3×)"). It stops hinting an approach that keeps failing. Private chats, automations, fast commands, requests that read outside content and requests where you declined something never teach it.
- **Fallback to your local model:** Settings → Models & AI → *If Claude is busy or unreachable, let my local model answer* (API connection, off by default). When Claude is overloaded or the internet is down before any words appeared, your Ollama / LM Studio model answers instead, free, and a note says so (at most every 10 minutes). Pick the local model in the card that appears. Computer control and anything with a picture (screen, reply copilot) never fall back: they need Claude.
- **Checkpoints in routines:** a routine step `ask_to_continue` stops and asks before going on ("Turn the volume up?"). Say no (or Cancel) and the routine stops there.
  ```yaml
  steps:
    - tool: ask_to_continue
      input: { message: "Start the meeting setup?" }
    - tool: open_app
      input: { name: "Teams" }
  ```
- **Compare eval runs:** `npm run evals:compare` compares the two newest `npm run evals` runs (or two files you name) and lists what now fails, what now passes and the cost. It exits with an error if anything regressed, so run evals before and after changing a prompt and keep the change only when nothing broke. Free: it only reads the saved results.

**Added in 2.18:**
- **Browser recipes:** after Jarvis has done something in Jarvis Browser ("log in to my electricity site and open the latest bill"), say "save that as my power bill routine". The confirmation lists every step (pages opened, clicks, choices, typing); approve it and it becomes a normal routine note in `Routines/`. Run it again by name or its trigger phrase. Each saved step finds its button or field **by name** on the fresh page (waiting up to 10 s for it to load), so it keeps working when the site changes its layout a little. Every step is checked again when it runs: clicks that send, buy or submit still ask, password and card fields are still refused, and a saved click that turns out to be a submit button stops instead of clicking. Only the newest 30 steps of a conversation are kept, in memory, until you save them.
- **Goals:** "my goal is to run a half marathon by March: 5 km, 10 km, 15 km" → `goals` puts it in a **Goals** list in Tasks with the milestones as subtasks and March as the target. "How are my goals going?" shows each one as on track, behind, overdue or done, comparing milestones ticked with how much of the time has passed (behind = more than 15 % slower than the calendar). Tick milestones like any task. Automation template **Goal check** (Sundays 6 pm) speaks up only about goals that are behind.
- **Memory tidy-up:** once a day Jarvis looks for memory notes that seem to be the same person or project ("Priya" and "Priya Sharma") or topic notes with mostly the same facts, and puts a merge suggestion in Memory → Review (at most 5 a day). Accepting adds the missing facts to the note that is kept; you delete the other one in Obsidian. A suggestion you reject is never made again. No AI model is used and nothing is changed without you.
- **Ignored nudges:** if you don't answer a check-in or task automation five times in a row (no reply in its conversation), Jarvis suggests pausing it, once. It never pauses anything itself. Briefings don't count (they're meant to be listened to).

### 3.5g Ideas from eight more projects (2.19, ADR-042)
Twelve repositories were studied (ideas only, our own code). Four had nothing for a Windows desktop assistant: **tokenspeed** (data-centre GPU inference), **agent-substrate** (Kubernetes sandboxes), **gpui-kit** (a Rust UI toolkit) and Hindsight's / WeKnora's Docker servers themselves. What came in:
- **Read documents** (idea from Tencent/WeKnora): "summarise the contract in Downloads", "what's the total in budget.xlsx?" → `read_document` reads the text of **PDF, Word (.docx), Excel (.xlsx) and PowerPoint (.pptx)** files in the allowed folders, page by page, sheet by sheet or slide by slide. On this PC, no Office needed; nothing in the file is ever run. Scanned PDFs (pictures only) give little text. What it reads is untrusted, and facts from it wait for your review before entering memory.
- **Re-ranking** (idea from vectorize-io/hindsight): Settings → Memory → **Smarter recall** → Download (23 MB, on this PC). After keyword and meaning search find candidate notes, a small cross-encoder reads your question together with each one and keeps those that really answer it. Off or not downloaded = the old order.
- **Weekly reflection** (Hindsight's "reflect"): once a week the fast model reads your memory notes together and writes patterns that several notes show ("Sir plans trips around cricket matches") to `Memory/Facts/Observations.md`, each marked "(inferred)" and linked to the notes behind it. Instruction-like or doubtful ones go to Memory → Review. Turn it off with `memory.reflect`. Costs one small fast-model call a week.
- **Recall earlier** (idea from ranxianglei/billion-context's decompress): long chats keep the newest 30 messages word for word and fold the rest into a summary. `recall_earlier` brings back the exact folded words when the summary lost a detail ("what was the GST number I gave you at the start?").
- **Skill libraries** (anthropics/knowledge-work-plugins, K-Dense-AI/scientific-agent-skills, cathrynlavery/diagram-design, affaan-m/ECC): see §3.7. A link to a whole repo installs every skill in it, turned off; big skills keep their instructions and docs and drop extra example files instead of failing; every skill is scanned for prompt injection (idea from ECC's AgentShield).
- **Cua Driver** (trycua/cua, MIT): a Connections preset under **Desktop control**; see §3.11.
- **FreeLLMAPI** (tashfeenahmed/freellmapi, MIT): works as a **Local model** server (`http://localhost:3001/v1` plus its key). It is **not** offline or private: it forwards every message to free cloud providers. Settings says so.
- Not taken: Hindsight's and WeKnora's servers (they need Docker, Postgres or Neo4j; their ideas were enough), ECC's "instincts" (Jarvis's curator already stores confidence and source per fact), and Cua's admin auto-start (a daemon running elevated at every logon).

### 3.6 Web and research
- **Web search:** Claude's own search (API connection), or Claude Code's search (subscription connection). Results count as untrusted.
- **Read a page:** `fetch_web_page` reads public pages only, at most 2 MB, re-checking every redirect.
- **Long results stay searchable** (2.10, idea from mksglu/context-mode): any tool result over 20 KB (a long page, log or MCP answer) is no longer cut off. Jarvis sees the first 8 KB plus an id like `o3`; the full text sits in an in-memory search index (SQLite FTS5) and `search_tool_output` finds the relevant parts or reads a part by number. Saves tokens and loses nothing. Memory only, never on disk; scoped to the conversation; the oldest of 30 (8 MB) are dropped. Untrusted text stays wrapped as untrusted when read back.
- **Deep research** (ideas from OpenJarvis): "Research X" runs a separate reading-only agent. It plans sub-questions, searches, reads sources and returns a **cited report**, saved to `Research/`.
- **News feeds:** RSS/Atom headlines from your feeds (Sidebar → Automations → News feeds); the defaults are Hacker News and BBC World.

### 3.7 Skills (ideas from OpenJarvis / agentskills.io)
A skill is a folder with `SKILL.md` that teaches Jarvis how to do a kind of task.
- **Install:** Sidebar → **Skills**, from a folder or a public GitHub folder link. Only text files are kept.
- **Use:** Jarvis sees each skill's name and description and loads the full instructions with `use_skill` when a task matches.
- **Libraries (2.19):** a link to a whole repo or folder (for example `https://github.com/anthropics/knowledge-work-plugins`) installs every skill in it, **turned off**, so only the ones you switch on are added to each request. One link can add up to 400 skills; skills with the same name are installed once. Sidebar → Skills shows every skill as a **network of dots** (2.22), clustered by group (Code & dev, Design & UI, Data & research, Writing & content, Business & ops, AI & agents, Testing & quality, Security, Other — read from each skill's name and description). Lit dots are on. Search dims what doesn't match (Enter jumps to the first hit), group chips hide a group, and clicking a dot opens a side panel to read it, switch it on or off, or remove it.
- **Big skills:** a skill keeps SKILL.md, then its Markdown docs, then other text files, up to 200 files and 5 MB; extra example files are left out (you're told how many) instead of the install failing.
- **Scanned:** every installed skill is checked by the prompt-injection scanner. Medium findings are shown; a skill that tells the AI to ignore its rules, leak data or similar is installed turned off, with a note to read it first.
- **Safety:** skills never run code. Every action still asks you as usual. Review, turn off or remove skills in Settings.
- **Forge (2.39):** **Use in Forge runs** (in a skill's details) gives its instructions to Claude when Forge builds changes to Jarvis (§3.22).

### 3.8 Automations (ideas from OpenJarvis)
Settings → **Automations**, or just say "every Friday at 5 pm summarise my week".
- **Kinds:**
  - **Briefing:** spoken and saved to `Briefings/`. A switched-off **Morning briefing** preset is included (weather, reminders, headlines, memory).
  - **Task:** do something and report.
  - **Check-in:** speaks up only when something is worth saying.
- **When (2.9 adds the last three):** at a time on chosen days, every N minutes, **once** on a date and time, **monthly** on a day (29–31 run on the last day of shorter months), or **each time Jarvis starts** (after a delay you choose; 20 s grace for startup to settle). Say "on the 1st of each month check my bills", "tomorrow at 9 remind me…", "each time you start, tell me what's overdue".
- **Templates (2.9):** Evening wrap-up, Weekly review, When I start Jarvis, Late-morning focus nudge, Monthly bills check, Lunchtime news, Stretch and water break, Claude Code watch. **Use this** fills the editor so you can adjust before saving.
- **Buttons:** Run now, **Last result** (opens its latest conversation), Edit, **Duplicate** (a switched-off copy to change), Delete.
- **When they run:**
  - Only while Jarvis is running.
  - Runs missed by more than 2 hours are skipped.
  - Each run is a normal conversation, so confirmations still ask you.
- **Spending cap and auto-pause (2.11, ideas from Paperclip and Open Dots):** one run is stopped once it has cost **$0.50** (Settings → Models & AI → *Per automation run*; on the subscription this is the API-equivalent cost; 0 turns it off), and that automation **switches itself off**. Three failed runs in a row switch it off too. Either way you get a notification and its last result says why ("paused: …"); switch it back on in Automations. Runs you stop yourself don't count as failures.
- **Watchdog (2.17):** if the safety layer held anything back during a run (blocked action, unanswered confirmation, prompt-injection attempt), a warning tells you afterwards what it was (§3.5f).

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

**2.9 fixes and additions:**
- **Read chat on screen** button in the panel: Jarvis minimises itself, reads the chat behind it, and comes back (before, pressing anything inside Jarvis made it read its own window). Saying "help me reply" while Jarvis is in front works the same way.
- **Pasting goes back to exactly the captured window** (by its window handle) and tolerates unread counters in the title ("(3) WhatsApp", "Slack | #team | 2 new items"); before, a changed counter made pasting fail with "window gone" or "chat changed". A different chat (another Slack channel) still refuses.
- **Group chats** work (each message keeps its sender's name); before they were refused.
- **Remembers who each contact is** (scene and relationship, last 300 contacts, stored only in Jarvis's database) and preselects it next time.
- **Quick replies:** three short replies at once, without the analysis and checks.
- **Rewrite any reply:** Shorter, Warmer, Firmer, Formal, Casual, + Emoji, or **Translate** into a language you type. Rewrites never add promises, facts or decisions.
- Replies are written in the chat's own language and script (Hinglish stays Hinglish).

### 3.11 Connections (MCP)
Sidebar → **Connections** → **Add connection**. Three tabs:
- **Catalogue** — vetted, version-pinned servers grouped by category, with a filter box and "needs key / no key / hosted" tags:
  - **App hubs (one connection, many apps):** **Zapier** (9,000+ apps: Gmail, Sheets, Slack, Calendar… you choose the actions at mcp.zapier.com) and **Apify** (thousands of ready-made scrapers).
  - **Browser & files:** Playwright browser, Chrome DevTools, scoped Filesystem.
  - **Web search:** Brave Search, Tavily, Exa, Firecrawl, Perplexity.
  - **Docs & knowledge:** Context7 (library docs), Microsoft Learn, DeepWiki (no keys needed), Hugging Face.
  - **Desktop control (2.19):** **Cua Driver** (trycua, MIT): reads and operates Windows apps through UI Automation, often in the background without moving your mouse, and works with every connection (subscription and local models too). Install it yourself first (§9); its admin auto-start is not needed. Listing apps and windows is free; reading a window (it returns a picture of it) and every action ask first. Changing the driver's own settings or installing extensions through it is blocked.
  - **Developer:** GitHub, Linear, Sentry, MongoDB (started read-only), **REA** (2.9: reverse engineer apps; 170+ tools, so prefer the Claude subscription, which loads tool definitions only when needed; needs Node.js 22.19+).
  - **Productivity:** Notion, Todoist, HubSpot, Stripe (use a restricted key).
  - **Home & media:** Home Assistant (lights, plugs, sensors via its "Model Context Protocol Server" integration), YouTube transcripts.
- **MCP Registry** — search the official public registry (registry.modelcontextprotocol.io, thousands of servers) inside Jarvis and add one in two clicks. Jarvis only lists servers it can run safely as-is (an npm package, or an HTTPS address with at most a Bearer token); Python/Docker ones are counted and can be added as Custom. Registry servers are added as **community** trust, every tool asks first, they get their own keys (they can never reuse your GitHub, Notion, Zapier… keys), npm ones carry a "runs on this PC" warning, and **View source code** opens the repository so you can check it.
- **Custom** — any stdio command or HTTPS URL.

Keys go in the form before **Connect** (stored encrypted like every secret, passed only to that server). Tools appear as `mcp__server__tool`, go through the same policy, and their output is untrusted.

### 3.20 NPCs: your team of agents (2.21)
Sidebar → **NPCs**. Single-purpose agents (a Marketing Head, a Finance Manager, a Frontend Developer…), each with its own brief, AI (any brain: Jarvis's own connection, the local model, a cloud provider, or your ChatGPT / Gemini plan), tools and memory. **Jarvis is their head**: he gives them work, reads every NPC's memory and runs their meetings.
- **Roster:** hire from 10 templates (Marketing Head, Finance Manager, Frontend Developer, Backend Developer, Researcher, Content Writer, Sales Lead, Project Manager, Designer, Fitness & Diet Coach) or from scratch; rename and change anything; switch each one **on/off**; remove. Each gets a desk.
- **Office:** an isometric office drawn in CSS 3D. NPCs bob at their desks, pulse while working, show their latest line in a speech bubble, walk to the glass meeting room when a meeting starts (Jarvis takes the head of the table), and grey out when switched off. Click one for its file: brief, AI, tools, memory, Message, Edit. The live #office feed sits beside it.
- **Team chat:** `#office` is everyone. **Tag** someone (`@Maya`, `@all`, `@Jarvis`; type `@` for suggestions) to give them work; with no tag Jarvis decides and hands it out by tagging. NPCs tag each other and Jarvis too ("@Ledger what can we spend?"), up to two levels and 8 replies per message. Private chats with each NPC on the left.
- **Meeting room:** pick up to 6 NPCs, a topic and 1–3 rounds; they speak in turns (the speaker lights up at the table), you can add a line between turns, then Jarvis posts the decisions and `- @Name: task` action items. Minutes are saved to `NPCs/Meetings/` in the vault.
- **Memory:** each NPC keeps facts in `NPCs/<name>/Memory.md` (lines it writes as `REMEMBER: …`; not from a reply that read a web page or file, and a rename carries the note over). NPCs read only their own; Jarvis reads all (`npc_memory`, and vault search sees them).
- **Jarvis's tools:** `npc_team` (who's there, what they're doing), `npc_ask` (give one or more NPCs a job; replies come back to him and show in #office), `npc_memory`, `npc_meeting`. His prompt lists the switched-on team, so "ask Maya and Ledger to plan the launch budget" works by voice.
- **Safety:** every NPC tool call goes through Jarvis's policy, confirmations and Activity; NPCs never get team, delegation or desktop-control tools; replies written after reading outside content are marked and their tags don't hand out work (Security.md §16.10).
- Ideas from **Agents Office** (departments of agents with leads and briefs, teammates leaving @notes, meeting at the centre) and **Claw3D** (agents as workers in an office, standups); our own code, no assets.

### 3.21 AI Router: every AI in one place (2.29 layout, 2.30 Phase 1, 2.31 custom providers and Cloudflare, 2.32 Phase 2 delegation, 2.33 Phase 3 abilities, 2.34 Phase 4 and the merge of Models & AI, 2.35 free usage and the clean-up)
Sidebar → **AI Router**. Free AI models from many providers, pooled into one helper Claude can hand work to: brain **`free`** for `delegate_task`, NPCs and Compare AIs (ideas from FreeLLMAPI, tashfeenahmed/freellmapi, MIT; our own code; ADR-045). Claude stays the boss: he decides what goes to the pool, and every pool answer ends with who answered, e.g. *(Free pool: answered by Cerebras · gpt-oss-120b; tried Groq: rate limited.)*
- **Three tiers, by who receives the text** (not by model name: Gemini through Google is tier 2, the same Gemini through an unknown relay is tier 3):
  - **Tier 1 · Brain**: Claude and the local model. Gets everything, including private data.
  - **Tier 2 · Trusted free**: Google Gemini, Groq, Cerebras, OpenRouter, NVIDIA NIM, Mistral, Cloudflare Workers AI. Non-private work only.
  - **Tier 3 · Third-party**: any provider you move there on Providers & keys, and every **custom provider** you add. Used only when every tier-2 route is busy, only after you answer the pop-up (**No, wait / Until Jarvis restarts / Just this once**; with **Ask every time for third-party AIs** on, the middle button is gone and Jarvis asks before every third-party answer), and never private data. A tier-3 route gets **only the question itself**: no Jarvis prompt, no earlier messages or tool results, no pictures, no tools; a tool call it invents is dropped. Its answer counts as outside content, like a web page: what Jarvis does after reading it needs your confirmation, and the trail says *answered by …, a third-party AI*.
- **Custom providers (2.31):** Providers & keys → **Add custom provider**: Name, Address (an OpenAI-compatible base URL such as `https://gen.pollinations.ai/v1`), Model, optional API key, **Test** (sends a one-token "Reply OK"), **Save**. For basic, non-private questions on relays you have keys for. Always tier 3 (no tier switch). The address must be HTTPS and a public host name: this PC, your home network, `.local` names and bare IP addresses are refused, and its DNS answer is checked again before every call (a host that starts pointing at a private address gets nothing; redirects are refused). The address can't be edited: remove the provider and add it again. The key is encrypted on this PC like provider keys (only its last four characters show; never logged or audited). Each one says "Added by you, not checked by Jarvis". Limits are learned from replies. Up to 10. **Check all keys** sends each one the same one-token "Reply OK".
- **Cloudflare Workers AI (2.31):** Settings → Models & AI → Cloudflare Workers AI: the API token (Workers AI permission) and your **Cloudflare Account ID** (32 letters and digits from dash.cloudflare.com → Workers AI; one for every Cloudflare key). Jarvis puts the id into Cloudflare's fixed address itself; anything that isn't exactly 32 lowercase hex characters is refused. No model list is published: type the model id (e.g. `@cf/meta/llama-3.1-8b-instruct`). Free: 10,000 neurons a day, reset at 00:00 UTC, learned from replies. Without the Account ID the key stays out of the pool and Check all keys marks it as needing you.
- **Private data stays in tier 1** (always on, no switch; Security.md §16.15): once a task used memory or the vault, tasks/calendar/reminders, files, the screen or camera, passwords, the clipboard, WhatsApp/messages, your location or any MCP connection, or its text holds a key, password or card, the pool refuses it in code. The pool's own sub-agent never gets those tools.
- **Which keys and models:** each free provider's keys from AI Router → API keys (since 2.35 the only place; up to 5 per provider). A key's chosen model joins the pool, and so does every model you **star** for it. **A key with nothing chosen or starred (2.33.1) joins with every free chat model its model list shows**: speech, embedding, picture and safety-filter models are left out, and on OpenRouter only models ending in `:free` (the others cost money). Press **Check keys** after adding a key: it refreshes each key's model list, including each model's context size. The Models tab shows each model's context (OpenRouter and Groq publish it) and, under a model, each door's limits: requests and tokens per minute and per day (OpenRouter free: 20 a minute, 50 a day per account; Groq's are read from its replies, per model, after the first answer). Switch a model off with its **On** switch. A connection's name can't be an API key: Jarvis refuses it, and a key saved as a name before 2.33.1 is replaced by the default name. Add keys there, or paste a `.env` (e.g. FreeLLMAPI's) on **API keys → Import from .env**: Jarvis lists the names it recognised, then saves the keys encrypted; a key already saved is skipped.
- **Free usage (2.35):** AI Router → **Usage**, the first tab. Two totals across every free key, **Free tokens** and **Free requests**: what is left, of how much, and how much you used, for **Today**, **This week** (seven days of the daily allowance) or **This month** (this month's days of it; Mistral's is monthly). Then one row per provider you have a key for: tokens and requests left with a bar, when it resets, its per-minute cap, and a tag saying where the numbers come from: **Live** (read from the provider at the last key check: OpenRouter's `GET /api/v1/key` reports today's free requests used and the cap, 50 or 1,000), **Learned** (from replies: Groq's `x-ratelimit-limit-requests` per model), **Published** (the provider's limits page), **Estimate** (the provider shows it only after sign-in: Gemini ~20 requests a day per model, Gemma ~1,000; Mistral ~1 billion tokens a month; Cloudflare ~250K tokens a day, worked out from 10,000 neurons) or **Yours**. The pencil opens **Free tokens a day / Free requests a day**: type the numbers from the provider's own console and they replace Jarvis's for that provider (`pool.providers.<id>.tpd/rpd`; **Use Jarvis's numbers** clears them). A cap counts once per model for Groq, Gemini and Cerebras (each model has its own) and once per key for OpenRouter, Cloudflare and Mistral; a provider with no known cap (NVIDIA: no daily cap, about 40 a minute) is named under the total and left out of it, its use too (so it never eats into the others' "left"); a switched-off provider is left out as well. Used = the pool's own records, minus refusals (429) and calls that got no answer (timeouts); OpenRouter's live count wins when higher (it includes use outside Jarvis). **Check now** re-checks every key (no tokens used). Below: free answers today, success rate (— when none), money saved, paused routes and the last answers.
- **Where the numbers come from (2.35):** limits were researched once, when this was built, and each checked against the provider's own docs (dated in code, `FREE_PROVIDERS`). FreeLLMAPI does the same: its desktop app ships a hand-checked per-model table (requests and tokens per minute and per day, plus a rough monthly estimate) and its live probes mostly find no quota headers. Asking an AI or searching the web at run time was rejected: third-party lists disagree and an AI often invents numbers, so Jarvis shows dated, labelled numbers and lets you type your own.
- **Limits:** Cerebras (5 requests / 30K tokens a minute, 1M tokens a day per model), Groq (per model, e.g. gpt-oss 1,000 requests and 200K tokens a day) and OpenRouter free models (20 a minute, 50 a day for the whole key) publish theirs; Gemini, NVIDIA and Mistral show free limits only in your account, so Jarvis uses estimates and learns from each reply (`retry-after`, Groq's `x-ratelimit-*` headers). The router obeys these caps per model, or for the whole key where the provider counts that way (OpenRouter). A rate-limited route pauses (its retry-after, else 1 → 5 → 30 min), "out of today's limit" pauses until UTC midnight, a rejected key 6 h, a server error 2 min; a model that refuses tools or pictures is remembered and skipped for those requests. Up to 6 attempts within 45 s, then a plain message ("All free AIs are busy: 7 routes checked (…). Soonest back in about 2 min. Claude can do this one instead.").
- **Tabs (2.35):** what you use every day first, then what you set once, after a divider: **Usage** · **API keys** · **Free models** · **Abilities** │ **Main brain** · **Rules** · **AI tree** · **History**. Each tab opens with one line saying what it is for and **Learn more**, which opens the full explanation (the long cards that used to fill the tabs live there now). **API keys**: the **Add an API key** list groups providers: *Free (trusted, tier 2)* first, each with what it gives free ("Groq · 200K tokens a day per model", "Mistral · ~1B tokens a month"), then *Paid*; picking a free one shows its note. Below the key list only the free providers **you have a key for** are listed (with health, tier, Check all keys), then free search keys, .env import and custom relays. **Free models**: routing strategies, filters, each model's doors and limits, Test this model, chains. **Main brain**: who answers you, Claude's model per job, budget, your AI plans, coding agents, fast commands (saved with the bar at the bottom). **Rules**: the three tier cards list only AIs you set up (an empty one offers **Add a free key**), private data never leaves tier 1 (always on), the six delegation switches, and the tier-3 question. **AI tree**: every AI as a tree from the top down: JARVIS, then Main brain, Free AI pool, Helpers and Abilities, each provider a branch with its models listed under it (six at most, then "+N more"); square wires; it opens centred on JARVIS and scrolls when wide; click a box to open the tab that changes it. **History**: the charts (was Analytics). Old links (Overview, Tiers & privacy, Delegation, Analytics) open the matching new tab.
- **Settings → Models & AI (2.35)** only links here (**Open Main brain**, **Open API keys**, **See free usage**): one home for every AI setting. Settings now opens on General.
- **Free:** pool answers are recorded as free in Usage (source "pool") and never count against your Claude budget. `pool_calls` keeps 31 days of who was asked and how it went, never the text.
- **Delegation (2.32): Claude as the boss.** AI Router → Delegation, six switches (`pool.delegation.*`):
  - **Let Claude hand heavy, non-private work to free AIs** (on): summaries, drafts, translations, reading public pages; Claude asks for a short report and reads only that.
  - **Front door for simple chats** (off): a short, plain, public question (≤ 25 words, one sentence, no link, nothing about you, your people, files, messages or plans, no PC action) goes straight to a tier-2 free AI and Claude isn't called. Never in a `/private` chat, with an attachment, after private data was read in that chat, or as a follow-up to an answer by Claude. Laya, when loaded, can send a question back to Claude. The chat shows *Front door: a free AI answered this simple question* and the reply ends with who answered.
  - **Keep a conversation on one model** (on): for 30 minutes the chat goes back to the free model that answered it first.
  - **Hand-over note** (on): if that model is out, the next one gets a short note of what the free AIs answered so far; off: only the question. Claude's answers are never in it.
  - **Fall back both ways** (on): every free AI busy → Claude answers (front door) or does the sub-task (*Free pool busy, so Claude did this one.*); Claude busy, at its plan limit or out of budget → a free AI answers a non-private chat, after the local model if that fallback is on, and the chat says why.
  - **Prefer free AIs when the budget is nearly used** (on): past 80% of today's Claude budget (API key only) the front door opens and Claude is told to delegate more.
  - What the free AI sees: a neutral prompt (nothing about you), the question, and earlier questions in that chat that a free AI answered. Private data never goes, whatever the switches say.
- **Abilities (2.33):** AI Router → Abilities, a switch on each panel (`pool.abilities.*`). Private data never goes to any of them (checked in code before anything leaves the PC; no switch).
  - **Free web search** (on): web lookups use the `free_web_search` tool, which tries **Tavily → Brave Search → Exa → Firecrawl → Linkup** in that order. Each needs its own key: AI Router → Providers & keys → **Free search keys** (encrypted on this PC, last four shown, a "Get a key" link, today's count and any pause). A provider that runs out or rate-limits is paused and the next one goes. Claude's own paid web search appears only when no free one can take the search: all used up, switched off, or the chat holds your private data. Free AIs doing a sub-task may search too. Brave's free plan is a $5 monthly credit and needs a card: set a spending limit in Brave's dashboard.
  - **Image generation** (on): ask "draw a logo for my bakery" (tool `generate_image`), or type a description on the tab, pick **Square / Wide / Tall** and press **Generate**. Square pictures come from **Cloudflare Workers AI** (FLUX.1 [schnell], your Cloudflare key and Account ID, about 170 a day free). Wide and tall, or when Cloudflare is busy, come from **Pollinations**, a third party: Jarvis asks first (the same "Use third-party AIs?" pop-up), and it adds a small logo. Pictures are saved to your vault under `Images/` with a note of who made them, and the reply says who made it. Gemini isn't used: its image models have no free quota.
  - **Fusion brain** (on): brain **`fusion`** for `delegate_task` and **Compare AIs**: up to three free models from different providers answer at once, then a judge (the largest free model, from a provider that didn't draft when possible) writes one answer from the drafts. Tier 2 only, no tools; needs keys from two free providers. The answer ends with every model used, e.g. *(Fusion: drafts by Groq · llama-3.3-70b, Cerebras · gpt-oss-120b; judged by Gemini · gemini-2.5-pro.)*
  - **Voice backup chain:** **Speaking** (on): Kokoro on this PC → Edge voices → ElevenLabs → Windows voice, sending only the reply text. **Hearing** (off until you switch it on and confirm): Whisper on this PC → Groq Whisper → OpenAI, only engines with a key; your recorded voice goes to them only when on-device Whisper fails. Every switch shows a notice naming the engine ("Hearing with Groq Whisper now (…)"), and the tab shows the engine in use.
- **Phase 4 (2.34):** **Routing strategies**: Priority (your order), Balanced (reliability 50 · speed 25 · smarts 25), Smartest (35 · 10 · 55), Fastest (35 · 55 · 10), Most reliable (70 · 15 · 15) and Custom (three sliders). **Learn from real answers** (on): scores come from the last week, each day counting half as much every 2 days. **Shrink long prompts** (on): before a free model gets a request, tool output older than the last few messages becomes a one-line note, long text repeated word for word is sent once, and long older text is cut; the latest messages are never touched. **Too-small models are skipped**: when a model's context size is known (OpenRouter and Groq publish it), a bigger request goes elsewhere. **Named chains** (up to 8): an order of models for a kind of job ("Coding", "Vision"); Claude names one in `delegate_task` ("chain") and its models go first, then the rest. **Analytics**: last 24 hours (hourly) or 7 / 30 / 90 days (daily): requests, success rate, tokens in and out, average and slowest-5% time, money saved, per provider (with today's use of its daily cap and an outlook: "plenty left today", "runs out around 19:40 at this pace", "used up until 05:30") and the busiest models. Request records are kept 92 days (were 31). **Test this model** sends "Reply with OK" to each tier-2 door and shows how each did.
- **Phases:** 1 ✓ the free brain · 2 ✓ Claude as the boss · 3 ✓ free web search, image generation, fusion brain, voice backup chain · 4 ✓ strategies, learned scores, prompt shrinking, context sizes, named chains, analytics and quota outlook. Not built: a separate "group the same model" switch (the Models table always groups a model's providers as its doors).

### 3.22 Forge: Jarvis improves itself (2.36, ADR-046)
Ask Jarvis for a change to Jarvis ("add a tool that…", "make the Tasks page do…") and it builds it itself. Full plan and phases: [Forge.md](Forge.md).
- **Set up once:** say "use git@github.com:<you>/Jarvis.git for Forge" (tool `forge_setup`, asks first). Forge keeps its **own copy** of the source in `%APPDATA%\Jarvis\forge\repo`, separate from yours, and starts every change from GitHub `dev` with a fresh `npm ci` (a few minutes): push your own commits first. Needs Node.js, Git and Claude Code signed in.
- **Ask for a change:** Jarvis agrees the goal with you, then `forge_start` (asks first, shows the goal and the budget, default $5 of Claude per run, setting `forge.budgetUsd`). Your own Claude Code works **in the background** in Forge's copy on a new branch `forge/<date>-<words>`. It can only read and edit files there: no commands, no web, nothing outside the copy. It runs typecheck, lint and tests through Forge.
- **Checks (all must pass):** protected files → typecheck → lint → tests related to the changed files → the full test suite → build → e2e (test windows open on screen for a while) → secret scan. The first failure stops the run.
- **Protected files:** Jarvis can't change its own safety code (policy engine, guards, redaction, Electron hardening, confirmations, privacy gates, test settings, `package.json`, the rules files, Forge itself). Its edits there are refused and the checks reject them anyway. To allow one, name the file when you start the run; the confirmation shows it in capitals. Deleting, skipping (`.skip`, `.only`, `.todo`, `.fails`) or renaming a test away, removing test cases, or switching type checking or linting off for a whole file also fails the run; fewer assertions is a warning.
- **Say it (2.40):** "Jarvis, learn to …", "teach yourself …" or "use Forge to …". Jarvis picks a self-built tool when it can (no reinstall) and a code change only when it must, agrees the goal with you, then asks before starting.
- **Forge page (2.40):** Sidebar → **Forge** lists every run (newest first): what it was for, how it ended or that it shipped, how long it took, its Claude cost and how many edits free AIs did. Open one for its checks, what it studied and the no-copy result, the shipping steps, the installer path and Claude's summary. At the top: Claude spent this month and in all, versions shipped, and the share of edits done free. It refreshes by itself while a run works.
- **While it works:** "how is Forge doing?" (`forge_status`: state, latest steps, check results, Claude's summary), "stop Forge" (`forge_cancel`; the work stays on its branch). You get a notification when it ends. One run at a time; runs are saved in `%APPDATA%\Jarvis\forge\runs`.
- **New tools without a reinstall (2.37):** "make a tool that…" (`forge_build_tool`, asks first) when the ability needs no new screen: fetching or converting data, a public API, calculations. Claude writes one small `tool.mjs` with tests; Forge checks it (files, imports, syntax, tests, that it loads) in **Node's sandbox** plus Forge's guard: it can call public https addresses (not this PC or the home network), read only its own folder and write only its `data` folder, and can't start programs or open other connections. Then "install it" (`forge_install_tool`, asks first) adds it as the connection **forge-<name>** in Settings → Connections, where you switch it off or remove it. Jarvis asks before each use, like any new connection. The same name again updates it. Needs Node.js 22.14+ (or 24+).
- **Free AIs do the typing (2.37):** while building, Claude hands small edits (1–3 files) to free AIs with `delegate_edit`, then reads and fixes what they wrote. First the free AIs that promise not to train on what they get (Groq, Cerebras, Cloudflare; checked 2026-10-28). When those are used up, a pop-up asks whether the others (Gemini, Mistral, OpenRouter's free models, NVIDIA) may see the code for the rest of the run; no means Claude does it. Third-party relays never get code, and anything that looks like a key or password stays with Claude. Switch it off with the setting `forge.freeWorkers`. "How is Forge doing?" shows how many edits the free AIs did.
- **Ship it (2.38):** a passed change waits on its branch until you say "approve it" (`forge_approve`). The confirmation shows the goal, every changed file with lines added/removed, warnings from the review, protected files you allowed, Claude's summary (its own words) and the Claude cost. Then, in Forge's copy only: version bump (minor, or patch when the goal starts with "fix"), a History row if Claude didn't add one, commit, a fresh `npm ci`, `npm run dist`, a **backup of your data** (`jarvis.db`, which holds your settings), merge into `dev`, tag `v<version>`, push to GitHub. 10–30 minutes; you get a notification with the installer path (`%APPDATA%\Jarvis\forge\installers`, the last 5 kept). **Jarvis never installs itself:** close Jarvis and run the installer. Your own copy of the source catches up with `git pull`. If a step fails (push refused, merge conflict) you are told, nothing is retried, and approving again continues from that step. Forge ships only the exact commit its checks passed: if the branch changed since, it refuses.
- **"Build it like the feature in …" (2.39):** name an app, a website or a GitHub repo when you ask (`studyApp`, shown in capitals in the confirmation). Claude studies it first, in the same run: a **GitHub repo** is downloaded read-only to `%APPDATA%\Jarvis\forge\study` (nothing in it is installed or run; Claude can read it, never change it); an **app or website** is inspected with **REA** (needs Node.js 22.19+). Forge lets REA use only its read-only tools: it never starts the app, writes files or reads outside the app's folder or the program folders; for a website it may read pages of that site only (public sites, not this PC or your home network). Claude writes study notes first (`docs/forge-study/<run>.md`: what the feature does, the evidence, what it couldn't confirm, the licence), then builds **our own version**. GPL/AGPL sources: behaviour only. The **no-copy check** compares the change with the studied repo: 20+ copied lines in one place, or 40+ in all, fail the run; shorter ones are warnings you see before approving. `forge_status` shows the notes path and what the check found.
- **Skills for Forge (2.39):** Settings → Skills → a skill → **Use in Forge runs**: its instructions join Claude's rules when Forge builds (it must also be switched on; checked for prompt injection again before each run; up to 8,000 characters each, 24,000 in all). Reinstalling, updating or removing the skill clears the mark.
- **Roll back (2.38):** "roll back Forge" (`forge_rollback`, asks first) schedules your data from just before the last Forge build to come back (what changed since is kept in `pre-restore.db`) and names the previous installer. Do it in this order: close Jarvis, run the previous installer, start Jarvis; it restores the data before it opens anything. (If the newer Jarvis starts first, it restores and then upgrades the data again.)

### 3.13 Spaces (Notion-style notebooks)
Sidebar → **Spaces**. Each space (Learning, Finance, Fitness, Ideas…) is a notebook of pages.
- **Sidebar tree (accordion):** your spaces sit under "Spaces"; the arrow beside **Spaces** folds the whole list away, and the arrow beside each space shows or hides its pages (like Notion's page tree). Click a page to open it. Jarvis remembers what you folded; opening a page unfolds its space. **+ New space** picks a name and an icon. (The tree shows on windows 1200 px and wider; narrower windows show space icons only.)
- **Spaces home:** every space as a gallery card with a cover and its icon, plus **Recently edited** pages across all spaces.
- **A space:** a cover banner, the space's icon and name, then its pages as a **Gallery** (cards with a cover, the page icon and title, like a Notion gallery database) or a **List**; switch with the tabs and Jarvis remembers your choice. **Search** filters, **New page** offers templates (Blank, Learning note, Journal entry titled with today's date, Meeting notes, Expense log table, Project plan), and the last card **+ New page** makes a blank page.
- **Page icon and cover:** click the icon square to pick an emoji; hover the cover and press **Change cover** to pick one of eight built-in covers (Grid, Synthwave, Matrix, Circuit, Aurora, Hazard, Plasma, Chrome). They are saved in the page's frontmatter (`icon:`, `cover:`), so Obsidian keeps them. Covers are generated art, so no image is ever downloaded.
- **Editor (2.8, like Notion):** you see the formatted page, not Markdown symbols. Press **/** on any line for the block menu (Text, Heading 1–3, Bulleted, Numbered and To-do lists, Quote, Code block, Divider, Table, Link to a page); type to filter ("/h2", "/check"), ↑↓ and Enter to pick. **Shortcuts:** Ctrl+B bold, Ctrl+I italic, Ctrl+Shift+S strikethrough, Ctrl+E inline code, Ctrl+K link, Ctrl+Alt+1/2/3 headings (Ctrl+Alt+0 text), Ctrl+Shift+8/7/9 bulleted/numbered/to-do list, Ctrl+Shift+B quote, Ctrl+Alt+C code block, Tab/Shift+Tab indent; Markdown typed at the start of a line (`# `, `- `, `1. `, `[] `, `> `, ```` ``` ````) still converts. `[[Page name]]` becomes a link chip. The bar above the text does the same with the mouse, and the keyboard button lists every shortcut. **Markdown** (top right) shows the raw text for anyone who prefers it. Pages are still plain Markdown files (Obsidian reads them unchanged; ordinary characters such as `my_file`, `&` and `[draft]` are saved as typed). It **saves by itself** about a second after you stop typing (Ctrl+S saves now; leaving the page saves first).
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
Sidebar → **Tasks**. It opens on **All lists** (2.8).
- **All lists:** every list as a card: icon and colour, a progress ring, its description, **To do / Doing / Done** counts (Doing turns red past the list's limit), the next open tasks, how many are overdue and what's due next. A summary line counts open, in-progress and overdue tasks across lists. **Find a list** filters; drag cards to reorder; **New list** (the dashed card) asks for a name, an icon and a colour. Archived lists hide behind **Archived (N)**.
- **A list** opens as a **board** with **To do / Doing / Done** columns. The breadcrumb reads **Lists › Work** and becomes **Lists › Work › To do** when you open one column on its own (the tabs under it, or the ⤢ on a column). Each column has its own **+** quick add; drag a card to another column to change its status, or onto a card to put it just above. Cards show the due date (coloured: overdue, today, soon), priority, subtasks done (2/5), notes, repeat and tags. Done folds tasks finished over a week ago (**Show N older**). A progress bar shows how much of the list is done.
- **Filter a list** by priority, due date (overdue, today, next 7 days, no date) and its #tags; **Clear filters** resets.
- **List settings** (⚙ at the top): name, a description for the card, icon, colour, a **Doing limit** (1–10; the board warns when more tasks are in progress), **Archive**, **Clear done tasks**, **Delete list** (its tasks move to the Inbox).
- **Smart lists:** **Inbox** (tasks without a list), **Today** (overdue first, then today), **Upcoming** (grouped by day), **Starred**, **All tasks**, **Completed** (grouped by the day you finished them, with *Clear completed*). Your own **lists** (+ beside "Lists"; double-click to rename, click the dot to change colour, bin to delete — its tasks move to the Inbox) and every **#tag** in use appear below.
- **Quick add** (press **N**): type naturally and the chips underneath show what Jarvis understood — *"Call mom tomorrow 6pm #family !1 every week"*. It understands today / tonight / tomorrow / weekdays ("next friday", "by mon"), "in 3 days", "in 30 min", dates like "12 oct" or "12/10" (day first), "on the 15th", times ("6pm", "17:30", "noon", "1-2pm"), lengths ("for 45 min"), repeats ("every day", "every weekday", "every 2 weeks", "every mon and thu", "monthly"), priority (**!1**–**!4** or p1–p4) and **#list-or-tag** (a list when one has that name, otherwise a tag).
- **A task** (click it): title, **To do / Doing / Done**, list, priority P1–P4 (the colour of the tick circle), due date and time, **reminder** (a Windows notification and Jarvis says it; a timed task reminds at its time unless you change it), **repeat** (every day/weekday/week/2 weeks/month/year or custom: every N days/weeks/months/years, on chosen weekdays, ending never / on a date / after N times), tags, star, **subtasks** with a progress bar, and Markdown notes. **Focus 25 min** starts the pomodoro beside the orb and marks the task Doing; **Time-block it** puts it on the calendar.
- **Ticking a repeating task** logs it as done and moves it to its next date, with its subtasks unticked for the next round. Ticking any other task ticks its open subtasks. **Clear completed** keeps a done task that still has an open subtask.
- **Layouts** (top right): **List**, **Board** (To do / Doing / Done columns — drag cards between them) and **Priority matrix** (Eisenhower: do now, schedule, quick wins, later; important = P1/P2 or starred, urgent = due by tomorrow). **Sort:** smart order, due date, priority, A–Z, newest, or **My order** (drag rows).
- **Stats strip:** done today, this week, your **streak** (days in a row with something done) and how many are overdue.
- **Jarvis has full control** with the `tasks` tool: "add buy milk to my tasks for tomorrow", "what's on my list today?", "mark the electricity bill done", "move the report to Friday, high priority", "make a Groceries list". Deleting a task asks you first.
- Stored in Jarvis's local database (`todos`, `todo_lists`; migrations 010–011), included in the daily backups.

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

### 3.19 Apps (2.9, ADR-032)
Sidebar → **Apps**: Jarvis's own light apps. Jarvis uses them for its work, and you can too. They are laid out as an **Apple Watch style honeycomb** (2.22): one bubble in the middle, rings around it; bubbles shrink toward the edge and swell under the pointer, and the one you point at is named underneath.
- **Browser** (its own window): an address bar (type an address or a search; DuckDuckGo is home) and the page. Its pages are kept apart from Jarvis: their own persistent session (`persist:jarvis-browser`, so logins stay), sandboxed, no preload and no access to Jarvis, every permission (camera, microphone, location, notifications) denied, http/https only, new tabs open in place. Ctrl+L address bar, Alt+← / Alt+→, F5, Ctrl+W. Jarvis: `jarvis_browser` opens a page, **reads the page you're looking at** (visible text, read in an isolated world, marked as untrusted web content), goes back/forward, reloads or closes. Say "open the React docs in your browser", "summarise the page in my browser".
- **Terminal** (its own window): a PowerShell console. Type a command and press Enter; ↑/↓ recall, Ctrl+L clears, **Stop** ends a long one (60 s limit). `cd` carries over between commands. Every command passes the shell guard first (blocked ones are shown, not run) and is written to the audit log. **Every script Jarvis runs with `run_powershell` (after you approve it) appears here too**, marked JARVIS. Only the Terminal window can run commands; the main window has no such channel.
- **Timers:** 1–45 min quick countdowns or your own with a label; every running timer and reminder (yours and Jarvis's) with a live countdown and Cancel; a **stopwatch** with laps.
- **Scratchpad:** notes you and Jarvis share (up to 20,000 characters, saves as you type). Say "put this on the scratchpad"; Jarvis can read and append, and clearing asks first (`scratchpad`).
- **System monitor:** the live CPU graph, memory, disk, battery and uptime.
- `open_jarvis_app` opens any of them by voice.
- **Jarvis drives Jarvis Browser himself** (2.12): snapshot, click, type, choose, scroll, with confirmations for anything that commits (§3.5e, ADR-035).

### 3.12 Interface
- **Core (the home screen):** Jarvis's orb is the screen. It sits in the middle of a HUD with corner readouts (clock, uplink and model, microphone mode, today's spend), a status line under it (`[ READY ]`, `[ THINKING… ]`…), and his words appear under the orb as captions while he replies. Before a conversation there's a greeting and three suggestions.
  - **Talk to the orb:** with the chat closed there is no message box: **click the orb** (or press the push-to-talk key) to speak; click again to stop. If voice is off, clicking the orb opens the chat. **Start typing anywhere** and the chat opens with your letters already in the box.
  - **Comms log:** the conversation, with **the message box at its bottom**: a log beside the orb (an overlay sheet below 1200 px) that opens when a conversation starts; the speech-bubble button in the header shows or hides it. Tool cards and citations work as before.
  - **Panels make room for each other** (2.20): the sidebar, Conversations, the comms log, Activity and an app beside the orb share one row. When one more opens than the window can hold, the ones opened longest ago close (the sidebar collapses to its strip and comes back by itself when there is room again, unless you hid it with Ctrl+B); the one you just opened always stays. Below 1200 px the log and Activity are sheets on the same edge, so only the newer one stays (`features/chat/panel-fit.ts`).
  - Conversation history; `/private` conversations are not logged to the vault.
  - **Rewind** (idea from isair/jarvis): hover one of your messages in the log. **Edit from here** removes it and everything after and puts it back in the box; **Regenerate from here** asks again. Attachments are not re-sent; the vault's daily log keeps the original.
- **Panels beside the orb:** ask Jarvis to show something ("show my pending tasks", "start a 25-minute pomodoro", "show the dashboard", "how much have I spent on AI this month?") and he moves to the left of the stage while the panel slides in on the right; the sidebar and the conversation log step aside to make room and come back when you close it (✕). Kinds today:
  - **Pomodoro** — a focus timer with a ring (start/pause, +5 min, reset); a toast tells you when focus or the break ends.
  - **AI usage & billing** — spend against your daily and monthly budgets, by model, purpose or day.
  - **System monitor** — live CPU (with a graph), memory, system-drive space, battery and uptime, every two seconds (§3.5c).
  - **QR code** — any link or text as a QR code, drawn on this PC (§3.5c).
  - **Jarvis status** — connection, model, voice mode, today's and this month's spend (with budget bars), connections ready, spaces and pages.
  - **List** (tasks, agendas, anything with items and ticks), **Stats** (labelled numbers with optional bars) and **Note** (formatted text) — Jarvis fills these with whatever you asked for.
  - **Apps** (v2.16, ADR-040): Sidebar → **Apps** lists every app, and Core's header **All apps** button opens the same list; every app opens **beside the orb**, including **Browser**, **Terminal** and the new **Camera** (live preview, Take photo → Pictures\Jarvis Camera; Jarvis asks before opening it, and it turns off when closed). Ask "what is 2+2?" (or "15 percent of 2400", "twelve into three") and the calculator opens with the sum worked out while Jarvis says the answer, with no model call. New apps added to `shared/jarvis-apps.ts` appear in both lists automatically.
  - Earlier (v2.15) apps sat in the Core header where the panel button was: Today (tasks due and today's events, tick tasks off), Pomodoro, Stopwatch & timer, Calculator (type or tap; never eval'd), Unit converter (length, weight, temperature, volume, speed, area, time, data), World clock (add cities, remembered), QR code (type any text), System monitor, AI usage and Jarvis status. The first five are icons; **All apps** lists them all. Each opens beside the orb; press it again to close.
  - **What Jarvis makes shows up beside the orb**: a reply with a page, drawing or diagram (artifact) opens it there by itself; any artifact card has **Show beside the orb**; and Jarvis can show a picture, page or document file with `show_file` (e.g. an image it generated, a report it wrote).
  - The old panel button opened Pomodoro, Status and Usage by hand. Jarvis uses the `show_panel` / `hide_panel` tools (safe: display only). Jarvis shows tasks and agendas as a List panel; the full views are Tasks (§3.17) and Calendar (§3.18).
- **The orb follows you:** on every other screen (Spaces, Settings, Connections…) a small live orb floats in a corner, moving with Jarvis's state and voice, with his words beside it while he replies. Click it to return to Core. If it covers something, **drag it to another corner**, or hover it and press the small arrow to **tuck it into the edge** as a slim glowing tab (click the tab to bring it back). Jarvis remembers where you put it. The sidebar's logo is a live orb too, and the **Mini orb** floats on the Windows desktop over other apps.
- **Views:**
  - **Help everywhere (2.9):** a small **?** beside every page title, settings page and main settings section opens what it is, how to use it, what to say to Jarvis, and tips (`renderer/src/help/help-content.ts`).
  - **Sidebar:** **// workspace** — Core, Spaces (with its page tree), **Tasks**, **Calendar**, Brain, Memory, Passwords; **// tools** — **Apps**, **Automations**, **Skills**, Connections, Reply copilot; Settings at the bottom. **Hide it** with the arrow next to the JARVIS logo or **Ctrl+B**; a slim strip with one button brings it back. Jarvis also hides it himself while he shows a panel.
  - **Settings → Advanced → Logs:** the newest log lines (secrets removed), warnings-only filter, and Open logs folder.
  - **Settings → Activity & usage:** every action, the tamper-evident audit log, and **Usage** (spend by model/purpose/day; subscription cost is shown as API-equivalent). Core's header still opens the live Activity drawer for the current turn.
  - **Settings → Bible (help):** this guide, searchable, plus the generated reference.
  - **Memory:** browse, search, forget, and the review queue.
  - **Spaces** (§3.13), **Brain** (§3.3), **Passwords** (§3.14), **Connections** (§3.11), **Reply copilot** and **Bible**.
- **Settings → General → Style** (2.6): **Soft** (the default) or **Cyberpunk**. Each choice has a preview card and applies as you pick (kept when you press Save changes). Theme (light/dark) and accent colour work with both.
  - **Soft:** rounded cards (12–16 px corners), rounded buttons and pill tags, calm graphite (dark) or paper-white (light) surfaces, gentle shadows instead of neon glow, one sans-serif font (code and paths stay monospace), no grid, scanlines, corner brackets or glitch. The orb is the same.
  - **Cyberpunk:** the "Neon Grid" HUD described next.
- **Look in the Cyberpunk style ("Neon Grid", cyberpunk HUD, [Design-system](Design-system.md)):**
  - Near-black void with a faint blueprint grid and CRT scanlines; hard 4 px corners; panels carry HUD corner brackets; hairline borders with neon glow on what's active or floating.
  - Neon cyan is the main button (clipped corners, dark text), focus and Jarvis; magenta and hazard-yellow are the second and third neon. Status tags are square chips (yellow = needs you, red = blocked, green = done).
  - Headings, labels, buttons and numbers speak in **Geist Mono** (HUD style, `// SECTION` labels); reading text stays in Geist. Bundled, works offline.
  - The sidebar groups **// workspace** and **// systems**; the active row has a glowing neon bar.
  - **Settings → General → Orb style:** 19 styles, each a live preview card (hover to see it move): **Particle core** (default), **Arc reactor**, **Fluid glass** (Siri-like), **Voice cloud** (ChatGPT-voice-like), **Liquid metal**, **Solar flare**, **Plasma ball**, **Radial equalizer**, **Oscilloscope**, **Light ring** (smart-speaker style), **Black hole**, **Galaxy**, and new in 2.9 **Aurora** (northern-lights curtains in a dark sphere), **Voice waves** (layered Siri-style waves), **Wormhole** (rings rushing into a bright throat), **Tesseract** (a 4D cube turning through itself), **Iris** (camera-aperture blades that open when it listens), **Firefly swarm** and **Crystal** (two counter-turning gems). Atom, Sorcery circle, Digital rain, Gyroscope, Holo globe and Sonar pulse were removed in 2.9 (a saved removed style falls back to Particle core). Every style uses your accent colour, follows voice and music, and shows Jarvis's state (yellow when he needs you, red on errors, a segmented ring while he works through tools). The sidebar logo, the corner orb and the mini orb use the same style. At rest (idle or asleep) orbs draw at 30 frames a second instead of 60, which halves their CPU use; they're at full speed whenever Jarvis listens, thinks, works or speaks.
  - **Particle core (default):** about 1,500 glowing dots that ripple like liquid with the sound, shading from your accent colour to violet, with a hot core of swirling filaments, wavy particle shells orbiting it, a ring of level dots, sparks thrown off when Jarvis speaks or thinks, and a HUD of turning arcs, a glyph ring (spell-circle style), ticks and markers. It breathes at rest, moves with Jarvis's voice when he speaks, your voice when he listens, and music playing on the PC the rest of the time (Settings → General → "The orb moves to music"; only the loudness is read). It spins faster while listening, sweeps while thinking, splits its dot ring into one segment per tool while acting, turns yellow when it needs you, and glitches red on errors. Reduced motion draws it still.
  - Responsive from 480 px wide (Windows Snap half-screen); below 1200 px the sidebar shows icons only and the log and Activity open as sheets (Esc closes Activity). The window opens at up to 1400 × 880, never larger than the screen.
  - **Settings → General → Theme** (preview cards): Match Windows (default), Light, Dark, and **Pitch black** (2.8: true #000 canvas for OLED screens, pure white text and the brightest borders). In 2.8 every theme got brighter secondary text and clearly visible card borders.
  - **Settings → General → Text size** (2.8): 90 %, 100 %, 110 %, 120 %, 135 % or 150 % with **A−/A+**. Every view's text follows at once; spacing stays the same. The default text is also a size bigger than before 2.8.
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
| `voice/` | controller, providers, local engines (Whisper / keyword spotter / openWakeWord / VAD / model store), conversation helpers, dictation |
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
- **Prompt-injection scan (2.17):** untrusted results are also scanned for text aimed at an AI; a hit warns Claude, is audited (rule ids only) and makes **every** further action in that request ask. A tool result with private data (key, password, card…) makes later external-facing actions in that request ask too.
- **Secrets:** encrypted with DPAPI; never sent to the renderer, logs, vault or git; redaction runs before anything is stored.
- **Circuit breaker (2.11):** an action that already failed twice with the same input is not run a third time, and after 6 failed actions in a row Jarvis stops using tools for that request and tells you what went wrong, instead of burning steps (and money) going round in circles.
- **Kill switch:** `Ctrl+Alt+Shift+X`, the tray, "stop everything" or Telegram `/stop` aborts every turn, tool, confirmation and computer action.
- **Packaging:** Electron fuses (no RunAsNode, no NODE_OPTIONS / inspect, ASAR-only with integrity), plus a hardened BrowserWindow.

**What leaves your PC, and when**

| Feature | Goes to | When |
|---|---|---|
| Chat / tools (API) | Anthropic | every turn |
| Chat (subscription) | Anthropic via Claude Code | every turn |
| Chat (local) | your local server | every turn (nothing leaves your network) |
| Deepgram STT | Deepgram | only while listening |
| Whisper, instant wake word (keyword spotter), openWakeWord, Picovoice wake | — | never (on-device) |
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
**Grouped by importance (2.22):** the Settings list is split into Essentials (General, Models & AI, Voice, Memory), Abilities, Safety, System and Help, each with an icon, and a **Search settings** box at the top filters it by name or by what a page covers ("wake word", "budget", "backup"; Enter opens the first). **Models & AI** (2.35) is a signpost to AI Router, where every AI setting now lives (Main brain, API keys, free usage). **Voice** opens with the four modes as tiles and **How your voice travels**: microphone → wake → hearing → thinking → speaking, each with its engine, the stage at work lit live.

**Changes wait for Save.** Editing anything in Settings (and in Automations or Skills) shows a bar at the bottom: "N unsaved changes · **Discard** · **Save changes**" (Ctrl+S saves too). Colours and the theme preview straight away and go back if you discard. Saving a change to the connection (`llm.provider`), the vault folder, meaning-based memory search or the voice engines (voice mode, microphone, echo cancellation, wake-word engine and sensitivity, speech-to-text engine and Whisper model, voice output engine; 2.20) asks **"Restart Jarvis now?"**; picking a voice mode other than Off asks too — those apply live, but a restart gives them a clean start; choose Later to keep working. Keys (secret fields) still save with their own Save button, and changes you confirm in a dialog (allowed folders, tool permissions, vault folder) save as soon as you confirm.

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
- `memory.semanticSearch`, `memory.rerank`, `memory.reflect`
- `laya.mode` (off / shadow = watch only / on)
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
| `npm run laya:install <folder>` | install the Laya model from an ONNX export (every file checked against `models.json`) |

**Making the Laya export (once, needs Python 3.10+; ADR-027).** In PowerShell:
```powershell
py -3.11 -m venv "$env:LOCALAPPDATA\laya-venv"   # a short path: torch's files break Windows' 260-character limit
& "$env:LOCALAPPDATA\laya-venv\Scripts\python.exe" -m pip install torch --index-url https://download.pytorch.org/whl/cpu
& "$env:LOCALAPPDATA\laya-venv\Scripts\python.exe" -m pip install "laya[onnx]==0.4.0"
git clone --branch v0.4.0 --depth 1 https://github.com/NandhaKishorM/laya "$env:TEMP\laya"
$ck = & "$env:LOCALAPPDATA\laya-venv\Scripts\python.exe" -c "from huggingface_hub import snapshot_download as s; print(s('convaiinnovations/laya-multilingual', revision='e4e9ddf21a7b1903b7acffd8814ad4307bf63a67'))"
& "$env:LOCALAPPDATA\laya-venv\Scripts\python.exe" -X utf8 "$env:TEMP\laya\laya-ts\scripts\export_onnx.py" --model-dir $ck --out-dir "$env:TEMP\laya-onnx"
npm run laya:install "$env:TEMP\laya-onnx"
```
If `laya:install` reports a mismatch, this export differs from the pinned one (for example a newer torch); check it with the Laya real-model test, then re-pin `models.json` on purpose. The pinned export from 2026-10-10 is the one measured in ADR-027.

**Tests**
- **Fakes** (FakeClaude, fake OS, fake voice, fake Claude Code over real MCP, fake Telegram/Ollama/web servers) keep tests offline and deterministic.
- **Opt-in real-model test:** `tests/integration/local-voice.real.test.ts` with `JARVIS_VOICE_MODELS` set.
- **Laya real-model test:** `tests/integration/laya.real.test.ts` with `JARVIS_LAYA_MODEL` set to the installed folder; it fails if any phrase meant for Jarvis would be skipped.
- More in [Testing](Testing.md).

**Rules for contributors**
- Never weaken the hardening, policy, guards, redaction or confirmations.
- No `child_process.exec` and no string-built shell commands.
- Every tool needs a Zod schema, tier, summary, timeout and tests.
- Don't copy code from other repos; reverse-engineer them and write our own code with the same logic (AGPL/GPL: behaviour and ideas only).
- See [Code style](Code-style.md) and [Agents](Agents.md).

---

## 9. Troubleshooting

| Problem | Try |
|---|---|
| Wake word slow, or misses you | From 2.28: Settings → Voice → Wake word → **Instant "Hey <name>"**, download it (18 MB), then record **Your voice** once so it is tuned to your accent. If it still misses you, raise the sensitivity to 0.7–0.8; if it wakes by mistake, lower it. `wake word heard` in the log shows each wake. |
| Wake word never reacts | Best fix (2.28): the instant wake word (row above). Before 2.28: Settings → Voice → **Your voice**, say "Hey <name>" five times; your own voice becomes the wake word (download the 4 MB "Hey Jarvis" model first). Otherwise choose **Your name** (Whisper; hears "Jarvis" and "Hey Jarvis") or Picovoice; the "Hey Jarvis" keyword model alone ignores a plain "Jarvis" and misses accents. Look in `%APPDATA%\Jarvis\logs\jarvis.1.log` for `wake word near miss` (it heard you but not well enough: raise the sensitivity) or "microphone read failed". A wake word that can't start says why in a toast. **Test microphone** must move. |
| Said "Hey Jarvis" several times and he never listened | Fixed in 2.24: repeating the name used to restart the greeting each time, so the mic never opened. Say it once and wait for "Yes, sir?". |
| Renamed Jarvis but the old name still wakes it | With a custom name only the name works; check the spelling in Settings → General → Assistant name and pick a name of 4+ letters that Whisper spells consistently. |
| App lags or freezes while Jarvis listens or talks (before 2.9) | Fixed in 2.9: the on-device models moved to their own background process (ADR-029). If speech is still slow to recognise, choose Whisper **base.en** in Settings → Voice. |
| Hardware acceleration | Jarvis always uses the GPU (Electron's default; nothing turns it off). Turning it off would move drawing (the orb, the Brain views, glass and blur effects) onto the CPU and make the app much slower, so there is no switch for it. |
| Voice mishears words | Use Whisper **small.en** (or Deepgram); set the language; for Hindi or Telugu use multilingual small with that language. |
| Jarvis answers its own voice | Lower the speaker volume or use headphones; echo rejection handles most cases. |
| Jarvis stops talking by himself / cuts you off | Keep `voice.bargeIn` off with speakers (the wake word then can't interrupt him); raise `voice.endSilenceMs` to 1200–1500 if you pause while speaking. Prefer the Edge voice over Windows SAPI for natural speech. |
| Always listening hears nothing after changing the Whisper model | Fixed in 1.4 (it kept using the disposed model: "Session already disposed" in the log). |
| "Claude Code is not signed in" | Settings → Models & AI → Sign in with Claude, or run `claude auth login`. |
| Local model unreachable | Start Ollama / LM Studio; check the address (`http://localhost:11434/v1`); pick an installed model. FreeLLMAPI: `http://localhost:3001/v1` and paste its unified key in **Server key**. |
| Cua Driver connection fails ("spawn cua-driver ENOENT") | Install it, without the admin auto-start: in PowerShell, `irm https://cua.ai/driver/install.ps1 -OutFile $env:TEMP\cua.ps1`, read the file, then `powershell -ExecutionPolicy Bypass -File $env:TEMP\cua.ps1 -NoAutoStart`. To turn its telemetry off first: put `{"telemetry_enabled": false}` in `%USERPROFILE%\.cua-driver\config.json`. Restart Jarvis so it sees the new PATH. |
| A skill library installed but Jarvis ignores it | Library skills start **off**. Settings → Skills → filter → switch on the ones you want. |
| Model download failed | Check your connection, then Download again (files are verified; partial files are discarded). |
| Hotkey doesn't work | Another app owns it: change it in Settings → Hotkeys / Dictation. |
| Telegram silent | Settings → Telegram: token saved, channel on, Connect, pairing code sent from a private chat. |
| Reply copilot won't paste | The chat window must still be open with the same title; otherwise use Copy. |
| Database warning banner | Settings → Data & backups → Restore a backup. |
| The mic in the message box says speech needs setup | Settings → Voice → **Set up free on-device speech** (one-time ~100 MB download, with the instant wake word), or add a Deepgram key. |
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
| 027 | Laya (on-device, laya-ts on onnxruntime-node) filters ambient speech before the Claude intent judge; model routing by Laya rejected after measuring |
| 028 | Kokoro-82M (fp32 ONNX, eSpeak NG run as Sir's own program, not bundled) and ElevenLabs as optional voices; fallback chain to Edge then SAPI |
| 029 | On-device models (Whisper, Kokoro, Laya) in an Electron utility process at below-normal priority, threads capped; main stalls fell from 0.9–2.8 s to ≤ 55 ms |
| 030 | Fast path: plain PC commands run one SAFE tool with no Claude call (rules, then Laya for loose wording); Laya can't replace Claude |
| 031 | REA attached per Claude Code session (`--mcp-config`) when building "like app X"; also a Connections preset; nothing bundled |
| 032 | Jarvis Apps: Browser and Terminal in their own isolated windows with their own preloads; Timers, Scratchpad, Monitor in the Apps view |
| 033 | Chat artifacts (HTML, SVG, Mermaid) in a sandboxed frame on the app's own `artifact.html` with no network |
| 034 | Hidden capture window: echo-cancelled microphone (barge-in without headphones) and one-shot camera stills; PvRecorder as fallback |
| 035 | Jarvis drives Jarvis Browser by snapshot refs with real input; risky clicks, Enter and typing-after-reading ask first |
| 036 | Videos with HyperFrames run through npx with Sir's Node (not bundled, telemetry off) |
| 037 | Sub-agents in parallel with fresh contexts; context meter + /compact; chat search; ChatGPT/Claude import; YouTube transcripts; mood tags |
| 042 | Ideas from twelve repos (2.19): read_document (unpdf + adm-zip), cross-encoder re-ranking, weekly reflection, recall_earlier, skill libraries with injection scan, Cua Driver preset, keyed local servers (FreeLLMAPI); Docker servers, GPU engines, K8s and a Rust UI rejected |
| 041 | Ideas from ruflo: budget warnings, memory provenance + history, prompt-injection scan, private-data rule, automation watchdog, approaches that worked, local-model fallback, routine checkpoints, eval compare; 2.18: browser recipes, goals, memory tidy-up, ignored-nudge hint; swarms, federation, neural "self-learning", a continue gate and DB encryption rejected |
| 044 | Instant wake word: open-vocabulary keyword spotting (sherpa-onnx) |
| 045 | AI Router: free providers pooled in three tiers by who receives the text; private data stays in tier 1 by code; switching is allowed but always shown; Sir's own relays only in tier 3, with the question alone; Cloudflare's account id filled into a fixed address by code |

---

## 11. History

| Version | What arrived |
|---|---|
| 0.0 – 0.6 | Foundation, chat, native tools and safety, memory, voice, MCP connections, computer control |
| 1.0 | Polish and packaging: mini orb, backups, usage dashboard, installer with fuses |
| 1.1 | Claude subscription connection |
| 1.2 | On-device voice (Whisper, openWakeWord); 1.2.1 fixed the wake word never hearing anything |
| 2.8 | **Lists first**: All lists home with progress cards, a To do / Doing / Done board per list (breadcrumb Lists › Work › To do, per-column add, Doing limit, filters, list settings, archive); **Notion-style Spaces editor** ("/" block menu, Ctrl+B and friends, formatted while you write, still Markdown); **Pitch black** theme, brighter text and borders, **Text size**; **rename the assistant** (wake word and replies follow); wake word by name with on-device Whisper, and wake-word errors are shown |
| 2.9 | **No more lag:** on-device models (Whisper, Kokoro, Laya) moved to their own low-priority process; idle orb at 30 fps. **Apps:** Jarvis Browser and Jarvis Terminal (own windows), Timers with stopwatch, Scratchpad, System monitor. **Fast commands** with no AI call (rules + Laya). **REA** for "build it like app X" in Claude Code sessions and as a connection. **Reply copilot** fixes (reads the chat behind Jarvis, pastes by window handle, group chats) plus quick replies, rewrite/translate and remembered contacts. **Automations:** once, monthly and at-start schedules, templates, last result, duplicate. **Seven new orb styles** (six removed). A **?** help button on every page and main section |
| 2.12 | Ideas from LibreChat, Open-LLM-VTuber, camofox-browser and HyperFrames (§3.5e): **artifacts** in chat (live HTML, SVG, Mermaid in a sandbox), **context meter and /compact**, **search all chats**, **import ChatGPT / Claude history**, **sub-agents**, **Jarvis drives his own browser**, **YouTube transcripts**, **mood-tinted orb**, **interrupt without headphones** (echo-cancelled mic), **look through the camera**, **make videos** with HyperFrames |
| 2.11 | Ideas from five agent platforms (Paperclip, Munder Difflin, Octop, invisible_dots, Open Dots; ideas only, no code copied): Claude Code sessions in **their own git worktree**; a **circuit breaker** that stops an agent retrying a failing action or failing over and over; automations get a **per-run spending cap** and **switch themselves off** after 3 failures in a row |
| 2.40 | **Forge F7: "Jarvis, learn to …" and the Forge page.** Say "learn to …" or "teach yourself …" and Jarvis starts Forge (such requests no longer go to a free AI without tools). Sidebar → **Forge** shows every run with its cost, checks, study results, shipping steps and installer, plus totals (§3.22). New plan-quality evals for Forge |
| 2.39 | **Forge F6: "build it like that app".** `studyApp` on `forge_start` / `forge_build_tool`: a GitHub repo is studied from a read-only copy, an app or website with REA; Claude writes study notes first, then builds our own version, and the new **no-copy check** blocks code copied from the studied repo. Skills marked **Use in Forge runs** join Claude's rules (§3.22) |
| 2.38 | **Forge F5: ship and roll back.** `forge_approve` turns a passed change into a real version after you see the files, warnings and cost: version bump, installer, backup of your data, merge into `dev`, tag, push. `forge_rollback` restores the data from before the last Forge build and names the previous installer (§3.22). Also fixed: Security.md had its first half pasted into §17 |
| 2.37 | **Forge F3–F4: new tools without a reinstall, and free AIs do the typing.** `forge_build_tool` / `forge_install_tool`: a self-built tool runs in Node's permission sandbox and joins as the connection forge-<name>. `delegate_edit`: small edits go to free AIs that don't train on code first, the others only after a pop-up, then Claude (§3.22) |
| 2.36 | **Forge, phases F1–F2: Jarvis builds changes to itself.** `forge_setup`, `forge_start`, `forge_status`, `forge_cancel` (§3.22): your Claude Code works headless in Forge's own copy of the source with file tools only, then every check runs (protected files, typecheck, lint, related and full tests, build, e2e, secret scan). Protected files and weakened tests fail the run. Shipping (installer, merge, push) comes in F5 |
| 2.35 | **AI Router: free usage, and a cleaner page.** New first tab **Usage**: free tokens and requests your keys get today, this week and this month, used and left, per provider, with where each number comes from (live from OpenRouter, learned from Groq, the provider's docs, an estimate, or your own numbers from the provider's console). Tabs regrouped (everyday first), long explanations moved behind **Learn more**, only providers you have keys for are listed, the Add a key list shows free providers first with what each gives, the AI map is now a top-down **AI tree**, and Settings → Models & AI links to AI Router instead of repeating it |
| 2.34 | **AI Router Phase 4, and every AI in one place.** Models & AI moved into AI Router as **Main brain** and **API keys** tabs (Settings keeps the same parts); a new **AI map** on the Overview shows every AI and model at full size; adding a key now asks for the key itself and loads its models in one step. Six routing strategies, scores that learn from recent answers, prompt shrinking for small free limits, context-size filters and skipping, named chains, **Test this model**, and real Analytics with each provider's outlook for today |
| 2.33.1 | **AI Router: models appear as soon as you add a key.** A key with no chosen model uses every free chat model it can (OpenRouter: `:free` only); the Models tab shows context sizes and every limit; Check keys refreshes model lists; Groq limits are learned per model; an API key typed as a connection name is refused and old ones are cleaned up |
| 2.33 | **AI Router Phase 3: abilities.** Free web search (Tavily → Brave → Exa → Firecrawl → Linkup, Claude's paid search only when they're used up or the chat is private), free pictures saved to the vault (Cloudflare FLUX, Pollinations after you say yes), the **fusion** brain (free drafts + a judge, also in Compare AIs) and a voice backup chain that always says which engine is in use (cloud hearing off until you allow it). Private data never reaches any of them |
| 2.32 | **AI Router Phase 2: Claude as the boss.** Six Delegation switches: Claude hands heavy non-private work to free AIs; an optional front door sends short, plain, public questions straight to a free AI; a chat keeps its free model for 30 minutes; a hand-over note when the model changes; fallback both ways (free AIs busy → Claude; Claude out of budget or limits → a free AI for non-private chats); free AIs preferred past 80% of today's budget. The chat always says when a free AI answered, and private data never goes to one |
| 2.31 | **AI Router: your own providers and Cloudflare.** Add any OpenAI-compatible relay as a custom provider (always tier 3, HTTPS public hosts only, DNS checked before every call, address fixed, key encrypted); tier-3 routes get only the question and no tools, and their answers count as outside content; "Ask every time for third-party AIs"; Cloudflare Workers AI joins tier 2 with your Account ID put into its fixed address by code |
| 2.30 | **AI Router Phase 1: the free pool works.** Brain `free` for sub-tasks, NPCs and Compare AIs; Cerebras and NVIDIA NIM added; failover with limits learned from replies; Priority and Balanced routing; key checks and `.env` import; private data never leaves Claude and the local model (checked in code); third-party providers only after you say yes; every answer says who answered |
| 2.29 | **AI Router** in the sidebar (layout preview): every tab of the free AI pool drawn with sample numbers (Overview, Models, Providers & keys, Tiers & privacy, Delegation, Abilities, Analytics), the three tiers and the tier-3 question; the pool itself arrives in Phase 1 |
| 2.28.1 | In a window narrower than 1200 px the conversation sheet starts under the top bar, so **Show activity** and the other top-bar buttons stay reachable while it is open |
| 2.28 | **Instant wake word** (ADR-044): "Hey <name>" by on-device keyword spotting (sherpa-onnx, k2-fsa Zipformer 3.3M), any name with no training, wakes ~0.3 s after the phrase at 1–2 % CPU; the new default; tuned to Sir's accent by the five Voice Match phrases; part of the one-click on-device setup. Archived models (`.tar.bz2`) download through our own bzip2 and tar readers with per-file SHA-256 checks. Chosen after comparing the voice stacks of isair/jarvis, Priler/jarvis, PanPenek/JarvisAi, AlexandreSajus/JARVIS and Open-LLM-VTuber |
| 2.27.4 | Phone remote certificate works on a PC with only one network address (the names were glued into one and Windows refused them) |
| 2.27.3 | Phone remote certificate works when Jarvis is started from a PowerShell 7 terminal (or on GitHub's build machine): Jarvis no longer passes PowerShell 7's module path to Windows PowerShell |
| 2.27.2 | **Installer from GitHub:** every push builds `Jarvis-Setup-<version>.exe` on GitHub's Windows machine and attaches it to the ci run (Artifacts → Jarvis-Setup), so no PC is needed to build |
| 2.27.1 | Coding agents re-checked on this PC: Gemini CLI marked as refusing personal accounts (use Antigravity or a Gemini key), OpenCode noted as needing its own sign-in before Jarvis can use it |
| 2.27 | **Usage per connection** (integrations step 5): who answered each call (Anthropic key, Claude plan, this PC, each connection), live prices from OpenRouter and Vercel AI Gateway, calls at a guessed price marked, and Compare AIs shows its most possible cost and asks above a level you set |
| 2.26 | **Compare AIs** (integrations step 4): one request to several AIs, side by side, one reviewing another, or a chain; live answers with model, time, tokens and cost; Stop; run history |
| 2.25 | **Connections and models** (integrations step 3): up to five keys per AI provider, each with its own model list (live / typed / cached, favourites, hide), extra keys as their own brains for sub-agents and NPCs, and a choice of which key Jarvis's own brain uses |
| 2.24 | **Wake word fixed:** your own recorded "Hey <name>" becomes the wake word (any name and accent, on this PC; ADR-043); repeating the name no longer restarts the greeting and keeps the mic shut; "Yes, sir?" is ready before the first wake; with echo cancellation the mic opens with the greeting; near misses are logged. **Startup hello** with the time and today's plan, then the mic opens. The "capture window failed to load" warning at quit is gone |
| 2.22 | **Calmer notices:** a Claude Code session is announced at most once per 15 minutes, and spoken notices wait for a lull instead of cutting into a conversation. **Visual settings:** Settings grouped by importance with icons and search; **AI tree** of Jarvis and his models; **voice flow** diagram and mode tiles; **Skills network** of dots by group with a side panel; **Apps honeycomb** like an Apple Watch |
| 2.19.1 | Cua Driver preset: its `set_config`, `install_extension` and `install_ffmpeg` tools are blocked |
| 2.19 | Ideas from twelve repos (§3.5g): **read PDF/Word/Excel/PowerPoint**, **re-ranked memory**, **weekly reflection** into Observations, **recall_earlier** for folded chat history, **skill libraries** (whole repos, installed off, injection-scanned), **Cua Driver** desktop-control preset, and a key field for local servers such as **FreeLLMAPI**. Fix: reading a page in Jarvis Browser no longer counts as a prompt-injection attempt (the scanner saw Jarvis's own "outside content" wrapper), so clicks after a read only ask when the page really is suspicious |
| 2.18 | More from ruflo (§3.5f): **browser recipes** (save what Jarvis did in Jarvis Browser as a routine that finds controls by name), **goals** with milestones and on-track / behind status plus a Goal check template, a daily **memory tidy-up** that suggests merging duplicate notes, and a nudge when you keep ignoring a check-in |
| 2.17 | Ideas from ruflo (§3.5f): **budget warnings** at 50/75/90 %, **memory facts labelled by source** ("(inferred)", "(read)"; read-only facts wait for review) and kept as **history** when they change, a **prompt-injection scan** that makes the rest of the request ask, a **private-data rule**, an **automation watchdog**, **approaches that worked** as hints, **local-model fallback** when Claude is down, **checkpoints in routines**, `npm run evals:compare` |
| 2.10 | **Long tool results stay searchable** (idea from mksglu/context-mode): results over 20 KB show the first 8 KB plus an id, and `search_tool_output` searches or reads the rest instead of it being cut off |
| 1.3 | Features from isair/jarvis, OpenJarvis and jev-chat-jarvis (conversational voice, dictation, everyday tools, local model, skills, automations, research, Telegram, reply copilot) and this Bible |
| 1.4 | Voice fixes (always-listening model bug, no self-interruption, longer end-of-speech pause, PTT follow-ups, conversational replies); ideas from microsoft/JARVIS (HuggingGPT), sukeesh/Jarvis (plugins) and Priler/jarvis (instant commands); glass theme v2 (aurora backdrop, glass islands, Sora/Geist fonts, transparency modes, responsive down to 480 px), light and dark themes |
| 1.5 | The rest of isair/jarvis: semantic (meaning-based) memory search, recall by date, offline screen OCR, world time, chat rewind, tool routing for local models, in-app logs, slow speech-recognition guidance, Chrome and YouTube MCP presets |
| 1.6 | "Obsidian Intelligence" redesign: four-level glass, violet/cyan roles, Outfit font, eight-layer orb with tool progress, view/modal/toast motion, re-coloured light theme |
| 1.7 | "Graphite" redesign: solid neutral surfaces, one blue accent, consistent page grid, simpler orb; Transparency setting removed |
| 1.8 | "Workspace" redesign modelled on Notion: warm canvas and sidebar, purple primary, link blue, pastel tags and suggestion cards, labelled sidebar |
| 1.9 | "Geist" redesign modelled on Vercel: ink-on-white, solid-ink primary, one blue, brand mesh behind the empty-state hero, Geist + Geist Mono, stacked shadows, pill tags |
| 1.10 | Teal energy-core orb that follows voice, mic and music playing on the PC (loopback meter in its own sandboxed session) |
| 2.7 | **Better voices:** Kokoro on-device neural voice and ElevenLabs cloud voices beside Edge and Windows, with automatic fallback; ideas from four more projects (§3.5d): **Claude Code session watcher** that says when a session waits on you, start Claude Code sessions by voice, Claude plan usage gauges, play music from your library |
| 2.6 | **Soft style** (rounded, calm; the new default) beside **Cyberpunk** in Settings → General → Style; ideas from smaller Jarvis projects on GitHub (§3.5c): Wikipedia, dictionary, distance between places, window snapping, save screenshot, personalities, quiet mode, QR code and live system monitor panels |
| 2.5 | **Laya listening filter**: an on-device model decides whether ambient speech is for Jarvis before Claude is asked (off / watch only / on) |
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
- **Laya** (Convai Innovations / NandhaKishorM, Apache-2.0): the `laya-ts` runtime (used as a package, built from the v0.4.0 tag) and the `laya-multilingual` checkpoint, exported to ONNX with Laya's own script, for the listening filter.
- **context-mode** (mksglu, Elastic License 2.0; idea only, no code): keep long tool output in a local full-text index and hand the model a search handle instead of the raw text.
- **OpenJarvis** (Stanford Hazy Research, Apache-2.0): skills, scheduled agents and morning digest, deep research, channels (Telegram), news feeds.
- **Jev chat assistant / jev-chat-jarvis** (MIT; its NOTICE asks for credit): "Based on ideas from Jev Chat Assistant (https://github.com/jev-chat/jev-chat-jarvis)" for the reply copilot's analyse → stance → draft → check → fill flow and scoring.
- **microsoft/JARVIS** (MIT): HuggingGPT's plan → select model → execute → respond loop over Hugging Face models.
- **sukeesh/Jarvis** (MIT): everyday plugins (currency, stocks and crypto, network checks, password generator, file organiser).
- **Priler/jarvis** (CC BY-NC-SA 4.0): phrase-to-action instant commands without a language model, matched forgivingly.
- **microsoft/UFO** (MIT) and **Windows-Use** (MIT): the idea of driving Windows apps through their UI Automation tree before falling back to screenshots.
- **Obsidian** graph view and **Notion**: the ideas behind the Brain view and Spaces.
- **Smaller Jarvis projects** (ideas only, §3.5c): Gladiator07/JARVIS, BolisettySujith/J.A.R.V.I.S and kishanrajput23/Jarvis-Desktop-Voice-Assistant (Wikipedia, dictionary, distance, named screenshots, "be silent for a while"); Julian-Ivanov/jarvis-voice-assistant (window snapping); sosoj92/jarvis-assistant-vocal, Avinashb722/jarvis-ai-assistant and JashanMaan28/Zorin (switchable personalities, live system stats); eadmin2/jarvis_ai (machine stats panel). Data: Wikipedia (CC BY-SA, credited in every answer), Free Dictionary API, Open-Meteo.
- **Four more projects** (ideas only, §3.5d): ethanplusai/jarvis (Claude Code session watcher, starting sessions by voice, plan usage gauges), kishanrajput23/Jarvis-Desktop-Voice-Assistant (play music from the library); ascending-llc/jarvis-registry and zouhir/jarvis were reviewed.
- **Voices (2.7):** **Kokoro-82M** (hexgrad, Apache-2.0; onnx-community's ONNX conversion) and its voice packs; phoneme clean-up follows kokoro-js's public behaviour (Apache-2.0). **eSpeak NG** (GPL-3.0) is *not* bundled: Jarvis runs the copy you install as a separate program. **ElevenLabs** is a paid cloud service used with your key.
- **Libraries added in 2.0:** Baileys (MIT, WhatsApp linked device) and qrcode (MIT).
- **Agents Office** (ajsahni, PolyForm Noncommercial + Sahni.ai terms; ideas only, no code or assets) and **Claw3D** (iamlukethedev, MIT; ideas only): the NPC office, team chat with @tags and meeting room (§3.20).
- **Libraries added in 2.8:** Tiptap 3 (MIT; editor, starter kit, lists, tables, Markdown) and ProseMirror (MIT) for the Spaces editor.
- **Four more projects (2.12, ideas only, §3.5e):** **LibreChat** (MIT; artifacts, context usage and compaction, conversation search, import, subagents), **Open-LLM-VTuber** (MIT; emotion tags, interrupting without headphones, visual perception), **jo-inc/camofox-browser** (MIT; accessibility snapshots with element refs, YouTube transcripts; its anti-detection features were not taken). **HyperFrames** (heygen-com, Apache-2.0) is run as Sir's own program through npx, not bundled; its 21 skills are installed as skills.
- **Libraries added in 2.12:** Mermaid 12.2.0 (MIT), bundled into the renderer for artifact diagrams.
- **ruflo** (ruvnet, MIT; ideas only, §3.5f): cost-tracker budget ladder, typed memory provenance (ADR-323), bitemporal facts, ToolOutputGuardrail, Project Anatole watchdog, ReasoningBank, provider failover, workflow approval gates, guidance evolution/replay, browser session recipes and selector memory, goals/horizon tracking, memory consolidation, the dream-cycle follow-through ledger.
- **Twelve repos (2.19, ideas only, §3.5g):** **Tencent/WeKnora** (MIT; document parsing), **vectorize-io/hindsight** (MIT; cross-encoder re-ranking, reflect/observations), **ranxianglei/billion-context** (MIT + attribution term for using its software, which Jarvis does not; reversible compression), **affaan-m/ECC** (MIT; AgentShield-style skill scanning), **trycua/cua** (MIT; Cua Driver, used as an external MCP server, not bundled), **tashfeenahmed/freellmapi** (MIT; used as an external server), **anthropics/knowledge-work-plugins** (Apache-2.0), **K-Dense-AI/scientific-agent-skills** (MIT) and **cathrynlavery/diagram-design** (MIT) as installable skill libraries (downloaded by you, not bundled).
- **Libraries added in 2.19:** **unpdf** 1.8.1 (MIT, bundles Mozilla pdf.js, Apache-2.0) and **adm-zip** 0.6.1 (MIT) for `read_document`.
- **ms-marco-MiniLM-L-6-v2** (cross-encoder / sentence-transformers, Apache-2.0; Xenova's ONNX conversion) for re-ranking, downloaded on request.
- **Models:** the instant wake word's keyword-spotting model (k2-fsa, GigaSpeech) and sherpa-onnx are Apache-2.0; the openWakeWord "hey jarvis" model is **CC BY-NC-SA 4.0 (non-commercial)**; the Whisper weights (OpenAI) are MIT, using onnx-community's ONNX conversions; Silero VAD is MIT.

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
