# CLAUDE.md — JARVIS Desktop

You are helping Sir build **JARVIS**, a voice-first AI assistant desktop app for Windows (Electron + React + TypeScript, Claude API, MCP, Obsidian memory).

## Start here (every session)
1. Read `docs/Agents.md` **Part A** (your working rules).
2. Check the **CURRENT PHASE** line at the top of `docs/Implementation.md` and work only on that phase.
3. Read the docs that phase's prompt lists. `docs/Security.md` always applies and wins every conflict.

## Docs index
| Doc | Use it for |
|---|---|
| `docs/PRD.md` | What and why; priorities (P0/P1/P2); prior-art research |
| `docs/TRD.md` | Stack, versions policy, NFRs, ADRs |
| `docs/Architecture.md` | Processes, modules, data flow, folder structure |
| `docs/API-Guide.md` | IPC contract, tool interface, Claude/MCP/voice integration code |
| `docs/Database.md` | SQLite schema, vault layout and file formats |
| `docs/Security.md` | Permission tiers, guards, injection defenses, Electron hardening |
| `docs/Agents.md` | Part A: your rules. Part B: Jarvis runtime prompts |
| `docs/Design-system.md` | Tokens, typography, components, confirm dialog rules |
| `docs/App-flow.md` | User flows and error flows |
| `docs/Code-style.md` | Conventions, git, dependency and licensing policy |
| `docs/Testing.md` | Test plan, security suite, evals, CI |
| `docs/Implementation.md` | Phase-by-phase tasks and prompts |

## Commands
`npm run dev` · `npm run typecheck` · `npm run lint` · `npm test` · `npm run test:e2e` · `npm run dist` · `npm run evals` (costs tokens, ask first)

## Non-negotiables
- Never weaken Electron hardening, the policy engine, guards, redaction, or confirmations.
- Secrets never reach the renderer, logs, vault, tests, or git.
- No `child_process.exec`; no string-built shell commands.
- Every tool: Zod schema + tier + summarize + timeout + tests.
- Don't copy code from other repos (never from AGPL/GPL).
- Verify ⚠️-marked external APIs against official docs; fix the docs when they're wrong.
- End every task with a Before/After/Why table and PowerShell commands Sir can run to verify.
