# Standing rules (always loaded)

This file is imported by `CLAUDE.md`, so Claude reads it at the start of every session.
Keep it short: every line here costs tokens on every turn.

## How this folder works
| File | Written by | Claude reads it? |
|---|---|---|
| `YYYY-MM-DD.md` | Hook (`scripts/claude-log.mjs`): every prompt and reply, secrets redacted | **No.** Only grep it when Sir asks about a past conversation. |
| `YYYY-MM-DD-changes.md` | Hook: rebuilt from today's git commits and uncommitted files after each turn | Only when asked "what changed today". |
| `RULES.md` | Claude, when Sir gives a lasting rule | Yes, every session (this file). |
| `docs/BIBLE.md` | Claude, after any feature or behaviour change | Only the section relevant to the task. |

The daily logs are gitignored. Never paste them into context in full.

## Rules for Claude
1. When Sir states a rule meant to last ("always", "never", "from now on"), append it under **Project rules** below in the same turn.
2. After any change to features, settings, tools, or flows, update the matching section of `docs/BIBLE.md` in the same task. Run `npm run docs:reference` if tools, settings, IPC, or migrations changed.
3. Commit with conventional messages (`feat:`, `fix:` ...). The changes log is built from them, so the message is the log entry.
4. Prefer a fresh session (`/clear`) per task. Recover context from `RULES.md`, `docs/BIBLE.md` and the changes log, not from old chats.

## Project rules
<!-- Claude appends Sir's standing rules here, one bullet each, with the date. -->
- 2026-10-07: After any change, bump the version (major for breaking/big changes, minor for features and redesigns, patch for fixes) and build the Windows installer with `npm run dist` so every version has its own `dist/Jarvis-Setup-<version>.exe`. Tell Sir the path.
- 2026-10-14: Don't copy code from other repos. Reverse-engineer them instead (read the source or study the app) and write our own code with the same logic. No pasting or line-by-line translation; AGPL/GPL projects: behaviour and ideas only.
