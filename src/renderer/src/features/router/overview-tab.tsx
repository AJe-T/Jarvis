import { AlertTriangle, ArrowRight, Brain, Cloud, Lock, ShieldAlert, Sparkles } from 'lucide-react';
import clsx from 'clsx';
import type { PoolSnapshot, PoolTier } from '@shared/free-pool';
import { AiMap } from './ai-map';
import type { RouterTab } from './ai-map-model';
import { Panel, ProviderDot, StatTile, TierTag, fmtAgo, fmtIn, fmtTokens } from './parts';

function providerLabel(s: PoolSnapshot, id: string): string {
  return s.providers.find((p) => p.id === id)?.label ?? id;
}

/** Overview: today's numbers, the map of every AI, how the tiers stand, the last answers. */
export function OverviewTab({
  snap,
  onOpen,
}: {
  snap: PoolSnapshot;
  onOpen: (tab: RouterTab) => void;
}): React.JSX.Element {
  const t2 = snap.providers.filter((p) => p.tier === 2 && p.enabled);
  const t2Keys = t2.reduce((n, p) => n + p.keys.length, 0);
  const t3 = snap.providers.filter((p) => p.tier === 3);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Free answers today" value={String(snap.today.requests)} />
        <StatTile
          label="Success rate"
          value={`${(snap.today.successRate * 100).toFixed(1)}%`}
          hint="after automatic retries"
        />
        <StatTile label="Tokens today" value={fmtTokens(snap.today.tokens)} />
        <StatTile
          label="Saved vs Claude"
          value={`$${snap.today.savedUsd.toFixed(2)}`}
          hint="what Claude would have cost"
        />
      </div>

      <Panel title="Your AI map" aside="Click any box to change it">
        <AiMap snap={snap} onOpen={onOpen} />
      </Panel>

      <Panel title="Who answers what" aside="Tier = who receives your text, not the model name">
        <ol className="grid gap-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr]">
          <TierCard
            tier={1}
            icon={<Brain size={18} aria-hidden />}
            title="Brain"
            who="Claude · your local model"
            rule="Private and important work. Anything that touched memory, files, the screen, passwords or messages stays here."
            status="Always on"
          />
          <Arrow />
          <TierCard
            tier={2}
            icon={<Cloud size={18} aria-hidden />}
            title="Trusted free"
            who={`${t2.length} providers · ${t2Keys} keys`}
            rule="Heavy but harmless work: summaries, drafts, translations, research reading."
            status={!snap.enabled ? 'Switched off' : t2Keys ? 'Ready' : 'No key yet'}
            live={snap.enabled && t2Keys > 0}
          />
          <Arrow />
          <TierCard
            tier={3}
            icon={<ShieldAlert size={18} aria-hidden />}
            title="Third-party"
            who={`${t3.length} relays · last resort`}
            rule="Only when tiers 1 and 2 are out of limits, only after you say yes, and never with private data."
            status="Asks you first"
          />
        </ol>
      </Panel>

      <BudgetPanel snap={snap} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Paused routes" aside={`${snap.pressure.length} cooling down`}>
          {snap.pressure.length === 0 ? (
            <p className="text-sm text-ink-300">Every route is ready.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {snap.pressure.map((p) => (
                <li
                  key={`${p.providerId}-${p.modelLabel}`}
                  className="flex items-center gap-3 rounded-sm bg-surface-2 px-3 py-2 text-sm"
                >
                  <AlertTriangle size={14} aria-hidden className="shrink-0 text-lamp-400" />
                  <span className="min-w-0 flex-1 truncate text-ink-100">
                    {p.modelLabel}{' '}
                    <span className="text-ink-500">via {providerLabel(snap, p.providerId)}</span>
                  </span>
                  <span className="hidden text-ink-300 md:inline">{p.reason}</span>
                  <span className="font-code text-xs text-ink-500 tabular-nums">
                    back in {fmtIn(p.until)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="When everything is busy">
          <div
            role="note"
            className="flex items-start gap-3 rounded-md border border-line bg-surface-2 p-3 text-sm"
          >
            <Lock size={16} aria-hidden className="mt-0.5 shrink-0 text-lamp-400" />
            <p className="text-ink-300">
              <span className="font-medium text-ink-100">Example:</span> “All free AIs are busy: 7
              routes checked (5 rate limited or paused, 2 out of today’s limit). Soonest back in
              about 2 min. Claude can do this one instead.”
            </p>
          </div>
          <p className="text-xs text-ink-500">
            Jarvis says plainly why nothing free could answer and what happens next, instead of a
            vague error.
          </p>
        </Panel>
      </div>

      <Panel title="Last answers from the pool" aside="every reply says who answered">
        <ul className="flex flex-col divide-y divide-line-subtle">
          {snap.recent.length === 0 && (
            <li className="text-sm text-ink-300">
              Nothing yet. Claude hands the free pool heavy, non-private sub-tasks; you can also ask
              “use the free pool to summarise …”.
            </li>
          )}
          {snap.recent.map((a) => (
            <li key={a.id} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate font-medium text-ink-100">{a.task}</span>
                <span className="font-code text-xs text-ink-500">{fmtAgo(a.at)}</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-300">
                {a.tried.map((t) => (
                  <span key={t.providerId} className="inline-flex items-center gap-1.5">
                    <ProviderDot id={t.providerId} />
                    <span className="line-through decoration-ink-500">
                      {providerLabel(snap, t.providerId)}
                    </span>
                    <span className="text-ink-500">({t.reason})</span>
                    <ArrowRight size={12} aria-hidden className="text-ink-500" />
                  </span>
                ))}
                <span className="inline-flex items-center gap-1.5 rounded-sm bg-accent-tint px-2 py-0.5 text-accent-tag-ink">
                  <Sparkles size={12} aria-hidden />
                  {providerLabel(snap, a.providerId)} · {a.modelLabel}
                </span>
                <TierTag tier={a.tier} short />
                <span className="font-code text-ink-500 tabular-nums">
                  {(a.ms / 1000).toFixed(1)}s · {fmtTokens(a.tokens)} tokens
                </span>
              </div>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function Arrow(): React.JSX.Element {
  return (
    <li aria-hidden className="hidden items-center text-ink-500 lg:flex">
      <ArrowRight size={18} />
    </li>
  );
}

function TierCard({
  tier,
  icon,
  title,
  who,
  rule,
  status,
  live,
}: {
  tier: PoolTier;
  icon: React.ReactNode;
  title: string;
  who: string;
  rule: string;
  status: string;
  live?: boolean;
}): React.JSX.Element {
  return (
    <li className="flex flex-col gap-2 rounded-md border border-line bg-surface-2 p-4">
      <div className="flex items-center gap-2 text-ink-100">
        {icon}
        <span className="font-semibold">{title}</span>
        <span className="ml-auto">
          <TierTag tier={tier} short />
        </span>
      </div>
      <span className="text-xs text-ink-500">{who}</span>
      <p className="flex-1 text-sm text-ink-300">{rule}</p>
      <span
        className={clsx(
          'inline-flex items-center gap-1.5 font-code text-xs',
          live ? 'text-ok-400' : 'text-ink-500',
        )}
      >
        <span
          aria-hidden
          className={clsx('size-1.5 rounded-full', live ? 'bg-ok-400' : 'bg-ink-500')}
        />
        {status}
      </span>
    </li>
  );
}

/** Monthly free-token budget as one stacked bar, a colour per model (FreeLLMAPI's best view). */
function BudgetPanel({ snap }: { snap: PoolSnapshot }): React.JSX.Element {
  const total = snap.models.reduce((n, m) => n + m.monthlyTokens, 0);
  const used = snap.models.reduce((n, m) => n + m.usedTokens, 0);
  // Most free tiers publish daily caps, not monthly ones: then the bar shares out what was used.
  const scale = Math.max(total, used, 1);
  const palette = [
    'var(--accent-500)',
    'var(--neon-magenta)',
    'var(--neon-green)',
    'var(--lamp-400)',
    'var(--neon-violet)',
    'var(--neon-orange)',
    'var(--alarm-500)',
    'var(--ink-300)',
  ];
  return (
    <Panel
      title="Free tokens this month"
      aside={
        <>
          <span className="font-medium text-ink-100">{fmtTokens(used)}</span> used
          {total > 0 && ` of ${fmtTokens(total)} known monthly allowance`}
        </>
      }
    >
      <div
        className="flex h-3 w-full overflow-hidden rounded-full bg-surface-2"
        role="img"
        aria-label={`${fmtTokens(used)} of ${fmtTokens(total)} free tokens used this month`}
      >
        {snap.models.map((m, i) => (
          <span
            key={m.id}
            style={{
              width: `${(m.usedTokens / scale) * 100}%`,
              background: palette[i % palette.length],
            }}
          />
        ))}
      </div>
      <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {snap.models.map((m, i) => (
          <li key={m.id} className="flex items-center gap-2 text-sm">
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full"
              style={{ background: palette[i % palette.length] }}
            />
            <span className="min-w-0 flex-1 truncate text-ink-100">{m.label}</span>
            <span className="font-code text-xs text-ink-500 tabular-nums">
              {fmtTokens(m.usedTokens)}
              {m.monthlyTokens > 0 && ` / ${fmtTokens(m.monthlyTokens)}`}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
