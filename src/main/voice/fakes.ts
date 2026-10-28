import { sleep } from '../lib/util';
import type { Recorder, SttProvider, SttSession, TtsProvider, WakeWord } from './types';

// Testing.md §8: fixture-driven stand-ins so the voice pipeline runs without a mic, keys or network.

export function createFakeRecorder(frameLength = 512): Recorder & { reads: number } {
  let recording = false;
  const r = {
    frameLength,
    reads: 0,
    start: () => {
      recording = true;
    },
    stop: () => {
      recording = false;
    },
    async read(): Promise<Int16Array> {
      await sleep(32); // 512 samples @ 16 kHz
      // Like PvRecorder: a read that is pending when the recorder is stopped or released fails.
      if (!recording) throw new Error('PvRecorder failed to read audio data frame.');
      r.reads++;
      const frame = new Int16Array(frameLength);
      for (let i = 0; i < frameLength; i++) frame[i] = Math.round(Math.sin(i / 8) * 800);
      return frame;
    },
    release: () => {
      recording = false;
    },
    get isRecording() {
      return recording;
    },
  };
  return r;
}

export function createFakeWake(): WakeWord & { trigger(): void; resets: number } {
  let fire = false;
  return {
    frameLength: 512,
    resets: 0,
    process: () => {
      const f = fire;
      fire = false;
      return f;
    },
    reset() {
      this.resets++;
    },
    trigger: () => {
      fire = true;
    },
    release: () => undefined,
  };
}

/** Each started session "hears" the next scripted transcript after a short delay. */
export function createFakeStt(
  transcripts: string[] = [],
  opts: { startDelayMs?: number } = {},
): SttProvider & { queue: string[]; sessions: number; written: number } {
  const provider = {
    id: 'fake',
    queue: [...transcripts],
    sessions: 0,
    written: 0,
    async start({ signal }: { signal: AbortSignal }): Promise<SttSession> {
      provider.sessions++;
      if (opts.startDelayMs) await sleep(opts.startDelayMs);
      const handlers: Record<string, Array<(...a: never[]) => void>> = {};
      const fire = (e: string, ...a: unknown[]): void => {
        for (const h of handlers[e] ?? []) (h as (...x: unknown[]) => void)(...a);
      };
      const text = provider.queue.shift();
      if (text !== undefined) {
        setTimeout(() => {
          if (signal.aborted) return;
          fire('speechStarted');
          fire('partial', text.split(' ').slice(0, 2).join(' '));
          fire('final', text);
        }, 60);
      }
      return {
        write: () => {
          provider.written++;
        },
        on: (event: string, cb: (...a: never[]) => void) => {
          (handlers[event] ??= []).push(cb);
        },
        close: async () => undefined,
      };
    },
  };
  return provider;
}

/** 44-byte WAV header + a few silent samples: enough for decodeAudioData in the renderer. */
export function silentWav(samples = 2400): Uint8Array {
  const dataBytes = samples * 2;
  const b = Buffer.alloc(44 + dataBytes);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + dataBytes, 4);
  b.write('WAVE', 8);
  b.write('fmt ', 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(24000, 24);
  b.writeUInt32LE(48000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(dataBytes, 40);
  return new Uint8Array(b);
}

export function createFakeTts(
  id: 'fake' | 'edge' | 'sapi' = 'fake',
  opts: { fail?: boolean } = {},
): TtsProvider & { spoken: string[] } {
  const spoken: string[] = [];
  return {
    id: id === 'fake' ? 'fake' : id,
    spoken,
    async *synthesize(text) {
      if (opts.fail) throw new Error('tts endpoint down');
      spoken.push(text);
      yield { mime: 'audio/wav' as const, data: silentWav() };
    },
  };
}
