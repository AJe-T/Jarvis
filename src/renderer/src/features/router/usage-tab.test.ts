import { describe, expect, it } from 'vitest';
import { parseAmount } from './usage-tab';

describe('Usage → your own numbers', () => {
  it('reads plain numbers, separators and K/M/B; empty means Jarvis’s number', () => {
    expect(parseAmount('500,000', 1e12)).toBe(500_000);
    expect(parseAmount('500K', 1e12)).toBe(500_000);
    expect(parseAmount(' 1.5m ', 1e12)).toBe(1_500_000);
    expect(parseAmount('2B', 1e12)).toBe(2_000_000_000);
    expect(parseAmount('', 1e12)).toBeNull();
  });

  it('refuses words, zero, negatives and numbers past the cap (the form stays open)', () => {
    for (const bad of ['fifty', '0', '-5', '1e5', '5x'])
      expect(parseAmount(bad, 1e12)).toBeUndefined();
    expect(parseAmount('2B', 1e9)).toBeUndefined();
  });
});
