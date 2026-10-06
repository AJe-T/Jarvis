# Technical Requirements Document (TRD) — JARVIS Desktop

| Field | Value |
|---|---|
| Status | v1.0 — Approved |
| Last updated | 2026-10-06 |
| Related | [PRD](PRD.md) · [Architecture](Architecture.md) · [API-Guide](API-Guide.md) · [Security](Security.md) |

> **Version note:** Library versions change fast. Pin exact versions in `package.json` at scaffold time (Phase 0) and record them in §4. Any API detail marked ⚠️ must be re-verified against official docs before implementation.

---

## 1. Platform & Environment

| Item | Requirement |
|---|---|
| OS | Windows 10 22H2+ / Windows 11, x64 |
| Runtime | Electron (latest stable) — ships its own Node.js |
| Dev Node.js | Node 22 LTS (or current LTS) + npm |
| Hardware (min) | 4-core CPU, 8 GB RAM, microphone, speakers |
| Hardware (rec.) | 16 GB RAM, headset mic (better STT + fewer false wakes) |
| Network | Required (Claude API, STT, TTS). Graceful degradation when offline |
| Privileges | Runs as a **standard user**. Never requests admin/UAC elevation |

## 2. Technology Stack

| Layer | Choice | Why (short) |
|---|---|---|
| Desktop shell | **Electron** + **electron-vite** | Sir knows React; JS everywhere; mature Windows support; Goose/VS Code-class apps prove it |
| Language | **TypeScript (strict)** | Type safety catches tool/IPC mistakes; JS-family so no new language |
| UI | **React** + **Tailwind CSS** + **Radix UI primitives** + CSS animations | Familiar stack; accessible primitives; orb motion is CSS keyframes/transitions (no animation library needed) |
| UI state | **Zustand** | Tiny, simple stores; no boilerplate |
| Validation | **Zod** | One schema → runtime validation + TS types + JSON Schema for Claude tools |
| LLM | **Claude API** via `@anthropic-ai/sdk` | Best-in-class tool use; computer-use, browser-use, memory and web-search tools |
| App connectors | **MCP** via `@modelcontextprotocol/sdk` (client) | Standard protocol; thousands of existing servers |
| Browser control | **`@playwright/mcp`** (Microsoft, Apache-2.0) | Accessibility-snapshot browsing; no vision tokens |
| Desktop input | **`@nut-tree-fork/nut-js`** (Apache-2.0) | Mouse/keyboard/screen from Node; community fork with prebuilt binaries |
| Windows OS ops | **PowerShell** via `child_process.execFile` (never `exec`) + Electron APIs (`shell`, `screen`, `desktopCapturer`, `Notification`, `globalShortcut`, `safeStorage`) | Built into Windows; no extra binaries |
| Database | **SQLite** via Electron's built-in `node:sqlite` (`DatabaseSync`) + **FTS5** | Synchronous, embedded, FTS5 built in, no native module to compile (ADR-009) |
| Memory files | **Obsidian vault** (plain Markdown + YAML frontmatter) | Human-readable, editable, graph view, Sir owns the data |
| File watching | **chokidar** | Detect Sir's edits in Obsidian |
| Mic capture | **`@picovoice/pvrecorder-node`** | Cross-platform PCM capture in main process, no SoX |
| Wake word | **`@picovoice/porcupine-node`** (built-in keyword `JARVIS`) | On-device, accurate, free AccessKey |
| STT | Provider interface → **Deepgram streaming** (default) · OpenAI transcription (alt) · local whisper.cpp (P2) | Streaming + endpointing gives low latency |
| TTS | Provider interface → **Edge TTS** (`msedge-tts`, MIT, voice `en-GB-RyanNeural`) · Windows SAPI fallback · ElevenLabs (optional) | Free, natural British voice; offline fallback. `@travisvn/edge-tts` is AGPL-3.0, so it is not allowed |
| Fuzzy search | **fuse.js** | Matching spoken app names to installed apps |
| Logging | **pino** (+ pino-roll for rotation) | Fast structured logs with redaction paths |
| Testing | **Vitest**, **Playwright (`_electron`)**, **msw** | Unit/integration/E2E |
| Packaging | **electron-builder** (NSIS installer) | Standard Windows installer; handles native module rebuilds |
| Lint/format | **ESLint** (typescript-eslint) + **Prettier** | See [Code-style](Code-style.md) |

