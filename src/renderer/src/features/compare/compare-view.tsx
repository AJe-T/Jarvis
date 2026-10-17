import { useEffect, useState } from 'react';
import { create } from 'zustand';
import clsx from 'clsx';
import { Copy, History, Plus, Square, Trash2, X } from 'lucide-react';
import { MAX_RUN_STEPS, type RunMode, type RunStepView, type RunView } from '@shared/ai-runs';
import type { BrainRef } from '@shared/llm-providers';
import type { Req, Res } from '@shared/ipc-contract';
import { confirmAction } from '../../components/ui/confirm-modal';
import { Button, IconButton } from '../../components/ui/button';
import { PageBody, PageHeader } from '../../components/ui/page';
import { Markdown } from '../../components/jarvis/chat-message';
import { call, cleanError } from '../../lib/api';
import { registerBridge } from '../../lib/ipc-bridge';
import { useUiStore } from '../../stores/ui-store';

type Brain = Res<'runs:brains'>[number];

/** Runs by id, kept fresh by runs:update. */
const useRuns = create<{ runs: Record<string, RunView>; shown: string | null }>(() => ({
  runs: {},
  shown: null,
}));
const putRun = (run: RunView): void =>
  useRuns.setState((s) => ({ runs: { ...s.runs, [run.id]: run } }));
registerBridge((on) => [on('runs:update', (p) => putRun(p.run))]);

const MODES: Array<{ id: RunMode; title: string; body: string }> = [
  { id: 'compare', title: 'Compare', body: 'Every AI answers at the same time, side by side.' },
  {
    id: 'review',
    title: 'Review',
    body: 'One AI answers, a second one checks it and improves it.',
  },
  { id: 'chain', title: 'Chain', body: 'Each AI builds on the last, with its own job.' },
];

const STATUS_TONE: Record<string, string> = {
  queued: 'text-ink-500',
  running: 'text-accent-300',
  done: 'text-ok-400',
  partial: 'text-lamp-400',
  failed: 'text-alarm-500',
  cancelled: 'text-ink-500',
};

const seconds = (s: RunStepView): string => {
  if (!s.startedAt || (!s.finishedAt && s.status !== 'running')) return '';
  const end = s.finishedAt ? Date.parse(s.finishedAt) : Date.now();
  return `${((end - Date.parse(s.startedAt)) / 1000).toFixed(1)} s`;
};

function StepCard({ step }: { step: RunStepView }): React.JSX.Element {
  const role =
    step.role === 'review' ? 'Review' : step.role === 'stage' ? `Stage ${step.idx + 1}` : 'Answer';
  return (
    <article className="flex min-w-0 flex-col gap-2 rounded-md border border-line p-3">
      <header className="flex items-baseline justify-between gap-2">
        <span className="min-w-0">
          <span className="block truncate font-semibold text-ink-100">{step.label}</span>
          <span className="block text-xs text-ink-500">
            {role}
            {step.model ? ` · ${step.model}` : ''}
            {step.instruction ? ` · ${step.instruction}` : ''}
          </span>
        </span>
        <span role="status" className={clsx('shrink-0 text-xs', STATUS_TONE[step.status])}>
          {step.status}
        </span>
      </header>
      {step.error && <p className="text-sm text-alarm-500">{step.error}</p>}
      {step.output ? (
        <div className="max-h-[28rem] overflow-y-auto text-sm">
          <Markdown text={step.output} />
        </div>
      ) : (
        step.status === 'running' && <span className="skeleton block h-16 w-full" aria-hidden />
      )}
      <footer className="flex items-center justify-between gap-2 text-xs text-ink-500">
        <span>
          {[
            seconds(step),
            step.inputTokens || step.outputTokens
              ? `${step.inputTokens} in / ${step.outputTokens} out tokens`
              : '',
            step.costUsd ? `≈ $${step.costUsd.toFixed(4)} (estimate)` : '',
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
        {step.output && (
          <IconButton
            label="Copy this answer"
            onClick={() => void navigator.clipboard.writeText(step.output)}
          >
            <Copy size={14} />
          </IconButton>
        )}
      </footer>
    </article>
  );
}

function RunResult({ run }: { run: RunView }): React.JSX.Element {
  const total = run.steps.reduce((a, s) => a + s.costUsd, 0);
  return (
    <section aria-label="Result" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className={clsx('text-sm', STATUS_TONE[run.status])}>
          {run.mode} · {run.status}
        </span>
        {total > 0 && <span className="text-xs text-ink-500">≈ ${total.toFixed(4)} in all</span>}
        {run.status === 'running' && (
          <Button variant="danger" onClick={() => void call('runs:cancel', { id: run.id })}>
            <Square size={14} aria-hidden /> Stop
          </Button>
        )}
      </div>
      <p className="rounded-md bg-surface-2 p-3 text-sm whitespace-pre-wrap text-ink-300">
        {run.prompt}
      </p>
      <div className={clsx('grid gap-3', run.mode === 'compare' && 'md:grid-cols-2')}>
        {run.steps.map((s) => (
          <StepCard key={s.idx} step={s} />
        ))}
      </div>
    </section>
  );
}

interface Pick {
  brain: BrainRef;
  instruction: string;
}

function BrainSelect({
  brains,
  value,
  onChange,
  label,
}: {
  brains: Brain[];
  value: BrainRef;
  onChange(b: BrainRef): void;
  label: string;
}): React.JSX.Element {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value as BrainRef)}
      className="min-h-8 rounded-md border border-line bg-surface-2 px-2 text-sm text-ink-100"
    >
      {brains.map((b) => (
        <option key={b.id} value={b.id}>
          {b.label}
        </option>
      ))}
    </select>
  );
}

