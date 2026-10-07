import { describe, expect, it } from 'vitest';
import type { FakeScript } from '@main/llm/fake-claude';
import type { Intent } from '@main/voice/conversation';
import {
  createFakeRecorder,
  createFakeStt,
  createFakeTts,
  createFakeWake,
} from '@main/voice/fakes';
import type { HeardSegment } from '@main/voice/local/continuous';
import { createVoiceSystem } from '@main/voice/voice-system';
import { idle, setupServices } from './helpers';

const until = async (cond: () => boolean, ms = 4000): Promise<void> => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
};

function setup(
  script: FakeScript,
  transcripts: string[],
  opts: {
    mode?: 'ptt' | 'wake' | 'ambient';
    judge?: (t: string) => Intent;
    followUp?: number;
  } = {},
) {
  const t = setupServices(script);
  const s = t.services;
  s.settings.set('voice.mode', opts.mode ?? 'wake');
  s.settings.set('voice.followUpSeconds', opts.followUp ?? 1);
  const wake = createFakeWake();
  const stt = createFakeStt(transcripts);
  let ambientHandlers: { onSegment(seg: HeardSegment): void } | null = null;
  const judged: string[] = [];
  const v = createVoiceSystem(s, {
    factories: {
      recorder: (_d, n) => createFakeRecorder(n),
      wake: () => wake,
      stt,
      edge: createFakeTts('edge'),
      sapi: createFakeTts('sapi'),
      ambient: async (h) => {
        ambientHandlers = h;
        return { write: () => undefined, reset: () => undefined, close: () => undefined };
      },
    },
    timeouts: { silenceMs: 300, maxListenMs: 3000, echoSettleMs: 10 },
    ...(opts.judge
      ? {
          judge: async (transcript: string) => {
            judged.push(transcript);
            return (opts.judge as (t: string) => Intent)(transcript);
          },
        }
      : {}),
  });
  const userTurns = (): Array<{ text: string; conversationId: string }> =>
    s.conversations.list(50).flatMap((c) =>
      s.conversations
        .messages(c.id)
        .filter((m) => m.role === 'user' && m.source === 'voice')
        .map((m) => ({ text: m.text_plain, conversationId: c.id, seq: m.created_at })),
    );
  const playAll = (): void => {
    for (const e of t.events.filter((x) => x.event === 'tts:audio')) {
      const a = e.payload as { utteranceId: string; last?: boolean };
      v.voice.onPlayback(a.utteranceId, a.last ? 'finished' : 'started');
    }
  };
  const segment = (text: string): void => {
    const now = Date.now();
    ambientHandlers?.onSegment({ text, start: now - 1500, end: now });
  };
  return { ...t, v, wake, stt, userTurns, playAll, segment, judged };
}

describe('conversational voice (ADR-012)', () => {
  it('voice turns continue the same conversation and a follow-up needs no wake word', async () => {
    const t = setup(
      {
        rules: [
          { match: 'weather', steps: [{ text: '<spoken>Sunny and 24 degrees, sir.</spoken>' }] },
          { match: 'tomorrow', steps: [{ text: '<spoken>Rain tomorrow, sir.</spoken>' }] },
        ],
      },
      ["what's the weather", 'and tomorrow'],
    );
    expect(await t.v.start()).toEqual({ ok: true });
    t.wake.trigger();
    await until(() => t.userTurns().length === 1);
    await idle(t.services);
    t.playAll(); // reply finished playing → follow-up window opens by itself
    await until(() => t.stt.sessions === 2);
    await until(() => t.userTurns().length === 2);
    await idle(t.services);
    const [first, second] = t.userTurns();
    expect(second?.conversationId).toBe(first?.conversationId);
    const listening = t.events.filter(
      (e) =>
        e.event === 'assistant:state' && (e.payload as { state: string }).state === 'LISTENING',
    );
    expect(listening.map((e) => (e.payload as { detail?: string }).detail)).toEqual([
      undefined,
      'follow-up',
    ]);
    t.v.voice.shutdown();
  });

  it('a wake word while Jarvis is thinking does not throw the reply away', async () => {
    const t = setup(
      {
        rules: [{ match: 'story', steps: [{ text: 'Once upon a time, sir.', chunkDelayMs: 150 }] }],
      },
      ['tell me a story'],
      { followUp: 0 },
    );
    await t.v.start();
    t.wake.trigger();
    await until(() => t.services.orchestrator.isBusy());
    t.wake.trigger(); // false trigger / cough: nothing is said
    await idle(t.services, 5000);
    const replies = t.services.conversations
      .list(5)
      .flatMap((c) => t.services.conversations.messages(c.id))
      .filter((m) => m.role === 'assistant');
    expect(replies.map((m) => m.text_plain)).toEqual(['Once upon a time, sir.']);
    t.v.voice.shutdown();
  });

  it("ignores Jarvis's own voice coming back and asks again on a mishearing", async () => {
    const t = setup(
      { rules: [{ match: 'hello', steps: [{ text: '<spoken>At your service, sir.</spoken>' }] }] },
      ['hello there', 'at your service sir', 'Yabbies!'],
    );
    await t.v.start();
    t.wake.trigger();
    await until(() => t.userTurns().length === 1);
    await idle(t.services);
    t.playAll(); // follow-up hears the echo: ignored
    await until(() => t.stt.sessions === 2);
    await new Promise((r) => setTimeout(r, 200));
    t.wake.trigger(); // a mishearing gets a polite retry, not a turn
    await until(() => t.stt.sessions >= 3);
    await new Promise((r) => setTimeout(r, 200));
    expect(t.userTurns().map((u) => u.text)).toEqual(['hello there']);
    const spoken = t.events.filter((e) => e.event === 'tts:audio').length;
    expect(spoken).toBeGreaterThan(1); // "Sorry, sir, I didn't catch that."
    t.v.voice.shutdown();
  });

  it('always-listening: "Jarvis" anywhere asks the judge with the recent conversation', async () => {
    const t = setup(
      {
        rules: [
          { match: 'picnic', steps: [{ text: '<spoken>A picnic sounds lovely, sir.</spoken>' }] },
        ],
      },
      [],
      {
        mode: 'ambient',
        judge: (transcript) =>
          /jarvis/i.test(transcript.split('\n').at(-1) ?? '')
            ? { directed: true, query: 'What do you think about a picnic tomorrow?' }
            : { directed: false, query: '' },
      },
    );
    expect(await t.v.start()).toEqual({ ok: true });
    t.segment('We could have a picnic tomorrow.');
    t.segment('Depends on the weather, should we stay in?');
    expect(t.judged).toEqual([]); // ambient chatter is never sent anywhere
    t.segment('Jarvis, what do you think?');
    await until(() => t.userTurns().length === 1);
    await idle(t.services);
    expect(t.judged[0]).toMatch(
      /picnic tomorrow[\s\S]*Depends on the weather[\s\S]*Jarvis, what do you think/,
    );
    expect(t.userTurns()[0]?.text).toBe('What do you think about a picnic tomorrow?');
    t.v.voice.shutdown();
  });

  it('always-listening needs on-device Whisper', async () => {
    const t = setupServices();
    t.services.settings.set('voice.mode', 'ambient');
    const v = createVoiceSystem(t.services, {
      factories: {
        recorder: (_d, n) => createFakeRecorder(n),
        wake: () => createFakeWake(),
        stt: createFakeStt([]),
        edge: createFakeTts('edge'),
        sapi: createFakeTts('sapi'),
      },
    });
    expect((await v.start()).ok).toBe(false);
  });
});

