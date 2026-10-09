import { useState } from 'react';
import { Search } from 'lucide-react';
import clsx from 'clsx';
import {
  MCP_PRESETS,
  PRESET_CATEGORIES,
  type McpPreset,
  type PresetCategory,
} from '@shared/mcp-presets';
import type { McpServerInput } from '@shared/ipc-contract';
import { Button } from '../../components/ui/button';
import { Field, TextInput } from '../../components/ui/field';
import { call, cleanError } from '../../lib/api';
import { useSettingsStore } from '../../stores/settings-store';
import { SecretField } from '../settings/secret-field';
import { NAME_RE, type Candidate } from './candidate';
import { RegistryBrowser } from './registry-browser';

type Mode = 'catalogue' | 'registry' | 'custom';
const MODES: Array<{ id: Mode; label: string }> = [
  { id: 'catalogue', label: 'Catalogue' },
  { id: 'registry', label: 'MCP Registry' },
  { id: 'custom', label: 'Custom' },
];

function splitArgs(text: string): string[] {
  return (text.match(/"[^"]*"|\S+/g) ?? []).map((a) => a.replace(/^"|"$/g, ''));
}

const fromPreset = (p: McpPreset): Candidate => ({
  label: p.label,
  description: p.description,
  secrets: p.secrets ?? [],
  server: p.server,
});

/** Vetted presets, filterable by category and text. */
function Catalogue({
  existing,
  onPick,
}: {
  existing: string[];
  onPick(c: Candidate): void;
}): React.JSX.Element {
  const [category, setCategory] = useState<PresetCategory | 'all'>('all');
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = MCP_PRESETS.filter(
    (p) =>
      !existing.includes(p.server.name) &&
      (category === 'all' || p.category === category) &&
      (!q || `${p.label} ${p.description}`.toLowerCase().includes(q)),
  );
  const chip = (id: PresetCategory | 'all', label: string): React.JSX.Element => (
    <button
      key={id}
      type="button"
      aria-pressed={category === id}
      onClick={() => setCategory(id)}
      className={clsx(
        'h-7 rounded-xs border px-2.5 font-code text-xs',
        category === id
          ? 'border-accent-edge bg-accent-tint text-accent-tag-ink'
          : 'border-line text-ink-300 hover:border-line-strong hover:text-ink-100',
      )}
    >
      {label}
    </button>
  );
  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search
          size={14}
          aria-hidden
          className="absolute top-1/2 left-3 -translate-y-1/2 text-icon-rest"
        />
        <TextInput
          aria-label="Filter connections"
          placeholder="Filter: search, notes, code, home…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full pl-8"
        />
      </div>
      <div className="flex flex-wrap gap-1.5" aria-label="Categories">
        {chip('all', 'All')}
        {PRESET_CATEGORIES.map((c) => chip(c.id, c.label))}
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {shown.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onPick(fromPreset(p))}
              className="flex h-full w-full flex-col gap-1 rounded-md border border-line bg-surface-1 p-3 text-left transition-colors hover:border-accent-edge hover:bg-hover"
            >
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="font-semibold text-ink-100">{p.label}</span>
                {p.server.transport === 'http' && (
                  <span className="tag bg-accent-tint text-accent-tag-ink">hosted</span>
                )}
                <span
                  className={clsx(
                    'tag',
                    p.secrets?.length ? 'bg-lamp-tint text-lamp-tag-ink' : 'bg-ok-tint text-ok-400',
                  )}
                >
                  {p.secrets?.length ? 'needs key' : 'no key'}
                </span>
              </span>
              <span className="text-sm text-ink-300">{p.description}</span>
            </button>
          </li>
        ))}
        {shown.length === 0 && (
          <li className="py-4 text-sm text-ink-500 sm:col-span-2">
            Nothing here. Try the MCP Registry tab for thousands more.
          </li>
        )}
      </ul>
    </div>
  );
}

