import { describe, expect, it } from 'vitest';
import { SETTINGS, type SettingKey, type SettingValue } from '@shared/settings';
import type { JarvisError } from './errors';
import type { ModelId } from './voice/local/model-store';
import { createSettingsService } from './settings/settings-service';
import { guardOfflineChange, offlineProblems, offlineReadiness, type OfflineView } from './offline';

/** Everything on this PC: Ollama, voice v2 with Moonshine downloaded, Kokoro with eSpeak NG. */
const READY: Partial<Record<SettingKey, unknown>> = {
  'llm.provider': 'local',
  'llm.local.baseUrl': 'http://localhost:11434/v1',
  'llm.local.model': 'qwen3:8b',
  'voice.engine': 'v2',
  'voice.tts.provider': 'kokoro',
  'voice.mode': 'wake',
};

function view(
  over: Partial<Record<SettingKey, unknown>> = {},
  opts: { models?: ModelId[]; espeak?: boolean } = {},
): OfflineView {
  const values = { ...READY, ...over };
  const models = new Set<ModelId>(opts.models ?? ['silero-vad', 'moonshine-base', 'kokoro-82m']);
  return {
    get: <K extends SettingKey>(k: K): SettingValue<K> =>
      (k in values ? values[k] : SETTINGS[k].default) as SettingValue<K>,
    installed: (id) => models.has(id),
    espeak: () => opts.espeak ?? true,
  };
}

const parts = (v: OfflineView): string[] => offlineProblems(v).map((p) => p.part);

describe('offline mode: what must be on this PC', () => {
  it('is ready when brain, hearing, voice and wake word are all local', () => {
    expect(offlineProblems(view())).toEqual([]);
  });

  it('refuses Claude, the subscription and cloud brains as the main brain', () => {
    for (const provider of ['api', 'subscription', 'cloud']) {
      const [p] = offlineProblems(view({ 'llm.provider': provider }));
      expect(p?.part).toBe('Brain');
      expect(p?.fix).toMatch(/Local model/);
    }
    expect(offlineProblems(view({ 'llm.provider': 'api' }))[0]?.fix).toMatch(/Claude \(API key\)/);
  });

  it('refuses a local model on the home network or with no model picked', () => {
    expect(parts(view({ 'llm.local.baseUrl': 'http://192.168.1.20:11434/v1' }))).toEqual(['Brain']);
    expect(parts(view({ 'llm.local.model': '' }))).toEqual(['Brain']);
    expect(parts(view({ 'llm.local.baseUrl': 'http://127.0.0.1:1234/v1' }))).toEqual([]);
  });

  it('voice v2 needs an on-device speech model and the voice detector', () => {
    expect(parts(view({}, { models: ['kokoro-82m', 'silero-vad'] }))).toEqual(['Speech to text']);
    expect(parts(view({}, { models: ['kokoro-82m', 'moonshine-base'] }))).toEqual([
      'Speech to text',
    ]);
  });

  it('classic voice: cloud speech to text and the Picovoice wake word are refused', () => {
    const classic = { 'voice.engine': 'classic' };
    expect(parts(view({ ...classic, 'voice.stt.provider': 'deepgram' }))).toEqual([
      'Speech to text',
    ]);
    expect(parts(view({ ...classic, 'voice.stt.provider': 'windows' }))).toEqual([]);
    expect(
      parts(view({ ...classic, 'voice.stt.provider': 'whisper' }, { models: ['kokoro-82m'] })),
    ).toEqual(['Speech to text']); // whisper-small.en isn't downloaded
    const server = (url: string): string[] =>
      parts(view({ ...classic, 'voice.stt.provider': 'server', 'voice.stt.serverUrl': url }));
    expect(server('http://localhost:8000/v1')).toEqual([]); // Sir's own server on this PC
    expect(server('http://192.168.1.5:8000/v1')).toEqual(['Speech to text']);
    expect(
      parts(
        view({ ...classic, 'voice.stt.provider': 'windows', 'voice.wake.provider': 'picovoice' }),
      ),
    ).toEqual(['Wake word']);
  });

  it('voices: Edge and other cloud voices are refused; Kokoro and Piper need their download and eSpeak', () => {
    expect(parts(view({ 'voice.tts.provider': 'edge' }))).toEqual(['Voice']);
    expect(parts(view({ 'voice.tts.provider': 'elevenlabs' }))).toEqual(['Voice']);
    expect(parts(view({ 'voice.tts.provider': 'sapi' }))).toEqual([]);
    expect(parts(view({}, { espeak: false }))).toEqual(['Voice']);
    expect(parts(view({}, { models: ['silero-vad', 'moonshine-base'] }))).toEqual(['Voice']);
  });

  it('a realtime conversation is refused (it streams the voice out)', () => {
    expect(parts(view({ 'voice.mode': 'realtime' }))).toEqual(['Voice mode']);
  });

  it('lists every problem at once, so Sir sees the whole list in one pop-up', () => {
    expect(parts(view({ 'llm.provider': 'api', 'voice.tts.provider': 'edge' }))).toEqual([
      'Brain',
      'Voice',
    ]);
  });
});

