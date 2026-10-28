import type { VoiceStatus } from '@shared/ipc-contract';
import type { Logger } from '../logging/logger';
import type { EchoState } from './echo-check';

/** Waits before each new try of the echo-cancelled microphone after it failed (voice fix 1A). */
export const CAPTURE_RETRY_MS = [1000, 3000, 10_000] as const;
/** A retry due while Sir is talking (or Jarvis is) waits this long and checks again. */
const BUSY_RECHECK_MS = 2000;

type MicStatus = VoiceStatus['mic'];

/** What capture.html reported once the echo-cancelled microphone opened. */
export interface CaptureStarted {
  match: 'default' | 'id' | 'matched' | 'fallback';
  requestedLabel: string;
  label: string;
  deviceId: string;
  inputs: Array<{ deviceId: string; label: string }>;
}

/**
 * Keeps track of which microphone is listening and brings the echo-cancelled one back after it
 * fails: the native recorder takes over at once, then the capture window is tried again after 1 s,
 * 3 s and 10 s (never while Sir or Jarvis is talking). After that it stays on the native recorder
 * until Sir presses Try again (or changes the microphone settings).
 */
export function createMicSupervisor(deps: {
  capture?: { reset(): void; broken(): boolean };
  echoCancel(): boolean;
  /** Listening or speaking: swapping microphones now would cut Sir (or Jarvis) off. */
  busy(): boolean;
  /** Re-opens the microphone for the current mode (voice.applyMode). */
  restart(): void;
  /** Remembers the Chromium deviceId of the chosen microphone (voice.captureDeviceId). */
  learnDevice(deviceId: string): void;
  emit(status: VoiceStatus): void;
  notify(level: 'info' | 'warn', message: string): void;
  logger: Logger;
  setTimer?(fn: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimer?(t: ReturnType<typeof setTimeout> | undefined): void;
}) {
  const setTimer = deps.setTimer ?? setTimeout;
  const clearTimer = deps.clearTimer ?? clearTimeout;
  const log = deps.logger.child({ module: 'voice.mic' });
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** The chosen device that couldn't be found, already told to Sir (once per device). */
  let warnedMissing = '';
  const echoReady = (): boolean => deps.echoCancel() && !!deps.capture && !deps.capture.broken();
  let status: MicStatus = {
    source: echoReady() ? 'echo' : 'native',
    state: 'idle',
    detail: '',
    device: '',
    deviceMismatch: false,
    inputs: [],
    retryInMs: null,
  };

  let echo: EchoState = 'off';
  let hearing: VoiceStatus['hearing'] = { chosen: '', engine: '', why: '' };

  function set(next: Partial<MicStatus>): void {
    status = { ...status, ...next };
    deps.emit({ mic: status, echo, hearing });
  }

  function tryAgain(): void {
    timer = undefined;
    if (deps.busy()) {
      timer = setTimer(tryAgain, BUSY_RECHECK_MS);
      return;
    }
    attempt++;
    log.info({ attempt }, 'trying the echo-cancelled microphone again');
    deps.capture?.reset();
    set({ source: 'echo', state: 'idle', retryInMs: null });
    deps.restart();
  }

  function stopRetrying(): void {
    clearTimer(timer);
    timer = undefined;
  }

  function retry(): void {
    stopRetrying();
    attempt = 0;
    deps.capture?.reset();
    set({ source: echoReady() ? 'echo' : 'native', state: 'idle', detail: '', retryInMs: null });
    deps.restart();
  }

  return {
    status: (): VoiceStatus => ({ mic: status, echo, hearing }),

    /** Voice fix 2B: which speech-to-text engine really listens; a fallback is explained once. */
    hearing(next: VoiceStatus['hearing']): void {
      if (
        next.chosen === hearing.chosen &&
        next.engine === hearing.engine &&
        next.why === hearing.why
      )
        return;
      if (next.why && next.why !== hearing.why) deps.notify('warn', next.why);
      hearing = next;
      set({});
    },

    /** Voice fix 2A: the echo check's verdict; a leak is explained once. */
    echo(next: EchoState): void {
      if (next === echo) return;
      if (next === 'leaks')
        deps.notify(
          'warn',
          "Echo cancellation isn't keeping my voice out of the microphone here, so saying my name won't interrupt me while I talk. Use the hotkey, headphones, or lower the speaker volume.",
        );
      echo = next;
      set({});
    },

    /** The echo-cancelled microphone failed: the native one is opened now, a retry scheduled. */
    broken(why: string): void {
      stopRetrying();
      const delay = CAPTURE_RETRY_MS[attempt];
      if (attempt === 0)
        deps.notify(
          'warn',
          `The echo-cancelled microphone stopped (${why}). Listening with the Windows microphone instead; trying again shortly.`,
        );
      else if (delay === undefined)
        deps.notify(
          'warn',
          `The echo-cancelled microphone keeps failing (${why}), so the Windows microphone stays on (no echo cancellation). Settings → Voice → Microphone → Try again.`,
        );
      set({
        source: 'native',
        state: delay === undefined ? 'failed' : 'retrying',
        detail: why,
        device: '',
        retryInMs: delay ?? null,
      });
      deps.restart();
      if (delay !== undefined) timer = setTimer(tryAgain, delay);
    },

    /** The echo-cancelled microphone opened. */
    started(info: CaptureStarted): void {
      if (attempt > 0) deps.notify('info', 'The echo-cancelled microphone is working again.');
      attempt = 0;
      stopRetrying();
      if (info.match === 'matched' && info.deviceId) deps.learnDevice(info.deviceId);
      const missing = info.match === 'fallback';
      if (missing && warnedMissing !== info.requestedLabel) {
        warnedMissing = info.requestedLabel;
        deps.notify(
          'warn',
          `Echo cancellation couldn't find “${info.requestedLabel}”, so the default microphone (“${info.label}”) is listening. Pick yours in Settings → Voice → Microphone.`,
        );
      }
      set({
        source: 'echo',
        state: 'ok',
        detail: '',
        device: info.label,
        deviceMismatch: missing,
        inputs: info.inputs,
        retryInMs: null,
      });
    },

    /** The native recorder opened (echo cancellation off, or standing in while it is retried). */
    nativeStarted(device: string): void {
      set({
        source: 'native',
        device,
        deviceMismatch: false,
        state: status.state === 'retrying' || status.state === 'failed' ? status.state : 'ok',
      });
    },

    /** The microphone closed (press to talk between requests). */
    stopped(): void {
      if (status.state === 'ok') set({ state: 'idle' });
    },

    /** Settings → Voice → Try again, or echo cancellation / the microphone changed. */
    retry,

    /** Sir picked a microphone from the echo-cancelled mic's own list. */
    useDevice(deviceId: string): void {
      warnedMissing = '';
      deps.learnDevice(deviceId);
      retry();
    },
  };
}

export type MicSupervisor = ReturnType<typeof createMicSupervisor>;
