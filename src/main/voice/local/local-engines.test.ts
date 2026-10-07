import { describe, expect, it, vi } from 'vitest';
import type { SettingsService } from '../../settings/settings-service';
import { createLocalEngines } from './local-engines';
import type { ModelStore } from './model-store';

vi.mock('./onnx', () => ({
  VAD_WINDOW: 512,
  // Loud windows are speech.
  loadSileroVad: async () => ({
    prob: async (w: Float32Array) => ((w[0] ?? 0) > 0.1 ? 0.9 : 0),
    reset: () => undefined,
  }),
  loadOwwModels: async () => ({}),
}));
vi.mock('./whisper', () => ({
  loadWhisper: async (dir: string) => {
    let disposed = false;
    return {
      async transcribe() {
        if (disposed) throw new Error('Session already disposed.');
        return `heard by ${dir}`;
      },
      async release() {
        disposed = true;
      },
    };
  },
}));

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 20));

describe('local engines: always-listening', () => {
  it('keeps transcribing after the Whisper model is switched (the old one is disposed)', async () => {
    const values: Record<string, unknown> = {
      'voice.stt.whisperModel': 'whisper-base.en',
      'voice.stt.provider': 'whisper',
      'voice.stt.language': 'en',
      'voice.endSilenceMs': 300,
    };
    const settings = { get: (k: string) => values[k] } as unknown as SettingsService;
    const store = { installed: () => true, dir: (id: string) => id } as unknown as ModelStore;
    const local = createLocalEngines(store, settings);
    const heard: string[] = [];
    const errors: string[] = [];
    const ambient = await local.ambient({
      onSpeechStart: () => undefined,
      onSegment: (s) => heard.push(s.text),
      onError: (e) => errors.push(e.message),
    });
    const phrase = async (): Promise<void> => {
      for (let i = 0; i < 10; i++) ambient.write(new Int16Array(512).fill(10_000));
      for (let i = 0; i < 15; i++) ambient.write(new Int16Array(512)); // > 300 ms of quiet
      await flush();
    };

    await phrase();
    values['voice.stt.whisperModel'] = 'whisper-small.en';
    local.preload(); // what Settings does on a model change: loads the new one, disposes the old
    await flush();
    await phrase();

    expect(errors).toEqual([]);
    expect(heard).toEqual(['heard by whisper-base.en', 'heard by whisper-small.en']);
    ambient.close();
  });
});