## 3. Claude API Usage (summary — details in [API-Guide](API-Guide.md))

| Capability | API feature | Model(s) |
|---|---|---|
| Main conversation + tool use | Messages API, streaming, custom tools (JSON Schema) | `claude-sonnet-5-5` (default) |
| Deep reasoning ("think hard") | Same + thinking ⚠️ | `claude-opus-5-5` |
| Background jobs (titles, summaries, memory curation) | Messages API, JSON output | `claude-haiku-4-5-20251001` |
| Long-term memory | **Memory tool** `{"type":"memory_20250818","name":"memory"}` — client-side, GA | Sonnet / Opus |
| Web search | Server tool (web search) ⚠️ verify current version string | Sonnet / Opus |
| Full desktop control | **Computer use toolset** `{"type":"computer_toolset_20260801"}` — client-side, no beta header on Claude 5.5 models | `claude-sonnet-5-5` / `claude-opus-5-5` (Haiku 4.5 **not** supported by this toolset) |
| Browser control (alt, P2) | Browser use toolset `browser_toolset_20260801` | Sonnet / Opus 5.5 |
| Cost reduction | Prompt caching (`cache_control: {type: "ephemeral"}`) on system prompt + tools | All |

Model IDs live in Settings (not hard-coded) so they can be updated without a release.

## 4. Dependencies (pinned at Phase 0, 2026-10-06)

```text
# runtime
@anthropic-ai/sdk 0.131.0  @modelcontextprotocol/sdk 1.32.1  zod 4.6.5  zustand 5.0.15
chokidar 5.0.0  yaml 2.9.1 (frontmatter)  fuse.js 7.5.0  pino 10.4.0  pino-roll 4.0.0  nanoid 6.0.2
@nut-tree-fork/nut-js 4.2.6  @picovoice/porcupine-node 4.0.2  @picovoice/pvrecorder-node 1.2.9
@deepgram/sdk 5.14.0       # STT default
msedge-tts 2.0.9           # TTS default (unofficial endpoint — wrapped behind provider)
react 19.3.0  react-dom 19.3.0  react-markdown 10.1.0  remark-gfm 4.0.1  lucide-react 1.52.0  clsx 2.1.1
@radix-ui/react-dialog 1.2.0  @radix-ui/react-tooltip 1.3.0  @radix-ui/react-switch 1.3.8
@fontsource/chakra-petch, ibm-plex-sans, jetbrains-mono 5.3.0 (OFL, bundled locally)
# not a dependency: @playwright/mcp (spawned with npx at a pinned version, ADR-005)

# dev
electron 44.5.1  electron-vite 5.0.0  vite 7.3.7 (electron-vite 5 supports vite <= 7)  @vitejs/plugin-react 5.2.0
typescript 5.9.3 (typescript-eslint requires < 6.1)  tailwindcss 4.3.3  @tailwindcss/vite 4.3.3
vitest 5.0.3  @vitest/coverage-v8 5.0.3  jsdom 30.1.2  @testing-library/react 16.3.3  @playwright/test 1.63.0
eslint 10.12.0  typescript-eslint 8.71.1  eslint-plugin-react-hooks 7.1.1  prettier 3.9.9
electron-builder 26.15.3  @electron/fuses 2.1.3
```
Changes from the original list (Phase 0): `better-sqlite3` → built-in `node:sqlite` (ADR-009); `gray-matter` (no release since 2019) → `yaml` + a small frontmatter splitter; `@travisvn/edge-tts` (AGPL-3.0) → `msedge-tts` (MIT); Framer Motion and msw dropped (CSS animations and an injectable FakeClaude cover the need); Zod 4's built-in `z.toJSONSchema` replaces `zod-to-json-schema`; `date-fns` not needed (`Intl` covers formatting).

