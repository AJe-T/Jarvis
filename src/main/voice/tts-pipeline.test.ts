import { describe, expect, it } from 'vitest';
import { logger } from '../logging/logger';
import { createFakeTts } from './fakes';
import { clearSpeechCache, Utterance } from './tts-pipeline';

function speak(tts: ReturnType<typeof createFakeTts>, text: string, cache: boolean) {
  const sent: Array<{ last?: boolean | undefined }> = [];
  let done: () => void = () => undefined;
  const finished = new Promise<void>((r) => (done = r));
  const u = new Utterance(
    {
      primary: () => tts,
      fallbacks: () => [],
      voice: () => 'v',
      rate: () => '+0%',
      emitAudio: (p) => {
        sent.push(p);
        if (p.last) done();
      },
      emitStop: () => undefined,
      onFallback: () => undefined,
      logger,
    },
    { extractSpoken: false, cache },
  );
  u.push(text);
  u.end();
  return finished.then(() => sent.filter((p) => !p.last).length);
}

describe('Utterance speech cache', () => {
  it('plays a stock line from memory the second time', async () => {
    clearSpeechCache();
    const tts = createFakeTts();
    expect(await speak(tts, 'Yes, sir?', true)).toBe(1);
    expect(await speak(tts, 'Yes, sir?', true)).toBe(1);
    expect(tts.spoken).toEqual(['Yes, sir?']);
  });

  it('does not keep ordinary replies', async () => {
    clearSpeechCache();
    const tts = createFakeTts();
    await speak(tts, 'Sunny, sir.', false);
    await speak(tts, 'Sunny, sir.', false);
    expect(tts.spoken).toHaveLength(2);
  });
});

describe('Utterance backup voice (AI Router Phase 3)', () => {
  it('a failed voice hands the sentence to the next, and says which voice spoke and why', async () => {
    const broken = createFakeTts('fake', { fail: true });
    const edge = createFakeTts('edge');
    const engines: Array<[string, string | undefined]> = [];
    let done: () => void = () => undefined;
    const finished = new Promise<void>((r) => (done = r));
    const u = new Utterance(
      {
        primary: () => broken,
        fallbacks: () => [edge],
        voice: () => 'v',
        rate: () => '+0%',
        emitAudio: (p) => p.last && done(),
        emitStop: () => undefined,
        onFallback: () => undefined,
        onEngine: (id, failed) => engines.push([id, failed?.id]),
        logger,
      },
      { extractSpoken: false },
    );
    u.push('Hello, sir.');
    u.end();
    await finished;
    expect(edge.spoken).toEqual(['Hello, sir.']);
    expect(engines).toEqual([['edge', 'fake']]);
  });
});
