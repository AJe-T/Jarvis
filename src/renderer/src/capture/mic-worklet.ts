// Voice fix 1C: runs on the capture window's audio thread (AudioWorkletGlobalScope), replacing the
// deprecated ScriptProcessorNode. Turns the 16 kHz float input into Int16 frames of exactly the
// length main asked for and posts each one to capture.ts (the buffer is transferred, not copied).

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: unknown);
}
declare function registerProcessor(name: string, processor: unknown): void;

class MicFrames extends AudioWorkletProcessor {
  private readonly frameLength: number;
  private frame: Int16Array;
  private filled = 0;

  constructor(options: { processorOptions?: { frameLength?: number } }) {
    super(options);
    this.frameLength = Math.max(
      128,
      Math.min(16_000, options.processorOptions?.frameLength ?? 512),
    );
    this.frame = new Int16Array(this.frameLength);
  }

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i] ?? 0));
      this.frame[this.filled++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.filled === this.frameLength) {
        this.port.postMessage(this.frame.buffer, [this.frame.buffer]);
        this.frame = new Int16Array(this.frameLength);
        this.filled = 0;
      }
    }
    return true; // keep running while the microphone is connected
  }
}

registerProcessor('mic-frames', MicFrames);

// A module, so the declarations above stay private to this file.
export {};
