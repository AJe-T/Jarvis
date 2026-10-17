import { localDay, newId } from '../../lib/util';
import type { Db } from '../connection';

export type UsagePurpose =
  | 'chat'
  | 'curator'
  | 'title'
  | 'summary'
  | 'desktop_agent'
  | 'eval'
  | 'intent'
  | 'research'
  | 'briefing'
  | 'copilot'
  | 'task';
export type Billing = 'api' | 'subscription' | 'local';

export interface UsageEntry {
  model: string;
  purpose: UsagePurpose;
  conversationId: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  estCostUsd: number;
  billing?: Billing;
  /** Who answered (llm/usage-ledger.ts sourceOf); migration 016. */
  source?: string;
  /** Where the price came from: live, table, fallback, free. */
  price?: string;
}

export type BreakdownBy = 'model' | 'purpose' | 'day' | 'source' | 'billing';

export function createUsageRepo(db: Db) {
  return {
    insert(e: UsageEntry, at = new Date()): void {
      db.prepare(
        `INSERT INTO usage_ledger (id, ts, day, model, purpose, conversation_id, input_tokens, output_tokens,
           cache_read_tokens, cache_write_tokens, est_cost_usd, billing, source, price)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        newId('u_'),
        at.toISOString(),
        localDay(at),
        e.model,
        e.purpose,
        e.conversationId,
        e.inputTokens,
        e.outputTokens,
        e.cacheReadTokens,
        e.cacheWriteTokens,
        e.estCostUsd,
        e.billing ?? 'api',
        e.source ?? null,
        e.price ?? null,
      );
    },

    /** Sum over local days in [fromDay, toDay]. */
    totals(fromDay: string, toDay: string, billing?: Billing): { costUsd: number; tokens: number } {
      const r = db
        .prepare(
          `SELECT COALESCE(SUM(est_cost_usd), 0) AS cost,
             COALESCE(SUM(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens), 0) AS tokens
           FROM usage_ledger WHERE day BETWEEN ? AND ? AND (? IS NULL OR billing = ?)`,
        )
        .get(fromDay, toDay, billing ?? null, billing ?? null) as { cost: number; tokens: number };
      return { costUsd: r.cost, tokens: r.tokens };
    },

    /** Estimated cost of one conversation so far (all billings; local calls cost 0). */
    conversationCost(conversationId: string): number {
      const r = db
        .prepare(
          'SELECT COALESCE(SUM(est_cost_usd), 0) AS cost FROM usage_ledger WHERE conversation_id = ?',
        )
        .get(conversationId) as { cost: number };
      return r.cost;
    },

    /** `estimated` = calls priced like the dearest model because the real price is unknown. */
    breakdown(fromDay: string, toDay: string, by: BreakdownBy) {
      // Fixed column expressions only (never from the request). Rows before migration 016 have no source.
      const col = {
        model: 'model',
        purpose: 'purpose',
        day: 'day',
        source: "COALESCE(source, 'earlier')",
        billing: 'billing',
      }[by];
      return db
        .prepare(
          `SELECT ${col} AS key, SUM(est_cost_usd) AS costUsd,
             SUM(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens) AS tokens, COUNT(*) AS calls,
             SUM(CASE WHEN price = 'fallback' THEN 1 ELSE 0 END) AS estimated
           FROM usage_ledger WHERE day BETWEEN ? AND ? GROUP BY ${col} ORDER BY ${by === 'day' ? 'key' : 'costUsd DESC'}`,
        )
        .all(fromDay, toDay) as Array<{
        key: string;
        costUsd: number;
        tokens: number;
        calls: number;
        estimated: number;
      }>;
    },
  };
}

export type UsageRepo = ReturnType<typeof createUsageRepo>;
