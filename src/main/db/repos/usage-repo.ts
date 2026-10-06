import { localDay, newId } from '../../lib/util';
import type { Db } from '../connection';

export type UsagePurpose = 'chat' | 'curator' | 'title' | 'summary' | 'desktop_agent' | 'eval';

export interface UsageEntry {
  model: string;
  purpose: UsagePurpose;
  conversationId: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  estCostUsd: number;
}

export function createUsageRepo(db: Db) {
  return {
    insert(e: UsageEntry, at = new Date()): void {
      db.prepare(
        `INSERT INTO usage_ledger (id, ts, day, model, purpose, conversation_id, input_tokens, output_tokens,
           cache_read_tokens, cache_write_tokens, est_cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      );
    },

    /** Sum over local days in [fromDay, toDay]. */
    totals(fromDay: string, toDay: string): { costUsd: number; tokens: number } {
      const r = db
        .prepare(
          `SELECT COALESCE(SUM(est_cost_usd), 0) AS cost,
             COALESCE(SUM(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens), 0) AS tokens
           FROM usage_ledger WHERE day BETWEEN ? AND ?`,
        )
        .get(fromDay, toDay) as { cost: number; tokens: number };
      return { costUsd: r.cost, tokens: r.tokens };
    },

    breakdown(fromDay: string, toDay: string, by: 'model' | 'purpose' | 'day') {
      const col = { model: 'model', purpose: 'purpose', day: 'day' }[by];
      return db
        .prepare(
          `SELECT ${col} AS key, SUM(est_cost_usd) AS costUsd,
             SUM(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens) AS tokens, COUNT(*) AS calls
           FROM usage_ledger WHERE day BETWEEN ? AND ? GROUP BY ${col} ORDER BY ${by === 'day' ? 'key' : 'costUsd DESC'}`,
        )
        .all(fromDay, toDay) as Array<{
        key: string;
        costUsd: number;
        tokens: number;
        calls: number;
      }>;
    },
  };
}

export type UsageRepo = ReturnType<typeof createUsageRepo>;
