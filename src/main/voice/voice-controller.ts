import type { EventPayload } from '@shared/ipc-contract';
import type { EventChannel } from '@shared/ipc-channels';
import type { VoiceMode } from '@shared/types';
import type { AssistantStateHub } from '../agent/assistant-state';
import type { Orchestrator, TurnInfo } from '../agent/orchestrator';
import { JarvisError, errorMessage } from '../errors';
import type { Logger } from '../logging/logger';
import type { KillSwitch } from '../security/kill-switch';
import type { SettingsService } from '../settings/settings-service';
import type { ConfirmationBroker, ConfirmRequestEvent } from '../tools/confirmation-broker';
import { TranscriptBuffer, isEcho, isUnclear, mentionsName, type Intent } from './conversation';
import type { ContinuousTranscriber, HeardSegment } from './local/continuous';
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
  /** The engine chosen in Settings → Voice (Picovoice or local openWakeWord); throws JarvisError if not ready. */
  wake(sensitivity: number): WakeWord | Promise<WakeWord>;
  stt: SttProvider;
  edge: TtsProvider;
  sapi: TtsProvider;
  /** "Always listening" (on-device Whisper only); throws JarvisError if not available. */
  ambient?(handlers: {
    onSpeechStart(): void;
    onSegment(seg: HeardSegment): void;
    onError(err: Error): void;
  }): Promise<ContinuousTranscriber>;
}

export interface VoiceDeps {
  settings: SettingsService;
  state: AssistantStateHub;
  orchestrator: Orchestrator;
  broker: ConfirmationBroker;
  killSwitch: KillSwitch;
  emit<E extends EventChannel>(event: E, payload: EventPayload<E>): void;
  logger: Logger;
  factories: VoiceFactories;
  activeConversation(): string | undefined;
  /** ADR-012 intent judge: is the latest ambient speech for Jarvis, and what does Sir want? */
  judge?(transcript: string, ctx: { followUp: boolean; lastReply: string }): Promise<Intent>;
  /** Overridable for tests. */
  timeouts?: { silenceMs?: number; maxListenMs?: number; echoSettleMs?: number };
}

