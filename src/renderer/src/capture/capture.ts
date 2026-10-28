import micWorkletUrl from './mic-worklet?worker&url';

// Capture window (Security.md §7, main/windows/capture-window.ts): a hidden window with its own
// session, the only place allowed to open the microphone or camera.
// - Microphone: Chromium's echo cancellation removes Jarvis's own voice from what the mic hears, so
//   Sir can interrupt him without headphones (idea from Open-LLM-VTuber). 16 kHz mono frames go to
//   main, where wake word and speech recognition read them like the native recorder's.
// - Camera: one still on request (look_through_camera), then the camera is closed at once.

interface CaptureApi {
  frames(bytes: Uint8Array): void;
  micState(state: 'started' | 'failed', detail: string): void;
  snapped(id: string, jpegBase64: string | null, error: string): void;
  onCommand(cb: (cmd: unknown) => void): void;
}

type Command =
  | {
      type: 'mic-start';
      deviceLabel: string;
      deviceId: string;
      frameLength: number;
      /** Voice fix 1C: Chromium's own clean-up, chosen in Settings (both off by default). */
      noiseSuppression?: boolean;
      autoGainControl?: boolean;
    }
  | { type: 'mic-stop' }
  | { type: 'snap'; id: string; deviceLabel: string };

const api = (window as unknown as { capture: CaptureApi }).capture;

const SAMPLE_RATE = 16_000;
/** The camera needs a moment to settle its exposure before the still. */
const CAMERA_SETTLE_MS = 700;

let mic: { ctx: AudioContext; stream: MediaStream } | null = null;

interface Processing {
  noiseSuppression: boolean;
  autoGainControl: boolean;
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The device whose label matches Windows's name for it (labels are known once allowed); else the default. */
async function deviceId(kind: MediaDeviceKind, label: string): Promise<string | undefined> {
  if (!label) return undefined;
  const devices = await navigator.mediaDevices.enumerateDevices();
  const want = label.toLowerCase();
  return devices.find((d) => d.kind === kind && d.label.toLowerCase().includes(want))?.deviceId;
}

type MicMatch = 'default' | 'id' | 'matched' | 'fallback';

/**
 * The microphone to open: the saved Chromium deviceId when it is still plugged in, else the one whose
 * label contains Windows's name for it. Neither found = the default, reported as 'fallback' so main
 * warns and Settings → Voice offers the list (never a silent switch to another mic).
 */
async function pickMic(
  label: string,
  savedId: string,
): Promise<{ id?: string; match: MicMatch; inputs: MediaDeviceInfo[] }> {
  const inputs = (await navigator.mediaDevices.enumerateDevices()).filter(
    (d) => d.kind === 'audioinput',
  );
  if (savedId && inputs.some((d) => d.deviceId === savedId))
    return { id: savedId, match: 'id', inputs };
  if (!label) return { match: 'default', inputs };
  const want = label.toLowerCase();
  const found = inputs.find((d) => d.label.toLowerCase().includes(want));
  return found ? { id: found.deviceId, match: 'matched', inputs } : { match: 'fallback', inputs };
}

/** Bumped by every start and stop, so a start that finishes after a newer command gives up. */
let generation = 0;

async function micStart(
  deviceLabel: string,
  savedId: string,
  frameLength: number,
  processing: Processing,
): Promise<void> {
  micStop();
  const mine = ++generation;
  const picked = await pickMic(deviceLabel, savedId);
  const id = picked.id;
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      ...(id ? { deviceId: { exact: id } } : {}),
      // Echo cancellation is why this window exists; the rest is Sir's choice (voice fix 1C): the
      // wake-word and speech models were trained on plain audio, which suppression and gain reshape.
      echoCancellation: true,
      noiseSuppression: processing.noiseSuppression,
      autoGainControl: processing.autoGainControl,
      channelCount: 1,
    },
  });
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  const stale = (): boolean => {
    if (mine === generation) return false;
    // Stopped (or restarted) while the microphone was opening: close this one.
    for (const t of stream.getTracks()) t.stop();
    void ctx.close();
    return true;
  };
  if (stale()) return;
  // A hidden window may start suspended; frames only flow once it runs.
  await ctx.resume();
  // Voice fix 1C: an AudioWorklet (the audio thread) replaces the deprecated ScriptProcessorNode.
  await ctx.audioWorklet.addModule(micWorkletUrl);
  if (stale()) return;
  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'mic-frames', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 1,
    channelCountMode: 'explicit',
    processorOptions: { frameLength },
  });
  node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => api.frames(new Uint8Array(e.data));
  source.connect(node);
  // Connected to the output so the graph keeps pulling it; it writes nothing, so it plays silence.
  node.connect(ctx.destination);
  mic = { ctx, stream };
  // Unplugged or turned off in Windows: say so, so main falls back and retries (voice fix 1A).
  stream.getAudioTracks()[0]?.addEventListener('ended', () => {
    if (mine !== generation) return;
    micStop();
    api.micState('failed', 'the microphone was disconnected or turned off');
  });
  api.micState('started', JSON.stringify(micInfo(stream, ctx, deviceLabel, picked)));
}

