import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle, ChevronDown, ChevronRight, Info, ShieldAlert } from 'lucide-react';
import clsx from 'clsx';
import { call } from '../../lib/api';
import { useConfirmStore, type ConfirmRequest } from '../../stores/confirm-store';
import { Button } from '../ui/button';

function useCountdown(expiresAt: string): number {
  const [left, setLeft] = useState(() =>
    Math.max(0, Math.round((Date.parse(expiresAt) - Date.now()) / 1000)),
  );
  useEffect(() => {
    const t = setInterval(
      () => setLeft(Math.max(0, Math.round((Date.parse(expiresAt) - Date.now()) / 1000))),
      500,
    );
    return () => clearInterval(t);
  }, [expiresAt]);
  return left;
}

function Details({ req }: { req: ConfirmRequest }): React.JSX.Element | null {
  const lines = req.details.split('\n');
  const [open, setOpen] = useState(req.detailsKind !== 'paths' || lines.length <= 5);
  if (!req.details.trim()) return null;
  if (req.detailsKind === 'paths') {
    return (
      <div>
        <button
          type="button"
          className="flex items-center gap-1 text-sm text-ink-300 hover:text-ink-100"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
          {open ? 'Hide' : 'Show'} the {lines.length === 1 ? 'path' : `${lines.length} items`}
        </button>
        {open && (
          <pre className="mt-2 max-h-48 overflow-auto rounded-sm bg-solid-inset p-2 font-code text-xs whitespace-pre-wrap text-ink-100">
            {req.details}
          </pre>
        )}
      </div>
    );
  }
  if (req.detailsKind === 'code') {
    return (
      <pre
        className="max-h-64 overflow-auto rounded-sm border border-glass-border bg-solid-inset py-2 font-code text-xs text-ink-100"
        aria-label="Details"
      >
        {lines.map((l, i) => (
          <div key={i} className="flex">
            <span className="w-9 shrink-0 pr-2 text-right text-ink-500 select-none">{i + 1}</span>
            <span className="pr-3 whitespace-pre-wrap break-all">{l}</span>
          </div>
        ))}
      </pre>
    );
  }
  return <p className="text-sm text-ink-300">{req.details}</p>;
}

/**
 * Design-system.md §5.5 — safety-critical. Destructive: red primary, focus starts on Cancel, Enter
 * does not approve (Ctrl+Enter or click does). Non-destructive: Enter approves. Esc denies.
 */
export function ConfirmDialog(): React.JSX.Element | null {
  const req = useConfirmStore((s) => s.current);
  if (!req) return null;
  return <ConfirmDialogBody key={req.requestId} req={req} />;
}

function ConfirmDialogBody({ req }: { req: ConfirmRequest }): React.JSX.Element {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const approveRef = useRef<HTMLButtonElement>(null);
  const left = useCountdown(req.expiresAt);
  const [sent, setSent] = useState(false);

  function respond(decision: 'approve' | 'deny', via: 'click' | 'keyboard'): void {
    if (sent) return;
    setSent(true);
    void call('confirm:respond', { requestId: req.requestId, decision, via }).catch(() =>
      useConfirmStore.getState().resolved(req.requestId),
    );
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      respond('approve', 'keyboard');
    } else if (
      req.destructive &&
      (e.key === 'Enter' || e.key === ' ') &&
      (document.activeElement === approveRef.current ||
        document.activeElement?.tagName !== 'BUTTON')
    ) {
      // A destructive action is approved only by a click or Ctrl+Enter, never by a stray Enter/Space.
      e.preventDefault();
    }
  }

  return (
    <Dialog.Root open onOpenChange={(o) => !o && respond('deny', 'keyboard')}>
      <Dialog.Portal>
        <Dialog.Overlay className="glass-scrim fade-in fixed inset-0 z-40" />
        <Dialog.Content
          role="alertdialog"
          aria-describedby="confirm-summary"
          onKeyDown={onKeyDown}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (req.destructive ? cancelRef : approveRef).current?.focus();
          }}
          className={clsx(
            // §6.5: the most opaque glass in the app; destructive gets a red edge, confirm-tier an amber top hairline.
            'glass-decision modal-in fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-[min(30rem,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto p-6',
            req.destructive ? 'border-alarm-500/50' : 'border-t-2 border-t-lamp-400',
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <Dialog.Title className="flex items-start gap-2 text-lg font-semibold text-ink-100">
              {req.destructive ? (
                <AlertTriangle size={20} className="mt-1 shrink-0 text-alarm-500" aria-hidden />
              ) : (
                <ShieldAlert size={20} className="mt-1 shrink-0 text-lamp-400" aria-hidden />
              )}
              {req.title}
            </Dialog.Title>
            {req.queueTotal > 1 && (
              <span className="shrink-0 text-xs text-ink-500 tabular">{`${req.queuePosition} of ${req.queueTotal}`}</span>
            )}
          </div>

          <p id="confirm-summary" className="text-base text-ink-300">
            {req.purpose
              ? `Jarvis wants to ${req.purpose.replace(/^./, (c) => c.toLowerCase())}`
              : req.humanSummary}
          </p>

          <Details req={req} />

          {req.taintedFrom && (
            <p
              className="flex items-start gap-2 rounded-sm border border-lamp-400/40 bg-lamp-tint p-2 text-sm text-ink-100"
              role="note"
            >
              <Info size={16} className="mt-0.5 shrink-0 text-lamp-400" aria-hidden />
              Suggested after reading {req.taintedFrom}. Check it carefully.
            </p>
          )}

          <div className="flex items-center justify-between gap-3 pt-1">
            <span className="text-xs text-ink-500" aria-live="polite">
              {left <= 20
                ? `Cancels automatically in ${left} s`
                : req.destructive
                  ? 'Ctrl+Enter to confirm'
                  : ''}
            </span>
            <div className="flex gap-2">
              <Button ref={cancelRef} onClick={() => respond('deny', 'click')} disabled={sent}>
                Cancel
              </Button>
              <Button
                ref={approveRef}
                variant={req.destructive ? 'danger' : 'primary'}
                onClick={() => respond('approve', 'click')}
                disabled={sent}
              >
                {req.actionLabel}
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
