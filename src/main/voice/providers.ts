import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DeepgramClient } from '@deepgram/sdk';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { Porcupine, BuiltinKeyword } from '@picovoice/porcupine-node';
import { PvRecorder } from '@picovoice/pvrecorder-node';
import { JarvisError } from '../errors';
import { newId } from '../lib/util';
import { runPowerShell } from '../tools/powershell';
import { createOverrunMeter } from './diagnostics';
import { escapeSsml } from './speech/speech';
import { deepgramEvents } from './stt/deepgram-events';
import type { Recorder, SttProvider, SttSession, TtsChunk, TtsProvider, WakeWord } from './types';

// ── Speech to text: Deepgram live (API-Guide.md §9.2, verified against @deepgram/sdk 5.14.0) ─────────

type Handler = (...args: never[]) => void;

export function createDeepgramStt(getKey: () => string | undefined): SttProvider {
  return {
    id: 'deepgram',
    async start({ language, signal, endSilenceMs = 1000 }) {
      const apiKey = getKey();
      if (!apiKey)
        throw new JarvisError(
          'INVALID',
          'no deepgram key',
          'Add a Deepgram key in Settings → Voice.',
        );
      const client = new DeepgramClient({ apiKey });
      const socket = await client.listen.v1.connect({
        model: 'nova-3',
        language: language === 'auto' ? 'multi' : language,
        encoding: 'linear16',
        sample_rate: 16000,
        channels: 1,
        interim_results: 'true',
        // A short endpoint split "what's the weather… in London" into two requests.
        endpointing: endSilenceMs,
        utterance_end_ms: Math.max(1000, endSilenceMs),
        vad_events: 'true',
        smart_format: 'true',
        punctuate: 'true',
        abortSignal: signal,
        reconnectAttempts: 0,
        connectionTimeoutInSeconds: 5,
      });
      const handlers = new Map<string, Handler[]>();
      const fire = (event: string, ...args: unknown[]): void => {
        for (const h of handlers.get(event) ?? []) (h as (...a: unknown[]) => void)(...args);
      };
      const events = deepgramEvents(fire);
      socket.on('message', (msg) => events.message(msg));
      socket.on('error', (err) => events.error(err));
      socket.on('close', (e) => events.close(e.code));
      socket.connect();
      await socket.waitForOpen();
      const session: SttSession = {
        write: (frame) =>
          socket.sendMedia(new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength)),
        on: (event: string, cb: Handler) => {
          handlers.set(event, [...(handlers.get(event) ?? []), cb]);
        },
        async close() {
          events.ending();
          try {
            socket.sendCloseStream({ type: 'CloseStream' });
          } catch {
            // already closed
          }
          socket.close();
        },
      };
      return session;
    },
  };
}

// ── Text to speech ─────────────────────────────────────────────────────────────────────────────

/** Edge "Read Aloud" voices via msedge-tts (MIT). Unofficial endpoint, so callers fall back to SAPI. */
export function createEdgeTts(): TtsProvider {
  let tts: MsEdgeTTS | null = null;
  let configuredVoice = '';
  return {
    id: 'edge',
    async *synthesize(text, { voice, rate, signal }) {
      if (!tts || configuredVoice !== voice) {
        tts?.close();
        tts = new MsEdgeTTS();
        await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
        configuredVoice = voice;
      }
      const { audioStream } = tts.toStream(escapeSsml(text), rate ? { rate } : {});
      const parts: Buffer[] = [];
      const onAbort = (): void => {
        audioStream.destroy();
      };
      signal.addEventListener('abort', onAbort, { once: true });
      try {
        for await (const chunk of audioStream as AsyncIterable<Buffer>) parts.push(chunk);
      } finally {
        signal.removeEventListener('abort', onAbort);
      }
      if (signal.aborted) return;
      if (parts.length === 0) throw new Error('Edge TTS returned no audio');
      // One decodable MP3 per sentence keeps playback gapless enough and simple.
      yield { mime: 'audio/mpeg', data: new Uint8Array(Buffer.concat(parts)) } satisfies TtsChunk;
    },
  };
}

/** Fully offline fallback: Windows System.Speech (API-Guide.md §9.3). */
export function createSapiTts(): TtsProvider {
  return {
    id: 'sapi',
    async *synthesize(text, { signal, rate }) {
      const out = path.join(tmpdir(), `jarvis-tts-${newId()}.wav`);
      const rateNum = Math.max(
        -10,
        Math.min(10, Math.round(Number.parseInt(rate ?? '0', 10) / 10) || 0),
      );
      const script = `Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
try { $s.SelectVoiceByHints([System.Speech.Synthesis.VoiceGender]::Male, [System.Speech.Synthesis.VoiceAge]::Adult, 0, [Globalization.CultureInfo]'en-GB') } catch {}
$s.Rate = [int]$P.rate
$s.SetOutputToWaveFile($P.out); $s.Speak([string]$P.text); $s.Dispose()`;
      try {
        const r = await runPowerShell(script, {
          params: { out, text, rate: rateNum },
          signal,
          timeoutMs: 30_000,
        });
        if (r.exitCode !== 0) throw new Error(r.stderr || 'SAPI failed');
        yield { mime: 'audio/wav', data: new Uint8Array(await readFile(out)) } satisfies TtsChunk;
      } finally {
        await rm(out, { force: true });
      }
    },
  };
}

// ── Microphone + wake word (main process only, ADR-007) ────────────────────────────────────────

export const FRAME_LENGTH = 512;

/** Phase 0 diagnostics for the native recorder. */
export interface PvRecorderHooks {
  /** Frames PvRecorder lost because the mic loop read too slowly (estimated, see createOverrunMeter). */
  onOverrun?(frames: number): void;
  /** The device that actually opened. */
  onStart?(device: string): void;
  /** PvRecorder's own debug output (buffer overflows) on stderr. */
  debug?: boolean;
}

export function createPvRecorder(
  deviceIndex: number,
  frameLength = FRAME_LENGTH,
  hooks: PvRecorderHooks = {},
): Recorder {
  const rec = new PvRecorder(frameLength, deviceIndex);
  const overrun = createOverrunMeter(frameLength);
  return {
    frameLength,
    start: () => {
      if (hooks.debug) rec.setDebugLogging(true);
      rec.start();
      overrun.start();
      hooks.onStart?.(rec.getSelectedDevice());
    },
    stop: () => rec.stop(),
    read: async () => {
      const t = performance.now();
      const frame = await rec.read();
      const lost = overrun.frame(performance.now() - t);
      if (lost > 0) hooks.onOverrun?.(lost);
      return frame;
    },
    release: () => rec.release(),
    get isRecording() {
      return rec.isRecording;
    },
  };
}

export function listAudioDevices(): string[] {
  return PvRecorder.getAvailableDevices();
}

export function createPorcupine(accessKey: string, sensitivity: number): WakeWord {
  const p = new Porcupine(accessKey, [BuiltinKeyword.JARVIS], [sensitivity]);
  return {
    frameLength: p.frameLength,
    process: (frame) => p.process(frame) >= 0,
    reset: () => undefined, // Porcupine keeps no phrase between frames worth clearing
    release: () => p.release(),
  };
}
