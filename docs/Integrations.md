# AI Integrations — status matrix and how to extend

| Field | Value |
|---|---|
| Status | v2.30 (steps 1–5 done; step 6 checked; AI Router Phase 1 done) |
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
| Cloudflare Workers AI | Planned | OpenAI-compatible, but the address contains Sir's account id (`/accounts/{id}/ai/v1`); needs a fixed-address design that validates the id before it can join. |
| OpenCode Zen / Console | Planned (maybe) | Mixed formats: chat completions only for some models, Responses / Anthropic / Gemini formats for others, and the model list lives under a different prefix. Needs a per-model format router. |
| Amazon Bedrock, Google Vertex AI, Azure AI Foundry | Planned (optional) | Need cloud sign-in (AWS SigV4, Google service accounts, Entra ID), not a simple key. |
| GitHub Models | Unsupported | Retired by GitHub (docs checked 2026-10-16). |
| Eden AI | Unsupported for now | Could not confirm an OpenAI-compatible chat endpoint in its docs. |
| Custom public endpoint (address typed by Sir) | Unsupported (decision) | Would let a whole conversation go to any host. Cloud addresses stay fixed in code. |

**Connections (v2.25).** Each provider can have up to five keys (`conn_<provider>` is the main key, `conn_<provider>_<n>` the extras), each with its own model registry in `ai_models` (live / typed / cached, favourite, enabled). Extra keys are brains for `delegate_task` and NPCs and can be Jarvis's own (`llm.cloud.connection`). Code: `main/llm/connections.ts`, `main/ipc/handlers/ai-connections.ts`, `renderer/.../settings/connections-card.tsx`.

**AI Router (v2.29 layout, v2.30 Phase 1; ADR-045).** Brain `free` = the free pool: every key of a provider in `FREE_PROVIDERS` (`shared/free-pool.ts`: Gemini, Groq, Cerebras, OpenRouter, NVIDIA, Mistral), with its chosen model and starred models. `main/llm/pool/` (router: pure ranking; pool: attempts, learning, tier-3 question; snapshot: the page), `pool_calls` (migration 017), IPC `pool:*`, Sidebar → AI Router. Private turns are refused in `agent/brain-runner.ts` (Security.md §16.15). Phases 2–4 are drawn on the page with a Phase tag.

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
