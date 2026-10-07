// Music meter (Design-system.md §6.1, Security.md §7): runs in a hidden window with its own
// session. It turns the sound playing on the PC into one loudness number for the orb. Nothing is
// recorded or stored; the screen track Windows requires for loopback audio is stopped at once.

interface MeterApi {
  level(rms: number): void;
  failed(reason: string): void;
}

const meter = (window as unknown as { meter: MeterApi }).meter;

/** About 30 updates a second, enough for the orb to follow a beat. */
const FRAME_MS = 33;
/** Quieter than this counts as silence (one 0 is sent, then nothing until sound returns). */
const SILENCE_RMS = 0.003;

async function start(): Promise<void> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  for (const track of stream.getVideoTracks()) track.stop();
  if (!stream.getAudioTracks().length) throw new Error('no loopback audio track');

  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  let quiet = true;

  setInterval(() => {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const x of buf) sum += x * x;
    const rms = Math.sqrt(sum / buf.length);
    if (rms < SILENCE_RMS) {
      if (!quiet) meter.level(0);
      quiet = true;
      return;
    }
    quiet = false;
    meter.level(Math.min(1, rms));
  }, FRAME_MS);
}

start().catch((e: unknown) => meter.failed(e instanceof Error ? e.message : String(e)));
