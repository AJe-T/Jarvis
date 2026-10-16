/**
 * Early budget warnings (idea from ruflo's cost tracker): a heads-up at 50 %, 75 % and 90 % of the
 * daily and monthly API budgets, before the budget guard stops spending at 100 %.
 * Each step is said once per day (or month); only the highest step crossed is reported.
 */

export const BUDGET_WARN_STEPS = [0.5, 0.75, 0.9] as const;

export interface BudgetAlert {
  period: 'day' | 'month';
  step: number;
  spentUsd: number;
  budgetUsd: number;
}

export function budgetAlertText(a: BudgetAlert): string {
  const pct = Math.round(a.step * 100);
  const which = a.period === 'day' ? "today's" : "this month's";
  return `You've used ${pct}% of ${which} budget ($${a.spentUsd.toFixed(2)} of $${a.budgetUsd.toFixed(2)}).`;
}

export function createBudgetAlerts(deps: { onAlert: (a: BudgetAlert) => void }) {
  // ponytail: in memory, so a restart may repeat the current step once; persist if that annoys.
  const fired = new Map<string, number>();

  function checkOne(period: 'day' | 'month', key: string, spentUsd: number, budgetUsd: number) {
    if (budgetUsd <= 0) return;
    const ratio = spentUsd / budgetUsd;
    // At 100 % the budget guard speaks for itself.
    if (ratio >= 1) return;
    const step = [...BUDGET_WARN_STEPS].reverse().find((s) => ratio >= s);
    if (step === undefined) return;
    const id = `${period}:${key}`;
    if ((fired.get(id) ?? 0) >= step) return;
    fired.set(id, step);
    deps.onAlert({ period, step, spentUsd, budgetUsd });
  }

  return {
    /** `day` is the local date (YYYY-MM-DD); the month key is its first 7 characters. */
    check(
      t: { day: string; dayCostUsd: number; monthCostUsd: number },
      budget: { daily: number; monthly: number },
    ): void {
      checkOne('day', t.day, t.dayCostUsd, budget.daily);
      checkOne('month', t.day.slice(0, 7), t.monthCostUsd, budget.monthly);
    },
  };
}
