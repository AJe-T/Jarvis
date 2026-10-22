declare module 'pino-roll';

/** The part of sherpa-onnx-node (Apache-2.0, no bundled types) the keyword spotter uses (ADR-044). */
declare module 'sherpa-onnx-node' {
  export interface OnlineStream {
    acceptWaveform(wave: { sampleRate: number; samples: Float32Array }): void;
  }
  export interface KeywordSpotterConfig {
    featConfig: { sampleRate: number; featureDim: number };
    modelConfig: {
      transducer: { encoder: string; decoder: string; joiner: string };
      tokens: string;
      numThreads: number;
      provider: 'cpu';
      debug?: number;
    };
    keywordsFile: string;
    maxActivePaths?: number;
    numTrailingBlanks?: number;
    keywordsScore?: number;
    keywordsThreshold?: number;
  }
  export class KeywordSpotter {
    constructor(config: KeywordSpotterConfig);
    createStream(): OnlineStream;
    isReady(stream: OnlineStream): boolean;
    decode(stream: OnlineStream): void;
    reset(stream: OnlineStream): void;
    getResult(stream: OnlineStream): { keyword: string };
  }
}
