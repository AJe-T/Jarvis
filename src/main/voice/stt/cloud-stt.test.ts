import { describe, expect, it, vi } from 'vitest';
import {
  assemblyAiTranscriber,
  elevenLabsTranscriber,
  groqTranscriber,
  isoLanguage,
  openAiTranscriber,
  serverTranscriber,
  windowsTranscriber,
} from './cloud-stt';

const audio = new Float32Array(16000 * 2).fill(0.1); // 2 s, long enough to keep short phrases
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const bodyOf = (body: RequestInit['body'] | undefined): Record<string, unknown> =>
  JSON.parse(body as string) as Record<string, unknown>;

function capture(response: () => Response) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: url as string, init: init ?? {} });
    return response();
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetch };
}

describe('phrase speech-to-text engines (ADR-038)', () => {
  it('turns setting languages into ISO codes, leaving auto to the service', () => {
    expect(isoLanguage('en-IN')).toBe('en');
    expect(isoLanguage('te')).toBe('te');
    expect(isoLanguage('auto')).toBeUndefined();
  });

  it('sends Groq a WAV with the model and language, and refuses redirects', async () => {
    const { calls, fetch } = capture(() => json({ text: ' open notepad ' }));
    const t = groqTranscriber({
      key: () => 'gsk_test',
      model: () => 'whisper-large-v3-turbo',
      fetch,
    });
    expect(await t.transcribe(audio, 'en-IN')).toBe('open notepad');
    const [call] = calls;
    expect(call?.url).toBe('https://api.groq.com/openai/v1/audio/transcriptions');
    expect(call?.init.redirect).toBe('error');
    expect((call?.init.headers as Record<string, string>)['authorization']).toBe('Bearer gsk_test');
    const form = call?.init.body as FormData;
    expect(form.get('model')).toBe('whisper-large-v3-turbo');
    expect(form.get('language')).toBe('en');
    const file = form.get('file') as Blob;
    expect(file.type).toBe('audio/wav');
    expect(
      Buffer.from(await file.arrayBuffer())
        .subarray(0, 4)
        .toString(),
    ).toBe('RIFF');
  });

  it('asks for a key before sending anything', async () => {
    const { fetch } = capture(() => json({}));
    const t = openAiTranscriber({
      key: () => undefined,
      model: () => 'gpt-4o-mini-transcribe',
      fetch,
    });
    await expect(t.transcribe(audio, 'en')).rejects.toMatchObject({
      userMessage: 'Add your OpenAI key in Settings → Voice.',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports a rejected key without echoing the response body', async () => {
    const { fetch } = capture(() => json({ error: 'secret echo sk-123' }, 401));
    const t = openAiTranscriber({ key: () => 'sk', model: () => 'whisper-1', fetch });
    const err = (await t.transcribe(audio, 'en').catch((e: unknown) => e)) as Error;
    expect(String((err as { userMessage?: string }).userMessage)).toContain('rejected the key');
    expect(err.message).not.toContain('sk-123');
  });

  it('lets an own server work without a key, but only at an allowed address', async () => {
    const { calls, fetch } = capture(() => json({ text: 'hello' }));
    const ok = serverTranscriber({
      url: () => 'http://localhost:8000/v1/',
      key: () => undefined,
      model: () => 'Systran/faster-whisper-small',
      fetch,
    });
    expect(await ok.transcribe(audio, 'auto')).toBe('hello');
    expect(calls[0]?.url).toBe('http://localhost:8000/v1/audio/transcriptions');
    expect((calls[0]?.init.headers as Record<string, string>)['authorization']).toBeUndefined();
    expect((calls[0]?.init.body as FormData).get('language')).toBeNull();

    const remote = serverTranscriber({
      url: () => 'http://example.com/v1',
      key: () => undefined,
      model: () => 'x',
      fetch,
    });
    await expect(remote.transcribe(audio, 'en')).rejects.toThrow('speech server url refused');
    expect(calls).toHaveLength(1);
  });

  it('calls ElevenLabs Scribe v2 with its own key header', async () => {
    const { calls, fetch } = capture(() => json({ text: 'namaste' }));
    const t = elevenLabsTranscriber({ key: () => 'xi', fetch });
    expect(await t.transcribe(audio, 'hi')).toBe('namaste');
    expect(calls[0]?.url).toBe('https://api.elevenlabs.io/v1/speech-to-text');
    expect((calls[0]?.init.headers as Record<string, string>)['xi-api-key']).toBe('xi');
    const form = calls[0]?.init.body as FormData;
    expect(form.get('model_id')).toBe('scribe_v2');
    expect(form.get('language_code')).toBe('hi');
  });

  it('uploads to AssemblyAI, submits the transcript and polls until completed', async () => {
    const replies = [
      json({ upload_url: 'https://cdn.assemblyai.com/upload/abc' }),
      json({ id: 'tr_1', status: 'queued' }),
      json({ status: 'processing' }),
      json({ status: 'completed', text: 'set a timer' }),
      json({ id: 'tr_1' }),
    ];
    const { calls, fetch } = capture(() => replies.shift() as Response);
    const t = assemblyAiTranscriber({ key: () => 'aai', fetch, sleep: async () => undefined });
    expect(await t.transcribe(audio, 'auto')).toBe('set a timer');
    expect(calls.map((c) => c.url)).toEqual([
      'https://api.assemblyai.com/v2/upload',
      'https://api.assemblyai.com/v2/transcript',
      'https://api.assemblyai.com/v2/transcript/tr_1',
      'https://api.assemblyai.com/v2/transcript/tr_1',
      'https://api.assemblyai.com/v2/transcript/tr_1',
    ]);
    // The transcript (and the audio with it) is deleted once read.
    expect(calls.at(-1)?.init.method).toBe('DELETE');
    expect(bodyOf(calls[1]?.init.body)).toEqual({
      audio_url: 'https://cdn.assemblyai.com/upload/abc',
      language_detection: true,
    });
    expect((calls[0]?.init.headers as Record<string, string>)['authorization']).toBe('aai');
  });

  it('stops polling AssemblyAI when the job fails', async () => {
    const replies = [
      json({ upload_url: 'u' }),
      json({ id: 'tr_2' }),
      json({ status: 'error', error: 'bad audio' }),
      json({}),
    ];
    const { fetch } = capture(() => replies.shift() as Response);
    const t = assemblyAiTranscriber({ key: () => 'k', fetch, sleep: async () => undefined });
    await expect(t.transcribe(audio, 'en')).rejects.toThrow('AssemblyAI: transcript failed');
  });

  it('reads the phrase with Windows speech from a temp WAV passed as a parameter, then deletes it', async () => {
    const run = vi.fn(async () => ({ stdout: 'what time is it', stderr: '', exitCode: 0 }));
    const files = { writeFile: vi.fn(async () => undefined), rm: vi.fn(async () => undefined) };
    const t = windowsTranscriber(run, files);
    expect(await t.transcribe(audio, 'en')).toBe('what time is it');
    const [script, opts] = run.mock.calls[0] as unknown as [string, { params: { wav: string } }];
    expect(script).not.toContain(opts.params.wav); // never spliced into the script text
    expect(files.rm).toHaveBeenCalledWith(opts.params.wav, { force: true });
  });

  it('explains how to turn Windows speech on when it is missing', async () => {
    const run = vi.fn(async () => ({ stdout: '', stderr: 'No recognizer installed', exitCode: 1 }));
    const files = { writeFile: vi.fn(async () => undefined), rm: vi.fn(async () => undefined) };
    const err = (await windowsTranscriber(run, files)
      .transcribe(audio, 'en')
      .catch((e: unknown) => e)) as { userMessage?: string };
    expect(err.userMessage).toContain('Time & language → Speech');
    expect(files.rm).toHaveBeenCalled();
  });
});
