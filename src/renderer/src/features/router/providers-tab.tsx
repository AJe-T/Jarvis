import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileUp,
  Plus,
  RefreshCw,
  Search,
  Settings2,
} from 'lucide-react';
import clsx from 'clsx';
import type { KeyHealth, PoolProvider, PoolSnapshot, PoolTier } from '@shared/free-pool';
import { ENV_KEY_NAMES } from '@shared/free-pool';
import type { Res } from '@shared/ipc-contract';
import { MAX_CONNECTIONS_PER_PROVIDER, type CloudProviderId } from '@shared/llm-providers';
import { Button, IconButton } from '../../components/ui/button';
import { call, cleanError } from '../../lib/api';
import { useUiStore } from '../../stores/ui-store';
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
import type { PoolActions } from './router-view';

type Filter = 'all' | 'healthy' | 'issues' | 'off';

/** The worst state among a provider's keys decides its summary dot. */
function summary(p: PoolProvider): { health: KeyHealth; text: string } {
  if (p.keys.length === 0) return { health: 'unchecked', text: 'no key yet' };
  const count = (h: KeyHealth): number => p.keys.filter((k) => k.health === h).length;
  if (count('issue')) return { health: 'issue', text: `${count('issue')} issue` };
  if (count('cooling')) return { health: 'cooling', text: `${count('cooling')} cooling down` };
  if (count('unchecked')) return { health: 'unchecked', text: 'not checked yet' };
  return { health: 'healthy', text: `${p.keys.length} healthy` };
}

