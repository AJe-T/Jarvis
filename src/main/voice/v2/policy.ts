import type { ModelId } from '../local/model-store';

/**
 * Voice v2's fixed choices, picked from measurements (tests/integration/voice-bench.real.test.ts on
 * Edge neural voices incl. Indian English, clean / quiet / noisy / quiet + auto gain), not from a
 * settings matrix. Change them only with a new bench run.
 */

/**
 * On-device speech models in order of preference; the first one downloaded is used. Bench 2026-10-29
 * (24 commands, 4 voices incl. Indian English; word errors clean / noisy, time per command on this
 * laptop): moonshine-base 5 % / 14 %, 0.4 s; whisper-base.en 5 % / 8 %, 1–2.4 s; distil-small.en
 * 6 % / 13 %, 2.5–4 s; whisper-small.en 0 % / 9 %, 5 s; parakeet-ctc 20 % / 30 %; Windows speech
 * failed every clip. Deepgram (when its key is set) is used before any of these.
 */
export const V2_LOCAL_STT: readonly ModelId[] = [
  'moonshine-base',
  'whisper-base.en',
  'whisper-small.en',
];

/** What "Set up on-device speech" downloads for v2 (voice detector, speech model, both wake words). */
export const V2_SETUP_MODELS: readonly ModelId[] = [
  'silero-vad',
  'moonshine-base',
  'kws-zipformer-en',
  'openwakeword-hey-jarvis',
];

/**
 * Wake sensitivity v2 uses for both engines together (Settings' slider is classic-only). Bench
 * 2026-10-29, 12 wake clips ("Hey Jarvis", "Hey Jarvis!", "Jarvis" x 4 voices) and 36 other phrases:
 * at 0.8 both together heard every "Hey Jarvis" clean, quiet, noisy and with auto gain (11/12 incl. the
 * bare name) and fired falsely only on "Hey Travis" (0-2/36); at 0.6, 9-10/12 with 0-1 false. The
 * spotter alone heard 4-8/12 (it misses quiet speech); openWakeWord alone 7-10/12.
 */
export const V2_WAKE_SENSITIVITY = 0.8;

/** The first preferred on-device model that is downloaded, or null. */
export function v2LocalModel(installed: (id: ModelId) => boolean): ModelId | null {
  return V2_LOCAL_STT.find((id) => installed(id)) ?? null;
}
