# Code Style — JARVIS Desktop

| Field | Value |
|---|---|
| Status | v1.0 |
| Last updated | 2026-10-06 |
| Related | [Agents](Agents.md) Part A · [Testing](Testing.md) · [Security](Security.md) |

Formatting is automated (Prettier); this document covers the decisions tools can't make.

---

## 1. Principles

1. **Readable over clever.** Sir must be able to follow every file. Prefer explicit code to abstractions until a pattern repeats 3 times.
2. **Boundaries are typed and validated.** Anything crossing IPC, the network, a child process, the file system, or the LLM is parsed with Zod.
3. **Fail loudly in dev, gracefully in prod.** Errors are typed, logged with context, and turned into clear user messages.
4. **Security rules are code-review blockers** ([Security](Security.md)).
5. **Small modules.** Target < 300 lines per file, < 50 lines per function.

## 2. TypeScript

- `strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitOverride: true`, `exactOptionalPropertyTypes: true`.
- No `any`. Use `unknown` and narrow, or a Zod schema. `as` casts only at validated boundaries, with a comment.
- Prefer `type` for unions/aliases, `interface` for object contracts that are implemented (e.g., `TtsProvider`).
- Use discriminated unions for states/results (`{ ok: true, value } | { ok: false, error }`).
- No enums; use `as const` objects + union types:
  ```ts
  export const TIERS = ['SAFE', 'CONFIRM', 'BLOCKED'] as const;
  export type Tier = (typeof TIERS)[number];
  ```
- ES modules everywhere; path aliases: `@main/*`, `@renderer/*`, `@shared/*`.
- Async: always `await` or explicitly `void` a promise; ESLint `no-floating-promises` on.
- Pass `AbortSignal` to every long-running operation (LLM calls, tools, TTS, MCP calls).

## 3. Naming & Files

| Thing | Convention | Example |
|---|---|---|
| Files | kebab-case | `policy-engine.ts`, `confirm-dialog.tsx` |
| React components | PascalCase export, kebab-case file | `export function ConfirmDialog` in `confirm-dialog.tsx` |
| Functions/vars | camelCase, verbs for functions | `buildContextBlock()` |
| Constants | UPPER_SNAKE for true constants | `MAX_ITERATIONS` |
| Types/interfaces | PascalCase, no `I` prefix | `ToolContext` |
| Claude tool names | snake_case verb_noun | `open_app`, `delete_to_recycle_bin` |
| IPC channels | `domain:action` | `chat:send`, `tool:update` |
| Settings keys | dot.path | `voice.tts.voice` |
| Tests | `*.test.ts` next to code (unit) or in `tests/` (integration/E2E) | `path-guard.test.ts` |
| Zod schemas | `XxxSchema` + inferred `type Xxx` | `ChatSendSchema`, `type ChatSend` |

One exported concept per file where practical; `index.ts` barrels only at module roots (`tools/native/index.ts`).

## 4. Main-Process Patterns

### 4.1 Errors

```ts
export class JarvisError extends Error {
  constructor(
    public readonly code: ErrorCode,          // 'TOOL_TIMEOUT' | 'POLICY_BLOCKED' | 'LLM_AUTH' | ...
    message: string,
    public readonly userMessage?: string,     // safe to show Sir
    public readonly cause?: unknown,
  ) { super(message); }
}
```
- Throw `JarvisError` (or subclasses `ToolError`, `PolicyError`) inside services; catch at boundaries (IPC handler, agent loop, tool executor) and convert to a user message or `tool_result` error.
- Never swallow errors silently. If intentionally ignored, comment why and log at `debug`.
- Tool errors returned to Claude must be **actionable**: say what failed and what might work ("No app matches 'VSC'. Closest: Visual Studio Code").

### 4.2 Logging (pino)

```ts
const log = logger.child({ module: 'tools.executor' });
log.info({ tool: block.name, tier, decision, durationMs }, 'tool executed');
```
- Structured fields, short message. Levels: `error` (needs attention), `warn` (degraded), `info` (lifecycle, tool decisions), `debug` (payload shapes, dev only).
- Never log: API keys, full prompts in prod, raw audio, screenshots, file contents. pino `redact` paths + `redact()` helper on strings.

### 4.3 Services & dependency injection
- Services are created in `main/index.ts` (composition root) and passed explicitly. No hidden singletons except `logger` and `settings`.
- Each service exposes an interface (for test fakes). Example: `createPolicyEngine({ settings, pathGuard, shellGuard }): PolicyEngine`.

### 4.4 Child processes
- Only `execFile`/`spawn` with argument arrays; PowerShell through `runPowerShell(script, { timeoutMs, signal })` which uses `-EncodedCommand`.
- Always set `windowsHide: true`, a timeout, and kill the process tree on abort.

### 4.5 Files
- All paths through `pathGuard.resolve()` before use.
- Writes are atomic (`write tmp → rename`).
- Use `fs/promises`; no sync I/O on hot paths except `better-sqlite3` (which is synchronous by design and fast).

## 5. IPC Patterns

- Define channel + Zod request/response in `src/shared/ipc-contract.ts` **first**, then implement the handler and preload method.
- One preload method per channel; no generic `invoke`.
- Events from main use `webContents.send` via a typed `emit(event, payload)` helper; payloads validated in dev builds.
- Large binary (TTS audio) goes as `ArrayBuffer`; high-frequency events (`voice:level`) are throttled (≤ 20 Hz).

## 6. React / UI

