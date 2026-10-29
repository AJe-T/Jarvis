import { JarvisError } from '../../errors';
import { nodeSocket, waitOpen, type OpenSocket } from '../tts/stream-tts';
import { fromBase64, toBase64 } from './resample';
import type { RealtimeProvider, RealtimeToolCall } from './types';

/** JSON Schema keywords the Gemini function schema (an OpenAPI subset) accepts. */
const KEEP = new Set([
  'type',
  'description',
  'properties',
  'required',
  'items',
  'enum',
  'format',
  'nullable',
]);

/** Zod's JSON Schema → the subset Gemini's FunctionDeclaration.parameters takes. */
export function geminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(geminiSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (!KEEP.has(k)) continue;
    if (k === 'properties' && v && typeof v === 'object')
      out[k] = Object.fromEntries(Object.entries(v).map(([p, s]) => [p, geminiSchema(s)]));
    else if (k === 'items') out[k] = geminiSchema(v);
    else if (k === 'type' && Array.isArray(v)) {
      // ['string', 'null'] → string + nullable
      out['type'] = v.find((t) => t !== 'null') ?? 'string';
      if (v.includes('null')) out['nullable'] = true;
    } else out[k] = v;
  }
  return out;
}

/**
 * Gemini Live over its raw WebSocket, checked 2026-10-29 against ai.google.dev/api/live and
 * /gemini-api/docs/live-api/get-started-websocket: `setup` first (wait for setupComplete),
 * realtimeInput.audio as 16 kHz PCM, 24 kHz PCM back in serverContent.modelTurn, toolCall /
 * toolResponse matched by id. The key goes in the `key` query parameter, as documented; the URL is
 * never logged.
 */
export function createGeminiLive(o: {
  key: () => string | undefined;
  model: () => string;
  voice: () => string;
  open?: OpenSocket;
}): RealtimeProvider {
  return {
    id: 'gemini',
    get model() {
      return o.model();
    },
    async connect({ instructions, tools, signal }, cb) {
      const key = o.key();
      if (!key)
        throw new JarvisError(
          'INVALID',
          'no gemini key',
          'Realtime conversation with Gemini needs a Gemini API key (Settings → AI Router → Providers).',
        );
      const sock = (o.open ?? nodeSocket)(
        `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(key)}`,
        {},
      );
      sock.binaryType = 'arraybuffer';
      let open = true;
      let ready: () => void = () => undefined;
      const setupDone = new Promise<void>((r) => (ready = r));
      let heardText = '';
      let saidText = '';
      let usage: { input: number; output: number } | null = null;
      const send = (m: Record<string, unknown>): void => {
        if (open && sock.readyState === 1) sock.send(JSON.stringify(m));
      };
      const flushLines = (): void => {
        if (heardText.trim()) cb.onTranscript('user', heardText.trim());
        if (saidText.trim()) cb.onTranscript('assistant', saidText.trim());
        heardText = '';
        saidText = '';
      };
      sock.addEventListener('message', (e) => {
        let m: Record<string, unknown>;
        try {
          const raw =
            e.data instanceof ArrayBuffer ? new TextDecoder().decode(e.data) : String(e.data);
          m = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          return;
        }
        if (m['setupComplete']) ready();
        const u = m['usageMetadata'] as
          { promptTokenCount?: number; responseTokenCount?: number } | undefined;
        if (u) usage = { input: u.promptTokenCount ?? 0, output: u.responseTokenCount ?? 0 };
        const tc = m['toolCall'] as
          { functionCalls?: Array<{ id?: string; name?: string; args?: unknown }> } | undefined;
        if (tc?.functionCalls?.length) {
          const calls: RealtimeToolCall[] = tc.functionCalls
            .filter((c) => c.id && c.name)
            .map((c) => ({ id: c.id as string, name: c.name as string, args: c.args ?? {} }));
          if (calls.length) cb.onToolCalls(calls);
        }
        if (m['goAway']) cb.onWarning('Gemini is ending the session soon (its time limit)');
        const sc = m['serverContent'] as
          | {
              modelTurn?: { parts?: Array<{ inlineData?: { data?: string } }> };
              interrupted?: boolean;
              turnComplete?: boolean;
              inputTranscription?: { text?: string };
              outputTranscription?: { text?: string };
            }
          | undefined;
        if (!sc) return;
        if (sc.interrupted) cb.onSpeechStarted();
        if (sc.inputTranscription?.text) heardText += sc.inputTranscription.text;
        if (sc.outputTranscription?.text) saidText += sc.outputTranscription.text;
        for (const p of sc.modelTurn?.parts ?? [])
          if (p.inlineData?.data) cb.onAudio(fromBase64(p.inlineData.data));
        if (sc.turnComplete) {
          flushLines();
          // ponytail: usageMetadata may be per turn or a running total; counted as per turn, which
          // can only overstate the spend (the budget errs on the safe side).
          cb.onReplyDone(usage);
          usage = null;
        }
      });
      sock.addEventListener('close', () => {
        if (!open) return;
        open = false;
        flushLines();
        cb.onClose('Gemini ended the conversation');
      });
      sock.addEventListener('error', () => cb.onWarning('Gemini connection error'));
      signal.addEventListener('abort', () => sock.close(), { once: true });
      await waitOpen(sock, 8000);
      send({
        setup: {
          model: `models/${o.model()}`,
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: o.voice() } } },
          },
          systemInstruction: { parts: [{ text: instructions }] },
          ...(tools.length
            ? {
                tools: [
                  {
                    functionDeclarations: tools.map((t) => ({
                      name: t.name,
                      description: t.description,
                      parameters: geminiSchema(t.parameters),
                    })),
                  },
                ],
              }
            : {}),
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
      });
      await Promise.race([
        setupDone,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Gemini did not finish setting up')), 8000),
        ),
      ]);
      return {
        sendAudio(frame) {
          send({
            realtimeInput: { audio: { data: toBase64(frame), mimeType: 'audio/pcm;rate=16000' } },
          });
        },
        sendToolResults(results) {
          send({
            toolResponse: {
              functionResponses: results.map((r) => ({
                id: r.id,
                name: r.name,
                response: { output: r.output },
              })),
            },
          });
        },
        addContext(text) {
          send({
            clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: false },
          });
        },
        truncate() {
          // Gemini stops and forgets an interrupted reply by itself.
        },
        close() {
          open = false;
          sock.close();
        },
      };
    },
  };
}
