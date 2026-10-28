import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { open, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Logger } from '../logging/logger';
import { wavHeader } from './wav';

const SAMPLE_RATE = 16_000;
/** Drop and timing summaries are logged at most this often. */
export const REPORT_MS = 10_000;
/** A debug recording is split into a new file after this long (10 min ≈ 19 MB). */
const MAX_FILE_BYTES = 10 * 60 * SAMPLE_RATE * 2;

/**
 * Where a frame was lost: the capture window's queue overflowed, a frame of the wrong length
 * arrived, the early buffer (audio before speech-to-text connected) was full, or the native
 * recorder overran because the mic loop read too slowly, or the audio worker fell behind on wake
 * frames (backlog).
 */
export type DropReason = 'queue' | 'length' | 'early' | 'overrun' | 'backlog';
/** What the frames in a debug recording were fed to. */
export type TapKind = 'stt' | 'wake' | 'ambient';

export interface AudioTap {
  write(frame: Int16Array): void;
  close(): void;
}

interface DropWindow {
  total: number;
  window: number;
  first: number;
  firstAt: number;
  lastAt: number;
}

interface Timing {
  n: number;
  sum: number;
  min: number;
  max: number;
  from: number;
}

const iso = (t: number): string => new Date(t).toISOString();
const fileStamp = (t: number): string => iso(t).replace(/[:.]/g, '-');

/**
 * Phase 0 voice diagnostics. Always counts dropped frames and times inference; with
 * `voice.debugAudio` on it also records the exact frames each engine was given as 16 kHz mono WAV
 * files (Security.md §9: Sir's voice, on this PC only, deleted at the next start once switched off).
 */