describe('dictation (ideas from isair/jarvis)', () => {
  it('hotkey → speech → pause → cleaned text pasted into the app in front, kept in history', async () => {
    const t = setupServices();
    const s = t.services;
    s.settings.set('voice.mode', 'off'); // dictation works in every voice mode
    s.settings.set('dictation.dictionary', 'jarvis => JARVIS');
    const v = createVoiceSystem(s, {
      factories: {
        recorder: (_d, n) => createFakeRecorder(n),
        wake: () => createFakeWake(),
        stt: createFakeStt(['um send the report to jarvis today']),
        edge: createFakeTts('edge'),
        sapi: createFakeTts('sapi'),
      },
      timeouts: { silenceMs: 2000, dictationQuietMs: 50 },
    });
    v.voice.dictate();
    const os = s.os as unknown as { calls: Array<{ op: string; args: unknown[] }> };
    await until(() => os.calls.some((c) => c.op === 'pasteText'));
    expect(os.calls.find((c) => c.op === 'pasteText')?.args).toEqual([
      'Send the report to JARVIS today',
    ]);
    await until(() => v.dictations.list().length === 1);
    expect(v.dictations.list()[0]).toMatchObject({
      raw_text: 'um send the report to jarvis today',
      final_text: 'Send the report to JARVIS today',
      target_app: 'notepad',
    });
    expect(s.conversations.list(5)).toHaveLength(0); // dictation never becomes a chat turn
    v.voice.shutdown();
  });

  it('ignores the wake word while Jarvis is talking (his own voice), unless barge-in is on', async () => {
    const t = setup(
      { rules: [{ match: 'story', steps: [{ text: '<spoken>Once upon a time, sir.</spoken>' }] }] },
      ['tell me a story', 'stop'],
      { followUp: 0 },
    );
    await t.v.start();
    t.wake.trigger();
    await until(() => t.userTurns().length === 1);
    await idle(t.services);
    const audio = t.events.find((e) => e.event === 'tts:audio')?.payload as { utteranceId: string };
    t.v.voice.onPlayback(audio.utteranceId, 'started');
    expect(t.services.state.get()).toBe('SPEAKING');
    t.wake.trigger();
    await new Promise((r) => setTimeout(r, 150));
    expect(t.stt.sessions).toBe(1); // not cut off by hearing himself
    t.services.settings.set('voice.bargeIn', true);
    t.wake.trigger();
    await until(() => t.stt.sessions === 2);
    t.v.voice.shutdown();
  });

  it('push-to-talk replies open the follow-up window too, so it is a conversation', async () => {
    const t = setup(
      {
        rules: [
          { match: 'weather', steps: [{ text: '<spoken>Sunny, sir. Anything else?</spoken>' }] },
          { match: 'tomorrow', steps: [{ text: '<spoken>Rain tomorrow, sir.</spoken>' }] },
        ],
      },
      ["what's the weather", 'and tomorrow'],
      { mode: 'ptt' },
    );
    await t.v.start();
    t.v.voice.ptt();
    await until(() => t.userTurns().length === 1);
    await idle(t.services);
    t.playAll();
    await until(() => t.userTurns().length === 2);
    t.v.voice.shutdown();
  });
});
