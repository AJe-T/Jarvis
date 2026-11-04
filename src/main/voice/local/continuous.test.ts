import { describe, expect, it } from 'vitest';
import { createContinuousTranscriber, type HeardSegment } from './continuous';
import { VAD_WINDOW } from './onnx';

/** Speech in every window: the phrase never ends on its own. */
const alwaysSpeech = { prob: async () => 0.9, reset: () => undefined };

function setup(maxBacklog?: number) {
  const heard: HeardSegment[] = [];
  let release: () => void = () => undefined;
  let slow = false;
  const t = createContinuousTranscriber({
    vad: alwaysSpeech,
    transcriber: {
      transcribe: async () => {
        if (slow) await new Promise<void>((r) => (release = r));
        return `phrase ${heard.length + 1}`;
      },
      release: async () => undefined,
    },
    onSegment: (s) => heard.push(s),
    onError: (e) => {
      throw e;
    },
    ...(maxBacklog !== undefined ? { maxBacklog } : {}),
  });
  return { t, heard, slowDown: () => (slow = true), release: () => release() };
}

describe('continuous transcriber: meetings', () => {
  it('flush() transcribes the phrase still being spoken', async () => {
    const { t, heard } = setup();
    t.write(new Int16Array(VAD_WINDOW * 20));
    await t.flush();
    expect(heard.map((h) => h.text)).toEqual(['phrase 1']);
  });

  it('keeps every phrase with maxBacklog Infinity while the model lags', async () => {
    const { t, heard, slowDown, release } = setup(Infinity);
    slowDown();
    // 12 s phrases are cut by length: 5 of them queue behind the slow model.
    for (let i = 0; i < 5; i++) t.write(new Int16Array(16_000 * 12 + VAD_WINDOW));
    const done = t.flush();
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 5));
      release();
    }
    await done;
    expect(heard.length).toBeGreaterThanOrEqual(5);
  });
});
