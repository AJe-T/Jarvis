import { createAudioEngines } from './engines';
import { createAudioHost } from './host-core';
import type { FromWorker, ToWorker } from './protocol';

/**
 * Voice fix 1B: entry of the audio utility process (built to out/main/audio-host.js). It runs the
 * real-time models (wake words, Silero voice detector) so the Electron main process never waits on
 * them; it reads only the model folders named in each request and never touches settings, files,
 * secrets or the network.
 */
const port = process.parentPort;
const post = (m: FromWorker): void => port.postMessage(m);
const handle = createAudioHost(
  post,
  createAudioEngines((level, obj, msg) => post({ t: 'log', level, obj, msg })),
);
port.on('message', (e: { data: ToWorker }) => handle(e.data));