const SILENCE_TIMEOUT_MS = 8_000;
const MAX_LISTEN_MS = 30_000;
const LEVEL_INTERVAL_MS = 50; // ≤ 20 Hz (Code-style.md §5)
const METER_MS = 5_000;
const MAX_EARLY_FRAMES = 250; // ≥ 8 s at 512 samples per frame
/** Voice turns within this long continue the same conversation (ADR-012). */
const CONVERSATION_GAP_MS = 15 * 60_000;
/** Wait for the room to stop echoing Jarvis's voice before opening the follow-up window. */
const ECHO_SETTLE_MS = 400;
/** How long a transcript is checked against what Jarvis just said. */
const ECHO_MEMORY_MS = 15_000;

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
  let modeGeneration = 0;
  let listening: {
    session: SttSession | null;
    abort: AbortController;
    silence?: ReturnType<typeof setTimeout>;
    max?: ReturnType<typeof setTimeout>;
    heard: boolean;
    retried: boolean;
    /** Audio captured while the speech-to-text session is still starting ("Hey Jarvis, what time…"). */
    early: Int16Array[];
    /** Opened by itself after a spoken reply: no chime, gives up quietly. */
    followUp: boolean;
  } | null = null;
  /** ADR-012 conversational state. */
  let lastVoice: { conversationId: string; at: number } | null = null;
  let recentSpoken = '';
  let spokenEndedAt = 0;
  let followUntil = 0;
  const replyUtterances = new Set<string>();
  let ambient: ContinuousTranscriber | null = null;
  const heardBuffer = new TranscriptBuffer();
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

  /** What Jarvis said lately, so the microphone hearing it again isn't taken as Sir speaking. */
  function rememberSpoken(text: string): void {
    recentSpoken = `${recentSpoken} ${text}`.slice(-800);
  }

  function say(text: string): Utterance {
    stopSpeaking();
    rememberSpoken(text);
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
      (mode() === 'ambient' && !sleeping && ambient !== null) ||
      listening !== null ||
      Date.now() < meterUntil
    );
  }

  function ensureRecorder(): void {
    if (recorder) return;
    const rec = d.factories.recorder(d.settings.get('voice.deviceIndex'), wake?.frameLength ?? 512);
    recorder = rec;
    rec.start();
    void loop(rec);
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

  /**
   * One loop per recorder. applyMode replaces the recorder (and the wake engine) while a read or a
   * wake-word inference may still be pending; that loop must then end quietly instead of reporting a
   * broken microphone and releasing the new recorder (the bug that silently disabled the wake word).
   */
  async function loop(rec: Recorder): Promise<void> {
    let lastLevel = 0;
    try {
      while (recorder === rec && needRecorder()) {
        const frame = await rec.read();
        if (recorder !== rec) break;
        const now = Date.now();
        if (now - lastLevel >= LEVEL_INTERVAL_MS) {
          lastLevel = now;
          d.emit('voice:level', { rms: rms(frame) });
        }
        if (listening) {
          if (listening.session) listening.session.write(frame);
          else if (listening.early.length < MAX_EARLY_FRAMES) listening.early.push(frame);
        } else if (ambient && mode() === 'ambient' && !sleeping) {
          ambient.write(frame);
        } else if (wake && mode() === 'wake' && !sleeping) {
          const w = wake;
          let heard = false;
          try {
            heard = await w.process(frame);
          } catch (err) {
            if (wake === w) throw err; // a replaced engine may fail on its way out; ignore that
          }
          if (heard && wake === w && recorder === rec) onWake();
        }
      }
    } catch (err) {
      if (recorder !== rec) return; // replaced or released on purpose
      log.warn({ err: errorMessage(err) }, 'microphone read failed');
      d.emit('notify', {
        level: 'error',
        message: 'The microphone stopped working. Check it is plugged in.',
        action: 'settings:voice',
      });
      cancelListening();
    } finally {
      if (recorder === rec) {
        releaseRecorder();
        d.emit('voice:level', { rms: 0 });
      }
    }
  }

  // ── listening ───────────────────────────────────────────────────────────────────────────
  function onWake(): void {
    timings.wakeAt = Date.now();
    void startListening(false);
  }

  /**
   * A reply that is still being written is NOT cancelled here: a false wake word or a cough must not
   * throw Sir's answer away. route() replaces the running turn only once real words arrive (ADR-012).
   */
  async function startListening(isRetry: boolean, followUp = false): Promise<void> {
    if (listening) return;
    stopSpeaking();
    sleeping = false;
    ambient?.reset();
    const abort = new AbortController();
    listening = { session: null, abort, heard: false, retried: isRetry, early: [], followUp };
    d.state.set('LISTENING', followUp ? 'follow-up' : undefined);
    if (timings.wakeAt)
      log.info({ wakeToListeningMs: Date.now() - timings.wakeAt }, 'latency: wake → listening');
    timings.wakeAt = undefined;
    d.emit('voice:transcript', { text: '', isFinal: false });
    ensureRecorder();
    const current = listening;
    const followUpMs = d.settings.get('voice.followUpSeconds') * 1000;
    current.silence = setTimeout(
      () => {
        if (!current.heard) cancelListening();
      },
      followUp ? followUpMs : (d.timeouts?.silenceMs ?? SILENCE_TIMEOUT_MS),
    );
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
      for (const f of current.early) session.write(f);
      current.early = [];
    } catch (err) {
      log.warn({ err: errorMessage(err) }, 'speech-to-text connect failed');
      d.emit('notify', {
        level: 'error',
        // Setup problems (no Deepgram key, Whisper model not downloaded) carry their own message.
        message:
          err instanceof JarvisError && err.userMessage
            ? err.userMessage
            : "Couldn't start speech recognition. You can type instead.",
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
    settleAfterListening();
  }

  /** Back to whatever Jarvis was doing before Sir spoke (still working on a reply, or idle). */
  function settleAfterListening(): void {
    if (d.state.get() === 'LISTENING') d.state.set(d.orchestrator.isBusy() ? 'THINKING' : 'IDLE');
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
    // Route first, then settle: LISTENING → THINKING directly (no "cancelled" chime after every request).
    await route(transcript, session.retried, session.followUp);
    settleAfterListening();
  }

  /** App-flow.md §5: local commands, spoken confirmations, otherwise a voice turn. */
  async function route(text: string, retried: boolean, followUp = false): Promise<void> {
    // ADR-012: the microphone hearing Jarvis's own voice is not Sir speaking.
    if (Date.now() - spokenEndedAt < ECHO_MEMORY_MS && isEcho(text, recentSpoken)) {
      log.info('ignored an echo of Jarvis');
      return;
    }
    if (isUnclear(text)) {
      if (followUp) return; // noise after a reply: just go back to waiting
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
    // A new request replaces a reply that is still being worked on.
    if (d.orchestrator.isBusy()) d.orchestrator.cancel();
    const recent =
      lastVoice && Date.now() - lastVoice.at < CONVERSATION_GAP_MS
        ? lastVoice.conversationId
        : undefined;
    const conversationId = d.activeConversation() ?? recent;
    d.orchestrator.send({ text, source: 'voice', ...(conversationId ? { conversationId } : {}) });
  }

  /**
   * ADR-012 always-listening: every phrase is transcribed on-device into a 2-minute rolling buffer
   * (memory only). Saying "Jarvis" anywhere, or speaking inside the follow-up window, asks the intent
   * judge whether Sir is talking to Jarvis and what he wants, using the recent conversation as context.
   */
  async function onHeard(seg: HeardSegment): Promise<void> {
    const now = Date.now();
    const duringSpeech = speaking !== null || voiceTurns.size > 0 || now - spokenEndedAt < 800;
    const text = seg.text.trim();
    if (!text) return;
    heardBuffer.add({ text, start: seg.start, end: seg.end, duringSpeech });
    if (duringSpeech && CANCEL_PHRASES.test(text)) {
      stopSpeaking();
      return;
    }
    if (now - spokenEndedAt < ECHO_MEMORY_MS && isEcho(text, recentSpoken)) return;
    const followUp = now <= followUntil;
    if (!mentionsName(text) && !followUp) return;
    if (duringSpeech) stopSpeaking(); // "Jarvis, wait—" interrupts
    d.emit('voice:transcript', { text, isFinal: false });
    let intent: Intent = { directed: true, query: text };
    if (d.judge) {
      try {
        intent = await d.judge(heardBuffer.format(now), {
          followUp,
          lastReply: recentSpoken.slice(-400),
        });
      } catch (err) {
        log.warn({ err: errorMessage(err) }, 'intent judge failed; using the words as they are');
      }
    }
    d.emit('voice:transcript', { text: intent.directed ? intent.query : '', isFinal: true });
    if (!intent.directed) return;
    followUntil = 0;
    heardBuffer.clear(); // answered: the next mention starts a fresh context
    await route(intent.query, true, followUp);
  }

  /**
   * ADR-012 follow-up window: after a spoken reply, Sir can just keep talking for a few seconds
   * without the wake word. Waits for the room's echo to die down first.
   */
  function openFollowUp(): void {
    const seconds = d.settings.get('voice.followUpSeconds');
    if (seconds <= 0 || sleeping || d.broker.current()) return;
    if (mode() === 'ambient') {
      followUntil = Date.now() + (d.timeouts?.echoSettleMs ?? ECHO_SETTLE_MS) + seconds * 1000;
      return;
    }
    if (mode() !== 'wake') return;
    setTimeout(() => {
      if (!listening && !speaking && voiceTurns.size === 0 && d.state.get() === 'IDLE')
        void startListening(false, true);
    }, d.timeouts?.echoSettleMs ?? ECHO_SETTLE_MS);
  }

  /** Runs fn once the given utterance has finished playing (renderer reports "finished"). */
  const afterSpeechWaiters = new Map<string, () => void>();
  function afterSpeech(u: Utterance, fn: () => void): void {
    afterSpeechWaiters.set(u.id, fn);
  }

  // ── turn integration ────────────────────────────────────────────────────────────────────
  d.orchestrator.onTurnStart((turn: TurnInfo) => {
    if (turn.mode !== 'voice' || mode() === 'off') return;
    lastVoice = { conversationId: turn.conversationId, at: Date.now() };
    stopSpeaking();
    replyUtterances.add(turn.turnId);
    voiceTurns.set(turn.turnId, newUtterance(true, turn.turnId));
  });
  d.orchestrator.onDelta((turn, delta) => {
    const u = voiceTurns.get(turn.turnId);
    if (!u) return;
    rememberSpoken(delta);
    u.push(delta);
  });
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
      spokenEndedAt = Date.now();
      const wasReply = replyUtterances.delete(utteranceId);
      voiceTurns.delete(utteranceId);
      if (speaking?.id === utteranceId) speaking = null;
      if (d.state.get() === 'SPEAKING' && voiceTurns.size === 0 && !speaking)
        d.state.set(sleeping ? 'SLEEP' : 'IDLE');
      const waiter = afterSpeechWaiters.get(utteranceId);
      afterSpeechWaiters.delete(utteranceId);
      if (waiter) waiter();
      else if (wasReply && voiceTurns.size === 0 && !speaking) openFollowUp();
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

    /** Applies voice.mode: 'wake' keeps the wake word running on-device; audio leaves the PC only while LISTENING (and never with local Whisper). */
    async applyMode(): Promise<{ ok: boolean; error?: string }> {
      const gen = ++modeGeneration;
      const m = mode();
      cancelListening();
      wake?.release();
      wake = null;
      ambient?.close();
      ambient = null;
      heardBuffer.clear();
      sleeping = false;
      if (m === 'ambient') {
        if (!d.factories.ambient)
          return { ok: false, error: 'Always-listening mode is not available here.' };
        try {
          const next = await d.factories.ambient({
            onSpeechStart: () => undefined,
            onSegment: (seg) => void onHeard(seg),
            onError: (err) => log.warn({ err: errorMessage(err) }, 'ambient transcription failed'),
          });
          if (gen !== modeGeneration) {
            next.close();
            return { ok: true };
          }
          ambient = next;
        } catch (err) {
          return {
            ok: false,
            error:
              err instanceof JarvisError && err.userMessage
                ? err.userMessage
                : `Always-listening mode could not start: ${errorMessage(err)}`,
          };
        }
        releaseRecorder();
        ensureRecorder();
      } else if (m === 'wake') {
        try {
          const next = await d.factories.wake(d.settings.get('voice.wake.sensitivity'));
          // A newer applyMode (setting changed again while the model loaded) wins.
          if (gen !== modeGeneration) {
            next.release();
            return { ok: true };
          }
          wake = next;
        } catch (err) {
          return {
            ok: false,
            error:
              err instanceof JarvisError && err.userMessage
                ? err.userMessage
                : `Wake word could not start: ${errorMessage(err)}`,
          };
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
      ambient?.close();
      ambient = null;
      wake?.release();
      wake = null;
      releaseRecorder();
    },

    isListening: () => listening !== null,
  };
}

export type VoiceController = ReturnType<typeof createVoiceController>;