- Function components + hooks only. Components ≤ 200 lines; extract subcomponents.
- State: local `useState` for UI-only; **Zustand stores** for cross-component state (`useChatStore`, `useAssistantStore`, `useSettingsStore`). Stores are updated from IPC events in one place (`src/renderer/src/lib/ipc-bridge.ts`).
- Styling: Tailwind classes using **design tokens only** (`bg-night-900`, `text-ink-300`, `ring-reactor-500`). **No raw hex/rgb values** in components; ESLint rule (`no-restricted-syntax` on hex literals in `.tsx`) + review.
- Use Radix primitives for Dialog, Tooltip, Popover, Switch, Tabs (accessibility built in).
- Markdown via `react-markdown` + `remark-gfm`; **no** `rehype-raw`, **no** `dangerouslySetInnerHTML`.
- Every icon-only button has `aria-label`; every interactive element is keyboard reachable.
- Respect `prefers-reduced-motion` via a `useReducedMotion()` hook.
- Copy follows [Design-system](Design-system.md) §8 (sentence case, action-named buttons).

## 7. Tests (summary)

- Unit tests for every pure module (policy, guards, redaction, chunker, router, FTS query builder) and every tool (with mocked OS calls).
- Name tests by behaviour: `it('blocks Remove-Item -Recurse on C:\\')`.
- No real network, API keys, or OS side effects in unit/integration tests. Full strategy: [Testing](Testing.md).

## 8. Git Workflow

| Item | Rule |
|---|---|
| Branches | `main` (always runnable) · `phase-N/<short-topic>` · `fix/<topic>` |
| Commits | Conventional Commits: `feat(tools): add open_app with Start Menu index`, `fix(voice): stop TTS on barge-in`, `docs: update API-Guide memory tool commands`, `test(security): add shell blocklist cases` |
| Commit size | One concern; compiles and tests pass at each commit |
| PR / merge checklist | Typecheck ✓ Lint ✓ Tests ✓ Security tests ✓ Docs updated ✓ No secrets ✓ Manual check steps written ✓ |
| Tags | `v0.<phase>.0` at the end of each phase (e.g., `v0.2.0` after Phase 2) |
| Never commit | `.env`, `secrets.bin`, `*.db`, vault content, logs, `dist/`, `out/` |

Sir's git identities (local user / GitHub account) are configured per repo by Sir; the coding agent must not change global git config.

## 9. Dependency Checklist

Before adding a package, answer in the PR:
1. **Need:** can we do it in < 50 lines ourselves or with an existing dependency?
2. **Licence:** MIT / Apache-2.0 / BSD / ISC only. (No GPL/AGPL/SSPL/"Commons Clause" in the app bundle.)
3. **Health:** release or commit in the last 6 months; no unresolved critical security advisories.
4. **Size & native code:** native modules need Electron rebuild support and Windows prebuilds.
5. **Trust:** reputable publisher; check download counts and repo; avoid typosquats (verify exact name).
6. **Pin:** exact version in `package.json`; lockfile committed.

## 10. Licensing & Third-Party Code

- **Do not copy code from other repositories** into this project by default. Re-implement from our specs.
- AGPL/GPL projects (e.g., Open Interpreter, Khoj): **never** copy code, even small snippets. Ideas and public behaviour are fine; code is not.
- MIT/Apache snippets (only if truly necessary): keep the original copyright + licence header in the file, and add an entry to `THIRD_PARTY_NOTICES.md` (project, URL, licence, files).
- Fonts are OFL; bundle their licence files in `resources/fonts/`.
- Bundled MCP servers (e.g., `@playwright/mcp`, Apache-2.0) run as separate processes; list them in `THIRD_PARTY_NOTICES.md`.

## 11. Comments & Documentation

- Comments explain **why**, not what. Link to the relevant doc section for non-obvious rules: `// Security.md §5.2: never build shell strings`.
- Each module folder has a short `README.md` (purpose, main exports, gotchas).
- When behaviour or interfaces change, update the docs in `docs/` in the same commit. The docs are the source of truth for Claude Code.

## 12. Config Samples

`tsconfig.json` (base, extended by node/web configs):
```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "strict": true, "noUncheckedIndexedAccess": true, "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true, "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true, "skipLibCheck": true, "resolveJsonModule": true,
    "isolatedModules": true, "forceConsistentCasingInFileNames": true,
    "baseUrl": ".",
    "paths": { "@main/*": ["src/main/*"], "@renderer/*": ["src/renderer/src/*"], "@shared/*": ["src/shared/*"] }
  }
}
```

`.prettierrc`:
```json
{ "singleQuote": true, "semi": true, "trailingComma": "all", "printWidth": 100, "endOfLine": "crlf" }
```
(`endOfLine: crlf` matches Windows; alternatively set `"auto"` and use `.gitattributes` with `* text=auto eol=lf`. Pick one at Phase 0 and keep it.)

ESLint (flat config, key rules):
```js
rules: {
  '@typescript-eslint/no-explicit-any': 'error',
  '@typescript-eslint/no-floating-promises': 'error',
  '@typescript-eslint/consistent-type-imports': 'error',
  'no-restricted-imports': ['error', { paths: [
    { name: 'child_process', importNames: ['exec', 'execSync'], message: 'Use execFile/spawn or runPowerShell (Security.md §5.2)' },
  ]}],
  'no-restricted-syntax': ['error',
    { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: 'Not allowed (Security.md §7)' },
  ],
  'react-hooks/rules-of-hooks': 'error',
  'react-hooks/exhaustive-deps': 'warn',
}
```
