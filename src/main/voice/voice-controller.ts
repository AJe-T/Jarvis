import type { EventPayload } from '@shared/ipc-contract';
import type { EventChannel } from '@shared/ipc-channels';
import { isDefaultName, nameVariants } from '@shared/assistant-name';
import type { VoiceMode } from '@shared/types';
import type { AssistantStateHub } from '../agent/assistant-state';
import type { Orchestrator, TurnInfo } from '../agent/orchestrator';
import { JarvisError, errorMessage } from '../errors';
import type { Logger } from '../logging/logger';
import type { KillSwitch } from '../security/kill-switch';
import type { SettingsService } from '../settings/settings-service';
import type { ConfirmationBroker, ConfirmRequestEvent } from '../tools/confirmation-broker';
import {
  TranscriptBuffer,
  isEcho,
  isUnclear,
  mentionsName,
  stripLeading,
  stripName,
  type Intent,
  type JudgeContext,
} from './conversation';
import type { QuickMatch } from './quick-commands';
import type { ContinuousTranscriber, HeardSegment } from './local/continuous';
import { Utterance, warmSpeech } from './tts-pipeline';
import { speakingFallbacks, ttsName, whyOf, type EngineReport } from './backup';
import { createLinePicker, WAKE_LINES, WORKING_LINES } from './greetings';
import type { AudioTap, VoiceDiagnostics } from './diagnostics';
import { createEchoCheck, type EchoState } from './echo-check';
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
  /** True when the microphone in use cancels Jarvis's own voice, so he can be interrupted by voice. */
  echoCancelled?(): boolean;
  /** The engine chosen in Settings → Voice (Picovoice or local openWakeWord); throws JarvisError if not ready. */
  wake(sensitivity: number): WakeWord | Promise<WakeWord>;
  stt: SttProvider;
  edge: TtsProvider;
  sapi: TtsProvider;
  /** The other voices of Settings → Voice (ADR-028/038); absent in tests. */
  kokoro?: TtsProvider;
  piper?: TtsProvider;
  elevenlabs?: TtsProvider;
  openai?: TtsProvider;
  aura?: TtsProvider;
  groq?: TtsProvider;
  server?: TtsProvider;
  /**
   * ADR-039 Voice Match: is this phrase in Sir's voice? Resolves true when Voice Match is off or
   * not set up, so it only ever narrows who can wake Jarvis.
   */
  verifySpeaker?(audio: Float32Array): Promise<boolean>;
  /** On-device Whisper on every phrase: "always listening", and the wake word for a custom name. Throws JarvisError if not available. */
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
  /** Dictation finished: the words to type into the app in front. */
  onDictation?(text: string): void;
  /** ADR-012 intent judge: is the latest ambient speech for Jarvis, and what does Sir want? */
  judge?(transcript: string, ctx: JudgeContext): Promise<Intent>;
  /** AI Router Phase 3: which speech engine is in use (a notice on every switch). */
  report?: EngineReport;
  /** Instant commands (routine triggers, time, date): answered without the model. */
  quick?(text: string): QuickMatch | null;
  /** Voice fix 2A: whether echo cancellation was seen keeping Jarvis's voice out of the mic. */
  onEcho?(state: EchoState): void;
  /** Phase 0: dropped-frame counts, inference timing and (voice.debugAudio) WAV recordings. */
  diag?: Pick<VoiceDiagnostics, 'tap' | 'drop' | 'timer' | 'flush'>;
  /** Overridable for tests. */
  timeouts?: {
    silenceMs?: number;
    maxListenMs?: number;
    echoSettleMs?: number;
    dictationQuietMs?: number;
    composeIdleMs?: number;
  };
}

const SILENCE_TIMEOUT_MS = 8_000;
const MAX_LISTEN_MS = 30_000;
const LEVEL_INTERVAL_MS = 50; // ≤ 20 Hz (Code-style.md §5)
const METER_MS = 5_000;
/** Voice Match enrolment: one phrase, ended by a pause or this limit. */
const SAMPLE_MAX_MS = 5_000;
const SAMPLE_END_SILENCE_MS = 700;
/** Frame loudness that counts as speech while enrolling. */
const SAMPLE_SPEECH_RMS = 0.02;
const MAX_EARLY_FRAMES = 250; // 8 s at 512 samples per frame, 20 s at 1280
/** A wake engine that fails again within this long of being reopened stays off (Sir is told). */
const WAKE_REOPEN_MS = 30_000;
/** Dictation lets Sir pause to think mid-sentence. */
const DICTATION_PAUSE_MS = 1500;
const DICTATION_MAX_MS = 120_000;
/** Composing a message stops by itself after this long without new words (or Sir taps the mic). */
const COMPOSE_IDLE_MS = 20_000;
const COMPOSE_MAX_MS = 5 * 60_000;
/** Voice turns within this long continue the same conversation (ADR-012). */
const CONVERSATION_GAP_MS = 15 * 60_000;
/** Wait for the room to stop echoing Jarvis's voice before opening the follow-up window. */
const ECHO_SETTLE_MS = 400;
/** Listening starts after the wake greeting, or after this long if its playback is never reported. */
const GREETING_MAX_MS = 3_000;
/** A repeated wake word is ignored while the greeting plays, but no longer than this. */
const GREETING_STALE_MS = 8_000;
/** Stock lines are rendered ahead only for free voices: a paid cloud voice would bill each one. */
const WARM_ENGINES = new Set(['edge', 'sapi', 'kokoro', 'piper', 'server']);
/** A volunteered line (Claude Code, reminder) waits until Jarvis has been quiet this long. */
const NOTICE_QUIET_MS = 10_000;
const NOTICE_RETRY_MS = 3_000;
const MAX_NOTICES = 3;
/** How long a transcript is checked against what Jarvis just said. */
const ECHO_MEMORY_MS = 15_000;

