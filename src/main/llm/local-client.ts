import { JarvisError } from '../errors';
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
  fetch?: typeof fetch;
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

export function createLocalClient(
  cfg: LocalLlmConfig,
): LlmClient & { listModels(): Promise<string[]> } {
  const f = cfg.fetch ?? fetch;
  const unreachable = (detail: string): JarvisError =>
    new JarvisError(
      'LLM_NETWORK',
      detail,
      `Couldn't reach the local model at ${cfg.baseUrl()}. Is Ollama or LM Studio running?`,
    );

  async function listModels(): Promise<string[]> {
    const base = checkLocalUrl(cfg.baseUrl()).toString();
    const res = await f(join(base, '/models'), { signal: AbortSignal.timeout(8000) }).catch(
      (e: unknown) => {
        throw unreachable(String(e));
      },
    );
    if (!res.ok) throw unreachable(`HTTP ${res.status}`);
    const body = (await res.json()) as { data?: Array<{ id: string }> };
    return (body.data ?? []).map((m) => m.id);
  }

  return {
    listModels,
    async ping() {
      const model = cfg.model();
      if (!model)
        throw new JarvisError(
          'INVALID',
          'no local model',
          'Choose a local model in Settings → Models & budget.',
        );
      const models = await listModels();
      if (!models.includes(model))
        throw new JarvisError(
          'INVALID',
          'model missing',
          `The local server doesn't have "${model}". Available: ${models.join(', ') || 'none'}.`,
        );
    },

    async stream(req, opts) {
      if (req.tools?.some((t) => (t as { type?: string }).type?.startsWith('computer_')))
        throw new JarvisError(
          'LLM_BAD_REQUEST',
          'computer toolset on local model',
          'Computer control needs an Anthropic API key. Switch the connection in Settings → Models & budget.',
        );
      const model = cfg.model();
      if (!model)
        throw new JarvisError(
          'INVALID',
          'no local model',
          'Choose a local model in Settings → Models & budget.',
        );
      const base = checkLocalUrl(cfg.baseUrl()).toString();
      const tools = selectTools(toOpenAiTools(req.tools, cfg.catalog), req.messages);
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
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.any([opts.signal, AbortSignal.timeout(300_000)]),
      }).catch((e: unknown) => {
        if (opts.signal.aborted) throw e;
        throw unreachable(String(e));
      });
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => '');
        throw new JarvisError(
          'LLM_BAD_REQUEST',
          `local ${res.status}: ${text}`,
          `The local model refused the request (${res.status}): ${text.slice(0, 200)}`,
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
        id: `local_${Date.now()}`,
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
