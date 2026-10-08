import { randomUUID } from 'node:crypto';
import { emit } from '../ipc/emit';
import { onSend } from '../ipc/handle';

/**
 * Compressed audio (Telegram's OGG/Opus voice notes, phone recordings) → 16 kHz mono samples for
 * on-device Whisper. Node has no Opus decoder, but Chromium does: the main window's renderer decodes
 * with an OfflineAudioContext and sends the samples back. No extra dependency, nothing leaves the PC.
 */
const pending = new Map<
  string,
  { resolve(s: Float32Array): void; reject(e: Error): void; timer: ReturnType<typeof setTimeout> }
>();
let registered = false;

export function decodeAudio(
  data: Uint8Array,
  mime: string,
  timeoutMs = 30_000,
): Promise<Float32Array> {
  if (!registered) {
    registered = true;
    onSend('audio:decoded', (p) => {
      const job = pending.get(p.id);
      if (!job) return;
      pending.delete(p.id);
      clearTimeout(job.timer);
      if (p.samples) job.resolve(new Float32Array(p.samples));
      else job.reject(new Error(p.error ?? 'Audio could not be decoded.'));
    });
  }
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Audio decoding timed out (is the Jarvis window running?).'));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    emit('audio:decode', { id, mime, data: new Uint8Array(data) });
  });
}
