import { useEffect, useState } from 'react';
import type { Req, Res } from '@shared/ipc-contract';
import { Section } from '../../components/ui/field';
import { Button } from '../../components/ui/button';
import { confirmAction } from '../../components/ui/confirm-modal';
import { call, cleanError } from '../../lib/api';
import { useUiStore } from '../../stores/ui-store';

type Folder = Req<'app:openFolder'>['which'];

function OpenFolder({ which, label }: { which: Folder; label: string }): React.JSX.Element {
  const toast = useUiStore((s) => s.toast);
  return (
    <Button
      variant="ghost"
      onClick={() =>
        void call('app:openFolder', { which }).catch((e: unknown) =>
          toast({ level: 'error', message: cleanError(e) }),
        )
      }
    >
      {label}
    </Button>
  );
}

/** Database.md §7: daily backups (7 kept), manual backup, restore on restart. */
export function DataSection(): React.JSX.Element {
  const [backups, setBackups] = useState<Res<'db:backups'>>([]);
  const toast = useUiStore((s) => s.toast);
  const load = (): void => void call('db:backups', {}).then(setBackups);
  useEffect(load, []);

  const restore = async (file: string): Promise<void> => {
    const ok = await confirmAction({
      title: 'Restore this backup?',
      body: `Jarvis will restart and replace your current history, settings and reminders with the copy from ${file}. A copy of your current data is kept as pre-restore.db in the data folder.`,
      actionLabel: 'Restore and restart',
      destructive: true,
    });
    if (ok)
      await call('db:restore', { file }).catch((e: unknown) =>
        toast({ level: 'error', message: cleanError(e) }),
      );
  };

  return (
    <Section
      title="Data & backups"
      description="Jarvis backs up its database once a day and keeps the last 7 copies. Your Obsidian vault is plain files; back it up however you like."
    >
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() =>
            void call('db:backupNow', {})
              .then(() => {
                toast({ level: 'info', message: 'Backup saved.' });
                load();
              })
              .catch((e: unknown) => toast({ level: 'error', message: cleanError(e) }))
          }
        >
          Back up now
        </Button>
        <OpenFolder which="backups" label="Open backups folder" />
        <OpenFolder which="userData" label="Open data folder" />
        <OpenFolder which="vault" label="Open vault" />
      </div>
      <ul className="flex max-w-xl flex-col gap-1">
        {backups.length === 0 && <li className="text-sm text-ink-500">No backups yet.</li>}
        {backups.map((b) => (
          <li
            key={b.file}
            className="flex items-center justify-between gap-3 rounded-md border border-glass-border px-3 py-2 text-sm"
          >
            <span className="text-ink-100 tabular">{new Date(b.createdAt).toLocaleString()}</span>
            <Button variant="ghost" onClick={() => void restore(b.file)}>
              Restore
            </Button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function AboutSection(): React.JSX.Element {
  const [info, setInfo] = useState<Res<'app:info'> | null>(null);
  useEffect(() => void call('app:info', {}).then(setInfo), []);
  return (
    <Section title="About Jarvis">
      <dl className="grid max-w-xl grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-ink-500">Version</dt>
        <dd className="text-ink-100 tabular">{info?.version ?? '…'}</dd>
        <dt className="text-ink-500">Data folder</dt>
        <dd className="font-code text-xs break-all text-ink-300">{info?.userData ?? '…'}</dd>
        <dt className="text-ink-500">Vault</dt>
        <dd className="font-code text-xs break-all text-ink-300">{info?.vaultPath ?? '…'}</dd>
      </dl>
      <div className="flex flex-wrap gap-2">
        <OpenFolder which="logs" label="Open logs folder" />
      </div>
      <p className="max-w-[60ch] text-xs text-ink-500">
        Built with Electron, React and the Claude API. Open-source licences are listed in
        THIRD_PARTY_NOTICES.md next to the app. Fonts: Outfit, JetBrains Mono (SIL Open Font
        License).
      </p>
    </Section>
  );
}
