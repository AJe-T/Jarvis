import { describe, expect, it } from 'vitest';
import type { TtsProvider } from './types';
import { packSpeech, speakToFile } from './speech-file';
import { encodeWav } from './wav';

const wav = (samples: number[], rate: number) => encodeWav(Float32Array.from(samples), rate);

describe('spoken replies as one file (voice fix 4: Telegram uses the chosen voice)', () => {
  it('joins MP3 sentences as they are', () => {
    const f = packSpeech([
      { mime: 'audio/mpeg', data: Uint8Array.of(1, 2) },
      { mime: 'audio/mpeg', data: Uint8Array.of(3) },
    ]);
    expect(f).toEqual({ mime: 'audio/mpeg', data: Uint8Array.of(1, 2, 3) });
  });

  it('joins WAV sentences and streamed PCM into one WAV at the voice rate', () => {
    const f = packSpeech([
      { mime: 'audio/wav', data: wav([0.5], 22_050) },
      { mime: 'audio/wav', data: wav([-0.5], 22_050) },
    ]);
    expect(f?.mime).toBe('audio/wav');
    const b = Buffer.from(f?.data ?? []);
    expect(b.readUInt32LE(24)).toBe(22_050);
    expect(b.readUInt32LE(40)).toBe(4);
    const pcm = packSpeech([{ mime: 'audio/pcm', data: new Uint8Array(6), sampleRate: 24_000 }]);
    expect(Buffer.from(pcm?.data ?? []).readUInt32LE(24)).toBe(24_000);
  });

  it('refuses mixed rates or formats so the next voice is tried', () => {
    expect(
      packSpeech([
        { mime: 'audio/wav', data: wav([0], 16_000) },
        { mime: 'audio/wav', data: wav([0], 22_050) },
      ]),
    ).toBeNull();
    expect(
      packSpeech([
        { mime: 'audio/mpeg', data: Uint8Array.of(1) },
        { mime: 'audio/wav', data: wav([0], 16_000) },
      ]),
    ).toBeNull();
  });

  it('uses the chosen voice, and a backup when it fails', async () => {
    const broken: TtsProvider = {
      id: 'elevenlabs',
      // eslint-disable-next-line require-yield
      async *synthesize() {
        throw new Error('quota');
      },
    };
    const edge: TtsProvider = {
      id: 'edge',
      async *synthesize() {
        yield { mime: 'audio/mpeg', data: Uint8Array.of(9) };
      },
    };
    expect(await speakToFile('Hello.', [broken, edge], { voice: 'v', rate: '+0%' })).toEqual({
      mime: 'audio/mpeg',
      data: Uint8Array.of(9),
    });
    await expect(speakToFile('Hello.', [broken], { voice: 'v', rate: '+0%' })).rejects.toThrow(
      'quota',
    );
  });
});
