# API Guide — JARVIS Desktop

| Field | Value |
|---|---|
| Status | v1.0 |
| Last updated | 2026-10-06 |
| Related | [Architecture](Architecture.md) · [Agents](Agents.md) · [Security](Security.md) · [Database](Database.md) |

This guide defines **every interface** inside the app (IPC, tools, services) and **how we call external APIs** (Claude, MCP, STT, TTS). Code samples are TypeScript reference implementations: correct in shape, to be adapted during implementation.

> ⚠️ = verify against the current official docs/package README before coding. APIs evolve; the docs win over this file.
> Official references: Claude API docs — https://docs.claude.com (Messages, Tool use, Memory tool, Computer use tool, Browser use tool, Prompt caching, Web search) · MCP TypeScript SDK — https://github.com/modelcontextprotocol/typescript-sdk

---

## 1. IPC Contract (Renderer ↔ Main)

All channels and payload schemas live in `src/shared/ipc-contract.ts` and are validated with Zod in **both** directions.

### 1.1 Invoke channels (renderer → main, request/response)

| Channel | Request | Response | Notes |
|---|---|---|---|
| `chat:send` | `{ conversationId?: string, text: string, source: 'text'\|'voice', attachments?: Attachment[] }` | `{ conversationId, turnId }` | Starts a turn; results stream via events |
| `chat:cancel` | `{ turnId }` | `{ ok }` | Aborts current turn |
| `conversations:list` | `{ limit, cursor? }` | `{ items: ConversationSummary[], nextCursor? }` | |
| `conversations:get` | `{ id }` | `{ conversation, messages, toolCalls }` | |
| `conversations:delete` | `{ id, alsoVault: boolean }` | `{ ok }` | CONFIRM in UI |
| `confirm:respond` | `{ requestId, decision: 'approve'\|'deny' }` | `{ ok }` | Answer to `confirm:request` |
| `settings:getAll` / `settings:set` | `{}` / `{ key, value }` | all values / `{ ok }` | Values validated per key schema (`src/shared/settings.ts`) |
| `secrets:delete` / `secrets:test` | `{ name }` | `{ ok }` / `{ ok, error? }` | Test = tiny Haiku call ("Reply OK") for the Anthropic key |
| `secrets:set` | `{ name: SecretName, value: string }` | `{ ok, last4 }` | Value never returned |
| `secrets:status` | `{}` | `Record<SecretName, { set: boolean, last4?: string }>` | |
| `memory:list` / `memory:read` / `memory:search` | … | … | Memory browser |
| `memory:delete` | `{ vaultPath }` | `{ ok }` | CONFIRM in UI; audit logged |
| `mcp:list` / `mcp:add` / `mcp:update` / `mcp:remove` / `mcp:restart` | … | … | MCP settings page |
| `voice:setMode` | `{ mode: 'off'\|'ptt'\|'wake' }` | `{ ok }` | |
| `voice:mic` | `{ action: 'start'\|'stop' }` | `{ ok }` | Mic button in UI |
| `app:killSwitch` | `{}` | `{ ok }` | Same as hotkey |
| `usage:summary` | `{ range: 'day'\|'month' }` | `{ costUsd, tokens, budget }` | |
| `audit:list` | `{ limit, cursor? }` | `{ items }` | |
| `onboarding:complete` | `{ vaultPath, voiceMode, facts: { role?, project?, city? } }` | `{ ok }` | |
| `activity:list` | `{ limit, conversationId? }` | tool calls | Full Activity log |
| `memory:openInObsidian` / `memory:reviewList` / `memory:reviewResolve` / `memory:rebuildIndex` | … | … | Memory browser + review queue |
| `voice:devices` | `{}` | `{ index, name }[]` | Mic picker; `voice:mic` also accepts `action: 'meter'` (level only, 5 s) |
| `app:info` / `app:openExternal` / `app:pickFolder` / `app:setMiniMode` | … | … | http(s) only for openExternal |
| `usage:breakdown` / `audit:verify` / `audit:export` / `routines:list` / `reminders:list` / `db:backups` / `db:backupNow` / `db:restore` | … | … | Dashboards and data management |

### 1.2 Event channels (main → renderer, push)

