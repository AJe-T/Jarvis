import type { Tier } from '@shared/types';
import type { Tool } from '../tools/types';
import { contentGuard, urlGuard } from './guards';
import type { PathGuard } from './path-guard';
import { checkShellScript } from './shell-guard';

export interface PolicyDecision {
  tier: Tier;
  reason: string;
  humanSummary: string;
  destructive: boolean;
}

export interface PolicyContext {
  signal: AbortSignal;
  tainted: boolean;
  /** The turn read outside text that tried to instruct the AI (injection-scan.ts). */
  suspicious?: boolean;
  /** A tool in this turn returned private data (a key, password, card number…). */
  privateData?: boolean;
}

const RANK: Record<Tier, number> = { SAFE: 0, CONFIRM: 1, BLOCKED: 2 };
const stricter = (a: Tier, b: Tier): Tier => (RANK[a] >= RANK[b] ? a : b);

export interface PolicyDeps {
  pathGuard: Pick<PathGuard, 'check'>;
  budgetExceeded(): boolean;
  overrides(): Record<string, Tier>;
}

/**
 * Security.md §5. Pure and synchronous: the model has no way to influence the outcome beyond the
 * tool input, which every guard inspects. Order: kill switch/budget → tool tier → global BLOCKED
 * rules → user overrides (tighten only) → taint escalation.
 */
export function createPolicyEngine(deps: PolicyDeps) {
  return {
    evaluate(tool: Tool, input: unknown, ctx: PolicyContext): PolicyDecision {
      const humanSummary = safeSummary(tool, input);
      const destructive =
        typeof tool.destructive === 'function'
          ? tool.destructive(input)
          : (tool.destructive ?? false);
      const blocked = (reason: string): PolicyDecision => ({
        tier: 'BLOCKED',
        reason,
        humanSummary,
        destructive,
      });

      if (ctx.signal.aborted) return blocked('All activity was stopped (kill switch).');
      if (deps.budgetExceeded()) return blocked('The spending budget is used up.');

      let tier: Tier = typeof tool.tier === 'function' ? tool.tier(input) : tool.tier;
      if (tier === 'BLOCKED') return blocked('This action is never allowed.');

      const g = tool.guards?.(input) ?? {};
      for (const p of g.paths ?? []) {
        const r = deps.pathGuard.check(p);
        if (!r.ok) return blocked(r.reason);
      }
      if (g.script !== undefined) {
        const v = checkShellScript(g.script);
        if (v.blocked) return blocked(`The script includes ${v.reasons.join('; ')}.`);
      }
      for (const u of g.urls ?? []) {
        const r = urlGuard(u.url, { allowPrivate: u.allowPrivate ?? false });
        if (!r.ok) return blocked(r.reason);
      }
      for (const t of g.text ?? []) {
        const r = contentGuard(t);
        if (!r.ok) return blocked(r.reason);
      }

      const override = deps.overrides()[tool.name];
      if (override) {
        tier = stricter(tier, override);
        if (tier === 'BLOCKED') return blocked('Sir has blocked this tool in Settings.');
      }

      const external =
        typeof tool.externalFacing === 'function'
          ? tool.externalFacing(input)
          : (tool.externalFacing ?? false);
      // An injection attempt was seen this turn: nothing runs without Sir, not only external actions.
      if (ctx.suspicious && tier === 'SAFE') {
        return {
          tier: 'CONFIRM',
          reason: 'Suggested after reading content that tried to give the AI instructions.',
          humanSummary,
          destructive,
        };
      }
      // Read private data, then reach outside: ask first (idea from ruflo's protector, rule PR-004).
      if (ctx.privateData && external && tier === 'SAFE') {
        return {
          tier: 'CONFIRM',
          reason: 'Suggested after reading private data.',
          humanSummary,
          destructive,
        };
      }
      if (ctx.tainted && external && tier === 'SAFE') {
        return {
          tier: 'CONFIRM',
          reason: 'Suggested after reading external content.',
          humanSummary,
          destructive,
        };
      }
      return {
        tier,
        reason: tier === 'SAFE' ? 'Safe action.' : 'Needs your approval.',
        humanSummary,
        destructive,
      };
    },
  };
}

function safeSummary(tool: Tool, input: unknown): string {
  try {
    return tool.summarize(input);
  } catch {
    return tool.name;
  }
}

export type PolicyEngine = ReturnType<typeof createPolicyEngine>;
