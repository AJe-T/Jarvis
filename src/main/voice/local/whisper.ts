/** Local speech-to-text with Whisper via transformers.js (Apache-2.0) on onnxruntime-node (ADR-011). */
export interface Transcriber {
  /** 16 kHz mono audio in [-1, 1] → text. `language` is a setting code (en-IN, hi, auto…). */
  transcribe(audio: Float32Array, language?: string): Promise<string>;
  release(): Promise<void>;
}

/** Whisper's well-known outputs on near-silence or noise. */
const HALLUCINATION =
  /^\s*(\[[^\]]*\]|\([^)]*\)|thank you\.?|thanks for watching!?|you|bye\.?|\.+)\s*$/i;

/** Settings language code → Whisper language name; undefined lets Whisper detect it. */
export function whisperLanguage(code: string | undefined): string | undefined {
  const base = (code ?? 'auto').toLowerCase().split('-')[0];
  return { en: 'english', hi: 'hindi', te: 'telugu', ta: 'tamil', bn: 'bengali', mr: 'marathi' }[
    base ?? ''
  ];
}

export function cleanTranscript(text: string, seconds: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return seconds < 1.5 && HALLUCINATION.test(t) ? '' : t;
}

/**
 * `dir` is models/<id>, holding the pinned transformers.js layout (config, tokenizer, onnx/*_quantized).
 * Any model the ASR pipeline knows works here: Whisper, Distil-Whisper, Moonshine, Parakeet CTC (ADR-038).
 */
export async function loadWhisper(
  dir: string,
  multilingual: boolean,
  threads?: number,
): Promise<Transcriber> {
  const { env, pipeline } = await import('@huggingface/transformers');
  // Never fetch anything at runtime: only the files Jarvis downloaded and verified.
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = '';
  const asr = await pipeline('automatic-speech-recognition', dir, {
    // int8 for every part: Whisper/Moonshine's encoder + merged decoder, Parakeet's single model.
    dtype: 'q8',
    device: 'cpu',
    // onnxruntime's default takes every core, starving the rest of the PC (ADR-029).
    ...(threads ? { session_options: { intraOpNumThreads: threads } } : {}),
  });
  return {
    async transcribe(audio, language) {
      // Multilingual models guess the language on short clips badly ("Yabbies!"); pin it unless "auto".
      const lang = multilingual ? whisperLanguage(language) : undefined;
      const opts = multilingual
        ? { task: 'transcribe' as const, ...(lang ? { language: lang } : {}) }
        : {};
      const out = (await asr(audio, opts)) as { text: string } | Array<{ text: string }>;
      const text = Array.isArray(out) ? out.map((o) => o.text).join(' ') : out.text;
      return cleanTranscript(text, audio.length / 16000);
    },
    release: () => asr.dispose(),
  };
}
