import { z } from 'zod';
import type { LivePrice, ModelListing } from '@shared/llm-providers';
import { JarvisError } from '../errors';
import { redact } from '../security/redact';

const OpenAiModels = z.object({
  data: z.array(z.object({ id: z.string(), pricing: z.unknown().optional() })).default([]),
});

/** Most a real model charges per million tokens; anything above is a misread unit, not a price. */
const MAX_PER_MTOK = 1000;

/**
 * Integrations step 5: a gateway's listed price (USD per token, as strings) → per million tokens.
 * Null when the shape or the numbers don't look like a price (then Jarvis prices it as unknown).
 */
export function parsePrice(kind: 'openrouter' | 'vercel', pricing: unknown): LivePrice | null {
  if (!pricing || typeof pricing !== 'object') return null;
  const p = pricing as Record<string, unknown>;
  const perM = (v: unknown, fallback?: number): number | null => {
    if (v === undefined && fallback !== undefined) return fallback;
    const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
    if (!Number.isFinite(n) || n < 0) return null;
    const m = Math.round(n * 1_000_000 * 1e6) / 1e6;
    return m <= MAX_PER_MTOK ? m : null;
  };
  const input = perM(kind === 'openrouter' ? p['prompt'] : p['input']);
  const output = perM(kind === 'openrouter' ? p['completion'] : p['output']);
  if (input === null || output === null) return null;
  const cacheRead = perM(p['input_cache_read'], input);
  const cacheWrite = perM(p['input_cache_write'], input);
  if (cacheRead === null || cacheWrite === null) return null;
  return {
    inPerMTok: input,
    outPerMTok: output,
    cacheReadPerMTok: cacheRead,
    cacheWritePerMTok: cacheWrite,
  };
}
const OllamaTags = z.object({
  models: z.array(z.object({ name: z.string().optional(), model: z.string().optional() })),
});
import type { ToolCatalogEntry } from '../agent/agent-loop';
import type { LlmClient, LlmMessage, LlmRequest, MessageParam } from './types';

/**
 * ADR-013: a local model behind an OpenAI-compatible endpoint (Ollama, LM Studio, llama.cpp server).
 * Translates Jarvis's Messages-API requests to /chat/completions and the streamed answer back, so the
 * normal agent loop, tools and safety checks run unchanged. Idea from isair/jarvis; code is our own.
 */

interface OaiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | Array<Record<string, unknown>> | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

type Block = Record<string, unknown> & { type: string };

const asBlocks = (c: MessageParam['content']): Block[] =>
  typeof c === 'string' ? [{ type: 'text', text: c }] : (c as unknown as Block[]);