| Channel | Payload |
|---|---|
| `assistant:state` | `{ state: AssistantState, detail?: string }` |
| `chat:delta` | `{ turnId, messageId, textDelta }` |
| `chat:message` | `{ turnId, message: UiMessage }` (final) |
| `tool:update` | `{ turnId, toolCall: UiToolCall }` (pending → running → success/error) |
| `confirm:request` | `{ requestId, toolName, humanSummary, details, destructive, taintedFrom?: string, expiresAt }` |
| `voice:level` | `{ rms: number }` (~20 Hz, for orb) |
| `voice:transcript` | `{ text, isFinal }` |
| `tts:audio` | `{ utteranceId, seq, mime: 'audio/mpeg'\|'audio/wav', data: ArrayBuffer }` |
| `tts:stop` | `{ utteranceId? }` |
| `usage:update` | `{ dayCostUsd, monthCostUsd }` |
| `mcp:status` | `{ server, status: 'connecting'\|'ready'\|'error', toolCount?, error? }` |
| `notify` | `{ level: 'info'\|'warn'\|'error', message, action? }` |
| `confirm:resolved` | `{ requestId, decision }` (closes a dialog that timed out or was killed) |
| `conversation:updated` | `ConversationSummary` (title/last-active changed) |
| `memory:changed` | `{ vaultPaths }` |
| `computer:active` | `{ active }` (Computer-Control mode on/off) |
| `nav:open` | `{ view, section? }` (e.g., tray → Settings) |

Renderer → main fire-and-forget: `tts:playback` `{ utteranceId, event: 'started'\|'finished'\|'level', level? }`.

> Implementation: channel names live in `src/shared/ipc-channels.ts` (dependency-free, so the sandboxed preload can import it); schemas in `src/shared/ipc-contract.ts`. The preload exposes `window.jarvis.call[channel](req)`, `window.jarvis.send[channel](payload)` and `window.jarvis.on(event, handler)`: one fixed function per channel, built from the fixed list.

### 1.3 Preload (`src/preload/index.ts`)

```ts
import { contextBridge, ipcRenderer } from 'electron';
import { INVOKE, EVENTS, type JarvisApi } from '../shared/ipc-contract';

const api: JarvisApi = {
  chat: {
    send: (req) => ipcRenderer.invoke(INVOKE.chatSend, req),
    cancel: (req) => ipcRenderer.invoke(INVOKE.chatCancel, req),
  },
  confirm: { respond: (req) => ipcRenderer.invoke(INVOKE.confirmRespond, req) },
  // ...one explicit method per channel (no generic passthrough)
  on: (event, handler) => {
    if (!Object.values(EVENTS).includes(event)) throw new Error('Unknown event');
    const listener = (_e: unknown, payload: unknown) => handler(payload as never);
    ipcRenderer.on(event, listener);
    return () => ipcRenderer.removeListener(event, listener);
  },
};
contextBridge.exposeInMainWorld('jarvis', api);
```

### 1.4 Main-side handler pattern

```ts
export function handle<C extends InvokeChannel>(channel: C, fn: Handler<C>) {
  ipcMain.handle(channel, async (event, raw) => {
    assertTrustedSender(event);                       // senderFrame.url === app URL
    const req = contract[channel].request.parse(raw); // Zod
    const res = await fn(req, event);
    return contract[channel].response.parse(res);
  });
}
```

## 2. Tool Interface

```ts
// src/main/tools/types.ts
export type Tier = 'SAFE' | 'CONFIRM' | 'BLOCKED';

export interface ToolContext {
  signal: AbortSignal;
  conversationId: string;
  turnId: string;
  tainted: boolean;            // turn has consumed untrusted content
  logger: Logger;
}

export interface ToolOutput {
  content: Array<{ type: 'text'; text: string } | { type: 'image'; source: ImageSource }>;
  isError?: boolean;
  untrusted?: boolean;         // overrides tool default
}

export interface Tool<I = unknown> {
  name: string;                                  // snake_case, unique
  description: string;                           // for Claude: what, when, when NOT
  input: z.ZodType<I>;
  tier: Tier | ((input: I) => Tier);
  destructive?: boolean;                         // stronger confirm UX
  untrustedOutput?: boolean;
  timeoutMs?: number;                            // default 15_000
  summarize(input: I): string;                   // "Open Visual Studio Code"
  run(input: I, ctx: ToolContext): Promise<ToolOutput>;
}
```

### 2.1 Example native tool

