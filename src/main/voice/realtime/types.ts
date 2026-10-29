/**
 * Voice fix 3: optional realtime speech-to-speech (OpenAI Realtime, Gemini Live) behind one
 * interface. The service hears Sir and speaks itself; Jarvis still owns the microphone, playback,
 * memory, budgets and every tool call (tools/executor.ts).
 */

/** A Jarvis tool as a realtime function (JSON Schema parameters). */
export interface RealtimeTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface RealtimeToolCall {
  id: string;
  name: string;
  args: unknown;
}

export interface RealtimeUsage {
  input: number;
  output: number;
}

export interface RealtimeCallbacks {
  /** Model speech: 16-bit little-endian mono PCM at 24 kHz. */
  onAudio(pcm: Uint8Array): void;
  /** Sir started talking (the service stops its reply; playback must stop too). */
  onSpeechStarted(): void;
  /** One finished line of the conversation. */
  onTranscript(role: 'user' | 'assistant', text: string): void;
  /** The model wants these tools run (all calls of one reply, together). */
  onToolCalls(calls: RealtimeToolCall[]): void;
  /** A reply finished; its token use when the service reports it. */
  onReplyDone(usage: RealtimeUsage | null): void;
  /** A non-fatal problem the service reported. */
  onWarning(message: string): void;
  /** The connection ended (network, the service's time limit, an error). */
  onClose(why: string): void;
}

export interface RealtimeConnection {
  /** 16 kHz mono 16-bit microphone frames (resampled here if the service wants another rate). */
  sendAudio(frame: Int16Array): void;
  /** Answers to one reply's tool calls; the model then continues. */
  sendToolResults(results: Array<{ id: string; name: string; output: string }>): void;
  /** Notes from Sir's memory for what he just asked (not a request). */
  addContext(text: string): void;
  /** Sir interrupted after `playedMs` of the current reply: forget what he didn't hear. */
  truncate(playedMs: number): void;
  close(): void;
}

export interface RealtimeProvider {
  readonly id: 'openai' | 'gemini';
  readonly model: string;
  connect(
    o: { instructions: string; tools: RealtimeTool[]; signal: AbortSignal },
    cb: RealtimeCallbacks,
  ): Promise<RealtimeConnection>;
}
