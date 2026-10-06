import type { EventPayload } from '@shared/ipc-contract';
import type { DecidedBy } from '../db/repos/tool-calls-repo';
import { newId } from '../lib/util';

export type ConfirmRequestEvent = EventPayload<'confirm:request'>;
export type Decision = 'approve' | 'deny';

export interface ConfirmInput {
  toolName: string;
  title: string;
  humanSummary: string;
  purpose?: string | undefined;
  details: string;
  detailsKind: 'text' | 'code' | 'paths';
  actionLabel: string;
  destructive: boolean;
  taintedFrom?: string | undefined;
}

interface Pending {
  id: string;
  input: ConfirmInput;
  resolve(r: { decision: Decision; decidedBy: DecidedBy }): void;
  timer?: ReturnType<typeof setTimeout>;
  expiresAt?: string;
}

export const CONFIRM_TIMEOUT_MS = 120_000;

/**
 * API-Guide.md §6.5 / Design-system.md §5.5: one dialog at a time, in order. Resolves on Sir's answer,
 * the kill switch (deny), or a 120 s timeout (deny). Voice can approve only non-destructive actions.
 */
export function createConfirmationBroker(deps: {
  emit(e: 'confirm:request', p: ConfirmRequestEvent): void;
  emitResolved(p: { requestId: string; decision: Decision }): void;
  onShow?(req: ConfirmRequestEvent): void;
  timeoutMs?: number;
}) {
  const queue: Pending[] = [];
  const timeoutMs = deps.timeoutMs ?? CONFIRM_TIMEOUT_MS;

  function show(): void {
    const head = queue[0];
    if (!head || head.timer) return;
    head.expiresAt = new Date(Date.now() + timeoutMs).toISOString();
    head.timer = setTimeout(() => finish(head.id, 'deny', 'timeout'), timeoutMs);
    const event: ConfirmRequestEvent = {
      requestId: head.id,
      toolName: head.input.toolName,
      title: head.input.title,
      humanSummary: head.input.humanSummary,
      details: head.input.details,
      detailsKind: head.input.detailsKind,
      actionLabel: head.input.actionLabel,
      destructive: head.input.destructive,
      expiresAt: head.expiresAt,
      queuePosition: 1,
      queueTotal: queue.length,
      ...(head.input.purpose ? { purpose: head.input.purpose } : {}),
      ...(head.input.taintedFrom ? { taintedFrom: head.input.taintedFrom } : {}),
    };
    deps.emit('confirm:request', event);
    deps.onShow?.(event);
  }

  function finish(id: string, decision: Decision, decidedBy: DecidedBy): boolean {
    const idx = queue.findIndex((p) => p.id === id);
    if (idx === -1) return false;
    const [p] = queue.splice(idx, 1);
    if (!p) return false;
    if (p.timer) clearTimeout(p.timer);
    deps.emitResolved({ requestId: id, decision });
    p.resolve({ decision, decidedBy });
    show();
    return true;
  }

  return {
    request(
      input: ConfirmInput,
      signal: AbortSignal,
    ): Promise<{ decision: Decision; decidedBy: DecidedBy }> {
      return new Promise((resolve) => {
        const id = newId('cf_');
        if (signal.aborted) return resolve({ decision: 'deny', decidedBy: 'kill_switch' });
        queue.push({ id, input, resolve });
        signal.addEventListener('abort', () => finish(id, 'deny', 'kill_switch'), { once: true });
        show();
      });
    },

    respond(id: string, decision: Decision, via: 'click' | 'keyboard' | 'voice'): boolean {
      const p = queue.find((q) => q.id === id);
      if (!p || p !== queue[0]) return false;
      // Security.md §4: destructive actions need a click or Ctrl+Enter, never voice.
      if (via === 'voice' && decision === 'approve' && p.input.destructive) return false;
      return finish(id, decision, via === 'voice' ? 'user_voice' : 'user_click');
    },

    current(): (ConfirmInput & { id: string }) | null {
      const head = queue[0];
      return head?.timer ? { ...head.input, id: head.id } : null;
    },

    denyAll(): void {
      for (const p of [...queue]) finish(p.id, 'deny', 'kill_switch');
    },

    size: () => queue.length,
  };
}

export type ConfirmationBroker = ReturnType<typeof createConfirmationBroker>;