```ts
// src/main/tools/native/apps/open-app.ts
export const openApp: Tool<{ name: string }> = {
  name: 'open_app',
  description:
    'Open an installed Windows application by its everyday name (e.g. "VS Code", "Spotify", "Calculator"). ' +
    'Use list_installed_apps first if unsure. Do not use for websites; use open_url.',
  input: z.object({ name: z.string().min(1).max(100) }),
  tier: 'SAFE',
  summarize: ({ name }) => `Open ${name}`,
  async run({ name }, ctx) {
    const match = appIndex.find(name);                 // fuse.js over Start Menu + Get-StartApps
    if (!match) return err(`No installed app matches "${name}". Closest: ${appIndex.suggest(name).join(', ')}`);
    await launch(match, ctx.signal);                   // shell.openPath(lnk) or explorer shell:AppsFolder\<AppID>
    return ok(`Opened ${match.displayName}.`);
  },
};
```

### 2.2 Registry → Claude tool definitions

```ts
export function toClaudeTools(tools: Tool[]): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: zodToJsonSchema(t.input) as Anthropic.Tool.InputSchema,
  }));
}
```

Description-writing rules for tools: say what it does, when to use it, when **not** to use it, and what it returns. Keep each under ~80 words.

Implementation additions to the `Tool` interface (`src/main/tools/types.ts`): `externalFacing` (taint escalation), `guards(input)` (paths/script/urls/text the policy engine checks against the global BLOCKED rules), `confirm(input)` (dialog title, action-named button label, details and their kind: `text` | `code` | `paths`), `jsonSchema` (MCP tools bring their own schema) and `source`. JSON Schema for native tools comes from Zod 4's `z.toJSONSchema`.

### 2.3 v1 native tool catalogue

| Area | Tools |
|---|---|
| system | `get_datetime`, `get_system_info`, `get_battery`, `set_volume`, `mute`, `media_control`, `set_brightness`, `lock_screen`, `sleep_pc`, `restart_pc`, `shutdown_pc` |
| apps & windows | `list_installed_apps`, `open_app`, `close_app`, `kill_process`, `list_open_windows`, `focus_window`, `minimize_window`, `maximize_window` |
| web | `open_url` (+ Claude server-side web search) |
| files | `search_files`, `read_text_file`, `write_text_file`, `create_folder`, `move_path`, `rename_path`, `copy_path`, `delete_to_recycle_bin`, `open_path` |
| clipboard & notify | `read_clipboard`, `write_clipboard`, `show_notification` |
| time | `set_timer`, `set_reminder`, `list_reminders`, `cancel_reminder` |
| memory | Claude `memory` tool, `search_memory`, `search_conversations` |
| routines | `list_routines`, `run_routine` |
| shell | `run_powershell` |
| delegation | `delegate_desktop_task` (Phase 6) |

Windows implementation hints:

| Need | Approach |
|---|---|
| Installed apps | Index `.lnk` files in both Start Menu folders + `Get-StartApps` (Name, AppID); launch Store apps with `explorer.exe shell:AppsFolder\<AppID>` |
| Volume (absolute) | PowerShell `Add-Type` Core Audio interop (IAudioEndpointVolume); fallback: nut.js media keys |
| Brightness | `Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods` → `WmiSetBrightness` (laptops) |
| Close app gracefully | `(Get-Process -Name X).CloseMainWindow()`; `kill_process` uses `Stop-Process` |
| Windows list/focus | nut.js window APIs; fallback user32 `SetForegroundWindow` via `Add-Type` |
| Recycle Bin delete | Electron `shell.trashItem(path)` |
| System info | Node `os` + `Get-CimInstance Win32_Battery / Win32_OperatingSystem` |
| Notifications | Electron `new Notification({...}).show()` |

## 3. Claude Client & Agent Loop

### 3.1 Client wrapper

```ts
// src/main/llm/claude-client.ts
import Anthropic from '@anthropic-ai/sdk';

export function createClaude(apiKey: string) {
  return new Anthropic({ apiKey, maxRetries: 3, timeout: 120_000 });
}
```

### 3.2 Request shape with prompt caching

Cache order is **tools → system → messages**. Put stable content first and mark the end of the stable prefix.

