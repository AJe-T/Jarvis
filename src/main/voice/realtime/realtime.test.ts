import { describe, expect, it } from 'vitest';
import type { Logger } from '../../logging/logger';
import type { StreamSocket } from '../tts/stream-tts';
import { createGeminiLive, geminiSchema } from './gemini';
import { createOpenAiRealtime } from './openai';
import { createUpsampler16to24 } from './resample';
import { startRealtimeSession, type RealtimeDeps } from './session';
import type { RealtimeCallbacks, RealtimeConnection, RealtimeProvider } from './types';

const quiet = {
  child: () => quiet,
  info: () => undefined,
  warn: () => undefined,
} as unknown as Logger;

class FakeSocket implements StreamSocket {
  binaryType = 'blob';
  readyState = 0;
  sent: Array<Record<string, unknown>> = [];
  private handlers = new Map<string, Array<(e: { data: unknown }) => void>>();
  constructor(
    readonly url: string,
    readonly headers: Record<string, string>,
  ) {
    setTimeout(() => {
      this.readyState = 1;
      this.emit('open');
    }, 0);
  }
  addEventListener(type: string, cb: (e: { data: unknown }) => void): void {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), cb]);
  }
  emit(type: string, data?: unknown): void {
    for (const h of this.handlers.get(type) ?? []) h({ data });
  }
  message(m: Record<string, unknown>): void {
    this.emit('message', JSON.stringify(m));
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit('close');
  }
}

function recorder(): RealtimeCallbacks & { log: Array<[string, unknown]> } {
  const log: Array<[string, unknown]> = [];
  return {
    log,
    onAudio: (pcm) => log.push(['audio', pcm.length]),
    onSpeechStarted: () => log.push(['speech', null]),
    onTranscript: (role, text) => log.push([role, text]),
    onToolCalls: (calls) => log.push(['tools', calls]),
    onReplyDone: (u) => log.push(['done', u]),
    onWarning: (m) => log.push(['warn', m]),
    onClose: (why) => log.push(['close', why]),
  };
}

const b64 = (bytes: number): string => Buffer.alloc(bytes).toString('base64');
const tools = [
  {
    name: 'set_volume',
    description: 'Set the volume.',
    parameters: {
      type: 'object',
      properties: { level: { type: 'number' } },
      required: ['level'],
      additionalProperties: false,
    },
  },
];

describe('16 kHz → 24 kHz for OpenAI Realtime', () => {
  it('makes 1.5 samples per input sample, seamlessly across frames', () => {
    const up = createUpsampler16to24();
    const total = [0, 1, 2, 3]
      .map(() => up(new Int16Array(512).fill(1000)).length)
      .reduce((a, b) => a + b);
    expect(total).toBe(3072);
    const ramp = up(Int16Array.from([1000, 1000, 1000, 1000]));
    expect([...ramp].every((v) => v === 1000)).toBe(true);
  });
});

describe('Gemini function schemas', () => {
  it('keeps the OpenAPI subset Gemini accepts and turns nullable unions into nullable', () => {
    expect(
      geminiSchema({
        $schema: 'x',
        type: 'object',
        additionalProperties: false,
        properties: { path: { type: ['string', 'null'], description: 'Where', default: 'x' } },
        required: ['path'],
      }),
    ).toEqual({
      type: 'object',
      properties: { path: { type: 'string', nullable: true, description: 'Where' } },
      required: ['path'],
    });
  });
});

