import { TTS_ENGINES } from '@shared/speech-engines';
import type { EventChannel } from '@shared/ipc-channels';
import type { EventPayload } from '@shared/ipc-contract';
import { errorMessage, JarvisError } from '../errors';
import type { Transcriber } from './local/whisper';
import type { TtsProvider } from './types';

/**
 * AI Router Phase 3: the voice backup chain. When a speech engine fails or hits its limit, the
 * next one takes over, and Sir is told which one is in use every time it changes (no silent
 * switching). Speaking: Kokoro → Edge → ElevenLabs → Windows (reply text only). Hearing: Whisper on
 * this PC → Groq → OpenAI, only when Sir switched it on (pool.abilities.voiceHearing): that sends
 * his recorded voice out.
 */

export type EngineKind = 'hearing' | 'speaking';
export type EngineReport = (kind: EngineKind, name: string, why?: string) => void;

export const ttsName = (id: string): string =>
  ({ kokoro: 'Kokoro on this PC', edge: 'Edge voices', sapi: 'Windows voice' })[id] ??
  TTS_ENGINES.find((e) => e.id === id)?.title ??
  id;

/** The reason a failed engine gives, short and readable. */
export const whyOf = (err: unknown): string =>
  err instanceof JarvisError && err.userMessage ? err.userMessage : errorMessage(err).slice(0, 120);

/**
 * Tells Sir (a notice) and the AI Router page which engine is in use, only when it changes. The
 * first engine of a run is the chosen one and needs no notice.
 */
export function createEngineReporter(deps: {
  engines: Record<EngineKind, string | null>;
  emit<E extends EventChannel>(event: E, payload: EventPayload<E>): void;
}): EngineReport {
  return (kind, name, why) => {
    const before = deps.engines[kind];
    if (before === name) return;
    deps.engines[kind] = name;
    if (before === null && !why) return;
    const verb = kind === 'hearing' ? 'Hearing' : 'Speaking';
    deps.emit('notify', {
      level: why ? 'warn' : 'info',
      message: why ? `${verb} with ${name} now (${why}).` : `${verb} with ${name} again.`,
      action: 'settings:voice',
    });
  };
}

/** Voices tried after the chosen one. Backup on: Kokoro, Edge, ElevenLabs, Windows (as set up). */
export function speakingFallbacks(
  primary: string,
  f: { edge: TtsProvider; sapi: TtsProvider; kokoro?: TtsProvider; elevenlabs?: TtsProvider },
  backup: boolean,
): TtsProvider[] {
  if (!backup) return primary === 'sapi' ? [] : primary === 'edge' ? [f.sapi] : [f.edge, f.sapi];
  return [f.kokoro, f.edge, f.elevenlabs, f.sapi].filter(
    (p): p is TtsProvider => p !== undefined && p.id !== primary,
  );
}

/**
 * Hearing chain: each phrase goes to the first engine that answers. A cloud step is only in the
 * list when Sir switched cloud hearing on and its key is set (voice-system.ts builds the list).
 */
export function hearingChain(
  steps: Array<{ name: string; t: Transcriber }>,
  report: EngineReport,
): Transcriber {
  return {
    async transcribe(audio, language) {
      let why: string | undefined;
      let last: Error = new Error('no speech engine');
      for (const [i, step] of steps.entries()) {
        try {
          const text = await step.t.transcribe(audio, language);
          report('hearing', step.name, i > 0 ? why : undefined);
          return text;
        } catch (err) {
          last = err instanceof Error ? err : new Error(String(err));
          why = `${step.name}: ${whyOf(err)}`;
        }
      }
      throw last;
    },
    release: async () => {
      await Promise.all(steps.map((s) => s.t.release()));
    },
  };
}
