# AI Integrations — status matrix and how to extend

| Field | Value |
|---|---|
| Status | v2.32 (steps 1–5 done; step 6 checked; AI Router Phases 1–2 done) |
| Generated part | Provider and agent tables in [REFERENCE.md](REFERENCE.md) (`npm run docs:reference`) |
| Security | [Security.md](Security.md) §16.10–16.11 always wins |

Jarvis is a single-user Windows desktop app. Everything runs on Sir's PC; there is no server, so multi-user isolation and hosted secret managers do not apply. Keys live in `secrets.bin` (DPAPI) and never reach the renderer.

## Status words

| Word | Meaning |
|---|---|
| **Implemented** | Connect, model choice, Test, chat with tools, errors and unit tests are all in place, but nobody has live-tested it from this repo without Sir's key. |
| **Partial** | Some of the above; the gap is named. |
| **Detected only** | Jarvis can tell whether it is installed; it does not use it. |
| **Planned** | A later step of the plan below. |
| **Unsupported** | Won't be built; the reason is given. |

## Model APIs and gateways

All use `main/llm/local-client.ts` (Messages API ↔ OpenAI Chat Completions translation, streaming, tool calls), the fixed-address check and one DPAPI secret per provider.

| Provider | Status | Notes |
|---|---|---|
| Anthropic (API key) | Implemented | Native Messages API. Only connection with computer control and Claude web search. |
| Anthropic (Claude plan via Claude Code) | Implemented | Official Claude Code login; ADR-010. |
| OpenAI, Gemini, DeepSeek, xAI, Mistral, Groq | Implemented | OpenAI-compatible endpoints. |
| OpenRouter, Together | Implemented | Gateways. |
| Hugging Face Inference Providers | Implemented | `router.huggingface.co/v1`; token needs the Inference Providers permission. |
| Vercel AI Gateway | Implemented | `ai-gateway.vercel.sh/v1`; API key (OIDC tokens are for Vercel deployments, not a desktop app). |
| Requesty | Implemented | `router.requesty.ai/v1`. EU endpoint not offered yet. |
| DeepInfra | Partial | No documented model list: id typed by hand, Test = 1-token request. |
| Fireworks AI | Partial | Same as DeepInfra; ids look like `accounts/fireworks/models/…`. |
| Ollama cloud | Partial | Chat via `ollama.com/v1`; list via `ollama.com/api/tags` (docs say cloud ids come from there). `/v1/models` on the cloud is undocumented, so not used. |
| Local (Ollama, LM Studio, llama.cpp, FreeLLMAPI) | Implemented | Loopback / private network only (`checkLocalUrl`). One server at a time. |
| Cerebras | Implemented (2.30) | `api.cerebras.ai/v1`, tools per model. Free Trial: 5 RPM, 30K TPM, 1M TPD (docs checked 2026-10-27). |
| NVIDIA NIM | Implemented (2.30) | `integrate.api.nvidia.com/v1`. The docs show chat completions but not the model list path: if Refresh models fails, type the id from build.nvidia.com. |
| Cloudflare Workers AI | Implemented (v2.31) | Fixed address `https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1`; code fills in Sir's Account ID (`llm.cloud.cloudflareAccount`, exactly 32 lowercase hex). No documented model list: type the id (`@cf/…`). Free 10,000 neurons/day, reset 00:00 UTC (docs checked 2026-10-27). AI Router tier 2. |
| OpenCode Zen / Console | Planned (maybe) | Mixed formats: chat completions only for some models, Responses / Anthropic / Gemini formats for others, and the model list lives under a different prefix. Needs a per-model format router. |
| Amazon Bedrock, Google Vertex AI, Azure AI Foundry | Planned (optional) | Need cloud sign-in (AWS SigV4, Google service accounts, Entra ID), not a simple key. |
| GitHub Models | Unsupported | Retired by GitHub (docs checked 2026-10-16). |
| Eden AI | Unsupported for now | Could not confirm an OpenAI-compatible chat endpoint in its docs. |
| Custom public endpoint (address typed by Sir) | Unsupported (decision) for the main brain and tier 2; **tier 3 only** since v2.31 | Would let a whole conversation go to any host, so cloud addresses stay fixed in code. Exception: AI Router custom providers, always tier 3, question only (see below). |

