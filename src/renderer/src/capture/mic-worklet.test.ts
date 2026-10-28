import { beforeAll, describe, expect, it } from 'vitest';

type Processor = { process(inputs: Float32Array[][]): boolean };
type ProcessorClass = new (o: { processorOptions: { frameLength: number } }) => Processor;

const posted: ArrayBuffer[] = [];
let registered: ProcessorClass | null = null;

beforeAll(async () => {
  // The audio thread's globals, as AudioWorkletGlobalScope provides them.
  const g = globalThis as Record<string, unknown>;
  g['AudioWorkletProcessor'] = class {
    readonly port = { postMessage: (b: ArrayBuffer) => posted.push(b) };
  };
  g['registerProcessor'] = (_name: string, cls: ProcessorClass) => {
    registered = cls;
  };
  await import('./mic-worklet');
});

describe('microphone worklet (voice fix 1C)', () => {
  it('turns 128-sample render quanta into Int16 frames of exactly the asked length', () => {
    posted.length = 0;
    const p = new (registered as ProcessorClass)({ processorOptions: { frameLength: 320 } });
    const quantum = (v: number) => [[new Float32Array(128).fill(v)]];
    for (let i = 0; i < 5; i++) expect(p.process(quantum(0.5))).toBe(true); // 640 samples
    expect(posted).toHaveLength(2);
    const frame = new Int16Array(posted[0] as ArrayBuffer);
    expect(frame).toHaveLength(320);
    expect(frame[0]).toBe(Math.trunc(0.5 * 0x7fff));
  });

  it('clips out-of-range samples and keeps running with no input', () => {
    posted.length = 0;
    const p = new (registered as ProcessorClass)({ processorOptions: { frameLength: 128 } });
    expect(p.process([])).toBe(true);
    p.process([[Float32Array.from({ length: 128 }, (_, i) => (i % 2 ? 2 : -2))]]);
    const frame = new Int16Array(posted[0] as ArrayBuffer);
    expect([frame[0], frame[1]]).toEqual([-32768, 32767]);
  });
});
