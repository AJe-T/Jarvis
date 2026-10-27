import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createSubagentTool } from '@main/agent/subagents';
import type { TurnContext } from '@main/agent/agent-loop';
import { createModelStore } from '@main/voice/local/model-store';
import type { LocalEngines } from '@main/voice/local/local-engines';
import type { Transcriber } from '@main/voice/local/whisper';
import { realFactories } from '@main/voice/voice-system';
import { POOL_TOOLS } from '@shared/free-pool';
import { idle } from './helpers';
import { CEREBRAS, GROQ, setup, sse } from './pool-fakes';

/** AI Router Phase 3: free search, pictures, fusion and the voice backup chain, all on fake servers. */

type T = ReturnType<typeof setup>;

const TAVILY = 'https://api.tavily.com/search';
const ACCOUNT = '0123456789abcdef0123456789abcdef';
const CF_IMAGE = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/@cf/black-forest-labs/flux-1-schnell`;
const GROQ_STT = 'https://api.groq.com/openai/v1/audio/transcriptions';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

/** One fake internet for every test: search, Cloudflare images, Pollinations, chat, speech. */
function reply(url: string): Response {
  if (url === TAVILY)
    return json({
      results: [{ title: 'Tea', url: 'https://tea.example', content: 'From China.' }],
    });
  if (url === CF_IMAGE) return json({ success: true, result: { image: JPEG.toString('base64') } });
  if (url.startsWith('https://image.pollinations.ai/'))
    return new Response(JPEG, { headers: { 'content-type': 'image/jpeg' } });
  if (url === GROQ_STT) return json({ text: 'hello from groq' });
  return sse('A draft.');
}

const turn = (conversationId: string): TurnContext => ({
  turnId: `t_${conversationId}`,
  conversationId,
  mode: 'text',
  purpose: 'chat',
  signal: new AbortController().signal,
  taint: { tainted: false },
});

/** A real conversation row: tool calls are stored against it. */
const conv = (t: T): string => t.services.conversations.create('text').id;

async function run(t: T, name: string, input: unknown, conversationId = conv(t)) {
  const r = await t.services.tools.execute(
    { type: 'tool_use', id: `toolu_${name}_${Math.random()}`, name, input } as never,
    turn(conversationId),
  );
  const text =
    typeof r.content === 'string'
      ? r.content
      : (r.content ?? []).map((b) => ('text' in b ? b.text : '')).join('');
  return { error: Boolean(r.is_error), text };
}

/** This conversation read Sir's reminders: private from now on (Security.md §16.15). */
async function makePrivate(t: T, conversationId: string): Promise<void> {
  await t.services.tools.execute(
    {
      type: 'tool_use',
      id: `toolu_r_${conversationId}`,
      name: 'list_reminders',
      input: {},
    } as never,
    turn(conversationId),
  );
}

const toolNames = (t: T, conversationId: string): string[] =>
  t.services.registry.definitions(turn(conversationId)).map((d) => (d as { name: string }).name);

describe('free web search', () => {
  it('Claude sees the free search while a key works, the paid one once none can take it', () => {
    const t = setup(reply);
    const c1 = conv(t);
    expect(toolNames(t, c1)).toContain('web_search');
    expect(toolNames(t, c1)).not.toContain('free_web_search');
    t.services.secrets.set('search_tavily', 'tvly-test-0000');
    expect(toolNames(t, c1)).toContain('free_web_search');
    expect(toolNames(t, c1)).not.toContain('web_search');
    t.services.settings.set('pool.abilities.search', false);
    expect(toolNames(t, c1)).toContain('web_search');
    // The free pool's own sub-agent may search too: queries pass the same gate.
    expect(POOL_TOOLS.has('free_web_search')).toBe(true);
  });

  it('searches Tavily and hands back untrusted, labelled results', async () => {
    const t = setup(reply);
    t.services.secrets.set('search_tavily', 'tvly-test-0000');
    const r = await run(t, 'free_web_search', { query: 'history of tea' });
    expect(r.error).toBe(false);
    expect(t.calls).toEqual([TAVILY]);
    expect(r.text).toContain('<untrusted_content source="free web search (Tavily)"');
    expect(r.text).toContain('Searched with Tavily (free)');
    expect(r.text).toContain('https://tea.example');
  });

  it('a private conversation never reaches free search; Claude gets his own search instead', async () => {
    const t = setup(reply);
    t.services.secrets.set('search_tavily', 'tvly-test-0000');
    const priv = conv(t);
    await makePrivate(t, priv);
    expect(toolNames(t, priv)).toContain('web_search');
    expect(toolNames(t, priv)).not.toContain('free_web_search');
    const r = await run(t, 'free_web_search', { query: 'history of tea' }, priv);
    expect(r.error).toBe(true);
    expect(r.text).toMatch(/never gets Sir's private data.*Use web_search instead/);
    // A key in the query itself is refused too.
    const k = await run(t, 'free_web_search', { query: 'what is gsk_test_groq_key_0000' });
    expect(k.error).toBe(true);
    expect(t.calls).not.toContain(TAVILY);
  });
});

describe('image generation', () => {
  function withCloudflare(t: T): void {
    t.services.secrets.set('cloudflare', 'cf-test-token-0000');
    t.services.settings.set('llm.cloud.cloudflareAccount', ACCOUNT);
  }

  it('draws with Cloudflare, saves the picture and a note of who made it to the vault', async () => {
    const t = setup(reply);
    withCloudflare(t);
    const r = await run(t, 'generate_image', { prompt: 'a logo for a bakery' });
    expect(r.error).toBe(false);
    expect(t.calls).toEqual([CF_IMAGE]);
    expect(t.bodies.at(-1)).toMatchObject({ prompt: 'a logo for a bakery', steps: 4 });
    const m = /Images\/([\w-]+)\.jpg/.exec(r.text);
    expect(r.text).toContain('Made by Cloudflare Workers AI · FLUX.1 [schnell]');
    const dir = join(t.services.settings.get('vault.path'), 'Images');
    expect(readFileSync(join(dir, `${m?.[1]}.jpg`))).toEqual(JPEG);
    expect(readFileSync(join(dir, `${m?.[1]}.md`), 'utf8')).toContain(
      'Made by Cloudflare Workers AI · FLUX.1 [schnell].',
    );
  });

  it('never sends a prompt from a private conversation, or one holding a key', async () => {
    const t = setup(reply);
    withCloudflare(t);
    const priv = conv(t);
    await makePrivate(t, priv);
    expect((await run(t, 'generate_image', { prompt: 'a cat' }, priv)).error).toBe(true);
    expect(
      (await run(t, 'generate_image', { prompt: 'a sign saying gsk_test_groq_key_0000' })).error,
    ).toBe(true);
    expect(t.calls).toHaveLength(0);
    expect(existsSync(join(t.services.settings.get('vault.path'), 'Images'))).toBe(false);
  });

  it('a wide picture needs Pollinations (tier 3): asks first, and "no" sends nothing', async () => {
    const t = setup(reply);
    const s = t.services;
    const answer = async (a: 'no' | 'once') => {
      const p = run(t, 'generate_image', { prompt: 'a mountain at dawn', size: 'wide' });
      await vi.waitFor(() => expect(t.events.some((e) => e.event === 'pool:ask')).toBe(true));
      const q = t.events.filter((e) => e.event === 'pool:ask').at(-1)?.payload as {
        requestId: string;
      };
      s.answerTier3(q.requestId, a);
      return p;
    };
    expect((await answer('no')).error).toBe(true);
    expect(t.calls).toHaveLength(0);
    t.events.length = 0;
    const r = await answer('once');
    expect(r.text).toContain('Made by Pollinations, a third-party AI · Flux');
    expect(t.calls[0]).toMatch(
      /^https:\/\/image\.pollinations\.ai\/prompt\/a%20mountain%20at%20dawn\?width=1024&height=576/,
    );
  });
});

describe('fusion brain', () => {
  const fusing = {
    rules: [
      {
        match: 'compare teas',
        steps: [
          {
            tools: [
              {
                name: 'delegate_task',
                input: {
                  tasks: [
                    {
                      title: 'Teas',
                      instructions: 'Compare green and black tea.',
                      brain: 'fusion',
                    },
                  ],
                },
              },
            ],
          },
          { text: 'Done, sir.' },
        ],
      },
    ],
  };
  const report = (t: T): string => JSON.stringify(t.llm.calls.map((c) => c.messages));

  it('two providers draft, a judge writes the answer, and the trail lists every model', async () => {
    const t = setup(reply, fusing);
    expect(t.services.brains.available()).toContain('fusion');
    t.services.registry.register(createSubagentTool(t.services));
    t.services.orchestrator.send({ text: 'compare teas please', source: 'text' });
    await idle(t.services, 10_000);
    // Two drafts at once (any order), then the judge.
    expect([...t.calls.slice(0, 2)].sort()).toEqual([CEREBRAS, GROQ].sort());
    expect(t.calls).toHaveLength(3);
    const judge = t.bodies[2] as { messages: Array<{ role: string; content: string }> };
    expect(judge.messages[0]?.content).toMatch(/^You are the judge/);
    expect(judge.messages[1]?.content).toContain('Draft 2:\nA draft.');
    // No tools for drafters or the judge.
    expect(t.bodies.every((b) => !b.tools?.length)).toBe(true);
    expect(report(t)).toMatch(
      /\(Fusion: drafts by (Groq|Cerebras) · [\w.-]+, (Groq|Cerebras) · [\w.-]+; judged by Groq · llama-3.3-70b-versatile\.\)/,
    );
  });

  it('never runs on a private conversation', async () => {
    const t = setup(reply, fusing);
    t.services.registry.register(createSubagentTool(t.services));
    const sent = t.services.orchestrator.send({ text: 'hello', source: 'text' });
    await idle(t.services, 10_000);
    await makePrivate(t, sent.conversationId);
    t.calls.length = 0;
    t.services.orchestrator.send({
      conversationId: sent.conversationId,
      text: 'compare teas please',
      source: 'text',
    });
    await idle(t.services, 10_000);
    expect(t.calls).toHaveLength(0);
    expect(report(t)).toContain("Free AIs never get Sir's private data");
  });

  it('is not offered with fewer than two free providers, or when switched off', () => {
    const t = setup(reply);
    t.services.settings.set('pool.abilities.fusion', false);
    expect(t.services.brains.ready('fusion')).toBe(false);
    t.services.settings.set('pool.abilities.fusion', true);
    t.services.settings.set('pool.providers', { cerebras: { enabled: false } });
    expect(t.services.brains.ready('fusion')).toBe(false);
  });
});

describe('voice backup chain: hearing', () => {
  function fakeLocal() {
    let chain: Transcriber | null = null;
    const local = {
      ready: () => true,
      vadReady: () => true,
      transcribe: vi.fn(async () => Promise.reject(new Error('Whisper crashed'))),
      stt: { id: 'whisper', start: vi.fn(async () => ({}) as never) },
      phraseStt: (_id: string, t: Transcriber) => ({
        id: 'whisper',
        start: async () => {
          chain = t;
          return {} as never;
        },
      }),
    };
    return { local: local as unknown as LocalEngines, raw: local, chain: () => chain };
  }

  it('off (the default): Sir’s voice never leaves this PC, even when Whisper fails', async () => {
    const t = setup(reply);
    t.services.settings.set('voice.stt.provider', 'whisper');
    const { local, raw, chain } = fakeLocal();
    const store = createModelStore({ root: join(t.dir, 'models'), onProgress: () => undefined });
    const f = realFactories(t.services, local, store);
    await f.stt.start({
      sampleRate: 16000,
      language: 'en-IN',
      signal: new AbortController().signal,
    });
    expect(raw.stt.start).toHaveBeenCalled();
    expect(chain()).toBeNull();
    expect(t.calls).toHaveLength(0);
  });

  it('on: a failed phrase goes to Groq, and Sir is told the engine changed', async () => {
    const t = setup(reply);
    const s = t.services;
    s.settings.set('voice.stt.provider', 'whisper');
    s.settings.set('pool.abilities.voiceHearing', true);
    const { local, chain } = fakeLocal();
    const store = createModelStore({ root: join(t.dir, 'models'), onProgress: () => undefined });
    const f = realFactories(s, local, store);
    await f.stt.start({
      sampleRate: 16000,
      language: 'en-IN',
      signal: new AbortController().signal,
    });
    expect(await chain()?.transcribe(new Float32Array(1600), 'en-IN')).toBe('hello from groq');
    expect(t.calls).toEqual([GROQ_STT]);
    expect(s.voiceEngines.hearing).toBe('Groq Whisper');
    const notes = t.events
      .filter((e) => e.event === 'notify')
      .map((e) => (e.payload as { message: string }).message);
    expect(notes).toContain('Hearing with Groq Whisper now (Whisper on this PC: Whisper crashed).');
  });
});
