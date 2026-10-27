import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileUp,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import clsx from 'clsx';
import type { KeyHealth, PoolProvider, PoolSnapshot, PoolTier } from '@shared/free-pool';
import { Button, IconButton } from '../../components/ui/button';
import { call } from '../../lib/api';
import {
  FilterChip,
  HealthDot,
  Panel,
  ProviderDot,
  SettingRow,
  TIER_NAME,
  TierTag,
  Toggle,
} from './parts';

type Filter = 'all' | 'healthy' | 'issues' | 'off';

/** The worst state among a provider's keys decides its summary dot. */
function summary(p: PoolProvider): { health: KeyHealth; text: string } {
  if (p.keys.length === 0) return { health: 'unchecked', text: 'no key needed' };
  const count = (h: KeyHealth): number => p.keys.filter((k) => k.health === h).length;
  if (count('issue')) return { health: 'issue', text: `${count('issue')} issue` };
  if (count('cooling')) return { health: 'cooling', text: `${count('cooling')} cooling down` };
  if (count('unchecked')) return { health: 'unchecked', text: 'not checked yet' };
  return { health: 'healthy', text: `${p.keys.length} healthy` };
}

const ENV_NAMES = [
  'GEMINI_API_KEY',
  'GROQ_API_KEY',
  'CEREBRAS_API_KEY',
  'OPENROUTER_API_KEY',
  'CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID',
  'NVIDIA_API_KEY',
  'MISTRAL_API_KEY',
];