function textOf(blocks: Block[]): string {
  return blocks
    .map((b) => {
      if (b.type === 'text') return typeof b.text === 'string' ? b.text : '';
      if (b.type === 'image') return '[image]';
      if (b.type === 'document') return '[document]';
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function imageParts(blocks: Block[]): Array<Record<string, unknown>> {
  return blocks
    .filter((b) => b.type === 'image')
    .map((b) => {
      const src = b.source as { media_type?: string; data?: string };
      return {
        type: 'image_url',
        image_url: { url: `data:${src.media_type ?? 'image/png'};base64,${src.data ?? ''}` },
      };
    });
}

/** Anthropic messages → OpenAI chat messages (tool_use ↔ tool_calls, tool_result ↔ role "tool"). */
export function toOpenAiMessages(
  system: LlmRequest['system'],
  messages: MessageParam[],
): OaiMessage[] {
  const out: OaiMessage[] = [];
  const sys = typeof system === 'string' ? system : (system ?? []).map((b) => b.text).join('\n\n');
  if (sys) out.push({ role: 'system', content: sys });
  for (const m of messages) {
    const blocks = asBlocks(m.content);
    if (m.role === 'assistant') {
      const calls = blocks.filter((b) => b.type === 'tool_use');
      out.push({
        role: 'assistant',
        content: textOf(blocks) || null,
        ...(calls.length
          ? {
              tool_calls: calls.map((b) => ({
                id: String(b.id),
                type: 'function' as const,
                function: { name: String(b.name), arguments: JSON.stringify(b.input ?? {}) },
              })),
            }
          : {}),
      });
      continue;
    }
    for (const r of blocks.filter((b) => b.type === 'tool_result')) {
      const c = r.content as MessageParam['content'] | undefined;
      const inner = c === undefined ? [] : asBlocks(c);
      out.push({
        role: 'tool',
        tool_call_id: String(r.tool_use_id),
        content: `${r.is_error ? 'ERROR: ' : ''}${textOf(inner)}`,
      });
    }
    const rest = blocks.filter((b) => b.type !== 'tool_result');
    if (!rest.length) continue;
    const images = imageParts(rest);
    out.push({
      role: 'user',
      content: images.length ? [{ type: 'text', text: textOf(rest) }, ...images] : textOf(rest),
    });
  }
  return out;
}

/** Jarvis tool definitions → OpenAI functions. Server tools (web search) and the computer toolset are dropped. */
export function toOpenAiTools(
  tools: LlmRequest['tools'],
  catalog: () => ToolCatalogEntry[],
): Array<{
  type: 'function';
  function: { name: string; description: string; parameters: unknown };
}> {
  const byName = new Map(catalog().map((t) => [t.name, t]));
  return (tools ?? []).flatMap((t) => {
    const def = t as { name?: string; description?: string; input_schema?: unknown; type?: string };
    const entry = def.name ? byName.get(def.name) : undefined;
    const schema = def.input_schema ?? entry?.inputSchema;
    if (!def.name || !schema || def.name === 'web_search' || def.name === 'delegate_desktop_task')
      return [];
    return [
      {
        type: 'function' as const,
        function: {
          name: def.name,
          description: def.description ?? entry?.description ?? '',
          parameters: schema,
        },
      },
    ];
  });
}

type OpenAiTool = ReturnType<typeof toOpenAiTools>[number];

/** Small local models drift when shown ~70 tools; isair/jarvis routes each request to a few. */
export const LOCAL_TOOL_LIMIT = 12;
/** Always offered: memory and the clock are relevant to almost anything. */
const CORE_TOOLS = ['get_datetime', 'search_memory', 'memory'];
const STOP = new Set(
  'a an the and or of to in on for with my me i you it is are be do does can could would please what whats how when where who this that from at by about jarvis sir'.split(
    ' ',
  ),
);
const words = (text: string): Set<string> =>
  new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
      .map((w) => w.replace(/(ing|ed|es|s)$/, '')),
  );

/**
 * Keyword routing (isair/jarvis's KEYWORD strategy; code is ours): score each tool by words shared
 * between Sir's latest message and the tool's name and description; keep tools this turn already used.
 * ponytail: keyword overlap; switch to the semantic index's embeddings if routing misses too often.
 */
export function selectTools(
  tools: OpenAiTool[],
  messages: LlmRequest['messages'],
  limit = LOCAL_TOOL_LIMIT,
): OpenAiTool[] {
  if (tools.length <= limit) return tools;
  const used = new Set<string>();
  let ask = '';
  for (const m of messages) {
    if (typeof m.content === 'string') {
      if (m.role === 'user') ask = m.content;
      continue;
    }
    const text = m.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join(' ');
    if (m.role === 'user' && text.trim()) ask = text;
    for (const b of m.content) if (b.type === 'tool_use') used.add(b.name);
  }
  const q = words(ask);
  const scored = tools.map((t) => {
    const name = words(t.function.name.replace(/_/g, ' '));
    const desc = words(t.function.description);
    let score = 0;
    for (const w of q) score += (name.has(w) ? 3 : 0) + (desc.has(w) ? 1 : 0);
    return { t, score };
  });
  const keep = new Set([...used, ...CORE_TOOLS]);
  const picked = scored
    .filter((x) => x.score > 0 && !keep.has(x.t.function.name))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, limit - keep.size))
    .map((x) => x.t.function.name);
  for (const n of picked) keep.add(n);
  return tools.filter((t) => keep.has(t.function.name));
}

