import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import type { Res } from '@shared/ipc-contract';
import { Button } from '../../components/ui/button';
import { call, cleanError } from '../../lib/api';
import { useDraftSetting, useSettingsStore } from '../../stores/settings-store';
import { useUiStore } from '../../stores/ui-store';
import { SecretField } from './secret-field';
import { refreshList, useConnections } from './connections-card';
import { SettingInput } from './settings-controls';
import { CLOUD_PROVIDERS, cloudProvider, type CloudProviderId } from '@shared/llm-providers';

type Provider = 'api' | 'subscription' | 'local' | 'cloud';
type Status = Res<'llm:claudeCodeStatus'>;

const OPTIONS: Array<{ id: Provider; title: string; body: string }> = [
  {
    id: 'api',
    title: 'Anthropic API key',
    body: 'Pay per use from your Anthropic Console account. Everything works, including computer control.',
  },
  {
    id: 'subscription',
    title: 'My Claude subscription',
    body: 'Uses the Claude plan you are signed in to in Claude Code on this PC. Personal use only. Computer control is not available.',
  },
  {
    id: 'local',
    title: 'Local model (Ollama / LM Studio)',
    body: 'Any OpenAI-compatible server on this PC or your network. With Ollama or LM Studio it runs offline: free and private, but slower and less capable than Claude; no web search or computer control.',
  },
  {
    id: 'cloud',
    title: 'Another AI (ChatGPT, Gemini, DeepSeek, Grok…)',
    body: 'Your API key for OpenAI, Google Gemini, DeepSeek, xAI, Mistral, Groq, OpenRouter or Together. Paid per use on that account and counted in the budget; all tools work except computer control and Claude web search.',
  },
];

/** Polls `claude auth status` while Sir is signing in, so the card updates by itself. */
function useClaudeCodeStatus(): { status: Status | null; refresh(): Promise<void> } {
  const [status, setStatus] = useState<Status | null>(null);
  const refresh = useCallback(async () => setStatus(await call('llm:claudeCodeStatus', {})), []);
  useEffect(() => void refresh(), [refresh]);
  return { status, refresh };
}

export function ClaudeCodeCard(): React.JSX.Element {
  const { status, refresh } = useClaudeCodeStatus();
  const [waiting, setWaiting] = useState(false);
  const toast = useUiStore((s) => s.toast);

  useEffect(() => {
    if (!waiting || status?.loggedIn) return;
    const t = setInterval(() => void refresh(), 3000);
    const stop = setTimeout(() => setWaiting(false), 5 * 60_000);
    return () => (clearInterval(t), clearTimeout(stop));
  }, [waiting, status?.loggedIn, refresh]);

  if (!status)
    return (
      <div role="status" className="flex flex-col gap-2">
        <span className="sr-only">Checking Claude Code…</span>
        <span className="skeleton block h-4 w-56" aria-hidden />
        <span className="skeleton block h-4 w-40" aria-hidden />
      </div>
    );
  if (!status.found)
    return (
      <div role="status" className="rounded-md border border-lamp-400 p-3 text-sm text-ink-100">
        Claude Code isn&apos;t installed on this PC. Install it, sign in, then come back here.{' '}
        <button
          type="button"
          className="text-accent-300 underline"
          onClick={() =>
            void call('app:openExternal', { url: 'https://claude.com/product/claude-code' })
          }
        >
          Get Claude Code
        </button>
      </div>
    );
  return (
    <div
      role="status"
      className={clsx(
        'flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm',
        status.loggedIn ? 'border-ok-400' : 'border-lamp-400',
      )}
    >
      <span className="text-ink-100">
        {status.loggedIn
          ? `✓ Signed in to Claude Code${status.subscriptionType ? ` (${status.subscriptionType} plan)` : ''}.`
          : (status.error ?? 'Claude Code is installed but not signed in.')}
      </span>
      {!status.loggedIn && (
        <Button
          variant="primary"
          onClick={() =>
            void call('llm:claudeCodeLogin', {})
              .then(() => setWaiting(true))
              .catch((e: unknown) => toast({ level: 'error', message: cleanError(e) }))
          }
        >
          Sign in with Claude
        </Button>
      )}
      <Button variant="ghost" onClick={() => void refresh()}>
        Check again
      </Button>
      {waiting && !status.loggedIn && (
        <span className="text-ink-300">Finish signing in in the window that opened…</span>
      )}
    </div>
  );
}