/** Providers & keys: every provider in its tier, its keys and their health (FreeLLMAPI Keys page). */
export function ProvidersTab({ snap }: { snap: PoolSnapshot }): React.JSX.Element {
  const [providers, setProviders] = useState<PoolProvider[]>(snap.providers);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const keyCount = providers.reduce((n, p) => n + p.keys.length, 0);

  const update = (id: string, patch: Partial<PoolProvider>): void =>
    setProviders((list) => list.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const shown = providers.filter((p) => {
    if (query && !p.label.toLowerCase().includes(query.toLowerCase())) return false;
    const h = summary(p).health;
    if (filter === 'healthy') return p.enabled && h === 'healthy';
    if (filter === 'issues') return h === 'issue' || h === 'cooling';
    if (filter === 'off') return !p.enabled;
    return true;
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-48 flex-1">
          <span className="sr-only">Filter providers</span>
          <Search
            size={14}
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-500"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter providers…"
            className="min-h-9 w-full rounded-sm border border-line bg-surface-1 pr-3 pl-8 text-sm text-ink-100"
          />
        </label>
        {(['all', 'healthy', 'issues', 'off'] as const).map((f) => (
          <FilterChip key={f} active={filter === f} onClick={() => setFilter(f)}>
            {{ all: 'All', healthy: 'Healthy', issues: 'Issues', off: 'Switched off' }[f]}
          </FilterChip>
        ))}
        <span className="ml-auto font-code text-xs text-ink-500">
          {providers.length} providers · {keyCount} keys
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button disabled title="Works from Phase 1">
          <RefreshCw size={14} aria-hidden /> Check all keys
        </Button>
        <Button onClick={() => setImporting((v) => !v)} aria-expanded={importing}>
          <FileUp size={14} aria-hidden /> Import from .env
        </Button>
        <Button variant="primary" disabled title="Works from Phase 1">
          <Plus size={14} aria-hidden /> Add key
        </Button>
      </div>

      {importing && <ImportPanel />}

      {([2, 3] as const).map((tier) => {
        const rows = shown.filter((p) => p.tier === tier);
        if (rows.length === 0) return null;
        return (
          <section key={tier} aria-label={`Tier ${tier} providers`} className="flex flex-col gap-1">
            <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink-100">
              <TierTag tier={tier} />
              <span className="font-normal text-ink-500">
                {tier === 2
                  ? 'used for non-private work'
                  : 'used only after you say yes, never for private work'}
              </span>
            </h2>
            {rows.map((p) => (
              <ProviderRow
                key={p.id}
                provider={p}
                open={open === p.id}
                onToggleOpen={() => setOpen(open === p.id ? null : p.id)}
                onChange={(patch) => update(p.id, patch)}
              />
            ))}
          </section>
        );
      })}

      <Panel title="Key settings">
        <div>
          <SettingRow
            title="Which key goes first"
            detail="With several keys for one provider: use the one with the most room left, so the nearly-full key rests."
          >
            <select
              aria-label="Which key goes first"
              defaultValue="roomiest"
              className="min-h-9 rounded-sm border border-line bg-surface-1 px-2 text-sm text-ink-100"
            >
              <option value="roomiest">Most room left</option>
              <option value="turns">Take turns</option>
            </select>
          </SettingRow>
          <SettingRow
            title="Check keys automatically"
            detail="A tiny test request per key, so a dead or expired key is caught before Jarvis needs it."
          >
            <select
              aria-label="Check keys automatically"
              defaultValue="6h"
              className="min-h-9 rounded-sm border border-line bg-surface-1 px-2 text-sm text-ink-100"
            >
              <option value="1h">Every hour</option>
              <option value="6h">Every 6 hours</option>
              <option value="24h">Once a day</option>
              <option value="off">Only when I click</option>
            </select>
          </SettingRow>
          <SettingRow
            title="Keys per provider"
            detail="Up to 10 keys each (one account per provider is what most free tiers allow). Keys are encrypted on this PC and never shown again after saving."
          >
            <span className="font-code text-sm text-ink-100">10</span>
          </SettingRow>
        </div>
      </Panel>
    </div>
  );
}

function ProviderRow({
  provider: p,
  open,
  onToggleOpen,
  onChange,
}: {
  provider: PoolProvider;
  open: boolean;
  onToggleOpen: () => void;
  onChange: (patch: Partial<PoolProvider>) => void;
}): React.JSX.Element {
  const s = summary(p);
  return (
    <div className={clsx('card p-0', !p.enabled && 'opacity-60')}>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <Toggle
          label={`Use ${p.label}`}
          checked={p.enabled}
          onChange={(on) => onChange({ enabled: on })}
        />
        <button
          type="button"
          onClick={onToggleOpen}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <ProviderDot id={p.id} />
          <span className="truncate font-medium text-ink-100">{p.label}</span>
          <span className="tag bg-neutral-tint text-ink-300">{p.keys.length}</span>
          <HealthDot health={s.health} />
          <span className="sr-only">{s.text}</span>
        </button>
        <label className="flex items-center gap-2 text-xs text-ink-500">
          Tier
          <select
            value={p.tier}
            onChange={(e) => onChange({ tier: Number(e.target.value) as PoolTier })}
            className="min-h-8 rounded-sm border border-line bg-surface-1 px-2 text-sm text-ink-100"
          >
            {([2, 3] as const).map((t) => (
              <option key={t} value={t}>
                {t} · {TIER_NAME[t]}
              </option>
            ))}
          </select>
        </label>
        <IconButton label={open ? 'Hide keys' : 'Show keys'} onClick={onToggleOpen}>
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </IconButton>
      </div>
      {open && (
        <div className="flex flex-col gap-2 border-t border-line-subtle px-4 py-3">
          {p.keys.length === 0 && (
            <p className="text-sm text-ink-300">This provider works without a key.</p>
          )}
          {p.keys.map((k) => (
            <div
              key={k.id}
              className="flex flex-wrap items-center gap-3 rounded-sm bg-surface-2 px-3 py-2 text-sm"
            >
              <span className="font-code text-ink-100">•••• {k.hint}</span>
              <HealthDot health={k.health} />
              <span className="flex items-center gap-2 text-xs text-ink-500">
                used today
                <span className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-1" aria-hidden>
                  <span
                    className={clsx(
                      'block h-full rounded-full',
                      k.usedToday > 0.85 ? 'bg-alarm-500' : 'bg-accent-500',
                    )}
                    style={{ width: `${Math.round(k.usedToday * 100)}%` }}
                  />
                </span>
                {Math.round(k.usedToday * 100)}%
              </span>
              <span className="ml-auto text-xs text-ink-500">
                {k.lastChecked ? `checked ${k.lastChecked}` : 'never checked'}
              </span>
              <IconButton label={`Remove key •••• ${k.hint} (Phase 1)`} disabled>
                <Trash2 size={14} />
              </IconButton>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-3 text-xs text-ink-500">
            <button
              type="button"
              className="inline-flex items-center gap-1 text-accent-300 underline-offset-2 hover:underline"
              onClick={() => void call('app:openExternal', { url: p.docsUrl })}
            >
              Free-tier limits (official docs) <ExternalLink size={12} aria-hidden />
            </button>
            <span>Another key for {p.label}: Phase 1.</span>
          </div>
        </div>
      )}
    </div>
  );
}

function ImportPanel(): React.JSX.Element {
  return (
    <Panel title="Import keys from a .env file">
      <p className="text-sm text-ink-300">
        Paste the lines from a <code>.env</code> file (for example the one FreeLLMAPI uses). Jarvis
        shows which keys it recognised, you tick the ones to keep, and they are saved encrypted.
        Nothing you paste is shown again or written to a log.
      </p>
      <textarea
        aria-label=".env lines"
        disabled
        rows={4}
        placeholder={'GROQ_API_KEY=gsk_…\nGEMINI_API_KEY=AIza…'}
        className="rounded-sm border border-line bg-surface-1 p-3 font-code text-sm text-ink-100 disabled:opacity-60"
      />
      <div className="flex flex-wrap gap-1.5">
        {ENV_NAMES.map((n) => (
          <span key={n} className="tag bg-neutral-tint text-ink-300">
            {n}
          </span>
        ))}
      </div>
      <p className="text-xs text-ink-500">
        The paste box opens in Phase 1, so no real key is typed into a preview.
      </p>
    </Panel>
  );
}