describe('OpenAI Realtime adapter (voice fix 3)', () => {
  async function connect() {
    let sock: FakeSocket | null = null;
    const cb = recorder();
    const p = createOpenAiRealtime({
      key: () => 'sk-test',
      model: () => 'gpt-realtime-mini',
      voice: () => 'cedar',
      open: (url, headers) => (sock = new FakeSocket(url, headers)),
    });
    const conn = await p.connect(
      { instructions: 'Be brief.', tools, signal: new AbortController().signal },
      cb,
    );
    return { conn, cb, sock: sock as unknown as FakeSocket };
  }

  it('opens the GA session with 24 kHz PCM both ways, the voice and the tools; key in the header', async () => {
    const t = await connect();
    expect(t.sock.url).toBe('wss://api.openai.com/v1/realtime?model=gpt-realtime-mini');
    expect(t.sock.headers).toEqual({ authorization: 'Bearer sk-test' });
    const s = t.sock.sent[0]?.['session'] as Record<string, unknown>;
    expect(s).toMatchObject({
      type: 'realtime',
      instructions: 'Be brief.',
      audio: {
        input: { format: { type: 'audio/pcm', rate: 24000 } },
        output: { format: { type: 'audio/pcm', rate: 24000 }, voice: 'cedar' },
      },
      tools: [{ type: 'function', name: 'set_volume' }],
    });
  });

  it('sends the mic upsampled, plays deltas, and returns tool results then asks for the reply', async () => {
    const t = await connect();
    t.conn.sendAudio(new Int16Array(512));
    const append = t.sock.sent.find((m) => m['type'] === 'input_audio_buffer.append');
    expect(Buffer.from(String(append?.['audio']), 'base64').length).toBe(768 * 2);
    t.sock.message({ type: 'response.output_audio.delta', item_id: 'it_1', delta: b64(480) });
    t.sock.message({ type: 'input_audio_buffer.speech_started' });
    t.conn.truncate(1200);
    t.sock.message({
      type: 'response.done',
      response: {
        output: [
          { type: 'function_call', call_id: 'c1', name: 'set_volume', arguments: '{"level":30}' },
        ],
        usage: { input_tokens: 900, output_tokens: 300 },
      },
    });
    expect(t.cb.log).toEqual([
      ['audio', 480],
      ['speech', null],
      ['done', { input: 900, output: 300 }],
      ['tools', [{ id: 'c1', name: 'set_volume', args: { level: 30 } }]],
    ]);
    expect(t.sock.sent.find((m) => m['type'] === 'conversation.item.truncate')).toEqual({
      type: 'conversation.item.truncate',
      item_id: 'it_1',
      content_index: 0,
      audio_end_ms: 1200,
    });
    t.conn.sendToolResults([{ id: 'c1', name: 'set_volume', output: 'Volume set to 30%.' }]);
    expect(t.sock.sent.slice(-2)).toEqual([
      {
        type: 'conversation.item.create',
        item: { type: 'function_call_output', call_id: 'c1', output: 'Volume set to 30%.' },
      },
      { type: 'response.create' },
    ]);
  });
});

describe('Gemini Live adapter (voice fix 3)', () => {
  it('sets up, waits for setupComplete, streams 16 kHz audio and answers tool calls by id', async () => {
    let sock: FakeSocket | null = null;
    const cb = recorder();
    const p = createGeminiLive({
      key: () => 'AIza-test',
      model: () => 'gemini-3.8-live',
      voice: () => 'Charon',
      open: (url, headers) => (sock = new FakeSocket(url, headers)),
    });
    const pending = p.connect(
      { instructions: 'Be brief.', tools, signal: new AbortController().signal },
      cb,
    );
    await new Promise((r) => setTimeout(r, 5));
    const s = sock as unknown as FakeSocket;
    expect(s.url).toContain('BidiGenerateContent?key=AIza-test');
    expect(s.sent[0]).toMatchObject({
      setup: {
        model: 'models/gemini-3.8-live',
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Charon' } } },
        },
        systemInstruction: { parts: [{ text: 'Be brief.' }] },
        tools: [{ functionDeclarations: [{ name: 'set_volume' }] }],
      },
    });
    s.message({ setupComplete: {} });
    const conn = await pending;
    conn.sendAudio(new Int16Array(4));
    expect(s.sent.at(-1)).toEqual({
      realtimeInput: { audio: { data: b64(8), mimeType: 'audio/pcm;rate=16000' } },
    });
    s.message({ serverContent: { inputTranscription: { text: 'Volume ' } } });
    s.message({
      serverContent: {
        inputTranscription: { text: 'thirty' },
        modelTurn: { parts: [{ inlineData: { data: b64(96) } }] },
      },
    });
    s.message({
      toolCall: { functionCalls: [{ id: 'f1', name: 'set_volume', args: { level: 30 } }] },
    });
    s.message({
      serverContent: { outputTranscription: { text: 'Done, sir.' }, turnComplete: true },
      usageMetadata: { promptTokenCount: 50, responseTokenCount: 20 },
    });
    expect(cb.log).toEqual([
      ['audio', 96],
      ['tools', [{ id: 'f1', name: 'set_volume', args: { level: 30 } }]],
      ['user', 'Volume thirty'],
      ['assistant', 'Done, sir.'],
      ['done', { input: 50, output: 20 }],
    ]);
    conn.sendToolResults([{ id: 'f1', name: 'set_volume', output: 'ok' }]);
    expect(s.sent.at(-1)).toEqual({
      toolResponse: {
        functionResponses: [{ id: 'f1', name: 'set_volume', response: { output: 'ok' } }],
      },
    });
  });
});

/** A provider the test drives by hand. */
function fakeProvider() {
  let cb: RealtimeCallbacks | null = null;
  const sent: string[] = [];
  const conn: RealtimeConnection = {
    sendAudio: () => sent.push('audio'),
    sendToolResults: (r) => sent.push(`results:${r.map((x) => x.output).join('|')}`),
    addContext: (t) => sent.push(`context:${t.slice(-12)}`),
    truncate: (ms) => sent.push(`truncate:${Math.round(ms / 100)}`),
    close: () => sent.push('close'),
  };
  const provider: RealtimeProvider = {
    id: 'openai',
    model: 'gpt-realtime-mini',
    connect: async (_o, c) => {
      cb = c;
      return conn;
    },
  };
  return { provider, sent, cb: () => cb as RealtimeCallbacks };
}

