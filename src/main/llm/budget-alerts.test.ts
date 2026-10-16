import { describe, expect, it } from 'vitest';
import { budgetAlertText, createBudgetAlerts, type BudgetAlert } from './budget-alerts';

function setup() {
  const alerts: BudgetAlert[] = [];
  const b = createBudgetAlerts({ onAlert: (a) => alerts.push(a) });
  const budget = { daily: 2, monthly: 30 };
  const at = (day: string, dayCostUsd: number, monthCostUsd = 0) =>
    b.check({ day, dayCostUsd, monthCostUsd }, budget);
  return { alerts, at };
}

describe('budget alerts', () => {
  it('says nothing under 50 %', () => {
    const { alerts, at } = setup();
    at('2026-10-15', 0.99);
    expect(alerts).toEqual([]);
  });

  it('warns once per step and only the highest step crossed', () => {
    const { alerts, at } = setup();
    at('2026-10-15', 1.0);
    at('2026-10-15', 1.1);
    at('2026-10-15', 1.85); // jumps past 75 % straight to 90 %
    at('2026-10-15', 1.9);
    expect(alerts.map((a) => a.step)).toEqual([0.5, 0.9]);
  });

  it('starts again on a new day and leaves 100 % to the budget guard', () => {
    const { alerts, at } = setup();
    at('2026-10-15', 1.6);
    at('2026-10-16', 2.5);
    at('2026-10-16', 1.2);
    expect(alerts.map((a) => [a.period, a.step])).toEqual([
      ['day', 0.75],
      ['day', 0.5],
    ]);
  });

  it('tracks the month separately and ignores a zero budget', () => {
    const alerts: BudgetAlert[] = [];
    const b = createBudgetAlerts({ onAlert: (a) => alerts.push(a) });
    b.check({ day: '2026-10-15', dayCostUsd: 5, monthCostUsd: 16 }, { daily: 0, monthly: 30 });
    expect(alerts).toEqual([{ period: 'month', step: 0.5, spentUsd: 16, budgetUsd: 30 }]);
    expect(budgetAlertText(alerts[0] as BudgetAlert)).toBe(
      "You've used 50% of this month's budget ($16.00 of $30.00).",
    );
  });
});