```ts
const request: Anthropic.MessageCreateParams = {
  model: router.pick(turn),                     // 'claude-sonnet-5-5' default
  max_tokens: 4096,
  tools: withCacheOnLast([
    ...toClaudeTools(nativeTools),
    ...mcpManager.claudeTools(),                // namespaced mcp__server__tool
    { type: 'memory_20250818', name: 'memory' },        // client-side memory tool
    webSearchTool,                                       // server tool, see §5
  ]),
  system: [
    { type: 'text', text: STATIC_PERSONA_AND_RULES, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: dynamicContext },     // date/time, mode, core profile, retrieved memories
  ],
  messages: history,                            // trimmed + summarized (§3.5)
};
```

### 3.3 Streaming one step

```ts
async function streamStep(req: Anthropic.MessageCreateParams, ctx: TurnCtx) {
  const stream = claude.messages.stream(req, { signal: ctx.signal });
  stream.on('text', (delta) => ctx.emit('chat:delta', { turnId: ctx.turnId, textDelta: delta }));
  const message = await stream.finalMessage();
  usageLedger.record(message.model, message.usage, ctx);   // input/output/cache tokens
  return message;
}
```

### 3.4 Agent loop

```ts
const MAX_ITER = 25;
const HALT = 'Not executed: an earlier action in this turn failed.';

export async function runTurn(ctx: TurnCtx) {
  const messages = await contextBuilder.history(ctx);
  for (let i = 0; i < MAX_ITER; i++) {
    killSwitch.throwIfActive();
    budgetGuard.assertCanSpend(ctx);

    const msg = await streamStep(buildRequest(messages, ctx), ctx);
    messages.push({ role: 'assistant', content: msg.content });

    const toolUses = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (toolUses.length === 0) return finish(ctx, msg, messages);   // end_turn

    const results: Anthropic.ToolResultBlockParam[] = [];
    let failed = false;
    for (const block of toolUses) {                     // sequential, in order
      if (failed) { results.push(errorResult(block, HALT)); continue; }
      const r = await executor.execute(block, ctx);    // policy → confirm → run → audit
      results.push(r);
      if (r.is_error && isBatchToolset(block)) failed = true;
    }
    messages.push({ role: 'user', content: results });
  }
  return finishWithLimitMessage(ctx, messages);         // "I've stopped after 25 steps, sir…"
}
```

`executor.execute` returns a `tool_result` with `tool_use_id`, `content`, `is_error`, and, for toolset members, `toolset_name` echoed. Denied actions → `is_error: true`, text: `"Sir declined this action. Do not retry it; ask what he'd prefer."`. Blocked → `"This action is not permitted by Jarvis's safety policy (<reason>)."`.

> SDK typing: if the installed SDK version lacks types for newer fields (e.g., `toolset_name`), extend the types locally in `src/main/llm/types-ext.ts` rather than using `any`.

### 3.5 Context management

| Concern | Rule |
|---|---|
| History window | Last 30 messages verbatim; older ones summarised by Haiku into `conversations.summary` and injected as "Earlier in this conversation: …" |
| Token budget | Estimate with `chars / 3.5`; if > 120k input tokens, summarise more aggressively; use the token counting endpoint ⚠️ for exact checks in tests |
| Untrusted tool output | Truncate to 20 KB per result; wrap per [Security](Security.md) §6 |
| Screenshots | Only inside the Desktop Operator sub-agent's context; never in the main conversation |

### 3.6 Model router

```ts
pick(turn): string {
  if (turn.purpose === 'curator' || turn.purpose === 'title' || turn.purpose === 'summary')
    return settings.models.fast;      // 'claude-haiku-4-5-20251001'
  if (turn.purpose === 'desktop_agent') return settings.models.computer;  // 'claude-sonnet-5-5' (toolset-capable)
  if (turn.deep || /\b(think hard|deep dive|plan)\b/i.test(turn.text)) return settings.models.deep; // 'claude-opus-5-5'
  return settings.models.default;     // 'claude-sonnet-5-5'
}
```

Model IDs are settings, not constants. Haiku 4.5 does **not** support `computer_toolset_20260801`.

### 3.7 Errors

| Error | Handling |
|---|---|
| 401/403 | Stop; open Settings → API key with message |
| 429 / 529 overloaded / 5xx | SDK retries (3, backoff); then user-facing "My brain is overloaded, sir. Try again in a moment." |
| 400 invalid_request (e.g., missing tool_result) | Bug: log full redacted request; show error card; never retry |
| Abort (kill switch / cancel) | Persist partial assistant text marked `[interrupted]` |
| Stream idle > 30 s | Abort and retry once |

