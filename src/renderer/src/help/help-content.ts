/**
 * The "?" help on every page and settings section (help-button.tsx). Keys: a page ("tasks"), a
 * settings page ("settings.voice") or a settings section by its title ("section:Wake word").
 * Keep each entry short: what it is, how to use it, what to say, and the one thing people trip on.
 */
export interface HelpEntry {
  title: string;
  what: string;
  how: string[];
  /** Things to say or type to Jarvis. */
  say?: string[];
  tips?: string[];
}

export const HELP: Record<string, HelpEntry> = {
  // ── Pages ──
  core: {
    title: 'Core',
    what: 'Jarvis’s home screen. The orb shows what Jarvis is doing: listening, thinking, working through tools, speaking, waiting for you (yellow) or an error (red).',
    how: [
      'Click the orb (or press your push-to-talk key) to speak; click again to stop.',
      'Start typing anywhere to open the conversation with your words already in the box.',
      'The speech-bubble button in the header shows or hides the conversation log.',
      'Hover one of your messages to edit it or ask again from there.',
      'The bar in the conversation header shows how full Jarvis’s context is; click it to compact, or type /compact.',
      'Diagrams, charts and small tools Jarvis makes appear as live cards: switch to the code, open full screen or save them.',
      'Conversations → Search all chats finds any past chat as you type.',
    ],
    say: [
      'What’s on my calendar today?',
      'Draw our release process as a diagram',
      'Summarise this video: https://youtu.be/…',
      'Search for flights to Goa in the browser',
    ],
    tips: [
      'The orb takes the mood of each reply for a moment (warm when happy, amber when concerned).',
      'Start a message with /private to keep it out of your Obsidian daily log.',
      'Short PC commands (“open Spotify”, “volume 30”, “next song”) run instantly with no AI call.',
    ],
  },
  spaces: {
    title: 'Spaces',
    what: 'Notion-style notebooks (Learning, Finance, Ideas…) saved as plain Markdown in your Obsidian vault.',
    how: [
      '+ New space in the sidebar, then New page (templates: journal, meeting notes, expense log…).',
      'Press / on any line for headings, lists, to-dos, tables, code and links to other pages.',
      'Pages save by themselves a second after you stop typing (Ctrl+S saves now).',
      'The sparkle button asks Jarvis about the page you’re on.',
    ],
    say: [
      'Add this to my Finance space under October',
      'What did I note in Learning about closures?',
    ],
    tips: ['Deleting moves pages to the vault’s .trash, so nothing is lost by accident.'],
  },
  compare: {
    title: 'Compare AIs',
    what: 'Send one request to several AIs you have set up and see what each says: side by side, one checking another, or a chain where each builds on the last. They only answer: no tools, nothing on your PC changes.',
    how: [
      'Compare: 2–4 AIs answer the same prompt at the same time.',
      'Review: the first AI answers, the second points out mistakes and gives a better version.',
      'Chain: each stage gets your request plus the previous stage’s output and its own job (“check the facts”, “make it shorter”).',
      'Every answer shows its model, time, tokens and an estimated cost. Stop cancels the rest. History keeps the last 50 runs on this PC.',
      'Your prompt goes to every AI you pick, and each bills its own account: pick only the ones you want to see it.',
    ],
  },
  forge: {
    title: 'Forge',
    what: 'Jarvis improving itself: a new tool (no reinstall) or a change to its own code, built and checked by your Claude Code in Forge’s own copy of the source. This page lists every run, what it cost and what shipped.',
    how: [
      'Ask: Jarvis agrees the goal with you, then asks before it starts (budget per run in Settings, default $5 of Claude).',
      'A change that passes every check waits for you: say “approve it” to see the files and cost, then it builds the installer, backs up your data, merges and pushes. You run the installer yourself.',
      'Name an app, a website or a GitHub repo to build it like: Claude studies it first and writes our own version; copied code fails the run.',
      'Open a run for its checks, study notes, shipping steps, installer path and Claude’s summary.',
    ],
    say: [
      'Jarvis, learn to convert currencies',
      'Add a dark mode toggle to Settings, like the one in VS Code',
      'How is Forge doing?',
      'Approve it',
      'Roll back Forge',
    ],
    tips: [
      'Forge starts every run from GitHub’s dev branch: push your own commits first.',
      'Roll back in this order: close Jarvis, run the previous installer, then start Jarvis.',
    ],
  },
  router: {
    title: 'AI Router',
    what: 'Every AI Jarvis uses, in one place: how much free AI your keys give you, all your API keys, the free models, the main brain that answers you (Claude), and the rules for who may see what. Since 2.35 this is the only place for these settings; Settings → Models & AI just links here.',
    how: [
      'Usage (first tab): free tokens and requests your keys get today, this week and this month, how many you used and how many are left, per provider.',
      'API keys: add a key in one step. Free providers are listed first with what each gives free; their keys join the free pool by themselves.',
      'Free models: the order requests go in, filters, each model’s limits, and Test this model.',
      'Abilities: free web search, free pictures, the fusion brain and the voice backup chain.',
      'After the divider, the things you set once: Main brain (Claude, its models, budget), Rules (tiers, private data, how Claude shares work), the AI tree, and History (charts).',
    ],
    tips: [
      'The tier depends on who receives your text, not the model: Gemini through Google is tier 2, Gemini through an unknown relay is tier 3.',
      'OpenRouter keys only ever use models ending in :free; its other models cost money.',
      'Never paste a key into a name box: Jarvis refuses names that look like keys.',
    ],
    say: [
      'Use the free pool to summarise these three pages',
      'Ask a free AI to translate this into Hindi',
      'Draw a logo for my bakery',
      'Use the Coding chain to write a regex for email addresses',
    ],
  },
  'router:usage': {
    title: 'Free usage',
    what: 'How many free tokens and requests your keys get, and how many you used, for today, this week and this month. A week is seven days of the daily allowance; a month is this month’s days of it.',
    how: [
      'The two big numbers are what is left across all your free keys. A provider whose cap isn’t known is listed under the total instead of being counted as zero.',
      'Groq, Gemini and Cerebras give each model its own daily cap, so a key’s allowance is the sum over the models it lends the pool. OpenRouter, Cloudflare and Mistral have one cap for the whole key.',
      'The tag on each provider says where its numbers come from: Live (read from the provider at the last key check: OpenRouter), Learned (from the provider’s replies: Groq), Published (the provider’s limits page), Estimate (the provider shows it only after sign-in), or Yours.',
      'Press the pencil to type the numbers you see in the provider’s own console. They replace Jarvis’s for that provider.',
      'Check now asks every key again (no tokens used) and refreshes the live counts.',
    ],
    tips: [
      'Why not ask an AI or search the web for the limits? Jarvis did that once, when this page was built, and checked each number against the provider’s own docs. A live AI answer would often be out of date or made up, so the numbers here are dated and labelled instead.',
      'Gemini counts requests, not tokens, and resets at midnight Pacific time; most others reset at midnight UTC.',
      'NVIDIA has no daily cap (about 40 requests a minute), so it never shows as running out.',
    ],
  },
  'router:keys': {
    title: 'API keys',
    what: 'Every AI key you saved. Keys are encrypted on this PC with Windows DPAPI; only their last four characters are ever shown.',
    how: [
      'Add an API key: pick the provider, paste the key, optionally name it, press Save and load models.',
      'Free (trusted, tier 2) providers are listed first with what each gives free. Their keys join the free pool with every free chat model they can use.',
      'Paid providers (OpenAI, DeepSeek…) are used only when you pick one as the main brain or Claude hands it a task.',
      'Below the list: the free providers you added, their health and tier, free search keys, .env import and your own tier-3 relays.',
    ],
    tips: [
      'Up to 5 keys per provider (work and personal). With several, Jarvis uses the one with the most room left.',
    ],
  },
  'router:brain': {
    title: 'Main brain',
    what: 'Claude (by API key or your Claude plan) is Jarvis’s main brain: it reads your memory, uses your tools and decides what to hand to free AIs.',
    how: [
      'Connection: Claude by API key, your Claude plan, a local model, or another AI.',
      'Claude’s models: which model does conversation, deep thinking, background jobs and computer control.',
      'Budget: Claude requests stop when a daily or monthly budget is used up.',
      'Changes wait in the bar at the bottom until you press Save.',
    ],
  },
  'router:rules': {
    title: 'Rules',
    what: 'Who may receive which work. Tier 1 is Claude and your local model (gets everything). Tier 2 is trusted free providers (non-private work only). Tier 3 is third-party relays (last resort, only after you say yes, never private data).',
    how: [
      'The tier cards show only AIs you have set up. Move a provider between tier 2 and 3 on API keys.',
      'Private data never leaves tier 1: if a task used memory, files, the screen, passwords, the clipboard or your messages, Claude or your local model answers. Checked in code on every request, with no off switch.',
      'How a request is shared out: the front door sends short, plain, non-private questions straight to a free AI; Claude does private or important work itself and hands heavy, harmless parts to the free pool, reading only the short report.',
      'Examples: “What’s 15% of 2,400?” and “Summarise these three articles” go free (tier 2). “What did I note about my loan?” and “Reply to Priya on WhatsApp” stay with Claude (tier 1).',
      'When everything free is busy, Jarvis says plainly why (“7 routes checked, 5 rate limited, soonest back in 2 min”) and Claude can do it instead.',
    ],
  },
  'router:models': {
    title: 'Free models',
    what: 'Every free chat model your keys can use, shown in the order requests would go to them right now.',
    how: [
      'Routing strategy: Priority (your order), Balanced, Smartest, Fastest, Most reliable, or Custom weights.',
      'Filter by tools, pictures, tier or context size; open a model to see each door (provider), its limits and Test this model.',
      'Smarter routing: scores learn from the last week, long prompts are trimmed for small free limits, and a model too small for a request is skipped.',
      'Named chains give a kind of job (“Coding”) its own order of models.',
    ],
  },
  'router:abilities': {
    title: 'Abilities',
    what: 'Free extras on top of chat: free web search (paid Claude search only as a last resort), free pictures saved to your vault, the fusion brain (several free AIs draft, one judges), and a voice backup chain.',
    how: [
      'Each one has its own switch. Search keys go on API keys → Free search keys.',
      'Hearing backup sends your recorded voice to Groq or OpenAI only when Whisper on this PC fails, so it stays off until you switch it on.',
    ],
  },
  'router:tree': {
    title: 'AI tree',
    what: 'Every AI Jarvis can use, from the top down: Jarvis, then the main brain, the free pool, paid helpers and abilities, each provider as a branch and its models listed under it.',
    how: [
      'Click any box to open the tab that changes it.',
      'Faded boxes with dashed wires are set up but not working (no key yet, or switched off).',
      'A provider shows up to 6 models; the rest are one “+N more” line (all of them are on Free models).',
    ],
  },
  npcs: {
    title: 'NPCs',
    what: 'Your team of single-purpose agents (Marketing, Finance, Developers, Research…). Each has its own AI, tools and memory. Jarvis is their head: he gives them work, reads their memories and runs their meetings.',
    how: [
      'Hire an NPC from a template or from scratch; switch it off any time.',
      'Team chat: #office is everyone. Tag someone (@Maya) to give them work; with no tag, Jarvis decides who does it. NPCs tag each other too.',
      'Meeting room: pick NPCs and a topic. They talk in turns, then Jarvis posts decisions and action items; the minutes go to your vault (NPCs/Meetings).',
      'Each NPC keeps its own memory note (NPCs/<name>/Memory.md). Jarvis can read all of them.',
    ],
    say: [
      'Ask Maya and Ledger to plan the launch budget',
      'Call a meeting with the developers about the login bug',
      'What does Scout remember about our competitors?',
    ],
    tips: [
      'Brains: any AI set up in Settings → Brain, or your ChatGPT / Gemini plan through their apps (those only think and write, no tools).',
      'Every tool an NPC uses goes through Jarvis’s safety rules and confirmations.',
    ],
  },
  tasks: {
    title: 'Tasks',
    what: 'To-do lists with boards (To do / Doing / Done), due dates, reminders, repeats, priorities and subtasks.',
    how: [
      'Press N for quick add and type naturally: “Call mom tomorrow 6pm #family !1 every week”.',
      'Open a list for its board; drag cards between columns to change their status.',
      'Click a task for details: reminder, repeat, subtasks, notes, Focus 25 min.',
      'Smart lists on the left: Inbox, Today, Upcoming, Starred, Completed.',
    ],
    say: [
      'Add buy milk for tomorrow',
      'What’s on my list today?',
      'Mark the electricity bill done',
    ],
    tips: ['!1–!4 sets priority; #name puts it in a list (or a tag when no list has that name).'],
  },
  calendar: {
    title: 'Calendar',
    what: 'Day, week, month, schedule and year views of your events, with reminders and repeats.',
    how: [
      'Drag across empty time to create an event, or use quick add: “Lunch with Sam fri 1-2pm”.',
      'Drag an event to move it; drag its bottom edge to change its length.',
      'Keys: D W M A Y switch view, T today, ← → move, N new event.',
      'Import or export .ics files from the calendar list.',
    ],
    say: ['When am I free on Monday for an hour?', 'Move standup to 10:30'],
  },
  brain: {
    title: 'Brain',
    what: 'Your whole Obsidian vault drawn as a living graph, six different ways.',
    how: [
      'Pick a view at the top: Neural, 3D orbs, Clusters, Constellations, Mind map, Treemap.',
      'Scroll to zoom, drag to move, click a dot to read the note in the side panel.',
      'Find a note jumps to it; the legend hides or shows folders.',
    ],
  },
  memory: {
    title: 'Memory',
    what: 'What Jarvis remembers about you, stored as notes in your Obsidian vault and searched on every turn.',
    how: [
      'Browse and search memories; forget any you don’t want kept.',
      'The review queue holds suggestions that looked like instructions: approve or discard them.',
      'Edits you make in Obsidian are picked up within seconds.',
    ],
    say: ['Remember that my sister’s name is Priya', 'What did we talk about yesterday?'],
  },
  passwords: {
    title: 'Passwords',
    what: 'An encrypted password vault (AES-256, opened only by your master password). The AI never sees it.',
    how: [
      'Create a master password the first time. It is never stored: forget it and the vault can’t be opened.',
      'Add entries with a username, password, site, category and optional two-factor secret.',
      'Copying a password wipes it from the clipboard after 20 seconds.',
    ],
    tips: ['It locks itself after 5 idle minutes, when Windows locks, or with the lock button.'],
  },
  apps: {
    title: 'Apps',
    what: 'Jarvis’s own apps, as a honeycomb of bubbles like an Apple Watch: point at one to see what it does, click to open it beside the orb. Core’s “All apps” button shows the same honeycomb. Jarvis opens them too.',
    how: [
      'Today, Calculator, Unit converter, World clock, QR code, Pomodoro, AI usage and Jarvis status: small tools that run on this PC. Ask “what is 2+2?” and the calculator opens with the answer.',
      'Browser: Jarvis’s own browser, beside the orb. Its pages are kept apart from the app (own cookies, no access to Jarvis). Jarvis can open pages there, read them, and use them: click links and buttons, fill in search boxes, pick options and scroll.',
      'Terminal: a PowerShell console beside the orb. Type commands; `cd` carries over. Every script Jarvis runs for you (after you approve it) appears there too.',
      'Camera: a live preview of your webcam; Take photo saves to Pictures\\Jarvis Camera. The camera turns off when you close it. Jarvis asks before opening it.',
      'Timers: quick countdowns, every running timer and reminder with a live countdown, and a stopwatch with laps.',
      'Scratchpad: quick notes you and Jarvis share. It saves as you type.',
      'System monitor: CPU, memory, disk, battery and uptime.',
    ],
    say: [
      'Open the docs for React in your browser',
      'Summarise the page in my browser',
      'Put this phone number on the scratchpad',
      'Open the terminal',
      'What is 15% of 2400?',
      'Open the camera',
    ],
    tips: [
      'Commands that the safety rules block (formatting disks, registry edits, downloads that run code…) are refused in the Terminal too.',
      'Browser shortcuts: Ctrl+L address bar, Alt+← back, F5 reload, Ctrl+W close.',
      'Close an app with the ✕ on its panel, or open another; the browser keeps its pages until you close it.',
      'When Jarvis uses the browser, clicks that buy, pay, send, post or delete, pressing Enter, and typing after he has read a page all ask you first. He never types passwords, card numbers or codes.',
    ],
  },
  automations: {
    title: 'Automations',
    what: 'Things Jarvis does by itself while it is running: briefings, recurring tasks, and check-ins that speak only when something matters.',
    how: [
      'New automation, or pick one from Templates and adjust it.',
      'When: at a time on chosen days, every N minutes, once on a date, monthly on a day, or each time Jarvis starts.',
      'Kind: Briefing (spoken and/or saved), Task (do and report) or Check-in (silent unless worth saying).',
      'Run now tries it at once; Last result opens its latest conversation; Duplicate copies one to change.',
    ],
    say: ['Every Friday at 5 pm summarise my week', 'On the 1st of each month check my bills'],
    tips: [
      'Nothing runs while Jarvis is closed; a run missed by more than 2 hours is skipped.',
      'Actions that need your OK still ask you, even in an automation.',
    ],
  },
  skills: {
    title: 'Skills',
    what: 'Instruction packs (a folder with SKILL.md) that teach Jarvis how to do a kind of task.',
    how: [
      'Every skill is a dot in a network, grouped by what it helps with (Code, Design, Data, Writing…). Lit dots are on.',
      'Search to find skills (Enter jumps to the first); click a group chip to hide that group.',
      'Click a dot: the side panel shows what it does, switches it on or off, reads its instructions or removes it.',
      'Install from a folder or a public GitHub folder link below the network. Only text files are kept.',
    ],
    tips: ['Skills never run code; every action still asks you as usual.'],
  },
  connections: {
    title: 'Connections',
    what: 'Extra tools for Jarvis through MCP servers: browsers, search, GitHub, Notion, Zapier, smart home and more.',
    how: [
      'Add connection → Catalogue for vetted ones, MCP Registry to search thousands, or Custom.',
      'Enter any key the connection needs before pressing Connect; keys are stored encrypted.',
      'Each tool asks first unless you mark it safe.',
    ],
    tips: [
      'REA (Developer) lets Jarvis study how another app works. To build something “like app X”, just ask: Jarvis starts Claude Code with REA attached for that session.',
      'Connections with many tools add to every request on an API key; the Claude subscription loads them only when needed.',
    ],
  },
  copilot: {
    title: 'Reply copilot',
    what: 'Helps you answer a chat (WhatsApp, Telegram, Slack…): reads it, works out what they want, drafts replies in your style and checks them. It pastes your pick; you press Send.',
    how: [
      'Open the chat, then press the copilot hotkey (Ctrl+Alt+R) or click Read chat on screen.',
      'Pick who it is. Jarvis remembers this for the contact next time.',
      'Quick replies gives three short answers at once; Analyse → pick a stance → Draft two replies gives checked drafts.',
      'Rewrite any reply: Shorter, Warmer, Firmer, Formal, Casual, + Emoji, or Translate into a language.',
      'Paste into chat puts it in the same chat’s message box. Jarvis never sends.',
    ],
    say: ['Help me reply'],
    tips: [
      'Works with group chats too.',
      'If you switched to a different chat before pasting, Jarvis won’t paste; copy instead.',
    ],
  },

  // ── Settings pages ──
  'settings.general': {
    title: 'General',
    what: 'Name, look and feel: assistant name, theme, style, accent colour, text size, orb style and personality.',
    how: [
      'Changes preview as you pick; press Save changes to keep them.',
      'Orb style: hover a card to see it move. Every style follows your accent colour and Jarvis’s state.',
    ],
    tips: ['A custom assistant name changes the wake word too.'],
  },
  'settings.everyday': {
    title: 'Everyday',
    what: 'Home town for weather, meal log target, Hugging Face models, Claude Code session alerts and other daily helpers.',
    how: ['Set your home town (or press Detect) so “What’s the weather?” needs no place name.'],
  },
  'settings.brain': {
    title: 'Models & AI',
    what: 'Which brain Jarvis uses (Anthropic API key, your Claude subscription, another AI provider or a local model), which models, and spending limits.',
    how: [
      'The AI tree at the top shows Jarvis, every AI connected to him (main brain, helpers, fallback) and the models each runs. Click a branch to jump to its settings.',
      'Pick a connection and test it.',
      'API key: daily and monthly budgets stop spending when reached.',
      'Fast commands: plain PC commands skip the AI entirely (Off / Rules / Rules + Laya).',
    ],
    tips: [
      'The subscription connection counts against your Claude plan, shown as API-equivalent cost.',
    ],
  },
  'settings.files': {
    title: 'Files & permissions',
    what: 'Which folders Jarvis may read and change, and stricter rules for any tool.',
    how: [
      'Add or remove allowed folders. Anything outside them is refused.',
      'Stricter rules make a tool always ask (or never run).',
    ],
    tips: ['Deleting always goes to the Recycle Bin, never a permanent delete.'],
  },
  'settings.memory': {
    title: 'Memory',
    what: 'Where your Obsidian vault is and how Jarvis searches it.',
    how: [
      'Choose the vault folder.',
      'Download semantic search (24 MB) to find notes by meaning, on this PC.',
      'Import chats from ChatGPT or Claude: pick the export .zip you get from either service; each chat becomes a note in Memory/Imports.',
    ],
    tips: ['Importing again is safe: chats already imported are skipped.'],
  },
  'settings.telegram': {
    title: 'Phone & chat apps',
    what: 'Talk to Jarvis from your phone: Telegram bot, WhatsApp (your own “message yourself” chat) and the phone remote web app.',
    how: [
      'Turn a channel on and follow its pairing steps.',
      'Destructive actions can only be approved at the PC.',
    ],
  },
  'settings.passwords': {
    title: 'Passwords',
    what: 'When the password vault locks itself and other vault options.',
    how: ['Set the idle lock time. The vault also locks when Windows locks or sleeps.'],
  },
  'settings.voice': {
    title: 'Voice',
    what: 'How you talk to Jarvis and how it talks back: mode, wake word, speech recognition, voice, microphone and the Laya filter.',
    how: [
      'Voice mode: Off, Press to talk, Wake word, or Always listening (on this PC), as four tiles.',
      'How your voice travels: microphone → wake → hearing → thinking → speaking, with the engine for each. The stage at work lights up while you talk; click one to change it.',
      'Set up free on-device speech downloads Whisper base.en (~80 MB) in one click.',
      'Pick a voice: Edge (online, free), Kokoro (on this PC), ElevenLabs (cloud) or Windows.',
    ],
    tips: [
      'Echo cancellation (on by default) stops the microphone hearing Jarvis, so you can interrupt him by name without headphones.',
      'On a laptop CPU choose Whisper base.en: small.en is more accurate but slower than you speak.',
      'All on-device models run in a separate low-priority process, so the app stays smooth while they work.',
    ],
  },
  'settings.dictation': {
    title: 'Dictation',
    what: 'Type with your voice into any app: press the dictation hotkey, speak, pause.',
    how: [
      'Turn it on, then press Ctrl+Alt+D in any app and speak.',
      'Pause about 1.5 s (or press the hotkey again) and the text is pasted at your cursor.',
      'The dictionary fixes words it mishears: “avan tech => AvaanTech”.',
    ],
  },
  'settings.privacy': {
    title: 'Privacy',
    what: 'What Jarvis logs, keeps and sends.',
    how: ['Use /private at the start of a message to keep a conversation out of the vault log.'],
  },
  'settings.hotkeys': {
    title: 'Hotkeys',
    what: 'Global keyboard shortcuts that work in any app.',
    how: [
      'Click a hotkey and press the new combination.',
      'If one is taken by another app, Jarvis says so; pick another.',
    ],
    tips: ['Ctrl+Alt+Shift+X is the kill switch: it stops everything Jarvis is doing.'],
  },
  'settings.data': {
    title: 'Data & backups',
    what: 'Daily backups of Jarvis’s database, restore, and how long messages are kept.',
    how: ['Back up now, or pick a backup to restore on the next start.'],
  },
  'settings.advanced': {
    title: 'Advanced',
    what: 'Logs, limits and other settings most people never need.',
    how: ['Logs shows the newest log lines with secrets removed; Open logs folder for the files.'],
  },
  'settings.activity': {
    title: 'Activity & usage',
    what: 'Every action Jarvis took, the tamper-evident audit log, and spending by model, purpose and day.',
    how: ['Filter actions; open Usage for cost and your Claude plan’s 5-hour and weekly windows.'],
  },
  'settings.bible': {
    title: 'Bible (help)',
    what: 'The full guide to Jarvis, searchable, plus the generated reference of every tool and setting.',
    how: ['Search for any feature, setting or error.'],
  },
  'settings.about': {
    title: 'About',
    what: 'Version, credits and licences.',
    how: [],
  },

  // ── Settings sections ──
  'section:Wake word': {
    title: 'Wake word',
    what: 'How Jarvis hears its name when you aren’t pressing anything.',
    how: [
      'Your own “Hey <name>” (best): record it five times in Your voice; any name, any accent, instant.',
      'Your name by speech recognition: on-device Whisper listens for the assistant’s name, any name.',
      'Keyword “Hey Jarvis”: lightest on the CPU but only hears “Hey Jarvis” and can miss accents.',
      'Raise sensitivity (0.6–0.7) if it misses you; lower it if it wakes by itself. The log shows “wake word near miss” when it almost heard you.',
    ],
  },
  'section:Voice mode': {
    title: 'Voice mode',
    what: 'When Jarvis listens.',
    how: [
      'Press to talk: the Talk button or the push-to-talk hotkey.',
      'Wake word: say the name, then your request, in one breath.',
      'Always listening: everything is transcribed on this PC into a 2-minute memory-only buffer; say the name anywhere in a sentence.',
    ],
  },
  'section:Speech to text': {
    title: 'Speech to text',
    what: 'What turns your voice into words: Deepgram (cloud, instant) or Whisper (on this PC, free).',
    how: ['Pick the engine and, for Whisper, the model size. base.en is quickest on laptops.'],
  },
  'section:On-device listening filter (Laya)': {
    title: 'Laya',
    what: 'A 1.3 GB model that runs on this PC and answers small multiple-choice questions about text in one quick pass. It doesn’t write replies, so it can’t replace Claude.',
    how: [
      'Listening filter (always-listening mode): decides whether a phrase was meant for Jarvis before Claude is asked. Watch only logs agreement; On skips Claude when Laya is sure it wasn’t.',
      'Fast commands (Models & AI): Laya also understands loosely worded PC commands such as “ugh, skip this song” or “shh”, which then run with no AI call.',
    ],
    tips: [
      'Laya runs in the separate model process, so it never slows the app.',
      'The listening filter steps aside with a custom assistant name (its labels say “Jarvis”); fast commands still work.',
    ],
  },
  'section:Semantic search': {
    title: 'Semantic search',
    what: 'Finds notes and past messages by meaning, not just matching words, with a 24 MB model on this PC.',
    how: ['Download it once; new notes are indexed in the background.'],
  },
  'section:Budget': {
    title: 'Budget',
    what: 'Daily and monthly spending limits for the Anthropic API key connection.',
    how: ['When a limit is reached Jarvis stops calling the API until the next day or month.'],
  },
  'section:Computer control': {
    title: 'Computer control',
    what: 'Lets Jarvis move the mouse and type to do a task in any app (API key connection only).',
    how: ['Each session starts only after you confirm; a red border and Stop pill stay on screen.'],
  },
  'section:Phone remote (free, no app to install)': {
    title: 'Phone remote',
    what: 'Talk to Jarvis from your phone’s browser on your home network, including hands-free calls.',
    how: [
      'Turn it on, press Pair a phone and scan the QR code.',
      'Accept the self-signed certificate warning the first time.',
    ],
  },
  'section:WhatsApp': {
    title: 'WhatsApp',
    what: 'Command Jarvis from your own WhatsApp “Message yourself” chat.',
    how: [
      'Turn it on and link it in WhatsApp → Linked devices.',
      'Write “Jarvis, …” in your self chat. Other chats are never read as commands.',
    ],
    tips: [
      'Uses an unofficial library; WhatsApp may restrict accounts that do. Consider a spare number.',
    ],
  },
  'section:Telegram': {
    title: 'Telegram',
    what: 'A private Telegram bot that talks only to you.',
    how: [
      'Create a bot with @BotFather, paste its token, then send the 6-digit pairing code to it.',
    ],
  },
  'section:News feeds': {
    title: 'News feeds',
    what: 'RSS/Atom feeds for headlines and the morning briefing.',
    how: ['One per line: Name | https://feed-address'],
  },
  'section:Allowed folders': {
    title: 'Allowed folders',
    what: 'The only folders Jarvis’s file tools may touch.',
    how: ['Add your project folders here so Jarvis can read and organise them.'],
  },
  'section:Fast commands': {
    title: 'Fast commands',
    what: 'Plain PC commands, typed or spoken, run straight away with no Claude call: instant and free.',
    how: [
      'Rules + Laya (recommended): exact phrasings, plus loosely worded ones Laya understands on this PC.',
      'Exact phrasings only: just the rules below.',
      'Off: every message goes to Claude.',
    ],
    say: ['Open Spotify', 'Volume 30', 'Next song', 'Mute', 'Lock my PC', 'Ugh, skip this song'],
    tips: [
      'Anything longer or unclear (“open my downloads folder and sort it”) still goes to Claude.',
      'They run through the same safety rules and activity log as any other action.',
    ],
  },
  'section:Templates': {
    title: 'Automation templates',
    what: 'Ready-made automations you can add in one click and adjust.',
    how: ['Press Use this, change the time or wording if you like, and Save.'],
  },
  'section:Claude Code sessions': {
    title: 'Claude Code sessions',
    what: 'Jarvis watches your Claude Code sessions and tells you when one is waiting for you.',
    how: ['Choose: speak up when one is waiting, also when one finishes, or never.'],
  },
};
