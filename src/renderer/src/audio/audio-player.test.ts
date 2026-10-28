import { describe, expect, it } from 'vitest';
import { pcmBuffer } from './audio-player';

describe('streamed PCM playback (voice fix 2B)', () => {
  it('turns 16-bit little-endian samples into a float AudioBuffer at their own rate', () => {
    let made: { channels: number; length: number; rate: number; data: Float32Array } | null = null;
    const ctx = {
      createBuffer: (channels: number, length: number, rate: number) => {
        made = { channels, length, rate, data: new Float32Array(length) };
        return { getChannelData: () => made?.data } as unknown as AudioBuffer;
      },
    };
    const bytes = new Uint8Array(Int16Array.from([0, 16384, -32768, 32767]).buffer);
    pcmBuffer(ctx, bytes, 24_000);
    expect(made).toMatchObject({ channels: 1, length: 4, rate: 24_000 });
    expect([...(made as unknown as { data: Float32Array }).data]).toEqual([
      0,
      0.5,
      -1,
      32767 / 32768,
    ]);
  });
});
