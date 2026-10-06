import { useState } from 'react';
import { MCP_PRESETS, type McpPreset } from '@shared/mcp-presets';
import type { McpServerInput } from '@shared/ipc-contract';
import { Button } from '../../components/ui/button';
import { Field, TextInput } from '../../components/ui/field';
import { call, cleanError } from '../../lib/api';
import { useSettingsStore } from '../../stores/settings-store';
import { SecretField } from '../settings/secret-field';

function splitArgs(text: string): string[] {
  return (text.match(/"[^"]*"|\S+/g) ?? []).map((a) => a.replace(/^"|"$/g, ''));
}

/** App-flow.md §8: presets or a custom server; connecting immediately acts as the "Test". */
export function AddConnection({
  existing,
  onDone,
}: {
  existing: string[];
  onDone(): void;
}): React.JSX.Element {
  const [preset, setPreset] = useState<McpPreset | 'custom' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const secrets = useSettingsStore((s) => s.secrets);
  const [custom, setCustom] = useState({
    name: '',
    transport: 'stdio' as 'stdio' | 'http',
    command: 'npx',
    args: '',
    url: '',
    trust: 'community' as McpServerInput['trustLevel'],
  });

  async function add(server: McpServerInput): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await call('mcp:add', server);
      onDone();
    } catch (err) {
      setError(cleanError(err));
    } finally {
      setBusy(false);
    }
  }

  if (!preset) {
    return (
      <section
        className="rounded-md border border-reactor-500 bg-night-800 p-4"
        aria-label="Add connection"
      >
        <h2 className="mb-3 font-semibold">Add a connection</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {MCP_PRESETS.filter((p) => !existing.includes(p.server.name)).map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => setPreset(p)}
                className="h-full w-full rounded-md border border-night-600 p-3 text-left hover:border-reactor-500"
              >
                <span className="block font-semibold text-ink-100">{p.label}</span>
                <span className="block text-sm text-ink-300">{p.description}</span>
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={() => setPreset('custom')}
              className="h-full w-full rounded-md border border-dashed border-night-600 p-3 text-left hover:border-reactor-500"
            >
              <span className="block font-semibold text-ink-100">Custom server</span>
              <span className="block text-sm text-ink-300">
                Any MCP server (stdio command or HTTPS URL). Only add servers you trust.
              </span>
            </button>
          </li>
        </ul>
        <div className="mt-3 text-right">
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </section>
    );
  }

  if (preset !== 'custom') {
    const needs = preset.needsSecret;
    const ready = !needs || secrets[needs.name]?.set;
    return (
      <section
        className="flex flex-col gap-3 rounded-md border border-reactor-500 bg-night-800 p-4"
        aria-label={`Add ${preset.label}`}
      >
        <h2 className="font-semibold">{preset.label}</h2>
        <p className="text-sm text-ink-300">{preset.description}</p>
        {needs && (
          <>
            <SecretField name={needs.name} label={needs.label} />
            <p className="text-xs text-ink-500">{needs.help}</p>
          </>
        )}
        <p className="font-code text-xs break-all text-ink-500">
          {preset.server.transport === 'http'
            ? preset.server.url
            : `${preset.server.command} ${preset.server.args.join(' ')}`}
        </p>
        {error && (
          <p role="alert" className="text-sm text-alarm-500">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setPreset(null)}>
            Back
          </Button>
          <Button
            variant="primary"
            disabled={!ready || busy}
            onClick={() => void add(preset.server)}
          >
            {busy ? 'Connecting…' : 'Connect'}
          </Button>
        </div>
      </section>
    );
  }

  const nameOk = /^[a-z][a-z0-9_-]{1,30}$/.test(custom.name) && !existing.includes(custom.name);
  return (
    <section
      className="flex flex-col gap-3 rounded-md border border-reactor-500 bg-night-800 p-4"
      aria-label="Add custom connection"
    >
      <h2 className="font-semibold">Custom MCP server</h2>
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
            className="min-h-9 w-48 rounded-md border border-night-600 bg-night-900 px-2"
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
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setPreset(null)}>
          Back
        </Button>
        <Button
          variant="primary"
          disabled={!nameOk || busy}
          onClick={() =>
            void add({
              name: custom.name,
              transport: custom.transport,
              ...(custom.transport === 'stdio' ? { command: custom.command } : { url: custom.url }),
              args: custom.transport === 'stdio' ? splitArgs(custom.args) : [],
              envSecrets: {},
              trustLevel: custom.trust,
              defaultTier: 'CONFIRM',
              toolOverrides: {},
              enabled: true,
            })
          }
        >
          {busy ? 'Connecting…' : 'Connect'}
        </Button>
      </div>
    </section>
  );
}
