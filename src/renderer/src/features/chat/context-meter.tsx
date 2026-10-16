import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import type { Res } from '@shared/ipc-contract';
import { Button } from '../../components/ui/button';
import { call, cleanError } from '../../lib/api';
import { useChatStore } from '../../stores/chat-store';
import { useUiStore } from '../../stores/ui-store';

type Stats = Res<'conversations:context'>;

const k = (n: number): string =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : `${n}`;

/** Folds the active conversation into its summary (the meter's button and the /compact command). */
export async function compactActive(): Promise<void> {
  const id = useChatStore.getState().activeId;
  const toast = useUiStore.getState().toast;
  if (!id) {
    toast({ level: 'info', message: 'Nothing to compact yet.' });
    return;
  }
  try {
    const r = await call('conversations:compact', { id });
    toast({
      level: 'info',
      message: r.summarizedMessages
        ? `Compacted: ${r.summarizedMessages} messages folded into a summary.`
        : 'Already compact.',
    });
    window.dispatchEvent(new Event('jarvis:context-changed'));
  } catch (err) {
    toast({ level: 'error', message: cleanError(err) });
  }
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}): React.JSX.Element {
  return (
    <li className="flex items-center gap-2">
      <span aria-hidden className={clsx('size-2 rounded-full', tone)} />
      <span className="text-ink-300">{label}</span>
      <span className="ml-auto font-code text-ink-100 tabular">{k(value)}</span>
    </li>
  );
}

/**
 * Context meter (idea from LibreChat): how full the next request's context is. Click for the split
 * (dialogue, tool traffic, instructions) and a Compact button.
 */
export function ContextMeter(): React.JSX.Element | null {
  const activeId = useChatStore((s) => s.activeId);
  const count = useChatStore((s) => s.messages.length);
  const live = useChatStore((s) => s.live !== null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    if (!activeId) return setStats(null);
    // A slow answer for a chat Sir already left must not show over the one he is in.
    const stillHere = (): boolean => useChatStore.getState().activeId === activeId;
    call('conversations:context', { id: activeId })
      .then((s) => stillHere() && setStats(s))
      .catch(() => stillHere() && setStats(null));
  }, [activeId]);

  useEffect(() => {
    if (!live) refresh();
  }, [refresh, count, live]);
  useEffect(() => {
    window.addEventListener('jarvis:context-changed', refresh);
    return () => window.removeEventListener('jarvis:context-changed', refresh);
  }, [refresh]);

  if (!stats) return null;
  const pct = Math.min(100, Math.round((stats.usedTokens / stats.windowTokens) * 100));
  const tone = pct >= 85 ? 'bg-alarm-500' : pct >= 60 ? 'bg-lamp-400' : 'bg-accent-500';
  return (
    <div className="relative">
      <button
        type="button"
        aria-label={`Context ${pct}% full. Show details`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-sm px-1.5 py-1 hover:bg-hover"
      >
        <span aria-hidden className="h-1.5 w-12 overflow-hidden rounded-full bg-surface-2">
          <span className={clsx('block h-full', tone)} style={{ width: `${Math.max(2, pct)}%` }} />
        </span>
        <span className="font-code text-3xs text-ink-500 tabular">{pct}%</span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Context"
          className="popover absolute right-0 z-30 mt-1 w-64 p-3 text-xs"
        >
          <p className="mb-2 text-ink-100">
            <span className="font-code tabular">{k(stats.usedTokens)}</span> of{' '}
            <span className="font-code tabular">{k(stats.windowTokens)}</span> tokens
            {stats.estimated ? ' (estimated)' : ''}
          </p>
          <ul className="mb-2 flex flex-col gap-1">
            <Row label="Conversation" value={stats.dialogueTokens} tone="bg-accent-500" />
            <Row label="Tool traffic" value={stats.toolTokens} tone="bg-neon-magenta" />
            <Row label="Instructions, memory & tools" value={stats.otherTokens} tone="bg-ink-500" />
          </ul>
          <p className="mb-3 text-ink-500">
            {stats.messages} messages sent each turn
            {stats.summarizedMessages
              ? `; ${stats.summarizedMessages} older ones are summarised`
              : ''}
            .
          </p>
          <Button
            className="w-full"
            disabled={busy || live}
            onClick={() => {
              setBusy(true);
              void compactActive().finally(() => {
                setBusy(false);
                setOpen(false);
              });
            }}
          >
            {busy ? 'Compacting…' : 'Compact now'}
          </Button>
          <p className="mt-2 text-3xs text-ink-500">
            Folds everything so far into a short summary, so replies get cheaper and faster. Type
            /compact to do the same.
          </p>
        </div>
      )}
    </div>
  );
}
