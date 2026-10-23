import { join } from 'node:path';
import { createLocalEngines } from '@main/voice/local/local-engines';
import { createModelStore } from '@main/voice/local/model-store';
import { describe, expect, it } from 'vitest';
import type { FakeScript } from '@main/llm/fake-claude';
import {
  createFakeRecorder,
  createFakeStt,
  createFakeTts,
  createFakeWake,
} from '@main/voice/fakes';
import { createVoiceSystem, realFactories } from '@main/voice/voice-system';
import { WAKE_LINES, WORKING_LINES } from '@main/voice/greetings';
import { idle, setupServices } from './helpers';

function setupVoice(
  script: FakeScript | ((dir: string) => FakeScript),
  transcripts: string[],
  opts: {
    edgeFails?: boolean;
    mode?: 'ptt' | 'wake';
    sttStartMs?: number;
    greet?: boolean;
    echoCancelled?: boolean;
  } = {},
) {
  const t = setupServices(script);
  t.services.settings.set('voice.mode', opts.mode ?? 'ptt');
  // Instant greetings have their own tests; the rest check what follows them.
  t.services.settings.set('voice.greet', opts.greet ?? false);
  // The fake engine stands in for a keyword engine (the default 'name' engine is Whisper-based).
  t.services.settings.set('voice.wake.provider', 'openwakeword');
  const wake = createFakeWake();
  const stt = createFakeStt(transcripts, { startDelayMs: opts.sttStartMs ?? 0 });
  const edge = createFakeTts('edge', { fail: opts.edgeFails ?? false });
  const sapi = createFakeTts('sapi');
  const v = createVoiceSystem(t.services, {
    factories: {
      recorder: (_d, n) => createFakeRecorder(n),
      wake: () => wake,
      stt,
      edge,
      sapi,
      ...(opts.echoCancelled ? { echoCancelled: () => true } : {}),
    },
    timeouts: { silenceMs: 300, maxListenMs: 3000 },
  });
  const states = (): string[] =>
    t.events
      .filter((e) => e.event === 'assistant:state')
      .map((e) => (e.payload as { state: string }).state);
  const audio = (): Array<{ utteranceId: string; last?: boolean }> =>
    t.events
      .filter((e) => e.event === 'tts:audio')
      .map((e) => e.payload as { utteranceId: string; last?: boolean });
  /** Plays every utterance as the renderer would: "started" on first chunk, "finished" at the marker. */
  const play = (): void => {
    for (const a of audio()) {
      t.services.state.get();
      v.voice.onPlayback(a.utteranceId, a.last ? 'finished' : 'started');
    }
  };
  return { ...t, v, wake, stt, edge, sapi, states, audio, play };
}

