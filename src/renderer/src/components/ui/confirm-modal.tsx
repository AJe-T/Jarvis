import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle } from 'lucide-react';
import { create } from 'zustand';
import { Button } from './button';

interface Ask {
  title: string;
  body: string;
  actionLabel: string;
  destructive: boolean;
  resolve(ok: boolean): void;
}

const useAsk = create<{ current: Ask | null }>(() => ({ current: null }));

/**
 * In-app confirmation for UI-initiated actions (delete a conversation, forget a memory, change a
 * sensitive setting). Tool confirmations use ConfirmDialog, which is driven by main.
 */
export function confirmAction(opts: Omit<Ask, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => useAsk.setState({ current: { ...opts, resolve } }));
}

export function ConfirmModalHost(): React.JSX.Element | null {
  const ask = useAsk((s) => s.current);
  if (!ask) return null;
  const close = (ok: boolean): void => {
    useAsk.setState({ current: null });
    ask.resolve(ok);
  };
  return (
    <Dialog.Root open onOpenChange={(o) => !o && close(false)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-night-950/70" />
        <Dialog.Content
          role="alertdialog"
          className="fixed top-1/2 left-1/2 z-50 w-[min(28rem,90vw)] -translate-x-1/2 -translate-y-1/2 rounded-md border border-night-600 bg-night-800 p-5 shadow-2xl"
          onOpenAutoFocus={(e) => {
            if (ask.destructive) {
              e.preventDefault();
              document.getElementById('confirm-modal-cancel')?.focus();
            }
          }}
        >
          <Dialog.Title className="flex items-center gap-2 text-lg font-semibold text-ink-100">
            <AlertTriangle
              size={18}
              aria-hidden
              className={ask.destructive ? 'text-alarm-500' : 'text-lamp-400'}
            />
            {ask.title}
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm whitespace-pre-line text-ink-300">
            {ask.body}
          </Dialog.Description>
          <div className="mt-5 flex justify-end gap-2">
            <Button id="confirm-modal-cancel" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button variant={ask.destructive ? 'danger' : 'primary'} onClick={() => close(true)}>
              {ask.actionLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
