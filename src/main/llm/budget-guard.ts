import { JarvisError } from '../errors';
import type { SettingsService } from '../settings/settings-service';
import type { UsageLedger } from './usage-ledger';

export interface BudgetGuard {
  /** Throws BUDGET_EXCEEDED before a Claude call when a budget or the per-turn ceiling is reached. */
  assertCanSpend(turnInputTokens?: number): void;
  isExceeded(): boolean;
}

/** Jarvis's own connection is paid per use (API key or cloud); subscription and local are not. */
const ownPaid = (settings: SettingsService): boolean => {
  const p = settings.get('llm.provider');
  return p === 'api' || p === 'cloud';
};

/** Share (0–1+) of today's Claude budget spent; 0 when Jarvis's connection isn't paid per use. */
export function dayShare(ledger: UsageLedger, settings: SettingsService): number {
  const daily = settings.get('budget.dailyUsd');
  if (!ownPaid(settings) || daily <= 0) return 0;
  return ledger.totals().day / daily;
}

/** Security.md §11. */
export function createBudgetGuard(
  ledger: UsageLedger,
  settings: SettingsService,
  /** Calls through this guard are paid per use; default: Jarvis's own connection decides. */
  paid?: () => boolean,
): BudgetGuard {
  const budgetError = (text: string): JarvisError => new JarvisError('BUDGET_EXCEEDED', text, text);

  function check(): JarvisError | null {
    // ADR-010/013: subscription and local models have no per-call charge; budgets limit API-key spend.
    if (!(paid ? paid() : ownPaid(settings))) return null;
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
