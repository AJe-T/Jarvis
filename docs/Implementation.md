# Implementation Plan — JARVIS Desktop

| Field | Value |
|---|---|
| Status | v1.0 |
| Last updated | 2026-10-06 |
| Related | All docs. This is the **build order**. Claude Code works on one phase at a time. |

**How to use this file with Claude Code:** finish each phase completely (tests + Sir's manual check + git tag) before starting the next. Each phase has a ready-to-paste prompt. Every phase ends with a working app, never a half-built one.

Current phase tracker (Sir updates this line):

> **CURRENT PHASE: 4**

---

## Phase 0 — Environment & Scaffold (≈ 2 days)

### 0.1 Install tools (PowerShell, one at a time)

```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
winget install Microsoft.VisualStudioCode
winget install Obsidian.Obsidian
# Close and reopen PowerShell, then verify:
node -v; npm -v; git --version
```

Native modules (`better-sqlite3`, nut.js fork, Picovoice) normally download prebuilt binaries. **Only if** an install fails with `node-gyp` / `MSBuild` errors, install the C++ build tools:

```powershell
winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
winget install Python.Python.3.12
```

Install **Claude Code** following the official guide (https://docs.claude.com/en/docs/claude-code/overview).

### 0.2 Accounts & keys (Sir does these himself, never paste keys into chats)

| Key | Where | When needed |
|---|---|---|
| Anthropic API key | console.anthropic.com → API Keys (also set a monthly spend limit) | Phase 1 |
| Picovoice AccessKey (free) | console.picovoice.ai | Phase 4 |
| Deepgram API key | console.deepgram.com | Phase 4 |
| GitHub fine-grained PAT (read-only first) | github.com → Settings → Developer settings | Phase 5 |

### 0.3 Scaffold

```powershell
cd D:\Projects     # or wherever Sir keeps code
npm create @quick-start/electron@latest jarvis -- --template react-ts   # electron-vite scaffolder ⚠️ verify command
cd jarvis
git init
mkdir docs
# copy the 12 docs into .\docs and CLAUDE.md into the repo root
npm install
npm run dev        # a blank Electron window should open
```

### 0.4 Phase 0 tasks
- [ ] Apply `Code-style.md` §12 configs (tsconfig strict, Prettier, ESLint flat config with restricted imports).
- [ ] Create folder structure from `Architecture.md` §10 (empty `index.ts` files with module README stubs).
- [ ] Add Vitest + one passing test; add `typecheck`, `lint`, `format`, `test` scripts.
- [ ] `.gitignore` (node_modules, out, dist, .env, *.db, logs) + `.env.example` with `ANTHROPIC_API_KEY=`.
- [ ] Electron hardening baseline (`Security.md` §7) on the main window.
- [ ] GitHub Actions CI from `Testing.md` §9.
- [ ] `THIRD_PARTY_NOTICES.md` (empty template).

### 0.5 Claude Code prompt
```text
Read CLAUDE.md and docs/Implementation.md (Phase 0), docs/Code-style.md, docs/Security.md §7 and docs/Architecture.md §10.
Complete the Phase 0 task list in docs/Implementation.md §0.4 on top of the electron-vite react-ts scaffold already in this repo.
Do not implement features from later phases. Show me a Before/After/Why table and the commands to verify.
```

**Done when:** `npm run dev` opens a hardened blank window; `npm run typecheck && npm run lint && npm test` pass; CI green. Tag `v0.0.0`.

---

## Phase 1 — Foundation: Chat with the Brain (≈ 1 week)

**Goal:** a desktop window where Sir chats with Claude, with streaming, history, secure key storage, and cost tracking.

### Tasks
- [ ] `shared/ipc-contract.ts` with Phase 1 channels (`chat:*`, `conversations:*`, `settings:*`, `secrets:*`, `usage:summary`; events `chat:delta`, `chat:message`, `assistant:state`, `usage:update`, `notify`).
- [ ] Preload `window.jarvis` (explicit methods only) + main `handle()` helper with sender + Zod validation.
- [ ] `settings/secrets.ts` (safeStorage) and `settings/settings-service.ts`.
- [ ] `db/connection.ts`, migration `001_init.sql` (full schema from `Database.md` §3), repositories for conversations/messages/usage/settings/audit.
- [ ] `llm/claude-client.ts`, `llm/usage-ledger.ts`, `llm/budget-guard.ts`.
- [ ] `agent/orchestrator.ts` + `agent/agent-loop.ts` (no tools yet, but loop structure in place), `agent/context-builder.ts` with static/dynamic system blocks (`Agents.md` §B1, persona only) and prompt caching.
- [ ] `agent/model-router.ts` (default/deep/fast).
- [ ] Titler (Haiku) after first exchange.
- [ ] Renderer: layout (rail, chat column, status bar), Composer, ChatMessage with Markdown, streaming caret, conversation list, Settings → Brain (key, models, budget), design tokens + fonts (`Design-system.md` §2–3), compact Orb with IDLE/THINKING/ERROR states.
- [ ] Logging (pino + redaction).
- [ ] Tests: IPC validation, budget guard, context builder cache stability, redaction basics, E2E E2/E8/E10 with FakeClaude.

### Claude Code prompt
```text
We are on Phase 1 in docs/Implementation.md. Read docs/PRD.md F1, docs/Architecture.md §2–5, docs/API-Guide.md §1, §3, §10,
docs/Database.md §2–3, docs/Agents.md §B1 and docs/Design-system.md §2–5.
Implement the Phase 1 task list. Build it in small commits: (1) IPC contract + preload + handler helper, (2) secrets + settings,
(3) DB + migrations + repos, (4) Claude client + usage + budget, (5) orchestrator + context builder, (6) UI.
After each step run typecheck, lint and tests. Finish with manual check steps for me.
```

**Done when:** Sir enters his key in Settings, chats with streaming replies, restarts the app and sees history, and sees today's cost in the status bar. Tag `v0.1.0`.

---

## Phase 2 — Hands: Tools, Permissions, Activity (≈ 1–2 weeks)

**Goal:** Jarvis controls apps/system/files safely. **Safety layer first, tools second.**

### Tasks (in this order)
1. **Security core**
   - [ ] `security/policy-engine.ts`, `path-guard.ts`, `shell-guard.ts`, `redact.ts` (full), `untrusted.ts`, `audit.ts` (hash chain), `kill-switch.ts`.
   - [ ] Unit tests to 100% branch coverage + shell corpus + path fuzz (`Testing.md` §3, §6.2, §6.3).
2. **Tool framework**
   - [ ] `tools/types.ts`, `registry.ts`, `executor.ts` (policy → confirmation broker → run with timeout/abort → audit → `tool_result`).
   - [ ] Confirmation broker + `confirm:request` / `confirm:respond` IPC.
   - [ ] Agent loop handles `tool_use` blocks per `API-Guide.md` §3.4.
3. **Native tools** (`API-Guide.md` §2.3)
   - [ ] system: datetime, system info, battery, volume, mute, media keys, brightness, lock, sleep/restart/shutdown.
   - [ ] apps & windows: app index (Start Menu `.lnk` + `Get-StartApps`, fuse.js), open/close/kill, list/focus/min/max windows.
   - [ ] web: `open_url`.
   - [ ] files: search/read/write/create/move/rename/copy/delete-to-recycle-bin/open.
   - [ ] clipboard, notifications, timers & reminders (scheduler + DB).
   - [ ] `run_powershell` (PowerShell runner with `-EncodedCommand`).
4. **UI**
   - [ ] ConfirmDialog (`Design-system.md` §5.5, all rules), ToolCallCard, Activity drawer + full Activity page, Orb ACTING/AWAITING states, kill-switch hotkey + tray item, Settings → Files & permissions (allowed roots).

### Claude Code prompt
```text
We are on Phase 2. Read docs/Security.md fully, docs/API-Guide.md §2–3 and §6.4–6.5, docs/Design-system.md §5.4–5.5,
docs/App-flow.md §6 and §11, docs/Testing.md §3, §4 and §6.
Implement the Phase 2 tasks strictly in the listed order. Do not start step 3 (native tools) until the security core and
tool framework tests pass. Each native tool needs: Zod schema, tier per Security.md §4.1, summarize(), timeout, unit tests.
Never use exec(); use execFile or the PowerShell runner. Show Before/After/Why and manual checks.
```

**Done when:** "open VS Code", "set volume to 30", "create a folder called Test on the Desktop" (prompts), "delete it" (destructive prompt, goes to Recycle Bin) all work; blocked commands are refused; kill switch works; security suite green. Tag `v0.2.0`.

---

## Phase 3 — Brain: Obsidian Memory (≈ 1 week)

**Goal:** Jarvis remembers across conversations, in a vault Sir can read and edit.

### Tasks
- [ ] `memory/vault-service.ts` (skeleton creation incl. `README (Jarvis).md`, `About Sir.md`, `Preferences.md`; atomic writes; merge on external edit; `.trash/`).
- [ ] `memory/memory-tool-handler.ts` (Claude memory tool `memory_20250818`, all commands, traversal protection) + add tool to requests.
- [ ] `memory/indexer.ts` + `vault-watcher.ts` (chokidar) + `memories`/`memories_fts`/`vault_files` repos; "Rebuild index".
- [ ] `memory/retriever.ts` (core profile + FTS top-k + conversation search) wired into context builder dynamic block.
- [ ] `memory/conversation-logger.ts` (daily log format `Database.md` §8.3, redacted, skips private turns).
- [ ] `memory/curator.ts` (Haiku, `Agents.md` §B3 prompt, Zod-validated ops, thresholds, review queue).
- [ ] Native tools: `search_memory`, `search_conversations`.
- [ ] Routines: parse `Routines/*.md` (`Database.md` §8.4) → `routines` table; `list_routines`, `run_routine`.
- [ ] UI: Memory browser (tree, view, Open in Obsidian, Forget), review queue panel, onboarding step 3 (vault).
- [ ] Tests from `Testing.md` §3 (memory rows), §4 (memory scenarios), §6.5.

### Claude Code prompt
```text
We are on Phase 3. Read docs/Database.md §1, §3, §7–8, docs/Architecture.md §7, docs/API-Guide.md §4, §6.1–6.3,
docs/Agents.md §B1 (Memory section) and §B3, docs/App-flow.md §7, docs/Security.md §6 (memory hygiene) and §9 (redaction).
Implement the Phase 3 tasks. Verify the Claude memory tool command names against the official Memory tool docs first and
update API-Guide.md §4 if anything differs. Show Before/After/Why and manual checks (including what to look for in Obsidian).
```

**Done when:** "Remember that I deploy on Vercel" → note in Obsidian; a new conversation answers "where do I deploy?" correctly; editing a note in Obsidian changes Jarvis's answer; "forget that" removes it; the daily conversation log appears. Tag `v0.3.0`.

---

## Phase 4 — Voice (≈ 1–2 weeks)

**Goal:** talk to Jarvis and hear him reply.

### Tasks
- [ ] `voice/recorder.ts` (PvRecorder, device selection, RMS levels at 20 Hz).
- [ ] `voice/wake-word.ts` (Porcupine `JARVIS`, sensitivity setting).
- [ ] `voice/stt/deepgram.ts` (+ `SttProvider` interface; OpenAI alt as P1).
- [ ] `voice/tts/edge.ts`, `voice/tts/sapi.ts` (fallback), `TtsProvider` interface; sentence chunker, `<spoken>` extractor, markdown stripper.
- [ ] `voice/voice-controller.ts` state machine (`Architecture.md` §8) incl. barge-in, silence timeout, "stop"/"never mind".
- [ ] Press-to-talk hotkey (`Ctrl+Alt+Space`, toggle) + mic button.
- [ ] Renderer audio player (queue of `tts:audio` buffers, stop on `tts:stop`, output level for orb).
- [ ] Orb: LISTENING (mic level), SPEAKING (output level), SLEEP; live transcript display; chimes (optional).
- [ ] Voice-mode system prompt addition (`<spoken>` block) + spoken confirmations (`Agents.md` §B6) + voice approvals for non-destructive CONFIRM.
- [ ] Onboarding step 4 + Settings → Voice.
- [ ] Tests: `Testing.md` §8 (fixtures-based), chunker/extractor units.

### Claude Code prompt
```text
We are on Phase 4. Read docs/Architecture.md §8 and ADR-007 in docs/TRD.md, docs/API-Guide.md §9, docs/App-flow.md §5,
docs/Agents.md §B1 (Response format) and §B6, docs/Design-system.md §5.1, docs/Testing.md §8.
Implement the Phase 4 tasks. The whole audio input pipeline runs in the main process; the renderer only plays audio and shows levels.
Verify Picovoice, PvRecorder, Deepgram and Edge TTS package APIs against their current READMEs before coding.
Instrument latency timestamps (wake→listening, EOS→final transcript, final→first audio) and log them.
```

**Done when:** "Jarvis, what time is it?" works hands-free from 2 m; replies spoken in the British voice; barge-in stops speech; PTT works while minimised. Tag `v0.4.0`.

---

## Phase 5 — Connections: MCP + Browser (≈ 1–2 weeks)

**Goal:** Jarvis uses the browser and Sir's apps via MCP, and searches the web.

### Tasks
- [ ] `mcp/config.ts` (`mcp.json` + `mcp_servers` table, `secret:` env resolution), `mcp/manager.ts` (stdio + streamable HTTP, list/call, namespacing, timeouts, reconnect, status events).
- [ ] Executor support for MCP tools (tier from server default + overrides; untrusted output wrapping; taint tracking).
- [ ] Preset: Playwright MCP (pinned version, dedicated `--user-data-dir` profile under `%APPDATA%\Jarvis\browser-profile`), read-only browse tools overridden to SAFE.
- [ ] Presets: GitHub (official server, fine-grained PAT), Notion (official), Filesystem (scoped to allowed roots).
- [ ] Web search server tool in requests; citations rendered in UI.
- [ ] Connections page (`Design-system.md` §5.6, `App-flow.md` §8).
- [ ] Tests: fake MCP server integration, crash recovery, injection corpus first run (`Testing.md` §6.4).

### Claude Code prompt
```text
We are on Phase 5. Read docs/API-Guide.md §5 and §8, docs/Security.md §6 and §10, docs/App-flow.md §8, docs/Testing.md §4 and §6.4.
Implement the Phase 5 tasks. Use @modelcontextprotocol/sdk client classes; verify import paths against the current SDK README.
On Windows, handle npx spawning correctly (npx.cmd or cmd /c). Pin MCP server versions. Default every MCP tool to CONFIRM.
```

**Done when:** "Open github.com/AvaanTech and tell me the latest repo updates" works via Playwright MCP; GitHub connector lists PRs; write actions prompt; web search answers with sources. Tag `v0.5.0`.

---

## Phase 6 — Full Desktop Control (≈ 2 weeks)

**Goal:** Jarvis can operate any app's GUI when no other tool fits, safely.

### Tasks
- [ ] `tools/computer/capture.ts` (desktopCapturer primary display, resize to ≤ 1568 px long edge, keep scale), DPI mapping (DIP ↔ physical with `scaleFactor`) + calibration test.
- [ ] `tools/computer/executor.ts` implementing all 17 `computer_toolset_20260801` members (`API-Guide.md` §7) with batch semantics + halt text + `toolset_name` echo.
- [ ] `security/desktop-policy.ts` (`Security.md` §5.3).
- [ ] Desktop Operator sub-agent (`Agents.md` §B4) with its own loop (max 60 actions), invoked by `delegate_desktop_task` (CONFIRM).
- [ ] Overlay window (red border + Stop pill, content-protected, click-through except pill).
- [ ] Kill switch releases held keys/buttons.
- [ ] Optional: evaluate Windows-MCP (Python/uv) as an MCP preset for accessibility-tree control; disable its telemetry per its README.
- [ ] Tests: executor unit tests with fake nut.js, batch/halt semantics, policy, kill-switch release, manual GUI tasks (`Testing.md` §10).

### Claude Code prompt
```text
We are on Phase 6. First re-read the official Claude "Computer use tool" docs page (computer_toolset_20260801) and reconcile
any differences with docs/API-Guide.md §7, updating the doc. Then read docs/Security.md §5.3 and §11, docs/Agents.md §B4,
docs/App-flow.md §9, docs/Design-system.md §4.4. Implement the Phase 6 tasks. Write the DPI calibration test before wiring clicks.
```

**Done when:** "In Notepad, type a shopping list and save it to Desktop as list.txt" works end-to-end with the overlay visible; clicks are accurate at Sir's display scaling; Stop works instantly. Tag `v0.6.0`.

---

## Phase 7 — Polish & Package (≈ 1 week)

### Tasks
- [ ] Tray menu (Show, Voice on/off, Stop everything, Quit), start with Windows (setting), start hidden.
- [ ] Mini orb mode (`Design-system.md` §4.3).
- [ ] Empty-state orchestration (large orb → compact), suggestion chips from routines.
- [ ] Usage dashboard (day/month, by model/purpose).
- [ ] DB backup/restore UI; audit chain verification button; data retention settings; `/private` incognito turns.
- [ ] electron-builder NSIS installer; Electron fuses for production; app icon; version/about screen.
- [ ] Final security gate (`Security.md` §15) + evals ≥ 90% + manual QA.

### Claude Code prompt
```text
We are on Phase 7. Read docs/PRD.md F6, docs/Design-system.md §4.2–4.3, docs/Security.md §7 (fuses) and §15,
docs/Testing.md §5–7 and §10. Implement the Phase 7 tasks, then run the full release gate and report results in a table.
```

**Done when:** installer works on a clean Windows 11 VM; all gates pass. Tag `v1.0.0`. 🎉

---

## Parking Lot (P2 — don't build until v1 ships)

Local Whisper STT · local LLM fallback (Ollama) · vector memory (sqlite-vec + local embeddings) · Claude browser-use toolset executor · accessibility-tree automation (Windows-MCP / Terminator) · OAuth for remote MCP · true hold-to-talk via native keyboard hook · custom wake word · light theme · phone companion · plugin/skill marketplace · auto-update.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `NODE_MODULE_VERSION` mismatch / "was compiled against a different Node.js version" | Native module built for system Node, not Electron. Run `npx electron-builder install-app-deps` (or `npx @electron/rebuild`), then restart `npm run dev` |
| `gyp ERR!` / `MSBuild` not found during install | Install VS Build Tools + Python (§0.1), delete `node_modules`, `npm ci` |
| Microphone not detected | Windows Settings → Privacy & security → Microphone → allow desktop apps; check device index in Settings → Voice |
| Porcupine "invalid AccessKey" / activation limit | Re-copy key from Picovoice Console; free tier has device/usage limits, so check the console |
| Clicks offset in computer mode | DPI scaling mismatch; rerun calibration test; check `scaleFactor` conversion |
| Windows Defender flags the app | Expected for input automation; add a folder exclusion for the dev build only; sign installer later |
| `spawn npx ENOENT` for MCP | Use `npx.cmd` or `cmd /c npx` on Windows |
| Edge TTS stops working | Unofficial endpoint changed; app falls back to SAPI; update the package or switch provider |
| 400 error "tool_use ids without tool_result" | Agent loop bug: every `tool_use` needs a `tool_result` in the next user message (`API-Guide.md` §3.4) |