describe('offline mode: the local model must really answer', () => {
  it('asks the local model only when the settings are right, and reports a failure', async () => {
    let pinged = 0;
    const ping = async (): Promise<void> => {
      pinged++;
      throw new Error('connect ECONNREFUSED 127.0.0.1:11434');
    };
    expect(await offlineReadiness(view({ 'llm.provider': 'api' }), ping)).toHaveLength(1);
    expect(pinged).toBe(0);
    const [p] = await offlineReadiness(view(), ping);
    expect(p?.part).toBe('Brain');
    expect(p?.fix).toMatch(/ECONNREFUSED.*Start Ollama/);
    expect(await offlineReadiness(view(), async () => undefined)).toEqual([]);
  });
});

describe('offline mode: while it is on', () => {
  const on = view({ 'offline.enabled': true });
  /** What Sir reads when the change is refused. */
  const refusal = (key: SettingKey, value: unknown): string => {
    try {
      guardOfflineChange(on, key, value);
      return '';
    } catch (err) {
      return (err as JarvisError).userMessage ?? '';
    }
  };

  it('refuses a change that puts a part back in the cloud, saying why', () => {
    expect(refusal('llm.provider', 'api')).toBe(
      'Offline mode is on. The main brain is Claude (API key), which runs in the cloud. Turn Offline mode off first (Settings → Privacy).',
    );
    expect(refusal('voice.tts.provider', 'edge')).toMatch(/Edge.*Turn Offline mode off/);
    expect(refusal('voice.mode', 'realtime')).toMatch(/Realtime/);
    expect(refusal('voice.engine', 'classic')).toMatch(/Speech to text is Deepgram/); // classic default
  });

  it('allows changes that stay on this PC, and anything when it is off', () => {
    expect(() => guardOfflineChange(on, 'voice.tts.provider', 'sapi')).not.toThrow();
    expect(() => guardOfflineChange(on, 'llm.local.model', 'llama3.1:8b')).not.toThrow();
    expect(() => guardOfflineChange(on, 'assistant.name', 'Friday')).not.toThrow();
    expect(() => guardOfflineChange(view(), 'llm.provider', 'api')).not.toThrow();
  });
});

describe('offline mode: one guard for every settings write', () => {
  it('the settings service refuses a cloud part whoever writes it (onboarding, voice mode, IPC)', () => {
    const repo = { all: () => new Map<string, unknown>(), set: () => undefined };
    const settings = createSettingsService(repo);
    for (const [k, v] of Object.entries(READY)) settings.set(k as SettingKey, v);
    settings.set('offline.enabled', true);
    const live: OfflineView = {
      get: (k) => settings.get(k),
      installed: () => true,
      espeak: () => true,
    };
    settings.setGuard((key, value) => guardOfflineChange(live, key, value));
    expect(() => settings.set('voice.mode', 'realtime')).toThrow();
    expect(settings.get('voice.mode')).toBe('wake'); // not saved
    expect(() => settings.set('voice.tts.provider', 'sapi')).not.toThrow();
    settings.set('offline.enabled', false);
    expect(() => settings.set('voice.mode', 'realtime')).not.toThrow();
  });
});
