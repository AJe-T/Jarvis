import { describe, expect, it, vi } from 'vitest';
import { createEngineReporter, hearingChain, speakingFallbacks } from './backup';
import { createFakeTts } from './fakes';
import type { TtsProvider } from './types';

const tts = (id: TtsProvider['id']): TtsProvider => ({ ...createFakeTts(), id });

describe('voice backup chain', () => {
  const f = {
    kokoro: tts('kokoro'),
    edge: tts('edge'),
    elevenlabs: tts('elevenlabs'),
    sapi: tts('sapi'),
  };

  it('speaking backup on: Kokoro → Edge → ElevenLabs → Windows, minus the chosen voice', () => {
    expect(speakingFallbacks('kokoro', f, true).map((p) => p.id)).toEqual([
      'edge',
      'elevenlabs',
      'sapi',
    ]);
    expect(speakingFallbacks('openai', f, true).map((p) => p.id)).toEqual([
      'kokoro',
      'edge',
      'elevenlabs',
      'sapi',
    ]);
    // Voices that aren't set up here are left out.
    expect(
      speakingFallbacks('edge', { edge: f.edge, sapi: f.sapi }, true).map((p) => p.id),
    ).toEqual(['sapi']);
  });

  it('speaking backup off: the old Edge → Windows fallback', () => {
    expect(speakingFallbacks('kokoro', f, false).map((p) => p.id)).toEqual(['edge', 'sapi']);
    expect(speakingFallbacks('sapi', f, false)).toEqual([]);
  });

  it('hearing: the next engine takes a failed phrase, and every switch is reported by name', async () => {
    const report = vi.fn();
    const local = {
      transcribe: vi.fn(async () => 'local words'),
      release: vi.fn(async () => undefined),
    };
    const groq = {
      transcribe: vi.fn(async () => 'groq words'),
      release: vi.fn(async () => undefined),
    };
    const t = hearingChain(
      [
        { name: 'Whisper on this PC', t: local },
        { name: 'Groq Whisper', t: groq },
      ],
      report,
    );
    expect(await t.transcribe(new Float32Array(4), 'en')).toBe('local words');
    expect(groq.transcribe).not.toHaveBeenCalled();
    local.transcribe.mockRejectedValueOnce(new Error('model crashed'));
    expect(await t.transcribe(new Float32Array(4), 'en')).toBe('groq words');
    expect(report.mock.calls).toEqual([
      ['hearing', 'Whisper on this PC', undefined],
      ['hearing', 'Groq Whisper', 'Whisper on this PC: model crashed'],
    ]);
  });

  it('a notice on every change of engine, none for the first chosen one or a repeat', () => {
    const emit = vi.fn();
    const engines = { hearing: null, speaking: null };
    const report = createEngineReporter({ engines, emit });
    report('speaking', 'Kokoro on this PC');
    report('speaking', 'Kokoro on this PC');
    expect(emit).not.toHaveBeenCalled();
    report('speaking', 'Edge voices', 'Kokoro on this PC failed: model missing');
    report('speaking', 'Kokoro on this PC');
    expect(emit.mock.calls.map((c) => (c[1] as { message: string }).message)).toEqual([
      'Speaking with Edge voices now (Kokoro on this PC failed: model missing).',
      'Speaking with Kokoro on this PC again.',
    ]);
    expect(engines.speaking).toBe('Kokoro on this PC');
  });
});
