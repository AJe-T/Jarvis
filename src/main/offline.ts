import { cloudProvider } from '@shared/llm-providers';
import type { SettingKey, SettingValue } from '@shared/settings';
import { STT_ENGINES, TTS_ENGINES, isLoopbackUrl } from '@shared/speech-engines';
import { JarvisError, errorMessage } from './errors';
import type { ModelId } from './voice/local/model-store';
import { v2LocalModel } from './voice/v2/policy';

/**
 * Offline mode (idea from huwprosser/jarvis-mlx: STT, LLM and TTS all on the machine). It is a
 * promise, not a switch that changes engines: it turns on only when the brain, speech to text, the
 * voice and the wake word Sir chose are all on this PC and ready, and while it is on nothing may
 * move one of them back to the cloud. Each problem says which part and what to change.
 */

export interface OfflineProblem {
  part: 'Brain' | 'Speech to text' | 'Voice' | 'Wake word' | 'Voice mode';
  fix: string;
}

export interface OfflineView {
  get<K extends SettingKey>(key: K): SettingValue<K>;
  /** A downloaded on-device model (Settings → Voice). */
  installed(id: ModelId): boolean;
  /** eSpeak NG is installed (Kokoro and Piper need it). */
  espeak(): boolean;
}

const LOCAL_SPEECH = 'Settings → Voice → "Set up free on-device speech"';

function brainProblems(v: OfflineView): OfflineProblem[] {
  const provider = v.get('llm.provider');
  if (provider !== 'local') {
    const now =
      provider === 'api'
        ? 'Claude (API key)'
        : provider === 'subscription'
          ? 'Claude (your subscription)'
          : cloudProvider(v.get('llm.cloud.provider')).label;
    return [
      {
        part: 'Brain',
        fix: `The main brain is ${now}, which runs in the cloud. Choose "Local model" (Ollama or LM Studio) in AI Router → Main brain.`,
      },
    ];
  }
  const out: OfflineProblem[] = [];
  if (!isLoopbackUrl(v.get('llm.local.baseUrl')))
    out.push({
      part: 'Brain',
      fix: `The local model's address (${v.get('llm.local.baseUrl')}) is not on this PC. Use a server on this PC, e.g. Ollama at http://localhost:11434/v1.`,
    });
  if (!v.get('llm.local.model'))
    out.push({ part: 'Brain', fix: 'Pick the local model to use in AI Router → Main brain.' });
  return out;
}

function hearingProblems(v: OfflineView): OfflineProblem[] {
  const needVad = (): OfflineProblem[] =>
    v.installed('silero-vad')
      ? []
      : [{ part: 'Speech to text', fix: `The voice detector isn't downloaded: ${LOCAL_SPEECH}.` }];
  if (v.get('voice.engine') === 'v2')
    return v2LocalModel((id) => v.installed(id))
      ? needVad()
      : [
          {
            part: 'Speech to text',
            fix: `No on-device speech model is downloaded: ${LOCAL_SPEECH}.`,
          },
        ];
  const id = v.get('voice.stt.provider');
  if (id === 'windows') return [];
  if (id === 'whisper')
    return v.installed(v.get('voice.stt.whisperModel'))
      ? needVad()
      : [
          {
            part: 'Speech to text',
            fix: "The on-device speech model you chose isn't downloaded: Settings → Voice → Speech to text → Download.",
          },
        ];
  if (id === 'server' && isLoopbackUrl(v.get('voice.stt.serverUrl'))) return needVad();
  const title = STT_ENGINES.find((e) => e.id === id)?.title ?? id;
  return [
    {
      part: 'Speech to text',
      fix: `Speech to text is ${title}, which is not on this PC. Choose "On this PC" in Settings → Voice → Speech to text.`,
    },
  ];
}

function voiceProblems(v: OfflineView): OfflineProblem[] {
  const id = v.get('voice.tts.provider');
  if (id === 'sapi') return [];
  if (id === 'kokoro' || id === 'piper') {
    const out: OfflineProblem[] = [];
    const model = id === 'kokoro' ? 'kokoro-82m' : v.get('voice.tts.piperVoice');
    if (!v.installed(model))
      out.push({
        part: 'Voice',
        fix: `The ${id === 'kokoro' ? 'Kokoro' : 'Piper'} voice isn't downloaded: Settings → Voice → Voice → Download.`,
      });
    if (!v.espeak())
      out.push({
        part: 'Voice',
        fix: `${id === 'kokoro' ? 'Kokoro' : 'Piper'} needs the free eSpeak NG program: install it from github.com/espeak-ng/espeak-ng/releases, then restart Jarvis.`,
      });
    return out;
  }
  if (id === 'server' && isLoopbackUrl(v.get('voice.tts.serverUrl'))) return [];
  const title = TTS_ENGINES.find((e) => e.id === id)?.title ?? id;
  return [
    {
      part: 'Voice',
      fix: `Jarvis speaks with ${title}, which is not on this PC. Choose Kokoro, Piper or the Windows voice in Settings → Voice.`,
    },
  ];
}

/** What stops offline mode, from the settings and downloads alone (no network, instant). */
export function offlineProblems(v: OfflineView): OfflineProblem[] {
  const out = [...brainProblems(v), ...hearingProblems(v), ...voiceProblems(v)];
  if (v.get('voice.engine') === 'classic' && v.get('voice.wake.provider') === 'picovoice')
    out.push({
      part: 'Wake word',
      fix: 'The Picovoice wake word checks its key online. Choose the on-device "Hey Jarvis" in Settings → Voice → Wake word.',
    });
  if (v.get('voice.mode') === 'realtime')
    out.push({
      part: 'Voice mode',
      fix: 'Realtime conversation streams your voice to OpenAI or Gemini. Choose another voice mode.',
    });
  return out;
}

/** offlineProblems, then whether the local model really answers (only when the settings are right). */
export async function offlineReadiness(
  v: OfflineView,
  pingLocal: (signal: AbortSignal) => Promise<void>,
): Promise<OfflineProblem[]> {
  const problems = offlineProblems(v);
  if (problems.some((p) => p.part === 'Brain')) return problems;
  try {
    await pingLocal(AbortSignal.timeout(10_000));
  } catch (err) {
    problems.unshift({
      part: 'Brain',
      fix: `The local model isn't answering: ${errorMessage(err).slice(0, 200)} Start Ollama (or LM Studio) and check "${v.get('llm.local.model')}" is pulled.`,
    });
  }
  return problems;
}

/** Offline mode is on: Jarvis sends nothing to cloud brains, hearing or voices. */
export const isOffline = (settings: Pick<OfflineView, 'get'>): boolean =>
  settings.get('offline.enabled');

/**
 * While offline mode is on, a setting change that would put a part back in the cloud is refused
 * (Sir turns offline mode off first). Changes that keep everything on this PC go through.
 */
export function guardOfflineChange(v: OfflineView, key: SettingKey, value: unknown): void {
  if (!isOffline(v) || key === 'offline.enabled') return;
  const before = new Set(offlineProblems(v).map((p) => p.fix));
  const after: OfflineView = {
    ...v,
    get: <K extends SettingKey>(k: K): SettingValue<K> =>
      k === key ? (value as SettingValue<K>) : v.get(k),
  };
  const added = offlineProblems(after).find((p) => !before.has(p.fix));
  if (added)
    throw new JarvisError(
      'INVALID',
      `offline mode blocks ${key}`,
      `Offline mode is on. ${added.fix.split('. ')[0]}. Turn Offline mode off first (Settings → Privacy).`,
    );
}
