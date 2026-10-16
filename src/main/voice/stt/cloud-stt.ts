import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isAllowedSpeechServer, speechServerUrl } from '@shared/speech-engines';
import { JarvisError } from '../../errors';
import { newId } from '../../lib/util';
import { runPowerShell } from '../../tools/powershell';
import { cleanTranscript, type Transcriber } from '../local/whisper';
import { readJsonCapped } from '../http-body';
import { httpError } from '../tts/cloud-tts';
import { encodeWav } from '../wav';

/**
 * ADR-038: speech-to-text engines that read a whole phrase. Silero VAD on this PC decides when Sir
 * stopped talking (local-stt.ts), then the phrase goes to one of these as a 16 kHz WAV. API
 * shapes verified 2026-10-15 against each provider's docs (API-Guide.md §9.2).
 */

type Fetch = typeof fetch;
const TIMEOUT_MS = 30_000;
const SAMPLE_RATE = 16_000;

/** Settings language (en-IN, hi, auto) → ISO-639-1; undefined lets the service detect it. */
export function isoLanguage(code: string | undefined): string | undefined {
  if (!code || code === 'auto') return undefined;
  return code.toLowerCase().split('-')[0];
}

function needKey(key: string | undefined, who: string): string {
  if (!key)
    throw new JarvisError('INVALID', `no ${who} key`, `Add your ${who} key in Settings → Voice.`);
  return key;
}

const wavBlob = (audio: Float32Array): Blob =>
  new Blob([encodeWav(audio, SAMPLE_RATE)], { type: 'audio/wav' });

const textOf = (j: unknown): string =>
  j && typeof j === 'object' && typeof (j as { text?: unknown }).text === 'string'
    ? (j as { text: string }).text
    : '';

const timeout = (): AbortSignal => AbortSignal.timeout(TIMEOUT_MS);

const finish = (text: string, audio: Float32Array): string =>
  cleanTranscript(text, audio.length / SAMPLE_RATE);

/** OpenAI's /audio/transcriptions, as served by OpenAI, Groq and self-hosted servers. */
export function createOpenAiTranscriber(o: {
  who: string;
  url: () => string;
  key: () => string | undefined;
  keyOptional?: boolean;
  model: () => string;
  /** Self-hosted: the address comes from Settings, so it is checked on every use. */
  checkUrl?: boolean;
  fetch?: Fetch;
}): Transcriber {
  return {
    async transcribe(audio, language) {
      const key = o.keyOptional ? o.key() : needKey(o.key(), o.who);
      const url = o.url();
      if (o.checkUrl && !isAllowedSpeechServer(url.replace(/\/audio\/transcriptions$/, '')))
        throw new JarvisError(
          'INVALID',
          'speech server url refused',
          'The speech server address must be https://, or http:// to this PC or your home network.',
        );
      const form = new FormData();
      form.append('file', wavBlob(audio), 'speech.wav');
      form.append('model', o.model());
      form.append('response_format', 'json');
      const lang = isoLanguage(language);
      if (lang) form.append('language', lang);
      const res = await (o.fetch ?? fetch)(url, {
        method: 'POST',
        headers: key ? { authorization: `Bearer ${key}` } : {},
        body: form,
        redirect: 'error',
        signal: timeout(),
      });
      if (!res.ok) throw httpError(o.who, res.status, 'transcribe');
      return finish(textOf(await readJsonCapped(res, o.who)), audio);
    },
    release: async () => undefined,
  };
}

export const groqTranscriber = (o: {
  key: () => string | undefined;
  model: () => string;
  fetch?: Fetch;
}): Transcriber =>
  createOpenAiTranscriber({
    who: 'Groq',
    url: () => 'https://api.groq.com/openai/v1/audio/transcriptions',
    ...o,
  });

export const openAiTranscriber = (o: {
  key: () => string | undefined;
  model: () => string;
  fetch?: Fetch;
}): Transcriber =>
  createOpenAiTranscriber({
    who: 'OpenAI',
    url: () => 'https://api.openai.com/v1/audio/transcriptions',
    ...o,
  });

export const serverTranscriber = (o: {
  url: () => string;
  key: () => string | undefined;
  model: () => string;
  fetch?: Fetch;
}): Transcriber =>
  createOpenAiTranscriber({
    who: 'The speech server',
    url: () => speechServerUrl(o.url(), 'audio/transcriptions'),
    key: o.key,
    keyOptional: true,
    checkUrl: true,
    model: o.model,
    ...(o.fetch ? { fetch: o.fetch } : {}),
  });

/** ElevenLabs Scribe v2: multipart model_id + file, header xi-api-key; text in `text`. */
export function elevenLabsTranscriber(o: {
  key: () => string | undefined;
  fetch?: Fetch;
}): Transcriber {
  return {
    async transcribe(audio, language) {
      const key = needKey(o.key(), 'ElevenLabs');
      const form = new FormData();
      form.append('model_id', 'scribe_v2');
      form.append('file', wavBlob(audio), 'speech.wav');
      const lang = isoLanguage(language);
      if (lang) form.append('language_code', lang);
      const res = await (o.fetch ?? fetch)('https://api.elevenlabs.io/v1/speech-to-text', {
        method: 'POST',
        headers: { 'xi-api-key': key },
        body: form,
        redirect: 'error',
        signal: timeout(),
      });
      if (!res.ok) throw httpError('ElevenLabs', res.status, 'transcribe');
      return finish(textOf(await readJsonCapped(res, 'ElevenLabs')), audio);
    },
    release: async () => undefined,
  };
}

