import { describe, expect, it, vi } from 'vitest';

type Listener = (...args: unknown[]) => void;

/** A fake Deepgram live socket: closes with 1000 "aborted" when the abort signal fires, like the SDK. */
const sockets: Array<{ emit: (event: string, ...args: unknown[]) => void }> = [];
vi.mock('@deepgram/sdk', () => ({
  DeepgramClient: class {
    listen = {
      v1: {
        connect: async ({ abortSignal }: { abortSignal: AbortSignal }) => {
          const on = new Map<string, Listener[]>();
          const emit = (event: string, ...args: unknown[]): void =>
            (on.get(event) ?? []).forEach((l) => l(...args));
          abortSignal.addEventListener('abort', () =>
            queueMicrotask(() => emit('close', { code: 1000, reason: 'aborted' })),
          );
          const socket = {
            on: (event: string, l: Listener) => on.set(event, [...(on.get(event) ?? []), l]),
            connect: () => undefined,
            waitForOpen: async () => undefined,
            sendMedia: () => undefined,
            sendCloseStream: () => undefined,
            close: () => undefined,
          };
          sockets.push({ emit });
          return socket;
        },
      },
    };
  },
}));
vi.mock('@picovoice/porcupine-node', () => ({ Porcupine: class {}, BuiltinKeyword: {} }));
vi.mock('@picovoice/pvrecorder-node', () => ({ PvRecorder: class {} }));

const { createDeepgramStt } = await import('./providers');

describe('Deepgram live session closing', () => {
  it('does not report its own abort as Deepgram dropping the connection', async () => {
    const abort = new AbortController();
    const session = await createDeepgramStt(() => 'key').start({
      sampleRate: 16000,
      language: 'en-US',
      signal: abort.signal,
    });
    const errors: unknown[] = [];
    session.on('error', (e) => errors.push(e));
    abort.abort(); // endListening aborts before session.close()
    await new Promise((r) => setTimeout(r, 0));
    void session.close();
    expect(errors).toEqual([]);
  });

  it('still reports Deepgram closing the line itself', async () => {
    const session = await createDeepgramStt(() => 'key').start({
      sampleRate: 16000,
      language: 'en-US',
      signal: new AbortController().signal,
    });
    const errors: Error[] = [];
    session.on('error', (e) => errors.push(e));
    sockets.at(-1)?.emit('close', { code: 1011, reason: 'NET-0001' });
    expect(errors.map((e) => e.message)).toEqual([
      'Deepgram closed the connection (close 1011: NET-0001)',
    ]);
  });
});