**Dependency policy:** every new dependency must be (a) actively maintained (commit in last 6 months), (b) MIT/Apache/BSD/ISC licensed, (c) justified in the PR. No AGPL/GPL in the app bundle.

## 5. Non-Functional Requirements

### 5.1 Performance budgets

| Metric | Target |
|---|---|
| Cold start → window interactive | < 3 s |
| Idle RAM (all processes, voice armed) | < 450 MB |
| Idle CPU (wake word armed) | < 3% of one core |
| Wake word detection → LISTENING state | < 300 ms |
| End of speech → transcript final | < 800 ms |
| Typed message → first token (p50) | < 1.5 s |
| End of speech → first TTS audio (p50, no tools) | < 2.5 s |
| Native SAFE tool execution (p95) | < 500 ms |
| Vault edit → re-indexed | < 5 s |

### 5.2 Reliability

- Agent loop hard cap: **25 iterations** per user turn (computer mode: 60), then stop and report.
- Every external call has a timeout (Claude: 120 s stream idle 30 s; MCP tool: 60 s; PowerShell: 30 s; STT connect: 5 s).
- Retries: exponential backoff with jitter for 429/5xx/overloaded (max 3), **never** retry non-idempotent tools automatically.
- Crash isolation: MCP servers run as child processes; a crash marks the server "error" and doesn't crash the app.
- Graceful degradation matrix:

| Failure | Behaviour |
|---|---|
| No network | Banner "Offline"; voice capture still works; queue nothing; SAFE local tools available via typed slash-commands (P1) |
| Claude API error | Show error card with retry; spoken "I'm having trouble reaching my brain, sir." |
| STT provider down | Fall back to alternate provider if configured; else text-only mode |
| TTS provider down | Fall back to Windows SAPI |
| Vault missing | Recreate folder skeleton, warn once |
| DB corrupted | Restore from latest automatic backup ([Database](Database.md) §7) |

### 5.3 Security & privacy (summary — see [Security](Security.md))
- Electron hardening: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, strict CSP, no `remote`, IPC sender validation.
- Secrets encrypted with `safeStorage` (DPAPI on Windows); never sent to renderer.
- No inbound network listeners; MCP over stdio or outbound HTTPS only.
- Deterministic permission policy; LLM cannot change tiers.

### 5.4 Observability
- Structured logs (pino) to `%APPDATA%/Jarvis/logs`, rotated daily, 14-day retention, secret redaction.
- Tamper-evident audit log in SQLite (hash chain) for every tool decision.
- Usage ledger (tokens, est. cost) per request.
- Debug panel (dev builds): raw Claude request/response viewer with secrets masked.

### 5.5 Accessibility & UX
- Full keyboard operation; visible focus; `prefers-reduced-motion` respected; WCAG AA contrast on text ([Design-system](Design-system.md)).

## 6. Configuration

| Source | Used for | Location |
|---|---|---|
| `.env` (dev only) | Dev API keys | repo root, git-ignored |
| Secrets store | API keys (Anthropic, Deepgram, Picovoice, ElevenLabs, MCP tokens) | `%APPDATA%/Jarvis/secrets.bin` (safeStorage-encrypted) |
| Settings table | Models, voice, hotkeys, budgets, vault path, allowed folders | SQLite `settings` |
| `mcp.json` | MCP server definitions (Claude-Desktop-compatible shape) | `%APPDATA%/Jarvis/mcp.json` |
| Policy overrides | Per-tool tier overrides (can only *raise* strictness, except via Settings UI with confirmation) | SQLite `settings.policy` |

## 7. Build & Release

