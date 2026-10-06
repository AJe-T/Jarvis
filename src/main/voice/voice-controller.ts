import type { EventPayload } from '@shared/ipc-contract';
import type { EventChannel } from '@shared/ipc-channels';
import type { VoiceMode } from '@shared/types';
import type { AssistantStateHub } from '../agent/assistant-state';
import type { Orchestrator, TurnInfo } from '../agent/orchestrator';
import { errorMessage } from '../errors';
import type { Logger } from '../logging/logger';
import type { KillSwitch } from '../security/kill-switch';
import type { SettingsService } from '../settings/settings-service';
import type { ConfirmationBroker, ConfirmRequestEvent } from '../tools/confirmation-broker';
import { Utterance } from './tts-pipeline';
import {
  rms,
  type Recorder,
  type SttProvider,
  type SttSession,
  type TtsProvider,
  type WakeWord,
} from './types';

export interface VoiceFactories {
  recorder(deviceIndex: number, frameLength: number): Recorder;
  wake(accessKey: string, sensitivity: number): WakeWord;
  stt: SttProvider;
  edge: TtsProvider;
  sapi: TtsProvider;
}

export interface VoiceDeps {
  settings: SettingsService;
  secret(name: string): string | undefined;
  state: AssistantStateHub;
  orchestrator: Orchestrator;
  broker: ConfirmationBroker;
  killSwitch: KillSwitch;
  emit<E extends EventChannel>(event: E, payload: EventPayload<E>): void;
  logger: Logger;
  factories: VoiceFactories;
  activeConversation(): string | undefined;
  /** Overridable for tests. */
  timeouts?: { silenceMs?: number; maxListenMs?: number };
}

const SILENCE_TIMEOUT_MS = 8_000;
const MAX_LISTEN_MS = 30_000;
const LEVEL_INTERVAL_MS = 50; // ≤ 20 Hz (Code-style.md §5)
const METER_MS = 5_000;

