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
  | { type: 'mic-start'; deviceLabel: string; frameLength: number }
  | { type: 'mic-stop' }
  | { type: 'snap'; id: string; deviceLabel: string };

const api = (window as unknown as { capture: CaptureApi }).capture;

const SAMPLE_RATE = 16_000;
/** ScriptProcessor block size (a power of two); frames are re-cut to the length main asks for. */
const BLOCK = 512;
/** The camera needs a moment to settle its exposure before the still. */
const CAMERA_SETTLE_MS = 700;

let mic: { ctx: AudioContext; stream: MediaStream } | null = null;

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The device whose label matches Windows's name for it (labels are known once allowed); else the default. */
async function deviceId(kind: MediaDeviceKind, label: string): Promise<string | undefined> {
  if (!label) return undefined;
  const devices = await navigator.mediaDevices.enumerateDevices();
  const want = label.toLowerCase();
  return devices.find((d) => d.kind === kind && d.label.toLowerCase().includes(want))?.deviceId;
}

/** Bumped by every start and stop, so a start that finishes after a newer command gives up. */
let generation = 0;

async function micStart(deviceLabel: string, frameLength: number): Promise<void> {
  micStop();
  const mine = ++generation;
  const id = await deviceId('audioinput', deviceLabel);
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      ...(id ? { deviceId: { exact: id } } : {}),
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    },
  });
  if (mine !== generation) {
    // Stopped (or restarted) while the microphone was opening: close this one.
    for (const t of stream.getTracks()) t.stop();
    return;
  }
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  // A hidden window may start suspended; frames only flow once it runs.
  await ctx.resume();
  const source = ctx.createMediaStreamSource(stream);
  // ponytail: ScriptProcessorNode is deprecated but simple and fine at 16 kHz; an AudioWorklet if it ever goes.
  const node = ctx.createScriptProcessor(BLOCK, 1, 1);
  let pending = new Int16Array(0);
  node.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    const next = new Int16Array(pending.length + input.length);
    next.set(pending);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i] ?? 0));
      next[pending.length + i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    let at = 0;
    for (; at + frameLength <= next.length; at += frameLength)
      api.frames(new Uint8Array(next.slice(at, at + frameLength).buffer));
    pending = next.slice(at);
  };
  source.connect(node);
  // The node only runs while connected to an output; it writes silence.
  node.connect(ctx.destination);
  mic = { ctx, stream };
  api.micState('started', JSON.stringify(micInfo(stream, ctx, deviceLabel, id)));
}

/** Phase 0 diagnostics: which device opened, at what rate, with which processing (main logs it). */
function micInfo(stream: MediaStream, ctx: AudioContext, requested: string, id?: string) {
  const track = stream.getAudioTracks()[0];
  const s = track?.getSettings() ?? {};
  return {
    requestedLabel: requested,
    match: !requested ? 'default' : id ? 'matched' : 'fallback',
    label: track?.label ?? '',
    deviceId: s.deviceId ?? '',
    requestedRate: SAMPLE_RATE,
    actualRate: ctx.sampleRate,
    trackRate: s.sampleRate ?? null,
    channels: s.channelCount ?? null,
    echoCancellation: typeof s.echoCancellation === 'boolean' ? s.echoCancellation : null,
    noiseSuppression: s.noiseSuppression ?? null,
    autoGainControl: s.autoGainControl ?? null,
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
    micStart(cmd.deviceLabel, cmd.frameLength).catch((e: unknown) => {
      micStop();
      api.micState('failed', message(e));
    });
  else if (cmd.type === 'mic-stop') micStop();
  else if (cmd.type === 'snap') void snap(cmd.id, cmd.deviceLabel);
});