| Step | Command |
|---|---|
| Install | `npm ci` |
| Dev | `npm run dev` (electron-vite, HMR for renderer) |
| Type check | `npm run typecheck` |
| Lint | `npm run lint` |
| Test | `npm test` (unit+integration), `npm run test:e2e` |
| Build installer | `npm run dist` → `dist/Jarvis-Setup-x.y.z.exe` |

Native modules (`@nut-tree-fork/*`, Picovoice; both ship N-API prebuilds) are rebuilt for Electron's ABI by electron-builder `install-app-deps` (postinstall). CI runs on `windows-latest` ([Testing](Testing.md) §9).

## 8. Architecture Decision Records (condensed)

### ADR-001: Electron over Tauri
| | Electron | Tauri |
|---|---|---|
| Language | TS only | TS + Rust |
| Size/RAM | Heavier (~150 MB installer) | Light |
| Ecosystem for this app (nut.js, Picovoice, MCP SDK, better-sqlite3) | Native Node support | Requires sidecars |
| Team familiarity | High | Low |

**Decision:** Electron. Footprint is acceptable for a single-user desktop app; one language beats binary size. **Revisit** if RAM budget is consistently exceeded.

### ADR-002: TypeScript-only (no Python backend)
Python has richer automation libraries (pywinauto, UFO), but a second runtime doubles setup and packaging complexity for a beginner. **Decision:** TS only; Python-based tools (e.g., Windows-MCP) are allowed as optional, external MCP servers.

### ADR-003: SQLite + Obsidian (dual store) over a vector DB
SQLite holds structured/raw data (messages, tool calls, usage) and the FTS index; the vault holds curated, human-editable memory. Vector search is deferred (P2: `sqlite-vec` + local embeddings) because FTS5 + core-profile injection is sufficient for a single user's memory scale. **Consequence:** vault is the source of truth for memories; DB index is rebuildable from it.

### ADR-004: Claude memory tool mapped to the vault
Anthropic's client-side memory tool lets Claude decide what to read/write as files. Mapping its `/memories` root to `JarvisBrain/Memory/` gives Obsidian integration for free. A Haiku "curator" adds automatic extraction because the main model may not always save on its own.

### ADR-005: Playwright MCP for the browser (v1), Claude browser-use toolset later
Playwright MCP is ready-made (no executor to write). The first-party browser toolset has 27+ member tools to implement, which is valuable but heavy. **Revisit in P2.**

### ADR-006: Native PowerShell tools first, computer-use second
Deterministic tools (open app, volume, files) are fast, cheap, and reliable. Screenshot-based computer use costs thousands of tokens per step and is slower, so it is used only when no native tool or MCP server fits.

### ADR-007: Main-process audio pipeline
Mic capture, wake word, and STT streaming run in the main process (PvRecorder + Porcupine + provider WebSocket), so **no secrets enter the renderer**. The renderer only receives audio levels (for the orb) and TTS audio buffers to play.

### ADR-008: Deterministic policy engine
Permission tiers are enforced by code before any tool executes. The model is told the rules but has no ability to change them. This is the core safety property of the product.

### ADR-009: Built-in `node:sqlite` instead of `better-sqlite3`
`better-sqlite3` 13.0.3 has no prebuilt binary for Electron 44 (ABI 149), so it would have to be compiled with the Visual Studio C++ Build Tools, and node-gyp warns that the space in the user path (`C:\Users\TEJA N`) can break native builds. Electron 44 ships Node 24.21, whose built-in `node:sqlite` (`DatabaseSync`, SQLite 3.53) is synchronous like better-sqlite3 and has FTS5 + the porter tokenizer compiled in (verified 2026-10-06). **Decision:** use `node:sqlite` (approved by Sir). **Consequences:** no native DB module to rebuild; backups use `VACUUM INTO`; transactions use a small `BEGIN`/`COMMIT` helper. **Revisit** if Electron drops `node:sqlite`.