const CANCEL_PHRASES = /^(stop|cancel|never ?mind|forget it|that's all|nothing)[.!]?$/i;
const STOP_EVERYTHING = /^(jarvis,? )?stop everything[.!]?$/i;
const SLEEP_PHRASES = /^(jarvis,? )?(go to sleep|stop listening|sleep)[.!]?$/i;
const YES = /^(yes|yeah|yep|go ahead|do it|confirm|sure|okay|ok|please do)\b/i;
const NO = /^(no|nope|cancel|stop|don't|do not|negative)\b/i;

/** First letter lower-case so prompts read naturally ("Shall I create folder…"). */
const lc = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * Architecture.md §8 voice state machine (main process only, ADR-007). Owns mic capture, wake word,
 * STT sessions, barge-in, spoken replies and spoken confirmations.
 */
export function createVoiceController(d: VoiceDeps) {
  const log = d.logger.child({ module: 'voice' });
  let recorder: Recorder | null = null;
  let wake: WakeWord | null = null;
  let loopRunning = false;
  let listening: {
    session: SttSession | null;
    abort: AbortController;
    silence?: ReturnType<typeof setTimeout>;
    max?: ReturnType<typeof setTimeout>;
    heard: boolean;
    retried: boolean;
  } | null = null;
  let meterUntil = 0;
  let sleeping = false;
  let speaking: Utterance | null = null;
  let fallbackWarned = false;
  const voiceTurns = new Map<string, Utterance>();
  const timings: {
    wakeAt?: number | undefined;
    eosAt?: number | undefined;
    finalAt?: number | undefined;
  } = {};

  const mode = (): VoiceMode => d.settings.get('voice.mode');

  // ── TTS ─────────────────────────────────────────────────────────────────────────────────
  function newUtterance(extractSpoken: boolean, id?: string): Utterance {
    return new Utterance(
      {
        primary: () =>
          d.settings.get('voice.tts.provider') === 'sapi' ? d.factories.sapi : d.factories.edge,
        fallback: d.factories.sapi,
        voice: () => d.settings.get('voice.tts.voice'),
        rate: () => d.settings.get('voice.tts.rate'),
        emitAudio: (p) => d.emit('tts:audio', p),
        emitStop: (utteranceId) => d.emit('tts:stop', utteranceId ? { utteranceId } : {}),
        onFallback: () => {
          if (fallbackWarned) return;
          fallbackWarned = true;
          d.emit('notify', {
            level: 'warn',
            message: 'Online voice unavailable; using the Windows voice for now.',
          });
        },
        onFirstAudio: () => {
          if (timings.finalAt)
            log.info(
              { finalToFirstAudioMs: Date.now() - timings.finalAt },
              'latency: final transcript → first audio',
            );
          timings.finalAt = undefined;
        },
        logger: log,
      },
      { extractSpoken, ...(id ? { id } : {}) },
    );
  }

  function say(text: string): Utterance {
    stopSpeaking();
    const u = newUtterance(false);
    speaking = u;
    u.push(text);
    u.end();
    return u;
  }

  function stopSpeaking(): void {
    speaking?.stop();
    speaking = null;
    for (const u of voiceTurns.values()) u.stop();
    voiceTurns.clear();
    if (d.state.get() === 'SPEAKING') d.state.set('IDLE');
  }

  // ── mic loop ────────────────────────────────────────────────────────────────────────────
  function needRecorder(): boolean {
    return (
      (mode() === 'wake' && !sleeping && wake !== null) ||
      listening !== null ||
      Date.now() < meterUntil
    );
  }

  function ensureRecorder(): void {
    if (recorder) return;
    recorder = d.factories.recorder(d.settings.get('voice.deviceIndex'), wake?.frameLength ?? 512);
    recorder.start();
    void loop();
  }

  function releaseRecorder(): void {
    if (!recorder) return;
    try {
      recorder.stop();
      recorder.release();
    } catch {
      // device already gone
    }
    recorder = null;
  }

  async function loop(): Promise<void> {
    if (loopRunning) return;
    loopRunning = true;
    let lastLevel = 0;
    try {
      while (recorder && needRecorder()) {
        const frame = await recorder.read();
        const now = Date.now();
        if (now - lastLevel >= LEVEL_INTERVAL_MS) {
          lastLevel = now;
          d.emit('voice:level', { rms: rms(frame) });
        }
        if (listening) listening.session?.write(frame);
        else if (wake && mode() === 'wake' && !sleeping && wake.process(frame)) onWake();
      }
    } catch (err) {
      log.warn({ err: errorMessage(err) }, 'microphone read failed');
      d.emit('notify', {
        level: 'error',
        message: 'The microphone stopped working. Check it is plugged in.',
        action: 'settings:voice',
      });
      cancelListening();
    } finally {
      loopRunning = false;
      releaseRecorder();
      d.emit('voice:level', { rms: 0 });
    }
  }

  // ── listening ───────────────────────────────────────────────────────────────────────────
  function onWake(): void {
    timings.wakeAt = Date.now();
    void startListening(false);
  }

  async function startListening(isRetry: boolean): Promise<void> {
    if (listening) return;
    if (!d.secret('deepgram')) {
      d.emit('notify', {
        level: 'warn',
        message: 'Add a Deepgram key to use voice input.',
        action: 'settings:voice',
      });
      return;
    }
    const s = d.state.get();
    if (s === 'THINKING' || s === 'ACTING') {
      // Barge-in on a reply that is still being written: stop it and listen to Sir instead.
      d.orchestrator.cancel();
    }
    stopSpeaking();
    sleeping = false;
    const abort = new AbortController();
    listening = { session: null, abort, heard: false, retried: isRetry };
    d.state.set('LISTENING');
    if (timings.wakeAt)
      log.info({ wakeToListeningMs: Date.now() - timings.wakeAt }, 'latency: wake → listening');
    timings.wakeAt = undefined;
    d.emit('voice:transcript', { text: '', isFinal: false });
    ensureRecorder();
    const current = listening;
    current.silence = setTimeout(() => {
      if (!current.heard) cancelListening();
    }, d.timeouts?.silenceMs ?? SILENCE_TIMEOUT_MS);
    current.max = setTimeout(() => cancelListening(), d.timeouts?.maxListenMs ?? MAX_LISTEN_MS);
    try {
      const session = await d.factories.stt.start({
        sampleRate: 16000,
        language: d.settings.get('voice.stt.language'),
        signal: abort.signal,
      });
      if (listening !== current) {
        await session.close();
        return;
      }
      current.session = session;
      session.on('speechStarted', () => (current.heard = true));
      session.on('partial', (text) => {
        if (text) current.heard = true;
        timings.eosAt = Date.now();
        d.emit('voice:transcript', { text, isFinal: false });
      });
      session.on('final', (text) => void onFinal(current, text));
      session.on('utteranceEnd', () => {
        if (current.heard && listening === current) void onFinal(current, '');
      });
      session.on('error', (err) => {
        log.warn({ err: errorMessage(err) }, 'speech-to-text error');
        d.emit('notify', {
          level: 'error',
          message: 'Speech recognition failed. You can type instead.',
          action: 'settings:voice',
        });
        cancelListening();
      });
    } catch (err) {
      log.warn({ err: errorMessage(err) }, 'speech-to-text connect failed');
      d.emit('notify', {
        level: 'error',
        message: "Couldn't reach the speech service. You can type instead.",
        action: 'settings:voice',
      });
      cancelListening();
    }
  }

  function endListening(): void {
    const l = listening;
    if (!l) return;
    listening = null;
    clearTimeout(l.silence);
    clearTimeout(l.max);
    l.abort.abort();
    void l.session?.close().catch(() => undefined);
    if (!needRecorder()) releaseRecorder();
  }

  function cancelListening(): void {
    if (!listening) return;
    endListening();
    d.emit('voice:transcript', { text: '', isFinal: true });
    if (d.state.get() === 'LISTENING') d.state.set('IDLE');
  }

  async function onFinal(session: NonNullable<typeof listening>, text: string): Promise<void> {
    if (listening !== session) return;
    const transcript = text.trim();
    if (!transcript && !session.heard) return;
    endListening();
    timings.finalAt = Date.now();
    if (timings.eosAt)
      log.info(
        { eosToFinalMs: timings.finalAt - timings.eosAt },
        'latency: end of speech → final transcript',
      );
    d.emit('voice:transcript', { text: transcript, isFinal: true });
    if (d.state.get() === 'LISTENING') d.state.set('IDLE');
    await route(transcript, session.retried);
  }

  /** App-flow.md §5: local commands, spoken confirmations, otherwise a voice turn. */
  async function route(text: string, retried: boolean): Promise<void> {
    if (text.replace(/[^\p{L}\p{N}]/gu, '').length < 2) {
      const u = say("Sorry, sir, I didn't catch that.");
      if (!retried) afterSpeech(u, () => void startListening(true));
      return;
    }
    if (STOP_EVERYTHING.test(text)) return d.killSwitch.trigger('voice');
    if (SLEEP_PHRASES.test(text)) {
      sleeping = true;
      d.state.set('SLEEP');
      if (!needRecorder()) releaseRecorder();
      return;
    }
    const pending = d.broker.current();
    if (pending) {
      if (YES.test(text)) {
        if (!d.broker.respond(pending.id, 'approve', 'voice'))
          say('Please confirm that one on screen, sir.');
        return;
      }
      if (NO.test(text)) {
        d.broker.respond(pending.id, 'deny', 'voice');
        return;
      }
      say('Please say yes or no, sir.');
      return;
    }
    if (CANCEL_PHRASES.test(text)) {
      d.orchestrator.cancel();
      stopSpeaking();
      return;
    }
    const conversationId = d.activeConversation();
    d.orchestrator.send({ text, source: 'voice', ...(conversationId ? { conversationId } : {}) });
  }

  /** Runs fn once the given utterance has finished playing (renderer reports "finished"). */
  const afterSpeechWaiters = new Map<string, () => void>();
  function afterSpeech(u: Utterance, fn: () => void): void {
    afterSpeechWaiters.set(u.id, fn);
  }

  // ── turn integration ────────────────────────────────────────────────────────────────────
  d.orchestrator.onTurnStart((turn: TurnInfo) => {
    if (turn.mode !== 'voice' || mode() === 'off') return;
    stopSpeaking();
    voiceTurns.set(turn.turnId, newUtterance(true, turn.turnId));
  });
  d.orchestrator.onDelta((turn, delta) => voiceTurns.get(turn.turnId)?.push(delta));
  d.orchestrator.onTurnEnd((turn) => {
    const u = voiceTurns.get(turn.turnId);
    if (!u) return;
    if (turn.outcome === 'aborted') {
      u.stop();
      voiceTurns.delete(turn.turnId);
    } else u.end();
  });

  /** Agents.md §B6 spoken confirmations during voice turns. */
  function onConfirmShown(e: ConfirmRequestEvent): void {
    const turn = d.orchestrator.currentTurn();
    if (!turn || turn.mode !== 'voice' || mode() === 'off') return;
    if (e.destructive) {
      say(`That will ${lc(e.humanSummary)}. Please confirm on screen, sir.`);
      return;
    }
    const u = say(
      e.taintedFrom
        ? "This came from a web page, so I'd like you to check it first, sir."
        : `Shall I ${lc(e.humanSummary)}, sir?`,
    );
    afterSpeech(u, () => void startListening(true));
  }

  return {
    onConfirmShown,
    say,
    stopSpeaking,

    /** Renderer playback lifecycle (tts:playback). */
    onPlayback(utteranceId: string, event: 'started' | 'finished' | 'level'): void {
      if (event === 'started' && d.state.get() !== 'LISTENING') d.state.set('SPEAKING');
      if (event !== 'finished') return;
      voiceTurns.delete(utteranceId);
      if (speaking?.id === utteranceId) speaking = null;
      if (d.state.get() === 'SPEAKING' && voiceTurns.size === 0 && !speaking)
        d.state.set(sleeping ? 'SLEEP' : 'IDLE');
      const waiter = afterSpeechWaiters.get(utteranceId);
      afterSpeechWaiters.delete(utteranceId);
      waiter?.();
    },

    /** PRD F4.1 press-to-talk toggle; also barge-in while Jarvis is speaking. */
    ptt(): void {
      if (mode() === 'off') {
        d.emit('notify', {
          level: 'info',
          message: 'Voice is off. Turn it on in Settings → Voice.',
          action: 'settings:voice',
        });
        return;
      }
      if (listening) cancelListening();
      else void startListening(false);
    },

    mic(action: 'start' | 'stop' | 'meter'): void {
      if (action === 'meter') {
        meterUntil = Date.now() + METER_MS;
        ensureRecorder();
        return;
      }
      if (action === 'start') void startListening(false);
      else cancelListening();
    },

    /** Applies voice.mode: 'wake' keeps Porcupine running on-device; audio leaves the PC only while LISTENING. */
    async applyMode(): Promise<{ ok: boolean; error?: string }> {
      const m = mode();
      cancelListening();
      wake?.release();
      wake = null;
      sleeping = false;
      if (m === 'wake') {
        const key = d.secret('picovoice');
        if (!key) return { ok: false, error: 'Add a Picovoice AccessKey to use the wake word.' };
        try {
          wake = d.factories.wake(key, d.settings.get('voice.wake.sensitivity'));
        } catch (err) {
          return { ok: false, error: `Wake word could not start: ${errorMessage(err)}` };
        }
        releaseRecorder();
        ensureRecorder();
      } else if (!needRecorder()) releaseRecorder();
      if (d.state.get() === 'SLEEP') d.state.set('IDLE');
      return { ok: true };
    },

    onKill(): void {
      cancelListening();
      stopSpeaking();
      afterSpeechWaiters.clear();
    },

    shutdown(): void {
      cancelListening();
      stopSpeaking();
      wake?.release();
      wake = null;
      releaseRecorder();
    },

    isListening: () => listening !== null,
  };
}

export type VoiceController = ReturnType<typeof createVoiceController>;
