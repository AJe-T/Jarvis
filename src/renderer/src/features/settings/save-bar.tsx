import { useEffect } from 'react';
import { Button } from '../../components/ui/button';
import { confirmAction } from '../../components/ui/confirm-modal';
import { call } from '../../lib/api';
import { useSettingsStore } from '../../stores/settings-store';
import { useUiStore } from '../../stores/ui-store';

/** Design-system.md §6.9: edits wait here until Save; big ones offer a restart. Ctrl+S saves. */
export function SaveBar(): React.JSX.Element | null {
  const count = useSettingsStore((s) => Object.keys(s.drafts).length);
  const toast = useUiStore((s) => s.toast);

  async function save(): Promise<void> {
    const { restart, errors } = await useSettingsStore.getState().saveDrafts();
    for (const message of errors) toast({ level: 'error', message });
    if (errors.length === 0) toast({ level: 'info', message: 'Settings saved.' });
    if (restart.length === 0) return;
    const now = await confirmAction({
      title: 'Restart Jarvis now?',
      body: 'Some of these changes (connection, memory or vault) apply best after a restart.',
      actionLabel: 'Restart now',
      destructive: false,
    });
    if (now) await call('app:relaunch', {});
  }

  useEffect(() => {
    if (count === 0) return;
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (count === 0) return null;
  return (
    <div
      role="region"
      aria-label="Unsaved settings"
      className="popover toast-in mx-auto mb-4 flex w-[min(640px,calc(100%-2rem))] shrink-0 items-center gap-3 px-4 py-2.5"
    >
      <span className="size-2 shrink-0 rounded-pill bg-lamp-400 dot-breathe" aria-hidden />
      <p className="min-w-0 flex-1 font-code text-sm text-ink-100">
        {count} unsaved {count === 1 ? 'change' : 'changes'}
      </p>
      <Button variant="ghost" onClick={() => useSettingsStore.getState().discard()}>
        Discard
      </Button>
      <Button variant="primary" onClick={() => void save()}>
        Save changes
      </Button>
    </div>
  );
}
