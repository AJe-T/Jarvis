import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight, ChevronUp, Plus, Search } from 'lucide-react';
import clsx from 'clsx';
import {
  MAX_CHAINS,
  ROUTING_STRATEGIES,
  type PoolChain,
  type PoolModel,
  type PoolSnapshot,
  type PoolTier,
  type ScoreWeights,
} from '@shared/free-pool';
import type { Res } from '@shared/ipc-contract';
import { Button, IconButton } from '../../components/ui/button';
import { call, cleanError } from '../../lib/api';
import { useUiStore } from '../../stores/ui-store';
import type { PoolActions } from './router-view';
import {
  FilterChip,
  Meter,
  Panel,
  ProviderDot,
  Segmented,
  SettingRow,
  TierTag,
  Toggle,
  fmtTokens,
} from './parts';

/** Models: strategy, filters and the ranked model table with every route under each model. */
export function ModelsTab({
  snap,
  actions,
}: {
  snap: PoolSnapshot;
  actions: PoolActions;
}): React.JSX.Element {
  const { strategy, models } = snap;
  const [query, setQuery] = useState('');
  const [tools, setTools] = useState(false);
  const [vision, setVision] = useState(false);
  const [tier, setTier] = useState<PoolTier | 0>(0);
  const [open, setOpen] = useState<string | null>(null);
  const [minK, setMinK] = useState(0);
  const active = ROUTING_STRATEGIES.find((s) => s.id === strategy);

  // Main already sends the models in the order requests would go.
  const shown = models.filter(
    (m) =>
      (!query ||
        `${m.label} ${m.maker} ${m.routes.map((r) => r.providerId).join(' ')}`
          .toLowerCase()
          .includes(query.toLowerCase())) &&
      (!tools || m.tools) &&
      (!vision || m.vision) &&
      (!tier || m.routes.some((r) => r.tier === tier)) &&
      (!minK || m.contextK >= minK),
  );

  const move = (id: string, by: -1 | 1): void => actions.model({ model: id, move: by });

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Routing strategy" aside={active?.weights}>
        <Segmented
          label="Routing strategy"
          options={ROUTING_STRATEGIES}
          value={strategy}
          livePhase={4}
          onChange={(v) => actions.settings({ strategy: v })}
        />
        <p className="text-sm text-ink-300">
          {strategy === 'priority'
            ? 'Requests try models from the top down; move a row with its arrows. A model that keeps getting rate limited drops back on its own and recovers.'
            : 'Models are ranked by live scores: reliability (answers that worked), speed (words per second) and smarts (model size). The table shows the order requests are routed in right now.'}
        </p>
        {strategy === 'custom' && (
          <CustomWeights
            weights={snap.weights}
            onChange={(weights) => actions.settings({ weights })}
          />
        )}
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
        {([0, 2, 3] as const).map((t) => (
          <FilterChip key={t} active={tier === t} onClick={() => setTier(t)}>
            {t === 0 ? 'All tiers' : `Tier ${t}`}
          </FilterChip>
        ))}
        {CONTEXT_FILTERS.map((c) => (
          <FilterChip key={c.k} active={minK === c.k} onClick={() => setMinK(c.k)}>
            {c.label}
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
                      {m.maker && (
                        <span className="tag bg-neutral-tint text-ink-300">{m.maker}</span>
                      )}
                      {m.contextK > 0 && (
                        <span className="tag bg-neutral-tint text-ink-300" title="Context window">
                          {m.contextK >= 1000
                            ? `${Math.round(m.contextK / 100) / 10}M`
                            : `${m.contextK}K`}{' '}
                          context
                        </span>
                      )}
                      {m.usedTokens > 0 && (
                        <span className="tag bg-neutral-tint text-ink-300">
                          {fmtTokens(m.usedTokens)} this month
                        </span>
                      )}
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
                      onChange={(on) => actions.model({ model: m.id, enabled: on })}
                    />
                  </td>
                </tr>
                {open === m.id && <RouteRows snap={snap} model={m} />}
              </Fragment>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-sm text-ink-300">
                  {models.length === 0
                    ? 'No free models yet. Add a key on API keys, then press Check keys: every free chat model the key can use appears here (OpenRouter: models ending in :free).'
                    : 'No model matches these filters.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <RoutingOptions snap={snap} actions={actions} />
    </div>
  );
}

/** Under a model: each provider that serves it, its tier, its limits and today's use; a test. */
function RouteRows({ snap, model }: { snap: PoolSnapshot; model: PoolModel }): React.JSX.Element {
  const [testing, setTesting] = useState(false);
  const [results, setResults] = useState<Res<'pool:testModel'> | null>(null);
  const toast = useUiStore((s) => s.toast);
  const test = (): void => {
    setTesting(true);
    void call('pool:testModel', { model: model.id })
      .then(setResults)
      .catch((e: unknown) => toast({ level: 'error', message: cleanError(e) }))
      .finally(() => setTesting(false));
  };
  return (
    <tr className="border-b border-line-subtle bg-surface-2">
      <td />
      <td colSpan={6} className="py-3 pr-4">
        <p className="mb-2 text-xs text-ink-500">
          Same model, different doors. The router tries tier-2 doors first; a tier-3 door is used
          only after you say yes, and never for private work. Limits are the provider&apos;s free
          caps for your key (Groq&apos;s are read from its replies, per model).
        </p>
        <ul className="flex flex-col gap-1.5">
          {model.routes.map((r) => {
            const p = snap.providers.find((x) => x.id === r.providerId);
            return (
              <li key={r.connectionId} className="flex flex-wrap items-center gap-3 text-sm">
                <ProviderDot id={r.providerId} />
                <span className="w-44 truncate text-ink-100">{p?.label ?? r.providerId}</span>
                <TierTag tier={r.tier} />
                <span className="font-code text-xs text-ink-300 tabular-nums">
                  {limitsText(r.limits)}
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
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button onClick={test} disabled={testing}>
            {testing ? 'Testing…' : 'Test this model'}
          </Button>
          <span className="text-xs text-ink-500">
            Sends “Reply with OK” to each tier-2 door (a real, free request).
          </span>
          {results && (
            <ul className="flex w-full flex-col gap-1 text-xs" role="status">
              {results.length === 0 && <li className="text-ink-500">No tier-2 door to test.</li>}
              {results.map((r) => (
                <li key={r.provider} className={r.ok ? 'text-ok-400' : 'text-alarm-500'}>
                  {r.ok ? '✓' : '✗'} {r.name}:{' '}
                  {r.ok ? `answered in ${(r.ms / 1000).toFixed(1)} s` : (r.reason ?? 'failed')}
                </li>
              ))}
            </ul>
          )}
        </div>
      </td>
    </tr>
  );
}

/** "30 req/min · 1,000 req/day · 12K tokens/min" or, before the first answer, where they come from. */
function limitsText(l: PoolModel['routes'][number]['limits']): string {
  const parts = [
    l.rpm && `${l.rpm} req/min`,
    l.rpd && `${l.rpd.toLocaleString()} req/day`,
    l.tpm && `${fmtTokens(l.tpm)} tokens/min`,
    l.tpd && `${fmtTokens(l.tpd)} tokens/day`,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'limits not published: learned after its first answer';
}

const CONTEXT_FILTERS = [
  { k: 0, label: 'Any context' },
  { k: 32, label: '32K+' },
  { k: 128, label: '128K+' },
  { k: 1000, label: '1M+' },
] as const;

/** Custom strategy: how much reliability, speed and smarts count (shown as shares of 100). */
function CustomWeights({
  weights,
  onChange,
}: {
  weights: ScoreWeights;
  onChange: (w: ScoreWeights) => void;
}): React.JSX.Element {
  const [w, setW] = useState(weights);
  const keys = ['reliability', 'speed', 'smarts'] as const;
  const total = keys.reduce((n, k) => n + w[k], 0) || 1;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {keys.map((k) => (
        <label key={k} className="flex flex-col gap-1 text-sm text-ink-300">
          <span className="flex justify-between">
            <span className="capitalize">{k}</span>
            <span className="font-code text-ink-100 tabular-nums">
              {Math.round((w[k] / total) * 100)}%
            </span>
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(w[k] * 100)}
            aria-label={`${k} weight`}
            onChange={(e) => setW({ ...w, [k]: Number(e.target.value) / 100 })}
            onPointerUp={() => onChange(w)}
            onKeyUp={() => onChange(w)}
            className="accent-[var(--accent-500)]"
          />
        </label>
      ))}
    </div>
  );
}

function RoutingOptions({
  snap,
  actions,
}: {
  snap: PoolSnapshot;
  actions: PoolActions;
}): React.JSX.Element {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Answer clean-up">
        <div>
          <SettingRow
            title="Hide the model's thinking text"
            detail="Some free models write their reasoning inside <think> tags. Jarvis always keeps only the answer."
          >
            <Toggle label="Hide thinking text (always on)" checked disabled />
          </SettingRow>
          <SettingRow
            title="Retry empty answers on the next model"
            detail="A model that returns nothing (ran out of room while thinking) counts as a miss, not an answer."
          >
            <Toggle
              label="Retry empty answers"
              checked={snap.retryEmpty}
              onChange={(on) => actions.settings({ retryEmpty: on })}
            />
          </SettingRow>
        </div>
      </Panel>
      <Panel title="Smarter routing">
        <div>
          <SettingRow
            title="Learn from real answers"
            detail="Scores come from the last week of answers, newer days counting more (a day counts half as much every 2 days), so a model that got better moves up quickly."
          >
            <Toggle
              label="Learn from real answers"
              checked={snap.learn}
              onChange={(on) => actions.settings({ learn: on })}
            />
          </SettingRow>
          <SettingRow
            title="Shrink long prompts"
            detail="Before a free model gets a request, older tool output becomes a one-line note, repeated text is sent once and long old text is cut. The latest messages are never touched."
          >
            <Toggle
              label="Shrink long prompts"
              checked={snap.shrink}
              onChange={(on) => actions.settings({ shrink: on })}
            />
          </SettingRow>
          <SettingRow
            title="Skip models too small for the request"
            detail="When a model's context size is known, a request bigger than it goes to a bigger model instead of failing."
          >
            <Toggle label="Skip too-small models (always on)" checked disabled />
          </SettingRow>
        </div>
      </Panel>
      <ChainsPanel snap={snap} actions={actions} />
    </div>
  );
}

/**
 * Named chains: an order of models for one kind of job. Claude names one in delegate_task
 * ("chain": "Coding"); its models go first, in Sir's order, then every other model as usual.
 */
function ChainsPanel({
  snap,
  actions,
}: {
  snap: PoolSnapshot;
  actions: PoolActions;
}): React.JSX.Element {
  const [editing, setEditing] = useState<PoolChain | null>(null);
  const [name, setName] = useState('');
  const others = (n: string): PoolChain[] => snap.chains.filter((c) => c.name !== n);
  return (
    <Panel title="Named chains" className="lg:col-span-2">
      <p className="text-sm text-ink-300">
        Separate orders for separate jobs, like a coding chain or a vision chain. Claude names one
        when he hands a free task over; its models are tried first, in your order, then the rest.
      </p>
      <ul className="flex flex-col gap-2">
        {snap.chains.length === 0 && <li className="text-sm text-ink-500">No chains yet.</li>}
        {snap.chains.map((c) => (
          <li key={c.name} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium text-ink-100">{c.name}</span>
            <span className="font-code text-xs text-ink-500">
              {c.models.length ? c.models.join(' → ') : 'no models yet'}
            </span>
            <span className="ml-auto flex gap-2">
              <Button variant="ghost" onClick={() => setEditing(c)}>
                Edit
              </Button>
              <Button variant="ghost" onClick={() => actions.chains(others(c.name))}>
                Delete
              </Button>
            </span>
          </li>
        ))}
      </ul>
      {snap.chains.length < MAX_CHAINS && (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const n = name.trim();
            if (!n || snap.chains.some((c) => c.name.toLowerCase() === n.toLowerCase())) return;
            const chain = { name: n, models: [] };
            actions.chains([...snap.chains, chain]);
            setEditing(chain);
            setName('');
          }}
        >
          <input
            aria-label="New chain name"
            value={name}
            maxLength={30}
            onChange={(e) => setName(e.target.value)}
            placeholder="Coding"
            className="min-h-9 min-w-0 flex-1 rounded-sm border border-line bg-surface-1 px-3 text-sm text-ink-100"
          />
          <Button type="submit" disabled={!name.trim()}>
            <Plus size={14} aria-hidden /> New chain
          </Button>
        </form>
      )}
      {editing && (
        <ChainEditor
          key={editing.name}
          chain={editing}
          models={snap.models.map((m) => m.id)}
          onDone={(c) => {
            actions.chains([...others(editing.name), c]);
            setEditing(null);
          }}
          onCancel={() => setEditing(null)}
        />
      )}
    </Panel>
  );
}

function ChainEditor({
  chain,
  models,
  onDone,
  onCancel,
}: {
  chain: PoolChain;
  models: string[];
  onDone: (c: PoolChain) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [picked, setPicked] = useState(chain.models);
  const move = (i: number, by: -1 | 1): void => {
    const next = [...picked];
    const j = i + by;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j] as string, next[i] as string];
    setPicked(next);
  };
  return (
    <div className="flex flex-col gap-3 rounded-md border border-line bg-surface-2 p-3">
      <h3 className="text-sm font-semibold text-ink-100">Models in “{chain.name}”, in order</h3>
      <ol className="flex flex-col gap-1">
        {picked.map((m, i) => (
          <li key={m} className="flex items-center gap-2 text-sm text-ink-100">
            <span className="w-5 font-code text-xs text-ink-500">{i + 1}</span>
            <span className="flex-1 font-code text-xs">{m}</span>
            <IconButton label={`Move ${m} up`} className="size-6" onClick={() => move(i, -1)}>
              <ChevronUp size={12} />
            </IconButton>
            <IconButton label={`Move ${m} down`} className="size-6" onClick={() => move(i, 1)}>
              <ChevronDown size={12} />
            </IconButton>
            <Button variant="ghost" onClick={() => setPicked(picked.filter((x) => x !== m))}>
              Remove
            </Button>
          </li>
        ))}
      </ol>
      <label className="flex flex-col gap-1 text-sm text-ink-300">
        Add a model
        <select
          value=""
          onChange={(e) => e.target.value && setPicked([...picked, e.target.value])}
          className="min-h-9 rounded-sm border border-line bg-surface-1 px-2 text-sm text-ink-100"
        >
          <option value="">Choose…</option>
          {models
            .filter((m) => !picked.includes(m))
            .map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
        </select>
      </label>
      <div className="flex gap-2">
        <Button variant="primary" onClick={() => onDone({ name: chain.name, models: picked })}>
          Save chain
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
