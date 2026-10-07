# JARVIS Desktop: Documentation Pack

A complete, build-ready specification for a Jarvis-style AI assistant for Windows that **controls the desktop**, **connects to apps and the browser**, **talks and listens**, and **remembers everything in an Obsidian vault**.

## What's inside

```text
jarvis-docs/
├─ README.md            ← you are here
├─ CLAUDE.md            ← put in the repo root; Claude Code reads it automatically
└─ docs/
   ├─ BIBLE.md          ★ The whole project in one guide (also in the app: Bible view)
   ├─ REFERENCE.md      Generated from code: every tool + tier, setting, IPC channel, migration
   ├─ PRD.md            Product requirements + GitHub prior-art research
   ├─ TRD.md            Tech stack, NFRs, architecture decisions
   ├─ Architecture.md   Processes, modules, agent loop, voice & memory pipelines
   ├─ API-Guide.md      IPC contract, tool interface, Claude / MCP / voice code
   ├─ Database.md       SQLite schema + Obsidian vault structure & formats
   ├─ Security.md       Permission tiers, guards, injection defenses, hardening
   ├─ Agents.md         A: rules for Claude Code · B: Jarvis's own prompts
   ├─ Design-system.md  "Workshop at Night" visual system, orb, confirm dialog
   ├─ App-flow.md       Every user flow, incl. errors and kill switch
   ├─ Code-style.md     Conventions, git, dependency & licensing policy
   ├─ Testing.md        Unit → E2E, security suite, 40-command eval set, CI
   └─ Implementation.md Phase 0–8 build plan with copy-paste Claude Code prompts
```

**Start with [BIBLE.md](BIBLE.md).** It covers every feature, including the ones added after v1.0 (Claude subscription and local-model connections, on-device voice, conversational voice, dictation, everyday tools, skills, automations, research, Telegram and the reply copilot).

## How to use it with Claude Code

1. Do **Phase 0.1–0.3** in `docs/Implementation.md` yourself (install tools, create the scaffold).
2. Copy `docs/` into the new repo and `CLAUDE.md` into the repo root.
3. Open the repo in a terminal and start Claude Code.
4. Paste the **Phase 0 prompt** from `docs/Implementation.md` §0.5.
5. When a phase is done (tests green + your manual check), tag it, update the `CURRENT PHASE` line, and paste the next phase's prompt.

## The six features, and where they're specified

| Feature | Spec |
|---|---|
| Control the full desktop | PRD F2 · API-Guide §2, §7 · Security §4–5 · Implementation Phases 2 & 6 |
| Connect apps & browsers | PRD F3 · API-Guide §8 · Implementation Phase 5 |
| Voice agent | PRD F4 · Architecture §8 · API-Guide §9 · Implementation Phase 4 |
| Remember all conversations | PRD F5 · Architecture §7 · Database §3, §8 · Phase 3 |
| Obsidian "brain" folder | Database §8 · API-Guide §4, §6 · Phase 3 |
| Safety (makes the rest possible) | Security.md (all) · Phase 2 builds it first |

## Key decisions at a glance

- **Electron + React + TypeScript only.** One language you already know.
- **Claude API** as the brain: Sonnet 5.5 default, Opus 5.5 for deep thinking, Haiku 4.5 for background memory work.
- **Claude's memory tool** writes straight into your Obsidian vault's `Memory/` folder.
- **MCP** for app connections; **Playwright MCP** for the browser.
- **Claude computer-use toolset** for full GUI control, used last and behind a red overlay with a Stop button.
- **Porcupine** "Jarvis" wake word (on-device) → **Deepgram** STT → Claude → **Edge TTS** British voice.
- **Code-enforced permission tiers** (SAFE / CONFIRM / BLOCKED). The AI can't approve its own actions.

> Features from open-source projects (Microsoft UFO, Windows-MCP, Goose, Playwright MCP, mem0, Khoj, Open Interpreter, Porcupine) were studied and **re-specified as original designs**, not copied, because several of those projects are AGPL-licensed. See PRD §8.