/** Which device opened, at what rate, with which processing (main logs it; Settings shows it). */
function micInfo(
  stream: MediaStream,
  ctx: AudioContext,
  requested: string,
  picked: { match: MicMatch; inputs: MediaDeviceInfo[] },
) {
  const track = stream.getAudioTracks()[0];
  const s = track?.getSettings() ?? {};
  return {
    requestedLabel: requested.slice(0, 300),
    match: picked.match,
    label: (track?.label ?? '').slice(0, 300),
    deviceId: s.deviceId ?? '',
    requestedRate: SAMPLE_RATE,
    actualRate: ctx.sampleRate,
    trackRate: s.sampleRate ?? null,
    channels: s.channelCount ?? null,
    echoCancellation: typeof s.echoCancellation === 'boolean' ? s.echoCancellation : null,
    noiseSuppression: s.noiseSuppression ?? null,
    autoGainControl: s.autoGainControl ?? null,
    inputs: picked.inputs
      .slice(0, 16)
      .map((d) => ({ deviceId: d.deviceId, label: d.label.slice(0, 300) })),
  };
}

function micStop(): void {
  generation++;
  if (!mic) return;
  for (const t of mic.stream.getTracks()) t.stop();
  void mic.ctx.close();
  mic = null;
}

async function snap(id: string, deviceLabel: string): Promise<void> {
  let stream: MediaStream | null = null;
  try {
    const camera = await deviceId('videoinput', deviceLabel);
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        ...(camera ? { deviceId: { exact: camera } } : {}),
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });
    const video = document.createElement('video');
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    await new Promise((r) => setTimeout(r, CAMERA_SETTLE_MS));
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    const jpeg = canvas.toDataURL('image/jpeg', 0.85).split(',')[1] ?? '';
    video.srcObject = null;
    api.snapped(id, jpeg || null, jpeg ? '' : 'The camera gave an empty picture.');
  } catch (e) {
    api.snapped(id, null, message(e));
  } finally {
    for (const t of stream?.getTracks() ?? []) t.stop();
  }
}

api.onCommand((raw) => {
  const cmd = raw as Command;
  if (cmd.type === 'mic-start')
    micStart(cmd.deviceLabel, cmd.deviceId ?? '', cmd.frameLength, {
      noiseSuppression: cmd.noiseSuppression ?? false,
      autoGainControl: cmd.autoGainControl ?? false,
    }).catch((e: unknown) => {
      micStop();
      api.micState('failed', message(e));
    });
  else if (cmd.type === 'mic-stop') micStop();
  else if (cmd.type === 'snap') void snap(cmd.id, cmd.deviceLabel);
});