## 4. Memory Tool Handler (`memory_20250818`)

Claude issues file commands against a virtual `/memories` root. We map it to `<vault>/Memory/`.

| Command | Input | Our behaviour |
|---|---|---|
| `view` | `path`, `view_range?` | Directory → list (2 levels, sizes); file → numbered lines |
| `create` | `path`, `file_text` | Create/overwrite (redact, atomic write, merge-if-externally-edited) |
| `str_replace` | `path`, `old_str`, `new_str` | Must match exactly once, else error with guidance |
| `insert` | `path`, `insert_line`, `insert_text` | Insert after line N |
| `delete` | `path` | Move file to vault `.trash/` (Obsidian convention) + audit; reject deleting root |
| `rename` | `old_path`, `new_path` | Both inside root |

Verified 2026-10-06 against `@anthropic-ai/sdk` 0.131.0 (`BetaMemoryTool20250818*Command` types): `view {path, view_range?}`, `create {path, file_text}`, `str_replace {path, old_str, new_str}`, `insert {path, insert_line, insert_text}`, `delete {path}`, `rename {old_path, new_path}`. The tool definition is GA: `{ type: 'memory_20250818', name: 'memory' }`. Bare notes created by Claude get the §8.2 frontmatter added automatically.

```ts
function resolveMemoryPath(virtualPath: string): string {
  if (!virtualPath.startsWith('/memories')) throw new ToolError('Path must start with /memories');
  const rel = virtualPath.slice('/memories'.length);
  const abs = path.resolve(memoryRoot, '.' + rel);
  const real = fs.existsSync(abs) ? fs.realpathSync(abs) : abs;
  if (real !== memoryRoot && !real.startsWith(memoryRoot + path.sep))
    throw new ToolError('Path escapes memory directory');   // traversal protection
  if (!real.endsWith('.md') && fs.existsSync(real) && fs.statSync(real).isFile())
    throw new ToolError('Only .md files are allowed in memory');
  return real;
}
```

After every successful write: update `memories` + FTS index, emit `memory:changed`.

## 5. Web Search (server tool)

```ts
const webSearchTool = { type: 'web_search_20260318', name: 'web_search', max_uses: 5 }; // verified in @anthropic-ai/sdk 0.131.0 types (2026-10-06)
```

Executed by Anthropic; results come back as content blocks with citations. Render citations as links in the UI. Treat as untrusted for taint tracking.

## 6. Internal Service APIs

### 6.1 Vault service

```ts
interface VaultService {
  root: string;
  ensureSkeleton(): Promise<void>;                          // folders + README + About Sir.md
  read(rel: string): Promise<{ frontmatter: object; body: string; hash: string }>;
  write(rel: string, md: string, opts: { writer: 'jarvis'; expectedHash?: string }): Promise<void>;
  appendConversationLog(entry: ConversationLogEntry): Promise<string>; // returns rel path
  trash(rel: string): Promise<void>;
  list(dirRel: string): Promise<VaultEntry[]>;
}
```

### 6.2 Retriever

```ts
interface Retriever {
  coreProfile(): Promise<string>;              // About Sir.md + Preferences.md (trimmed to budget)
  searchMemories(query: string, k?: number): Promise<MemoryHit[]>;       // FTS5 bm25
  searchConversations(query: string, k?: number): Promise<ConversationHit[]>;
  buildContextBlock(userText: string): Promise<string>;  // "<memory>…</memory>" for system prompt
}
```

Query construction: extract keywords from the user message (stopword removal), plus entity names found in memory titles; OR them in an FTS query.

### 6.3 Curator (post-turn, Haiku)

Input: last exchange (Sir + Jarvis text only), current core profile, top-10 related memory notes.
Output (strict JSON, validated with Zod):

```json
{
  "ops": [
    { "op": "ADD", "kind": "person", "path": "People/Pradyumna.md",
      "title": "Pradyumna", "facts": ["Backend/database teammate on Avaan Website"],
      "links": ["Avaan Website"], "confidence": 0.9 },
    { "op": "UPDATE", "path": "Preferences.md",
      "facts": ["Prefers before/after comparison tables for code changes"], "confidence": 0.95 },
    { "op": "NOOP" }
  ]
}
```

