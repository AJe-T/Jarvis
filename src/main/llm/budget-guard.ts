import { JarvisError } from '../errors';
import type { SettingsService } from '../settings/settings-service';
import type { UsageLedger } from './usage-ledger';

export interface BudgetGuard {
  /** Throws BUDGET_EXCEEDED before a Claude call when a budget or the per-turn ceiling is reached. */
  assertCanSpend(turnInputTokens?: number): void;
  isExceeded(): boolean;
}

/** Security.md §11. */
export function createBudgetGuard(ledger: UsageLedger, settings: SettingsService): BudgetGuard {
  const budgetError = (text: string): JarvisError => new JarvisError('BUDGET_EXCEEDED', text, text);

  function check(): JarvisError | null {
    const { day, month } = ledger.totals();
    const daily = settings.get('budget.dailyUsd');
    const monthly = settings.get('budget.monthlyUsd');
    if (day >= daily)
      return budgetError(
        `Today's budget ($${daily.toFixed(2)}) is used up. Adjust it in Settings → Brain.`,
      );
    if (month >= monthly)
      return budgetError(
        `This month's budget ($${monthly.toFixed(2)}) is used up. Adjust it in Settings → Brain.`,
      );
    return null;
  }
  return {
    assertCanSpend(turnInputTokens = 0) {
      const err = check();
      if (err) throw err;
      const ceiling = settings.get('budget.perTurnInputTokens');
      if (turnInputTokens > ceiling)
        throw budgetError(
          `I stopped this task because it used over ${ceiling.toLocaleString()} input tokens.`,
        );
    },
    isExceeded: () => check() !== null,
  };
}
