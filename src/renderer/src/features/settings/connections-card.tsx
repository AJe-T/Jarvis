import { useCallback, useEffect, useState } from 'react';
import { create } from 'zustand';
import clsx from 'clsx';
import { ChevronDown, ChevronRight, Star, Trash2 } from 'lucide-react';
import {
  ACCOUNT_SLOT,
  CLOUD_PROVIDERS,
  MAX_CONNECTIONS_PER_PROVIDER,
  cloudProvider,
  type AiConnection,
  type CloudProviderId,
  type ConnectionModel,
} from '@shared/llm-providers';
import type { Req, Res } from '@shared/ipc-contract';
import { Button, IconButton } from '../../components/ui/button';
import { confirmAction } from '../../components/ui/confirm-modal';
import { call, cleanError } from '../../lib/api';
import { useUiStore } from '../../stores/ui-store';
import { SettingInput } from './settings-controls';
import { SecretField } from './secret-field';

const SOURCE: Record<ConnectionModel['source'], { label: string; hint: string; tone: string }> = {
  live: { label: 'live', hint: "In the provider's latest model list", tone: 'text-ok-400' },
  manual: { label: 'typed', hint: 'Added by hand', tone: 'text-accent-300' },
  cached: {
    label: 'cached',
    hint: 'Listed before but not in the latest list (may be retired)',
    tone: 'text-lamp-400',
  },
};

/** One list for every card on the page, so a change in one shows in the others. */
const useList = create<{ list: AiConnection[] | null; seq: number }>(() => ({
  list: null,
  seq: 0,
}));

export async function refreshList(): Promise<void> {
  const n = useList.getState().seq + 1;
  useList.setState({ seq: n });
  try {
    const list = await call('ai:connections', {});
    if (useList.getState().seq === n) useList.setState({ list }); // the latest answer wins
  } catch {
    // keeps the last list; the next action refreshes again
  }
}

/** Connections and their models, from main (keys never come back). */
export function useConnections(): {
  list: AiConnection[] | null;
  refresh(): Promise<void>;
  act(req: Req<'ai:connection'>): Promise<Res<'ai:connection'>>;
} {
  const list = useList((s) => s.list);
  const toast = useUiStore((s) => s.toast);
  const refresh = refreshList;
  useEffect(() => void refreshList(), []);
  const act = useCallback(
    async (req: Req<'ai:connection'>) => {
      try {
        return await call('ai:connection', req);
      } catch (e) {
        toast({ level: 'error', message: cleanError(e) });
        return { ok: false, error: cleanError(e) };
      } finally {
        await refreshList();
      }
    },
    [toast],
  );
  return { list, refresh, act };
}

function ModelRow({
  conn,
  m,
  act,
}: {
  conn: AiConnection;
  m: ConnectionModel;
  act: ReturnType<typeof useConnections>['act'];
}): React.JSX.Element {
  const s = SOURCE[m.source];
  return (
    <li className="flex items-center gap-2 py-1 text-sm">
      <IconButton
        label={m.favourite ? `Unstar ${m.model}` : `Star ${m.model}`}
        onClick={() =>
          void act({ action: 'flags', id: conn.id, model: m.model, favourite: !m.favourite })
        }
      >
        <Star size={14} className={m.favourite ? 'fill-current text-lamp-400' : 'text-ink-500'} />
      </IconButton>
      <label className="flex min-w-0 flex-1 items-center gap-2">
        <input
          type="checkbox"
          checked={m.enabled}
          onChange={(e) =>
            void act({ action: 'flags', id: conn.id, model: m.model, enabled: e.target.checked })
          }
        />
        <span
          className={clsx('truncate', m.enabled ? 'text-ink-100' : 'text-ink-500 line-through')}
        >
          {m.model}
        </span>
      </label>
      {m.price && (
        <span
          className="text-xs text-ink-500 tabular"
          title="USD per million tokens, input / output, as the provider lists it"
        >
          ${m.price.inPerMTok} / ${m.price.outPerMTok}
        </span>
      )}
      <span title={s.hint} className={clsx('text-xs', s.tone)}>
        {s.label}
      </span>
      {conn.model === m.model ? (
        <span className="text-xs text-ok-400">in use</span>
      ) : (
        <button
          type="button"
          className="text-xs text-accent-300 underline"
          disabled={!m.enabled}
          onClick={() => void act({ action: 'setModel', id: conn.id, model: m.model })}
        >
          Use
        </button>
      )}
      {m.source !== 'live' && (
        <IconButton
          label={`Remove ${m.model}`}
          onClick={() => void act({ action: 'removeModel', id: conn.id, model: m.model })}
        >
          <Trash2 size={14} />
        </IconButton>
      )}
    </li>
  );
}

