import { describe, expect, it } from 'vitest';
import type { FakeScript } from '@main/llm/fake-claude';
import {
  createFakeRecorder,
  createFakeStt,
  createFakeTts,
  createFakeWake,
} from '@main/voice/fakes';
import { createVoiceSystem } from '@main/voice/voice-system';
import { idle, setupServices } from './helpers';

function setupVoice(
  script: FakeScript | ((dir: string) => FakeScript),
  transcripts: string[],
  opts: { edgeFails?: boolean; mode?: 'ptt' | 'wake' } = {},
) {
  const t = setupServices(script);
  t.services.settings.set('voice.mode', opts.mode ?? 'ptt');
  const wake = createFakeWake();
  const stt = createFakeStt(transcripts);
  const edge = createFakeTts('edge', { fail: opts.edgeFails ?? false });
  const sapi = createFakeTts('sapi');
  const v = createVoiceSystem(t.services, {
    factories: { recorder: (_d, n) => createFakeRecorder(n), wake: () => wake, stt, edge, sapi },
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
      ['what time is it'],
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
    expect(transcripts.at(-1)).toEqual({ text: 'what time is it', isFinal: true });
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
          e.event === 'notify' && /Windows voice/.test((e.payload as { message: string }).message),
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
