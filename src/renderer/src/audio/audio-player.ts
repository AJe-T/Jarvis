import type { EventPayload } from '@shared/ipc-contract';
import { useAssistantStore } from '../stores/assistant-store';

type AudioEvent = EventPayload<'tts:audio'>;

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
      const copy = e.data.slice().buffer;
      let buffer: AudioBuffer;
      try {
        buffer = await ctx.decodeAudioData(copy);
      } catch {
        return; // a corrupt chunk is skipped rather than stalling the queue
      }
      if (gen !== this.generation) return;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(this.analyser as AnalyserNode);
      const at = Math.max(ctx.currentTime + 0.02, this.nextStart);
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
  chime(kind: 'listen' | 'cancel' | 'confirm'): void {
    const ctx = this.context();
    const notes = { listen: [660, 880], cancel: [520, 390], confirm: [700, 560] }[kind];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = 'sine';
      const t = ctx.currentTime + i * 0.11;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.08, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.13);
    });
  }
}

export const audioPlayer = new AudioPlayer();
