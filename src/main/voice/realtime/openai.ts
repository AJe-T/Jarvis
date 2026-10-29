import { JarvisError } from '../../errors';
import { nodeSocket, waitOpen, type OpenSocket } from '../tts/stream-tts';
import { createUpsampler16to24, fromBase64, toBase64 } from './resample';
import type { RealtimeProvider, RealtimeToolCall } from './types';

/**
 * OpenAI Realtime (GA) over a WebSocket, checked 2026-10-29 against
 * developers.openai.com/api/docs/guides/realtime-conversations and realtime-function-calling:
 * session.update { type: 'realtime', audio: { input|output: { format: audio/pcm 24 kHz } } },
 * input_audio_buffer.append, response.output_audio.delta, function calls in response.done,
 * function_call_output + response.create, conversation.item.truncate after an interruption.
 */
export function createOpenAiRealtime(o: {
  key: () => string | undefined;
  model: () => string;
  voice: () => string;
  open?: OpenSocket;
}): RealtimeProvider {
  return {
    id: 'openai',
    get model() {
      return o.model();
    },
    async connect({ instructions, tools, signal }, cb) {
      const key = o.key();
      if (!key)
        throw new JarvisError(
          'INVALID',
          'no openai key',
          'Realtime conversation with OpenAI needs an OpenAI API key (Settings → AI Router → Providers).',
        );
      const model = o.model();
      const sock = (o.open ?? nodeSocket)(
        `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`,
        { authorization: `Bearer ${key}` },
      );
      let open = true;
      const send = (m: Record<string, unknown>): void => {
        if (open && sock.readyState === 1) sock.send(JSON.stringify(m));
      };
      /** The reply being spoken, for truncating it when Sir interrupts. */
      let speakingItem = '';
      sock.addEventListener('message', (e) => {
        let m: Record<string, unknown>;
        try {
          m = JSON.parse(String(e.data)) as Record<string, unknown>;
        } catch {
          return;
        }
        switch (m['type']) {
          case 'response.output_audio.delta':
            if (typeof m['item_id'] === 'string') speakingItem = m['item_id'];
            if (typeof m['delta'] === 'string') cb.onAudio(fromBase64(m['delta']));
            return;
          case 'input_audio_buffer.speech_started':
            return cb.onSpeechStarted();
          case 'conversation.item.input_audio_transcription.completed':
            if (typeof m['transcript'] === 'string' && m['transcript'].trim())
              cb.onTranscript('user', m['transcript'].trim());
            return;
          case 'response.output_audio_transcript.done':
            if (typeof m['transcript'] === 'string' && m['transcript'].trim())
              cb.onTranscript('assistant', m['transcript'].trim());
            return;
          case 'response.done': {
            const r = (m['response'] ?? {}) as {
              output?: Array<{
                type?: string;
                call_id?: string;
                name?: string;
                arguments?: string;
              }>;
              usage?: { input_tokens?: number; output_tokens?: number };
            };
            const calls: RealtimeToolCall[] = (r.output ?? [])
              .filter((x) => x.type === 'function_call' && x.call_id && x.name)
              .map((x) => {
                let args: unknown;
                try {
                  args = JSON.parse(x.arguments ?? '{}');
                } catch {
                  args = {};
                }
                return { id: x.call_id as string, name: x.name as string, args };
              });
            cb.onReplyDone(
              r.usage
                ? { input: r.usage.input_tokens ?? 0, output: r.usage.output_tokens ?? 0 }
                : null,
            );
            if (calls.length) cb.onToolCalls(calls);
            return;
          }
          case 'error': {
            const err = (m['error'] ?? {}) as { message?: string };
            return cb.onWarning(`OpenAI: ${err.message ?? 'error'}`);
          }
          default:
            return;
        }
      });
      sock.addEventListener('close', () => {
        if (!open) return;
        open = false;
        cb.onClose('OpenAI ended the conversation');
      });
      sock.addEventListener('error', () => cb.onWarning('OpenAI connection error'));
      signal.addEventListener('abort', () => sock.close(), { once: true });
      await waitOpen(sock, 8000);
      send({
        type: 'session.update',
        session: {
          type: 'realtime',
          model,
          output_modalities: ['audio'],
          instructions,
          audio: {
            input: {
              format: { type: 'audio/pcm', rate: 24_000 },
              turn_detection: { type: 'semantic_vad' },
            },
            output: { format: { type: 'audio/pcm', rate: 24_000 }, voice: o.voice() },
          },
          tools: tools.map((t) => ({ type: 'function', ...t })),
          tool_choice: 'auto',
        },
      });
      // Separately, so a service that refuses it still keeps the session above: Sir's words as text.
      send({
        type: 'session.update',
        session: {
          type: 'realtime',
          audio: { input: { transcription: { model: 'gpt-4o-mini-transcribe' } } },
        },
      });
      const up = createUpsampler16to24();
      return {
        sendAudio(frame) {
          send({ type: 'input_audio_buffer.append', audio: toBase64(up(frame)) });
        },
        sendToolResults(results) {
          for (const r of results)
            send({
              type: 'conversation.item.create',
              item: { type: 'function_call_output', call_id: r.id, output: r.output },
            });
          send({ type: 'response.create' });
        },
        addContext(text) {
          send({
            type: 'session.update',
            session: { type: 'realtime', instructions: `${instructions}\n\n${text}` },
          });
        },
        truncate(playedMs) {
          if (!speakingItem) return;
          send({
            type: 'conversation.item.truncate',
            item_id: speakingItem,
            content_index: 0,
            audio_end_ms: Math.max(0, Math.round(playedMs)),
          });
          speakingItem = '';
        },
        close() {
          open = false;
          sock.close();
        },
      };
    },
  };
}
