import micWorkletUrl from '../capture/mic-worklet?worker&url';

// Meeting recorder (main/windows/meeting-window.ts, idea from anomalyco/hex): a hidden window with
// its own session. Two tracks become 16 kHz mono frames for main: "you" from the microphone and
// "them" from the sound the PC plays (the call). Nothing is stored here; the window closes when the
// meeting stops.

type Who = 'you' | 'them';

interface MeetingApi {
  frame(who: Who, bytes: Uint8Array): void;
  track(who: Who, state: 'started' | 'failed', detail: string): void;
}

const api = (window as unknown as { meeting: MeetingApi }).meeting;

const SAMPLE_RATE = 16_000;
/** 100 ms per frame. */
const FRAME_LENGTH = 1600;

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

async function pipe(stream: MediaStream, who: Who): Promise<void> {
  // The context resamples to 16 kHz itself.
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  await ctx.resume();
  await ctx.audioWorklet.addModule(micWorkletUrl);
  const node = new AudioWorkletNode(ctx, 'mic-frames', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 1,
    channelCountMode: 'explicit',
    processorOptions: { frameLength: FRAME_LENGTH },
  });
  node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => api.frame(who, new Uint8Array(e.data));
  ctx.createMediaStreamSource(stream).connect(node);
  // Connected so the graph keeps pulling it; it writes nothing, so it plays silence.
  node.connect(ctx.destination);
  stream
    .getAudioTracks()[0]
    ?.addEventListener('ended', () => api.track(who, 'failed', 'the audio stopped'));
  api.track(who, 'started', stream.getAudioTracks()[0]?.label ?? '');
}

async function microphone(): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    // Echo cancellation keeps most of the call's voice out of "You" when there are no headphones.
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    },
  });
  await pipe(stream, 'you');
}

async function pcSound(): Promise<void> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  for (const t of stream.getVideoTracks()) t.stop();
  if (!stream.getAudioTracks().length) throw new Error('no loopback audio track');
  await pipe(stream, 'them');
}

// Each track on its own: a meeting still records the microphone if the PC's sound can't be had.
microphone().catch((e: unknown) => api.track('you', 'failed', message(e)));
pcSound().catch((e: unknown) => api.track('them', 'failed', message(e)));
