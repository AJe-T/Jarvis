import { Fragment, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ChevronUp, Plus, Search } from 'lucide-react';
import clsx from 'clsx';
import {
  ROUTING_STRATEGIES,
  type PoolModel,
  type PoolSnapshot,
  type PoolTier,
  type RoutingStrategy,
} from '@shared/free-pool';
import { IconButton } from '../../components/ui/button';
import {
  FilterChip,
  Meter,
  Panel,
  PhaseTag,
  ProviderDot,
  Segmented,
  SettingRow,
  TierTag,
  Toggle,
  fmtTokens,
} from './parts';

const CONTEXT_STEPS = [
  { id: 0, label: 'Any context' },
  { id: 32, label: '32K+' },
  { id: 128, label: '128K+' },
  { id: 1000, label: '1M+' },
] as const;

/** Models: strategy, filters and the ranked model table with every route under each model. */
export function ModelsTab({ snap }: { snap: PoolSnapshot }): React.JSX.Element {
  const [strategy, setStrategy] = useState<RoutingStrategy>(snap.strategy);
  const [models, setModels] = useState<PoolModel[]>(snap.models);
  const [query, setQuery] = useState('');
  const [tools, setTools] = useState(false);
  const [vision, setVision] = useState(false);
  const [minContext, setMinContext] = useState<number>(0);
  const [tier, setTier] = useState<PoolTier | 0>(0);
  const [open, setOpen] = useState<string | null>(null);
  const active = ROUTING_STRATEGIES.find((s) => s.id === strategy);

  const ranked = useMemo(
    () => (strategy === 'priority' ? models : [...models].sort((a, b) => b.score - a.score)),
    [models, strategy],
  );
  const shown = ranked.filter(
    (m) =>
      (!query ||
        `${m.label} ${m.maker} ${m.routes.map((r) => r.providerId).join(' ')}`
          .toLowerCase()
          .includes(query.toLowerCase())) &&
      (!tools || m.tools) &&
      (!vision || m.vision) &&
      m.contextK >= minContext &&
      (!tier || m.routes.some((r) => r.tier === tier)),
  );

  const move = (id: string, by: -1 | 1): void =>
    setModels((list) => {
      const i = list.findIndex((m) => m.id === id);
      const j = i + by;
      if (i < 0 || j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j] as PoolModel, next[i] as PoolModel];
      return next;
    });

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Routing strategy" aside={active?.weights}>
        <Segmented
          label="Routing strategy"
          options={ROUTING_STRATEGIES}
          value={strategy}
          onChange={setStrategy}
        />
        <p className="text-sm text-ink-300">
          {strategy === 'priority'
            ? 'Requests try models from the top down; move a row with its arrows. A model that keeps getting rate limited drops back on its own and recovers.'
            : 'Models are ranked by live scores. The table shows the order requests are routed in right now.'}{' '}
          Smartest, Fastest, Most reliable and Custom arrive in Phase 4.
        </p>
      </Panel>

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-56 flex-1">
          <span className="sr-only">Search models or providers</span>
          <Search
            size={14}
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-500"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search models or providers…"
            className="min-h-9 w-full rounded-sm border border-line bg-surface-1 pr-3 pl-8 text-sm text-ink-100"
          />
        </label>
        <FilterChip active={tools} onClick={() => setTools((v) => !v)}>
          Tools
        </FilterChip>
        <FilterChip active={vision} onClick={() => setVision((v) => !v)}>
          Vision
        </FilterChip>
        {CONTEXT_STEPS.map((c) => (
          <FilterChip key={c.id} active={minContext === c.id} onClick={() => setMinContext(c.id)}>
            {c.label}
          </FilterChip>
        ))}
        {([0, 2, 3] as const).map((t) => (
          <FilterChip key={t} active={tier === t} onClick={() => setTier(t)}>
            {t === 0 ? 'All tiers' : `Tier ${t}`}
          </FilterChip>
        ))}
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[760px] text-sm">
          <caption className="sr-only">Free models in routing order</caption>
          <thead>
            <tr className="border-b border-line text-left text-xs text-ink-500">
              <th scope="col" className="w-10 py-3 pl-4 font-medium">
                #
              </th>
              <th scope="col" className="py-3 font-medium">
                Model
              </th>
              <th scope="col" className="py-3 font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="size-1.5 rounded-full bg-ok-400" /> Reliability
                </span>
              </th>
              <th scope="col" className="py-3 font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="size-1.5 rounded-full bg-accent-500" /> Speed
                </span>
              </th>
              <th scope="col" className="py-3 font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="size-1.5 rounded-full bg-neon-magenta" /> Smarts
                </span>
              </th>
              <th scope="col" className="py-3 text-right font-medium">
                Score
              </th>
              <th scope="col" className="py-3 pr-4 text-right font-medium">
                On
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((m, i) => (
              <Fragment key={m.id}>
                <tr
                  className={clsx(
                    'border-b border-line-subtle transition-colors hover:bg-hover',
                    !m.enabled && 'opacity-55',
                  )}
                >
                  <td className="py-3 pl-4 font-code text-xs text-ink-500 tabular-nums">
                    {strategy === 'priority' ? (
                      <span className="flex flex-col">
                        <IconButton
                          label={`Move ${m.label} up`}
                          className="size-5"
                          onClick={() => move(m.id, -1)}
                        >
                          <ChevronUp size={12} />
                        </IconButton>
                        <IconButton
                          label={`Move ${m.label} down`}
                          className="size-5"
                          onClick={() => move(m.id, 1)}
                        >
                          <ChevronDown size={12} />
                        </IconButton>
                      </span>
                    ) : (
                      i + 1
                    )}
                  </td>
                  <td className="py-3">
                    <button
                      type="button"
                      aria-expanded={open === m.id}
                      onClick={() => setOpen(open === m.id ? null : m.id)}
                      className="flex flex-wrap items-center gap-1.5 text-left"
                    >
                      {open === m.id ? (
                        <ChevronDown size={14} aria-hidden className="text-ink-500" />
                      ) : (
                        <ChevronRight size={14} aria-hidden className="text-ink-500" />
                      )}
                      <span className="font-medium text-ink-100">{m.label}</span>
                      <span className="tag bg-neutral-tint text-ink-300">
                        {m.routes.length} route{m.routes.length === 1 ? '' : 's'}
                      </span>
                      <span className="tag bg-neutral-tint text-ink-300">
                        {fmtTokens(m.monthlyTokens)}/mo
                      </span>
                      <span className="tag bg-neutral-tint text-ink-300">
                        {m.contextK >= 1000 ? `${m.contextK / 1000}M` : `${m.contextK}K`} ctx
                      </span>
                      {m.tools && (
                        <span className="tag bg-accent-tint text-accent-tag-ink">Tools</span>
                      )}
                      {m.vision && (
                        <span className="tag bg-lamp-tint text-lamp-tag-ink">Vision</span>
                      )}
                    </button>
                  </td>
                  <td className="py-3">
                    <Meter value={m.reliability} tone="ok" label="Reliability" />
                  </td>
                  <td className="py-3">
                    <Meter value={m.speed} tone="accent" label="Speed" />
                  </td>
                  <td className="py-3">
                    <Meter value={m.intelligence} tone="violet" label="Smarts" />
                  </td>
                  <td className="py-3 text-right font-code text-sm text-ink-100 tabular-nums">
                    {m.score ? m.score.toFixed(3) : 'new'}
                  </td>
                  <td className="py-3 pr-4 text-right">
                    <Toggle
                      label={`Use ${m.label}`}
                      checked={m.enabled}
                      onChange={(on) =>
                        setModels((list) =>
                          list.map((x) => (x.id === m.id ? { ...x, enabled: on } : x)),
                        )
                      }
                    />
                  </td>
                </tr>
                {open === m.id && <RouteRows snap={snap} model={m} />}
              </Fragment>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-sm text-ink-300">
                  No model matches these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <RoutingOptions />
    </div>
  );
}

