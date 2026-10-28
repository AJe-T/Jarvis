# Forge — Jarvis improves itself

> Status: **F0 decided, F1 + F2 built (v2.36.0, ADR-046, Security.md §17).** Next: F3.
> `docs/Security.md` wins every conflict with this doc.

Sir gives Jarvis a GitHub repo, an app or website to study, or a plain description. Jarvis builds that
ability itself, tests it, and hands Sir either a ready-to-use tool (no reinstall) or a new
`dist/Jarvis-Setup-<version>.exe`. Claude plans and reviews; free-pool AIs do most of the typing.

## 1. What already exists (reuse, don't rebuild)

| Piece | Where | Forge uses it for |
|---|---|---|
| Claude Code via Agent SDK (Sir's plan) | `src/main/llm/claude-code.ts` (ADR-010) | The boss: plan, review, fix |
| `start_claude_session` with `isolate` (git worktree + branch) and `studyApp` (REA) | `src/main/claude-sessions/tools.ts` | Already ~40% of a Forge run; Forge drives it headless instead of in a window |
| REA reverse-engineering MCP | `src/main/claude-sessions/rea.ts` (ADR-031) | Study an app or site before building "the same feature" |
| `delegate_task` sub-agents, brains `free` / `fusion` / chains | `src/main/agent/subagents.ts` | Hand small coding tasks to free AIs |
| Free AI pool, router, limits, allowance, analytics | `src/main/llm/pool/*` | Pick the free model, respect quotas, show the cost saved |
| Skill installer (repo link → skills, injection-scanned) | `src/main/skills/skills.ts` | Level 1, and skills the boss can switch on for a run |
| MCP client + registry | `src/main/mcp/` | Load self-built tools (Level 2) |
| Secret scan | `npm run secret-scan` | Gate before any code leaves the PC for a free AI |
| Gates: `typecheck`, `lint`, `test`, `test:e2e`, `dist` | `package.json` | The pass/fail checks |
| graphify code graph | `graphify-out/` | Find which modules a change can affect |
| GitHub remote, version tags, per-version installers | `origin`, `dist/` | Rollback |

**Laya** (`src/main/laya/laya.ts`, ADR-027) is a one-pass yes/no classifier, not a coder. Forge uses it at most
for cheap triage (e.g. "does this request need core changes?"), with Claude deciding when it isn't sure.

## 2. Three levels

| Level | Output | Reinstall? | Touches core? |
|---|---|---|---|
| **L1 Skill** | Instructions from a repo or description | No | No (exists today) |
| **L2 Self-built tool** | A small MCP server Jarvis writes in `%APPDATA%\Jarvis\forge\tools\<name>\`, tested, then registered | No; on/off/remove in one click | No |
| **L3 Self-modify** | A branch of Jarvis's own source, all gates green, Sir-approved, built to an installer | Yes | Yes, behind protected-path rules |

The boss always tries the lowest level that delivers the ability. L3 is only for UI, IPC, settings or core changes.

## 3. The pipeline (one Forge run)

```
Sir: "add X" / repo link / "like the feature in <app>"
  1. INTAKE     boss (Claude) restates the goal, picks L1/L2/L3, asks Sir only real questions
  2. STUDY      REA on the app/site, or read the repo (ideas only: no copying, AGPL/GPL = behaviour only)
  3. PLAN       boss writes forge-plan.json: tasks, each with allowed files, acceptance tests, brain
  4. SANDBOX    a fresh branch forge/<slug> from origin/dev in Forge's own clone (L3)
                or a fresh tool folder (L2). The running app is never edited.
  5. BUILD      workers (free pool first) do one task each: write the test, then the code
  6. CHECK      per task: diff only touches allowed files? its tests pass? else retry → escalate
  7. REVIEW     boss reads the full diff, runs impact tests, fixes or re-plans
  8. GATES      typecheck → lint → impact tests → full unit + security suite → e2e → secret-scan
  9. APPROVE    Sir sees Before/After/Why, the diff summary, protected-path flags, tokens used
 10. SHIP       L2: register the tool. L3: bump version, npm run dist, commit, tag, push
 11. INSTALL    Sir runs the installer. Jarvis never installs itself.
```

### Worker escalation ladder (point 5)

Each task: **no-training free model** (chain for "code") → retry once with the error output → **another
no-training free model** → (all of those used up) **pop-up asking Sir** whether other free providers,
which may keep or train on the code, may continue; it says which providers and what they receive →
**boss does it**. No paid model in between (Sir's decision). Every step is logged with tokens and cost,
so the AI Router Analytics tab shows "Forge: N tasks, X% done free, $Y saved".

The boss gives workers tiny, exact tasks: one or two files, the function signature, the test to make pass,
the relevant code pasted in. Free models fail on vague, multi-file work; they do well on this.

## 4. Sir's five points, and what each needs

| # | Sir's idea | Verdict | What Forge adds |
|---|---|---|---|
| 1 | GitHub version control, roll back if core breaks | Yes | Every Forge build is a commit + tag `v<version>`; previous installers kept in `dist/`. **Gotcha:** DB migrations are forward-only (`src/main/db/connection.ts`), so an old exe can meet a newer DB. Fix: back up `jarvis.db` (and settings) before a Forge build is installed; "Roll back" restores the backup and points Sir at the previous installer. |
| 2 | Compare diffs, don't touch unchanged modules, test changed + existing features | Yes, with one change | Enforce "don't touch": each task's allowed-files list; a diff outside it is rejected. Testing only changed files is **not enough**: unchanged modules that import changed ones can break. So: fast loop = tests related to changed files (`vitest related` + graphify dependents); final gate = the **full** suite + security suite + e2e. |
| 3 | Use Jarvis's own Claude, agents, skills, connections | Yes | The boss session gets the skills Sir marks "Forge", the MCP connections he allows, and REA. Skills are already injection-scanned; MCP secrets stay in main (Security §10 MCP Server Vetting). |
| 4 | Use REA and Laya | REA yes, Laya barely | REA is the study step. Laya is a classifier, so it can only help triage (see §1). |
| 5 | Free brains do the work, Claude plans and reviews | Yes | §3 ladder. Privacy (§7 Q1, decided): no-training providers first; others only after a pop-up Sir answers. Today the free-pool privacy gate closes once private files are read, so F4 adds an explicit, secret-scanned "Forge workspace is shareable" exception. |

## 5. Safety rules (non-negotiable)

1. **Protected paths** (`PROTECTED_PATHS` in `src/main/forge/protected.ts`). Checked twice: the boss's
   edit is refused when it happens, and the gate rejects any diff touching one. Sir can allow a file by
   name when starting a run (shown in capitals in the confirmation). The list: `src/main/security/`
   (policy engine, guards, redaction), Electron hardening (`src/main/index.ts`, `src/main/windows/`, app
   windows, `src/preload/`, CSP in `src/renderer/index.html`, `electron-builder.yml` fuses, IPC
   validation), the executor, confirmation broker and tool types, the privacy gates (`subagents.ts`,
   `brain-runner.ts`, `front-door.ts`), how Claude Code and programs start (`claude-code.ts`,
   `lib/process.ts`), `package.json`, the lockfile and `.npmrc`, test/lint/format/type configs and
   `tests/setup.ts`, `scripts/`, `.github/`, `.husky/`, `.claude/`, `.gitignore`, `.gitattributes`,
   `.env*`, `CLAUDE.md`, `RULES.md`, `docs/Security.md`, this doc, and Forge itself
   (`src/main/forge/`, `src/shared/forge.ts`). Jarvis may never weaken the checks that review Jarvis.
   `src/main/services.ts` (where every feature is wired, Forge too) is not protected, because nearly
   every feature changes it: Sir's review of the diff in F5 covers it.
2. **Tests can't be weakened to go green.** Deleted test files, fewer test cases, `.skip`/`.only`/`.todo`/`.fails`, and switching type checking or linting off for a file fail the run; fewer assertions is a warning.
3. **No code from other repos.** Workers get behaviour notes, never pasted source. The boss checks diffs for
   large verbatim blocks from the studied repo.
4. **Secrets.** Worktree is secret-scanned before any free AI sees it; `.env*`, keys, vault, logs, DB never
   enter a worker prompt.
5. **Sir approves twice.** The plan (before tokens are spent) and the result (before `dist`). Install is
   always Sir's own action.
6. **Budget cap per run.** Tokens and money; the run pauses and asks when the cap is hit.
7. **L2 tools are sandboxed.** Own folder, run as an MCP server with only the guards' allowed paths; tier
   assigned by the boss, default CONFIRM; Zod schema + summarize + timeout + tests like every tool.

## 6. Phases

Each phase ends with tests green, BIBLE.md updated, a version bump and an installer (project rule).

| Phase | Goal | Main tasks | Done when |
|---|---|---|---|
| **F0 Design** ✅ | Lock decisions | §7 answered 2026-10-28; ADR-046; Security §17 | Done |
| **F1 Headless boss** ✅ 2.36 | Claude Code runs a brief in Forge's clone without a window and reports back | `forge/boss.ts` (Agent SDK, file tools only, `run_check`/`changed_files` MCP tools, permission gate), `forge/workspace.ts` (clone, branch, `npm ci` every run, commit, clean, diff; no git hooks, `.git/config` restored each run), `forge/forge.ts` (one run at a time, budget, cancel, announce), tools `forge_setup`/`forge_start`/`forge_status`/`forge_cancel`. Progress through `forge_status` and notifications; a Forge panel comes in F7 | Unit + real-git integration tests green; first real run is Sir's |
| **F2 Gates + protected paths** ✅ 2.36 | Nothing ships unless green | `forge/gates.ts`: review → typecheck → lint → related tests → full unit → build → e2e → secret scan, stop at first failure; `forge/protected.ts`: protected files, deleted/renamed tests, `.skip/.only/.todo/xit`, fewer assertions (warning) | Planted bad diffs (protected file, skipped test, deleted test) are rejected in tests |
| **F3 L2 self-built tools** | New abilities with no reinstall | Tool template (MCP server + Zod + tests); sandbox folder; register/disable/remove UI; boss picks L2 when it fits | "Make a tool that fetches X's public API" works end to end, then is removed cleanly |
| **F4 Free workers** | Cheap typing | `forge-plan.json` task format; worker tools scoped to the worktree (read/write allowed files only); escalation ladder; Analytics "Forge saved" | ≥60% of tasks in a sample run finish on free models, all gates still green |
| **F5 Ship + rollback** | Installer, merge and undo | After Sir approves: version bump, `dist`, merge `forge/<slug>` into `dev`, tag, push to GitHub (automatic, Sir's decision); Sir's own copy catches up with `git pull`. DB/settings backup; "Roll back" flow | Install a Forge build, roll back, previous version starts with Sir's data intact |
| **F6 Study mode** | "Build it like that app" | REA + repo study → behaviour notes; no-copy check; skills/connections allow-list for runs | A feature studied from a sample app is rebuilt in our own code |
| **F7 Polish** | Daily use | Voice: "Jarvis, learn to …"; Forge history page; per-run cost; evals for plan quality | Sir uses it for a real feature |

Order: F1 → F2 before anything else, because the gates are what make the rest safe. F3 gives the most
value soonest. F4 cuts cost. F5 makes L3 real.

## 7. Decisions (Sir, 2026-10-28)

1. **Code to free AIs:** no-training free providers first. When their limits are used up, a pop-up tells
   Sir which other free providers would get the code and that they may keep or train on it; only on yes.
   Secret scan before anything leaves the PC. (F4)
2. **Paid fallback:** none. Free AIs → Claude.
3. **Source location:** a separate clone only Forge uses (`%APPDATA%\Jarvis\forge\repo`, from GitHub).
   When a change is done and approved it is merged into `dev` (F5). Forge is now the main way to build
   Jarvis; Sir coding by hand is optional.
4. **Push:** automatic after Sir approves (F5). GitHub `origin/dev` is the base of every run, so commits
   made by hand must be pushed before Forge sees them.
5. **Start point:** F1 + F2 first (done in 2.36), then the next phases in order.
