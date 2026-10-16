import { describe, expect, it, vi } from 'vitest';
import { readCapped, readJsonCapped } from './http-body';
import { normalise } from './tts/piper';
import { withLocalFallback } from './voice-system';
import type { LocalEngines } from './local/local-engines';

function chunked(parts: number[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (const n of parts) c.enqueue(new Uint8Array(n));
      c.close();
    },
  });
  return new Response(stream);
}

describe('speech service safety nets (ADR-038)', () => {
  it('stops reading a chunked answer once it passes the cap', async () => {
    await expect(readCapped(chunked([600, 600]), 1000, 'Server')).rejects.toThrow(
      'Server sent too much data',
    );
    expect((await readCapped(chunked([400, 400]), 1000, 'Server')).byteLength).toBe(800);
  });

  it('refuses a declared size over the cap before reading', async () => {
    const res = new Response('x', { headers: { 'content-length': '5000000' } });
    await expect(readJsonCapped(res, 'Groq')).rejects.toThrow('too much data');
  });

  it('brings a quiet Piper voice up to full level', () => {
    const out = normalise(new Float32Array([0.1, -0.2, 0.05]));
    expect(Math.max(...out.map(Math.abs))).toBeCloseTo(0.95);
    expect(normalise(new Float32Array([0, 0])).every((x) => x === 0)).toBe(true);
  });

  it('reads a failed cloud phrase on this PC when on-device speech is ready', async () => {
    const cloud = {
      transcribe: vi.fn(async () => Promise.reject(new Error('429'))),
      release: vi.fn(async () => undefined),
    };
    const ready = { ready: () => true, transcribe: vi.fn(async () => 'on device') };
    const t = withLocalFallback(cloud, ready as unknown as LocalEngines);
    expect(await t.transcribe(new Float32Array(10), 'en')).toBe('on device');
    const notReady = { ready: () => false, transcribe: vi.fn() };
    await expect(
      withLocalFallback(cloud, notReady as unknown as LocalEngines).transcribe(
        new Float32Array(1),
        'en',
      ),
    ).rejects.toThrow('429');
  });
});
