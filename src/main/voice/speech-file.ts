import type { TtsChunk, TtsProvider } from './types';
import { wavHeader } from './wav';

/** A spoken reply as one file to send (Telegram): MP3 plays as a voice note, WAV as audio. */
export interface SpeechFile {
  mime: 'audio/mpeg' | 'audio/wav';
  data: Uint8Array;
}

/** The PCM samples and rate inside a WAV file (its 'fmt ' and 'data' chunks). */
function wavPcm(wav: Uint8Array): { rate: number; pcm: Uint8Array } | null {
  const b = Buffer.from(wav.buffer, wav.byteOffset, wav.byteLength);
  if (b.length < 12 || b.toString('ascii', 0, 4) !== 'RIFF') return null;
  let rate = 0;
  for (let at = 12; at + 8 <= b.length;) {
    const id = b.toString('ascii', at, at + 4);
    const size = b.readUInt32LE(at + 4);
    if (id === 'fmt ') rate = b.readUInt32LE(at + 12);
    if (id === 'data')
      return rate ? { rate, pcm: wav.subarray(at + 8, Math.min(b.length, at + 8 + size)) } : null;
    at += 8 + size + (size % 2);
  }
  return null;
}

/**
 * One voice's chunks → one file. MP3 sentences are simply joined (MP3 frames concatenate); WAV
 * sentences and streamed PCM become one WAV. Null when the chunks can't be joined (mixed formats or
 * sample rates), so the caller tries the next voice.
 */
export function packSpeech(chunks: TtsChunk[]): SpeechFile | null {
  const parts = chunks.filter((c) => c.data.length > 0);
  if (parts.length === 0) return null;
  if (parts.every((c) => c.mime === 'audio/mpeg'))
    return { mime: 'audio/mpeg', data: new Uint8Array(Buffer.concat(parts.map((c) => c.data))) };
  let rate = 0;
  const pcm: Uint8Array[] = [];
  for (const c of parts) {
    const piece =
      c.mime === 'audio/pcm'
        ? { rate: c.sampleRate ?? 24_000, pcm: c.data }
        : c.mime === 'audio/wav'
          ? wavPcm(c.data)
          : null;
    if (!piece || (rate && piece.rate !== rate)) return null;
    rate = piece.rate;
    pcm.push(piece.pcm);
  }
  const data = Buffer.concat(pcm);
  // 16-bit mono at the voice's own rate (wavHeader assumes 16-bit mono).
  return {
    mime: 'audio/wav',
    data: new Uint8Array(Buffer.concat([wavHeader(data.length, rate), data])),
  };
}

/** The reply in the first of `voices` that can say it (the chosen voice, then the backups). */
export async function speakToFile(
  text: string,
  voices: TtsProvider[],
  opts: { voice: string; rate: string; timeoutMs?: number },
): Promise<SpeechFile> {
  let lastErr: unknown = new Error('no voice is available');
  for (const v of voices) {
    try {
      const chunks: TtsChunk[] = [];
      for await (const c of v.synthesize(text, {
        voice: opts.voice,
        rate: opts.rate,
        signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
      }))
        chunks.push(c);
      const file = packSpeech(chunks);
      if (file) return file;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
