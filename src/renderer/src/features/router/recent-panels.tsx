import { AlertTriangle, ArrowRight, Sparkles } from 'lucide-react';
import type { PoolSnapshot } from '@shared/free-pool';
import { Panel, ProviderDot, TierTag, fmtAgo, fmtIn, fmtTokens } from './parts';

function providerLabel(s: PoolSnapshot, id: string): string {
  return s.providers.find((p) => p.id === id)?.label ?? id;
}

/** Bottom of AI Router → Usage: routes cooling down now, and the pool's last answers. */
export function RecentPanels({ snap }: { snap: PoolSnapshot }): React.JSX.Element {
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
      <Panel title="Paused right now" aside={`${snap.pressure.length} cooling down`}>
        {snap.pressure.length === 0 ? (
          <p className="text-sm text-ink-300">Every free model is ready.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {snap.pressure.map((p) => (
              <li
                key={`${p.providerId}-${p.modelLabel}`}
                className="flex items-center gap-3 rounded-sm bg-surface-2 px-3 py-2 text-sm"
              >
                <AlertTriangle size={14} aria-hidden className="shrink-0 text-lamp-400" />
                <span className="min-w-0 flex-1 truncate text-ink-100" title={p.reason}>
                  {p.modelLabel}{' '}
                  <span className="text-ink-500">via {providerLabel(snap, p.providerId)}</span>
                </span>
                <span className="font-code text-xs text-ink-500 tabular-nums">
                  back in {fmtIn(p.until)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Last answers from free AIs" aside="every reply says who answered">
        <ul className="flex flex-col divide-y divide-line-subtle">
          {snap.recent.length === 0 && (
            <li className="text-sm text-ink-300">
              Nothing yet. Try “use the free pool to summarise …”.
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