function session(over: Partial<RealtimeDeps> = {}) {
  const f = fakeProvider();
  const events: Array<{ event: string; payload: unknown }> = [];
  const recorded: unknown[] = [];
  const spent: unknown[] = [];
  const states: string[] = [];
  let budgetLeft = true;
  const deps: RealtimeDeps = {
    provider: () => f.provider,
    instructions: async () => 'Be brief.',
    memoryFor: async (t) => (t.includes('Priya') ? 'Priya is your sister.' : ''),
    tools: () => tools,
    runTool: async (call) => `ran ${call.name}`,
    newConversation: () => 'c_1',
    record: async (...a) => void recorded.push(a),
    canSpend: () => {
      if (!budgetLeft) throw new Error('budget');
    },
    spend: (...a) => void spent.push(a),
    emit: (event, payload) => void events.push({ event, payload }),
    setState: (st) => void states.push(st),
    maxMinutes: () => 10,
    logger: quiet,
    ...over,
  };
  return { f, deps, events, recorded, spent, states, noBudget: () => (budgetLeft = false) };
}

describe('realtime session (voice fix 3)', () => {
  it('plays replies as PCM utterances, records spend, and runs tool calls through the executor', async () => {
    const t = session();
    const s = await startRealtimeSession(t.deps);
    s.write(new Int16Array(512));
    t.f.cb().onAudio(new Uint8Array(4800)); // 100 ms
    t.f.cb().onReplyDone({ input: 900, output: 300 });
    const audio = t.events
      .filter((e) => e.event === 'tts:audio')
      .map(
        (e) =>
          e.payload as { mime: string; sampleRate?: number; last?: boolean; utteranceId: string },
      );
    expect(audio[0]).toMatchObject({ mime: 'audio/pcm', sampleRate: 24000 });
    expect(audio[1]).toMatchObject({ last: true, utteranceId: audio[0]?.utteranceId });
    expect(s.owns(audio[0]?.utteranceId ?? '')).toBe(true);
    expect(t.spent).toEqual([['gpt-realtime-mini', { input: 900, output: 300 }, 'c_1']]);
    t.f.cb().onToolCalls([{ id: 'c1', name: 'set_volume', args: { level: 30 } }]);
    await new Promise((r) => setTimeout(r, 0));
    expect(t.f.sent).toContain('results:ran set_volume');
    s.end('test', true);
  });

  it('stops playback and truncates when Sir interrupts', async () => {
    const t = session();
    const s = await startRealtimeSession(t.deps);
    t.f.cb().onAudio(new Uint8Array(48_000)); // 1 s queued
    const id = (t.events[0]?.payload as { utteranceId: string }).utteranceId;
    s.playback(id, 'started');
    t.f.cb().onSpeechStarted();
    expect(t.events.some((e) => e.event === 'tts:stop')).toBe(true);
    expect(t.f.sent.some((x) => x.startsWith('truncate:'))).toBe(true);
    s.end('test', true);
  });

  it('adds memory notes for what Sir says, and "goodbye" ends it and saves the transcript', async () => {
    const t = session();
    const s = await startRealtimeSession(t.deps);
    t.f.cb().onTranscript('user', 'Remind me about Priya');
    await new Promise((r) => setTimeout(r, 0));
    expect(t.f.sent.some((x) => x.startsWith('context:'))).toBe(true);
    t.f.cb().onTranscript('assistant', 'Of course, sir.');
    t.f.cb().onTranscript('user', "That's all, goodbye");
    await s.ended;
    expect(t.recorded).toEqual([
      [
        'c_1',
        [
          { role: 'user', text: 'Remind me about Priya' },
          { role: 'assistant', text: 'Of course, sir.' },
          { role: 'user', text: "That's all, goodbye" },
        ],
        [],
      ],
    ]);
    expect(t.f.sent).toContain('close');
    expect(t.states.at(-1)).toBe('IDLE');
  });

  it('will not start over budget, and ends once a reply uses the budget up', async () => {
    const over = session();
    over.noBudget();
    await expect(startRealtimeSession(over.deps)).rejects.toThrow('budget');
    const t = session();
    const s = await startRealtimeSession(t.deps);
    t.noBudget();
    t.f.cb().onReplyDone({ input: 10, output: 10 });
    await s.ended;
    expect(t.events.some((e) => e.event === 'notify')).toBe(true);
  });

  it('ends by itself after 30 s of quiet', async () => {
    const timers: Array<{ fn: () => void; ms: number }> = [];
    const t = session({
      setTimer: (fn, ms) => (
        timers.push({ fn, ms }),
        timers.length as unknown as ReturnType<typeof setTimeout>
      ),
      clearTimer: () => undefined,
    });
    const s = await startRealtimeSession(t.deps);
    timers
      .filter((x) => x.ms === 30_000)
      .at(-1)
      ?.fn();
    await s.ended;
    expect(t.recorded).toHaveLength(1);
  });
});