export function createVoiceDiagnostics(opts: {
  dir: string;
  enabled(): boolean;
  logger: Logger;
  now?(): number;
}) {
  const now = opts.now ?? Date.now;
  const log = opts.logger.child({ module: 'voice.diag' });
  const drops = new Map<DropReason, DropWindow>();
  const timings = new Map<string, Timing>();
  let seq = 0;

  function reportDrops(reason: DropReason, d: DropWindow): void {
    // The first drop of a window was logged when it happened; only report what came after it.
    if (d.window > d.first)
      log.warn(
        { reason, frames: d.window, from: iso(d.firstAt), to: iso(d.lastAt), total: d.total },
        'audio frames dropped (10 s summary)',
      );
    d.window = 0;
  }

  function reportTiming(label: string, t: Timing): void {
    if (t.n > 0)
      log.info(
        {
          label,
          calls: t.n,
          minMs: Math.round(t.min * 100) / 100,
          avgMs: Math.round((t.sum / t.n) * 100) / 100,
          maxMs: Math.round(t.max * 100) / 100,
          windowMs: now() - t.from,
        },
        'audio timing',
      );
    timings.set(label, { n: 0, sum: 0, min: Infinity, max: 0, from: now() });
  }

  /** One debug recording, split into ~10 min files. */
  function openTap(kind: TapKind): AudioTap {
    let stream: WriteStream | null = null;
    let file = '';
    let bytes = 0;
    let closed = false;

    function finish(): void {
      const s = stream;
      const f = file;
      const size = bytes;
      stream = null;
      if (!s) return;
      // The header was written with a zero length; patch in the real one once the data is on disk.
      s.end(() => {
        void open(f, 'r+')
          .then(async (h) => {
            try {
              await h.write(wavHeader(size, SAMPLE_RATE), 0, 44, 0);
            } finally {
              await h.close();
            }
          })
          .catch((err: unknown) => log.warn({ err: String(err) }, 'debug recording not finished'));
      });
    }

    function start(): WriteStream | null {
      try {
        mkdirSync(opts.dir, { recursive: true });
      } catch (err) {
        log.warn({ err: String(err) }, 'debug recording folder could not be made');
        closed = true;
        return null;
      }
      file = join(opts.dir, `${fileStamp(now())}-${kind}-${++seq}.wav`);
      bytes = 0;
      const s = createWriteStream(file);
      s.on('error', (err) => {
        log.warn({ err: String(err) }, 'debug recording failed');
        closed = true;
      });
      s.write(wavHeader(0, SAMPLE_RATE));
      log.info({ file, kind }, 'debug recording started');
      return s;
    }

    return {
      write(frame) {
        if (closed) return;
        if (stream && bytes >= MAX_FILE_BYTES) finish();
        stream ??= start();
        if (!stream) return;
        stream.write(Buffer.from(new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength)));
        bytes += frame.byteLength;
      },
      close() {
        closed = true;
        finish();
      },
    };
  }

  return {
    /** A debug recording of the frames fed to one engine, or null when `voice.debugAudio` is off. */
    tap(kind: TapKind): AudioTap | null {
      return opts.enabled() ? openTap(kind) : null;
    },

    /** Counts lost frames: the first of each 10 s window is logged at once, the rest as a summary. */
    drop(reason: DropReason, frames = 1): void {
      const t = now();
      const d = drops.get(reason) ?? { total: 0, window: 0, first: 0, firstAt: 0, lastAt: 0 };
      drops.set(reason, d);
      if (d.window > 0 && t - d.firstAt >= REPORT_MS) reportDrops(reason, d);
      if (d.window === 0) {
        d.first = frames;
        d.firstAt = t;
        log.warn({ reason, frames, at: iso(t), total: d.total + frames }, 'audio frames dropped');
      }
      d.window += frames;
      d.total += frames;
      d.lastAt = t;
    },

    /** Records one duration (ms) under `label`; min / avg / max are logged every 10 s. */
    timer(label: string): (ms: number) => void {
      return (ms) => {
        let t = timings.get(label);
        if (!t) {
          t = { n: 0, sum: 0, min: Infinity, max: 0, from: now() };
          timings.set(label, t);
        }
        if (t.n > 0 && now() - t.from >= REPORT_MS) {
          reportTiming(label, t);
          t = timings.get(label) ?? t;
        }
        t.n++;
        t.sum += ms;
        t.min = Math.min(t.min, ms);
        t.max = Math.max(t.max, ms);
      };
    },

    /** Frames lost so far, by reason (Phase 1B's check that the audio worker drops none). */
    totals(): Record<DropReason, number> {
      return {
        queue: drops.get('queue')?.total ?? 0,
        length: drops.get('length')?.total ?? 0,
        early: drops.get('early')?.total ?? 0,
        overrun: drops.get('overrun')?.total ?? 0,
        backlog: drops.get('backlog')?.total ?? 0,
      };
    },

    /** Logs what the current windows hold (the microphone closed). */
    flush(): void {
      for (const [reason, d] of drops) if (d.window > 0) reportDrops(reason, d);
      for (const [label, t] of timings) reportTiming(label, t);
    },

    /** Deletes old debug recordings (at start, when `voice.debugAudio` is off). */
    async clear(): Promise<void> {
      await rm(opts.dir, { recursive: true, force: true });
    },
  };
}

export type VoiceDiagnostics = ReturnType<typeof createVoiceDiagnostics>;

/**
 * Counts native-recorder overruns from timing alone (PvRecorder drops samples silently when its
 * buffer fills). On a read that had to wait for audio the loop is caught up, so wall time minus
 * audio time is fixed latency plus whatever was lost; growth of it since the first such read is
 * lost audio. ponytail: the sound card's clock drifts from the PC's (~0.01 %), which reads as about
 * one lost frame every few minutes; fine for diagnostics, not an exact count.
 */
export function createOverrunMeter(
  frameLength: number,
  now: () => number = () => performance.now(),
) {
  const frameMs = (frameLength / SAMPLE_RATE) * 1000;
  let startedAt = 0;
  let samples = 0;
  let base: number | null = null;
  let lost = 0;
  return {
    start(): void {
      startedAt = now();
      samples = 0;
      base = null;
      lost = 0;
    },
    /** After each read (`waitedMs` = how long read() took): frames newly lost since the last call. */
    frame(waitedMs: number): number {
      samples += frameLength;
      // A read served from the recorder's backlog says nothing: the loop is behind, not losing yet.
      if (waitedMs < frameMs / 2) return 0;
      const drift = now() - startedAt - (samples / SAMPLE_RATE) * 1000;
      if (base === null || drift < base) {
        base = drift;
        return 0;
      }
      const total = Math.floor((drift - base) / frameMs);
      if (total <= lost) return 0;
      const fresh = total - lost;
      lost = total;
      return fresh;
    },
  };
}
