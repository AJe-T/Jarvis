import type { WakeWord } from '../types';

/** What one voice check found (Settings → Voice → Check my voice). */
export interface VoiceCheckResult {
  /** Something louder than the room was recorded. */
  recorded: boolean;
  /** What speech recognition made of it. */
  heard: string;
  /** Which engine heard it. */
  engine: string;
  /** Did the wake word fire on this recording? (null when it isn't set up) */
  wake: boolean | null;
  /** Speech level, dB of full scale (−20 is ideal, below −40 is too quiet). */
  levelDb: number;
  /** Time speech recognition took. */
  ms: number;
  /** One line of what to do, '' when all is well. */
  advice: string;
}

const db = (x: number): number => Math.round(20 * Math.log10(Math.max(1e-6, x)));

/** The level of the loud part of a recording (the louder half of its 20 ms windows). */
export function speechLevelDb(audio: Float32Array): number {
  const win = 320;
  const levels: number[] = [];
  for (let at = 0; at + win <= audio.length; at += win) {
    let s = 0;
    for (let i = at; i < at + win; i++) s += (audio[i] ?? 0) ** 2;
    levels.push(Math.sqrt(s / win));
  }
  if (levels.length === 0) return -120;
  levels.sort((a, b) => b - a);
  const top = levels.slice(0, Math.max(1, Math.ceil(levels.length / 2)));
  return db(Math.sqrt(top.reduce((a, b) => a + b * b, 0) / top.length));
}

/** Runs a recording (padded with silence) through a wake engine; true if it fired. */
export async function wakeHears(wake: WakeWord, audio: Float32Array): Promise<boolean> {
  const padded = new Float32Array(8000 + audio.length + 16000);
  padded.set(audio, 8000);
  const n = wake.frameLength;
  let heard = false;
  for (let at = 0; at + n <= padded.length; at += n) {
    const frame = Int16Array.from(padded.subarray(at, at + n), (x) =>
      Math.round(Math.max(-1, Math.min(1, x)) * 32767),
    );
    if (await wake.process(frame)) heard = true;
  }
  return heard;
}

/** The one thing Sir should fix first, from the check's findings. */
export function adviceFor(r: Omit<VoiceCheckResult, 'advice'>, name: string): string {
  if (!r.recorded)
    return 'Nothing was heard. Check the microphone chosen above and that Windows lets apps use it (Settings → Privacy → Microphone).';
  if (r.levelDb < -42)
    return 'Your voice is very quiet. Move closer, or raise the microphone level in Windows (Sound settings → Input → Volume).';
  if (!r.heard.trim())
    return 'The recording had sound but no words were recognised. Speak a little slower and closer.';
  if (r.wake === false && /jarvis|hey/i.test(r.heard))
    return `Speech is fine, but the wake word didn't fire. Say "Hey ${name}" as one smooth phrase, then check again.`;
  if (r.ms > 4000)
    return 'Recognition is slow on this PC. A Deepgram key (Settings → Voice) makes it near-instant.';
  return '';
}