const until = async (cond: () => boolean, ms = 3000): Promise<void> => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe('phase 4 voice (Testing.md §8, fixture-based)', () => {
  it('press-to-talk → transcript → voice turn → only the <spoken> block is synthesised', async () => {
    const t = setupVoice(
      {
        rules: [
          {
            match: 'time',
            steps: [
              { text: "<spoken>It's half past nine, sir.</spoken>\n\n| Zone | Time |\n|---|---|" },
            ],
          },
        ],
      },
      ['what time is it in Tokyo'],
    );
    await t.v.start();
    t.v.voice.ptt();
    await until(() => t.stt.sessions === 1);
    await until(() => t.services.conversations.list(5).length === 1);
    await idle(t.services);
    await until(() => t.audio().some((a) => a.last));
    expect(t.edge.spoken).toEqual(["It's half past nine, sir."]);
    expect(t.states()).toEqual(expect.arrayContaining(['LISTENING', 'THINKING']));
    const transcripts = t.events
      .filter((e) => e.event === 'voice:transcript')
      .map((e) => e.payload as { text: string; isFinal: boolean });
    expect(transcripts.at(-1)).toEqual({ text: 'what time is it in Tokyo', isFinal: true });
    const userMsg = t.events.find(
      (e) =>
        e.event === 'chat:message' &&
        (e.payload as { message: { role: string } }).message.role === 'user',
    );
    expect(userMsg).toBeDefined();
    t.play();
    expect(t.services.state.get()).toBe('IDLE');
    expect(t.states()).toContain('SPEAKING');
  });

  it('wake word starts listening; levels are emitted while the mic runs', async () => {
    const t = setupVoice({ rules: [] }, ['hello'], { mode: 'wake' });
    t.services.secrets.set('picovoice', 'pv-test-key-123');
    expect(await t.v.start()).toEqual({ ok: true });
    t.wake.trigger();
    await until(() => t.stt.sessions === 1);
    await until(() => t.events.some((e) => e.event === 'voice:level'));
    t.v.voice.shutdown();
  });

  it('woken, Jarvis answers at once from lines rendered ahead (no model call, no synthesis), then listens', async () => {
    const t = setupVoice({ rules: [] }, ['hello'], { mode: 'wake', greet: true });
    await t.v.start();
    await until(() => t.edge.spoken.length === WAKE_LINES.length + WORKING_LINES.length);
    t.wake.trigger();
    await until(() => t.audio().some((a) => a.last));
    expect(t.edge.spoken).toHaveLength(WAKE_LINES.length + WORKING_LINES.length); // from the cache
    // Not listening yet: without echo cancellation the microphone would hear the greeting.
    expect(t.stt.sessions).toBe(0);
    t.play();
    await until(() => t.stt.sessions === 1);
    t.v.voice.shutdown();
  });

  it('saying the wake word again while Jarvis greets does not start over (regression)', async () => {
    const t = setupVoice({ rules: [] }, ['hello'], { mode: 'wake', greet: true });
    await t.v.start();
    t.wake.trigger();
    await until(() => t.audio().some((a) => a.last));
    t.wake.trigger();
    t.wake.trigger();
    await new Promise((r) => setTimeout(r, 200));
    expect(new Set(t.audio().map((a) => a.utteranceId)).size).toBe(1);
    expect(t.events.some((e) => e.event === 'tts:stop')).toBe(false);
    t.play();
    await until(() => t.stt.sessions === 1);
    t.v.voice.shutdown();
  });

  it('with an echo-cancelled mic it listens while greeting; the greeting leaking through is not a request', async () => {
    const t = setupVoice(
      { rules: [{ match: 'hello', steps: [{ text: 'Hi, sir.' }] }] },
      [
        '', // what leaked past the echo canceller: speech with no words
        'hello there',
      ],
      { mode: 'wake', greet: true, echoCancelled: true },
    );
    await t.v.start();
    t.wake.trigger();
    await until(() => t.stt.sessions === 1); // at once, before the greeting is played
    expect(t.audio().length).toBeGreaterThan(0);
    await until(() => t.stt.sessions === 2); // the empty phrase reopened listening
    await until(() => t.services.conversations.list(5).length === 1);
    await idle(t.services);
    const said = t.services.conversations
      .list(5)
      .flatMap((c) => t.services.conversations.messages(c.id))
      .filter((m) => m.role === 'user')
      .map((m) => m.text_plain);
    expect(said).toEqual(['hello there']);
    t.v.voice.shutdown();
  });

  it('says a stock "working on it" line, and the reply plays after it instead of cutting it off', async () => {
    const t = setupVoice(
      { rules: [{ match: 'weather', steps: [{ text: '<spoken>Sunny, sir.</spoken>' }] }] },
      ['what is the weather'],
      { greet: true },
    );
    await t.v.start();
    t.v.voice.ptt();
    await until(() => t.services.conversations.list(5).length === 1);
    await idle(t.services);
    await until(() => t.edge.spoken.includes('Sunny, sir.'));
    const working = t.audio()[0]?.utteranceId;
    expect(t.audio().some((a) => a.utteranceId !== working)).toBe(true); // the reply is its own utterance
    expect(t.events.some((e) => e.event === 'tts:stop')).toBe(false);
  });

  it('greets on start with the plan for today, then opens the mic for the answer', async () => {
    const t = setupVoice({ rules: [] }, [], { mode: 'wake' });
    t.services.settings.set('voice.followUpSeconds', 1);
    await t.v.start();
    t.v.voice.welcome('Good morning, sir. Your day is clear. What shall we do?');
    await until(() => t.audio().some((a) => a.last));
    t.play();
    await until(() => t.stt.sessions === 1);
    const listening = t.events.filter(
      (e) =>
        e.event === 'assistant:state' && (e.payload as { state: string }).state === 'LISTENING',
    );
    expect((listening.at(-1)?.payload as { detail?: string }).detail).toBe('follow-up');
    t.v.voice.shutdown();
  });

  it('wake word survives the mode being re-applied while the mic is running (regression)', async () => {
    const t = setupVoice({ rules: [] }, ['hello'], { mode: 'wake' });
    t.services.secrets.set('picovoice', 'pv-test-key-123');
    // voice:setMode applies the mode, and so does the settings listener: two applyMode calls back to back.
    await Promise.all([t.v.voice.applyMode(), t.v.voice.applyMode()]);
    await new Promise((r) => setTimeout(r, 150));
    await t.v.voice.applyMode(); // e.g. a model finished downloading
    await new Promise((r) => setTimeout(r, 150));
    t.wake.trigger();
    await until(() => t.stt.sessions === 1);
    const notices = t.events
      .filter((e) => e.event === 'notify')
      .map((e) => JSON.stringify(e.payload));
    expect(notices.filter((n) => n.includes('microphone'))).toEqual([]);
    t.v.voice.shutdown();
  });

  it('keeps the words spoken while speech-to-text is still starting', async () => {
    const t = setupVoice({ rules: [] }, ['what time is it'], { mode: 'wake', sttStartMs: 200 });
    t.services.secrets.set('picovoice', 'pv-test-key-123');
    await t.v.start();
    t.wake.trigger();
    await until(() => t.stt.sessions === 1);
    await until(() => t.stt.written > 0);
    // ~200 ms of audio (≈ 6 frames of 32 ms) captured before the session existed reached it.
    expect(t.stt.written).toBeGreaterThanOrEqual(4);
    t.v.voice.shutdown();
  });

  it('barge-in: PTT while speaking stops audio immediately and listens', async () => {
    const t = setupVoice(
      {
        rules: [
          {
            match: 'story',
            steps: [
              { text: '<spoken>Once upon a time there was a very long story, sir.</spoken>' },
            ],
          },
        ],
      },
      ['tell me a story', 'stop'],
    );
    await t.v.start();
    t.v.voice.ptt();
    await until(() => t.audio().length > 0);
    t.v.voice.onPlayback(t.audio()[0]?.utteranceId ?? '', 'started');
    expect(t.services.state.get()).toBe('SPEAKING');
    t.v.voice.ptt();
    expect(t.events.some((e) => e.event === 'tts:stop')).toBe(true);
    expect(t.services.state.get()).toBe('LISTENING');
    await until(() => t.stt.sessions === 2);
    await idle(t.services);
  });

  it('falls back to the Windows voice when Edge TTS fails, warning once', async () => {
    const t = setupVoice(
      {
        rules: [
          {
            match: 'hi',
            steps: [{ text: '<spoken>Good evening, sir. All systems ready.</spoken>' }],
          },
        ],
      },
      ['hi there'],
      { edgeFails: true },
    );
    await t.v.start();
    t.v.voice.ptt();
    await until(() => t.audio().some((a) => a.last));
    expect(t.sapi.spoken.join(' ')).toContain('Good evening, sir.');
    expect(
      t.events.filter(
        (e) =>
          e.event === 'notify' && /backup voice/.test((e.payload as { message: string }).message),
      ),
    ).toHaveLength(1);
  });

  it('asks again when nothing intelligible was heard, then gives up', async () => {
    const t = setupVoice({ rules: [] }, ['', '']);
    await t.v.start();
    t.v.voice.ptt();
    await until(() => t.sapi.spoken.length + t.edge.spoken.length > 0);
    expect(t.edge.spoken[0]).toBe("Sorry, sir, I didn't catch that.");
    const first = t.audio().find((a) => a.last);
    t.v.voice.onPlayback(first?.utteranceId ?? '', 'finished');
    await until(() => t.stt.sessions === 2);
    expect(t.services.conversations.list(5)).toHaveLength(0);
  });

  it('times out after silence and returns to IDLE', async () => {
    const t = setupVoice({ rules: [] }, []);
    await t.v.start();
    t.v.voice.ptt();
    expect(t.services.state.get()).toBe('LISTENING');
    await until(() => t.services.state.get() === 'IDLE', 2000);
  });

  it('"stop everything" fires the kill switch', async () => {
    const t = setupVoice({ rules: [] }, ['Jarvis, stop everything']);
    await t.v.start();
    t.v.voice.ptt();
    await until(() =>
      t.events.some(
        (e) =>
          e.event === 'notify' &&
          (e.payload as { message: string }).message === 'All activity stopped.',
      ),
    );
  });

  it('spoken confirmation: "yes" approves a non-destructive action', async () => {
    const t = setupVoice(
      (dir) => ({
        rules: [
          {
            match: 'invoices',
            steps: [
              {
                tools: [
                  { name: 'create_folder', input: { path: `${dir}\\home\\Documents\\Invoices` } },
                ],
              },
              { text: '<spoken>Done, sir.</spoken>' },
            ],
          },
        ],
      }),
      ['create a folder called invoices', 'yes go ahead'],
    );
    await t.v.start();
    t.v.voice.ptt();
    await until(() => t.edge.spoken.some((s) => s.startsWith('Shall I create folder Invoices')));
    const prompt = t.audio().find((a) => a.last);
    t.v.voice.onPlayback(prompt?.utteranceId ?? '', 'finished');
    await until(() => t.services.toolCalls.list(5).some((c) => c.decision === 'approved'));
    await idle(t.services);
    expect(t.services.toolCalls.list(5)[0]).toMatchObject({
      decided_by: 'user_voice',
      status: 'success',
    });
  });

  it('spoken confirmation: destructive actions must be confirmed on screen', async () => {
    const t = setupVoice(
      {
        rules: [
          {
            match: 'shut',
            steps: [{ tools: [{ name: 'shutdown_pc', input: {} }] }, { text: 'ok' }],
          },
        ],
      },
      ['shut down the pc'],
    );
    await t.v.start();
    t.v.voice.ptt();
    await until(() => t.edge.spoken.some((s) => s.includes('Please confirm on screen')));
    const pending = t.services.broker.current();
    expect(pending?.destructive).toBe(true);
    expect(t.services.broker.respond(pending?.id ?? '', 'approve', 'voice')).toBe(false);
    t.services.killSwitch.trigger('ui');
    await idle(t.services);
  });
});