Applying: confidence ≥ 0.8 → apply via vault service; 0.5–0.8 or instruction-like text → `memory_review_queue`; < 0.5 → drop. Prompt in [Agents](Agents.md) §B3.

### 6.4 Policy engine

```ts
interface PolicyEngine {
  evaluate(tool: Tool, input: unknown, ctx: ToolContext): PolicyDecision;
}
type PolicyDecision = { tier: Tier; reason: string; humanSummary: string; destructive: boolean };
```

### 6.5 Confirmation broker

```ts
interface ConfirmationBroker {
  request(d: PolicyDecision & { toolName: string; details: string; taintedFrom?: string }): Promise<'approve' | 'deny'>;
  // emits confirm:request; resolves on confirm:respond, kill switch (deny), or 120 s timeout (deny)
}
```

## 7. Computer-Use Toolset Executor (Phase 6)

Request (Desktop Operator sub-agent):

```ts
{
  model: settings.models.computer,               // claude-sonnet-5-5 or claude-opus-5-5
  max_tokens: 4096,
  system: DESKTOP_OPERATOR_PROMPT,               // Agents.md §B4
  tools: [{ type: 'computer_toolset_20260801' }],// no beta header on Claude 5.5 models (API)
  messages,
}
```

Verified 2026-10-06 against the official Computer use tool page: no beta header on 5.5 models; the toolset entry takes only `type`, `configs` and `cache_control` (**no** `display_width_px`/`display_height_px`/`display_number`, they are rejected); Claude learns the screen size only from screenshots; limits are ≤ 1568 px long edge **and** ≤ 1.15 MP for broad compatibility (5.5 models accept up to 2576 px / ~3.75 MP; Jarvis uses the smaller limits to save tokens); `cursor_position` returns text like `X=512, Y=384`; `key.repeat` is 1–100; `hold_key`/`wait` durations go up to 300 s (Jarvis caps a single member at 30 s so Stop stays responsive). Pruning old screenshots is safe because the Desktop Operator does not use extended thinking. On Sir's display (1536×864 DIP at 125 %) nut.js moves in physical pixels and `screen.getCursorScreenPoint() × scaleFactor` matches within 1 px (checked with a calibration script); Settings → Advanced → "Check click accuracy" repeats this check.

Member tools to implement (17): `screenshot`, `zoom`, `left_click`, `right_click`, `middle_click`, `double_click`, `triple_click`, `left_click_drag`, `mouse_move`, `left_mouse_down`, `left_mouse_up`, `cursor_position`, `scroll`, `type`, `key` (honour `repeat`), `hold_key`, `wait`.

Rules (from the official docs):
- Dispatch on (`toolset_name === 'computer'`, `name`). Inputs have **no** `action` field.
- Run blocks **in order**; on first failure, answer remaining blocks with `is_error: true` and text `Not executed: an earlier computer action in this turn failed.`
- Every result echoes `toolset_name: 'computer'`; `screenshot`/`zoom` return an image block; others return short text (`OK`).
- **Resize screenshots yourself** (the API rejects oversized images): target ≤ 1568 px long edge for broad compatibility (Claude 5.5-class models accept larger); keep `scale` and map Claude's coordinates back: `screenX = x / scale`.
- **Windows DPI:** Electron `screen` uses DIPs; nut.js uses physical pixels. Multiply by `display.scaleFactor` when converting. Write a calibration test (click known targets) before trusting clicks.
- Exclude Jarvis overlay windows from screenshots (`setContentProtection(true)` on overlay) and refuse clicks inside Jarvis windows.
- Optionally append a fresh screenshot to the last result of a batch to save a round trip.
- Long sessions: keep the last 3 screenshots; prefer server-side tool-result clearing ⚠️ over client pruning on Claude 5.5 models (pruning can invalidate thinking blocks).

```ts
async function runComputerMember(name: string, input: any): Promise<ToolOutput> {
  desktopPolicy.assertAllowed(name, input);          // Security.md §5.3
  switch (name) {
    case 'screenshot':   return image(await capture.primaryScaled());
    case 'zoom':         return image(await capture.region(input.region));
    case 'left_click':   if (input.coordinate) await mouse.setPosition(toPhysical(input.coordinate));
                         await withModifiers(input.text, () => mouse.leftClick()); return ok();
    case 'type':         await keyboard.type(input.text); return ok();
    case 'key':          for (let i = 0; i < (input.repeat ?? 1); i++) await pressChord(input.text); return ok();
    case 'scroll':       await scroll(input.scroll_direction, input.scroll_amount, input.coordinate); return ok();
    case 'wait':         await sleep(Math.min(input.duration, 30) * 1000); return ok();
    // ...remaining members
    default:             return err(`Member ${name} is not implemented`);
  }
}
```