**Connections (v2.25).** Each provider can have up to five keys (`conn_<provider>` is the main key, `conn_<provider>_<n>` the extras), each with its own model registry in `ai_models` (live / typed / cached, favourite, enabled). Extra keys are brains for `delegate_task` and NPCs and can be Jarvis's own (`llm.cloud.connection`). Code: `main/llm/connections.ts`, `main/ipc/handlers/ai-connections.ts`, `renderer/.../settings/connections-card.tsx`.

**AI Router (v2.29 layout, v2.30 Phase 1, v2.31 custom providers + Cloudflare, v2.32 Phase 2 delegation, v2.33 Phase 3 abilities, v2.34 Phase 4 and the merge of Models & AI; ADR-045).** Brain `free` = the free pool: every key of a provider in `FREE_PROVIDERS` (`shared/free-pool.ts`: Gemini, Groq, Cerebras, OpenRouter, NVIDIA, Mistral, Cloudflare) plus Sir's own tier-3 providers (`pool_custom`), with its chosen model and starred models. `main/llm/pool/` (router: pure ranking; pool: attempts, learning, tier-3 question; snapshot: the page), `pool_calls` (migration 017), IPC `pool:*`, Sidebar → AI Router. Private turns are refused in `agent/brain-runner.ts` (Security.md §16.15). Phase 2 (front door, fallback, sticky, hand-over) lives in `agent/front-door.ts` and the orchestrator's `answer()`; Phase 3 (free search, images, fusion: `llm/pool/search.ts`, `images.ts`, `fusion.ts`, `limits.ts`; voice backup: `voice/backup.ts`) is below; Phase 4 (strategies, learned scores, `shrink.ts`, context skipping, named chains, `analytics.ts`, model tests) is in ADR-045's 2.34 amendment. Since 2.34 the AI Router also holds the main-brain settings and every API key (tabs Main brain and API keys).

**Multi-AI runs (v2.26).** Sidebar → Compare AIs runs compare / review / chain over any ready brains (`main/agent/multi-run.ts`, migration 015). Model execution only (no tools); agent execution with tools stays in `delegate_task`. Fallback execution remains `llm.fallbackLocal` (opt-in); specialist routing is Jarvis choosing a `brain` in `delegate_task`. Neither switches models silently.

**Capabilities.** Per provider only `tools` is recorded (`yes` or `per-model`). Images, audio, JSON mode, reasoning controls and context windows differ per model, and no reliable per-model source is wired yet, so they are **unknown**, not assumed. The translation sends images as `image_url`; a model that can't take them returns the provider's own error.

**Pricing.** Only the Claude models have prices (Settings → `pricing`). Any other model is priced like the dearest Claude model so the budget errs safe: their cost in Usage is an over-estimate, not a bill. Add a model's real price to `pricing` to correct it. **v2.27:** OpenRouter (`pricing.prompt/completion`) and Vercel AI Gateway (`pricing.input/output`, both plus `input_cache_read/_write`, USD per token as strings; docs checked 2026-10-17) publish prices in their model list; **Refresh models** stores them per connection and the ledger uses them when `pricing` has no entry for that model (order: Sir's table, the gateway's list, the dearest model). A listed price above $1,000 per million tokens or not a number is ignored. Hugging Face's router lists per-provider prices but their unit is not documented, so it is not used. Each usage row records who answered (`source`: Anthropic key, Claude plan, this PC, or the connection) and where its price came from; Activity → Usage groups by connection or by cloud / plan / this PC and marks calls priced by guess. Compare AIs shows the most a run may cost (every AI writing its longest answer) and asks above `budget.confirmRunUsd` (default $0.05); main refuses an unconfirmed run over that level. Provider-side billing and a plan's remaining quota are not read (no official interface).

## Subscriptions and command-line apps

| App | Status | How Jarvis uses it |
|---|---|---|
| Claude Code | Implemented | Jarvis's own connection on Sir's Claude plan. |
| Codex CLI (ChatGPT plan) | Implemented | Answer-only brain `chatgpt`: `exec --sandbox read-only`, user config ignored. |
| Antigravity CLI (Gemini plan) | Implemented | Answer-only brain `antigravity`: `--print`, no auto-approve. |
| Gemini CLI | Unsupported (personal accounts) | Tested 2026-10-17: Google refuses personal sign-in in Gemini CLI; use Antigravity or the Gemini API key. |
| OpenCode | Detected only | Headless mode tested 2026-10-17; needs its own `opencode auth login` before it can be wired. |
| GitHub Copilot CLI, Cursor CLI, Aider, Goose | Detected only | Not installed on this PC, so their script mode can't be tested yet. |
| Kimi Code CLI | Detected only | Windows support not confirmed in its docs. |

