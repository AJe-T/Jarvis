import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { confirmAction } from '../../components/ui/confirm-modal';
import { Section } from '../../components/ui/field';
import { call, cleanError } from '../../lib/api';
import { useSetting } from '../../stores/settings-store';
import { useUiStore } from '../../stores/ui-store';
import { SettingSwitch, saveSetting } from './settings-controls';
import { ModelDownload, useModels } from './voice-engines';

/** ChatGPT / Claude.ai history → Memory/Imports (idea from LibreChat's import). */
function ImportChats(): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const toast = useUiStore((s) => s.toast);
  async function run(): Promise<void> {
    setBusy(true);
    try {
      const r = await call('memory:importChats', {});
      if (r.cancelled) return;
      const parts = [
        `${r.imported} chat${r.imported === 1 ? '' : 's'} imported`,
        r.skipped ? `${r.skipped} already there` : '',
        r.failed ? `${r.failed} could not be saved` : '',
      ].filter(Boolean);
      toast({ level: r.failed ? 'warn' : 'info', message: `${parts.join(', ')}.` });
    } catch (err) {
      toast({ level: 'error', message: cleanError(err) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Section
      title="Import chats from ChatGPT or Claude"
      description="Bring your past conversations into Jarvis's memory, so he can recall them when they matter. Export your data (ChatGPT: Settings → Data controls → Export; Claude: Settings → Privacy → Export data), then pick the .zip you receive. Each chat becomes a note in Memory/Imports; importing again skips chats already there. Nothing is uploaded."
    >
      <div>
        <Button disabled={busy} onClick={() => void run()}>
          {busy ? 'Importing…' : 'Choose export file…'}
        </Button>
      </div>
    </Section>
  );
}

export function MemorySection(): React.JSX.Element {
  const vault = useSetting('vault.path') ?? '';
  const [busy, setBusy] = useState(false);
  const toast = useUiStore((s) => s.toast);
  const models = useModels();

  async function changeVault(): Promise<void> {
    const r = await call('app:pickFolder', { title: 'Choose the JarvisBrain vault folder' });
    if (!r.path || r.path === vault) return;
    const okd = await confirmAction({
      title: "Use this folder as Jarvis's memory?",
      body: `${r.path}\n\nJarvis creates its folders there if needed. The old vault is left untouched.`,
      actionLabel: 'Use folder',
      destructive: false,
    });
    if (okd) await saveSetting('vault.path', r.path);
  }

  async function rebuild(): Promise<void> {
    setBusy(true);
    try {
      const r = await call('memory:rebuildIndex', {});
      toast({ level: 'info', message: `Index rebuilt from ${r.files} notes.` });
    } catch (err) {
      toast({ level: 'error', message: cleanError(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Section
        title="Memory vault"
        description="Jarvis's long-term memory is an Obsidian vault of Markdown notes. You can edit them; Jarvis notices within seconds."
      >
        <p className="rounded-sm bg-surface-2 px-3 py-2 font-code text-sm break-all">{vault}</p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void call('memory:openInObsidian', {})}>Open in Obsidian</Button>
          <Button onClick={() => void changeVault()}>Choose another folder…</Button>
          <Button variant="ghost" disabled={busy} onClick={() => void rebuild()}>
            Rebuild index
          </Button>
        </div>
      </Section>
      <ImportChats />
      <Section
        title="Semantic search"
        description="Finds memories and past conversations by meaning, not just matching words (an idea from isair/jarvis). Runs on this PC with a 24 MB model; nothing is sent anywhere."
      >
        <ModelDownload id="minilm-embed" models={models} />
        <SettingSwitch
          k="memory.semanticSearch"
          label="Use semantic search when the model is downloaded"
        />
      </Section>
      <Section
        title="Smarter recall"
        description="Ideas from Hindsight (vectorize-io/hindsight). Re-ranking reads your question together with each note Jarvis found and keeps the ones that really answer it (on this PC, 23 MB). Reflection looks across your memory once a week with the fast model and writes patterns it sees to Memory/Facts/Observations.md, each marked (inferred); instructions and doubtful items go to Review instead."
      >
        <ModelDownload id="minilm-rerank" models={models} />
        <SettingSwitch
          k="memory.rerank"
          label="Re-rank found memories when the model is downloaded"
        />
        <SettingSwitch k="memory.reflect" label="Reflect on my memory once a week" />
      </Section>
    </>
  );
}
