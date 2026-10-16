import { describe, expect, it } from 'vitest';
import { createPlanLimitsStore, describePlanLimits, parsePlanLimits } from './plan-limits';

// Shape captured from a live Claude Code 2.x subscription call.
const LIVE = {
  status: 'allowed',
  resetsAt: 1791606600,
  rateLimitType: 'five_hour',
  unifiedWindows: {
    five_hour: { utilization: 0.1, resetsAt: 1791606600 },
    seven_day: { utilization: 0.54, resetsAt: 1791982800 },
  },
};

describe('plan limits', () => {
  it('reads both windows from unifiedWindows as percentages', () => {
    const p = parsePlanLimits(LIVE, 5);
    expect(p).toEqual({
      fiveHour: { usedPercent: 10, resetsAt: 1791606600_000 },
      sevenDay: { usedPercent: 54, resetsAt: 1791982800_000 },
      updatedAt: 5,
    });
  });

  it('falls back to the typed single-window fields and ignores unknown shapes', () => {
    expect(
      parsePlanLimits({ rateLimitType: 'seven_day', utilization: 0.9 }, 1)?.sevenDay?.usedPercent,
    ).toBe(90);
    expect(parsePlanLimits({ status: 'allowed' }, 1)).toBeNull();
    expect(parsePlanLimits('nope', 1)).toBeNull();
  });

  it('keeps the other window when a report covers only one', () => {
    const store = createPlanLimitsStore(() => 7);
    store.record(LIVE);
    store.record({ rateLimitType: 'five_hour', utilization: 0.3 });
    expect(store.get()?.fiveHour?.usedPercent).toBe(30);
    expect(store.get()?.sevenDay?.usedPercent).toBe(54);
  });

  it('describes the numbers for speech', () => {
    expect(describePlanLimits(null)).toMatch(/No plan usage yet/);
    expect(describePlanLimits(parsePlanLimits(LIVE, 1))).toMatch(
      /5-hour window 10% used.*week 54% used/,
    );
  });
});