function Composer({ brains }: { brains: Brain[] }): React.JSX.Element {
  const toast = useUiStore((s) => s.toast);
  const [mode, setMode] = useState<RunMode>('compare');
  const [prompt, setPrompt] = useState('');
  const first = brains[0]?.id ?? 'jarvis';
  const second = brains[1]?.id ?? first;
  const [picks, setPicks] = useState<Pick[]>([
    { brain: first, instruction: '' },
    { brain: second, instruction: '' },
  ]);
  const [busy, setBusy] = useState(false);
  // An AI removed in Settings since this page opened falls back to the first one; jobs are chain-only.
  const steps = (mode === 'review' ? picks.slice(0, 2) : picks).map((p) => ({
    brain: brains.some((b) => b.id === p.brain) ? p.brain : first,
    instruction: mode === 'chain' ? p.instruction : '',
  }));
  const names = [
    ...new Set(steps.map((p) => brains.find((b) => b.id === p.brain)?.label ?? p.brain)),
  ];
  const set = (i: number, patch: Partial<Pick>): void =>
    setPicks((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  // What it may cost, refreshed as Sir edits (integrations step 5).
  const key = JSON.stringify({ mode, prompt: prompt.trim() || '?', steps });
  const [estimate, setEstimate] = useState<Res<'runs:estimate'> | null>(null);
  useEffect(() => {
    let current = true; // a slow answer for older text must not replace a newer one
    const t = setTimeout(
      () =>
        void call('runs:estimate', JSON.parse(key) as Req<'runs:estimate'>)
          .then((e) => current && setEstimate(e))
          .catch(() => current && setEstimate(null)),
      300,
    );
    return () => {
      current = false;
      clearTimeout(t);
    };
  }, [key]);

  async function send(): Promise<void> {
    setBusy(true);
    try {
      const cost = await call('runs:estimate', { mode, prompt, steps });
      if (
        cost.needsConfirm &&
        !(await confirmAction({
          title: `Spend up to $${cost.maxUsd.toFixed(2)}?`,
          body: `If every AI writes its longest answer, this run costs up to $${cost.maxUsd.toFixed(2)} (estimate${cost.steps.some((s) => s.price === 'fallback') ? '; some prices are unknown and taken from the dearest Claude model' : ''}). Change the level in Settings → Brain → Budget.`,
          actionLabel: 'Send',
          destructive: false,
        }))
      )
        return;
      const run = await call('runs:start', {
        request: { mode, prompt, steps },
        ...(cost.needsConfirm ? { acceptUsd: cost.maxUsd } : {}),
      });
      putRun(run);
      useRuns.setState({ shown: run.id });
    } catch (e) {
      toast({ level: 'error', message: cleanError(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="New run" className="flex flex-col gap-3 rounded-md border border-line p-3">
      <div role="radiogroup" aria-label="Mode" className="grid gap-2 sm:grid-cols-3">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={mode === m.id}
            onClick={() => setMode(m.id)}
            className={clsx(
              'rounded-md border p-2 text-left',
              mode === m.id ? 'border-accent-edge bg-selected' : 'border-line hover:border-ink-500',
            )}
          >
            <span className="block text-sm font-semibold text-ink-100">{m.title}</span>
            <span className="block text-xs text-ink-300">{m.body}</span>
          </button>
        ))}
      </div>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={4}
        maxLength={20_000}
        placeholder="What should they answer?"
        aria-label="Prompt"
        className="rounded-md border border-line bg-surface-2 p-2 text-sm text-ink-100"
      />
      <ol className="flex flex-col gap-2">
        {steps.map((p, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2">
            <span className="w-20 text-xs text-ink-500">
              {mode === 'review'
                ? i
                  ? 'Reviews'
                  : 'Answers'
                : mode === 'chain'
                  ? `Stage ${i + 1}`
                  : `AI ${i + 1}`}
            </span>
            <BrainSelect
              brains={brains}
              value={p.brain}
              label={`AI ${i + 1}`}
              onChange={(b) => set(i, { brain: b })}
            />
            {mode === 'chain' && i > 0 && (
              <input
                value={p.instruction}
                maxLength={2000}
                onChange={(e) => set(i, { instruction: e.target.value })}
                placeholder="Its job, e.g. “check the facts” or “make it shorter”"
                aria-label={`Stage ${i + 1} job`}
                className="min-h-8 min-w-0 flex-1 rounded-md border border-line bg-surface-2 px-2 text-sm text-ink-100"
              />
            )}
            {mode !== 'review' && steps.length > 2 && (
              <IconButton
                label="Remove"
                onClick={() => setPicks((ps) => ps.filter((_, j) => j !== i))}
              >
                <X size={14} />
              </IconButton>
            )}
          </li>
        ))}
      </ol>
      {mode !== 'review' && steps.length < MAX_RUN_STEPS && (
        <Button
          variant="ghost"
          className="self-start"
          onClick={() => setPicks((ps) => [...ps, { brain: first, instruction: '' }])}
        >
          <Plus size={14} aria-hidden /> Add an AI
        </Button>
      )}
      <p className="text-xs text-lamp-400">
        Your prompt goes to {names.join(', ')}. Each one sees it and bills its own account. Answers
        only: they have no tools.
      </p>
      {estimate && (
        <p className="text-xs text-ink-300" aria-live="polite">
          {estimate.maxUsd > 0
            ? `Up to $${estimate.maxUsd.toFixed(estimate.maxUsd < 0.01 ? 4 : 2)} if every AI writes its longest answer (estimate).`
            : 'No per-use cost: plans and this PC only.'}
          {estimate.steps.some((s) => s.price === 'fallback') &&
            ' Some prices are unknown, so they are counted like the dearest Claude model.'}
          {estimate.steps.some((s) => s.price === 'plan') &&
            ' Plan apps count against your plan instead.'}
        </p>
      )}
      <Button
        variant="primary"
        className="self-start"
        disabled={busy || !prompt.trim()}
        onClick={() => void send()}
      >
        Send to {steps.length} AIs
      </Button>
    </section>
  );
}

/** Integrations step 4: Sidebar → Compare AIs. */
export function CompareView(): React.JSX.Element {
  const [brains, setBrains] = useState<Brain[] | null>(null);
  const runs = useRuns((s) => s.runs);
  const shown = useRuns((s) => s.shown);
  const [history, setHistory] = useState(false);
  useEffect(() => {
    void call('runs:brains', {}).then(setBrains);
    // A live update may already be newer than this snapshot: keep it.
    void call('runs:list', {}).then((list) =>
      list.forEach((r) => {
        if (!useRuns.getState().runs[r.id]) putRun(r);
      }),
    );
  }, []);
  const current = shown ? runs[shown] : undefined;
  const past = Object.values(runs).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader title="Compare AIs" help="compare">
        <Button variant="ghost" onClick={() => setHistory((h) => !h)}>
          <History size={14} aria-hidden /> History ({past.length})
        </Button>
      </PageHeader>
      <PageBody className="flex max-w-6xl flex-col gap-4">
        {history && (
          <section
            aria-label="History"
            className="flex flex-col gap-1 rounded-md border border-line p-3"
          >
            {past.length === 0 && <p className="text-sm text-ink-300">No runs yet.</p>}
            {past.map((r) => (
              <div key={r.id} className="flex items-center gap-2 text-sm">
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left text-ink-100 hover:underline"
                  onClick={() => useRuns.setState({ shown: r.id })}
                >
                  {r.prompt.slice(0, 120)}
                </button>
                <span className="text-xs text-ink-500">
                  {r.mode} · {new Date(r.createdAt).toLocaleString()}
                </span>
                <span className={clsx('text-xs', STATUS_TONE[r.status])}>{r.status}</span>
                <IconButton
                  label="Delete this run"
                  onClick={() =>
                    void call('runs:remove', { id: r.id }).then(() =>
                      useRuns.setState((s) => {
                        const { [r.id]: _gone, ...rest } = s.runs;
                        return { runs: rest, shown: s.shown === r.id ? null : s.shown };
                      }),
                    )
                  }
                >
                  <Trash2 size={14} />
                </IconButton>
              </div>
            ))}
            {past.length > 0 && (
              <Button
                variant="ghost"
                className="self-start"
                onClick={() =>
                  void call('runs:clear', {}).then(() =>
                    useRuns.setState((s) => ({
                      runs: Object.fromEntries(
                        Object.entries(s.runs).filter(([, r]) => r.status === 'running'),
                      ),
                    })),
                  )
                }
              >
                Clear finished runs
              </Button>
            )}
          </section>
        )}
        {brains === null ? (
          <span className="skeleton block h-40 w-full" aria-hidden />
        ) : brains.length < 2 ? (
          <p className="text-sm text-ink-300">
            Set up a second AI first (Settings → Brain: another provider&apos;s key, a local model,
            or your ChatGPT / Gemini app).
          </p>
        ) : (
          <Composer brains={brains} />
        )}
        {current && <RunResult run={current} />}
      </PageBody>
    </div>
  );
}