/** Providers & keys: every provider in its tier, its keys and their health (FreeLLMAPI Keys page). */
export function ProvidersTab({
  snap,
  actions,
}: {
  snap: PoolSnapshot;
  actions: PoolActions;
}): React.JSX.Element {
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [checking, setChecking] = useState(false);
  const go = useUiStore((s) => s.go);
  const keyCount = snap.providers.reduce((n, p) => n + p.keys.length, 0);
  const addKey = (): void => go('settings', 'brain');

  const shown = snap.providers.filter((p) => {
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
          {snap.providers.length} providers · {keyCount} keys
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          disabled={checking || keyCount === 0}
          onClick={() => {
            setChecking(true);
            void actions.checkKeys().finally(() => setChecking(false));
          }}
        >
          <RefreshCw size={14} aria-hidden className={checking ? 'animate-spin' : undefined} />{' '}
          {checking ? 'Checking…' : 'Check all keys'}
        </Button>
        <Button onClick={() => setImporting((v) => !v)} aria-expanded={importing}>
          <FileUp size={14} aria-hidden /> Import from .env
        </Button>
        <Button variant="primary" onClick={addKey}>
          <Plus size={14} aria-hidden /> Add key
        </Button>
      </div>

      {importing && (
        <ImportPanel
          onDone={() => {
            setImporting(false);
            actions.reload();
          }}
        />
      )}

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
                onChange={(patch) => actions.provider({ id: p.id as CloudProviderId, ...patch })}
                onAddKey={addKey}
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
              value={snap.keyOrder}
              onChange={(e) =>
                actions.settings({ keyOrder: e.target.value as 'roomiest' | 'turns' })
              }
              className="min-h-9 rounded-sm border border-line bg-surface-1 px-2 text-sm text-ink-100"
            >
              <option value="roomiest">Most room left</option>
              <option value="turns">Take turns</option>
            </select>
          </SettingRow>
          <SettingRow
            title="Check keys automatically"
            detail="A model-list call per key (no tokens used), so a dead or expired key is caught before Jarvis needs it."
          >
            <select
              aria-label="Check keys automatically"
              value={String(snap.checkHours)}
              onChange={(e) => actions.settings({ checkHours: Number(e.target.value) })}
              className="min-h-9 rounded-sm border border-line bg-surface-1 px-2 text-sm text-ink-100"
            >
              <option value="1">Every hour</option>
              <option value="6">Every 6 hours</option>
              <option value="24">Once a day</option>
              <option value="0">Only when I click</option>
            </select>
          </SettingRow>
          <SettingRow
            title="Keys per provider"
            detail="Add or remove keys and pick each key's model in Settings → Models & AI. Keys are encrypted on this PC; only their last four characters are ever shown."
          >
            <span className="font-code text-sm text-ink-100">
              up to {MAX_CONNECTIONS_PER_PROVIDER}
            </span>
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
  onAddKey,
}: {
  provider: PoolProvider;
  open: boolean;
  onToggleOpen: () => void;
  onChange: (patch: { enabled?: boolean; tier?: 2 | 3 }) => void;
  onAddKey: () => void;
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
          {p.keys.length ? (
            <HealthDot health={s.health} />
          ) : (
            <span className="text-xs text-ink-500">no key yet</span>
          )}
        </button>
        <label className="flex items-center gap-2 text-xs text-ink-500">
          Tier
          <select
            value={p.tier}
            onChange={(e) => onChange({ tier: Number(e.target.value) as 2 | 3 })}
            className="min-h-8 rounded-sm border border-line bg-surface-1 px-2 text-sm text-ink-100"
          >
            {([2, 3] as const satisfies readonly PoolTier[]).map((t) => (
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
            <p className="text-sm text-ink-300">
              No key for {p.label} yet. Add one in Settings → Models & AI, or import a .env file.
            </p>
          )}
          {p.keys.map((k) => (
            <div
              key={k.id}
              className="flex flex-wrap items-center gap-3 rounded-sm bg-surface-2 px-3 py-2 text-sm"
            >
              <span className="text-ink-100">{k.label}</span>
              <span className="font-code text-ink-300">•••• {k.hint}</span>
              <HealthDot health={k.health} />
              <span className="flex items-center gap-2 text-xs text-ink-500">
                {k.requestsToday} today
                {k.usedToday > 0 && (
                  <>
                    <span
                      className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-1"
                      aria-hidden
                    >
                      <span
                        className={clsx(
                          'block h-full rounded-full',
                          k.usedToday > 0.85 ? 'bg-alarm-500' : 'bg-accent-500',
                        )}
                        style={{ width: `${Math.round(k.usedToday * 100)}%` }}
                      />
                    </span>
                    {Math.round(k.usedToday * 100)}% of the known limit
                  </>
                )}
              </span>
              <span className="ml-auto text-xs text-ink-500">
                {k.lastChecked
                  ? `checked ${new Date(k.lastChecked).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                  : 'never checked'}
              </span>
            </div>
          ))}
          <p className="text-xs text-ink-500">{p.note}</p>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <button
              type="button"
              className="inline-flex items-center gap-1 text-accent-300 underline-offset-2 hover:underline"
              onClick={() => void call('app:openExternal', { url: p.docsUrl })}
            >
              Free-tier limits (official docs, checked {p.checked}){' '}
              <ExternalLink size={12} aria-hidden />
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-accent-300 underline-offset-2 hover:underline"
              onClick={onAddKey}
            >
              <Settings2 size={12} aria-hidden /> Keys and models in Settings
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ImportPanel({ onDone }: { onDone: () => void }): React.JSX.Element {
  const [text, setText] = useState('');
  const [found, setFound] = useState<Res<'pool:importEnv'>['found'] | null>(null);
  const [result, setResult] = useState<Res<'pool:importEnv'> | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useUiStore((s) => s.toast);

  const check = (apply: boolean): void => {
    setBusy(true);
    void call('pool:importEnv', { text, apply })
      .then((r) => {
        if (apply) {
          setResult(r);
          setText(''); // the keys leave the renderer as soon as they are saved
          setFound(null);
        } else setFound(r.found);
      })
      .catch((e: unknown) => toast({ level: 'error', message: cleanError(e) }))
      .finally(() => setBusy(false));
  };

  return (
    <Panel title="Import keys from a .env file">
      <p className="text-sm text-ink-300">
        Paste the lines from a <code>.env</code> file (for example the one FreeLLMAPI uses). Jarvis
        lists the keys it recognised, then saves them encrypted. A key you already saved is skipped.
        Nothing you paste is shown again or written to a log.
      </p>
      <textarea
        aria-label=".env lines"
        rows={4}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setFound(null);
        }}
        placeholder={'GROQ_API_KEY=gsk_…\nGEMINI_API_KEY=AIza…'}
        spellCheck={false}
        className="rounded-sm border border-line bg-surface-1 p-3 font-code text-sm text-ink-100"
      />
      <div className="flex flex-wrap gap-1.5">
        {Object.keys(ENV_KEY_NAMES).map((n) => (
          <span key={n} className="tag bg-neutral-tint text-ink-300">
            {n}
          </span>
        ))}
      </div>
      {found && (
        <p className="text-sm text-ink-100">
          {found.length
            ? `Found ${found.length}: ${found.map((f) => `${f.name} (${f.provider})`).join(', ')}.`
            : 'No known key names found.'}
        </p>
      )}
      {result && (
        <p className="text-sm text-ink-100">
          Saved {result.saved.length} key{result.saved.length === 1 ? '' : 's'}
          {result.skipped.length
            ? `; skipped ${result.skipped.map((s) => `${s.provider} (${s.reason})`).join(', ')}`
            : ''}
          . Pick a model for any new key in Settings → Models & AI.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy || !text.trim()} onClick={() => check(false)}>
          Find keys
        </Button>
        <Button variant="primary" disabled={busy || !found?.length} onClick={() => check(true)}>
          Save {found?.length ?? 0} key{found?.length === 1 ? '' : 's'}
        </Button>
        {result && <Button onClick={onDone}>Done</Button>}
      </div>
    </Panel>
  );
}