/** App-flow.md §8: keys first, then Connect (connecting immediately acts as the "Test"). */
function ConnectForm({
  candidate,
  existing,
  onBack,
  onDone,
}: {
  candidate: Candidate;
  existing: string[];
  onBack(): void;
  onDone(): void;
}): React.JSX.Element {
  const secrets = useSettingsStore((s) => s.secrets);
  const [name, setName] = useState(candidate.server.name);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const missing = candidate.secrets.filter((n) => !secrets[n.name]?.set);
  const nameOk = NAME_RE.test(name) && !existing.includes(name);
  const s = candidate.server;

  async function connect(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await call('mcp:add', { ...s, name });
      onDone();
    } catch (err) {
      setError(cleanError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="flex flex-col gap-3 card border-accent-edge p-4"
      aria-label={`Add ${candidate.label}`}
    >
      <h2 className="font-semibold">{candidate.label}</h2>
      {candidate.description && <p className="text-sm text-ink-300">{candidate.description}</p>}
      {candidate.renamable && (
        <Field label="Name (lowercase, used in tool names)">
          {(id) => (
            <TextInput
              id={id}
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase())}
            />
          )}
        </Field>
      )}
      {candidate.secrets.map((n) => (
        <div key={n.name}>
          <SecretField name={n.name} label={n.label} />
          {n.help && <p className="mt-1 text-xs text-ink-500">{n.help}</p>}
        </div>
      ))}
      <p className="font-code text-xs break-all text-ink-500">
        {s.transport === 'http' ? s.url : `${s.command ?? ''} ${s.args.join(' ')}`}
      </p>
      {candidate.renamable && s.transport === 'stdio' && (
        <p
          role="note"
          className="rounded-sm border border-lamp-400 bg-lamp-tint px-3 py-2 text-sm text-lamp-tag-ink"
        >
          This downloads a community package from npm and runs it on this PC with your Windows
          rights. Check the source first; Jarvis still asks before every tool it offers.
        </p>
      )}
      {candidate.source && (
        <button
          type="button"
          className="self-start font-code text-xs text-accent-300 underline underline-offset-2"
          onClick={() => void call('app:openExternal', { url: candidate.source ?? '' })}
        >
          View source code
        </button>
      )}
      {error && (
        <p role="alert" className="font-code text-sm break-all text-alarm-500">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button
          variant="primary"
          disabled={missing.length > 0 || !nameOk || busy}
          onClick={() => void connect()}
        >
          {busy ? 'Connecting…' : 'Connect'}
        </Button>
      </div>
    </section>
  );
}

/** Any MCP server by hand: a stdio command or an HTTPS URL. */
function CustomForm({
  existing,
  onDone,
}: {
  existing: string[];
  onDone(): void;
}): React.JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [custom, setCustom] = useState({
    name: '',
    transport: 'stdio' as 'stdio' | 'http',
    command: 'npx',
    args: '',
    url: '',
    trust: 'community' as McpServerInput['trustLevel'],
  });
  const nameOk = NAME_RE.test(custom.name) && !existing.includes(custom.name);

  async function add(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await call('mcp:add', {
        name: custom.name,
        transport: custom.transport,
        ...(custom.transport === 'stdio' ? { command: custom.command } : { url: custom.url }),
        args: custom.transport === 'stdio' ? splitArgs(custom.args) : [],
        envSecrets: {},
        trustLevel: custom.trust,
        defaultTier: 'CONFIRM',
        toolOverrides: {},
        enabled: true,
      });
      onDone();
    } catch (err) {
      setError(cleanError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3" aria-label="Add custom connection">
      <p className="text-sm text-ink-300">
        Any MCP server (stdio command or HTTPS URL). Only add servers you trust.
      </p>
      <Field label="Name (lowercase, used in tool names)">
        {(id) => (
          <TextInput
            id={id}
            value={custom.name}
            onChange={(e) => setCustom({ ...custom, name: e.target.value.toLowerCase() })}
          />
        )}
      </Field>
      <fieldset className="flex gap-4 text-sm">
        <legend className="sr-only">Transport</legend>
        {(['stdio', 'http'] as const).map((t) => (
          <label key={t} className="flex items-center gap-1.5">
            <input
              type="radio"
              checked={custom.transport === t}
              onChange={() => setCustom({ ...custom, transport: t })}
            />{' '}
            {t === 'stdio' ? 'Command (stdio)' : 'URL (HTTPS)'}
          </label>
        ))}
      </fieldset>
      {custom.transport === 'stdio' ? (
        <>
          <Field label="Command">
            {(id) => (
              <TextInput
                id={id}
                value={custom.command}
                onChange={(e) => setCustom({ ...custom, command: e.target.value })}
                className="font-code"
              />
            )}
          </Field>
          <Field label="Arguments" hint="Pin versions, e.g. -y @scope/server@1.2.3">
            {(id) => (
              <TextInput
                id={id}
                value={custom.args}
                onChange={(e) => setCustom({ ...custom, args: e.target.value })}
                className="font-code"
              />
            )}
          </Field>
        </>
      ) : (
        <Field label="URL">
          {(id) => (
            <TextInput
              id={id}
              value={custom.url}
              onChange={(e) => setCustom({ ...custom, url: e.target.value })}
              className="font-code"
            />
          )}
        </Field>
      )}
      <Field label="Trust level">
        {(id) => (
          <select
            id={id}
            value={custom.trust}
            onChange={(e) =>
              setCustom({ ...custom, trust: e.target.value as McpServerInput['trustLevel'] })
            }
            className="min-h-9 w-48 rounded-md border border-line bg-surface-2 px-2"
          >
            <option value="official">Official vendor</option>
            <option value="community">Community</option>
            <option value="experimental">Experimental</option>
          </select>
        )}
      </Field>
      {error && (
        <p role="alert" className="font-code text-sm break-all text-alarm-500">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <Button variant="primary" disabled={!nameOk || busy} onClick={() => void add()}>
          {busy ? 'Connecting…' : 'Connect'}
        </Button>
      </div>
    </div>
  );
}

/** App-flow.md §8: a vetted catalogue, the public MCP Registry, or a custom server. */
export function AddConnection({
  existing,
  onDone,
}: {
  existing: string[];
  onDone(): void;
}): React.JSX.Element {
  const [mode, setMode] = useState<Mode>('catalogue');
  const [picked, setPicked] = useState<Candidate | null>(null);

  if (picked)
    return (
      <ConnectForm
        candidate={picked}
        existing={existing}
        onBack={() => setPicked(null)}
        onDone={onDone}
      />
    );

  return (
    <section className="card border-accent-edge p-4" aria-label="Add connection">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="font-semibold">Add a connection</h2>
        <div role="tablist" aria-label="Source" className="ml-auto flex gap-1">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={mode === m.id}
              onClick={() => setMode(m.id)}
              className={clsx(
                'h-8 rounded-sm px-3 font-code text-xs',
                mode === m.id
                  ? 'bg-selected text-ink-100 shadow-[inset_0_-2px_0_var(--accent-500)]'
                  : 'text-ink-500 hover:bg-hover hover:text-ink-100',
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      {mode === 'catalogue' && <Catalogue existing={existing} onPick={setPicked} />}
      {mode === 'registry' && <RegistryBrowser existing={existing} onPick={setPicked} />}
      {mode === 'custom' && <CustomForm existing={existing} onDone={onDone} />}
      <div className="mt-3 text-right">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </section>
  );
}
