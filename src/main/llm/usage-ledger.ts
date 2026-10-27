import type { Price } from '@shared/settings';
import { localDay } from '../lib/util';
import type { Billing, UsagePurpose, UsageRepo } from '../db/repos/usage-repo';
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

/** Where a price came from (usage_ledger.price, migration 016). */
export type PriceKind = 'live' | 'table' | 'fallback' | 'free';

const CONNECTION_IN_ID = /^cloud_(conn_[a-z]{2,20}(?:_\d{1,2})?)_\d+$/;

/**
 * Who answered (usage_ledger.source): 'local', a cloud connection (its id is carried in the
 * message id, llm/brains.ts), the Claude plan, or Anthropic's API.
 */
export function sourceOf(messageId: string | undefined, billing: Billing): string {
  // AI Router: free tiers, not billed (llm/pool/pool.ts gives its answers "pool_" ids).
  if (messageId?.startsWith('pool_')) return 'pool';
  if (messageId?.startsWith('local_') || billing === 'local') return 'local';
  const conn = messageId ? CONNECTION_IN_ID.exec(messageId)?.[1] : undefined;
  if (conn) return conn;
  if (messageId?.startsWith('cloud_')) return 'cloud';
  return billing === 'subscription' ? 'claude-plan' : 'anthropic';
}

export function createUsageLedger(deps: {
  repo: UsageRepo;
  settings: SettingsService;
  /** Subscription calls are recorded at their API-equivalent cost but never count against the budget. */
  billing?: () => Billing;
  /** A gateway's own listed price for this model on this connection (integrations step 5). */
  livePrice?: (connectionId: string, model: string) => Price | null;
  onUpdate?: (s: {
    dayCostUsd: number;
    monthCostUsd: number;
    model: string;
    purpose: UsagePurpose;
  }) => void;
}) {
  const { repo, settings } = deps;

  /**
   * A model's price: Sir's own table first (he may correct a gateway), then the gateway's listed
   * price for that connection, else the dearest known model so the budget errs on the safe side.
   */
  function priceInfo(model: string, source?: string): { price: Price; kind: PriceKind } {
    const table = settings.get('pricing');
    const own = table[model];
    if (own) return { price: own, kind: 'table' };
    const live = source?.startsWith('conn_') ? deps.livePrice?.(source, model) : null;
    if (live) return { price: live, kind: 'live' };
    return {
      price: Object.values(table).reduce<Price>((a, b) => (b.outPerMTok > a.outPerMTok ? b : a), {
        inPerMTok: 5,
        outPerMTok: 25,
        cacheReadPerMTok: 0.5,
        cacheWritePerMTok: 6.25,
      }),
      kind: 'fallback',
    };
  }
  const priceFor = (model: string, source?: string): Price => priceInfo(model, source).price;

  function totals(now = new Date()): { day: number; month: number } {
    const day = localDay(now);
    return {
      day: repo.totals(day, day, 'api').costUsd,
      month: repo.totals(monthStart(day), day, 'api').costUsd,
    };
  }

  return {
    priceFor,
    priceInfo,
    totals,
    record(
      message: Pick<LlmMessage, 'model' | 'usage'> & { id?: string },
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
      // A local-model answer (also a fallback while the API is chosen) is free: local-client ids start "local_".
      // Another provider's API ("cloud_") is pay-per-use whichever connection is Jarvis's own.
      const billing =
        message.id?.startsWith('local_') || message.id?.startsWith('pool_')
          ? 'local'
          : message.id?.startsWith('cloud_')
            ? 'api'
            : (deps.billing?.() ?? 'api');
      // ADR-013: a model on Sir's own machine costs nothing per call.
      const source = sourceOf(message.id, billing);
      const info = billing === 'local' ? null : priceInfo(message.model, source);
      const costUsd = info
        ? costOf(info.price, tokens) + searches * settings.get('pricing.webSearchPerUse')
        : 0;
      repo.insert({
        model: message.model,
        purpose,
        conversationId,
        inputTokens: tokens.input,
        outputTokens: tokens.output,
        cacheReadTokens: tokens.cacheRead,
        cacheWriteTokens: tokens.cacheWrite,
        estCostUsd: costUsd,
        billing,
        source,
        price: info?.kind ?? 'free',
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