/** Under a model: each provider that serves it, its tier, its limits and today's use. */
function RouteRows({ snap, model }: { snap: PoolSnapshot; model: PoolModel }): React.JSX.Element {
  return (
    <tr className="border-b border-line-subtle bg-surface-2">
      <td />
      <td colSpan={6} className="py-3 pr-4">
        <p className="mb-2 text-xs text-ink-500">
          Same model, different doors. The router tries tier-2 doors first; a tier-3 door is used
          only after you say yes, and never for private work.
        </p>
        <ul className="flex flex-col gap-1.5">
          {model.routes.map((r) => {
            const p = snap.providers.find((x) => x.id === r.providerId);
            return (
              <li key={r.providerId} className="flex flex-wrap items-center gap-3 text-sm">
                <ProviderDot id={r.providerId} />
                <span className="w-44 truncate text-ink-100">{p?.label ?? r.providerId}</span>
                <TierTag tier={r.tier} />
                <span className="font-code text-xs text-ink-300 tabular-nums">
                  {r.limits.rpm ? `${r.limits.rpm} / min` : 'no per-minute cap'} ·{' '}
                  {r.limits.rpd ? `${r.limits.rpd.toLocaleString()} / day` : 'no daily cap'}
                </span>
                <span className="ml-auto flex items-center gap-2 text-xs text-ink-500">
                  today
                  <span
                    className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-1"
                    aria-hidden
                  >
                    <span
                      className={clsx(
                        'block h-full rounded-full',
                        r.usedFraction > 0.85 ? 'bg-alarm-500' : 'bg-accent-500',
                      )}
                      style={{ width: `${Math.round(r.usedFraction * 100)}%` }}
                    />
                  </span>
                  <span className="w-9 text-right font-code tabular-nums">
                    {Math.round(r.usedFraction * 100)}%
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </td>
    </tr>
  );
}

function RoutingOptions(): React.JSX.Element {
  const [stripThinking, setStripThinking] = useState(true);
  const [retryEmpty, setRetryEmpty] = useState(true);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Answer clean-up">
        <div>
          <SettingRow
            title="Hide the model's thinking text"
            detail="Some free models write their reasoning inside <think> tags. Jarvis keeps only the answer."
          >
            <Toggle
              label="Hide thinking text"
              checked={stripThinking}
              onChange={setStripThinking}
            />
          </SettingRow>
          <SettingRow
            title="Retry empty answers on the next model"
            detail="A model that returns nothing (ran out of room while thinking) counts as a miss, not an answer."
          >
            <Toggle label="Retry empty answers" checked={retryEmpty} onChange={setRetryEmpty} />
          </SettingRow>
        </div>
      </Panel>
      <Panel title="Smarter routing" phase={4}>
        <div>
          <SettingRow
            title="Named chains"
            detail="Separate orders for separate jobs: a coding chain, a vision chain."
            phase={4}
          >
            <span className="flex flex-wrap justify-end gap-1">
              {['Default', 'Coding', 'Vision'].map((c) => (
                <span key={c} className="tag bg-neutral-tint text-ink-300">
                  {c}
                </span>
              ))}
              <IconButton label="New chain (Phase 4)" disabled className="size-6">
                <Plus size={12} />
              </IconButton>
            </span>
          </SettingRow>
          <SettingRow
            title="Treat the same model on several providers as one"
            detail="One row per model, its providers as doors (shown above already)."
            phase={4}
          >
            <Toggle label="Group same model" checked disabled />
          </SettingRow>
          <SettingRow
            title="Learn from real answers"
            detail="Scores improve from speed and success over the last week; newer results count more."
            phase={4}
          >
            <Toggle label="Learn from real answers" checked={false} disabled />
          </SettingRow>
          <SettingRow
            title="Shrink long prompts"
            detail="Drop repeated text and stale tool output before sending, to fit small free limits."
            phase={4}
          >
            <Toggle label="Shrink long prompts" checked={false} disabled />
          </SettingRow>
        </div>
        <p className="flex items-center gap-2 text-xs text-ink-500">
          <PhaseTag phase={4} /> These switches are drawn now and start working in Phase 4.
        </p>
      </Panel>
    </div>
  );
}