## 8. MCP Manager

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

async function connect(server: McpServerConfig) {
  const transport = server.transport === 'stdio'
    ? new StdioClientTransport({
        command: server.command,          // on Windows prefer 'npx.cmd' or ['cmd','/c','npx',...] if ENOENT
        args: server.args,
        env: { ...minimalEnv(), ...secretsFor(server) },  // never pass the Anthropic key
      })
    : new StreamableHTTPClientTransport(new URL(server.url!), { requestInit: { headers: authHeaders(server) } });
  const client = new Client({ name: 'jarvis', version: APP_VERSION });
  await client.connect(transport);
  const { tools } = await client.listTools();
  return { client, tools };
}
```

- Tool names exposed to Claude: `mcp__${server}__${tool}` (≤ 64 chars; truncate + hash suffix if needed).
- Tool call: `client.callTool({ name, arguments })` with 60 s timeout; map MCP `content` (text/image) to Claude `tool_result` content; mark untrusted.
- Health: reconnect with backoff (1 s → 30 s, max 5 tries) then status `error`.
- `mcp.json` shape (compatible with Claude Desktop's format):

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp@<pinned-version>", "--user-data-dir", "%APPDATA%\\Jarvis\\browser-profile"],
      "jarvis": { "trust": "official", "defaultTier": "CONFIRM",
                  "toolOverrides": { "browser_snapshot": "SAFE", "browser_navigate": "SAFE", "browser_take_screenshot": "SAFE" } }
    },
    "github": {
      "command": "<per GitHub MCP server README>",
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "secret:github_pat" },
      "jarvis": { "trust": "official", "defaultTier": "CONFIRM" }
    }
  }
}
```

`"secret:<name>"` values are resolved from the secrets store at spawn time.

Implementation (Phase 5): the `mcp_servers` table is the source of truth; `%APPDATA%\Jarvis\mcp.json` is written as a Claude-Desktop-compatible export (secret references only). HTTP servers may set `authSecret` (sent as `Authorization: Bearer …`, migration `002_mcp_auth.sql`). Args may use `{browserProfile}` and `{allowedRoots}` placeholders. `cross-spawn` inside the SDK handles `npx` on Windows, so `command: "npx"` works as-is. Imports verified against SDK 1.32.1: `@modelcontextprotocol/sdk/client/index.js`, `client/stdio.js`, `client/streamableHttp.js`.

## 9. Voice Interfaces

```ts
interface SttProvider {
  start(opts: { sampleRate: 16000; language: string }): SttSession;
}
interface SttSession {
  write(frame: Int16Array): void;
  on(event: 'partial' | 'final', cb: (text: string) => void): void;
  on(event: 'utteranceEnd', cb: () => void): void;
  close(): Promise<void>;
}

interface TtsProvider {
  readonly id: 'edge' | 'sapi' | 'elevenlabs';
  synthesize(text: string, opts: { voice: string; rate?: string; signal: AbortSignal }):
    AsyncIterable<{ mime: string; data: Uint8Array }>;
}
```

### 9.1 Mic + wake word (main process)

```ts
import { Porcupine, BuiltinKeyword } from '@picovoice/porcupine-node';
import { PvRecorder } from '@picovoice/pvrecorder-node';

const porcupine = new Porcupine(picovoiceKey, [BuiltinKeyword.JARVIS], [0.6]); // ⚠️ check constructor
const recorder = new PvRecorder(porcupine.frameLength, settings.voice.deviceIndex ?? -1);
recorder.start();
while (running) {
  const frame = await recorder.read();          // Int16Array, 16 kHz
  emitLevel(rms(frame));
  if (state === 'LISTENING') sttSession.write(frame);
  else if (porcupine.process(frame) >= 0) voice.onWake();   // also barge-in during SPEAKING
}
```

### 9.2 STT default: Deepgram live ⚠️

