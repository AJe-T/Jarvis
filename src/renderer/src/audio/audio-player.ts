import type { EventPayload } from '@shared/ipc-contract';
import { useAssistantStore } from '../stores/assistant-store';

type AudioEvent = EventPayload<'tts:audio'>;

export type ChimeKind = 'listen' | 'cancel' | 'confirm' | 'thinking';
export type ChimeLevel = 'soft' | 'normal' | 'loud';

/** Peak gain per Settings → Voice → Chime volume (0.08 before v2.62, easy to miss). */
export const CHIME_PEAK: Record<ChimeLevel, number> = { soft: 0.12, normal: 0.3, loud: 0.55 };

/**
 * On and off must be told apart without looking: listening rises over three notes ("da-da-DING"),
 * stopping falls over two ("dum-dum"). `scale` keeps the thinking tick quieter than the cues.
 */
export const CHIMES: Record<
  ChimeKind,
  { notes: number[]; gap: number; length: number; scale: number }
> = {
  listen: { notes: [660, 880, 1320], gap: 0.1, length: 0.18, scale: 1 },
  cancel: { notes: [660, 392], gap: 0.16, length: 0.24, scale: 1 },
  confirm: { notes: [700, 560], gap: 0.12, length: 0.16, scale: 0.8 },
  // "Got it, working on it": one low note, so a slow reply doesn't feel like silence.
  thinking: { notes: [440], gap: 0, length: 0.14, scale: 0.4 },
};

/** Head start before streamed PCM starts playing (and after any underrun). */
const PCM_LEAD_S = 0.12;

/** 16-bit little-endian mono samples → an AudioBuffer (no decoding: there is no container). */
export function pcmBuffer(
  ctx: Pick<BaseAudioContext, 'createBuffer'>,
  bytes: Uint8Array,
  sampleRate: number,
): AudioBuffer {
  const n = Math.max(1, bytes.length >> 1);
  const buffer = ctx.createBuffer(1, n, sampleRate);
  const out = buffer.getChannelData(0);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < bytes.length >> 1; i++) out[i] = view.getInt16(i * 2, true) / 32768;
  return buffer;
}

/**
 * Plays TTS chunks from main in order (Web Audio queue). Reports "started"/"finished" per utterance
 * so main can drive SPEAKING → IDLE, and feeds the output level to the orb (≤ 20 Hz).
 */
class AudioPlayer {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private chain: Promise<void> = Promise.resolve();
  private playing = new Set<AudioBufferSourceNode>();
  private startedUtterances = new Set<string>();
  private nextStart = 0;
  private generation = 0;
  private levelTimer: ReturnType<typeof setInterval> | null = null;

  private context(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  enqueue(e: AudioEvent): void {
    const gen = this.generation;
    // Decode in arrival order; schedule each buffer right after the previous one.
    this.chain = this.chain.then(async () => {
      if (gen !== this.generation) return;
      if (e.last) {
        await this.whenDrained(gen);
        if (gen === this.generation)
          window.jarvis.send['tts:playback']({ utteranceId: e.utteranceId, event: 'finished' });
        return;
      }
      const ctx = this.context();
      if (ctx.state === 'suspended') await ctx.resume();
      let buffer: AudioBuffer;
      if (e.mime === 'audio/pcm') {
        buffer = pcmBuffer(ctx, e.data, e.sampleRate ?? 24_000);
      } else {
        try {
          buffer = await ctx.decodeAudioData(e.data.slice().buffer);
        } catch {
          return; // a corrupt chunk is skipped rather than stalling the queue
        }
      }
      if (gen !== this.generation) return;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(this.analyser as AnalyserNode);
      // Streamed PCM (voice fix 2B) arrives in small pieces: a short head start absorbs network
      // jitter, then each piece is scheduled sample-exactly after the last, with no gap or click.
      const lead = e.mime === 'audio/pcm' && this.nextStart <= ctx.currentTime ? PCM_LEAD_S : 0.02;
      const at = Math.max(ctx.currentTime + lead, this.nextStart);
      src.start(at);
      this.nextStart = at + buffer.duration;
      this.playing.add(src);
      src.onended = () => this.playing.delete(src);
      if (!this.startedUtterances.has(e.utteranceId)) {
        this.startedUtterances.add(e.utteranceId);
        window.jarvis.send['tts:playback']({ utteranceId: e.utteranceId, event: 'started' });
      }
      this.trackLevel();
    });
  }

  private whenDrained(gen: number): Promise<void> {
    return new Promise((resolve) => {
      const check = (): void => {
        if (gen !== this.generation || !this.ctx || this.ctx.currentTime >= this.nextStart - 0.01)
          resolve();
        else setTimeout(check, 50);
      };
      check();
    });
  }

  private trackLevel(): void {
    if (this.levelTimer) return;
    const data = new Uint8Array(256);
    this.levelTimer = setInterval(() => {
      if (!this.analyser || this.playing.size === 0) {
        useAssistantStore.getState().setOutLevel(0);
        if (this.levelTimer) clearInterval(this.levelTimer);
        this.levelTimer = null;
        return;
      }
      this.analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += ((v - 128) / 128) ** 2;
      useAssistantStore.getState().setOutLevel(Math.sqrt(sum / data.length));
    }, 50);
  }

  /** Barge-in / kill switch: silence immediately (Design target: < 200 ms). */
  stop(): void {
    this.generation++;
    for (const src of this.playing) {
      try {
        src.stop();
      } catch {
        // already stopped
      }
    }
    this.playing.clear();
    this.nextStart = 0;
    this.chain = Promise.resolve();
    useAssistantStore.getState().setOutLevel(0);
  }

  /** Short UI chimes (Design-system.md §7), synthesised so no sound files ship. */
  chime(kind: ChimeKind, level: ChimeLevel = 'loud'): void {
    const ctx = this.context();
    const { notes, gap, length, scale } = CHIMES[kind];
    const peak = CHIME_PEAK[level] * scale;
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      // Triangle: brighter than a sine, so it cuts through music and room noise.
      osc.type = 'triangle';
      const t = ctx.currentTime + i * gap;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(peak, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + length + 0.01);
    });
  }
}

export const audioPlayer = new AudioPlayer();
