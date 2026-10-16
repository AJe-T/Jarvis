import { describe, expect, it } from 'vitest';
import { cpuPercent, createSystemSampler } from './system-stats';

describe('system monitor sampler', () => {
  it('measures CPU busy share between two samples', () => {
    expect(cpuPercent({ idle: 100, total: 200 }, { idle: 150, total: 300 })).toBe(50);
    expect(cpuPercent({ idle: 0, total: 0 }, { idle: 0, total: 0 })).toBe(0);
    expect(cpuPercent({ idle: 0, total: 100 }, { idle: 100, total: 200 })).toBe(0);
  });

  it('reads real counters from this machine', () => {
    const s = createSystemSampler()();
    expect(s.cores).toBeGreaterThan(0);
    expect(s.memUsedBytes).toBeLessThanOrEqual(s.memTotalBytes);
    expect(s.cpuPercent).toBeGreaterThanOrEqual(0);
    expect(s.cpuPercent).toBeLessThanOrEqual(100);
  });
});
