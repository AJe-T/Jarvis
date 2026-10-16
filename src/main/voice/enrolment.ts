import { nameVariants } from '@shared/assistant-name';
import { JarvisError } from '../errors';
import { GREETING, mentionsName } from './conversation';
import { buildProfile, encodeProfile } from './local/speaker';
import { buildTemplates, type PhraseFeatures, type WakeTemplates } from './local/personal-wake';

/**
 * ADR-039 Voice Match enrolment, like "Say 'Hey Google'" on a phone: Sir says "Hey <name>" a few
 * times. Each phrase becomes a voice fingerprint straight away (the audio itself is dropped), and
 * on-device speech, when downloaded, notes how it spells the name in his voice.
 */
export const ENROL_PHRASES = 5;
/** Shorter than this is a cough or a click, not "Hey Summer". */
const MIN_SECONDS = 0.5;
const MAX_ALIASES = 3;

/**
 * Spellings on-device speech heard instead of the name ("sumer" for Summer), heard at least twice
 * and not already caught by the near-spelling rule. Greeting words are dropped; at most two words.
 */
export function learnAliases(heard: string[], name: string): string[] {
  const names = nameVariants(name);
  const counts = new Map<string, number>();
  for (const text of heard) {
    if (!text || mentionsName(text, names)) continue;
    const words = text
      .toLowerCase()
      .split(/\s+/)
      .map((w) => w.replace(/[^\p{L}\p{N}']+/gu, ''))
      .filter((w) => w && !GREETING.has(w));
    const alias = words.join(' ');
    if (words.length === 0 || words.length > 2 || alias.replace(/\s/g, '').length < 4) continue;
    counts.set(alias, (counts.get(alias) ?? 0) + 1);
  }
  return [...counts]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_ALIASES)
    .map(([a]) => a);
}

export interface EnrolmentResult {
  threshold: number;
  aliases: string[];
  /** How well each phrase matched the others (0–1), shown so Sir can see the fit. */
  scores: number[];
  /** ADR-043: the phrases also became Sir's personal wake word. */
  wakeWord: boolean;
}

export function createEnrolment(deps: {
  /** One phrase from the microphone (16 kHz floats). */
  record(): Promise<Float32Array>;
  speakerReady(): boolean;
  embed(audio: Float32Array): Promise<Float32Array>;
  /** On-device speech, when downloaded; used to learn the spelling of the name. */
  transcribe?(audio: Float32Array): Promise<string>;
  /** ADR-043: the phrase as wake-word features; null when the wake-word model isn't downloaded. */
  wakeFeatures?(audio: Float32Array): Promise<PhraseFeatures | null>;
  /** null = no usable wake-word templates this time: drop any older ones. */
  saveWake?(templates: WakeTemplates | null): void;
  name(): string;
  save(profile: string, result: EnrolmentResult): void;
  now?(): number;
}) {
  let embeddings: Float32Array[] = [];
  let heard: string[] = [];
  let wake: PhraseFeatures[] = [];
  let busy = false;

  return {
    count: (): number => embeddings.length,

    /** Records and fingerprints one phrase. */
    async sample(): Promise<{ count: number; heard: string }> {
      if (!deps.speakerReady())
        throw new JarvisError(
          'INVALID',
          'speaker model not downloaded',
          'Download the voice recognition model first (Settings → Voice → Your voice).',
        );
      if (busy) throw new JarvisError('INVALID', 'already recording', 'Still recording.');
      busy = true;
      try {
        const audio = await deps.record();
        if (audio.length / 16000 < MIN_SECONDS)
          throw new JarvisError(
            'INVALID',
            'phrase too short',
            `I didn't catch that. Say “Hey ${deps.name()}” clearly, a little closer to the mic.`,
          );
        const [embedding, text, features] = await Promise.all([
          deps.embed(audio),
          deps.transcribe ? deps.transcribe(audio).catch(() => '') : Promise.resolve(''),
          deps.wakeFeatures ? deps.wakeFeatures(audio).catch(() => null) : Promise.resolve(null),
        ]);
        embeddings = [...embeddings, embedding];
        heard = [...heard, text];
        if (features) wake = [...wake, features];
        return { count: embeddings.length, heard: text };
      } finally {
        busy = false;
      }
    },

    /** Builds and saves the profile once enough phrases are in; clears the session. */
    finish(): EnrolmentResult {
      if (embeddings.length < ENROL_PHRASES)
        throw new JarvisError(
          'INVALID',
          'not enough phrases',
          `Say it ${ENROL_PHRASES - embeddings.length} more time(s) first.`,
        );
      const built = buildProfile(embeddings);
      const templates = deps.saveWake ? buildTemplates(wake) : null;
      const result: EnrolmentResult = {
        threshold: built.threshold,
        aliases: learnAliases(heard, deps.name()),
        scores: built.scores.map((s) => Math.round(s * 100) / 100),
        wakeWord: templates !== null,
      };
      deps.save(encodeProfile(built.centroid, embeddings.length, (deps.now ?? Date.now)()), result);
      // null: old templates (an earlier recording) must not outlive the new profile.
      deps.saveWake?.(templates);
      embeddings = [];
      heard = [];
      wake = [];
      return result;
    },

    cancel(): void {
      embeddings = [];
      heard = [];
      wake = [];
    },
  };
}

export type Enrolment = ReturnType<typeof createEnrolment>;
