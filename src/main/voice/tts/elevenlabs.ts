import { ELEVEN_VOICE_RE, type ElevenModel } from '@shared/voices';
import { JarvisError } from '../../errors';
import type { TtsChunk, TtsProvider } from '../types';
import { speedFromRate } from './kokoro';

/**
 * ElevenLabs cloud voices: the most natural-sounding option (API verified 2026-10 against
 * elevenlabs.io/docs/api-reference/text-to-speech/stream and /docs/overview/models). The key lives
 * in the secret store and is only sent to api.elevenlabs.io. What Jarvis says leaves the PC, so
 * this is opt-in; the default stays Edge.
 */
export function createElevenLabsTts(deps: {
  key: () => string | undefined;
  voiceId: () => string;
  model: () => ElevenModel;
  fetch?: typeof fetch;
}): TtsProvider {
  return {
    id: 'elevenlabs',
    async *synthesize(text, { rate, signal }) {
      const key = deps.key();
      if (!key)
        throw new JarvisError(
          'INVALID',
          'no elevenlabs key',
          'Add an ElevenLabs API key in Settings → Voice.',
        );
      const voice = deps.voiceId();
      if (!ELEVEN_VOICE_RE.test(voice))
        throw new JarvisError('INVALID', 'bad voice id', 'That ElevenLabs voice id looks wrong.');
      const res = await (deps.fetch ?? fetch)(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}/stream?output_format=mp3_44100_128`,
        {
          method: 'POST',
          headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
          body: JSON.stringify({
            text,
            model_id: deps.model(),
            // ElevenLabs accepts 0.7–1.2.
            voice_settings: { speed: Math.min(1.2, speedFromRate(rate)) },
          }),
          signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
        },
      );
      if (!res.ok) {
        const hint =
          res.status === 401
            ? ' (check the API key)'
            : res.status === 429
              ? ' (quota or rate limit)'
              : '';
        throw new Error(`ElevenLabs: HTTP ${res.status}${hint}`);
      }
      const data = new Uint8Array(await res.arrayBuffer());
      if (signal.aborted) return;
      if (data.length === 0) throw new Error('ElevenLabs returned no audio');
      yield { mime: 'audio/mpeg', data } satisfies TtsChunk;
    },
  };
}
