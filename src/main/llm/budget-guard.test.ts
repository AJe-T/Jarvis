import { describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '../db/connection';
import { createSettingsRepo } from '../db/repos/settings-repo';
import { createUsageRepo } from '../db/repos/usage-repo';
import { createSettingsService } from '../settings/settings-service';
import { createBudgetGuard, dayShare } from './budget-guard';
import { costOf, createUsageLedger, monthStart } from './usage-ledger';

function setup() {
  const db = openDatabase(':memory:');
  migrate(db);
  const settings = createSettingsService(createSettingsRepo(db));
  const repo = createUsageRepo(db);
  const updates: number[] = [];
  const ledger = createUsageLedger({ repo, settings, onUpdate: (u) => updates.push(u.dayCostUsd) });
  return { db, settings, repo, ledger, guard: createBudgetGuard(ledger, settings), updates };
}

const msg = (model: string, input: number, output: number) =>
  ({
    model,
    usage: {
      input_tokens: input,
      output_tokens: output,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      server_tool_use: null,
    },
  }) as never;

describe('usage ledger', () => {
  it('computes cost from the price table', () => {
    expect(
      costOf(
        { inPerMTok: 2, outPerMTok: 10, cacheReadPerMTok: 0.2, cacheWritePerMTok: 2.5 },
        { input: 1_000_000, output: 100_000, cacheRead: 0, cacheWrite: 0 },
      ),
    ).toBeCloseTo(3);
  });

  it('records usage and reports totals', () => {
    const { ledger, updates } = setup();
    const r = ledger.record(msg('claude-sonnet-5-5', 1_000_000, 0), 'chat', null);
    expect(r.costUsd).toBeCloseTo(2);
    expect(ledger.totals().day).toBeCloseTo(2);
    expect(updates).toHaveLength(1);
  });

  it('prices unknown models conservatively', () => {
    const { ledger } = setup();
    expect(ledger.priceFor('claude-future-9').outPerMTok).toBeGreaterThanOrEqual(20);
  });

  it('adds web search cost', () => {
    const { ledger } = setup();
    const m = msg('claude-sonnet-5-5', 0, 0) as { usage: { server_tool_use: unknown } };
    m.usage.server_tool_use = { web_search_requests: 3 };
    expect(ledger.record(m as never, 'chat', null).costUsd).toBeCloseTo(0.03);
  });

  it('uses the first of the month for monthly totals', () => {
    expect(monthStart('2026-10-06')).toBe('2026-10-01');
  });
});

describe('budget guard', () => {
  it('allows spending under budget', () => {
    expect(() => setup().guard.assertCanSpend()).not.toThrow();
  });

  it('blocks when the daily budget is used up', () => {
    const { ledger, guard } = setup();
    ledger.record(msg('claude-sonnet-5-5', 1_000_000, 0), 'chat', null); // $2 = default daily budget
    expect(() => guard.assertCanSpend()).toThrow(/Today's budget/);
    expect(guard.isExceeded()).toBe(true);
  });

  it('blocks when the monthly budget is used up', () => {
    const { ledger, guard, settings } = setup();
    settings.set('budget.dailyUsd', 100);
    settings.set('budget.monthlyUsd', 1);
    ledger.record(msg('claude-sonnet-5-5', 600_000, 0), 'chat', null);
    expect(() => guard.assertCanSpend()).toThrow(/month's budget/);
  });

  it('reports the share of today spent, only for a paid connection; a free guard never blocks', () => {
    const { ledger, settings } = setup();
    ledger.record(msg('claude-sonnet-5-5', 800_000, 0), 'chat', null); // $1.60 of $2
    expect(dayShare(ledger, settings)).toBeCloseTo(0.8);
    const free = createBudgetGuard(ledger, settings, () => false);
    ledger.record(msg('claude-sonnet-5-5', 800_000, 0), 'chat', null);
    expect(free.isExceeded()).toBe(false);
    expect(() => free.assertCanSpend(250_000)).toThrow(/input tokens/);
    settings.set('llm.provider', 'subscription');
    expect(dayShare(ledger, settings)).toBe(0);
  });

  it('stops a turn over the per-turn token ceiling', () => {
    expect(() => setup().guard.assertCanSpend(250_000)).toThrow(/input tokens/);
  });

  it('day totals ignore previous days', () => {
    const { repo, guard } = setup();
    repo.insert(
      {
        model: 'm',
        purpose: 'chat',
        conversationId: null,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        estCostUsd: 5,
      },
      new Date(Date.now() - 2 * 86_400_000),
    );
    // Could still be within the month; daily guard must not trip.
    expect(() => guard.assertCanSpend()).not.toThrow(/Today's/);
  });
});