const ASSEMBLY = 'https://api.assemblyai.com/v2';
const POLL_MS = 400;

/** AssemblyAI: upload the WAV, ask for a transcript, poll until it is completed or failed. */
export function assemblyAiTranscriber(o: {
  key: () => string | undefined;
  fetch?: Fetch;
  sleep?: (ms: number) => Promise<void>;
}): Transcriber {
  const doFetch = o.fetch ?? fetch;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  return {
    async transcribe(audio, language) {
      try {
        return await transcribeOnce(audio, language);
      } catch (err) {
        if (err instanceof Error && err.name === 'TimeoutError')
          throw new JarvisError(
            'TOOL_FAILED',
            'AssemblyAI: timed out',
            'AssemblyAI took too long.',
          );
        throw err;
      }
    },
    release: async () => undefined,
  };

  async function transcribeOnce(audio: Float32Array, language?: string): Promise<string> {
    const key = needKey(o.key(), 'AssemblyAI');
    const signal = AbortSignal.timeout(60_000);
    const call = async (path: string, init: RequestInit = {}): Promise<unknown> => {
      const res = await doFetch(`${ASSEMBLY}${path}`, {
        ...init,
        headers: { authorization: key, ...(init.headers as Record<string, string>) },
        redirect: 'error',
        signal,
      });
      if (!res.ok) throw httpError('AssemblyAI', res.status, 'transcribe');
      return readJsonCapped(res, 'AssemblyAI');
    };
    const upload = (await call('/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: Buffer.from(encodeWav(audio, SAMPLE_RATE)),
    })) as { upload_url?: string };
    if (!upload.upload_url) throw new Error('AssemblyAI: no upload_url');
    const lang = isoLanguage(language);
    const job = (await call('/transcript', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        audio_url: upload.upload_url,
        ...(lang ? { language_code: lang } : { language_detection: true }),
      }),
    })) as { id?: string };
    if (!job.id || !/^[\w-]{1,100}$/.test(job.id)) throw new Error('AssemblyAI: bad transcript id');
    try {
      for (;;) {
        await sleep(POLL_MS);
        const t = (await call(`/transcript/${job.id}`)) as {
          status?: string;
          text?: string | null;
        };
        if (t.status === 'completed') return finish(t.text ?? '', audio);
        // The service's error text can echo the request, so only the fact is kept.
        if (t.status === 'error')
          throw new JarvisError(
            'TOOL_FAILED',
            'AssemblyAI: transcript failed',
            "AssemblyAI couldn't transcribe that.",
          );
      }
    } finally {
      // AssemblyAI keeps audio and text until deleted; Jarvis needs neither once it has the words.
      await doFetch(`${ASSEMBLY}/transcript/${job.id}`, {
        method: 'DELETE',
        headers: { authorization: key },
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      }).catch(() => undefined);
    }
  }
}

/**
 * Windows' own recogniser (System.Speech, dictation grammar) reading the phrase from a WAV file.
 * Offline and needs nothing installed beyond Windows' speech language.
 */
export function windowsTranscriber(
  run: typeof runPowerShell = runPowerShell,
  files = { writeFile, rm },
): Transcriber {
  return {
    async transcribe(audio, language) {
      const wav = join(tmpdir(), `jarvis-stt-${newId()}.wav`);
      await files.writeFile(wav, encodeWav(audio, SAMPLE_RATE));
      const script = `Add-Type -AssemblyName System.Speech
$info = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() |
  Where-Object { $_.Culture.Name -eq [string]$P.lang } | Select-Object -First 1
$r = if ($info) { New-Object System.Speech.Recognition.SpeechRecognitionEngine($info) } else { New-Object System.Speech.Recognition.SpeechRecognitionEngine }
try {
  $r.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
  $r.SetInputToWaveFile([string]$P.wav)
  $words = @()
  while ($true) { $res = $r.Recognize(); if ($null -eq $res) { break }; $words += $res.Text }
  [Console]::Out.Write(($words -join ' '))
} finally { $r.Dispose() }`;
      try {
        // en-IN → en-IN recogniser if Windows has one; otherwise the default (usually en-US).
        const lang = language && language !== 'auto' ? language : '';
        const r = await run(script, { params: { wav, lang }, timeoutMs: 30_000 });
        if (r.exitCode !== 0)
          throw new JarvisError(
            'TOOL_FAILED',
            `windows speech: ${r.stderr.slice(0, 200)}`,
            'Windows speech recognition is not available. Turn it on in Windows Settings → Time & language → Speech, or choose another engine.',
          );
        return finish(r.stdout, audio);
      } finally {
        await files.rm(wav, { force: true });
      }
    },
    release: async () => undefined,
  };
}