/**
 * ADR-045: Cloudflare's address holds Sir's Account ID. Main accepts exactly 32 lowercase hex
 * characters (the setting's schema) and puts it into the fixed address itself.
 */
export function AccountIdField(): React.JSX.Element {
  return (
    <SettingInput
      k="llm.cloud.cloudflareAccount"
      label="Cloudflare Account ID"
      hint="32 letters and digits, from dash.cloudflare.com → Workers AI. Used for every Cloudflare key."
    />
  );
}

function ConnectionPanel({
  conn,
  act,
}: {
  conn: AiConnection;
  act: ReturnType<typeof useConnections>['act'];
}): React.JSX.Element {
  const p = cloudProvider(conn.provider);
  const [status, setStatus] = useState<{ ok: boolean; error?: string | undefined } | null>(null);
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState('');
  const [title, setTitle] = useState(conn.label);
  const run = async (req: Req<'ai:connection'>): Promise<void> => {
    setBusy(true);
    setStatus(await act(req));
    setBusy(false);
  };
  return (
    <div className="flex flex-col gap-3 border-t border-line p-3">
      <SecretField
        key={conn.secret}
        name={conn.secret}
        label={`${p.label} API key`}
        placeholder={p.keyHint}
        onSaved={() => void refreshList()}
      />
      {p.note && <p className="text-xs text-ink-300">{p.note}</p>}
      {p.baseUrl.includes(ACCOUNT_SLOT) && <AccountIdField />}
      <div className="flex flex-wrap items-center gap-2">
        {p.models !== 'manual' && (
          <Button
            variant="ghost"
            disabled={busy || !conn.keySet}
            onClick={() => void run({ action: 'refresh', id: conn.id })}
          >
            Refresh models
          </Button>
        )}
        <Button
          disabled={busy || !conn.keySet || !conn.model}
          onClick={() => void run({ action: 'test', id: conn.id })}
        >
          {busy ? 'Working…' : 'Test'}
        </Button>
        {status && (
          <span
            role="status"
            className={clsx('text-sm', status.ok ? 'text-ok-400' : 'text-alarm-500')}
          >
            {status.ok ? '✓ Done.' : status.error}
          </span>
        )}
      </div>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!typed.trim()) return;
          void act({ action: 'addModel', id: conn.id, model: typed.trim() }).then(() =>
            setTyped(''),
          );
        }}
      >
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="Add a model id by hand…"
          aria-label="Model id"
          className="min-h-8 w-72 rounded-md border border-line bg-surface-2 px-2 text-sm text-ink-100"
        />
        <Button type="submit" variant="ghost" disabled={!typed.trim()}>
          Add
        </Button>
      </form>
      {conn.models.length ? (
        <ul aria-label={`${conn.label} models`} className="max-h-72 overflow-y-auto">
          {conn.models.map((m) => (
            <ModelRow key={m.model} conn={conn} m={m} act={act} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-300">
          No models yet:{' '}
          {p.models === 'manual' ? 'add one by hand.' : 'refresh, or add one by hand.'}
        </p>
      )}
      {!conn.primary && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={title}
            maxLength={60}
            aria-label="Connection name"
            onChange={(e) => setTitle(e.target.value)}
            className="min-h-8 w-48 rounded-md border border-line bg-surface-2 px-2 text-sm text-ink-100"
          />
          <Button
            variant="ghost"
            disabled={!title.trim() || title.trim() === conn.label}
            onClick={() => void act({ action: 'rename', id: conn.id, label: title.trim() })}
          >
            Rename
          </Button>
          <Button
            variant="danger"
            onClick={() =>
              void confirmAction({
                title: `Remove ${conn.label}?`,
                body: 'Its key is deleted from this PC and its model list is forgotten. Sub-agents and NPCs using it stop working.',
                actionLabel: 'Remove',
                destructive: true,
              }).then((ok) => {
                if (ok) void act({ action: 'remove', id: conn.id });
              })
            }
          >
            Remove connection
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Integrations step 3: every key Sir saved, several per provider if he wants (work and personal),
 * each with its model list: refresh it from the provider, star favourites, hide models, pick the one
 * in use. Only providers with a key or an extra connection are listed; add one below.
 */
export function ConnectionsCard(): React.JSX.Element {
  const { list, act } = useConnections();
  const [open, setOpen] = useState<string | null>(null);
  const [provider, setProvider] = useState<CloudProviderId>('openai');
  const [label, setLabel] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useUiStore((st) => st.toast);
  if (!list) return <span className="skeleton block h-16 w-full" aria-hidden />;
  const shown = list.filter((c) => c.keySet || !c.primary || c.id === open);
  const count = list.filter((c) => c.provider === provider).length;
  return (
    <div className="flex flex-col gap-3">
      {shown.length === 0 && (
        <p className="text-sm text-ink-300">No AI provider keys yet. Add one below.</p>
      )}
      <ul className="flex flex-col gap-2">
        {shown.map((c) => (
          <li key={c.id} className="rounded-md border border-line">
            <button
              type="button"
              aria-expanded={open === c.id}
              onClick={() => setOpen(open === c.id ? null : c.id)}
              className="flex w-full items-center gap-2 p-3 text-left"
            >
              {open === c.id ? (
                <ChevronDown size={16} aria-hidden />
              ) : (
                <ChevronRight size={16} aria-hidden />
              )}
              <span className="flex-1">
                <span className="block font-semibold text-ink-100">
                  {c.primary ? cloudProvider(c.provider).label : c.label}
                </span>
                <span className="block text-xs text-ink-300">
                  {c.primary ? 'Main key' : cloudProvider(c.provider).label} ·{' '}
                  {c.keySet ? 'key saved' : 'no key'} · {c.model || 'no model chosen'} ·{' '}
                  {c.models.length} models
                </span>
              </span>
            </button>
            {open === c.id && <ConnectionPanel conn={c} act={act} />}
          </li>
        ))}
      </ul>
      <form
        className="flex flex-col gap-3 rounded-md border border-dashed border-line p-3"
        aria-label="Add an API key"
        onSubmit={(e) => {
          e.preventDefault();
          if (!key.trim()) return;
          setBusy(true);
          // The provider's own slot first (unless Sir named the key); otherwise an extra connection.
          const main = list.find((c) => c.provider === provider && c.primary);
          const target =
            main && !main.keySet && !label.trim()
              ? Promise.resolve({ ok: true, id: main.id })
              : act({ action: 'add', provider, label });
          void target
            .then(async (r) => {
              const id = r.ok ? r.id : undefined;
              const conn = useList.getState().list?.find((c) => c.id === id);
              if (!id || !conn) return;
              await call('secrets:set', { name: conn.secret, value: key.trim() });
              // Fetch its model list now, so its models show up straight away.
              const listed = await act({ action: 'refresh', id });
              setKey('');
              setLabel('');
              setOpen(id);
              toast({
                level: listed.ok ? 'info' : 'warn',
                message: listed.ok
                  ? `${cloudProvider(provider).label}: key saved and its models loaded.`
                  : `Key saved, but its model list didn't load: ${listed.error ?? 'try Refresh'}.`,
              });
            })
            .catch((err: unknown) => toast({ level: 'error', message: cleanError(err) }))
            .finally(() => setBusy(false));
        }}
      >
        <span className="text-sm font-semibold text-ink-100">Add an API key</span>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-sm text-ink-100">
            Provider
            <select
              aria-label="Provider"
              value={provider}
              onChange={(e) => setProvider(e.target.value as CloudProviderId)}
              className="min-h-9 rounded-md border border-line bg-surface-2 px-2 text-ink-100"
            >
              {CLOUD_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-64 flex-1 flex-col gap-1 text-sm text-ink-100">
            API key
            <input
              type="password"
              aria-label="API key"
              autoComplete="off"
              spellCheck={false}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="Paste the key here"
              className="min-h-9 rounded-md border border-line bg-surface-2 px-2 font-code text-ink-100"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink-100">
            Name (optional, not the key)
            <input
              aria-label="Name (optional, not the key)"
              value={label}
              maxLength={60}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Work account"
              className="min-h-9 w-48 rounded-md border border-line bg-surface-2 px-2 text-ink-100"
            />
          </label>
          <Button
            type="submit"
            variant="primary"
            disabled={busy || !key.trim() || count >= MAX_CONNECTIONS_PER_PROVIDER}
          >
            {busy ? 'Saving…' : 'Save and load models'}
          </Button>
        </div>
        {count >= MAX_CONNECTIONS_PER_PROVIDER && (
          <span className="text-sm text-ink-300">
            At most {MAX_CONNECTIONS_PER_PROVIDER} keys per provider.
          </span>
        )}
        <button
          type="button"
          className="self-start text-xs text-accent-300 underline-offset-2 hover:underline"
          onClick={() => void call('app:openExternal', { url: cloudProvider(provider).keysUrl })}
        >
          Where do I get a {cloudProvider(provider).label} key?
        </button>
      </form>
      <p className="text-xs text-ink-500">
        Extra keys show up as their own AI for sub-agents and NPCs. Each one is billed on its own
        account.
      </p>
    </div>
  );
}
