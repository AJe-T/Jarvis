# JARVIS Desktop

Voice-first AI assistant for Windows: Electron + React + TypeScript, Claude API, MCP, Obsidian memory.
The full specification lives in [`docs/`](docs/README.md); start with [`CLAUDE.md`](CLAUDE.md).

## Requirements

- Windows 10 22H2+ / 11 x64, Node.js 22 LTS (22.12+), Git
- Obsidian (optional, to browse the memory vault)
- Keys (entered inside the app, stored encrypted): Anthropic (Phase 1), Picovoice + Deepgram (voice), GitHub PAT (connector)

## Commands (PowerShell)

```powershell
npm ci                # install
npm run dev           # run with hot reload
npm run typecheck     # tsc for main/preload/renderer
npm run lint          # eslint
npm test              # vitest unit + integration
npm run build; npm run test:e2e   # Playwright E2E against the built app
npm run dist          # Windows installer -> dist\Jarvis-Setup-x.y.z.exe
```

> If you launch from a shell that has `ELECTRON_RUN_AS_NODE=1` set (some editor extension hosts do),
> run `Remove-Item Env:ELECTRON_RUN_AS_NODE` first, or Electron starts as plain Node.
