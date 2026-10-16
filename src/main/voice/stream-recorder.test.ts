import { describe, expect, it } from 'vitest';
import { createStreamRecorder } from './stream-recorder';

function setup() {
  const calls: string[] = [];
  const rec = createStreamRecorder({
    frameLength: 512,
    onStart: () => calls.push('start'),
    onStop: () => calls.push('stop'),
  });
  return { rec, calls };
}

const frame = (v: number): Int16Array => new Int16Array(512).fill(v);

describe('stream recorder (echo-cancelled mic from the capture window)', () => {
  it('hands frames to read() in order, waiting when none has arrived yet', async () => {
    const { rec, calls } = setup();
    rec.push(frame(9)); // before start: ignored
    rec.start();
    rec.push(frame(1));
    expect((await rec.read())[0]).toBe(1);
    const pending = rec.read();
    rec.push(frame(2));
    expect((await pending)[0]).toBe(2);
    expect(calls).toEqual(['start']);
    expect(rec.isRecording).toBe(true);
  });

  it('stop ends a pending read so the voice loop can finish, and stops the microphone once', async () => {
    const { rec, calls } = setup();
    rec.start();
    const pending = rec.read();
    rec.stop();
    rec.release();
    await expect(pending).rejects.toThrow('stopped');
    expect(calls).toEqual(['start', 'stop']);
    rec.push(frame(3));
    expect(rec.isRecording).toBe(false);
  });

  it('a microphone failure reaches the reader with its reason', async () => {
    const { rec } = setup();
    rec.start();
    const pending = rec.read();
    rec.fail(new Error('microphone: NotAllowedError'));
    await expect(pending).rejects.toThrow(/NotAllowedError/);
    await expect(rec.read()).rejects.toThrow(/NotAllowedError/);
  });

  it('keeps only the newest ~6 s when nobody reads', async () => {
    const { rec } = setup();
    rec.start();
    for (let i = 0; i < 250; i++) rec.push(frame(i));
    expect((await rec.read())[0]).toBe(50);
  });
});