/** Removes <think>…</think> reasoning that some local models stream as ordinary text. */
export class ThinkFilter {
  private inThink = false;
  private carry = '';
  push(delta: string): string {
    let s = this.carry + delta;
    this.carry = '';
    let out = '';
    while (s) {
      const tag = this.inThink ? '</think>' : '<think>';
      const at = s.indexOf(tag);
      if (at === -1) {
        // Keep a possible partial tag for the next delta.
        const partial = [...Array(tag.length - 1).keys()]
          .map((i) => tag.slice(0, i + 1))
          .reverse()
          .find((p) => s.endsWith(p));
        const keep = partial?.length ?? 0;
        if (!this.inThink) out += s.slice(0, s.length - keep);
        this.carry = s.slice(s.length - keep);
        break;
      }
      if (!this.inThink) out += s.slice(0, at);
      s = s.slice(at + tag.length);
      this.inThink = !this.inThink;
    }
    return out;
  }
}

export interface LocalLlmConfig {
  baseUrl(): string;
  model(): string;
  catalog(): ToolCatalogEntry[];
  /** Optional Bearer key, for servers that want one (e.g. FreeLLMAPI's unified key). */
  apiKey?(): string | undefined;
  fetch?: typeof fetch;
  /** Sees each chat reply's status and headers (the AI Router learns limits from them). */
  observe?(r: { status: number; headers: Headers }): void;
  /**
   * A cloud provider instead of a server on this PC: its fixed address is allowed, every tool is
   * offered (big models cope), and calls are billed. Name and settings hint for messages.
   */
  cloud?: {
    name(): string;
    allowedBaseUrls: readonly string[];
    /** Fixed model-list addresses for providers that don't use {baseUrl}/models. */
    allowedModelUrls?: readonly string[];
    /** How the provider lists its models (shared/llm-providers.ts); default 'openai'. */
    listing?(): {
      kind: ModelListing;
      url?: string | undefined;
      prices?: 'openrouter' | 'vercel' | undefined;
    };
    /** The connection id, carried in the message id so usage can be told apart per key. */
    tag?(): string;
  };
}

/** Only the catalogue's fixed HTTPS addresses (shared/llm-providers.ts), never one typed in. */
export function checkCloudUrl(raw: string, allowed: readonly string[]): URL {
  if (!allowed.includes(raw) || !raw.startsWith('https://'))
    throw new JarvisError('INVALID', 'unknown cloud url', 'That AI provider is not supported.');
  return new URL(raw);
}

/** Only loopback or private-network servers: the whole conversation goes to this endpoint. */
export function checkLocalUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new JarvisError(
      'INVALID',
      'bad local url',
      'The local model address is not a valid URL.',
    );
  }
  const h = url.hostname.replace(/^\[|\]$/g, '');
  const privateHost =
    h === 'localhost' ||
    h === '::1' ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h);
  if (!/^https?:$/.test(url.protocol) || !privateHost)
    throw new JarvisError(
      'INVALID',
      'non-local url',
      'The local model must run on this PC or your home network (localhost or a private address).',
    );
  return url;
}

const join = (base: string, path: string): string => `${base.replace(/\/+$/, '')}${path}`;

