import { loadOwwModels, loadSileroVad, type Vad } from '../local/onnx';
import { createOpenWakeWord } from '../local/open-wake-word';
import { createPersonalWake } from '../local/personal-wake';
import {
  createSpotterWake,
  keywordsText,
  loadSpotterModel,
  type SpotterModel,
} from '../local/spotter';
import type { WakeWord } from '../types';
import type { WakeSpec } from './protocol';

const round2 = (n: number): number => Math.round(n * 100) / 100;

type Log = (level: 'info' | 'warn', obj: Record<string, unknown>, msg: string) => void;

/**
 * The real-time models as the audio worker runs them (voice fix 1B). The same code the main process
 * used before; only where it runs changed. The spotter's model is kept once loaded (a few MB).
 */
export function createAudioEngines(log: Log) {
  const spotters = new Map<string, Promise<SpotterModel>>();

  function spotterModel(dir: string): Promise<SpotterModel> {
    let p = spotters.get(dir);
    if (!p) {
      p = loadSpotterModel(dir);
      p.catch(() => spotters.delete(dir));
      spotters.set(dir, p);
    }
    return p;
  }

  return {
    /** `onNearMiss`: told of each near miss instead of only logging it (main double-checks those). */
    async openWake(
      spec: WakeSpec,
      onNearMiss?: (info: Record<string, unknown>) => void,
    ): Promise<WakeWord> {
      const near = (info: Record<string, unknown>): void =>
        onNearMiss ? onNearMiss(info) : log('info', info, 'wake word near miss');
      if (spec.engine === 'spotter') {
        const model = await spotterModel(spec.dir);
        const engine = await model.open(keywordsText(spec.phrases, model.pieces, spec.threshold));
        return createSpotterWake(engine, {
          onHeard: (phrase) =>
            log('info', { phrase, threshold: spec.threshold }, 'wake word heard'),
        });
      }
      const models = await loadOwwModels(spec.dir);
      if (spec.engine === 'openwakeword')
        return createOpenWakeWord(models, spec.threshold, Date.now, (score) =>
          near({ engine: 'hey-jarvis', score: round2(score), threshold: spec.threshold }),
        );
      return createPersonalWake(models, spec.templates, {
        sensitivity: spec.sensitivity,
        ...(spec.classifierThreshold !== undefined
          ? { classifierThreshold: spec.classifierThreshold }
          : {}),
        onNearMiss: (distance, threshold) =>
          near({ engine: 'personal', distance: round2(distance), threshold: round2(threshold) }),
      });
    },

    openVad: (path: string): Promise<Vad> => loadSileroVad(path),
  };
}
