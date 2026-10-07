import { useState } from 'react';
import { Ban, Check, ChevronDown, ChevronRight, Circle, Loader2, Wrench, X } from 'lucide-react';
import clsx from 'clsx';
import type { UiToolCall } from '@shared/types';

const TIER_CLASS = {
  SAFE: 'border-glass-border-strong text-ink-300',
  CONFIRM: 'border-lamp-400 text-lamp-400',
  BLOCKED: 'border-alarm-500 text-alarm-500',
} as const;

function StatusIndicator({ call }: { call: UiToolCall }): React.JSX.Element {
  // A live status (waiting/running) wins over the provisional decision stored while Sir decides.
  const settled =
    call.status !== 'awaiting' && call.status !== 'pending' && call.status !== 'running';
  if (settled && (call.decision === 'denied' || call.decision === 'cancelled'))
    return (
      <span className="flex items-center gap-1 text-ink-500">
        <Ban size={14} aria-hidden /> Declined
      </span>
    );
  if (call.decision === 'blocked')
    return (
      <span className="flex items-center gap-1 text-ink-500">
        <Ban size={14} aria-hidden /> Not permitted
      </span>
    );
  switch (call.status) {
    case 'awaiting':
      return (
        <span className="flex items-center gap-1 text-lamp-400">
          <Circle size={10} fill="currentColor" aria-hidden /> Waiting for you
        </span>
      );
    case 'running':
      return (
        <span className="flex items-center gap-1 text-reactor-500">
          <Loader2 size={14} className="spin" aria-hidden /> Running
        </span>
      );
    case 'success':
      return (
        <span className="flex items-center gap-1 text-ok-400">
          <Check size={14} aria-hidden /> <span className="tabular">{call.durationMs ?? 0} ms</span>
        </span>
      );
    case 'error':
      return (
        <span className="flex items-center gap-1 text-alarm-500">
          <X size={14} aria-hidden /> Failed
        </span>
      );
    case 'not_run':
      return <span className="text-ink-500">Not run</span>;
    default:
      return (
        <span className="flex items-center gap-1 text-ink-500">
          <Circle size={8} fill="currentColor" aria-hidden /> Pending
        </span>
      );
  }
}

/** Design-system.md §5.4. */
export function ToolCallCard({
  call,
  compact = false,
}: {
  call: UiToolCall;
  compact?: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={clsx(
        'glass-inset text-sm',
        // §6.4: awaiting Sir gets a 2px amber bar.
        call.status === 'awaiting' && 'shadow-[inset_2px_0_0_var(--lamp-400)]',
      )}
    >
      <button
        type="button"
        className="flex min-h-10 w-full items-center gap-2 px-2.5 py-1.5 text-left"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Wrench size={14} className="shrink-0 text-ink-500" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-ink-100" title={call.humanSummary}>
          {call.humanSummary}
        </span>
        {!compact && (
          <span
            className={clsx('rounded-pill border px-2 text-xs font-medium', TIER_CLASS[call.tier])}
          >
            {call.tier}
          </span>
        )}
        <StatusIndicator call={call} />
        {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
      </button>
      {call.status === 'error' && call.error && !open && (
        <p className="truncate px-2.5 pb-1.5 text-alarm-500">{call.error}</p>
      )}
      {open && (
        <div className="space-y-2 rounded-b-md border-t border-glass-border bg-solid-inset px-2.5 py-2 font-code text-xs text-ink-300">
          <div>
            <div className="mb-1 font-body text-ink-500">{call.toolName} · input</div>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all">
              {call.inputPreview}
            </pre>
          </div>
          {(call.outputPreview ?? call.error) && (
            <div>
              <div className="mb-1 font-body text-ink-500">output</div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all">
                {call.error ?? call.outputPreview}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