export function createLocalClient(cfg: LocalLlmConfig): LlmClient & {
  listModels(): Promise<string[]>;
  listModelsDetailed(): Promise<Array<{ id: string; price: LivePrice | null }>>;
} {
  const f = cfg.fetch ?? fetch;
  const cloud = cfg.cloud;
  const auth = (): Record<string, string> => {
    const key = cfg.apiKey?.();
    return key ? { authorization: `Bearer ${key}` } : {};
  };
  const where = (): string => (cloud ? cloud.name() : 'the local model');
  const settingsHint = cloud
    ? 'Choose a model for the AI provider in Settings → Brain.'
    : 'Choose a local model in Settings → Models & AI.';
  const unreachable = (detail: string): JarvisError =>
    new JarvisError(
      'LLM_NETWORK',
      detail,
      cloud
        ? `Couldn't reach ${cloud.name()}. Check the internet connection and the API key in Settings → Brain.`
        : `Couldn't reach the local model at ${cfg.baseUrl()}. Is Ollama or LM Studio running?`,
    );
  const checkUrl = (raw: string): URL =>
    cloud ? checkCloudUrl(raw, cloud.allowedBaseUrls) : checkLocalUrl(raw);
  const needKey = (): void => {
    if (cloud && !cfg.apiKey?.())
      throw new JarvisError(
        'INVALID',
        'no cloud key',
        `Add your ${cloud.name()} API key in Settings → Brain.`,
      );
  };

  const listing = (): {
    kind: ModelListing;
    url?: string | undefined;
    prices?: 'openrouter' | 'vercel' | undefined;
  } => cloud?.listing?.() ?? { kind: 'openai' };

  /** Model ids, and their prices where the gateway publishes them (integrations step 5). */
  async function listModelsDetailed(): Promise<Array<{ id: string; price: LivePrice | null }>> {
    needKey();
    const how = listing();
    if (how.kind === 'manual')
      throw new JarvisError(
        'INVALID',
        'no model list',
        `${where()} doesn't publish a model list. Type the model id from its website.`,
      );
    // The Ollama list address must be one of the catalogue's fixed list addresses.
    const url =
      how.kind === 'ollama' && how.url
        ? checkCloudUrl(how.url, cloud?.allowedModelUrls ?? []).toString()
        : join(checkUrl(cfg.baseUrl()).toString(), '/models');
    const res = await f(url, {
      headers: auth(),
      signal: AbortSignal.timeout(8000),
    }).catch((e: unknown) => {
      throw unreachable(String(e));
    });
    if (!res.ok) throw unreachable(`HTTP ${res.status}`);
    const parsed = (how.kind === 'ollama' ? OllamaTags : OpenAiModels).safeParse(
      await res.json().catch(() => null),
    );
    if (!parsed.success) throw unreachable('model list was not the expected JSON');
    const body = parsed.data;
    if ('models' in body)
      return body.models
        .map((m) => ({ id: m.name ?? m.model ?? '', price: null }))
        .filter((m) => m.id);
    const prices = how.prices;
    return body.data.map((m) => ({
      id: m.id,
      price: prices ? parsePrice(prices, m.pricing) : null,
    }));
  }

  const listModels = async (): Promise<string[]> => (await listModelsDetailed()).map((m) => m.id);

  /** No model list to check against: one tiny, non-streamed request (max_tokens 1) instead. */
  async function pingByRequest(model: string): Promise<void> {
    const base = checkUrl(cfg.baseUrl()).toString();
    const res = await f(join(base, '/chat/completions'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth() },
      body: JSON.stringify({
        model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'Reply OK' }],
      }),
      signal: AbortSignal.timeout(20_000),
    }).catch((e: unknown) => {
      throw unreachable(String(e));
    });
    if (res.ok) return;
    // The body is the provider's text: some echo the request, so strip known secrets and the key.
    const key = cfg.apiKey?.();
    const raw = await res.text().catch(() => '');
    const text = redact(key ? raw.split(key).join('[key]') : raw).slice(0, 200);
    const s = res.status;
    if (s === 401 || s === 403)
      throw new JarvisError('LLM_AUTH', `test ${s}`, `${where()} rejected the API key.`);
    if (s === 402 || s === 429 || s >= 500)
      throw new JarvisError(
        s === 429 ? 'LLM_OVERLOADED' : 'LLM_NETWORK',
        `test ${s}: ${text}`,
        s === 402
          ? `${where()} says the account is out of credit (402).`
          : `${where()} is busy or failing right now (${s}). Try again in a minute.`,
      );
    throw new JarvisError(
      'INVALID',
      `test ${s}: ${text}`,
      `${where()} refused "${model}" (${s}): ${text}`,
    );
  }

  return {
    listModels,
    listModelsDetailed,
    async ping() {
      const model = cfg.model();
      if (!model) throw new JarvisError('INVALID', 'no model', settingsHint);
      if (listing().kind === 'manual') {
        needKey();
        return pingByRequest(model);
      }
      const models = await listModels();
      // Some providers list ids as "models/<id>" but take the bare id.
      if (!models.some((m) => m === model || m === `models/${model}`))
        throw new JarvisError(
          'INVALID',
          'model missing',
          `${where()} doesn't have "${model}". Available: ${models.slice(0, 20).join(', ') || 'none'}.`,
        );
    },

    async stream(req, opts) {
      if (req.tools?.some((t) => (t as { type?: string }).type?.startsWith('computer_')))
        throw new JarvisError(
          'LLM_BAD_REQUEST',
          'computer toolset on local model',
          'Computer control needs an Anthropic API key. Switch the connection in Settings → Models & AI.',
        );
      const model = cfg.model();
      if (!model) throw new JarvisError('INVALID', 'no model', settingsHint);
      needKey();
      const base = checkUrl(cfg.baseUrl()).toString();
      const all = toOpenAiTools(req.tools, cfg.catalog);
      // Small local models drift with ~70 tools; cloud models get them all.
      const tools = cloud ? all : selectTools(all, req.messages);
      const body = {
        model,
        stream: true,
        stream_options: { include_usage: true },
        max_tokens: req.max_tokens,
        messages: toOpenAiMessages(req.system, req.messages),
        ...(tools.length ? { tools } : {}),
      };
      const res = await f(join(base, '/chat/completions'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...auth() },
        body: JSON.stringify(body),
        signal: AbortSignal.any([opts.signal, AbortSignal.timeout(300_000)]),
      }).catch((e: unknown) => {
        if (opts.signal.aborted) throw e;
        throw unreachable(String(e));
      });
      cfg.observe?.({ status: res.status, headers: res.headers });
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => '');
        throw new JarvisError(
          res.status === 429
            ? 'LLM_OVERLOADED'
            : res.status === 401
              ? 'LLM_AUTH'
              : 'LLM_BAD_REQUEST',
          `${cloud ? 'cloud' : 'local'} ${res.status}: ${text}`,
          `${where()} refused the request (${res.status}): ${text.slice(0, 200)}`,
        );
      }

      const think = new ThinkFilter();
      let text = '';
      const calls = new Map<number, { id: string; name: string; args: string }>();
      let finish = 'stop';
      let usage = { input: 0, output: 0 };
      const decoder = new TextDecoder();
      let buffer = '';
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') continue;
          const ev = JSON.parse(data) as {
            choices?: Array<{
              delta?: {
                content?: string | null;
                tool_calls?: Array<{
                  index: number;
                  id?: string;
                  function?: { name?: string; arguments?: string };
                }>;
              };
              finish_reason?: string | null;
            }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };
          if (ev.usage)
            usage = { input: ev.usage.prompt_tokens ?? 0, output: ev.usage.completion_tokens ?? 0 };
          const choice = ev.choices?.[0];
          if (!choice) continue;
          if (choice.delta?.content) {
            const visible = think.push(choice.delta.content);
            if (visible) {
              text += visible;
              opts.onText?.(visible);
            }
          }
          for (const tc of choice.delta?.tool_calls ?? []) {
            const cur = calls.get(tc.index) ?? {
              id: tc.id ?? `call_${tc.index}`,
              name: '',
              args: '',
            };
            if (tc.id) cur.id = tc.id;
            if (tc.function?.name) cur.name += tc.function.name;
            if (tc.function?.arguments) cur.args += tc.function.arguments;
            calls.set(tc.index, cur);
          }
          if (choice.finish_reason) finish = choice.finish_reason;
        }
      }

      const toolUses = [...calls.values()].map((c) => {
        let input: unknown;
        try {
          input = c.args ? JSON.parse(c.args) : {};
        } catch {
          input = { _unparsed: c.args };
        }
        return {
          type: 'tool_use',
          id: c.id.startsWith('toolu_') ? c.id : `toolu_${c.id}`,
          name: c.name,
          input,
        };
      });
      return {
        // The usage ledger reads "local_" as free; a cloud call is billed.
        id: cloud
          ? `cloud_${cloud.tag ? `${cloud.tag()}_` : ''}${Date.now()}`
          : `local_${Date.now()}`,
        type: 'message',
        role: 'assistant',
        model,
        content: [...(text.trim() ? [{ type: 'text', text, citations: null }] : []), ...toolUses],
        stop_reason: toolUses.length ? 'tool_use' : finish === 'length' ? 'max_tokens' : 'end_turn',
        stop_sequence: null,
        usage: {
          input_tokens: usage.input,
          output_tokens: usage.output,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      } as unknown as LlmMessage;
    },
  };
}
