import './apps-pages.css';

/** Jarvis Camera (ADR-040). Talks to main only through window.camera; the video never leaves the page. */
interface CameraApi {
  save(jpegBase64: string): Promise<{ name: string; path: string }>;
  reveal(): Promise<void>;
}
const api = (window as unknown as { camera: CameraApi }).camera;

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const video = $<HTMLVideoElement>('video');
const status = $<HTMLParagraphElement>('status');
const select = $<HTMLSelectElement>('device');
const mirror = $<HTMLButtonElement>('mirror');
const shoot = $<HTMLButtonElement>('shoot');
const saved = $<HTMLSpanElement>('saved');
const reveal = $<HTMLButtonElement>('reveal');
const flash = $<HTMLDivElement>('flash');
let stream: MediaStream | null = null;

function stop(): void {
  for (const t of stream?.getTracks() ?? []) t.stop();
  stream = null;
}

async function start(deviceId?: string): Promise<void> {
  stop();
  shoot.disabled = true;
  status.hidden = false;
  status.textContent = 'Turning the camera on…';
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: deviceId ? { deviceId: { exact: deviceId } } : { width: 1280, height: 720 },
    });
    video.srcObject = stream;
    status.hidden = true;
    shoot.disabled = false;
    await listCameras(stream.getVideoTracks()[0]?.getSettings().deviceId);
  } catch (err) {
    status.textContent =
      err instanceof DOMException && err.name === 'NotFoundError'
        ? 'No camera found. Plug one in and open the app again.'
        : 'The camera could not start. Is another app using it? Check Windows Settings → Privacy → Camera.';
  }
}

async function listCameras(current?: string): Promise<void> {
  const cams = (await navigator.mediaDevices.enumerateDevices()).filter(
    (d) => d.kind === 'videoinput',
  );
  select.replaceChildren(
    ...cams.map((d, i) => {
      const o = document.createElement('option');
      o.value = d.deviceId;
      o.textContent = d.label || `Camera ${i + 1}`; // always text, never HTML
      o.selected = d.deviceId === current;
      return o;
    }),
  );
  select.disabled = cams.length < 2;
}

select.addEventListener('change', () => void start(select.value));
mirror.addEventListener('click', () => {
  const on = mirror.getAttribute('aria-pressed') !== 'true';
  mirror.setAttribute('aria-pressed', String(on));
  video.classList.toggle('mirrored', on);
});
video.classList.add('mirrored');

shoot.addEventListener('click', () => {
  if (!video.videoWidth) return;
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  // The photo is saved the way the world sees Sir (not mirrored).
  ctx.drawImage(video, 0, 0);
  const data = canvas.toDataURL('image/jpeg', 0.92).split(',')[1] ?? '';
  flash.classList.remove('on');
  void flash.offsetWidth;
  flash.classList.add('on');
  shoot.disabled = true;
  api
    .save(data)
    .then((r) => {
      saved.textContent = `Saved ${r.name}`;
      reveal.hidden = false;
    })
    .catch(() => {
      saved.textContent = 'The photo could not be saved.';
    })
    .finally(() => {
      shoot.disabled = false;
    });
});
reveal.addEventListener('click', () => void api.reveal());
document.addEventListener('keydown', (e) => {
  if ((e.key === ' ' || e.key === 'Enter') && document.activeElement === document.body) {
    e.preventDefault();
    shoot.click();
  }
});
window.addEventListener('pagehide', stop);

void start();