What is never done, whatever the app: reading browser cookies, scraping a chat website, copying a CLI's private credential files, searching folders for keys, or turning a website subscription into API access. A paid ChatGPT, Claude or Gemini website plan is reached only through that company's own app.

## Plan (remaining steps)

| Step | Contents | State |
|---|---|---|
| 1 | Registry metadata, six gateways, manual-model Test, MCP secret-guard fix, generated tables | Done (v2.23) |
| 2 | Agent CLI detection (files only) | Done (v2.23) |
| 3 | Several connections per provider; model registry table (favourites, enabled, default, source: live / manual / cached) | Done (v2.25) |
| 4 | Compare side by side, review mode, chains, execution history, cancel | Done (v2.26) |
| 5 | Usage per provider, connection and model; local apart from cloud; live gateway prices; cost estimate and confirmation before multi-model runs | Done (v2.27) |
| 6 | Wire detected CLIs one by one (headless mode tested on this PC), then optional Bedrock / Vertex / Azure | Checked (v2.27.1): nothing new could be wired yet; see below |

**Step 6 findings (2026-10-17, this PC).** Installed: Gemini CLI 0.40.1, OpenCode 1.14.48, and only VS Code Insiders' Copilot bootstrapper (the real `@github/copilot` CLI isn't installed). Gemini CLI headless (`-p … --approval-mode plan`) is refused by Google for personal accounts ("migrate to Antigravity"), so it stays detected-only; the Antigravity brain covers the plan and the Gemini API covers keys. OpenCode headless (`run --agent plan --pure --dir <empty folder>`) starts, but its own provider sign-in is missing ("Missing Authentication header") and it exits 0 on that error, so a runner would also need to read its JSON events for errors; it gets wired once `opencode auth login` is done and a test answer comes back. Aider, Goose, Cursor and Kimi aren't installed. Bedrock, Vertex AI and Azure AI Foundry are not built: each needs its cloud account (AWS SigV4 keys, a Google service account, an Azure resource and Entra ID or key), none exists on this PC to test against, and every model they host is reachable through the existing keys or gateways.

### AI Router: custom tier-3 providers and Cloudflare (agreed 2026-10-27, built in v2.31)

Sir's decision. Amends the "Custom public endpoint: Unsupported" row above **for tier 3 only**; the main brain and tier 2 keep fixed addresses. Recorded in ADR-045 (TRD.md, BIBLE §10) and Security.md §16.15. Code: `main/llm/pool/custom.ts` (address checks, DNS re-check, store), `pool.ts` (`questionOnly`, tier forced to 3), migration 018, IPC `pool:addCustom` / `pool:testCustom` / `pool:removeCustom`.

**1. Custom providers (always tier 3).** AI Router → Providers & keys → **+ Add custom provider**: Name, Address (an OpenAI-compatible base URL, e.g. `https://gen.pollinations.ai/v1`), optional API key, Model, **Test**. Use case: basic, non-private questions ("what does *drift* mean?") on relays Sir has keys for. Guards, all enforced in code:

| Guard | Rule |
|---|---|
| Tier | A custom provider is **always tier 3**; it can't be moved to tier 2. |
| Address | HTTPS only; public hosts only: refuse localhost, loopback, private/link-local ranges (10/8, 172.16/12, 192.168/16, 169.254/16, ::1, fc00::/7) and bare IPs; resolve the host and re-check the IP before each call (DNS rebinding). Store it main-side; fixed after saving (edit = remove + add). |
| What is sent | Only the task / question itself: no chat history, no memory notes, no personal system prompt. All existing private-data checks still apply (taint, conversation history, running calls, `findSensitive`). |
| Answers | Every tier-3 answer is **untrusted outside content** (taint it like a web page): actions Jarvis takes after reading it need Sir's confirmation. |
| Tools | None for tier-3 routes in Phase 1 extras (answers only). |
| Consent | The existing tier-3 pop-up (No, wait / Until Jarvis restarts / Just this once), plus a setting **"Ask every time for third-party AIs"** (default off = once per session). |
| Keys | DPAPI secret per custom provider (new secret-name pattern, protected like provider keys); only the last four characters are shown; never logged or audited. |
| Limits | Unknown: learned from replies like the others (`retry-after`, 429 ladder). |
| Docs | Each custom provider shows "added by Sir, not checked by Jarvis" on the page. |

