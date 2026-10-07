import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import type { Res } from '@shared/ipc-contract';
import { Button } from '../../components/ui/button';
import { call, cleanError } from '../../lib/api';
import { useSetting, useSettingsStore } from '../../stores/settings-store';
import { useUiStore } from '../../stores/ui-store';
import { SecretField } from './secret-field';
import { SettingInput } from './settings-controls';

type Provider = 'api' | 'subscription' | 'local';
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
    body: 'Runs fully offline on this PC. Free, private, but slower and less capable than Claude; no web search or computer control.',
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
  const model = useSetting('llm.local.model') ?? '';
  const set = useSettingsStore((s) => s.set);
  const [models, setModels] = useState<string[]>([]);
  const [status, setStatus] = useState<{ ok: boolean; error?: string | undefined } | null>(null);
  const refresh = useCallback(async () => {
    const r = await call('llm:localModels', {});
    setModels(r.models);
    setStatus(r.error ? { ok: false, error: r.error } : null);
  }, []);
  useEffect(() => void refresh(), [refresh]);
  return (
    <div className="flex flex-col gap-3 rounded-md border border-glass-border p-3">
      <SettingInput
        k="llm.local.baseUrl"
        label="Server address (OpenAI-compatible)"
        hint="Ollama: http://localhost:11434/v1 · LM Studio: http://localhost:1234/v1. Only this PC or your home network."
      />
      <label className="flex flex-col gap-1 text-sm text-ink-100">
        Model
        <select
          value={model}
          onChange={(e) => void set('llm.local.model', e.target.value).then(() => setStatus(null))}
          className="min-h-8 max-w-md rounded-md border border-glass-border bg-glass-inset px-2 text-ink-100"
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
    </div>
  );
}

/** ADR-010: one connection at a time, chosen here. */
export function ConnectionPicker(): React.JSX.Element {
  const provider = useSetting('llm.provider') ?? 'api';
  const setSetting = useSettingsStore((s) => s.set);
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
                ? 'border-accent-edge bg-glass-selected'
                : 'border-glass-border hover:border-ink-500',
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