const CANCEL_PHRASES = /^(stop|cancel|never ?mind|forget it|that's all|nothing)[.!]?$/i;
// Tested on the words without the assistant's name ("Jarvis, stop everything" → "stop everything").
const STOP_EVERYTHING = /^stop everything[.!]?$/i;
const SLEEP_PHRASES = /^(go to sleep|stop listening|sleep)[.!]?$/i;
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
    /** voice.debugAudio: the frames this session's speech-to-text was given. */
    tap: AudioTap | null;
    /** Opened by itself after a spoken reply: no chime, gives up quietly. */
    followUp: boolean;
    /** The wake greeting playing while this session listens (echo-cancelled mic). */
    greeting?: string;
    /**
     * Dictation: collect everything said, then hand it over (no turn). 'app' types it into the app in
     * front after a pause or the hotkey; 'composer' streams it into Jarvis's message box, phone-keyboard
     * style, until Sir taps the mic again (he reads it, then presses Send).
     */
    dictation?: {
      parts: string[];
      /** The phrase still being spoken (kept if Sir stops before its final transcript). */
      partial?: string;
      target: 'app' | 'composer';
      quiet?: ReturnType<typeof setTimeout>;
    };
  } | null = null;
  /** ADR-012 conversational state. */
  let lastVoice: { conversationId: string; at: number } | null = null;
  let recentSpoken = '';
  let spokenEndedAt = 0;
  let followUntil = 0;
  const replyUtterances = new Set<string>();
  let ambient: ContinuousTranscriber | null = null;
  /** Wake mode is listening for the assistant's name with Whisper (custom names, or chosen in Settings). */
  let spotting = false;
  const heardBuffer = new TranscriptBuffer();
  let meterUntil = 0;
  /** Voice Match enrolment: the phrase being recorded. */
  let sample: {
    frames: Int16Array[];
    heard: boolean;
    quietMs: number;
    done(audio: Float32Array): void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  let sleeping = false;
  let speaking: Utterance | null = null;
  /** "On it, sir.": the reply plays after it instead of cutting it off. */
  let ack: Utterance | null = null;
  /** Utterances the renderer is playing right now. */
  const playing = new Set<string>();
  /** voice.debugAudio: what the wake engine / always-listening transcriber hears (one file per wake). */
  let wakeTap: AudioTap | null = null;
  let ambientTap: AudioTap | null = null;
  const wakeTiming = d.diag?.timer('wake.process');
  const echo = createEchoCheck((state) => {
    log.info({ state }, 'echo cancellation check');
    d.onEcho?.(state);
  });
  /** Voice fix 2B: the request whose reply hasn't started playing yet. */
  let pendingLatency: {
    eosAt: number;
    finalAt: number;
    turnId?: string;
    firstTokenAt?: number;
  } | null = null;

  function logLatency(l: NonNullable<typeof pendingLatency>): void {
    pendingLatency = null;
    const now = Date.now();
    log.info(
      {
        eosToFinalMs: l.finalAt - l.eosAt,
        finalToFirstTokenMs: l.firstTokenAt ? l.firstTokenAt - l.finalAt : null,
        firstTokenToAudioMs: l.firstTokenAt ? now - l.firstTokenAt : null,
        eosToFirstAudioMs: now - l.eosAt,
        tts: d.settings.get('voice.tts.provider'),
        stt: d.settings.get('voice.stt.provider'),
      },
      'latency: end of speech → first audio of the reply',
    );
  }
  /** When a failed wake engine was last reopened. */
  let wakeReopenedAt = 0;
  const wakeLine = createLinePicker(WAKE_LINES);
  const workingLine = createLinePicker(WORKING_LINES);
  /** The "Yes, sir?" playing before listening starts (no echo cancellation). */
  let greeting: Utterance | null = null;
  let greetingAt = 0;
  let fallbackWarned = false;
  const voiceTurns = new Map<string, Utterance>();
  const timings: {
    wakeAt?: number | undefined;
    eosAt?: number | undefined;
    finalAt?: number | undefined;
  } = {};

  const mode = (): VoiceMode => d.settings.get('voice.mode');
  /** The assistant's name and its near spellings (Settings → General → Name). */
  // Spellings learned while Sir enrolled his voice ("sumer") count as the name too (ADR-039).
  const names = (): string[] => [
    ...nameVariants(d.settings.get('assistant.name')),
    ...d.settings.get('voice.wake.learned'),
  ];

  /** Voice Match: only Sir's voice wakes Jarvis by name or in always-listening (when turned on). */
  async function isSir(seg: HeardSegment): Promise<boolean> {
    if (!seg.audio || !d.factories.verifySpeaker) return true;
    try {
      return await d.factories.verifySpeaker(seg.audio);
    } catch (err) {
      log.warn({ err: errorMessage(err) }, 'voice match failed; letting the phrase through');
      return true;
    }
  }
  /**
   * Picovoice and openWakeWord only know "Jarvis"; any other name is spotted by Whisper, unless
   * Sir recorded his own "Hey <name>" (ADR-043) or uses the keyword spotter (ADR-044), which both
   * work for any name.
   */
  const spotsName = (): boolean => {
    const engine = d.settings.get('voice.wake.provider');
    if (engine === 'personal' || engine === 'spotter') return false;
    return engine === 'name' || !isDefaultName(d.settings.get('assistant.name'));
  };
  /** Whisper hears every phrase: always-listening, or wake mode waiting for the name. */
  const transcribing = (): boolean =>
    ambient !== null && !sleeping && (mode() === 'ambient' || (mode() === 'wake' && spotting));

  // ── TTS ─────────────────────────────────────────────────────────────────────────────────
  const voiceOf = {
    primary: () => d.factories[d.settings.get('voice.tts.provider')] ?? d.factories.edge,
    voice: () => d.settings.get('voice.tts.voice'),
    rate: () => d.settings.get('voice.tts.rate'),
  };

  /** The instant lines, rendered ahead of time (one warm-up at a time; a new one replaces it). */
  let warming: AbortController | null = null;
  function warmLines(): void {
    warming?.abort();
    if (mode() === 'off' || !d.settings.get('voice.greet')) return;
    if (!WARM_ENGINES.has(d.settings.get('voice.tts.provider'))) return;
    const ctl = new AbortController();
    warming = ctl;
    void (async () => {
      for (const line of [...WAKE_LINES, ...WORKING_LINES]) {
        if (ctl.signal.aborted) return;
        await warmSpeech(voiceOf, line, ctl.signal);
      }
    })().catch((err: unknown) =>
      log.warn({ err: errorMessage(err) }, 'could not prepare greetings'),
    );
  }

  function newUtterance(extractSpoken: boolean, id?: string, cache = false): Utterance {
    return new Utterance(
      {
        ...voiceOf,
        fallbacks: () =>
          speakingFallbacks(
            d.settings.get('voice.tts.provider'),
            d.factories,
            d.settings.get('pool.abilities.voiceSpeaking'),
          ),
        onEngine: (id, failed) =>
          d.report?.(
            'speaking',
            ttsName(id),
            failed && `${ttsName(failed.id)} failed: ${whyOf(failed.err)}`,
          ),
        emitAudio: (p) => d.emit('tts:audio', p),
        emitStop: (utteranceId) => d.emit('tts:stop', utteranceId ? { utteranceId } : {}),
        onFallback: (err) => {
          // With the engine reporter, every switch is announced by name instead.
          if (fallbackWarned || d.report) return;
          fallbackWarned = true;
          const why = err instanceof JarvisError && err.userMessage ? ` ${err.userMessage}` : '';
          d.emit('notify', {
            level: 'warn',
            message: `Your chosen voice is unavailable, so Jarvis is using a backup voice.${why}`,
            action: 'settings:voice',
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
      { extractSpoken, cache, ...(id ? { id } : {}) },
    );
  }

  /** What Jarvis said lately, so the microphone hearing it again isn't taken as Sir speaking. */
  function rememberSpoken(text: string): void {
    recentSpoken = `${recentSpoken} ${text}`.slice(-800);
  }

  /** `cache`: a stock line (greetings), kept as audio so the next time it plays at once. */
  function say(text: string, cache = false): Utterance {
    stopSpeaking();
    rememberSpoken(text);
    const u = newUtterance(false, undefined, cache);
    speaking = u;
    u.push(text);
    u.end();
    return u;
  }

  /**
   * Woken: answer at once ("Yes, sir?"), with no model call, and listen for the request. With
   * echo cancellation the mic opens at the same moment (it doesn't hear the greeting), so words
   * Sir says straight after the name aren't lost; without it, listening starts once it has played.
   */
  function greetThenListen(): void {
    // Saying the name again while Jarvis is already answering used to restart the greeting each
    // time, so the mic never opened while Sir kept repeating "Hey Jarvis".
    // A greeting whose playback is never reported (renderer reloaded) stops counting after a while,
    // so the wake word can't stay ignored.
    const greetingLive =
      greeting && !greeting.aborted && Date.now() - greetingAt < GREETING_STALE_MS;
    if (listening || greetingLive) return log.info('wake word repeated; already listening');
    if (!d.settings.get('voice.greet')) return void startListening(false);
    const line = wakeLine();
    // Listening during the greeting relies on echo cancellation; not where it was seen to leak.
    if (d.factories.echoCancelled?.() && echo.state() !== 'leaks') {
      void startListening(false, false, null, line); // synchronously LISTENING; say() leaves it so
      say(line, true);
      return;
    }
    const u = say(line, true);
    greeting = u;
    greetingAt = Date.now();
    let started = false;
    const listen = (): void => {
      // Stopped (kill switch, barge-in) or still audible: the playback report will start it.
      if (started || u.aborted || playing.has(u.id)) return;
      started = true;
      clearTimeout(timer);
      void startListening(false);
    };
    // Playback that is never reported (renderer reloaded, audio failed) must not leave Jarvis deaf.
    const timer = setTimeout(listen, GREETING_MAX_MS);
    afterSpeech(u, listen); // onPlayback drops it from `playing` before calling this
  }

  /**
   * Lines Jarvis volunteers (Claude Code sessions, reminders) wait for a lull instead of cutting
   * into a conversation: say() stops whatever is playing, which used to end Sir's reply mid-way.
   */
  const notices: string[] = [];
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  function conversing(): boolean {
    const now = Date.now();
    const s = d.state.get();
    return (
      // ERROR can linger until the next turn; it is not a conversation in progress.
      (s !== 'IDLE' && s !== 'SLEEP' && s !== 'ERROR') ||
      listening !== null ||
      speaking !== null ||
      voiceTurns.size > 0 ||
      d.orchestrator.isBusy() ||
      now < followUntil ||
      now - spokenEndedAt < NOTICE_QUIET_MS ||
      (lastVoice !== null && now - lastVoice.at < NOTICE_QUIET_MS)
    );
  }
  function notice(text: string): void {
    if (!notices.includes(text)) notices.push(text);
    notices.splice(0, Math.max(0, notices.length - MAX_NOTICES)); // only the latest few matter
    flushNotices();
  }
  function flushNotices(): void {
    clearTimeout(noticeTimer);
    if (!notices.length) return;
    if (conversing()) {
      noticeTimer = setTimeout(flushNotices, NOTICE_RETRY_MS);
      noticeTimer.unref?.();
      return;
    }
    say(notices.splice(0).join(' '));
  }

  function stopSpeaking(): void {
    speaking?.stop();
    speaking = null;
    ack = null;
    playing.clear();
    for (const u of voiceTurns.values()) u.stop();
    voiceTurns.clear();
    if (d.state.get() === 'SPEAKING') d.state.set('IDLE');
  }

  // ── mic loop ────────────────────────────────────────────────────────────────────────────
  function needRecorder(): boolean {
    return (
      (mode() === 'wake' && !sleeping && wake !== null) ||
      transcribing() ||
      listening !== null ||
      sample !== null ||
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

  function closeTaps(): void {
    wakeTap?.close();
    wakeTap = null;
    ambientTap?.close();
    ambientTap = null;
  }

  function releaseRecorder(): void {
    if (!recorder) return;
    closeTaps();
    d.diag?.flush();
    try {
      recorder.stop();
      recorder.release();
    } catch {
      // device already gone
    }
    recorder = null;
  }

  /**
   * Voice fix 1B: hands one frame to the wake engine without waiting for it, so the mic loop goes
   * straight back to reading. Engines in the audio worker answer later, in order; an answer of
   * "heard" wakes Jarvis if that engine and microphone are still current and he isn't listening yet.
   */
  function feedWake(w: WakeWord, frame: Int16Array, rec: Recorder): void {
    const started = performance.now();
    let result: boolean | Promise<boolean>;
    try {
      result = w.process(frame);
    } catch (err) {
      return wakeFailed(w, err);
    }
    if (typeof result === 'boolean') {
      wakeTiming?.(performance.now() - started);
      if (result) woke(w, rec);
      return;
    }
    result.then(
      (heard) => {
        if (heard) woke(w, rec);
      },
      (err: unknown) => wakeFailed(w, err),
    );
  }

  function woke(w: WakeWord, rec: Recorder): void {
    if (wake !== w || recorder !== rec || listening || sample) return;
    // One recording per wake: it ends with the phrase that fired.
    wakeTap?.close();
    wakeTap = null;
    onWake();
  }

  /** The wake engine failed (its worker crashed): reopen it, but not in a tight loop. */
  function wakeFailed(w: WakeWord, err: unknown): void {
    if (wake !== w) return; // a replaced engine may fail on its way out; ignore that
    log.warn({ err: errorMessage(err) }, 'wake word engine failed');
    wake = null;
    w.release();
    if (Date.now() - wakeReopenedAt < WAKE_REOPEN_MS) {
      d.emit('notify', {
        level: 'error',
        message:
          'The wake word stopped working. Press to talk still works; change any voice setting or restart to try again.',
        action: 'settings:voice',
      });
      return;
    }
    wakeReopenedAt = Date.now();
    void controller.applyMode();
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
        const level = rms(frame);
        if (now - lastLevel >= LEVEL_INTERVAL_MS) {
          lastLevel = now;
          d.emit('voice:level', { rms: level });
        }
        // Voice fix 2A: Jarvis's replies tell whether echo cancellation works (not while Sir talks).
        if (listening || sample) echo.skipReply();
        else echo.frame(level, d.state.get() === 'SPEAKING', now);
        if (sample) {
          feedSample(frame, (frame.length / 16000) * 1000);
        } else if (listening) {
          if (listening.session) {
            listening.session.write(frame);
            listening.tap?.write(frame);
          } else if (listening.early.length < MAX_EARLY_FRAMES) listening.early.push(frame);
          else d.diag?.drop('early');
        } else if (ambient && transcribing()) {
          ambientTap ??= d.diag?.tap('ambient') ?? null;
          ambientTap?.write(frame);
          ambient.write(frame);
        } else if (wake && mode() === 'wake' && !sleeping) {
          wakeTap ??= d.diag?.tap('wake') ?? null;
          wakeTap?.write(frame);
          feedWake(wake, frame, rec);
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

  // ── Voice Match enrolment (ADR-039) ─────────────────────────────────────────────────────
  function endSample(): void {
    const s = sample;
    if (!s) return;
    sample = null;
    clearTimeout(s.timer);
    const audio = new Float32Array(s.frames.reduce((a, f) => a + f.length, 0));
    let at = 0;
    for (const f of s.frames) for (const x of f) audio[at++] = x / 32768;
    // Nothing heard at all: an empty phrase, which enrolment reports as "didn't catch that".
    s.done(s.heard ? audio : new Float32Array(0));
    if (!needRecorder()) releaseRecorder();
  }

  function feedSample(frame: Int16Array, frameMs: number): void {
    if (!sample) return;
    sample.frames.push(frame);
    if (rms(frame) >= SAMPLE_SPEECH_RMS) {
      sample.heard = true;
      sample.quietMs = 0;
    } else if (sample.heard) {
      sample.quietMs += frameMs;
      if (sample.quietMs >= SAMPLE_END_SILENCE_MS) endSample();
    }
  }

  // ── listening ───────────────────────────────────────────────────────────────────────────
  /** Jarvis's voice is coming out of the speakers (or just stopped). */
  function audible(): boolean {
    const tail = d.timeouts?.echoSettleMs ?? ECHO_SETTLE_MS;
    return d.state.get() === 'SPEAKING' || Date.now() - spokenEndedAt < tail;
  }

  /**
   * The wake word may cut Jarvis off: with echo cancellation the mic no longer hears his own voice
   * (Open-LLM-VTuber's "interrupt without headphones"); without it only when Sir turned barge-in on.
   */
  function canBargeIn(): boolean {
    // Voice fix 2A: by echo cancellation only once his replies showed it keeps his voice out.
    return (
      d.settings.get('voice.bargeIn') ||
      ((d.factories.echoCancelled?.() ?? false) && echo.state() === 'verified')
    );
  }

  function onWake(): void {
    // Without echo cancellation the mic hears Jarvis's own voice; that "wake" cut him off mid-reply.
    if (audible() && !canBargeIn()) return log.info('wake word ignored while speaking');
    timings.wakeAt = Date.now();
    greetThenListen();
  }

  /**
   * A reply that is still being written is NOT cancelled here: a false wake word or a cough must not
   * throw Sir's answer away. route() replaces the running turn only once real words arrive (ADR-012).
   */
  async function startListening(
    isRetry: boolean,
    followUp = false,
    dictation: 'app' | 'composer' | null = null,
    greetingLine?: string,
  ): Promise<void> {
    if (listening) return;
    stopSpeaking();
    sleeping = false;
    greeting = null;
    ambient?.reset();
    const abort = new AbortController();
    listening = {
      session: null,
      abort,
      heard: false,
      retried: isRetry,
      early: [],
      tap: d.diag?.tap('stt') ?? null,
      followUp,
      ...(greetingLine ? { greeting: greetingLine } : {}),
      ...(dictation ? { dictation: { parts: [], target: dictation } } : {}),
    };
    const detail = followUp
      ? 'follow-up'
      : dictation === 'composer'
        ? 'compose'
        : dictation
          ? 'dictation'
          : undefined;
    d.state.set('LISTENING', detail);
    if (timings.wakeAt)
      log.info({ wakeToListeningMs: Date.now() - timings.wakeAt }, 'latency: wake → listening');
    timings.wakeAt = undefined;
    if (dictation === 'composer') d.emit('voice:compose', { text: '', final: false });
    else d.emit('voice:transcript', { text: '', isFinal: false });
    ensureRecorder();
    const current = listening;
    const followUpMs = d.settings.get('voice.followUpSeconds') * 1000;
    const composing = dictation === 'composer';
    current.silence = setTimeout(
      () => {
        if (!current.heard) cancelListening();
      },
      composing
        ? (d.timeouts?.composeIdleMs ?? COMPOSE_IDLE_MS)
        : followUp
          ? followUpMs
          : (d.timeouts?.silenceMs ?? SILENCE_TIMEOUT_MS),
    );
    current.max = setTimeout(
      () => (current.dictation ? finishDictation(current) : cancelListening()),
      composing
        ? COMPOSE_MAX_MS
        : dictation
          ? DICTATION_MAX_MS
          : (d.timeouts?.maxListenMs ?? MAX_LISTEN_MS),
    );
    try {
      const session = await d.factories.stt.start({
        sampleRate: 16000,
        language: d.settings.get('voice.stt.language'),
        signal: abort.signal,
        endSilenceMs: dictation ? DICTATION_PAUSE_MS : d.settings.get('voice.endSilenceMs'),
        ...(dictation ? { continuous: true, livePartials: true } : {}),
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
        if (current.dictation) {
          emitDictation(current, text);
          dictationPause(current);
        } else d.emit('voice:transcript', { text, isFinal: false });
      });
      session.on('final', (text) => {
        if (!current.dictation) return void onFinal(current, text);
        if (text.trim()) current.dictation.parts.push(text.trim());
        current.heard = true;
        emitDictation(current, '');
        dictationPause(current);
      });
      session.on('utteranceEnd', () => {
        if (current.dictation) return; // dictation ends on a longer pause or the hotkey
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
      for (const f of current.early) {
        session.write(f);
        current.tap?.write(f);
      }
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

  /** Everything dictated so far plus the phrase still being spoken. */
  function emitDictation(l: NonNullable<typeof listening>, partial: string): void {
    if (!l.dictation) return;
    l.dictation.partial = partial.trim();
    const text = [...l.dictation.parts, l.dictation.partial].filter(Boolean).join(' ');
    if (l.dictation.target === 'composer') d.emit('voice:compose', { text, final: false });
    else d.emit('voice:transcript', { text, isFinal: false });
  }

  /**
   * Dictation into an app ends after a pause with nothing new, or when the hotkey is pressed again.
   * Composing a message ends only when Sir taps the mic (or after a long quiet spell).
   */
  function dictationPause(l: NonNullable<typeof listening>): void {
    if (!l.dictation) return;
    clearTimeout(l.dictation.quiet);
    const ms =
      l.dictation.target === 'composer'
        ? (d.timeouts?.composeIdleMs ?? COMPOSE_IDLE_MS)
        : (d.timeouts?.dictationQuietMs ?? 1200);
    l.dictation.quiet = setTimeout(() => finishDictation(l), ms);
  }

  function finishDictation(l: NonNullable<typeof listening>): void {
    if (listening !== l || !l.dictation) return;
    clearTimeout(l.dictation.quiet);
    const text = [...l.dictation.parts, l.dictation.partial ?? ''].join(' ').trim();
    endListening();
    if (l.dictation.target === 'composer') {
      d.emit('voice:compose', { text, final: true });
      settleAfterListening();
      return;
    }
    d.emit('voice:transcript', { text, isFinal: true });
    settleAfterListening();
    if (text) d.onDictation?.(text);
  }

  function endListening(): void {
    const l = listening;
    if (!l) return;
    listening = null;
    clearTimeout(l.silence);
    clearTimeout(l.max);
    l.tap?.close();
    wake?.reset();
    l.abort.abort();
    void l.session?.close().catch(() => undefined);
    if (!needRecorder()) releaseRecorder();
  }

  function cancelListening(): void {
    if (!listening) return;
    // Stopping a message being composed keeps the words already in the box.
    if (listening.dictation?.target === 'composer') return finishDictation(listening);
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
    let transcript = text.trim();
    if (!transcript && !session.heard) return;
    if (session.greeting) {
      // The greeting leaking past echo cancellation is not Sir's request: listen again for it.
      if (!transcript || isEcho(transcript, session.greeting)) {
        endListening();
        return void startListening(true);
      }
      transcript = stripLeading(transcript, session.greeting); // "Yes sir? What time is it"
    }
    endListening();
    timings.finalAt = Date.now();
    // Voice fix 2B: one line per voice request, end of speech to the first sound of the reply.
    pendingLatency = { eosAt: timings.eosAt ?? timings.finalAt, finalAt: timings.finalAt };
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
    const bare = stripName(text, names());
    if (STOP_EVERYTHING.test(bare)) return d.killSwitch.trigger('voice');
    if (SLEEP_PHRASES.test(bare)) {
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
    const quick = d.settings.get('voice.quickCommands') ? (d.quick?.(text) ?? null) : null;
    if (quick?.kind === 'say') {
      say(quick.text);
      return;
    }
    // A new request replaces a reply that is still being worked on.
    const replacing = d.orchestrator.isBusy();
    if (replacing) d.orchestrator.cancel();
    // Instant "On it, sir." while the model works (seconds); the reply plays right after it.
    // Not when replacing a reply: stopping that one would cut this line off too.
    if (d.settings.get('voice.greet') && !quick && !replacing) ack = say(workingLine(), true);
    const recent =
      lastVoice && Date.now() - lastVoice.at < CONVERSATION_GAP_MS
        ? lastVoice.conversationId
        : undefined;
    const conversationId = d.activeConversation() ?? recent;
    d.orchestrator.send({
      text,
      source: 'voice',
      ...(conversationId ? { conversationId } : {}),
      ...(quick
        ? { direct: { tool: 'run_routine', input: { name: quick.name }, ack: quick.ack } }
        : {}),
    });
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
    const named = mentionsName(text, names());
    if (!named && !followUp) return;
    if (!(await isSir(seg))) return log.info('speech in another voice; ignored');
    if (duringSpeech) stopSpeaking(); // "Jarvis, wait—" interrupts
    // Just the name ("Jarvis?", "Hey Jarvis"): listen for the request, like a wake word.
    if (named && !stripName(text, names())) {
      timings.wakeAt = now;
      greetThenListen();
      return;
    }
    d.emit('voice:transcript', { text, isFinal: false });
    let intent: Intent = { directed: true, query: text };
    if (d.judge) {
      try {
        intent = await d.judge(heardBuffer.format(now), {
          followUp,
          lastReply: recentSpoken.slice(-400),
          heard: text,
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
   * Wake word by name (any name Sir chose): Whisper transcribes each phrase on this PC. "April" alone
   * opens listening like a wake word; "April, what time is it?" in one breath goes straight through.
   */
  async function onNameHeard(seg: HeardSegment): Promise<void> {
    const text = seg.text.trim();
    if (!text || !mentionsName(text, names())) return;
    if (Date.now() - spokenEndedAt < ECHO_MEMORY_MS && isEcho(text, recentSpoken)) return;
    if (audible() && !canBargeIn()) return log.info('name heard while speaking; ignored');
    if (!(await isSir(seg))) return log.info('name heard in another voice; ignored');
    const request = stripName(text, names());
    if (!request || isUnclear(request)) {
      timings.wakeAt = Date.now();
      greetThenListen();
      return;
    }
    stopSpeaking();
    timings.finalAt = Date.now();
    d.emit('voice:transcript', { text: request, isFinal: true });
    await route(request, false);
    settleAfterListening();
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
    // Push-to-talk conversations continue too: the reply came from a press, so Sir can just answer.
    if (mode() !== 'wake' && mode() !== 'ptt') return;
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
    warming?.abort(); // the reply goes first; lines not rendered yet are kept on first use
    lastVoice = { conversationId: turn.conversationId, at: Date.now() };
    if (!ack || speaking !== ack) stopSpeaking();
    replyUtterances.add(turn.turnId);
    voiceTurns.set(turn.turnId, newUtterance(true, turn.turnId));
    if (pendingLatency && !pendingLatency.turnId) pendingLatency.turnId = turn.turnId;
  });
  d.orchestrator.onDelta((turn, delta) => {
    const u = voiceTurns.get(turn.turnId);
    if (!u) return;
    if (pendingLatency?.turnId === turn.turnId) pendingLatency.firstTokenAt ??= Date.now();
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

  const controller = {
    onConfirmShown,
    say,
    notice,
    stopSpeaking,

    /** Renderer playback lifecycle (tts:playback). */
    onPlayback(utteranceId: string, event: 'started' | 'finished' | 'level'): void {
      if (event === 'started') playing.add(utteranceId);
      if (event === 'started' && pendingLatency?.turnId === utteranceId) logLatency(pendingLatency);
      if (event === 'started' && d.state.get() !== 'LISTENING') d.state.set('SPEAKING');
      if (event !== 'finished') return;
      playing.delete(utteranceId);
      spokenEndedAt = Date.now();
      const wasReply = replyUtterances.delete(utteranceId);
      voiceTurns.delete(utteranceId);
      if (speaking?.id === utteranceId) speaking = null;
      if (ack?.id === utteranceId) ack = null;
      const replyAudible = [...voiceTurns.keys()].some((id) => playing.has(id));
      if (d.state.get() === 'SPEAKING' && voiceTurns.size === 0 && !speaking)
        d.state.set(sleeping ? 'SLEEP' : 'IDLE');
      // "On it, sir." is over but the answer is still being written: back to thinking.
      else if (d.state.get() === 'SPEAKING' && !speaking && !replyAudible) d.state.set('THINKING');
      const waiter = afterSpeechWaiters.get(utteranceId);
      afterSpeechWaiters.delete(utteranceId);
      if (waiter) waiter();
      else if (wasReply && voiceTurns.size === 0 && !speaking) openFollowUp();
    },

    /** Dictation hotkey: start, or finish early if already dictating. Works in every voice mode. */
    dictate(): void {
      if (listening?.dictation) return finishDictation(listening);
      if (listening) cancelListening();
      void startListening(false, false, 'app');
    },

    /**
     * The mic in Jarvis's message box: words appear live in the box as Sir speaks, nothing is sent
     * until he presses Send. Tap again to stop. Works in every voice mode, including "off".
     */
    compose(action: 'start' | 'stop'): void {
      if (action === 'stop') {
        if (listening?.dictation?.target === 'composer') finishDictation(listening);
        return;
      }
      if (listening?.dictation?.target === 'composer') return;
      if (listening) cancelListening();
      void startListening(false, false, 'composer');
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

    /**
     * Voice Match enrolment: records one phrase (ends after a short pause, at most 5 s) and returns
     * it as 16 kHz floats; empty when nothing was heard. Refused while Jarvis is busy listening.
     */
    recordSample(): Promise<Float32Array> {
      if (sample || listening || d.state.get() === 'SPEAKING')
        return Promise.reject(
          new JarvisError(
            'INVALID',
            'microphone busy',
            'Wait until Jarvis is idle, then try again.',
          ),
        );
      return new Promise<Float32Array>((resolve) => {
        sample = {
          frames: [],
          heard: false,
          quietMs: 0,
          done: resolve,
          timer: setTimeout(endSample, SAMPLE_MAX_MS),
        };
        ensureRecorder();
      });
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
      closeTaps();
      wake?.release();
      wake = null;
      ambient?.close();
      ambient = null;
      spotting = false;
      heardBuffer.clear();
      sleeping = false;
      const byName = m === 'wake' && spotsName();
      if (m === 'ambient' || byName) {
        if (!d.factories.ambient)
          return { ok: false, error: 'Listening with on-device Whisper is not available here.' };
        try {
          const next = await d.factories.ambient({
            onSpeechStart: () => undefined,
            onSegment: (seg) => void (byName ? onNameHeard(seg) : onHeard(seg)),
            onError: (err) => log.warn({ err: errorMessage(err) }, 'ambient transcription failed'),
          });
          if (gen !== modeGeneration) {
            next.close();
            return { ok: true };
          }
          ambient = next;
          spotting = byName;
        } catch (err) {
          if (gen !== modeGeneration) return { ok: true }; // a newer mode replaced this one
          return {
            ok: false,
            error:
              err instanceof JarvisError && err.userMessage
                ? err.userMessage
                : `${byName ? 'The wake word' : 'Always-listening mode'} could not start: ${errorMessage(err)}`,
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
          if (gen !== modeGeneration) return { ok: true }; // a newer mode replaced this one
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
      echo.restart(d.factories.echoCancelled?.() ?? false);
      warmLines();
      return { ok: true };
    },

    /** A voice setting changed and the kept lines were dropped: render them again in the new voice. */
    warmLines,

    /** Startup hello (time and today's plan, no model call), then the mic opens for Sir's answer. */
    welcome(text: string): void {
      if (mode() === 'off' || conversing()) return;
      afterSpeech(say(text), openFollowUp);
    },

    onKill(): void {
      cancelListening();
      stopSpeaking();
      afterSpeechWaiters.clear();
      notices.length = 0;
      clearTimeout(noticeTimer);
    },

    shutdown(): void {
      warming?.abort();
      cancelListening();
      stopSpeaking();
      notices.length = 0;
      clearTimeout(noticeTimer);
      ambient?.close();
      ambient = null;
      wake?.release();
      wake = null;
      releaseRecorder();
    },

    isListening: () => listening !== null,
    /** Voice fix 2A: what the replies showed about echo cancellation. */
    echoState: (): EchoState => echo.state(),
  };
  return controller;
}

export type VoiceController = ReturnType<typeof createVoiceController>;