**2. Cloudflare Workers AI (tier 2).** OpenAI-compatible at `https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1`. The address stays fixed in code; only `{account_id}` comes from Sir: a settings field validated as exactly 32 lowercase hex characters, inserted by code (never free text). API token as a DPAPI secret like other providers, entered by Sir in Settings → Models & AI (never pasted in chat). Checked 2026-10-27 (developers.cloudflare.com): chat completions and embeddings are documented, **no model list**, so `models: 'manual'` and key checks use the one-token ping; free allowance 10,000 neurons a day, reset 00:00 UTC, so limits are learned. Tests use a fake server (`pool.test.ts`).

**3. Later (Phase 4):** context size per model: read it where a provider publishes it (OpenRouter's model list), learn it from "too long" errors, let Sir type it; then bring back the 32K+ / 128K+ / 1M+ filter.

### AI Router Phase 2: Delegation (agreed 2026-10-27, built in v2.32)

Claude stays the boss; six settings under `pool.delegation.*` (AI Router → Delegation). Full rules: Security.md §16.15 "Delegation (2.32)", ADR-045 amendment.

| Rule | Default | Where | Sir's decision |
|---|---|---|---|
| Claude delegates heavy, non-private work | on | `agent/subagents.ts` description; `services.ts` context line | Short report back |
| Front door for simple chats | off | `agent/front-door.ts` `frontDoor`, orchestrator `answer()` | Strict word rules + Laya veto only; tier 2 only; public lookup tools (`POOL_TOOLS`) |
| Sticky conversations (30 min) | on | `llm/pool/pool.ts` `lastRoute` | Delegations and chat turns of one conversation share it |
| Hand-over note | on | `front-door.ts` `handoverText` | Built in code from the pool's own exchanges (no extra model call); off = question only |
| Fallback both ways | on | `answer()`, `subagents.ts` | Claude out → local model first (when on), then the pool; tier 3 may be asked. Pool out → sub-task re-runs on Claude automatically |
| Budget-aware (80%) | on | `budget-guard.ts` `dayShare` | Front door opens + Claude told to delegate; API-key connection only |

Not done (later phases): a model-written hand-over note, Laya approving front-door questions, front-door answers for messages with attachments.

### AI Router Phase 3: Abilities (agreed 2026-10-28, built in v2.33)

Four abilities under `pool.abilities.*` (AI Router → Abilities). Full rules: Security.md §16.15 "Abilities (2.33)", ADR-045 amendment. Every one passes the privacy gate in code before anything leaves the PC.

| Service | Use | Request (⚠️ checked 2026-10-28 against the official API reference) | Free allowance | Status |
|---|---|---|---|---|
| Tavily | search 1 | `POST https://api.tavily.com/search`, `Authorization: Bearer`, `{query, max_results, search_depth: "basic"}` → `results[].title/url/content`; 429 (+ Retry-After), 432 plan limit, 433 pay-as-you-go limit | 1,000 credits a month (basic search = 1 credit) | Supported |
| Brave Search | search 2 | `GET https://api.search.brave.com/res/v1/web/search?q=&count=`, `X-Subscription-Token` → `web.results[].title/url/description` | $5 credit a month (about 1,000 searches); needs a card, so set a spending limit (third-party reports, 2026; Brave's pricing page needs sign-in) | Supported |
| Exa | search 3 | `POST https://api.exa.ai/search`, `x-api-key`, `{query, numResults, contents: {text: {maxCharacters}}}` → `results[].title/url/text` | starting credit (amount shown only in the dashboard) | Supported |
| Firecrawl | search 4 | `POST https://api.firecrawl.dev/v2/search`, `Authorization: Bearer`, `{query, limit}` → `data.web[].url/title/description` | starting credits (dashboard) | Supported |
| Linkup | search 5 | `POST https://api.linkup.so/v1/search`, `Authorization: Bearer`, `{q, depth: "standard", outputType: "searchResults"}` → `results[]` (`type` text: `name/url/content`; images skipped); 429 limit or no credit | free monthly credit (dashboard) | Supported |
| Cloudflare Workers AI | images, tier 2 | `POST https://api.cloudflare.com/client/v4/accounts/{id}/ai/run/@cf/black-forest-labs/flux-1-schnell`, Bearer token, `{prompt ≤ 2048, steps ≤ 8}` → `result.image` (base64 JPEG). Black Forest Labs terms. | 10,000 neurons a day (reset 00:00 UTC); one 1024² picture at 4 steps ≈ 58 neurons | Supported (square only: the model takes no size) |
| Pollinations | images, tier 3 | `GET https://image.pollinations.ai/prompt/{prompt}?width&height&seed&safe=true`, no key → JPEG; area ≤ 768², one at a time, 45 s apart, 402 + Retry-After over the limit | free, per IP, with a small logo | Supported, asks first |
| Gemini image models | images | — | no free image quota ("limit: 0" on the free tier, 2026) | **Dropped** |
| Groq Whisper / OpenAI transcribe | hearing backup | existing transcribers (`voice/stt/cloud-stt.ts`, API-Guide.md §9) | Groq free tier; OpenAI paid | Supported, off by default |
| Kokoro / Edge / ElevenLabs / Windows | speaking backup | existing voices (`voice/tts/`) | Kokoro, Edge, Windows free | Supported |

| Ability | Default | Where | Sir's decision |
|---|---|---|---|
| Free web search | on | `llm/pool/search.ts` (`free_web_search`), `tools/registry.ts` (which search Claude sees, per turn) | Order above; paid `web_search` only when none can take it; in `POOL_TOOLS` |
| Image generation | on | `llm/pool/images.ts` (`generate_image`, IPC `pool:image`) | Cloudflare → Pollinations (tier 3, asks first); vault `Images/` + credit note |
| Fusion brain | on | `llm/pool/fusion.ts`, brain `fusion` (`brains.ts`, `brain-runner.ts`) | 3 drafters, best judge, no tools; offered in Compare AIs |
| Voice backup: speaking | on | `voice/backup.ts` `speakingFallbacks`, `tts-pipeline.ts` `onEngine` | Kokoro → Edge → ElevenLabs → Windows |
| Voice backup: hearing | **off** | `voice/backup.ts` `hearingChain`, `voice-system.ts` | Allowed, off by default, confirm to switch on, every switch named |

**2.33.1:** keys with no chosen model join with their listed free chat models; `pool.checkKeys` re-lists each key's models (`connections.syncLive`) and stores context sizes (migration 019, `ai_models.context_tokens`; ⚠️ OpenRouter `context_length`, Groq `context_window`, checked 2026-10-28); Groq's `x-ratelimit-*` caps are learned per route.

Not done: a size picker for Cloudflare (its free FLUX model has no size), counting each search provider's monthly credit from its dashboard (only replies are read), fusion drafts with tools.

## How to add an OpenAI-compatible provider

1. Read the provider's official docs: base URL, auth header, whether `GET {base}/models` exists.
2. Add an entry to `CLOUD_PROVIDERS` in `src/shared/llm-providers.ts` with every field of `CloudProviderDef`, including `checked` (today's date). Use `models: 'manual'` when no list is documented. Never guess a URL.
3. Give it a colour in `renderer/src/features/settings/model-tree.ts`.
4. `npm run typecheck && npm test`. The gateway tests check that every address is HTTPS and that ids, secrets and addresses are unique, and `isProtectedSecret` picks up the new secret automatically.
5. `npm run docs:reference`, add a row above, bump the version.

A provider that is **not** OpenAI-compatible (own request format, cloud IAM) needs its own `LlmClient` next to `local-client.ts`; don't stretch the translation.

## How to add an agent CLI

1. Detection: add an entry to `AGENT_CLIS` in `src/shared/agent-clis.ts` (command names, documented install folders, npm package if any, install command, docs URL, `use: 'detected'`). Avoid generic command names that other tools also use.
2. Wiring it in (step 6): verify its headless flags against `--help` on this PC, then add a runner like `main/llm/cli-brains.ts`. Rules: `spawn` with an argument array (`runExe`, no shell), empty working folder, read-only or no-tool mode, API-key variables removed (`cliEnv`), timeout and output cap, never on tainted turns, unit tests with a fake runner. Change `use` to `answer-brain`.

## Diagnosing

| Symptom | Check |
|---|---|
| "doesn't publish a model list" | Expected for DeepInfra and Fireworks; type the id. |
| "rejected the API key" | Key wrong, or missing a permission (Hugging Face). |
| "Couldn't reach …" | Internet, firewall, or provider outage. |
| Agent shows "Not found" but is installed | It isn't on the PATH Jarvis started with: restart Jarvis after installing. |
