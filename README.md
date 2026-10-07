# JARVIS Desktop

Voice-first AI assistant for Windows: Electron + React + TypeScript, Claude API, MCP, Obsidian memory.
**Read [`docs/BIBLE.md`](docs/BIBLE.md)**: everything about the project in one guide (also in the app's Bible view).
Exact lists of tools, settings and IPC channels are generated into [`docs/REFERENCE.md`](docs/REFERENCE.md).
For contributors: [`CLAUDE.md`](CLAUDE.md) and the specs in [`docs/`](docs/README.md).

## Highlights

- Three brains: Anthropic API key, your Claude subscription (via Claude Code), or a local model (Ollama / LM Studio)
- Voice: wake word ("Jarvis" / "Hey Jarvis"), always-listening ("…what do you think, Jarvis?"), follow-ups without the wake word, cloud or on-device speech, dictation into any app
- Memory in your Obsidian vault; guarded PC control (apps, files, settings, PowerShell, mouse and keyboard)
- Weather, meal log, "what's on my screen", web pages, deep research with citations, news feeds
- Skills (SKILL.md), scheduled automations and a morning briefing, Telegram from your phone, reply copilot for chat apps

## Requirements

- Windows 10 22H2+ / 11 x64, Node.js 22 LTS (22.12+), Git
- Obsidian (optional, to browse the memory vault)
- One brain: an Anthropic API key, **or** Claude Code signed in to your Claude plan, **or** Ollama / LM Studio
- Optional keys (entered inside the app, stored encrypted): Deepgram + Picovoice (cloud voice; on-device alternatives need none), GitHub PAT / Notion token (connectors), Telegram bot token

## Commands (PowerShell)

```powershell
npm ci                # install
npm run dev           # run with hot reload
npm run typecheck     # tsc for main/preload/renderer
npm run lint          # eslint
npm test              # vitest unit + integration
npm run build; npm run test:e2e   # Playwright E2E against the built app
npm run dist          # Windows installer -> dist\Jarvis-Setup-x.y.z.exe
npm run docs:reference  # regenerate docs/REFERENCE.md from the code
```

> If you launch from a shell that has `ELECTRON_RUN_AS_NODE=1` set (some editor extension hosts do),
> run `Remove-Item Env:ELECTRON_RUN_AS_NODE` first, or Electron starts as plain Node.
