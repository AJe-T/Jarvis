import { describe, expect, it } from 'vitest';
import { fitColibri } from './colibri';

describe('which colibri model fits', () => {
  it('starts a 16 GB laptop on the best model that runs from RAM', () => {
    const { recommended, fits } = fitColibri(16, 300);
    expect(recommended?.id).toBe('qwen36-35b');
    expect(fits.find((f) => f.model.id === 'qwen36-35b')?.fit).toBe('slow');
    expect(fits.find((f) => f.model.id === 'qwen38-flash-next')?.fit).toBe('no-ram');
  });

  it('prefers a model that runs well, and says when the disk is too small', () => {
    const { recommended, fits } = fitColibri(32, 40);
    expect(recommended?.id).toBe('qwen36-35b');
    expect(fits.find((f) => f.model.id === 'deepseek-v4-flash')?.fit).toBe('no-disk');
  });

  it('recommends nothing below 8 GB of RAM', () => {
    expect(fitColibri(6, 500).recommended).toBeNull();
  });
});
