import { describe, expect, it } from 'vitest';
import type { FakeScript } from '@main/llm/fake-claude';
import {
  createFakeRecorder,
  createFakeStt,
  createFakeTts,
  createFakeWake,
  type FakeUtterance,
} from '@main/voice/fakes';
import { createVoiceSystem } from '@main/voice/voice-system';
import { idle, setupServices } from './helpers';

/** v2.63: speech-to-text drops, words kept as a draft, long requests, the wake word's second opinion. */
function setup(
  script: FakeScript,
  transcripts: Array<string | FakeUtterance>,
  opts: { mode?: 'ptt' | 'wake'; maxListenMs?: number; clip?: (a: Float32Array) => string } = {},
) {
  const t = setupServices(script);
  t.services.settings.set('voice.mode', opts.mode ?? 'ptt');
  t.services.settings.set('voice.greet', false);
  t.services.settings.set('voice.wake.provider', 'openwakeword');
  const wake = createFakeWake();
  const stt = createFakeStt(transcripts);
  const clips: Float32Array[] = [];
  const v = createVoiceSystem(t.services, {
    factories: {
      recorder: (_d, n) => createFakeRecorder(n),
      wake: () => wake,
      stt,
      edge: createFakeTts('edge'),
      sapi: createFakeTts('sapi'),
      ...(opts.clip
        ? {
            transcribeClip: async (audio: Float32Array) => {
              clips.push(audio);
              return opts.clip?.(audio) ?? '';
            },
          }
        : {}),
    },
    timeouts: { silenceMs: 300, maxListenMs: opts.maxListenMs ?? 3000 },
  });
  const notices = (): string[] =>
    t.events
      .filter((e) => e.event === 'notify')
      .map((e) => (e.payload as { message: string }).message);
  const drafts = (): string[] =>
    t.events
      .filter((e) => e.event === 'voice:draft')
      .map((e) => (e.payload as { text: string }).text);
  const userSaid = (): string[] =>
    t.services.conversations
      .list(5)
      .flatMap((c) => t.services.conversations.messages(c.id))
      .filter((m) => m.role === 'user')
      .map((m) => m.text_plain);
  return { ...t, v, wake, stt, clips, notices, drafts, userSaid };
}

const until = async (cond: () => boolean, ms = 4000): Promise<void> => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
};
const hi = { rules: [{ match: 'hello', steps: [{ text: '<spoken>Hi, sir.</spoken>' }] }] };

describe('speech-to-text dropping (v2.63)', () => {
  it('a drop before any words reconnects quietly and still hears the request', async () => {
    const t = setup(hi, [{ drop: true }, 'hello there']);
    await t.v.start();
    t.v.voice.ptt();
    await until(() => t.userSaid().length === 1);
    await idle(t.services);
    expect(t.userSaid()).toEqual(['hello there']);
    expect(t.stt.sessions).toBe(2);
    expect(t.notices().filter((m) => /Speech recognition failed/.test(m))).toEqual([]);
    t.v.voice.shutdown();
  });

  it('two drops in a row are reported', async () => {
    const t = setup(hi, [{ drop: true }, { drop: true }]);
    await t.v.start();
    t.v.voice.ptt();
    await until(() => t.notices().some((m) => /Speech recognition failed/.test(m)));
    expect(t.stt.sessions).toBe(2);
    t.v.voice.shutdown();
  });
});

describe('spoken words are never lost (v2.63)', () => {
  it('words heard before listening is cut short wait in the message box as a draft', async () => {
    const t = setup(
      hi,
      [{ partials: ['open the', 'open the report for', 'open the report for Ravi'] }],
      {
        maxListenMs: 400,
      },
    );
    await t.v.start();
    t.v.voice.ptt();
    await until(() => t.drafts().length === 1);
    expect(t.drafts()).toEqual(['open the report for Ravi']);
    expect(t.userSaid()).toEqual([]); // nothing was sent
    t.v.voice.shutdown();
  });

  it('the listening limit moves on while words keep arriving', async () => {
    const partials = Array.from({ length: 12 }, (_, i) =>
      Array.from({ length: i + 1 }, (_, j) => `word${j + 1}`).join(' '),
    );
    // 12 partials 100 ms apart (1.2 s) against a 300 ms limit: before v2.63 it cut at word 3.
    const t = setup(hi, [{ partials, everyMs: 100 }], { maxListenMs: 300 });
    await t.v.start();
    t.v.voice.ptt();
    await until(() => t.drafts().length === 1);
    expect(t.drafts()[0]).toBe(partials.at(-1));
    t.v.voice.shutdown();
  });

  it('nothing is kept when nothing was said', async () => {
    const t = setup(hi, []);
    await t.v.start();
    t.v.voice.ptt();
    await until(() => t.services.state.get() === 'IDLE' && t.stt.sessions === 1);
    await new Promise((r) => setTimeout(r, 500));
    expect(t.drafts()).toEqual([]);
    t.v.voice.shutdown();
  });
});

describe("the wake word's second opinion on a near miss (v2.63)", () => {
  it('wakes when on-device speech heard the name in the near miss', async () => {
    const t = setup(hi, ['hello'], { mode: 'wake', clip: () => 'Jarvis.' });
    await t.v.start();
    await new Promise((r) => setTimeout(r, 200)); // some audio reaches the wake word
    t.v.voice.nearMiss();
    await until(() => t.stt.sessions === 1);
    expect(t.clips[0]?.length).toBeGreaterThan(0);
    t.v.voice.shutdown();
  });

  it('stays asleep when it heard something else', async () => {
    const t = setup(hi, ['hello'], { mode: 'wake', clip: () => 'the weather is nice' });
    await t.v.start();
    await new Promise((r) => setTimeout(r, 200));
    t.v.voice.nearMiss();
    await until(() => t.clips.length === 1);
    await new Promise((r) => setTimeout(r, 200));
    expect(t.stt.sessions).toBe(0);
    t.v.voice.shutdown();
  });
});