/** ADR-013: pick the server and model; lists what the server has installed. */
export function LocalModelCard(): React.JSX.Element {
  const model = useDraftSetting('llm.local.model') ?? '';
  const set = useSettingsStore((s) => s.stage);
  const [models, setModels] = useState<string[]>([]);
  const [status, setStatus] = useState<{ ok: boolean; error?: string | undefined } | null>(null);
  const refresh = useCallback(async () => {
    const r = await call('llm:localModels', {});
    setModels(r.models);
    setStatus(r.error ? { ok: false, error: r.error } : null);
  }, []);
  useEffect(() => void refresh(), [refresh]);
  return (
    <div className="flex flex-col gap-3 rounded-md border border-line p-3">
      <SettingInput
        k="llm.local.baseUrl"
        label="Server address (OpenAI-compatible)"
        hint="Ollama: http://localhost:11434/v1 · LM Studio: http://localhost:1234/v1 · FreeLLMAPI: http://localhost:3001/v1. Only this PC or your home network."
      />
      <SecretField
        name="local_llm"
        label="Server key (only if the server asks for one)"
        placeholder="freellmapi-…"
      />
      <label className="flex flex-col gap-1 text-sm text-ink-100">
        Model
        <select
          value={model}
          onChange={(e) => void set('llm.local.model', e.target.value).then(() => setStatus(null))}
          className="min-h-8 max-w-md rounded-md border border-line bg-surface-2 px-2 text-ink-100"
        >
          <option value="">{models.length ? 'Choose a model…' : 'No models found'}</option>
          {[...new Set([...(model ? [model] : []), ...models])].map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" onClick={() => void refresh()}>
          Refresh models
        </Button>
        <Button onClick={() => void call('llm:localTest', {}).then(setStatus)}>Test</Button>
        {status && (
          <span
            role="status"
            className={clsx('text-sm', status.ok ? 'text-ok-400' : 'text-alarm-500')}
          >
            {status.ok ? '✓ Model ready.' : status.error}
          </span>
        )}
      </div>
      <p className="text-xs text-ink-500">
        No Ollama yet? Install it from ollama.com, then run e.g. <code>ollama pull qwen3:8b</code>.
        Models that support tool calling (Qwen 3, Llama 3.1+, Mistral) can use Jarvis's tools.
      </p>
      <p className="text-xs text-lamp-400">
        FreeLLMAPI (github.com/tashfeenahmed/freellmapi) runs on this PC but forwards every message
        to free cloud AI providers, which may keep or train on it. It is not offline or private;
        don&apos;t use it for anything sensitive.
      </p>
    </div>
  );
}

/** Integrations step 3: which of the provider's saved keys Jarvis's own brain uses. */
function MainConnectionPicker({
  provider,
}: {
  provider: CloudProviderId;
}): React.JSX.Element | null {
  const { list } = useConnections();
  const chosen = useDraftSetting('llm.cloud.connection') ?? '';
  const set = useSettingsStore((s) => s.stage);
  const extra = (list ?? []).filter((c) => c.provider === provider && !c.primary);
  if (!extra.length) return null;
  const current = extra.find((c) => c.id === chosen);
  return (
    <label className="flex flex-col gap-1 text-sm text-ink-100">
      Which key
      <select
        value={current ? current.id : ''}
        onChange={(e) => void set('llm.cloud.connection', e.target.value)}
        className="min-h-8 max-w-md rounded-md border border-line bg-surface-2 px-2 text-ink-100"
      >
        <option value="">Main key</option>
        {extra.map((c) => (
          <option key={c.id} value={c.id} disabled={!(c.keySet && c.model) && c.id !== chosen}>
            {c.label}
            {c.keySet && c.model ? ` (${c.model})` : ' (not set up)'}
          </option>
        ))}
      </select>
      {current && (
        <span className="text-xs text-ink-300">
          Its key and model are set under Connections and models below; the fields here are the main
          key&apos;s.
        </span>
      )}
    </label>
  );
}

/** Another provider's API: pick it, add its key, choose a model from its own list. */
export function CloudModelCard(): React.JSX.Element {
  const id = useDraftSetting('llm.cloud.provider') ?? 'openai';
  const chosen = useDraftSetting('llm.cloud.models') ?? {};
  const model = chosen[id] ?? '';
  const set = useSettingsStore((s) => s.stage);
  const saved = useSettingsStore((s) => s.values['llm.cloud.provider']);
  const p = cloudProvider(id);
  const [models, setModels] = useState<string[]>([]);
  const [status, setStatus] = useState<{ ok: boolean; error?: string | undefined } | null>(null);
  // Bumped on every provider change, so a slow list for the previous provider is dropped.
  const seq = useRef(0);
  const refresh = useCallback(async () => {
    const n = ++seq.current;
    const r = await call('llm:cloudModels', {});
    if (n !== seq.current) return;
    setModels(r.models);
    setStatus(r.error ? { ok: false, error: r.error } : null);
  }, []);
  // The list comes from the saved provider: refresh once a change of provider is saved.
  // Providers without a model list ('manual') would only answer "type the id": don't ask.
  useEffect(() => {
    if (saved && cloudProvider(saved as CloudProviderId).models !== 'manual') {
      void refresh();
      return;
    }
    seq.current++;
    setModels([]);
    setStatus(null);
  }, [refresh, saved]);
  const unsaved = saved !== id;
  return (
    <div className="flex flex-col gap-3 rounded-md border border-line p-3">
      <label className="flex flex-col gap-1 text-sm text-ink-100">
        Provider
        <select
          value={id}
          onChange={(e) => {
            void set('llm.cloud.provider', e.target.value as CloudProviderId);
            seq.current++;
            setModels([]);
            setStatus(null);
          }}
          className="min-h-8 max-w-md rounded-md border border-line bg-surface-2 px-2 text-ink-100"
        >
          {(
            [
              ['model-api', 'AI companies'],
              ['gateway', 'Gateways (one key, many models)'],
            ] as const
          ).map(([cat, title]) => (
            <optgroup key={cat} label={title}>
              {CLOUD_PROVIDERS.filter((c) => c.category === cat).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <MainConnectionPicker provider={id} />
      <SecretField
        key={p.secret}
        name={p.secret}
        label={`${p.label} API key`}
        placeholder={p.keyHint}
        onSaved={() => {
          void refreshList(); // Connections and models below shows whether a key is saved
          // The list is the saved provider's: only refresh when that is the one shown.
          if (!unsaved && p.models !== 'manual') void refresh();
        }}
      />
      <p className="text-xs text-ink-500">
        Get a key at{' '}
        <button
          type="button"
          className="text-accent-300 underline"
          onClick={() => void call('app:openExternal', { url: p.keysUrl })}
        >
          {new URL(p.keysUrl).host}
        </button>
        {' · '}
        <button
          type="button"
          className="text-accent-300 underline"
          onClick={() => void call('app:openExternal', { url: p.docsUrl })}
        >
          docs
        </button>
        . A ChatGPT or Gemini app subscription is separate from API access.
      </p>
      {p.note && <p className="text-xs text-ink-300">{p.note}</p>}
      <label className="flex flex-col gap-1 text-sm text-ink-100">
        Model
        <input
          list="cloud-models"
          value={model}
          placeholder={models.length ? 'Choose or type a model id…' : 'Type a model id'}
          onChange={(e) =>
            void set('llm.cloud.models', { ...chosen, [id]: e.target.value.trim() }).then(() =>
              setStatus(null),
            )
          }
          className="min-h-8 max-w-md rounded-md border border-line bg-surface-2 px-2 text-ink-100"
        />
        <datalist id="cloud-models">
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        {p.models !== 'manual' && (
          <Button variant="ghost" disabled={unsaved} onClick={() => void refresh()}>
            Refresh models
          </Button>
        )}
        <Button disabled={unsaved} onClick={() => void call('llm:cloudTest', {}).then(setStatus)}>
          Test
        </Button>
        {unsaved && (
          <span className="text-sm text-ink-300">Save to load this provider&apos;s models.</span>
        )}
        {!unsaved && p.models === 'manual' && (
          <span className="text-sm text-ink-300">Test sends one 1-token request.</span>
        )}
        {status && (
          <span
            role="status"
            className={clsx('text-sm', status.ok ? 'text-ok-400' : 'text-alarm-500')}
          >
            {status.ok ? '✓ Model ready.' : status.error}
          </span>
        )}
      </div>
    </div>
  );
}

/** ADR-010: one connection at a time, chosen here. */
export function ConnectionPicker(): React.JSX.Element {
  const provider = useDraftSetting('llm.provider') ?? 'api';
  const setSetting = useSettingsStore((s) => s.stage);
  return (
    <div className="flex flex-col gap-4">
      <div
        role="radiogroup"
        aria-label="How Jarvis connects to Claude"
        className="grid gap-2 sm:grid-cols-2"
      >
        {OPTIONS.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={provider === o.id}
            onClick={() => void setSetting('llm.provider', o.id)}
            className={clsx(
              'rounded-md border p-3 text-left transition-colors',
              provider === o.id
                ? 'border-accent-edge bg-selected'
                : 'border-line hover:border-ink-500',
            )}
          >
            <span className="block font-semibold text-ink-100">{o.title}</span>
            <span className="mt-1 block text-sm text-ink-300">{o.body}</span>
          </button>
        ))}
      </div>
      {provider === 'subscription' ? (
        <ClaudeCodeCard />
      ) : provider === 'local' ? (
        <LocalModelCard />
      ) : provider === 'cloud' ? (
        <CloudModelCard />
      ) : (
        <SecretField
          name="anthropic"
          label="Anthropic API key"
          placeholder="sk-ant-…"
          testable="anthropic"
        />
      )}
    </div>
  );
}

type CliStatus = Res<'llm:cliStatus'>[number];

/**
 * Sir's ChatGPT and Gemini plans, through each company's own app (Codex, Antigravity): no API key.
 * They only think and write (no tools), for NPCs and sub-agents. Jarvis's own connection stays above.
 */
export function SubscriptionApps(): React.JSX.Element {
  const [apps, setApps] = useState<CliStatus[] | null>(null);
  const [tests, setTests] = useState<Record<string, { ok: boolean; error?: string | undefined }>>(
    {},
  );
  const [testing, setTesting] = useState<string | null>(null);
  const toast = useUiStore((s) => s.toast);
  const refresh = useCallback(async () => setApps(await call('llm:cliStatus', {})), []);
  useEffect(() => void refresh(), [refresh]);
  if (!apps) return <span className="skeleton block h-16 w-full" aria-hidden />;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {apps.map((a) => (
        <div key={a.id} className="flex flex-col gap-2 rounded-md border border-line p-3">
          <span className="font-semibold text-ink-100">{a.label}</span>
          <span
            role="status"
            className={clsx(
              'text-sm',
              !a.installed
                ? 'text-lamp-400'
                : a.signedIn === false
                  ? 'text-lamp-400'
                  : 'text-ok-400',
            )}
          >
            {!a.installed
              ? `Not installed. ${a.installHint}`
              : a.signedIn === true
                ? '✓ Installed and signed in'
                : a.signedIn === false
                  ? 'Installed, not signed in'
                  : '✓ Installed (press Test to check the sign-in)'}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {a.installed && (
              <Button
                variant="ghost"
                onClick={() =>
                  void call('llm:cliLogin', { id: a.id })
                    .then(() =>
                      toast({
                        level: 'info',
                        message: 'Finish signing in in the window that opened.',
                      }),
                    )
                    .catch((e: unknown) => toast({ level: 'error', message: cleanError(e) }))
                }
              >
                Sign in
              </Button>
            )}
            {a.installed && (
              <Button
                disabled={testing === a.id}
                onClick={() => {
                  setTesting(a.id);
                  void call('llm:cliTest', { id: a.id })
                    .then((r) => setTests((t) => ({ ...t, [a.id]: r })))
                    .finally(() => {
                      setTesting(null);
                      void refresh();
                    });
                }}
              >
                {testing === a.id ? 'Testing…' : 'Test'}
              </Button>
            )}
            <Button variant="ghost" onClick={() => void refresh()}>
              Check again
            </Button>
          </div>
          {tests[a.id] && (
            <span
              role="status"
              className={clsx('text-sm', tests[a.id]?.ok ? 'text-ok-400' : 'text-alarm-500')}
            >
              {tests[a.id]?.ok ? '✓ It answered.' : tests[a.id]?.error}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
