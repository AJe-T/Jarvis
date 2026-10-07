import { useState } from 'react';
import { FolderPlus, X } from 'lucide-react';
import type { Tier } from '@shared/types';
import { Button } from '../../components/ui/button';
import { confirmAction } from '../../components/ui/confirm-modal';
import { Section, TextInput } from '../../components/ui/field';
import { call } from '../../lib/api';
import { useSetting } from '../../stores/settings-store';
import { saveSetting } from './settings-controls';

/** Security.md §5.1 allowed roots and §5 step 4 per-tool overrides (changes need their own confirmation). */
export function FilesSection(): React.JSX.Element {
  const roots = useSetting('files.allowedRoots') ?? [];
  const overrides = useSetting('policy.overrides') ?? {};
  const [tool, setTool] = useState('');
  const [tier, setTier] = useState<Tier>('CONFIRM');

  async function addRoot(): Promise<void> {
    const r = await call('app:pickFolder', { title: 'Allow Jarvis to work in this folder' });
    if (!r.path || roots.includes(r.path)) return;
    const okd = await confirmAction({
      title: 'Allow Jarvis to use this folder?',
      body: `${r.path}\n\nJarvis will be able to read files here, and create, move or delete them after asking you.`,
      actionLabel: 'Allow folder',
      destructive: false,
    });
    if (okd) await saveSetting('files.allowedRoots', [...roots, r.path]);
  }

  async function removeRoot(root: string): Promise<void> {
    const okd = await confirmAction({
      title: 'Remove this folder?',
      body: root,
      actionLabel: 'Remove folder',
      destructive: false,
    });
    if (okd)
      await saveSetting(
        'files.allowedRoots',
        roots.filter((x) => x !== root),
      );
  }

  async function addOverride(): Promise<void> {
    const name = tool.trim();
    if (!/^[a-zA-Z0-9_-]{2,64}$/.test(name)) return;
    const okd = await confirmAction({
      title: `${tier === 'BLOCKED' ? 'Block' : 'Always confirm'} ${name}?`,
      body:
        tier === 'BLOCKED'
          ? `Jarvis will never run ${name}.`
          : `Jarvis will ask before every use of ${name}.`,
      actionLabel: tier === 'BLOCKED' ? 'Block tool' : 'Require confirmation',
      destructive: false,
    });
    if (!okd) return;
    await saveSetting('policy.overrides', { ...overrides, [name]: tier });
    setTool('');
  }

  async function removeOverride(name: string): Promise<void> {
    const { [name]: _gone, ...rest } = overrides;
    const okd = await confirmAction({
      title: `Remove the rule for ${name}?`,
      body: 'It goes back to its default safety level.',
      actionLabel: 'Remove rule',
      destructive: false,
    });
    if (okd) await saveSetting('policy.overrides', rest);
  }

  return (
    <>
      <Section
        title="Allowed folders"
        description="Jarvis can only touch files inside these folders. System folders, AppData, .ssh and Jarvis's own data are always off-limits."
      >
        <ul className="flex flex-col gap-1">
          {roots.map((r) => (
            <li
              key={r}
              className="flex items-center justify-between gap-2 rounded-sm bg-glass-inset px-3 py-1.5"
            >
              <span className="font-code text-sm break-all text-ink-100">{r}</span>
              <button
                type="button"
                aria-label={`Remove ${r}`}
                className="rounded-sm p-1 text-ink-500 hover:text-alarm-500"
                onClick={() => void removeRoot(r)}
              >
                <X size={14} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
        <div>
          <Button onClick={() => void addRoot()}>
            <FolderPlus size={14} aria-hidden /> Add folder
          </Button>
        </div>
      </Section>
      <Section
        title="Stricter rules"
        description="Make a tool always ask, or block it entirely. Rules can only make Jarvis more careful, never less."
      >
        {Object.keys(overrides).length > 0 && (
          <ul className="flex flex-col gap-1">
            {Object.entries(overrides).map(([name, t]) => (
              <li
                key={name}
                className="flex items-center justify-between rounded-sm bg-glass-inset px-3 py-1.5 text-sm"
              >
                <span className="font-code">{name}</span>
                <span className="flex items-center gap-2">
                  <span className={t === 'BLOCKED' ? 'text-alarm-500' : 'text-lamp-400'}>
                    {t === 'BLOCKED' ? 'Blocked' : 'Always confirm'}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove rule for ${name}`}
                    className="p-1 text-ink-500 hover:text-ink-100"
                    onClick={() => void removeOverride(name)}
                  >
                    <X size={14} aria-hidden />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <TextInput
            aria-label="Tool name"
            placeholder="Tool name, e.g. open_url"
            value={tool}
            onChange={(e) => setTool(e.target.value)}
            className="w-64 font-code text-sm"
          />
          <select
            aria-label="Rule"
            value={tier}
            onChange={(e) => setTier(e.target.value as Tier)}
            className="min-h-9 rounded-md border border-glass-border bg-glass-inset px-2 text-sm"
          >
            <option value="CONFIRM">Always confirm</option>
            <option value="BLOCKED">Block</option>
          </select>
          <Button onClick={() => void addOverride()} disabled={!tool.trim()}>
            Add rule
          </Button>
        </div>
      </Section>
    </>
  );
}
