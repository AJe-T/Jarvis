import type { Price } from '@shared/settings';
import { localDay } from '../lib/util';
import type { UsagePurpose, UsageRepo } from '../db/repos/usage-repo';
import type { SettingsService } from '../settings/settings-service';
import type { LlmMessage } from './types';

export interface UsageRecord {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
}

export function costOf(
  price: Price,
  u: { input: number; output: number; cacheRead: number; cacheWrite: number },
): number {
  return (
    (u.input * price.inPerMTok +
      u.output * price.outPerMTok +
      u.cacheRead * price.cacheReadPerMTok +
      u.cacheWrite * price.cacheWritePerMTok) /
    1_000_000
  );
}

export function monthStart(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

export function createUsageLedger(deps: {
  repo: UsageRepo;
  settings: SettingsService;
  onUpdate?: (s: {
    dayCostUsd: number;
    monthCostUsd: number;
    model: string;
    purpose: UsagePurpose;
  }) => void;
}) {
  const { repo, settings } = deps;

  function priceFor(model: string): Price {
    const table = settings.get('pricing');
    // Unknown model: price it like the most expensive known model so the budget errs on the safe side.
    return (
      table[model] ??
      Object.values(table).reduce<Price>((a, b) => (b.outPerMTok > a.outPerMTok ? b : a), {
        inPerMTok: 5,
        outPerMTok: 25,
        cacheReadPerMTok: 0.5,
        cacheWritePerMTok: 6.25,
      })
    );
  }

  function totals(now = new Date()): { day: number; month: number } {
    const day = localDay(now);
    return { day: repo.totals(day, day).costUsd, month: repo.totals(monthStart(day), day).costUsd };
  }

  return {
    priceFor,
    totals,
    record(
      message: Pick<LlmMessage, 'model' | 'usage'>,
      purpose: UsagePurpose,
      conversationId: string | null,
    ): UsageRecord {
      const u = message.usage;
      const tokens = {
        input: u.input_tokens,
        output: u.output_tokens,
        cacheRead: u.cache_read_input_tokens ?? 0,
        cacheWrite: u.cache_creation_input_tokens ?? 0,
      };
      const searches = u.server_tool_use?.web_search_requests ?? 0;
      const costUsd =
        costOf(priceFor(message.model), tokens) +
        searches * settings.get('pricing.webSearchPerUse');
      repo.insert({
        model: message.model,
        purpose,
        conversationId,
        inputTokens: tokens.input,
        outputTokens: tokens.output,
        cacheReadTokens: tokens.cacheRead,
        cacheWriteTokens: tokens.cacheWrite,
        estCostUsd: costUsd,
      });
      const t = totals();
      deps.onUpdate?.({ dayCostUsd: t.day, monthCostUsd: t.month, model: message.model, purpose });
      return {
        costUsd,
        inputTokens: tokens.input + tokens.cacheRead + tokens.cacheWrite,
        outputTokens: tokens.output,
      };
    },
  };
}

export type UsageLedger = ReturnType<typeof createUsageLedger>;