describe('voice engine selection (ADR-011)', () => {
  it('explains what is missing for each engine instead of failing silently', async () => {
    const t = setupServices();
    const s = t.services;
    const store = createModelStore({ root: join(t.dir, 'models'), onProgress: () => undefined });
    const f = realFactories(s, createLocalEngines(store, s.settings), store);
    const signal = new AbortController().signal;
    const start = () => f.stt.start({ sampleRate: 16000, language: 'en-IN', signal });

    // ADR-044: the default engine is the instant wake word, which needs its model.
    await expect(f.wake(0.6)).rejects.toMatchObject({ userMessage: /instant wake-word model/ });
    s.settings.set('voice.wake.provider', 'picovoice');
    let err: unknown;
    try {
      void f.wake(0.6);
    } catch (e) {
      err = e;
    }
    expect((err as { userMessage?: string }).userMessage).toMatch(
      /Picovoice AccessKey, or choose the on-device "Hey Jarvis"/,
    );
    await expect(start()).rejects.toMatchObject({ userMessage: /Deepgram key/ });

    s.settings.set('voice.wake.provider', 'openwakeword');
    s.settings.set('voice.stt.provider', 'whisper');
    await expect(f.wake(0.6)).rejects.toMatchObject({ userMessage: /Download the "Hey Jarvis"/ });
    await expect(start()).rejects.toMatchObject({ userMessage: /Download the Whisper model/ });
  });
});