Options: `model` (current Nova generation), `encoding: 'linear16'`, `sample_rate: 16000`, `interim_results: true`, `endpointing: 300`, `utterance_end_ms: 1000`, `smart_format: true`, `language: 'en-IN'` or `'en'` (test both for Sir's accent). Final transcript = concatenation of `is_final` segments until `speech_final`/`UtteranceEnd`. Silence timeout 8 s → back to IDLE.

### 9.3 TTS default: Edge TTS ⚠️

Voice `en-GB-RyanNeural`, rate `+5%`. Unofficial endpoint, so wrap in try/catch → fallback to SAPI:

```powershell
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SetOutputToWaveFile($out); $s.Speak($text); $s.Dispose()
```

### 9.3a Implementation notes (Phase 4, verified 2026-10-06)

- **Deepgram** (`@deepgram/sdk` 5.14): `new DeepgramClient({ apiKey })` → `client.listen.v1.connect({ model: 'nova-3', encoding: 'linear16', sample_rate: 16000, interim_results: 'true', endpointing: 300, utterance_end_ms: 1000, vad_events: 'true', smart_format: 'true', abortSignal })` → `socket.connect(); await socket.waitForOpen()` → `sendMedia(pcm)`; messages are `Results` (`is_final`, `speech_final`, `channel.alternatives[0].transcript`), `UtteranceEnd`, `SpeechStarted`.
- **Edge TTS** uses `msedge-tts` (MIT): `setMetadata(voice, AUDIO_24KHZ_48KBITRATE_MONO_MP3)` then `toStream(escapedText, { rate })`; one MP3 per sentence. Text is SSML-escaped first.
- **Porcupine / PvRecorder** match §9.1 (`new Porcupine(key, [BuiltinKeyword.JARVIS], [sensitivity])`, `new PvRecorder(512, deviceIndex)`, `await recorder.read()`).
- `tts:audio` carries an empty **`last: true` marker** at the end of each utterance; the renderer reports `tts:playback { event: 'finished' }` once everything before it has played, which moves SPEAKING → IDLE.
- The renderer reports which chat is open with `ui:activeConversation` so spoken turns land in that conversation; spoken user messages are emitted as `chat:message` (role `user`, source `voice`).
- Local voice commands: "stop" / "never mind" (cancel turn + speech), "stop everything" (kill switch), "go to sleep" (SLEEP until hotkey). While a confirmation is open, "yes/go ahead/do it" approves (non-destructive only) and "no/cancel" denies.

### 9.4 Speech shaping

- **Sentence chunker:** buffer deltas; flush at `. ! ?` + space/newline (min 20 chars) or 200 chars.
- **Markdown stripper:** remove code blocks (say "I've put the code on screen"), links → link text, tables → "details on screen".
- **Spoken summary:** in voice mode, Claude wraps the spoken part in `<spoken>…</spoken>` ([Agents](Agents.md) §B1); only that is sent to TTS; the full text is shown in chat.
- **Barge-in:** on wake/hotkey during SPEAKING → `tts:stop`, abort synthesis, go to LISTENING.

## 10. Settings Keys (selected)

| Key | Type | Default |
|---|---|---|
| `models.default` / `models.deep` / `models.fast` / `models.computer` | string | `claude-sonnet-5-5` / `claude-opus-5-5` / `claude-haiku-4-5-20251001` / `claude-sonnet-5-5` |
| `budget.dailyUsd` / `budget.monthlyUsd` | number | 2 / 30 |
| `pricing` | `Record<model, {inPerMTok, outPerMTok, cacheReadPerMTok, cacheWritePerMTok}>` | Fill from the official pricing page |
| `voice.mode` | `'off'\|'ptt'\|'wake'` | `'ptt'` |
| `voice.stt.provider` / `voice.tts.provider` / `voice.tts.voice` | string | `deepgram` / `edge` / `en-GB-RyanNeural` |
| `voice.wake.sensitivity` | 0–1 | 0.6 |
| `hotkeys.ptt` / `hotkeys.toggleWindow` / `hotkeys.kill` | accelerator | `Ctrl+Alt+Space` / `Ctrl+Alt+J` / `Ctrl+Alt+Shift+X` |
| `vault.path` | string | `%USERPROFILE%\Documents\JarvisBrain` |
| `files.allowedRoots` | string[] | Desktop, Documents, Downloads, Pictures, Videos, Music, vault |
| `agent.maxIterations` / `agent.computerMaxActions` | number | 25 / 60 |
| `privacy.logConversationsToVault` | boolean | true |
