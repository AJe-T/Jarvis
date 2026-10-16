import { describe, expect, it } from 'vitest';
import {
  isAllowedSpeechServer,
  LOCAL_MODEL_IDS,
  LOCAL_STT_MODELS,
  LOCAL_STT_MODEL_IDS,
  PIPER_VOICE_IDS,
  speechServerUrl,
  STT_ENGINES,
  STT_ENGINE_IDS,
  TTS_ENGINES,
  TTS_ENGINE_IDS,
} from '@shared/speech-engines';
import { SETTINGS } from '@shared/settings';
import MANIFEST from './local/models.json';

describe('speech engine catalogue (ADR-038)', () => {
  it('lists exactly the models pinned in models.json', () => {
    expect([...LOCAL_MODEL_IDS].sort()).toEqual(Object.keys(MANIFEST).sort());
  });

  it('pins every downloadable file to a sha256 and size', () => {
    for (const [id, m] of Object.entries(MANIFEST))
      for (const f of m.files) {
        expect(f.sha256, `${id}/${f.path}`).toMatch(/^[0-9a-f]{64}$/);
        expect(f.size, `${id}/${f.path}`).toBeGreaterThan(0);
        if (f.url) expect(f.url, `${id}/${f.path}`).toMatch(/^https:\/\//);
      }
  });

  it('describes every engine and every on-device model once', () => {
    expect(STT_ENGINES.map((e) => e.id)).toEqual([...STT_ENGINE_IDS]);
    expect(TTS_ENGINES.map((e) => e.id)).toEqual([...TTS_ENGINE_IDS]);
    expect(LOCAL_STT_MODELS.map((m) => m.id)).toEqual([...LOCAL_STT_MODEL_IDS]);
    for (const e of [...STT_ENGINES, ...TTS_ENGINES]) expect(e.body.length).toBeGreaterThan(40);
  });

  it('stores Piper voices as voice.onnx + voice.onnx.json', () => {
    for (const id of PIPER_VOICE_IDS)
      expect(MANIFEST[id].files.map((f) => f.path).sort()).toEqual([
        'voice.onnx',
        'voice.onnx.json',
      ]);
  });

  it('accepts its own setting defaults', () => {
    for (const [key, def] of Object.entries(SETTINGS))
      if (key.startsWith('voice.'))
        expect(def.schema.safeParse(def.default).success, key).toBe(true);
  });

  it('allows plain http only to this PC or the home network', () => {
    for (const ok of [
      'http://localhost:8000/v1',
      'http://127.0.0.1:8880/v1',
      'http://[::1]:8000/v1',
      'http://192.168.1.20:8004/v1',
      'http://10.0.0.5/v1',
      'http://172.20.1.1/v1',
      'https://speech.example.com/v1',
    ])
      expect(isAllowedSpeechServer(ok), ok).toBe(true);
    for (const bad of [
      'http://example.com/v1',
      'http://172.32.0.1/v1',
      'https://169.254.169.254/latest',
      'https://[fe80::1]/v1',
      'https://metadata.google.internal/v1',
      'http://localhost.evil.com/v1',
      'https://user:pw@speech.example.com/v1',
      'https://speech.example.com/v1?x=1',
      'file:///C:/x',
      'ftp://localhost/v1',
      'not a url',
    ])
      expect(isAllowedSpeechServer(bad), bad).toBe(false);
  });

  it('joins the server base and path whatever the trailing slash', () => {
    expect(speechServerUrl('http://localhost:8000/v1/', 'audio/speech')).toBe(
      'http://localhost:8000/v1/audio/speech',
    );
  });
});
